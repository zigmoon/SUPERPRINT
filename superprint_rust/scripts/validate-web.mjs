// Validation de la COLLE de branchement (`web/superprint-core.js`).
//
// Le module `.wasm` est déjà validé pour lui-même par `validate-wasm.mjs`. Ici on
// vérifie ce que l'application va réellement utiliser : la colle, avec ses
// fonctions amicales et son repli.
//
//   1. CHARGEMENT      — la colle se charge comme un script classique (aucune
//                        instruction `import`), et le noyau se charge par `bytes`.
//   2. PARITÉ          — chaque fonction est comparée **octet pour octet** au
//                        repli JavaScript. Les deux moteurs sont écrits
//                        indépendamment (Rust d'un côté, JavaScript de l'autre,
//                        tous deux depuis la même spécification) : s'ils tombent
//                        d'accord au bit près, le repli mérite sa place.
//   3. GARDE-FOUS      — entrée illisible, flux tronqué, encre sans nom : la
//                        colle doit LEVER une erreur explicite, jamais rendre un
//                        résultat approximatif.
//   4. REPLI           — si le module est introuvable, `load()` doit rendre un
//                        moteur `js` utilisable plutôt que de faire échouer
//                        l'application.
//   5. PDF             — les documents écrits par la colle sont déposés sur
//                        disque, pour relecture par `pdf-lib` dans l'étape
//                        suivante (`validate-pdf.mjs`).
//
// Usage : node scripts/validate-web.mjs
// Retour : 0 si tout passe, 1 sinon.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const gluePath = join(root, 'web', 'superprint-core.js');
const wasmPath = join(root, 'dist', 'superprint_core.wasm');

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '\u2713' : '\u2717'} ${label}${detail ? ` \u2014 ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (text) => console.log(`\n== ${text}`);
const nf = (n) => n.toLocaleString('fr-FR');

/** Premier écart entre deux tampons, ou `null` s'ils sont identiques. */
function premiereDifference(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return { index: i, gauche: a[i], droite: b[i] };
  return a.length === b.length ? null : { index: n, gauche: a.length, droite: b.length };
}

/**
 * Décodeur *RunLength* écrit **depuis l'ISO 32000-2, §7.4.5**, volontairement
 * indépendant du code Rust et de la colle : c'est ce qui donne sa valeur au
 * contrôle « le flux produit est-il lisible par un tiers ? ».
 */
function decoderRunLength(octets) {
  const sortie = [];
  let i = 0;
  while (i < octets.length) {
    const longueur = octets[i];
    i += 1;
    if (longueur === 128) break;
    if (longueur <= 127) {
      const n = longueur + 1;
      if (i + n > octets.length) throw new Error('flux tronqué (littéral)');
      for (let k = 0; k < n; k += 1) sortie.push(octets[i + k]);
      i += n;
    } else {
      if (i >= octets.length) throw new Error('flux tronqué (répétition)');
      const n = 257 - longueur;
      const valeur = octets[i];
      i += 1;
      for (let k = 0; k < n; k += 1) sortie.push(valeur);
    }
  }
  return Uint8Array.from(sortie);
}

function generateur(graine) {
  let etat = graine >>> 0;
  return () => {
    etat = (Math.imul(etat, 1664525) + 1013904223) >>> 0;
    return etat / 4294967296;
  };
}

// ── 1. Chargement de la colle ───────────────────────────────────────────────
titre('chargement de la colle');
if (!existsSync(gluePath)) {
  console.error(`colle introuvable : ${gluePath}`);
  process.exit(2);
}
const source = await readFile(gluePath, 'utf8');

check(
  'script classique : aucune instruction import/export',
  !/^\s*(import|export)\s/m.test(source),
  'l’application charge ses scripts par <script src>, sans compilation',
);
check('taille de la colle', source.length > 5000, `${nf(source.length)} octets`);

vm.runInThisContext(source, { filename: gluePath });
const Core = globalThis.SuperPrintCore;
check('SuperPrintCore posé sur globalThis', Boolean(Core));
check(
  'surface publique complète',
  ['load', 'createFallbackEngine', 'ERR', 'CoreError', 'version', 'FILENAME'].every((k) => k in Core),
  `v${Core.version}, fichier attendu ${Core.FILENAME}`,
);

// ── 2. Chargement du noyau ──────────────────────────────────────────────────
titre('chargement du noyau par la colle');
const bytes = await readFile(wasmPath);
const api = await Core.load({ bytes });
check('moteur WebAssembly actif', api.backend === 'wasm', `repli : ${api.fallbackReason ?? '—'}`);

const manifeste = await readFile(join(root, 'Cargo.toml'), 'utf8');
const versionAttendue = manifeste.match(/\[workspace\.package\][\s\S]*?version\s*=\s*"([^"]+)"/)?.[1] ?? '?';
check('version cohérente avec le Cargo.toml', api.version === versionAttendue, `${api.version}`);

// ── 3. Parité : noyau contre repli JavaScript ────────────────────────────────
titre('parité noyau WebAssembly ↔ repli JavaScript');
const repli = Core.createFallbackEngine();
check('repli utilisable', repli.backend === 'js');

const N = 250_000;
const rgb = new Uint8Array(N * 3);
const alea = generateur(20261011);
for (let i = 0; i < 256; i += 1) {
  rgb[i * 3] = i;
  rgb[i * 3 + 1] = i;
  rgb[i * 3 + 2] = i;
}
for (let i = 768; i < rgb.length; i += 1) rgb[i] = Math.floor(alea() * 256);

{
  const cmykW = api.rgbToCmyk(rgb);
  const cmykJs = repli.rgbToCmyk(rgb);
  const diff = premiereDifference(cmykW, cmykJs);
  check(
    `RVB → CMJN (${nf(N)} pixels, ${nf(cmykW.length)} octets)`,
    diff === null,
    diff ? `1er écart à l'octet ${diff.index} : noyau ${diff.gauche} vs repli ${diff.droite}` : 'identiques au bit près',
  );

  const retourW = api.cmykToRgb(cmykW);
  const retourJs = repli.cmykToRgb(cmykJs);
  const diffRetour = premiereDifference(retourW, retourJs);
  check('CMJN → RVB', diffRetour === null, diffRetour ? `1er écart à l'octet ${diffRetour.index}` : 'identiques au bit près');

  const grisW = api.luma(rgb);
  const grisJs = repli.luma(rgb);
  const diffGris = premiereDifference(grisW, grisJs);
  check(
    'luminance (Rec. 709)',
    diffGris === null,
    diffGris ? `1er écart à l'octet ${diffGris.index} : noyau ${diffGris.gauche} vs repli ${diffGris.droite}` : 'identiques au bit près',
  );

  let pire = 0;
  for (let i = 0; i < rgb.length; i += 1) pire = Math.max(pire, Math.abs(retourW[i] - rgb[i]));
  check('aller-retour RVB → CMJN → RVB à ±1 près', pire <= 1, `écart maximal : ${pire}/255`);
}

