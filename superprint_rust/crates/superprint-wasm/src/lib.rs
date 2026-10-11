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
use std::sync::Mutex;

use superprint_core::color8;
use superprint_core::{units, Cmyk, PageSize, Rgb};
use superprint_font::FontFace;
use superprint_image::{compress, resample, GrayImage, RgbImage};
use superprint_pdf::colorspace::{ColorStack, QuadriSpace};
use superprint_pdf::doc::{write_spot_page, write_spot_page_with_image};
use superprint_pdf::document::{ColorValue, Document, Op, OutputIntent, Page, Paint, Path};
use superprint_pdf::image::{ImageFilter, ImageXObject};
use superprint_pdf::spot::{AlternateSpace, SpotInk};
use superprint_text::{Cesure, Motifs};

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
        2 => ImageFilter::FlateDecode,
        3 => ImageFilter::Auto,
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

// ─────────────────── document : export PDF complet ───────────────────
//
// Les fonctions ci-dessus écrivent **une page de démonstration**. Celles-ci
// construisent un **document** : plusieurs pages, formes vectorielles, tons
// directs teintés, images placées, métadonnées et destination de sortie.
//
// ## État global, et pourquoi
//
// Un document est un objet qui se construit **par étapes** (les pages
// référencent des images déclarées plus tard, la page suivante ajoute ses
// encres…). Le passer par la frontière C à chaque appel demanderait de
// sérialiser puis reconstruire tout l'état à chaque fois.
//
// Le module garde donc **un seul document en cours**, comme un curseur :
// `sp_doc_reset` l'ouvre, les fonctions le remplissent, `sp_doc_write` le ferme.
// C'est cohérent avec l'usage réel — on exporte un document à la fois — et la
// frontière reste sans allocation d'objet côté appelant.
//
// `sp_doc_reset` doit être appelé **avant** de construire un nouveau document :
// les constructeurs ajoutent, ils ne remplacent pas.

/// Document en cours de construction. `None` tant que `sp_doc_reset` n'a pas
/// été appelé.
static DOC: Mutex<Option<Document>> = Mutex::new(None);

/// Ce que la dernière écriture a constaté sur le texte composé.
///
/// Un document peut être écrit et pourtant incomplet — si la police ne dessine
/// pas un caractère. Le taire serait le pire des services : l'imprimeur
/// recevrait un fichier apparemment bon avec un blanc au milieu du texte.
#[derive(Clone, Copy, Debug, Default)]
struct Rapport {
    /// Nombre de caractères remplacés par le glyphe « manquant ».
    substitues: u32,
}

/// Rapport de la dernière écriture, ou `None` si aucun document n'a été écrit.
static RAPPORT: Mutex<Option<Rapport>> = Mutex::new(None);

/// Prend le document en cours, ou `None` si aucun n'est ouvert.
fn with_doc<T>(action: impl FnOnce(&mut Document) -> T) -> Option<T> {
    // Un verrou empoisonné (panique survenue pendant un appel précédent) ne doit
    // pas condamner le module : on reprend la main sur l'état.
    let mut garde = DOC.lock().unwrap_or_else(|e| e.into_inner());
    garde.as_mut().map(action)
}

/// Ouvre un document vide et **abandonne** celui qui était en cours.
///
/// Renvoie `0`.
#[no_mangle]
pub extern "C" fn sp_doc_reset() -> i32 {
    let mut garde = DOC.lock().unwrap_or_else(|e| e.into_inner());
    *garde = Some(Document::new());
    // Le rapport de la dernière écriture concerne le document qu'on vient de
    // jeter : le garder ferait croire à un texte manquant dans le suivant.
    if let Ok(mut rapport) = RAPPORT.lock() {
        *rapport = None;
    }
    0
}

/// Nombre de pages déjà déclarées, ou un code d'erreur si aucun document n'est
/// ouvert.
#[no_mangle]
pub extern "C" fn sp_doc_page_count() -> i32 {
    match with_doc(|doc| doc.pages.len() as i32) {
        Some(n) => n,
        None => SP_ERR_BAD_INPUT,
    }
}

/// Active ou coupe les traits de coupe. `actif` : 0 ou 1.
#[no_mangle]
pub extern "C" fn sp_doc_marks(actif: u32) -> i32 {
    match with_doc(|doc| {
        doc.marks = actif != 0;
        0
    }) {
        Some(code) => code,
        None => SP_ERR_BAD_INPUT,
    }
}

/// Renseigne une métadonnée du document.
///
/// `cle` est un nom reconnu : `title`, `author`, `subject`, `keywords`,
/// `creator`, `producer`. Une clé inconnue est refusée plutôt qu'ignorée.
///
/// # Safety
///
/// `cle`/`valeur` doivent désigner leurs longueurs respectives en octets
/// lisibles.
#[no_mangle]
pub unsafe extern "C" fn sp_doc_info(
    cle: *const u8,
    cle_len: usize,
    valeur: *const u8,
    valeur_len: usize,
) -> i32 {
    let Some(nom) = (unsafe { as_slice(cle, cle_len) }) else {
        return SP_ERR_NULL;
    };
    let Some(texte) = (unsafe { as_slice(valeur, valeur_len) }) else {
        return SP_ERR_NULL;
    };
    let (Ok(nom), Ok(texte)) = (core::str::from_utf8(nom), core::str::from_utf8(texte)) else {
        return SP_ERR_BAD_INPUT;
    };
    // Une valeur vide efface le champ : c'est plus utile que de refuser.
    let texte = (!texte.trim().is_empty()).then(|| texte.to_string());
    match with_doc(|doc| {
        let champ = match nom.trim() {
            "title" => &mut doc.info.title,
            "author" => &mut doc.info.author,
            "subject" => &mut doc.info.subject,
            "keywords" => &mut doc.info.keywords,
            "creator" => &mut doc.info.creator,
            "producer" => &mut doc.info.producer,
            _ => return SP_ERR_BAD_INPUT,
        };
        // `None` efface explicitement le champ.
        *champ = texte;
        0
    }) {
        Some(code) => code,
        None => SP_ERR_BAD_INPUT,
    }
}

/// Ajoute une page et la rend **courante** : les encres et les opérations qui
/// suivent s'y rapportent.
///
/// `quadri` : `0` = CMJN, `1` = RVB. `bleed_mm` et `mark_mm` sont les marges
/// d'impression autour du format fini.
///
/// Renvoie le nombre de pages après ajout, ou un code d'erreur.
#[no_mangle]
pub extern "C" fn sp_doc_add_page(
    trim_w_mm: f64,
    trim_h_mm: f64,
    bleed_mm: f64,
    mark_mm: f64,
    quadri: u32,
) -> i32 {
    let espace = match quadri {
        0 => QuadriSpace::Cmyk,
        1 => QuadriSpace::Rgb,
        _ => return SP_ERR_BAD_INPUT,
    };
    if !(trim_w_mm.is_finite() && trim_h_mm.is_finite()) || trim_w_mm <= 0.0 || trim_h_mm <= 0.0 {
        return SP_ERR_BAD_INPUT;
    }
    match with_doc(|doc| {
        let page = Page::new(
            PageSize::new(trim_w_mm, trim_h_mm),
            bleed_mm.max(0.0),
            mark_mm.max(0.0),
            ColorStack::new(espace),
        );
        doc.add_page(page) as i32
    }) {
        Some(n) => n + 1,
        None => SP_ERR_BAD_INPUT,
    }
}

/// Déclare une encre directe sur la page **courante**.
///
/// La syntaxe est celle déjà employée par `sp_write_spot_page` :
///
/// ```text
/// cmyk<TAB>PANTONE WARM RED C<TAB>0<TAB>900<TAB>800<TAB>0
/// rgb<TAB>PANTONE 300 C<TAB>0<TAB>94<TAB>184
/// gray<TAB>RICHTIG SCHWARZ<TAB>0
/// ```
///
/// Renvoie le rang de l'encre dans la page, ou un code d'erreur. Un nom en
/// double est refusé : deux plaques identiques sont une erreur de composition.
///
/// # Safety
///
/// `spec` doit désigner `spec_len` octets lisibles.
#[no_mangle]
pub unsafe extern "C" fn sp_doc_add_ink(spec: *const u8, spec_len: usize) -> i32 {
    let Some(octets) = (unsafe { as_slice(spec, spec_len) }) else {
        return SP_ERR_NULL;
    };
    let Some(quire) = parse_ink_line(octets) else {
        return SP_ERR_BAD_INPUT;
    };
    match with_doc(|doc| match doc.pages.last_mut() {
        Some(page) => match page.stack.add_spot(quire) {
            Ok(()) => page.stack.spots().len() as i32 - 1,
            Err(_) => SP_ERR_BAD_INPUT,
        },
        None => SP_ERR_BAD_INPUT,
    }) {
        Some(code) => code,
        None => SP_ERR_BAD_INPUT,
    }
}

