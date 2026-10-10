//! Conversions d'unités typographiques et d'impression.
//!
//! Repères : 1 pouce = 25,4 mm ; 1 point PostScript = 1/72 pouce.

/// Points PostScript par millimètre.
pub const PT_PER_MM: f64 = 72.0 / 25.4;
/// Millimètres par pouce.
pub const MM_PER_IN: f64 = 25.4;

/// Millimètres → points.
#[inline]
#[must_use]
pub fn mm_to_pt(mm: f64) -> f64 {
    mm * PT_PER_MM
}

/// Points → millimètres.
#[inline]
#[must_use]
pub fn pt_to_mm(pt: f64) -> f64 {
    pt / PT_PER_MM
}

/// Millimètres → pixels, pour une résolution donnée (p. ex. 300 DPI).
#[inline]
#[must_use]
pub fn mm_to_px(mm: f64, dpi: f64) -> f64 {
    mm / MM_PER_IN * dpi
}

/// Pixels → millimètres, pour une résolution donnée.
#[inline]
#[must_use]
pub fn px_to_mm(px: f64, dpi: f64) -> f64 {
    px / dpi * MM_PER_IN
}

/// Centimètres → millimètres.
#[inline]
#[must_use]
pub fn cm_to_mm(cm: f64) -> f64 {
    cm * 10.0
}

/// Pouces → millimètres.
#[inline]
#[must_use]
pub fn in_to_mm(inches: f64) -> f64 {
    inches * MM_PER_IN
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "attendu {b}, obtenu {a}");
    }

    #[test]
    fn mm_pt_va_et_vient() {
        approx(pt_to_mm(mm_to_pt(210.0)), 210.0);
        approx(pt_to_mm(mm_to_pt(297.0)), 297.0);
    }

    #[test]
    fn pixels_a_300_dpi() {
        // 25,4 mm = 1 pouce = 300 px à 300 DPI
        approx(mm_to_px(25.4, 300.0), 300.0);
        approx(px_to_mm(300.0, 300.0), 25.4);
    }

    #[test]
    fn centimetres_et_pouces() {
        approx(cm_to_mm(2.54), 25.4);
        approx(in_to_mm(1.0), 25.4);
    }
}
