//! Dump d'un **SVG importé**, pour comparaison avec un lecteur écrit à part.
//!
//! Cet exemple est la moitié Rust d'une preuve. L'autre moitié
//! (`scripts/validate-svg.mjs`) écrit **son propre** lecteur de commandes de
//! chemin — lexeur, matrice, arc, aplatissement — et compare, forme par forme et
//! sommet par sommet, avec ce que le noyau rend.
//!
//! Usage :
//!
//! ```text
//! svg_dump resume   <fichier.svg> <tolerance> <sortie.tsv>
//! svg_dump formes   <fichier.svg> <tolerance> <sortie.tsv>
//! svg_dump couleurs <sortie.tsv>
//! ```
//!
//! Le TSV des formes porte, par ligne : le rang de la forme, le nombre de
//! sous-chemins, le nombre de sommets, l'aire signée, la boîte, le remplissage,
//! le contour et son épaisseur. Les **sommets** sont écrits dans leur propre
//! section, un point par ligne, échappés comme le reste : c'est ce qui permet de
//! comparer deux lectures **au sommet près**, et pas seulement en résumé.

use std::env;
use std::fs;
use std::process::ExitCode;

use superprint_doc::svg::{self, Ancre, DocumentSvg, TOLERANCE_PAR_DEFAUT};

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    let Some(mode) = args.get(1) else {
        return usage();
    };
    match mode.as_str() {
        "resume" => resume(&args),
        "formes" => formes(&args),
        "couleurs" => couleurs(&args),
        autre => {
            eprintln!("mode inconnu : {autre}");
            usage()
        }
    }
}

fn usage() -> ExitCode {
    eprintln!(
        "usage :\n  svg_dump resume   <fichier.svg> <tolerance> <sortie.tsv>\n  svg_dump formes   <fichier.svg> <tolerance> <sortie.tsv>\n  svg_dump couleurs <sortie.tsv>"
    );
    ExitCode::from(2)
}

fn ecrire(chemin: &str, contenu: &str) -> ExitCode {
    if let Err(e) = fs::write(chemin, contenu) {
        eprintln!("écriture impossible : {e}");
        return ExitCode::from(1);
    }
    print!("{contenu}");
    ExitCode::SUCCESS
}

/// Échappe un texte pour qu'il tienne sur une ligne de TSV.
fn echapper(texte: &str) -> String {
    let mut sortie = String::with_capacity(texte.len());
    for c in texte.chars() {
        match c {
            '\\' => sortie.push_str("\\\\"),
            '\t' => sortie.push_str("\\t"),
            '\n' => sortie.push_str("\\n"),
            '\r' => sortie.push_str("\\r"),
            autre => sortie.push(autre),
        }
    }
    sortie
}

fn tolerance(argument: Option<&String>) -> f64 {
    argument
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(TOLERANCE_PAR_DEFAUT)
}

/// Lit le fichier, et **dit ce qui a échoué** au lieu de sortir en silence : le
/// script de contrôle vérifie que les refus sont nommés.
fn lire(chemin: &str, tolerance: f64) -> Result<DocumentSvg, String> {
    let octets = fs::read(chemin).map_err(|e| format!("lecture impossible : {e}"))?;
    svg::lire_octets(&octets, tolerance).map_err(|e| e.to_string())
}

fn resume(args: &[String]) -> ExitCode {
    if args.len() != 5 {
        return usage();
    }
    let tolerance = tolerance(args.get(3));
    let octets = match fs::read(&args[2]) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("lecture impossible : {e}");
            return ExitCode::FAILURE;
        }
    };
    let rapport = match svg::lire_octets(&octets, tolerance) {
        Ok(document) => rendu_resume(&document),
        Err(e) => format!("erreur\t{}\n", echapper(&e.to_string())),
    };
    ecrire(&args[4], &rapport)
}

