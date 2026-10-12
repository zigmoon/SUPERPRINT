/* ══════════════════════════════════════════════════════════════════════════
   validate-xlsx.mjs — le classeur `.xlsx` du noyau, confronté à SheetJS.

   Le noyau ne lisait pas le `.xlsx` du tout. Le produit, lui, embarque un
   lecteur `.xlsx` complet : **SheetJS** (`superprint/app/JS/xlsx.full.min.js`,
   Apache-2.0, 951 904 octets), lu ici **sur place et jamais modifié**. C'est
   donc la référence : non pas un troisième lecteur écrit par nous, ce qui
   serait un troisième jeu de conventions à défendre, mais l'implémentation de
   référence du format, celle qui sert déjà en production.

   Ce que ce contrôle vérifie, et chaque point a sa raison :

     1. LA PARITÉ, CELLULE PAR CELLULE, SUR LE TÉMOIN RÉEL. Le seul classeur
        du dépôt (`_dev/sorties/_test_excel.xlsx`) est lu par le noyau et par
        SheetJS ; l'égalité est exigée sur l'ordre et le nom des feuilles, la
        plage couverte, chaque référence, chaque type et chaque valeur — pas
        « à peu près » : la référence, le type et la valeur, cellule par cellule.

     2. UN SECOND TÉMOIN, ENGENDRÉ PAR SheetJS LUI-MÊME. Le témoin réel porte
        ses chaînes en ligne (`inlineStr`) et n'a ni largeur de colonne ni
        fusion : il n'atteint donc pas le chemin des **chaînes partagées**, ni
        `cols`, ni `mergeCells`, ni une feuille masquée. Le second témoin est
        écrit par SheetJS (`bookSST`, fusions, largeurs, trois feuilles dont une
        `hidden`, booléens et erreurs) : c'est un fichier que nous n'avons pas
        produit, et qui exerce ce que le premier n'exerce pas.

        Une erreur se compare par son **nom**, pas par la valeur de SheetJS :
        en relisant le `<v>#DIV/0!</v>` qu'il vient d'écrire, SheetJS rend
        `{t:'e', v:7, w:'#DIV/0!'}` — le code dans `v`, le nom dans `w`. Opposer
        `7` à `#DIV/0!` ne dirait rien de la lecture ; c'est `w` qui porte le
        fait, et c'est `w` qui est comparé.

     3. LES LARGEURS, LES FUSIONS ET LES CHAÎNES PARTAGÉES, CONTRÔLÉES AUSSI SUR
        LE XML BRUT. SheetJS ne rend pas `!cols` à la relecture par défaut ; une
        comparaison qui s'appuierait sur lui seul laisserait donc passer une
        largeur fausse. Ces trois faits sont donc relus dans le **XML extrait
        par le noyau** (`doc_dump xml`) et comptés ici, indépendamment — un
        `<col min max width>` par largeur, un `<si>` par chaîne partagée, un
        `<mergeCell ref>` par fusion. Les largeurs se comparent à l'identique,
        sans tolérance : le `<col width="22.83203125">` de SheetJS vaut
        `22.83203125`, et non `22.83`.

     4. LES RENOMMAGES ET LES PANNES. Un `.rtf` renommé `.xlsx` et un `.docx`
        renommé `.xlsx` sont lus pour **ce qu'ils sont** — c'est la signature qui
        décide, pas l'extension — et le modèle de cellules, qui n'en a pas,
        refuse alors d'inventer une grille. Un classeur tronqué et un fichier
        vide sont refusés de même, en disant pourquoi.

   Usage : node scripts/validate-xlsx.mjs
   Retour : 0 si tout passe, 1 sinon.
   ══════════════════════════════════════════════════════════════════════════ */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, '..');
const parent = join(racine, '..');
const cheminExemple = join(
  racine,
  'target',
  'wasm32-wasip1',
  'release',
  'examples',
  'doc_dump.wasm',
);
const cheminSheetJs = join(parent, 'superprint', 'app', 'JS', 'xlsx.full.min.js');
const temoinReel = join(parent, '_dev', 'sorties', '_test_excel.xlsx');
const rtfReel = join(parent, '_dev', 'sorties', 'rapport-test.rtf');
const docxReel = join(parent, '_dev', 'docx-test', 'titre4.docx');

