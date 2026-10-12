/* ══════════════════════════════════════════════════════════════════════════
   validate-rtf.mjs — le lecteur RTF du noyau, confronté à celui du produit.

   Le portage du RTF a une chance que les autres n'ont pas : le produit possède
   DÉJÀ un lecteur RTF correct, `spRtfToText`, écrit et corrigé sur des
   documents réels. La preuve n'est donc pas d'écrire un troisième lecteur — ce
   qui serait un troisième jeu de conventions à défendre — mais d'**extraire les
   fonctions du produit** et d'exiger l'égalité **caractère par caractère**.

   Ce que ce contrôle vérifie, et chaque point a sa raison :

     1. LA PARITÉ, SUR LES FICHIERS RÉELS DU DÉPÔT. Le texte rendu par le noyau
        doit être identique, caractère pour caractère, à `spRtfToText` du
        produit. Pas « équivalent » : identique — c'est du texte, et une espace
        de différence se voit dans une mise en page.

     2. LES CAS QUI PIÈGENT, ÉCRITS À LA MAIN. Un accord entre deux lecteurs peut
        être un accord sur la même erreur. Les caractères accentués, le repli
        `\uN`, le `\uc0`, le `\*`, les tirets typographiques et le contenu des
        tables sont donc aussi vérifiés contre des **attendus calculés ici**, à
        partir de la spécification.

     3. LE FORMAT DE PAGE, EN STRUCTURE. `spRtfPageSize` donne le format en
        millimètres ; le noyau doit donner le même, et refuser ce qu'il refuse.

     4. LES REFUS. Un fichier qui n'est pas un RTF est refusé **en le nommant**,
        pas lu de travers.

   Usage : node scripts/validate-rtf.mjs
   Retour : 0 si tout passe, 1 sinon.
   ══════════════════════════════════════════════════════════════════════════ */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const dossier = join(racine, 'target', 'rtf');
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

/** Lance le banc et rend `{ code, sortie }` sans lever. */
function lancerSouple(...args) {
  try {
    return { code: 0, sortie: lancer(...args) };
  } catch (erreur) {
    return { code: erreur.status ?? 1, sortie: String(erreur.stderr ?? '') };
  }
}

/* ────────────── extraction des fonctions du produit ────────────── */

const cheminProduit = join(parent, 'superprint', 'app', 'JS', 'sp-doc-import.js');
if (!existsSync(cheminProduit)) {
  console.error(`introuvable : ${cheminProduit}`);
  process.exit(2);
}
const sourceProduit = readFileSync(cheminProduit, 'utf8');

/**
 * Extrait le corps d'une fonction, par comptage d'accolades.
 *
 * On ne recopie PAS le RTF du produit : on lit son fichier. Le jour où sa
 * fonction change, ce contrôle change avec elle — c'est exactement ce qu'on veut
 * d'une comparaison.
 */
function extraireFonction(source, nom) {
  const debut = source.indexOf(`function ${nom}(`);
  if (debut < 0) return null;
  let profondeur = 0;
  for (let i = source.indexOf('{', debut); i < source.length; i += 1) {
    if (source[i] === '{') profondeur += 1;
    else if (source[i] === '}') {
      profondeur -= 1;
      if (profondeur === 0) return source.slice(debut, i + 1);
    }
  }
  return null;
}

/** Extrait une affectation `var NAME = { … };` par comptage d'accolades. */
function extraireObjet(source, nom) {
  const debut = source.indexOf(`var ${nom} = {`);
  if (debut < 0) return null;
  let profondeur = 0;
  for (let i = source.indexOf('{', debut); i < source.length; i += 1) {
    if (source[i] === '{') profondeur += 1;
    else if (source[i] === '}') {
      profondeur -= 1;
      if (profondeur === 0) return source.slice(debut, i + 1) + ';';
    }
  }
  return null;
}

