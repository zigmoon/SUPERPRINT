/* ══════════════════════════════════════════════════════════════════════════
   validate-path.mjs — la géométrie vectorielle du noyau, mise à l'épreuve.

   Le produit confiait le Pathfinder à Paper.js (235 Ko de bibliothèque tierce).
   Le noyau le calcule. Ce script vérifie ce calcul **sans faire confiance au
   noyau**, et de trois façons indépendantes :

     1. APLATISSEMENT. Le noyau remplace une courbe de Bézier par une polyligne.
        Le script recalcule la courbe de son côté, et vérifie que la polyligne
        ne s'en écarte jamais de plus que la tolérance demandée. C'est une
        borne, pas une impression.
     2. SÉMANTIQUE ENSEMBLISTE. Le noyau rend les anneaux du résultat ; le script
        demande à ce résultat, pour des milliers de points, s'il les contient, et
        compare avec la réponse calculée à partir des DEUX FORMES D'ENTRÉE par la
        définition même de l'opération. C'est ce qu'un Pathfinder doit faire :
        produire la bonne surface, pas un dessin qui y ressemble.
     3. IDENTITÉS D'AIRES. `A∪B + A∩B = A + B`, `A\B = A − A∩B`,
        `A△B = A∪B − A∩B`. Ce sont des égalités exactes, donc des contrôles.
     4. ÉPAISSISSEMENT. Le noyau convertit un trait en **surface**. Le script
        applique **la définition** — l'ensemble des points à une demi-épaisseur
        du tracé, somme de Minkowski d'une polyligne et d'un disque — recalculée
        par force brute, et exige les trois relations de style séparément : le
        rond est égal, l'onglet est plus grand, le biseau plus petit.

   Usage : node scripts/validate-path.mjs
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
  'path_dump.wasm',
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
    '(construire : cargo build -p superprint-path --example path_dump --target wasm32-wasip1 --release)',
  );
  process.exit(2);
}

const dossier = join(racine, 'target', 'path');
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

/* ─────────────────── replis indépendants ───────────────────────────────────
   Tout ce qui suit est écrit ici, sans regarder le Rust. C'est ce qui donne sa
   valeur au contrôle : deux calculs écrits séparément doivent tomber d'accord. */

/** Aire signée d'un anneau (formule du lacet). */
function aire(anneau) {
  let somme = 0;
  for (let i = 0; i < anneau.length; i += 1) {
    const [x1, y1] = anneau[i];
    const [x2, y2] = anneau[(i + 1) % anneau.length];
    somme += x1 * y2 - y1 * x2;
  }
  return somme / 2;
}

/** Nombre d'enroulements d'un anneau autour d'un point. */
function enroulements(anneau, [px, py]) {
  let n = 0;
  for (let i = 0; i < anneau.length; i += 1) {
    const [x1, y1] = anneau[i];
    const [x2, y2] = anneau[(i + 1) % anneau.length];
    if (surSegment(px, py, x1, y1, x2, y2)) return 1;
    const cote = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
    if (y1 <= py) {
      if (y2 > py && cote > 0) n += 1;
    } else if (y2 <= py && cote < 0) n -= 1;
  }
  return n;
}

/** Nombre de croisements d'un rayon partant vers la droite. */
function croisements(anneau, [px, py]) {
  let n = 0;
  for (let i = 0; i < anneau.length; i += 1) {
    const [x1, y1] = anneau[i];
    const [x2, y2] = anneau[(i + 1) % anneau.length];
    if (surSegment(px, py, x1, y1, x2, y2)) return 1;
    if ((y1 > py) !== (y2 > py)) {
      const x = x1 + ((py - y1) / (y2 - y1)) * (x2 - x1);
      if (x > px) n += 1;
    }
  }
  return n;
}

function surSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return px === x1 && py === y1;
  const aire2 = Math.abs(dx * (py - y1) - dy * (px - x1));
  if (aire2 / Math.sqrt(l2) > 1e-9) return false;
  const t = ((px - x1) * dx + (py - y1) * dy) / l2;
  return t >= -1e-9 && t <= 1 + 1e-9;
}

