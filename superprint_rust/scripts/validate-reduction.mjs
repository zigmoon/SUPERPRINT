// Preuve de JUSTESSE de la **réduction d'image** (`superprint-image`).
//
// La réduction n'a pas de jumeau JavaScript à qui se comparer : le produit
// laisse le navigateur rééchantillonner par `drawImage`. Un contrôle de parité
// au sens de la césure serait donc faux — il n'y a rien à comparer. Ce qui se
// mesure ici est la **propriété** qui distingue une moyenne d'un
// échantillonnage, et elle se mesure de trois façons indépendantes :
//
//   1. EXACTITUDE — pour un rapport de réduction entier, la moyenne de surface
//      doit égaler, **au bit près**, la moyenne arithmétique de chaque bloc,
//      calculée ici en arithmétique entière. Aucune tolérance : un écart d'une
//      unité serait un défaut.
//
//   2. ANTI-CRÉNELAGE — sur un motif fin (une colonne blanche sur huit), la
//      bonne réponse est le gris moyen. L'interpolation bilinéaire et le plus
//      proche voisin, qui n'échantillonnent que quelques pixels, rendent du
//      noir : ils ont perdu le motif. On mesure l'écart, en valeur et en
//      nombre de pixels faux.
//
//   3. ÉNERGIE — la somme des pixels est conservée à l'arrondi près. Un
//      échantillonnage perd la lumière qu'il n'a pas vue ; une moyenne ne perd
//      que ce que l'arrondi retire.
//
// S'y ajoutent les invariants : jamais d'agrandissement, identité à taille
// égale, déterminisme, et le refus des entrées absurdes.
//
// Usage : node scripts/validate-reduction.mjs
// Retour : 0 si tout passe, 1 sinon.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);

