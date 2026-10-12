//! **Imposition** — où va chaque page, et comment la feuille se présente.
//!
//! Un livret imprimé ne se lit pas dans l'ordre où il s'imprime : les pages
//! extérieures passent en premier, puis on converge vers le centre, et chaque
//! feuille est pliée en deux. Ce crate calcule ce plan :
//!
//! ```
//! use superprint_impose::{ordre, Emplacement, Plan, Reglages};
//!
//! // 1. L'ordre des pages, découpé en planches de deux places.
//! let feuilles = superprint_impose::planches_pour(20);
//! assert_eq!(feuilles[0], [Emplacement::Page(20), Emplacement::Page(1)]);
//!
//! // 2. La géométrie : taille de la feuille, place de chaque page, coupes.
//! let plan = Plan::nouveau(feuilles[0][0], feuilles[0][1], Reglages::default());
//! assert_eq!(plan.feuille_largeur_mm, 446.0);
//! assert_eq!(plan.reperes.len(), 12);
//!
//! // 3. Ou depuis une spécification textuelle — la forme que la frontière
//! //    WebAssembly reçoit, et que la frontière lit avec ce même code.
//! let plan = Plan::depuis_spec("!page\t210\t297\n!places\t1\t20").unwrap();
//! assert_eq!(plan.feuille_largeur_mm, 446.0);
//! ```
//!
//! ## Ce que ce crate ne fait pas
//!
//! Il ne dessine pas la planche. Rendre deux pages côte à côte demande de
//! parcourir des objets Fabric, de mesurer du texte avec une police réelle, de
//! rasteriser : ce travail reste dans l'application, qui possède déjà tout cela.
//! Ce qui était éparpillé et recopié, c'est le **calcul** — et c'est lui qui
//! vient ici.
//!
//! ## Pourquoi ce découpage est le bon
//!
//! Les quatre formules de ce crate sont écrites **trois fois** dans
//! `app/JS/main.js` (export imposé, rendu de planche, construction du canvas),
//! avec deux écarts constatés entre les copies : une épaisseur de trait
//! (0,08 mm contre 0,25 mm) et une largeur de demi-page (fond perdu compté d'un
//! seul côté dans le chemin raster de secours, des deux dans le chemin
//! vectoriel). Un seul endroit supprime la classe entière de ces défauts.
//!
//! ## Et pourquoi la frontière ne coûte rien, ici
//!
//! Le plan est calculé **une fois par planche**, pour deux pages. À comparer à
//! la césure, appelée pour chaque mot : c'est le cas d'usage où le WebAssembly
//! est à son avantage. Voir `docs/PORTAGE.md`, section F.

#![forbid(unsafe_code)]
#![deny(missing_docs)]

mod ordre;
mod plan;
mod pose;
mod reperes;
mod specification;

pub use ordre::{ordre, planches, planches_pour, Emplacement, PAGES_PAR_FEUILLE};
pub use plan::{Place, Plan, Reglages};
pub use pose::{Cote, Pose};
pub use reperes::{reperes_de_coupe, Segment};
pub use specification::{lire_place, Specification};
