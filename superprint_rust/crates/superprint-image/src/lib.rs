//! # superprint-image — traitement d'image
//!
//! Cœur image du noyau Rust de SuperPrint. Il traite la cause directe du défaut
//! **PDF de 131 Mo** relevé par le rapport de test interne (non publié, conservé
//! hors du dépôt) : des images embarquées **à leur résolution d'origine et non
//! compressées**.
//!
//! Deux leviers, tous deux portés par ce crate :
//!
//! 1. **Réduire** — ramener une image à la résolution réellement utile
//!    (cible DPI), en rééchantillonnant ;
//! 2. **Compresser** — encoder le flux avec un filtre PDF réel
//!    (`/RunLengthDecode`) au lieu d'écrire les pixels bruts.
//!
//! ## Contenu
//!
//! - [`buffer`] — tampons typés ([`RgbImage`], [`GrayImage`]) et conversions ;
//! - [`resample`] — réduction bilinéaire / plus proche voisin, ciblage DPI ;
//! - [`compress`] — filtre PDF *RunLength* (encodage et décodage) ;
//! - [`niveaux`] — niveaux, courbes, correction automatique ;
//! - [`filtres`] — flou gaussien, netteté (masque flou), médiane 3×3 ;
//! - [`encrage`] — couverture d'encre, limitation du taux d'encre, GCR ;
//! - [`alpha`] — canal alpha, composition, aplatissement.
//!
//! Feuille de route : `superprint_rust/docs/PORTAGE.md`.

#![forbid(unsafe_code)]

pub mod alpha;
pub mod buffer;
pub mod compress;
pub mod encrage;
pub mod filtres;
pub mod niveaux;
pub mod resample;

pub use alpha::{composer, AlphaImage, ModeFusion, Rgba};
pub use buffer::{GrayImage, ImageError, RgbImage};
pub use compress::{run_length_decode, run_length_encode};
pub use encrage::{Cmjn, CmjnImage};
pub use niveaux::{appliquer, appliquer_gris, Courbe, Niveaux, Reglages};
pub use resample::{
    downscale_area, downscale_area_gray, downscale_bilinear, downscale_nearest, target_size_for_dpi,
};