/** Les deux segments se croisent-ils, extrémités comprises ? */
function segmentsCroises(a1, a2, b1, b2) {
  const d1 = (a2[0] - a1[0]) * (b1[1] - a1[1]) - (a2[1] - a1[1]) * (b1[0] - a1[0]);
  const d2 = (a2[0] - a1[0]) * (b2[1] - a1[1]) - (a2[1] - a1[1]) * (b2[0] - a1[0]);
  const d3 = (b2[0] - b1[0]) * (a1[1] - b1[1]) - (b2[1] - b1[1]) * (a1[0] - b1[0]);
  const d4 = (b2[0] - b1[0]) * (a2[1] - b1[1]) - (b2[1] - b1[1]) * (a2[0] - b1[0]);
  if ((d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0)) return true;
  return (
    (d1 === 0 && surSegment(b1[0], b1[1], a1[0], a1[1], a2[0], a2[1])) ||
    (d2 === 0 && surSegment(b2[0], b2[1], a1[0], a1[1], a2[0], a2[1])) ||
    (d3 === 0 && surSegment(a1[0], a1[1], b1[0], b1[1], b2[0], b2[1])) ||
    (d4 === 0 && surSegment(a2[0], a2[1], b1[0], b1[1], b2[0], b2[1]))
  );
}

function dansContour(forme, point) {
  if (forme.regle === 'pairimpair') {
    return forme.anneaux.reduce((n, a) => n + croisements(a, point), 0) % 2 === 1;
  }
  return forme.anneaux.reduce((n, a) => n + enroulements(a, point), 0) !== 0;
}

/** La définition de chaque opération, écrite ici et nulle part ailleurs. */
const OPERATIONS = {
  union: (a, b) => a || b,
  intersection: (a, b) => a && b,
  difference: (a, b) => a && !b,
  exclusion: (a, b) => a !== b,
};

/** Distance d'un point à la fois à toutes les arêtes d'une liste d'anneaux. */
function distanceAuxBords(anneaux, p) {
  let min = Infinity;
  for (const anneau of anneaux) {
    for (let i = 0; i < anneau.length; i += 1) {
      min = Math.min(min, distanceAuSegment(p, anneau[i], anneau[(i + 1) % anneau.length]));
    }
  }
  return min;
}

function distanceAuSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

/** Évaluation d'une cubique, de son côté à lui. */
function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

/* ─────────────────── 1. aplatissement ─────────────────── */

titre('aplatissement : la polyligne reste à moins d’une tolérance de la courbe');

const COURBES = [
  // La cubique symétrique de référence.
  [[0, 0], [0, 100], [100, 100], [100, 0]],
  // Un quart de cercle.
  [[1, 0], [1, 0.5522847498307934], [0.5522847498307934, 1], [0, 1]],
  // Une courbe qui rebrousse.
  [[0, 0], [100, 0], [-100, 0], [0, 0]],
  // Presque une droite : l'aplatissement doit s'arrêter tout de suite.
  [[0, 0], [33, 1], [66, -1], [100, 0]],
  // Une courbe très allongée, où l'espacement des points doit s'adapter.
  [[0, 0], [10, 900], [90, -900], [100, 0]],
];

let piresEcarts = [];
for (const [i, courbe] of COURBES.entries()) {
  for (const tolerance of [1, 0.1, 0.01, 0.001]) {
    const [p0, p1, p2, p3] = courbe;
    const sortie = temporaire(`aplatir-${i}.tsv`);
    lancer('aplatir', ...courbe.flat().map(String), String(tolerance), sortie);
    const points = readFileSync(sortie, 'utf8')
      .trim()
      .split('\n')
      .filter((l) => l.startsWith('point\t'))
      .map((l) => l.split('\t').slice(1).map(Number));
    // Les extrémités sont-elles exactes ?
    if (
      Math.hypot(points[0][0] - p0[0], points[0][1] - p0[1]) > 1e-12 ||
      Math.hypot(
        points[points.length - 1][0] - p3[0],
        points[points.length - 1][1] - p3[1],
      ) > 1e-12
    ) {
      check(`courbe ${i} : extrémités exactes`, false);
    }
    // Écart maximal entre la courbe et la polyligne.
    let ecart = 0;
    for (let k = 0; k <= 4000; k += 1) {
      const p = bezier(p0, p1, p2, p3, k / 4000);
      let d = Infinity;
      for (let s = 0; s + 1 < points.length; s += 1) {
        d = Math.min(d, distanceAuSegment(p, points[s], points[s + 1]));
      }
      ecart = Math.max(ecart, d);
    }
    piresEcarts.push(ecart / tolerance);
    if (ecart > tolerance) {
      check(
        `courbe ${i}, tolérance ${tolerance} : écart ${ecart.toFixed(6)}`,
        false,
        'la polyligne s’écarte plus que demandé',
      );
    }
  }
}
check(
  `les ${piresEcarts.length} aplatissements respectent leur tolérance`,
  piresEcarts.every((r) => r <= 1),
  `pire rapport écart/tolérance : ${Math.max(...piresEcarts).toFixed(4)}`,
);

