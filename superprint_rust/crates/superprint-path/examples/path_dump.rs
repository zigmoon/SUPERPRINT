//! Dump de **géométrie vectorielle**, pour comparaison avec un repli JavaScript.
//!
//! Trois modes, qui correspondent aux trois moitiés qu'on veut prouver :
//!
//! ```text
//! path_dump aplatir <x0> <y0> <x1> <y1> <x2> <y2> <x3> <y3> <tolerance> <sortie>
//! path_dump booleen <entree.txt> <sortie.tsv>
//! path_dump epaissir <entree.txt> <sortie.tsv>
//! ```
//!
//! `aplatir` écrit les sommets de la polyligne qui remplace une cubique. Le
//! script de contrôle recalcule la courbe **de son côté** et vérifie qu'aucun
//! point ne s'écarte de la polyligne de plus que la tolérance demandée.
//!
//! `epaissir` convertit un **trait** en surface. La définition est celle de la
//! somme de Minkowski — l'ensemble des points à une distance inférieure ou égale
//! à une demi-épaisseur du tracé — et le script la recalcule par force brute,
//! point par point, sans rien savoir de l'algorithme. Le fichier d'entrée
//! s'écrit :
//!
//! ```text
//! souschemin ouvert 0 0 10 0 10 10
//! souschemin ferme 0 0 10 0 10 10 0 10
//! epaisseur 2
//! jonction rond
//! extremite rond
//! miterlimite 10
//! tolerance 0.05
//! ```
//!
//! `booleen` lit des formes et une opération, et écrit le **résultat** — ses
//! anneaux, pas un verdict. C'est le script qui décide : il applique la
//! définition ensembliste de l'opération aux deux formes d'entrée, et compare
//! avec l'appartenance calculée sur le résultat. Le fichier d'entrée s'écrit :
//!
//! ```text
//! anneau A 0 0 10 0 10 10 0 10
//! anneau B 5 0 15 0 15 10 5 10
//! regle A nonzero
//! regle B nonzero
//! op union
//! ```
//!
//! La sortie est un TSV :
//!
//! ```text
//! aireA\t100
//! aireB\t100
//! aire\t150
//! anneau\t8\t<x> <y> <x> <y> …
//! erreur\t<message>
//! ```

use std::env;
use std::fs;
use std::process::ExitCode;

use superprint_path::booleen::{operer, Operation};
use superprint_path::courbe::Courbe;
use superprint_path::plume::{epaissir, Extremite, Jonction, Plume};
use superprint_path::point::Point;
use superprint_path::polygone::{Contour, Polygone, Regle};

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    let Some(mode) = args.get(1) else {
        return usage();
    };
    match mode.as_str() {
        "aplatir" => aplatir(&args),
        "booleen" => booleen(&args),
        "epaissir" => epaissir_commande(&args),
        autre => {
            eprintln!("mode inconnu : {autre}");
            usage()
        }
    }
}

fn usage() -> ExitCode {
    eprintln!(
        "usage :\n  path_dump aplatir <x0> <y0> <x1> <y1> <x2> <y2> <x3> <y3> <tolerance> <sortie>\n  path_dump booleen <entree.txt> <sortie.tsv>\n  path_dump epaissir <entree.txt> <sortie.tsv>"
    );
    ExitCode::from(2)
}

fn nombre(texte: &str) -> Option<f64> {
    texte.parse::<f64>().ok().filter(|v| v.is_finite())
}

fn aplatir(args: &[String]) -> ExitCode {
    if args.len() != 12 {
        return usage();
    }
    let mut valeurs = Vec::with_capacity(9);
    for texte in &args[2..11] {
        let Some(v) = nombre(texte) else {
            eprintln!("nombre illisible : {texte}");
            return ExitCode::from(2);
        };
        valeurs.push(v);
    }
    let tolerance = valeurs[8];
    let courbe = Courbe::Cubique {
        depart: Point::new(valeurs[0], valeurs[1]),
        controle1: Point::new(valeurs[2], valeurs[3]),
        controle2: Point::new(valeurs[4], valeurs[5]),
        arrivee: Point::new(valeurs[6], valeurs[7]),
    };
    let mut points = vec![courbe.depart()];
    courbe.aplatir(tolerance, &mut points);
    let mut rapport = String::from("sommet\tx\ty\n");
    for p in &points {
        rapport.push_str(&format!("point\t{}\t{}\n", p.x, p.y));
    }
    rapport.push_str(&format!("nb\t{}\n", points.len()));
    ecrire(&args[11], &rapport)
}

