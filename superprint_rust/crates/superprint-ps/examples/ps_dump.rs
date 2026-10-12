//! Dump d'un **fichier PostScript** interprété, pour comparaison avec un
//! interpréteur écrit à part.
//!
//! Cet exemple est la moitié Rust d'une preuve. L'autre moitié
//! (`scripts/validate-ps.mjs`) interprète le **même** PostScript avec son propre
//! lexeur, sa propre pile et sa propre matrice, écrits indépendamment, et
//! compare dessin par dessin : nombre de sommets, boîte, aire, couleur, peinture.
//!
//! Usage :
//!
//! ```text
//! ps_dump entete  <fichier.eps> <sortie.tsv>
//! ps_dump dessins <fichier.eps> <tolerance> <sortie.tsv>
//! ps_dump texte   <fichier.eps> <sortie.txt>
//! ps_dump format  <fichier> <sortie.tsv>
//! ```
//!
//! Le TSV des dessins porte, pour chaque dessin : son rang, sa peinture, son
//! espace colorimétrique, ses composantes, son nombre de sommets, sa boîte et
//! son aire. Les nombres sont écrits avec 9 décimales : assez pour qu'une
//! divergence de calcul apparaisse, pas assez pour que du bruit d'arrondi en
//! produise une.

use std::env;
use std::fs;
use std::process::ExitCode;

use superprint_ps::{dsc, interpreter_avec, Couleur, DocumentPs, ErreurPs, Peinture};

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    let Some(mode) = args.get(1) else {
        return usage();
    };
    match mode.as_str() {
        "entete" => entete(&args),
        "dessins" => dessins(&args),
        "texte" => texte(&args),
        "format" => format(&args),
        autre => {
            eprintln!("mode inconnu : {autre}");
            usage()
        }
    }
}

fn usage() -> ExitCode {
    eprintln!(
        "usage :\n  ps_dump entete  <fichier.eps> <sortie.tsv>\n  ps_dump dessins <fichier.eps> <tolerance> <sortie.tsv>\n  ps_dump texte   <fichier.eps> <sortie.txt>\n  ps_dump format  <fichier> <sortie.tsv>"
    );
    ExitCode::from(2)
}

fn ecrire(chemin: &str, contenu: &str) -> ExitCode {
    match fs::write(chemin, contenu) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("écriture impossible dans {chemin} : {e}");
            ExitCode::FAILURE
        }
    }
}

fn lire(chemin: &str) -> Result<Vec<u8>, String> {
    fs::read(chemin).map_err(|e| format!("lecture impossible : {e}"))
}

/// Décrit une erreur d'interprétation en une ligne, sans saut de ligne : elle
/// doit tenir dans une cellule de TSV.
fn decrire(e: &ErreurPs) -> String {
    // Les accents restent des accents : le rapport est lu par un script qui
    // compare des raisons écrites en français, et `escape_default` les
    // transformerait en `\u{e9}`, ce qui rendrait toute comparaison fausse.
    e.to_string()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

// ─────────────────────────────────────────────────────────────────────────────
// entete
// ─────────────────────────────────────────────────────────────────────────────

fn entete(args: &[String]) -> ExitCode {
    let (Some(fichier), Some(sortie)) = (args.get(2), args.get(3)) else {
        return usage();
    };
    let octets = match lire(fichier) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::FAILURE;
        }
    };
    let saveur = dsc::reconnaitre(&octets);
    let po = saveur == dsc::Saveur::PostScript;
    let mut sortie_tsv = String::new();
    sortie_tsv.push_str(&format!("saveur\t{saveur}\n"));
    sortie_tsv.push_str(&format!("octets\t{}\n", octets.len()));
    if !po {
        // Le découpage DSC n'a de sens que sur du PostScript : sur un PDF ou une
        // archive, il lirait du binaire comme s'il s'agissait de lignes, et
        // rapporterait des commentaires `%AI…` qui sont des octets comprimés.
        sortie_tsv.push_str("blocs\t-\n");
        sortie_tsv.push_str("version\t\n");
        sortie_tsv.push_str("eps\tfalse\n");
        sortie_tsv.push_str("createur\t\n");
        sortie_tsv.push_str("titre\t\n");
        sortie_tsv.push_str("pages\t-\n");
        sortie_tsv.push_str("boundingbox\t-\t-\t-\t-\n");
        sortie_tsv.push_str("hiresboundingbox\t-\t-\t-\t-\n");
        sortie_tsv.push_str("millimetres\t-\t-\n");
        return ecrire(sortie, &sortie_tsv);
    }
    let (en_tete, _, blocs) = dsc::decouper(&String::from_utf8_lossy(&octets));
    sortie_tsv.push_str(&format!("blocs\t{blocs}\n"));
    sortie_tsv.push_str(&format!(
        "version\t{}\n",
        en_tete.version.as_deref().unwrap_or("")
    ));
    sortie_tsv.push_str(&format!("eps\t{}\n", en_tete.est_eps));
    sortie_tsv.push_str(&format!(
        "createur\t{}\n",
        en_tete.createur.as_deref().unwrap_or("")
    ));
    sortie_tsv.push_str(&format!(
        "titre\t{}\n",
        en_tete.titre.as_deref().unwrap_or("")
    ));
    sortie_tsv.push_str(&format!(
        "pages\t{}\n",
        en_tete
            .pages_annoncees
            .map_or_else(|| "-".to_string(), |p| p.to_string())
    ));
    sortie_tsv.push_str(&format!(
        "boundingbox\t{}\n",
        boite_texte(en_tete.bounding_box)
    ));
    sortie_tsv.push_str(&format!(
        "hiresboundingbox\t{}\n",
        boite_texte(en_tete.bounding_box_haute_resolution)
    ));
    sortie_tsv.push_str(&format!(
        "millimetres\t{}\n",
        match en_tete.dimensions_mm() {
            Some((l, h)) => format!("{l:.9}\t{h:.9}"),
            None => "-\t-".to_string(),
        }
    ));
    for commentaire in &en_tete.commentaires_illustrator {
        sortie_tsv.push_str(&format!("illustrator\t{commentaire}\n"));
    }
    ecrire(sortie, &sortie_tsv)
}

