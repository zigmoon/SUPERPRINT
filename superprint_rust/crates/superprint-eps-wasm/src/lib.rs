//! # superprint-eps-wasm — la frontière C de l'import PostScript / EPS
//!
//! Un module WebAssembly **à part**, et c'est délibéré. Le module principal du
//! noyau est précaché par le service worker : il est donc téléchargé par tout le
//! monde. Y ajouter l'interpréteur PostScript le faisait passer de 380 à 540 Ko
//! — mesuré — soit **+160 Ko pour des utilisateurs qui n'importeront jamais un
//! fichier PostScript**.
//!
//! Ce crate ne dépend que de [`superprint_ps`] : le module livré contient l'EPS
//! **seul**, et il est chargé à la demande par `web/superprint-eps.js`, au moment
//! où l'utilisateur ouvre un `.eps` — exactement quand `sp-eps-import.js` (44 Ko)
//! l'était avant.
//!
//! ## Ce que le produit attend, et ce qui change de camp
//!
//! `main.js` importe un EPS à travers un **module** à cinq fonctions
//! (`window.SPEps`) :
//!
//! | Fonction | Où elle vit maintenant |
//! |---|---|
//! | `detect` | ✅ **Rust** — [`sp_eps_detect`] |
//! | `extractPsText` | ✅ **Rust** — le découpage DSC, dans [`sp_eps_analyse`] |
//! | `parse` | ✅ **Rust** — l'interpréteur, dans [`sp_eps_analyse`] |
//! | `toFabricGroup` | ❌ **JavaScript** — elle crée des objets Fabric, c'est du dessin dans le navigateur |
//! | `importance` | ❌ **JavaScript** — un score d'interface, sur des données que Rust fournit |
//!
//! ## Deux précautions de frontière, apprises à la dure
//!
//! 1. **Le succès d'un export à deux passes rend le nombre d'octets écrits, pas
//!    zéro.** Un `!== 0` côté appelant lit une réussite comme un échec.
//! 2. **`detect` rend une chaîne dans le produit** (`'eps'`, `'pdf'`,
//!    `'inconnu'`), et `main.js` compare `genre === 'pdf'`. [`sp_eps_detect`]
//!    rend un entier — plus sobre sur une frontière C — et **c'est la colle
//!    JavaScript qui refait la correspondance**, à un seul endroit. Renvoyer un
//!    entier en prétendant que `main.js` le lirait était une erreur.
//!
//! ## Sur le `unsafe` de ce crate
//!
//! La règle du dépôt est que **tout `unsafe` vit dans la frontière C**, et non
//! dans les crates de calcul. Ce crate **est** une frontière C : il ne contient
//! aucun calcul, seulement des lectures de pointeurs et une recopie de sortie.
//! Le risque est donc ici, et nulle part ailleurs — [`superprint_ps`] reste
//! `#![forbid(unsafe_code)]`.

#![deny(missing_docs)]

use core::{ptr, slice};
use std::alloc::{alloc, dealloc, Layout};

use superprint_ps::{dsc, Peinture};

// ─────────────────────────── codes d'erreur ───────────────────────────

/// Un pointeur reçu était nul.
pub const SP_ERR_NULL: i32 = -1_000_001;
/// Le tampon de sortie est trop petit ; `out_len` porte la taille nécessaire.
pub const SP_ERR_TOO_SMALL: i32 = -1_000_002;
/// Une entrée était illisible ou inutilisable.
pub const SP_ERR_BAD_INPUT: i32 = -1_000_003;

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

/// Une plage de lecture, ou `None` si le pointeur est nul.
unsafe fn as_slice<'a>(ptr: *const u8, len: usize) -> Option<&'a [u8]> {
    if ptr.is_null() {
        return None;
    }
    Some(unsafe { slice::from_raw_parts(ptr, len) })
}

/// Recopie `octets` dans `dst` et rend le nombre d'octets écrits.
unsafe fn copy_out(octets: &[u8], dst: *mut u8, cap: usize) -> i32 {
    if dst.is_null() {
        return SP_ERR_NULL;
    }
    let n = octets.len().min(cap);
    unsafe { ptr::copy_nonoverlapping(octets.as_ptr(), dst, n) };
    n as i32
}

// ─────────────────────────── la frontière ───────────────────────────