/// Enregistre une police embarquée et renvoie son rang.
///
/// `data` contient un fichier de police **TrueType** (`.ttf`) — ou OpenType à
/// contours TrueType. Les polices à contours CFF (`.otf`, `.otc`), comme les
/// collections `.ttc`, sont **refusées** : le format n'est pas lu, et prétendre
/// le contraire produirait un PDF dont le texte ne s'imprime pas.
///
/// La police est embarquée en entier : le sous-ensemble (ne garder que les
/// glyphes utilisés) n'est pas fait. Le fichier est plus lourd, mais aucun
/// glyphe ne peut manquer à l'impression.
///
/// Renvoie le rang de la police (à citer ensuite dans une ligne `text`), ou un
/// code d'erreur.
///
/// # Safety
///
/// `data` doit désigner `len` octets lisibles.
#[no_mangle]
pub unsafe extern "C" fn sp_doc_add_font(data: *const u8, len: usize) -> i32 {
    let Some(octets) = (unsafe { as_slice(data, len) }) else {
        return SP_ERR_NULL;
    };
    if octets.is_empty() {
        return SP_ERR_BAD_INPUT;
    }
    // L'analyse refuse un fichier tronqué ou d'un format non géré, sans
    // paniquer : une police illisible à la frontière doit être un code
    // d'erreur, pas un plantage du moteur.
    let Ok(face) = FontFace::parse(octets.to_vec()) else {
        return SP_ERR_BAD_INPUT;
    };
    match with_doc(|doc| doc.add_font(face) as i32) {
        Some(rang) => rang,
        None => SP_ERR_BAD_INPUT,
    }
}

/// Nombre de caractères que la **dernière** écriture n'a pas su dessiner.
///
/// Zéro veut dire « tout s'imprimera ». Toute autre valeur signale un texte
/// composé avec une police qui n'a pas les dessins voulus : le PDF est écrit,
/// mais il est incomplet — et il le dit.
#[no_mangle]
pub extern "C" fn sp_doc_substitues() -> i32 {
    match RAPPORT.lock() {
        Ok(garde) => garde.as_ref().map_or(0, |r| r.substitues as i32),
        Err(_) => 0,
    }
}

// ───────────────────────────── césure ─────────────────────────────
//
// La césure est appelée pour **chaque mot** d'un texte : c'est la fonction la
// plus sollicitée de la frontière. Deux conséquences sur sa forme :
//
//  1. les dictionnaires sont **chargés une fois** et gardés, plutôt que
//     reconstruits à chaque mot ;
//  2. la sortie est **binaire** (des indices de coupe en `u16`), pas du texte :
//     convertir des nombres en caractères pour les reconvertir aussitôt serait
//     du travail jeté, sur un chemin chaud.

/// Les dictionnaires chargés, un par langue.
static CESURES: Mutex<Vec<Cesure>> = Mutex::new(Vec::new());

/// Nombre de dictionnaires chargés.
#[no_mangle]
pub extern "C" fn sp_cesure_nombre() -> i32 {
    match CESURES.lock() {
        Ok(garde) => garde.len() as i32,
        Err(_) => SP_ERR_BAD_INPUT,
    }
}

/// Vide la liste des dictionnaires.
#[no_mangle]
pub extern "C" fn sp_cesure_reset() -> i32 {
    let mut garde = CESURES.lock().unwrap_or_else(|e| e.into_inner());
    garde.clear();
    0
}

/// Charge un dictionnaire de césure et renvoie son rang.
///
/// `spec` est le format texte lu par `Motifs::depuis_spec` : la ligne `!bornes`
/// y est **obligatoire**. Des bornes devinées décideraient de coupes que
/// personne n'a demandées — un dictionnaire sans bornes est donc refusé.
///
/// Un rang déjà attribué peut être écrasé en rechargeant : la colle s'en sert
/// pour remplacer un dictionnaire par un autre sans changer les références.
///
/// # Safety
///
/// `spec` doit désigner `spec_len` octets lisibles.
#[no_mangle]
pub unsafe extern "C" fn sp_cesure_charge(spec: *const u8, spec_len: usize) -> i32 {
    let Some(octets) = (unsafe { as_slice(spec, spec_len) }) else {
        return SP_ERR_NULL;
    };
    let Ok(texte) = core::str::from_utf8(octets) else {
        return SP_ERR_BAD_INPUT;
    };
    let Some(motifs) = Motifs::depuis_spec(texte) else {
        return SP_ERR_BAD_INPUT;
    };
    let mut garde = CESURES.lock().unwrap_or_else(|e| e.into_inner());
    garde.push(Cesure::dictionnaire(motifs));
    // Le rang dépasse `i32` si on a chargé deux milliards de dictionnaires :
    // impossible, mais la conversion reste vérifiée plutôt que supposée.
    i32::try_from(garde.len() - 1).unwrap_or(SP_ERR_BAD_INPUT)
}

/// Écrit les **positions de coupe** d'un mot, en indices de **points de code**.
///
/// La sortie est une suite de `u16` en petit-boutiste. Une position `p`
/// signifie : couper **après** le `p`-ᵉ caractère.
///
/// ⚠️ Les indices comptent des **points de code**, pas des unités UTF-16 : la
/// fonction appelante doit découper avec `Array.from(mot)` et non `mot[i]`.
/// Pour un caractère hors plan multilingue, les deux diffèrent — et la césure
/// ne s'applique de toute façon jamais à ces écritures.
///
/// Renvoie le nombre de coupes, ou `SP_ERR_TOO_SMALL` en renseignant `out_len`
/// avec la taille nécessaire (protocole en deux passes habituel).
///
/// # Safety
///
/// `mot` doit désigner `mot_len` octets lisibles ; `dst` `dst_cap` octets
/// inscriptibles ; `out_len` un `u32`.
#[no_mangle]
pub unsafe extern "C" fn sp_cesure_coupes(
    rang: u32,
    mot: *const u8,
    mot_len: usize,
    dst: *mut u8,
    dst_cap: usize,
    out_len: *mut u32,
) -> i32 {
    if out_len.is_null() {
        return SP_ERR_NULL;
    }
    let Some(octets) = (unsafe { as_slice(mot, mot_len) }) else {
        return SP_ERR_NULL;
    };
    let Ok(texte) = core::str::from_utf8(octets) else {
        return SP_ERR_BAD_INPUT;
    };
    let garde = CESURES.lock().unwrap_or_else(|e| e.into_inner());
    let Some(cesure) = garde.get(rang as usize) else {
        return SP_ERR_BAD_INPUT;
    };
    let Some(motifs) = cesure.motifs() else {
        // Un dictionnaire sans motifs ne coupe rien — ce n'est pas une erreur.
        unsafe { *out_len = 0 };
        return 0;
    };

    // Les positions sont filtrées, triées et dédoublonnées **exactement** comme
    // `motifs::decouper` le fait pour ses fragments : c'est cette égalité-là qui
    // garantit que la colle, qui découpe à ces positions, retrouve les fragments
    // que le dictionnaire seul aurait rendus. On lit `coupes` plutôt que
    // `fragments` parce que `fragments` alloue une chaîne par morceau, et
    // l'appelant n'a besoin que des positions.
    let caracteres = texte.chars().count();
    let mut positions: Vec<usize> = motifs
        .coupes(texte)
        .into_iter()
        .filter(|i| *i > 0 && *i < caracteres)
        .collect();
    positions.sort_unstable();
    positions.dedup();

    // Les positions vont par paires d'octets : on ne garde que celles qui
    // tiennent, plutôt que de tout refuser à cause d'une seule.
    let mut retenues = Vec::with_capacity(positions.len());
    for position in &positions {
        match u16::try_from(*position) {
            Ok(valeur) => retenues.push(valeur),
            // Un mot de plus de 65 535 caractères n'existe pas dans un texte
            // composé ; s'il arrive, on le refuse plutôt que de tronquer.
            Err(_) => return SP_ERR_BAD_INPUT,
        }
    }

    let besoin = retenues.len() * 2;
    unsafe { *out_len = besoin as u32 };
    if besoin > dst_cap {
        return SP_ERR_TOO_SMALL;
    }
    if retenues.is_empty() {
        return 0;
    }
    let Some(zone) = (unsafe { as_slice_mut(dst, besoin) }) else {
        return SP_ERR_NULL;
    };
    for (index, position) in retenues.iter().enumerate() {
        let octets = position.to_le_bytes();
        zone[index * 2] = octets[0];
        zone[index * 2 + 1] = octets[1];
    }
    positions.len() as i32
}