fn boite_texte(boite: Option<(f64, f64, f64, f64)>) -> String {
    match boite {
        Some((x0, y0, x1, y1)) => format!("{x0:.9}\t{y0:.9}\t{x1:.9}\t{y1:.9}"),
        None => "-\t-\t-\t-".to_string(),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// dessins
// ─────────────────────────────────────────────────────────────────────────────

fn dessins(args: &[String]) -> ExitCode {
    let (Some(fichier), Some(tolerance), Some(sortie)) = (args.get(2), args.get(3), args.get(4))
    else {
        return usage();
    };
    let Ok(tolerance) = tolerance.parse::<f64>() else {
        eprintln!("tolérance illisible : {tolerance}");
        return ExitCode::FAILURE;
    };
    let octets = match lire(fichier) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::FAILURE;
        }
    };
    match interpreter_avec(&octets, tolerance) {
        Ok(document) => ecrire(sortie, &rendu_dessins(&document)),
        Err(e) => ecrire(sortie, &format!("erreur\t{}\n", decrire(&e))),
    }
}

fn rendu_dessins(document: &DocumentPs) -> String {
    let mut sortie = String::new();
    sortie.push_str(&format!("tolerance\t{}\n", document_somme_texte(document)));
    sortie.push_str(&format!("blocs\t{}\n", document.valeurs.blocs_ignores));
    sortie.push_str(&format!("pages\t{}\n", document.valeurs.pages));
    sortie.push_str(&format!("dessins\t{}\n", document.dessins().len()));
    sortie.push_str(&format!("sommets\t{}\n", document.nombre_de_sommets()));
    for avertissement in &document.valeurs.avertissements {
        sortie.push_str(&format!(
            "avertissement\t{}\n",
            avertissement.replace(['\t', '\n'], " ")
        ));
    }
    for inconnu in &document.valeurs.inconnus {
        sortie.push_str(&format!("inconnu\t{inconnu}\n"));
    }
    for (rang, dessin) in document.dessins().iter().enumerate() {
        let (peinture, epaisseur) = match dessin.peinture {
            Peinture::Rempli => ("remplissage".to_string(), "-".to_string()),
            Peinture::RempliPairImpair => ("remplissage-pair-impair".to_string(), "-".to_string()),
            Peinture::Contour { epaisseur } => ("contour".to_string(), format!("{epaisseur:.9}")),
            Peinture::Tronque => ("decoupage".to_string(), "-".to_string()),
            Peinture::TronquePairImpair => ("decoupage-pair-impair".to_string(), "-".to_string()),
        };
        let couleur = match dessin.couleur {
            Couleur::Gris(g) => format!("gris\t{g:.9}\t-\t-\t-"),
            Couleur::Rvb(r, v, b) => format!("rvb\t{r:.9}\t{v:.9}\t{b:.9}\t-"),
            Couleur::Cmjn(c, m, j, n) => format!("cmjn\t{c:.9}\t{m:.9}\t{j:.9}\t{n:.9}"),
        };
        let boite = match dessin.boite() {
            Some((min, max)) => format!("{:.9}\t{:.9}\t{:.9}\t{:.9}", min.x, min.y, max.x, max.y),
            None => "-\t-\t-\t-".to_string(),
        };
        sortie.push_str(&format!(
            "dessin\t{rang}\t{peinture}\t{epaisseur}\t{couleur}\t{}\t{boite}\t{:.9}\n",
            dessin.nombre_de_sommets(),
            dessin.aire(),
        ));
        // Les sommets eux-mêmes, un par ligne : c'est ce qui permet de comparer
        // deux interprétations point par point, et pas seulement en surface.
        for (rangs, sous_chemin) in dessin.sous_chemins.iter().enumerate() {
            for (rangp, point) in sous_chemin.iter().enumerate() {
                sortie.push_str(&format!(
                    "sommet\t{rang}\t{rangs}\t{rangp}\t{:.9}\t{:.9}\n",
                    point.x, point.y
                ));
            }
        }
    }
    sortie
}

