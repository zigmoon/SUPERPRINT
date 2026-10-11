//! Dump d'un **document importé**, pour comparaison avec un extracteur écrit
//! à part.
//!
//! Cet exemple est la moitié Rust d'une preuve. L'autre moitié
//! (`scripts/validate-doc.mjs`) analyse le **même XML** avec son propre
//! analyseur, écrit indépendamment, et compare paragraphe par paragraphe.
//!
//! Usage :
//!
//! ```text
//! doc_dump resume      <document> <sortie.tsv>
//! doc_dump paragraphes <document> <sortie.tsv>
//! doc_dump texte       <document> <sortie.txt>
//! doc_dump flux        <document> <retrait> <espace> <sortie.tsv>
//! ```
//!
//! Le TSV des paragraphes échappe les tabulations et les sauts de ligne
//! (`\t`, `\n`, `\\`) pour qu'un paragraphe tienne sur une ligne — sinon un
//! paragraphe portant un saut de ligne forcé serait illisible pour le script de
//! contrôle.

use std::env;
use std::fs;
use std::process::ExitCode;

use superprint_doc::xml;
use superprint_doc::{ErreurImport, Memoire};

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    let Some(mode) = args.get(1) else {
        return usage();
    };
    match mode.as_str() {
        "resume" => resume(&args),
        "paragraphes" => paragraphes(&args),
        "texte" => texte(&args),
        "flux" => flux(&args),
        "xml" => xml_brut(&args),
        autre => {
            eprintln!("mode inconnu : {autre}");
            usage()
        }
    }
}

fn usage() -> ExitCode {
    eprintln!(
        "usage :\n  doc_dump resume      <document> <sortie.tsv>\n  doc_dump paragraphes <document> <sortie.tsv>\n  doc_dump texte       <document> <sortie.txt>\n  doc_dump flux        <document> <retrait> <espace> <sortie.tsv>\n  doc_dump xml         <document> <entree> <sortie.txt>"
    );
    ExitCode::from(2)
}

/// Lit un document, et rend l'erreur en nommant ce qu'on a trouvé à la place.
fn ouvrir(chemin: &str) -> Result<Memoire, String> {
    let octets = fs::read(chemin).map_err(|e| format!("lecture impossible : {e}"))?;
    Memoire::depuis_octets(octets).map_err(|e| decrire(&e))
}

