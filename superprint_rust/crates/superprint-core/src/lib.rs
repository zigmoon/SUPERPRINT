//! # SuperPrint — noyau Rust
//!
//! Primitives partagées du refactoring Rust de SuperPrint :
//! unités typographiques, couleurs (RVB/CMJN, et conversions **sur octets**),
//! géométrie d'impression.
//!
//! Ce crate est **pur Rust** (aucune dépendance) : il compile en natif *ou* en
//! WebAssembly (`wasm32-unknown-unknown`) pour être appelé depuis
//! l'application web.
//!
//! Feuille de route : `superprint_rust/docs/PLAN.md`.

#![forbid(unsafe_code)]

pub mod color;
pub mod color8;
pub mod geometry;
pub mod lab;
pub mod units;

pub use color::{Cmyk, Rgb};
pub use geometry::PageSize;
pub use lab::{delta_e2000, delta_e76, Lab, Xyz, BLANC_D50, BLANC_D65};
