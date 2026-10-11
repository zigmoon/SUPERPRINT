//! # superprint-wasm — la surface C du noyau Rust, pour le navigateur
//!
//! C'est le **seul** crate du workspace compilé en `cdylib`, donc le seul qui
//! produise un `.wasm` qu'un navigateur peut charger. Les trois crates du noyau
//! (`superprint-core`, `superprint-image`, `superprint-pdf`) restent des
//! bibliothèques Rust pures, marquées `#![forbid(unsafe_code)]` : tout le
//! `unsafe` de la frontière est ici, et nulle part ailleurs.
//!
//! ## Pourquoi pas `wasm-bindgen`
//!
//! Le workspace s'est fixé la règle **zéro dépendance externe**. `wasm-bindgen`
//! imposerait, en plus de lui-même, une chaîne d'outils JavaScript à installer
//! et à versionner. Le noyau n'a besoin que de **nombres et de tampons** : une
//! frontière C classique suffit, et elle se teste sans outil intermédiaire.
//! Le prix est l'écriture à la main de la gestion mémoire ([`sp_alloc`] /
//! [`sp_free`]) — d'où la présence d'`unsafe` dans ce fichier.
//!
//! ## Contrat de la frontière
//!
//! Toutes les fonctions qui peuvent échouer renvoient un code **`i32`** :
//!
//! - `>= 0` : succès (c'est le nombre d'octets écrits, quand il y en a) ;
//! - `< -1_000_000` : une erreur, dont la valeur est une des constantes
//!   `SP_ERR_*` ci-dessous.
//!
//! Les erreurs sont numérotées très loin de zéro pour qu'un **compte d'octets**
//! ne puisse jamais être confondu avec elles.
//!
//! Les tampons de sortie appartiennent à **l'appelant** : il les alloue avec
//! [`sp_alloc`] et les rend avec [`sp_free`]. Les fonctions d'écriture suivent
//! un protocole en **deux passes** : on appelle une première fois avec un
//! tampon vide, la fonction remplit `out_len` avec la taille nécessaire et
//! renvoie [`SP_ERR_TOO_SMALL`] ; on alloue, puis on rappelle.
//!
//! ## Repères d'appel (JavaScript)
//!
//! ```js
//! const { instance } = await WebAssembly.instantiate(bytes, {});
//! const { memory, sp_alloc, sp_rgb_to_cmyk } = instance.exports;
//! const src = sp_alloc(n * 3);
//! // ... on remplit `new Uint8Array(memory.buffer, src, n * 3)` ...
//! const dst = sp_alloc(n * 4);
//! sp_rgb_to_cmyk(src, dst, n);           // 0 = succès
//! const cmyk = new Uint8Array(memory.buffer, dst, n * 4);
//! ```
//!
//! ⚠️ `memory.buffer` est **détaché** dès qu'une fonction Rust agrandit la
//! mémoire : toute vue `TypedArray` construite avant l'appel devient inutile.
//! Il faut la reconstruire après chaque appel qui peut allouer. C'est la règle
//! que suit `scripts/validate-wasm.mjs`.
//!
//! Feuille de route : `superprint_rust/docs/PLAN.md` (phase 3).

#![deny(unsafe_op_in_unsafe_fn)]

use core::{ptr, slice};
use std::alloc::{alloc, dealloc, Layout};

use superprint_core::color8;
use superprint_core::{units, Cmyk, PageSize, Rgb};
use superprint_image::{compress, resample, GrayImage, RgbImage};
use superprint_pdf::colorspace::{ColorStack, QuadriSpace};
use superprint_pdf::doc::{write_spot_page, write_spot_page_with_image};
use superprint_pdf::image::{ImageFilter, ImageXObject};
use superprint_pdf::spot::{AlternateSpace, SpotInk};

// ─────────────────────────── codes d'erreur ───────────────────────────
//
// Volontairement très négatifs : un nombre d'octets écrits reste toujours
// positif et ne peut donc jamais être pris pour une erreur.

