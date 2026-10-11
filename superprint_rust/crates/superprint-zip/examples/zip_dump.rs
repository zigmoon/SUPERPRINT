//! Dump d'archive **ZIP**, pour comparaison avec des lecteurs indépendants.
//!
//! Cet exemple est la moitié Rust d'une preuve. L'autre moitié
//! (`scripts/validate-zip.mjs`) décompresse **les mêmes entrées** avec le `zlib`
//! de Node, et compare octet pour octet — ce que le noyau rend doit être
//! exactement ce qu'un lecteur indépendant rend.
//!
//! Usage :
//!
//! ```text
//! zip_dump liste    <archive.zip> <sortie.tsv>
//! zip_dump extraire <archive.zip> <nom de l'entrée> <sortie.bin>
//! zip_dump toutes   <archive.zip> <sortie.tsv>
//! zip_dump format   <fichier>      <sortie.tsv>
//! ```
//!
//! `liste` écrit une ligne par entrée : `entree\trang\tmethode\ttaille\tcompressee\tcrc\tnom`.
//! `toutes` extrait **toutes** les entrées et vérifie leur CRC, puis écrit un
//! résumé. `extraire` écrit les octets décompressés dans un fichier.
//!
//! `format` ne décompresse rien : il dit seulement **ce qu'est ce fichier**
//! (archive, PDF, PostScript, XML, autre) et ce que contient une archive. C'est
//! ce qui permet de reconnaître un `.ai` qui est en réalité un PDF, ou un `.doc`
//! renommé en `.docx`.

use std::env;
use std::fs;
use std::process::ExitCode;

use superprint_zip::lecture::ressemble_a_une_archive;
use superprint_zip::Archive;

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    let Some(mode) = args.get(1) else {
        return usage();
    };
    match mode.as_str() {
        "liste" => liste(&args),
        "extraire" => extraire(&args),
        "toutes" => toutes(&args),
        "format" => format_du_fichier(&args),
        autre => {
            eprintln!("mode inconnu : {autre}");
            usage()
        }
    }
}

fn usage() -> ExitCode {
    eprintln!(
        "usage :\n  zip_dump liste    <archive.zip> <sortie.tsv>\n  zip_dump extraire <archive.zip> <nom> <sortie.bin>\n  zip_dump toutes   <archive.zip> <sortie.tsv>\n  zip_dump format   <fichier>     <sortie.tsv>"
    );
    ExitCode::from(2)
}

fn lire(chemin: &str) -> Result<Vec<u8>, ExitCode> {
    match fs::read(chemin) {
        Ok(octets) => Ok(octets),
        Err(e) => {
            eprintln!("lecture impossible de {chemin} : {e}");
            Err(ExitCode::from(1))
        }
    }
}

fn ecrire(chemin: &str, contenu: &[u8], rapport: &str) -> ExitCode {
    if let Err(e) = fs::write(chemin, contenu) {
        eprintln!("écriture impossible : {e}");
        return ExitCode::from(1);
    }
    print!("{rapport}");
    ExitCode::SUCCESS
}

fn liste(args: &[String]) -> ExitCode {
    if args.len() != 4 {
        return usage();
    }
    let Ok(octets) = lire(&args[2]) else {
        return ExitCode::from(1);
    };
    let mut rapport = String::new();
    match Archive::lire(octets) {
        Ok(archive) => {
            for (rang, entree) in archive.entrees().iter().enumerate() {
                rapport.push_str(&format!(
                    "entree\t{rang}\t{}\t{}\t{}\t{:08X}\t{}\n",
                    entree.methode(),
                    entree.taille(),
                    entree.taille_compressee(),
                    entree.crc(),
                    entree.nom()
                ));
            }
            rapport.push_str(&format!("total\t{}\n", archive.nombre_d_entrees()));
        }
        Err(e) => rapport.push_str(&format!("erreur\t{e}\n")),
    }
    ecrire(&args[3], rapport.as_bytes(), &rapport)
}

fn extraire(args: &[String]) -> ExitCode {
    if args.len() != 5 {
        return usage();
    }
    let Ok(octets) = lire(&args[2]) else {
        return ExitCode::from(1);
    };
    let archive = match Archive::lire(octets) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("archive illisible : {e}");
            return ExitCode::from(1);
        }
    };
    match archive.extraire(&args[3]) {
        Ok(contenu) => {
            let rapport = format!(
                "octets\t{}\ncrc\t{:08X}\n",
                contenu.len(),
                superprint_zip::crc32(&contenu)
            );
            ecrire(&args[4], &contenu, &rapport)
        }
        Err(e) => {
            eprintln!("extraction impossible : {e}");
            ExitCode::from(1)
        }
    }
}

