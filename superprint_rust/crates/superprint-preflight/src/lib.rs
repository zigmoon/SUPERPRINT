//! **Prépresse** — vérifier un document avant de l'envoyer à l'imprimeur.
//!
//! Un imprimeur refuse un fichier, ou l'imprime mal, pour une poignée de raisons
//! toujours les mêmes. Ce crate les cherche toutes, et **dit précisément
//! laquelle** : page, objet, valeur mesurée, seuil attendu. Pas de « le document
//! semble correct » — un constat qui ne dit pas où regarder ne sert à rien.
//!
//! ## Ce qui est vérifié, et pourquoi
//!
//! | Constat | Ce qui se passe sans lui |
//! |---|---|
//! | Image sous la résolution | elle sort **floue** sur le papier, personne ne le voit à l'écran |
//! | Couverture d'encre excessive | l'encre **bave** et ne sèche pas |
//! | Noir quadrichrome sur du texte fin | un texte à quatre encres est **flou** : les repérages bougent |
//! | Contenu débordant du fond perdu | après rognage, un **liseré blanc** apparaît sur le bord |
//! | Police non embarquée | le texte est **remplacé** par une autre police chez l'imprimeur |
//! | Profil de sortie absent | personne ne sait **de quelle couleur** le fichier parle |
//! | Repères de coupe absents | le massicot ne sait pas **où couper** |
//! | Encre déclarée mais vide | une **plaque** inutile est facturée |
//!
//! ## Ce que ce crate ne fait pas
//!
//! Il ne **corrige** rien. Un prépresse qui corrige en silence est pire qu'un
//! prépresse qui se tait : l'auteur croit son fichier bon et ne comprend pas
//! pourquoi le tirage diffère. Chaque constat porte donc une gravité et de quoi
//! décider — c'est à l'appelant de choisir.
//!
//! ## Et sur quoi il ne se prononce pas
//!
//! - la **transparence** : le noyau n'a pas de canal alpha, donc un document
//!   entrant n'en a pas. Le jour où il en aura, il faudra un contrôle de plus ;
//! - les **profils ICC** : ce crate ne lit pas un profil, il constate seulement
//!   qu'il y en a un (voir `docs/PORTAGE.md`, section B9) ;
//! - le **texte vivant** : un texte non vectorisé est un risque réel, mais
//!   savoir s'il est « vivant » n'est pas une propriété du document, c'est une
//!   intention de l'auteur. On le signale comme information, sans seuil.

#![forbid(unsafe_code)]
#![deny(missing_docs)]

mod constats;
mod regles;
mod verificateurs;

pub use constats::{Code, Constat, Gravite, Rapport};
pub use regles::Regles;
pub use verificateurs::{boite_englobante, verifier};

/// Version de la table des constats. **Incrémenter** quand un contrôle change de
/// sens : un rapport archivé doit pouvoir dire sous quelle règle il a été rendu.
pub const VERSION_CONTROLES: u32 = 1;

#[cfg(test)]
mod tests;
