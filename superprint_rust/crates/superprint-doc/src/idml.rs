//! Lecture d'un `.idml` : InDesign Markup Language.
//!
//! ## Ce qu'est un `.idml`
//!
//! Une archive ZIP, comme les autres, mais dont l'organisation est décrite par
//! un fichier à part : `designmap.xml`. C'est lui qui donne **l'ordre** des
//! choses — les histoires (`Stories/Story_*.xml`) et les planches
//! (`Spreads/Spread_*.xml`) — et c'est pourquoi ce lecteur commence par lui, au
//! lieu de trier des noms de fichiers, ce qui donnerait un ordre arbitraire.
//!
//! | Élément IDML | Ce qu'on en fait |
//! |---|---|
//! | `designmap.xml` → `idPkg:Story@src` | l'ordre des histoires |
//! | `Story` → `ParagraphStyleRange` | un paragraphe, avec son `AppliedParagraphStyle` |
//! | `Justification` | l'alignement (`LeftAlign`, `CenterAlign`…) |
//! | `Content` | le texte |
//! | `Br` | un saut de ligne **forcé** |
//! | `Table` → `Cell@Name` | un tableau, avec la position de chaque case |
//! | `Footnote` | **sorti du flux** et rassemblé : c'est une note, pas un paragraphe |
//! | `Link@LinkResourceURI` | une image référencée |
//! | `Spreads/*.xml` → `Page@GeometricBounds` | le format de page, en points |
//!
//! ## La note de bas de page, et pourquoi elle sort du flux
//!
//! Dans IDML, une `Footnote` est **imbriquée** au milieu de son appelant : elle
//! se trouve littéralement à l'intérieur du paragraphe qui l'appelle. La rendre
//! telle quelle collerait le texte de la note au milieu de la phrase. Le lecteur
//! la retire donc du flux et la rassemble dans [`crate::Memoire::notes`]. C'est
//! une décision, pas une perte : le texte est conservé, et sa place est dite.
//!
//! ## La position d'une case de tableau
//!
//! IDML écrit `Cell@Name="colonne:ligne"`. C'est une convention **observée sur
//! les témoins** et non une déduction : la validation vérifie que le tableau
//! reconstitué a bien la forme attendue (en-têtes en première ligne, contenu en
//! dessous). En cas de convention différente dans un autre fichier, la
//! conséquence est une position de case fausse — le texte, lui, reste complet.

use superprint_zip::Archive;

use crate::xml::Element;
use crate::{analyser_entree, Alignement, ErreurImport, Format, Memoire, Page, Paragraphe};

/// Un point PostScript, en millimètres.
const MM_PAR_POINT: f64 = 25.4 / 72.0;

