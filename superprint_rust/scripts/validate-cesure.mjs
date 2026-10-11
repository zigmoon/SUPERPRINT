// Preuve de PARITÉ du module de césure (`superprint-text`) contre le code
// JavaScript de SuperPrint, lu **sans être modifié**.
//
// Ce script ne teste pas le Rust contre lui-même : il met les deux moteurs face
// à face sur le même corpus.
//
//   CÔTÉ JAVASCRIPT — les fichiers réels du dépôt :
//     • `app/JS/hypher.js`        le moteur de césure par dictionnaire (Liang)
//     • `app/JS/hyphenation-fr.js` les motifs français du produit
//     • `app/JS/main.js`          les règles typographiques françaises
//                                 (bloc « CÉSURE : RÈGLES TYPOGRAPHIQUES
//                                 FRANÇAISES »), extraites par bornes de texte
//                                 et évaluées telles quelles
//
//   CÔTÉ RUST — l'exemple `cesure_dump`, compilé en WebAssembly et lancé par
//   Node (le crate n'a pas besoin du linker natif).
//
// Sept valeurs sont comparées pour chaque mot, dont une **position par
// position** (`frontieres`) : une coupe fautive ne peut pas passer inaperçue.
//
// Le corpus est du **vrai texte français** : les mots sont extraits du README
// du produit, accents et apostrophes compris. On y ajoute une liste de cas
// pièges — élisions, mots composés, digraphes — parce que ce sont exactement
// ceux qui avaient produit des coupes fautives dans l'application.
//
// Usage : node scripts/validate-cesure.mjs
// Retour : 0 si tout passe, 1 sinon.

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);
const produit = join(root, '..', 'superprint');

const cheminHypher = join(produit, 'app', 'JS', 'hypher.js');
const cheminMotifs = join(produit, 'app', 'JS', 'hyphenation-fr.js');
const cheminMain = join(produit, 'app', 'JS', 'main.js');
const cheminExemple = join(root, 'target', 'wasm32-wasip1', 'release', 'examples', 'cesure_dump.wasm');

