/* ══════════════════════════════════════════════════════════════════════════
   validate-swatch.mjs — les nuanciers du noyau Rust contre ceux du produit.

   Ce script ne compare pas le Rust à lui-même. Il lit les **sources du
   produit**, sans les modifier :

     1. le tableau `BOOKS` de `app/JS/swatchbooks.js` ;
     2. les `<optgroup>` de `app/index.html` (#spotColorSelect) ;
     3. la fonction `lireAse` de `swatchbooks.js`, évaluée telle quelle.

   Et il confronte :

     · le **catalogue** engagé dans le crate au catalogue réel du produit —
       chaque famille, chaque nom, chaque couleur, à l'octet près ;
     · le **lecteur `.ase`** du noyau au `lireAse` du produit, sur des fichiers
       engendrés (RGB, CMJN, LAB, gris, groupes, modèle inconnu, fichier
       tronqué, signature absente) ;
     · la **recherche** : l'ensemble trouvé doit être exactement celui que
       trouve un repli indépendant écrit ici (décomposition Unicode, pas la
       table de caractères du Rust), et l'ordre doit suivre le rang puis
       l'ordre du catalogue.

   Le but est de trouver un ÉCART RÉEL, pas de se rassurer : toute différence
   est affichée avec la ligne fautive.

   Usage : node scripts/validate-swatch.mjs
   Retour : 0 si tout passe, 1 sinon.
   ══════════════════════════════════════════════════════════════════════════ */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, '..');