/// Lit un trait et une plume, écrit la surface obtenue.
///
/// Le rapport porte les **anneaux**, pas un verdict : c'est le script de
/// contrôle qui décide, en appliquant la définition (la distance au tracé) par
/// force brute.
fn epaissir_commande(args: &[String]) -> ExitCode {
    if args.len() != 4 {
        return usage();
    }
    let Ok(texte) = fs::read_to_string(&args[2]) else {
        eprintln!("lecture impossible : {}", args[2]);
        return ExitCode::from(1);
    };
    let (sous_chemins, fermes, plume) = match lire_trait(&texte) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::from(2);
        }
    };
    let mut rapport = String::new();
    rapport.push_str(&format!("epaisseur\t{}\n", plume.epaisseur));
    rapport.push_str(&format!("sous_chemins\t{}\n", sous_chemins.len()));
    match epaissir(&sous_chemins, &fermes, &plume) {
        Ok(surface) => {
            rapport.push_str(&format!("aire\t{}\n", surface.aire()));
            rapport.push_str(&format!("anneaux\t{}\n", surface.anneaux.len()));
            for anneau in &surface.anneaux {
                rapport.push_str(&format!("anneau\t{}\t", anneau.points.len()));
                for (i, p) in anneau.points.iter().enumerate() {
                    if i > 0 {
                        rapport.push(' ');
                    }
                    rapport.push_str(&format!("{} {}", p.x, p.y));
                }
                rapport.push('\n');
            }
        }
        Err(e) => rapport.push_str(&format!("erreur\t{e}\n")),
    }
    ecrire(&args[3], &rapport)
}

/// Un trait : ses sous-chemins, leur fermeture, et sa plume.
type Trait = (Vec<Vec<Point>>, Vec<bool>, Plume);

/// Lit la description d'un trait : ses sous-chemins et sa plume.
fn lire_trait(texte: &str) -> Result<Trait, String> {
    let mut sous_chemins: Vec<Vec<Point>> = Vec::new();
    let mut fermes: Vec<bool> = Vec::new();
    let mut plume = Plume::nouvelle(1.0);
    for (numero, brute) in texte.lines().enumerate() {
        let ligne = brute.trim();
        if ligne.is_empty() || ligne.starts_with('#') {
            continue;
        }
        let mots: Vec<&str> = ligne.split_whitespace().collect();
        let illisible = |quoi: &str| format!("ligne {} : {quoi}", numero + 1);
        match mots[0] {
            "souschemin" => {
                let Some(genre) = mots.get(1) else {
                    return Err(illisible("« souschemin » attend « ouvert » ou « ferme »"));
                };
                let ferme = match *genre {
                    "ouvert" => false,
                    "ferme" => true,
                    autre => return Err(illisible(&format!("genre « {autre} » inconnu"))),
                };
                let mut points = Vec::new();
                for paire in mots[2..].chunks(2) {
                    if paire.len() != 2 {
                        return Err(illisible("un sommet s'écrit avec deux nombres"));
                    }
                    let (Some(x), Some(y)) = (nombre(paire[0]), nombre(paire[1])) else {
                        return Err(illisible("coordonnée illisible"));
                    };
                    points.push(Point::new(x, y));
                }
                sous_chemins.push(points);
                fermes.push(ferme);
            }
            "epaisseur" => {
                plume.epaisseur = nombre(mots.get(1).copied().unwrap_or(""))
                    .ok_or_else(|| illisible("« epaisseur » attend un nombre"))?;
            }
            "miterlimite" => {
                let texte = mots.get(1).copied().unwrap_or("");
                plume.limite_miter = if texte == "infini" {
                    f64::INFINITY
                } else {
                    nombre(texte).ok_or_else(|| {
                        illisible("« miterlimite » attend un nombre ou « infini »")
                    })?
                };
            }
            "tolerance" => {
                plume.tolerance = nombre(mots.get(1).copied().unwrap_or(""))
                    .ok_or_else(|| illisible("« tolerance » attend un nombre"))?;
            }
            "jonction" => {
                plume.jonction = match mots.get(1).copied().unwrap_or("") {
                    "onglet" => Jonction::Miter,
                    "biseau" => Jonction::Biseau,
                    "rond" => Jonction::Rond,
                    autre => return Err(illisible(&format!("jonction « {autre} » inconnue"))),
                };
            }
            "extremite" => {
                plume.extremite = match mots.get(1).copied().unwrap_or("") {
                    "bout" => Extremite::Bout,
                    "carre" => Extremite::Carre,
                    "rond" => Extremite::Rond,
                    autre => return Err(illisible(&format!("extrémité « {autre} » inconnue"))),
                };
            }
            autre => return Err(illisible(&format!("mot-clé « {autre} » inconnu"))),
        }
    }
    if sous_chemins.is_empty() {
        return Err("aucun sous-chemin".to_string());
    }
    Ok((sous_chemins, fermes, plume))
}

