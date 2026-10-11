//! Lecture d'un `.odt` : OpenDocument Texte.
//!
//! ## Ce qui est lu
//!
//! | Élément ODF | Ce qu'on en fait |
//! |---|---|
//! | `mimetype` (entrée d'archive, **non compressée**) | vérifie qu'on a bien affaire à un texte ODF |
//! | `text:h` | un titre, avec son `text:outline-level` |
//! | `text:p` | un paragraphe |
//! | `text:span` | descendu : c'est de la mise en forme en ligne |
//! | `text:s` | `c` espaces (1 par défaut) — c'est **le piège du format** |
//! | `text:tab`, `text:line-break` | tabulation, saut de ligne forcé |
//! | `text:list` / `text:list-item` | une liste |
//! | `table:table` / `table:table-row` / `table:table-cell` | un tableau, avec la position |
//! | `draw:frame` / `draw:image/@xlink:href` | une image |
//! | `style:page-layout-properties` | le format de page (`fo:page-width`) |
//!
//! ## Le piège du format, et pourquoi il est écrit ici
//!
//! ODF **n'écrit pas** les espaces répétés : deux espaces consécutifs dans le
//! document deviennent `<text:s text:c="2"/>`. Un lecteur qui ignore `text:s`
//! rend un document dont tous les alignements verticaux par espaces ont disparu —
//! sans erreur, sans avertissement, juste un texte différent. C'est le genre de
//! faute qui se voit sur un rapport de tarifs et nulle part ailleurs.
//!
//! ## Ce qui n'est pas lu, et qui est dit
//!
//! Les styles nommés (`text:style-name`) sont **conservés par leur nom** mais la
//! mise en forme en ligne (gras, italique, couleur) n'est pas représentable dans
//! [`crate::Paragraphe`] : elle est comptée et signalée.

use superprint_zip::Archive;

use crate::xml::Element;
use crate::{analyser_entree, ErreurImport, Format, Memoire, Page, Paragraphe};

/// Le type MIME attendu dans l'entrée `mimetype` d'un texte ODF.
pub const MIMETYPE_TEXTE: &str = "application/vnd.oasis.opendocument.text";

/// Lit un document OpenDocument.
///
/// # Erreurs
///
/// [`ErreurImport::FormatContredit`] quand l'entrée `mimetype` ne dit pas
/// « texte ODF » — un classeur `.ods` renommé, par exemple.
pub fn lire(archive: &Archive) -> Result<Memoire, ErreurImport> {
    let mut avertissements: Vec<String> = Vec::new();

    // Le type MIME est la seule autorité sur la nature du fichier. Il est écrit
    // **sans compression** dans l'archive, exprès, pour être lisible avant le
    // reste.
    if let Ok(mimetype) = archive.extraire_texte("mimetype") {
        let mimetype = mimetype.trim();
        if !mimetype.is_empty() && mimetype != MIMETYPE_TEXTE {
            return Err(ErreurImport::FormatContredit {
                annonce: mimetype.to_string(),
                trouve: MIMETYPE_TEXTE.to_string(),
            });
        }
    }

    let racine = analyser_entree(archive, "content.xml", "")?;
    let corps = racine
        .enfant("body")
        .and_then(|b| b.enfant("text"))
        .or_else(|| racine.enfant("text"))
        .ok_or_else(|| ErreurImport::SansContenu {
            entree: "content.xml".to_string(),
        })?;

    let mut paragraphes: Vec<Paragraphe> = Vec::new();
    let mut images: Vec<String> = Vec::new();

    // Le corps se parcourt à un seul niveau, et les conteneurs (listes,
    // tableaux, sections) sont descendus par leurs propres fonctions. C'est ce
    // qui garde l'ordre du document sans récursion générale.
    for enfant in corps.elements() {
        parcourir(
            enfant,
            None,
            &mut paragraphes,
            &mut images,
            &mut avertissements,
        );
    }

    let page = lire_page(&racine);
    let titre = racine
        .chercher("title")
        .first()
        .map(|t| t.texte())
        .filter(|t| !t.trim().is_empty());

    let en_ligne = compter_mise_en_forme_en_ligne(&racine);
    if en_ligne > 0 {
        avertissements.push(format!(
            "{en_ligne} élément(s) de mise en forme en ligne (span avec style, gras, couleur) : \
             le modèle de paragraphe ne porte pas la mise en forme par morceau"
        ));
    }

    Ok(Memoire {
        format: Format::Odt,
        paragraphes,
        page,
        titre,
        images,
        notes: Vec::new(),
        avertissements,
    })
}

