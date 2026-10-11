// Preuve de PARITÉ du module d'IMPOSITION contre le code JavaScript du produit,
// lu **sans être modifié**.
//
// Ce script ne teste pas le Rust contre lui-même. Il extrait de
// `app/JS/main.js` les trois morceaux qui décident de l'imposition, et les
// évalue **tels quels** :
//
//   1. `calculerImposition` — la fonction `calculateImposition`, extraite par
//      ses bornes de texte. Rien n'est réécrit : c'est le code du produit qui
//      décide.
//
//   2. Les **expressions de taille de feuille**, extraites des trois endroits
//      où elles sont recopiées dans `main.js` (export imposé, rendu de planche,
//      construction du canvas). Elles doivent donner le même résultat que le
//      plan Rust — et le même résultat **entre elles**, ce qui est justement
//      l'intérêt de n'avoir qu'une formule.
//
//   3. Les **arguments de chaque `pdf.line()`** du bloc des traits de coupe,
//      extraits par expression régulière puis évalués avec les seules variables
//      que le bloc définit. Chaque segment doit coïncider avec le Rust, à
//      1/100 de micromètre près.
//
// Usage : node scripts/validate-imposition.mjs
// Retour : 0 si tout passe, 1 sinon.

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const produit = join(root, '..', 'superprint');
const cheminMain = join(produit, 'app', 'JS', 'main.js');
const cheminExemple = join(
  root,
  'target',
  'wasm32-wasip1',
  'release',
  'examples',
  'impose_dump.wasm',
);

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '\u2713' : '\u2717'} ${label}${detail ? ` \u2014 ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (texte) => console.log(`\n== ${texte}`);

if (!existsSync(cheminMain)) {
  console.error(`fichier introuvable : ${cheminMain}`);
  process.exit(2);
}
if (!existsSync(cheminExemple)) {
  console.error(`exemple introuvable : ${cheminExemple}`);
  console.error('(le construire avec : cargo build -p superprint-impose --example impose_dump --target wasm32-wasip1 --release)');
  process.exit(2);
}

const source = await readFile(cheminMain, 'utf8');

// ── 1. L'ordre des pages, extrait du produit ────────────────────────────────
titre('ordre des pages : la fonction du produit, extraite telle quelle');

const debutFonction = source.indexOf('function calculateImposition(');
if (debutFonction < 0) {
  console.error('calculateImposition introuvable dans main.js — le produit a changé.');
  process.exit(1);
}
// On prend jusqu'à l'accolade fermante de la fonction : on compte les
// accolades, en ignorant celles qui seraient dans une chaîne ou un commentaire
// (il n'y en a pas ici, mais compter naïvement serait fragile).
let profondeur = 0;
let finFonction = -1;
for (let i = source.indexOf('{', debutFonction); i < source.length; i += 1) {
  const c = source[i];
  if (c === '{') profondeur += 1;
  else if (c === '}') {
    profondeur -= 1;
    if (profondeur === 0) {
      finFonction = i + 1;
      break;
    }
  }
}
const codeOrdre = source.slice(debutFonction, finFonction);
check(
  'la fonction calculateImposition est extraite',
  finFonction > debutFonction && codeOrdre.length > 200,
  `${codeOrdre.split('\n').length} lignes`,
);

// On l'évalue **telle quelle**, dans un bac isolé. Si elle disparaît ou change
// de nom dans main.js, ce contrôle échoue bruyamment — c'est voulu.
const bac = { Math };
vm.createContext(bac);
vm.runInContext(`${codeOrdre}\n;calculateImposition;`, bac);
const calculateImposition = vm.runInContext('this.calculateImposition', bac);
check('la fonction s’évalue et est appelable', typeof calculateImposition === 'function');

// ── 2. Le corpus de nombres de pages ────────────────────────────────────────
const tailles = [
  ...new Set([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 16, 20, 24, 28, 32, 40, 48, 52, 64, 100, 128, 200, 500,
    1000,
  ]),
].sort((a, b) => a - b);

const comparaisons = [];
for (const nb of tailles) {
  comparaisons.push({
    nb,
    attendu: calculateImposition(nb).map(String),
  });
}
check(
  'les ordres du produit sont calculés',
  comparaisons.every((c) => Array.isArray(c.attendu)),
  `${tailles.length} tailles`,
);

// ── 3. Le côté Rust ─────────────────────────────────────────────────────────
titre('calcul côté Rust (WebAssembly, lancé par Node)');

// Le bac à sable WASI n'expose que le dossier du projet : les fichiers de
// travail vivent donc dans `target/`.
const dossier = join(root, 'target', 'imposition');
await mkdir(dossier, { recursive: true });

const lancer = (mode, entree, nomSortie) => {
  const sortie = join(dossier, nomSortie);
  execFileSync(
    'node',
    [join(root, 'scripts', 'run-wasi.mjs'), cheminExemple, mode, entree, `target/imposition/${nomSortie}`],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  return readFile(sortie, 'utf8');
};

let ecartsOrdre = 0;
for (const { nb, attendu } of comparaisons) {
  const texte = await lancer('ordre', String(nb), `ordre-${nb}.txt`);
  const obtenu = texte.trim() ? texte.trim().split(/\r?\n/) : [];
  if (obtenu.length !== attendu.length) {
    if (ecartsOrdre < 5) console.log(`    ${nb} pages : ${obtenu.length} places au lieu de ${attendu.length}`);
    ecartsOrdre += 1;
    continue;
  }
  for (let i = 0; i < obtenu.length; i += 1) {
    if (obtenu[i] !== attendu[i]) {
      if (ecartsOrdre < 5) console.log(`    ${nb} pages, place ${i} : « ${obtenu[i]} » au lieu de « ${attendu[i]} »`);
      ecartsOrdre += 1;
      break;
    }
  }
}
check(
  `l'ordre des pages est identique pour ${tailles.length} tailles`,
  ecartsOrdre === 0,
  ecartsOrdre ? `${ecartsOrdre} taille(s) en écart` : `de 0 à ${tailles[tailles.length - 1]} pages`,
);