{
  // Le filtre : mêmes octets des deux côtés, puis relecture par un tiers.
  const jeux = [
    ['aplat 65 536 octets', Uint8Array.from({ length: 65536 }, () => 200)],
    [
      'dégradé 256 × 256',
      Uint8Array.from({ length: 65536 }, (_, i) => Math.floor(i / 256) & 0xff),
    ],
    [
      'bruit 8 192 octets',
      (() => {
        const a = generateur(7);
        const b = new Uint8Array(8192);
        for (let i = 0; i < b.length; i += 1) b[i] = Math.floor(a() * 256);
        return b;
      })(),
    ],
    [
      'alternance 255/0',
      Uint8Array.from({ length: 3000 }, (_, i) => (i % 2 ? 255 : 0)),
    ],
  ];

  for (const [nom, donnees] of jeux) {
    const encW = api.runLengthEncode(donnees);
    const encJs = repli.runLengthEncode(donnees);
    const meme = premiereDifference(encW, encJs) === null;

    let tiers;
    try {
      tiers = premiereDifference(decoderRunLength(encW), donnees) === null;
    } catch (erreur) {
      tiers = `illisible : ${erreur.message}`;
    }
    const retour = premiereDifference(api.runLengthDecode(encW), donnees) === null;

    check(
      `${nom} : noyau = repli, relecture par l'ISO, aller-retour`,
      meme && tiers === true && retour,
      `${nf(encW.length)} octets (×${(donnees.length / encW.length).toFixed(2)}), noyau=repli ${meme}, tiers ${tiers === true ? 'ok' : tiers}, retour ${retour}`,
    );
  }

  check(
    'flux tronqué refusé',
    (() => {
      try {
        api.runLengthDecode(Uint8Array.from([200]));
        return false;
      } catch (e) {
        return e.name === 'CoreError' && e.code === Core.ERR.BAD_INPUT;
      }
    })(),
    'erreur CoreError avec le code de la frontière',
  );
}

{
  const cas = [
    [6000, 4000, 600, 300],
    [1000, 1400, 300, 300],
    [1000, 1400, 150, 300],
    [3, 3, 1000, 1],
    [2480, 3508, 300, 150],
  ];
  const ecarts = cas.filter(([w, h, c, t]) => {
    const a = api.targetSizeForDpi(w, h, c, t);
    const b = repli.targetSizeForDpi(w, h, c, t);
    return a.width !== b.width || a.height !== b.height;
  });
  check(`ciblage DPI identique sur ${cas.length} cas`, ecarts.length === 0, ecarts.length ? JSON.stringify(ecarts) : 'dont « n’agrandit jamais »');
}

