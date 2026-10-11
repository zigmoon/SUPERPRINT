// Preuve du branchement **tel qu'il sera livré** dans l'application.
//
// Ce script ne teste pas une maquette : il évalue les fichiers réels de
// `superprint/app/JS/` dans un contexte isolé qui imite le navigateur, puis
// compare le moteur installé au moteur du produit, mot pour mot.
//
//   • `JS/superprint-core.js`          la colle (copiée de `superprint_rust/web`)
//   • `JS/superprint_core.wasm`        le noyau compilé
//   • `JS/superprint-branchement.js`   le branchement lui-même
//   • `JS/hypher.js`, `JS/hyphenation-*.js`  le moteur et les dictionnaires du
//                                     produit, lus sans être modifiés
//
// Ce qui est vérifié :
//   1. `window.hyphenators` est posé **immédiatement**, avant tout appel ;
//   2. le noyau prend la main et rend les **mêmes fragments** qu'`Hypher` ;
//   3. la concaténation des fragments redonne toujours le mot ;
//   4. `desactiver()` ramène au moteur du produit, à l'identique ;
//   5. si le noyau manque, la césure continue de fonctionner (repli).
//
// Usage : node scripts/validate-branchement-app.mjs
// Retour : 0 si tout passe, 1 sinon.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);
const app = join(root, '..', 'superprint', 'app');
const js = join(app, 'JS');

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '\u2713' : '\u2717'} ${label}${detail ? ` \u2014 ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (texte) => console.log(`\n== ${texte}`);

const fichiers = {
  colle: join(js, 'superprint-core.js'),
  wasm: join(js, 'superprint_core.wasm'),
  branchement: join(js, 'superprint-branchement.js'),
  hypher: join(js, 'hypher.js'),
};
for (const [nom, chemin] of Object.entries(fichiers)) {
  if (!existsSync(chemin)) {
    console.error(`fichier introuvable (${nom}) : ${chemin}`);
    process.exit(2);
  }
}

// ── 1. Le décor du navigateur ───────────────────────────────────────────────
titre('décor du navigateur (les fichiers du produit, lus sans être modifiés)');

const langues = [
  ['fr', 'fr'],
  ['de', 'de'],
  ['es', 'es'],
  ['it', 'it'],
  ['en', 'en-us'],
];
const dictionnaires = {};
const Hyphenation = {};
for (const [langue, source] of langues) {
  const chemin = join(js, `hyphenation-${langue}.js`);
  if (!existsSync(chemin)) continue;
  const charge = require(chemin);
  dictionnaires[langue] = charge.Hyphenation[source];
  Hyphenation[source] = charge.Hyphenation[source];
}
const { Hypher } = require(fichiers.hypher);

// Le réseau est simulé : dans le navigateur, `fetch` va chercher le `.wasm`
// à côté de la page ; ici, il le lit sur le disque, sous le **même** chemin
// relatif que celui écrit dans le branchement. Un chemin faux échouerait donc
// aussi dans ce test.
const bac = {
  console: { info: () => {}, warn: () => {}, error: () => {} },
  Math,
  RegExp,
  String,
  Object,
  Array,
  Number,
  JSON,
  Error,
  TypeError,
  isFinite,
  Uint8Array,
  Uint16Array,
  DataView,
  TextEncoder,
  TextDecoder,
  WebAssembly,
  Hypher,
  Hyphenation,
  fetch: async (url) => {
    const chemin = join(app, String(url));
    if (!existsSync(chemin)) {
      return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    const octets = await readFile(chemin);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength),
    };
  },
};
bac.globalThis = bac;
bac.window = bac;
bac.self = bac;
vm.createContext(bac);

check('hypher.js et les dictionnaires chargés', typeof Hypher === 'function' && !!dictionnaires.fr?.patterns);

// ── 2. Chargement, dans l'ordre de `index.html` ─────────────────────────────
titre('chargement dans l’ordre de index.html');

vm.runInContext(await readFile(fichiers.colle, 'utf8'), bac, { filename: 'superprint-core.js' });
check('la colle est chargée', typeof bac.SuperPrintCore?.load === 'function');

vm.runInContext(await readFile(fichiers.branchement, 'utf8'), bac, { filename: 'superprint-branchement.js' });
check('le branchement est chargé', typeof bac.SuperPrintBranchement === 'object');

// Point le plus important du fichier : les moteurs sont posés **avant** le
// moindre appel, donc aucune fenêtre où la césure manquerait.
check(
  'window.hyphenators est posé immédiatement',
  !!bac.hyphenators && !!bac.hyphenators.fr && typeof bac.hyphenators.fr.hyphenate === 'function',
  Object.keys(bac.hyphenators || {}).join(', '),
);

// Le noyau est chargé de façon asynchrone : on laisse le temps aux promesses
// de se dérouler, sans dormir artificiellement (le calcul est local).
for (let essai = 0; essai < 200 && !bac.SuperPrintBranchement.etat.actif; essai += 1) {
  await new Promise((resoudre) => setTimeout(resoudre, 25));
}
const apresChargement = bac.SuperPrintBranchement.etat;
check('le noyau a pris la main', apresChargement.actif === true, `backend=${apresChargement.backend}`);
check(
  'les cinq dictionnaires sont branchés',
  Object.keys(apresChargement.rangs).length === 5,
  `rangs=${JSON.stringify(apresChargement.rangs)}`,
);

// ── 3. Parité, mot pour mot ─────────────────────────────────────────────────
titre('parité : moteur installé contre moteur du produit');

const prose = (
  await Promise.all(
    ['faq.html', 'ORGANISATION.md', 'TRADEMARKS.md'].map((nom) => readFile(join(root, '..', 'superprint', nom), 'utf8')),
  )
).join('\n');
const MOT_PROPRE = /^[\p{Letter}\p{Mn}'\u2019\u2010\u2011\u2013\u2014-]+$/u;
const corpus = [
  ...new Set(
    prose
      .split(/\s+/)
      .map((mot) => mot.trim())
      .filter((mot) => mot.length >= 5 && mot.length <= 40 && MOT_PROPRE.test(mot)),
  ),
];
check('corpus', corpus.length > 400, `${corpus.length} mots uniques`);

const forme = (liste) => (Array.isArray(liste) && liste.length > 1 ? liste.join('|') : '-');

function comparerCle(cle) {
  const moteur = bac.hyphenators[cle];
  if (!moteur) {
    check(`langue « ${cle} » installée`, false);
    return;
  }
  const moteurProduit = new Hypher(dictionnaires[cle]);
  const ecarts = [];
  let coupes = 0;
  for (const mot of corpus) {
    const attendu = moteurProduit.hyphenate(mot);
    const obtenu = moteur.hyphenate(mot);
    if (forme(obtenu) !== forme(attendu)) {
      if (ecarts.length < 8) ecarts.push(`${mot}: attendu=${forme(attendu)} obtenu=${forme(obtenu)}`);
    }
    if (obtenu.join('') !== mot) ecarts.push(`${mot}: recomposition fautive (« ${obtenu.join('')} »)`);
    if (Array.isArray(obtenu) && obtenu.length > 1) coupes += 1;
  }
  check(
    `${cle} : ${corpus.length} mots identiques`,
    ecarts.length === 0,
    ecarts.length ? `${ecarts.length} écart(s)` : `${coupes} mots effectivement coupés`,
  );
  for (const ligne of ecarts.slice(0, 8)) console.log(`    ${ligne}`);
}

for (const [cle] of langues) {
  if (dictionnaires[cle]) comparerCle(cle);
}

// ── 3 bis. Imposition et réduction d'image, depuis les fichiers livrés ──────
titre('imposition et réduction, sans passer par la césure');

const branchement = bac.SuperPrintBranchement;

const ordre = branchement.orderPages(20);
check(
  'orderPages(20) rend la suite du produit',
  Array.isArray(ordre) &&
    ordre.join(',') === '20,1,2,19,18,3,4,17,16,5,6,15,14,7,8,13,12,9,10,11',
  Array.isArray(ordre) ? ordre.join(', ') : String(ordre),
);

const ZERO = branchement.orderPages(1);
check(
  'une place vide se lit null, jamais 0',
  Array.isArray(ZERO) && ZERO[0] === null && ZERO[1] === 1,
  JSON.stringify(ZERO),
);

const plan = branchement.imposition({
  largeurPageMm: 210,
  hauteurPageMm: 297,
  fondPerduMm: 3,
  inclureFondPerdu: true,
  decoupePageAPage: false,
  reperesDeCoupe: true,
  gauche: 20,
  droite: 1,
});
check(
  'la feuille d’un A4 en livret mesure 446 × 323 mm',
  plan && plan.feuille.largeurMm === 446 && plan.feuille.hauteurMm === 323,
  plan ? `${plan.feuille.largeurMm} × ${plan.feuille.hauteurMm}` : 'plan absent',
);
check(
  'les deux formats finis se touchent',
  plan && plan.places[0].trimXMm + plan.places[0].trimLargeurMm === plan.places[1].trimXMm,
  plan ? `${plan.places[0].trimXMm + plan.places[0].trimLargeurMm} = ${plan.places[1].trimXMm}` : '',
);
check(
  'douze traits de coupe, aucun dans le format fini',
  plan &&
    plan.reperes.length === 12 &&
    plan.reperes.every(
      (r) =>
        !(r.x1 > plan.formatFini.xMm && r.x1 < plan.formatFini.xMm + plan.formatFini.largeurMm &&
          r.y1 > plan.formatFini.yMm && r.y1 < plan.formatFini.yMm + plan.formatFini.hauteurMm),
    ),
  plan ? `${plan.reperes.length} traits` : '',
);

const pixels = new Uint8Array(1200 * 900 * 3);
for (let i = 0; i < pixels.length; i += 1) pixels[i] = i % 251;
// 1200 px posés sur 50 mm, c'est 609,6 DPI : à 300 DPI il en faut 591.
const reduit = branchement.reduireImage(pixels, 1200, 900, 50, 300);
check(
  'reduireImage réduit à la résolution demandée',
  reduit && reduit.reduite === true && reduit.width === 591 && reduit.height === 443,
  reduit ? `${reduit.width}×${reduit.height} (1200×900 à 609,6 DPI → 300 DPI)` : 'aucun résultat',
);
check(
  'les pixels rendus ont exactement la taille annoncée',
  reduit && reduit.pixels.length === reduit.width * reduit.height * 3,
  reduit ? `${reduit.pixels.length} octets` : '',
);

const deja = branchement.reduireImage(pixels, 300, 200, 100, 300);
check(
  'une image déjà à la bonne résolution n’est pas touchée',
  deja && deja.reduite === false && deja.pixels === pixels,
  '300 px sur 100 mm = 76 DPI, rien à retirer',
);

// ── 3 ter. Les composants sont indépendants ────────────────────────────────
titre('les composants ne dépendent pas les uns des autres');
{
  // Sans `Hyphenation`, la césure ne peut pas être branchée — mais l'imposition
  // et la réduction d'image n'en ont pas besoin, et doivent continuer de
  // fonctionner. Les lier à un fichier de motifs ferait échouer deux composants
  // parce qu'un troisième n'a pas trouvé ses données.
  const bacSans = { ...bac };
  bacSans.globalThis = bacSans;
  bacSans.window = bacSans;
  bacSans.self = bacSans;
  delete bacSans.Hyphenation;
  delete bacSans.hyphenators;
  vm.createContext(bacSans);
  vm.runInContext(await readFile(fichiers.branchement, 'utf8'), bacSans, {
    filename: 'superprint-branchement.js',
  });
  for (let essai = 0; essai < 200 && !bacSans.SuperPrintBranchement.etat.backend; essai += 1) {
    await new Promise((resoudre) => setTimeout(resoudre, 25));
  }
  check(
    'le noyau se charge même sans dictionnaires de césure',
    bacSans.SuperPrintBranchement.etat.backend === 'wasm',
    `backend=${bacSans.SuperPrintBranchement.etat.backend}, césure=${bacSans.SuperPrintBranchement.etat.actif}`,
  );
  check(
    'aucun moteur de césure posé — le produit garde le sien',
    !bacSans.hyphenators || Object.keys(bacSans.hyphenators).length === 0,
  );
  const ordreSans = bacSans.SuperPrintBranchement.orderPages(8);
  check(
    'orderPages fonctionne quand même',
    Array.isArray(ordreSans) && ordreSans.join(',') === '8,1,2,7,6,3,4,5',
    Array.isArray(ordreSans) ? ordreSans.join(', ') : String(ordreSans),
  );
  const reduitSans = bacSans.SuperPrintBranchement.reduireImage(
    new Uint8Array(400 * 400 * 3).fill(9),
    400,
    400,
    10,
    300,
  );
  check(
    'reduireImage fonctionne quand même',
    reduitSans !== null && reduitSans.width === 118,
    reduitSans ? `${reduitSans.width}×${reduitSans.height} (400 px sur 10 mm = 1016 DPI → 300)` : 'aucun résultat',
  );
}

// ── 4. Réversibilité ────────────────────────────────────────────────────────
titre('réversibilité');

const avant = bac.hyphenators.fr.hyphenate('bibliothèque');
bac.SuperPrintBranchement.desactiver();
const apres = bac.hyphenators.fr.hyphenate('bibliothèque');
check(
  'desactiver() ramène au moteur du produit',
  forme(apres) === forme(new Hypher(dictionnaires.fr).hyphenate('bibliothèque')),
  `${forme(avant)} → ${forme(apres)}`,
);
check('etat.actif repasse à faux', bac.SuperPrintBranchement.etat.actif === false);

// ── 5. Le repli : le noyau manque ───────────────────────────────────────────
titre('repli : le noyau manque');
{
  const bacNu = { ...bac, SuperPrintCore: undefined, fetch: async () => ({ ok: false, status: 404 }) };
  bacNu.globalThis = bacNu;
  bacNu.window = bacNu;
  bacNu.self = bacNu;
  delete bacNu.hyphenators;
  vm.createContext(bacNu);
  vm.runInContext(await readFile(fichiers.branchement, 'utf8'), bacNu, { filename: 'superprint-branchement.js' });
  await new Promise((resoudre) => setTimeout(resoudre, 60));
  const etatNu = bacNu.SuperPrintBranchement.etat;
  check('les moteurs sont quand même posés', typeof bacNu.hyphenators?.fr?.hyphenate === 'function');
  check('le noyau n’est pas actif', etatNu.actif === false);
  check(
    'la césure continue de fonctionner (Hypher)',
    forme(bacNu.hyphenators.fr.hyphenate('bibliothèque')) ===
      forme(new Hypher(dictionnaires.fr).hyphenate('bibliothèque')),
  );
}

console.log(`\n${ok ? '\u2713 branchement de l’application conforme' : '\u2717 branchement non conforme'}`);
process.exit(ok ? 0 : 1);
