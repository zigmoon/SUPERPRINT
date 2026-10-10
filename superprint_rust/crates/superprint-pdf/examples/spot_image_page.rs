//! Démonstration exécutable : le **défaut « PDF de 131 Mo »**, chiffré.
//!
//! L'exemple construit une image de synthèse à la résolution d'un appareil
//! photo, puis la fait passer par la chaîne complète de `superprint-image` +
//! `superprint-pdf` :
//!
//! 1. **réduction** de la résolution source vers la résolution cible (l'image
//!    n'a aucune raison de voyager à une définition que l'imprimeur ne peut pas
//!    rendre) ;
//! 2. **compression** RunLength, appliquée seulement si elle fait gagner ;
//! 3. **embarquement** en objet image PDF, plus les bandes de contrôle des
//!    tons directs.
//!
//! À chaque étape, la taille est affichée : c'est la mesure qui compte, pas une
//! promesse. Deux jeux de données sont comparés — un **aplat** (logo, pack) et du
//! **bruit** (photo) — parce que RunLength sauve l'un et pas l'autre.
//!
//! Usage : `spot_image_page <chemin-de-sortie> [dpi-source] [dpi-cible]`
//!
//! ## Pourquoi 300 → 150 DPI par défaut ?
//!
//! Ce n'est **pas** une limite de la bibliothèque, mais du **harnais
//! d'exécution**. Sur cette machine, `cargo test` ne peut pas se lier (Visual
//! Studio absent) : les exemples tournent sous **Node/WASI**, dont le tas
//! plafonne autour de 32 Mo — un 600 DPI (65 Mo de pixels bruts) dépasse ce
//! plafond et fait tomber le processus Node. Dans un navigateur, la mémoire
//! WebAssembly monte à 4 Go et 600 → 300 DPI passe sans difficulté.
//!
//! Le **ratio** démontré est le même à toutes les échelles ; seuls les chiffres
//! absolus changent.

use std::io::Write;

use superprint_core::{Cmyk, PageSize};
use superprint_image::{downscale_bilinear, target_size_for_dpi, RgbImage};
use superprint_pdf::{
    write_spot_page_with_image, AlternateSpace, ColorStack, ImageFilter, ImageXObject, QuadriSpace,
    SpotInk,
};

/// Format final du document (en millimètres).
const TRIM_MM: (f64, f64) = (170.0, 240.0);

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args
        .next()
        .unwrap_or_else(|| "spot-image-page.pdf".to_string());
    let source_dpi = parse_dpi(args.next(), 300.0);
    let target_dpi = parse_dpi(args.next(), 150.0);

    println!("SuperPrint — chaîne image → PDF (module n° 4)");
    println!("  format     : {} x {} mm", TRIM_MM.0, TRIM_MM.1);
    println!("  résolution : source {source_dpi} DPI → cible {target_dpi} DPI\n");

    let (width, height) = size_at_dpi(TRIM_MM, source_dpi);
    let source = artwork(width, height);
    let raw = source.data().len();
    println!(
        "1. Image source           {width} x {height} px   RVB brut   {}",
        human(raw)
    );

    let (new_width, new_height) = target_size_for_dpi(width, height, source_dpi, target_dpi);
    let reduced = downscale_bilinear(&source, new_width, new_height);
    let reduced_len = reduced.data().len();
    println!(
        "2. Réduction {target_dpi} DPI        {new_width} x {new_height} px   RVB brut   {}   (÷{:.1})",
        human(reduced_len),
        raw as f64 / reduced_len as f64
    );

    // Ce que l'application écrivait : les pixels nus, sans filtre.
    let uncompressed = ImageXObject::from_rgb(&reduced, ImageFilter::None);
    let compressed = ImageXObject::from_rgb(&reduced, ImageFilter::Auto);
    println!(
        "3. Compression            filtre {}, flux {} → {}",
        compressed.filter(),
        human(uncompressed.encoded_len()),
        human(compressed.encoded_len())
    );
    println!(
        "   à écrire dans le PDF  : {}   (au lieu de {}, soit ÷{:.0})\n",
        human(compressed.encoded_len()),
        human(raw),
        raw as f64 / compressed.encoded_len() as f64
    );

    let stack = color_stack();
    let pdf = write_spot_page_with_image(
        PageSize::new(TRIM_MM.0, TRIM_MM.1),
        3.0,
        10.0,
        &stack,
        &compressed,
    );

    let mut file = std::fs::File::create(&path).expect("création du fichier");
    file.write_all(&pdf).expect("écriture");
    println!("4. PDF écrit              {} dans {path}", human(pdf.len()));

    // Contre-épreuve honnête : sur une photo, RunLength ne gagne rien.
    let photo = noise_image(new_width, new_height);
    let photo_auto = ImageXObject::from_rgb(&photo, ImageFilter::Auto);
    println!(
        "\n   Contre-épreuve — photo (bruit) : filtre {}, flux égal aux pixels bruts.",
        photo_auto.filter()
    );
    println!("   RunLength ne sert à rien sur une photo : seul le point 2 fait gagner.");
}