fn rendu_resume(document: &DocumentSvg) -> String {
    let mut sortie = String::new();
    sortie.push_str(&format!("tolerance\t{}\n", document.tolerance));
    sortie.push_str(&format!("entites\t{}\n", document.entites));
    sortie.push_str(&format!("formes\t{}\n", document.formes.len()));
    sortie.push_str(&format!("sommets\t{}\n", document.nombre_de_sommets()));
    sortie.push_str(&format!("textes\t{}\n", document.textes.len()));
    sortie.push_str(&format!("aire\t{:.9}\n", document.aire()));
    match document.boite() {
        Some((min, max)) => sortie.push_str(&format!(
            "boite\t{:.6}\t{:.6}\t{:.6}\t{:.6}\n",
            min.x, min.y, max.x, max.y
        )),
        None => sortie.push_str("boite\t-\n"),
    }
    sortie.push_str(&format!(
        "largeur\t{}\n",
        document
            .largeur
            .map_or("?".to_string(), |v| format!("{v:.6}"))
    ));
    sortie.push_str(&format!(
        "hauteur\t{}\n",
        document
            .hauteur
            .map_or("?".to_string(), |v| format!("{v:.6}"))
    ));
    match document.view_box {
        Some(boite) => sortie.push_str(&format!(
            "viewbox\t{:.6}\t{:.6}\t{:.6}\t{:.6}\n",
            boite.min.x, boite.min.y, boite.max.x, boite.max.y
        )),
        None => sortie.push_str("viewbox\t-\n"),
    }
    for (nom, compte) in &document.non_rendus {
        sortie.push_str(&format!("non_rendu\t{nom}\t{compte}\n"));
    }
    for avertissement in &document.avertissements {
        sortie.push_str(&format!("avertissement\t{}\n", echapper(avertissement)));
    }
    sortie
}

fn formes(args: &[String]) -> ExitCode {
    if args.len() != 5 {
        return usage();
    }
    let tolerance = tolerance(args.get(3));
    match lire(&args[2], tolerance) {
        Ok(document) => ecrire(&args[4], &rendu_formes(&document)),
        Err(e) => ecrire(&args[4], &format!("erreur\t{}\n", echapper(&e))),
    }
}

fn rendu_formes(document: &DocumentSvg) -> String {
    let mut sortie = rendu_resume(document);
    for (rang, forme) in document.formes.iter().enumerate() {
        let (min_x, min_y, max_x, max_y) = match forme.boite() {
            Some((min, max)) => (min.x, min.y, max.x, max.y),
            None => (f64::NAN, f64::NAN, f64::NAN, f64::NAN),
        };
        let remplissage = forme.remplissage.map_or("-".to_string(), |c| {
            format!("{}@{:.6}", c.hexadecimal(), c.alpha)
        });
        let (contour, epaisseur, extremite, jonction) = match forme.contour {
            Some(trait_) => (
                format!(
                    "{}@{:.6}",
                    trait_.couleur.hexadecimal(),
                    trait_.couleur.alpha
                ),
                format!("{:.6}", trait_.epaisseur),
                format!("{:?}", trait_.extremite),
                format!("{:?}", trait_.jonction),
            ),
            None => (
                "-".to_string(),
                "-".to_string(),
                "-".to_string(),
                "-".to_string(),
            ),
        };
        sortie.push_str(&format!(
            "forme\t{rang}\t{}\t{}\t{:.9}\t{min_x:.6}\t{min_y:.6}\t{max_x:.6}\t{max_y:.6}\t{remplissage}\t{contour}\t{epaisseur}\t{extremite}\t{jonction}\t{}\t{}\n",
            forme.sous_chemins.len(),
            forme.nombre_de_sommets(),
            forme.aire(),
            forme.regle as u8,
            forme.id.as_deref().map_or("-".to_string(), echapper),
        ));
        for (sous_rang, sous_chemin) in forme.sous_chemins.iter().enumerate() {
            for (point_rang, point) in sous_chemin.iter().enumerate() {
                sortie.push_str(&format!(
                    "sommet\t{rang}\t{sous_rang}\t{point_rang}\t{:.9}\t{:.9}\n",
                    point.x, point.y
                ));
            }
        }
    }
    for (rang, texte) in document.textes.iter().enumerate() {
        let ancre = match texte.ancre {
            Ancre::Debut => "Debut",
            Ancre::Milieu => "Milieu",
            Ancre::Fin => "Fin",
        };
        sortie.push_str(&format!(
            "texte\t{rang}\t{:.6}\t{:.6}\t{:.6}\t{}\t{}\t{}\t{}\t{ancre}\n",
            texte.x,
            texte.y,
            texte.corps,
            echapper(&texte.contenu),
            echapper(&texte.famille),
            texte.gras as u8,
            texte.italique as u8,
        ));
    }
    sortie
}

/// Écrit la table des couleurs nommées du noyau, pour que le script de contrôle
/// puisse la comparer à celle du produit (`jspdf.umd.min.js`), nom par nom.
fn couleurs(args: &[String]) -> ExitCode {
    if args.len() != 3 {
        return usage();
    }
    let mut sortie = String::new();
    for (nom, entier) in svg::COULEURS {
        sortie.push_str(&format!(
            "couleur\t{nom}\t{:02x}{:02x}{:02x}\n",
            (entier >> 16) & 0xFF,
            (entier >> 8) & 0xFF,
            entier & 0xFF
        ));
    }
    ecrire(&args[2], &sortie)
}
