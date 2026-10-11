//! # superprint-path — géométrie vectorielle
//!
//! ## Ce que le produit faisait, et ce qui est fait ici
//!
//! Le Pathfinder du produit (`main.js`, `performPaperOperation`) **ne calcule
//! rien lui-même** : il convertit les formes Fabric en chemins Paper.js et
//! appelle `unite`, `subtract`, `intersect`, `exclude`. C'est-à-dire qu'il
//! emprunte **Paper.js** — 235 Ko de bibliothèque tierce — pour l'algèbre
//! booléenne des chemins.
//!
//! Ce crate porte cette algèbre. Il ne l'emprunte à personne : il n'a **aucune
//! dépendance** hors `superprint-core`.
//!
//! ## Les trois étages
//!
//! | Module | Contenu | Pourquoi |
//! |---|---|---|
//! | [`point`] | point, vecteur, boîte englobante | la base, sans fioriture |
//! | [`matrice`] | matrice affine `[a b c d tx ty]`, composition, inverse | la même convention que PostScript et SVG, écrite une fois |
//! | [`courbe`] | Bézier quadratique et cubique : évaluation, **aplatissement** adaptatif, boîte, subdivision, longueur | le produit n'en a pas besoin puisqu'il a Paper.js ; le nôtre si, et l'écrivain PDF en manquait |
//! | [`polygone`] | anneau, aire signée, **règles de remplissage** (`nonzero`, pair-impair), appartenance d'un point | c'est le sens même d'une forme pleine |
//! | [`booleen`] | union, intersection, différence, exclusion | le Pathfinder |
//!
//! ## Comment l'aplatissement est vérifié
//!
//! Une courbe de Bézier n'est pas un polygone. Toutes les opérations de ce crate
//! travaillent donc sur des **polylignes**, obtenues par aplatissement à une
//! tolérance donnée. Cette simplification est mesurable, et elle est mesurée :
//! pour une tolérance `t`, aucun point de la courbe n'est à plus de `t` du
//! polygone — c'est la propriété testée, pas supposée.
//!
//! ## Comment les opérations booléennes sont vérifiées
//!
//! C'est la partie qu'on ne peut pas se contenter de croire. Trois contrôles
//! indépendants sont appliqués (voir `scripts/validate-path.mjs`) :
//!
//! 1. **par échantillonnage** : on tire des milliers de points, on demande à la
//!    forme RÉSULTANTE si elle les contient, et on compare avec la réponse
//!    calculée à partir des deux formes d'ENTRÉE par la définition même de
//!    l'opération (`A∪B`, `A∩B`, `A\B`, `A△B`). C'est la sémantique ensembliste,
//!    vérifiée point par point ;
//! 2. **par les aires** : `aire(A∪B) + aire(A∩B) = aire(A) + aire(B)`, et
//!    `aire(A\B) = aire(A) − aire(A∩B)`. Ce sont des identités exactes ;
//! 3. **par les cas limites écrits à la main** : formes disjointes, formes
//!    imbriquées, arêtes **partagées** (deux carrés côte à côte), sommets
//!    confondus, dégénérescences.
//!
//! ## Ce que le crate refuse de faire
//!
//! Les préconditions sont **vérifiées, pas supposées**. Une forme dont un anneau
//! s'auto-intersecte n'a pas de sens ensembliste unique : elle est **refusée**
//! ([`ErreurPath::ContourNonSimple`]) au lieu de produire un résultat qui aurait
//! l'air d'un résultat.
//!
//! Feuille de route : `docs/PORTAGE.md` (domaine « géométrie vectorielle »).

#![forbid(unsafe_code)]
#![deny(missing_docs)]

pub mod booleen;
pub mod courbe;
pub mod matrice;
pub mod point;
pub mod polygone;

pub use booleen::{operer, Operation};
pub use courbe::Courbe;
pub use matrice::Matrice;
pub use point::{Boite, Point};
pub use polygone::{Contour, Polygone, Regle};

/// Erreur de géométrie vectorielle.
#[derive(Clone, Debug, PartialEq)]
pub enum ErreurPath {
    /// Un anneau s'auto-intersecte : la forme n'a pas de contenu ensembliste
    /// défini.
    ///
    /// Refuser est le seul choix honnête : l'algorithme booléen classifie chaque
    /// arête par « dedans / dehors », ce qui suppose que « dedans » ait un sens.
    ContourNonSimple {
        /// `true` pour la forme de gauche, `false` pour celle de droite.
        gauche: bool,
    },
    /// Une forme n'a aucun anneau, ou un anneau de moins de trois sommets.
    ContourVide {
        /// `true` pour la forme de gauche, `false` pour celle de droite.
        gauche: bool,
    },
    /// Un anneau dégénère : tous ses sommets sont confondus, ou son aire est
    /// nulle à l'échelle demandée.
    ContourDegenere {
        /// `true` pour la forme de gauche, `false` pour celle de droite.
        gauche: bool,
    },
    /// Le résultat de l'opération est vide.
    ///
    /// Ce n'est pas une erreur de calcul : deux formes disjointes n'ont pas
    /// d'intersection. C'est rendu comme une erreur parce qu'un `Contour` vide
    /// serait plus difficile à distinguer d'un oubli.
    ResultatVide,
    /// Le bord du résultat ne se referme pas.
    ///
    /// Cela veut dire qu'un segment isolé délimite une surface : le résultat
    /// serait une forme ouverte, c'est-à-dire pas une forme. Le désigner comme
    /// « vide » serait un mensonge commode ; on le dit.
    ChainageImpossible,
    /// Un chemin n'est pas continu : un morceau ne commence pas où finit le
    /// précédent.
    ///
    /// Recoller le trou en silence inventerait un segment, et un segment
    /// inventé se voit à l'impression sous forme de trait droit là où il y avait
    /// un vide.
    CheminDiscontinu {
        /// Rang du morceau qui ne suit pas.
        morceau: usize,
    },
}

impl std::fmt::Display for ErreurPath {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let cote = |gauche: &bool| if *gauche { "gauche" } else { "droite" };
        match self {
            Self::ContourNonSimple { gauche } => {
                write!(f, "contour auto-intersectant ({})", cote(gauche))
            }
            Self::ContourVide { gauche } => write!(f, "contour vide ({})", cote(gauche)),
            Self::ContourDegenere { gauche } => write!(f, "contour dégénéré ({})", cote(gauche)),
            Self::ResultatVide => write!(f, "le résultat de l'opération est vide"),
            Self::ChainageImpossible => write!(
                f,
                "le bord du résultat ne se referme pas : arête isolée délimitant une surface"
            ),
            Self::CheminDiscontinu { morceau } => write!(
                f,
                "chemin discontinu : le morceau {morceau} ne commence pas où finit le précédent"
            ),
        }
    }
}

impl std::error::Error for ErreurPath {}
