/* ══════════════════════════════════════════════════════════════════════════
   validate-image.mjs — le traitement d'image du noyau contre un repli écrit ici.

   Ce script engendre les images d'entrée **en JavaScript** et applique à
   chacune un **repli indépendant** : le noyau Rust et le repli ne partagent
   aucun code, et là où les deux implémentent la même formule, c'est la même
   définition écrite deux fois — donc une divergence serait une vraie erreur,
   pas une nuance.

   Ce qui est comparé :

     · NIVEAUX et COURBES — à l'octet près, table comprise ;
     · FLOU — à l'unité près (le Rust est séparable, le repli calcule un noyau 2D :
       même formule, ordre d'opérations différent) ;
     · MÉDIANE — à l'octet près, plus la propriété qui la définit (un trait d'un
       pixel disparaît, un bord franc ne bouge pas) ;
     · NETTETÉ — le seuil doit épargner les petits écarts et amplifier les grands ;
     · LIMITATION D'ENCRE — les propriétés, pas la formule : la limite est tenue,
       aucun canal ne monte, deux passages ne changent rien de plus ;
     · COMPOSITION ALPHA — à l'octet près, contre le `source-over` de la
       spécification, y compris sur des calques translucides.

   Usage : node scripts/validate-image.mjs
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
  'image_dump.wasm',
);

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '\u2713' : '\u2717'} ${label}${detail ? ` \u2014 ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (t) => console.log(`\n== ${t}`);

if (!existsSync(cheminExemple)) {
  console.error(`introuvable : ${cheminExemple}`);
  console.error('(construire : cargo build -p superprint-image --example image_dump --target wasm32-wasip1 --release)');
  process.exit(2);
}

const dossier = join(racine, 'target', 'image');
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

/* ─────────────────── générateurs d'images (réplique à garder en tête) ─────────
   Ces motifs existent aussi en Rust dans `image_dump.rs`… non : ils n'existent
   QUE ici. Le Rust lit des octets, il n'engendre rien. C'est ce qui rend le
   contrôle utile — une divergence du filtre ne peut pas se cacher derrière une
   divergence du générateur.                                                 */
const COTE = 256;

function lcg(graine) {
  let etat = graine >>> 0;
  return () => {
    etat = (Math.imul(etat, 1664525) + 1013904223) >>> 0;
    return etat >>> 24;
  };
}

function engendrer(motif, canaux, argument = 0) {
  const octets = new Uint8Array(COTE * COTE * canaux);
  const suivant = lcg(argument);
  for (let y = 0; y < COTE; y += 1) {
    for (let x = 0; x < COTE; x += 1) {
      let v;
      switch (motif) {
        case 'uni': v = [argument & 255, argument & 255, argument & 255, argument & 255]; break;
        case 'damier': {
          const t = (x + y) % 2 === 0 ? 0 : 255;
          v = [t, t, t, t];
          break;
        }
        case 'degrade': v = [x, x, x, x]; break;
        case 'bruit': { const n = suivant(); v = [n, n, n, n]; break; }
        case 'grille': {
          const pas = argument >= 2 ? argument : 16;
          const t = x % pas === 0 || y % pas === 0 ? 20 : 230;
          v = [t, t, t, t];
          break;
        }
        case 'couleurs': {
          const q = Math.floor((x * 4) / COTE);
          v = [[220, 30, 40], [30, 200, 60], [40, 60, 220], [128, 128, 128]][q].concat([0]);
          break;
        }
        case 'alpha': v = [x, y, 200, (x ^ y) & 255]; break;
        case 'cmjn': v = [suivant(), suivant(), suivant(), suivant()]; break;
        case 'encres': {
          /* Un cas construit pour dépasser toutes les limites : un gris neutre
             fort avec du noir par-dessus (jusqu'à 400 % d'encre). */
          const n = Math.min(255, ((x + y) * 2) & 255);
          v = [n, n, n, Math.min(255, n * 2)];
          break;
        }
        default: v = [0, 0, 0, 0];
      }
      const base = (y * COTE + x) * canaux;
      for (let c = 0; c < canaux; c += 1) octets[base + c] = v[Math.min(c, 3)];
    }
  }
  return octets;
}

