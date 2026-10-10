//! Boîtes de page PDF : `MediaBox`, `TrimBox`, `BleedBox`, en **points**.
//!
//! Le PDF décrit la page par des rectangles, en points PostScript (1 pt =
//! 1/72 pouce), avec l'origine **en bas à gauche** :
//!
//! - **TrimBox** — le format fini (ce qui reste après massicotage) ;
//! - **BleedBox** — le format fini **plus** le fond perdu ;
//! - **MediaBox** — le support physique, fond perdu **plus** les traits de
//!   coupe.
//!
//! Le rapport de test interne (§5) confirme les valeurs de SuperPrint :
//! **10 mm par côté** pour les traits de coupe, soit **+20 mm** au format fini,
//! et **+6 mm** pour un fond perdu de 3 mm.

use superprint_core::units::mm_to_pt;
use superprint_core::PageSize;

use crate::object;

/// Un rectangle en points PDF `[llx lly urx ury]` (coin bas-gauche puis
/// haut-droit).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BoxPoints {
    /// Abscisse du coin inférieur gauche.
    pub llx: f64,
    /// Ordonnée du coin inférieur gauche.
    pub lly: f64,
    /// Abscisse du coin supérieur droit.
    pub urx: f64,
    /// Ordonnée du coin supérieur droit.
    pub ury: f64,
}

impl BoxPoints {
    /// Largeur, en points.
    #[must_use]
    pub fn width(self) -> f64 {
        self.urx - self.llx
    }

    /// Hauteur, en points.
    #[must_use]
    pub fn height(self) -> f64 {
        self.ury - self.lly
    }

    /// Représentation PDF : `[llx lly urx ury]`.
    #[must_use]
    pub fn to_pdf_array(self) -> String {
        object::array(&[
            object::number(self.llx),
            object::number(self.lly),
            object::number(self.urx),
            object::number(self.ury),
        ])
    }
}

/// Les trois boîtes d'une page, en points. La `MediaBox` commence à `(0, 0)`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PageBoxes {
    /// Support physique (fond perdu + traits de coupe).
    pub media: BoxPoints,
    /// Format fini.
    pub trim: BoxPoints,
    /// Format fini + fond perdu. `None` si le fond perdu est nul (la `BleedBox`
    /// vaut alors la `TrimBox`, qui est le défaut PDF).
    pub bleed: Option<BoxPoints>,
}

impl PageBoxes {
    /// Calcule les boîtes d'une page de format `trim`, avec `bleed_mm` de fond
    /// perdu et `mark_mm` de traits de coupe (par côté).
    ///
    /// La `MediaBox` est posée en `(0, 0)` ; la `TrimBox` et la `BleedBox` sont
    /// décalées en conséquence, de sorte que les trois rectangles soient
    /// **emboîtés** (fond perdu dans media, format fini dans fond perdu).
    #[must_use]
    pub fn from_page(trim: PageSize, bleed_mm: f64, mark_mm: f64) -> Self {
        let bleed_mm = bleed_mm.max(0.0);
        let mark_mm = mark_mm.max(0.0);

        let w = mm_to_pt(trim.width_mm);
        let h = mm_to_pt(trim.height_mm);
        let b = mm_to_pt(bleed_mm);
        let m = mm_to_pt(mark_mm);

        // Décalage du format fini depuis le bord de la MediaBox.
        let offset = b + m;
        let media_w = w + 2.0 * offset;
        let media_h = h + 2.0 * offset;

        let media = BoxPoints {
            llx: 0.0,
            lly: 0.0,
            urx: media_w,
            ury: media_h,
        };

        let trim_box = BoxPoints {
            llx: offset,
            lly: offset,
            urx: offset + w,
            ury: offset + h,
        };

        let bleed = if bleed_mm > 0.0 {
            Some(BoxPoints {
                llx: m,
                lly: m,
                urx: m + w + 2.0 * b,
                ury: m + h + 2.0 * b,
            })
        } else {
            None
        };

        Self {
            media,
            trim: trim_box,
            bleed,
        }
    }

