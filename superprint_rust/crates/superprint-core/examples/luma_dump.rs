//! Dump déterministe des luminances (Rec. 709) — pour la VÉRIFICATION CROISÉE
//! entre le noyau Rust et le module WebAssembly écrit à la main
//! (`superprint_asm/src/luma.wat`).
//!
//! Usage : `luma_dump [nombre-de-triplets]` (défaut : 5000)
//! Sortie : une ligne `r g b y` par triplet, produits par un LCG déterministe
//! (les mêmes entrées sont rejouées côté WAT et comparées ligne à ligne).
//!
//! Compilé pour `wasm32-wasip1`, il s'exécute via Node sans linker natif.

use superprint_core::Rgb;

fn main() {
    let count: usize = std::env::args()
        .nth(1)
        .and_then(|value| value.parse().ok())
        .unwrap_or(5000);

    // Générateur congruentiel linéaire (Numerical Recipes) : reproductible à
    // l'identique dans le script de vérification JavaScript.
    let mut state: u32 = 0x1234_5678;
    let mut next = || {
        state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        (state >> 24) as u8
    };

    for _ in 0..count {
        let r = next();
        let g = next();
        let b = next();
        println!("{r} {g} {b} {}", Rgb::new(r, g, b).luma());
    }
}