/// Pointeur nul là où un tampon était requis.
pub const SP_ERR_NULL: i32 = -1_000_001;
/// Tampon de sortie trop petit : `out_len` porte alors la taille nécessaire.
pub const SP_ERR_TOO_SMALL: i32 = -1_000_002;
/// Entrée illisible (spécification d'encres mal formée, dimensions nulles…).
pub const SP_ERR_BAD_INPUT: i32 = -1_000_003;
/// Tampon d'entrée plus court que ce qu'annoncent les dimensions.
pub const SP_ERR_SHORT_INPUT: i32 = -1_000_004;

// ─────────────────────────── mémoire ───────────────────────────

/// Alignement de toute allocation rendue par [`sp_alloc`].
///
/// Huit octets, comme l'ABI C : c'est ce qui permet aux sorties d'être des
/// `u32` ou des `f64` sans risque d'écriture sur un pointeur mal aligné (ce qui
/// serait un comportement indéfini en Rust, et un piège classique des
/// frontières WebAssembly).
const SP_ALIGN: usize = 8;

/// Alloue `len` octets (alignés sur [`SP_ALIGN`]) et renvoie leur adresse.
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
    if ptr.is_null() || len == 0 {
        return;
    }
    if let Ok(layout) = Layout::from_size_align(len, SP_ALIGN) {
        unsafe { dealloc(ptr, layout) };
    }
}

// ─────────────────────────── version ───────────────────────────

/// Version majeure du noyau (issue de `Cargo.toml`).
#[no_mangle]
pub extern "C" fn sp_version_major() -> u32 {
    env!("CARGO_PKG_VERSION_MAJOR").parse().unwrap_or(0)
}

/// Version mineure du noyau.
#[no_mangle]
pub extern "C" fn sp_version_minor() -> u32 {
    env!("CARGO_PKG_VERSION_MINOR").parse().unwrap_or(0)
}

/// Version corrective du noyau.
#[no_mangle]
pub extern "C" fn sp_version_patch() -> u32 {
    env!("CARGO_PKG_VERSION_PATCH").parse().unwrap_or(0)
}

// ─────────────────────────── unités ───────────────────────────

/// Millimètres → points PostScript.
#[no_mangle]
pub extern "C" fn sp_mm_to_pt(mm: f64) -> f64 {
    units::mm_to_pt(mm)
}

/// Points PostScript → millimètres.
#[no_mangle]
pub extern "C" fn sp_pt_to_mm(pt: f64) -> f64 {
    units::pt_to_mm(pt)
}

/// Millimètres → pixels, à la résolution donnée.
#[no_mangle]
pub extern "C" fn sp_mm_to_px(mm: f64, dpi: f64) -> f64 {
    units::mm_to_px(mm, dpi)
}

/// Pixels → millimètres, à la résolution donnée.
#[no_mangle]
pub extern "C" fn sp_px_to_mm(px: f64, dpi: f64) -> f64 {
    units::px_to_mm(px, dpi)
}

// ─────────────────────────── couleurs sur octets ───────────────────────────

/// Convertit `n` pixels RVB (`3·n` octets) en CMJN (`4·n` octets).
///
/// # Safety
///
/// `src` doit pointer sur au moins `3·n` octets lisibles et `dst` sur au moins
/// `4·n` octets inscriptibles ; les deux zones ne doivent pas se recouvrir.
#[no_mangle]
pub unsafe extern "C" fn sp_rgb_to_cmyk(src: *const u8, dst: *mut u8, n: usize) -> i32 {
    let Some(input) = (unsafe { as_slice(src, n.saturating_mul(3)) }) else {
        return SP_ERR_NULL;
    };
    let Some(output) = (unsafe { as_slice_mut(dst, n.saturating_mul(4)) }) else {
        return SP_ERR_NULL;
    };
    color8::rgb_to_cmyk(input, output, n);
    0
}

