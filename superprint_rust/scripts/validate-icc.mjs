/* ══════════════════════════════════════════════════════════════════════════
   validate-icc.mjs — le lecteur de profils ICC contre une relecture indépendante.

   Ce script relit les **profils réels du produit** (`superprint/app/icc/`) en
   JavaScript, octet par octet, sans rien partager avec le Rust : en-tête, table
   des balises, types, tailles, nom. Puis il compare ligne à ligne avec ce que le
   noyau en dit.

   Il mesure aussi, et affiche, ce qui est le plus intéressant dans ces fichiers :
   **l'écart entre la taille que la spécification ICC donne pour une balise et la
   taille que le fichier déclare.** Les profils livrés sont écrits par Adobe et
   s'écartent de la lettre de la norme ; le noyau le signale au lieu de le
   masquer, et ce script le chiffre.

   Enfin, il éprouve les refus : un fichier tronqué, une signature absente, une
   balise qui sort du fichier, et un profil d'écran qui ne doit PAS pouvoir
   servir d'OutputIntent.

   Usage : node scripts/validate-icc.mjs
   Retour : 0 si tout passe, 1 sinon.
   ══════════════════════════════════════════════════════════════════════════ */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, '..');
const produit = join(racine, '..', 'superprint');
const dossierIcc = join(produit, 'app', 'icc');
const cheminExemple = join(
  racine,
  'target',
  'wasm32-wasip1',
  'release',
  'examples',
  'icc_dump.wasm',
);

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '\u2713' : '\u2717'} ${label}${detail ? ` \u2014 ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (t) => console.log(`\n== ${t}`);

if (!existsSync(cheminExemple)) {
  console.error(`introuvable : ${cheminExemple}`);
  console.error('(construire : cargo build -p superprint-icc --example icc_dump --target wasm32-wasip1 --release)');
  process.exit(2);
}

const dossier = join(racine, 'target', 'icc');
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

/* ───────────────────── relecture indépendante du format ───────────────────── */

const CLASSES = { scnr: 'entrée', mntr: 'affichage', prtr: 'sortie', link: 'espace de connexion', abst: 'abstrait', nmcl: 'nuancier' };
const ESPACES = {
  'RGB ': 'RVB', CMYK: 'CMJN', GRAY: 'gris', '2CLR': 'deux couleurs', 'CMY ': 'CMJ',
  'Lab ': 'Lab', 'XYZ ': 'XYZ',
};

function relire(octets) {
  if (octets.length < 128) return { erreur: 'trop court' };
  if (octets.toString('latin1', 36, 40) !== 'acsp') return { erreur: 'signature acsp absente' };
  const taille = octets.readUInt32BE(0);
  if (taille > octets.length) return { erreur: 'taille déclarée trop grande' };
  const nombre = octets.readUInt32BE(128);
  if (132 + nombre * 12 > octets.length) return { erreur: 'table des balises hors fichier' };

  const balises = [];
  for (let i = 0; i < nombre; i += 1) {
    const e = 132 + i * 12;
    const signature = octets.toString('latin1', e, e + 4);
    const decalage = octets.readUInt32BE(e + 4);
    const t = octets.readUInt32BE(e + 8);
    if (decalage !== 0 && (decalage < 128 || decalage + t > octets.length)) {
      return { erreur: `balise ${signature} hors fichier` };
    }
    const type = t >= 4 ? octets.toString('latin1', decalage, decalage + 4) : '';
    let table = null;
    if ((type === 'mft1' || type === 'mft2') && t >= 12) {
      table = {
        entrees: octets[decalage + 8],
        sorties: octets[decalage + 9],
        grille: octets[decalage + 10],
      };
    }
    balises.push({ signature, decalage, taille: t, type, table });
  }

  /* Le nom : `desc` (texte) ou `mluc` (UTF-16BE). */
  let nom = '';
  const desc = balises.find((b) => b.signature === 'desc');
  if (desc && desc.taille > 12) {
    const d = octets.subarray(desc.decalage, desc.decalage + desc.taille);
    if (d.toString('latin1', 0, 4) === 'mluc') {
      const n = d.readUInt32BE(8);
      const pas = d.readUInt32BE(12);
      if (n > 0 && pas >= 12) {
        const longueur = d.readUInt32BE(20);
        const offset = d.readUInt32BE(24);
        const debut = 16 + n * pas + offset;
        nom = d.subarray(debut, debut + longueur).swap16().toString('utf16le').trim();
      }
    } else {
      const compte = d.readUInt32BE(8);
      const texte = d.subarray(12, 12 + compte);
      nom = texte.subarray(0, texte.indexOf(0) < 0 ? texte.length : texte.indexOf(0)).toString('latin1').trim();
    }
  }

  return {
    taille,
    version: `${octets[8]} ${octets[9]}`,
    classe: CLASSES[octets.toString('latin1', 12, 16)] || 'inconnue',
    espace: ESPACES[octets.toString('latin1', 16, 20)] || 'inconnu',
    pcs: ESPACES[octets.toString('latin1', 20, 24)] || 'inconnu',
    blanc: [68, 72, 76].map((o) => octets.readInt32BE(o) / 65536),
    intention: octets.readUInt32BE(64),
    nom,
    balises,
  };
}

function tailleSpec(balise) {
  if (!balise.table) return null;
  const { entrees, sorties, grille } = balise.table;
  const noeuds = Math.pow(grille, entrees);
  if (balise.type === 'mft1') return 8 + entrees * 256 + noeuds * sorties + sorties * 256;
  if (balise.type === 'mft2') return 48 + entrees * 256 * 2 + noeuds * sorties * 2 + sorties * 256 * 2;
  return null;
}

function noyau(cheminFichier) {
  const copie = temporaire('copie.icc');
  writeFileSync(copie, readFileSync(cheminFichier));
  lancer(copie, temporaire('out.tsv'));
  const lignes = readFileSync(temporaire('out.tsv'), 'utf8').split('\n');
  const champs = {};
  const balises = [];
  for (const ligne of lignes) {
    const c = ligne.split('\t');
    if (c[0] === 'balise') balises.push(c);
    else if (c[0]) champs[c[0]] = c.slice(1);
  }
  return { champs, balises };
}

/* ───────────────────── 1. les trois profils livrés ───────────────────── */

const profils = ['CoatedFOGRA39.icc', 'USWebCoatedSWOP.icc', 'JapanColor2001Coated.icc'];

titre('les trois profils du produit : en-tête, espace, nom, balises');

for (const nomFichier of profils) {
  const chemin = join(dossierIcc, nomFichier);
  if (!existsSync(chemin)) {
    check(`${nomFichier} présent`, false, chemin);
    continue;
  }
  const octets = readFileSync(chemin);
  const attendu = relire(octets);
  const { champs, balises } = noyau(chemin);

  const accords = [
    ['taille', String(attendu.taille), champs.taille?.[0]],
    ['version', attendu.version, champs.version?.join(' ')],
    ['classe', attendu.classe, champs.classe?.[0]],
    ['espace', attendu.espace, champs.espace?.[0]],
    ['pcs', attendu.pcs, champs.pcs?.[0]],
    ['intention', String(attendu.intention), champs.intention?.[0]],
    ['nom', attendu.nom, champs.nom?.[0]],
  ];
  const desaccords = accords.filter(([, a, r]) => a !== r);
  check(
    `${nomFichier} : en-tête et nom identiques`,
    desaccords.length === 0,
    desaccords.length ? desaccords.map(([q, a, r]) => `${q}: attendu « ${a} » reçu « ${r} »`).join(' · ') : attendu.nom,
  );

  const blancOk = [0, 1, 2].every((i) => Math.abs(attendu.blanc[i] - Number(champs.blanc[i])) < 1e-6);
  check(`${nomFichier} : point blanc identique`, blancOk, champs.blanc.join(' '));

  check(`${nomFichier} : 4 composantes CMJN`, champs.composantes?.[0] === '4');
  check(`${nomFichier} : peut servir d'OutputIntent`, champs.sortie?.[0] === '1');

  /* Toutes les balises : signature, décalage, taille, type. */
  let premierEcart = null;
  if (attendu.balises.length !== balises.length) {
    premierEcart = `${attendu.balises.length} balises attendues, ${balises.length} reçues`;
  } else {
    attendu.balises.forEach((b, i) => {
      const r = balises[i];
      /* Le noyau rogne les espaces de fin de la signature de type (« XYZ  » n'a
         pas de sens en TSV) : on compare donc sur la forme rognée. */
      const typeJs = b.type.trim();
      if (b.signature !== r[1] || String(b.decalage) !== r[2] || String(b.taille) !== r[3] || typeJs !== r[4]) {
        if (!premierEcart) {
          premierEcart = `${b.signature}: ${b.decalage}/${b.taille}/${typeJs} contre ${r[1]}/${r[2]}/${r[3]}/${r[4]}`;
        }
      }
    });
  }
  check(
    `${nomFichier} : les ${attendu.balises.length} balises, au même endroit, avec le même type`,
    premierEcart === null,
    premierEcart || '',
  );
}

