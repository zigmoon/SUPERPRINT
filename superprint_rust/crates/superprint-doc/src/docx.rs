//! Lecture d'un `.docx` : WordprocessingML.
//!
//! ## Ce qui est lu
//!
//! | Élément OOXML | Ce qu'on en fait |
//! |---|---|
//! | `w:p` | un paragraphe |
//! | `w:pPr/w:pStyle/@w:val` | son style, **par son nom** (`Heading1`…) |
//! | `w:pPr/w:jc/@w:val` | son alignement |
//! | `w:t` | le texte (y compris dans `w:hyperlink`, `w:ins`, `w:smartTag`) |
//! | `w:tab` | une tabulation |
//! | `w:br`, `w:cr` | un saut de ligne **forcé** (`\n`) |
//! | `w:noBreakHyphen`, `w:softHyphen` | un trait d'union |
//! | `w:sym` | un caractère de police de symboles, quand son code est lisible |
//! | `w:drawing` | une image, résolue par `document.xml.rels` |
//! | `w:tbl` / `w:tr` / `w:tc` | un tableau : la position `(ligne, colonne)` est portée par le paragraphe |
//! | `w:sectPr/w:pgSz` | le format de page, en vingtièmes de point |
//!
//! ## Ce qui n'est pas lu, et qui est **dit**
//!
//! Gras, italique, soulignement, couleur, police par morceau : ce sont des
//! attributs de `w:rPr`, et le modèle de [`crate::Paragraphe`] n'a pas de
//! notion de morceau. Le nombre de passages concernés est compté et mis dans les
//! avertissements. C'est la limite honnête de ce modèle, et elle est visible au
//! lieu d'être silencieuse.
//!
//! Les images multiples dans un même paragraphe sont comptées : le champ
//! [`crate::Paragraphe::image`] n'en porte qu'une, mais le paragraphe ne fait
//! pas disparaître les autres — elles sont dans [`crate::Memoire::images`].

use superprint_zip::Archive;

use crate::xml::Element;
use crate::{analyser_entree, Alignement, ErreurImport, Format, Memoire, Page, Paragraphe};

/// Un vingtième de point, en millimètres.
///
/// Un twip vaut 1/1440 de pouce, donc `25,4 / 1440`.
const MM_PAR_TWIP: f64 = 25.4 / 1440.0;

/// Lit un document Word.
///
/// # Erreurs
///
/// Voir [`ErreurImport`].
pub fn lire(archive: &Archive) -> Result<Memoire, ErreurImport> {
    let racine = analyser_entree(archive, "word/document.xml", "word")?;
    let corps = racine
        .enfant("body")
        .ok_or_else(|| ErreurImport::SansContenu {
            entree: "word/document.xml".to_string(),
        })?;

    // Les relations donnent, pour chaque `rId`, le chemin réel de l'image.
    let relations = lire_relations(archive);
    let mut avertissements: Vec<String> = Vec::new();
    let mut paragraphes: Vec<Paragraphe> = Vec::new();
    let mut images: Vec<String> = Vec::new();
    let mut mises_en_forme = 0usize;

    // Le corps se parcourt à plat : un tableau contient des paragraphes, et
    // l'ordre du document doit être respecté. On garde donc la position dans le
    // tableau, en la propageant vers le bas.
    for enfant in corps.elements() {
        match () {
            _ if enfant.est("p") => {
                let mut paragraphe =
                    lire_paragraphe(enfant, &relations, &mut images, &mut avertissements);
                mises_en_forme += compter_mises_en_forme(enfant);
                paragraphe.table = None;
                paragraphes.push(paragraphe);
            }
            _ if enfant.est("tbl") => {
                let lignes: Vec<&Element> = enfant.elements().filter(|e| e.est("tr")).collect();
                for (rang_ligne, ligne) in lignes.iter().enumerate() {
                    let cellules: Vec<&Element> =
                        ligne.elements().filter(|e| e.est("tc")).collect();
                    for (rang_cellule, cellule) in cellules.iter().enumerate() {
                        for p in cellule.elements().filter(|e| e.est("p")) {
                            let mut paragraphe =
                                lire_paragraphe(p, &relations, &mut images, &mut avertissements);
                            mises_en_forme += compter_mises_en_forme(p);
                            paragraphe.table = Some((rang_ligne, rang_cellule));
                            paragraphes.push(paragraphe);
                        }
                    }
                }
            }
            _ if enfant.est("sdt") => {
                // Un contrôle de contenu (`sdt`) enveloppe des paragraphes.
                for p in enfant.chercher("p") {
                    let mut paragraphe =
                        lire_paragraphe(p, &relations, &mut images, &mut avertissements);
                    mises_en_forme += compter_mises_en_forme(p);
                    paragraphe.table = None;
                    paragraphes.push(paragraphe);
                }
            }
            _ => {}
        }
    }

    // Le format de page vient de la dernière section (la seule, le plus
    // souvent). `sectPr` peut être dans le corps ou dans le dernier `w:pPr`.
    let mut page = racine.chercher("sectPr").first().and_then(|s| lire_page(s));
    if page.is_none() {
        page = corps.enfant("sectPr").and_then(lire_page);
    }

    if mises_en_forme > 0 {
        avertissements.push(format!(
            "{mises_en_forme} passage(s) mis en forme (gras, italique, couleur, police) : \
             le modèle de paragraphe ne porte pas la mise en forme par morceau"
        ));
    }
    if !racine.chercher("sectPr").is_empty() && page.is_none() {
        avertissements
            .push("un format de page est déclaré, mais sa taille n'a pas pu être lue".to_string());
    }

    Ok(Memoire {
        format: Format::Docx,
        paragraphes,
        page,
        titre: None,
        images,
        notes: Vec::new(),
        classeur: None,
        avertissements,
    })
}