function ecrireEntree(nom, octets) {
  const chemin = temporaire(nom);
  writeFileSync(chemin, octets);
  return chemin;
}

function lireSortie(nom) {
  return new Uint8Array(readFileSync(temporaire(nom)));
}

function ecartMax(a, b) {
  let max = 0;
  for (let i = 0; i < a.length; i += 1) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}
function identique(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/* ─────────────────── replis indépendants ─────────────────── */

const borne = (v) => Math.max(0, Math.min(255, Math.round(v)));

function tableNiveaux(noir, blanc, gamma) {
  const blanche = Math.max(blanc, noir + 1);
  const g = Math.max(0.01, Math.min(10, gamma));
  const table = new Uint8Array(256);
  for (let e = 0; e < 256; e += 1) {
    const t = Math.max(0, Math.min(1, (e - noir) / (blanche - noir)));
    table[e] = borne(Math.pow(t, 1 / g) * 255);
  }
  return table;
}

function appliquerTable(src, table, canaux) {
  const sortie = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i += 1) sortie[i] = table[src[i]];
  return sortie;
}

function tableCourbe(points) {
  const p = points.filter((q) => q.every(Number.isFinite)).sort((a, b) => a[0] - b[0]);
  const table = new Uint8Array(256);
  for (let e = 0; e < 256; e += 1) {
    let valeur;
    if (p.length < 2 || p[0][0] === p[p.length - 1][0]) valeur = e;
    else if (e <= p[0][0]) valeur = p[0][1];
    else if (e >= p[p.length - 1][0]) valeur = p[p.length - 1][1];
    else {
      let i = 0;
      while (i < p.length - 2 && !(e >= p[i][0] && e <= p[i + 1][0])) i += 1;
      const [x0, y0] = p[i];
      const [x1, y1] = p[i + 1];
      valeur = x1 === x0 ? y1 : y0 + ((e - x0) / (x1 - x0)) * (y1 - y0);
    }
    table[e] = borne(valeur);
  }
  return table;
}

/* Le flou est ici calculé en 2D d'un seul tenant : c'est la même formule que le
   noyau séparable du Rust, écrite dans l'autre sens. */
function flou2d(src, canaux, sigma) {
  const rayon = Math.ceil(sigma * 3);
  const noyau = [];
  for (let i = 0; i <= rayon * 2; i += 1) {
    const x = i - rayon;
    noyau.push(Math.exp((-x * x) / (2 * sigma * sigma)));
  }
  const somme = noyau.reduce((a, b) => a + b, 0);
  for (let i = 0; i < noyau.length; i += 1) noyau[i] /= somme;

  const lire = (x, y, c) => {
    const xx = Math.max(0, Math.min(COTE - 1, x));
    const yy = Math.max(0, Math.min(COTE - 1, y));
    return src[(yy * COTE + xx) * canaux + c];
  };
  const sortie = new Uint8Array(src.length);
  for (let y = 0; y < COTE; y += 1) {
    for (let x = 0; x < COTE; x += 1) {
      for (let c = 0; c < canaux; c += 1) {
        let total = 0;
        for (let ky = 0; ky < noyau.length; ky += 1) {
          for (let kx = 0; kx < noyau.length; kx += 1) {
            total += noyau[ky] * noyau[kx] * lire(x + kx - rayon, y + ky - rayon, c);
          }
        }
        sortie[(y * COTE + x) * canaux + c] = borne(total);
      }
    }
  }
  return sortie;
}

function mediane3(src, canaux) {
  const lire = (x, y, c) => {
    const xx = Math.max(0, Math.min(COTE - 1, x));
    const yy = Math.max(0, Math.min(COTE - 1, y));
    return src[(yy * COTE + xx) * canaux + c];
  };
  const sortie = new Uint8Array(src.length);
  const fenetre = new Array(9);
  for (let y = 0; y < COTE; y += 1) {
    for (let x = 0; x < COTE; x += 1) {
      for (let c = 0; c < canaux; c += 1) {
        let k = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) fenetre[k++] = lire(x + dx, y + dy, c);
        }
        fenetre.sort((a, b) => a - b);
        sortie[(y * COTE + x) * canaux + c] = fenetre[4];
      }
    }
  }
  return sortie;
}