const dossier = join(racine, 'target', 'xlsx');
mkdirSync(dossier, { recursive: true });

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '\u2713' : '\u2717'} ${label}${detail ? ` \u2014 ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (t) => console.log(`\n== ${t}`);

if (!existsSync(cheminExemple)) {
  console.error(`introuvable : ${cheminExemple}`);
  console.error(
    '(construire : cargo build -p superprint-doc --example doc_dump --target wasm32-wasip1 --release)',
  );
  process.exit(2);
}
if (!existsSync(cheminSheetJs)) {
  console.error(`introuvable : ${cheminSheetJs}`);
  process.exit(2);
}

/** Lance le banc en traduisant les chemins pour le bac à sable WASI. */
function lancer(...args) {
  const traduits = args.map((a) =>
    typeof a === 'string' && a.startsWith(dossier)
      ? a.slice(racine.length + 1).split('\\').join('/')
      : a,
  );
  return execFileSync(
    process.execPath,
    [join(racine, 'scripts', 'run-wasi.mjs'), cheminExemple, ...traduits],
    { stdio: 'pipe', cwd: racine },
  ).toString();
}
function lancerSouple(...args) {
  try {
    return { code: 0, sortie: lancer(...args) };
  } catch (e) {
    return { code: e.status ?? 1, sortie: `${e.stdout || ''}${e.stderr || ''}` };
  }
}
const temporaire = (nom) => join(dossier, nom);

/* ─────────────────────────── chargement de SheetJS ────────────────────────
   `xlsx.full.min.js` est un paquet UMD : il s'installe dans `module.exports`
   quand il en trouve un. On lui en donne un, dans un contexte `node:vm` isolé
   — le fichier n'est ni copié ni modifié, il est lu et exécuté tel quel. */
function chargerSheetJs() {
  const source = readFileSync(cheminSheetJs, 'utf8');
  const bac = {
    module: { exports: {} },
    exports: {},
    console,
    process,
    Buffer,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    ArrayBuffer,
    Date,
    Math,
    JSON,
    Object,
    String,
    Number,
    Boolean,
    Error,
    RegExp,
    Map,
    Set,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
  };
  bac.globalThis = bac;
  bac.window = bac;
  bac.module.exports = bac.exports;
  vm.createContext(bac);
  vm.runInContext(source, bac, { filename: 'xlsx.full.min.js' });
  const paquet = bac.module.exports.read ? bac.module.exports : bac.XLSX;
  if (!paquet || typeof paquet.read !== 'function') {
    throw new Error('SheetJS chargé mais sans fonction `read`');
  }
  return paquet;
}
const XLSX = chargerSheetJs();

/* ─────────────── le dump du noyau, relu comme un jeu de faits ─────────────
   `doc_dump classeur` écrit un TSV : un fait par ligne. On déballe les
   échappements (`\t`, `\n`, `\\`) dans le même ordre que le Rust les a posés,
   en un seul passage — un remplacement successif mangerait les doubles. */
const ECHAPPEMENTS = { '\\': '\\', t: '\t', n: '\n', r: '\r' };
function desechapper(texte) {
  let sortie = '';
  for (let i = 0; i < texte.length; i += 1) {
    const suivant = texte[i] === '\\' ? texte[i + 1] : undefined;
    if (suivant !== undefined && suivant in ECHAPPEMENTS) {
      sortie += ECHAPPEMENTS[suivant];
      i += 1;
    } else {
      sortie += texte[i];
    }
  }
  return sortie;
}

function classeurDuNoyau(chemin) {
  const sortie = temporaire('classeur.tsv');
  const r = lancerSouple('classeur', chemin, sortie);
  if (r.code !== 0) return { erreur: `banc sorti en ${r.code} : ${r.sortie}` };
  const lignes = readFileSync(sortie, 'utf8').split('\n').filter(Boolean);
  const retour = { feuilles: [], texte: [], avertissements: [], chaines: null };
  for (const ligne of lignes) {
    const champs = ligne.split('\t');
    const genre = champs[0];
    if (genre === 'erreur') return { erreur: desechapper(champs[1] ?? '') };
    if (genre === 'chaines_partagees') retour.chaines = Number(champs[1]);
    else if (genre === 'avertissement') retour.avertissements.push(desechapper(champs[1]));
    else if (genre === 'feuille')
      retour.feuilles.push({
        rang: Number(champs[1]),
        nom: desechapper(champs[2]),
        etat: champs[3],
        entree: champs[4],
        plage: null,
        cellules: new Map(),
        colonnes: [],
        fusions: [],
        lignes: [],
      });
    else if (genre === 'texte') retour.texte.push(desechapper(champs[2]));
    else {
      const feuille = retour.feuilles[Number(champs[1])];
      if (!feuille) continue;
      if (genre === 'plage') feuille.plage = champs[2] === '-' ? null : [champs[2], champs[3]];
      else if (genre === 'cellule')
        feuille.cellules.set(champs[2], { genre: champs[3], texte: desechapper(champs[4]) });
      else if (genre === 'colonne')
        feuille.colonnes.push({
          premiere: Number(champs[2]),
          derniere: Number(champs[3]),
          largeur: Number(champs[4]),
          masquee: champs[5] === '1',
        });
      else if (genre === 'fusion') feuille.fusions.push([champs[2], champs[3]]);
      else if (genre === 'ligne') feuille.lignes.push(desechapper(champs[3]));
    }
  }
  return retour;
}

/** Extrait une entrée du classeur par le noyau, et la rend en texte. */
function entreeBrute(classeur, entree) {
  const sortie = temporaire('entree.xml');
  const r = lancerSouple('xml', classeur, entree, sortie);
  if (r.code !== 0) return null;
  return readFileSync(sortie, 'utf8');
}

/* ─────────────────────────── notations A1 ↔ index ─────────────────────────
   Écrites ici, à partir de la définition (numération bijective), pour que la
   comparaison ne dépende pas de la conversion du noyau : deux conversions
   fausses de la même façon s'accorderaient. */
function colonneDepuisLettres(lettres) {
  let colonne = 0;
  for (const c of lettres) colonne = colonne * 26 + (c.charCodeAt(0) - 64);
  return colonne - 1;
}
function lettresDepuisColonne(colonne) {
  let reste = colonne + 1;
  let sortie = '';
  while (reste > 0) {
    const chiffre = (reste - 1) % 26;
    sortie = String.fromCharCode(65 + chiffre) + sortie;
    reste = (reste - 1 - chiffre) / 26;
  }
  return sortie;
}
function referenceEnIndex(a1) {
  const m = /^([A-Z]+)([0-9]+)$/.exec(a1);
  if (!m) return null;
  return { colonne: colonneDepuisLettres(m[1]), ligne: Number(m[2]) - 1 };
}
function indexEnReference(colonne, ligne) {
  return `${lettresDepuisColonne(colonne)}${ligne + 1}`;
}

/* ─────────────────────── lecture de SheetJS, normalisée ───────────────────
   SheetJS range ses feuilles dans un objet et ses cellules dans le même
   objet, préfixées par `!` pour les métadonnées. On en tire des faits
   comparables : nom, état, plage, cellules (référence, type, valeur), fusions. */
function classeurDeSheetJs(octets) {
  const wb = XLSX.read(octets, { type: 'buffer' });
  const feuilles = [];
  for (const nom of wb.SheetNames) {
    const ws = wb.Sheets[nom];
    const masquage = wb.Workbook?.Sheets?.find((s) => s.name === nom)?.Hidden ?? 0;
    const cellules = new Map();
    let debut = null;
    let fin = null;
    for (const cle of Object.keys(ws)) {
      if (cle.startsWith('!')) continue;
      const reference = referenceEnIndex(cle);
      if (!reference) continue;
      const cellule = ws[cle];
      // `w` est la **forme écrite** de la cellule, `v` sa valeur : pour une
      // erreur, SheetJS range un code numérique dans `v` et le nom dans `w`.
      cellules.set(cle, { genre: cellule.t ?? 'n', brute: cellule.v, ecrit: cellule.w });
      if (!debut) debut = { ...reference };
      debut.colonne = Math.min(debut.colonne, reference.colonne);
      debut.ligne = Math.min(debut.ligne, reference.ligne);
      if (!fin) fin = { ...reference };
      fin.colonne = Math.max(fin.colonne, reference.colonne);
      fin.ligne = Math.max(fin.ligne, reference.ligne);
    }
    feuilles.push({
      nom,
      etat: masquage === 1 ? 'hidden' : masquage === 2 ? 'veryHidden' : 'visible',
      plage: debut && fin ? [indexEnReference(debut.colonne, debut.ligne), indexEnReference(fin.colonne, fin.ligne)] : null,
      cellules,
      fusions: (ws['!merges'] ?? []).map((m) => [
        indexEnReference(m.s.c, m.s.r),
        indexEnReference(m.e.c, m.e.r),
      ]),
    });
  }
  return feuilles;
}

/* ─────────────────────── comparaison, terme à terme ─────────────────────── */
function memeNombre(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return false;
  return Math.abs(x - y) <= 1e-12 * Math.max(1, Math.abs(x), Math.abs(y));
}

/**
 * Compare le noyau et SheetJS sur un même fichier. Rend le nombre de cellules
 * comparées, ou lève — un `throw` plutôt qu'un `check` : une comparaison
 * fausse à un endroit doit se voir tout de suite, avec la référence.
 */
function comparerCellules(prefixe, noyau, attendu) {
  let comparees = 0;
  for (let i = 0; i < attendu.length; i += 1) {
    const f = attendu[i];
    const n = noyau.feuilles[i];
    if (!n) {
      check(`${prefixe} : la feuille ${i} (« ${f.nom} ») est lue`, false, 'absente du noyau');
      continue;
    }
    check(`${prefixe} : feuille ${i} — nom et état`, n.nom === f.nom && n.etat === f.etat, `« ${n.nom} »/${n.etat} contre « ${f.nom} »/${f.etat}`);
    const plage = n.plage ? n.plage.join(':') : null;
    const plageAttendue = f.plage ? f.plage.join(':') : null;
    check(`${prefixe} : feuille ${i} — la plage couverte`, plage === plageAttendue, `${plage} contre ${plageAttendue}`);

    for (const [a1, cellule] of f.cellules) {
      const vue = n.cellules.get(a1);
      if (!vue) {
        check(`${prefixe} : ${f.nom}!${a1} (${cellule.genre}) est lue`, false, 'cellule absente du noyau');
        continue;
      }
      // Les types `d` (date ISO) ne sont pas couverts : le noyau ne convertit
      // jamais un nombre en date, et une date écrite comme chaîne arrive en `s`.
      if (cellule.genre === 'd') {
        check(`${prefixe} : ${f.nom}!${a1} — le type « d » de SheetJS n'est pas couvert`, false, 'témoin à changer, ou lecteur à étendre');
        continue;
      }
      const sien = cellule.genre === 's' || cellule.genre === 'str' ? 's' : cellule.genre;
      if (vue.genre !== sien) {
        check(`${prefixe} : ${f.nom}!${a1} — le type`, false, `« ${vue.genre} » contre « ${sien} »`);
        continue;
      }
      let egal;
      let ecrit = String(cellule.brute);
      if (sien === 'n') egal = memeNombre(vue.texte, cellule.brute);
      else if (sien === 'b')
        egal = (vue.texte === 'VRAI') === (cellule.brute === true || cellule.brute === 1);
      else if (sien === 'e') {
        // Une erreur se compare par son **nom**, jamais par `v` : en relisant un
        // `<v>#DIV/0!</v>`, SheetJS rend `{t:'e', v:7, w:'#DIV/0!'}` — un code
        // contre un nom ne dirait rien. Le noyau, lui, lit le nom écrit dans le
        // fichier ; c'est `w` qui porte le fait, et c'est donc `w` qu'on oppose.
        ecrit = String(cellule.ecrit);
        egal = vue.texte === cellule.ecrit;
      } else egal = vue.texte === String(cellule.brute);
      check(
        `${prefixe} : ${f.nom}!${a1} vaut la même chose`,
        egal,
        egal ? `${sien} ${vue.texte}` : `« ${vue.texte} » contre « ${ecrit} »`,
      );
      comparees += 1;
    }

    // Une cellule que le noyau invente (absente chez SheetJS) est un mensonge
    // aussi : on compte les références de part et d'autre.
    const enPlus = [...n.cellules.keys()].filter((a1) => !f.cellules.has(a1));
    check(`${prefixe} : feuille ${i} — aucune cellule inventée`, enPlus.length === 0, enPlus.slice(0, 5).join(', '));

    const fusions = n.fusions.map(([a, b]) => `${a}:${b}`).sort().join(' ');
    const fusionsAttendues = f.fusions.map(([a, b]) => `${a}:${b}`).sort().join(' ');
    check(`${prefixe} : feuille ${i} — les fusions`, fusions === fusionsAttendues, `« ${fusions} » contre « ${fusionsAttendues} »`);

    const hauteur = n.plage
      ? referenceEnIndex(n.plage[1]).ligne - referenceEnIndex(n.plage[0]).ligne + 1
      : 0;
    check(`${prefixe} : feuille ${i} — une ligne de texte par ligne de grille`, n.lignes.length === hauteur, `${n.lignes.length} contre ${hauteur}`);
    check(
      `${prefixe} : feuille ${i} — aucune ligne ne finit par une tabulation`,
      n.lignes.every((l) => !l.endsWith('\t')),
    );
  }
  return comparees;
}