/// La saveur d'un fichier, reconnue par ses premiers octets.
///
/// Rend `1` PostScript, `2` PDF, `3` archive ZIP, `0` inconnu.
///
/// ⚠️ Ce n'est **pas** ce que `main.js` compare. Le produit lit
/// `detect(bytes) === 'pdf'` : c'est `web/superprint-eps.js` qui refait la
/// correspondance entier → chaîne, à un seul endroit. Un entier sur la frontière
/// C est plus sobre, mais prétendre que `main.js` le lirait était une erreur.
///
/// # Safety
///
/// `src` doit désigner `src_len` octets lisibles.
#[no_mangle]
pub unsafe extern "C" fn sp_eps_detect(src: *const u8, src_len: usize) -> i32 {
    let Some(octets) = (unsafe { as_slice(src, src_len) }) else {
        return SP_ERR_NULL;
    };
    match dsc::reconnaitre(octets) {
        dsc::Saveur::PostScript => 1,
        dsc::Saveur::Pdf { .. } => 2,
        dsc::Saveur::Archive => 3,
        dsc::Saveur::Inconnnue => 0,
    }
}

/// Interprète un EPS et écrit un rapport que lit `web/superprint-eps.js`.
///
/// Protocole en deux passes, comme le reste de la frontière : un tampon trop
/// petit reçoit [`SP_ERR_TOO_SMALL`] et `out_len` la taille nécessaire.
///
/// Le rapport est du **texte**, une ligne par élément, champs séparés par des
/// tabulations : relisible à l'œil pendant la mise au point, pour quelques
/// dizaines de kilo-octets sur un EPS vectoriel réel.
///
/// Un fichier qui n'est pas du PostScript ne produit **pas** d'erreur de
/// frontière : il produit un rapport portant `!erreur` et son message. La raison
/// est que l'appelant doit pouvoir dire à l'utilisateur *pourquoi* son `.ai` a
/// été refusé — et `%PDF` n'est pas une panne, c'est une réponse.
///
/// # Safety
///
/// `src` doit désigner `src_len` octets lisibles ; `dst` `dst_cap` octets
/// inscriptibles ; `out_len` un `u32`.
#[no_mangle]
pub unsafe extern "C" fn sp_eps_analyse(
    src: *const u8,
    src_len: usize,
    tolerance: f64,
    dst: *mut u8,
    dst_cap: usize,
    out_len: *mut u32,
) -> i32 {
    if out_len.is_null() {
        return SP_ERR_NULL;
    }
    let Some(octets) = (unsafe { as_slice(src, src_len) }) else {
        return SP_ERR_NULL;
    };
    let tolerance = if tolerance > 0.0 && tolerance.is_finite() {
        tolerance
    } else {
        superprint_ps::TOLERANCE_PAR_DEFAUT
    };
    let rapport = match superprint_ps::interpreter_avec(octets, tolerance) {
        Ok(document) => format_eps(&document),
        Err(erreur) => format!("!erreur\t{}\n", aplatir(&erreur.to_string())),
    };
    let besoin = rapport.len();
    unsafe { *out_len = besoin as u32 };
    if besoin > dst_cap {
        return SP_ERR_TOO_SMALL;
    }
    unsafe { copy_out(rapport.as_bytes(), dst, dst_cap) }
}

// ─────────────────────────── le rapport ───────────────────────────

