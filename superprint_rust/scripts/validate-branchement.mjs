// Preuve de PARITÉ du **branchement** : ce qui sera réellement installé dans
// l'application doit rendre exactement ce que rend `Hypher` aujourd'hui.
//
// Ce script ne teste pas la colle contre elle-même. Il prend les trois pièces
// réelles et les met face à face :
//
//   1. `web/superprint-core.js`   la colle, **telle qu'elle sera livrée**
//   2. `dist/superprint_core.wasm` le noyau compilé par `build-wasm.ps1`
//   3. `app/JS/hypher.js` + `app/JS/hyphenation-*.js`
//                                 le moteur et les dictionnaires du produit,
//                                 lus **sans être modifiés**
//
// Le point comparé est celui du branchement, et lui seul : les **fragments du
// dictionnaire**. C'est exactement ce que `Hypher.prototype.hyphenate` rend, et
// c'est le seul niveau que le branchement remplace — le filtrage typographique
// français et l'ajout des traits d'union restent dans `main.js`, qui continue
// de les appliquer comme avant.
//
// Comparer un niveau plus large (le mot déjà filtré et tireté) ne prouverait
// rien sur le branchement : ce serait mesurer du code qu'on n'installe pas.
//
// Usage : node scripts/validate-branchement.mjs
// Retour : 0 si tout passe, 1 sinon.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);
const produit = join(root, '..', 'superprint');

const cheminColle = join(root, 'web', 'superprint-core.js');
const cheminWasm = join(root, 'dist', 'superprint_core.wasm');
const cheminHypher = join(produit, 'app', 'JS', 'hypher.js');

