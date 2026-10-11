//! Dump du **plan d'imposition**, pour comparaison avec le JavaScript.
//!
//! Cet exemple n'est pas une démonstration : c'est la moitié Rust d'une preuve.
//! `scripts/validate-imposition.mjs` extrait de `app/JS/main.js` — **sans le
//! modifier** — la fonction `calculateImposition`, les expressions qui
//! calculent la taille de la feuille, et les arguments de chaque `pdf.line()`
//! des traits de coupe. Il compare ensuite ligne à ligne.
//!
//! Usage :
//!
//! ```text
//! impose_dump ordre <nb-pages>              <fichier-sortie>
//! impose_dump plan  <fichier-specification> <fichier-sortie>
//! ```
//!
//! La sortie de `ordre` est un numéro de page par ligne, `Vide` pour une place
//! vide. Celle de `plan` est un tableau en TSV :
//!
//! ```text
//! feuille  <largeur>  <hauteur>
//! place    <rang>  <page>  <x>  <y>  <largeur>  <hauteur>  <fond perdu>  <trim x>  <trim y>  <trim droite>  <trim bas>
//! repere   <x1>  <y1>  <x2>  <y2>  <epaisseur>
//! ordre
//! <page>   (une ligne par place)
//! ```
//!
//! ⚠️ Le lecteur de spécification est celui du crate, `Specification::lire` :
//! **la même fonction** que celle qu'emploie la frontière C. Il n'y a donc rien
//! à comparer entre l'exemple et la frontière — ils ne peuvent pas diverger.

use std::env;
use std::fs;
use std::process::ExitCode;

use superprint_impose::{ordre, Plan, Specification};

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    if args.len() < 4 {
        eprintln!("usage : impose_dump <ordre|plan> <entree> <sortie>");
        return ExitCode::from(2);
    }

    let texte = match args[1].as_str() {
        "ordre" => {
            let Ok(nb_pages) = args[2].trim().parse::<u32>() else {
                eprintln!("nombre de pages invalide : {}", args[2]);
                return ExitCode::from(2);
            };
            ordre(nb_pages)
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<String>>()
                .join("\n")
        }
        "plan" => {
            let Ok(spec) = fs::read_to_string(&args[2]) else {
                eprintln!("specification illisible : {}", args[2]);
                return ExitCode::from(2);
            };
            match rendre(&spec) {
                Some(texte) => texte,
                None => {
                    eprintln!("specification refusee (ligne !page absente ou invalide)");
                    return ExitCode::from(3);
                }
            }
        }
        autre => {
            eprintln!("mode inconnu : {autre} (attendu « ordre » ou « plan »)");
            return ExitCode::from(2);
        }
    };

    if fs::write(&args[3], texte).is_err() {
        eprintln!("ecriture impossible : {}", args[3]);
        return ExitCode::from(2);
    }
    ExitCode::SUCCESS
}

/// Le plan, puis l'ordre des pages, en TSV.
fn rendre(specification: &str) -> Option<String> {
    let spec = Specification::lire(specification)?;
    let plan = Plan::nouveau(spec.gauche, spec.droite, spec.reglages);

    let mut sortie = format!(
        "feuille\t{:.4}\t{:.4}\n",
        plan.feuille_largeur_mm, plan.feuille_hauteur_mm
    );
    for (rang, place) in plan.places.iter().enumerate() {
        sortie.push_str(&format!(
            "place\t{rang}\t{}\t{:.4}\t{:.4}\t{:.4}\t{:.4}\t{:.4}\t{:.4}\t{:.4}\t{:.4}\t{:.4}\n",
            place.emplacement,
            place.x_mm,
            place.y_mm,
            place.largeur_mm,
            place.hauteur_mm,
            place.fond_perdu_mm,
            place.trim_x_mm(),
            place.trim_y_mm(),
            place.trim_droite_mm(),
            place.trim_bas_mm(),
        ));
    }
    for repere in &plan.reperes {
        sortie.push_str(&format!(
            "repere\t{:.4}\t{:.4}\t{:.4}\t{:.4}\t{:.4}\n",
            repere.x1, repere.y1, repere.x2, repere.y2, repere.epaisseur_mm
        ));
    }
    sortie.push_str("ordre\n");
    for place in ordre(spec.pages.unwrap_or(0)) {
        sortie.push_str(&format!("{place}\n"));
    }
    Some(sortie)
}
