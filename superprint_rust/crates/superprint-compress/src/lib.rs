//! # superprint-compress — DEFLATE et zlib
//!
//! Écrit **depuis les spécifications** (RFC 1951 pour DEFLATE, RFC 1950 pour
//! zlib), sans aucune dépendance. C'est la réponse au défaut le plus lourd du
//! rapport de test interne : la **taille des fichiers**. Le noyau ne savait
//! produire que du `RunLength`, qui ne gagne rien sur une photographie ni sur
//! un contenu vectoriel dense. Un PDF d'impression vit de ces deux-là.
//!
//! ## Ce qui est implémenté, et ce qui ne l'est pas
//!
//! | Élément | État |
//! |---|---|
//! | **Décompression** (`inflate`) : blocs stockés, Huffman figé, Huffman dynamique | ✅ complet |
//! | **Compression** (`deflate`) : LZ77 + Huffman **figé** | ✅ |
//! | Blocs stockés en sortie (données incompressibles) | ✅ |
//! | Compression : Huffman **dynamique** | ❌ |
//! | `gzip` (RFC 1952), CRC-32 | ❌ (inutile à un PDF) |
//!
//! ⚠️ **Limite assumée** : le compresseur emploie le **Huffman figé**, pas le
//! Huffman dynamique. Conséquence chiffrée : sur du texte ou du vectoriel, un
//! déflateur dynamique gagne encore 5 à 15 %. En échange, le code tient en
//! quelques centaines de lignes vérifiables, sans dépendance. Le
//! **décompresseur**, lui, lit le Huffman dynamique : tout flux PDF produit
//! ailleurs se relit.
//!
//! ## La preuve, et pourquoi elle est croisée
//!
//! Comparer un compresseur à lui-même ne prouve rien. Le contrôle
//! (`scripts/validate-compression.mjs`) est donc **croisé** avec le `zlib` de
//! Node, qui est une autre implémentation :
//!
//! 1. ce que le Rust compresse doit être **relu par Node** ;
//! 2. ce que Node compresse doit être **relu par le Rust** ;
//! 3. les deux doivent rendre **exactement** les octets d'origine.
//!
//! Aucun des trois ne s'obtient en triché : il faut un codec juste.
//!
//! ## Comment s'en servir
//!
//! ```no_run
//! use superprint_compress::{compresser_zlib, decompresser_zlib};
//!
//! let donnees = b"un flux de contenu PDF, avec ses repetitions repetitives".to_vec();
//! let comprime = compresser_zlib(&donnees);
//! assert!(comprime.len() < donnees.len());
//! assert_eq!(decompresser_zlib(&comprime).unwrap(), donnees);
//! ```

#![forbid(unsafe_code)]

pub mod deflate;
pub mod inflate;

pub use deflate::Compression;
pub use inflate::ErreurDeflate;

/// Ce qui empêche de relire un flux.
pub use inflate::ErreurDeflate as CompressError;

/// En-tête zlib d'un flux par défaut : compression maximale, fenêtre de 32 Ko,
/// sans dictionnaire.
///
/// `0x78` = méthode 8 (DEFLATE) et fenêtre 32 Ko ; `0x9C` porte le drapeau
/// `FLEVEL = 2` (« algorithme par défaut ») et le reste de contrôle, calculés de
/// sorte que `0x789C` soit un multiple de 31 — ce que la RFC 1950 exige pour
/// détecter une corruption d'en-tête.
const ENTETE_ZLIB: [u8; 2] = [0x78, 0x9C];

/// Compresse des données au format **zlib** — celui que le PDF attend pour
/// `/FlateDecode`.
#[must_use]
pub fn compresser_zlib(donnees: &[u8]) -> Vec<u8> {
    let brut = deflate::compresser(donnees, Compression::Defaut);
    let mut sortie = Vec::with_capacity(brut.len() + 6);
    sortie.extend_from_slice(&ENTETE_ZLIB);
    sortie.extend_from_slice(&brut);
    sortie.extend_from_slice(&adler32(donnees).to_be_bytes());
    sortie
}

/// Décompresse un flux **zlib**.
///
/// # Erreurs
///
/// [`ErreurDeflate`] si l'en-tête, le corps ou la somme de contrôle ne
/// correspondent pas. Un flux corrompu est **refusé**, jamais approximé : une
/// image décalée est bien pire qu'une image manquante.
pub fn decompresser_zlib(donnees: &[u8]) -> Result<Vec<u8>, ErreurDeflate> {
    if donnees.len() < 6 {
        return Err(ErreurDeflate::Tronque {
            attendu: 6,
            trouve: donnees.len(),
        });
    }
    let (entete, reste) = donnees.split_at(2);
    if entete[0] & 0x0F != 8 {
        return Err(ErreurDeflate::MethodeInconnue { octet: entete[0] });
    }
    // La vérification de l'en-tête : le mot de 16 bits doit être un multiple
    // de 31. C'est la seule protection contre une en-tête abîmée.
    let mot = (u16::from(entete[0]) << 8) | u16::from(entete[1]);
    if mot % 31 != 0 {
        return Err(ErreurDeflate::EnTeteInvalide { mot });
    }
    if entete[1] & 0x20 != 0 {
        // Un dictionnaire préalable : le format l'autorise, ce module ne le
        // gère pas. Le dire vaut mieux que rendre un flux faux.
        return Err(ErreurDeflate::DictionnaireNonGere);
    }

    let (corps, queue) = reste.split_at(reste.len() - 4);
    let attendu = u32::from_be_bytes([queue[0], queue[1], queue[2], queue[3]]);
    let sortie = inflate::decompresser(corps)?;
    let obtenu = adler32(&sortie);
    if obtenu != attendu {
        return Err(ErreurDeflate::SommeInvalide { attendu, obtenu });
    }
    Ok(sortie)
}

