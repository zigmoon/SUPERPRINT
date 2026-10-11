//! Compresse ou décompresse un fichier, pour la preuve croisée avec Node.
//!
//! Cet exemple est la moitié Rust de `scripts/validate-compression.mjs`. Le
//! script lui donne des fichiers, récupère sa sortie et la **confronte au
//! `zlib` de Node**, qui est une autre implémentation. Comparer un compresseur
//! à lui-même ne prouve rien ; le confronter à un tiers, si.
//!
//! Usage :
//!
//! ```text
//! compression_dump compresser   [rapide|defaut|pousse] <entree> <sortie>
//! compression_dump decompresser <entree> <sortie>
//! compression_dump brut         [rapide|defaut|pousse] <entree> <sortie>
//! compression_dump brut-relire  <entree> <sortie>
//! ```

use std::env;
use std::fs;
use std::process::ExitCode;

use superprint_compress::{
    compresser_brut, compresser_zlib, decompresser_brut, decompresser_zlib, Compression,
};

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    if args.len() < 4 {
        eprintln!(
            "usage : compression_dump <compresser|decompresser|brut|brut-relire> [niveau] <entree> <sortie>"
        );
        return ExitCode::from(2);
    }
    let mode = args[1].as_str();
    let avec_niveau = matches!(mode, "compresser" | "brut");
    let (niveau, indice) = if avec_niveau {
        let Some(brut) = args.get(2) else {
            return ExitCode::from(2);
        };
        (lire_niveau(brut), 3usize)
    } else {
        (Compression::Defaut, 2usize)
    };
    let (Some(entree), Some(sortie)) = (args.get(indice), args.get(indice + 1)) else {
        eprintln!("chemins manquants");
        return ExitCode::from(2);
    };

    let Ok(donnees) = fs::read(entree) else {
        eprintln!("lecture impossible : {entree}");
        return ExitCode::from(2);
    };

    let resultat = match mode {
        "compresser" => Ok(compresser_zlib(&donnees)),
        "brut" => Ok(compresser_brut(&donnees, niveau)),
        "decompresser" => decompresser_zlib(&donnees),
        "brut-relire" => decompresser_brut(&donnees),
        _ => {
            eprintln!("mode inconnu : {mode}");
            return ExitCode::from(2);
        }
    };

    match resultat {
        Ok(octets) => {
            if let Err(erreur) = fs::write(sortie, &octets) {
                eprintln!("écriture impossible : {erreur}");
                return ExitCode::from(2);
            }
            // Le rapport de taille part sur la sortie d'erreur : le script le
            // affiche, mais rien ne se mêle aux octets du fichier.
            eprintln!(
                "{mode} : {} octet(s) → {} octet(s)",
                donnees.len(),
                octets.len()
            );
            ExitCode::SUCCESS
        }
        Err(erreur) => {
            // Un refus est une **information**, pas un plantage : le script
            // s'en sert pour vérifier qu'un flux corrompu est bien rejeté.
            eprintln!("refus : {erreur}");
            ExitCode::from(3)
        }
    }
}

fn lire_niveau(texte: &str) -> Compression {
    match texte {
        "rapide" => Compression::Rapide,
        "pousse" => Compression::Pousse,
        _ => Compression::Defaut,
    }
}
