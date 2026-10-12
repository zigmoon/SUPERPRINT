//! # superprint-doc-wasm — la frontière C de l'import de documents
//!
//! Un module WebAssembly **à part**, et c'est délibéré. Le module principal du
//! noyau est précaché par le service worker : il est donc téléchargé par tout le
//! monde. Le document importé, lui, est un geste **ponctuel** — comme l'import
//! PostScript, et pour la même raison il vit dans son propre module, chargé au
//! moment où l'utilisateur ouvre un fichier.
//!
//! ## Un seul export, et pourquoi
//!
//! [`sp_doc_texte`] rend **le texte** d'un document. C'est exactement ce que
//! `main.js` demande à un format qu'il ne sait pas composer : sa fonction
//! `_spTexteOdf` rend une chaîne, et le format de page n'est pas lu sur ce
//! chemin. Exposer davantage — le format, la page, les paragraphes — serait une
//! interface que personne n'appelle ; ce qui n'est pas atteignable depuis un
//! export ne coûte rien, mais ce qui l'est sans servir coûte des octets **et**
//! une promesse à tenir. Le reste du crate (lecteur SVG, algèbre de chemin,
//! modèle de classeur, `fluidifier`) n'est donc pas exposé, et l'éditeur de
//! liens ne le garde pas.
//!
//! ## Un refus n'est pas une panne, c'est une réponse
//!
//! Trois issues, et elles ne se confondent pas :
//!
//! | Ce qui arrive | Code | `dst` porte |
//! |---|---|---|
//! | un document lu | `n >= 0`, le nombre d'octets écrits | son texte (éventuellement vide) |
//! | un document **refusé** | [`SP_ERR_REFUS`] | la **raison**, en clair |
//! | un tampon trop petit | [`SP_ERR_TOO_SMALL`] | rien ; `out_len` dit la taille |
//!
//! La raison pour laquelle un refus a **son propre code** plutôt qu'un préfixe
//! dans le texte : un document dont le premier paragraphe commencerait par
//! `!erreur` serait lu de travers. Le code ne se confond avec rien.
//!
//! ⚠️ **La passe de sonde appelle `sp_doc_texte` avec `dst` nul et `dst_cap` à
//! zéro** : c'est ainsi que l'appelant apprend la taille nécessaire. Refuser un
//! `dst` nul **avant** d'avoir comparé la capacité rendrait le protocole
//! inutilisable — et c'est exactement la faute qui a été commise ici, puis
//! trouvée par `scripts/validate-doc-branchement.mjs`. Un `dst` n'est donc exigé
//! que s'il y a quelque chose à écrire.
//!
//! ## Sur le `unsafe` de ce crate
//!
//! La règle du dépôt est que **tout `unsafe` vit dans la frontière C**, et non
//! dans les crates de calcul. Ce crate **est** une frontière C : il ne contient
//! aucun calcul, seulement des lectures de pointeurs et une recopie de sortie.
//! [`superprint_doc`] reste `#![forbid(unsafe_code)]`.

#![deny(missing_docs)]

use core::{ptr, slice};
use std::alloc::{alloc, dealloc, Layout};

use superprint_doc::Memoire;

// ─────────────────────────── codes de retour ───────────────────────────

/// Un pointeur reçu était nul.
pub const SP_ERR_NULL: i32 = -1_000_001;
/// Le tampon de sortie est trop petit ; `out_len` porte la taille nécessaire.
pub const SP_ERR_TOO_SMALL: i32 = -1_000_002;
/// Le document a été **refusé**, et `dst` porte la raison, en clair.
///
/// Ce n'est pas une panne : c'est la réponse du noyau à un `.ods`, à un PDF
/// renommé ou à une archive abîmée. La distinguer d'un texte vide est ce qui
/// permet à l'appelant de **dire pourquoi** — et de se rabattre sur son propre
/// chemin quand il en a un.
pub const SP_ERR_REFUS: i32 = -1_000_003;

// ─────────────────────────── mémoire ───────────────────────────