/** Les langues que `main.js` sait brancher (`_spHyphenSource`). */
const langues = [
  ['fr', 'fr'],
  ['en', 'en-us'],
  ['de', 'de'],
  ['es', 'es'],
  ['it', 'it'],
];

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '\u2713' : '\u2717'} ${label}${detail ? ` \u2014 ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (texte) => console.log(`\n== ${texte}`);

for (const fichier of [cheminColle, cheminWasm, cheminHypher]) {
  if (!existsSync(fichier)) {
    console.error(`fichier introuvable : ${fichier}`);
    console.error('(le noyau se construit avec : pwsh -File scripts/build-wasm.ps1)');
    process.exit(2);
  }
}

// ── 1. La colle et le noyau ─────────────────────────────────────────────────
titre('colle et noyau, tels qu’ils seront livrés');

require(cheminColle);
const { SuperPrintCore } = globalThis;
check('la colle expose sa surface publique', typeof SuperPrintCore?.load === 'function');

const octets = await readFile(cheminWasm);
const moteur = await SuperPrintCore.load({ bytes: octets, fallback: false });
check('le noyau est bien du WebAssembly', moteur.backend === 'wasm', `backend=${moteur.backend}`);
check(
  'la colle expose la césure',
  ['chargerMotifs', 'coupes', 'fragments', 'cesureReset'].every((nom) => typeof moteur[nom] === 'function'),
);

// ── 2. Les dictionnaires du produit ─────────────────────────────────────────
titre('dictionnaires du produit (lecture seule)');

const { Hypher } = require(cheminHypher);
check('hypher.js chargé', typeof Hypher === 'function');

const dictionnaires = {};
for (const [langue, source] of langues) {
  const fichier = join(produit, 'app', 'JS', `hyphenation-${langue}.js`);
  if (!existsSync(fichier)) {
    check(`hyphenation-${langue}.js présent`, false, 'fichier absent');
    continue;
  }
  const charge = require(fichier);
  const definition = charge.Hyphenation?.[source];
  if (!definition?.patterns) {
    check(`dictionnaire « ${source} » lisible`, false);
    continue;
  }
  dictionnaires[langue] = {
    definition,
    moteurJs: new Hypher(definition),
    rang: moteur.chargerMotifs(definition),
  };
  const motifs = Object.values(definition.patterns).reduce((total, chaine) => total + chaine.length, 0);
  check(
    `dictionnaire « ${source} » chargé dans le noyau`,
    Number.isInteger(dictionnaires[langue].rang) && dictionnaires[langue].rang >= 0,
    `rang=${dictionnaires[langue].rang}, bornes=${definition.leftmin}/${definition.rightmin}, ${motifs} car. de motifs`,
  );
}

// Deux dictionnaires chargés doivent occuper des rangs **distincts** : sinon le
// second écraserait le premier, et toutes les langues se couperaient avec les
// motifs de la dernière chargée — un défaut invisible sur un test anglais.
const rangs = Object.values(dictionnaires).map((d) => d.rang);
check('les rangs sont distincts', new Set(rangs).size === rangs.length, `rangs=[${rangs.join(', ')}]`);

// ── 3. Le corpus ────────────────────────────────────────────────────────────
titre('corpus');

const sourcesProse = [
  join(produit, 'faq.html'),
  join(produit, 'ORGANISATION.md'),
  join(produit, 'TRADEMARKS.md'),
  join(root, 'README.md'),
];

const pieges = [
  "l'habillage", 'aujourd’hui', "quelqu'un", "c'est-à-dire", 'presqu’île', "entr'acte",
  'grand-mère', 'États-Unis', 'arc-en-ciel', 'porte-monnaie', 'week-end', 'rendez-vous',
  'prochable', 'tableau', 'travail', 'irréel', 'constipation', 'astrophysique',
  'bibliothèque', 'chronologie', 'méthode', 'signature', 'guerre', 'équation',
  'à', 'où', 'ça', 'déjà', 'café', 'forêt', 'hôtel', 'château', 'élève', 'aiguë',
  'anticonstitutionnellement', 'internationalisation', 'responsabilité',
  'particulièrement', 'environnemental', 'administration',
  'et', 'ou', 'de', 'la', 'le', 'un', 'avec', 'pour', 'tout', 'très',
  'chef-d’œuvre', 'pèse-lettre', 'savoir-faire', 'va-et-vient',
];

const prose = (
  await Promise.all(sourcesProse.filter(existsSync).map((fichier) => readFile(fichier, 'utf8')))
).join('\n');

// Même filtre que `validate-cesure.mjs` : de vrais mots, rien d'autre. Le trait
// d'union est en **fin** de classe, sans quoi il formerait entre `'` et `’` une
// plage Unicode qui englobe la barre oblique et la parenthèse.
const MOT_PROPRE = /^[\p{Letter}\p{Mn}'\u2019\u2010\u2011\u2013\u2014-]+$/u;
const motsProse = prose
  .split(/\s+/)
  .map((mot) => mot.trim())
  .filter((mot) => mot.length >= 5 && mot.length <= 40 && MOT_PROPRE.test(mot));

const corpusFr = [...new Set([...pieges, ...motsProse])].filter((mot) => !mot.includes('\u00AD'));
check('corpus français', corpusFr.length > 400, `${corpusFr.length} mots uniques`);

// Un corpus anglais, court mais réel : il prouve que le branchement ne se
// contente pas de fonctionner pour une seule langue.
const corpusEn = (
  'hyphenation typesetting imposition preflight responsibility internationalisation ' +
  'environmental characteristic administration documentation compression typography ' +
  'supercalifragilistic the and for with without through acknowledge'
).split(/\s+/);
check('corpus anglais', corpusEn.length > 10, `${corpusEn.length} mots`);

// ── 4. La comparaison ───────────────────────────────────────────────────────
titre('fragments : moteur du produit contre noyau branché');

function comparer(langue, mots) {
  const entree = dictionnaires[langue];
  if (!entree) {
    check(`comparaison ${langue}`, false, 'dictionnaire absent');
    return;
  }
  const ecarts = [];
  const forme = (liste) => (Array.isArray(liste) && liste.length > 1 ? liste.join('|') : '-');
  for (const mot of mots) {
    const attendu = entree.moteurJs.hyphenate(mot);
    const obtenu = moteur.fragments(entree.rang, mot);
    const reference = forme(attendu && attendu.length ? attendu : [mot]);
    if (forme(obtenu) !== reference) {
      if (ecarts.length < 12) ecarts.push(`${mot}: attendu=${reference} obtenu=${forme(obtenu)}`);
    }
    // Invariant de forme : la concaténation doit redonner le mot, sinon la
    // composition afficherait autre chose que ce que l'utilisateur a saisi.
    if (obtenu.join('') !== mot) {
      ecarts.push(`${mot}: recomposition fautive (« ${obtenu.join('')} »)`);
    }
  }
  check(
    `${langue} : ${mots.length} mots identiques`,
    ecarts.length === 0,
    ecarts.length ? `${ecarts.length} écart(s)` : 'fragments et recomposition',
  );
  for (const ligne of ecarts.slice(0, 12)) console.log(`    ${ligne}`);
}

comparer('fr', corpusFr);
comparer('en', corpusEn);

// ── 5. Le contrat d'erreur de la colle ──────────────────────────────────────
titre('refus explicites (la colle ne doit jamais deviner)');

let refuse = false;
try {
  moteur.chargerMotifs({ patterns: { 2: '1ç1j1q' } });
} catch (erreur) {
  refuse = erreur?.code === SuperPrintCore.ERR.BAD_INPUT;
}
check('un dictionnaire sans bornes est refusé', refuse);

let rangInconnuRefuse = false;
try {
  moteur.fragments(9999, 'tableau');
} catch (erreur) {
  rangInconnuRefuse = erreur?.code === SuperPrintCore.ERR.BAD_INPUT;
}
check('un rang inconnu est refusé', rangInconnuRefuse);

check(
  'le nombre de dictionnaires correspond',
  (() => {
    try {
      moteur.cesureReset();
      const apres = moteur.chargerMotifs(dictionnaires.fr.definition);
      return apres === 0;
    } catch {
      return false;
    }
  })(),
  'rechargement après remise à zéro',
);

console.log(`\n${ok ? '\u2713 branchement conforme' : '\u2717 branchement non conforme'}`);
process.exit(ok ? 0 : 1);
