/* ══════════════════════════════════════════════════════════════════════════
   validate-eps-branchement.mjs — le branchement de l'import PostScript.

   `web/superprint-eps.js` se fait passer pour `window.SPEps`, l'objet que
   `main.js` attend. Ce script le met à l'épreuve **sans navigateur**, dans un
   contexte `node:vm` qui imite ce dont il a besoin, et il vérifie trois choses
   que seule une exécution réelle peut dire :

     1. LE CONTRAT. `main.js` appelle cinq fonctions et lit des champs précis
        (`detect` rend `'eps'`/`'pdf'` ; `stats.chemins` ; `bbox.minX`…). Un
        champ manquant ne se voit pas à la lecture, il se voit à l'import : c'est
        donc ici qu'on le cherche.

     2. LA GÉOMÉTRIE. Les sous-chemins du noyau sont en repère PostScript (y vers
        le haut) ; Fabric attend l'inverse. Le script vérifie la transformation
        sur les témoins réels, et l'ordre des points — une symétrie verticale
        oubliée donnerait un logo à l'envers, ce qui se voit tout de suite, mais
        un décalage d'origine ne se verrait qu'à l'impression.

     3. LES DÉCISIONS MESURÉES. `.ai` qui est un PDF, bloc d'aperçu, `show`
        refusé, et le compte de dessins — les mêmes chiffres que
        `scripts/validate-ps.mjs`, mais obtenus **par le chemin du produit**.

   Usage : node scripts/validate-eps-branchement.mjs
   Retour : 0 si tout passe, 1 sinon.
   ══════════════════════════════════════════════════════════════════════════ */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, '..');
const parent = join(racine, '..');
const app = join(parent, 'superprint', 'app');

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (t) => console.log(`\n== ${t}`);

const CHEMIN_COLLE = join(racine, 'web', 'superprint-eps.js');
for (const [nom, chemin] of [
  ['colle', CHEMIN_COLLE],
  ['module', join(racine, 'dist', 'superprint_eps.wasm')],
]) {
  if (!existsSync(chemin)) {
    console.error(`introuvable (${nom}) : ${chemin}`);
    console.error('(construire : pwsh -File scripts/build-wasm.ps1)');
    process.exit(2);
  }
}

/* ───────────────── Le décor : ce dont la colle a besoin ───────────────── */

/** Un Fabric minimal : assez pour vérifier ce que la colle en fait. */
const appelsFabric = [];
class FauxPath {
  constructor(d, options) {
    this.d = d;
    this.options = options;
    appelsFabric.push({ d, options });
  }
  set(props) {
    Object.assign(this, props);
    return this;
  }
}
class FauxGroup {
  constructor(objets) {
    this.objets = objets;
  }
  set(props) {
    Object.assign(this, props);
    return this;
  }
}
const fabric = {
  Path: FauxPath,
  Group: FauxGroup,
  util: {
    groupSVGElements(objets) {
      return new FauxGroup(objets);
    },
  },
};

/** Une promesse d'un tour de boucle, pour laisser les microtâches se dérouler. */
const tourner = () => new Promise((r) => setTimeout(r, 0));

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
  Uint32Array,
  DataView,
  TextEncoder,
  TextDecoder,
  WebAssembly,
  Promise,
  setTimeout,
  fabric,
  // `fetch` lit sur le disque sous le MÊME chemin relatif que celui écrit dans
  // la colle : un chemin faux échouerait donc aussi dans ce test.
  fetch: async (url) => {
    const chemin = join(app, String(url));
    if (!existsSync(chemin)) return { ok: false, status: 404 };
    const octets = await readFile(chemin);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength),
    };
  },
  // Les écouteurs d'intention : on les enregistre pour pouvoir les déclencher.
  ecouteurs: [],
  document: {
    addEventListener(type, fn) {
      bac.ecouteurs.push({ type, fn });
    },
    getElementById: () => null,
  },
};
bac.globalThis = bac;
bac.window = bac;
bac.self = bac;
vm.createContext(bac);

/* ───────────────── Chargement de la colle ───────────────── */