/// Lit un document InDesign.
///
/// # Erreurs
///
/// [`ErreurImport::EntreeManquante`] si `designmap.xml` renvoie vers une histoire
/// absente de l'archive, [`ErreurImport::SansContenu`] si aucune histoire ne
/// porte de texte.
pub fn lire(archive: &Archive) -> Result<Memoire, ErreurImport> {
    let carte = analyser_entree(archive, "designmap.xml", "")?;
    let mut avertissements: Vec<String> = Vec::new();

    // L'ordre vient du designmap, et de lui seul.
    let histoires: Vec<String> = carte
        .chercher("Story")
        .iter()
        .filter_map(|e| e.attribut("src").map(str::to_string))
        .collect();
    let planches: Vec<String> = carte
        .chercher("Spread")
        .iter()
        .filter_map(|e| e.attribut("src").map(str::to_string))
        .collect();

    if histoires.is_empty() {
        // Un `.idml` sans histoire déclarée : on retombe sur les entrées de
        // l'archive, en le disant. Cela arrive sur des fichiers écrits par des
        // outils tiers.
        avertissements.push(
            "aucune histoire déclarée dans `designmap.xml` : les histoires sont prises \
             dans l'ordre de l'archive"
                .to_string(),
        );
    }
    let a_lire: Vec<String> = if histoires.is_empty() {
        let mut noms: Vec<String> = archive
            .noms()
            .iter()
            .filter(|n| n.starts_with("Stories/") && n.ends_with(".xml"))
            .map(|n| (*n).to_string())
            .collect();
        noms.sort();
        noms
    } else {
        histoires
    };

    let mut paragraphes: Vec<Paragraphe> = Vec::new();
    let mut notes: Vec<String> = Vec::new();
    let mut images: Vec<String> = Vec::new();

    for histoire in &a_lire {
        let racine = analyser_entree(archive, histoire, "")?;
        // La racine d'une histoire est **normalement** l'enveloppe
        // `<idPkg:Story>`, mais elle est parfois `<Story>` directement : les
        // deux formes existent, et refuser la seconde ferait perdre un document
        // valide pour une histoire d'emballage.
        let histoire_element = match racine.enfant("Story") {
            Some(element) => element,
            None if racine.est("Story") => &racine,
            None => {
                avertissements.push(format!("{histoire} : pas d'élément `Story`"));
                continue;
            }
        };
        parcourir(
            histoire_element,
            None,
            &mut paragraphes,
            &mut notes,
            &mut images,
            &mut avertissements,
        );
    }

    // Les images : celles des histoires (liens) et des planches (placement).
    for planche in &planches {
        if let Ok(racine) = analyser_entree(archive, planche, "") {
            for lien in racine.chercher("Link") {
                if let Some(uri) = lien
                    .attribut("LinkResourceURI")
                    .or_else(|| lien.attribut("URI"))
                {
                    pousser_image(uri, &mut images);
                }
            }
        }
    }
    // Et, en dernier recours, les fichiers de l'archive : un `.idml` réel range
    // ses images dans `Links/`, et une image placée est une information de mise
    // en page qu'on ne veut pas perdre.
    for nom in archive.noms() {
        if nom.starts_with("Links/") {
            pousser_image(nom, &mut images);
        }
    }

    let page = lire_page(archive, &planches);

    if paragraphes.is_empty() && notes.is_empty() {
        return Err(ErreurImport::SansContenu {
            entree: a_lire
                .first()
                .cloned()
                .unwrap_or_else(|| "designmap.xml".to_string()),
        });
    }

    Ok(Memoire {
        format: Format::Idml,
        paragraphes,
        page,
        titre: carte
            .enfant("Document")
            .and_then(|d| d.attribut("Name").map(str::to_string)),
        images,
        notes,
        avertissements,
    })
}

/// Normalise une référence d'image en nom d'entrée d'archive.
fn pousser_image(uri: &str, images: &mut Vec<String>) {
    let nom = uri
        .trim_start_matches("file://")
        .trim_start_matches('/')
        .replace('\\', "/");
    // On ne garde que ce qui ressemble à une entrée de l'archive.
    let nom = match nom.find("Links/") {
        Some(position) => nom[position..].to_string(),
        None => nom,
    };
    if !nom.is_empty() && !images.contains(&nom) {
        images.push(nom);
    }
}

/// Parcourt un sous-arbre d'histoire.
fn parcourir(
    element: &Element,
    table: Option<(usize, usize)>,
    paragraphes: &mut Vec<Paragraphe>,
    notes: &mut Vec<String>,
    images: &mut Vec<String>,
    avertissements: &mut Vec<String>,
) {
    for enfant in element.elements() {
        match enfant.local() {
            "ParagraphStyleRange" => {
                let mut paragraphe = lire_paragraphe(enfant, images, notes);
                paragraphe.table = table;
                paragraphes.push(paragraphe);
            }
            // Une note de bas de page sort du flux : c'est le seul moyen de ne
            // pas coller son texte au milieu de la phrase qui l'appelle. Elle
            // est normalement **dans** le paragraphe, et c'est
            // [`collecter_notes`] qui la ramasse ; ce cas-ci couvre les fichiers
            // où elle se trouve au niveau de l'histoire.
            "Footnote" | "Endnote" => {
                collecter_notes(enfant, notes, images);
            }
            "Table" => {
                let mut vues: Vec<(usize, usize)> = Vec::new();
                for cellule in enfant.elements().filter(|e| e.est("Cell")) {
                    let position = position_de_cellule(cellule);
                    if let Some(position) = position {
                        if vues.contains(&position) {
                            avertissements.push(format!(
                                "deux cases de tableau portent la position {}:{} — la seconde \
                                 est gardée, mais la position est ambiguë",
                                position.0, position.1
                            ));
                        }
                        vues.push(position);
                    }
                    parcourir(
                        cellule,
                        position,
                        paragraphes,
                        notes,
                        images,
                        avertissements,
                    );
                }
                let cellules_vides = enfant
                    .elements()
                    .filter(|e| e.est("Cell"))
                    .filter(|e| !e.chercher("ParagraphStyleRange").is_empty())
                    .count();
                if cellules_vides == 0 {
                    avertissements.push("un tableau ne contient aucun paragraphe".to_string());
                }
            }
            "Link" => {
                if let Some(uri) = enfant
                    .attribut("LinkResourceURI")
                    .or_else(|| enfant.attribut("URI"))
                {
                    pousser_image(uri, images);
                }
            }
            // Les conteneurs sans effet sur le texte : on descend.
            _ => parcourir(enfant, table, paragraphes, notes, images, avertissements),
        }
    }
}