/// Parcourt un élément du corps d'un texte OpenDocument.
///
/// `table` porte la position dans un tableau, quand on y est.
fn parcourir(
    element: &Element,
    table: Option<(usize, usize)>,
    paragraphes: &mut Vec<Paragraphe>,
    images: &mut Vec<String>,
    avertissements: &mut Vec<String>,
) {
    match element.local() {
        "h" => {
            let niveau = element
                .attribut("outline-level")
                .and_then(|v| v.parse::<u8>().ok())
                .filter(|n| (1..=10).contains(n));
            let mut paragraphe = lire_paragraphe(element, images, avertissements);
            paragraphe.niveau = niveau;
            if paragraphe.style.is_none() {
                paragraphe.style = Some(match niveau {
                    Some(n) => format!("Titre{n}"),
                    None => "Titre".to_string(),
                });
            }
            paragraphe.table = table;
            paragraphes.push(paragraphe);
        }
        "p" => {
            let mut paragraphe = lire_paragraphe(element, images, avertissements);
            paragraphe.table = table;
            paragraphes.push(paragraphe);
        }
        "list" => {
            for item in element.elements().filter(|e| e.est("list-item")) {
                for enfant in item.elements() {
                    let position = if enfant.est("p") || enfant.est("h") {
                        table
                    } else {
                        None
                    };
                    let avant = paragraphes.len();
                    parcourir(enfant, position, paragraphes, images, avertissements);
                    // ODF ne dit pas « ceci est une puce » : c'est la liste qui
                    // le dit. On marque les paragraphes ajoutés par cette liste.
                    for paragraphe in &mut paragraphes[avant..] {
                        paragraphe.liste = true;
                    }
                    // Un `list-item` peut contenir directement du texte sans
                    // `<text:p>` : rare, mais le format l'autorise.
                    if paragraphes.len() == avant {
                        let direct = texte_de(element);
                        if !direct.trim().is_empty() {
                            let mut paragraphe = Paragraphe::texte(direct);
                            paragraphe.liste = true;
                            paragraphe.table = table;
                            paragraphes.push(paragraphe);
                        }
                    }
                }
            }
        }
        "table" => {
            for (rang_ligne, ligne) in element
                .elements()
                .filter(|e| e.est("table-row"))
                .enumerate()
            {
                for (rang_cellule, cellule) in ligne
                    .elements()
                    .filter(|e| e.est("table-cell") || e.est("covered-table-cell"))
                    .enumerate()
                {
                    for enfant in cellule.elements() {
                        if enfant.est("p") || enfant.est("h") || enfant.est("list") {
                            parcourir(
                                enfant,
                                Some((rang_ligne, rang_cellule)),
                                paragraphes,
                                images,
                                avertissements,
                            );
                        }
                    }
                    // Une cellule vide compte : elle occupe une case.
                    let vide = !cellule.elements().any(|e| e.est("p") || e.est("h"));
                    if vide {
                        let mut paragraphe = Paragraphe::texte(String::new());
                        paragraphe.table = Some((rang_ligne, rang_cellule));
                        paragraphes.push(paragraphe);
                    }
                }
            }
        }
        // Les conteneurs sans effet sur le texte.
        "section" | "text-section" | "soft-page-break" => {
            for enfant in element.elements() {
                parcourir(enfant, table, paragraphes, images, avertissements);
            }
        }
        // Une image hors paragraphe (dans un cadre flottant).
        "frame" | "image" | "g" | "rect" | "ellipse" => {
            let trouvees = collecter_images(element);
            if !trouvees.is_empty() {
                let mut paragraphe = Paragraphe::texte(String::new());
                paragraphe.image = Some(trouvees[0].clone());
                paragraphe.table = table;
                for chemin in trouvees {
                    if !images.contains(&chemin) {
                        images.push(chemin);
                    }
                }
                paragraphes.push(paragraphe);
            }
        }
        _ => {}
    }
}