/// Ajoute une ou plusieurs opérations de dessin à la page courante.
///
/// `spec` contient **une ligne par opération**, champs séparés par une
/// tabulation. Les coordonnées sont en millimètres, dans le repère du **format
/// fini** : `(0, 0)` en bas à gauche, ordonnée croissante.
///
/// ```text
/// rect<TAB>X<TAB>Y<TAB>W<TAB>H<TAB>fill<TAB>0<TAB><PEINTURE>
/// rect<TAB>X<TAB>Y<TAB>W<TAB>H<TAB>stroke<TAB>EPAISSEUR<TAB><PEINTURE>
/// circle<TAB>CX<TAB>CY<TAB>R<TAB><fill|stroke><TAB>EPAISSEUR<TAB><PEINTURE>
/// polygon<TAB><fill|stroke><TAB>EPAISSEUR<TAB><PEINTURE><TAB>X1<TAB>Y1<TAB>X2<TAB>Y2…
/// line<TAB>X1<TAB>Y1<TAB>X2<TAB>Y2<TAB>stroke<TAB>EPAISSEUR<TAB><PEINTURE>
/// image<TAB>RANG<TAB>X<TAB>Y<TAB>W<TAB>H
/// text<TAB>POLICE<TAB>TAILLE_PT<TAB>X<TAB>Y<TAB><PEINTURE><TAB>LE_TEXTE
/// ```
///
/// Pour `text`, le texte est **le dernier champ et rien d'autre** : une
/// tabulation à l'intérieur, ou un champ en trop, fait refuser la ligne. Ses
/// espaces de début et de fin sont conservés — eux seuls comptent dans une
/// composition. Un `\\n` dans le texte vaut un passage à la ligne (l'interligne
/// valant 1,2 fois le corps) : le protocole étant ligne par ligne, un vrai
/// retour à la ligne terminerait la commande.
///
/// Le champ `EPAISSEUR` vaut `0` pour un remplissage : il est présent partout
/// pour que la lecture reste **de position fixe**, sans branchement.
///
/// La `<PEINTURE>` a toujours la même forme, selon son espace :
///
/// ```text
/// q4<TAB>C<TAB>M<TAB>Y<TAB>K      quadri CMJN, composantes pour mille (0–1000)
/// q3<TAB>R<TAB>G<TAB>B            quadri RVB, composantes 0–255
/// sp<TAB>RANG<TAB>TEINTE          encre directe, teinte pour mille (0–1000)
/// ```
///
/// Toute ligne illisible fait échouer **l'appel entier** : un document à moitié
/// dessiné serait pire qu'un document refusé.
///
/// Renvoie le nombre d'opérations ajoutées.
///
/// # Safety
///
/// `spec` doit désigner `spec_len` octets lisibles.
#[no_mangle]
pub unsafe extern "C" fn sp_doc_op(spec: *const u8, spec_len: usize) -> i32 {
    let Some(octets) = (unsafe { as_slice(spec, spec_len) }) else {
        return SP_ERR_NULL;
    };
    let Ok(texte) = core::str::from_utf8(octets) else {
        return SP_ERR_BAD_INPUT;
    };

    // Tout est analysé AVANT d'être appliqué : si la dernière ligne est
    // illisible, la page ne reçoit rien du tout.
    let mut operations = Vec::new();
    for ligne in texte.lines() {
        // On ne rogne **que** le début : les espaces de fin d'une ligne de texte
        // font partie de la composition, et un texte indenté en a aussi au
        // début. Les champs numériques, eux, sont rognés un par un à la lecture.
        let ligne = ligne.trim_start();
        if ligne.is_empty() {
            continue;
        }
        match parse_op(ligne) {
            Some(op) => operations.push(op),
            None => return SP_ERR_BAD_INPUT,
        }
    }
    if operations.is_empty() {
        return 0;
    }

    let ajoutees = operations.len() as i32;
    match with_doc(|doc| match doc.pages.last_mut() {
        Some(page) => {
            page.ops.extend(operations);
            0
        }
        None => SP_ERR_BAD_INPUT,
    }) {
        Some(0) => ajoutees,
        Some(code) => code,
        None => SP_ERR_BAD_INPUT,
    }
}

/// Enregistre une image en **niveaux de gris** (1 octet par pixel).
///
/// `filter` : `0` = aucun, `1` = RunLength forcé, `2` = Flate forcé,
/// `3` = choix automatique (le plus petit des trois).
/// s'il fait gagner des octets (recommandé).
///
/// Renvoie le rang de l'image, à utiliser dans une opération `image`. Elle doit
/// avoir été **réduite** au préalable : ce module l'encode, il ne devine pas la
/// résolution utile.
///
/// # Safety
///
/// `pixels` doit désigner `width·height` octets lisibles.
#[no_mangle]
pub unsafe extern "C" fn sp_doc_add_image_gray(
    pixels: *const u8,
    width: u32,
    height: u32,
    filter: u32,
) -> i32 {
    let Some(octets) = (unsafe { as_slice(pixels, pixel_bytes(width, height, 1)) }) else {
        return SP_ERR_NULL;
    };
    let Some(filtre) = parse_filter(filter) else {
        return SP_ERR_BAD_INPUT;
    };
    let Ok(image) = GrayImage::from_data(width, height, octets.to_vec()) else {
        return SP_ERR_BAD_INPUT;
    };
    match with_doc(|doc| doc.add_image(ImageXObject::from_gray(&image, filtre)) as i32) {
        Some(rang) => rang,
        None => SP_ERR_BAD_INPUT,
    }
}

/// Enregistre une image **RVB** (3 octets par pixel). Voir
/// [`sp_doc_add_image_gray`] pour le filtre et le rang.
///
/// # Safety
///
/// `pixels` doit désigner `width·height·3` octets lisibles.
#[no_mangle]
pub unsafe extern "C" fn sp_doc_add_image_rgb(
    pixels: *const u8,
    width: u32,
    height: u32,
    filter: u32,
) -> i32 {
    let Some(octets) = (unsafe { as_slice(pixels, pixel_bytes(width, height, 3)) }) else {
        return SP_ERR_NULL;
    };
    let Some(filtre) = parse_filter(filter) else {
        return SP_ERR_BAD_INPUT;
    };
    let Ok(image) = RgbImage::from_data(width, height, octets.to_vec()) else {
        return SP_ERR_BAD_INPUT;
    };
    match with_doc(|doc| doc.add_image(ImageXObject::from_rgb(&image, filtre)) as i32) {
        Some(rang) => rang,
        None => SP_ERR_BAD_INPUT,
    }
}

/// Déclare la **destination de sortie** : le profil ICC qui décrit l'espace
/// d'impression visé.
///
/// Les octets du profil sont écrits tels quels comme `/DestOutputProfile`. Aucun
/// profil n'est inventé : sans profil réel, il n'y a pas d'`OutputIntent`, et un
/// imprimeur ne peut pas savoir à quoi se rapporte le fichier.
///
/// `components` doit valoir 3 (RVB) ou 4 (CMJN).
///
/// # Safety
///
/// `identifiant`, `info` et `icc` doivent désigner leurs longueurs respectives.
#[no_mangle]
pub unsafe extern "C" fn sp_doc_output_intent(
    components: u32,
    identifiant: *const u8,
    identifiant_len: usize,
    info: *const u8,
    info_len: usize,
    icc: *const u8,
    icc_len: usize,
) -> i32 {
    let Some(nom) = (unsafe { as_slice(identifiant, identifiant_len) }) else {
        return SP_ERR_NULL;
    };
    let Some(description) = (unsafe { as_slice(info, info_len) }) else {
        return SP_ERR_NULL;
    };
    let Some(profil) = (unsafe { as_slice(icc, icc_len) }) else {
        return SP_ERR_NULL;
    };
    let (Ok(nom), Ok(description)) = (core::str::from_utf8(nom), core::str::from_utf8(description))
    else {
        return SP_ERR_BAD_INPUT;
    };
    // Le nombre de composantes est vérifié ici par le constructeur du document,
    // qui refuse un profil manifestement tronqué.
    let Some(components) = u8::try_from(components).ok() else {
        return SP_ERR_BAD_INPUT;
    };
    match with_doc(|doc| {
        doc.output_intent = Some(OutputIntent {
            icc: profil.to_vec(),
            components,
            identifier: nom.to_string(),
            info: description.to_string(),
        });
        0
    }) {
        Some(code) => code,
        None => SP_ERR_BAD_INPUT,
    }
}