{
  /* Un contrôle de finesse : diviser la tolérance par dix doit multiplier le
     nombre de points par bien plus que deux. Sans cela, « respecter la
     tolérance » pourrait se contenter d'un découpage fixe très fin. */
  const pointsPour = (tolerance) => {
    const sortie = temporaire('finesse.tsv');
    lancer('aplatir', '0', '0', '0', '100', '100', '100', '100', '0', String(tolerance), sortie);
    return readFileSync(sortie, 'utf8')
      .trim()
      .split('\n')
      .filter((l) => l.startsWith('point\t')).length;
  };
  const gros = pointsPour(1);
  const fin = pointsPour(0.001);
  check(
    'une tolérance plus serrée produit vraiment plus de points',
    fin > gros * 4,
    `${gros} points à 1, ${fin} points à 0,001`,
  );
  check('et l’aplatissement d’une courbe très tendue reste raisonnable', fin < 20000, `${fin} points`);
}

/* ─────────────────── 2. opérations booléennes ─────────────────── */

titre('opérations booléennes : la surface, vérifiée point par point');

const carre = (x, y, c) => [
  [x, y],
  [x + c, y],
  [x + c, y + c],
  [x, y + c],
];
const triangle = (x, y, c) => [
  [x, y],
  [x + c, y],
  [x, y + c],
];
const regulier = (cx, cy, r, cotes) =>
  Array.from({ length: cotes }, (_, i) => {
    const a = (2 * Math.PI * i) / cotes;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });

/* Le corpus : chaque cas est choisi pour ce qu'il met à l'épreuve. */
const CORPUS = [
  { nom: 'carrés décalés en x', A: [carre(0, 0, 10)], B: [carre(5, 0, 10)] },
  { nom: 'carrés décalés en x et y', A: [carre(0, 0, 10)], B: [carre(5, 3, 10)] },
  { nom: 'carré dans un carré', A: [carre(0, 0, 10)], B: [carre(3, 3, 4)] },
  { nom: 'arête partagée', A: [carre(0, 0, 10)], B: [carre(10, 0, 10)] },
  { nom: 'arête partagée, en colonne', A: [carre(0, 0, 10)], B: [carre(0, 10, 10)] },
  { nom: 'coin partagé', A: [carre(0, 0, 10)], B: [carre(10, 10, 10)] },
  { nom: 'formes disjointes', A: [carre(0, 0, 10)], B: [carre(100, 100, 10)] },
  { nom: 'formes identiques', A: [carre(0, 0, 10)], B: [carre(0, 0, 10)] },
  { nom: 'triangles qui se croisent', A: [triangle(0, 0, 10)], B: [triangle(5, 0, 10)] },
  { nom: 'triangles en pointe', A: [triangle(0, 0, 10)], B: [triangle(5, 5, 10)] },
  { nom: 'polygones réguliers', A: [regulier(0, 0, 10, 7)], B: [regulier(6, 3, 8, 5)] },
  { nom: 'étoile sur carré', A: [regulier(5, 5, 12, 9)], B: [carre(2, 2, 12)] },
  { nom: 'grand polygone et petit disque', A: [regulier(0, 0, 20, 32)], B: [regulier(8, 2, 6, 24)] },
  {
    nom: 'forme à deux anneaux',
    A: [carre(0, 0, 20), [...carre(6, 6, 8)].reverse()],
    B: [carre(10, 10, 15)],
  },
  {
    // Deux anneaux d'une MÊME forme qui se chevauchent : c'est ce qu'un `clip`
    // PostScript à plusieurs sous-chemins produit, et c'est le cas qui a révélé
    // que les arêtes d'une forme n'étaient pas découpées à leurs contacts avec
    // les anneaux de cette même forme. La surface, elle, se vérifie comme les
    // autres — point par point, contre la définition.
    nom: 'anneaux qui se chevauchent dans la même forme',
    A: [carre(0, 0, 10), carre(5, 5, 10)],
    B: [carre(-20, -20, 60)],
    // L'aire signée d'une forme dont les anneaux se recouvrent n'est pas l'aire
    // de sa surface : le recouvrement y est compté deux fois. Les identités
    // d'aires, qui reposent sur cette égalité, ne sont donc pas vérifiables ici.
    anneauxSuperposes: true,
  },
  { nom: 'rectangle très allongé', A: [carre(0, 0, 100)], B: [[[40, -5], [60, -5], [60, 5], [40, 5]]] },
];