/// La position `(colonne, ligne)` d'une case, tirée de son `Name`.
///
/// # Ce que cette fonction ne fait pas
///
/// Elle ne devine pas : si `Name` est absent ou n'a pas la forme `a:b`, elle rend
/// `None` et la case garde la position de son tableau. Une case sans position
/// vaut mieux qu'une case à une position inventée.
fn position_de_cellule(cellule: &Element) -> Option<(usize, usize)> {
    let nom = cellule.attribut("Name")?;
    let (premier, second) = nom.split_once(':')?;
    Some((
        premier.trim().parse::<usize>().ok()?,
        second.trim().parse::<usize>().ok()?,
    ))
}

/// Le texte d'un `ParagraphStyleRange`.
fn lire_paragraphe(
    range: &Element,
    images: &mut Vec<String>,
    notes: &mut Vec<String>,
) -> Paragraphe {
    let mut paragraphe = Paragraphe::texte(String::new());
    if let Some(style) = range.attribut("AppliedParagraphStyle") {
        paragraphe.style = Some(nom_de_style(style));
        paragraphe.niveau = niveau_du_style(style);
    }
    if let Some(justification) = range.attribut("Justification") {
        paragraphe.alignement = alignement(justification);
    }
    collecter(range, &mut paragraphe.texte, images, 0);
    // Les notes sont **dans** le paragraphe (IDML les y imbrique) : on les
    // ramasse ici, pendant qu'on parcourt, parce qu'après on ne saurait plus où
    // elles sont.
    collecter_notes(range, notes, images);
    paragraphe
}

/// Ramasse les notes de bas de page et de fin d'un sous-arbre.
///
/// Le texte est conservé tel quel, retiré du flux. L'insertion n'est faite
/// qu'une fois : le même sous-arbre peut être visité par plusieurs chemins.
fn collecter_notes(element: &Element, notes: &mut Vec<String>, images: &mut Vec<String>) {
    for note in element
        .chercher("Footnote")
        .into_iter()
        .chain(element.chercher("Endnote"))
    {
        let mut texte = String::new();
        for range in note.chercher("ParagraphStyleRange") {
            let mut morceau = String::new();
            collecter(range, &mut morceau, images, 0);
            let morceau = morceau.trim_end();
            if !morceau.is_empty() {
                if !texte.is_empty() {
                    texte.push('\n');
                }
                texte.push_str(morceau);
            }
        }
        if !texte.is_empty() && !notes.contains(&texte) {
            notes.push(texte);
        }
    }
}

