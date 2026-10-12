// Validation du module WebAssembly LIVRABLE du noyau Rust
// (`dist/superprint_core.wasm`, produit par `scripts/build-wasm.ps1`).
//
// Ce script ne teste pas un exemple : il charge l'artefact tel qu'un navigateur
// le chargerait, et vérifie trois choses.
//
//   1. CHARGEABILITÉ — le module n'a **aucun import** : `WebAssembly.instantiate
//      (bytes, {})` suffit. Pas de WASI, pas de fonction hôte à fournir. C'est
//      la différence exacte entre un `.rlib` et un `.wasm` utilisable par le web.
//
//   2. PARITÉ CROISÉE — sur de vrais tampons, le résultat du noyau Rust est
//      comparé **octet pour octet** à celui des modules WebAssembly écrits à la
//      main en WAT (`superprint_asm/dist/`). Deux implémentations indépendantes,
//      chargées de la même façon : si les deux tombent d'accord au bit près, la
//      parité n'est pas une affirmation, c'est une mesure.
//
//   3. FONCTIONNEMENT RÉEL — un PDF est produit par le module (protocole en deux
//      passes) et écrit sur disque, puis relu par `pdf-lib` dans une étape
//      séparée (`scripts/validate-pdf.mjs`). Un PDF de la taille attendue, lu
//      par un analyseur éprouvé.
//
// Usage :
//   node scripts/validate-wasm.mjs [chemin.wasm] [chemin-superprint_asm/dist]
//
// Retour : 0 si tout passe, 1 sinon.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const wasmPath = resolve(process.argv[2] ?? join(root, 'dist', 'superprint_core.wasm'));
const asmDist = resolve(process.argv[3] ?? join(root, '..', 'superprint_asm', 'dist'));