let pointsVerifies = 0;
let desaccords = 0;
let ignores = 0;
let refusLegitimes = 0;
let refusSuspects = 0;
let identitesJustes = 0;
let identitesTestees = 0;
let identitesEcartees = 0;
let formesSimples = 0;
let resultatsTestes = 0;
let premierDesaccord = '';

/* Générateur déterministe : le même contrôle à chaque exécution. */
let graine = 20260214;
const suivant = () => {
  graine = (graine * 1103515245 + 12345) % 2147483648;
  return graine / 2147483648;
};

for (const cas of CORPUS) {
  const formeA = { anneaux: cas.A, regle: 'nonzero' };
  const formeB = { anneaux: cas.B, regle: 'nonzero' };
  const resultats = {};
  for (const operation of Object.keys(OPERATIONS)) {
    const entree = temporaire('booleen.txt');
    const sortie = temporaire('booleen.tsv');
    const lignes = [];
    for (const [nom, anneaux] of [['A', cas.A], ['B', cas.B]]) {
      for (const anneau of anneaux) {
        lignes.push(`anneau ${nom} ${anneau.flat().join(' ')}`);
      }
      lignes.push(`regle ${nom} nonzero`);
    }
    lignes.push(`op ${operation}`);
    writeFileSync(entree, `${lignes.join('\n')}\n`);
    lancer('booleen', entree, sortie);
    const brut = readFileSync(sortie, 'utf8').trim().split('\n');
    const anneaux = [];
    let aire = null;
    let messageErreur = null;
    for (const ligne of brut) {
      const champs = ligne.split('\t');
      if (champs[0] === 'anneau') {
        const nombre = Number(champs[1]);
        const valeurs = champs[2].trim().split(/\s+/).map(Number);
        const anneau = [];
        for (let i = 0; i < nombre; i += 1) anneau.push([valeurs[2 * i], valeurs[2 * i + 1]]);
        anneaux.push(anneau);
      } else if (champs[0] === 'aire') {
        aire = Number(champs[1]);
      } else if (champs[0] === 'erreur') {
        messageErreur = champs[1];
      }
    }
    resultats[operation] = { anneaux, aire, messageErreur };

    // Une erreur n'est acceptable que si la surface attendue est réellement
    // vide : c'est ce que dit la définition de l'opération.
    if (messageErreur) {
      let surfaceAttendue = false;
      for (let i = 0; i < 3000 && !surfaceAttendue; i += 1) {
        const p = [suivant() * 130 - 20, suivant() * 130 - 20];
        if (OPERATIONS[operation](dansContour(formeA, p), dansContour(formeB, p))) {
          surfaceAttendue = true;
        }
      }
      if (surfaceAttendue) {
        refusSuspects += 1;
        check(`${cas.nom} / ${operation} : refus injustifié`, false, messageErreur);
      } else {
        refusLegitimes += 1;
      }
      continue;
    }

    // Le résultat est-il un vrai contour ? Ses anneaux ne doivent pas se croiser.
    const resultat = { anneaux, regle: 'nonzero' };
    resultatsTestes += 1;
    let simple = true;
    for (const [i, anneau] of anneaux.entries()) {
      for (let j = 0; j < anneau.length && simple; j += 1) {
        for (let k = j + 1; k < anneau.length && simple; k += 1) {
          const voisines = k === j + 1 || (j === 0 && k === anneau.length - 1);
          if (voisines) continue;
          if (
            segmentsCroises(
              anneau[j],
              anneau[(j + 1) % anneau.length],
              anneau[k],
              anneau[(k + 1) % anneau.length],
            )
          ) {
            simple = false;
          }
        }
      }
      void i;
    }
    if (simple) formesSimples += 1;
    else check(`${cas.nom} / ${operation} : anneau auto-intersectant`, false);

    // Le contrôle central : l'appartenance au résultat, contre la définition.
    const points = 4000;
    for (let i = 0; i < points; i += 1) {
      const p = [suivant() * 130 - 20, suivant() * 130 - 20];
      // Un point trop près d'un bord est ambigu : la convention « un point du
      // bord est dedans » décide, et elle n'est pas la même des deux côtés.
      const marge = 1e-6;
      const bords = [
        distanceAuxBords(cas.A, p),
        distanceAuxBords(cas.B, p),
        distanceAuxBords(anneaux, p),
      ];
      if (Math.min(...bords) < marge) {
        ignores += 1;
        continue;
      }
      const attendu = OPERATIONS[operation](dansContour(formeA, p), dansContour(formeB, p));
      const recu = dansContour(resultat, p);
      pointsVerifies += 1;
      if (attendu !== recu) {
        desaccords += 1;
        if (!premierDesaccord) {
          premierDesaccord = `${cas.nom} / ${operation} au point (${p[0].toFixed(3)}, ${p[1].toFixed(3)}) : attendu ${attendu}, obtenu ${recu}`;
        }
      }
    }
  }

  // Identités d'aires, quand les quatre résultats existent.
  const aireDe = (operation) => {
    const r = resultats[operation];
    return r.messageErreur ? 0 : r.aire;
  };
  if (cas.anneauxSuperposes) {
    // Une forme dont deux anneaux se recouvrent a une aire **signée** qui n'est
    // pas l'aire de sa surface : le recouvrement y compte deux fois. Les
    // identités d'aires ne sont donc pas vérifiables ici — la surface, elle,
    // l'est par les points ci-dessus, et c'est la même définition.
    identitesEcartees += 1;
  } else if (resultats.union && resultats.intersection) {
    identitesTestees += 1;
    const somme = aireDe('union') + aireDe('intersection');
    const aireA = cas.A.reduce((s, a) => s + aire(a), 0);
    const aireB = cas.B.reduce((s, a) => s + aire(a), 0);
    const ecart = Math.abs(somme - (aireA + aireB));
    if (ecart > 1e-6 * Math.max(1, aireA + aireB)) {
      check(
        `${cas.nom} : A∪B + A∩B ≠ A + B`,
        false,
        `${somme.toFixed(6)} contre ${(aireA + aireB).toFixed(6)}`,
      );
    } else {
      identitesJustes += 1;
    }
    // A\B = A − A∩B, et A△B = A∪B − A∩B.
    if (resultats.difference) {
      const e = Math.abs(aireDe('difference') - (aireA - aireDe('intersection')));
      if (e > 1e-6 * Math.max(1, aireA)) {
        check(`${cas.nom} : A\\B ≠ A − A∩B`, false, `écart ${e}`);
      } else {
        identitesJustes += 1;
        identitesTestees += 1;
      }
    }
    if (resultats.exclusion) {
      const e = Math.abs(aireDe('exclusion') - (aireDe('union') - aireDe('intersection')));
      if (e > 1e-6 * Math.max(1, aireA + aireB)) {
        check(`${cas.nom} : A△B ≠ A∪B − A∩B`, false, `écart ${e}`);
      } else {
        identitesJustes += 1;
        identitesTestees += 1;
      }
    }
  }
}

