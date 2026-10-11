//! Filtres : flou gaussien, netteté, médiane.
//!
//! Trois filtres, choisis parce que ce sont les trois dont un export
//! d'impression a besoin : **réduire le bruit** (médiane), **adoucir** (flou),
//! **rattraper la douceur de la réduction** (netteté).
//!
//! ## Le flou gaussien est séparable — et c'est ce qui le rend utilisable
//!
//! Un noyau gaussien 2D de rayon `r` coûte `(2r+1)²` multiplications par pixel.
//! Mais une gaussienne est le produit de deux gaussiennes 1D : deux passes
//! coûtent `2 × (2r+1)`. À `σ = 3` (rayon 9), on passe de 361 à 38 opérations
//! par pixel — dix fois moins — **pour un résultat identique**, puisqu'on ne
//! change pas la formule, seulement l'ordre des multiplications.
//!
//! ## Le bord est prolongé, pas assombri
//!
//! Hors de l'image, un filtre qui lit « zéro » assombrit tous les bords d'un
//! halo noir. Le bord est donc **prolongé** (`clamp`) : un pixel du bord vaut
//! son voisin le plus proche. C'est la convention de tous les logiciels d'image,
//! et le halo est le défaut le plus visible sur une photo collée au fond perdu.
//!
//! Feuille de route : `docs/PORTAGE.md` (domaine « image »).

use crate::buffer::{GrayImage, RgbImage};

/// Rayon au-delà duquel une gaussienne est négligeable (3 σ couvre 99,7 %).
#[must_use]
fn rayon_pour(sigma: f64) -> usize {
    if !sigma.is_finite() || sigma <= 0.0 {
        return 0;
    }
    (sigma * 3.0).ceil() as usize
}

/// Le noyau gaussien 1D normalisé de rayon donné.
///
/// Sa somme vaut **exactement** 1 après normalisation, ce qui garantit qu'un
/// flou ne change pas la luminosité moyenne de l'image. C'est le test qui
/// distingue un flou correct d'une simple moyenne pondérée mal normalisée.
#[must_use]
pub fn noyau_gaussien(sigma: f64) -> Vec<f64> {
    let rayon = rayon_pour(sigma);
    if rayon == 0 {
        return vec![1.0];
    }
    let mut noyau = Vec::with_capacity(rayon * 2 + 1);
    let deux_sigma_carre = 2.0 * sigma * sigma;
    for i in 0..=rayon * 2 {
        let x = i as f64 - rayon as f64;
        noyau.push((-x * x / deux_sigma_carre).exp());
    }
    let somme: f64 = noyau.iter().sum();
    for v in &mut noyau {
        *v /= somme;
    }
    noyau
}

/// Lit un octet en prolongeant le bord (jamais de valeur hors image).
fn lis(data: &[u8], largeur: usize, hauteur: usize, x: isize, y: isize, canaux: usize) -> [u8; 4] {
    let x = x.clamp(0, largeur as isize - 1) as usize;
    let y = y.clamp(0, hauteur as isize - 1) as usize;
    let i = (y * largeur + x) * canaux;
    let mut pixel = [0u8; 4];
    for (c, octet) in data[i..i + canaux].iter().enumerate() {
        pixel[c] = *octet;
    }
    pixel
}