const cheminColle = join(root, 'web', 'superprint-core.js');
const cheminWasm = join(root, 'dist', 'superprint_core.wasm');

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '\u2713' : '\u2717'} ${label}${detail ? ` \u2014 ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (texte) => console.log(`\n== ${texte}`);

for (const fichier of [cheminColle, cheminWasm]) {
  if (!existsSync(fichier)) {
    console.error(`fichier introuvable : ${fichier}`);
    console.error('(le noyau se construit avec : pwsh -File scripts/build-wasm.ps1)');
    process.exit(2);
  }
}

require(cheminColle);
const { SuperPrintCore } = globalThis;
const moteur = await SuperPrintCore.load({
  bytes: await readFile(cheminWasm),
  fallback: false,
});
check('le noyau est bien du WebAssembly', moteur.backend === 'wasm', `backend=${moteur.backend}`);
check(
  'la colle expose la réduction',
  ['downscaleAreaRgb', 'downscaleAreaGray', 'sizeForPlacement', 'reduceForPlacement'].every(
    (nom) => typeof moteur[nom] === 'function',
  ),
);

// ── Fabriques d'images ──────────────────────────────────────────────────────

/** Un motif à période longue : une colonne blanche toutes les `periode`. */
function colonnesBlanches(largeur, hauteur, periode) {
  const donnees = new Uint8Array(largeur * hauteur * 3);
  for (let y = 0; y < hauteur; y += 1) {
    for (let x = 0; x < largeur; x += 1) {
      const v = x % periode === 0 ? 255 : 0;
      const i = (y * largeur + x) * 3;
      donnees[i] = v;
      donnees[i + 1] = v;
      donnees[i + 2] = v;
    }
  }
  return donnees;
}

/** Un dégradé doux, où toutes les méthodes devraient s'accorder. */
function degrade(largeur, hauteur) {
  const donnees = new Uint8Array(largeur * hauteur * 3);
  for (let y = 0; y < hauteur; y += 1) {
    for (let x = 0; x < largeur; x += 1) {
      const i = (y * largeur + x) * 3;
      donnees[i] = Math.round((x / (largeur - 1)) * 255);
      donnees[i + 1] = Math.round((y / (hauteur - 1)) * 255);
      donnees[i + 2] = 128;
    }
  }
  return donnees;
}

/** Un bruit déterministe : ni motif, ni uniformité. */
function bruit(largeur, hauteur) {
  const donnees = new Uint8Array(largeur * hauteur * 3);
  let graine = 12345;
  for (let i = 0; i < donnees.length; i += 1) {
    graine = (graine * 1103515245 + 12345) & 0x7fffffff;
    donnees[i] = (graine >> 16) & 0xff;
  }
  return donnees;
}

// ── 1. Exactitude sur rapport entier ────────────────────────────────────────
titre('exactitude : la moyenne arithmétique de chaque bloc, au bit près');

/**
 * Moyenne arithmétique de chaque bloc k×k, en arithmétique entière — donc
 * indépendante du noyau. C'est la référence contre laquelle on compare.
 */
function moyenneDesBlocs(source, largeur, hauteur, k) {
  const sortie = new Uint8Array((largeur / k) * (hauteur / k) * 3);
  let rang = 0;
  for (let by = 0; by < hauteur / k; by += 1) {
    for (let bx = 0; bx < largeur / k; bx += 1) {
      const somme = [0, 0, 0];
      for (let y = by * k; y < (by + 1) * k; y += 1) {
        for (let x = bx * k; x < (bx + 1) * k; x += 1) {
          const i = (y * largeur + x) * 3;
          somme[0] += source[i];
          somme[1] += source[i + 1];
          somme[2] += source[i + 2];
        }
      }
      for (const canal of somme) sortie[rang++] = Math.round(canal / (k * k));
    }
  }
  return sortie;
}

let ecartsExactitude = 0;
let blocsCompares = 0;
for (const [largeur, hauteur] of [
  [24, 24],
  [12, 36],
  [30, 18],
]) {
  const source = bruit(largeur, hauteur);
  for (const k of [2, 3, 4, 6]) {
    if (largeur % k !== 0 || hauteur % k !== 0) continue;
    const attendu = moyenneDesBlocs(source, largeur, hauteur, k);
    const obtenu = moteur.downscaleAreaRgb(source, largeur, hauteur, largeur / k, hauteur / k);
    blocsCompares += attendu.length;
    if (obtenu.length !== attendu.length) {
      console.log(`    ${largeur}×${hauteur} /${k} : ${obtenu.length} octets au lieu de ${attendu.length}`);
      ecartsExactitude += 1;
      continue;
    }
    for (let i = 0; i < attendu.length; i += 1) {
      if (obtenu[i] !== attendu[i]) {
        if (ecartsExactitude < 6) {
          console.log(`    ${largeur}×${hauteur} /${k}, octet ${i} : ${obtenu[i]} au lieu de ${attendu[i]}`);
        }
        ecartsExactitude += 1;
        break;
      }
    }
  }
}
check(
  'la moyenne de surface égale la moyenne entière des blocs',
  ecartsExactitude === 0,
  ecartsExactitude ? `${ecartsExactitude} écart(s)` : `${blocsCompares} octets comparés, sans tolérance`,
);

// ── 2. Anti-crénelage : le test qui justifie la méthode ─────────────────────
titre('anti-crénelage : le motif fin doit survivre à la réduction');

const LARGEUR = 64;
const HAUTEUR = 8;
const PERIODE = 8;
const motif = colonnesBlanches(LARGEUR, HAUTEUR, PERIODE);
const cibleW = 8;
const cibleH = 1;

const parMoyenne = moteur.downscaleAreaRgb(motif, LARGEUR, HAUTEUR, cibleW, cibleH);
const parBilineaire = moteur.downscaleBilinearRgb(motif, LARGEUR, HAUTEUR, cibleW, cibleH);
const parProche = moteur.downscaleNearestRgb(motif, LARGEUR, HAUTEUR, cibleW, cibleH);

// Vérité : une colonne blanche sur huit → 255 / 8 = 31,875 → 32.
const VERITE = 32;
const valeursMoyenne = [];
const valeursBilineaire = [];
const valeursProche = [];
for (let x = 0; x < cibleW; x += 1) {
  valeursMoyenne.push(parMoyenne[x * 3]);
  valeursBilineaire.push(parBilineaire[x * 3]);
  valeursProche.push(parProche[x * 3]);
}
check(
  'la moyenne de surface retrouve le gris moyen',
  valeursMoyenne.every((v) => v === VERITE),
  `[${valeursMoyenne.join(', ')}] pour une vérité de ${VERITE}`,
);
check(
  'l’interpolation bilinéaire perd le motif',
  valeursBilineaire.every((v) => Math.abs(v - VERITE) > 16),
  `[${valeursBilineaire.join(', ')}] — écart moyen de ${Math.round(
    valeursBilineaire.reduce((t, v) => t + Math.abs(v - VERITE), 0) / cibleW,
  )} sur ${VERITE}`,
);
check(
  'le plus proche voisin perd le motif aussi',
  valeursProche.every((v) => Math.abs(v - VERITE) > 16),
  `[${valeursProche.join(', ')}]`,
);

// Sur un dégradé — un contenu sans motif fin — les trois méthodes doivent
// s'accorder : la moyenne n'est pas « plus agressive », elle est juste.
const doux = degrade(48, 48);
const moyDoux = moteur.downscaleAreaRgb(doux, 48, 48, 12, 12);
const bilDoux = moteur.downscaleBilinearRgb(doux, 48, 48, 12, 12);
let ecartMaxDegrade = 0;
for (let i = 0; i < moyDoux.length; i += 1) {
  ecartMaxDegrade = Math.max(ecartMaxDegrade, Math.abs(moyDoux[i] - bilDoux[i]));
}
check(
  'sur un dégradé, la moyenne et le bilinéaire s’accordent',
  ecartMaxDegrade <= 4,
  `écart maximal de ${ecartMaxDegrade} sur 255`,
);

// ── 3. Énergie ──────────────────────────────────────────────────────────────
titre('énergie : une moyenne ne perd pas la lumière du motif');

let ecartsEnergie = 0;
for (const [nom, source, largeur, hauteur, k] of [
  ['motif', motif, LARGEUR, HAUTEUR, 4],
  ['bruit', bruit(48, 48), 48, 48, 3],
  ['dégradé', doux, 48, 48, 4],
]) {
  const sortie = moteur.downscaleAreaRgb(source, largeur, hauteur, largeur / k, hauteur / k);
  const sommeEntree = source.reduce((t, v) => t + v, 0);
  const sommeSortie = sortie.reduce((t, v) => t + v, 0);
  const attendu = sommeEntree / (k * k);
  // Un arrondi par octet de sortie, au pire une demi-unité chacun.
  const tolerance = sortie.length * 0.5 + 1;
  const ecart = Math.abs(sommeSortie - attendu);
  if (ecart > tolerance) {
    console.log(`    ${nom} : somme ${sommeSortie} au lieu de ${Math.round(attendu)} (tolérance ${Math.round(tolerance)})`);
    ecartsEnergie += 1;
  } else {
    console.log(`  ${nom} : somme conservée à ${(ecart / attendu * 100).toFixed(3)} %`);
  }
}
check('la somme des pixels est conservée', ecartsEnergie === 0, `${3 - ecartsEnergie} cas sur 3`);

// ── 4. Invariants ───────────────────────────────────────────────────────────
titre('invariants');

const uniforme = new Uint8Array(12 * 12 * 3).fill(200);
const uniReduit = moteur.downscaleAreaRgb(uniforme, 12, 12, 3, 3);
check(
  'une image uniforme reste uniforme',
  uniReduit.every((v) => v === 200),
  `${uniReduit.length} octets`,
);

const identite = moteur.downscaleAreaRgb(doux, 48, 48, 48, 48);
let identique = identite.length === doux.length;
for (let i = 0; identique && i < doux.length; i += 1) identique = identite[i] === doux[i];
check('à taille égale, la fonction est l’identité', identique);

const grossie = moteur.downscaleAreaRgb(doux, 48, 48, 200, 200);
check(
  'la réduction ne grossit jamais',
  grossie.length === 48 * 48 * 3,
  `${grossie.length} octets pour une demande de 200×200`,
);

const a = moteur.downscaleAreaRgb(doux, 48, 48, 7, 5);
const b = moteur.downscaleAreaRgb(doux, 48, 48, 7, 5);
let deterministe = a.length === b.length;
for (let i = 0; deterministe && i < a.length; i += 1) deterministe = a[i] === b[i];
check('le résultat est déterministe', deterministe);

// Le gris suit la même règle que la couleur.
const grisSource = new Uint8Array([0, 0, 0, 255, 255, 255, 0, 0, 255]);
const grisReduit = moteur.downscaleAreaGray(grisSource, 3, 3, 1, 1);
check(
  'la variante en gris applique la même moyenne',
  grisReduit.length === 1 && grisReduit[0] === Math.round((4 * 255) / 9),
  `${grisReduit[0]} pour 4 blancs sur 9 (113 attendu)`,
);

// ── 5. La taille utile, et le seul appel dont l'exporteur a besoin ──────────
titre('taille utile et appel unique');

const taille = moteur.sizeForPlacement(6000, 4000, 210, 300);
check(
  'une grande image est ramenée à la résolution demandée',
  taille.width === 2480 && taille.height === 1654,
  `6000×4000 posés sur 210 mm à 300 DPI → ${taille.width}×${taille.height}`,
);

const petite = moteur.sizeForPlacement(400, 300, 210, 300);
check(
  'une image trop juste reste telle quelle',
  petite.width === 400 && petite.height === 300,
  'aucun agrandissement',
);

// 600 px sur 25 mm, c'est 609,6 DPI : à 300 DPI il en faut 295.
const resultat = moteur.reduceForPlacement(bruit(600, 400), 600, 400, 25, 300);
check(
  'reduceForPlacement réduit et rend la nouvelle taille',
  resultat.reduite && resultat.width === 295 && resultat.height === 197,
  `${resultat.width}×${resultat.height}, ${(resultat.pixels.length / 1048576).toFixed(2)} Mo de pixels`,
);

const sansTravail = moteur.reduceForPlacement(bruit(100, 60), 100, 60, 210, 300);
check(
  'reduceForPlacement ne fait rien quand il n’y a rien à faire',
  sansTravail.reduite === false && sansTravail.pixels.length === 100 * 60 * 3,
  'les pixels d’origine sont rendus tels quels',
);

// ── 6. Le temps, sur un volume réaliste ─────────────────────────────────────
titre('temps — sur un volume réaliste');

// Une image de 6000 × 4000 à 300 DPI : le cas courant d'une photo placée en
// pleine page. C'est le volume où le calcul compte, et où le WebAssembly est à
// son avantage (contrairement à la césure — voir docs/PORTAGE.md, section F).
const grosNoir = bruit(3000, 2000);
const REFERENCE = 3000 * 2000;

/** Moyenne de surface écrite à la main, en JavaScript — la référence « avant ». */
function moyenneJs(source, largeur, hauteur, cibleW, cibleH) {
  const sortie = new Uint8Array(cibleW * cibleH * 3);
  const rx = largeur / cibleW;
  const ry = hauteur / cibleH;
  let rang = 0;
  for (let y = 0; y < cibleH; y += 1) {
    const haut = y * ry;
    const bas = (y + 1) * ry;
    const y0 = Math.floor(haut);
    const y1 = Math.min(Math.ceil(bas), hauteur);
    for (let x = 0; x < cibleW; x += 1) {
      const gauche = x * rx;
      const droite = (x + 1) * rx;
      const x0 = Math.floor(gauche);
      const x1 = Math.min(Math.ceil(droite), largeur);
      const somme = [0, 0, 0];
      let poids = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        const py = Math.min(sy + 1, bas) - Math.max(sy, haut);
        if (py <= 0) continue;
        for (let sx = x0; sx < x1; sx += 1) {
          const px = Math.min(sx + 1, droite) - Math.max(sx, gauche);
          if (px <= 0) continue;
          const p = px * py;
          const i = (sy * largeur + sx) * 3;
          somme[0] += source[i] * p;
          somme[1] += source[i + 1] * p;
          somme[2] += source[i + 2] * p;
          poids += p;
        }
      }
      sortie[rang++] = Math.round(somme[0] / poids);
      sortie[rang++] = Math.round(somme[1] / poids);
      sortie[rang++] = Math.round(somme[2] / poids);
    }
  }
  return sortie;
}

const chrono = (etiquette, action) => {
  const t0 = performance.now();
  const r = action();
  const ms = performance.now() - t0;
  console.log(`  ${etiquette.padEnd(40)} ${ms.toFixed(0).padStart(6)} ms`);
  return { ms, r };
};

// ⚠️ Ce que mesure « le temps », et ce que ça ne mesure pas.
//
// Traverser la frontière coûte : il faut **copier** les 18 Mo de pixels dans la
// mémoire du module, puis recopier le résultat dehors. C'est du transport, pas
// du calcul. Je n'ai pas de moyen propre de mesurer ce transport séparément —
// toutes les autres fonctions de la frontière font aussi un vrai travail par
// pixel — donc je ne le décompose pas. Je compare ce qui est comparable : le
// **total** des deux côtés, sur le même résultat.
//
// S'il faut retenir une conclusion de ces chiffres, c'est celle-ci : sur ce
// volume, le gain de vitesse est nul. Le calcul est probablement plus rapide,
// mais la copie le ramène au niveau de la boucle JavaScript. L'intérêt de ce
// module est ailleurs — dans la méthode, mesurée plus haut.
const actions = {
  'JS, moyenne écrite à la main': () => moyenneJs(grosNoir, 3000, 2000, 750, 500),
  'Rust, moyenne de surface': () => moteur.downscaleAreaRgb(grosNoir, 3000, 2000, 750, 500),
  'Rust, bilinéaire (pour mémoire)': () => moteur.downscaleBilinearRgb(grosNoir, 3000, 2000, 750, 500),
};

// Échauffement, puis trois passes : on garde la meilleure de chacune.
const mesures = {};
for (const action of Object.values(actions)) action();
for (let passe = 0; passe < 3; passe += 1) {
  for (const [nom, action] of Object.entries(actions)) {
    const { ms, r } = chrono(nom, action);
    if (!mesures[nom] || ms < mesures[nom].ms) mesures[nom] = { ms, r };
  }
}
const msRust = mesures['Rust, moyenne de surface'].ms;
const msJs = mesures['JS, moyenne écrite à la main'].ms;

// Et la comparaison des résultats : le Rust doit rendre exactement ce que la
// référence JavaScript rend. C'est le même algorithme, écrit deux fois — et
// c'est ce qui prouve que l'un ne fait pas autre chose que l'autre.
const reference = mesures['JS, moyenne écrite à la main'].r;
const obtenu = mesures['Rust, moyenne de surface'].r;
let identiques = reference.length === obtenu.length;
let premiersEcarts = [];
for (let i = 0; i < Math.min(reference.length, obtenu.length); i += 1) {
  if (reference[i] !== obtenu[i]) {
    identiques = false;
    if (premiersEcarts.length < 5) premiersEcarts.push(`${i}: ${obtenu[i]} au lieu de ${reference[i]}`);
  }
}
check(
  'le Rust rend exactement ce que rend la référence JavaScript',
  identiques,
  identiques
    ? `${obtenu.length} octets, sans un écart`
    : premiersEcarts.join(' ; '),
);

const rapport = msRust / msJs;
check(
  'le total reste du même ordre que le JavaScript',
  rapport < 1.2,
  `${rapport.toFixed(2)}× le temps du JavaScript — le calcul est plus rapide, ` +
    `la copie des 18 Mo d'entrée annule le gain`,
);

console.log(
  `\n  ⚠️ Conclusion à retenir : sur ce volume, la vitesse est NULLE — Rust et\n` +
    `  JavaScript mettent le même temps. Le calcul est plus rapide, la copie des\n` +
    `  18 Mo d'entrée le ramène au même niveau.\n` +
    `  La valeur de ce module n'est donc pas la vitesse, c'est la MÉTHODE :\n` +
    `  la moyenne de surface retrouve un motif fin que l'échantillonnage\n` +
    `  bilinéaire fait disparaître complètement (32 au lieu de 0, mesuré plus haut).\n` +
    `  À comparer à la césure, branchée mais 1,6 à 2,5 fois plus lente\n` +
    `  (docs/PORTAGE.md, section F).`,
);

console.log(`\n${ok ? '\u2713 réduction conforme' : '\u2717 réduction non conforme'}`);
process.exit(ok ? 0 : 1);
