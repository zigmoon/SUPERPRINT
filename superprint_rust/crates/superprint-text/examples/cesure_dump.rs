//! Dump des décisions de césure, pour comparaison avec le JavaScript.
//!
//! Cet exemple n'est **pas** une démonstration : c'est la moitié Rust d'une
//! preuve. `scripts/validate-cesure.mjs` calcule les mêmes valeurs avec le
//! **vrai** `hypher.js` et les **vraies** règles de `app/JS/main.js`, puis
//! compare ligne à ligne. Tant que les deux colonnes sont identiques, le
//! portage est mesuré — pas supposé.
//!
//! Usage :
//! `cesure_dump <fichier-mots> <fichier-motifs> <fichier-sortie>`
//!
//! Le fichier de motifs est un format texte minimal, écrit par le script :
//!
//! ```text
//! 2<TAB>3                      bornes gauche et droite
//! 3<TAB>1ç1j1q                  longueur, puis les motifs qui se suivent
//! 4<TAB>1f2lab2h2c
//! !exceptions<TAB>as·so·ci·a·tion, ta·ble
//! ```
//!
//! Sortie, une ligne par mot, champs séparés par des tabulations :
//!
//! ```text
//! mot  coupes  frontieres  syllabes  groupes  filtre  tirets
//! ```

use std::env;
use std::fs;
use std::process::ExitCode;

use superprint_text::{francais, Cesure, Motifs};

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    if args.len() < 4 {
        eprintln!("usage : cesure_dump <fichier-mots> <fichier-motifs> <fichier-sortie>");
        return ExitCode::from(2);
    }

    let Ok(mots) = fs::read_to_string(&args[1]) else {
        eprintln!("fichier de mots illisible : {}", args[1]);
        return ExitCode::from(2);
    };
    let Ok(description) = fs::read_to_string(&args[2]) else {
        eprintln!("fichier de motifs illisible : {}", args[2]);
        return ExitCode::from(2);
    };

    let (left, right, groupes, exceptions) = lire_motifs(&description);
    // `depuis_compacte` veut des paires (longueur, texte) ; on les lui donne
    // par référence, sans recopier les motifs — ils pèsent leur poids.
    let references: Vec<(usize, &str)> = groupes
        .iter()
        .map(|(taille, texte)| (*taille, texte.as_str()))
        .collect();
    let mut motifs = Motifs::depuis_compacte(left, right, &references);
    if let Some(liste) = &exceptions {
        motifs = motifs.avec_exceptions(liste);
    }
    let cesure = Cesure::dictionnaire(motifs);

    let mut sortie = String::new();
    let mut nombre = 0usize;
    for mot in mots.lines() {
        let mot = mot.trim();
        if mot.is_empty() {
            continue;
        }
        sortie.push_str(&ligne(mot, &cesure));
        sortie.push('\n');
        nombre += 1;
    }

    if let Err(erreur) = fs::write(&args[3], &sortie) {
        eprintln!("écriture impossible : {erreur}");
        return ExitCode::from(2);
    }
    eprintln!("{nombre} mot(s) analysé(s)");
    ExitCode::SUCCESS
}

/// Lit le format texte minimal décrit en tête de fichier.
#[allow(clippy::type_complexity)]
fn lire_motifs(description: &str) -> (usize, usize, Vec<(usize, String)>, Option<String>) {
    let mut left = 2usize;
    let mut right = 3usize;
    let mut groupes: Vec<(usize, String)> = Vec::new();
    let mut exceptions: Option<String> = None;
    let mut bornes_lues = false;

    for ligne in description.lines() {
        let ligne = ligne.trim_end();
        if ligne.is_empty() {
            continue;
        }
        if let Some(reste) = ligne.strip_prefix("!exceptions\t") {
            exceptions = Some(reste.to_string());
            continue;
        }
        let mut champs = ligne.splitn(2, '\t');
        let Some(premier) = champs.next() else {
            continue;
        };
        let Some(second) = champs.next() else {
            continue;
        };
        let Ok(valeur) = premier.trim().parse::<usize>() else {
            continue;
        };
        if !bornes_lues {
            // La première ligne porte les deux bornes, séparées par l'autre
            // tabulation de la même ligne.
            if let Ok(droite) = second.trim().parse::<usize>() {
                left = valeur;
                right = droite;
                bornes_lues = true;
                continue;
            }
        }
        groupes.push((valeur, second.to_string()));
    }
    (left, right, groupes, exceptions)
}

/// Une ligne de sortie pour un mot.
fn ligne(mot: &str, cesure: &Cesure) -> String {
    let caracteres: Vec<char> = mot.chars().collect();

    let coupes: Vec<String> = cesure.coupes(mot).iter().map(usize::to_string).collect();

    // Un caractère par frontière : la comparaison position par position est
    // bien plus parlante qu'un simple « ça diffère ».
    let frontieres: String = (0..=caracteres.len())
        .map(|i| {
            if francais::frontiere_valide(&caracteres, i) {
                '1'
            } else {
                '0'
            }
        })
        .collect();

    let syllabes = joindre(francais::syllabes(mot));

    // Les positions où un groupe de consonnes commence : celles que la
    // syllabation interroge réellement. On applique **les mêmes conditions**
    // que `syllabes` — voyelle avant, lettre qui n'est pas une voyelle après —
    // sinon on interroge la fonction sur des cas qu'elle ne traite pas.
    let mut groupes: Vec<String> = Vec::new();
    for i in 1..caracteres.len() {
        if !francais::est_voyelle(caracteres[i - 1]) {
            continue;
        }
        if !francais::est_lettre(caracteres[i]) || francais::est_voyelle(caracteres[i]) {
            continue;
        }
        let position = match francais::coupe_du_groupe(&caracteres, i) {
            Some(p) => p.to_string(),
            None => "-".to_string(),
        };
        groupes.push(format!("{i}:{position}"));
    }

    let brut = cesure.motifs().map(|m| m.fragments(mot));
    let filtre = brut.as_ref().and_then(|f| francais::filtrer(mot, f));
    let filtre_texte = joindre(filtre.clone());
    let tirets = joindre(francais::ajouter_tirets(mot, filtre.as_deref()));

    [
        mot.to_string(),
        coupes.join(","),
        frontieres,
        syllabes,
        groupes.join(","),
        filtre_texte,
        tirets,
    ]
    .join("\t")
}

/// Rend un découpage sous forme comparable : `-` s'il n'y en a pas.
fn joindre(morceaux: Option<Vec<String>>) -> String {
    match morceaux {
        Some(liste) if liste.len() > 1 => liste.join("|"),
        _ => "-".to_string(),
    }
}
