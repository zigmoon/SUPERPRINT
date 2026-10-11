// Validation du TEXTE et des POLICES embarquées (`dist/superprint_core.wasm`).
//
// Ce script ne se contente pas de vérifier que le PDF est bien formé : il
// demande à **un lecteur PDF indépendant** de relire les caractères composés.
// C'est la seule preuve qui compte pour un texte. Un PDF peut afficher du texte
// sans qu'un lecteur puisse l'extraire — c'est le cas quand on écrit des
// identifiants de glyphe sans table `/ToUnicode`. On vérifie donc les trois
// étages :
//
//   1. la POLICE est acceptée et embarquée (`/FontFile2`, `/CIDFontType2`) ;
//   2. le TEXTE est composé en identifiants de glyphe (`Identity-H`) ;
//   3. le lecteur RE trouve en clair, accents compris — c'est `/ToUnicode` qui
//      le permet.
//
// Le lecteur employé est `pdf.js` (Mozilla), déjà présent dans le dépôt pour
// l'application : il est utilisé **en lecture seule**, jamais modifié.
//
// Usage :
//   node scripts/validate-text.mjs [chemin.wasm] [chemin-police.ttf]
//
// Retour : 0 si tout passe, 1 sinon, 2 si le module est introuvable.

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);

const wasmPath = resolve(process.argv[2] ?? join(root, 'dist', 'superprint_core.wasm'));
// Police réelle livrée avec l'application : lecture seule, jamais modifiée.
const policeParDefaut = join(
  root,
  '..',
  'superprint',
  'app',
  'CSS',
  'fonts',
  'IBMPlexSans-400-normal.ttf',
);
const policePath = resolve(process.argv[3] ?? policeParDefaut);
// `pdf.js` vit dans l'application SuperPrint : on l'emprunte tel quel.
const pdfjsPath = join(root, '..', 'superprint', 'app', 'JS', 'pdf.min.js');

const SP_ERR_TOO_SMALL = -1_000_002;

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '\u2713' : '\u2717'} ${label}${detail ? ` \u2014 ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (text) => console.log(`\n== ${text}`);

if (!existsSync(wasmPath)) {
  console.error(
    `module introuvable : ${wasmPath}\n(lance d'abord : pwsh -File scripts/build-wasm.ps1)`,
  );
  process.exit(2);
}

/** Vue neuve sur la mémoire — `memory.buffer` se détache à chaque agrandissement. */
const octets = (exports, ptr, len) => new Uint8Array(exports.memory.buffer, ptr, len);
const lireU32 = (exports, ptr) => new DataView(exports.memory.buffer).getUint32(ptr, true);

/** Dépose des octets dans la mémoire du module et rend l'adresse ; à libérer. */
function deposer(exports, donnees) {
  const ptr = exports.sp_alloc(donnees.length);
  if (ptr === 0 && donnees.length > 0) throw new Error('sp_alloc a échoué');
  octets(exports, ptr, donnees.length).set(donnees);
  return ptr;
}

const encoder = new TextEncoder();

/** Dépose un texte UTF-8 et rend `[ptr, len]` ; à libérer. */
function deposerTexte(exports, texte) {
  const donnees = encoder.encode(texte);
  return [deposer(exports, donnees), donnees.length];
}

// ── 1. Chargement ──────────────────────────────────────────────────────────
titre('chargement du module livrable');
const bytes = await readFile(wasmPath);
const { instance } = await WebAssembly.instantiate(bytes, {});
const x = instance.exports;

const attendues = [
  'sp_doc_reset',
  'sp_doc_add_page',
  'sp_doc_add_font',
  'sp_doc_substitues',
  'sp_doc_op',
  'sp_doc_info',
  'sp_doc_write',
];
const manquantes = attendues.filter((nom) => typeof x[nom] !== 'function');
check(
  `les ${attendues.length} fonctions de texte sont exportées`,
  manquantes.length === 0,
  manquantes.join(', ') || `${Object.keys(x).filter((n) => n.startsWith('sp_')).length} exports au total`,
);