/// Convertit une taille en millimètres et une résolution en nombre de pixels.
///
/// Un seul arrondi, à la fin : calculer en flottant puis convertir évite
/// d'accumuler les erreurs d'arrondi intermédiaires.
fn size_at_dpi(mm: (f64, f64), dpi: f64) -> (u32, u32) {
    let px = |millimetres: f64| (millimetres * dpi / 25.4).round().max(1.0) as u32;
    (px(mm.0), px(mm.1))
}

fn parse_dpi(value: Option<String>, default: f64) -> f64 {
    value
        .and_then(|text| text.parse::<f64>().ok())
        .filter(|dpi| *dpi > 0.0)
        .unwrap_or(default)
}

/// Taille lisible : octets, ko ou Mo.
fn human(bytes: usize) -> String {
    let bytes = bytes as f64;
    if bytes >= 1024.0 * 1024.0 {
        format!("{:.1} Mo", bytes / (1024.0 * 1024.0))
    } else if bytes >= 1024.0 {
        format!("{:.1} ko", bytes / 1024.0)
    } else {
        format!("{bytes:.0} octets")
    }
}

/// Un rectangle plein, exprimé en fractions de la largeur et de la hauteur
/// (`x0, y0, x1, y1`) et sa couleur RVB.
struct Shape {
    rect: (f64, f64, f64, f64),
    color: [u8; 3],
}

/// Une image de synthèse **à aplats** : fond blanc et cinq rectangles pleins.
///
/// C'est le profil d'un logo ou d'un habillage de pack — le cas où RunLength
/// écrase le poids. Une photo ne se comporte pas ainsi (voir la contre-épreuve).
fn artwork(width: u32, height: u32) -> RgbImage {
    let mut data = vec![255u8; RgbImage::expected_len(width, height)];
    let shapes = [
        Shape {
            rect: (0.06, 0.05, 0.94, 0.10),
            color: [16, 24, 32],
        },
        Shape {
            rect: (0.06, 0.16, 0.46, 0.44),
            color: [12, 62, 148],
        },
        Shape {
            rect: (0.54, 0.16, 0.94, 0.44),
            color: [232, 78, 27],
        },
        Shape {
            rect: (0.06, 0.52, 0.94, 0.72),
            color: [0, 128, 96],
        },
        Shape {
            rect: (0.06, 0.80, 0.60, 0.94),
            color: [92, 46, 126],
        },
    ];

    for shape in shapes {
        let (x0, y0) = (shape.rect.0, shape.rect.1);
        let (x1, y1) = (shape.rect.2, shape.rect.3);
        let x0 = (x0 * f64::from(width)).round() as u32;
        let x1 = (x1 * f64::from(width)).round() as u32;
        let y0 = (y0 * f64::from(height)).round() as u32;
        let y1 = (y1 * f64::from(height)).round() as u32;
        for y in y0..y1.min(height) {
            for x in x0..x1.min(width) {
                let i = (y as usize * width as usize + x as usize) * RgbImage::CHANNELS;
                data[i..i + 3].copy_from_slice(&shape.color);
            }
        }
    }

    RgbImage::from_data(width, height, data).expect("dimensions cohérentes")
}

/// Du bruit reproductible : le profil d'une photographie, incompressible.
fn noise_image(width: u32, height: u32) -> RgbImage {
    let mut seed = 0x1234_5678u32;
    let mut data = Vec::with_capacity(RgbImage::expected_len(width, height));
    for _ in 0..RgbImage::expected_len(width, height) {
        seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        data.push((seed >> 24) as u8);
    }
    RgbImage::from_data(width, height, data).expect("dimensions cohérentes")
}

/// Une quadri CMJN et deux encres directes.
fn color_stack() -> ColorStack {
    let warm_red = SpotInk::new(
        "PANTONE WARM RED C",
        AlternateSpace::Cmyk(Cmyk {
            c: 0.0,
            m: 0.9,
            y: 0.8,
            k: 0.0,
        }),
    )
    .expect("encre valide");

    let violet = SpotInk::new(
        "PANTONE VIOLET C",
        AlternateSpace::Cmyk(Cmyk {
            c: 0.7,
            m: 1.0,
            y: 0.0,
            k: 0.1,
        }),
    )
    .expect("encre valide");

    ColorStack::with_spots(QuadriSpace::Cmyk, [warm_red, violet]).expect("pas de doublon")
}