console.log(
  `  ${CORPUS.length} paires de formes × 4 opérations — ${resultatsTestes} résultats produits, ${refusLegitimes} refus justifiés, ${refusSuspects} refus injustifiés`,
);
check(
  `la surface du résultat est correcte sur ${pointsVerifies} points`,
  desaccords === 0,
  desaccords === 0
    ? `${ignores} points écartés (à moins d’un millionième d’un bord)`
    : `${desaccords} désaccords — ${premierDesaccord}`,
);
check(
  `tous les résultats produits sont des anneaux simples`,
  formesSimples === resultatsTestes,
  `${formesSimples} / ${resultatsTestes}`,
);
check(
  `les identités d’aires tiennent (${identitesJustes} / ${identitesTestees})`,
  identitesJustes === identitesTestees,
  identitesEcartees
    ? `${identitesEcartees} cas écarté(s) : anneaux d’une même forme qui se recouvrent (l’aire signée n’y est pas l’aire de la surface)`
    : '',
);
check('aucun refus injustifié', refusSuspects === 0);

/* ─────────────────── 3. les refus ─────────────────── */

titre('ce que le noyau refuse, et pourquoi');

function lancerBooleen(entree) {
  const chemin = temporaire('refus.txt');
  const sortie = temporaire('refus.tsv');
  writeFileSync(chemin, entree);
  lancer('booleen', chemin, sortie);
  return readFileSync(sortie, 'utf8');
}

