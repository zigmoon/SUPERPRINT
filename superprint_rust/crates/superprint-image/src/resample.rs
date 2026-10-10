//! Réduction d'image : rééchantillonnage vers une taille plus petite.
//!
//! Une image de 6000 × 4000 px à 600 DPI ne sert à rien dans un PDF destiné à
//! une impression à 300 DPI : elle pèse **quatre fois** trop. La réduction est
//! le premier levier contre les PDF obèses.
//!
//! Deux méthodes :
//!
//! - [`downscale_bilinear`] — qualité : chaque pixel de sortie est un mélange
//!   des quatre pixels voisins (pas de crénelage) ;
//! - [`downscale_nearest`] — vitesse : on échantillonne le pixel le plus proche.
//!
//! Le calcul est **déterministe** : mêmes entrées, même sortie, au bit près.

use crate::buffer::{GrayImage, RgbImage};

/// Coordonnée source correspondant au centre du pixel de destination `i`.
///
/// On aligne les **centres** de pixels (`(i + 0.5) · ratio - 0.5`) : sans ce
/// décalage, l'image dérive d'un demi-pixel et les bords bavent.
#[inline]
fn source_coordinate(i: u32, dst: u32, src: u32) -> f64 {
    (f64::from(i) + 0.5) * (f64::from(src) / f64::from(dst)) - 0.5
}

/// Réduit une image RVB par **interpolation bilinéaire**.
///
/// `new_width` et `new_height` sont bornés à la taille d'origine : cette
/// fonction **ne grossit jamais** une image (l'agrandissement ne fait
/// qu'ajouter du poids sans information).
#[must_use]
pub fn downscale_bilinear(src: &RgbImage, new_width: u32, new_height: u32) -> RgbImage {
    let new_width = new_width.clamp(1, src.width());
    let new_height = new_height.clamp(1, src.height());

    let mut out = Vec::with_capacity(RgbImage::expected_len(new_width, new_height));
    for y in 0..new_height {
        let sy = source_coordinate(y, new_height, src.height());
        let y0 = sy.floor().max(0.0) as u32;
        let y1 = (y0 + 1).min(src.height() - 1);
        let fy = (sy - sy.floor()).clamp(0.0, 1.0);

        for x in 0..new_width {
            let sx = source_coordinate(x, new_width, src.width());
            let x0 = sx.floor().max(0.0) as u32;
            let x1 = (x0 + 1).min(src.width() - 1);
            let fx = (sx - sx.floor()).clamp(0.0, 1.0);

            let p00 = src.pixel(x0, y0).expect("x0,y0 dans l'image");
            let p10 = src.pixel(x1, y0).expect("x1,y0 dans l'image");
            let p01 = src.pixel(x0, y1).expect("x0,y1 dans l'image");
            let p11 = src.pixel(x1, y1).expect("x1,y1 dans l'image");

            let channel = |c00: u8, c10: u8, c01: u8, c11: u8| -> u8 {
                let top = f64::from(c00) * (1.0 - fx) + f64::from(c10) * fx;
                let bottom = f64::from(c01) * (1.0 - fx) + f64::from(c11) * fx;
                let value = top * (1.0 - fy) + bottom * fy;
                value.round().clamp(0.0, 255.0) as u8
            };

            out.push(channel(p00.r, p10.r, p01.r, p11.r));
            out.push(channel(p00.g, p10.g, p01.g, p11.g));
            out.push(channel(p00.b, p10.b, p01.b, p11.b));
        }
    }

    RgbImage::from_data(new_width, new_height, out).expect("dimensions cohérentes")
}

/// Réduit une image RVB par **plus proche voisin** (rapide, sans mélange).
#[must_use]
pub fn downscale_nearest(src: &RgbImage, new_width: u32, new_height: u32) -> RgbImage {
    let new_width = new_width.clamp(1, src.width());
    let new_height = new_height.clamp(1, src.height());

    let mut out = Vec::with_capacity(RgbImage::expected_len(new_width, new_height));
    for y in 0..new_height {
        let sy = source_coordinate(y, new_height, src.height())
            .round()
            .max(0.0) as u32;
        let sy = sy.min(src.height() - 1);
        for x in 0..new_width {
            let sx = source_coordinate(x, new_width, src.width())
                .round()
                .max(0.0) as u32;
            let sx = sx.min(src.width() - 1);
            let p = src.pixel(sx, sy).expect("coordonnées bornées");
            out.push(p.r);
            out.push(p.g);
            out.push(p.b);
        }
    }

    RgbImage::from_data(new_width, new_height, out).expect("dimensions cohérentes")
}

/// Taille cible, en pixels, pour ramener une image à `target_dpi`.
///
/// Ne **grossit jamais** : si l'image est déjà à une résolution inférieure ou
/// égale à la cible, sa taille est renvoyée inchangée.
#[must_use]
pub fn target_size_for_dpi(
    width_px: u32,
    height_px: u32,
    current_dpi: f64,
    target_dpi: f64,
) -> (u32, u32) {
    if current_dpi <= 0.0 || target_dpi <= 0.0 || current_dpi <= target_dpi {
        return (width_px, height_px);
    }
    let ratio = target_dpi / current_dpi;
    let width = ((f64::from(width_px) * ratio).round() as u32).max(1);
    let height = ((f64::from(height_px) * ratio).round() as u32).max(1);
    (width, height)
}

