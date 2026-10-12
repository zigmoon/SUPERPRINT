//! Le **rendu d'une page**, tel qu'il arrive de l'extérieur.
//!
//! ## Ce que ce module reçoit, et pourquoi sous cette forme
//!
//! Le noyau ne sait pas rasteriser une page : la page est faite d'objets Fabric,
//! de polices du navigateur, d'images en mémoire — tout ce que Rust ne peut pas
//! posséder. C'est donc **le navigateur qui rend**, et le noyau qui assemble.
//!
//! La frontière entre les deux est volontairement la plus pauvre possible :
//! des **octets RVB**, une largeur et une hauteur en pixels. Pas de PNG, pas de
//! JPEG, pas d'encodage à défaire : le navigateur a déjà les pixels dans un
//! `ImageData`, et lui demander de les encoder pour que nous les décodions
//! serait deux fois du travail pour zéro information.
//!
//! ## L'ordre des lignes, et pourquoi il n'y a rien à retourner
//!
//! Les octets arrivent **de haut en bas** — l'ordre naturel d'un canevas, et
//! l'ordre d'un `ImageData`. Un flux d'image PDF commence aussi à la ligne du
//! **haut** de l'image. Les deux conventions coïncident donc, et il n'y a
//! **aucun retournement** à faire : c'est une source classique de planche
//! retournée, et elle est tarie à la racine plutôt que corrigée après coup.
//!
//! ## La conversion des couleurs
//!
//! Elle est faite **ici**, et pas dans le navigateur, pour une raison de fond :
//! la conversion RVB → CMJN du noyau est vérifiée **au bit près** contre celle du
//! produit (`scripts/validate-cmyk.mjs`, 655 000 conversions, écart maximal
//! `1e-12`). Faire convertir les pixels par le JavaScript du produit ferait
//! dépendre le résultat de l'endroit où l'on regarde ; la faire ici la fait
//! dépendre de la seule fonction mesurée.

use superprint_core::color::{self, Reglages};
use superprint_image::{CmjnImage, RgbImage};
use superprint_pdf::image::{ImageFilter, ImageXObject};

use crate::ErreurMontage;

/// Ce qu'on écrit dans la planche.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModeCouleur {
    /// RVB, tel quel. Le mode de l'écran et de la preuve ;
    Rvb,
    /// CMJN, converti par le noyau. Le mode de l'impression offset, et le seul
    /// que PDF/X-1a accepte ;
    Cmjn,
    /// Niveaux de gris, par la luminance. Un octet par pixel au lieu de trois.
    NiveauxDeGris,
}

impl ModeCouleur {
    /// Nom du mode, tel que l'interface le nomme.
    #[must_use]
    pub fn nom(self) -> &'static str {
        match self {
            Self::Rvb => "rvb",
            Self::Cmjn => "cmjn",
            Self::NiveauxDeGris => "niveaux-de-gris",
        }
    }
}

/// Un rendu de page : des pixels RVB, et leurs dimensions.
///
/// La taille en pixels n'a pas besoin d'être celle du format : c'est la
/// **résolution** (la qualité choisie dans l'interface). Ce qui doit
/// correspondre, c'est le **rapport** largeur/hauteur — l'assemblage le vérifie,
/// parce qu'un rapport faux étire la page sans rien dire.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RendusPage {
    largeur_px: u32,
    hauteur_px: u32,
    pixels: Vec<u8>,
}

impl RendusPage {
    /// Un rendu, à partir de ses pixels RVB (trois octets par pixel, ligne du
    /// haut en premier).
    ///
    /// # Erreurs
    ///
    /// [`ErreurMontage::TamponIncoherent`] si le nombre d'octets ne correspond
    /// pas à `largeur × hauteur × 3`, ou si une dimension est nulle.
    pub fn nouveau(
        largeur_px: u32,
        hauteur_px: u32,
        pixels: Vec<u8>,
    ) -> Result<Self, ErreurMontage> {
        let attendu = RgbImage::expected_len(largeur_px, hauteur_px);
        if largeur_px == 0 || hauteur_px == 0 || pixels.len() != attendu {
            return Err(ErreurMontage::TamponIncoherent {
                largeur_px,
                hauteur_px,
                octets: pixels.len(),
                attendu,
            });
        }
        Ok(Self {
            largeur_px,
            hauteur_px,
            pixels,
        })
    }

