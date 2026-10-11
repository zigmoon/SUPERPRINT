//! Dump de la **pagination**, pour comparaison avec l'algorithme du produit.
//!
//! Cet exemple n'est pas une démonstration : c'est la moitié Rust d'une preuve.
//! `scripts/validate-flow.mjs` met en face deux façons de répartir un texte sur
//! une chaîne de cadres, avec **la même mesure** des deux côtés :
//!
//! - ici, la méthode du noyau : composer **une fois** en lignes, puis répartir
//!   les lignes ;
//! - là, la méthode du produit (`getFittingTextIndex` de `main.js`) : recherche
//!   binaire sur le **nombre de caractères**, avec une recomposition complète à
//!   chaque essai.
//!
//! Usage :
//!
//! ```text
//! flow_dump <entree.txt> <largeur> <hauteur> <nb-cadres> <cesure 0|1> <sortie.tsv>
//! flow_dump --bench <paragraphes> <mesureur>|<sortie>
//! ```
//!
//! `mesureur` compte les appels de mesure : c'est le coût réel des deux
//! méthodes, compté au même endroit — et c'est ce chiffre qui dit pourquoi une
//! chaîne de 124 blocs prend 128 secondes dans le produit.
//!
//! Sortie (TSV) : `cadre`, `ligne`, `reste`, `total`, `mesures`, `verifie`.

use std::env;
use std::fs;
use std::process::ExitCode;
use std::sync::atomic::{AtomicUsize, Ordering};

use superprint_flow::chaine::{Cadre, Chaine};
use superprint_flow::flux::Flux;
use superprint_flow::repartition::{repartir, Reglages};
use superprint_text::{Cesure, Motifs};

/// Le compteur de mesures, partagé par toutes les mesures d'une passe.
static MESURES: AtomicUsize = AtomicUsize::new(0);

/// Mesure **monospace** : une unité par caractère.
///
/// Volontairement la plus simple possible : le but du contrôle n'est pas la
/// justesse d'une police, c'est la **méthode** de répartition. Avec une mesure
/// aussi élémentaire, une divergence ne peut venir que de la méthode.
fn mesurer(texte: &str) -> f64 {
    MESURES.fetch_add(1, Ordering::Relaxed);
    // La mesure compte les **caractères**, pas les octets : la même règle est
    // écrite en JavaScript dans le script de contrôle.
    texte.chars().count() as f64
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        return usage();
    }

    if args[1] == "--bench" {
        return banc(&args);
    }

    if args.len() < 7 {
        return usage();
    }
    let Some(largeur) = args[2].trim().parse::<f64>().ok() else {
        return usage();
    };
    let Some(hauteur) = args[3].trim().parse::<f64>().ok() else {
        return usage();
    };
    let Some(nb_cadres) = args[4].trim().parse::<usize>().ok() else {
        return usage();
    };
    let avec_cesure = args[5].trim() != "0";
    let sortie = &args[6];

    let Ok(texte) = fs::read_to_string(&args[1]) else {
        eprintln!("entrée illisible : {}", args[1]);
        return ExitCode::from(2);
    };

    let flux = Flux::depuis_texte(&texte);
    let mut chaine = Chaine::nouveau();
    for id in 0..nb_cadres {
        chaine.ajouter(Cadre::nouveau(id, largeur, hauteur));
    }

    let hauteur_ligne = |_: usize| 10.0f64;
    let zero = |_: usize| 0.0f64;
    let cesure = if avec_cesure {
        /* Un jeu de motifs volontairement minimal : le contrôle porte sur la
        RÉPARTITION, pas sur la justesse des règles de césure (c'est le rôle
        de `validate-cesure.mjs`). Il suffit que la césure coupe. */
        Some(Cesure::dictionnaire(Motifs::depuis_pat(
            "n3t\nt3i\ns3t\n",
            2,
            3,
        )))
    } else {
        None
    };

    let mut reglages = Reglages::nouveau(&mesurer, &hauteur_ligne, &zero);
    if let Some(c) = cesure.as_ref() {
        reglages = reglages.avec_cesure(c);
    }

    MESURES.store(0, Ordering::Relaxed);
    let r = repartir(&flux, &chaine, &reglages);
    let mesures = MESURES.load(Ordering::Relaxed);

    let mut lignes: Vec<String> = Vec::new();
    for cadre in &r.cadres {
        lignes.push(format!(
            "cadre\t{}\t{}\t{:.3}\t{:.3}\t{}",
            cadre.cadre,
            cadre.lignes.len(),
            cadre.hauteur_occupee,
            cadre.hauteur_utile,
            u8::from(cadre.tronque)
        ));
        for l in &cadre.lignes {
            lignes.push(format!(
                "ligne\t{}\t{}\t{}\t{:.3}\t{}\t{}",
                cadre.cadre,
                l.paragraphe,
                l.rang,
                l.ligne.largeur,
                u8::from(l.ligne.tiret),
                l.ligne.texte
            ));
        }
    }
    lignes.push(format!("reste\t{}", r.reste.split_whitespace().count()));
    lignes.push(format!("total\t{}", r.lignes_composees));
    lignes.push(format!("mesures\t{mesures}"));
    lignes.push(format!(
        "verifie\t{}",
        match r.verifier(&flux, &chaine) {
            Ok(()) => "OK".to_string(),
            Err(e) => format!("ERREUR {e}"),
        }
    ));
    lignes.push(format!("complet\t{}", u8::from(r.complet)));

    if let Err(e) = fs::write(sortie, lignes.join("\n")) {
        eprintln!("écriture impossible : {e}");
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
}