/// Écrit le document en cours en PDF, dans le tampon de l'appelant.
///
/// Même protocole en deux passes que les autres fonctions d'écriture : appeler
/// une première fois avec un tampon vide rend [`SP_ERR_TOO_SMALL`] et renseigne
/// `out_len` avec la taille nécessaire.
///
/// Renvoie le nombre d'octets écrits. Le document **n'est pas** refermé : on
/// peut le réécrire, par exemple après avoir corrigé une métadonnée. Appeler
/// `sp_doc_reset` pour en commencer un autre.
///
/// # Safety
///
/// `dst` doit désigner `dst_cap` octets inscriptibles ; `out_len` un `u32`.
#[no_mangle]
pub unsafe extern "C" fn sp_doc_write(dst: *mut u8, dst_cap: usize, out_len: *mut u32) -> i32 {
    if out_len.is_null() {
        return SP_ERR_NULL;
    }
    let resultat = with_doc(|doc| doc.write_with_report());
    let Some(resultat) = resultat else {
        return SP_ERR_BAD_INPUT;
    };
    match resultat {
        Ok((pdf, usage)) => {
            // Le rapport est conservé : l'appelant peut ensuite demander si le
            // texte a été rendu en entier (voir `sp_doc_substitues`).
            if let Ok(mut garde) = RAPPORT.lock() {
                *garde = Some(Rapport {
                    substitues: usage.substitues as u32,
                });
            }
            unsafe { *out_len = pdf.len() as u32 };
            unsafe { copy_out(&pdf, dst, dst_cap) }
        }
        // Les refus du document (couleur incohérente, encre inconnue…) sont
        // remontés comme entrée illisible : l'appelant les distingue par le
        // message que son propre outillage affiche.
        Err(_) => SP_ERR_BAD_INPUT,
    }
}

/// Traduit un code de filtre reçu de la frontière.
fn parse_filter(code: u32) -> Option<ImageFilter> {
    match code {
        0 => Some(ImageFilter::None),
        1 => Some(ImageFilter::RunLengthDecode),
        2 => Some(ImageFilter::FlateDecode),
        3 => Some(ImageFilter::Auto),
        _ => None,
    }
}

/// Lit **une** ligne d'encre (même syntaxe que `sp_write_spot_page`).
fn parse_ink_line(octets: &[u8]) -> Option<SpotInk> {
    let texte = core::str::from_utf8(octets).ok()?;
    let f: Vec<&str> = texte
        .lines()
        .next()?
        .trim()
        .split('\t')
        .map(str::trim)
        .collect();
    match f.first().copied()? {
        "cmyk" if f.len() == 6 => {
            let (c, m, y, k) = (
                per_mille(f[2])?,
                per_mille(f[3])?,
                per_mille(f[4])?,
                per_mille(f[5])?,
            );
            SpotInk::new(f[1], AlternateSpace::Cmyk(Cmyk { c, m, y, k })).ok()
        }
        "rgb" if f.len() == 5 => {
            let (r, g, b) = (byte255(f[2])?, byte255(f[3])?, byte255(f[4])?);
            SpotInk::new(f[1], AlternateSpace::Rgb(Rgb::new(r, g, b))).ok()
        }
        "gray" if f.len() == 3 => SpotInk::new(f[1], AlternateSpace::Gray(byte255(f[2])?)).ok(),
        _ => None,
    }
}

/// Lit la peinture d'une opération à partir du champ `debut`.
///
/// Renvoie la peinture **et** le nombre de champs qu'elle a consommés : pour un
/// rectangle la peinture termine la ligne, pour un polygone elle est suivie des
/// sommets. La lecture doit donc savoir où elle s'arrête, sans quoi les deux cas
/// seraient indiscernables.
fn parse_paint(champs: &[&str], debut: usize) -> Option<(Paint, usize)> {
    let genre = champs.get(debut).copied()?;
    let consommes = match genre {
        "q4" => 5,
        "q3" => 4,
        "sp" => 3,
        _ => return None,
    };
    if champs.len() < debut + consommes {
        return None;
    }
    let paint = match genre {
        "q4" => Paint::Quadri(ColorValue::Cmyk(Cmyk {
            c: per_mille(champs[debut + 1])?,
            m: per_mille(champs[debut + 2])?,
            y: per_mille(champs[debut + 3])?,
            k: per_mille(champs[debut + 4])?,
        })),
        "q3" => Paint::Quadri(ColorValue::Rgb(Rgb::new(
            byte255(champs[debut + 1])?,
            byte255(champs[debut + 2])?,
            byte255(champs[debut + 3])?,
        ))),
        _ => Paint::Spot {
            index: champs[debut + 1].parse().ok()?,
            tint: per_mille(champs[debut + 2])?,
        },
    };
    Some((paint, consommes))
}

/// Lit une opération de dessin.
fn parse_op(ligne: &str) -> Option<Op> {
    // Le texte est le seul champ dont les espaces comptent : on l'isole avant
    // de découper, sinon `str::trim` mangerait les espaces de début et de fin
    // de la chaîne composée.
    if ligne.starts_with("text\t") {
        return parse_op_texte(ligne);
    }
    let c: Vec<&str> = ligne.split('\t').map(str::trim).collect();
    match c.first().copied()? {
        "rect" if c.len() >= 8 => {
            let path = Path::Rect {
                x: nombre_mm(c[1])?,
                y: nombre_mm(c[2])?,
                width: nombre_mm(c[3])?,
                height: nombre_mm(c[4])?,
            };
            peinture_ou_trait(path, &c, 5)
        }
        "circle" if c.len() >= 7 => {
            let path = Path::Circle {
                cx: nombre_mm(c[1])?,
                cy: nombre_mm(c[2])?,
                radius: nombre_mm(c[3])?,
            };
            peinture_ou_trait(path, &c, 4)
        }
        "line" if c.len() >= 8 => {
            let path = Path::Line {
                x1: nombre_mm(c[1])?,
                y1: nombre_mm(c[2])?,
                x2: nombre_mm(c[3])?,
                y2: nombre_mm(c[4])?,
            };
            peinture_ou_trait(path, &c, 5)
        }
        "polygon" if c.len() >= 8 => {
            let action = c[1];
            let epaisseur = nombre_mm(c[2])?;
            let (paint, consommes) = parse_paint(&c, 3)?;
            // Les sommets occupent tout le reste, par paires.
            let reste = &c[3 + consommes..];
            if reste.len() < 6 || reste.len() % 2 != 0 {
                return None;
            }
            let mut sommets = Vec::with_capacity(reste.len() / 2);
            for paire in reste.chunks(2) {
                sommets.push((nombre_mm(paire[0])?, nombre_mm(paire[1])?));
            }
            assembler(Path::Polygon(sommets), action, epaisseur, paint)
        }
        "image" if c.len() == 6 => Some(Op::Image {
            image: c[1].parse().ok()?,
            x: nombre_mm(c[2])?,
            y: nombre_mm(c[3])?,
            width: nombre_mm(c[4])?,
            height: nombre_mm(c[5])?,
        }),
        _ => None,
    }
}

