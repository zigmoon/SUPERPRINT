/* ══════════════════════════════════════════════════════════════════════════
   validate-zip.mjs — le conteneur des fichiers d'échange, mis à l'épreuve.

   Un .docx, un .odt, un .xlsx et un .idml sont la même chose : une archive ZIP
   contenant du XML. Le noyau en a maintenant un lecteur ; ce script vérifie
   qu'il lit ce qu'un AUTRE lecteur lit, et qu'il refuse ce qu'il faut.

   Trois façons indépendantes :

     1. FICHIERS RÉELS. On prend les .docx, .odt et .idml réels du dépôt, on
        demande au noyau d'extraire chaque entrée, et on décompresse la MÊME
        entrée avec le `zlib` de Node. Comparaison octet pour octet.
     2. ARCHIVES FABRIQUÉES. Le script écrit ses propres archives (stockées et
        compressées, avec commentaire, avec noms en dossier) et vérifie que le
        noyau rend exactement ce qu'il a mis dedans.
     3. REFUS. Un .doc renommé, un .rtf renommé, une archive tronquée, un CRC
        abîmé, une archive chiffrée, une méthode exotique (BZIP2), une taille
        déclarée absurde, un nom qui sort de l'archive.

   Usage : node scripts/validate-zip.mjs
   Retour : 0 si tout passe, 1 sinon.
   ══════════════════════════════════════════════════════════════════════════ */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, '..');