/// Convertit `n` pixels CMJN (`4·n` octets) en RVB (`3·n` octets).
///
/// # Safety
///
/// `src` doit pointer sur au moins `4·n` octets lisibles et `dst` sur au moins
/// `3·n` octets inscriptibles ; les deux zones ne doivent pas se recouvrir.
#[no_mangle]
pub unsafe extern "C" fn sp_cmyk_to_rgb(src: *const u8, dst: *mut u8, n: usize) -> i32 {
    let Some(input) = (unsafe { as_slice(src, n.saturating_mul(4)) }) else {
        return SP_ERR_NULL;
    };
    let Some(output) = (unsafe { as_slice_mut(dst, n.saturating_mul(3)) }) else {
        return SP_ERR_NULL;
    };
    color8::cmyk_to_rgb(input, output, n);
    0
}

/// Réduit `n` pixels RVB (`3·n` octets) en luminance (`n` octets).
///
/// C'est le passage en niveaux de gris **avant** une planche noir et blanc : un
/// pixel sur un octet au lieu de trois, donc une image trois fois plus légère.
///
/// # Safety
///
/// `src` doit pointer sur au moins `3·n` octets lisibles et `dst` sur au moins
/// `n` octets inscriptibles.
#[no_mangle]
pub unsafe extern "C" fn sp_luma_rgb(src: *const u8, dst: *mut u8, n: usize) -> i32 {
    let Some(input) = (unsafe { as_slice(src, n.saturating_mul(3)) }) else {
        return SP_ERR_NULL;
    };
    let Some(output) = (unsafe { as_slice_mut(dst, n) }) else {
        return SP_ERR_NULL;
    };
    for (i, slot) in output.iter_mut().enumerate() {
        let p = i * 3;
        *slot = Rgb::new(input[p], input[p + 1], input[p + 2]).luma();
    }
    0
}

// ─────────────────────────── filtre RunLength ───────────────────────────

/// Encode `src_len` octets avec le filtre PDF *RunLength* dans `dst`.
///
/// Renvoie le nombre d'octets écrits, ou [`SP_ERR_TOO_SMALL`] accompagné de la
/// taille nécessaire dans `out_len`.
///
/// # Safety
///
/// `src` doit pointer sur `src_len` octets lisibles ; `dst` sur `dst_cap`
/// octets inscriptibles ; `out_len` sur un `u32` inscriptible.
#[no_mangle]
pub unsafe extern "C" fn sp_run_length_encode(
    src: *const u8,
    src_len: usize,
    dst: *mut u8,
    dst_cap: usize,
    out_len: *mut u32,
) -> i32 {
    let Some(input) = (unsafe { as_slice(src, src_len) }) else {
        return SP_ERR_NULL;
    };
    if out_len.is_null() {
        return SP_ERR_NULL;
    }
    let encoded = compress::run_length_encode(input);
    unsafe { *out_len = encoded.len() as u32 };
    unsafe { copy_out(&encoded, dst, dst_cap) }
}

/// Décode un flux *RunLength*.
///
/// Renvoie le nombre d'octets écrits, ou [`SP_ERR_BAD_INPUT`] si le flux est
/// tronqué (un flux corrompu ne doit pas produire une image silencieusement
/// décalée).
///
/// # Safety
///
/// Mêmes exigences que [`sp_run_length_encode`].
#[no_mangle]
pub unsafe extern "C" fn sp_run_length_decode(
    src: *const u8,
    src_len: usize,
    dst: *mut u8,
    dst_cap: usize,
    out_len: *mut u32,
) -> i32 {
    let Some(input) = (unsafe { as_slice(src, src_len) }) else {
        return SP_ERR_NULL;
    };
    if out_len.is_null() {
        return SP_ERR_NULL;
    }
    match compress::run_length_decode(input) {
        Some(decoded) => {
            unsafe { *out_len = decoded.len() as u32 };
            unsafe { copy_out(&decoded, dst, dst_cap) }
        }
        None => SP_ERR_BAD_INPUT,
    }
}

// ─────────────────────────── réduction d'image ───────────────────────────

