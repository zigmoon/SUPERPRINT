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
//! - [`writer`] — assemblage bas niveau : objets numérotés, flux, `xref`, `trailer` ;
//! - [`spot`] — une encre directe et sa transformation de teinte (`/Separation`) ;
//! - [`colorspace`] — la pile de couleurs d'une page : quadri + encres directes ;
//! - [`boxes`] — boîtes de page PDF (fond perdu, traits de coupe), en points ;
//! - [`image`] — image XObject : pixels réduits et compressés, embarqués ;
//! - [`font`] — polices composites (`Type0` / `Identity-H` / `FontFile2`) et
//!   flux `/ToUnicode`, pour que le texte soit **réellement du texte** ;
//! - [`doc`] — page de démonstration : les tons directs, seuls ;
//! - [`document`] — **l'exporteur** : plusieurs pages, texte, dessin vectoriel,
//!   tons directs teintés, images placées, métadonnées, `OutputIntent`.
//!
//! Feuille de route : `superprint_rust/docs/PLAN.md` (modules n° 3, 4 et 6).

#![forbid(unsafe_code)]

pub mod boxes;
pub mod colorspace;
pub mod doc;
pub mod document;
pub mod font;
pub mod image;
pub mod object;
pub mod spot;
pub mod writer;
pub mod xmp;

pub use boxes::{BoxPoints, PageBoxes};
pub use colorspace::{ColorStack, QuadriSpace, StackError};
pub use doc::{write_spot_page, write_spot_page_with_image};
pub use document::{ColorValue, DocError, DocInfo, Document, Op, OutputIntent, Page, Paint, Path};
pub use image::{ImageColorSpace, ImageFilter, ImageXObject};
pub use spot::{AlternateSpace, SpotError, SpotInk};
pub use xmp::{echapper_xml, paquet as paquet_xmp, Conformite};