/// Met un texte sur une seule ligne : un message peut contenir des retours à la
/// ligne, et un rapport en colonnes ne les tolère pas.
fn aplatir(texte: &str) -> String {
    texte.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Le rapport d'un EPS interprété. Voir [`sp_eps_analyse`] pour le format.
///
/// Les lignes commencent par `!` : un `#` aurait fait une ligne de commentaire
/// pour certains lecteurs, et un nom d'opérateur PostScript peut contenir
/// n'importe quel caractère — le `!` est donc le seul préfixe qui ne se confond
/// avec rien.
fn format_eps(document: &superprint_ps::DocumentPs) -> String {
    use core::fmt::Write as _;
    let mut sortie = String::with_capacity(4096);
    let entete = &document.en_tete;

    let _ = writeln!(
        sortie,
        "!entete\t{}\t{}\t{}\t{}",
        entete.version.as_deref().unwrap_or(""),
        aplatir(entete.createur.as_deref().unwrap_or("")),
        aplatir(entete.titre.as_deref().unwrap_or("")),
        u8::from(entete.est_eps)
    );
    let _ = writeln!(sortie, "{}", ligne_boite("!bbox", entete.bounding_box));
    let _ = writeln!(
        sortie,
        "{}",
        ligne_boite("!hires", entete.bounding_box_haute_resolution)
    );
    let _ = writeln!(
        sortie,
        "!superficie\t{:.4}\t{:.4}",
        entete.dimensions().map_or(0.0, |(l, _)| l),
        entete.dimensions().map_or(0.0, |(_, h)| h)
    );

    // La boîte réellement **dessinée**, qui n'est pas celle de l'en-tête : un
    // fichier peut annoncer une boîte plus grande que son dessin, et c'est ainsi
    // qu'on le voit.
    let dessinee = document.boite_dessinee();
    let _ = writeln!(
        sortie,
        "!dessinee\t{:.4}\t{:.4}\t{:.4}\t{:.4}",
        dessinee.map_or(0.0, |(min, _)| min.x),
        dessinee.map_or(0.0, |(min, _)| min.y),
        dessinee.map_or(0.0, |(_, max)| max.x),
        dessinee.map_or(0.0, |(_, max)| max.y)
    );

    // `!stats` : dessins, sommets, inconnus, blocs sautés, pages, **objets
    // exécutés**. Le dernier sert au score d'utilité de la colle
    // (`stats.tokens` dans le produit) : le rapport entre opérateurs inconnus et
    // objets exécutés est ce qui distingue un EPS conforme d'un fichier lu de
    // travers.
    let _ = writeln!(
        sortie,
        "!stats\t{}\t{}\t{}\t{}\t{}\t{}",
        document.valeurs.dessins.len(),
        document.nombre_de_sommets(),
        document.valeurs.inconnus.len(),
        document.valeurs.blocs_ignores,
        document.valeurs.pages,
        document.valeurs.objets
    );
    for nom in &document.valeurs.inconnus {
        let _ = writeln!(sortie, "!inconnu\t{}", aplatir(nom));
    }
    for avertissement in &document.valeurs.avertissements {
        let _ = writeln!(sortie, "!avert\t{}", aplatir(avertissement));
    }

    for (rang, dessin) in document.valeurs.dessins.iter().enumerate() {
        let (peinture, epaisseur) = match dessin.peinture {
            Peinture::Rempli => ("fill", String::new()),
            Peinture::RempliPairImpair => ("eofill", String::new()),
            Peinture::Contour { epaisseur } => ("stroke", format!("{epaisseur:.4}")),
            Peinture::Tronque => ("clip", String::new()),
        };
        let composantes = dessin.couleur.composantes();
        let _ = write!(
            sortie,
            "!dessin\t{rang}\t{peinture}\t{epaisseur}\t{}\t{}",
            dessin.couleur.espace(),
            composantes.len()
        );
        for valeur in &composantes {
            let _ = write!(sortie, "\t{valeur:.6}");
        }
        let _ = write!(sortie, "\t{}", dessin.sous_chemins.len());
        sortie.push('\n');

        for (rang_sous, sous) in dessin.sous_chemins.iter().enumerate() {
            let _ = write!(sortie, "!sous\t{rang}\t{rang_sous}\t{}", sous.len());
            for point in sous {
                let _ = write!(sortie, "\t{:.4}\t{:.4}", point.x, point.y);
            }
            sortie.push('\n');
        }
    }
    sortie
}

/// Une ligne `!bbox` — ou la même sans valeurs quand la boîte manque.
fn ligne_boite(etiquette: &str, boite: Option<(f64, f64, f64, f64)>) -> String {
    match boite {
        Some((x0, y0, x1, y1)) => format!("{etiquette}\t{x0:.4}\t{y0:.4}\t{x1:.4}\t{y1:.4}"),
        None => etiquette.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Le tampon de longueur de la frontière : `sp_alloc` rend des OCTETS, or
    /// `out_len` est un `*mut u32`. L'aller-retour par ce petit outil évite de
    /// répéter le transtypage — et de se tromper, ce qui n'aurait pas échoué au
    /// `cargo build` (le code de test n'y est pas compilé) mais ici.
    fn tampon_longueur() -> *mut u32 {
        sp_alloc(4) as *mut u32
    }

    /// L'analyse complète en deux passes, comme le fait la colle JavaScript.
    /// Rend `(code, texte)`.
    fn analyser(source: &[u8], tolerance: f64) -> (i32, String) {
        let p = sp_alloc(source.len());
        assert!(!p.is_null());
        unsafe { core::ptr::copy_nonoverlapping(source.as_ptr(), p, source.len()) };
        let p_len = tampon_longueur();
        assert!(!p_len.is_null());
        // Première passe : un tampon VIDE (nul, capacité zéro), donc un
        // `SP_ERR_TOO_SMALL` qui dit la place nécessaire. La fonction rend
        // avant d'écrire, un pointeur nul est donc sans danger ici — et c'est
        // exactement ce que fait la colle JavaScript.
        let trop_petit =
            unsafe { sp_eps_analyse(p, source.len(), tolerance, core::ptr::null_mut(), 0, p_len) };
        assert_eq!(trop_petit, SP_ERR_TOO_SMALL);
        let besoin = unsafe { p_len.read() } as usize;
        assert!(besoin > 0);
        let tampon = sp_alloc(besoin);
        assert!(!tampon.is_null());
        let code = unsafe { sp_eps_analyse(p, source.len(), tolerance, tampon, besoin, p_len) };
        let ecrit = unsafe { p_len.read() } as usize;
        // ⚠️ Le succès rend le NOMBRE D'OCTETS ÉCRITS, pas zéro.
        assert_eq!(code as usize, ecrit);
        assert!(ecrit <= besoin);
        let texte =
            String::from_utf8_lossy(unsafe { slice::from_raw_parts(tampon, ecrit) }).to_string();
        unsafe { sp_free(tampon, besoin) };
        unsafe { sp_free(p_len as *mut u8, 4) };
        unsafe { sp_free(p, source.len()) };
        (code, texte)
    }

    #[test]
    fn detection_des_saveurs() {
        let cas = [
            (&b"%!PS-Adobe-3.0"[..], 1),
            (&b"%!"[..], 1),
            (&b"%PDF-1.6"[..], 2),
            (&b"PK\x03\x04"[..], 3),
            (&b"\x89PNG"[..], 0),
        ];
        for (octets, attendu) in cas {
            let code = unsafe { sp_eps_detect(octets.as_ptr(), octets.len()) };
            assert_eq!(code, attendu, "{:?}", String::from_utf8_lossy(octets));
        }
    }

    #[test]
    fn un_pointeur_nul_est_refuse() {
        assert_eq!(unsafe { sp_eps_detect(core::ptr::null(), 0) }, SP_ERR_NULL);
    }

    #[test]
    fn l_allocation_ne_rend_jamais_zero_octet() {
        assert!(sp_alloc(0).is_null());
        let p = sp_alloc(64);
        assert!(!p.is_null());
        // Alignement : une écriture de `u64` doit être valide.
        unsafe { (p as *mut u64).write(0x0123_4567_89AB_CDEF) };
        unsafe { sp_free(p, 64) };
        unsafe { sp_free(core::ptr::null_mut(), 8) };
    }

    #[test]
    fn le_rapport_decrit_un_eps_minimal() {
        let source = b"%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 100\n%%EndComments\n\
                       newpath 0 0 moveto 100 0 lineto 100 100 lineto closepath 0.5 setgray fill\n";
        let (code, texte) = analyser(source, 0.05);
        assert!(code > 0, "{texte}");
        assert!(texte.contains("!entete"), "{texte}");
        assert!(
            texte.contains("!bbox\t0.0000\t0.0000\t100.0000\t100.0000"),
            "{texte}"
        );
        assert!(texte.contains("!dessin\t0\tfill"), "{texte}");
        assert!(texte.contains("!sous\t0\t0\t4"), "{texte}");
    }

    #[test]
    fn un_pdf_produit_une_erreur_lisible_dans_le_rapport() {
        let (_code, texte) = analyser(b"%PDF-1.6\n...", 0.05);
        assert!(texte.starts_with("!erreur\t"), "{texte}");
        assert!(texte.contains("PDF"), "{texte}");
    }
}