const parent = join(racine, '..');
const cheminExemple = join(
  racine,
  'target',
  'wasm32-wasip1',
  'release',
  'examples',
  'zip_dump.wasm',
);

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '\u2713' : '\u2717'} ${label}${detail ? ` \u2014 ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (t) => console.log(`\n== ${t}`);

if (!existsSync(cheminExemple)) {
  console.error(`introuvable : ${cheminExemple}`);
  console.error(
    '(construire : cargo build -p superprint-zip --example zip_dump --target wasm32-wasip1 --release)',
  );
  process.exit(2);
}

const dossier = join(racine, 'target', 'zip');
mkdirSync(dossier, { recursive: true });
const temporaire = (nom) => join(dossier, nom);
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

/** Lance et rend `{ code, sortie }` au lieu de lever : sert aux cas de refus. */
function lancerSouple(...args) {
  try {
    return { code: 0, sortie: lancer(...args) };
  } catch (e) {
    return { code: e.status ?? 1, sortie: (e.stdout || '').toString() + (e.stderr || '').toString() };
  }
}

/* ─────────────────── fabricant d'archives, écrit ici ─────────────────────── */

/** CRC32, tel que le ZIP l'emploie. Écrit ici, indépendamment du Rust. */
const TABLE_CRC = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(octets) {
  let c = -1;
  for (let i = 0; i < octets.length; i += 1) {
    c = TABLE_CRC[(c ^ octets[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

/**
 * Fabrique une archive ZIP. `entrees` est une liste de
 * `{ nom, contenu, compresse, commentaire }`.
 */
function fabriquerArchive(entrees, { commentaire = '' } = {}) {
  const morceaux = [];
  const annuaire = [];
  let decalage = 0;

  for (const entree of entrees) {
    const contenu = Buffer.from(entree.contenu);
    const compresse = entree.compresse ? deflateRawSync(contenu) : contenu;
    const methode = entree.compresse ? 8 : 0;
    const nom = Buffer.from(entree.nom, 'utf8');
    const drapeaux = 0x0800; // noms en UTF-8

    const entete = Buffer.alloc(30);
    entete.writeUInt32LE(0x04034b50, 0);
    entete.writeUInt16LE(20, 4);
    entete.writeUInt16LE(drapeaux, 6);
    entete.writeUInt16LE(methode, 8);
    entete.writeUInt16LE(0, 10);
    entete.writeUInt16LE(0x21, 12);
    entete.writeUInt32LE(crc32(contenu), 14);
    entete.writeUInt32LE(compresse.length, 18);
    entete.writeUInt32LE(contenu.length, 22);
    entete.writeUInt16LE(nom.length, 26);
    entete.writeUInt16LE(0, 28);
    morceaux.push(entete, nom, compresse);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(drapeaux, 8);
    central.writeUInt16LE(methode, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc32(contenu), 16);
    central.writeUInt32LE(compresse.length, 20);
    central.writeUInt32LE(contenu.length, 24);
    central.writeUInt16LE(nom.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(decalage, 42);
    annuaire.push(central, nom);

    decalage += entete.length + nom.length + compresse.length;
  }

  const debutAnnuaire = morceaux.reduce((n, m) => n + m.length, 0);
  const blocAnnuaire = Buffer.concat(annuaire);
  const commentaireBloc = Buffer.from(commentaire, 'utf8');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entrees.length, 8);
  eocd.writeUInt16LE(entrees.length, 10);
  eocd.writeUInt32LE(blocAnnuaire.length, 12);
  eocd.writeUInt32LE(debutAnnuaire, 16);
  eocd.writeUInt16LE(commentaireBloc.length, 20);

  return Buffer.concat([...morceaux, blocAnnuaire, eocd, commentaireBloc]);
}

/** Ce que le noyau dit d'une archive : `[{ rang, methode, taille, crc, nom }]`. */
function lireListe(chemin) {
  const tsv = temporaire('liste.tsv');
  lancer('liste', chemin, tsv);
  const lignes = readFileSync(tsv, 'utf8').trim().split('\n');
  const entrees = [];
  let erreur = null;
  let total = null;
  for (const ligne of lignes) {
    const c = ligne.split('\t');
    if (c[0] === 'entree') {
      entrees.push({
        rang: Number(c[1]),
        methode: Number(c[2]),
        taille: Number(c[3]),
        compressee: Number(c[4]),
        crc: c[5],
        nom: c[6],
      });
    } else if (c[0] === 'total') total = Number(c[1]);
    else if (c[0] === 'erreur') erreur = c[1];
  }
  return { entrees, total, erreur };
}

/* ─────────────────── 1. fichiers réels ──────────────────────────────────── */

titre('fichiers réels : le noyau lit ce qu’un autre lecteur lit');

const CANDIDATS = [
  { nom: 'titre4.docx', chemin: '_dev/docx-test/titre4.docx' },
  { nom: '_test_word.docx', chemin: '_dev/exports/_test_word.docx' },
  { nom: 'rapport-a5.docx', chemin: '_dev/sorties/rapport-a5.docx' },
  { nom: '_gros_120p.docx', chemin: '_dev/exports/_gros_120p.docx' },
  { nom: 'test.odt', chemin: '_dev/fixtures-396/_fixtures_396/test.odt' },
  { nom: '_test_word.odt', chemin: '_dev/sorties/_test_word.odt' },
  { nom: 'cadre-colonnes.idml', chemin: '_dev/idml-test/cadre-colonnes.idml' },
  { nom: 'features-561.idml', chemin: '_dev/idml-test/features-561.idml' },
  { nom: 'gabarit-items.idml', chemin: '_dev/idml-test/gabarit-items.idml' },
  { nom: 'banquet.idml', chemin: '_dev/idml-reel/banquet_républicain_master.idml' },
  { nom: '_test_excel.xlsx', chemin: '_dev/sorties/_test_excel.xlsx' },
];

let fichiersTestes = 0;
let entreesComparees = 0;
let octetsCompares = 0;
let desaccords = 0;
let ignores = [];
const detailsParFichier = [];

for (const candidat of CANDIDATS) {
  const source = join(parent, candidat.chemin);
  if (!existsSync(source)) {
    ignores.push(candidat.nom);
    continue;
  }
  const octets = readFileSync(source);

  // Node lit le ZIP de son côté : annuaire central, puis inflate.
  const lecteur = lecteurZip(octets);
  if (!lecteur) {
    check(`${candidat.nom} : lisible par Node`, false, 'pas un ZIP ?');
    continue;
  }
  const attendues = lecteur.entrees;

  // Le noyau lit la liste.
  const copie = temporaire('reel.zip');
  writeFileSync(copie, octets);
  const { entrees, erreur } = lireListe(copie);
  if (erreur) {
    check(`${candidat.nom} : liste par le noyau`, false, erreur);
    continue;
  }
  if (entrees.length !== attendues.length) {
    desaccords += 1;
    check(
      `${candidat.nom} : nombre d’entrées`,
      false,
      `noyau ${entrees.length}, Node ${attendues.length}`,
    );
    continue;
  }

  // Toutes les entrées extraites par le noyau, et comparées à Node.
  const sortie = temporaire('toutes.tsv');
  lancer('toutes', copie, sortie);
  const resume = readFileSync(sortie, 'utf8').trim().split('\n');
  const refus = resume.filter((l) => l.startsWith('refus\t'));
  const justes = Number(
    (resume.find((l) => l.startsWith('justes\t')) || '\t0').split('\t')[1],
  );
  if (justes !== attendues.length) {
    desaccords += 1;
    check(
      `${candidat.nom} : toutes les entrées extraites`,
      false,
      `${justes} justes, ${refus.length} refus, ${attendues.length} attendues`,
    );
    continue;
  }

  // Comparaison octet pour octet, sur chaque entrée, via une extraction
  // séparée : c'est ce qui prouve que le contenu est le même, pas seulement la
  // taille.
  let identiques = 0;
  for (const entree of attendues) {
    const noyau = temporaire('entree.bin');
    lancer('extraire', copie, entree.nom, noyau);
    const recu = readFileSync(noyau);
    const attendu = lecteur.extraire(entree);
    if (Buffer.compare(recu, attendu) === 0) {
      identiques += 1;
      octetsCompares += recu.length;
    } else {
      desaccords += 1;
      check(
        `${candidat.nom} / ${entree.nom}`,
        false,
        `${recu.length} octets reçus, ${attendu.length} attendus`,
      );
    }
  }
  fichiersTestes += 1;
  entreesComparees += identiques;
  detailsParFichier.push(`${candidat.nom} (${identiques} entrées)`);
  if (refus.length > 0) {
    check(`${candidat.nom} : aucune entrée refusée`, false, refus.join(' | '));
  }
}

check(
  `les ${fichiersTestes} fichiers réels s’ouvrent et toutes leurs entrées se comparent`,
  desaccords === 0,
  `${entreesComparees} entrées, ${octetsCompares} octets identiques octet pour octet`,
);
if (ignores.length > 0) {
  console.log(`  (absents du dépôt, non testés : ${ignores.join(', ')})`);
}
check('au moins 8 fichiers témoins testés', fichiersTestes >= 8, `${fichiersTestes} fichiers`);
console.log(`  ${detailsParFichier.join(' · ')}`);

/* ─────────────────── un lecteur ZIP indépendant, écrit ici ──────────────── */

/**
 * Lecteur ZIP minimal, écrit dans ce script pour ne dépendre d'aucun paquet.
 * Il suit l'annuaire central, comme le noyau, mais avec son propre code et sa
 * propre décompression (`zlib`).
 */
function lecteurZip(octets) {
  const eocd = octets.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return null;
  const nombre = octets.readUInt16LE(eocd + 10);
  const debut = octets.readUInt32LE(eocd + 16);
  const entrees = [];
  let position = debut;
  for (let i = 0; i < nombre; i += 1) {
    if (octets.readUInt32LE(position) !== 0x02014b50) return null;
    const methode = octets.readUInt16LE(position + 10);
    const crc = octets.readUInt32LE(position + 16);
    const compressee = octets.readUInt32LE(position + 20);
    const taille = octets.readUInt32LE(position + 24);
    const longNom = octets.readUInt16LE(position + 28);
    const longExtra = octets.readUInt16LE(position + 30);
    const longCommentaire = octets.readUInt16LE(position + 32);
    const local = octets.readUInt32LE(position + 42);
    const nom = octets.toString('utf8', position + 46, position + 46 + longNom);
    entrees.push({ nom, methode, crc, compressee, taille, local });
    position += 46 + longNom + longExtra + longCommentaire;
  }
  return {
    entrees,
    extraire(entree) {
      const longNom = octets.readUInt16LE(entree.local + 26);
      const longExtra = octets.readUInt16LE(entree.local + 28);
      const debutDonnees = entree.local + 30 + longNom + longExtra;
      const brut = octets.subarray(debutDonnees, debutDonnees + entree.compressee);
      const contenu = entree.methode === 8 ? inflateRawSync(brut) : Buffer.from(brut);
      if (contenu.length !== entree.taille) {
        throw new Error(`${entree.nom} : taille ${contenu.length} ≠ ${entree.taille}`);
      }
      if (crc32(contenu) !== entree.crc) {
        throw new Error(`${entree.nom} : CRC différent`);
      }
      return contenu;
    },
  };
}

/* ─────────────────── 2. archives fabriquées ─────────────────────────────── */

titre('archives fabriquées : ce qu’on met dedans ressort tel quel');

const CONTENUS = [
  { nom: 'vide.txt', contenu: Buffer.alloc(0), compresse: false },
  { nom: 'un-octet.txt', contenu: Buffer.from('x'), compresse: true },
  { nom: 'petit.xml', contenu: Buffer.from('<a>café — accentué</a>'), compresse: false },
  {
    nom: 'repetitif.xml',
    contenu: Buffer.from('<p>un paragraphe répétitif</p>'.repeat(300)),
    compresse: true,
  },
  { nom: 'binaire.bin', contenu: Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251)), compresse: true },
  { nom: 'dossier/imbrique/profond.xml', contenu: Buffer.from('<x/>'), compresse: true },
  { nom: 'noms accentues—café.xml', contenu: Buffer.from('<é/>'), compresse: false },
  {
    nom: 'aleatoire.bin',
    contenu: Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * 7919) % 256)),
    compresse: true,
  },
];

{
  const archive = fabriquerArchive(CONTENUS, { commentaire: 'un commentaire d’archive' });
  const chemin = temporaire('fabriquee.zip');
  writeFileSync(chemin, archive);
  const { entrees, erreur, total } = lireListe(chemin);
  check('l’archive fabriquée s’ouvre', !erreur, erreur || '');
  check(
    'le nombre d’entrées est celui attendu',
    total === CONTENUS.length,
    `${total} / ${CONTENUS.length}`,
  );

  let justes = 0;
  for (const [i, entree] of entrees.entries()) {
    const sortie = temporaire('fab.bin');
    lancer('extraire', chemin, entree.nom, sortie);
    const recu = readFileSync(sortie);
    if (Buffer.compare(recu, CONTENUS[i].contenu) === 0) justes += 1;
    else
      check(
        `archive fabriquée / ${entree.nom}`,
        false,
        `${recu.length} octets reçus, ${CONTENUS[i].contenu.length} attendus`,
      );
  }
  check(
    `les ${CONTENUS.length} contenus ressortent identiques`,
    justes === CONTENUS.length,
    `${justes} / ${CONTENUS.length}`,
  );

  // Les méthodes doivent être celles qu'on a demandées.
  const methodesJustes = entrees.every((e, i) => e.methode === (CONTENUS[i].compresse ? 8 : 0));
  check('les méthodes annoncées sont les bonnes', methodesJustes);

  // Et la compression doit avoir servie : pour le contenu répétitif.
  const repetitif = entrees.find((e) => e.nom === 'repetitif.xml');
  check(
    'un contenu répétitif est réellement compressé',
    repetitif.compressee < repetitif.taille / 5,
    `${repetitif.taille} → ${repetitif.compressee} octets`,
  );

  // Le numéro de méthode doit être celui du fichier, pas de la liste.
  const verifie = lireListe(chemin);
  check('la relecture donne le même annuaire', verifie.total === CONTENUS.length);
}

{
  /* Un contenu vraiment aléatoire ne se compresse pas : le noyau ne doit ni
     échouer ni gonfler, et DEFLATE stocke alors des blocs bruts. */
  const aleatoire = Buffer.from(
    Array.from({ length: 8192 }, (_, i) => Math.floor(((i * 1103515245 + 12345) % 2147483648) / 8388608) % 256),
  );
  const archive = fabriquerArchive([{ nom: 'bruit.bin', contenu: aleatoire, compresse: true }]);
  const chemin = temporaire('bruit.zip');
  writeFileSync(chemin, archive);
  const sortie = temporaire('bruit.bin');
  lancer('extraire', chemin, 'bruit.bin', sortie);
  check(
    'du bruit incompressible ressort intact',
    Buffer.compare(readFileSync(sortie), aleatoire) === 0,
  );
}

/* ─────────────────── 3. ce que le noyau doit refuser ────────────────────── */

titre('ce que le noyau refuse, et pourquoi');

function refus(nom, octets, motifAttendu) {
  const chemin = temporaire(nom);
  writeFileSync(chemin, octets);
  const sortie = temporaire('refus.tsv');
  // Un rapport laissé par un essai précédent ferait passer un cas en échec pour
  // un cas réussi : on le supprime avant.
  if (existsSync(sortie)) rmSync(sortie);
  const r = lancerSouple('liste', chemin, sortie);
  const contenu = existsSync(sortie) ? readFileSync(sortie, 'utf8') : r.sortie;
  const refuse = r.code !== 0 || contenu.includes('erreur');
  const motifVu = /erreur\t(.+)/.exec(contenu)?.[1] || '';
  const conforme = !motifAttendu || motifVu.toLowerCase().includes(motifAttendu.toLowerCase());
  check(
    `${nom} est refusé${motifAttendu ? ` (${motifAttendu})` : ''}`,
    refuse && conforme,
    motifVu || (r.code === 0 ? 'AUCUN REFUS' : `code ${r.code}`),
  );
}

{
  // Un .doc binaire renommé en .docx : le cas le plus fréquent du monde réel.
  const doc = Buffer.alloc(6000);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(doc, 0);
  refus('faux-docx.zip', doc, 'pas une archive');

  // Un RTF renommé.
  refus('faux-odt.zip', Buffer.from('{\\rtf1\\ansi un document texte}'), 'pas une archive');

  // Une archive tronquée au milieu de son annuaire.
  const valide = fabriquerArchive(CONTENUS.slice(0, 4));
  refus('tronquee.zip', valide.subarray(0, Math.floor(valide.length * 0.8)), '');

  // Un CRC abîmé : on modifie un octet du contenu, sans toucher à l'annuaire.
  const crcAbime = fabriquerArchive([{ nom: 'a.txt', contenu: Buffer.from('contenu intact'), compresse: false }]);
  const position = crcAbime.indexOf(Buffer.from('contenu intact'));
  crcAbime[position + 2] = 0x21;
  const cheminCrc = temporaire('crc-abime.zip');
  writeFileSync(cheminCrc, crcAbime);
  const r = lancerSouple('toutes', cheminCrc, temporaire('crc.tsv'));
  const contenuCrc = readFileSync(temporaire('crc.tsv'), 'utf8');
  check(
    'un contenu abîmé est refusé, et le CRC est nommé',
    contenuCrc.includes('refus') && /CRC32/.test(contenuCrc),
    (/refus\t(.+)/.exec(contenuCrc)?.[1] || 'AUCUN REFUS').slice(0, 90),
  );
  void r;

  // Une méthode exotique : on réécrit l'annonce en BZIP2 (12).
  const bzip = fabriquerArchive([{ nom: 'a.txt', contenu: Buffer.from('du texte'), compresse: false }]);
  const eocdBzip = bzip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const annuaireBzip = bzip.readUInt32LE(eocdBzip + 16);
  bzip.writeUInt16LE(12, annuaireBzip + 10);
  const cheminBzip = temporaire('bzip2.zip');
  writeFileSync(cheminBzip, bzip);
  const rBzip = lancerSouple('extraire', cheminBzip, 'a.txt', temporaire('bzip.bin'));
  check(
    'une méthode de compression non gérée est refusée, nommée',
    rBzip.code !== 0 && /méthode de compression 12/.test(rBzip.sortie),
    (rBzip.sortie.match(/méthode de compression[^\n]*/) || ['AUCUN REFUS'])[0].slice(0, 80),
  );

  // Une taille décompressée absurde dans l'annuaire central.
  const taille = fabriquerArchive([{ nom: 'a.txt', contenu: Buffer.from('0123456789'), compresse: false }]);
  taille.writeUInt32LE(999999, taille.readUInt32LE(taille.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) + 16) + 24);
  const cheminTaille = temporaire('taille.zip');
  writeFileSync(cheminTaille, taille);
  const rTaille = lancerSouple('extraire', cheminTaille, 'a.txt', temporaire('taille.bin'));
  check(
    'une taille déclarée absurde est refusée',
    rTaille.code !== 0,
    (rTaille.sortie.match(/(octets[^\n]*|hors du fichier[^\n]*)/) || ['AUCUN REFUS'])[0].slice(0, 80),
  );

  // Une entrée chiffrée : drapeau 0 dans l'annuaire central.
  const chiffre = fabriquerArchive([{ nom: 'a.txt', contenu: Buffer.from('secret'), compresse: false }]);
  const eocdChiffre = chiffre.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  chiffre.writeUInt16LE(1, chiffre.readUInt32LE(eocdChiffre + 16) + 8);
  refus('chiffre.zip', chiffre, 'chiffrée');

  // ZIP64 : on pose la sentinelle du nombre d'entrées.
  const zip64 = fabriquerArchive([{ nom: 'a.txt', contenu: Buffer.from('x'), compresse: false }]);
  const eocd64 = zip64.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  zip64.writeUInt16LE(0xffff, eocd64 + 10);
  zip64.writeUInt16LE(0xffff, eocd64 + 8);
  refus('zip64.zip', zip64, 'ZIP64');

  // Un nom qui sortirait de l'archive.
  refus(
    'evasion.zip',
    fabriquerArchive([{ nom: '../../evasion.txt', contenu: Buffer.from('x'), compresse: false }]),
    'suspect',
  );
  refus(
    'absolu.zip',
    fabriquerArchive([{ nom: '/etc/passwd', contenu: Buffer.from('x'), compresse: false }]),
    'suspect',
  );

  // Un fichier qui annonce plus d'entrées qu'il n'en a.
  const annonce = fabriquerArchive([{ nom: 'a.txt', contenu: Buffer.from('x'), compresse: false }]);
  const eocdAnnonce = annonce.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  annonce.writeUInt16LE(7, eocdAnnonce + 10);
  annonce.writeUInt16LE(7, eocdAnnonce + 8);
  refus('annonce-fausse.zip', annonce, 'annonce');

  // Un fichier vide, et deux octets de signature sans suite.
  refus('vide.zip', Buffer.alloc(0), "fin d'annuaire");
  refus('deux-octets.zip', Buffer.from([0x50, 0x4b]), "fin d'annuaire");

  /* Le cas réel le plus instructif du lot : `renomme.odt` est un fichier RTF
     avec une extension `.odt`. Le produit le signale dans ses commentaires, et
     c'est exactement ce qu'un lecteur doit faire — le reconnaître pour ce qu'il
     est, et refuser de l'ouvrir comme une archive. */
  const renomme = join(parent, '_dev/fixtures-396/_fixtures_396/renomme.odt');
  if (existsSync(renomme)) {
    const octets = readFileSync(renomme);
    refus('renomme.odt', octets, "pas une archive");
    const info = formatDe('renomme.odt', octets);
    check(
      'un .odt qui est en réalité du RTF est reconnu comme RTF',
      info.nature === 'rtf',
      `nature : ${info.nature}`,
    );
    check(
      'et il n’est pas compté comme archive',
      info.entrees === undefined,
      `entrées : ${info.entrees}`,
    );
  }
}

/* ─────────────────── 4. reconnaître le format ───────────────────────────── */

titre('reconnaître ce qu’est un fichier, sans le décompresser');

function formatDe(nom, octets) {
  const chemin = temporaire(nom);
  writeFileSync(chemin, octets);
  const sortie = temporaire('format.tsv');
  lancer('format', chemin, sortie);
  return Object.fromEntries(
    readFileSync(sortie, 'utf8')
      .trim()
      .split('\n')
      .map((l) => {
        const c = l.split('\t');
        return [c[0], c.slice(1).join('\t')];
      }),
  );
}

{
  const docx = join(parent, '_dev/docx-test/titre4.docx');
  if (existsSync(docx)) {
    const info = formatDe('format-docx.zip', readFileSync(docx));
    check('un .docx est reconnu comme archive', info.nature === 'zip');
    // Ce témoin-là est un .docx minimal, sans `[Content_Types].xml` : c'est
    // `word/document.xml` qui l'identifie. On accepte l'un ou l'autre, parce
    // que les deux existent dans la nature.
    check(
      'et il est identifié comme OOXML',
      /word\/document\.xml|\[content_types\]\.xml/.test(String(info.marqueurs)),
      `marqueurs : ${info.marqueurs}, entrées : ${info.entrees}`,
    );
    check('et il contient un dossier word/', String(info.dossiers || '').includes('word'), info.dossiers);
  }
  const docxComplet = join(parent, '_dev/exports/_test_word.docx');
  if (existsSync(docxComplet)) {
    const info = formatDe('format-docx2.zip', readFileSync(docxComplet));
    check(
      'un .docx complet porte bien [Content_Types].xml',
      String(info.marqueurs).includes('[content_types].xml'),
      `marqueurs : ${info.marqueurs}`,
    );
  }
  const odt = join(parent, '_dev/fixtures-396/_fixtures_396/test.odt');
  if (existsSync(odt)) {
    const info = formatDe('format-odt.zip', readFileSync(odt));
    check('un .odt est reconnu comme archive', info.nature === 'zip');
    check(
      'et son mimetype est vu',
      String(info.marqueurs).includes('mimetype'),
      `marqueurs : ${info.marqueurs}`,
    );
  }
  const idml = join(parent, '_dev/idml-test/features-561.idml');
  if (existsSync(idml)) {
    const info = formatDe('format-idml.zip', readFileSync(idml));
    check('un .idml est reconnu comme archive', info.nature === 'zip');
    check('et il contient les dossiers d’InDesign', /Stories|Spreads|designmap/i.test(String(info.dossiers)), info.dossiers);
  }

  /* Le point qui compte pour la suite : un `.ai` moderne n'est PAS du
     PostScript, c'est un PDF. Le noyau doit le dire au lieu de le deviner. */
  const ai = join(parent, '_dev/fixtures/Logo_licra_vecto.ai');
  if (existsSync(ai)) {
    const info = formatDe('format-ai.bin', readFileSync(ai));
    check(
      'le vrai .ai d’Illustrator est reconnu comme PDF, pas comme PostScript',
      info.nature === 'pdf',
      `nature : ${info.nature}, version : ${info.version}`,
    );
  }
  const eps = join(parent, '_dev/fixtures/eps-simple.eps');
  if (existsSync(eps)) {
    const info = formatDe('format-eps.bin', readFileSync(eps));
    check('un .eps est reconnu comme PostScript', info.nature === 'postscript');
    check('et sa BoundingBox est lue', info.boundingbox === '0 0 500 500', info.boundingbox);
    check('et son créateur aussi', String(info.createur || '').includes('fixture simple'), info.createur);
  }
  const aiPostScript = join(parent, '_dev/fixtures/eps-illustrator.eps');
  if (existsSync(aiPostScript)) {
    const info = formatDe('format-illustrator.bin', readFileSync(aiPostScript));
    check('un EPS d’Illustrator est reconnu comme PostScript', info.nature === 'postscript');
    check(
      'et sa HiResBoundingBox est lue',
      info.hiresboundingbox === '0 0 500 500',
      info.hiresboundingbox,
    );
  }
}

console.log(
  `\n${ok ? 'OK : le conteneur ZIP du noyau lit ce que lit un lecteur indépendant, et refuse ce qui est abîmé.' : 'ÉCHEC : voir les lignes \u2717 ci-dessus.'}`,
);
process.exit(ok ? 0 : 1);