fn booleen(args: &[String]) -> ExitCode {
    if args.len() != 4 {
        return usage();
    }
    let Ok(texte) = fs::read_to_string(&args[2]) else {
        eprintln!("lecture impossible : {}", args[2]);
        return ExitCode::from(1);
    };
    let (gauche, droite, operation) = match lire_formes(&texte) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::from(2);
        }
    };
    let mut rapport = String::new();
    rapport.push_str(&format!("aireA\t{}\n", gauche.aire()));
    rapport.push_str(&format!("aireB\t{}\n", droite.aire()));
    match operer(&gauche, &droite, operation) {
        Ok(resultat) => {
            rapport.push_str(&format!("aire\t{}\n", resultat.aire()));
            rapport.push_str(&format!("anneaux\t{}\n", resultat.anneaux.len()));
            for anneau in &resultat.anneaux {
                rapport.push_str(&format!("anneau\t{}\t", anneau.points.len()));
                for (i, p) in anneau.points.iter().enumerate() {
                    if i > 0 {
                        rapport.push(' ');
                    }
                    rapport.push_str(&format!("{} {}", p.x, p.y));
                }
                rapport.push('\n');
            }
        }
        Err(e) => rapport.push_str(&format!("erreur\t{e}\n")),
    }
    ecrire(&args[3], &rapport)
}

fn ecrire(chemin: &str, rapport: &str) -> ExitCode {
    if let Err(e) = fs::write(chemin, rapport) {
        eprintln!("écriture impossible : {e}");
        return ExitCode::from(1);
    }
    print!("{rapport}");
    ExitCode::SUCCESS
}

/// Lit le fichier d'entrée : des anneaux, deux règles, une opération.
fn lire_formes(texte: &str) -> Result<(Contour, Contour, Operation), String> {
    // Un éditeur de texte peut laisser un marqueur d'ordre des octets en tête de
    // fichier ; il ne doit pas se lire comme un mot-clé.
    let texte = texte.strip_prefix('\u{feff}').unwrap_or(texte);
    let mut anneaux_a: Vec<Polygone> = Vec::new();
    let mut anneaux_b: Vec<Polygone> = Vec::new();
    let mut regle_a = Regle::NonZero;
    let mut regle_b = Regle::NonZero;
    let mut operation: Option<Operation> = None;

    for (numero, ligne) in texte.lines().enumerate() {
        let ligne = ligne.trim();
        if ligne.is_empty() || ligne.starts_with('#') {
            continue;
        }
        let champs: Vec<&str> = ligne.split_whitespace().collect();
        match champs[0] {
            "anneau" => {
                // « anneau » + forme + un nombre PAIR de coordonnées.
                if champs.len() < 4 || champs.len() % 2 != 0 {
                    return Err(format!("ligne {} : anneau illisible", numero + 1));
                }
                let cible = match champs[1] {
                    "A" => &mut anneaux_a,
                    "B" => &mut anneaux_b,
                    autre => return Err(format!("ligne {} : forme « {autre} »", numero + 1)),
                };
                let mut points = Vec::new();
                for paire in champs[2..].chunks(2) {
                    let (Some(x), Some(y)) =
                        (nombre(paire[0]), nombre(paire.get(1).unwrap_or(&"")))
                    else {
                        return Err(format!("ligne {} : nombre illisible", numero + 1));
                    };
                    points.push(Point::new(x, y));
                }
                cible.push(Polygone::nouveau(points));
            }
            "regle" => {
                if champs.len() != 3 {
                    return Err(format!("ligne {} : règle illisible", numero + 1));
                }
                let regle = match champs[2] {
                    "nonzero" => Regle::NonZero,
                    "pairimpair" => Regle::PairImpair,
                    autre => return Err(format!("ligne {} : règle « {autre} »", numero + 1)),
                };
                match champs[1] {
                    "A" => regle_a = regle,
                    "B" => regle_b = regle,
                    autre => return Err(format!("ligne {} : forme « {autre} »", numero + 1)),
                }
            }
            "op" => {
                if champs.len() != 2 {
                    return Err(format!("ligne {} : opération illisible", numero + 1));
                }
                operation = Some(match champs[1] {
                    "union" => Operation::Union,
                    "intersection" => Operation::Intersection,
                    "difference" => Operation::Difference,
                    "exclusion" => Operation::Exclusion,
                    autre => return Err(format!("ligne {} : opération « {autre} »", numero + 1)),
                });
            }
            autre => return Err(format!("ligne {} : mot-clé « {autre} »", numero + 1)),
        }
    }
    let Some(operation) = operation else {
        return Err("aucune opération : la ligne `op` manque".to_string());
    };
    Ok((
        Contour::avec_regle(anneaux_a, regle_a),
        Contour::avec_regle(anneaux_b, regle_b),
        operation,
    ))
}