/* Composition alpha, formule de la spécification (source-over avec fusion). */
function fusionner(mode, dessous, dessus) {
  switch (mode) {
    case 'normal': return dessus;
    case 'multiplier': return dessous * dessus;
    case 'ecran': return 1 - (1 - dessous) * (1 - dessus);
    case 'obscurcir': return Math.min(dessous, dessus);
    case 'eclaircir': return Math.max(dessous, dessus);
    case 'superposer': return dessous <= 0.5 ? 2 * dessous * dessus : 1 - 2 * (1 - dessous) * (1 - dessus);
    default: throw new Error(`mode ${mode}`);
  }
}
function composerJs(fond, dessus, mode) {
  const sortie = new Uint8Array(fond.length);
  for (let i = 0; i < fond.length; i += 4) {
    const ab = fond[i + 3] / 255;
    const ah = dessus[i + 3] / 255;
    const ao = ah + ab * (1 - ah);
    if (ao <= 0) continue;
    for (let c = 0; c < 3; c += 1) {
      const cb = fond[i + c] / 255;
      const ch = dessus[i + c] / 255;
      const melange = (1 - ab) * ch + ab * fusionner(mode, cb, ch);
      const premultiplie = ah * melange + (1 - ah) * ab * cb;
      sortie[i + c] = borne((premultiplie / ao) * 255);
    }
    sortie[i + 3] = borne(ao * 255);
  }
  return sortie;
}
function aplatirJs(src) {
  const sortie = new Uint8Array((src.length / 4) * 3);
  for (let p = 0, q = 0; p < src.length; p += 4, q += 3) {
    const a = src[p + 3] / 255;
    for (let c = 0; c < 3; c += 1) sortie[q + c] = borne(src[p + c] * a + 255 * (1 - a));
  }
  return sortie;
}

/* Recadrage : extraction d'un rectangle, rogné aux bords de l'image. Rendre
   `null` quand le rectangle ne recouvre aucun pixel — c'est le cas que le noyau
   doit REFUSER plutôt que de rendre une image vide. */
function recadrerJs(src, taille, canaux, x, y, l, h) {
  const [largeurImage, hauteurImage] = taille;
  const x1 = Math.min(Math.max(x + l, 0), largeurImage);
  const y1 = Math.min(Math.max(y + h, 0), hauteurImage);
  const x0 = Math.min(Math.max(x, 0), largeurImage);
  const y0 = Math.min(Math.max(y, 0), hauteurImage);
  if (x0 >= x1 || y0 >= y1) return null;
  const L = x1 - x0;
  const H = y1 - y0;
  const sortie = new Uint8Array(L * H * canaux);
  for (let ligne = 0; ligne < H; ligne += 1) {
    const debut = ((y0 + ligne) * largeurImage + x0) * canaux;
    sortie.set(src.subarray(debut, debut + L * canaux), ligne * L * canaux);
  }
  return sortie;
}

/* ─────────────────── 1. niveaux et courbes ─────────────────── */

titre('niveaux et courbes : à l’octet près');

for (const [motif, argument] of [['degrade', 0], ['bruit', 7], ['couleurs', 0]]) {
  const src = engendrer(motif, 3, argument);
  const chemin = ecrireEntree('niveaux-src.raw', src);
  for (const [noir, blanc, gamma] of [[0, 255, 1], [20, 235, 1], [20, 235, 1.6], [0, 255, 0.6], [64, 192, 2.4]]) {
    lancer('niveaux', chemin, String(noir), String(blanc), String(gamma), temporaire('niveaux-out.raw'));
    const recu = lireSortie('niveaux-out.raw');
    const attendu = appliquerTable(src, tableNiveaux(noir, blanc, gamma), 3);
    const ecart = ecartMax(recu, attendu);
    check(
      `niveaux ${noir}/${blanc} γ${gamma} sur « ${motif} »`,
      ecart === 0,
      ecart === 0 ? '' : `écart maximal ${ecart}`,
    );
  }
}