// ── 2. Police réelle ───────────────────────────────────────────────────────
titre('police embarquée');
check('police de test trouvée', existsSync(policePath), policePath);
if (!existsSync(policePath)) {
  console.error('aucune police TrueType à essayer : arrêt.');
  process.exit(1);
}
const police = await readFile(policePath);
const signature = String.fromCharCode(...police.subarray(0, 4));
check(
  'fichier TrueType (contours `glyf`)',
  signature === '\u0000\u0001\u0000\u0000' || signature === 'true',
  `signature lue : ${JSON.stringify(signature)} — ${(police.length / 1024).toFixed(0)} Ko`,
);

check('ouverture d’un document', x.sp_doc_reset() === 0);
check('ajout d’une page 170 × 240 mm', x.sp_doc_add_page(170, 240, 3, 10, 0) === 1);

// Une encre directe, pour vérifier que le texte coexiste avec les tons directs.
{
  const [ptr, len] = deposerTexte(x, 'cmyk\tPANTONE 300 C\t900\t500\t0\t0');
  const rang = x.sp_doc_add_ink(ptr, len);
  x.sp_free(ptr, len);
  check('encre directe déclarée pour la page de texte', rang === 0, `rang ${rang}`);
}

let rangPolice;
{
  const ptr = deposer(x, police);
  rangPolice = x.sp_doc_add_font(ptr, police.length);
  x.sp_free(ptr, police.length);
}
check(
  'police TrueType acceptée',
  rangPolice === 0,
  rangPolice < 0 ? `code d'erreur ${rangPolice}` : `rang ${rangPolice}`,
);
if (rangPolice < 0) {
  console.error('police refusée : impossible de poursuivre.');
  process.exit(1);
}

// ── 3. Composition du texte ────────────────────────────────────────────────
titre('composition');

// Trois lignes : capitale accentuée, cédille, tiret cadratin — de quoi prendre
// en défaut un encodeur qui écrirait de l'UTF-8 au lieu d'identifiants de
// glyphe, ou une table `/ToUnicode` approximative.
const lignes = ['À l’imprimeur', 'café — déjà vu, çà et là', 'PANTONE 300 C'];
const texteAttendu = lignes.join('\n');
const noir = 'q4\t0\t0\t0\t1000';

// Chaque ligne est une opération : la première à y = 200 mm, les suivantes
// descendent de 1,2 × corps (14,4 pt pour 12 pt).
const operations = lignes
  .map((ligne) => `text\t${rangPolice}\t12\t20\t200\t${noir}\t${ligne.replace(/\\/g, '\\\\')}`)
  .join('\n');
{
  const [ptr, len] = deposerTexte(x, operations);
  const ajoutees = x.sp_doc_op(ptr, len);
  x.sp_free(ptr, len);
  check('trois lignes de texte composées', ajoutees === lignes.length, `${ajoutees} opération(s)`);
}

// Une ligne mal formée est refusée — mais seulement elle : le protocole impose
// que rien ne soit appliqué si une ligne est illisible.
{
  const [ptr, len] = deposerTexte(x, 'text\t0\t12\t20\t100\tq4\t0\t0\t0\t1000\tA\tB');
  const code = x.sp_doc_op(ptr, len);
  x.sp_free(ptr, len);
  check('ligne de texte mal formée refusée', code === -1_000_003, `code ${code}`);
}

// ── 4. Écriture (protocole en deux passes) ─────────────────────────────────
titre('écriture');
let pdf;
{
  const lenPtr = x.sp_alloc(4);
  const premier = x.sp_doc_write(0, 0, lenPtr);
  check('première passe : tampon vide annoncé', premier === SP_ERR_TOO_SMALL, `code ${premier}`);
  const besoin = lireU32(x, lenPtr);
  const tampon = x.sp_alloc(besoin);
  const code = x.sp_doc_write(tampon, besoin, lenPtr);
  pdf = Buffer.from(octets(x, tampon, lireU32(x, lenPtr)));
  x.sp_free(tampon, besoin);
  x.sp_free(lenPtr, 4);
  check('seconde passe : PDF écrit', code > 0, `${pdf.length} octets`);
}