{
  const papillon = lancerBooleen(
    'anneau A 0 0 10 10 10 0 0 10\nanneau B 20 20 30 20 30 30 20 30\nop union\n',
  );
  check(
    'un anneau qui se croise est refusé, et nommé comme tel',
    papillon.includes('erreur') && papillon.includes('auto-intersectant'),
    papillon.trim().split('\n').pop(),
  );
}
{
  const plat = lancerBooleen('anneau A 0 0 5 0 10 0\nanneau B 0 0 10 0 10 10 0 10\nop union\n');
  check(
    'un anneau plat est refusé comme dégénéré',
    plat.includes('erreur') && plat.includes('dégénéré'),
    plat.trim().split('\n').pop(),
  );
}
{
  const disjoints = lancerBooleen(
    'anneau A 0 0 10 0 10 10 0 10\nanneau B 50 50 60 50 60 60 50 60\nop intersection\n',
  );
  check(
    'une intersection vide est refusée plutôt que rendue vide',
    disjoints.includes('erreur') && disjoints.includes('vide'),
    disjoints.trim().split('\n').pop(),
  );
}
{
  const partagee = lancerBooleen(
    'anneau A 0 0 10 0 10 10 0 10\nanneau B 10 0 20 0 20 10 10 10\nop intersection\n',
  );
  check(
    'deux formes qui ne partagent qu’une arête n’ont pas d’intersection de surface',
    partagee.includes('erreur'),
    partagee.trim().split('\n').pop(),
  );
}
{
  const partagee = lancerBooleen(
    'anneau A 0 0 10 0 10 10 0 10\nanneau B 10 0 20 0 20 10 10 10\nop union\n',
  );
  const aireUnion = Number(
    (partagee.split('\n').find((l) => l.startsWith('aire\t')) || '\taire\t0').split('\t')[1],
  );
  check(
    'et leur union vaut bien la somme des deux surfaces',
    Math.abs(aireUnion - 200) < 1e-9,
    `aire ${aireUnion}`,
  );
}
{
  /* Une entrée illisible doit être refusée, pas devinée. */
  let refuse = false;
  try {
    lancerBooleen('anneau A 0 0 10 0 10 10 0\nop union\n');
  } catch (e) {
    refuse = true;
  }
  check('un anneau à coordonnées impaires est refusé', refuse);
}

/* ══════════════════════════════════════════════════════════════════════════
   L'ÉPAISSISSEMENT D'UN TRAIT : de la ligne à la surface.

   Un trait n'est pas une surface : c'est une polyligne et une épaisseur. Le
   noyau le convertit. Le script ne croit aucune de ses affirmations, et
   applique **la définition** : le trait est l'ensemble des points situés à une
   distance inférieure ou égale à une demi-épaisseur du tracé — la somme de
   Minkowski d'une polyligne et d'un disque. Cette définition est recalculée ici
   par force brute, sans rien savoir de l'algorithme.

   Elle dit aussi ce que chaque style vaut, et le script exige les trois
   relations, séparément : le rond est **égal**, l'onglet est **plus grand**
   (il ajoute le coin), le biseau et le bout sont **plus petits**.
   ══════════════════════════════════════════════════════════════════════════ */

titre('épaississement : la définition (distance au tracé) recalculée point par point');

/** Distance d'un point au segment `[a, b]`. */
function distanceSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const norme = dx * dx + dy * dy;
  if (norme === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / norme));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Distance d'un point à une polyligne — la définition, écrite à part. */
function distanceAuTrace(p, sousChemins, fermes) {
  let pire = Infinity;
  sousChemins.forEach((chemin, rang) => {
    const n = chemin.length;
    const nombre = fermes[rang] ? n : n - 1;
    for (let i = 0; i < nombre; i += 1) {
      pire = Math.min(pire, distanceSegment(p, chemin[i], chemin[(i + 1) % n]));
    }
  });
  return pire;
}