/// Réduit une image en niveaux de gris par **interpolation bilinéaire**.
#[must_use]
pub fn downscale_gray_bilinear(src: &GrayImage, new_width: u32, new_height: u32) -> GrayImage {
    let new_width = new_width.clamp(1, src.width());
    let new_height = new_height.clamp(1, src.height());

    let mut out = Vec::with_capacity((new_width * new_height) as usize);
    for y in 0..new_height {
        let sy = source_coordinate(y, new_height, src.height());
        let y0 = sy.floor().max(0.0) as u32;
        let y1 = (y0 + 1).min(src.height() - 1);
        let fy = (sy - sy.floor()).clamp(0.0, 1.0);
        for x in 0..new_width {
            let sx = source_coordinate(x, new_width, src.width());
            let x0 = sx.floor().max(0.0) as u32;
            let x1 = (x0 + 1).min(src.width() - 1);
            let fx = (sx - sx.floor()).clamp(0.0, 1.0);

            let p00 = f64::from(src.pixel(x0, y0).expect("borné"));
            let p10 = f64::from(src.pixel(x1, y0).expect("borné"));
            let p01 = f64::from(src.pixel(x0, y1).expect("borné"));
            let p11 = f64::from(src.pixel(x1, y1).expect("borné"));

            let top = p00 * (1.0 - fx) + p10 * fx;
            let bottom = p01 * (1.0 - fx) + p11 * fx;
            out.push((top * (1.0 - fy) + bottom * fy).round().clamp(0.0, 255.0) as u8);
        }
    }
    GrayImage::from_data(new_width, new_height, out).expect("dimensions cohérentes")
}

#[cfg(test)]
mod tests {
    use super::*;
    use superprint_core::color::Rgb;

    /// Image 2×2 connue : rouge, vert / bleu, blanc.
    fn quad() -> RgbImage {
        RgbImage::from_data(
            2,
            2,
            vec![
                255, 0, 0, // (0,0) rouge
                0, 255, 0, // (1,0) vert
                0, 0, 255, // (0,1) bleu
                255, 255, 255, // (1,1) blanc
            ],
        )
        .unwrap()
    }

    #[test]
    fn reduction_dune_image_uniforme_la_conserve() {
        let img = RgbImage::from_data(4, 4, [10u8, 20, 30].repeat(16)).unwrap();
        let bilinear = downscale_bilinear(&img, 2, 2);
        assert_eq!(bilinear.width(), 2);
        assert_eq!(bilinear.height(), 2);
        assert_eq!(bilinear.pixel(0, 0).unwrap(), Rgb::new(10, 20, 30));
        assert_eq!(bilinear.pixel(1, 1).unwrap(), Rgb::new(10, 20, 30));

        let nearest = downscale_nearest(&img, 2, 2);
        assert_eq!(nearest.pixel(1, 1).unwrap(), Rgb::new(10, 20, 30));
    }

    #[test]
    fn bilineaire_melange_les_voisins() {
        // 2×2 → 1×1 : le pixel unique doit être la moyenne des quatre coins.
        let img = quad();
        let out = downscale_bilinear(&img, 1, 1);
        assert_eq!(out.width(), 1);
        assert_eq!(out.height(), 1);
        let p = out.pixel(0, 0).unwrap();
        // moyenne de (255,0,0), (0,255,0), (0,0,255), (255,255,255)
        assert_eq!(p, Rgb::new(128, 128, 128));
    }

    #[test]
    fn ne_grossit_jamais() {
        let img = quad();
        let out = downscale_bilinear(&img, 10, 10);
        assert_eq!(out.width(), 2);
        assert_eq!(out.height(), 2);
        assert_eq!(out, img);
    }

    #[test]
    fn taille_cible_dpi() {
        // 6000×4000 à 600 DPI ramené à 300 DPI → 3000×2000 (÷2).
        assert_eq!(target_size_for_dpi(6000, 4000, 600.0, 300.0), (3000, 2000));
        // Déjà en dessous : inchangé.
        assert_eq!(target_size_for_dpi(1000, 800, 150.0, 300.0), (1000, 800));
        // Cas dégénérés.
        assert_eq!(target_size_for_dpi(1000, 800, 0.0, 300.0), (1000, 800));
        assert_eq!(target_size_for_dpi(1000, 800, 300.0, 0.0), (1000, 800));
    }

    #[test]
    fn gris_reduction() {
        let gray = GrayImage::from_data(2, 2, vec![0, 100, 200, 255]).unwrap();
        let out = downscale_gray_bilinear(&gray, 1, 1);
        // moyenne de 0, 100, 200, 255 = 138.75 → 139
        assert_eq!(out.pixel(0, 0).unwrap(), 139);
    }

    #[test]
    fn deterministe() {
        let img = RgbImage::from_data(
            8,
            8,
            (0..192).map(|i| (i * 7 % 256) as u8).collect::<Vec<_>>(),
        )
        .unwrap();
        let a = downscale_bilinear(&img, 3, 5);
        let b = downscale_bilinear(&img, 3, 5);
        assert_eq!(
            a, b,
            "deux appels identiques doivent donner le même résultat"
        );
    }
}