/** Extrait une affectation simple `var NAME = …;`. */
function extraireAffectation(source, nom) {
  const motif = new RegExp(`var\\s+${nom}\\s*=\\s*[^;]+;`);
  const trouve = source.match(motif);
  return trouve ? trouve[0] : null;
}

const morceaux = {
  cp1252: extraireObjet(sourceProduit, 'SP_DOC_CP1252'),
  cp1252Char: extraireFonction(sourceProduit, 'spCp1252Char'),
  skip: extraireObjet(sourceProduit, 'SP_RTF_SKIP'),
  layout: extraireFonction(sourceProduit, 'spRtfLayoutInfo'),
  texte: extraireFonction(sourceProduit, 'spRtfToText'),
  twips: extraireAffectation(sourceProduit, 'SP_TWIPS_PAR_MM'),
  cote: extraireFonction(sourceProduit, 'spCoteValide'),
  page: extraireFonction(sourceProduit, 'spRtfPageSize'),
};

titre('extraction des fonctions du produit');
{
  const manquants = Object.entries(morceaux)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  check(
    'les huit morceaux du lecteur RTF sont extraits de sp-doc-import.js',
    manquants.length === 0,
    manquants.length ? `manquants : ${manquants.join(', ')}` : Object.keys(morceaux).join(', '),
  );
}

const bac = {};
vm.createContext(bac);
vm.runInContext(Object.values(morceaux).join('\n'), bac);
const produit = {
  texte: bac.spRtfToText,
  layout: bac.spRtfLayoutInfo,
  page: bac.spRtfPageSize,
  cp1252: bac.spCp1252Char,
};
check(
  'et les fonctions s’évaluent hors du navigateur',
  typeof produit.texte === 'function' &&
    typeof produit.layout === 'function' &&
    typeof produit.page === 'function',
);

/** Les octets lus en latin-1, comme le fait `spBytesToLatin1`. */
const enLatin1 = (octets) => octets.toString('latin1');

const versDossier = (nom) => join(dossier, nom);

/* ────────────── 1. la parité, sur les fichiers réels ────────────── */

titre('parité, caractère par caractère, sur les RTF du dépôt');

const TEMOINS = [
  ['test.rtf', '_dev/fixtures-396/_fixtures_396/test.rtf'],
  ['lettre.rtf', '_dev/fixtures-rock/lettre.rtf'],
  ['_test_word.rtf', '_dev/sorties/_test_word.rtf'],
  ['rapport-test.rtf', '_dev/sorties/rapport-test.rtf'],
  ['renomme.odt', '_dev/fixtures-396/_fixtures_396/renomme.odt'],
];

let temoinsLus = 0;
let caracteresCompares = 0;
let ecarts = 0;
const absents = [];
for (const [nom, relatif] of TEMOINS) {
  const chemin = join(parent, relatif);
  if (!existsSync(chemin)) {
    absents.push(nom);
    continue;
  }
  const octets = readFileSync(chemin);
  // Certains témoins ne portent que la signature : on les saute sans les
  // compter, mais on le DIT — un témoin sauté en silence est un contrôle en
  // moins.
  if (!(octets[0] === 0x7b && octets[1] === 0x5c)) {
    console.log(`  ⚠️ ${nom} ne commence pas par « {\\ » : sauté`);
    continue;
  }
  const copie = versDossier(nom);
  writeFileSync(copie, octets);
  const { code, sortie } = lancerSouple('texte', `target/rtf/${nom}`, `target/rtf/${nom}.txt`);
  if (code !== 0) {
    console.log(`  ✗ ${nom} : le noyau a refusé — ${sortie.trim().split('\n')[0]}`);
    ecarts += 1;
    continue;
  }
  const duNoyau = readFileSync(versDossier(`${nom}.txt`), 'utf8');
  const duProduit = produit.texte(enLatin1(octets));

  if (duNoyau === duProduit) {
    caracteresCompares += duNoyau.length;
    temoinsLus += 1;
    continue;
  }
  // Le premier écart, avec son contexte : c'est ce qui rend un écart de texte
  // exploitable au lieu d'être un « les deux ne sont pas égaux ».
  let i = 0;
  while (i < Math.min(duNoyau.length, duProduit.length) && duNoyau[i] === duProduit[i]) i += 1;
  console.log(
    `  ✗ ${nom} : premier écart au caractère ${i}\n` +
      `      produit ${JSON.stringify(duProduit.slice(Math.max(0, i - 20), i + 30))}\n` +
      `      noyau   ${JSON.stringify(duNoyau.slice(Math.max(0, i - 20), i + 30))}`,
  );
  ecarts += 1;
}
if (absents.length) console.log(`  témoins absents du dépôt : ${absents.join(', ')}`);
check(
  `les ${temoinsLus} RTF du dépôt donnent le même texte`,
  ecarts === 0 && temoinsLus >= 3,
  ecarts ? `${ecarts} écart(s)` : `${caracteresCompares} caractères identiques`,
);

