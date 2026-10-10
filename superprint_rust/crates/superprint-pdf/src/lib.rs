//! # superprint-pdf — tons directs & écriture PDF
//!
//! Cœur PDF du noyau Rust de SuperPrint. Il traite la partie la plus
//! critique pour l'imprimeur : **les tons directs** (encres Pantone et
//! assimilées) écrits comme de vrais espaces couleur `/Separation`, plus la
//! géométrie de page (MediaBox / TrimBox / BleedBox) et l'assemblage d'un
//! document PDF minimal.
//!
//! Le module est **pur Rust**, sans dépendance PDF externe : il produit la
//! syntaxe PDF exacte et la vérifie par des tests. Il dépend seulement de
//! [`superprint_core`] pour les unités et les couleurs.
//!
//! ## Contenu
//!
//! - [`object`] — primitives de syntaxe PDF (noms, nombres, tableaux, dictionnaires) ;
//! - [`spot`] — une encre directe et sa transformation de teinte (`/Separation`) ;
//! - [`colorspace`] — la pile de couleurs d'une page : quadri + encres directes ;
//! - [`boxes`] — boîtes de page PDF (fond perdu, traits de coupe), en points ;
//! - [`image`] — image XObject : pixels réduits et compressés, embarqués ;
//! - [`doc`] — assemblage d'un PDF portant les tons directs (et une image).
//!
//! Feuille de route : `superprint_rust/docs/PLAN.md` (modules n° 3 et 4).

#![forbid(unsafe_code)]

pub mod boxes;
pub mod colorspace;
pub mod doc;
pub mod image;
pub mod object;
pub mod spot;

pub use boxes::{BoxPoints, PageBoxes};
pub use colorspace::{ColorStack, QuadriSpace, StackError};
pub use doc::{write_spot_page, write_spot_page_with_image};
pub use image::{ImageColorSpace, ImageFilter, ImageXObject};
pub use spot::{AlternateSpace, SpotError, SpotInk};