/// Le texte d'un paragraphe ODF, avec ses espaces explicites et ses images.
fn lire_paragraphe(
    element: &Element,
    images: &mut Vec<String>,
    avertissements: &mut Vec<String>,
) -> Paragraphe {
    let mut paragraphe = Paragraphe::texte(String::new());
    if let Some(style) = element.attribut("style-name") {
        paragraphe.style = Some(style.to_string());
    }
    let trouvees = texte_de_element(element, &mut paragraphe.texte);
    if !trouvees.is_empty() {
        paragraphe.image = Some(trouvees[0].clone());
        for chemin in &trouvees {
            if !images.contains(chemin) {
                images.push(chemin.clone());
            }
        }
        if trouvees.len() > 1 {
            avertissements.push(format!(
                "un paragraphe porte {} images : seule la première est portée par le paragraphe",
                trouvees.len()
            ));
        }
    }
    paragraphe
}

/// Texte d'un élément, sans collecter les images.
fn texte_de(element: &Element) -> String {
    let mut sortie = String::new();
    texte_de_element(element, &mut sortie);
    sortie
}

/// Accumule le texte d'un élément ODF et rend les images rencontrées.
///
/// C'est ici que se traitent les éléments **qui ne sont pas du texte** mais qui
/// en produisent : `text:s` (les espaces), `text:tab`, `text:line-break`.
fn texte_de_element(element: &Element, sortie: &mut String) -> Vec<String> {
    let mut images = Vec::new();
    for noeud in element.contenu() {
        match noeud {
            crate::xml::Noeud::Texte(texte) => sortie.push_str(texte),
            crate::xml::Noeud::Element(enfant) => match enfant.local() {
                // LE piège du format : les espaces répétés sont comptés.
                "s" => {
                    let nombre = enfant
                        .attribut("c")
                        .and_then(|c| c.parse::<usize>().ok())
                        .unwrap_or(1);
                    // Une valeur absurde ferait exploser la mémoire ; ODF ne
                    // compte pas plus que la largeur d'une ligne raisonnable.
                    for _ in 0..nombre.min(4096) {
                        sortie.push(' ');
                    }
                }
                "tab" => sortie.push('\t'),
                "line-break" => sortie.push('\n'),
                "image" => {
                    if let Some(reference) = enfant.attribut("href") {
                        images.push(reference.to_string());
                    }
                }
                // `text:span`, `text:a`, `text:bookmark-ref`, `text:note`…
                // descendent : leur texte fait partie du paragraphe.
                _ => images.extend(texte_de_element(enfant, sortie)),
            },
        }
    }
    images
}

/// Toutes les images d'un sous-arbre.
fn collecter_images(element: &Element) -> Vec<String> {
    let mut images = Vec::new();
    let mut poubelle = String::new();
    images.extend(texte_de_element(element, &mut poubelle));
    images
}

/// Le format de page, lu dans les styles automatiques.
///
/// ODF l'écrit en `fo:page-width` / `fo:page-height`, avec une unité collée au
/// nombre (`21cm`, `210mm`, `8.5in`, `595pt`).
fn lire_page(racine: &Element) -> Option<Page> {
    let proprietes = racine
        .chercher("page-layout-properties")
        .into_iter()
        .find(|p| p.attribut("page-width").is_some() && p.attribut("page-height").is_some())?;
    let largeur = lire_mesure(proprietes.attribut("page-width")?)?;
    let hauteur = lire_mesure(proprietes.attribut("page-height")?)?;
    if largeur <= 0.0 || hauteur <= 0.0 {
        return None;
    }
    let marge = |nom: &str| {
        proprietes
            .attribut(nom)
            .and_then(lire_mesure)
            .filter(|v| *v >= 0.0)
    };
    Some(Page {
        largeur_mm: largeur,
        hauteur_mm: hauteur,
        marge_gauche_mm: marge("margin-left"),
        marge_droite_mm: marge("margin-right"),
        marge_haut_mm: marge("margin-top"),
        marge_bas_mm: marge("margin-bottom"),
    })
}