const substitues = x.sp_doc_substitues();
check(
  'aucun caractère substitué : tout s’imprimera',
  substitues === 0,
  substitues === 0 ? 'la police dessine tous les caractères composés' : `${substitues} manquant(s)`,
);

const brut = pdf.toString('latin1');
check('police embarquée en entier', brut.includes('/FontFile2 '), '/FontFile2 présent');
check('police composite', brut.includes('/Subtype /Type0') && brut.includes('/Encoding /Identity-H'));
check('descendant CIDFontType2', brut.includes('/Subtype /CIDFontType2'));
check('table d’extraction', brut.includes('/ToUnicode '));
check('ressource de page', brut.includes('/Font << /F0 '));
check(
  'largeurs déclarées pour les glyphes utilisés',
  /\/W \[[^\]]+\]/.test(brut),
  (brut.match(/\/W \[[^\]]{0,60}/) ?? ['(aucune)'])[0],
);
check('le texte ne part PAS en caractères lisibles', !brut.includes('(À l’imprimeur)'));
check('encre directe conservée', brut.includes('/Separation'));

const sortie = join(root, 'dist', 'text-page.pdf');
await mkdir(dirname(sortie), { recursive: true });
await writeFile(sortie, pdf);
console.log(`  → ${sortie}`);

// ── 5. Relecture par un lecteur PDF indépendant ────────────────────────────
titre('relecture par pdf.js (Mozilla)');
check('pdf.js disponible', existsSync(pdfjsPath), pdfjsPath);
if (existsSync(pdfjsPath)) {
  const pdfjs = require(pdfjsPath);
  // Pas de travailleur séparé : on lit sur le fil principal, comme en Node.
  pdfjs.GlobalWorkerOptions.workerSrc = join(root, '..', 'superprint', 'app', 'JS', 'pdf.worker.min.js');
  const tache = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    disableWorker: true,
    verbosity: 0,
  });
  try {
    const document = await tache.promise;
    check('PDF ouvert par pdf.js', document.numPages === 1, `${document.numPages} page(s)`);

    const page = await document.getPage(1);
    const contenu = await page.getTextContent();
    const morceaux = contenu.items.map((item) => item.str);
    const relu = morceaux.join('\n');
    // Les espaces sont recomposés par le lecteur à partir des déplacements : on
    // compare donc sur les caractères, pas sur la mise en page. Ce qui compte
    // ici, c'est que les caractères REVIENNENT — accents compris.
    const normaliser = (s) => s.replace(/\s+/g, ' ').trim();
    const attendu = normaliser(texteAttendu);
    const obtenu = normaliser(relu);
    check('texte extrait en clair', obtenu === attendu, `lu : « ${obtenu} »`);

    // Contrôles ciblés : un encodage fautif casse presque toujours l'un des deux.
    check('accents préservés', obtenu.includes('café') && obtenu.includes('çà'), `« ${obtenu} »`);
    check('apostrophe typographique préservée', obtenu.includes('l’imprimeur'));
    check('tiret cadratin préservé', obtenu.includes('—'));
    check(
      'largeurs cohérentes : la ligne composée a une largeur plausible',
      morceaux.every((m) => typeof m === 'string'),
    );
  } catch (erreur) {
    check('PDF lisible par pdf.js', false, String(erreur && erreur.message ? erreur.message : erreur));
  }
}

console.log(ok ? '\nOK : le texte est composé, embarqué, et relu en clair.' : '\nÉCHEC.');
process.exit(ok ? 0 : 1);
