//! Réduction d'image : rééchantillonnage vers une taille plus petite.
//!
//! Une image de 6000 × 4000 px à 600 DPI ne sert à rien dans un PDF destiné à
//! une impression à 300 DPI : elle pèse **quatre fois** trop. La réduction est
//! le premier levier contre les PDF obèses.
//!
//! Trois méthodes, du plus juste au plus rapide :
//!
//! - [`downscale_area`] — **moyenne de surface** : chaque pixel de sortie vaut
//!   la moyenne des pixels source qu'il recouvre. C'est la seule méthode
//!   correcte au-delà d'un facteur 2, et celle qu'il faut employer par défaut ;
//! - [`downscale_bilinear`] — interpolation bilinéaire : quatre pixels
//!   seulement, quelle que soit la réduction ;
//! - [`downscale_nearest`] — plus proche voisin : vitesse, sans mélange.
//!
//! ## Pourquoi trois méthodes et pas une
//!
//! La différence n'est pas cosmétique. Réduire un damier d'un pixel sur deux
//! **huit fois** par interpolation bilinéaire donne un **moiré** : on n'a
//! échantillonné que quatre pixels sur un motif dont la période est de deux.
//! Par moyenne de surface, on obtient exactement le gris moyen — la seule
//! réponse juste. Le contrôle `scripts/validate-reduction.mjs` mesure cet écart
//! sur un damier, et vérifie que la moyenne de surface égale, au bit près, la
//! moyenne arithmétique de chaque bloc quand le rapport est entier.
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

/// Part de la bande `[a0, a1)` recouverte par la bande `[b0, b1)`.
///
/// Renvoie zéro quand les bandes ne se touchent pas : c'est ce qui évite les
/// tests de bord dans la boucle de moyennage, et ce qui rend un pixel
/// entièrement couvert par un seul poids de 1.
#[inline]
fn couverture(a0: f64, a1: f64, b0: f64, b1: f64) -> f64 {
    let debut = a0.max(b0);
    let fin = a1.min(b1);
    if fin <= debut {
        0.0
    } else {
        fin - debut
    }
}

/// Réduit une image RVB par **moyenne de surface** (filtre « boîte »).
///
/// Chaque pixel de sortie est la moyenne des pixels source qu'il recouvre,
/// **pondérée par la surface réellement recouverte**. Les boîtes des pixels de
/// sortie pavent exactement l'image source : l'énergie totale est donc
/// conservée, et pour un rapport de réduction **entier**, le résultat est
/// exactement la moyenne arithmétique de chaque bloc — au bit près.
///
/// C'est la méthode à employer dès que la réduction dépasse le facteur 2 : sur
/// un motif fin, échantillonner quatre pixels produit un moiré, moyenner le
/// motif entier produit la bonne couleur.
///
/// Ne **grossit jamais** l'image.
#[must_use]
pub fn downscale_area(src: &RgbImage, new_width: u32, new_height: u32) -> RgbImage {
    let (largeur_src, hauteur_src) = (src.width(), src.height());
    let new_width = new_width.clamp(1, largeur_src);
    let new_height = new_height.clamp(1, hauteur_src);

    let ratio_x = f64::from(largeur_src) / f64::from(new_width);
    let ratio_y = f64::from(hauteur_src) / f64::from(new_height);
    let donnees = src.data();

    let mut sortie = Vec::with_capacity(RgbImage::expected_len(new_width, new_height));
    for y in 0..new_height {
        let haut = f64::from(y) * ratio_y;
        let bas = f64::from(y + 1) * ratio_y;
        // Les bornes entières de la boîte : on ne parcourt que ce qui est
        // réellement recouvert, jamais toute l'image.
        let premier_y = haut.floor() as u32;
        let dernier_y = (bas.ceil() as u32).min(hauteur_src);
        for x in 0..new_width {
            let gauche = f64::from(x) * ratio_x;
            let droite = f64::from(x + 1) * ratio_x;
            let premier_x = gauche.floor() as u32;
            let dernier_x = (droite.ceil() as u32).min(largeur_src);

            let mut somme = [0.0f64; 3];
            let mut poids_total = 0.0f64;
            for sy in premier_y..dernier_y {
                let poids_y = couverture(f64::from(sy), f64::from(sy) + 1.0, haut, bas);
                if poids_y <= 0.0 {
                    continue;
                }
                for sx in premier_x..dernier_x {
                    let poids_x = couverture(f64::from(sx), f64::from(sx) + 1.0, gauche, droite);
                    if poids_x <= 0.0 {
                        continue;
                    }
                    let poids = poids_x * poids_y;
                    let index = ((sy * largeur_src + sx) * 3) as usize;
                    somme[0] += f64::from(donnees[index]) * poids;
                    somme[1] += f64::from(donnees[index + 1]) * poids;
                    somme[2] += f64::from(donnees[index + 2]) * poids;
                    poids_total += poids;
                }
            }
            // `poids_total` ne peut pas être nul : la boîte recouvre au moins un
            // pixel, et la couverture maximale d'un pixel entièrement couvert
            // vaut 1. Le test est là parce qu'une division par zéro produirait
            // `NaN`, et qu'un `NaN` converti en `u8` vaut 0 — un pixel noir
            // inexplicable plutôt qu'une erreur visible.
            if poids_total <= 0.0 {
                sortie.extend_from_slice(&[0, 0, 0]);
                continue;
            }
            for canal in somme {
                sortie.push((canal / poids_total).round().clamp(0.0, 255.0) as u8);
            }
        }
    }
    RgbImage::from_data(new_width, new_height, sortie).expect("dimensions cohérentes")
}