/// Convertit une mesure ODF en millimètres.
///
/// Rend `None` si l'unité est absente ou inconnue : sans unité, un nombre de
/// page ne veut rien dire, et le supposer en points serait une invention.
#[must_use]
pub fn lire_mesure(valeur: &str) -> Option<f64> {
    let valeur = valeur.trim();
    // Le plus long d'abord : `mm` avant `m`, `cm` avant `m`.
    for (unite, facteur) in [
        ("mm", 1.0),
        ("cm", 10.0),
        ("in", 25.4),
        ("pt", 25.4 / 72.0),
        ("pc", 25.4 / 6.0),
        ("px", 25.4 / 96.0),
    ] {
        if let Some(nombre) = valeur.strip_suffix(unite) {
            let nombre = nombre.trim().parse::<f64>().ok()?;
            return Some(nombre * facteur);
        }
    }
    None
}

/// Compte les éléments de mise en forme en ligne qui portent quelque chose.
fn compter_mise_en_forme_en_ligne(racine: &Element) -> usize {
    racine
        .chercher("span")
        .iter()
        .filter(|span| span.attribut("style-name").is_some())
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml;
    use crate::Alignement;

    fn lire_texte(xml_source: &str) -> Vec<Paragraphe> {
        let racine = xml::analyser(xml_source).unwrap();
        // Les témoins vont de `<office:text>` seul à `<office:document-content>`
        // complet : on accepte les trois cas.
        let corps = racine
            .enfant("body")
            .and_then(|b| b.enfant("text"))
            .or_else(|| racine.enfant("text"))
            .unwrap_or(&racine);
        let mut paragraphes = Vec::new();
        let mut images = Vec::new();
        let mut avertissements = Vec::new();
        for enfant in corps.elements() {
            parcourir(
                enfant,
                None,
                &mut paragraphes,
                &mut images,
                &mut avertissements,
            );
        }
        paragraphes
    }

    #[test]
    fn espaces_explicites_le_piege_du_format() {
        // ODF n'écrit pas deux espaces : il écrit `text:c="2"`.
        let paragraphes = lire_texte(
            r#"<office:body><office:text><text:p>avant<text:s text:c="3"/>après</text:p></office:text></office:body>"#,
        );
        assert_eq!(paragraphes[0].texte, "avant   après");
        // Et sans `text:c`, c'est UN espace.
        let paragraphes = lire_texte(
            r#"<office:body><office:text><text:p>a<text:s/>b</text:p></office:text></office:body>"#,
        );
        assert_eq!(paragraphes[0].texte, "a b");
    }

    #[test]
    fn tabulation_et_saut_de_ligne() {
        let paragraphes = lire_texte(
            r#"<office:body><office:text><text:p>a<text:tab/>b<text:line-break/>c</text:p></office:text></office:body>"#,
        );
        assert_eq!(paragraphes[0].texte, "a\tb\nc");
    }

    #[test]
    fn titre_avec_niveau() {
        let paragraphes = lire_texte(
            r#"<office:body><office:text><text:h text:outline-level="2">Titre</text:h></office:text></office:body>"#,
        );
        assert_eq!(paragraphes[0].niveau, Some(2));
        assert_eq!(paragraphes[0].style.as_deref(), Some("Titre2"));
        assert_eq!(paragraphes[0].texte, "Titre");
    }

    #[test]
    fn span_descendu_dans_le_paragraphe() {
        let paragraphes = lire_texte(
            r#"<office:body><office:text><text:p>le <text:span>pavé</text:span> est un symbole</text:p></office:text></office:body>"#,
        );
        assert_eq!(paragraphes[0].texte, "le pavé est un symbole");
    }

    #[test]
    fn listes_marquees() {
        let paragraphes = lire_texte(
            r#"<office:body><office:text><text:list>
                <text:list-item><text:p>un</text:p></text:list-item>
                <text:list-item><text:p>deux</text:p></text:list-item>
               </text:list></office:text></office:body>"#,
        );
        assert_eq!(paragraphes.len(), 2);
        assert!(paragraphes.iter().all(|p| p.liste));
        assert_eq!(paragraphes[0].texte, "un");
    }

    #[test]
    fn tableau_avec_positions() {
        let paragraphes = lire_texte(
            r#"<office:body><office:text><table:table>
                <table:table-row><table:table-cell><text:p>A</text:p></table:table-cell><table:table-cell><text:p>B</text:p></table:table-cell></table:table-row>
                <table:table-row><table:table-cell><text:p>C</text:p></table:table-cell><table:table-cell><text:p>D</text:p></table:table-cell></table:table-row>
               </table:table></office:text></office:body>"#,
        );
        assert_eq!(paragraphes.len(), 4);
        assert_eq!(paragraphes[0].table, Some((0, 0)));
        assert_eq!(paragraphes[1].table, Some((0, 1)));
        assert_eq!(paragraphes[3].table, Some((1, 1)));
        assert_eq!(paragraphes[2].texte, "C");
    }

    #[test]
    fn cellule_vide_compte() {
        let paragraphes = lire_texte(
            r#"<office:body><office:text><table:table>
                <table:table-row><table:table-cell><text:p>A</text:p></table:table-cell><table:table-cell/></table:table-row>
               </table:table></office:text></office:body>"#,
        );
        assert_eq!(paragraphes.len(), 2);
        assert_eq!(paragraphes[1].table, Some((0, 1)));
        assert!(paragraphes[1].texte.is_empty());
    }

    #[test]
    fn image_dans_un_cadre() {
        let paragraphes = lire_texte(
            r#"<office:body><office:text><text:p><draw:frame><draw:image xlink:href="Pictures/mosaique.png"/></draw:frame></text:p></office:text></office:body>"#,
        );
        assert_eq!(
            paragraphes[0].image.as_deref(),
            Some("Pictures/mosaique.png")
        );
    }

    #[test]
    fn mesures_avec_unites() {
        assert_eq!(lire_mesure("21cm"), Some(210.0));
        assert_eq!(lire_mesure("210mm"), Some(210.0));
        assert!((lire_mesure("8.5in").unwrap() - 215.9).abs() < 0.001);
        assert!((lire_mesure("595pt").unwrap() - 209.90).abs() < 0.01);
        assert!((lire_mesure("1pc").unwrap() - 4.2333).abs() < 0.001);
        assert!((lire_mesure("96px").unwrap() - 25.4).abs() < 0.001);
        // Sans unité, on ne devine pas.
        assert_eq!(lire_mesure("210"), None);
        assert_eq!(lire_mesure(""), None);
        assert_eq!(lire_mesure("cm"), None);
    }

    #[test]
    fn format_de_page_a4() {
        let racine = xml::analyser(
            r#"<office:document-content><office:automatic-styles>
                 <style:page-layout><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-top="2cm" fo:margin-left="1.5cm"/>
               </style:page-layout></office:automatic-styles></office:document-content>"#,
        )
        .unwrap();
        let page = lire_page(&racine).unwrap();
        assert_eq!(page.largeur_mm, 210.0);
        assert!((page.hauteur_mm - 297.0).abs() < 0.001);
        assert_eq!(page.marge_haut_mm, Some(20.0));
        assert_eq!(page.marge_gauche_mm, Some(15.0));
        assert_eq!(page.marge_droite_mm, None);
        assert!((page.largeur_utile_mm() - 195.0).abs() < 0.001);
    }

    #[test]
    fn style_de_paragraphe_conserve() {
        let paragraphes = lire_texte(
            r#"<office:body><office:text><text:p text:style-name="Standard">x</text:p></office:text></office:body>"#,
        );
        assert_eq!(paragraphes[0].style.as_deref(), Some("Standard"));
        assert_eq!(paragraphes[0].alignement, Alignement::ParDefaut);
    }

    #[test]
    fn alignement_non_lu_par_odf_reste_par_defaut() {
        // ODF met l'alignement dans le style, pas sur le paragraphe : on ne
        // prétend pas le lire ici, et le style est conservé par son nom.
        let paragraphes = lire_texte(
            r#"<office:body><office:text><text:p text:style-name="Centre">x</text:p></office:text></office:body>"#,
        );
        assert_eq!(paragraphes[0].alignement, Alignement::ParDefaut);
        assert_eq!(paragraphes[0].style.as_deref(), Some("Centre"));
    }

    #[test]
    fn une_valeur_d_espaces_absurde_ne_fait_pas_exploser() {
        let paragraphes = lire_texte(
            r#"<office:body><office:text><text:p>a<text:s text:c="99999999"/>b</text:p></office:text></office:body>"#,
        );
        assert_eq!(paragraphes[0].texte.chars().count(), 4098);
    }
}