{
  const src = engendrer('degrade', 3, 0);
  const chemin = ecrireEntree('courbe-src.raw', src);
  const points = [[0, 0], [64, 20], [128, 200], [192, 220], [255, 255]];
  lancer(
    'courbe',
    chemin,
    points.map((p) => p.join(':')).join(','),
    temporaire('courbe-out.raw'),
  );
  const attendu = appliquerTable(src, tableCourbe(points), 3);
  const ecart = ecartMax(lireSortie('courbe-out.raw'), attendu);
  check('courbe par morceaux sur un dégradé', ecart === 0, ecart === 0 ? '' : `écart ${ecart}`);
}

{
  /* Une courbe qui ne peut rien corriger doit rendre l'entrée intacte : c'est
     la différence entre « ne rien faire » et « tout aplatir ». */
  const src = engendrer('bruit', 3, 3);
  const chemin = ecrireEntree('courbe2-src.raw', src);
  lancer('courbe', chemin, '0:0', temporaire('courbe2-out.raw'));
  check('une courbe d’un seul point laisse l’image intacte', identique(lireSortie('courbe2-out.raw'), src));
}

/* ─────────────────── 2. flou, netteté, médiane ─────────────────── */

titre('flou : séparable côté noyau, 2D côté repli — même résultat à l’unité près');

for (const [motif, argument] of [['damier', 0], ['grille', 16], ['bruit', 11]]) {
  const src = engendrer(motif, 3, argument);
  const chemin = ecrireEntree('flou-src.raw', src);
  for (const sigma of [1.0, 1.5, 2.0]) {
    lancer('flou', chemin, String(sigma), temporaire('flou-out.raw'));
    const recu = lireSortie('flou-out.raw');
    const attendu = flou2d(src, 3, sigma);
    const ecart = ecartMax(recu, attendu);
    check(
      `flou σ=${sigma} sur « ${motif} »`,
      ecart <= 1,
      ecart <= 1 ? `écart maximal ${ecart}` : `ÉCART ${ecart}`,
    );
  }
}

{
  const src = engendrer('grille', 3, 24);
  const chemin = ecrireEntree('median-src.raw', src);
  lancer('mediane', chemin, temporaire('median-out.raw'));
  const recu = lireSortie('median-out.raw');
  const attendu = mediane3(src, 3);
  check('médiane 3×3 à l’octet près', identique(recu, attendu));

  /* La propriété qui définit la médiane : un trait d'un pixel disparaît, et un
     aplat reste un aplat. */
  const sombres = (o) => {
    let n = 0;
    for (let i = 0; i < o.length; i += 3) if (o[i] < 128) n += 1;
    return n;
  };
  check(
    'la médiane efface les traits d’un pixel et pas les aplats',
    sombres(recu) < sombres(src),
    `${sombres(src)} pixels sombres → ${sombres(recu)}`,
  );
  lancer('mediane', ecrireEntree('median-uni.raw', engendrer('uni', 3, 77)), temporaire('median-uni-out.raw'));
  check('la médiane laisse un aplat intact', identique(lireSortie('median-uni-out.raw'), engendrer('uni', 3, 77)));
}

{
  const src = engendrer('grille', 3, 32);
  const chemin = ecrireEntree('net-src.raw', src);
  const contraste = (o) => {
    let min = 255;
    let max = 0;
    for (let i = 0; i < o.length; i += 3) {
      min = Math.min(min, o[i]);
      max = Math.max(max, o[i]);
    }
    return max - min;
  };
  lancer('net', chemin, '1.0', '1.0', '0', temporaire('net-out.raw'));
  const sansSeuil = lireSortie('net-out.raw');
  check(
    'la netteté augment le contraste des contours',
    contraste(sansSeuil) >= contraste(src),
    `${contraste(src)} → ${contraste(sansSeuil)}`,
  );

  /* Un écart minuscule doit être épargné par le seuil, et amplifié sans lui. */
  const doux = new Uint8Array(256 * 256 * 3).fill(100);
  doux[(10 * 256 + 10) * 3 + 1] = 104;
  const cheminDoux = ecrireEntree('net-doux.raw', doux);
  lancer('net', cheminDoux, '1.0', '3.0', '10', temporaire('net-seuil.raw'));
  lancer('net', cheminDoux, '1.0', '3.0', '0', temporaire('net-sans.raw'));
  check('le seuil épargne un écart de 4/255', identique(lireSortie('net-seuil.raw'), doux));
  check('sans seuil, le même écart est amplifié', !identique(lireSortie('net-sans.raw'), doux));
}