/// Le texte d'un paragraphe, dans l'ordre du document.
fn lire_paragraphe(
    element: &Element,
    relations: &[(String, String)],
    images: &mut Vec<String>,
    avertissements: &mut Vec<String>,
) -> Paragraphe {
    let mut paragraphe = Paragraphe::texte(String::new());

    if let Some(proprietes) = element.enfant("pPr") {
        if let Some(style) = proprietes.enfant("pStyle") {
            let nom = style.attribut("val").unwrap_or_default().to_string();
            if !nom.is_empty() {
                paragraphe.niveau = niveau_du_style(&nom);
                paragraphe.style = Some(nom);
            }
        }
        if let Some(justification) = proprietes.enfant("jc") {
            paragraphe.alignement =
                Alignement::depuis_nom(justification.attribut("val").unwrap_or(""));
        }
        if let Some(numerotation) = proprietes.enfant("numPr") {
            paragraphe.liste =
                numerotation.enfant("numId").is_some() || numerotation.enfant("ilvl").is_some();
        }
    }

    let mut images_du_paragraphe: Vec<String> = Vec::new();
    collecter_run(
        element,
        &mut paragraphe.texte,
        relations,
        &mut images_du_paragraphe,
    );

    if !images_du_paragraphe.is_empty() {
        paragraphe.image = Some(images_du_paragraphe[0].clone());
        for chemin in &images_du_paragraphe {
            if !images.contains(chemin) {
                images.push(chemin.clone());
            }
        }
        if images_du_paragraphe.len() > 1 {
            avertissements.push(format!(
                "un paragraphe porte {} images : seule la première est portée par le paragraphe, \
                 les {} autres restent dans la liste des images",
                images_du_paragraphe.len(),
                images_du_paragraphe.len() - 1
            ));
        }
    }

    paragraphe
}