fn flou_separable(
    data: &[u8],
    largeur: usize,
    hauteur: usize,
    canaux: usize,
    noyau: &[f64],
) -> Vec<u8> {
    let rayon = (noyau.len() / 2) as isize;
    if rayon == 0 {
        return data.to_vec();
    }
    /* Passe horizontale. */
    let mut horizontal = vec![0u8; data.len()];
    for y in 0..hauteur {
        for x in 0..largeur {
            let mut somme = [0.0f64; 4];
            for (k, poids) in noyau.iter().enumerate() {
                let pixel = lis(
                    data,
                    largeur,
                    hauteur,
                    x as isize + k as isize - rayon,
                    y as isize,
                    canaux,
                );
                for canal in 0..canaux {
                    somme[canal] += poids * f64::from(pixel[canal]);
                }
            }
            let i = (y * largeur + x) * canaux;
            for canal in 0..canaux {
                horizontal[i + canal] = somme[canal].round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    /* Passe verticale. */
    let mut sortie = vec![0u8; data.len()];
    for y in 0..hauteur {
        for x in 0..largeur {
            let mut somme = [0.0f64; 4];
            for (k, poids) in noyau.iter().enumerate() {
                let pixel = lis(
                    &horizontal,
                    largeur,
                    hauteur,
                    x as isize,
                    y as isize + k as isize - rayon,
                    canaux,
                );
                for canal in 0..canaux {
                    somme[canal] += poids * f64::from(pixel[canal]);
                }
            }
            let i = (y * largeur + x) * canaux;
            for canal in 0..canaux {
                sortie[i + canal] = somme[canal].round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    sortie
}

/// Flou gaussien d'une image RVB.
///
/// `sigma <= 0` (ou non fini) rend l'image **inchangée** : un flou de rayon nul
/// est l'identité, pas une erreur.
#[must_use]
pub fn flou_gaussien(src: &RgbImage, sigma: f64) -> RgbImage {
    let noyau = noyau_gaussien(sigma);
    if noyau.len() == 1 {
        return src.clone();
    }
    let data = flou_separable(
        src.data(),
        src.width() as usize,
        src.height() as usize,
        RgbImage::CHANNELS,
        &noyau,
    );
    RgbImage::from_data(src.width(), src.height(), data)
        .expect("un flou ne change pas les dimensions")
}

/// Flou gaussien d'une image en gris.
#[must_use]
pub fn flou_gaussien_gris(src: &GrayImage, sigma: f64) -> GrayImage {
    let noyau = noyau_gaussien(sigma);
    if noyau.len() == 1 {
        return src.clone();
    }
    let data = flou_separable(
        src.data(),
        src.width() as usize,
        src.height() as usize,
        1,
        &noyau,
    );
    GrayImage::from_data(src.width(), src.height(), data)
        .expect("un flou ne change pas les dimensions")
}

/// Netteté par **masque flou** : `résultat = source + intensité × (source − flou)`.
///
/// Le **seuil** est ce qui rend le filtre utilisable : sans lui, le masque flou
/// amplifie aussi le grain, et une photo légèrement bruitée ressort constellée
/// de taches. Avec un seuil, seuls les écarts plus grands que le seuil sont
/// amplifiés — donc les contours, pas le bruit.
///
/// `intensite = 0` rend l'image inchangée.
#[must_use]
pub fn nettete(src: &RgbImage, sigma: f64, intensite: f64, seuil: u8) -> RgbImage {
    if intensite == 0.0 || !intensite.is_finite() {
        return src.clone();
    }
    let flou = flou_gaussien(src, sigma);
    let mut data = Vec::with_capacity(src.data().len());
    for (original, adouci) in src
        .data()
        .chunks_exact(RgbImage::CHANNELS)
        .zip(flou.data().chunks_exact(RgbImage::CHANNELS))
    {
        for canal in 0..RgbImage::CHANNELS {
            let ecart = f64::from(original[canal]) - f64::from(adouci[canal]);
            let valeur = if ecart.abs() <= f64::from(seuil) {
                f64::from(original[canal])
            } else {
                f64::from(original[canal]) + intensite * ecart
            };
            data.push(valeur.round().clamp(0.0, 255.0) as u8);
        }
    }
    RgbImage::from_data(src.width(), src.height(), data)
        .expect("la netteté ne change pas les dimensions")
}

/// Filtre médian 3×3, canal par canal.
///
/// La médiane enlève un point aberrant (poussière, pixel mort) sans adoucir les
/// contours — ce qu'un flou ne sait pas faire. C'est exactement ce qu'on veut
/// avant un scan à imprimer.
#[must_use]
pub fn mediane_3x3(src: &RgbImage) -> RgbImage {
    let largeur = src.width() as usize;
    let hauteur = src.height() as usize;
    let mut data = Vec::with_capacity(src.data().len());
    for y in 0..hauteur {
        for x in 0..largeur {
            let mut fenetres = [[0u8; 9]; 3];
            for dy in -1isize..=1 {
                for dx in -1isize..=1 {
                    let pixel = lis(
                        src.data(),
                        largeur,
                        hauteur,
                        x as isize + dx,
                        y as isize + dy,
                        RgbImage::CHANNELS,
                    );
                    let k = ((dy + 1) * 3 + (dx + 1)) as usize;
                    for canal in 0..3 {
                        fenetres[canal][k] = pixel[canal];
                    }
                }
            }
            for fenetre in fenetres.iter_mut() {
                fenetre.sort_unstable();
                data.push(fenetre[4]);
            }
        }
    }
    RgbImage::from_data(src.width(), src.height(), data)
        .expect("une médiane ne change pas les dimensions")
}

/// Filtre médian 3×3 sur une image en gris.
#[must_use]
pub fn mediane_3x3_gris(src: &GrayImage) -> GrayImage {
    let largeur = src.width() as usize;
    let hauteur = src.height() as usize;
    let mut data = Vec::with_capacity(src.data().len());
    for y in 0..hauteur {
        for x in 0..largeur {
            let mut fenetre = [0u8; 9];
            for dy in -1isize..=1 {
                for dx in -1isize..=1 {
                    let pixel = lis(
                        src.data(),
                        largeur,
                        hauteur,
                        x as isize + dx,
                        y as isize + dy,
                        1,
                    );
                    fenetre[((dy + 1) * 3 + (dx + 1)) as usize] = pixel[0];
                }
            }
            fenetre.sort_unstable();
            data.push(fenetre[4]);
        }
    }
    GrayImage::from_data(src.width(), src.height(), data)
        .expect("une médiane ne change pas les dimensions")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::buffer::ImageError;

    fn rgb(largeur: u32, hauteur: u32, remplissage: u8) -> RgbImage {
        RgbImage::from_data(
            largeur,
            hauteur,
            vec![remplissage; largeur as usize * hauteur as usize * 3],
        )
        .unwrap()
    }

    /// Un damier noir et blanc : le pire cas pour un flou.
    fn damier(cote: usize) -> RgbImage {
        let mut data = vec![0u8; cote * cote * 3];
        for y in 0..cote {
            for x in 0..cote {
                let v = if (x + y) % 2 == 0 { 0 } else { 255 };
                let i = (y * cote + x) * 3;
                data[i] = v;
                data[i + 1] = v;
                data[i + 2] = v;
            }
        }
        RgbImage::from_data(cote as u32, cote as u32, data).unwrap()
    }

    #[test]
    fn un_noyau_gaussien_est_normalise() {
        for sigma in [0.5, 1.0, 1.8, 3.0, 8.0] {
            let noyau = noyau_gaussien(sigma);
            let somme: f64 = noyau.iter().sum();
            assert!((somme - 1.0).abs() < 1e-12, "sigma {sigma} : somme {somme}");
            assert_eq!(noyau.len() % 2, 1, "le noyau doit être impair");
            assert_eq!(noyau.len(), rayon_pour(sigma) * 2 + 1);
        }
    }

    #[test]
    fn un_noyau_gaussien_est_symetrique_et_decroissant() {
        let noyau = noyau_gaussien(2.0);
        let milieu = noyau.len() / 2;
        for i in 0..=milieu {
            assert!(
                (noyau[i] - noyau[noyau.len() - 1 - i]).abs() < 1e-15,
                "symétrie"
            );
        }
        for i in 0..milieu {
            assert!(noyau[i] <= noyau[i + 1], "le centre doit dominer");
        }
    }

    #[test]
    fn un_sigma_nul_ou_absurde_laisse_l_image_intacte() {
        let src = damier(4);
        for sigma in [0.0, -1.0, f64::NAN] {
            assert_eq!(flou_gaussien(&src, sigma), src, "sigma {sigma}");
        }
    }

    #[test]
    fn un_flou_ne_change_pas_la_luminosite_moyenne() {
        /* La normalisation du noyau doit se voir : une image unie reste unie, et
        la moyenne d'un damier ne bouge pas. */
        let src = damier(8);
        let flou = flou_gaussien(&src, 1.5);
        let moyenne = |img: &RgbImage| {
            img.data().iter().map(|v| f64::from(*v)).sum::<f64>() / img.data().len() as f64
        };
        assert!(
            (moyenne(&src) - moyenne(&flou)).abs() < 1.0,
            "{} contre {}",
            moyenne(&src),
            moyenne(&flou)
        );
    }

    #[test]
    fn une_image_unie_reste_unie_apres_un_flou() {
        for valeur in [0u8, 1, 128, 254, 255] {
            let src = rgb(5, 4, valeur);
            assert_eq!(flou_gaussien(&src, 2.0), src, "valeur {valeur}");
        }
    }

    #[test]
    fn un_flou_rapproche_les_extremes_du_damier() {
        let src = damier(8);
        let flou = flou_gaussien(&src, 1.0);
        let extremes = |img: &RgbImage| {
            (
                img.data().iter().copied().min().unwrap(),
                img.data().iter().copied().max().unwrap(),
            )
        };
        let (min0, max0) = extremes(&src);
        let (min1, max1) = extremes(&flou);
        assert_eq!((min0, max0), (0, 255));
        assert!(
            min1 > 0 && max1 < 255,
            "le flou doit adoucir : {min1}..{max1}"
        );
    }

    #[test]
    fn le_bord_n_est_pas_assombri() {
        /* Hors de l'image, le bord est prolongé : sur une image unie, aucun
        pixel ne doit bouger. Un filtre qui lirait « zéro » produirait un
        cadre sombre. */
        let src = rgb(9, 7, 200);
        assert_eq!(flou_gaussien(&src, 3.0), src);
        let gris = GrayImage::from_data(9, 7, vec![200; 63]).unwrap();
        assert_eq!(flou_gaussien_gris(&gris, 3.0), gris);
    }

    #[test]
    fn le_flou_gaussien_est_separable_donc_deux_passes() {
        /* Contrôle croisé : le flou séparable doit donner la même chose que la
        moyenne pondérée 2D écrite directement (produit des noyaux). */
        let src = damier(6);
        let noyau = noyau_gaussien(1.0);
        let rayon = (noyau.len() / 2) as isize;
        let largeur = src.width() as usize;
        let hauteur = src.height() as usize;
        let mut attendu = Vec::with_capacity(src.data().len());
        for y in 0..hauteur {
            for x in 0..largeur {
                for canal in 0..3 {
                    let mut somme = 0.0;
                    for (ky, py) in noyau.iter().enumerate() {
                        for (kx, px) in noyau.iter().enumerate() {
                            let v = lis(
                                src.data(),
                                largeur,
                                hauteur,
                                x as isize + kx as isize - rayon,
                                y as isize + ky as isize - rayon,
                                RgbImage::CHANNELS,
                            );
                            somme += px * py * f64::from(v[canal]);
                        }
                    }
                    attendu.push(somme.round().clamp(0.0, 255.0) as u8);
                }
            }
        }
        let obtenu = flou_gaussien(&src, 1.0);
        let ecart_max = obtenu
            .data()
            .iter()
            .zip(attendu.iter())
            .map(|(a, b)| i16::from(*a).abs_diff(i16::from(*b)))
            .max()
            .unwrap();
        assert!(ecart_max <= 1, "écart maximal {ecart_max}");
    }

    #[test]
    fn une_nettete_d_intensite_nulle_laisse_l_image_intacte() {
        let src = damier(4);
        assert_eq!(nettete(&src, 2.0, 0.0, 0), src);
        assert_eq!(nettete(&src, 2.0, f64::NAN, 0), src);
    }

    #[test]
    fn la_nettete_augmente_l_ecart_aux_contours() {
        let src = damier(8);
        let net = nettete(&src, 1.0, 1.0, 0);
        let contraste = |img: &RgbImage| {
            let (min, max) = (
                img.data().iter().copied().min().unwrap(),
                img.data().iter().copied().max().unwrap(),
            );
            max - min
        };
        /* Le damier est déjà à 0..255 : la netteté ne peut pas dépasser, mais
        elle ne doit pas non plus écraser. */
        assert!(contraste(&net) >= contraste(&src));
        assert_eq!(net.width(), src.width());
    }

    #[test]
    fn le_seuil_de_la_nettete_epargne_les_petits_ecarts() {
        /* Une image presque unie avec un micro-écart : sous le seuil, rien ne
        doit bouger. */
        let mut data = vec![100u8; 3 * 5];
        data[7] = 104; /* +4 sur le vert du pixel 2 */
        let src = RgbImage::from_data(5, 1, data).unwrap();
        let sous_seuil = nettete(&src, 1.0, 3.0, 10);
        assert_eq!(
            sous_seuil, src,
            "un écart de 4 doit être épargné par un seuil de 10"
        );
        let sans_seuil = nettete(&src, 1.0, 3.0, 0);
        assert_ne!(sans_seuil, src, "sans seuil, l'écart doit être amplifié");
    }

    #[test]
    fn la_mediane_enleve_un_point_isole_et_pas_un_bord() {
        let mut data = vec![200u8; 5 * 5 * 3];
        let milieu = (2 * 5 + 2) * 3;
        data[milieu] = 0;
        data[milieu + 1] = 0;
        data[milieu + 2] = 0;
        let src = RgbImage::from_data(5, 5, data).unwrap();
        let filtre = mediane_3x3(&src);
        assert_eq!(
            filtre.pixel(2, 2).unwrap(),
            superprint_core::color::Rgb::new(200, 200, 200),
            "le point isolé doit disparaître"
        );

        /* Un vrai bord : la médiane ne doit pas le déplacer. */
        let mut data = vec![0u8; 5 * 5 * 3];
        for y in 0..5 {
            for x in 3..5 {
                let i = (y * 5 + x) * 3;
                data[i] = 255;
                data[i + 1] = 255;
                data[i + 2] = 255;
            }
        }
        let src = RgbImage::from_data(5, 5, data).unwrap();
        let filtre = mediane_3x3(&src);
        for y in 0..5 {
            assert_eq!(filtre.pixel(1, y).unwrap().r, 0, "ligne {y}");
            assert_eq!(filtre.pixel(4, y).unwrap().r, 255, "ligne {y}");
        }
    }

    #[test]
    fn une_mediane_sur_une_image_unie_la_laisse_unie() {
        let src = rgb(4, 4, 77);
        assert_eq!(mediane_3x3(&src), src);
        let gris = GrayImage::from_data(4, 4, vec![77; 16]).unwrap();
        assert_eq!(mediane_3x3_gris(&gris), gris);
    }

    #[test]
    fn les_filtres_ne_changent_pas_les_dimensions() {
        let src = damier(5);
        for resultat in [
            flou_gaussien(&src, 1.2),
            nettete(&src, 1.2, 1.5, 3),
            mediane_3x3(&src),
        ] {
            assert_eq!((resultat.width(), resultat.height()), (5, 5));
            assert_eq!(resultat.data().len(), src.data().len());
        }
    }

    #[test]
    fn les_filtres_sont_deterministes() {
        let src = damier(6);
        assert_eq!(flou_gaussien(&src, 1.4), flou_gaussien(&src, 1.4));
        assert_eq!(nettete(&src, 1.4, 2.0, 5), nettete(&src, 1.4, 2.0, 5));
        assert_eq!(mediane_3x3(&src), mediane_3x3(&src));
    }

    #[test]
    fn une_image_d_une_seule_ligne_se_filtre_quand_meme() {
        let src = RgbImage::from_data(
            5,
            1,
            vec![
                10, 20, 30, 200, 200, 200, 50, 50, 50, 0, 0, 0, 255, 255, 255,
            ],
        )
        .unwrap();
        let flou = flou_gaussien(&src, 1.0);
        assert_eq!(flou.data().len(), 15);
        assert_ne!(flou, src, "une ligne contrastée doit être adoucie");
    }

    #[test]
    fn une_image_d_un_seul_pixel_se_filtre_quand_meme() {
        let src = RgbImage::from_data(1, 1, vec![123, 45, 67]).unwrap();
        assert_eq!(flou_gaussien(&src, 2.0), src);
        assert_eq!(mediane_3x3(&src), src);
    }

    #[test]
    fn un_tampon_de_taille_fausse_est_refuse_a_la_construction() {
        assert!(matches!(
            RgbImage::from_data(2, 2, vec![0; 11]),
            Err(ImageError::BadLength { .. })
        ));
    }
}
