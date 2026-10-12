//! Dump d'une **planche imposée assemblée**, pour relecture par `pdf-lib`.
//!
//! Cet exemple n'est pas une démonstration : c'est la moitié Rust d'une preuve.
//! `scripts/validate-montage.mjs` relit le PDF produit avec **pdf-lib**, le
//! lecteur du produit, et confronte ce qu'il y trouve à ce que le plan annonce :
//! boîtes de page, place de chaque image, rectangles de rognage, repères, espaces
//! couleur, clés PDF/X.
//!
//! Usage :
//!
//! ```text
//! montage_dump <specification.txt> <sortie.pdf> <rvb|cmjn|gris> <fond 0|1> <filtre> [profil.icc]
//! ```
//!
//! ## Le motif des rendus, et pourquoi il n'est pas uniforme
//!
//! Les deux pages sont synthétiques, et **volontairement différentes** :
//!
//! - la place de **gauche** porte un rendu dont la moitié haute est **rouge** et
//!   la moitié basse **verte** ;
//! - celle de **droite**, moitié haute **bleue** et moitié basse **jaune**.
//!
//! Un aplat uniforme suffirait à vérifier la place, pas le **sens**. Avec ces
//! deux moitiés, le contrôle lit les premiers octets de chaque image et vérifie
//! que la moitié haute est bien la première : c'est la seule façon de mesurer
//! qu'aucun retournement n'a été fait, et un flux d'image PDF se lit **de haut en
//! bas** — comme un canevas, comme un `ImageData`. Cette coïncidence est une
//! propriété, donc une chose à vérifier, pas à supposer.

use std::env;
use std::fs;
use std::process::ExitCode;

use superprint_montage::planche::{Options, Sortie};
use superprint_montage::{assembler, ModeCouleur, RendusPage, TOLERANCE_RAPPORT};
use superprint_pdf::image::ImageFilter;
use superprint_pdf::xmp::Conformite;

/// Un pixel par millimètre : assez pour voir, assez peu pour aller vite.
const PIXELS_PAR_MM: f64 = 1.0;

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    if args.len() < 6 {
        eprintln!(
            "usage : montage_dump <spec.txt> <sortie.pdf> <rvb|cmjn|gris> <fond 0|1> <filtre> \
             [profil.icc]"
        );
        return ExitCode::from(2);
    }

    let Ok(spec) = fs::read_to_string(&args[1]) else {
        eprintln!("specification illisible : {}", args[1]);
        return ExitCode::from(2);
    };
    let Some(plan) = superprint_impose::Plan::depuis_spec(&spec) else {
        eprintln!("specification refusee (ligne !page absente ou invalide)");
        return ExitCode::from(3);
    };

    let Some(mode) = mode_couleur(&args[3]) else {
        eprintln!("mode inconnu : {} (attendu rvb, cmjn ou gris)", args[3]);
        return ExitCode::from(2);
    };
    let fond_blanc = args[4].trim() == "1";
    let Some(filtre) = filtre(&args[5]) else {
        eprintln!(
            "filtre inconnu : {} (attendu aucun, longueurs, flate ou auto)",
            args[5]
        );
        return ExitCode::from(2);
    };

    let mut options = Options {
        mode,
        fond_blanc,
        filtre,
        ..Options::default()
    };
    options.producteur = "SuperPrint (noyau Rust)".to_string();
    options.info.title = Some("Planche imposee de controle".to_string());
    options.info.creation_date = Some("2026-10-12T09:00:00Z".to_string());

    // La sortie : un profil ICC réel si on en donne un, et la conformité qui va
    // avec le mode. C'est le cas « imprimerie » : CMJN, profil, PDF/X-1a.
    if let Some(chemin) = args.get(6).filter(|c| !c.trim().is_empty()) {
        let Ok(icc) = fs::read(chemin) else {
            eprintln!("profil illisible : {chemin}");
            return ExitCode::from(2);
        };
        let mut sortie = Sortie::nouvelle(icc, 4, "FOGRA39", "Coated FOGRA39 (ISO 12647-2:2004)");
        if mode == ModeCouleur::Cmjn {
            sortie = sortie.revendiquant(Conformite::PdfX1a2001);
        }
        options.sortie = sortie;
    }

    // Les deux rendus, au rapport exact des zones posées.
    let rendus: Vec<RendusPage> = [
        ((255, 0, 0), (0, 255, 0)),   // gauche : haut rouge, bas vert
        ((0, 0, 255), (255, 255, 0)), // droite : haut bleu, bas jaune
    ]
    .into_iter()
    .enumerate()
    .map(|(rang, (haut, bas))| {
        let place = &plan.places[rang];
        let largeur = (place.largeur_mm * PIXELS_PAR_MM).round().max(1.0) as u32;
        let hauteur = (place.hauteur_mm * PIXELS_PAR_MM).round().max(1.0) as u32;
        motif(largeur, hauteur, haut, bas)
    })
    .collect();

    let planche = match assembler(&plan, [&rendus[0], &rendus[1]], &options) {
        Ok(planche) => planche,
        Err(erreur) => {
            eprintln!("assemblage refuse : {erreur}");
            return ExitCode::from(4);
        }
    };

    if fs::write(&args[2], &planche.pdf).is_err() {
        eprintln!("ecriture impossible : {}", args[2]);
        return ExitCode::from(2);
    }

    // Un résumé lisible : le contrôle s'en sert pour recouper, l'œil pour voir.
    println!(
        "planche : format fini {:.3}x{:.3} mm, media {:.3}x{:.3} mm, {} reperes, {} octets",
        planche.format_fini_mm.0,
        planche.format_fini_mm.1,
        planche.media_mm.0,
        planche.media_mm.1,
        planche.reperes,
        planche.pdf.len()
    );
    for (rang, cote) in ["gauche", "droite"].iter().enumerate() {
        let zone = planche.zones_mm[rang];
        println!(
            "zone {cote} : {:.3} {:.3} {:.3} {:.3}",
            zone.0, zone.1, zone.2, zone.3
        );
    }
    println!("tolerance rapport : {TOLERANCE_RAPPORT}");
    ExitCode::SUCCESS
}

/// Un rendu 3 octets par pixel : moitié haute d'une couleur, moitié basse d'une
/// autre. La ligne du haut est écrite **en premier**.
fn motif(largeur: u32, hauteur: u32, haut: (u8, u8, u8), bas: (u8, u8, u8)) -> RendusPage {
    let mut pixels = Vec::with_capacity((largeur * hauteur * 3) as usize);
    for y in 0..hauteur {
        let (r, v, b) = if y * 2 < hauteur { haut } else { bas };
        for _ in 0..largeur {
            pixels.extend_from_slice(&[r, v, b]);
        }
    }
    RendusPage::nouveau(largeur, hauteur, pixels).expect("le tampon est construit pour être exact")
}

fn mode_couleur(nom: &str) -> Option<ModeCouleur> {
    match nom.trim().to_ascii_lowercase().as_str() {
        "rvb" => Some(ModeCouleur::Rvb),
        "cmjn" => Some(ModeCouleur::Cmjn),
        "gris" => Some(ModeCouleur::NiveauxDeGris),
        _ => None,
    }
}

fn filtre(nom: &str) -> Option<ImageFilter> {
    match nom.trim().to_ascii_lowercase().as_str() {
        "aucun" => Some(ImageFilter::None),
        "longueurs" => Some(ImageFilter::RunLengthDecode),
        "flate" => Some(ImageFilter::FlateDecode),
        "auto" => Some(ImageFilter::Auto),
        _ => None,
    }
}