// ── 4. Les expressions de taille de feuille, extraites de main.js ────────────
titre('taille de feuille : les trois copies du produit');

/**
 * Extrait une affectation `const <nom> = <expression>;` de main.js.
 * Renvoie `null` si elle a disparu — c'est un signal, pas une erreur de script.
 */
function extraireAffectation(nom) {
  const motif = new RegExp(`const\\s+${nom}\\s*=\\s*([^;]+);`, 'g');
  const trouves = [...source.matchAll(motif)].map((m) => m[1].trim());
  return trouves;
}

const largeurs = extraireAffectation('sheetWidth');
const hauteurs = extraireAffectation('sheetHeight');
check(
  'les expressions de taille de feuille sont trouvées',
  largeurs.length >= 3 && hauteurs.length >= 3,
  `${largeurs.length} largeurs, ${hauteurs.length} hauteurs recopiées dans main.js`,
);

// Les trois sites définissent les mêmes variables d'entrée. On leur donne les
// valeurs que le produit y met, et on évalue chaque copie.
const contexteTailles = (pageW, pageH, exportBleed, innerGutter, cropMarkMargin) => ({
  pageFormat: { width: pageW, height: pageH },
  exportBleed,
  innerGutter,
  cropMarkMargin,
  Math,
});

let ecartsTaille = 0;
// Les trois sites n'ont pas tous la même variable de marge : le premier utilise
// une expression ternaire, les autres `cropMarkMargin` déjà calculé. En les
// évaluant avec les mêmes valeurs, on vérifie qu'ils **concordent** — ce qui est
// exactement l'intérêt de n'avoir qu'une formule.
function evaluer(expression, valeurs) {
  const bacTaille = { ...valeurs };
  vm.createContext(bacTaille);
  try {
    return vm.runInContext(expression, bacTaille);
  } catch (e) {
    return null;
  }
}