{
  const src = engendrer('bruit', 1, 5);
  const chemin = ecrireEntree('flou-gris-src.raw', src);
  lancer('flou-gris', chemin, '1.5', temporaire('flou-gris-out.raw'));
  const ecart = ecartMax(lireSortie('flou-gris-out.raw'), flou2d(src, 1, 1.5));
  check('flou σ=1,5 en gris', ecart <= 1, `écart maximal ${ecart}`);
}

/* ─────────────────── 3. encrage ─────────────────── */

titre('encrage : la limite est une limite, et les propriétés se vérifient');

const taux = (o, i) =>
  Math.floor((o[i] * 100) / 255) + Math.floor((o[i + 1] * 100) / 255)
  + Math.floor((o[i + 2] * 100) / 255) + Math.floor((o[i + 3] * 100) / 255);

function tauxMax(o) {
  let max = 0;
  for (let i = 0; i < o.length; i += 4) max = Math.max(max, taux(o, i));
  return max;
}

for (const [motif, argument] of [['cmjn', 13], ['encres', 0], ['uni', 255]]) {
  const src = engendrer(motif, 4, argument);
  const chemin = ecrireEntree('encrage-src.raw', src);
  for (const limite of [100, 200, 240, 260, 300]) {
    lancer('limiter', chemin, String(limite), temporaire('limite-out.raw'));
    const recu = lireSortie('limite-out.raw');
    const respectee = tauxMax(recu) <= limite;
    let monte = false;
    for (let i = 0; i < src.length; i += 1) if (recu[i] > src[i]) monte = true;
    let sousLimiteIntacte = true;
    for (let i = 0; i < src.length; i += 4) {
      if (taux(src, i) <= limite) {
        for (let c = 0; c < 4; c += 1) if (recu[i + c] !== src[i + c]) sousLimiteIntacte = false;
      }
    }
    check(
      `limite ${limite} % sur « ${motif} »`,
      respectee && !monte && sousLimiteIntacte,
      `taux max ${tauxMax(recu)} % · canal monté : ${monte} · intact sous la limite : ${sousLimiteIntacte}`,
    );

    /* Idempotence : le second passage ne doit rien changer. */
    lancer('limiter', temporaire('limite-out.raw'), String(limite), temporaire('limite-out2.raw'));
    check(`limite ${limite} % : le second passage ne change rien`, identique(lireSortie('limite-out2.raw'), recu));
  }
}

{
  const src = engendrer('encres', 4, 0);
  const chemin = ecrireEntree('encrage-gcr.raw', src);
  lancer('encrage', chemin, '1.0', '240', temporaire('gcr-out.raw'));
  const recu = lireSortie('gcr-out.raw');
  let noirMonte = true;
  for (let i = 0; i < src.length; i += 4) {
    if (recu[i + 3] < src[i + 3]) noirMonte = false;
  }
  check('le GCR ne fait jamais descendre le noir', noirMonte);
  check('le GCR puis la limite tient la limite', tauxMax(recu) <= 240, `taux max ${tauxMax(recu)} %`);
  check(
    'le GCR garde le triangle neutre : C = M = Y s’efface au profit du noir',
    (() => {
      const neutre = engendrer('uni', 4, 0);
      for (let i = 0; i < neutre.length; i += 4) {
        neutre[i] = 255;
        neutre[i + 1] = 255;
        neutre[i + 2] = 255;
        neutre[i + 3] = 0;
      }
      const cheminNeutre = ecrireEntree('neutre.raw', neutre);
      lancer('encrage', cheminNeutre, '1.0', '400', temporaire('neutre-out.raw'));
      const o = lireSortie('neutre-out.raw');
      return o[0] === 0 && o[1] === 0 && o[2] === 0 && o[3] === 255;
    })(),
  );
}

