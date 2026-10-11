//! # superprint-swatch — nuanciers et tons directs
//!
//! Une bibliothèque de teintes n'est pas un algorithme : c'est une **table**.
//! La recopier à la main serait la dupliquer, donc la laisser dériver. Ce crate
//! la **lit là où elle vit déjà** dans le produit, et la relit à chaque
//! compilation grâce à `include_str!` :
//!
//! - `data/nuanciers.txt` — engendré par `scripts/extract-swatchbooks.mjs`
//!   depuis `superprint/app/JS/swatchbooks.js` (Toyo, Focoltone, HKS, RAL, NCS,
//!   DIC) et `superprint/app/index.html` (Pantone, source de vérité du
//!   catalogue) ;
//! - [`ase`] — le lecteur des fichiers **Adobe Swatch Exchange** (`.ase`), qui
//!   est du **code** : un format binaire documenté, porté ici pour qu'un
//!   nuancier importé par l'utilisateur soit lu par le noyau et pas par une
//!   seconde implémentation.
//!
//! ## Ce que le crate apporte
//!
//! | Besoin | Fonction |
//! |---|---|
//! | Parcourir un nuancier | [`Catalogue`], [`Livre`], [`Famille`] |
//! | Retrouver une teinte par son nom | [`recherche::chercher`] |
//! | Retrouver la teinte **la plus proche** d'une couleur | [`recherche::plus_proche`] |
//! | Importer un `.ase` | [`ase::lire`] |
//!
//! ## Les valeurs livrées sont des repères d'écran
//!
//! Les bibliothèques du produit sont des **approximations sRGB publiées** — le
//! produit l'écrit lui-même sous la liste. Ce crate ne prétend pas davantage :
//! il transporte ces valeurs telles quelles. Pour les valeurs exactes d'un
//! fabricant, on importe son `.ase` — et c'est [`ase::lire`] qui le lit.
//!
//! Feuille de route : `docs/PORTAGE.md` (domaine « nuanciers »).

#![forbid(unsafe_code)]
#![deny(missing_docs)]

pub mod ase;
pub mod catalogue;
pub mod recherche;

pub use ase::{lire as lire_ase, AseErreur};
pub use catalogue::{Catalogue, Famille, Livre, Pastille};
pub use recherche::{chercher, plus_proche, Proximite};