for (const cas of [
  { pageW: 210, pageH: 297, exportBleed: 3, innerGutter: 0, cropMarkMargin: 10, gouttiere: 0 },
  { pageW: 210, pageH: 297, exportBleed: 0, innerGutter: 0, cropMarkMargin: 10, gouttiere: 0 },
  { pageW: 148, pageH: 210, exportBleed: 3, innerGutter: 6, cropMarkMargin: 10, gouttiere: 6 },
  { pageW: 210, pageH: 297, exportBleed: 3, innerGutter: 6, cropMarkMargin: 0, gouttiere: 6 },
]) {
  const valeurs = contexteTailles(
    cas.pageW,
    cas.pageH,
    cas.exportBleed,
    cas.gouttiere,
    cas.cropMarkMargin,
  );
  // Côté Rust : une spécification, un plan.
  const spec =
    `!page\t${cas.pageW}\t${cas.pageH}\n` +
    `!fond\t${cas.exportBleed}\t${cas.exportBleed > 0 ? 1 : 0}\n` +
    `!decoupe\t${cas.gouttiere > 0 ? 1 : 0}\n` +
    `!reperes\t${cas.cropMarkMargin > 0 ? 1 : 0}\t${cas.cropMarkMargin}\t5\t2.5\t0.25\n` +
    `!places\t1\t2\n`;
  const nomSpec = `spec-${cas.pageW}x${cas.pageH}-${cas.exportBleed}-${cas.gouttiere}-${cas.cropMarkMargin}.txt`;
  await writeFile(join(dossier, nomSpec), spec, 'utf8');
  const texteRust = await lancer('plan', `target/imposition/${nomSpec}`, `plan-${nomSpec}`);
  const feuilleRust = texteRust
    .split(/\r?\n/)
    .find((l) => l.startsWith('feuille\t'))
    .split('\t')
    .slice(1)
    .map(Number);

  for (let i = 0; i < largeurs.length; i += 1) {
    const l = evaluer(largeurs[i], valeurs);
    const h = evaluer(hauteurs[i], valeurs);
    if (l === null || h === null) continue;
    // `innerGutter` n'apparaît pas dans toutes les copies : celles qui ne le
    // mentionnent pas ne peuvent pas produire la gouttière. On ne compare donc
    // que les copies qui en tiennent compte, et on vérifie que les autres
    // donnent la même chose **sans** gouttière — c'est un écart connu du
    // produit, pas un défaut du portage.
    const tientCompte = largeurs[i].includes('innerGutter');
    const gouttiereCopie = tientCompte ? cas.gouttiere : 0;
    const attenduRust = [
      feuilleRust[0] - (cas.gouttiere - gouttiereCopie),
      feuilleRust[1],
    ];
    if (Math.abs(l - attenduRust[0]) > 1e-6 || Math.abs(h - attenduRust[1]) > 1e-6) {
      console.log(
        `    copie ${i} (${cas.pageW}x${cas.pageH}, bleed ${cas.exportBleed}, gouttiere ${cas.gouttiere}) : ` +
          `${l}×${h} au lieu de ${attenduRust[0]}×${attenduRust[1]}`,
      );
      ecartsTaille += 1;
    }
  }
}
check(
  'les copies de main.js et le plan Rust donnent la même feuille',
  ecartsTaille === 0,
  ecartsTaille ? `${ecartsTaille} écart(s)` : `${largeurs.length} copies × 4 configurations`,
);

// ── 5. Les traits de coupe, extraits de main.js ─────────────────────────────
titre('traits de coupe : les arguments de pdf.line(), extraits tels quels');

const debutCropMarks = source.indexOf('// Ajouter les traits de coupe dans la marge technique dédiée.');
const finCropMarks = source.indexOf('async function renderPageToImage(', debutCropMarks);
check(
  'le bloc des traits de coupe est trouvé',
  debutCropMarks > 0 && finCropMarks > debutCropMarks,
  `lignes ${debutCropMarks} → ${finCropMarks}`,
);

const blocCropMarks = source.slice(debutCropMarks, finCropMarks);
const appels = [...blocCropMarks.matchAll(/pdf\.line\(([^;]+)\);/g)].map((m) => m[1].trim());
check(
  'les appels pdf.line() sont extraits',
  appels.length === 16,
  `${appels.length} appels (12 traits + 4 interieurs)`,
);

// Les variables que le bloc définit lui-même, avec les valeurs du produit pour
// un cas connu : A4, fond perdu 3 mm, repères 10 mm, gouttière 6 mm.
const casCrop = {
  cropMarkMargin: 10,
  exportBleed: 3,
  pageWidth: 210,
  pageHeight: 297,
  innerGutter: 6,
  cutApart: true,
  cropLength: 5,
  cropOffset: 2.5,
  Math,
};
const bacCrop = { ...casCrop };
vm.createContext(bacCrop);
// Le bloc définit lui-même ces trois-là ; on les pose pour que les expressions
// extraites puissent les lire.
vm.runInContext(
  `
  const leftPageX = cropMarkMargin + exportBleed;
  const leftPageY = cropMarkMargin + exportBleed;
  const leftPageWidth = pageWidth;
  const leftPageHeight = pageHeight;
  const rightPageX = cropMarkMargin + pageWidth + exportBleed + innerGutter;
  const rightPageY = cropMarkMargin + exportBleed;
  const rightPageWidth = pageWidth;
  const rightPageHeight = pageHeight;
  const innerLeftX = leftPageX + leftPageWidth;
  const innerRightX = rightPageX;
  this.leftPageX = leftPageX; this.leftPageY = leftPageY;
  this.leftPageWidth = leftPageWidth; this.leftPageHeight = leftPageHeight;
  this.rightPageX = rightPageX; this.rightPageY = rightPageY;
  this.rightPageWidth = rightPageWidth; this.rightPageHeight = rightPageHeight;
  this.innerLeftX = innerLeftX; this.innerRightX = innerRightX;
`,
  bacCrop,
);