titre('chargement de la colle');
vm.runInContext(await readFile(CHEMIN_COLLE, 'utf8'), bac, { filename: 'superprint-eps.js' });

check(
  'window.SPEps est ABSENT tant que le module n’est pas prêt',
  typeof bac.SPEps === 'undefined',
  'c’est ce qui fait que main.js charge son module JavaScript au lieu d’échouer',
);
check(
  'la chargement est armé sur l’intention (dragover / drop)',
  bac.ecouteurs.some((e) => e.type === 'dragover') && bac.ecouteurs.some((e) => e.type === 'drop'),
  bac.ecouteurs.map((e) => e.type).join(', ') || 'aucun écouteur',
);

// On déclenche l'intention, comme le ferait un glisser de fichier.
for (const e of bac.ecouteurs.filter((x) => x.type === 'dragover')) e.fn();
for (let essai = 0; essai < 200 && !bac.SuperPrintEps.etat.pret; essai += 1) await tourner();

check('le module s’est chargé', bac.SuperPrintEps.etat.pret === true, bac.SuperPrintEps.etat.raison || '');
if (typeof bac.SPEps === 'undefined') {
  console.error(`\nwindow.SPEps n’a pas été posé : ${bac.SuperPrintEps.etat.raison || 'raison inconnue'}`);
  console.error('(le module est-il livré ? superprint/app/JS/superprint_eps.wasm)');
  process.exit(1);
}
check('window.SPEps est posé', typeof bac.SPEps === 'object' && bac.SPEps !== null);

/* ───────────────── Le contrat que main.js attend ───────────────── */

titre('le contrat de main.js, MESURÉ dans main.js');

// ⚠️ Ici, on ne recopie pas une liste de noms : on lit main.js et on relève
// TOUS les noms qu'il appelle sur l'objet du module. Une liste recopiée dit ce
// qu'on croit ; une liste mesurée dit ce qui se passe — et le jour où main.js
// appellera un nom de plus, ce test le dira au lieu de le laisser passer.
const corpsMain = await readFile(join(app, 'JS', 'main.js'), 'utf8');
const debutBloc = corpsMain.indexOf('function _spEpsEnsureModule');
const finBloc = corpsMain.indexOf('function initEpsImport');
const bloc = corpsMain.slice(debutBloc, finBloc);
check(
  'le bloc d’import EPS est localisé dans main.js',
  debutBloc > 0 && finBloc > debutBloc,
  `lignes ${corpsMain.slice(0, debutBloc + 1).split('\n').length} → ${corpsMain.slice(0, finBloc + 1).split('\n').length}`,
);
const utilises = [...new Set([...bloc.matchAll(/\bmod\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))].sort();
const attendus = ['detect', 'extractPsText', 'importance', 'parse', 'toFabricGroup'];
check(
  'les noms appelés sont exactement ceux que la colle expose',
  utilises.length > 0 && utilises.every((n) => typeof bac.SPEps[n] === 'function'),
  utilises.join(', '),
);
check(
  'et ce sont bien les cinq attendus',
  JSON.stringify(utilises) === JSON.stringify(attendus),
  `mesurés : ${utilises.join(', ')}`,
);
check(
  '`analyse.chemain/fills/strokes/nbInconnus` (les champs que main.js journalise) sont des nombres',
  (() => {
    const r = importer(new TextEncoder().encode('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\nnewpath 0 0 moveto 10 0 lineto 10 10 lineto closepath fill\n'));
    const s = r.analyse.stats;
    return ['chemins', 'fills', 'strokes', 'nbInconnus'].every((k) => typeof s[k] === 'number');
  })(),
);
check('`rust` dit la vérité', bac.SPEps.rust === true);
check(
  '`MM_PER_PT` est le rapport des points PostScript (25,4/72)',
  Math.abs(bac.SPEps.MM_PER_PT - 25.4 / 72) < 1e-12,
);
check(
  '⚠️ les quatre noms du module JavaScript d’origine qui ne sont PAS appelés restent absents',
  ['lireEntete', 'tokenize', 'toSvg', 'toSvgDataUrl'].every((n) => bac.SPEps[n] === undefined),
  'aucune ligne de main.js ne les lit : les ajouter serait du code mort',
);

/* ───────────────── La détection : chaînes, pas entiers ───────────────── */

titre('la détection rend les chaînes du produit, pas les entiers de la frontière');
{
  const cas = [
    [new TextEncoder().encode('%!PS-Adobe-3.0'), 'eps'],
    [new TextEncoder().encode('%PDF-1.6'), 'pdf'],
    [new Uint8Array([0x50, 0x4b, 0x03, 0x04]), 'zip'],
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'inconnu'],
  ];
  for (const [octets, attendu] of cas) {
    const obtenu = bac.SPEps.detect(octets);
    check(`detect(${attendu})`, obtenu === attendu, `→ « ${obtenu} »`);
  }
  check(
    '⚠️ main.js compare `genre === \'pdf\'` : un entier ici casserait l’aiguillage',
    bac.SPEps.detect(new TextEncoder().encode('%PDF-1.6')) === 'pdf',
  );
}