/* ─────────────────── le second témoin, écrit par SheetJS ────────────────── */
function engendrerTemoin() {
  const aoa = [
    ['Article', 'Date', 'Quantite', 'Prix', 'Remise', 'Actif', 'Note'],
    ['Reliure dos carre', '2026-03-15', 12, 1450.5, 0.15, true, { t: 'e', v: 7, w: '#DIV/0!' }],
    ['Papier couche 170g', '2026-04-02', 240, 89.9, 0.075, false, { t: 'e', v: 15, w: '#VALUE!' }],
  ];
  const commandes = XLSX.utils.aoa_to_sheet(aoa);
  commandes['!ref'] = 'A1:G3';
  commandes['!cols'] = [22, 12, 9, 11, 8, 7, 9].map((wch) => ({ wch }));
  commandes['!merges'] = [{ s: { r: 4, c: 0 }, e: { r: 5, c: 2 } }];
  const classeur = {
    SheetNames: ['Commandes', 'Divers', 'Cachee'],
    Sheets: {
      Commandes: commandes,
      Divers: XLSX.utils.aoa_to_sheet([['Feuille cachee'], ['controle']]),
      Cachee: XLSX.utils.aoa_to_sheet([['secret']]),
    },
    Workbook: {
      Sheets: [
        { name: 'Commandes', Hidden: 0 },
        { name: 'Divers', Hidden: 0 },
        { name: 'Cachee', Hidden: 1 },
      ],
    },
  };
  // `bookSST` est indispensable : sans lui, SheetJS écrit des chaînes en ligne,
  // et le chemin des chaînes partagées ne serait pas exercé.
  const octets = XLSX.write(classeur, { type: 'buffer', bookType: 'xlsx', bookSST: true });
  writeFileSync(temporaire('engendre-par-sheetjs.xlsx'), octets);
  return octets;
}