/// Descend dans un élément et accumule texte, tabulations, sauts et images.
fn collecter_run(
    element: &Element,
    sortie: &mut String,
    relations: &[(String, String)],
    images: &mut Vec<String>,
) {
    for enfant in element.elements() {
        match enfant.local() {
            // `w:t` : le texte lui-même. On ne descend pas dedans, il n'y a rien.
            "t" => sortie.push_str(&enfant.texte()),
            // `w:tab` : une tabulation.
            "tab" => sortie.push('\t'),
            // `w:br` et `w:cr` : un saut de ligne forcé. `w:br w:type="page"`
            // est un saut de page : on ne peut pas le représenter dans un
            // paragraphe, et on le rend comme un saut de ligne.
            "br" | "cr" => sortie.push('\n'),
            // Traits d'union spéciaux.
            "noBreakHyphen" => sortie.push('\u{2011}'),
            "softHyphen" => sortie.push('\u{00AD}'),
            // Un caractère de police de symboles : `w:sym w:char="F0B7"`.
            "sym" => {
                if let Some(code) = enfant
                    .attribut("char")
                    .and_then(|c| u32::from_str_radix(c, 16).ok())
                {
                    // `F0xx` est la zone privée de Symbol, `F0B7` est la puce.
                    let point = code & 0xFF;
                    if point == 0xB7 {
                        sortie.push('\u{2022}');
                    } else if let Some(c) = char::from_u32(point) {
                        sortie.push(c);
                    }
                }
            }
            // Une image : on résout `r:embed` par les relations.
            "blip" => {
                if let Some(identifiant) = enfant
                    .attribut("embed")
                    .or_else(|| enfant.attribut("r:embed"))
                    .or_else(|| enfant.attribut("link"))
                {
                    if let Some((_, chemin)) = relations.iter().find(|(id, _)| id == identifiant) {
                        images.push(chemin.clone());
                    }
                }
            }
            // Tout le reste se descend : `w:r`, `w:hyperlink`, `w:ins`,
            // `w:smartTag`, `w:fldSimple`, `w:rPr` (qui ne contient pas de
            // texte), `w:drawing`, `w:pict`, `w:txbxContent`…
            _ => collecter_run(enfant, sortie, relations, images),
        }
    }
}

/// Lit `word/_rels/document.xml.rels` : `rId` → chemin réel.
fn lire_relations(archive: &Archive) -> Vec<(String, String)> {
    let Ok(racine) = analyser_entree(archive, "word/_rels/document.xml.rels", "word/_rels") else {
        return Vec::new();
    };
    let mut relations = Vec::new();
    for relation in racine.elements().filter(|e| e.est("Relationship")) {
        let (Some(id), Some(cible)) = (relation.attribut("Id"), relation.attribut("Target")) else {
            continue;
        };
        // Les chemins sont relatifs à `word/` : « media/image1.png » désigne
        // `word/media/image1.png`.
        let cible = cible.trim_start_matches('/');
        let chemin = if cible.starts_with("word/") {
            cible.to_string()
        } else {
            format!("word/{}", cible.trim_start_matches("./"))
        };
        // Un lien externe n'est pas une entrée de l'archive.
        if relation.attribut("TargetMode") == Some("External") {
            continue;
        }
        relations.push((id.to_string(), chemin));
    }
    relations
}

/// `Heading1` → `1`, `Titre2` → `2`, `heading 3` → `3`.
///
/// Rend `None` quand le style n'est pas un titre numéroté. Les noms de styles
/// sont traduits par Word (« Titre 1 » en français), d'où les deux formes.
#[must_use]
pub fn niveau_du_style(nom: &str) -> Option<u8> {
    let minuscules = nom.to_lowercase();
    let reste = minuscules
        .strip_prefix("heading")
        .or_else(|| minuscules.strip_prefix("titre"))
        .or_else(|| minuscules.strip_prefix("h"))?;
    let chiffres: String = reste.chars().filter(|c| c.is_ascii_digit()).collect();
    let niveau = chiffres.parse::<u8>().ok()?;
    // Word va jusqu'à 9 niveaux de titre.
    (1..=9).contains(&niveau).then_some(niveau)
}

/// Lit `w:pgSz` et `w:pgMar`.
fn lire_page(section: &Element) -> Option<Page> {
    let taille = section.enfant("pgSz")?;
    let largeur = taille.attribut("w")?.parse::<f64>().ok()?;
    let hauteur = taille.attribut("h")?.parse::<f64>().ok()?;
    if largeur <= 0.0 || hauteur <= 0.0 {
        return None;
    }
    let mut page = Page {
        largeur_mm: largeur * MM_PAR_TWIP,
        hauteur_mm: hauteur * MM_PAR_TWIP,
        marge_gauche_mm: None,
        marge_droite_mm: None,
        marge_haut_mm: None,
        marge_bas_mm: None,
    };
    if let Some(marges) = section.enfant("pgMar") {
        let en_mm = |nom: &str| {
            marges
                .attribut(nom)
                .and_then(|v| v.parse::<f64>().ok())
                // Une marge négative est un signe de fichier abîmé : on ne la
                // rend pas, elle n'a pas de sens pour une mise en page.
                .filter(|v| *v >= 0.0)
                .map(|v| v * MM_PAR_TWIP)
        };
        page.marge_gauche_mm = en_mm("left");
        page.marge_droite_mm = en_mm("right");
        page.marge_haut_mm = en_mm("top");
        page.marge_bas_mm = en_mm("bottom");
    }
    Some(page)
}