/// Un marqueur de tolérance lisible : la valeur réellement employée.
fn document_somme_texte(_document: &DocumentPs) -> String {
    format!("{:.9}", superprint_ps::TOLERANCE_PAR_DEFAUT)
}

// ─────────────────────────────────────────────────────────────────────────────
// texte : les opérateurs et les avertissements
// ─────────────────────────────────────────────────────────────────────────────

fn texte(args: &[String]) -> ExitCode {
    let (Some(fichier), Some(sortie)) = (args.get(2), args.get(3)) else {
        return usage();
    };
    let octets = match lire(fichier) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::FAILURE;
        }
    };
    match superprint_ps::interpreter(&octets) {
        Ok(document) => {
            let mut contenu = String::new();
            for operateur in &document.valeurs.operateurs {
                contenu.push_str(&format!("operateur\t{operateur}\n"));
            }
            for avertissement in &document.valeurs.avertissements {
                contenu.push_str(&format!(
                    "avertissement\t{}\n",
                    avertissement.replace(['\t', '\n'], " ")
                ));
            }
            for inconnu in &document.valeurs.inconnus {
                contenu.push_str(&format!("inconnu\t{inconnu}\n"));
            }
            ecrire(sortie, &contenu)
        }
        Err(e) => ecrire(sortie, &format!("erreur\t{}\n", decrire(&e))),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// format : ce que le fichier est, quand il n'est pas du PostScript
// ─────────────────────────────────────────────────────────────────────────────

fn format(args: &[String]) -> ExitCode {
    let (Some(fichier), Some(sortie)) = (args.get(2), args.get(3)) else {
        return usage();
    };
    let octets = match lire(fichier) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::FAILURE;
        }
    };
    let saveur = dsc::reconnaitre(&octets);
    let nature = match saveur {
        dsc::Saveur::PostScript if octets.starts_with(b"%!PS-Adobe") => "postscript-adobe",
        dsc::Saveur::PostScript => "postscript",
        dsc::Saveur::Pdf { .. } => "pdf",
        dsc::Saveur::Archive => "zip",
        dsc::Saveur::Inconnnue => "inconnu",
    };
    let mut sortie_tsv = String::new();
    sortie_tsv.push_str(&format!("nature\t{nature}\n"));
    sortie_tsv.push_str(&format!("saveur\t{saveur}\n"));
    sortie_tsv.push_str(&format!("octets\t{}\n", octets.len()));
    // Et ce que l'interprétation en dit : c'est la vraie réponse.
    match superprint_ps::interpreter(&octets) {
        Ok(document) => {
            sortie_tsv.push_str("interpretable\toui\n");
            sortie_tsv.push_str(&format!("dessins\t{}\n", document.dessins().len()));
        }
        Err(e) => {
            sortie_tsv.push_str("interpretable\tnon\n");
            sortie_tsv.push_str(&format!("erreur\t{}\n", decrire(&e)));
        }
    }
    ecrire(sortie, &sortie_tsv)
}