/** Lance le noyau sur un trait décrit, et lit sa surface. */
function lancerEpaissir(description) {
  const entree = temporaire('trait.txt');
  writeFileSync(entree, description, 'ascii');
  const sortie = temporaire('trait.tsv');
  lancer('epaissir', entree, sortie);
  const tsv = readFileSync(sortie, 'utf8');
  const resultat = { erreur: null, aire: null, anneaux: [] };
  for (const ligne of tsv.split('\n')) {
    if (!ligne) continue;
    const champs = ligne.split('\t');
    if (champs[0] === 'erreur') resultat.erreur = champs[1];
    if (champs[0] === 'aire') resultat.aire = Number.parseFloat(champs[1]);
    if (champs[0] === 'anneau') {
      const nombres = champs[2].split(' ').map(Number);
      const anneau = [];
      for (let i = 0; i + 1 < nombres.length; i += 2) anneau.push([nombres[i], nombres[i + 1]]);
      resultat.anneaux.push(anneau);
    }
  }
  return resultat;
}

/** Un point est-il dans la surface rendue ? (règle non nulle, comme le noyau) */
function contient(resultat, p) {
  if (!resultat.anneaux.length) return false;
  return resultat.anneaux.reduce((n, anneau) => n + enroulements(anneau, p), 0) !== 0;
}

// ── 1. Les aires connues par construction ────────────────────────────────────

const AIRES = [
  {
    nom: 'un segment, bout plat : longueur × épaisseur',
    description: 'souschemin ouvert 0 0 10 0\nepaisseur 2\nextremite bout\n',
    attendue: 20,
  },
  {
    nom: 'un segment, bout carré : + deux demi-carrés',
    description: 'souschemin ouvert 0 0 10 0\nepaisseur 2\nextremite carre\n',
    attendue: 24,
  },
  {
    nom: 'un segment, bout rond : + un disque',
    description: 'souschemin ouvert 0 0 10 0\nepaisseur 2\nextremite rond\ntolerance 0.002\n',
    attendue: 20 + Math.PI,
    relatif: 0.002,
  },
  {
    nom: 'un carré fermé, onglets : (10+2)² − (10−2)²',
    description: 'souschemin ferme 0 0 10 0 10 10 0 10\nepaisseur 2\n',
    attendue: 80,
  },
  {
    nom: 'un carré fermé, jonctions rondes : quatre quarts de disque en moins',
    description:
      'souschemin ferme 0 0 10 0 10 10 0 10\nepaisseur 2\njonction rond\ntolerance 0.002\n',
    attendue: 80 - 4 + Math.PI,
    relatif: 0.002,
  },
  {
    nom: 'un carré fermé, biseaux : un triangle de ½ coupé à chaque coin',
    // Le biseau relie les deux points décalés directement : le coin perdu est
    // le triangle rectangle de côtés `h`, soit `h²/2 = 0,5` par coin. La surface
    // vaut donc 80 − 4×0,5 = 78, **exactement** — c'est un attendu que j'avais
    // d'abord écrit faux (77,657), et la mesure l'a corrigé.
    description:
      'souschemin ferme 0 0 10 0 10 10 0 10\nepaisseur 2\njonction biseau\ntolerance 0.002\n',
    attendue: 80 - 4 * 0.5,
  },
];

for (const cas of AIRES) {
  const resultat = lancerEpaissir(cas.description);
  const aire = Math.abs(resultat.aire ?? NaN);
  const relatif = cas.relatif ?? 1e-9;
  const ecart = Math.abs(aire - cas.attendue) / cas.attendue;
  check(
    `${cas.nom} — ${cas.attendue.toFixed(3)}`,
    resultat.erreur === null && ecart <= relatif,
    resultat.erreur ?? `noyau ${aire.toFixed(3)} (écart relatif ${ecart.toExponential(2)})`,
  );
}

// ── 2. La définition, point par point ────────────────────────────────────────