/* ───────────────────── 2. l'écart à la spécification, chiffré ───────────────────── */

titre('l’écart entre la taille de la spécification et la taille déclarée : un fait, mesuré');

for (const nomFichier of profils) {
  const octets = readFileSync(join(dossierIcc, nomFichier));
  const { balises } = relire(octets);
  const ecarts = balises
    .filter((b) => tailleSpec(b) !== null && b.taille !== tailleSpec(b))
    .map((b) => ({ signature: b.signature, type: b.type, declaree: b.taille, spec: tailleSpec(b), ecart: b.taille - tailleSpec(b) }));
  console.log(
    `  ${nomFichier.padEnd(26)} ${ecarts.map((e) => `${e.signature}(${e.type}) ${e.declaree} vs ${e.spec} → ${e.ecart >= 0 ? '+' : ''}${e.ecart}`).join(' · ')}`,
  );
  /* La comparaison : le noyau doit annoncer EXACTEMENT les mêmes écarts. */
  const { balises: bRust } = noyau(join(dossierIcc, nomFichier));
  const ecartsRust = bRust
    .filter((c) => c[9] !== '—' && c[9] !== '0')
    .map((c) => `${c[1]} ${c[9]}`);
  const ecartsJs = ecarts.map((e) => `${e.signature} ${e.ecart}`);
  check(
    `${nomFichier} : le noyau annonce les mêmes écarts`,
    JSON.stringify(ecartsRust) === JSON.stringify(ecartsJs),
    `noyau [${ecartsRust.join(', ')}] / relecture [${ecartsJs.join(', ')}]`,
  );
}