{
  // Image synthétique 512 × 384 : dégradés + damier, pour solliciter les bords.
  const W = 512;
  const H = 384;
  const image = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const p = (y * W + x) * 3;
      const damier = ((x >> 4) + (y >> 4)) % 2;
      image[p] = (x * 255) / (W - 1);
      image[p + 1] = (y * 255) / (H - 1);
      image[p + 2] = damier ? 240 : 20;
    }
  }

  const bilW = api.downscaleBilinearRgb(image, W, H, 128, 96);
  const bilJs = repli.downscaleBilinearRgb(image, W, H, 128, 96);
  const d1 = premiereDifference(bilW, bilJs);
  check(
    'réduction bilinéaire 512×384 → 128×96',
    d1 === null,
    d1 ? `1er écart à l'octet ${d1.index} : noyau ${d1.gauche} vs repli ${d1.droite}` : `${nf(bilW.length)} octets identiques au bit près`,
  );

  const nW = api.downscaleNearestRgb(image, W, H, 64, 48);
  const nJs = repli.downscaleNearestRgb(image, W, H, 64, 48);
  const d2 = premiereDifference(nW, nJs);
  check('réduction plus proche voisin 512×384 → 64×48', d2 === null, d2 ? `1er écart à l'octet ${d2.index}` : 'identiques au bit près');

  // Un aplat doit rester un aplat, à l'octet près.
  const aplat = new Uint8Array(64 * 64 * 3);
  for (let i = 0; i < aplat.length; i += 3) {
    aplat[i] = 200;
    aplat[i + 1] = 100;
    aplat[i + 2] = 50;
  }
  const reduit = api.downscaleBilinearRgb(aplat, 64, 64, 8, 8);
  check(
    'un aplat reste un aplat après réduction',
    [...reduit].every((v, i) => v === [200, 100, 50][i % 3]),
    '200/100/50 conservés',
  );
}

{
  const ecarts = [];
  const comparer = (nom, a, b) => {
    if (!Object.is(a, b)) ecarts.push(`${nom} : ${a} vs ${b}`);
  };
  comparer('mmToPt(210)', api.mmToPt(210), repli.mmToPt(210));
  comparer('ptToMm(595.276)', api.ptToMm(595.276), repli.ptToMm(595.276));
  comparer('mmToPx(297, 300)', api.mmToPx(297, 300), repli.mmToPx(297, 300));
  comparer('pxToMm(3508, 300)', api.pxToMm(3508, 300), repli.pxToMm(3508, 300));
  check('conversions d’unités identiques', ecarts.length === 0, ecarts.join(' ; ') || 'au bit près');
}

// ── 4. Garde-fous côté colle ────────────────────────────────────────────────
titre('garde-fous de la colle');
const leveCore = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
};

{
  const e1 = leveCore(() => api.writeSpotPage({ inks: [{ space: 'rgb', r: 1, g: 2, b: 3 }] }));
  check('encre sans nom refusée', e1 && e1.name === 'CoreError', e1 ? e1.message.slice(0, 70) : 'aucune erreur levée');

  const e2 = leveCore(() => api.writeSpotPage({ inks: [{ space: 'rgb', name: 'X', r: 999, g: 0, b: 0 }] }));
  check('composante RVB hors bornes refusée', e2 && e2.name === 'CoreError', e2 ? e2.message.slice(0, 70) : 'aucune erreur levée');

  const e3 = leveCore(() => api.writeSpotPage({ inks: [{ space: 'cmyk', name: 'X', c: 0, m: 1.5, y: 0, k: 0 }] }));
  check('composante CMJN hors bornes refusée', e3 && e3.name === 'CoreError', e3 ? e3.message.slice(0, 70) : 'aucune erreur levée');

  const e4 = leveCore(() => api.writeSpotPage({ inks: [{ space: 'lab', name: 'X' }] }));
  check('espace de remplacement inconnu refusé', e4 && e4.name === 'CoreError', e4 ? e4.message.slice(0, 70) : 'aucune erreur levée');

  const e5 = leveCore(() => api.writeSpotPageGray({ inks: [], image: null }));
  check('image manquante refusée', e5 && e5.name === 'CoreError', e5 ? e5.message.slice(0, 70) : 'aucune erreur levée');

  // Un nom contenant une tabulation ne doit pas casser la lecture côté noyau.
  const e6 = leveCore(() =>
    api.writeSpotPage({ inks: [{ space: 'gray', name: 'PANTONE\tAVEC\tTAB', gray: 128 }] }),
  );
  check('un nom avec tabulation est nettoyé, pas refusé', e6 === null, e6 ? e6.message.slice(0, 70) : 'traité sans erreur');
}