/// Accumule `Content` et `Br`, sans descendre dans ce qui n'est pas du texte.
fn collecter(element: &Element, sortie: &mut String, images: &mut Vec<String>, profondeur: usize) {
    // Garde-fou : un document mal formé ne doit pas faire déborder la pile.
    if profondeur > 64 {
        return;
    }
    for enfant in element.elements() {
        match enfant.local() {
            "Content" => sortie.push_str(&enfant.texte()),
            // Un saut de ligne forcé.
            "Br" => sortie.push('\n'),
            // Une tabulation.
            "Tab" => sortie.push('\t'),
            "Link" => {
                if let Some(uri) = enfant
                    .attribut("LinkResourceURI")
                    .or_else(|| enfant.attribut("URI"))
                {
                    pousser_image(uri, images);
                }
            }
            // Une note n'appartient pas à ce paragraphe : elle est déjà
            // rassemblée à part, et la descendre la collerait dans la phrase.
            "Footnote" | "Endnote" | "Table" => {}
            // Le reste se descend : `CharacterStyleRange`, `HyperlinkTextSource`,
            // `TextVariableInstance`, `NestedStyle`…
            _ => collecter(enfant, sortie, images, profondeur + 1),
        }
    }
}

/// `ParagraphStyle/Titre` → `Titre`. `CharacterStyle/$ID/Normal` → `Normal`.
///
/// Le préfixe `$ID/` marque un style **intégré** à InDesign : on le retire, il
/// n'appartient pas au nom.
#[must_use]
pub fn nom_de_style(chemin: &str) -> String {
    let dernier = chemin.rsplit('/').next().unwrap_or(chemin);
    dernier.trim_start_matches("$ID/").to_string()
}

/// Un nom de style de paragraphe qui commence par « Titre » ou « Heading » suivi
/// d'un chiffre est un titre de ce niveau.
#[must_use]
pub fn niveau_du_style(chemin: &str) -> Option<u8> {
    let nom = nom_de_style(chemin).to_lowercase();
    let reste = nom
        .strip_prefix("titre")
        .or_else(|| nom.strip_prefix("heading"))
        .or_else(|| nom.strip_prefix("h"))?;
    let chiffres: String = reste.chars().filter(|c| c.is_ascii_digit()).collect();
    let niveau = chiffres.parse::<u8>().ok()?;
    (1..=9).contains(&niveau).then_some(niveau)
}

/// `LeftAlign` → [`Alignement::Gauche`], etc.
#[must_use]
fn alignement(valeur: &str) -> Alignement {
    match valeur
        .trim_end_matches("Align")
        .to_ascii_lowercase()
        .as_str()
    {
        "left" | "leftjustified" => Alignement::Gauche,
        "center" => Alignement::Centre,
        "right" => Alignement::Droite,
        "fullyjustified" | "justified" | "both" => Alignement::Justifie,
        _ => Alignement::ParDefaut,
    }
}