/// Taille à viser pour ramener une image de `current_dpi` à `target_dpi`.
///
/// N'**agrandit jamais** : si l'image est déjà à la cible ou en dessous, ses
/// dimensions sont renvoyées inchangées.
///
/// # Safety
///
/// `out_w` et `out_h` doivent pointer sur des `u32` inscriptibles.
#[no_mangle]
pub unsafe extern "C" fn sp_target_size_for_dpi(
    width_px: u32,
    height_px: u32,
    current_dpi: f64,
    target_dpi: f64,
    out_w: *mut u32,
    out_h: *mut u32,
) -> i32 {
    if out_w.is_null() || out_h.is_null() {
        return SP_ERR_NULL;
    }
    let (w, h) = resample::target_size_for_dpi(width_px, height_px, current_dpi, target_dpi);
    unsafe {
        *out_w = w;
        *out_h = h;
    }
    0
}

/// Réduit une image RVB par **interpolation bilinéaire**.
///
/// # Safety
///
/// `src` doit pointer sur `src_w·src_h·3` octets lisibles et `dst` sur
/// `dst_w·dst_h·3` octets inscriptibles ; les zones ne doivent pas se recouvrir.
#[no_mangle]
pub unsafe extern "C" fn sp_downscale_bilinear_rgb(
    src: *const u8,
    src_w: u32,
    src_h: u32,
    dst: *mut u8,
    dst_w: u32,
    dst_h: u32,
) -> i32 {
    let Some(input) = (unsafe { as_slice(src, pixel_bytes(src_w, src_h, 3)) }) else {
        return SP_ERR_NULL;
    };
    let Some(output) = (unsafe { as_slice_mut(dst, pixel_bytes(dst_w, dst_h, 3)) }) else {
        return SP_ERR_NULL;
    };
    let Ok(image) = RgbImage::from_data(src_w, src_h, input.to_vec()) else {
        return SP_ERR_BAD_INPUT;
    };
    let reduced = resample::downscale_bilinear(&image, dst_w, dst_h);
    output.copy_from_slice(reduced.data());
    0
}

/// Réduit une image RVB par **plus proche voisin** (plus rapide, plus dur).
///
/// # Safety
///
/// Mêmes exigences que [`sp_downscale_bilinear_rgb`].
#[no_mangle]
pub unsafe extern "C" fn sp_downscale_nearest_rgb(
    src: *const u8,
    src_w: u32,
    src_h: u32,
    dst: *mut u8,
    dst_w: u32,
    dst_h: u32,
) -> i32 {
    let Some(input) = (unsafe { as_slice(src, pixel_bytes(src_w, src_h, 3)) }) else {
        return SP_ERR_NULL;
    };
    let Some(output) = (unsafe { as_slice_mut(dst, pixel_bytes(dst_w, dst_h, 3)) }) else {
        return SP_ERR_NULL;
    };
    let Ok(image) = RgbImage::from_data(src_w, src_h, input.to_vec()) else {
        return SP_ERR_BAD_INPUT;
    };
    let reduced = resample::downscale_nearest(&image, dst_w, dst_h);
    output.copy_from_slice(reduced.data());
    0
}

// ─────────────────────────── écriture PDF ───────────────────────────

/// Écrit une page PDF portant les encres directes décrites par `inks`.
///
/// `inks` pointe sur une chaîne UTF-8 (longueur `inks_len`) de lignes séparées
/// par `\n`, champs séparés par `\t` :
///
/// ```text
/// cmyk<TAB>PANTONE WARM RED C<TAB>0<TAB>900<TAB>800<TAB>0     (pour mille)
/// rgb<TAB>PANTONE 300 C<TAB>0<TAB>94<TAB>184                  (0–255)
/// gray<TAB>RICHTIG SCHWARZ<TAB>0                             (0–255)
/// ```
///
/// `quadri` choisit la couche de procédé : `0` = CMJN, `1` = RVB.
///
/// Renvoie le nombre d'octets écrits, ou [`SP_ERR_TOO_SMALL`] en renseignant
/// `out_len` avec la taille nécessaire (protocole en deux passes).
///
/// # Safety
///
/// `inks` doit pointer sur `inks_len` octets lisibles ; `dst` sur `dst_cap`
/// octets inscriptibles ; `out_len` sur un `u32` inscriptible.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn sp_write_spot_page(
    trim_w_mm: f64,
    trim_h_mm: f64,
    bleed_mm: f64,
    mark_mm: f64,
    quadri: u32,
    inks: *const u8,
    inks_len: usize,
    dst: *mut u8,
    dst_cap: usize,
    out_len: *mut u32,
) -> i32 {
    let Some(spec) = (unsafe { as_slice(inks, inks_len) }) else {
        return SP_ERR_NULL;
    };
    if out_len.is_null() {
        return SP_ERR_NULL;
    }
    let Some(stack) = parse_inks(spec, quadri) else {
        return SP_ERR_BAD_INPUT;
    };
    let page = write_spot_page(
        PageSize::new(trim_w_mm, trim_h_mm),
        bleed_mm,
        mark_mm,
        &stack,
    );
    unsafe { *out_len = page.len() as u32 };
    unsafe { copy_out(&page, dst, dst_cap) }
}