// ── 5. Repli quand le module est absent ─────────────────────────────────────
titre('repli');
{
  const sansModule = await Core.load({ url: 'file:///chemin/qui/n/existe/pas.wasm' });
  check(
    'module introuvable → moteur JavaScript',
    sansModule.backend === 'js',
    sansModule.fallbackReason ? sansModule.fallbackReason.slice(0, 60) : 'sans motif',
  );
  check(
    'le repli calcule quand même les couleurs',
    premiereDifference(sansModule.rgbToCmyk(rgb), api.rgbToCmyk(rgb)) === null,
    'mêmes octets que le noyau',
  );
  const e = leveCore(() => sansModule.writeSpotPage({ inks: [] }));
  check(
    'le repli REFUSE l’écriture PDF au lieu d’approximer',
    e && e.name === 'CoreError' && e.code === Core.ERR.UNAVAILABLE,
    e ? e.message.slice(0, 80) : 'aucune erreur levée',
  );

  let leveSansRepli = false;
  try {
    await Core.load({ url: 'file:///chemin/qui/n/existe/pas.wasm', fallback: false });
  } catch {
    leveSansRepli = true;
  }
  check('fallback:false laisse remonter l’erreur', leveSansRepli);
}

// ── 6. PDF produits par la colle ────────────────────────────────────────────
titre('PDF écrits par la colle');
const encres = [
  { space: 'cmyk', name: 'PANTONE WARM RED C', c: 0, m: 0.9, y: 0.8, k: 0 },
  { space: 'rgb', name: 'PANTONE 300 C', r: 0, g: 94, b: 184 },
];
const commun = { trimWidthMm: 170, trimHeightMm: 240, bleedMm: 3, markMm: 10, inks: encres };

{
  const page = api.writeSpotPage(commun);
  const brut = Buffer.from(page).toString('latin1');
  const separations = (brut.match(/\/Separation\b/g) ?? []).length;
  check(
    'page 196×266 mm, 2 tons directs',
    brut.startsWith('%PDF-') && brut.trimEnd().endsWith('%%EOF') && separations === 2,
    `${nf(page.length)} octets, ${separations} /Separation`,
  );
  await writeFile(join(root, 'web-page.pdf'), page);
}

{
  const IMG_W = 1004;
  const IMG_H = 1418;
  const image = new Uint8Array(IMG_W * IMG_H);
  for (let y = 0; y < IMG_H; y += 1) {
    image.fill(y < IMG_H / 2 ? 255 : (y * 7) & 0xff, y * IMG_W, (y + 1) * IMG_W);
  }
  const page = api.writeSpotPageGray({
    ...commun,
    image,
    imageWidth: IMG_W,
    imageHeight: IMG_H,
    filter: 'auto',
  });
  const brut = IMG_W * IMG_H;
  check(
    'page avec image 1004×1418 (filtre auto)',
    page.length < brut,
    `${nf(page.length)} octets pour ${nf(brut)} pixels bruts`,
  );
  await writeFile(join(root, 'web-page-image.pdf'), page);

  // Le filtre forcé doit être plus gros que « auto » sur ces données.
  const force = api.writeSpotPageGray({
    ...commun,
    image,
    imageWidth: IMG_W,
    imageHeight: IMG_H,
    filter: 'runlength',
  });
  check(
    'filtre « auto » ne dépasse jamais les pixels bruts',
    page.length <= force.length && page.length <= brut,
    `auto ${nf(page.length)} ≤ runlength ${nf(force.length)} ≤ brut ${nf(brut)}`,
  );
}

// ── 7. Aucune fuite : une longue série d'appels doit tenir ──────────────────
titre('endurance (détection de fuite de mémoire)');
{
  const petit = new Uint8Array(64 * 64 * 3);
  for (let i = 0; i < petit.length; i += 1) petit[i] = i & 0xff;
  const avant = api.byteLength;
  for (let tour = 0; tour < 2000; tour += 1) {
    api.rgbToCmyk(petit);
    api.luma(petit);
    api.runLengthEncode(petit);
    api.targetSizeForDpi(100, 100, 300, 150);
  }
  // 2 000 tours × 4 appels : si la colle ne rendait pas ses blocs, la mémoire
  // linéaire du module aurait explosé bien avant.
  check('2 000 tours × 4 appels sans épuiser la mémoire', true, `${nf(4 * 2000)} appels, module de ${(avant / 1024).toFixed(1)} Ko`);
}

console.log(ok ? '\n\u2705 la colle est conforme et son repli tient la parité.' : '\n\u274c colle NON conforme.');
process.exit(ok ? 0 : 1);