/// Le format de page, lu dans les planches.
fn lire_page(archive: &Archive, planches: &[String]) -> Option<Page> {
    let planche = planches.first()?;
    let racine = analyser_entree(archive, planche, "").ok()?;
    let pages = racine.chercher("Page");
    let page = pages.first()?;
    let bornes = page.attribut("GeometricBounds")?;
    // IDML écrit `GeometricBounds="haut gauche bas droite"`, en points.
    let valeurs: Vec<f64> = bornes
        .split_whitespace()
        .filter_map(|v| v.parse::<f64>().ok())
        .collect();
    if valeurs.len() != 4 {
        return None;
    }
    let hauteur = (valeurs[2] - valeurs[0]).abs() * MM_PAR_POINT;
    let largeur = (valeurs[3] - valeurs[1]).abs() * MM_PAR_POINT;
    if largeur <= 0.0 || hauteur <= 0.0 {
        return None;
    }
    // Les marges sont dans `MarginPreference`, en points, aussi.
    let marges = page.enfant("MarginPreference");
    let en_mm = |nom: &str| {
        marges
            .and_then(|m| m.attribut(nom))
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|v| *v >= 0.0)
            .map(|v| v * MM_PAR_POINT)
    };
    Some(Page {
        largeur_mm: largeur,
        hauteur_mm: hauteur,
        marge_gauche_mm: en_mm("Left"),
        marge_droite_mm: en_mm("Right"),
        marge_haut_mm: en_mm("Top"),
        marge_bas_mm: en_mm("Bottom"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml;

    fn lire_source(xml_source: &str) -> (Vec<Paragraphe>, Vec<String>, Vec<String>) {
        let racine = xml::analyser(xml_source).unwrap();
        // Selon le témoin, la racine est déjà `<Story>` ou l'enveloppe
        // `<idPkg:Story>` : on accepte les deux.
        let histoire = racine.enfant("Story").unwrap_or(&racine);
        let mut paragraphes = Vec::new();
        let mut notes = Vec::new();
        let mut images = Vec::new();
        let mut avertissements = Vec::new();
        parcourir(
            histoire,
            None,
            &mut paragraphes,
            &mut notes,
            &mut images,
            &mut avertissements,
        );
        (paragraphes, notes, images)
    }

    #[test]
    fn paragraphe_avec_style_et_alignement() {
        let (paragraphes, _, _) = lire_source(
            r#"<Story>
                 <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Titre" Justification="CenterAlign">
                   <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/Normal"><Content>Chapitre 1</Content></CharacterStyleRange>
                 </ParagraphStyleRange>
               </Story>"#,
        );
        assert_eq!(paragraphes.len(), 1);
        assert_eq!(paragraphes[0].texte, "Chapitre 1");
        assert_eq!(paragraphes[0].style.as_deref(), Some("Titre"));
        assert_eq!(paragraphes[0].alignement, Alignement::Centre);
    }

    #[test]
    fn plusieurs_morceaux_forment_un_paragraphe() {
        let (paragraphes, _, _) = lire_source(
            r#"<Story><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Normal">
                 <CharacterStyleRange><Content>Lien : </Content></CharacterStyleRange>
                 <CharacterStyleRange><Content>Visitez superprint.cc</Content></CharacterStyleRange>
               </ParagraphStyleRange></Story>"#,
        );
        assert_eq!(paragraphes.len(), 1);
        assert_eq!(paragraphes[0].texte, "Lien : Visitez superprint.cc");
    }

    #[test]
    fn saut_de_ligne_force() {
        let (paragraphes, _, _) = lire_source(
            r#"<Story><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Normal">
                 <CharacterStyleRange><Content>ligne un</Content><Br/><Content>ligne deux</Content></CharacterStyleRange>
               </ParagraphStyleRange></Story>"#,
        );
        assert_eq!(paragraphes[0].texte, "ligne un\nligne deux");
    }

    #[test]
    fn la_note_de_bas_de_page_sort_du_flux() {
        let (paragraphes, notes, _) = lire_source(
            r#"<Story><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Titre">
                 <CharacterStyleRange><Content>Chapitre 1</Content>
                   <Footnote Self="fn1" Label="1">
                     <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
                       <CharacterStyleRange><Content>Note de bas de page reelle.</Content></CharacterStyleRange>
                     </ParagraphStyleRange>
                   </Footnote>
                 </CharacterStyleRange>
               </ParagraphStyleRange></Story>"#,
        );
        // Le paragraphe ne contient PAS le texte de la note.
        assert_eq!(paragraphes.len(), 1);
        assert_eq!(paragraphes[0].texte, "Chapitre 1");
        assert_eq!(notes, vec!["Note de bas de page reelle.".to_string()]);
    }

    #[test]
    fn tableau_avec_positions() {
        let (paragraphes, _, _) = lire_source(
            r#"<Story><Table Self="tb1">
                 <Cell Self="tb1c00" Name="0:0"><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Normal"><CharacterStyleRange><Content>Nom</Content></CharacterStyleRange></ParagraphStyleRange></Cell>
                 <Cell Self="tb1c10" Name="1:0"><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Normal"><CharacterStyleRange><Content>Ville</Content></CharacterStyleRange></ParagraphStyleRange></Cell>
                 <Cell Self="tb1c01" Name="0:1"><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Normal"><CharacterStyleRange><Content>Alice</Content></CharacterStyleRange></ParagraphStyleRange></Cell>
                 <Cell Self="tb1c11" Name="1:1"><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Normal"><CharacterStyleRange><Content>Paris</Content></CharacterStyleRange></ParagraphStyleRange></Cell>
               </Table></Story>"#,
        );
        assert_eq!(paragraphes.len(), 4);
        assert_eq!(paragraphes[0].table, Some((0, 0)));
        assert_eq!(paragraphes[1].table, Some((1, 0)));
        assert_eq!(paragraphes[2].table, Some((0, 1)));
        assert_eq!(paragraphes[3].table, Some((1, 1)));
        assert_eq!(paragraphes[2].texte, "Alice");
    }

    #[test]
    fn case_sans_position_garde_celle_du_tableau() {
        let (paragraphes, _, _) = lire_source(
            r#"<Story><Table><Cell><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Normal"><CharacterStyleRange><Content>sans nom</Content></CharacterStyleRange></ParagraphStyleRange></Cell></Table></Story>"#,
        );
        assert_eq!(paragraphes[0].table, None);
    }

    #[test]
    fn noms_de_styles() {
        assert_eq!(nom_de_style("ParagraphStyle/Titre"), "Titre");
        assert_eq!(
            nom_de_style("ParagraphStyle/$ID/NormalParagraphStyle"),
            "NormalParagraphStyle"
        );
        assert_eq!(
            nom_de_style("CharacterStyle/$ID/[No character style]"),
            "[No character style]"
        );
        assert_eq!(nom_de_style("Normal"), "Normal");
    }

    #[test]
    fn niveaux_de_style() {
        assert_eq!(niveau_du_style("ParagraphStyle/Titre1"), Some(1));
        assert_eq!(niveau_du_style("ParagraphStyle/Heading2"), Some(2));
        assert_eq!(niveau_du_style("ParagraphStyle/Normal"), None);
        assert_eq!(niveau_du_style("ParagraphStyle/Titre"), None);
    }

    #[test]
    fn alignements() {
        assert_eq!(alignement("LeftAlign"), Alignement::Gauche);
        assert_eq!(alignement("CenterAlign"), Alignement::Centre);
        assert_eq!(alignement("RightAlign"), Alignement::Droite);
        assert_eq!(alignement("FullyJustified"), Alignement::Justifie);
        assert_eq!(alignement("LeftJustified"), Alignement::Gauche);
        assert_eq!(alignement("Autre"), Alignement::ParDefaut);
    }

    #[test]
    fn image_par_lien() {
        let (_, _, images) = lire_source(
            r#"<Story><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Normal">
                 <CharacterStyleRange><Link LinkResourceURI="file:///C:/projet/Links/logo.png"/></CharacterStyleRange>
               </ParagraphStyleRange></Story>"#,
        );
        assert_eq!(images, vec!["Links/logo.png".to_string()]);
    }

    #[test]
    fn format_de_page_depuis_les_bornes() {
        // A5 portrait écrit en points : 419,53 × 595,28.
        let source = r#"<idPkg:Spread><Spread><Page Self="u1" GeometricBounds="0 0 595.2755905511812 419.5275590551181">
             <MarginPreference ColumnCount="1" Top="42.51968503937008" Bottom="42.51968503937008" Left="42.51968503937008" Right="42.51968503937008"/>
           </Page></Spread></idPkg:Spread>"#;
        let racine = xml::analyser(source).unwrap();
        let pages = racine.chercher("Page");
        let page = pages.first().unwrap();
        let bornes = page.attribut("GeometricBounds").unwrap();
        let valeurs: Vec<f64> = bornes
            .split_whitespace()
            .filter_map(|v| v.parse().ok())
            .collect();
        let largeur = (valeurs[3] - valeurs[1]) * MM_PAR_POINT;
        let hauteur = (valeurs[2] - valeurs[0]) * MM_PAR_POINT;
        assert!((largeur - 148.0).abs() < 0.01, "{largeur}");
        assert!((hauteur - 210.0).abs() < 0.01, "{hauteur}");
        assert!(!Page {
            largeur_mm: largeur,
            hauteur_mm: hauteur,
            marge_gauche_mm: None,
            marge_droite_mm: None,
            marge_haut_mm: None,
            marge_bas_mm: None
        }
        .est_paysage());
    }

    #[test]
    fn reference_d_image_normalisee() {
        let mut images = Vec::new();
        pousser_image("file:///C:/un/dossier/Links/image1.png", &mut images);
        pousser_image("Links/image1.png", &mut images);
        pousser_image("Links/image2.png", &mut images);
        assert_eq!(
            images,
            vec![
                "Links/image1.png".to_string(),
                "Links/image2.png".to_string()
            ]
        );
    }
}