    /// Dictionnaire PDF des boîtes : `/MediaBox`, `/TrimBox` et (si fond perdu)
    /// `/BleedBox`.
    /// Entrées PDF des boîtes, **à fusionner** dans le dictionnaire de page :
    /// `/MediaBox […] /TrimBox […]` et, si fond perdu, `/BleedBox […]`.
    ///
    /// On renvoie les entrées seules (sans `<< >>`) : le dictionnaire de page
    /// les accueille déjà entre ses propres chevrons.
    #[must_use]
    pub fn boxes_entries(&self) -> String {
        let mut parts = vec![
            format!("/MediaBox {}", self.media.to_pdf_array()),
            format!("/TrimBox {}", self.trim.to_pdf_array()),
        ];
        if let Some(bleed) = self.bleed {
            parts.push(format!("/BleedBox {}", bleed.to_pdf_array()));
        }
        parts.join(" ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tolérance en points (les mm sont convertis en flottants).
    const EPS: f64 = 1e-6;

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < EPS, "attendu {b}, obtenu {a}");
    }

    #[test]
    fn a4_sans_fond_perdu_ni_traits() {
        let boxes = PageBoxes::from_page(PageSize::new(210.0, 297.0), 0.0, 0.0);
        approx(boxes.media.width(), mm_to_pt(210.0));
        approx(boxes.media.height(), mm_to_pt(297.0));
        // TrimBox = MediaBox quand il n'y a ni fond perdu ni traits.
        approx(boxes.trim.llx, 0.0);
        approx(boxes.trim.width(), mm_to_pt(210.0));
        assert!(boxes.bleed.is_none());
    }

    #[test]
    fn fond_perdu_de_3mm_ajoute_6mm() {
        // §5 du rapport : le fond perdu ajoute 6 mm au format fini.
        let boxes = PageBoxes::from_page(PageSize::new(170.0, 240.0), 3.0, 0.0);
        approx(boxes.media.width(), mm_to_pt(176.0));
        approx(boxes.media.height(), mm_to_pt(246.0));
        let bleed = boxes.bleed.expect("fond perdu attendu");
        approx(bleed.width(), mm_to_pt(176.0));
        approx(boxes.trim.width(), mm_to_pt(170.0));
    }

    #[test]
    fn traits_de_coupe_ajoutent_20mm() {
        // §5 : les traits réservent 10 mm par côté, soit +20 mm.
        let boxes = PageBoxes::from_page(PageSize::new(170.0, 240.0), 0.0, 10.0);
        approx(boxes.media.width(), mm_to_pt(190.0));
        approx(boxes.media.height(), mm_to_pt(260.0));
        approx(boxes.trim.width(), mm_to_pt(170.0));
    }

    #[test]
    fn fond_perdu_et_traits() {
        // Cas « imprimerie » : 170×240 + 3 mm de fond perdu + 10 mm de traits.
        let boxes = PageBoxes::from_page(PageSize::new(170.0, 240.0), 3.0, 10.0);
        approx(boxes.media.width(), mm_to_pt(196.0));
        approx(boxes.media.height(), mm_to_pt(266.0));
        approx(boxes.trim.llx, mm_to_pt(13.0));

        let bleed = boxes.bleed.expect("fond perdu attendu");
        // Emboîtement : media ⊇ bleed ⊇ trim.
        assert!(bleed.llx >= boxes.media.llx);
        assert!(bleed.urx <= boxes.media.urx);
        assert!(boxes.trim.llx >= bleed.llx);
        assert!(boxes.trim.urx <= bleed.urx);
    }

    #[test]
    fn les_boites_sont_emboitees_pour_a4_avec_bleed() {
        let boxes = PageBoxes::from_page(PageSize::new(210.0, 297.0), 3.0, 5.0);
        let bleed = boxes.bleed.unwrap();
        assert!(boxes.media.llx <= bleed.llx && boxes.media.lly <= bleed.lly);
        assert!(boxes.media.urx >= bleed.urx && boxes.media.ury >= bleed.ury);
        assert!(bleed.llx <= boxes.trim.llx && bleed.lly <= boxes.trim.lly);
        assert!(bleed.urx >= boxes.trim.urx && bleed.ury >= boxes.trim.ury);
    }

    #[test]
    fn entrees_pdf() {
        let boxes = PageBoxes::from_page(PageSize::new(170.0, 240.0), 3.0, 10.0);
        let entries = boxes.boxes_entries();
        // Entrées SEULES (à fusionner dans le dictionnaire de page), sans << >>.
        assert!(entries.starts_with("/MediaBox ["));
        assert!(entries.contains("/TrimBox ["));
        assert!(entries.contains("/BleedBox ["));
        assert!(!entries.contains("<<"));
    }
}