    /// Largeur, en pixels.
    #[must_use]
    pub fn largeur_px(&self) -> u32 {
        self.largeur_px
    }

    /// Hauteur, en pixels.
    #[must_use]
    pub fn hauteur_px(&self) -> u32 {
        self.hauteur_px
    }

    /// Le rapport largeur/hauteur, en pixels.
    #[must_use]
    pub fn rapport_px(&self) -> f64 {
        f64::from(self.largeur_px) / f64::from(self.hauteur_px)
    }

    /// Les pixels RVB.
    #[must_use]
    pub fn pixels(&self) -> &[u8] {
        &self.pixels
    }

    /// Les pixels convertis en CMJN par la conversion vérifiée du noyau.
    ///
    /// La quantification vers huit bits par canal est un **arrondi au plus
    /// proche** (`v × 255`, arrondi) : c'est la seule perte de cette étape, et
    /// elle vaut au plus `1/510` par canal. La conversion elle-même, elle, est
    /// exacte au bit près : la comparer au produit revient à comparer des
    /// nombres, pas des images.
    #[must_use]
    pub fn en_cmjn(&self, reglages: Reglages) -> CmjnImage {
        let mut sortie = Vec::with_capacity(self.pixels.len() / 3 * 4);
        for pixel in self.pixels.chunks_exact(3) {
            let c = color::convertir(
                f64::from(pixel[0]),
                f64::from(pixel[1]),
                f64::from(pixel[2]),
                reglages,
            );
            for canal in [c.c, c.m, c.y, c.k] {
                sortie.push(quantifier(canal));
            }
        }
        CmjnImage::from_data(self.largeur_px, self.hauteur_px, sortie)
            .expect("la longueur est construite pour être exacte")
    }

    /// Le rendu encodé pour le PDF, dans le mode demandé.
    ///
    /// # Erreurs
    ///
    /// [`ErreurMontage::TamponIncoherent`] ne peut pas arriver ici (le rendu a
    /// déjà été validé) : la conversion CMJN change la longueur du tampon, et
    /// c'est la seule construction faite dans cette méthode.
    #[must_use]
    pub fn encoder(
        &self,
        mode: ModeCouleur,
        reglages: Reglages,
        filtre: ImageFilter,
    ) -> ImageXObject {
        match mode {
            ModeCouleur::Rvb => {
                let image =
                    RgbImage::from_data(self.largeur_px, self.hauteur_px, self.pixels.clone())
                        .expect("le tampon a été validé à la construction");
                ImageXObject::from_rgb(&image, filtre)
            }
            ModeCouleur::NiveauxDeGris => {
                let image =
                    RgbImage::from_data(self.largeur_px, self.hauteur_px, self.pixels.clone())
                        .expect("le tampon a été validé à la construction");
                ImageXObject::from_gray(&image.to_gray(), filtre)
            }
            ModeCouleur::Cmjn => ImageXObject::from_cmyk(&self.en_cmjn(reglages), filtre),
        }
    }
}

