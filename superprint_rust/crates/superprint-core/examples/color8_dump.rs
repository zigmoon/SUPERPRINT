//! Dump déterministe des conversions CMJN ↔ RVB — pour la VÉRIFICATION CROISÉE
//! entre le noyau Rust (`superprint_core::color8`) et le module WebAssembly
//! écrit à la main (`superprint_asm/src/color8.wat`).
//!
//! Usage : `color8_dump [nombre-de-pixels]` (défaut : 5000)
//! Sortie : une ligne `r g b c m y k r2 g2 b2` par pixel (aller-retour inclus),
//! produite par un LCG déterministe rejoué à l'identique côté WAT.
//!
//! Compilé pour `wasm32-wasip1`, il s'exécute via Node sans linker natif.

use superprint_core::color8::{cmyk_to_rgb_px, rgb_to_cmyk_px};

fn main() {
    let count: usize = std::env::args()
        .nth(1)
        .and_then(|value| value.parse().ok())
        .unwrap_or(5000);

    // Même LCG que `luma_dump` (Numerical Recipes) : reproductible côté JS.
    let mut state: u32 = 0x1234_5678;
    let mut next = || {
        state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        (state >> 24) as u8
    };

    for _ in 0..count {
        let (r, g, b) = (next(), next(), next());
        let (c, m, y, k) = rgb_to_cmyk_px(r, g, b);
        let (r2, g2, b2) = cmyk_to_rgb_px(c, m, y, k);
        println!("{r} {g} {b} {c} {m} {y} {k} {r2} {g2} {b2}");
    }
}
