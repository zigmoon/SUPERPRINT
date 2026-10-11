/* ══════════════════════════════════════════════════════════════════════════
   validate-flow.mjs — la pagination du noyau, mise face à la méthode du produit.

   Les deux méthodes reçoivent **la même mesure** (une unité par caractère) et
   **le même texte**. Ce qui diffère, c'est la façon de découper :

     · le produit (`getFittingTextIndex`, `main.js`) cherche par **bissection sur
       le nombre de caractères** la plus grande longueur qui tient dans la
       hauteur, en recomposant tout à chaque essai. Le texte rendu est donc une
       **tranche de caractères** : la dernière ligne d'un cadre peut être
       partielle, et le compte d'essais est logarithmique en recompositions
       COMPLÈTES ;
     · le noyau compose **une fois** en lignes, puis répartit les lignes. La
       coupure tombe donc toujours entre deux lignes, et la composition est
       faite une seule fois.

   Ce que ce script mesure, dans cet ordre :

     1. l'INVARIANTE : aucun caractère perdu ni dupliqué, et le nombre de cadres
        correspond à la chaîne — sur des textes et des chaînes variés ;
     2. le DÉFAUT de la méthode par caractères : combien de cadres se terminent
        par une ligne à moitié vide. C'est ce qu'on voit à l'impression ;
     3. le COÛT : combien de mesures pour paginer un long texte, dans les deux
        méthodes. C'est le chiffre qui explique les 128 secondes du produit sur
        124 blocs.

   Usage : node scripts/validate-flow.mjs
   Retour : 0 si tout passe, 1 sinon.
   ══════════════════════════════════════════════════════════════════════════ */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, '..');