/* ────────────── 2. les cas qui piègent, écrits à la main ────────────── */

titre('les cas qui piègent : attendus calculés ici, pas par le produit');

/** Le texte du noyau pour une source RTF écrite à la main. */
function texteDuNoyau(source) {
  const nom = 'cas.rtf';
  writeFileSync(versDossier(nom), Buffer.from(source, 'latin1'));
  const { code } = lancerSouple('texte', `target/rtf/${nom}`, `target/rtf/${nom}.txt`);
  if (code !== 0) return null;
  return readFileSync(versDossier(`${nom}.txt`), 'utf8');
}

const CAS = [
  {
    nom: 'le balisage disparaît, le texte reste',
    source: '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\froman Times;}}Bonjour.}',
    attendu: (t) => t.trim() === 'Bonjour.' && !t.includes('fonttbl'),
  },
  {
    nom: 'les octets accentués passent par la table CP1252',
    // 80 = signe euro, e9 = « é » latin-1, 93/94 = guillemets français.
    source: "{\\rtf1 120\\'80 et caf\\'e9 \\'93Bonjour\\'94}",
    attendu: (t) => t.includes('120\u20AC') && t.includes('caf\u00E9') && t.includes('\u201CBonjour\u201D'),
  },
  {
    nom: 'l’apostrophe de repli ne laisse pas son « ? »',
    source: '{\\rtf1 l\\u8217?artisan}',
    attendu: (t) => t.includes('l\u2019artisan') && !t.includes('?'),
  },
  {
    nom: 'et un « ? » voulu reste un « ? » quand il n’y a aucun repli',
    source: '{\\rtf1\\uc0 Question \\u8217?}',
    attendu: (t) => t.includes('\u2019?'),
  },
  {
    nom: 'un groupe destiné à être ignoré l’est vraiment',
    source: '{\\rtf1{\\*\\generator Riched20 10.0;}Texte.}',
    attendu: (t) => t.trim() === 'Texte.' && !t.includes('Riched20'),
  },
  {
    nom: 'la table des couleurs ne pollue pas le texte',
    source: '{\\rtf1{\\colortbl;\\red255\\green0\\blue0;}Rouge.}',
    attendu: (t) => t.trim() === 'Rouge.' && !t.includes('red255'),
  },
  {
    nom: 'les tirets typographiques sont des caractères, pas du balisage',
    source: '{\\rtf1 un\\emdash deux\\endash trois}',
    attendu: (t) => t.includes('un\u2014deux\u2013trois'),
  },
  {
      nom: 'les paragraphes et les tabulations séparent',
    source: '{\\rtf1 un\\par deux\\tab trois}',
      // ⚠️ `\tab` produit une tabulation, mais la **normalisation des blancs** la
      // ramène à une espace : c'est ce que fait le produit, et le noyau le suit.
      attendu: (t) => t.includes('un\n') && t.includes('deux trois'),
    },
    {
      nom: 'un saut de page est marqué, et compte',
      source: '{\\rtf1 page une\\page page deux}',
      attendu: (t) => t.includes('[PAGE 2]') && t.includes('PAGES : au moins 2'),
    },
    {
      nom: 'l’en-tête est lu par la mise en page, PAS mis dans le corps',
      source: '{\\rtf1{\\header CONFIDENTIEL\\chpgn}corps du document}',
      // ⚠️ Le marqueur de numéro de page du produit est écrit `{N}`, puis ses
      // propres accolades sont remplacées par des espaces : il ressort donc en
      // « N ». Défaut du produit, reproduit — et c'est la comparaison avec sa
      // fonction qui le garantit.
      attendu: (t) =>
        t.includes('EN-TETE : CONFIDENTIEL N') &&
        t.trim().endsWith('corps du document') &&
        !t.split('[FIN DE LA MISE EN PAGE]')[1].includes('CONFIDENTIEL'),
    },
];