/// Alignement de toute allocation rendue par [`sp_alloc`].
///
/// Huit octets, comme l'ABI C : c'est ce qui permet aux sorties d'être des `u32`
/// ou des `f64` sans risque d'écriture sur un pointeur mal aligné.
const SP_ALIGN: usize = 8;

/// Alloue `len` octets (alignés sur `SP_ALIGN`) et renvoie leur adresse.
///
/// Renvoie `0` si `len` vaut zéro ou si l'allocation échoue. L'appelant doit
/// rendre le bloc avec [`sp_free`], **avec la même longueur**.
#[no_mangle]
pub extern "C" fn sp_alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return ptr::null_mut();
    }
    match Layout::from_size_align(len, SP_ALIGN) {
        Ok(layout) => unsafe { alloc(layout) },
        Err(_) => ptr::null_mut(),
    }
}

/// Rend un bloc obtenu par [`sp_alloc`].
///
/// # Safety
///
/// `ptr` doit venir de [`sp_alloc`] et `len` doit être la longueur exacte
/// demandée à ce moment-là. Un couple incorrect corrompt le tas.
#[no_mangle]
pub unsafe extern "C" fn sp_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    if let Ok(layout) = Layout::from_size_align(len, SP_ALIGN) {
        unsafe { dealloc(ptr, layout) };
    }
}

// ─────────────────────────── la frontière ───────────────────────────

/// Le **texte** d'un document, un paragraphe par ligne.
///
/// Voir l'en-tête du module pour les trois issues et leurs codes. Un document
/// lu mais **vide** rend `0` avec un tampon vide : ce n'est pas un refus, et
/// l'appelant doit pouvoir les distinguer — « ce document ne contient pas de
/// texte exploitable » n'est pas « ce n'est pas un document lisible ».
///
/// # Safety
///
/// `src` doit désigner `src_len` octets lisibles ; `dst` `dst_cap` octets
/// inscriptibles **quand `dst_cap` n'est pas nul** (la passe de sonde en passe
/// zéro) ; `out_len` un `u32` inscriptible.
#[no_mangle]
pub unsafe extern "C" fn sp_doc_texte(
    src: *const u8,
    src_len: usize,
    dst: *mut u8,
    dst_cap: usize,
    out_len: *mut u32,
) -> i32 {
    if out_len.is_null() {
        return SP_ERR_NULL;
    }
    if src.is_null() && src_len > 0 {
        return SP_ERR_NULL;
    }
    let octets: &[u8] = if src_len == 0 {
        &[]
    } else {
        unsafe { slice::from_raw_parts(src, src_len) }
    };
    let (contenu, refuse) = match Memoire::depuis_octets(octets.to_vec()) {
        Ok(memoire) => (memoire.texte(), false),
        Err(erreur) => (aplatir(&erreur.to_string()), true),
    };

    let besoin = contenu.len();
    unsafe { *out_len = besoin as u32 };
    if besoin > dst_cap {
        return SP_ERR_TOO_SMALL;
    }
    if besoin > 0 {
        if dst.is_null() {
            return SP_ERR_NULL;
        }
        unsafe { ptr::copy_nonoverlapping(contenu.as_ptr(), dst, besoin) };
    }
    if refuse {
        SP_ERR_REFUS
    } else {
        besoin as i32
    }
}