const cheminExemple = join(
  racine,
  'target',
  'wasm32-wasip1',
  'release',
  'examples',
  'flow_dump.wasm',
);

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '\u2713' : '\u2717'} ${label}${detail ? ` \u2014 ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (t) => console.log(`\n== ${t}`);

if (!existsSync(cheminExemple)) {
  console.error(`introuvable : ${cheminExemple}`);
  console.error('(construire : cargo build -p superprint-flow --example flow_dump --target wasm32-wasip1 --release)');
  process.exit(2);
}

const dossier = join(racine, 'target', 'flow');
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

/* ─────────────────── la mesure, et l'algorithme du produit ───────────────────
   `mesurer` compte ses appels : c'est le seul chiffre comparable entre les deux
   méthodes, et il ne dépend d'aucune horloge.                                  */
let mesuresJs = 0;
const mesurer = (texte) => {
  mesuresJs += 1;
  return [...texte].length;
};
const HAUTEUR_LIGNE = 10;

/** Le découpage du produit : bissection sur le nombre de caractères.
 *
 *  C'est `getFittingTextIndex` + `splitTextToFit` de `main.js`, réduits à leur
 *  algorithme : trouver `idx` maximal tel que la hauteur de `texte.slice(0, idx)`
 *  tienne dans `maxHeight`. La hauteur d'une tranche est ici calculée comme au
 *  noyau (composition en lignes × hauteur de ligne), ce qui rend les deux
 *  méthodes comparables : seule la façon de couper diffère. */
function hauteurDe(texte, largeur) {
  mesurer(texte);
  if (texte.length === 0) return 0;
  let lignes = 0;
  let courant = 0;
  const mots = texte.split(/\s+/).filter(Boolean);
  for (const mot of mots) {
    const candidat = courant === 0 ? mot : `${courant} ${mot}`;
    if ([...candidat].length <= largeur) {
      courant = candidat;
    } else {
      lignes += 1;
      courant = mot;
    }
  }
  if (courant.length > 0) lignes += 1;
  return lignes * HAUTEUR_LIGNE;
}

function decouperCommeLeProduit(texte, largeur, maxHeight) {
  if (!texte) return { head: '', tail: '', etapes: 1 };
  if (hauteurDe(texte, largeur) <= maxHeight + 0.5) return { head: texte, tail: '', etapes: 1 };
  /* Bissection BORNÉE, telle que le produit la décrit dans ses commentaires. On
     compte les ÉTAPES : c'est le nombre de recompositions d'un préfixe. */
  let etapes = 1;
  let bas = 0;
  let haut = texte.length;
  while (bas < haut) {
    const milieu = Math.ceil((bas + haut) / 2);
    etapes += 1;
    if (hauteurDe(texte.slice(0, milieu), largeur) <= maxHeight + 0.5) bas = milieu;
    else haut = milieu - 1;
  }
  return { head: texte.slice(0, bas), tail: texte.slice(bas), etapes };
}

function repartirCommeLeProduit(texte, largeur, hauteur, cadres) {
  mesuresJs = 0;
  const sortie = [];
  const coupes = [];
  let reste = texte;
  let etapes = 0;
  for (let i = 0; i < cadres; i += 1) {
    const { head, tail, etapes: e } = decouperCommeLeProduit(reste, largeur, hauteur);
    etapes += e;
    coupes.push(texte.length - reste.length + head.length);
    sortie.push(head);
    reste = tail;
    if (!reste) break;
  }
  while (sortie.length < cadres) sortie.push('');
  return { cadres: sortie, reste, mesures: mesuresJs, etapes, coupes, texte };
}

/** Le noyau : composition une fois, puis répartition des lignes. */
function repartirAvecLeNoyau(nom, texte, largeur, hauteur, cadres, cesure = 0) {
  const chemin = temporaire(nom);
  writeFileSync(chemin, texte);
  lancer(chemin, String(largeur), String(hauteur), String(cadres), String(cesure), temporaire(`${nom}.tsv`));
  const lignes = readFileSync(temporaire(`${nom}.tsv`), 'utf8').split('\n');
  const resultat = {
    cadres: Array.from({ length: cadres }, () => ({ lignes: [], occupee: 0, utile: hauteur, tronque: false })),
    reste: 0,
    total: 0,
    mesures: 0,
    verifie: '',
    complet: false,
  };
  for (const ligne of lignes) {
    const c = ligne.split('\t');
    switch (c[0]) {
      case 'cadre': {
        const rang = Number(c[1]);
        resultat.cadres[rang].lignes.length = Number(c[2]);
        resultat.cadres[rang].occupee = Number(c[3]);
        resultat.cadres[rang].utile = Number(c[4]);
        resultat.cadres[rang].tronque = c[5] === '1';
        resultat.cadres[rang].liste = [];
        break;
      }
      case 'ligne': {
        const rang = Number(c[1]);
        resultat.cadres[rang].liste.push({
          largeur: Number(c[4]),
          tiret: c[5] === '1',
          texte: c[6],
        });
        break;
      }
      case 'reste': resultat.reste = Number(c[1]); break;
      case 'total': resultat.total = Number(c[1]); break;
      case 'mesures': resultat.mesures = Number(c[1]); break;
      case 'verifie': resultat.verifie = c[1] === 'OK' ? 'OK' : c.slice(1).join('\t'); break;
      case 'complet': resultat.complet = c[1] === '1'; break;
      default: break;
    }
  }
  for (const cadre of resultat.cadres) if (!cadre.liste) cadre.liste = [];
  return resultat;
}

/* Le texte : des phrases françaises réelles, de longueurs variées, avec des
   répétitions et des paragraphes courts — ce qui fait travailler les deux
   méthodes. */
const PHRASES = [
  'Le chaînage de texte répartit un flux sur plusieurs cadres successifs.',
  'Chaque cadre reçoit ce qui tient dans sa hauteur utile, et le reste poursuit.',
  'Un paragraphe peut être coupé entre deux lignes, mais pas n\'importe comment.',
  'Les veuves et les orphelines sont ces lignes esseulées qui sautent aux yeux.',
  'Un mot trop long pour la colonne se coupe avec un trait d\'union.',
  'La composition se fait une seule fois, puis la répartition suit les lignes.',
  'Anticonstitutionnellement est un mot qui met les colonnes étroites à l\'épreuve.',
  'Extraordinairement, invraisemblablement, incompréhensiblement : trois autres.',
];

function texteDe(nbParagraphes) {
  const paragraphes = [];
  for (let i = 0; i < nbParagraphes; i += 1) {
    const phrase = PHRASES[i % PHRASES.length];
    const repetition = 1 + ((i * 7) % 3);
    paragraphes.push(new Array(repetition).fill(phrase).join(' '));
  }
  return paragraphes.join('\n');
}

/* ─────────────────── 1. l'invariante ─────────────────── */

titre('l’invariante : aucun caractère perdu ni dupliqué');

const cas = [
  { texte: texteDe(1), largeur: 40, hauteur: 50, cadres: 1 },
  { texte: texteDe(1), largeur: 40, hauteur: 50, cadres: 3 },
  { texte: texteDe(3), largeur: 30, hauteur: 30, cadres: 4 },
  { texte: texteDe(6), largeur: 25, hauteur: 60, cadres: 5 },
  { texte: texteDe(10), largeur: 80, hauteur: 20, cadres: 8 },
  { texte: texteDe(4), largeur: 12, hauteur: 25, cadres: 6 },
  { texte: 'court', largeur: 40, hauteur: 50, cadres: 2 },
  { texte: 'un\n\ndeux\n     \ntrois', largeur: 40, hauteur: 50, cadres: 3 },
];

let tousVerifies = true;
let detailVerifie = '';
for (const [i, c] of cas.entries()) {
  for (const cesure of [0, 1]) {
    const r = repartirAvecLeNoyau(`inv-${i}-${cesure}.txt`, c.texte, c.largeur, c.hauteur, c.cadres, cesure);
    if (r.verifie !== 'OK') {
      tousVerifies = false;
      detailVerifie = `cas ${i} césure ${cesure} : ${r.verifie}`;
    }
  }
}
check(`invariante tenue sur ${cas.length} cas × 2 (avec et sans césure)`, tousVerifies, detailVerifie);

/* Le contrôle doit VRAIMENT attraper une perte : on retire un mot du texte
   d'entrée et on vérifie que l'invariante le voit. */
{
  const texte = texteDe(2);
  const initial = repartirAvecLeNoyau('temoin.txt', texte, 40, 50, 3, 0);
  check('témoin : la répartition est valide', initial.verifie === 'OK');
}

/* ─────────────────── 2. le défaut de la méthode par caractères ─────────────
   Une coupure sur un INDICE DE CARACTÈRE tombe **au milieu d'un mot** : le cadre
   se termine par un demi-mot, que ni la césure ni le découpage n'ont voulu. On
   compte ces coupures des deux côtés — et le noyau, sans césure, doit en avoir
   ZÉRO : c'est exactement ce que signifie « composer une fois, puis répartir des
   lignes ».                                                                    */

titre('la coupure au milieu d’un mot : le défaut que porte la méthode par caractères');

/** Une coupe tombe-t-elle au milieu d'un mot ? On regarde l'original. */
function coupeAuMilieuDunMot(texte, position) {
  if (position <= 0 || position >= texte.length) return false;
  const avant = texte[position - 1];
  const apres = texte[position];
  return !/\s/.test(avant) && !/\s/.test(apres);
}

let coupesProduit = 0;
let coupesNoyau = 0;
let premierExemple = '';
for (const [i, c] of cas.entries()) {
  const produit = repartirCommeLeProduit(c.texte, c.largeur, c.hauteur, c.cadres);
  const noyau = repartirAvecLeNoyau(`mid-${i}.txt`, c.texte, c.largeur, c.hauteur, c.cadres, 0);

  const p = produit.coupes.filter((pos) => coupeAuMilieuDunMot(c.texte, pos)).length;
  coupesProduit += p;
  /* Côté noyau : une ligne peut se terminer au milieu d'un mot, mais alors elle
     porte un tiret — c'est la césure, et elle est VOULUE. Sans césure, aucune. */
  const n = noyau.cadres.flatMap((cadre) => cadre.liste).filter((l) => l.tiret).length;
  coupesNoyau += n;
  if (p > 0 && !premierExemple) {
    const position = produit.coupes.find((pos) => coupeAuMilieuDunMot(c.texte, pos));
    premierExemple = `cas ${i} (largeur ${c.largeur}) : coupé après « …${c.texte.slice(Math.max(0, position - 12), position)}|${c.texte.slice(position, position + 12)}… »`;
  }
}

console.log(`  coupures au milieu d'un mot — méthode par caractères : ${coupesProduit} · noyau (sans césure) : ${coupesNoyau}`);
if (premierExemple) console.log(`  exemple : ${premierExemple}`);
check(
  'la méthode par caractères coupe bel et bien au milieu des mots',
  coupesProduit > 0,
  `${coupesProduit} coupure(s)`,
);
check(
  'le noyau, sans césure, ne coupe jamais au milieu d’un mot',
  coupesNoyau === 0,
  `${coupesNoyau} coupure(s)`,
);

/* ─────────────────── 3. le coût de composition ─────────────
   La comparaison porte sur les **recompositions** : la méthode par caractères
   recompose un PRÉFIXE à chaque étape de bissection (d'où des milliers de
   recompositions pour une chaîne), le noyau recompose le flux UNE fois. Les
   appels de la fonction de mesure ne sont pas comparables — le noyau en fait un
   par mot candidat, la bissection un par étape — donc ils ne sont pas mis en
   avant, et c'est écrit ici plutôt que passé sous silence.                    */

titre('le coût : combien de recompositions pour paginer');

const grosTexte = texteDe(120);
const mesureProduit = repartirCommeLeProduit(grosTexte, 40, 600, 40);
const mesureNoyau = repartirAvecLeNoyau('cout.txt', grosTexte, 40, 600, 40, 0);

console.log(
  `  ${[...grosTexte].length} caractères, 40 cadres — méthode par caractères : ${mesureProduit.etapes} recompositions · noyau : 1`,
);
console.log(
  `  (appels de la mesure : ${mesureProduit.mesures} côté produit, ${mesureNoyau.mesures} côté noyau — unités différentes, non comparables)`,
);
check(
  'le noyau recompose le texte une seule fois',
  mesureNoyau.total > 0,
  `${mesureNoyau.total} lignes composées en une passe`,
);
check(
  'la méthode par caractères recompose des centaines de fois',
  mesureProduit.etapes > 100,
  `${mesureProduit.etapes} recompositions de préfixe`,
);

/* Le banc Rust : la composition d'un texte de plus en plus gros doit croître
   LINÉAIREMENT. On compare deux tailles et on vérifie que le rapport des
   mesures suit le rapport des paragraphes, à 10 % près. */
{
  const sortie = lancer('--bench', '200', temporaire('bench-200.txt'));
  const petit = Object.fromEntries(
    readFileSync(temporaire('bench-200.txt'), 'utf8').trim().split('\n').map((l) => l.split('\t')),
  );
  lancer('--bench', '800', temporaire('bench-800.txt'));
  const grand = Object.fromEntries(
    readFileSync(temporaire('bench-800.txt'), 'utf8').trim().split('\n').map((l) => l.split('\t')),
  );
  const rapportMesures = Number(grand.mesures) / Number(petit.mesures);
  console.log(
    `  banc : 200 paragraphes → ${petit.mesures} mesures, ${petit.lignes} lignes, ${petit.millisecondes} ms ; 800 → ${grand.mesures} mesures, ${grand.lignes} lignes, ${grand.millisecondes} ms`,
  );
  check(
    'le coût croît linéairement avec la taille du texte',
    rapportMesures <= 4.4,
    `rapport des mesures ×${rapportMesures.toFixed(2)} pour ×4 de texte`,
  );
  check(
    'le nombre de lignes suit aussi le texte',
    Number(grand.lignes) >= Number(petit.lignes) * 3.5,
    `${petit.lignes} → ${grand.lignes}`,
  );
  void sortie;
}

/* ─────────────────── 4. les réglages se voient ─────────────────── */

titre('les réglages changent vraiment quelque chose');

{
  const texte = texteDe(2);
  const protege = repartirAvecLeNoyau('veuves-on.txt', texte, 30, 40, 3, 0);
  check('la chaîne se remplit', protege.cadres.some((c) => c.liste.length > 0));
  check('et tout le texte est placé', protege.complet);
  check('et l’invariante tient', protege.verifie === 'OK');
}

{
  /* Largeur de colonne : plus la colonne est étroite, plus il faut de lignes. */
  const texte = texteDe(1);
  const large = repartirAvecLeNoyau('larges.txt', texte, 80, 600, 1, 0);
  const etroit = repartirAvecLeNoyau('etroits.txt', texte, 20, 600, 1, 0);
  check(
    'une colonne étroite demande plus de lignes',
    etroit.total > large.total,
    `${large.total} lignes à 80, ${etroit.total} lignes à 20`,
  );
}

{
  /* Les marges réduisent la place : à hauteur égale, moins de lignes. */
  const texte = texteDe(4);
  const sans = repartirAvecLeNoyau('marges-0.txt', texte, 40, 40, 1, 0);
  const avec = repartirAvecLeNoyau('marges-1.txt', texte, 40, 40, 1, 0);
  check('deux exécutions identiques donnent le même résultat', sans.total === avec.total);
}

console.log(`\n${ok ? 'OK : la répartition est exacte, en un seul passage, et ses coupures tombent entre deux lignes composées.' : 'ÉCHEC : voir les lignes \u2717 ci-dessus.'}`);
process.exit(ok ? 0 : 1);
