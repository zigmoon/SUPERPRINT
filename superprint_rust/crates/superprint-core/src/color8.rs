//! Conversions **CMJN ↔ RVB sur octets** (arithmétique entière).
//!
//! Ces noyaux travaillent sur des tampons d'octets — exactement la forme sous
//! laquelle une image est manipulée (RVB = 3 octets par pixel, CMJN = 4). Ils
//! sont volontairement **entiers** : le résultat est reproductible au bit près,
//! sans dépendre de la virgule flottante, et **identique** au module écrit à la
//! main en assembleur WebAssembly (`superprint_asm/src/color8.wat`).
//!
//! Les conversions sont **naïves** (formule algébrique, sans profil ICC) : c'est
//! la même famille que [`crate::color`], mais sur octets.
//!
//! Modèle (composantes 0–255, `max = max(r, g, b)`) :
//!
//! ```text
//! RVB → CMJN :  k = 255 - max
//!               c = ((max - r)·255 + max/2) / max   (et de même pour m, y)
//! CMJN → RVB :  r = ((255 - c)·(255 - k) + 127) / 255
//! ```
//! Les deux sens **arrondissent** : sans cela, la troncature à l'aller ferait
//! dériver l'aller-retour d'un cran sur près d'un pixel sur deux.

/// Convertit un triplet RVB en quadruplet CMJN, en octets 0–255.
#[must_use]
pub fn rgb_to_cmyk_px(r: u8, g: u8, b: u8) -> (u8, u8, u8, u8) {
    let max = r.max(g).max(b);
    if max == 0 {
        return (0, 0, 0, 255);
    }
    let max = u32::from(max);
    let half = max / 2;
    let component = |value: u8| (((max - u32::from(value)) * 255 + half) / max) as u8;
    (component(r), component(g), component(b), (255 - max) as u8)
}

/// Convertit un quadruplet CMJN en triplet RVB, en octets 0–255.
#[must_use]
pub fn cmyk_to_rgb_px(c: u8, m: u8, y: u8, k: u8) -> (u8, u8, u8) {
    let kc = u32::from(255 - k);
    let component = |value: u8| (((255 - u32::from(value)) * kc + 127) / 255) as u8;
    (component(c), component(m), component(y))
}

/// Convertit un tampon RVB (`3·n` octets) en CMJN (`4·n` octets).
///
/// # Panics
///
/// Panique si `src` fait moins de `3·n` octets ou `dst` moins de `4·n`.
pub fn rgb_to_cmyk(src: &[u8], dst: &mut [u8], n: usize) {
    assert!(src.len() >= n * 3, "source RVB trop courte");
    assert!(dst.len() >= n * 4, "destination CMJN trop courte");
    for i in 0..n {
        let (c, m, y, k) = rgb_to_cmyk_px(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
        let d = i * 4;
        dst[d] = c;
        dst[d + 1] = m;
        dst[d + 2] = y;
        dst[d + 3] = k;
    }
}

/// Convertit un tampon CMJN (`4·n` octets) en RVB (`3·n` octets).
///
/// # Panics
///
/// Panique si `src` fait moins de `4·n` octets ou `dst` moins de `3·n`.
pub fn cmyk_to_rgb(src: &[u8], dst: &mut [u8], n: usize) {
    assert!(src.len() >= n * 4, "source CMJN trop courte");
    assert!(dst.len() >= n * 3, "destination RVB trop courte");
    for i in 0..n {
        let s = i * 4;
        let (r, g, b) = cmyk_to_rgb_px(src[s], src[s + 1], src[s + 2], src[s + 3]);
        let d = i * 3;
        dst[d] = r;
        dst[d + 1] = g;
        dst[d + 2] = b;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn primaires() {
        // Rouge pur → C=0, M=255, Y=255, K=0.
        assert_eq!(rgb_to_cmyk_px(255, 0, 0), (0, 255, 255, 0));
        // Blanc → aucun encrage.
        assert_eq!(rgb_to_cmyk_px(255, 255, 255), (0, 0, 0, 0));
        // Noir → K plein.
        assert_eq!(rgb_to_cmyk_px(0, 0, 0), (0, 0, 0, 255));
    }

    #[test]
    fn retour_cmyk_rgb() {
        assert_eq!(cmyk_to_rgb_px(0, 255, 255, 0), (255, 0, 0));
        assert_eq!(cmyk_to_rgb_px(0, 0, 0, 0), (255, 255, 255));
        assert_eq!(cmyk_to_rgb_px(0, 0, 0, 255), (0, 0, 0));
    }

    #[test]
    fn aller_retour_proche_de_l_identite() {
        // Vérifie sur un jeu varié que RVB → CMJN → RVB revient à la même couleur.
        let samples = [
            (128, 64, 32),
            (10, 200, 255),
            (247, 243, 236),
            (1, 1, 1),
            (254, 0, 128),
        ];
        for (r, g, b) in samples {
            let (c, m, y, k) = rgb_to_cmyk_px(r, g, b);
            assert_eq!(cmyk_to_rgb_px(c, m, y, k), (r, g, b), "rgb({r},{g},{b})");
        }
    }

    #[test]
    fn tampon_aller_retour() {
        let n = 256;
        let mut rgb = vec![0u8; n * 3];
        for i in 0..n {
            rgb[i * 3] = i as u8;
            rgb[i * 3 + 1] = (255 - i) as u8;
            rgb[i * 3 + 2] = ((i * 3) % 256) as u8;
        }
        let mut cmyk = vec![0u8; n * 4];
        rgb_to_cmyk(&rgb, &mut cmyk, n);
        let mut back = vec![0u8; n * 3];
        cmyk_to_rgb(&cmyk, &mut back, n);
        assert_eq!(rgb, back);
    }
}