/// Lit une ligne `text` : `text<TAB>POLICE<TAB>TAILLE_PT<TAB>X<TAB>Y<TAB><PEINTURE><TAB>TEXTE`.
///
/// Le texte est **le dernier champ et rien d'autre**. On coupe donc au
/// **dernier** séparateur — et non après un nombre fixe de champs — parce que la
/// peinture en occupe un nombre variable (3 pour `q3`, 6 pour `q4`). Une
/// tabulation dans le texte décalerait la coupe et la peinture ne serait plus
/// lisible jusqu'au bout : la ligne est alors refusée.
///
/// Dans le texte, `\\n` vaut un passage à la ligne et `\\\\` une barre oblique
/// inverse : le protocole est ligne par ligne, un vrai retour à la ligne y
/// terminerait la commande.
fn parse_op_texte(ligne: &str) -> Option<Op> {
    let (entete, texte) = ligne.rsplit_once('\t')?;
    let c: Vec<&str> = entete.split('\t').map(str::trim).collect();

    let police: usize = c.get(1)?.parse().ok()?;
    let taille_pt = nombre_mm(c.get(2)?)?;
    // `nombre_mm` a déjà écarté l'infini et le non-nombre : la comparaison
    // suffit donc à refuser un corps nul ou négatif.
    if taille_pt <= 0.0 {
        return None;
    }
    let x = nombre_mm(c.get(3)?)?;
    let y = nombre_mm(c.get(4)?)?;
    let (paint, consommes) = parse_paint(&c, 5)?;
    // La peinture doit terminer l'en-tête : un champ en trop signale un appel
    // mal formé, et un appel mal formé se refuse.
    if 5 + consommes != c.len() {
        return None;
    }

    Some(Op::Text {
        font: police,
        size_pt: taille_pt,
        x,
        y,
        paint,
        text: deplier_texte(texte),
    })
}

/// Déplie les échappements du champ texte (`\n`, `\\`).
///
/// Un caractère inconnu précédé d'une barre oblique est laissé tel quel : mieux
/// vaut composer un texte contenant une barre oblique visible que de perdre
/// silencieusement un caractère.
fn deplier_texte(brut: &str) -> String {
    let mut sortie = String::with_capacity(brut.len());
    let mut iter = brut.chars();
    while let Some(caractere) = iter.next() {
        if caractere != '\\' {
            sortie.push(caractere);
            continue;
        }
        match iter.next() {
            Some('n') => sortie.push('\n'),
            Some('\\') => sortie.push('\\'),
            Some(autre) => {
                sortie.push('\\');
                sortie.push(autre);
            }
            None => sortie.push('\\'),
        }
    }
    sortie
}

/// Lit `fill`/`stroke`, l'épaisseur et la peinture, puis construit l'opération.
///
/// Ici la peinture doit **terminer** la ligne : un champ en trop signale une
/// erreur d'appel, et un appel erroné doit être refusé plutôt qu'interprété de
/// travers.
fn peinture_ou_trait(path: Path, champs: &[&str], action_a: usize) -> Option<Op> {
    let action = champs.get(action_a).copied()?;
    let epaisseur = nombre_mm(champs.get(action_a + 1).copied()?)?;
    let (paint, consommes) = parse_paint(champs, action_a + 2)?;
    if action_a + 2 + consommes != champs.len() {
        return None;
    }
    assembler(path, action, epaisseur, paint)
}

/// Construit l'opération finale, en refusant une action inconnue.
fn assembler(path: Path, action: &str, epaisseur_mm: f64, paint: Paint) -> Option<Op> {
    match action {
        "fill" => Some(Op::Fill { path, paint }),
        "stroke" => Some(Op::Stroke {
            path,
            paint,
            width_mm: epaisseur_mm,
        }),
        _ => None,
    }
}

