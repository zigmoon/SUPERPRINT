//! Géométrie d'impression : format de page, fond perdu, traits de coupe.
//!
//! Reprend les conventions mesurées de SuperPrint (voir
//! `superprint/RAPPORT-WORKFLOW-415.md`) : les traits de coupe réservent
//! **10 mm par côté**, soit **+20 mm** au format fini.

/// Dimensions d'une page, en millimètres.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PageSize {
    pub width_mm: f64,
    pub height_mm: f64,
}

impl PageSize {
    pub const fn new(width_mm: f64, height_mm: f64) -> Self {
        Self {
            width_mm,
            height_mm,
        }
    }

    /// Ajoute un fond perdu : `+2 × bleed_mm` dans les deux dimensions.
    #[must_use]
    pub fn with_bleed(self, bleed_mm: f64) -> Self {
        Self {
            width_mm: self.width_mm + 2.0 * bleed_mm,
            height_mm: self.height_mm + 2.0 * bleed_mm,
        }
    }

    /// Ajoute des traits de coupe : `+2 × mark_mm` dans les deux dimensions.
    ///
    /// SuperPrint réserve **10 mm par côté** (donc `+20 mm`) ; cf.
    /// `RAPPORT-WORKFLOW-415.md`, section 5.
    #[must_use]
    pub fn with_crop_marks(self, mark_mm: f64) -> Self {
        Self {
            width_mm: self.width_mm + 2.0 * mark_mm,
            height_mm: self.height_mm + 2.0 * mark_mm,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a4_avec_fond_perdu() {
        let a4 = PageSize::new(210.0, 297.0);
        assert_eq!(a4.with_bleed(3.0), PageSize::new(216.0, 303.0));
    }

    #[test]
    fn traits_ajoutent_20_mm() {
        let p = PageSize::new(170.0, 240.0).with_crop_marks(10.0);
        assert_eq!(p, PageSize::new(190.0, 260.0));
    }
}