/* ─────────────────────────────── 1. témoin réel ─────────────────────────── */
titre('1. le témoin réel du dépôt (_dev/sorties/_test_excel.xlsx)');

if (!existsSync(temoinReel)) {
  check('le témoin réel est là', false, temoinReel);
} else {
  const octets = readFileSync(temoinReel);
  const aLire = temporaire('reel.xlsx');
  copyFileSync(temoinReel, aLire);
  console.log(`   ${octets.length} octets, lu par SheetJS ${XLSX.version}`);
  const noyau = classeurDuNoyau(aLire);
  const attendu = classeurDeSheetJs(octets);
  if (noyau.erreur) {
    check('le noyau lit le témoin réel', false, noyau.erreur);
  } else {
    check('le noyau lit le témoin réel', true, `${noyau.feuilles.length} feuilles`);
    const n = comparerCellules('réel', noyau, attendu);
    console.log(`   ${n} cellules comparées`);
    check(
      'le témoin réel n’a pas de chaînes partagées (il porte des chaînes en ligne)',
      noyau.chaines === 0,
      `chaines_partagees = ${noyau.chaines}`,
    );
  }
}

/* ──────────────────────────── 2. témoin engendré ────────────────────────── */
titre('2. le témoin engendré par SheetJS (chaînes partagées, largeurs, fusions, feuille masquée)');