/// Compresse au format DEFLATE **brut** (sans en-tête ni somme de contrôle).
#[must_use]
pub fn compresser_brut(donnees: &[u8], niveau: Compression) -> Vec<u8> {
    deflate::compresser(donnees, niveau)
}

/// Décompresse un flux DEFLATE **brut**.
///
/// # Erreurs
///
/// [`ErreurDeflate`] si le flux est tronqué ou décrit un code inexistant.
pub fn decompresser_brut(donnees: &[u8]) -> Result<Vec<u8>, ErreurDeflate> {
    inflate::decompresser(donnees)
}

/// Somme de contrôle **Adler-32** (RFC 1950 §8.2).
///
/// Elle est calculée sur une base 65521 : c'est le plus grand nombre premier
/// inférieur à 65 536, choisi pour que le report dans le `u32` ne se produise
/// pas avec les tailles de bloc usuelles.
#[must_use]
pub fn adler32(donnees: &[u8]) -> u32 {
    const BASE: u32 = 65521;
    let mut a: u32 = 1;
    let mut b: u32 = 0;
    // Les blocs de 5 552 octets sont la taille classique : au-delà, `b`
    // pourrait dépasser 2^32 avant le report du modulo.
    for bloc in donnees.chunks(5_552) {
        for octet in bloc {
            a += u32::from(*octet);
            b += a;
        }
        a %= BASE;
        b %= BASE;
    }
    (b << 16) | a
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adler32_de_reference() {
        // Valeur de la RFC 1950 pour l'entrée vide, et valeur connue pour « abc ».
        assert_eq!(adler32(b""), 1);
        assert_eq!(adler32(b"abc"), 0x024D_0127);
        // « Wikipedia » : exemple classique, 0x11E60398.
        assert_eq!(adler32(b"Wikipedia"), 0x11E6_0398);
    }

    #[test]
    fn un_aller_retour_zlib_rend_les_memes_octets() {
        let donnees: Vec<u8> = (0..5000u32).map(|i| ((i * 7) % 251) as u8).collect();
        let comprime = compresser_zlib(&donnees);
        assert_eq!(decompresser_zlib(&comprime).unwrap(), donnees);
    }

    #[test]
    fn l_entete_zlib_est_conforme() {
        let comprime = compresser_zlib(b"test");
        assert_eq!(comprime[0], 0x78);
        let mot = (u16::from(comprime[0]) << 8) | u16::from(comprime[1]);
        assert_eq!(mot % 31, 0, "l'en-tête doit être un multiple de 31");
    }

    #[test]
    fn les_donnees_vides_passent() {
        let comprime = compresser_zlib(b"");
        assert!(comprime.len() >= 6);
        assert!(decompresser_zlib(&comprime).unwrap().is_empty());
    }

    #[test]
    fn un_flux_tronque_est_refuse() {
        assert!(matches!(
            decompresser_zlib(&[0x78]),
            Err(ErreurDeflate::Tronque { .. })
        ));
        let complet = compresser_zlib(b"des donnees a compresser");
        let tronque = &complet[..complet.len() - 4];
        assert!(decompresser_zlib(tronque).is_err());
    }

    #[test]
    fn une_somme_de_controle_fausse_est_refusee() {
        let mut comprime = compresser_zlib(b"des donnees a compresser");
        let dernier = comprime.len() - 1;
        comprime[dernier] ^= 0xFF;
        assert!(matches!(
            decompresser_zlib(&comprime),
            Err(ErreurDeflate::SommeInvalide { .. })
        ));
    }

    #[test]
    fn une_en_tete_dont_le_mot_est_faux_est_refusee() {
        let mut comprime = compresser_zlib(b"des donnees");
        comprime[1] = comprime[1].wrapping_add(1);
        assert!(matches!(
            decompresser_zlib(&comprime),
            Err(ErreurDeflate::EnTeteInvalide { .. })
        ));
    }

    #[test]
    fn une_methode_de_compression_inconnue_est_refusee() {
        // Méthode 7 : n'existe pas.
        let mut comprime = compresser_zlib(b"x");
        comprime[0] = 0x77;
        assert!(matches!(
            decompresser_zlib(&comprime),
            Err(ErreurDeflate::MethodeInconnue { .. })
        ));
    }

    #[test]
    fn un_dictionnaire_prealable_est_signale() {
        // Bit FDICT de l'en-tête : le format l'autorise, ce module non — et il
        // le dit au lieu de rendre un flux faux.
        //
        // ⚠️ L'en-tête doit rester **valide** pour que le refus vienne du
        // dictionnaire et non du contrôle de parité : `0x7820` est bien un
        // multiple de 31 (30 752 = 31 × 992), avec FDICT levé et FCHECK nul.
        let mut comprime = compresser_zlib(b"x");
        comprime[1] = 0x20;
        let mot = (u16::from(comprime[0]) << 8) | u16::from(comprime[1]);
        assert_eq!(mot % 31, 0, "l'en-tête de ce test doit être valide");
        assert!(matches!(
            decompresser_zlib(&comprime),
            Err(ErreurDeflate::DictionnaireNonGere)
        ));
    }

    #[test]
    fn le_defile_brut_ne_porte_ni_entete_ni_somme() {
        let donnees = b"abcabcabcabcabcabc".to_vec();
        let brut = compresser_brut(&donnees, Compression::Defaut);
        assert_ne!(&brut[..2], &ENTETE_ZLIB[..]);
        assert_eq!(decompresser_brut(&brut).unwrap(), donnees);
    }
}