// Codes d'erreur de la frontière (doivent rester synchronisés avec lib.rs).
const SP_ERR_NULL = -1_000_001;
const SP_ERR_TOO_SMALL = -1_000_002;
const SP_ERR_BAD_INPUT = -1_000_003;

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '\u2713' : '\u2717'} ${label}${detail ? ` \u2014 ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (text) => console.log(`\n== ${text}`);

/** Premier écart entre deux tampons, ou `null` s'ils sont identiques. */
function premiereDifference(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return { index: i, gauche: a[i], droite: b[i] };
  }
  return a.length === b.length ? null : { index: n, gauche: a.length, droite: b.length };
}

/** Vue neuve sur la mémoire — obligatoire : `memory.buffer` se détache à chaque
 *  agrandissement, donc toute vue construite avant un appel qui alloue est morte. */
const octets = (exports, ptr, len) => new Uint8Array(exports.memory.buffer, ptr, len);

/** Lit un `u32` en mémoire linéaire (petit-boutiste, comme WebAssembly). */
const lireU32 = (exports, ptr) => new DataView(exports.memory.buffer).getUint32(ptr, true);

/**
 * Décodeur *RunLength* écrit **depuis la spécification** (ISO 32000-2, §7.4.5),
 * volontairement indépendant du code Rust : c'est ce qui donne sa valeur au
 * contrôle « le flux produit est-il lisible par un tiers ? ».
 */
function decodeRunLength(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    const longueur = bytes[i];
    i += 1;
    if (longueur === 128) break; // fin de données
    if (longueur <= 127) {
      const n = longueur + 1;
      if (i + n > bytes.length) throw new Error('flux tronqué (littéral)');
      for (let k = 0; k < n; k += 1) out.push(bytes[i + k]);
      i += n;
    } else {
      if (i >= bytes.length) throw new Error('flux tronqué (répétition)');
      const n = 257 - longueur;
      const valeur = bytes[i];
      i += 1;
      for (let k = 0; k < n; k += 1) out.push(valeur);
    }
  }
  return Uint8Array.from(out);
}

/** Générateur congruentiel linéaire : entrées reproductibles d'une exécution à l'autre. */
function generateur(graine) {
  let etat = graine >>> 0;
  return () => {
    etat = (Math.imul(etat, 1664525) + 1013904223) >>> 0;
    return etat / 4294967296;
  };
}

if (!existsSync(wasmPath)) {
  console.error(`module introuvable : ${wasmPath}\n(lance d'abord : pwsh -File scripts/build-wasm.ps1)`);
  process.exit(2);
}

// ── 1. Chargement ──────────────────────────────────────────────────────────
titre('chargement du module livrable');
const bytes = await readFile(wasmPath);
const module = await WebAssembly.compile(bytes);
const imports = WebAssembly.Module.imports(module);
check(
  'aucun import : chargeable par un navigateur avec {}',
  imports.length === 0,
  imports.length === 0
    ? 'ni WASI, ni fonction hôte'
    : imports.map((i) => `${i.module}.${i.name}`).join(', '),
);

const { instance } = await WebAssembly.instantiate(bytes, {});
const x = instance.exports;

check('mémoire linéaire exportée', x.memory instanceof WebAssembly.Memory, `${(x.memory.buffer.byteLength / 1024).toFixed(0)} Ko`);
check('gestionnaire mémoire présent', typeof x.sp_alloc === 'function' && typeof x.sp_free === 'function');

const attendues = [
  'sp_alloc', 'sp_free',
  'sp_version_major', 'sp_version_minor', 'sp_version_patch',
  'sp_mm_to_pt', 'sp_pt_to_mm', 'sp_mm_to_px', 'sp_px_to_mm',
  'sp_rgb_to_cmyk', 'sp_cmyk_to_rgb', 'sp_luma_rgb',
  'sp_run_length_encode', 'sp_run_length_decode',
  'sp_target_size_for_dpi', 'sp_downscale_bilinear_rgb', 'sp_downscale_nearest_rgb',
  'sp_write_spot_page', 'sp_write_spot_page_gray',
  'sp_montage_debut', 'sp_montage_face', 'sp_montage_ecrire',
  'sp_montage_lire', 'sp_montage_rapport',
];
const manquantes = attendues.filter((nom) => typeof x[nom] !== 'function');
check(`les ${attendues.length} fonctions attendues sont exportées`, manquantes.length === 0, manquantes.join(', ') || `${Object.keys(x).length} exports au total`);

// Le compte des exports est une donnée de la documentation (« 49 fonctions ») :
// il est donc vérifié ici, sinon il dériverait sans que personne ne s'en aperçoive.
const prefixes = Object.keys(x).filter((nom) => nom.startsWith('sp_'));
check('la frontière expose exactement 49 fonctions', prefixes.length === 49, `${prefixes.length} export(s)`);

// ── 2. Version ─────────────────────────────────────────────────────────────
titre('version');
const manifeste = await readFile(join(root, 'Cargo.toml'), 'utf8');
const blocEspace = manifeste.match(/\[workspace\.package\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? '';
const versionAttendue = blocEspace.match(/version\s*=\s*"([^"]+)"/)?.[1] ?? '?';
const versionLue = `${x.sp_version_major()}.${x.sp_version_minor()}.${x.sp_version_patch()}`;
check(`version du module = ${versionAttendue} (celle du Cargo.toml)`, versionLue === versionAttendue, `lue : ${versionLue}`);

// ── 3. Unités ──────────────────────────────────────────────────────────────
titre('unités (comparées à la formule, recalculée ici)');
{
  // Comparaison DIRECTE à la formule, pas par aller-retour : `x·(72/25.4)` puis
  // `÷(72/25.4)` n'est pas garanti de rendre `x` au bit près en flottant, et un
  // aller-retour qui échoue ne prouverait rien sur la fonction.
  const PT_PAR_MM = 72 / 25.4;
  const millimetres = [0, 1, 25.4, 210, 297, 1234.5678];
  const points = [0, 1, 72, 595.276, 841.89];
  const pixels = [0, 1, 300, 2480, 3508];
  const resolutions = [72, 96, 150, 300, 1200];
  let ecarts = 0;
  const noter = (nom, attendu, lu) => {
    if (!Object.is(attendu, lu)) {
      ecarts += 1;
      if (ecarts <= 3) console.log(`   écart ${nom} : attendu ${attendu}, lu ${lu}`);
    }
  };
  for (const mm of millimetres) {
    noter('mm→pt', mm * PT_PAR_MM, x.sp_mm_to_pt(mm));
    for (const dpi of resolutions) {
      noter('mm→px', (mm / 25.4) * dpi, x.sp_mm_to_px(mm, dpi));
    }
  }
  for (const pt of points) noter('pt→mm', pt / PT_PAR_MM, x.sp_pt_to_mm(pt));
  for (const px of pixels) {
    for (const dpi of resolutions) noter('px→mm', (px / dpi) * 25.4, x.sp_px_to_mm(px, dpi));
  }
  const total = millimetres.length * 2 + points.length + pixels.length * resolutions.length;
  check('mm ↔ pt et mm ↔ px au bit près', ecarts === 0, `${total} conversions`);
}

// ── 4. Parité des couleurs contre l'assembleur ─────────────────────────────
titre('couleurs : noyau Rust vs modules écrits à la main en WAT');
const N = 250_000;
{
  const asmColorPath = join(asmDist, 'color8.wasm');
  const asmLumaPath = join(asmDist, 'luma.wasm');
  if (!existsSync(asmColorPath) || !existsSync(asmLumaPath)) {
    check('modules de référence superprint_asm présents', false, asmDist);
  } else {
    const asmColor = (await WebAssembly.instantiate(await readFile(asmColorPath), {})).instance.exports;
    const asmLuma = (await WebAssembly.instantiate(await readFile(asmLumaPath), {})).instance.exports;

    // Entrées : les 256 gris, deux rampes, puis du pseudo-aléatoire.
    const source = Buffer.alloc(N * 3);
    const alea = generateur(20261011);
    for (let i = 0; i < 256; i += 1) {
      source[i * 3] = i;
      source[i * 3 + 1] = i;
      source[i * 3 + 2] = i;
    }
    for (let i = 256; i < 512; i += 1) {
      const v = i - 256;
      source[i * 3] = v;
      source[i * 3 + 1] = 255 - v;
      source[i * 3 + 2] = (v * 3) & 0xff;
    }
    for (let i = 512 * 3; i < source.length; i += 1) source[i] = Math.floor(alea() * 256);

    // Rust : tampons alloués par le module lui-même.
    const rSrc = x.sp_alloc(N * 3);
    const rCmyk = x.sp_alloc(N * 4);
    const rRgb = x.sp_alloc(N * 3);
    const rGris = x.sp_alloc(N);
    octets(x, rSrc, N * 3).set(source);

    x.sp_rgb_to_cmyk(rSrc, rCmyk, N);
    const rustCmyk = Uint8Array.from(octets(x, rCmyk, N * 4));
    x.sp_cmyk_to_rgb(rCmyk, rRgb, N);
    const rustRetour = Uint8Array.from(octets(x, rRgb, N * 3));
    x.sp_luma_rgb(rSrc, rGris, N);
    const rustGris = Uint8Array.from(octets(x, rGris, N));

    // WAT : régions fixes, disjointes.
    const A_SRC = 0;
    const A_CMYK = 1_000_000;
    const A_RVB = 2_000_000;
    const A_GRIS = 3_000_000;
    // ⚠️ Chaque module a SA mémoire : la source doit être écrite dans les deux.
    // (Oublier la seconde écriture fait lire des zéros et fabrique une fausse
    // divergence — la première version de ce script est tombée dedans.)
    octets({ memory: asmColor.memory }, A_SRC, N * 3).set(source);
    asmColor.rgb_to_cmyk(A_SRC, A_CMYK, N);
    const watCmyk = Uint8Array.from(octets({ memory: asmColor.memory }, A_CMYK, N * 4));
    asmColor.cmyk_to_rgb(A_CMYK, A_RVB, N);
    const watRetour = Uint8Array.from(octets({ memory: asmColor.memory }, A_RVB, N * 3));

    octets({ memory: asmLuma.memory }, A_SRC, N * 3).set(source);
    asmLuma.luma_rgb_to_gray8(A_SRC, A_GRIS, N);
    const watGris = Uint8Array.from(octets({ memory: asmLuma.memory }, A_GRIS, N));

    const dCmyk = premiereDifference(rustCmyk, watCmyk);
    check(
      `RVB → CMJN identique (${N.toLocaleString('fr-FR')} pixels)`,
      dCmyk === null,
      dCmyk ? `1er écart à l'octet ${dCmyk.index} : Rust ${dCmyk.gauche} vs WAT ${dCmyk.droite}` : 'au bit près',
    );
    const dRetour = premiereDifference(rustRetour, watRetour);
    check(
      'CMJN → RVB identique',
      dRetour === null,
      dRetour ? `1er écart à l'octet ${dRetour.index}` : 'au bit près',
    );
    const dGris = premiereDifference(rustGris, watGris);
    check(
      'luminance (Rec. 709) identique',
      dGris === null,
      dGris ? `1er écart à l'octet ${dGris.index} : Rust ${dGris.gauche} vs WAT ${dGris.droite}` : 'au bit près',
    );

    // L'aller-retour n'est pas l'identité exacte sur des données quelconques :
    // on le mesure au lieu de l'affirmer.
    let pire = 0;
    for (let i = 0; i < source.length; i += 1) {
      pire = Math.max(pire, Math.abs(rustRetour[i] - source[i]));
    }
    check('aller-retour RVB → CMJN → RVB à ±1 près', pire <= 1, `écart maximal : ${pire}/255`);

    // Un tampon de sortie nul doit être refusé, pas écrit.
    check('pointeur nul refusé', x.sp_rgb_to_cmyk(rSrc, 0, N) === SP_ERR_NULL);

    x.sp_free(rSrc, N * 3);
    x.sp_free(rCmyk, N * 4);
    x.sp_free(rRgb, N * 3);
    x.sp_free(rGris, N);
  }
}

// ── 5. Filtre RunLength ────────────────────────────────────────────────────
titre('filtre RunLength (relu par un décodeur écrit depuis la spécification)');
{
  const jeux = [
    { nom: 'aplat de 4 096 octets identiques', data: Buffer.alloc(4096, 7) },
    { nom: 'dégradé vertical 256 × 256', data: Buffer.from(Array.from({ length: 65536 }, (_, i) => Math.floor(i / 256))) },
    { nom: 'bruit incompressible (8 192 octets)', data: (() => { const a = generateur(7); const b = Buffer.alloc(8192); for (let i = 0; i < b.length; i += 1) b[i] = Math.floor(a() * 256); return b; })() },
    { nom: 'alternance 255/0', data: Buffer.from(Array.from({ length: 3000 }, (_, i) => (i % 2 ? 255 : 0))) },
  ];

  for (const jeu of jeux) {
    const cap = jeu.data.length * 2 + 1024;
    const src = x.sp_alloc(jeu.data.length);
    const dst = x.sp_alloc(cap);
    const lenPtr = x.sp_alloc(8);
    octets(x, src, jeu.data.length).set(jeu.data);

    const code = x.sp_run_length_encode(src, jeu.data.length, dst, cap, lenPtr);
    const encode = Uint8Array.from(octets(x, dst, code));
    let decodeJS;
    try {
      decodeJS = decodeRunLength(encode);
    } catch (erreur) {
      decodeJS = null;
      check(`${jeu.nom} : flux lisible selon la spécification`, false, erreur.message);
    }

    const src2 = x.sp_alloc(jeu.data.length);
    const len2 = x.sp_alloc(8);
    const codeDecode = x.sp_run_length_decode(src, jeu.data.length, dst, cap, len2);
    void len2;

    const okFlux = decodeJS !== null && premiereDifference(decodeJS, jeu.data) === null;
    const facteur = (jeu.data.length / code).toFixed(2);
    check(
      `${jeu.nom} : encodé, relu, identique`,
      okFlux,
      `${code} octets (×${facteur} sur les pixels bruts)`,
    );

    x.sp_free(src, jeu.data.length);
    x.sp_free(dst, cap);
    x.sp_free(lenPtr, 8);
    x.sp_free(src2, jeu.data.length);
    x.sp_free(len2, 8);
  }

  // Un flux tronqué doit être refusé, pas décodé de travers.
  const tronque = Uint8Array.from([200]); // annonce une répétition, sans l'octet
  const src = x.sp_alloc(1);
  octets(x, src, 1).set(tronque);
  const dst = x.sp_alloc(512);
  const len = x.sp_alloc(8);
  check('flux tronqué refusé', x.sp_run_length_decode(src, 1, dst, 512, len) === SP_ERR_BAD_INPUT);
  x.sp_free(src, 1);
  x.sp_free(dst, 512);
  x.sp_free(len, 8);
}

// ── 6. Réduction d'image ───────────────────────────────────────────────────
titre('réduction d\'image (le levier sur le « PDF de 131 Mo »)');
{
  const ptrs = [];
  const allouer = (len) => {
    const p = x.sp_alloc(len);
    ptrs.push([p, len]);
    return p;
  };

  // Ciblage DPI : ne doit jamais agrandir.
  const cas = [
    [1000, 1400, 300, 150, 500, 700], // division par deux
    [1000, 1400, 300, 300, 1000, 1400], // déjà à la cible
    [1000, 1400, 150, 300, 1000, 1400], // sous la cible : inchangé
    [3, 3, 1000, 1, 1, 1], // arrondi, jamais zéro
  ];
  let ecarts = 0;
  for (const [w, h, courant, cible, attenduW, attenduH] of cas) {
    const outW = allouer(8);
    const outH = allouer(8);
    x.sp_target_size_for_dpi(w, h, courant, cible, outW, outH);
    const luW = lireU32(x, outW);
    const luH = lireU32(x, outH);
    if (luW !== attenduW || luH !== attenduH) {
      ecarts += 1;
      console.log(`   écart : ${w}×${h} à ${courant} DPI vers ${cible} DPI → ${luW}×${luH}, attendu ${attenduW}×${attenduH}`);
    }
  }
  check(`ciblage DPI correct sur ${cas.length} cas`, ecarts === 0, 'dont « n\'agrandit jamais »');
  check('ciblage DPI : pointeur nul refusé', x.sp_target_size_for_dpi(10, 10, 300, 150, 0, 0) === SP_ERR_NULL);

  // Aplat 16×16 réduit à 4×4 : un aplat reste un aplat, à l'octet près.
  const SRC_W = 16;
  const SRC_H = 16;
  const DST_W = 4;
  const DST_H = 4;
  const source = Buffer.alloc(SRC_W * SRC_H * 3);
  for (let i = 0; i < source.length; i += 3) {
    source[i] = 200;
    source[i + 1] = 100;
    source[i + 2] = 50;
  }
  const src = allouer(source.length);
  octets(x, src, source.length).set(source);
  const dst = allouer(DST_W * DST_H * 3);
  const code = x.sp_downscale_bilinear_rgb(src, SRC_W, SRC_H, dst, DST_W, DST_H);
  const reduit = Uint8Array.from(octets(x, dst, DST_W * DST_H * 3));
  const aplatTenue = code === 0 && [...reduit].every((v, i) => v === [200, 100, 50][i % 3]);
  check(`aplat 16×16 → 4×4 : couleur conservée au bit près`, aplatTenue);

  // Damier 2×2 réduit à 1×1 : le plus proche voisin ne doit jamais INVENTER une
  // couleur, seulement en choisir une. C'est l'invariant qui compte ; le pixel
  // exact dépend d'une règle de coordonnée (centres de pixels), pas d'un choix
  // arbitraire — on ne code donc pas une attente en dur.
  const damier = Uint8Array.from([255, 0, 0, 0, 0, 0, 255, 255, 255, 0, 0, 0]);
  const src2 = allouer(damier.length);
  octets(x, src2, damier.length).set(damier);
  const dst2 = allouer(3);
  x.sp_downscale_nearest_rgb(src2, 2, 2, dst2, 1, 1);
  const p = Uint8Array.from(octets(x, dst2, 3));
  const existe = [0, 1, 2, 3].some(
    (i) => damier[i * 3] === p[0] && damier[i * 3 + 1] === p[1] && damier[i * 3 + 2] === p[2],
  );
  check(
    'damier 2×2 → 1×1 : plus proche voisin rend un pixel source, sans mélange',
    existe,
    `rgb(${p[0]},${p[1]},${p[2]})`,
  );

  // Dimension nulle : c'est ce que la frontière PEUT détecter. En revanche elle
  // ne peut PAS vérifier qu'un tampon fait vraiment la longueur annoncée — un
  // pointeur C ne porte pas sa taille. C'est le contrat de l'appelant, et c'est
  // écrit dans la documentation du crate.
  check(
    'dimension nulle refusée',
    x.sp_downscale_bilinear_rgb(src2, 0, 2, dst2, 1, 1) === SP_ERR_BAD_INPUT,
  );

  for (const [p2, len] of ptrs) x.sp_free(p2, len);
}

// ── 7. PDF produit par le module ───────────────────────────────────────────
titre('écriture PDF depuis le module WebAssembly');
{
  const ptrs = [];
  const allouer = (len) => {
    const p = x.sp_alloc(len);
    ptrs.push([p, len]);
    return p;
  };

  /** Protocole en deux passes : d'abord la taille, puis l'écriture. */
  const ecrire = (appel) => {
    const lenPtr = allouer(8);
    const premier = appel(0, 0, lenPtr);
    if (premier !== SP_ERR_TOO_SMALL) {
      return { erreur: `un tampon vide devait rendre ${SP_ERR_TOO_SMALL}, reçu ${premier}` };
    }
    const besoin = lireU32(x, lenPtr);
    const tampon = allouer(besoin);
    const code = appel(tampon, besoin, lenPtr);
    if (code < 0) return { erreur: `écriture refusée (code ${code})` };
    return { besoin, code, data: Buffer.from(Uint8Array.from(octets(x, tampon, lireU32(x, lenPtr)))) };
  };

  // Deux encres directes, comme la démonstration existante.
  const encres = Buffer.from(
    [
      'cmyk\tPANTONE WARM RED C\t0\t900\t800\t0',
      'rgb\tPANTONE 300 C\t0\t94\t184',
    ].join('\n'),
    'utf8',
  );
  const srcEncres = allouer(encres.length);
  octets(x, srcEncres, encres.length).set(encres);

  const page = ecrire((dst, cap, lenPtr) =>
    x.sp_write_spot_page(170, 240, 3, 10, 0, srcEncres, encres.length, dst, cap, lenPtr),
  );
  if (page.erreur) {
    check('page avec tons directs produite', false, page.erreur);
  } else {
    const entete = page.data.subarray(0, 5).toString('latin1') === '%PDF-';
    const pied = page.data.toString('latin1').trimEnd().endsWith('%%EOF');
    check('page avec tons directs produite', entete && pied, `${page.data.length} octets, ${(page.data.toString('latin1').match(/\/Separation\b/g) ?? []).length} /Separation`);
    await writeFile(join(root, 'wasm-page.pdf'), page.data);
  }

  // Même page, plus une image en niveaux de gris (1004 × 1418, aplat + paliers).
  const IMG_W = 1004;
  const IMG_H = 1418;
  const image = Buffer.alloc(IMG_W * IMG_H);
  for (let y = 0; y < IMG_H; y += 1) {
    const valeur = y < IMG_H / 2 ? 255 : (y * 7) & 0xff;
    image.fill(valeur, y * IMG_W, (y + 1) * IMG_W);
  }
  const srcImage = allouer(image.length);
  octets(x, srcImage, image.length).set(image);

  const pageImage = ecrire((dst, cap, lenPtr) =>
    x.sp_write_spot_page_gray(170, 240, 3, 10, 0, /* filtre Auto */ 2, srcEncres, encres.length, srcImage, IMG_W, IMG_H, dst, cap, lenPtr),
  );
  if (pageImage.erreur) {
    check('page avec image produite', false, pageImage.erreur);
  } else {
    const brut = IMG_W * IMG_H;
    check(
      'page avec image produite, flux image ≤ pixels bruts',
      pageImage.data.length < brut,
      `${pageImage.data.length} octets au total pour ${brut.toLocaleString('fr-FR')} pixels de départ`,
    );
    await writeFile(join(root, 'wasm-page-image.pdf'), pageImage.data);
  }

  // Garde-fous.
  check(
    'quadri inconnue refusée',
    x.sp_write_spot_page(170, 240, 3, 10, 9, srcEncres, encres.length, 0, 0, allouer(8)) === SP_ERR_BAD_INPUT,
  );
  check(
    'encre mal formée refusée',
    x.sp_write_spot_page(170, 240, 3, 10, 0, srcEncres, 5, 0, 0, allouer(8)) === SP_ERR_BAD_INPUT,
  );
  check(
    'filtre d\'image inconnu refusé',
    x.sp_write_spot_page_gray(170, 240, 3, 10, 0, 7, srcEncres, encres.length, srcImage, IMG_W, IMG_H, 0, 0, allouer(8)) === SP_ERR_BAD_INPUT,
  );

  for (const [p, len] of ptrs) x.sp_free(p, len);
}

console.log(
  ok
    ? '\n\u2705 module WebAssembly chargeable, conforme et vérifié.'
    : '\n\u274c module NON conforme.',
);
process.exit(ok ? 0 : 1);