const DEFINITIONS = [
  {
    nom: 'jonctions et extrémités RONDES : égalité stricte',
    description:
      'souschemin ouvert 0 0 10 0 10 10\nepaisseur 2\njonction rond\nextremite rond\ntolerance 0.002\n',
    chemins: [[[0, 0], [10, 0], [10, 10]]],
    fermes: [false],
    relation: 'egal',
  },
  {
    nom: 'onglet (limite infinie) et bouts ronds : rien ne manque, le coin est ajouté',
    description:
      'souschemin ouvert 0 0 10 0 10 10\nepaisseur 2\njonction onglet\nmiterlimite infini\nextremite rond\ntolerance 0.002\n',
    chemins: [[[0, 0], [10, 0], [10, 10]]],
    fermes: [false],
    relation: 'surensemble',
  },
  {
    nom: 'biseau et bouts plats : rien n’est ajouté hors du trait',
    description:
      'souschemin ouvert 0 0 10 0 10 10\nepaisseur 2\njonction biseau\nextremite bout\ntolerance 0.002\n',
    chemins: [[[0, 0], [10, 0], [10, 10]]],
    fermes: [false],
    relation: 'sousensemble',
  },
  {
    nom: 'carré fermé, jonctions rondes : égalité stricte sur une forme fermée',
    description:
      'souschemin ferme -30 -20 30 -20 30 20 -30 20\nepaisseur 5\njonction rond\ntolerance 0.002\n',
    chemins: [[[-30, -20], [30, -20], [30, 20], [-30, 20]]],
    fermes: [true],
    relation: 'egal',
  },
];

for (const cas of DEFINITIONS) {
  const resultat = lancerEpaissir(cas.description);
  if (resultat.erreur !== null) {
    check(`${cas.nom}`, false, `refusé : ${resultat.erreur}`);
    continue;
  }
  const h = 1 * Number((cas.description.match(/epaisseur (\S+)/) || [, '1'])[1]) / 2;
  // La boîte d'échantillonnage : celle du tracé, élargie de `h` plus l'onglet.
  const points = cas.chemins.flat();
  const minX = Math.min(...points.map((p) => p[0])) - h - 3;
  const maxX = Math.max(...points.map((p) => p[0])) + h + 3;
  const minY = Math.min(...points.map((p) => p[1])) - h - 3;
  const maxY = Math.max(...points.map((p) => p[1])) + h + 3;
  const pas = 0.05;
  let examines = 0;
  let manquants = 0;
  let ajoutes = 0;
  let exemple = '';
  for (let x = minX; x <= maxX; x += pas) {
    for (let y = minY; y <= maxY; y += pas) {
      const p = [x, y];
      const distance = distanceAuTrace(p, cas.chemins, cas.fermes);
      // On ne teste pas la frontière : c'est un cas de mesure, pas de géométrie.
      if (Math.abs(distance - h) < 2 * pas) continue;
      examines += 1;
      const dedans = contient(resultat, p);
      const attendu = distance < h;
      if (attendu && !dedans) {
        manquants += 1;
        if (!exemple) exemple = `(${x.toFixed(2)}, ${y.toFixed(2)})`;
      }
      if (!attendu && dedans) {
        ajoutes += 1;
        if (!exemple) exemple = `(${x.toFixed(2)}, ${y.toFixed(2)})`;
      }
    }
  }
  const verdict =
    cas.relation === 'egal'
      ? manquants === 0 && ajoutes === 0
      : cas.relation === 'surensemble'
        ? manquants === 0
        : ajoutes === 0;
  check(
    `${cas.nom} (${examines} points)`,
    verdict,
    verdict
      ? cas.relation === 'egal'
        ? 'aucun désaccord'
        : `${cas.relation === 'surensemble' ? ajoutes : 0} point(s) ajouté(s), 0 manquant`
        : `${manquants} manquant(s), ${ajoutes} ajouté(s) — premier ${exemple}`,
  );
}

// ── 3. Ce qui ne se convertit pas est refusé en le nommant ───────────────────

{
  const impossible = lancerEpaissir(
    'souschemin ouvert 0 0 10 0 2 0.5\nepaisseur 2\nmiterlimite infini\n',
  );
  check(
    'un bord replié qui se recoupe est refusé, avec la raison',
    impossible.erreur !== null && impossible.erreur.includes('recoupe'),
    impossible.erreur ?? 'AUCUN REFUS',
  );
  const nulle = lancerEpaissir('souschemin ouvert 0 0 10 0\nepaisseur 0\n');
  check(
    'une épaisseur nulle est refusée plutôt que rendue plate',
    nulle.erreur !== null && nulle.erreur.includes('épaisseur'),
    nulle.erreur ?? 'AUCUN REFUS',
  );
}

console.log(
  `\n${ok ? 'OK : la géométrie du noyau produit la bonne surface, et refuse ce qui n’en a pas.' : 'ÉCHEC : voir les lignes \u2717 ci-dessus.'}`,
);
process.exit(ok ? 0 : 1);