fn toutes(args: &[String]) -> ExitCode {
    if args.len() != 4 {
        return usage();
    }
    let Ok(octets) = lire(&args[2]) else {
        return ExitCode::from(1);
    };
    let mut rapport = String::new();
    let archive = match Archive::lire(octets) {
        Ok(a) => a,
        Err(e) => {
            rapport.push_str(&format!("erreur\t{e}\n"));
            return ecrire(&args[3], rapport.as_bytes(), &rapport);
        }
    };
    let mut justes = 0usize;
    let mut refuses = 0usize;
    let mut total_octets = 0usize;
    for entree in archive.entrees() {
        match archive.extraire_entree(entree) {
            Ok(contenu) => {
                justes += 1;
                total_octets += contenu.len();
                rapport.push_str(&format!(
                    "juste\t{}\t{}\t{:08X}\n",
                    entree.nom(),
                    contenu.len(),
                    superprint_zip::crc32(&contenu)
                ));
            }
            Err(e) => {
                refuses += 1;
                rapport.push_str(&format!("refus\t{}\t{e}\n", entree.nom()));
            }
        }
    }
    rapport.push_str(&format!("justes\t{justes}\n"));
    rapport.push_str(&format!("refuses\t{refuses}\n"));
    rapport.push_str(&format!("octets\t{total_octets}\n"));
    ecrire(&args[3], rapport.as_bytes(), &rapport)
}

/// Dit ce qu'est un fichier, sans rien décompresser.
fn format_du_fichier(args: &[String]) -> ExitCode {
    if args.len() != 4 {
        return usage();
    }
    let Ok(octets) = lire(&args[2]) else {
        return ExitCode::from(1);
    };
    let mut rapport = String::new();
    let debut = &octets[..octets.len().min(1024)];
    let texte = String::from_utf8_lossy(debut);
    let nature = if octets.len() >= 5 && &octets[0..5] == b"%PDF-" {
        "pdf"
    } else if octets.len() >= 2 && &octets[0..2] == b"%!" {
        "postscript"
    } else if ressemble_a_une_archive(&octets) {
        "zip"
    } else if octets.len() >= 8 && octets[0..8] == [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]
    {
        "ole2"
    } else if texte.trim_start().starts_with('{') {
        "rtf"
    } else if texte.trim_start().starts_with('<') {
        "xml"
    } else {
        "inconnu"
    };
    rapport.push_str(&format!("nature\t{nature}\n"));
    rapport.push_str(&format!("octets\t{}\n", octets.len()));
    // La version PDF, quand il y en a une : c'est ce qui distingue un `.ai`
    // moderne (qui est un PDF) d'un `.ai` en PostScript.
    if nature == "pdf" {
        let version: String = octets[5..octets.len().min(20)]
            .iter()
            .take_while(|o| **o != b'\n' && **o != b'\r')
            .map(|o| *o as char)
            .collect();
        rapport.push_str(&format!("version\t{}\n", version.trim()));
    }
    if nature == "postscript" {
        for ligne in texte.lines().take(40) {
            if let Some(reste) = ligne.strip_prefix("%%BoundingBox:") {
                rapport.push_str(&format!("boundingbox\t{}\n", reste.trim()));
            }
            if let Some(reste) = ligne.strip_prefix("%%HiResBoundingBox:") {
                rapport.push_str(&format!("hiresboundingbox\t{}\n", reste.trim()));
            }
            if let Some(reste) = ligne.strip_prefix("%%Creator:") {
                rapport.push_str(&format!("createur\t{}\n", reste.trim()));
            }
        }
    }
    if nature == "zip" {
        match Archive::lire(octets) {
            Ok(archive) => {
                rapport.push_str(&format!("entrees\t{}\n", archive.nombre_d_entrees()));
                // Les entrées qui identifient un format, sans en lire le corps.
                // Toutes celles qui sont là sont écrites : un `.docx` porte
                // souvent `[Content_Types].xml` ET `word/document.xml`, et
                // c'est l'ensemble qui dit ce qu'est le fichier.
                let mut marqueurs: Vec<String> = Vec::new();
                for nom in [
                    "mimetype",
                    "[Content_Types].xml",
                    "word/document.xml",
                    "xl/workbook.xml",
                    "content.xml",
                    "META-INF/manifest.xml",
                    "designmap.xml",
                ] {
                    if archive.trouver_souple(nom).is_some() {
                        marqueurs.push(nom.to_lowercase());
                    }
                }
                rapport.push_str(&format!("marqueurs\t{}\n", marqueurs.join(" ")));
                let mut racines: Vec<&str> = Vec::new();
                for entree in archive.entrees() {
                    let racine = entree.nom().split('/').next().unwrap_or("");
                    if !racine.contains('.') && !racine.is_empty() && !racines.contains(&racine) {
                        racines.push(racine);
                    }
                }
                racines.sort_unstable();
                rapport.push_str(&format!("dossiers\t{}\n", racines.join(" ")));
            }
            Err(e) => rapport.push_str(&format!("erreur\t{e}\n")),
        }
    }
    ecrire(&args[3], rapport.as_bytes(), &rapport)
}