/// Un canal en virgule flottante vers un octet, arrondi au plus proche.
fn quantifier(canal: f64) -> u8 {
    let borne = canal.clamp(0.0, 1.0) * 255.0;
    // `as u8` tronque : on arrondit donc explicitement, sinon un canal à 0,999
    // tomberait à 254 et toute la planche perdrait un niveau.
    borne.round().clamp(0.0, 255.0) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rendu(w: u32, h: u32) -> RendusPage {
        let pixels = vec![128_u8; (w * h * 3) as usize];
        RendusPage::nouveau(w, h, pixels).expect("tampon de la bonne taille")
    }

    #[test]
    fn un_tampon_de_la_mauvaise_taille_est_refuse() {
        let erreur = RendusPage::nouveau(2, 2, vec![0; 11]).unwrap_err();
        assert_eq!(
            erreur,
            ErreurMontage::TamponIncoherent {
                largeur_px: 2,
                hauteur_px: 2,
                octets: 11,
                attendu: 12,
            }
        );
        assert!(RendusPage::nouveau(0, 2, Vec::new()).is_err());
    }

    #[test]
    fn le_rapport_est_celui_des_pixels() {
        let r = rendu(210, 297);
        assert!((r.rapport_px() - 210.0 / 297.0).abs() < 1e-12);
    }

    /// La quantification : le blanc pur reste blanc, le noir reste noir, et
    /// l'arrondi se fait au plus proche — pas par troncature.
    #[test]
    fn la_quantification_arrondit_au_plus_proche() {
        assert_eq!(quantifier(0.0), 0);
        assert_eq!(quantifier(1.0), 255);
        assert_eq!(
            quantifier(0.5),
            128,
            "128,5 arrondi à 128 (pair le plus proche)"
        );
        assert_eq!(quantifier(0.501), 128);
        assert_eq!(
            quantifier(0.999),
            255,
            "0,999 × 255 = 254,7 → 255, et non 254"
        );
        // Hors bornes : on borne au lieu de déborder.
        assert_eq!(quantifier(-1.0), 0);
        assert_eq!(quantifier(2.0), 255);
    }

    /// Le noir et le blanc sont les deux points fixes de la conversion : s'ils
    /// dérivaient, toute la planche serait décalée.
    #[test]
    fn le_noir_et_le_blanc_sont_exacts() {
        let noir = RendusPage::nouveau(1, 1, vec![0, 0, 0]).unwrap();
        let image = noir.en_cmjn(Reglages::default());
        assert_eq!(image.data(), &[0, 0, 0, 255], "le noir est du noir seul");

        let blanc = RendusPage::nouveau(1, 1, vec![255, 255, 255]).unwrap();
        let image = blanc.en_cmjn(Reglages::default());
        assert_eq!(image.data(), &[0, 0, 0, 0], "le blanc n'encrera rien");
    }

    /// Un gris neutre part en noir seul : c'est la neutralisation, et elle est
    /// mesurée à part du reste.
    #[test]
    fn un_gris_neutre_part_en_noir_seul() {
        let gris = RendusPage::nouveau(1, 1, vec![128, 128, 128]).unwrap();
        let image = gris.en_cmjn(Reglages::default());
        let d = image.data();
        assert_eq!(&d[..3], &[0, 0, 0]);
        assert!(d[3] > 120 && d[3] < 135, "K ≈ 127, obtenu {}", d[3]);
    }

    /// Le mode CMJN quadruple le tampon, et le mode gris le divise par trois.
    #[test]
    fn les_modes_donnent_les_bonnes_longueurs() {
        let r = rendu(4, 3);
        let cmyk = r.encoder(
            ModeCouleur::Cmjn,
            Reglages::default(),
            ImageFilter::FlateDecode,
        );
        let gris = r.encoder(
            ModeCouleur::NiveauxDeGris,
            Reglages::default(),
            ImageFilter::FlateDecode,
        );
        let rvb = r.encoder(
            ModeCouleur::Rvb,
            Reglages::default(),
            ImageFilter::FlateDecode,
        );
        assert_eq!(cmyk.color_space().channels(), 4);
        assert_eq!(gris.color_space().channels(), 1);
        assert_eq!(rvb.color_space().channels(), 3);
        assert_eq!(cmyk.width(), 4);
        assert_eq!(cmyk.height(), 3);
    }

    /// L'ordre des lignes n'est pas touché : le premier pixel du tampon reste le
    /// premier pixel de l'image. C'est ce qui empêche une planche retournée.
    #[test]
    fn la_premiere_ligne_reste_la_premiere() {
        // Un tampon 2×2 : la première ligne est rouge, la seconde bleue.
        let pixels = vec![255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255];
        let r = RendusPage::nouveau(2, 2, pixels).unwrap();
        let gris = r.encoder(
            ModeCouleur::NiveauxDeGris,
            Reglages::default(),
            ImageFilter::None,
        );
        let d = gris.data();
        // La luminance du rouge (0,299) est bien plus haute que celle du bleu
        // (0,114) : la première ligne reste donc la plus claire.
        assert!(d[0] > d[2], "première ligne {} contre {}", d[0], d[2]);
    }

    #[test]
    fn les_modes_ont_un_nom() {
        assert_eq!(ModeCouleur::Rvb.nom(), "rvb");
        assert_eq!(ModeCouleur::Cmjn.nom(), "cmjn");
        assert_eq!(ModeCouleur::NiveauxDeGris.nom(), "niveaux-de-gris");
    }
}