console.log(`
  Note : ces écarts sont ceux des profils Adobe livrés, pas une erreur de lecture.
  Mesure sur CoatedFOGRA39 : les balises mft2 (A2B0/A2B1/A2B2) sont 1 520 octets plus
  COURTS que la spécification, et les balises mft1 (B2A0/B2A1/B2A2, gamt) 40 octets
  plus LONGS. Décomposé : en mft2 l'en-tête fait 4 octets de plus (52 au lieu de 48)
  et la table de sortie 12 octets au lieu de 3 × 256 × 2 = 1 536 — soit deux entrées
  par canal au lieu de 256 ; en mft1, la table d'entrée a 40 octets de plus que les
  8 octets d'en-tête de la spécification.

  Autrement dit : la disposition EST déductible, et c'est justement pourquoi le noyau
  ne la déduit pas. Un lecteur qui connaît la marotte d'Adobe lit ces trois fichiers
  et se trompe en silence sur un profil conforme, écrit par un autre outil. Le noyau
  l'annonce, et la transformation reste à lcms.
`);

/* ───────────────────── 3. les refus ───────────────────── */

titre('les refus : un fichier douteux ne devient pas un OutputIntent');

const temoin = readFileSync(join(dossierIcc, 'CoatedFOGRA39.icc'));
const cas = [
  ['fichier tronqué à 100 octets', temoin.subarray(0, 100)],
  ['signature acsp détruite', Buffer.concat([temoin.subarray(0, 36), Buffer.from('xxxx'), temoin.subarray(40)])],
  ['taille déclarée absurde', (() => { const c = Buffer.from(temoin); c.writeUInt32BE(0xFFFFFF, 0); return c; })()],
  ['table de balises débordante', (() => { const c = Buffer.from(temoin); c.writeUInt32BE(1_000_000, 128); return c; })()],
  ['balise renvoyée dans le décor', (() => { const c = Buffer.from(temoin); c.writeUInt32BE(0x0000A2B0, 132); c.writeUInt32BE(900_000, 136); return c; })()],
];