/// Écrit une page PDF portant une **image en niveaux de gris** et les encres
/// directes décrites par `inks` (même syntaxe que [`sp_write_spot_page`]).
///
/// `filter` : `0` = aucun, `1` = RunLength forcé, `2` = RunLength **seulement
/// s'il fait gagner des octets** (le réglage recommandé).
///
/// L'appelant doit avoir **réduit** l'image avant de la confier ici : cette
/// fonction l'encode, elle ne devine pas la résolution utile.
///
/// # Safety
///
/// `inks` sur `inks_len` octets, `gray` sur `img_w·img_h` octets, `dst` sur
/// `dst_cap` octets, `out_len` sur un `u32` inscriptible.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn sp_write_spot_page_gray(
    trim_w_mm: f64,
    trim_h_mm: f64,
    bleed_mm: f64,
    mark_mm: f64,
    quadri: u32,
    filter: u32,
    inks: *const u8,
    inks_len: usize,
    gray: *const u8,
    img_w: u32,
    img_h: u32,
    dst: *mut u8,
    dst_cap: usize,
    out_len: *mut u32,
) -> i32 {
    let Some(spec) = (unsafe { as_slice(inks, inks_len) }) else {
        return SP_ERR_NULL;
    };
    let Some(pixels) = (unsafe { as_slice(gray, pixel_bytes(img_w, img_h, 1)) }) else {
        return SP_ERR_NULL;
    };
    if out_len.is_null() {
        return SP_ERR_NULL;
    }
    let Some(stack) = parse_inks(spec, quadri) else {
        return SP_ERR_BAD_INPUT;
    };
    let filter = match filter {
        0 => ImageFilter::None,
        1 => ImageFilter::RunLengthDecode,
        2 => ImageFilter::Auto,
        _ => return SP_ERR_BAD_INPUT,
    };
    let Ok(image) = GrayImage::from_data(img_w, img_h, pixels.to_vec()) else {
        return SP_ERR_BAD_INPUT;
    };
    let xobject = ImageXObject::from_gray(&image, filter);
    let page = write_spot_page_with_image(
        PageSize::new(trim_w_mm, trim_h_mm),
        bleed_mm,
        mark_mm,
        &stack,
        &xobject,
    );
    unsafe { *out_len = page.len() as u32 };
    unsafe { copy_out(&page, dst, dst_cap) }
}

// ─────────────────────────── utilitaires internes ───────────────────────────

/// Longueur en octets d'une image, en **saturant** pour ne pas boucler autour.
fn pixel_bytes(width: u32, height: u32, channels: usize) -> usize {
    (width as usize)
        .saturating_mul(height as usize)
        .saturating_mul(channels)
}

/// Construit une tranche en lecture, ou `None` si le pointeur est nul.
///
/// # Safety
///
/// `ptr` doit désigner `len` octets lisibles (ou `len` valant zéro).
unsafe fn as_slice<'a>(ptr: *const u8, len: usize) -> Option<&'a [u8]> {
    if len == 0 {
        return Some(&[]);
    }
    if ptr.is_null() {
        return None;
    }
    Some(unsafe { slice::from_raw_parts(ptr, len) })
}

