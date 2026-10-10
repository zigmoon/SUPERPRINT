//! Couleurs : RVB 8 bits et CMJN.
//!
//! Les conversions RVB ↔ CMJN sont **naïves** (formule algébrique, sans profil
//! ICC). La gestion colorimétrique réelle (profils, `/Separation`, PDF/X)
//! passera par un module dédié — voir `docs/PLAN.md`.

/// Couleur RVB, canaux 0–255.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

/// Couleur CMJN, canaux normalisés 0,0–1,0.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cmyk {
    pub c: f64,
    pub m: f64,
    pub y: f64,
    pub k: f64,
}

impl Rgb {
    pub const fn new(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b }
    }

    /// Luminance perceptuelle (Rec. 709), 0–255 — base du passage en niveaux de gris.
    #[must_use]
    pub fn luma(self) -> u8 {
        let y =
            0.2126 * f64::from(self.r) + 0.7152 * f64::from(self.g) + 0.0722 * f64::from(self.b);
        y.round().clamp(0.0, 255.0) as u8
    }
}

impl From<Rgb> for Cmyk {
    /// Conversion **naïve** RVB → CMJN, sans profil ICC.
    fn from(rgb: Rgb) -> Self {
        let r = f64::from(rgb.r) / 255.0;
        let g = f64::from(rgb.g) / 255.0;
        let b = f64::from(rgb.b) / 255.0;

        let k = 1.0 - r.max(g).max(b);
        if k >= 1.0 {
            return Self {
                c: 0.0,
                m: 0.0,
                y: 0.0,
                k: 1.0,
            };
        }
        let d = 1.0 - k;
        Self {
            c: (1.0 - r - k) / d,
            m: (1.0 - g - k) / d,
            y: (1.0 - b - k) / d,
            k,
        }
    }
}

impl From<Cmyk> for Rgb {
    /// Conversion **naïve** CMJN → RVB, sans profil ICC.
    fn from(cmyk: Cmyk) -> Self {
        let Cmyk { c, m, y, k } = cmyk;
        let scale = 1.0 - k;
        Self {
            r: ((1.0 - c) * scale * 255.0).round().clamp(0.0, 255.0) as u8,
            g: ((1.0 - m) * scale * 255.0).round().clamp(0.0, 255.0) as u8,
            b: ((1.0 - y) * scale * 255.0).round().clamp(0.0, 255.0) as u8,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_rgb(a: Rgb, b: Rgb) {
        let d = |x: u8, y: u8| (i16::from(x) - i16::from(y)).abs();
        assert!(
            d(a.r, b.r) <= 1 && d(a.g, b.g) <= 1 && d(a.b, b.b) <= 1,
            "attendu {b:?}, obtenu {a:?}"
        );
    }

    #[test]
    fn luminance_blanc_noir() {
        assert_eq!(Rgb::new(255, 255, 255).luma(), 255);
        assert_eq!(Rgb::new(0, 0, 0).luma(), 0);
        assert_eq!(Rgb::new(128, 128, 128).luma(), 128);
    }

    #[test]
    fn noir_donne_k_a_un() {
        let cmyk: Cmyk = Rgb::new(0, 0, 0).into();
        assert_eq!(
            cmyk,
            Cmyk {
                c: 0.0,
                m: 0.0,
                y: 0.0,
                k: 1.0
            }
        );
    }

    #[test]
    fn aller_retour_rgb_cmyk() {
        for rgb in [
            Rgb::new(255, 0, 0),
            Rgb::new(0, 128, 64),
            Rgb::new(12, 200, 255),
            Rgb::new(247, 243, 236),
        ] {
            approx_rgb(Rgb::from(Cmyk::from(rgb)), rgb);
        }
    }
}
