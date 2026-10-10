//! Démonstration exécutable : écrit sur disque un PDF d'une page portant
//! **deux tons directs** (Pantone Warm Red C et Pantone Violet C) sur une
//! quadri CMJN, au format 170×240 mm avec 3 mm de fond perdu et 10 mm de
//! traits de coupe.
//!
//! Usage : `spot_page <chemin-de-sortie>`
//!
//! Compilé pour `wasm32-wasip1`, il s'exécute sans linker natif — ce qui
//! permet de produire un PDF réel et de le valider, même sans Visual Studio.

use std::io::Write;

use superprint_core::{Cmyk, PageSize};
use superprint_pdf::{write_spot_page, AlternateSpace, ColorStack, QuadriSpace, SpotInk};

fn main() {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "spot-page.pdf".to_string());

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

    let stack =
        ColorStack::with_spots(QuadriSpace::Cmyk, [warm_red, violet]).expect("pas de doublon");

    let pdf = write_spot_page(PageSize::new(170.0, 240.0), 3.0, 10.0, &stack);

    let mut file = std::fs::File::create(&path).expect("création du fichier");
    file.write_all(&pdf).expect("écriture");
    println!("{} octets écrits dans {path}", pdf.len());
}