/* ───────────────── Les témoins réels, par le chemin du produit ───────────────── */

titre('les témoins réels, par le chemin exact de main.js');

/** Le code de _spImportEpsFile, réduit à ce qui touche le module. */
function importer(octets) {
  const genre = bac.SPEps.detect(octets);
  if (genre === 'pdf') return { genre };
  if (genre !== 'eps') return { genre };
  const texte = bac.SPEps.extractPsText(octets);
  const analyse = bac.SPEps.parse(texte);
  let res = null;
  try {
    res = bac.SPEps.toFabricGroup(analyse, bac.fabric);
  } catch (e) {
    return { genre, analyse, erreur: e.message };
  }
  return { genre, analyse, res, importance: bac.SPEps.importance(analyse) };
}

const TEMOINS = [
  ['eps-simple.eps', '_dev/fixtures/eps-simple.eps', 3],
  ['eps-preview.eps', '_dev/fixtures/eps-preview.eps', 1],
  ['eps-illustrator.eps', '_dev/fixtures/eps-illustrator.eps', 5],
  ['forme.eps', '_dev/sorties/forme.eps', 2],
];

let totalDessins = 0;
for (const [nom, relatif, attendus] of TEMOINS) {
  const chemin = join(parent, relatif);
  if (!existsSync(chemin)) {
    console.log(`  (absent du dépôt : ${nom})`);
    continue;
  }
  const r = importer(await readFile(chemin));
  if (r.erreur) {
    check(`${nom} : converti en objets Fabric`, false, r.erreur);
    continue;
  }
  totalDessins += r.analyse.stats.dessins;
  check(
    `${nom} : ${r.analyse.stats.dessins} dessin(s) → ${r.res ? r.res.nbPaths : 0} objet(s) Fabric`,
    r.analyse.stats.dessins === attendus && r.res && r.res.nbPaths > 0,
    `importance ${r.importance.toFixed(2)} · boîte ${r.analyse.stats.dessins ? 'ok' : '—'}`,
  );
}
check('total des dessins', totalDessins === 11, `${totalDessins} dessins (attendu 11)`);

/* ───────────────── La géométrie : repère PostScript → Fabric ───────────────── */

titre('la transformation de repère');
{
  // forme.eps : un rectangle de (10,10) à (190,110) et un triangle. La boîte
  // annoncée est 0 0 200 120, donc en repère Fabric :
  //   X = x - 0            Y = 120 - y
  // Le coin (10,10) devient donc (10, 110), et (190,110) devient (190, 10).
  const r = importer(await readFile(join(parent, '_dev/sorties/forme.eps')));
  const premier = r.analyse.dessins[0];
  const points = premier.sousChemins[0];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  check(
    'la boîte est prise dans l’en-tête (0 0 200 120)',
    r.analyse.bbox && r.analyse.bbox[2] === 200 && r.analyse.bbox[3] === 120,
    JSON.stringify(r.analyse.bbox),
  );
  check(
    'les points du noyau sont bien en repère PostScript (y = 110 en haut)',
    Math.max(...ys) === 110 && Math.min(...ys) === 10,
    `y de ${Math.min(...ys)} à ${Math.max(...ys)}`,
  );
  const d = r.res.group.objets ? r.res.group.objets[0].d : r.res.group.d;
  check(
    'le chemin écrit pour Fabric inverse bien y (Y = 120 − y)',
    // (10,10) → « M10 110 » et (190,10) → « L190 110 » : le rectangle est
    // basculé, et le premier point écrit est le coin supérieur gauche.
    d.startsWith('M10 110') && d.includes('L190 110'),
    d.slice(0, 60),
  );
  check(
    'le sous-chemin se ferme (Z) quand le noyau a répété le premier point',
    d.trim().endsWith('Z'),
    '…' + d.slice(-12),
  );
  void xs;
}