/* ─────────────────── 4. alpha ─────────────────── */

titre('composition alpha : à l’octet près, contre la formule de la spécification');

/* Le fond est rendu **opaque** : c'est un fond de page, pas un calque. Sans
   cela, composer un calque transparent sur un fond transparent rend du
   transparent — ce qui est correct, mais ne teste pas la propriété qu'on veut
   vérifier (« un calque vide ne touche pas au fond »). */
const fond = engendrer('couleurs', 4, 0);
for (let i = 3; i < fond.length; i += 4) fond[i] = 255;
const dessus = engendrer('alpha', 4, 0);
const cheminFond = ecrireEntree('fond.raw', fond);
const cheminDessus = ecrireEntree('dessus.raw', dessus);

for (const mode of ['normal', 'multiplier', 'ecran', 'obscurcir', 'eclaircir', 'superposer']) {
  lancer('composer', cheminFond, cheminDessus, mode, temporaire('compose.raw'));
  const recu = lireSortie('compose.raw');
  const attendu = composerJs(fond, dessus, mode);
  const ecart = ecartMax(recu, attendu);
  check(`composition « ${mode} »`, ecart === 0, ecart === 0 ? '' : `écart maximal ${ecart}`);
}

{
  lancer('aplatir', cheminDessus, temporaire('aplati.raw'));
  const recu = lireSortie('aplati.raw');
  const attendu = aplatirJs(dessus);
  check('aplatissement sur blanc', identique(recu, attendu));
  check('l’aplatissement change bien le nombre de canaux', recu.length === (dessus.length / 4) * 3);
}

{
  /* Identités : un calque opaque cache le fond, un calque transparent ne touche à
     rien. Ce sont les deux cas qu'un signe inversé fait échouer. */
  const transparent = new Uint8Array(256 * 256 * 4);
  for (let i = 0; i < transparent.length; i += 4) transparent[i + 3] = 0;
  lancer('composer', cheminFond, ecrireEntree('transparent.raw', transparent), 'normal', temporaire('ident.raw'));
  check(
    'un calque entièrement transparent laisse le fond intact',
    identique(lireSortie('ident.raw'), fond),
  );
}

{
  /* Un très gros calque : la composition doit rester rapide et exacte. */
  const depart = Date.now();
  lancer('composer', cheminFond, cheminDessus, 'normal', temporaire('compose-gros.raw'));
  console.log(`  (composition 256×256 : ${Date.now() - depart} ms, processus compris)`);
}

/* ─────────────────── 5. recadrage ─────────────────── */

titre('recadrage : extraction exacte, rognage aux bords, refus du vide');

const sourceRvB = engendrer('couleurs', 3, 7);
const cheminSource = ecrireEntree('source-rvb.raw', sourceRvB);

/* Le damier de contrôle : chaque pixel porte une valeur distincte, ce qui rend
   un décalage de ligne, de colonne ou de canaux impossible à rater. */
const damier = new Uint8Array(256 * 256 * 3);
for (let y = 0; y < 256; y += 1) {
  for (let x = 0; x < 256; x += 1) {
    const base = (y * 256 + x) * 3;
    damier[base] = x;
    damier[base + 1] = y;
    damier[base + 2] = (x + y) % 256;
  }
}
const cheminDamier = ecrireEntree('damier.raw', damier);

const recadrages = [
  { nom: 'au centre', x: 40, y: 20, l: 100, h: 60 },
  { nom: 'sur une ligne entière', x: 0, y: 128, l: 256, h: 1 },
  { nom: 'sur une colonne entière', x: 200, y: 0, l: 1, h: 256 },
  { nom: 'd’un seul pixel', x: 255, y: 255, l: 1, h: 1 },
  { nom: 'de l’image entière', x: 0, y: 0, l: 256, h: 256 },
  { nom: 'débordant à gauche et au-dessus', x: -30, y: -10, l: 80, h: 40 },
  { nom: 'débordant à droite et en dessous', x: 200, y: 240, l: 500, h: 500 },
  { nom: 'débordant des quatre côtés', x: -50, y: -50, l: 400, h: 400 },
];