/// Construit une tranche en écriture, ou `None` si le pointeur est nul.
///
/// # Safety
///
/// `ptr` doit désigner `len` octets inscriptibles (ou `len` valant zéro), et
/// n'être partagé avec aucune autre référence vivante.
unsafe fn as_slice_mut<'a>(ptr: *mut u8, len: usize) -> Option<&'a mut [u8]> {
    if len == 0 {
        return Some(&mut []);
    }
    if ptr.is_null() {
        return None;
    }
    Some(unsafe { slice::from_raw_parts_mut(ptr, len) })
}

/// Recopie `bytes` dans le tampon de l'appelant, ou signale qu'il est trop petit.
///
/// # Safety
///
/// `dst` doit désigner `dst_cap` octets inscriptibles.
unsafe fn copy_out(bytes: &[u8], dst: *mut u8, dst_cap: usize) -> i32 {
    if bytes.len() > dst_cap {
        return SP_ERR_TOO_SMALL;
    }
    if bytes.is_empty() {
        return 0;
    }
    if dst.is_null() {
        return SP_ERR_NULL;
    }
    unsafe { ptr::copy_nonoverlapping(bytes.as_ptr(), dst, bytes.len()) };
    bytes.len() as i32
}

/// Lit la spécification d'encres et en fait une pile de couleurs.
///
/// Renvoie `None` dès qu'une ligne est mal formée, plutôt que d'ignorer
/// silencieusement une encre : une plaque manquante est un défaut
/// d'impression, pas une approximation.
fn parse_inks(spec: &[u8], quadri: u32) -> Option<ColorStack> {
    let text = core::str::from_utf8(spec).ok()?;
    let quadri = match quadri {
        0 => QuadriSpace::Cmyk,
        1 => QuadriSpace::Rgb,
        _ => return None,
    };

    let mut inks = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let f: Vec<&str> = line.split('\t').map(str::trim).collect();
        let ink = match f.first().copied()? {
            "cmyk" if f.len() == 6 => {
                let (c, m, y, k) = (
                    per_mille(f[2])?,
                    per_mille(f[3])?,
                    per_mille(f[4])?,
                    per_mille(f[5])?,
                );
                SpotInk::new(f[1], AlternateSpace::Cmyk(Cmyk { c, m, y, k })).ok()?
            }
            "rgb" if f.len() == 5 => {
                let (r, g, b) = (byte255(f[2])?, byte255(f[3])?, byte255(f[4])?);
                SpotInk::new(f[1], AlternateSpace::Rgb(Rgb::new(r, g, b))).ok()?
            }
            "gray" if f.len() == 3 => {
                SpotInk::new(f[1], AlternateSpace::Gray(byte255(f[2])?)).ok()?
            }
            _ => return None,
        };
        inks.push(ink);
    }
    ColorStack::with_spots(quadri, inks).ok()
}

/// Lit un pourcentage pour mille (0–1000) et le normalise en 0,0–1,0.
fn per_mille(raw: &str) -> Option<f64> {
    let value: u32 = raw.parse().ok()?;
    if value > 1000 {
        return None;
    }
    Some(f64::from(value) / 1000.0)
}

