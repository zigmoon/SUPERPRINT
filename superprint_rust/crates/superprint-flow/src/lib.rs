//! # superprint-flow — pagination et chaînage de texte
//!
//! ## Le défaut que ce crate traite
//!
//! Le produit chaîne déjà des blocs de texte (`redistributeLinkedTextChain`,
//! `main.js`), et il le fait par une méthode que son propre code commente :
//! **recherche binaire sur le nombre de caractères, avec une recomposition
//! complète à chaque essai**. Le coût est mesuré dans ses commentaires :
//! `initDimensions()` coûte 1,9 ms sur 1 000 caractères, 45,8 ms sur 50 000,
//! 8 270 ms sur 300 000. Une chaîne de 124 blocs sur 403 123 caractères prend
//! **128 secondes**, application gelée.
//!
//! ## Ce que fait ce crate, et pourquoi c'est exact — pas seulement plus rapide
//!
//! Il compose **une fois** le texte en lignes, avec le compositionneur du noyau
//! ([`superprint_text::Compositeur`] : même règle gloutonne que `main.js`, césure
//! comprise), puis il **répartit les lignes** entre les cadres. La recherche
//! binaire disparaît : il n'y a plus rien à chercher, puisqu'on connaît la
//! hauteur de chaque ligne avant de décider.
//!
//! Trois conséquences, dans l'ordre d'importance :
//!
//! 1. **Les coupures tombent sur des lignes entières**, jamais au milieu d'un
//!    mot ni au milieu d'une ligne. La méthode par recherche binaire coupe au
//!    **caractère** près : elle peut donc laisser une ligne à moitié remplie en
//!    fin de cadre, ce qui se voit à l'impression.
//! 2. Le coût est **linéaire** en nombre de lignes, pas `O(log n)` recompositions
//!    complètes. C'est un effet de bord, pas l'objectif.
//! 3. **Aucun caractère ne peut se perdre ni se dupliquer** : la répartition
//!    travaille sur des indices de lignes, et la somme des morceaux est
//!    exactement l'original. C'est la propriété qui compte pour un document
//!    d'imprimerie, et elle est testée comme une invariante.
//!
//! ## Ce que ce crate ne fait pas
//!
//! Il ne **mesure** pas le texte : la mesure dépend de la police, du corps et des
//! approches, donc de l'appelant. Il ne compose pas non plus de colonnes, de
//! tableaux ni de blocs avec enroulement autour d'un objet : ce sont des
//! dispositions, pas du chaînage.
//!
//! Feuille de route : `docs/PORTAGE.md` (domaine « pagination et chaînage »).

#![forbid(unsafe_code)]
#![deny(missing_docs)]

pub mod chaine;
pub mod flux;
pub mod repartition;

pub use chaine::{Cadre, Chaine};
pub use flux::{Flux, Paragraphe};
pub use repartition::{repartir, CadreRempli, LignePlacee, Repartition};