/// Décrit une erreur d'import en disant ce que le fichier est, quand on peut.
fn decrire(e: &ErreurImport) -> String {
    match e {
        ErreurImport::Conteneur(superprint_zip::ErreurZip::PasUneArchive) => {
            "ce n'est pas une archive ZIP : un .doc binaire, un .rtf ou un PDF renommé".to_string()
        }
        autre => autre.to_string(),
    }
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

fn resume(args: &[String]) -> ExitCode {
    if args.len() != 4 {
        return usage();
    }
    let mut rapport = String::new();
    match ouvrir(&args[2]) {
        Ok(memoire) => {
            rapport.push_str(&format!("format\t{}\n", memoire.format.nom()));
            rapport.push_str(&format!("mime\t{}\n", memoire.format.type_mime()));
            rapport.push_str(&format!("paragraphes\t{}\n", memoire.paragraphes.len()));
            rapport.push_str(&format!("caracteres\t{}\n", memoire.nombre_de_caracteres()));
            rapport.push_str(&format!("titres\t{}\n", memoire.titres().count()));
            rapport.push_str(&format!(
                "listes\t{}\n",
                memoire.paragraphes.iter().filter(|p| p.liste).count()
            ));
            rapport.push_str(&format!(
                "tableaux\t{}\n",
                memoire
                    .paragraphes
                    .iter()
                    .filter_map(|p| p.table)
                    .map(|(l, _)| l)
                    .max()
                    .map_or(0, |l| l + 1)
            ));
            rapport.push_str(&format!("notes\t{}\n", memoire.notes.len()));
            rapport.push_str(&format!("images\t{}\n", memoire.images.len()));
            for image in &memoire.images {
                rapport.push_str(&format!("image\t{}\n", image));
            }
            if let Some(page) = memoire.page {
                rapport.push_str(&format!(
                    "page\t{:.6}\t{:.6}\t{}\t{}\t{}\t{}\n",
                    page.largeur_mm,
                    page.hauteur_mm,
                    page.est_paysage() as u8,
                    page.marge_gauche_mm
                        .map_or("?".to_string(), |v| format!("{v:.6}")),
                    page.marge_haut_mm
                        .map_or("?".to_string(), |v| format!("{v:.6}")),
                    page.marge_droite_mm
                        .map_or("?".to_string(), |v| format!("{v:.6}")),
                ));
            } else {
                rapport.push_str("page\t-\n");
            }
            if let Some(titre) = &memoire.titre {
                rapport.push_str(&format!("titre\t{}\n", echapper(titre)));
            }
            for note in &memoire.notes {
                rapport.push_str(&format!("note\t{}\n", echapper(note)));
            }
            for avertissement in &memoire.avertissements {
                rapport.push_str(&format!("avertissement\t{}\n", echapper(avertissement)));
            }
        }
        Err(e) => rapport.push_str(&format!("erreur\t{e}\n")),
    }
    ecrire(&args[3], &rapport)
}

fn paragraphes(args: &[String]) -> ExitCode {
    if args.len() != 4 {
        return usage();
    }
    let mut rapport = String::new();
    match ouvrir(&args[2]) {
        Ok(memoire) => {
            for (rang, paragraphe) in memoire.paragraphes.iter().enumerate() {
                let table = paragraphe
                    .table
                    .map_or("-".to_string(), |(l, c)| format!("{l}:{c}"));
                rapport.push_str(&format!(
                    "para\t{rang}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\n",
                    paragraphe.niveau.map_or("-".to_string(), |n| n.to_string()),
                    u8::from(paragraphe.liste),
                    paragraphe.alignement.nom(),
                    paragraphe.style.as_deref().unwrap_or("-"),
                    table,
                    paragraphe.image.as_deref().unwrap_or("-"),
                    echapper(&paragraphe.texte),
                ));
            }
            rapport.push_str(&format!("total\t{}\n", memoire.paragraphes.len()));
        }
        Err(e) => rapport.push_str(&format!("erreur\t{e}\n")),
    }
    ecrire(&args[3], &rapport)
}

fn texte(args: &[String]) -> ExitCode {
    if args.len() != 4 {
        return usage();
    }
    match ouvrir(&args[2]) {
        Ok(memoire) => ecrire(&args[3], &memoire.texte()),
        Err(e) => {
            eprintln!("{e}");
            ExitCode::from(1)
        }
    }
}

/// Convertit le document en flux de texte, pour la pagination.
fn flux(args: &[String]) -> ExitCode {
    if args.len() != 6 {
        return usage();
    }
    let (Ok(retrait), Ok(espace)) = (args[3].parse::<f64>(), args[4].parse::<f64>()) else {
        return usage();
    };
    let mut rapport = String::new();
    match ouvrir(&args[2]) {
        Ok(memoire) => {
            let flux = memoire.fluidifier(retrait, espace);
            rapport.push_str(&format!("paragraphes\t{}\n", flux.nombre_de_paragraphes()));
            rapport.push_str(&format!("caracteres\t{}\n", flux.longueur()));
            for (rang, paragraphe) in flux.paragraphes.iter().enumerate() {
                rapport.push_str(&format!(
                    "flux\t{rang}\t{:.6}\t{:.6}\t{}\t{}\n",
                    paragraphe.retrait_premiere,
                    paragraphe.retrait_suivantes,
                    u8::from(paragraphe.cesure),
                    echapper(&paragraphe.texte),
                ));
            }
        }
        Err(e) => rapport.push_str(&format!("erreur\t{e}\n")),
    }
    ecrire(&args[5], &rapport)
}

/// Extrait une entrée de l'archive et l'écrit telle quelle.
///
/// Sert au contrôle : le script de validation a besoin de lire le **même** XML
/// que celui que le noyau a analysé, pour l'analyser à son tour.
fn xml_brut(args: &[String]) -> ExitCode {
    if args.len() != 5 {
        return usage();
    }
    let octets = match fs::read(&args[2]) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("lecture impossible : {e}");
            return ExitCode::from(1);
        }
    };
    let Ok(archive) = superprint_zip::Archive::lire(octets) else {
        eprintln!("archive illisible");
        return ExitCode::from(1);
    };
    match archive.extraire_texte(&args[3]) {
        Ok(contenu) => ecrire(&args[4], &contenu),
        Err(e) => {
            eprintln!("{e}");
            ExitCode::from(1)
        }
    }
}

/// Le module `xml` est exposé pour que le script de contrôle puisse vérifier
/// qu'un XML mal formé est bien refusé, sans passer par un document complet.
#[allow(dead_code)]
fn analyser_xml(texte: &str) -> Result<xml::Element, String> {
    xml::analyser(texte).map_err(|e| e.to_string())
}