/// Le banc : combien de mesures pour paginer un long texte.
///
/// C'est la mesure qui compte pour l'utilisateur : la méthode du produit
/// recompose le texte entier à chaque essai, la nôtre compose une fois.
fn banc(args: &[String]) -> ExitCode {
    let Some(paragraphes) = args.get(2).and_then(|a| a.trim().parse::<usize>().ok()) else {
        return usage();
    };
    let Some(sortie) = args.get(3) else {
        return usage();
    };

    /* Un texte de taille connue, avec des mots de longueurs variées : c'est ce
    qui fait travailler la césure et la mesure. */
    let mot = "anticonstitutionnellement extraordinairement";
    let mut flux = Flux::nouveau();
    for i in 0..paragraphes {
        let texte = format!("{} paragraphe {} {:?}", mot, i, "");
        flux.ajouter(superprint_flow::flux::Paragraphe::nouveau(texte));
    }

    let mut chaine = Chaine::nouveau();
    for id in 0..40 {
        chaine.ajouter(Cadre::nouveau(id, 400.0, 600.0));
    }

    let hauteur_ligne = |_: usize| 10.0f64;
    let zero = |_: usize| 0.0f64;
    let reglages = Reglages::nouveau(&mesurer, &hauteur_ligne, &zero);

    MESURES.store(0, Ordering::Relaxed);
    let debut = std::time::Instant::now();
    let r = repartir(&flux, &chaine, &reglages);
    let duree = debut.elapsed();
    let mesures = MESURES.load(Ordering::Relaxed);

    let rapport = format!(
        "paragraphes\t{}\nlignes\t{}\nmesures\t{}\nmillisecondes\t{}\ncomplet\t{}\nreste\t{}\n",
        paragraphes,
        r.lignes_composees,
        mesures,
        duree.as_millis(),
        u8::from(r.complet),
        r.reste.split_whitespace().count()
    );
    if let Err(e) = fs::write(sortie, &rapport) {
        eprintln!("écriture impossible : {e}");
        return ExitCode::from(1);
    }
    print!("{rapport}");
    ExitCode::SUCCESS
}

fn usage() -> ExitCode {
    eprintln!(
        "usage : flow_dump <entree.txt> <largeur> <hauteur> <nb-cadres> <cesure 0|1> <sortie.tsv>"
    );
    eprintln!("        flow_dump --bench <paragraphes> <sortie.txt>");
    ExitCode::from(2)
}