/* ───────────────── Les mêmes décisions que validate-ps.mjs ───────────────── */

titre('les décisions mesurées, par le chemin du produit');
{
  const cheminAi = join(parent, '_dev/fixtures/Logo_licra_vecto.ai');
  if (existsSync(cheminAi)) {
    const r = importer(await readFile(cheminAi));
    check(
      'un .ai qui est un PDF est aiguillé vers l’import PDF, pas vers l’EPS',
      r.genre === 'pdf',
      `genre = ${r.genre}`,
    );
  }
}

{
  const source = new TextEncoder().encode(
    '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\n' +
      '%%BeginPreview: 10 10 1 10\n% A5A5A5A5\nA5A5A5A5A5A5A5A5\n%%EndPreview\n' +
      'newpath 0 0 moveto 10 10 lineto stroke\n',
  );
  const r = importer(source);
  check(
    'le bloc d’aperçu est sauté : l’hexadécimal n’est pas pris pour du PostScript',
    r.analyse.stats.dessins === 1 && r.analyse.stats.blocs === 1,
    `${r.analyse.stats.dessins} dessin, ${r.analyse.stats.blocs} bloc`,
  );
}

{
  const r = importer(new TextEncoder().encode('%!PS-Adobe-3.0\n(Bonjour) show\n'));
  check(
    '`show` est refusé, et la raison parle du texte',
    r.analyse.erreur !== null && r.analyse.erreur.includes('show') && r.analyse.erreur.includes('texte'),
    r.analyse.erreur ? r.analyse.erreur.slice(0, 100) : 'aucune erreur',
  );
  // ⚠️ `main.js` teste `!res || !res.group` puis affiche « aucun dessin
  // exploitable ». La colle doit donc rendre `null` — pas un groupe vide, qui
  // passerait ce test et ajouterait un objet invisible au canevas.
  check(
    'aucun objet Fabric n’est produit pour un fichier refusé',
    r.res === null && !r.res,
    `toFabricGroup → ${JSON.stringify(r.res === null ? null : r.res) }`,
  );
}

/* ───────────────── Le repli : sans le module ───────────────── */

titre('le repli : si le module manque, window.SPEps reste absent');
{
  const bacNu = { ...bac, fetch: async () => ({ ok: false, status: 404 }) };
  bacNu.globalThis = bacNu;
  bacNu.window = bacNu;
  bacNu.self = bacNu;
  bacNu.ecouteurs = [];
  bacNu.document = { addEventListener(t, f) { bacNu.ecouteurs.push({ t, f }); }, getElementById: () => null };
  delete bacNu.SPEps;
  delete bacNu.SuperPrintEps;
  vm.createContext(bacNu);
  vm.runInContext(await readFile(CHEMIN_COLLE, 'utf8'), bacNu, { filename: 'superprint-eps.js' });
  for (const e of bacNu.ecouteurs) e.f();
  await tourner();
  await tourner();
  check(
    'window.SPEps n’est PAS posé : main.js chargera son module JavaScript',
    typeof bacNu.SPEps === 'undefined',
    'c’est le comportement d’aujourd’hui, et c’est le bon repli',
  );
  check(
    'et la raison est dite',
    bacNu.SuperPrintEps.etat.raison !== null && bacNu.SuperPrintEps.etat.pret === false,
    bacNu.SuperPrintEps.etat.raison || 'sans raison',
  );
}

console.log(`\n${ok ? '✓ le branchement de l’import PostScript est conforme' : '✗ le branchement n’est pas conforme'}`);
process.exit(ok ? 0 : 1);