// Le corpus de prose : plusieurs sources, prises dans le dépôt, pour que le
// test reste utile même si l'une d'elles change de nom.
const sourcesProse = [
  join(produit, 'faq.html'),
  join(produit, 'ORGANISATION.md'),
  join(produit, 'TRADEMARKS.md'),
  join(root, 'README.md'),
  join(root, 'docs', 'PLAN.md'),
];

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '\u2713' : '\u2717'} ${label}${detail ? ` \u2014 ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (text) => console.log(`\n== ${text}`);

for (const fichier of [cheminHypher, cheminMotifs, cheminMain]) {
  if (!existsSync(fichier)) {
    console.error(`fichier introuvable : ${fichier}`);
    process.exit(2);
  }
}

// ── 1. Le moteur JavaScript, tel quel ───────────────────────────────────────
titre('moteur JavaScript du produit (lecture seule)');

const { Hypher } = require(cheminHypher);
const langue = require(cheminMotifs);
const fr = langue.Hyphenation.fr;
check('hypher.js et les motifs français chargés', typeof Hypher === 'function' && !!fr.patterns);
check(
  'bornes des motifs français',
  fr.leftmin === 2 && fr.rightmin === 3,
  `leftmin=${fr.leftmin}, rightmin=${fr.rightmin}`,
);

const hypher = new Hypher(fr);
const nombreMotifs = Object.values(fr.patterns).reduce(
  (total, chaine) => total + chaine.length,
  0,
);
check('motifs réellement chargés dans le trie', nombreMotifs > 5000, `${nombreMotifs} caractères de motifs`);

// ── 2. Les règles françaises, extraites de main.js ──────────────────────────
titre('règles typographiques françaises extraites de main.js');

const sourceMain = await readFile(cheminMain, 'utf8');
const debutMarqueur = '// ================= CÉSURE : RÈGLES TYPOGRAPHIQUES FRANÇAISES';
const finMarqueur = '// ============ FIN RÈGLES TYPOGRAPHIQUES FRANÇAISES';
const debut = sourceMain.indexOf(debutMarqueur);
const fin = sourceMain.indexOf(finMarqueur);
check('bloc des règles françaises trouvé', debut > 0 && fin > debut, `lignes ${debut} → ${fin}`);
if (debut < 0 || fin <= debut) {
  console.error('impossible d’extraire les règles : arrêt.');
  process.exit(1);
}

const bloc = sourceMain.slice(debut, fin);
check(
  'le bloc ne dépend de rien d’extérieur',
  // Toutes les constantes dont il a besoin sont définies dans le bloc lui-même.
  ['SP_HYPH_MIN_AVANT', 'SP_HYPH_MIN_APRES', 'SP_VOYELLES', 'SP_APOSTROPHES', 'SP_TIRETS'].every((nom) =>
    bloc.includes(nom),
  ),
  `${bloc.split('\n').length} lignes`,
);

// On évalue le bloc **tel quel** : c'est le code du produit qui décide, pas une
// réécriture de ce script. `vm` l'isole du reste du processus.
const bac = { console, Math, RegExp, String };
vm.createContext(bac);
vm.runInContext(`${bloc}\n;({spIsValidHyphenBoundary, spCoupeGroupe, spSyllabesFR, spFilterSyllables, spAjouterTiretsMot});`, bac);
const {
  spIsValidHyphenBoundary,
  spCoupeGroupe,
  spSyllabesFR,
  spFilterSyllables,
  spAjouterTiretsMot,
} = vm.runInContext('this', bac);
check('les cinq fonctions françaises sont disponibles', typeof spSyllabesFR === 'function' && typeof spAjouterTiretsMot === 'function');

// ── 3. Le corpus ────────────────────────────────────────────────────────────
titre('corpus');

const pieges = [
  // Élisions : ce sont ces cas qui avaient produit « L'- » et « jour- | d'hui ».
  "l'habillage", "L'habillage", "aujourd'hui", "quelqu'un", "c'est-à-dire", "d'abord",
  "l'homme", "presqu'île", "entr'acte", "s'il", "n'importe", "jusqu'au",
  // Mots composés : la frontière du tiret doit exister.
  'grand-mère', 'États-Unis', 'papier-carton', 'arc-en-ciel', 'porte-monnaie',
  'grand-père', 'sans-abri', 'rendez-vous', 'week-end', 'wagon-restaurant',
  // Digraphes, groupes insécables, consonnes doublées.
  'prochable', 'tableau', 'travail', 'espaces', 'irréel', 'constipation',
  'astrophysique', 'arbriser', 'bibliothèque', 'chronologie', 'méthode',
  'signature', 'guerre', 'équation', 'appeler', 'affaire', 'arriver',
  // Accents, ligatures, cédilles.
  'à', 'où', 'ça', 'déjà', 'café', 'forêt', 'hôtel', 'château', 'élève',
  'coût', 'aiguë', 'ambiguïté', 'façade', 'leçon', 'reçu', 'français',
  // Mots longs, où la césure sert vraiment.
  'anticonstitutionnellement', 'internationalisation', 'développement',
  'responsabilité', 'comptabilisation', 'indépendamment', 'particulièrement',
  'environnemental', 'caractéristique', 'administration',
  // Mots courts : ils ne doivent pas être coupés.
  'et', 'ou', 'de', 'la', 'le', 'un', 'avec', 'pour', 'tout', 'très',
  // Pièges typographiques.
  "aujourd'hui", "presque'île", 'vingt-et-un', 'chef-d’œuvre', 'pèse-lettre',
  'couvre-chef', 'taille-crayon', 'savoir-faire', 'va-et-vient',
];

const prose = (
  await Promise.all(
    sourcesProse.filter(existsSync).map((fichier) => readFile(fichier, 'utf8')),
  )
).join('\n');
// On ne garde que de **vrais mots** : des lettres, des apostrophes et des traits
// d'union. Sans ce filtre, la prose technique livre des fragments de code
// (`/Mac|iPhone|iPad/i.test(ua`) dont le `|` se confond avec le séparateur de
// colonnes de ce contrôle — de faux écarts, pas de vrais défauts.
//
// ⚠️ Le trait d'union est en **fin** de classe : entre `'` et `’` il formerait
// une plage Unicode allant de U+0027 à U+2019, qui englobe la barre oblique, la
// barre verticale et la parenthèse — exactement ce qu'on veut exclure.
const MOT_PROPRE = /^[\p{Letter}\p{Mn}'\u2019\u2010\u2011\u2013\u2014-]+$/u;
const motsProse = prose
  .split(/\s+/)
  .map((mot) => mot.trim())
  .filter((mot) => mot.length >= 5 && mot.length <= 40 && MOT_PROPRE.test(mot));

const corpus = [...new Set([...pieges, ...motsProse])];
// Les mots portant un trait conditionnel sont exclus : c'est le seul endroit où
// le Rust **étend** volontairement le JavaScript (voir francais.rs).
const ignores = corpus.filter((mot) => mot.includes('\u00AD'));
const mots = corpus.filter((mot) => !mot.includes('\u00AD'));
check('corpus constitué', mots.length > 400, `${mots.length} mots uniques (dont ${pieges.length} cas pièges)`);
if (ignores.length) console.log(`  (${ignores.length} mot(s) écarté(s) : trait conditionnel)`);

// ── 4. Valeurs JavaScript ───────────────────────────────────────────────────
titre('calcul côté JavaScript');

const joindre = (liste) => (Array.isArray(liste) && liste.length > 1 ? liste.join('|') : '-');

function attenduJavaScript(mot) {
  // ⚠️ La PREMIÈRE colonne comparée est le dictionnaire **seul** : c'est le
  // niveau exact auquel le branchement se fera dans l'application (voir
  // `superprint/app/JS/superprint-branchement.js`). Tout ce qui suit —
  // filtrage, tirets — reste à l'application, et n'est comparé que pour
  // information.
  const fragments = hypher.hyphenate(mot);
  const brut = (fragments && fragments.length ? fragments : [mot]).join('|');

  // Positions du dictionnaire, filtrées par les règles françaises.
  const positions = [];
  let cumul = 0;
  for (let k = 0; k < fragments.length - 1; k += 1) {
    cumul += fragments[k].length;
    positions.push(cumul);
  }
  const coupes = positions.filter((i) => spIsValidHyphenBoundary(mot, i));

  const frontieres = Array.from({ length: mot.length + 1 }, (_, i) =>
    spIsValidHyphenBoundary(mot, i) ? '1' : '0',
  ).join('');

  const groupes = [];
  for (let i = 1; i < mot.length; i += 1) {
    const precedent = mot[i - 1];
    const courant = mot[i];
    // Les mêmes conditions que le Rust : voyelle puis lettre.
    if ('aeiouyàâäéèêëïîôùûüÿœæ'.indexOf(precedent.toLowerCase()) === -1) continue;
    if (!/[A-Za-zÀ-ÿ]/.test(courant)) continue;
    if ('aeiouyàâäéèêëïîôùûüÿœæ'.indexOf(courant.toLowerCase()) !== -1) continue;
    const position = spCoupeGroupe(mot, i);
    groupes.push(`${i}:${position === -1 || position == null ? '-' : position}`);
  }

  const filtre = spFilterSyllables(mot, fragments);
  const tirets = spAjouterTiretsMot(mot, filtre);

  return [
    mot,
    brut,
    coupes.join(','),
    frontieres,
    joindre(spSyllabesFR(mot)),
    groupes.join(','),
    joindre(filtre),
    joindre(tirets),
  ].join('\t');
}

const attendu = mots.map(attenduJavaScript);
console.log(`  ${attendu.length} lignes calculées`);

// ── 5. Valeurs Rust ─────────────────────────────────────────────────────────
titre('calcul côté Rust (WebAssembly, lancé par Node)');

// Les fichiers de travail vivent dans `target/` : le bac à sable WASI n'expose
// que le dossier du projet, donc un chemin temporaire système serait illisible.
const dossier = join(root, 'target', 'cesure');
await mkdir(dossier, { recursive: true });
const relatif = (nom) => join('target', 'cesure', nom);
const cheminMots = join(dossier, 'mots.txt');
const cheminDescription = join(dossier, 'motifs.txt');
const cheminSortie = join(dossier, 'sortie.tsv');

await writeFile(cheminMots, mots.join('\n'), 'utf8');

// Les motifs sont **les données du produit**, recopiées telles quelles dans le
// format texte minimal que l'exemple Rust sait lire.
const lignesMotifs = [`${fr.leftmin}\t${fr.rightmin}`];
for (const taille of Object.keys(fr.patterns).map(Number).sort((a, b) => a - b)) {
  lignesMotifs.push(`${taille}\t${fr.patterns[taille]}`);
}
if (fr.exceptions) lignesMotifs.push(`!exceptions\t${fr.exceptions}`);
await writeFile(cheminDescription, lignesMotifs.join('\n'), 'utf8');
console.log(`  ${lignesMotifs.length - 1} ligne(s) de motifs écrites`);

if (!existsSync(cheminExemple)) {
  console.error(
    `exemple non compilé : ${cheminExemple}\n` +
      '  → cargo build -p superprint-text --example cesure_dump --target wasm32-wasip1 --release',
  );
  process.exit(2);
}
execFileSync(
  process.execPath,
  [
    join(here, 'run-wasi.mjs'),
    cheminExemple,
    relatif('mots.txt'),
    relatif('motifs.txt'),
    relatif('sortie.tsv'),
  ],
  { stdio: ['ignore', 'ignore', 'inherit'], cwd: root },
);

const obtenu = (await readFile(cheminSortie, 'utf8')).split('\n').filter((l) => l.length > 0);
check('autant de lignes des deux côtés', obtenu.length === attendu.length, `${obtenu.length} côté Rust`);

// ── 6. Comparaison, champ par champ ─────────────────────────────────────────
titre('comparaison');

const CHAMPS = [
  'mot',
  'fragments du dictionnaire (niveau du branchement)',
  'coupes du dictionnaire',
  'frontières',
  'syllabes',
  'groupes',
  'filtre',
  'tirets',
];
const ecarts = [];
const parChamp = new Map(CHAMPS.map((nom) => [nom, 0]));

for (let index = 0; index < Math.min(attendu.length, obtenu.length); index += 1) {
  const gauche = attendu[index].split('\t');
  const droite = obtenu[index].split('\t');
  for (let champ = 0; champ < CHAMPS.length; champ += 1) {
    if (gauche[champ] !== droite[champ]) {
      parChamp.set(CHAMPS[champ], parChamp.get(CHAMPS[champ]) + 1);
      if (ecarts.length < 12) {
        ecarts.push(
          `    « ${gauche[0]} » — ${CHAMPS[champ]}\n` +
            `      JavaScript : ${gauche[champ]}\n` +
            `      Rust       : ${droite[champ]}`,
        );
      }
    }
  }
}

for (const nom of CHAMPS.slice(1)) {
  const nombre = parChamp.get(nom);
  check(`${nom} : identiques sur ${mots.length} mots`, nombre === 0, nombre ? `${nombre} écart(s)` : '');
}

if (ecarts.length) {
  console.log('\nÉcarts (12 premiers) :');
  for (const ecart of ecarts) console.log(ecart);
}

// ── 7. Contrôle ciblé des cas pièges ────────────────────────────────────────
titre('contrôle ciblé des cas qui avaient échoué dans l’application');

const parMot = new Map(obtenu.map((l) => [l.split('\t')[0], l.split('\t')]));
const tiretsDe = (mot) => {
  const ligne = parMot.get(mot);
  return ligne ? ligne[7] : null;
};

// Ces quatre-là sont les coupes fautives **mesurées** dans l'historique du
// produit : chacune est citée dans les commentaires d'origine.
check(
  "« L'habillage » ne se coupe jamais après l'apostrophe",
  !(tiretsDe("L'habillage") ?? '').includes("L'|"),
  tiretsDe("L'habillage") ?? '(absent)',
);
check(
  "« aujourd'hui » ne se coupe jamais avant l'élision",
  !(tiretsDe("aujourd'hui") ?? '').includes("|d'hui"),
  tiretsDe("aujourd'hui") ?? '(absent)',
);
check(
  '« États-Unis » se coupe à son tiret, jamais dans « Unis »',
  !(tiretsDe('États-Unis') ?? '|États-|Unis').includes('U|'),
  tiretsDe('États-Unis') ?? '(absent)',
);
check(
  '« grand-mère » ne laisse pas « re » seul',
  !(tiretsDe('grand-mère') ?? '').includes('mè|re'),
  tiretsDe('grand-mère') ?? '(absent)',
);
check(
  'un mot court n’est jamais coupé',
  ['et', 'ou', 'de', 'la', 'le'].every((mot) => tiretsDe(mot) === '-'),
  ['et', 'ou', 'de', 'la', 'le'].map((m) => `${m}=${tiretsDe(m)}`).join(' '),
);
const recompositions = obtenirRecompositions(obtenu);
const perdues = recompositions.filter(({ mot, recompose }) => mot !== recompose);
check(
  'aucune coupe ne perd ni n’ajoute de caractère',
  perdues.length === 0,
  perdues.length
    ? perdues
        .slice(0, 5)
        .map(({ mot, recompose }) => `« ${mot} » → « ${recompose} »`)
        .join(' , ')
    : '',
);

function obtenirRecompositions(lignes) {
  return lignes.map((ligne) => {
    const champs = ligne.split('\t');
    const morceaux = champs[6] === '-' ? [champs[0]] : champs[6].split('|');
    return { mot: champs[0], recompose: morceaux.join('') };
  });
}

console.log(ok ? '\nOK : les deux moteurs de césure rendent le même verdict, mot pour mot.' : '\nÉCHEC.');
process.exit(ok ? 0 : 1);