const octetsEngendres = engendrerTemoin();
const noyauEngendre = classeurDuNoyau(temporaire('engendre-par-sheetjs.xlsx'));
const attenduEngendre = classeurDeSheetJs(octetsEngendres);
if (noyauEngendre.erreur) {
  check('le noyau lit le témoin engendré', false, noyauEngendre.erreur);
} else {
  check('le noyau lit le témoin engendré', true, `${noyauEngendre.feuilles.length} feuilles`);
  const n = comparerCellules('engendré', noyauEngendre, attenduEngendre);
  console.log(`   ${n} cellules comparées`);
  check(
    'les chaînes partagées sont comptées, et leur nombre est celui du fichier',
    noyauEngendre.chaines === 14,
    `chaines_partagees = ${noyauEngendre.chaines}`,
  );
  check('aucun avertissement : tout le classeur a été lu', noyauEngendre.avertissements.length === 0, noyauEngendre.avertissements.join(' | '));
}

/* ─────── 3. largeurs, fusions et chaînes, relues dans le XML brut ───────── */
titre('3. les largeurs, les fusions et les chaînes partagées, comptées dans le XML');

/* Un scan indépendant, minuscule et volontairement naïf : on cherche les
   balises, on compte. Il ne s'agit pas d'analyser du XML — `validate-doc.mjs`
   le fait ailleurs — mais de compter des faits pour les opposer au noyau. */