/// Compte les passages qui portent une mise en forme non représentable.
///
/// On ne compte **pas** `w:pStyle` : c'est le style du paragraphe, et il est
/// porté par le modèle.
fn compter_mises_en_forme(element: &Element) -> usize {
    element
        .chercher("rPr")
        .iter()
        .filter(|proprietes| !proprietes.enfants.is_empty())
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml;

    #[test]
    fn niveaux_de_style() {
        assert_eq!(niveau_du_style("Heading1"), Some(1));
        assert_eq!(niveau_du_style("Heading 2"), Some(2));
        assert_eq!(niveau_du_style("heading9"), Some(9));
        assert_eq!(niveau_du_style("Titre3"), Some(3));
        assert_eq!(niveau_du_style("H4"), Some(4));
        // Pas un titre.
        assert_eq!(niveau_du_style("Normal"), None);
        assert_eq!(niveau_du_style("Quote"), None);
        assert_eq!(niveau_du_style("Heading"), None);
        assert_eq!(niveau_du_style("Heading10"), None);
        assert_eq!(niveau_du_style("Heading0"), None);
    }

    #[test]
    fn texte_d_un_paragraphe_avec_tabulation_et_saut() {
        let xml = r#"<w:p><w:r><w:t>avant</w:t><w:tab/><w:t>milieu</w:t><w:br/><w:t>après</w:t></w:r></w:p>"#;
        let racine = xml::analyser(xml).unwrap();
        let paragraphe = lire_paragraphe(&racine, &[], &mut Vec::new(), &mut Vec::new());
        assert_eq!(paragraphe.texte, "avant\tmilieu\naprès");
    }

    #[test]
    fn texte_dans_un_lien_hypertexte() {
        let xml =
            r#"<w:p><w:hyperlink r:id="rId1"><w:r><w:t>un lien</w:t></w:r></w:hyperlink></w:p>"#;
        let racine = xml::analyser(xml).unwrap();
        let paragraphe = lire_paragraphe(&racine, &[], &mut Vec::new(), &mut Vec::new());
        assert_eq!(paragraphe.texte, "un lien");
    }

    #[test]
    fn style_et_alignement_lus() {
        let xml = r#"<w:p><w:pPr><w:pStyle w:val="Heading3"/><w:jc w:val="center"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>"#;
        let racine = xml::analyser(xml).unwrap();
        let paragraphe = lire_paragraphe(&racine, &[], &mut Vec::new(), &mut Vec::new());
        assert_eq!(paragraphe.style.as_deref(), Some("Heading3"));
        assert_eq!(paragraphe.niveau, Some(3));
        assert_eq!(paragraphe.alignement, Alignement::Centre);
    }

    #[test]
    fn liste_detectee() {
        let xml = r#"<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>puce</w:t></w:r></w:p>"#;
        let racine = xml::analyser(xml).unwrap();
        let paragraphe = lire_paragraphe(&racine, &[], &mut Vec::new(), &mut Vec::new());
        assert!(paragraphe.liste);
    }

    #[test]
    fn format_de_page_en_millimetres() {
        // A4 tel que Word l'écrit : 11906 × 16838 twips, marges de 1440 twips
        // (un pouce). Ces valeurs sont celles de Word, pas les valeurs rondes :
        // 11906 twips font 210,0086 mm, pas 210,00 — et c'est bien la valeur de
        // Word qu'il faut rendre, pas un arrondi à nous.
        let xml = r#"<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>"#;
        let racine = xml::analyser(xml).unwrap();
        let page = lire_page(&racine).unwrap();
        let attendu_largeur = 11906.0 * MM_PAR_TWIP;
        let attendu_hauteur = 16838.0 * MM_PAR_TWIP;
        assert!(
            (page.largeur_mm - attendu_largeur).abs() < 1e-9,
            "{} contre {attendu_largeur}",
            page.largeur_mm
        );
        assert!((page.largeur_mm - 210.0086111).abs() < 1e-6);
        assert!((page.hauteur_mm - attendu_hauteur).abs() < 1e-9);
        assert!((page.marge_gauche_mm.unwrap() - 25.4).abs() < 1e-9);
        assert!(!page.est_paysage());
        assert!((page.largeur_utile_mm() - (attendu_largeur - 50.8)).abs() < 1e-9);
    }

    #[test]
    fn page_en_paysage() {
        let xml = r#"<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/></w:sectPr>"#;
        let racine = xml::analyser(xml).unwrap();
        let page = lire_page(&racine).unwrap();
        assert!(page.est_paysage());
    }

    #[test]
    fn page_sans_taille_lisible() {
        assert!(lire_page(&xml::analyser("<w:sectPr/>").unwrap()).is_none());
        assert!(lire_page(&xml::analyser("<w:sectPr><w:pgSz/></w:sectPr>").unwrap()).is_none());
        assert!(lire_page(
            &xml::analyser(r#"<w:sectPr><w:pgSz w:w="0" w:h="100"/></w:sectPr>"#).unwrap()
        )
        .is_none());
    }

    #[test]
    fn caractere_de_symbole() {
        let xml = r#"<w:p><w:r><w:sym w:font="Symbol" w:char="F0B7"/></w:r></w:p>"#;
        let racine = xml::analyser(xml).unwrap();
        let paragraphe = lire_paragraphe(&racine, &[], &mut Vec::new(), &mut Vec::new());
        assert_eq!(paragraphe.texte, "\u{2022}");
    }

    #[test]
    fn image_resolue_par_les_relations() {
        let relations = vec![("rId4".to_string(), "word/media/image1.png".to_string())];
        let xml = r#"<w:p><w:r><w:drawing><wp:inline><a:graphic><a:blip r:embed="rId4"/></a:graphic></wp:inline></w:drawing></w:r></w:p>"#;
        let racine = xml::analyser(xml).unwrap();
        let mut images = Vec::new();
        let paragraphe = lire_paragraphe(&racine, &relations, &mut images, &mut Vec::new());
        assert_eq!(paragraphe.image.as_deref(), Some("word/media/image1.png"));
        assert_eq!(images, vec!["word/media/image1.png".to_string()]);
    }

    #[test]
    fn plusieurs_images_dans_un_paragraphe_sont_signalees() {
        let relations = vec![
            ("rId1".to_string(), "word/media/a.png".to_string()),
            ("rId2".to_string(), "word/media/b.png".to_string()),
        ];
        let xml = r#"<w:p><w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing><a:blip r:embed="rId2"/></w:r></w:p>"#;
        let racine = xml::analyser(xml).unwrap();
        let mut images = Vec::new();
        let mut avertissements = Vec::new();
        let paragraphe = lire_paragraphe(&racine, &relations, &mut images, &mut avertissements);
        assert_eq!(paragraphe.image.as_deref(), Some("word/media/a.png"));
        assert_eq!(images.len(), 2);
        assert_eq!(avertissements.len(), 1);
        assert!(avertissements[0].contains("2 images"));
    }

    #[test]
    fn mises_en_forme_comptees() {
        let xml = r#"<w:p><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>gras italique</w:t></w:r><w:r><w:rPr/><w:t>nu</w:t></w:r></w:p>"#;
        let racine = xml::analyser(xml).unwrap();
        // Un seul `rPr` non vide.
        assert_eq!(compter_mises_en_forme(&racine), 1);
    }

    #[test]
    fn relations_d_un_lien_externe_ignorees() {
        let xml = r#"<Relationships><Relationship Id="rId1" Target="http://exemple.fr" TargetMode="External"/><Relationship Id="rId2" Target="media/i.png"/></Relationships>"#;
        let racine = xml::analyser(xml).unwrap();
        let mut relations = Vec::new();
        for relation in racine.elements().filter(|e| e.est("Relationship")) {
            if relation.attribut("TargetMode") == Some("External") {
                continue;
            }
            relations.push((
                relation.attribut("Id").unwrap().to_string(),
                relation.attribut("Target").unwrap().to_string(),
            ));
        }
        assert_eq!(relations.len(), 1);
        assert_eq!(relations[0].1, "media/i.png");
    }
}