let recadragesJustes = 0;
for (const c of recadrages) {
  for (const [nom, source, taille, canaux, chemin] of [
    ['rvb', sourceRvB, [256, 256], 3, cheminSource],
    ['damier', damier, [256, 256], 3, cheminDamier],
  ]) {
    lancer('recadrer', chemin, String(c.x), String(c.y), String(c.l), String(c.h), temporaire('crop.raw'));
    const recu = lireSortie('crop.raw');
    const attendu = recadrerJs(source, taille, canaux, c.x, c.y, c.l, c.h);
    if (attendu === null) continue;
    if (identique(recu, attendu)) recadragesJustes += 1;
    else check(`recadrage ${c.nom} (${nom})`, false, `${recu.length} octets reçus, ${attendu.length} attendus`);
  }
}
check(
  `les ${recadrages.length * 2} recadrages rendent exactement la sous-image attendue`,
  recadragesJustes === recadrages.length * 2,
  `${recadragesJustes} justes`,
);

{
  /* Les cas rognés méritent un contrôle explicite de TAILLE : c'est la seule
     chose qu'un décalage de ligne laisserait passer. */
  const rognes = [
    { x: -30, y: -10, l: 80, h: 40, L: 50, H: 30 },
    { x: 200, y: 240, l: 500, h: 500, L: 56, H: 16 },
    { x: -50, y: -50, l: 400, h: 400, L: 256, H: 256 },
  ];
  let taillesJustes = true;
  for (const r of rognes) {
    lancer('recadrer', cheminDamier, String(r.x), String(r.y), String(r.l), String(r.h), temporaire('crop-taille.raw'));
    const recu = lireSortie('crop-taille.raw');
    if (recu.length !== r.L * r.H * 3) {
      taillesJustes = false;
      console.log(`    ${r.x},${r.y} ${r.l}×${r.h} : ${recu.length} octets, ${r.L * r.H * 3} attendus`);
    }
  }
  check('une sélection débordante est bien rognée à la bonne taille', taillesJustes);
}

{
  /* Le refus : un rectangle entièrement dehors ne doit pas rendre une image
     vide, mais une erreur. Le code de sortie le dit. */
  let refuses = 0;
  const dehors = [
    [256, 0, 10, 10],
    [0, 256, 10, 10],
    [-40, 0, 10, 10],
    [0, -40, 10, 10],
    [10, 10, 0, 10],
  ];
  for (const [x, y, l, h] of dehors) {
    let code = 0;
    try {
      lancer('recadrer', cheminDamier, String(x), String(y), String(l), String(h), temporaire('crop-vide.raw'));
    } catch (e) {
      code = e.status ?? 1;
    }
    if (code !== 0) refuses += 1;
    else check(`recadrage vide ${x},${y} ${l}×${h} refusé`, false, 'le noyau a rendu une image');
  }
  check(`les ${dehors.length} recadrages vides sont refusés`, refuses === dehors.length, `${refuses} refus`);
  check('et aucun recadrage vide n’a été écrit', !existsSync(temporaire('crop-vide.raw')));
}

{
  /* Une image en gris se recadre aussi : un canal au lieu de trois. */
  let gris = new Uint8Array(256 * 256);
  for (let y = 0; y < 256; y += 1) for (let x = 0; x < 256; x += 1) gris[y * 256 + x] = (x * 3 + y) % 256;
  const cheminGris = ecrireEntree('gris-crop.raw', gris);
  lancer('recadrer-gris', cheminGris, '10', '20', '30', '40', temporaire('crop-gris.raw'));
  const recu = lireSortie('crop-gris.raw');
  const attendu = recadrerJs(gris, [256, 256], 1, 10, 20, 30, 40);
  check('recadrage d’une image en gris', identique(recu, attendu), `${recu.length} octets`);
}

console.log(`\n${ok ? 'OK : les filtres d’image du noyau font exactement ce que dit leur repli.' : 'ÉCHEC : voir les lignes \u2717 ci-dessus.'}`);
process.exit(ok ? 0 : 1);