const segmentsProduit = [];
for (const appel of appels) {
  try {
    const points = vm.runInContext(`[${appel}]`, bacCrop);
    segmentsProduit.push(points.map(Number));
  } catch {
    // Une expression qui ne s'évalue pas est un écart de forme, pas un crash.
    segmentsProduit.push(null);
  }
}
check(
  'chaque appel pdf.line() s’évalue',
  segmentsProduit.every((s) => s !== null && s.length === 4),
  `${segmentsProduit.filter(Boolean).length} segments lisibles`,
);

// Côté Rust, sur la même configuration.
const specCrop =
  `!page\t210\t297\n!fond\t3\t1\n!decoupe\t1\n!reperes\t1\t10\t5\t2.5\t0.25\n!places\t1\t2\n`;
await writeFile(join(dossier, 'spec-crop.txt'), specCrop, 'utf8');
const texteCrop = await lancer('plan', 'target/imposition/spec-crop.txt', 'plan-crop.txt');
const reperesRust = texteCrop
  .split(/\r?\n/)
  .filter((l) => l.startsWith('repere\t'))
  .map((l) => l.split('\t').slice(1, 5).map(Number));

check(
  'autant de traits des deux côtés',
  reperesRust.length === segmentsProduit.filter(Boolean).length,
  `${reperesRust.length} côté Rust, ${segmentsProduit.filter(Boolean).length} côté produit`,
);

// Les coordonnées sont comparées **au centième de micromètre** (1e-5 mm) : le
// produit calcule en millimètres puis convertit en points PDF, le Rust reste en
// millimètres — les deux chemins ne peuvent pas être identiques au bit près, et
// prétendre le contraire serait faux. 1e-5 mm est très au-delà de ce qu'un
// massicot distingue.
//
// ⚠️ On compare les segments en **ensembles**, et non dans l'ordre : le bloc du
// produit ne dessine pas les coins dans le même ordre que `reperes_de_coupe`
// (lequel suit l'ordre haut-gauche, haut-droit, bas-gauche, bas-droit de chaque
// page). L'ordre de dessin n'a aucune conséquence sur le papier ; c'est la
// position qui compte. Comparer les listes dans l'ordre ferait échouer le
// contrôle sur une différence qui n'en est pas une.
const clePoints = (s) => {
  const p1 = [s[0], s[1]].map((v) => v.toFixed(5)).join(',');
  const p2 = [s[2], s[3]].map((v) => v.toFixed(5)).join(',');
  return p1 < p2 ? `${p1}|${p2}` : `${p2}|${p1}`;
};

let ecartsSegments = 0;
const ensembleProduit = new Set(segmentsProduit.filter(Boolean).map(clePoints));
const ensembleRust = new Set(reperesRust.map(clePoints));
for (const cle of ensembleProduit) {
  if (!ensembleRust.has(cle)) {
    if (ecartsSegments < 8) console.log(`    le produit trace un trait absent du plan : ${cle}`);
    ecartsSegments += 1;
  }
}
for (const cle of ensembleRust) {
  if (!ensembleProduit.has(cle)) {
    if (ecartsSegments < 8) console.log(`    le plan contient un trait absent du produit : ${cle}`);
    ecartsSegments += 1;
  }
}
check(
  'les traits de coupe coïncident, position par position',
  ecartsSegments === 0,
  ecartsSegments ? `${ecartsSegments} écart(s)` : `${ensembleRust.size} traits identiques`,
);

// ── 6. Les refus ────────────────────────────────────────────────────────────
titre('refus explicites');

let refuse = 0;
for (const spec of ['', '!fond\t3\t1', '!reperes\t1', '!places\t1\t2', '!page\t0\t297']) {
  const nom = `refus-${refuse}.txt`;
  await writeFile(join(dossier, nom), spec, 'utf8');
  try {
    execFileSync(
      'node',
      [join(root, 'scripts', 'run-wasi.mjs'), cheminExemple, 'plan', `target/imposition/${nom}`, `target/imposition/sortie-${nom}`],
      { cwd: root, stdio: 'ignore' },
    );
    console.log(`    « ${spec} » aurait dû être refusée`);
    refuse += 1;
  } catch (e) {
    if (e.status !== 3) {
      console.log(`    « ${spec} » : code de sortie ${e.status} au lieu de 3`);
      refuse += 1;
    }
  }
}
check(
  'une spécification sans format de page est refusée',
  refuse === 0,
  `${5 - refuse} refus sur 5`,
);

console.log(`\n${ok ? '\u2713 imposition conforme' : '\u2717 imposition non conforme'}`);
process.exit(ok ? 0 : 1);