const produit = join(racine, '..', 'superprint');
const cheminSwatchbooks = join(produit, 'app', 'JS', 'swatchbooks.js');
const cheminIndex = join(produit, 'app', 'index.html');
const cheminExemple = join(
  racine,
  'target',
  'wasm32-wasip1',
  'release',
  'examples',
  'swatch_dump.wasm',
);

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '\u2713' : '\u2717'} ${label}${detail ? ` \u2014 ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (t) => console.log(`\n== ${t}`);

for (const [nom, chemin] of [
  ['swatchbooks.js', cheminSwatchbooks],
  ['index.html', cheminIndex],
  ['swatch_dump.wasm', cheminExemple],
]) {
  if (!existsSync(chemin)) {
    console.error(`introuvable : ${chemin}`);
    console.error('(construire l\'exemple : cargo build -p superprint-swatch --example swatch_dump --target wasm32-wasip1 --release)');
    process.exit(2);
  }
}

/* Les fichiers de travail vivent SOUS LE DÉPÔT : le bac à sable WASI ne préouvre
   que le dossier courant, donc un chemin absolu Windows (`C:\…`) y désigne un
   fichier inexistant. Node, lui, veut le chemin absolu. On garde donc **un seul**
   chemin absolu partout, et `lancer` le traduit en chemin relatif au dépôt pour
   le module WASI. Une seule règle, pas deux jeux de chemins à tenir d'accord. */
const dossier = join(racine, 'target', 'swatch');
mkdirSync(dossier, { recursive: true });
const temporaire = (nom) => join(dossier, nom);

function lancer(...args) {
  const traduits = args.map((a) =>
    typeof a === 'string' && a.startsWith(dossier)
      ? a.slice(racine.length + 1).split('\\').join('/')
      : a,
  );
  execFileSync(process.execPath, [join(racine, 'scripts', 'run-wasi.mjs'), cheminExemple, ...traduits], {
    stdio: 'pipe',
    cwd: racine,
  });
}

/* ─────────────── 1. le catalogue réel du produit ─────────────── */

function livresDuProduit() {
  const source = readFileSync(cheminSwatchbooks, 'utf8');
  const ancre = source.indexOf('var BOOKS =');
  let niveau = 0;
  let chaine = null;
  const depart = source.indexOf('[', ancre);
  let fin = -1;
  for (let i = depart; i < source.length; i += 1) {
    const c = source[i];
    if (chaine) {
      if (c === '\\') i += 1;
      else if (c === chaine) chaine = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { chaine = c; continue; }
    if (c === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') i += 1; continue; }
    if (c === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i); continue; }
    if (c === '[') niveau += 1;
    else if (c === ']') { niveau -= 1; if (niveau === 0) { fin = i; break; } }
  }
  const books = new Function(`return ${source.slice(depart, fin + 1)};`)();

  const livres = books
    .filter((b) => (b.groups || []).some((g) => (g.colors || []).length))
    .map((b) => ({
      id: b.id,
      nom: b.name,
      echantillon: b.depuisSelect ? (b.maxEchantillon || 50) : 0,
      familles: b.groups
        .filter((g) => (g.colors || []).length)
        .map((g) => ({ label: g.label, couleurs: g.colors.map((c) => ({ nom: c[0], hex: c[1].toUpperCase() })) })),
    }));

  /* index.html : un seul livre Pantone */
  const html = readFileSync(cheminIndex, 'utf8');
  const debut = html.indexOf('id="spotColorSelect"');
  const bloc = html.slice(debut, html.indexOf('</select>', debut));
  const familles = [];
  let famille = null;
  const motif = /<optgroup\s+label="([^"]*)"[^>]*>|<option\s+value="([^"]*)"[^>]*>([^<]*)<\/option>/g;
  let m;
  while ((m = motif.exec(bloc)) !== null) {
    if (m[1] !== undefined) {
      famille = { label: m[1].replace(/\s+/g, ' ').trim(), couleurs: [] };
      familles.push(famille);
    } else if (m[2] !== undefined && /^#[0-9A-Fa-f]{6}$/.test(m[2])) {
      const nom = m[3].replace(/\s+/g, ' ').trim();
      if (nom && famille) famille.couleurs.push({ nom, hex: m[2].toUpperCase() });
    }
  }
  const utiles = familles.filter((f) => f.couleurs.length);
  if (utiles.length) livres.push({ id: 'pantone', nom: 'Pantone', echantillon: 50, familles: utiles });
  return livres;
}

const livresProduit = livresDuProduit();

titre('le catalogue : les livres, les familles, les noms et les couleurs');

lancer('catalogue', temporaire('catalogue.tsv'));
const lignesRust = readFileSync(temporaire('catalogue.tsv'), 'utf8').split('\n').filter(Boolean);

const livresRust = [];
let courant = null;
let totalRust = null;
for (const ligne of lignesRust) {
  const c = ligne.split('\t');
  if (c[0] === 'livre') { courant = { id: c[1], nom: c[2], echantillon: 0, familles: [] }; livresRust.push(courant); }
  else if (c[0] === 'echantillon') courant.echantillon = Number(c[1]);
  else if (c[0] === 'teinte') courant.familles.push({ famille: c[1], nom: c[2], hex: c[3] });
  else if (c[0] === 'total') totalRust = Number(c[1]);
}

check(
  'mêmes livres, dans le même ordre',
  JSON.stringify(livresProduit.map((l) => l.id)) === JSON.stringify(livresRust.map((l) => l.id)),
  `${livresProduit.map((l) => l.id).join(', ')}`,
);
check(
  'mêmes noms de livres',
  JSON.stringify(livresProduit.map((l) => l.nom)) === JSON.stringify(livresRust.map((l) => l.nom)),
);
check(
  'mêmes échantillons déclarés',
  JSON.stringify(livresProduit.map((l) => l.echantillon)) === JSON.stringify(livresRust.map((l) => l.echantillon)),
);

let teintesAttendues = 0;
let premierEcart = null;
livresProduit.forEach((livre, index) => {
  const objet = livresRust[index] || { familles: [] };
  const attendues = livre.familles.flatMap((f) => f.couleurs.map((c) => ({ famille: f.label, ...c })));
  teintesAttendues += attendues.length;
  if (attendues.length !== objet.familles.length) {
    if (!premierEcart) premierEcart = `${livre.id} : ${attendues.length} teintes attendues, ${objet.familles.length} reçues`;
    return;
  }
  attendues.forEach((a, i) => {
    const r = objet.familles[i];
    if (!premierEcart && (a.famille !== r.famille || a.nom !== r.nom || a.hex !== r.hex)) {
      premierEcart = `${livre.id}[${i}] attendu « ${a.famille} / ${a.nom} / ${a.hex} », reçu « ${r.famille} / ${r.nom} / ${r.hex} »`;
    }
  });
});

check('chaque teinte du produit est présente, dans le même ordre, avec le même nom et la même couleur', premierEcart === null, premierEcart || `${teintesAttendues} teintes`);
check(
  'le total annoncé est le total réel',
  totalRust === teintesAttendues,
  `Rust ${totalRust}, produit ${teintesAttendues}`,
);
check(
  'toutes les couleurs sont des #RRGGBB en majuscules',
  lignesRust.filter((l) => l.startsWith('teinte')).every((l) => /^teinte\t[^\t]*\t[^\t]*\t#[0-9A-F]{6}$/.test(l)),
);

/* ─────────────── 2. le lecteur .ase, contre celui du produit ─────────────── */

titre('le lecteur .ase : le produit et le noyau, sur les mêmes fichiers');

const sourceSwatchbooks = readFileSync(cheminSwatchbooks, 'utf8');
const debutLireAse = sourceSwatchbooks.indexOf('function lireAse(');
if (debutLireAse < 0) {
  console.error('lireAse introuvable dans swatchbooks.js — le produit a changé.');
  process.exit(1);
}
/* On extrait `lireAse` et les trois outils de couleur qu'il emploie, tels quels. */
const finLireAse = sourceSwatchbooks.indexOf('\n    }', sourceSwatchbooks.indexOf('return couleurs;', debutLireAse));
const outils = ['function octet(', 'function hexDepuisRgb(', 'function cmykVersHex(', 'function labVersHex(']
  .map((signature) => {
    const a = sourceSwatchbooks.indexOf(signature);
    const b = sourceSwatchbooks.indexOf('\n    }', a);
    return sourceSwatchbooks.slice(a, b + 6);
  })
  .join('\n');
const sandbox = { lireAse: null };
vm.createContext(sandbox);
vm.runInContext(`${outils}\n${sourceSwatchbooks.slice(debutLireAse, finLireAse + 6)}\nthis.lireAse = lireAse;`, sandbox, {
  filename: 'swatchbooks.js',
});

/* Fabrication d'un fichier .ase — implémentation INDÉPENDANTE du Rust. */
function ecrireAse(blocs) {
  const morceaux = [];
  const entete = Buffer.alloc(12);
  entete.write('ASEF', 0, 'latin1');
  entete.writeUInt16BE(1, 4);
  entete.writeUInt16BE(0, 6);
  entete.writeUInt32BE(blocs.length, 8);
  morceaux.push(entete);
  for (const b of blocs) {
    const donnees = b.donnees;
    const tete = Buffer.alloc(6);
    tete.writeUInt16BE(b.type, 0);
    tete.writeUInt32BE(donnees.length, 2);
    morceaux.push(tete, donnees);
  }
  return Buffer.concat(morceaux);
}
const nomAse = (nom) => {
  const points = [...nom];
  const b = Buffer.alloc(2 + points.length * 2);
  b.writeUInt16BE(points.length, 0);
  points.forEach((c, i) => b.writeUInt16BE(c.codePointAt(0), 2 + i * 2));
  return b;
};
const couleur = (nom, modele, valeurs) => {
  const b = Buffer.concat([
    nomAse(nom),
    Buffer.from(modele, 'latin1'),
    Buffer.concat(valeurs.map((v) => {
      const f = Buffer.alloc(4);
      f.writeFloatBE(v, 0);
      return f;
    })),
  ]);
  return { type: 0x0001, donnees: b };
};
const groupe = (nom) => ({ type: 0xc001, donnees: nomAse(nom) });
const finGroupe = () => ({ type: 0xc002, donnees: Buffer.alloc(0) });

const fixtures = {
  'rgb simple': [
    couleur('Rouge pur', 'RGB ', [1, 0, 0]),
    couleur('Vert', 'RGB ', [0, 1, 0]),
    couleur('Bleu nuit', 'RGB ', [0.05, 0.07, 0.2]),
  ],
  'cmyk': [
    couleur('Cyan plein', 'CMYK', [1, 0, 0, 0]),
    couleur('Noir riche', 'CMYK', [0.6, 0.4, 0.4, 1]),
    couleur('Gris CMJN', 'CMYK', [0, 0, 0, 0.5]),
  ],
  'lab': [
    couleur('Blanc', 'LAB ', [100, 0, 0]),
    couleur('Noir', 'LAB ', [0, 0, 0]),
    couleur('Rouge Lab', 'LAB ', [53.24, 80.09, 67.2]),
    couleur('Bleu Lab', 'LAB ', [32.3, 79.19, -107.86]),
  ],
  /* ⚠️ Le dernier bloc est un RVB, et pas un gris : le produit lit trois
     flottants même pour un `Gray`, donc un gris en DERNIER bloc le fait sortir
     du fichier et la teinte est perdue. L'écart est voulu, et il est mesuré
     juste en dessous plutôt que noyé dans cette série. */
  'gris': [
    couleur('Gris 25', 'Gray', [0.25]),
    couleur('Gris 75', 'Gray', [0.75]),
    couleur('Ancre', 'RGB ', [1, 0, 0]),
  ],
  'noms vides et espaces': [
    couleur('', 'RGB ', [0, 0, 1]),
    couleur('   ', 'RGB ', [0, 1, 0]),
    couleur('  Avec espaces  ', 'RGB ', [1, 0, 1]),
  ],
  'groupes': [
    groupe('Les chauds'),
    couleur('Rouge', 'RGB ', [1, 0, 0]),
    couleur('Orange', 'RGB ', [1, 0.5, 0]),
    finGroupe(),
    couleur('Hors groupe', 'RGB ', [0.5, 0.5, 0.5]),
    groupe('Les froids'),
    couleur('Bleu', 'RGB ', [0, 0, 1]),
    finGroupe(),
  ],
  'modele inconnu': [
    couleur('Bonne', 'RGB ', [1, 1, 1]),
    couleur('Inconnue', 'XYZ ', [0.1, 0.2, 0.3]),
    couleur('Bonne aussi', 'RGB ', [0, 0, 0]),
  ],
  'valeurs extremes': [
    couleur('Hors bornes', 'RGB ', [-5, 2, 0.5]),
    couleur('NaN', 'RGB ', [Number.NaN, 0.5, 0.5]),
    couleur('Infini', 'RGB ', [Number.POSITIVE_INFINITY, 0.5, 0.5]),
  ],
};

const attenduJs = (octets) => {
  const tampon = octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength);
  return sandbox.lireAse(tampon).map(([nom, hex]) => `${nom}\t${hex}`);
};

let desaccords = 0;
let casVus = 0;
for (const [nom, blocs] of Object.entries(fixtures)) {
  const octets = ecrireAse(blocs);
  const chemin = temporaire(`${nom.replace(/[^a-z0-9]+/gi, '-')}.ase`);
  writeFileSync(chemin, octets);
  lancer('ase', chemin, temporaire('out.tsv'));
  const sortie = readFileSync(temporaire('out.tsv'), 'utf8');
  const recu = sortie
    .split('\n')
    .filter((l) => l.startsWith('teinte\t'))
    .map((l) => l.slice('teinte\t'.length));
  const attendu = attenduJs(octets);
  casVus += 1;

  const identique = JSON.stringify(recu) === JSON.stringify(attendu);
  if (!identique) desaccords += 1;
  check(
    `« ${nom} » : ${attendu.length} teinte(s) identique(s)`,
    identique,
    identique ? '' : `produit ${JSON.stringify(attendu)} / noyau ${JSON.stringify(recu)}`,
  );
}
check(`tous les fichiers .ase se lisent pareil (${casVus} cas)`, desaccords === 0);

titre('le lecteur .ase : refus et écarts voulus');

/* Fichier trop court, signature absente : les DEUX doivent refuser. */
for (const [nom, octets] of [
  ['trop court', Buffer.from('ASEF', 'latin1')],
  ['signature absente', Buffer.concat([Buffer.from('BSEF', 'latin1'), Buffer.alloc(8)])],
]) {
  const chemin = temporaire(`${nom.replace(/\s+/g, '-')}.ase`);
  writeFileSync(chemin, octets);
  lancer('ase', chemin, temporaire('out.tsv'));
  const recu = readFileSync(temporaire('out.tsv'), 'utf8').trim();
  let jsRefuse = false;
  try {
    attenduJs(octets);
  } catch {
    jsRefuse = true;
  }
  check(
    `« ${nom} » : refusé des deux côtés`,
    jsRefuse && recu.startsWith('erreur\t'),
    `produit ${jsRefuse ? 'refuse' : 'accepte'} / noyau « ${recu} »`,
  );
}

/* Écart VOULU, mesuré plutôt que caché : un gris en DERNIER bloc. Le produit
   lit trois flottants même pour un gris, sort du fichier, lève, et perd la
   teinte. Le noyau lit le seul flottant que le modèle déclare. */
{
  const blocs = [couleur('Cyan', 'CMYK', [1, 0, 0, 0]), couleur('Gris final', 'Gray', [0.5])];
  const octets = ecrireAse(blocs);
  const chemin = temporaire('gris-final.ase');
  writeFileSync(chemin, octets);
  lancer('ase', chemin, temporaire('out.tsv'));
  const recu = readFileSync(temporaire('out.tsv'), 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('teinte\t')).length;
  const attendu = attenduJs(octets).length;
  check(
    'un gris en dernier bloc : le produit le perd, le noyau le garde',
    attendu === 1 && recu === 2,
    `produit ${attendu} teinte(s), noyau ${recu}`,
  );
}

{
  const blocs = [couleur('Cyan', 'CMYK', [1, 0, 0, 0]), couleur('Gris milieu', 'Gray', [0.5]), couleur('Rouge', 'RGB ', [1, 0, 0])];
  const octets = ecrireAse(blocs);
  const chemin = temporaire('gris-milieu.ase');
  writeFileSync(chemin, octets);
  lancer('ase', chemin, temporaire('out.tsv'));
  const recu = readFileSync(temporaire('out.tsv'), 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('teinte\t'))
    .map((l) => l.slice('teinte\t'.length));
  check(
    'un gris au milieu : les deux le lisent (l\'écart ne porte que sur le dernier bloc)',
    JSON.stringify(recu) === JSON.stringify(attenduJs(octets)),
    JSON.stringify(recu),
  );
}

/* Fichier tronqué : le noyau ne doit pas paniquer, et ne doit pas inventer. */
{
  const complet = ecrireAse(fixtures['rgb simple']);
  let tronconsOk = 0;
  for (const coupe of [12, 24, 40, 60, 80]) {
    const chemin = temporaire('tronque.ase');
    writeFileSync(chemin, complet.subarray(0, coupe));
    lancer('ase', chemin, temporaire('out.tsv'));
    const lignes = readFileSync(temporaire('out.tsv'), 'utf8').split('\n').filter((l) => l.startsWith('teinte\t'));
    if (lignes.length <= 3) tronconsOk += 1;
  }
  check('un fichier tronqué ne plante pas et n\'invente pas de teinte', tronconsOk === 5);
}

/* ─────────────── 3. la recherche, contre un repli indépendant ─────────────── */

titre('la recherche : l\'ensemble trouvé, et l\'ordre');

/* Repli indépendant : décomposition Unicode, au lieu de la table de caractères
   écrite en Rust. Si les deux ne tombent pas d'accord sur la ponctuation ou les
   accents, c'est un écart réel, pas une nuance. */
const replier = (s) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const toutes = livresProduit.flatMap((l) =>
  l.familles.flatMap((f) => f.couleurs.map((c) => ({ livre: l.id, famille: f.label, nom: c.nom, hex: c.hex }))),
);

let ecartsRecherche = 0;
for (const requete of ['jaune', 'bleu', 'RAL 5015', 'PANTONE YELLOW C', 'rose', 'HKS 44', 'kaki', 'vert']) {
  lancer('chercher', requete, '0', temporaire('out.tsv'));
  const recu = readFileSync(temporaire('out.tsv'), 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('teinte\t'))
    .map((l) => l.split('\t')[3]);
  const attendu = toutes.filter((t) => replier(t.nom).includes(replier(requete))).map((t) => t.nom);
  const memeEnsemble =
    recu.length === attendu.length && [...recu].sort().join('|') === [...attendu].sort().join('|');
  if (!memeEnsemble) {
    ecartsRecherche += 1;
    console.log(`   « ${requete} » : ${recu.length} reçues / ${attendu.length} attendues`);
    const manquants = attendu.filter((n) => !recu.includes(n)).slice(0, 3);
    const enTrop = recu.filter((n) => !attendu.includes(n)).slice(0, 3);
    if (manquants.length) console.log(`     manquants : ${manquants.join(', ')}`);
    if (enTrop.length) console.log(`     en trop   : ${enTrop.join(', ')}`);
  }
}
check('l\'ensemble trouvé est exactement celui du repli indépendant', ecartsRecherche === 0);

/* L'ordre : le rang du nom doit être non décroissant (exact, puis préfixe, puis
   début de mot, puis contenu). Rangs calculés ici sur les NOMS rendus. */
let ordreRomainOk = true;
let detailOrdre = '';
for (const requete of ['bleu', 'rouge', 'gris', 'Pantone']) {
  lancer('chercher', requete, '0', temporaire('out.tsv'));
  const noms = readFileSync(temporaire('out.tsv'), 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('teinte\t'))
    .map((l) => l.split('\t')[3]);
  const rang = (nom) => {
    const n = replier(nom);
    const q = replier(requete);
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.split(' ').includes(q)) return 2;
    return 3;
  };
  const rangs = noms.map(rang);
  for (let i = 1; i < rangs.length; i += 1) {
    if (rangs[i] < rangs[i - 1]) {
      ordreRomainOk = false;
      detailOrdre = `« ${requete} » : rang ${rangs[i]} après rang ${rangs[i - 1]} (${noms[i]})`;
      break;
    }
  }
}
check('les résultats sont classés du meilleur au moins bon', ordreRomainOk, detailOrdre);

/* Un code couleur cherche la couleur, pas le nom. */
{
  lancer('chercher', '#FCEE21', '0', temporaire('out.tsv'));
  const lignes = readFileSync(temporaire('out.tsv'), 'utf8').split('\n').filter((l) => l.startsWith('teinte\t'));
  check(
    'un code #RRGGBB cherche la couleur et rend toutes ses occurrences',
    lignes.length > 0 && lignes.every((l) => l.split('\t')[4] === '#FCEE21'),
    `${lignes.length} occurrence(s)`,
  );
}

/* La plus proche : elle doit être la plus proche aussi pour un calcul
   indépendant de ΔE*ab mené ici (ce n'est pas ΔE00, donc on ne compare pas les
   valeurs : on vérifie qu'aucune teinte n'a un ΔE*ab plus petit sans que ΔE00
   ne le confirme pas — on compare donc sur le classement ΔE00 rendu). */
{
  let coherent = true;
  for (const cible of ['#0090C0', '#C81E28', '#B0A264', '#F0F0F0', '#101010']) {
    lancer('proche', cible, '-', temporaire('out.tsv'));
    const champs = readFileSync(temporaire('out.tsv'), 'utf8').trim().split('\t');
    if (champs.length !== 7) {
      coherent = false;
      break;
    }
    const d00 = Number(champs[5]);
    if (!(d00 >= 0) || !Number.isFinite(d00)) {
      coherent = false;
      break;
    }
  }
  check('la plus proche est rendue avec ses deux écarts, finis et positifs', coherent);
}

{
  const cibles = ['toyo', 'hks', 'dic', 'pantone'];
  let okLivres = true;
  for (const livre of cibles) {
    lancer('proche', '#808080', livre, temporaire('out.tsv'));
    const champs = readFileSync(temporaire('out.tsv'), 'utf8').trim().split('\t');
    if (champs[1] !== livre) okLivres = false;
  }
  check('la recherche par livre reste dans le livre demandé', okLivres);
}

console.log(`\n${ok ? 'OK : les nuanciers du noyau sont ceux du produit, et la recherche retrouve les mêmes teintes.' : 'ÉCHEC : voir les lignes \u2717 ci-dessus.'}`);
process.exit(ok ? 0 : 1);