/// Réduit une image en niveaux de gris par **moyenne de surface**.
///
/// Même méthode que [`downscale_area`], sur un seul canal. Voir sa
/// documentation pour la justification.
#[must_use]
pub fn downscale_area_gray(src: &GrayImage, new_width: u32, new_height: u32) -> GrayImage {
    let (largeur_src, hauteur_src) = (src.width(), src.height());
    let new_width = new_width.clamp(1, largeur_src);
    let new_height = new_height.clamp(1, hauteur_src);

    let ratio_x = f64::from(largeur_src) / f64::from(new_width);
    let ratio_y = f64::from(hauteur_src) / f64::from(new_height);
    let donnees = src.data();

    let mut sortie = Vec::with_capacity((new_width * new_height) as usize);
    for y in 0..new_height {
        let haut = f64::from(y) * ratio_y;
        let bas = f64::from(y + 1) * ratio_y;
        let premier_y = haut.floor() as u32;
        let dernier_y = (bas.ceil() as u32).min(hauteur_src);
        for x in 0..new_width {
            let gauche = f64::from(x) * ratio_x;
            let droite = f64::from(x + 1) * ratio_x;
            let premier_x = gauche.floor() as u32;
            let dernier_x = (droite.ceil() as u32).min(largeur_src);

            let mut somme = 0.0f64;
            let mut poids_total = 0.0f64;
            for sy in premier_y..dernier_y {
                let poids_y = couverture(f64::from(sy), f64::from(sy) + 1.0, haut, bas);
                if poids_y <= 0.0 {
                    continue;
                }
                for sx in premier_x..dernier_x {
                    let poids_x = couverture(f64::from(sx), f64::from(sx) + 1.0, gauche, droite);
                    if poids_x <= 0.0 {
                        continue;
                    }
                    let poids = poids_x * poids_y;
                    somme += f64::from(donnees[(sy * largeur_src + sx) as usize]) * poids;
                    poids_total += poids;
                }
            }
            if poids_total <= 0.0 {
                sortie.push(0);
                continue;
            }
            sortie.push((somme / poids_total).round().clamp(0.0, 255.0) as u8);
        }
    }
    GrayImage::from_data(new_width, new_height, sortie).expect("dimensions cohérentes")
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

    // ── Moyenne de surface ───────────────────────────────────────────────

    /// Un motif à **période longue** : une colonne blanche toutes les `periode`
    /// colonnes, sur fond noir. C'est le piège classique du rééchantillonnage —
    /// un détail fin qui disparaît complètement quand on échantillonne.
    fn colonnes_blanches(largeur: u32, hauteur: u32, periode: u32) -> RgbImage {
        let mut donnees = Vec::with_capacity((largeur * hauteur * 3) as usize);
        for _ in 0..hauteur {
            for x in 0..largeur {
                let v = if x % periode == 0 { 255 } else { 0 };
                donnees.extend_from_slice(&[v, v, v]);
            }
        }
        RgbImage::from_data(largeur, hauteur, donnees).unwrap()
    }

    /// **Le test qui justifie la méthode.** Une image de 64 × 4 où une colonne
    /// sur huit est blanche, réduite 8 fois : la bonne réponse est le gris moyen
    /// — 255 / 8 = 31,875, soit 32.
    ///
    /// L'interpolation bilinéaire et le plus proche voisin échantillonnent deux
    /// colonnes **noires** et rendent 0 : ils ont perdu le motif. Ce n'est pas
    /// une nuance, c'est un défaut visible à l'impression — des hachures fines
    /// qui disparaissent ou se transforment en moiré.
    #[test]
    fn la_moyenne_de_surface_voit_le_motif_que_l_echantillonnage_rate() {
        let img = colonnes_blanches(64, 4, 8);
        let aire = downscale_area(&img, 8, 1);
        let bilineaire = downscale_bilinear(&img, 8, 1);
        let proche = downscale_nearest(&img, 8, 1);

        for x in 0..8 {
            assert_eq!(
                aire.pixel(x, 0).unwrap(),
                Rgb::new(32, 32, 32),
                "colonne {x} : la moyenne doit voir la colonne blanche"
            );
            assert_eq!(
                bilineaire.pixel(x, 0).unwrap(),
                Rgb::new(0, 0, 0),
                "colonne {x} : le bilineaire n'echantillonne que du noir"
            );
            assert_eq!(
                proche.pixel(x, 0).unwrap(),
                Rgb::new(0, 0, 0),
                "colonne {x} : le plus proche voisin non plus"
            );
        }
    }

    /// Un damier ne doit pas produire de moiré : la moyenne de surface rend un
    /// gris **uniforme**, quelle que soit la position dans le damier.
    #[test]
    fn un_damier_devient_un_gris_uniforme() {
        let (l, h) = (32u32, 32u32);
        let mut donnees = Vec::with_capacity((l * h * 3) as usize);
        for y in 0..h {
            for x in 0..l {
                let v = if (x + y) % 2 == 0 { 255 } else { 0 };
                donnees.extend_from_slice(&[v, v, v]);
            }
        }
        let img = RgbImage::from_data(l, h, donnees).unwrap();
        let out = downscale_area(&img, 4, 4);
        for y in 0..4 {
            for x in 0..4 {
                let p = out.pixel(x, y).unwrap();
                // Un damier parfait est à 50 % de blanc : 127,5, arrondi à 128.
                assert_eq!(p, Rgb::new(128, 128, 128), "damier en ({x}, {y})");
            }
        }
    }

    /// Pour un rapport de réduction **entier**, le résultat est exactement la
    /// moyenne arithmétique de chaque bloc — au bit près, calculée ici
    /// indépendamment en arithmétique entière.
    #[test]
    fn un_rapport_entier_donne_la_moyenne_exacte_du_bloc() {
        let (l, h) = (12u32, 12u32);
        let donnees: Vec<u8> = (0..l * h * 3).map(|i| (i * 37 % 256) as u8).collect();
        let img = RgbImage::from_data(l, h, donnees.clone()).unwrap();

        for k in [2u32, 3, 4, 6] {
            let out = downscale_area(&img, l / k, h / k);
            assert_eq!(out.width(), l / k);
            assert_eq!(out.height(), h / k);
            for by in 0..h / k {
                for bx in 0..l / k {
                    let mut somme = [0u64; 3];
                    for y in by * k..(by + 1) * k {
                        for x in bx * k..(bx + 1) * k {
                            let i = ((y * l + x) * 3) as usize;
                            for canal in 0..3 {
                                somme[canal] += u64::from(donnees[i + canal]);
                            }
                        }
                    }
                    let bloc = f64::from(k * k);
                    let attendu = Rgb::new(
                        (somme[0] as f64 / bloc).round() as u8,
                        (somme[1] as f64 / bloc).round() as u8,
                        (somme[2] as f64 / bloc).round() as u8,
                    );
                    assert_eq!(
                        out.pixel(bx, by).unwrap(),
                        attendu,
                        "bloc ({bx}, {by}) pour un rapport de {k}"
                    );
                }
            }
        }
    }

    /// Une image uniforme reste uniforme : aucune méthode ne doit inventer de
    /// variation là où il n'y en a pas.
    #[test]
    fn une_image_uniforme_est_conservee_a_l_identique() {
        let img = RgbImage::from_data(9, 6, [7u8, 128, 250].repeat(54)).unwrap();
        for (w, h) in [(3u32, 2u32), (1, 1), (9, 1)] {
            let out = downscale_area(&img, w, h);
            for y in 0..h {
                for x in 0..w {
                    assert_eq!(out.pixel(x, y).unwrap(), Rgb::new(7, 128, 250));
                }
            }
        }
    }

    /// À taille identique, la fonction est l'**identité** : chaque boîte
    /// recouvre exactement un pixel, avec un poids de 1.
    #[test]
    fn a_taille_identique_la_moyenne_est_l_identite() {
        let donnees: Vec<u8> = (0..192).map(|i| (i * 11 % 256) as u8).collect();
        let img = RgbImage::from_data(8, 8, donnees.clone()).unwrap();
        let out = downscale_area(&img, 8, 8);
        assert_eq!(out.data(), donnees.as_slice());
    }

    /// La réduction ne grossit jamais : une cible plus grande est ramenée à la
    /// taille d'origine — agrandir n'ajoute aucune information et ne fait
    /// qu'augmenter le poids du fichier.
    #[test]
    fn la_moyenne_ne_grossit_jamais() {
        let img = RgbImage::from_data(4, 4, [1u8, 2, 3].repeat(16)).unwrap();
        let out = downscale_area(&img, 100, 100);
        assert_eq!((out.width(), out.height()), (4, 4));
        assert_eq!(out.data(), img.data());
    }

    /// L'énergie est conservée : la somme des pixels de sortie vaut la somme
    /// d'entrée divisée par le carré du rapport, à l'arrondi près (une demi-unité
    /// par pixel de sortie au pire). C'est la propriété qui distingue une
    /// moyenne d'un échantillonnage — un échantillonnage perdrait la lumière du
    /// motif qu'il n'a pas vu.
    #[test]
    fn la_moyenne_conserve_l_energie() {
        let (l, h, k) = (21u32, 15u32, 3u32);
        let donnees: Vec<u8> = (0..l * h * 3).map(|i| (i % 251) as u8).collect();
        let img = RgbImage::from_data(l, h, donnees.clone()).unwrap();
        let out = downscale_area(&img, l / k, h / k);

        let somme_entree: u64 = donnees.iter().map(|v| u64::from(*v)).sum();
        let somme_sortie: u64 = out.data().iter().map(|v| u64::from(*v)).sum();
        let attendu = somme_entree as f64 / f64::from(k * k);
        // Un canal par pixel de sortie, chacun arrondi à une demi-unité près.
        let tolerance = f64::from(out.data().len() as u32) * 0.5 + 1.0;
        assert!(
            (somme_sortie as f64 - attendu).abs() <= tolerance,
            "somme {somme_sortie} au lieu de {attendu} (tolerance {tolerance})"
        );
    }

    /// La variante en niveaux de gris suit exactement la même règle.
    #[test]
    fn la_moyenne_en_gris_suit_la_meme_regle() {
        let donnees: Vec<u8> = vec![0, 0, 0, 255, 255, 255, 0, 0, 255];
        let gray = GrayImage::from_data(3, 3, donnees.clone()).unwrap();
        let out = downscale_area_gray(&gray, 1, 1);
        // 5 pixels noirs, 4 blancs : 4 x 255 / 9 = 113,33 -> 113
        assert_eq!(out.pixel(0, 0).unwrap(), 113);

        // Et l'identité à taille égale.
        let identite = downscale_area_gray(&gray, 3, 3);
        assert_eq!(identite.data(), donnees.as_slice());
    }

    /// Deux appels identiques donnent le même résultat, pour la moyenne aussi :
    /// le calcul ne doit dépendre ni de l'ordre de parcours ni d'un état caché.
    #[test]
    fn la_moyenne_est_deterministe() {
        let donnees: Vec<u8> = (0..192).map(|i| (i * 13 % 256) as u8).collect();
        let img = RgbImage::from_data(8, 8, donnees).unwrap();
        assert_eq!(downscale_area(&img, 3, 5), downscale_area(&img, 3, 5));
        assert_eq!(downscale_area(&img, 0, 0), downscale_area(&img, 1, 1));
    }
}
