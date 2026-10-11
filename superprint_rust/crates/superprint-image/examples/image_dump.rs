//! Dump de **traitement d'image**, pour comparaison avec un repli JavaScript.
//!
//! Cet exemple est la moitié Rust d'une preuve : `scripts/validate-image.mjs`
//! engendre les **mêmes** images d'entrée (en JavaScript, indépendamment), puis
//! compare octet par octet — ou à l'unité près là où l'ordre des opérations
//! flottantes peut différer d'un dernier bit.
//!
//! ⚠️ Les images d'entrée sont des **octets bruts** écrits par le script :
//! cet exemple ne sait pas les engendrer, et c'est voulu. Si les deux côtés
//! engendraient l'entrée, une divergence du générateur se lirait comme une
//! divergence du filtre.
//!
//! Usage — le dernier argument est toujours le fichier de sortie :
//!
//! ```text
//! image_dump niveaux    <entree> <noir> <blanc> <gamma>      <sortie>
//! image_dump courbe     <entree> <x1:y1,x2:y2,…>             <sortie>
//! image_dump flou       <entree> <sigma>                     <sortie>
//! image_dump net        <entree> <sigma> <force> <seuil>     <sortie>
//! image_dump mediane    <entree>                             <sortie>
//! image_dump flou-gris  <entree> <sigma>                     <sortie>
//! image_dump limiter    <entree> <limite>                    <sortie>
//! image_dump encrage    <entree> <taux-gcr> <limite>         <sortie>
//! image_dump composer   <fond> <dessus> <mode>               <sortie>
//! image_dump aplatir    <entree>                             <sortie>
//! image_dump recadrer   <entree> <x> <y> <largeur> <hauteur> <sortie>
//! ```
//!
//! Toutes les entrées font 256 × 256 pixels ; le nombre de canaux est celui du
//! type attendu par le mode (3 pour le RVB, 4 pour le CMJN et l'alpha, 1 pour le
//! gris).

use std::env;
use std::fs;
use std::process::ExitCode;

use superprint_image::alpha::{composer, AlphaImage, ModeFusion};
use superprint_image::encrage::{gcr_puis_limiter, limiter, CmjnImage};
use superprint_image::filtres::{flou_gaussien, flou_gaussien_gris, mediane_3x3, nettete};
use superprint_image::niveaux::{appliquer, Courbe, Niveaux, Reglages};
use superprint_image::{GrayImage, RgbImage};