let casJustes = 0;
for (const cas of CAS) {
  const texte = texteDuNoyau(cas.source);
  const parite = texte === produit.texte(cas.source);
  const juste = texte !== null && cas.attendu(texte);
  if (juste && parite) {
    casJustes += 1;
  } else {
    console.log(
      `  ✗ ${cas.nom}\n      noyau   ${JSON.stringify((texte ?? 'REFUSÉ').slice(0, 120))}\n` +
        `      produit ${JSON.stringify(produit.texte(cas.source).slice(0, 120))}`,
    );
  }
}
check(
  `les ${CAS.length} cas qui piègent passent, et le produit dit la même chose`,
  casJustes === CAS.length,
  `${casJustes} / ${CAS.length}`,
);

/* ────────────── 3. le format de page, en structure ────────────── */

titre('format de page : twips → millimètres, et les bornes');

let pagesJustes = 0;
let pagesTestees = 0;
for (const source of [
  '{\\rtf1\\paperw11906\\paperh16838}',   // A4 portrait
  '{\\rtf1\\paperw16838\\paperh11906}',   // A4 paysage
  '{\\rtf1\\paperw8391\\paperh11906}',    // A5
  '{\\rtf1\\paperw12240\\paperh15840}',   // Letter
  '{\\rtf1\\paperw10\\paperh10}',         // absurde : refusé
  '{\\rtf1\\paperw999999\\paperh16838}',  // hors bornes : refusé
  '{\\rtf1}',                             // pas de format : rien
]) {
  const nom = 'page.rtf';
  writeFileSync(versDossier(nom), Buffer.from(source, 'latin1'));
  const { code, sortie } = lancerSouple('resume', `target/rtf/${nom}`, `target/rtf/${nom}.tsv`);
  const attendu = produit.page(source);
  pagesTestees += 1;
  if (code !== 0) {
    console.log(`  ✗ ${source} : le noyau a refusé`);
    continue;
  }
  const lignes = readFileSync(versDossier(`${nom}.tsv`), 'utf8').split(/\r?\n/);
  const format = (lignes.find((l) => l.startsWith('format\t')) ?? '').split('\t')[1];
  const lignePage = lignes.find((l) => l.startsWith('page\t'));
  // ⚠️ Le banc écrit `page\t-` quand le document ne déclare pas de format :
  // c'est un **sentinelle**, pas une valeur. La lire comme un nombre donnerait
  // `NaN`, et le contrôle croirait à un désaccord là où les deux disent « aucun
  // format ».
  const brut = lignePage ? lignePage.split('\t').slice(1) : null;
  const duNoyau = brut && brut[0] !== '-' && !brut[0].startsWith('?') ? brut.slice(0, 2).map(Number) : null;
  const meme =
    format === 'rtf' &&
    (attendu === null
      ? duNoyau === null
      : duNoyau !== null && duNoyau[0] === attendu.w && duNoyau[1] === attendu.h);
  if (meme) {
    pagesJustes += 1;
  } else {
    console.log(
      `  ✗ ${source} : produit ${attendu ? `${attendu.w}×${attendu.h}` : 'refusé'}, ` +
        `noyau ${duNoyau ? duNoyau.join('×') : 'refusé'} (format ${format})`,
    );
  }
}
check(
  `le format de page coïncide avec spRtfPageSize sur ${pagesTestees} cas`,
  pagesJustes === pagesTestees,
  `${pagesJustes} / ${pagesTestees}`,
);