/// Lit un octet 0–255.
fn byte255(raw: &str) -> Option<u8> {
    raw.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Le protocole d'allocation doit rendre un bloc utilisable et réutilisable.
    #[test]
    fn allocation_et_liberation() {
        let p = sp_alloc(64);
        assert!(!p.is_null(), "sp_alloc(64) doit rendre un bloc");
        assert_eq!(p as usize % 8, 0, "l'allocation doit etre alignee sur 8");
        unsafe { sp_free(p, 64) };
        assert!(sp_alloc(0).is_null(), "une allocation nulle n'alloue rien");
    }

    /// Aller-retour RVB → CMJN → RVB au travers de la frontière C.
    #[test]
    fn frontiere_rvb_cmjn_aller_retour() {
        let n = 8usize;
        let source: Vec<u8> = (0..n)
            .flat_map(|i| {
                let v = (i * 31) as u8;
                [v, v.wrapping_add(40), v.wrapping_add(80)]
            })
            .collect();
        let mut cmyk = vec![0u8; n * 4];
        let mut retour = vec![0u8; n * 3];
        let code = unsafe { sp_rgb_to_cmyk(source.as_ptr(), cmyk.as_mut_ptr(), n) };
        assert_eq!(code, 0);
        let code = unsafe { sp_cmyk_to_rgb(cmyk.as_ptr(), retour.as_mut_ptr(), n) };
        assert_eq!(code, 0);
        assert_eq!(retour, source, "l'aller-retour doit revenir au bit près");
    }

    /// Le filtre RunLength traverse la frontière et se relit à l'identique.
    #[test]
    fn frontiere_run_length() {
        let source = vec![9u8; 500];
        // Un run répété vaut au plus 128 octets : 500 octets font donc 4 runs,
        // chacun en 2 octets (l'octet de longueur + l'octet répété).
        let runs = source.len().div_ceil(128);
        let attendu = runs * 2;

        let mut encoded = vec![0u8; 64];
        let mut len = 0u32;
        let code = unsafe {
            sp_run_length_encode(
                source.as_ptr(),
                source.len(),
                encoded.as_mut_ptr(),
                encoded.len(),
                &mut len,
            )
        };
        assert_eq!(code as usize, attendu, "{runs} run(s) attendu(s)");
        assert_eq!(len as usize, attendu);

        let mut decoded = vec![0u8; 500];
        let mut out = 0u32;
        let code = unsafe {
            sp_run_length_decode(
                encoded.as_ptr(),
                len as usize,
                decoded.as_mut_ptr(),
                decoded.len(),
                &mut out,
            )
        };
        assert_eq!(code, 500);
        assert_eq!(out, 500);
        assert_eq!(decoded, source);
    }

    /// Le protocole en deux passes : petit tampon → erreur + taille, puis écriture.
    #[test]
    fn frontiere_pdf_deux_passes() {
        let spec = b"cmyk\tPANTONE WARM RED C\t0\t900\t800\t0";
        let mut besoin = 0u32;
        let code = unsafe {
            sp_write_spot_page(
                170.0,
                240.0,
                3.0,
                10.0,
                0,
                spec.as_ptr(),
                spec.len(),
                ptr::null_mut(),
                0,
                &mut besoin,
            )
        };
        assert_eq!(
            code, SP_ERR_TOO_SMALL,
            "un tampon vide doit signaler la taille"
        );
        assert!(besoin > 100, "un PDF fait plus de 100 octets : {besoin}");

        let mut page = vec![0u8; besoin as usize];
        let mut ecrit = 0u32;
        let code = unsafe {
            sp_write_spot_page(
                170.0,
                240.0,
                3.0,
                10.0,
                0,
                spec.as_ptr(),
                spec.len(),
                page.as_mut_ptr(),
                page.len(),
                &mut ecrit,
            )
        };
        assert_eq!(code, besoin as i32);
        assert!(
            page.starts_with(b"%PDF-"),
            "la sortie doit commencer par %PDF-"
        );
        assert!(page.ends_with(b"%%EOF\n") || page.ends_with(b"%%EOF"));
    }

    /// Une encre mal formée est refusée, jamais ignorée.
    #[test]
    fn encre_mal_formee_refusee() {
        assert!(parse_inks(b"cmyk\tOK\t0\t0\t0\t0", 0).is_some());
        assert!(parse_inks(b"cmyk\tTROUEE", 0).is_none(), "ligne incomplète");
        assert!(
            parse_inks(b"cmyk\tOK\t0\t0\t0\t9999", 0).is_none(),
            "pour mille hors bornes"
        );
        assert!(
            parse_inks(b"bogus\tOK\t0\t0\t0\t0", 0).is_none(),
            "espace inconnu"
        );
        assert!(parse_inks(b"", 7).is_none(), "quadri inconnue");
    }
}