const COTE: u32 = 256;

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    let Some(mode) = args.get(1) else {
        return usage();
    };
    if args.len() < 4 {
        return usage();
    }
    let sortie = &args[args.len() - 1];
    let entrees: Vec<&String> = args[2..args.len() - 1].iter().collect();

    let octets = match mode.as_str() {
        "niveaux" => {
            let Some(chemin) = entrees.first() else {
                return usage();
            };
            let (Some(noir), Some(blanc), Some(gamma)) = (
                entrees.get(1).and_then(|v| nombre(v)),
                entrees.get(2).and_then(|v| nombre(v)),
                entrees.get(3).and_then(|v| nombre(v)),
            ) else {
                eprintln!("niveaux : bornes ou gamma illisibles");
                return ExitCode::from(2);
            };
            let r = Reglages {
                global: Niveaux::nouveau(noir, blanc, gamma),
                ..Reglages::neutre()
            };
            match rgb(chemin) {
                Ok(src) => appliquer(&src, &r).data().to_vec(),
                Err(e) => return erreur(&e),
            }
        }
        "courbe" => {
            let (Some(chemin), Some(points)) = (entrees.first(), entrees.get(1)) else {
                return usage();
            };
            let mut liste = Vec::new();
            for morceau in points.split(',') {
                let mut champ = morceau.split(':');
                let (Some(x), Some(y)) =
                    (champ.next().and_then(nombre), champ.next().and_then(nombre))
                else {
                    eprintln!("courbe : point illisible dans {morceau:?}");
                    return ExitCode::from(2);
                };
                liste.push((x, y));
            }
            let r = Reglages {
                courbe: Courbe::nouvelle(&liste),
                ..Reglages::neutre()
            };
            match rgb(chemin) {
                Ok(src) => appliquer(&src, &r).data().to_vec(),
                Err(e) => return erreur(&e),
            }
        }
        "flou" | "flou-gris" => {
            let Some(chemin) = entrees.first() else {
                return usage();
            };
            let Some(sigma) = entrees.get(1).and_then(|v| nombre(v)) else {
                eprintln!("flou : sigma illisible");
                return ExitCode::from(2);
            };
            if mode == "flou" {
                match rgb(chemin) {
                    Ok(src) => flou_gaussien(&src, sigma).data().to_vec(),
                    Err(e) => return erreur(&e),
                }
            } else {
                match gris(chemin) {
                    Ok(src) => flou_gaussien_gris(&src, sigma).data().to_vec(),
                    Err(e) => return erreur(&e),
                }
            }
        }
        "net" => {
            let Some(chemin) = entrees.first() else {
                return usage();
            };
            let (Some(sigma), Some(force), Some(seuil)) = (
                entrees.get(1).and_then(|v| nombre(v)),
                entrees.get(2).and_then(|v| nombre(v)),
                entrees.get(3).and_then(|v| nombre(v)),
            ) else {
                eprintln!("net : paramètres illisibles");
                return ExitCode::from(2);
            };
            match rgb(chemin) {
                Ok(src) => nettete(&src, sigma, force, seuil.clamp(0.0, 255.0) as u8)
                    .data()
                    .to_vec(),
                Err(e) => return erreur(&e),
            }
        }
        "mediane" => {
            let Some(chemin) = entrees.first() else {
                return usage();
            };
            match rgb(chemin) {
                Ok(src) => mediane_3x3(&src).data().to_vec(),
                Err(e) => return erreur(&e),
            }
        }
        "limiter" => {
            let Some(chemin) = entrees.first() else {
                return usage();
            };
            let Some(limite) = entrees.get(1).and_then(|v| v.trim().parse::<u32>().ok()) else {
                eprintln!("limiter : limite illisible");
                return ExitCode::from(2);
            };
            match cmjn(chemin) {
                Ok(src) => limiter(&src, limite).data().to_vec(),
                Err(e) => return erreur(&e),
            }
        }
        "encrage" => {
            let Some(chemin) = entrees.first() else {
                return usage();
            };
            let (Some(taux), Some(limite)) = (
                entrees.get(1).and_then(|v| nombre(v)),
                entrees.get(2).and_then(|v| v.trim().parse::<u32>().ok()),
            ) else {
                eprintln!("encrage : taux ou limite illisibles");
                return ExitCode::from(2);
            };
            match cmjn(chemin) {
                Ok(src) => gcr_puis_limiter(&src, taux, limite).data().to_vec(),
                Err(e) => return erreur(&e),
            }
        }
        "composer" => {
            let (Some(fond), Some(dessus), Some(fusion)) =
                (entrees.first(), entrees.get(1), entrees.get(2))
            else {
                return usage();
            };
            let Some(fusion) = mode_depuis_texte(fusion) else {
                eprintln!("mode de fusion inconnu : {fusion}");
                return ExitCode::from(2);
            };
            let (Ok(fond), Ok(dessus)) = (alpha(fond), alpha(dessus)) else {
                eprintln!("images alpha illisibles");
                return ExitCode::from(2);
            };
            match composer(&fond, &dessus, fusion) {
                Ok(m) => m.data().to_vec(),
                Err(e) => return erreur(&e.to_string()),
            }
        }
        "aplatir" => {
            let Some(chemin) = entrees.first() else {
                return usage();
            };
            match alpha(chemin) {
                Ok(src) => src.aplatir_sur_blanc().data().to_vec(),
                Err(e) => return erreur(&e),
            }
        }
        "recadrer" | "recadrer-gris" => {
            let (Some(chemin), Some(x), Some(y), Some(l), Some(h)) = (
                entrees.first(),
                entrees.get(1),
                entrees.get(2),
                entrees.get(3),
                entrees.get(4),
            ) else {
                return usage();
            };
            let (Ok(x), Ok(y), Ok(l), Ok(h)) = (
                x.parse::<i64>(),
                y.parse::<i64>(),
                l.parse::<u32>(),
                h.parse::<u32>(),
            ) else {
                return usage();
            };
            if mode == "recadrer" {
                match rgb(chemin) {
                    Ok(src) => match src.recadrer(x, y, l, h) {
                        Ok(c) => c.data().to_vec(),
                        Err(e) => return erreur(&e.to_string()),
                    },
                    Err(e) => return erreur(&e),
                }
            } else {
                match gris(chemin) {
                    Ok(src) => match src.recadrer(x, y, l, h) {
                        Ok(c) => c.data().to_vec(),
                        Err(e) => return erreur(&e.to_string()),
                    },
                    Err(e) => return erreur(&e),
                }
            }
        }
        autre => {
            eprintln!("mode inconnu : {autre}");
            return ExitCode::from(2);
        }
    };

    if let Err(e) = fs::write(sortie, octets) {
        eprintln!("écriture impossible : {e}");
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
}

fn usage() -> ExitCode {
    eprintln!("usage : image_dump <mode> <entree...> <sortie>");
    ExitCode::from(2)
}

fn erreur(message: &str) -> ExitCode {
    eprintln!("{message}");
    ExitCode::from(2)
}

fn nombre(texte: &str) -> Option<f64> {
    texte.trim().parse::<f64>().ok().filter(|v| v.is_finite())
}

fn mode_depuis_texte(texte: &str) -> Option<ModeFusion> {
    Some(match texte {
        "normal" => ModeFusion::Normal,
        "multiplier" => ModeFusion::Multiplier,
        "ecran" => ModeFusion::Ecran,
        "obscurcir" => ModeFusion::Obscurcir,
        "eclaircir" => ModeFusion::Eclaircir,
        "superposer" => ModeFusion::Superposer,
        _ => return None,
    })
}

fn lire(chemin: &str) -> Result<Vec<u8>, String> {
    fs::read(chemin).map_err(|e| format!("{chemin} : {e}"))
}

fn rgb(chemin: &str) -> Result<RgbImage, String> {
    RgbImage::from_data(COTE, COTE, lire(chemin)?).map_err(|e| e.to_string())
}

fn gris(chemin: &str) -> Result<GrayImage, String> {
    GrayImage::from_data(COTE, COTE, lire(chemin)?).map_err(|e| e.to_string())
}

fn alpha(chemin: &str) -> Result<AlphaImage, String> {
    AlphaImage::from_data(COTE, COTE, lire(chemin)?).map_err(|e| e.to_string())
}

fn cmjn(chemin: &str) -> Result<CmjnImage, String> {
    CmjnImage::from_data(COTE, COTE, lire(chemin)?).map_err(|e| e.to_string())
}