/* ────────────── 4. les refus ────────────── */

titre('refus explicites');

{
  const nom = 'pas-rtf.rtf';
  writeFileSync(versDossier(nom), Buffer.from('Bonjour tout le monde', 'latin1'));
  const sortie = versDossier(`${nom}.tsv`);
  lancerSouple('resume', `target/rtf/${nom}`, `target/rtf/${nom}.tsv`);
  // ⚠️ Le banc écrit ses refus **dans le fichier**, avec un code de retour nul :
  // c'est la convention de tous les bancs du dépôt, et c'est le `erreur` du TSV
  // qui fait foi. Lire le code de sortie seul ferait passer un refus pour un
  // succès.
  const tsv = existsSync(sortie) ? readFileSync(sortie, 'utf8') : '';
  const erreur = (tsv.split(/\r?\n/).find((l) => l.startsWith('erreur\t')) ?? '').slice(7);
  check(
    'des octets qui ne sont ni une archive ni un RTF sont refusés, et l’erreur le dit',
    erreur.length > 0,
    erreur ? erreur.slice(0, 110) : 'AUCUN REFUS',
  );
}

{
  // Le refus **nommé** du lecteur RTF lui-même : une source qui commence par
  // `{\` mais qui n'est pas du RTF du tout est refusée par le module, avec ce
  // qu'il a trouvé à la place.
  const nom = 'accolade.rtf';
  writeFileSync(versDossier(nom), Buffer.from('{\\pas-du-rtf', 'latin1'));
  const sortie = versDossier(`${nom}.tsv`);
  lancerSouple('resume', `target/rtf/${nom}`, `target/rtf/${nom}.tsv`);
  const tsv = existsSync(sortie) ? readFileSync(sortie, 'utf8') : '';
  const format = (tsv.split(/\r?\n/).find((l) => l.startsWith('format\t')) ?? '').split('\t')[1];
  // Ici le fichier **est** routé vers le lecteur RTF (il commence par `{\`) et
  // il est lu : c'est le comportement voulu — un RTF sans en-tête reste du
  // texte. Ce qui est vérifié est donc qu'il n'est pas pris pour autre chose.
  check(
    'une source qui commence par `{\\` est lue comme du RTF, pas comme une archive',
    format === 'rtf',
    `format : ${format ?? 'aucun'}`,
  );
}

{
  // Le témoin réel : un OpenDocument **renommé** qui contient du RTF. Le noyau
  // déduit le format du contenu, donc il le lit comme du RTF — et c'est un
  // changement de comportement assumé, dit dans `docs/PORTAGE.md`.
  const chemin = join(parent, '_dev', 'fixtures-396', '_fixtures_396', 'renomme.odt');
  if (existsSync(chemin)) {
    const octets = readFileSync(chemin);
    const nom = 'renomme-en-rtf.rtf';
    writeFileSync(versDossier(nom), octets);
    lancerSouple('resume', `target/rtf/${nom}`, `target/rtf/${nom}.tsv`);
    const tsv = readFileSync(versDossier(`${nom}.tsv`), 'utf8');
    const format = (tsv.split(/\r?\n/).find((l) => l.startsWith('format\t')) ?? '').split('\t')[1];
    check(
      'un `.odt` qui contient du RTF est lu comme du RTF, pas refusé',
      format === 'rtf',
      `format : ${format ?? 'aucun'}`,
    );
  } else {
    console.log('  (témoin `renomme.odt` absent du dépôt)');
  }
}

console.log(
  ok
    ? '\nOK : le lecteur RTF du noyau dit exactement ce que dit celui du produit.'
    : '\n✗ le lecteur RTF diverge du produit.',
);
process.exit(ok ? 0 : 1);