/// Met un texte sur une seule ligne : une raison peut contenir des retours à la
/// ligne, et un message en colonnes ne les tolère pas.
fn aplatir(texte: &str) -> String {
    texte.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Appelle la frontière en deux passes, comme le fait la colle.
    ///
    /// Rend `(code, out_len, contenu)` — et non un `Result` : c'est le
    /// **protocole** qu'on éprouve ici, codes compris.
    fn appeler(entree: &[u8]) -> (i32, u32, String) {
        let mut out_len: u32 = 0;
        // Passe de sonde : `dst` nul, capacité nulle. C'est l'appel qui doit
        // rendre SP_ERR_TOO_SMALL, et c'est celui que le premier jet refusait.
        let sonde = unsafe {
            sp_doc_texte(
                entree.as_ptr(),
                entree.len(),
                ptr::null_mut(),
                0,
                &mut out_len,
            )
        };
        if sonde == 0 && out_len == 0 {
            return (0, 0, String::new());
        }
        if sonde != SP_ERR_TOO_SMALL {
            return (sonde, out_len, String::new());
        }
        let besoin = out_len as usize;
        let mut tampon = vec![0u8; besoin];
        let code = unsafe {
            sp_doc_texte(
                entree.as_ptr(),
                entree.len(),
                tampon.as_mut_ptr(),
                besoin,
                &mut out_len,
            )
        };
        let contenu = String::from_utf8_lossy(&tampon[..besoin.min(out_len as usize)]).to_string();
        (code, out_len, contenu)
    }

    #[test]
    fn la_passe_de_sonde_est_acceptee() {
        // Le cas qui a réellement échoué : un `dst` nul est **légitime** tant
        // que la capacité compare. Le refuser rendrait le protocole inutilisable.
        let (code, taille, _) = appeler(b"pas un document du tout");
        assert_eq!(
            code, SP_ERR_REFUS,
            "un refus n'est pas une erreur de frontière"
        );
        assert!(taille > 0, "la raison doit avoir une taille");
    }

    #[test]
    fn un_refus_dit_pourquoi_et_ne_rend_pas_de_texte() {
        for entree in [b"".as_slice(), b"PK\x03\x04 tronque".as_slice()] {
            let (code, taille, contenu) = appeler(entree);
            assert_eq!(code, SP_ERR_REFUS);
            assert_eq!(contenu.len(), taille as usize);
            assert!(
                !contenu.contains('\n'),
                "une raison tient sur une ligne : {contenu:?}"
            );
        }
    }

    #[test]
    fn un_tampon_trop_petit_ne_ecrit_rien_et_dit_la_taille() {
        let entree = b"ni un document ni une archive";
        let mut out_len: u32 = 0;
        let mut trop_petit = [0u8; 3];
        let code = unsafe {
            sp_doc_texte(
                entree.as_ptr(),
                entree.len(),
                trop_petit.as_mut_ptr(),
                trop_petit.len(),
                &mut out_len,
            )
        };
        assert_eq!(code, SP_ERR_TOO_SMALL);
        assert!(out_len as usize > trop_petit.len());
        assert_eq!(trop_petit, [0u8; 3], "rien n'a été écrit");
    }

    #[test]
    fn un_pointeur_nul_est_refuse_sauf_pour_la_sonde() {
        let mut out_len: u32 = 0;
        // `out_len` nul : rien ne peut être rendu, donc erreur de frontière.
        let code = unsafe { sp_doc_texte(b"x".as_ptr(), 1, ptr::null_mut(), 0, ptr::null_mut()) };
        assert_eq!(code, SP_ERR_NULL);
        // `src` nul avec une longueur non nulle : idem.
        let code = unsafe { sp_doc_texte(ptr::null(), 1, ptr::null_mut(), 0, &mut out_len) };
        assert_eq!(code, SP_ERR_NULL);
        // `src` nul avec une longueur NULLE : c'est une entrée vide, pas une
        // faute d'appel. La passe de sonde doit donc répondre comme pour toute
        // entrée non encore lue — TOO_SMALL, avec la taille de la raison — et
        // non une erreur de frontière.
        let code = unsafe { sp_doc_texte(ptr::null(), 0, ptr::null_mut(), 0, &mut out_len) };
        assert_eq!(code, SP_ERR_TOO_SMALL);
        assert!(out_len > 0, "la raison d'un refus a une taille");
    }

    #[test]
    fn la_memoire_rendue_se_libere() {
        let bloc = sp_alloc(64);
        assert!(!bloc.is_null());
        unsafe { sp_free(bloc, 64) };
        // Zéro octet : pas d'allocation, donc pas de bloc à rendre.
        assert!(sp_alloc(0).is_null());
        // Rendre un pointeur nul est sans effet, et non une faute.
        unsafe { sp_free(ptr::null_mut(), 0) };
    }
}