/// Lit un nombre fini destiné à une longueur en millimètres.
///
/// Refuse l'infini et les non-nombres : un `NaN` glissé dans un flux PDF
/// produirait un document que le RIP rejetterait sans explication.
fn nombre_mm(texte: &str) -> Option<f64> {
    let valeur: f64 = texte.parse().ok()?;
    valeur.is_finite().then_some(valeur)
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

    // ───────────────────── document : export complet ─────────────────────

    /// Écrit le document en cours par le protocole en deux passes.
    ///
    /// Renvoie les octets, ou un code d'erreur si la première passe n'annonce
    /// pas `SP_ERR_TOO_SMALL`.
    fn ecrire_document() -> Result<Vec<u8>, i32> {
        let mut besoin = 0u32;
        let premier = unsafe { sp_doc_write(ptr::null_mut(), 0, &mut besoin) };
        if premier != SP_ERR_TOO_SMALL {
            return Err(premier);
        }
        let mut tampon = vec![0u8; besoin as usize];
        let mut ecrit = 0u32;
        let code = unsafe { sp_doc_write(tampon.as_mut_ptr(), tampon.len(), &mut ecrit) };
        if code < 0 {
            return Err(code);
        }
        tampon.truncate(ecrit as usize);
        Ok(tampon)
    }

    /// Ajoute une ligne encodée en UTF-8 sur la page courante.
    fn op(ligne: &str) -> i32 {
        unsafe { sp_doc_op(ligne.as_ptr(), ligne.len()) }
    }

    /// Ajoute une encre encodée en UTF-8 sur la page courante.
    fn encre(ligne: &str) -> i32 {
        unsafe { sp_doc_add_ink(ligne.as_ptr(), ligne.len()) }
    }

    #[test]
    fn document_complet_de_bout_en_bout() {
        assert_eq!(sp_doc_reset(), 0);
        assert_eq!(sp_doc_page_count(), 0);

        // Première page : CMJN, deux encres directes, formes vectorielles.
        assert_eq!(sp_doc_add_page(170.0, 240.0, 3.0, 10.0, 0), 1);
        assert_eq!(encre("cmyk\tPANTONE WARM RED C\t0\t900\t800\t0"), 0);
        assert_eq!(encre("rgb\tPANTONE 300 C\t0\t94\t184"), 1);

        let operations = [
            "rect\t10\t20\t50\t30\tfill\t0\tsp\t0\t500",
            "rect\t10\t60\t50\t30\tstroke\t0.5\tq4\t0\t0\t0\t1000",
            "circle\t120\t60\t18\tfill\t0\tq4\t0\t900\t0\t0",
            "polygon\tfill\t0\tsp\t1\t1000\t20\t100\t60\t120\t50\t90\t20\t120",
            "line\t0\t200\t170\t200\tstroke\t0.25\tq4\t0\t0\t0\t1000",
        ]
        .join("\n");
        assert_eq!(op(&operations), 5, "cinq opérations attendues");

        // Deuxième page, RVB, sans encre directe.
        assert_eq!(sp_doc_add_page(100.0, 100.0, 0.0, 0.0, 1), 2);
        assert_eq!(op("rect\t0\t0\t100\t100\tfill\t0\tq3\t255\t0\t0"), 1);

        let titre = "Rapport (essai) — café";
        assert_eq!(
            unsafe { sp_doc_info(b"title".as_ptr(), 5, titre.as_ptr(), titre.len(),) },
            0
        );

        let pdf = ecrire_document().expect("document valide");
        let texte = String::from_utf8_lossy(&pdf);

        assert!(pdf.starts_with(b"%PDF-"));
        assert!(texte.trim_end().ends_with("%%EOF"));
        assert!(texte.contains("/Count 2"), "deux pages déclarées");
        assert_eq!(
            texte.matches("/Separation").count(),
            2,
            "deux encres directes"
        );
        assert!(texte.contains("/CS0 cs") && texte.contains("/CS1 cs"));
        assert!(texte.contains("0.5 scn"), "teinte à 50 % sur l'encre 0");
        assert!(texte.contains("1 scn"), "teinte pleine sur l'encre 1");
        assert!(texte.contains("/DeviceRGB"), "seconde page en RVB");
        assert!(texte.contains("/TrimBox") && texte.contains("/BleedBox"));
        // Le titre accentué ressort en PDFDocEncoding, pas en UTF-8.
        assert!(
            texte.contains("/Title (Rapport \\(essai\\) \\342\\200\\224 caf\\351)")
                || texte.contains("caf\\351"),
            "titre attendu en PDFDocEncoding ; trouvé : {}",
            texte
                .lines()
                .find(|l| l.contains("/Title"))
                .unwrap_or("(aucun)")
        );

        // Un document écrit deux fois doit être identique : aucun état caché.
        let deuxieme = ecrire_document().expect("document valide");
        assert_eq!(pdf, deuxieme, "l'écriture doit être déterministe");
    }

    #[test]
    fn document_avec_image_placee() {
        assert_eq!(sp_doc_reset(), 0);
        assert_eq!(sp_doc_add_page(100.0, 100.0, 0.0, 0.0, 0), 1);

        // Aplat 8 × 4 : RunLength doit le réduire fortement.
        let pixels = [200u8; 32];
        let rang = unsafe { sp_doc_add_image_gray(pixels.as_ptr(), 8, 4, 2) };
        assert_eq!(rang, 0, "première image au rang 0");

        assert_eq!(op("image\t0\t10\t20\t40\t20"), 1);
        assert_eq!(sp_doc_page_count(), 1);

        let pdf = ecrire_document().expect("document valide");
        let texte = String::from_utf8_lossy(&pdf);
        assert!(texte.contains("/Im0 Do"));
        assert!(texte.contains("/Subtype /Image"));
        assert!(texte.contains("/Width 8") && texte.contains("/Height 4"));
        assert!(texte.contains("/DeviceGray"));

        // Une image inexistante n'est détectable qu'à l'écriture : c'est le seul
        // moment où l'on sait combien d'images existent réellement.
        assert_eq!(sp_doc_reset(), 0);
        assert_eq!(sp_doc_add_page(100.0, 100.0, 0.0, 0.0, 0), 1);
        assert_eq!(op("image\t5\t0\t0\t10\t10"), 1, "l'opération est acceptée");
        assert_eq!(
            ecrire_document().unwrap_err(),
            SP_ERR_BAD_INPUT,
            "mais l'écriture doit refuser une image inconnue"
        );
    }

    #[test]
    fn document_sans_page_refuse() {
        assert_eq!(sp_doc_reset(), 0);
        assert_eq!(
            ecrire_document().unwrap_err(),
            SP_ERR_BAD_INPUT,
            "un document vide ne s'écrit pas"
        );
        assert_eq!(
            op("rect\t0\t0\t1\t1\tfill\t0\tq4\t0\t0\t0\t0"),
            SP_ERR_BAD_INPUT,
            "aucune page courante"
        );
        assert_eq!(encre("gray\tX\t0"), SP_ERR_BAD_INPUT);
    }

    #[test]
    fn document_refuse_les_entrees_illisibles() {
        assert_eq!(sp_doc_reset(), 0);
        assert_eq!(sp_doc_add_page(100.0, 100.0, 0.0, 0.0, 0), 1);

        // Une opération illisible fait échouer l'appel ENTIER : rien n'est ajouté.
        assert_eq!(
            op("rect\t0\t0\t1\t1\tfill\t0\tq4\t0\t0\t0\t0\nrect\tPAF"),
            SP_ERR_BAD_INPUT
        );
        assert_eq!(
            op("cercle\t0\t0\t1\tfill\t0\tq4\t0\t0\t0\t0"),
            SP_ERR_BAD_INPUT,
            "verbe inconnu"
        );
        assert_eq!(
            op("rect\t0\t0\tNaN\t1\tfill\t0\tq4\t0\t0\t0\t0"),
            SP_ERR_BAD_INPUT,
            "un NaN ne doit pas entrer dans un flux PDF"
        );
        assert_eq!(
            op("rect\t0\t0\t1\t1\tdessine\t0\tq4\t0\t0\t0\t0"),
            SP_ERR_BAD_INPUT,
            "action inconnue"
        );
        assert_eq!(
            op("polygon\tfill\t0\tq4\t0\t0\t0\t0"),
            SP_ERR_BAD_INPUT,
            "trop peu de sommets"
        );
        assert_eq!(
            encre("lab\tX\t1\t2\t3"),
            SP_ERR_BAD_INPUT,
            "espace de remplacement inconnu"
        );
        assert_eq!(sp_doc_add_page(0.0, 100.0, 0.0, 0.0, 0), SP_ERR_BAD_INPUT);
        assert_eq!(sp_doc_add_page(100.0, 100.0, 0.0, 0.0, 9), SP_ERR_BAD_INPUT);
        assert_eq!(
            unsafe { sp_doc_info(b"inexistant".as_ptr(), 10, b"x".as_ptr(), 1) },
            SP_ERR_BAD_INPUT,
            "clé de métadonnée inconnue"
        );
    }

    #[test]
    fn document_couleur_incoherente_refusee_a_l_ecriture() {
        assert_eq!(sp_doc_reset(), 0);
        assert_eq!(sp_doc_add_page(100.0, 100.0, 0.0, 0.0, 0), 1);
        // Page CMJN, forme peinte en RVB.
        assert_eq!(op("rect\t0\t0\t10\t10\tfill\t0\tq3\t255\t0\t0"), 1);
        assert_eq!(ecrire_document().unwrap_err(), SP_ERR_BAD_INPUT);
    }

    #[test]
    fn document_output_intent_et_marks() {
        assert_eq!(sp_doc_reset(), 0);
        assert_eq!(sp_doc_add_page(170.0, 240.0, 3.0, 10.0, 0), 1);

        // Profil factice mais de taille plausible (CMJN → au moins 512 octets).
        let profil = vec![3u8; 700];
        let code = unsafe {
            sp_doc_output_intent(
                4,
                b"FOGRA39".as_ptr(),
                7,
                b"Coated FOGRA39".as_ptr(),
                14,
                profil.as_ptr(),
                profil.len(),
            )
        };
        assert_eq!(code, 0);

        let avec = ecrire_document().expect("document valide");
        let texte = String::from_utf8_lossy(&avec);
        assert!(texte.contains("/GTS_PDFX"));
        assert!(texte.contains("/OutputConditionIdentifier (FOGRA39)"));
        assert!(texte.contains("/N 4"));
        assert!(texte.contains("/OutputIntents ["));

        // Couper les traits de coupe allège le flux.
        assert_eq!(sp_doc_marks(0), 0);
        let sans = ecrire_document().expect("document valide");
        assert!(
            sans.len() < avec.len(),
            "sans traits, le fichier est plus petit"
        );

        // Un profil trop court est refusé à l'écriture.
        assert_eq!(sp_doc_reset(), 0);
        assert_eq!(sp_doc_add_page(100.0, 100.0, 0.0, 0.0, 0), 1);
        let court = [0u8; 8];
        assert_eq!(
            unsafe {
                sp_doc_output_intent(
                    4,
                    b"X".as_ptr(),
                    1,
                    b"Y".as_ptr(),
                    1,
                    court.as_ptr(),
                    court.len(),
                )
            },
            0
        );
        assert_eq!(ecrire_document().unwrap_err(), SP_ERR_BAD_INPUT);
    }

    #[test]
    fn document_reset_abandonne_le_precedent() {
        assert_eq!(sp_doc_reset(), 0);
        assert_eq!(sp_doc_add_page(100.0, 100.0, 0.0, 0.0, 0), 1);
        // Page CMJN, forme peinte en RVB : le document ne peut pas s'écrire.
        assert_eq!(op("rect\t0\t0\t1\t1\tfill\t0\tq3\t0\t0\t0"), 1);
        assert_eq!(
            ecrire_document().unwrap_err(),
            SP_ERR_BAD_INPUT,
            "une forme RVB sur une page CMJN doit être refusée"
        );

        // Après reset, le document précédent ne doit laisser aucune trace.
        assert_eq!(sp_doc_reset(), 0);
        assert_eq!(sp_doc_page_count(), 0);
        assert_eq!(sp_doc_add_page(100.0, 100.0, 0.0, 0.0, 0), 1);
        let pdf = ecrire_document().expect("document valide");
        assert_eq!(
            String::from_utf8_lossy(&pdf)
                .matches("/Type /Page ")
                .count(),
            1
        );
    }

    #[test]
    fn document_sans_reset_prealable_est_refuse() {
        // On repart d'un état propre, puis on ferme le document.
        assert_eq!(sp_doc_reset(), 0);
        let mut garde = DOC.lock().unwrap_or_else(|e| e.into_inner());
        *garde = None;
        drop(garde);

        assert_eq!(sp_doc_page_count(), SP_ERR_BAD_INPUT);
        assert_eq!(sp_doc_add_page(100.0, 100.0, 0.0, 0.0, 0), SP_ERR_BAD_INPUT);
        assert_eq!(ecrire_document().unwrap_err(), SP_ERR_BAD_INPUT);
        // On laisse le module dans un état utilisable pour les autres tests.
        assert_eq!(sp_doc_reset(), 0);
    }

    // ───────────────────────── texte et polices ─────────────────────────

    /// Un fichier de police TrueType valide, fabriqué pour le test.
    fn police_synthetique() -> Vec<u8> {
        superprint_font::synth::construire(&superprint_font::synth::PoliceSynth::default())
    }

    /// Enregistre une police par la frontière C.
    fn ajouter_police(octets: &[u8]) -> i32 {
        unsafe { sp_doc_add_font(octets.as_ptr(), octets.len()) }
    }

    #[test]
    fn texte_complet_de_bout_en_bout() {
        assert_eq!(sp_doc_reset(), 0);
        assert_eq!(sp_doc_add_page(170.0, 240.0, 3.0, 10.0, 0), 1);

        let octets = police_synthetique();
        let rang = ajouter_police(&octets);
        assert_eq!(rang, 0, "première police au rang 0");

        // `text<TAB>POLICE<TAB>TAILLE_PT<TAB>X<TAB>Y<TAB><PEINTURE><TAB>TEXTE`
        // La police de test dessine «  », « A », « B », « a », « b » et « é » :
        // le texte est choisi là-dedans pour ne rien substituer.
        assert_eq!(
            op("text\t0\t12\t20\t200\tq4\t0\t0\t0\t1000\tAé B"),
            1,
            "une opération de texte"
        );

        let pdf = ecrire_document().expect("document valide");
        let flux = String::from_utf8_lossy(&pdf);

        // La chaîne embarquée : les cinq objets de police sont là.
        assert!(flux.contains("/Subtype /Type0"));
        assert!(flux.contains("/Encoding /Identity-H"));
        assert!(flux.contains("/Subtype /CIDFontType2"));
        assert!(flux.contains("/FontFile2 "));
        // La ressource de page cite la police.
        assert!(flux.contains("/Font << /F0 "), "ressources : {flux}");
        // Le texte part en identifiants de glyphe, pas en caractères.
        assert!(flux.contains(" Tj"), "opérateur Tj attendu");
        // Et la table qui rend le texte extractible est bien écrite.
        assert!(flux.contains("/ToUnicode ") && flux.contains("begincmap"));
        // Tous les caractères sont dessinés : rien à signaler.
        assert_eq!(sp_doc_substitues(), 0, "aucun caractère manquant");
    }

    #[test]
    fn texte_avec_un_caractere_absent_est_signale() {
        assert_eq!(sp_doc_reset(), 0);
        assert_eq!(sp_doc_add_page(100.0, 100.0, 0.0, 0.0, 0), 1);
        let octets = police_synthetique();
        assert_eq!(ajouter_police(&octets), 0);

        // « Z » n'est pas dans la police de test : le document s'écrit, mais il
        // doit le dire au lieu de laisser un blanc inexpliqué.
        assert_eq!(op("text\t0\t10\t10\t50\tq4\t0\t0\t0\t1000\tAZ"), 1);

        // Le rapport n'existe qu'après une écriture : c'est elle qui compose.
        let pdf = ecrire_document().expect("document écrit malgré tout");
        assert!(String::from_utf8_lossy(&pdf).contains("/Type /Page "));
        assert_eq!(sp_doc_substitues(), 1, "un caractère non dessiné");

        // La composition est déterministe : une seconde écriture du même
        // document redonne le même compte.
        assert!(ecrire_document().is_ok());
        assert_eq!(sp_doc_substitues(), 1);

        // Le rapport suit le document : après reset, plus rien à signaler.
        assert_eq!(sp_doc_reset(), 0);
        assert_eq!(sp_doc_substitues(), 0);
    }

    #[test]
    fn texte_refuse_sans_police() {
        assert_eq!(sp_doc_reset(), 0);
        assert_eq!(sp_doc_add_page(100.0, 100.0, 0.0, 0.0, 0), 1);
        // Police n° 3 jamais enregistrée : refus explicite à l'écriture.
        assert_eq!(op("text\t3\t10\t10\t50\tq4\t0\t0\t0\t1000\tA"), 1);
        assert_eq!(ecrire_document().unwrap_err(), SP_ERR_BAD_INPUT);
    }

    #[test]
    fn police_illisible_refusee_sans_paniquer() {
        assert_eq!(sp_doc_reset(), 0);
        assert_eq!(sp_doc_add_page(100.0, 100.0, 0.0, 0.0, 0), 1);

        // Fichier vide, en-tête inconnu, fichier tronqué : trois refus francs.
        assert_eq!(ajouter_police(&[]), SP_ERR_BAD_INPUT);
        assert_eq!(ajouter_police(b"JUNKJUNKJUNK"), SP_ERR_BAD_INPUT);
        let tronque = &police_synthetique()[..80];
        assert_eq!(ajouter_police(tronque), SP_ERR_BAD_INPUT);

        // Une police CFF (`OTTO`) n'est pas lue : on le dit au lieu d'embarquer
        // un programme que le lecteur PDF refuserait.
        assert_eq!(ajouter_police(b"OTTO\x00\x00\x00\x00"), SP_ERR_BAD_INPUT);
    }

    #[test]
    fn texte_mal_forme_refuse() {
        // Tabulation dans le texte : la ligne ne peut pas être découpée.
        assert!(parse_op("text\t0\t12\t20\t200\tq4\t0\t0\t0\t1000\tA\tB").is_none());
        // Champ en trop après le texte : refus plutôt qu'interprétation.
        assert!(parse_op("text\t0\t12\t20\t200\tq4\t0\t0\t0\t1000\tABC\tZ").is_none());
        // Corps nul ou négatif.
        assert!(parse_op("text\t0\t0\t20\t200\tq4\t0\t0\t0\t1000\tA").is_none());
        assert!(parse_op("text\t0\t-3\t20\t200\tq4\t0\t0\t0\t1000\tA").is_none());
        // Texte vide : la ligne reste lisible, mais n'ajoute rien au flux.
        assert!(parse_op("text\t0\t12\t20\t200\tq4\t0\t0\t0\t1000\t").is_some());
    }

    #[test]
    fn espaces_du_texte_conserves() {
        // Les espaces de début et de fin comptent en composition : le découpage
        // ne doit pas les rogner comme il rogne les champs numériques.
        let Some(Op::Text { text, .. }) =
            parse_op("text\t0\t12\t20\t200\tq4\t0\t0\t0\t1000\t  A B  ")
        else {
            panic!("la ligne de texte doit être lisible");
        };
        assert_eq!(text, "  A B  ");
    }

    #[test]
    fn retour_a_la_ligne_echappe() {
        // Deux lignes composées, l'interligne venant du corps.
        let Some(Op::Text { text, .. }) =
            parse_op("text\t0\t12\t20\t200\tq4\t0\t0\t0\t1000\tA\\nB")
        else {
            panic!("la ligne de texte doit être lisible");
        };
        assert_eq!(text, "A\nB", "\\n doit devenir un vrai retour à la ligne");

        // La barre oblique inverse elle-même s'échappe : `\\\\` vaut `\\`.
        let Some(Op::Text { text, .. }) =
            parse_op("text\t0\t12\t20\t200\tq4\t0\t0\t0\t1000\tC:\\\\tmp")
        else {
            panic!("la ligne de texte doit être lisible");
        };
        assert_eq!(text, "C:\\tmp");

        // Un échappement inconnu est laissé visible plutôt que mangé en silence.
        let Some(Op::Text { text, .. }) =
            parse_op("text\t0\t12\t20\t200\tq4\t0\t0\t0\t1000\t50\\%")
        else {
            panic!("la ligne de texte doit être lisible");
        };
        assert_eq!(text, "50\\%");
    }

    // ───────────────────────── césure ─────────────────────────

    /// Une spécification minimale, mais **complète** : sans la ligne `!bornes`
    /// le dictionnaire est refusé, donc les tests de succès doivent la porter.
    ///
    /// Les motifs sont volontairement minuscules : ce qui est vérifié ici est le
    /// **contrat de la frontière** (chargement, rangs, protocole en deux passes),
    /// pas la qualité linguistique des coupes — celle-ci est mesurée mot à mot
    /// contre Hypher par `scripts/validate-branchement.mjs`.
    const SPEC_MINIMALE: &str = "!bornes\t2\t3\n3\t1bi1bli1o1th1ha";

    /// Charger un dictionnaire rend son rang, et les rangs s'enchaînent.
    #[test]
    fn frontiere_cesure_chargement_et_rangs() {
        sp_cesure_reset();
        assert_eq!(sp_cesure_nombre(), 0);

        let spec = SPEC_MINIMALE.as_bytes();
        let premier = unsafe { sp_cesure_charge(spec.as_ptr(), spec.len()) };
        assert_eq!(premier, 0, "le premier dictionnaire prend le rang 0");
        let second = unsafe { sp_cesure_charge(spec.as_ptr(), spec.len()) };
        assert_eq!(second, 1, "le suivant prend le rang 1");
        assert_eq!(sp_cesure_nombre(), 2);

        // Deux dictionnaires qui partagent le même rang seraient un défaut
        // invisible : la seconde langue se couperait avec les motifs de la
        // première. C'est exactement ce que ce test verrouille.
        assert_ne!(premier, second);

        sp_cesure_reset();
        assert_eq!(sp_cesure_nombre(), 0, "la remise a zero vide la liste");
    }

    /// Un dictionnaire sans bornes est **refusé**, pas complété par des valeurs
    /// devinées : des bornes inventées décideraient de coupes non demandées.
    #[test]
    fn frontiere_cesure_spec_incomplete_refusee() {
        sp_cesure_reset();
        let sans_bornes = b"3\t1bi1bli1o";
        let code = unsafe { sp_cesure_charge(sans_bornes.as_ptr(), sans_bornes.len()) };
        assert_eq!(code, SP_ERR_BAD_INPUT);
        assert_eq!(
            sp_cesure_nombre(),
            0,
            "un refus ne doit rien laisser charge"
        );

        // Un texte qui n'est pas de l'UTF-8 valide est refusé aussi.
        let octets = [0xFFu8, 0xFE, 0xFD];
        assert_eq!(
            unsafe { sp_cesure_charge(octets.as_ptr(), octets.len()) },
            SP_ERR_BAD_INPUT
        );
    }

    /// Le protocole en deux passes : tampon vide → `SP_ERR_TOO_SMALL` + taille
    /// annoncée, puis écriture réelle.
    #[test]
    fn frontiere_cesure_deux_passes() {
        sp_cesure_reset();
        let spec = SPEC_MINIMALE.as_bytes();
        let rang = unsafe { sp_cesure_charge(spec.as_ptr(), spec.len()) };
        assert_eq!(rang, 0);

        let mot = "bibliothèque";
        let mut besoin = 0u32;
        let code = unsafe {
            sp_cesure_coupes(
                rang as u32,
                mot.as_ptr(),
                mot.len(),
                ptr::null_mut(),
                0,
                &mut besoin,
            )
        };
        assert_eq!(
            code, SP_ERR_TOO_SMALL,
            "un tampon vide doit signaler la taille"
        );
        assert!(besoin > 0, "« {mot} » doit avoir au moins une coupe");
        assert_eq!(besoin % 2, 0, "les positions sont des u16 : taille paire");

        let mut tampon = vec![0u8; besoin as usize];
        let mut ecrit = 0u32;
        let code = unsafe {
            sp_cesure_coupes(
                rang as u32,
                mot.as_ptr(),
                mot.len(),
                tampon.as_mut_ptr(),
                tampon.len(),
                &mut ecrit,
            )
        };
        assert_eq!(
            code as usize,
            (besoin / 2) as usize,
            "une position par coupe"
        );
        assert_eq!(ecrit, besoin);

        // Les positions doivent tomber **dans** le mot et être croissantes :
        // une position hors bornes ferait paniquer le découpage de l'appelant.
        let caracteres = mot.chars().count();
        let mut precedente = 0usize;
        for index in 0..ecrit as usize / 2 {
            let position = u16::from_le_bytes([tampon[index * 2], tampon[index * 2 + 1]]) as usize;
            assert!(position > precedente, "positions croissantes attendues");
            assert!(position < caracteres, "position {position} hors du mot");
            precedente = position;
        }
    }

    /// Les positions comptent des **points de code**, pas des unités UTF-16.
    /// C'est la seule chose que l'appelante doit savoir pour découper juste.
    #[test]
    fn frontiere_cesure_positions_en_points_de_code() {
        sp_cesure_reset();
        let spec = SPEC_MINIMALE.as_bytes();
        let rang = unsafe { sp_cesure_charge(spec.as_ptr(), spec.len()) };
        assert_eq!(rang, 0);

        // Un mot hors BMP placé après « bibliothèque » : en UTF-16 il compterait
        // pour deux unités, et toutes les positions suivantes seraient décalées.
        let mot = "bibliothèque𝄞";
        let mut besoin = 0u32;
        let code = unsafe {
            sp_cesure_coupes(
                rang as u32,
                mot.as_ptr(),
                mot.len(),
                ptr::null_mut(),
                0,
                &mut besoin,
            )
        };
        assert_eq!(code, SP_ERR_TOO_SMALL);

        let mut tampon = vec![0u8; besoin as usize];
        let mut ecrit = 0u32;
        assert!(
            unsafe {
                sp_cesure_coupes(
                    rang as u32,
                    mot.as_ptr(),
                    mot.len(),
                    tampon.as_mut_ptr(),
                    tampon.len(),
                    &mut ecrit,
                )
            } >= 0
        );

        let caracteres = mot.chars().count();
        let en_unites_utf16 = mot.encode_utf16().count();
        assert!(
            caracteres < en_unites_utf16,
            "le cas de test doit bien contenir un caractere hors BMP"
        );
        for index in 0..ecrit as usize / 2 {
            let position = u16::from_le_bytes([tampon[index * 2], tampon[index * 2 + 1]]) as usize;
            assert!(
                position < caracteres,
                "la position {position} doit se lire en points de code ({caracteres}), \
                 pas en unites UTF-16 ({en_unites_utf16})"
            );
        }
    }

    /// Un rang inconnu, une entrée nulle ou non UTF-8 : refus explicites.
    #[test]
    fn frontiere_cesure_refus() {
        sp_cesure_reset();
        let mot = "tableau";
        let mut besoin = 0u32;
        let mut tampon = vec![0u8; 64];

        assert_eq!(
            unsafe {
                sp_cesure_coupes(
                    7,
                    mot.as_ptr(),
                    mot.len(),
                    tampon.as_mut_ptr(),
                    tampon.len(),
                    &mut besoin,
                )
            },
            SP_ERR_BAD_INPUT,
            "un rang qui n'existe pas doit etre refuse"
        );

        let spec = SPEC_MINIMALE.as_bytes();
        let rang = unsafe { sp_cesure_charge(spec.as_ptr(), spec.len()) };
        assert_eq!(rang, 0);

        // Une chaine vide est un cas **legitime**, pas une erreur : c'est la
        // regle du contrat (`as_slice` accepte un pointeur nul des lors que la
        // longueur est nulle). Un mot vide n'a simplement aucune coupe.
        let mut vide = 0u32;
        assert_eq!(
            unsafe { sp_cesure_coupes(rang as u32, ptr::null(), 0, ptr::null_mut(), 0, &mut vide) },
            0,
            "un mot vide n'a pas de coupe, ce n'est pas un refus"
        );

        // Un pointeur nul avec une longueur non nulle, en revanche, est refuse :
        // on ne peut pas lire ce qui n'existe pas.
        assert_eq!(
            unsafe {
                sp_cesure_coupes(
                    rang as u32,
                    ptr::null(),
                    5,
                    tampon.as_mut_ptr(),
                    64,
                    &mut besoin,
                )
            },
            SP_ERR_NULL
        );

        // `out_len` est obligatoire : sans lui, l'appelant n'apprendrait pas la
        // taille necessaire, donc le protocole n'aurait pas de sens.
        assert_eq!(
            unsafe {
                sp_cesure_coupes(
                    rang as u32,
                    mot.as_ptr(),
                    mot.len(),
                    tampon.as_mut_ptr(),
                    tampon.len(),
                    ptr::null_mut(),
                )
            },
            SP_ERR_NULL
        );

        sp_cesure_reset();
        assert_eq!(
            unsafe {
                sp_cesure_coupes(
                    0,
                    mot.as_ptr(),
                    mot.len(),
                    tampon.as_mut_ptr(),
                    64,
                    &mut besoin,
                )
            },
            SP_ERR_BAD_INPUT,
            "sans dictionnaire charge, il n'y a pas de rang 0"
        );
    }
}