const balises = (xml, nom) => {
  const trouvees = [];
  const motif = new RegExp(`<${nom}\\b([^>]*?)/?>`, 'g');
  let m;
  while ((m = motif.exec(xml)) !== null) trouvees.push(m[1]);
  return trouvees;
};
const attribut = (attrs, nom) => {
  const m = new RegExp(`\\b${nom}="([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
};

const fichierEngendre = temporaire('engendre-par-sheetjs.xlsx');
const feuilleXml = entreeBrute(fichierEngendre, 'xl/worksheets/sheet1.xml');
const chainesXml = entreeBrute(fichierEngendre, 'xl/sharedStrings.xml');
const classeurXml = entreeBrute(fichierEngendre, 'xl/workbook.xml');

if (feuilleXml === null || chainesXml === null || classeurXml === null) {
  check('les entrées du classeur sont extractibles par le noyau', false);
} else {
  check('les entrées du classeur sont extractibles par le noyau', true);

  const cols = balises(feuilleXml, 'col');
  check('le fichier déclare bien sept colonnes', cols.length === 7, `${cols.length} <col>`);
  const largeurs = cols.map((attrs) => ({
    debut: Number(attribut(attrs, 'min')),
    fin: Number(attribut(attrs, 'max')),
    largeur: Number(attribut(attrs, 'width')),
  }));
  const largeursNoyau = noyauEngendre.feuilles?.[0]?.colonnes ?? [];
  check(
    'les largeurs lues sont exactement celles du XML',
    largeursNoyau.length === largeurs.length &&
      largeurs.every((l, i) => {
        const sien = largeursNoyau[i];
        return (
          sien &&
          sien.premiere === l.debut - 1 &&
          sien.derniere === l.fin - 1 &&
          // Égalité **exacte**, sans tolérance : `doc_dump` écrit la largeur
          // telle qu'elle est lue, et une marge de tolérance laisserait passer
          // une largeur fausse mais proche — c'est-à-dire tout ce qu'un lecteur
          // peut se tromper à faire (`22.83203125` contre `22.83`).
          sien.largeur === l.largeur &&
          sien.masquee === false
        );
      }),
    `noyau ${largeursNoyau.map((c) => c.largeur).join(', ')} contre XML ${largeurs.map((l) => l.largeur).join(', ')}`,
  );

  const fusionsXml = balises(feuilleXml, 'mergeCell').map((a) => attribut(a, 'ref'));
  const fusionsNoyau = (noyauEngendre.feuilles?.[0]?.fusions ?? []).map(([a, b]) => `${a}:${b}`);
  check(
    'les fusions lues sont exactement celles du XML',
    fusionsXml.length === fusionsNoyau.length && fusionsXml.every((r, i) => r === fusionsNoyau[i]),
    `${fusionsNoyau.join(' ')} contre ${fusionsXml.join(' ')}`,
  );

  // `uniqueCount` est le nombre de chaînes distinctes ; `<si>` en est la liste,
  // et seul `<si>` peut se compter sans faire confiance à l'en-tête du fichier.
  const si = balises(chainesXml, 'si');
  check(
    'le nombre de chaînes partagées est celui des <si> du fichier',
    noyauEngendre.chaines === si.length,
    `${noyauEngendre.chaines} contre ${si.length} <si>`,
  );

  const feuillesXml = balises(classeurXml, 'sheet').map((a) => ({
    nom: attribut(a, 'name'),
    etat: attribut(a, 'state') ?? 'visible',
  }));
  const feuillesNoyau = (noyauEngendre.feuilles ?? []).map((f) => ({ nom: f.nom, etat: f.etat }));
  check(
    'l’ordre et l’état des feuilles sont ceux de xl/workbook.xml',
    feuillesXml.length === feuillesNoyau.length &&
      feuillesXml.every((f, i) => f.nom === feuillesNoyau[i].nom && f.etat === feuillesNoyau[i].etat),
    `${feuillesNoyau.map((f) => `${f.nom}/${f.etat}`).join(' ')} contre ${feuillesXml.map((f) => `${f.nom}/${f.etat}`).join(' ')}`,
  );
}

/* ────────────────────────────── 4. les refus ────────────────────────────── */
titre('4. les renommages et les pannes');

{
  // Un `.rtf` renommé `.xlsx` : la **signature** décide, comme pour le `.docx`
  // ci-dessous. Le noyau l'ouvre donc comme un RTF — et le modèle de cellules,
  // qui n'en a pas, doit le dire au lieu d'inventer une grille. Les deux
  // moitiés sont vérifiées : ce que le noyau en fait, et ce qu'il refuse d'en
  // faire.
  const aLire = temporaire('rtf-renomme.xlsx');
  if (existsSync(rtfReel)) {
    copyFileSync(rtfReel, aLire);
    const resume = temporaire('resume-rtf.tsv');
    const r = lancerSouple('resume', aLire, resume);
    const tsv = r.code === 0 ? readFileSync(resume, 'utf8') : '';
    check(
      'un .rtf renommé .xlsx est lu comme un .rtf (la signature décide, pas l’extension)',
      /^format\trtf$/m.test(tsv),
      tsv.split('\n')[0] || `banc sorti en ${r.code}`,
    );
    const c = classeurDuNoyau(aLire);
    check(
      'un .rtf renommé .xlsx ne produit pas de grille inventée',
      Boolean(c.erreur) && /classeur/i.test(c.erreur),
      c.erreur ?? 'aucune erreur : une grille a été inventée',
    );
  } else {
    check('un .rtf témoin est disponible pour le renommage', false, rtfReel);
  }
}

if (existsSync(docxReel)) {
  const aLire = temporaire('docx-renomme.xlsx');
  copyFileSync(docxReel, aLire);
  const sortie = temporaire('resume.tsv');
  const r = lancerSouple('resume', aLire, sortie);
  const resume = r.code === 0 ? readFileSync(sortie, 'utf8') : '';
  check(
    'un .docx renommé .xlsx est lu comme un .docx (la signature décide, pas l’extension)',
    /^format\tdocx$/m.test(resume),
    resume.split('\n').slice(0, 2).join(' / ') || `banc sorti en ${r.code}`,
  );
} else {
  check('un .docx témoin est disponible pour le renommage', false, docxReel);
}

{
  const entiers = readFileSync(temoinReel);
  const aLire = temporaire('tronque.xlsx');
  writeFileSync(aLire, entiers.subarray(0, 400));
  const r = classeurDuNoyau(aLire);
  check(
    'un classeur tronqué est refusé, et non lu de travers',
    Boolean(r.erreur),
    r.erreur ?? 'aucune erreur : une grille a été inventée',
  );

  const vide = temporaire('vide.xlsx');
  writeFileSync(vide, Buffer.alloc(0));
  const r2 = classeurDuNoyau(vide);
  check(
    'un fichier vide est refusé, et non lu de travers',
    Boolean(r2.erreur),
    r2.erreur ?? 'aucune erreur : une grille a été inventée',
  );
}

/* ───────── 5. la limite mesurée : le format d'affichage du tableur ──────────
   Le noyau lit la **valeur stockée** et ne lit aucun format de nombre : la
   cellule d'une date est un nombre (le rang de jours depuis 1899-12-30), une
   remise de 15 % est `0.15`. Le produit, lui, lit `raw:false` — « valeurs
   AFFICHÉES » — et c'est écrit dans `main.js:41062-41077` avec la raison, en
   toutes lettres : sans cela « une date devenait un numéro de série, un
   pourcentage 0,15, une devise perdait son symbole ».

   C'est donc LA question qui décide du branchement du `.xlsx` : brancher le
   noyau tel quel **changerait ce que l'utilisateur voit**. Ce n'est pas une
   supposition sur ce que ferait un lecteur sans format, c'est un écart qu'on
   peut chiffrer — et voici les trois cellules qui le chiffrent, lues des deux
   façons, avec les options recopiées du produit. */
titre('5. la limite mesurée : le noyau lit la valeur, le produit affiche la forme');

{
  const aoa = [
    ['Echeance', 'Remise', 'Prix'],
    [
      { t: 'n', v: 46096, z: 'dd/mm/yyyy' },
      { t: 'n', v: 0.15, z: '0%' },
      { t: 'n', v: 1450.5, z: '#,##0.00 €' },
    ],
  ];
  const avecFormats = XLSX.utils.aoa_to_sheet(aoa);
  avecFormats['!ref'] = 'A1:C2';
  const octets = XLSX.write(
    { SheetNames: ['Tarifs'], Sheets: { Tarifs: avecFormats } },
    { type: 'buffer', bookType: 'xlsx' },
  );
  const aLire = temporaire('formats.xlsx');
  writeFileSync(aLire, octets);

  const noyau = classeurDuNoyau(aLire);
  const feuille = XLSX.read(octets, { type: 'buffer' }).Sheets.Tarifs;
  const commun = { header: 1, defval: '' };
  const stockees = XLSX.utils.sheet_to_json(feuille, { ...commun, raw: true })[1];
  // Les options du produit, recopiées de `main.js` : `raw:false` et
  // `dateNF: 'dd/mm/yyyy'`.
  const affichees = XLSX.utils.sheet_to_json(feuille, {
    ...commun,
    raw: false,
    dateNF: 'dd/mm/yyyy',
  })[1];

  // Les trois cellules de la ligne 2, dans l'ordre A, B, C.
  const references = ['A2', 'B2', 'C2'];
  if (noyau.erreur) {
    check('le classeur porteur de formats est lisible', false, noyau.erreur);
  } else {
    check('le classeur porteur de formats est lisible', true);
    references.forEach((reference, i) => {
      const lue = noyau.feuilles[0].cellules.get(reference);
      const stockee = String(stockees[i]);
      const affichee = String(affichees[i]);
      check(
        `le noyau lit la valeur stockée de ${reference}, pas la forme affichée`,
        Boolean(lue) && Number(lue.texte) === Number(stockee),
        `noyau « ${lue ? lue.texte : '—'} », stockée « ${stockee} », affichée « ${affichee} »`,
      );
    });

    // Le contrôle qui **fige la limite** : si un jour le noyau lit les formats
    // de nombre, cette ligne échouera. C'est voulu — elle doit forcer la mise à
    // jour de `PORTAGE.md`, pas passer inaperçue.
    const ecarts = references.map((reference, i) => {
      const lue = noyau.feuilles[0].cellules.get(reference);
      return lue && lue.texte !== String(affichees[i]);
    });
    check(
      'l’écart avec les « valeurs affichées » du produit est réel, et il est mesuré ici',
      ecarts.every(Boolean),
      references
        .map((r, i) => `${r} ${noyau.feuilles[0].cellules.get(r)?.texte ?? '—'} → « ${affichees[i]} »`)
        .join(' · '),
    );
  }
}

console.log(`\n${ok ? 'OK : tout est conforme.' : 'ÉCHEC.'}`);
process.exit(ok ? 0 : 1);