for (const [nom, octets] of cas) {
  const attendu = relire(octets);
  const chemin = temporaire('refus.icc');
  writeFileSync(chemin, octets);
  lancer(chemin, temporaire('out.tsv'));
  const recu = readFileSync(temporaire('out.tsv'), 'utf8').trim();
  const lesDeux = Boolean(attendu.erreur) && recu.startsWith('erreur\t');
  check(
    `${nom} : refusé des deux côtés`,
    lesDeux,
    lesDeux ? recu.slice(0, 70) : `relecture « ${attendu.erreur || 'accepte'} » / noyau « ${recu.slice(0, 60)} »`,
  );
}

/* Un profil d'écran : structure valide, et pourtant il ne doit pas passer. */
{
  const ecran = Buffer.from(temoin);
  ecran.write('mntr', 12, 'latin1');
  ecran.write('RGB ', 16, 'latin1');
  const chemin = temporaire('ecran.icc');
  writeFileSync(chemin, ecran);
  lancer(chemin, temporaire('out.tsv'));
  const lignes = readFileSync(temporaire('out.tsv'), 'utf8').split('\n');
  const sortie = lignes.find((l) => l.startsWith('sortie\t'));
  check(
    'un profil d’affichage RVB est lu, mais refusé comme OutputIntent',
    sortie === 'sortie\t0',
    `${sortie}`,
  );
  const classe = lignes.find((l) => l.startsWith('classe\t'));
  check('et sa classe est bien lue comme « affichage »', classe === 'classe\taffichage', `${classe}`);
}

/* ───────────────────── 4. robustesse ───────────────────── */

titre('robustesse : aucun octet ne fait planter le noyau');

{
  /* Toutes les troncatures du préfixe, puis quelques octets modifiés : le noyau
     doit toujours rendre un rapport ou un refus, jamais un plantage. */
  let plantages = 0;
  let essais = 0;
  for (let coupe = 0; coupe <= 300; coupe += 7) {
    const chemin = temporaire('coupe.icc');
    writeFileSync(chemin, temoin.subarray(0, coupe));
    try {
      lancer(chemin, temporaire('out.tsv'));
    } catch {
      plantages += 1;
    }
    essais += 1;
  }
  for (let i = 0; i < 40; i += 1) {
    const modifie = Buffer.from(temoin.subarray(0, 4096));
    modifie[i * 97] = (i * 31) & 255;
    const chemin = temporaire('modifie.icc');
    writeFileSync(chemin, modifie);
    try {
      lancer(chemin, temporaire('out.tsv'));
    } catch {
      plantages += 1;
    }
    essais += 1;
  }
  check(
    `${essais} fichiers tronqués ou abîmés : aucun plantage`,
    plantages === 0,
    plantages ? `${plantages} plantage(s)` : 'tous rendus en rapport ou en refus',
  );
}

console.log(`\n${ok ? 'OK : le noyau lit les profils du produit comme une relecture indépendante, et refuse le reste.' : 'ÉCHEC : voir les lignes \u2717 ci-dessus.'}`);
process.exit(ok ? 0 : 1);
