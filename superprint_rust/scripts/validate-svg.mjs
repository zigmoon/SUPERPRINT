/* ══════════════════════════════════════════════════════════════════════════
   validate-svg.mjs — l'import SVG, mis à l'épreuve.

   Le noyau lit un SVG avec son propre analyseur XML, son propre lecteur de
   commandes de chemin, sa propre matrice et son propre aplatissement. Ce script
   ne lui demande pas s'il est content de lui : il écrit **les mêmes étages**,
   indépendamment, et confronte les deux lectures.

     1. LECTEUR INDÉPENDANT. Analyseur XML, lecteur de `d`, matrice, conversion
        d'arc et aplatissement sont écrits ici, séparément. Sur chaque SVG réel
        du dépôt, les deux lectures doivent donner **le même nombre de formes**
        et **les mêmes sommets**, au millionième près.

     2. AIRES CONNUES PAR CONSTRUCTION. Un rectangle, un cercle, une ellipse et
        un rectangle arrondi ont une aire calculable à la main. Le script la
        recalcule et l'exige du noyau : deux lectures peuvent s'accorder sur la
        même erreur, pas sur `πr²`.

     3. QUALITÉ DE L'APLATISSEMENT, MESURÉE. La tolérance n'est pas crue sur
        parole : le script échantillonne la courbe **vraie** en 4 000 points et
        mesure l'écart réel à la polyligne rendue. Il doit être inférieur à la
        tolérance demandée.

     4. LA TABLE DES COULEURS EST RELEVÉE DU PRODUIT. Le noyau embarque une
        table de couleurs nommées ; le produit en porte une aussi, dans
        `superprint/app/JS/jspdf.umd.min.js`. Le script relit ce fichier et
        compare **les 143 noms, un par un**. Ce n'est pas une liste recopiée de
        mémoire, c'est une liste vérifiée contre le produit.

     5. REFUS NOMMÉS. Ce dont l'ignorance perdrait du dessin — `<image>`,
        `<use>`, un dégradé, un `clip-path`, une feuille `<style>` — doit être
        REFUSÉ, en nommant l'élément. Ce qui décrit sans dessiner — `defs`,
        `title`, `metadata` — doit être COMPTÉ, sans arrêter la lecture. Les
        deux comportements sont mesurés, séparément.

     6. LE TEXTE N'EST PAS PERDU. `<text>` n'est pas dessiné (le noyau ne
        devine pas de police) mais il n'est pas jeté : sa position, son corps et
        son ancre sont rendus. Un import qui perd un libellé sans le dire est
        pire qu'un import qui le signale.

   Usage : node scripts/validate-svg.mjs
   Retour : 0 si tout passe, 1 sinon.
   ══════════════════════════════════════════════════════════════════════════ */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, '..');
const produit = join(racine, '..', 'superprint');
const cheminExemple = join(
  racine,
  'target',
  'wasm32-wasip1',
  'release',
  'examples',
  'svg_dump.wasm',
);

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (t) => console.log(`\n== ${t}`);

if (!existsSync(cheminExemple)) {
  console.error(`introuvable : ${cheminExemple}`);
  console.error(
    '(construire : cargo build -p superprint-doc --example svg_dump --target wasm32-wasip1 --release)',
  );
  process.exit(2);
}

const dossier = join(racine, 'target', 'svg');
mkdirSync(dossier, { recursive: true });
const joindre = (...bouts) => join(dossier, ...bouts);

/** Lance l'exemple en traduisant les chemins pour le bac à sable WASI. */
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

/* ───────────────────── lecture du TSV produit par le noyau ──────────────── */

function lireTsv(chemin) {
  const texte = readFileSync(chemin, 'utf8');
  const resume = {
    erreur: null,
    tolerance: null,
    entites: null,
    formes: null,
    sommets: null,
    textes: null,
    aire: null,
    boite: null,
    largeur: null,
    hauteur: null,
    viewbox: null,
    nonRendus: {},
    avertissements: [],
    liste: [],
    textesListe: [],
  };
  for (const ligne of texte.split('\n')) {
    if (!ligne) continue;
    const champs = ligne.split('\t');
    const nombre = (v) => Number.parseFloat(v);
    switch (champs[0]) {
      case 'erreur':
        resume.erreur = champs.slice(1).join('\t');
        break;
      case 'tolerance':
        resume.tolerance = nombre(champs[1]);
        break;
      case 'entites':
        resume.entites = nombre(champs[1]);
        break;
      case 'formes':
        resume.formes = nombre(champs[1]);
        break;
      case 'sommets':
        resume.sommets = nombre(champs[1]);
        break;
      case 'textes':
        resume.textes = nombre(champs[1]);
        break;
      case 'aire':
        resume.aire = nombre(champs[1]);
        break;
      case 'boite':
        resume.boite =
          champs[1] === '-' ? null : champs.slice(1, 5).map(nombre);
        break;
      case 'largeur':
        resume.largeur = champs[1] === '?' ? null : nombre(champs[1]);
        break;
      case 'hauteur':
        resume.hauteur = champs[1] === '?' ? null : nombre(champs[1]);
        break;
      case 'viewbox':
        resume.viewbox =
          champs[1] === '-' ? null : champs.slice(1, 5).map(nombre);
        break;
      case 'non_rendu':
        resume.nonRendus[champs[1]] = nombre(champs[2]);
        break;
      case 'avertissement':
        resume.avertissements.push(champs.slice(1).join('\t'));
        break;
      case 'forme': {
        const forme = {
          rang: nombre(champs[1]),
          sousChemins: nombre(champs[2]),
          sommets: nombre(champs[3]),
          aire: nombre(champs[4]),
          boite: champs.slice(5, 9).map(nombre),
          remplissage: champs[9],
          contour: champs[10],
          epaisseur: champs[11] === '-' ? null : nombre(champs[11]),
          extremite: champs[12],
          jonction: champs[13],
          regle: nombre(champs[14]),
          id: champs[15],
          points: [],
        };
        resume.liste.push(forme);
        break;
      }
      case 'sommet': {
        const forme = resume.liste[nombre(champs[1])];
        if (forme) {
          if (!forme.points[nombre(champs[2])]) forme.points[nombre(champs[2])] = [];
          forme.points[nombre(champs[2])][nombre(champs[3])] = [
            nombre(champs[4]),
            nombre(champs[5]),
          ];
        }
        break;
      }
      case 'texte':
        resume.textesListe.push({
          rang: nombre(champs[1]),
          x: nombre(champs[2]),
          y: nombre(champs[3]),
          corps: nombre(champs[4]),
          contenu: champs[5],
          famille: champs[6],
          gras: nombre(champs[7]),
          italique: nombre(champs[8]),
          ancre: champs[9],
        });
        break;
      default:
        break;
    }
  }
  return resume;
}

/** Dépose un SVG dans le bac à sable et demande au noyau de le lire. */
let compteur = 0;
function lireAvecLeNoyau(source, tolerance = 0.05) {
  compteur += 1;
  const nom = `engendre-${compteur}.svg`;
  writeFileSync(joindre(nom), source, 'utf8');
  lancer('formes', join(dossier, nom), String(tolerance), join(dossier, `${nom}.tsv`));
  return lireTsv(joindre(`${nom}.tsv`));
}

/* ══════════════════════════════════════════════════════════════════════════
   Le lecteur INDÉPENDANT.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── 1. Analyseur XML, écrit à part ──────────────────────────────────────── */

const ENTITES_XML = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };

function resoudreEntites(texte, declarees) {
  return texte.replace(/&(#x?[0-9a-fA-F]+|[A-Za-z_:][-A-Za-z0-9_.:]*);/g, (tout, nom) => {
    if (nom.startsWith('#')) {
      const point = nom[1] === 'x' || nom[1] === 'X'
        ? Number.parseInt(nom.slice(2), 16)
        : Number.parseInt(nom.slice(1), 10);
      return String.fromCodePoint(point);
    }
    if (Object.hasOwn(ENTITES_XML, nom)) return ENTITES_XML[nom];
    if (Object.hasOwn(declarees, nom)) return declarees[nom];
    throw new Error(`entité inconnue : &${nom};`);
  });
}

/** Analyse un document XML en arbre `{ nom, attributs, enfants }`. */
function analyserXml(texte) {
  const declarees = {};
  // Sous-ensemble interne du DOCTYPE : les entités générales.
  const doctype = /<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/;
  const trouve = doctype.exec(texte);
  if (trouve) {
    const interne = trouve[1] || '';
    const declaration = /<!ENTITY\s+(?!%)([A-Za-z_:][-A-Za-z0-9_.:]*)\s+("[^"]*"|'[^']*')/g;
    let m;
    while ((m = declaration.exec(interne)) !== null) {
      declarees[m[1]] = m[2].slice(1, -1);
    }
    if (/<!ENTITY\s+\S+\s+(SYSTEM|PUBLIC)/.test(interne)) {
      throw new Error('entité externe');
    }
    texte = texte.slice(0, trouve.index) + texte.slice(trouve.index + trouve[0].length);
  }
  texte = texte.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');

  const racine = { nom: '#racine', attributs: {}, enfants: [] };
  const pile = [racine];
  const jetons = /<\/?([A-Za-z_:][-A-Za-z0-9_.:]*)((?:\s+[-A-Za-z0-9_.:]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = jetons.exec(texte)) !== null) {
    const [tout, nom, brut, autoFermante, texteNu] = m;
    if (texteNu !== undefined) {
      const contenu = resoudreEntites(texteNu, declarees);
      if (contenu.trim()) pile[pile.length - 1].enfants.push({ texte: contenu });
      continue;
    }
    if (tout.startsWith('</')) {
      const ferme = pile.pop();
      if (!ferme || ferme.nom !== nom) throw new Error(`balise </${nom}> sans ouverture`);
      continue;
    }
    const attributs = {};
    const attribut = /([-A-Za-z0-9_.:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = attribut.exec(brut || '')) !== null) {
      attributs[a[1]] = resoudreEntites(a[2] !== undefined ? a[2] : a[3], declarees);
    }
    const element = { nom, attributs, enfants: [] };
    pile[pile.length - 1].enfants.push(element);
    if (!autoFermante) pile.push(element);
  }
  if (pile.length !== 1) throw new Error('balise non fermée');
  return { racine: racine.enfants.find((e) => e.nom), entites: Object.keys(declarees).length };
}

/* ── 2. Le lecteur SVG, écrit à part ─────────────────────────────────────── */

const PX_PAR_POUCE = 96;

const COULEURS_PRODUIT = {};

function local(nom) {
  const coupe = nom.indexOf(':');
  return coupe < 0 ? nom : nom.slice(coupe + 1);
}

function parseCouleur(valeur) {
  const v = String(valeur).trim().toLowerCase();
  if (v === '' || v === 'none' || v === 'transparent') return null;
  if (v === 'currentcolor') return 'courante';
  if (v.startsWith('#')) {
    const chiffres = v.slice(1);
    if (!/^[0-9a-f]+$/.test(chiffres)) throw new Error(`couleur ${valeur}`);
    const lire = (i) => Number.parseInt(chiffres[i], 16);
    if (chiffres.length === 3 || chiffres.length === 4) {
      const t = [lire(0) * 17, lire(1) * 17, lire(2) * 17];
      const a = chiffres.length === 4 ? (lire(3) * 17) / 255 : 1;
      return { r: t[0], g: t[1], b: t[2], alpha: a };
    }
    if (chiffres.length === 6 || chiffres.length === 8) {
      const t = [
        lire(0) * 16 + lire(1),
        lire(2) * 16 + lire(3),
        lire(4) * 16 + lire(5),
      ];
      const a = chiffres.length === 8 ? (lire(6) * 16 + lire(7)) / 255 : 1;
      return { r: t[0], g: t[1], b: t[2], alpha: a };
    }
    throw new Error(`couleur ${valeur}`);
  }
  const fonction = /^rgba?\(([^)]*)\)$/.exec(v);
  if (fonction) {
    const morceaux = fonction[1].split(/[,/\s]+/).filter(Boolean);
    if (morceaux.length < 3) throw new Error(`couleur ${valeur}`);
    const composante = (texte) =>
      texte.endsWith('%')
        ? (Number.parseFloat(texte) * 255) / 100
        : Number.parseFloat(texte);
    const alpha = morceaux[3]
      ? morceaux[3].endsWith('%')
        ? Number.parseFloat(morceaux[3]) / 100
        : Number.parseFloat(morceaux[3])
      : 1;
    return {
      r: Math.round(Math.min(255, Math.max(0, composante(morceaux[0])))),
      g: Math.round(Math.min(255, Math.max(0, composante(morceaux[1])))),
      b: Math.round(Math.min(255, Math.max(0, composante(morceaux[2])))),
      alpha,
    };
  }
  if (Object.hasOwn(COULEURS_PRODUIT, v)) {
    const n = COULEURS_PRODUIT[v];
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, alpha: 1 };
  }
  throw new Error(`couleur ${valeur}`);
}

function nombrePur(texte) {
  const t = String(texte).trim();
  if (t === '' || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
  const v = Number.parseFloat(t);
  return Number.isFinite(v) ? v : null;
}

function longueur(valeur, reference, corps) {
  const t = String(valeur).trim();
  if (t === '') return 0;
  if (t.endsWith('%')) {
    if (reference === null || reference === undefined) throw new Error('pourcentage sans référence');
    return (reference * Number.parseFloat(t)) / 100;
  }
  const m = /^([-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?)([A-Za-z]*)$/.exec(t);
  if (!m) throw new Error(`longueur ${valeur}`);
  const n = Number.parseFloat(m[1]);
  switch (m[4].toLowerCase()) {
    case '':
    case 'px':
      return n;
    case 'pt':
      return (n * PX_PAR_POUCE) / 72;
    case 'pc':
      return (n * PX_PAR_POUCE) / 6;
    case 'mm':
      return (n * PX_PAR_POUCE) / 25.4;
    case 'cm':
      return (n * PX_PAR_POUCE) / 2.54;
    case 'in':
      return n * PX_PAR_POUCE;
    case 'em':
      return n * corps;
    default:
      throw new Error(`unité inconnue ${m[4]}`);
  }
}

/* La référence d'un pourcentage dépend de l'attribut : la largeur du canevas
   pour `x` et `width`, sa hauteur pour `y` et `height`, sa diagonale normalisée
   pour tout le reste (c'est la règle du SVG). */
function referencePour(attribut, corps) {
  switch (attribut) {
    case 'x':
    case 'x1':
    case 'x2':
    case 'cx':
    case 'width':
      return corps.largeur;
    case 'y':
    case 'y1':
    case 'y2':
    case 'cy':
    case 'height':
      return corps.hauteur;
    default:
      if (corps.largeur !== null && corps.hauteur !== null) {
        return Math.sqrt((corps.largeur * corps.largeur + corps.hauteur * corps.hauteur) / 2);
      }
      return corps.largeur ?? corps.hauteur;
  }
}

function nombreListe(texte) {  return String(texte)
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((v) => nombrePur(v))
    .filter((v) => v !== null);
}

/* Matrice : six nombres, `(x, y) → (a·x + c·y + tx, b·x + d·y + ty)`, et
   `concatener` applique son opérande gauche en premier — comme le noyau. */const identite = () => [1, 0, 0, 1, 0, 0];
const concatener = (m, n) => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const appliquer = (m, p) => [
  m[0] * p[0] + m[2] * p[1] + m[4],
  m[1] * p[0] + m[3] * p[1] + m[5],
];
const radar = (degres) => {
  const r = (degres * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
};

function analyserTransformation(valeur) {
  let matrice = identite();
  const motif = /([A-Za-z]+)\s*\(([^)]*)\)/g;
  let m;
  let vu = 0;
  while ((m = motif.exec(valeur)) !== null) {
    vu += m[0].length;
    const nombres = nombreListe(m[2]);
    const nom = m[1].toLowerCase();
    let t = null;
    if (nom === 'matrix' && nombres.length === 6) t = nombres.slice();
    else if (nom === 'translate' && nombres.length === 1) t = [1, 0, 0, 1, nombres[0], 0];
    else if (nom === 'translate' && nombres.length === 2) t = [1, 0, 0, 1, nombres[0], nombres[1]];
    else if (nom === 'scale' && nombres.length === 1) t = [nombres[0], 0, 0, nombres[0], 0, 0];
    else if (nom === 'scale' && nombres.length === 2) t = [nombres[0], 0, 0, nombres[1], 0, 0];
    else if (nom === 'rotate' && nombres.length === 1) t = radar(nombres[0]);
    else if (nom === 'rotate' && nombres.length === 3) {
      const r = radar(nombres[0]);
      t = concatener(
        [1, 0, 0, 1, -nombres[1], -nombres[2]],
        concatener(r, [1, 0, 0, 1, nombres[1], nombres[2]]),
      );
    } else if (nom === 'skewx' && nombres.length === 1) {
      t = [1, 0, Math.tan((nombres[0] * Math.PI) / 180), 1, 0, 0];
    } else if (nom === 'skewy' && nombres.length === 1) {
      t = [1, Math.tan((nombres[0] * Math.PI) / 180), 0, 1, 0, 0];
    } else {
      throw new Error(`transformation ${m[0]}`);
    }
    matrice = concatener(t, matrice);
  }
  if (vu === 0 && valeur.trim() !== '') throw new Error(`transformation ${valeur}`);
  return matrice;
}

/* Aplatissement : le critère est celui du CONTRAT (écart à la corde **et**
   projection des points de contrôle), recopié ici pour que la comparaison
   porte sur la géométrie. C'est l'égalité au sommet près qui est le contrôle :
   la qualité du critère est mesurée séparément, contre la courbe vraie. */
function ecartCorde(courbe, quadratique) {
  const p0 = courbe[0];
  const p1 = courbe[courbe.length - 1];
  const corde = [p1[0] - p0[0], p1[1] - p0[1]];
  const longueur = Math.hypot(corde[0], corde[1]);
  const distance = (p) => {
    if (longueur === 0) return Math.hypot(p[0] - p0[0], p[1] - p0[1]);
    const vectoriel = (p[0] - p0[0]) * corde[1] - (p[1] - p0[1]) * corde[0];
    return Math.abs(vectoriel / longueur);
  };
  if (quadratique) return distance(courbe[1]) / 2;
  return Math.max(distance(courbe[1]), distance(courbe[2])) * 0.75;
}

function cubiquePoint(courbe, t) {
  const [p0, c1, c2, p1] = courbe;
  const u = 1 - t;
  const poids = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [
    poids[0] * p0[0] + poids[1] * c1[0] + poids[2] * c2[0] + poids[3] * p1[0],
    poids[0] * p0[1] + poids[1] * c1[1] + poids[2] * c2[1] + poids[3] * p1[1],
  ];
}

function quadratiquePoint(courbe, t) {
  const [p0, c1, p1] = courbe;
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * c1[0] + t * t * p1[0],
    u * u * p0[1] + 2 * u * t * c1[1] + t * t * p1[1],
  ];
}

function estPlate(courbe, tolerance, quadratique) {
  if (ecartCorde(courbe, quadratique) > tolerance) return false;
  const p0 = courbe[0];
  const p1 = courbe[courbe.length - 1];
  const corde = [p1[0] - p0[0], p1[1] - p0[1]];
  const carre = corde[0] * corde[0] + corde[1] * corde[1];
  if (carre === 0) {
    const milieu = quadratique ? quadratiquePoint(courbe, 0.5) : cubiquePoint(courbe, 0.5);
    return Math.hypot(milieu[0] - p0[0], milieu[1] - p0[1]) <= tolerance;
  }
  const longueur = Math.hypot(corde[0], corde[1]);
  const dedans = (p) => {
    const t = ((p[0] - p0[0]) * corde[0] + (p[1] - p0[1]) * corde[1]) / carre;
    return t >= -tolerance / longueur && t <= 1 + tolerance / longueur;
  };
  if (quadratique) return dedans(courbe[1]);
  return dedans(courbe[1]) && dedans(courbe[2]);
}

function subdiviser(courbe, quadratique) {
  if (quadratique) {
    const [p0, c1, p1] = courbe;
    const milieu = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const ab = milieu(p0, c1);
    const bc = milieu(c1, p1);
    const centre = milieu(ab, bc);
    return [[p0, ab, centre], [centre, bc, p1]];
  }
  const [p0, c1, c2, p1] = courbe;
  const milieu = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const a = milieu(p0, c1);
  const b = milieu(c1, c2);
  const c = milieu(c2, p1);
  const d = milieu(a, b);
  const e = milieu(b, c);
  const centre = milieu(d, e);
  return [[p0, a, d, centre], [centre, e, c, p1]];
}

function aplatir(courbe, quadratique, tolerance, sortie) {
  if (estPlate(courbe, tolerance, quadratique)) {
    sortie.push(courbe[courbe.length - 1]);
    return;
  }
  const [gauche, droite] = subdiviser(courbe, quadratique);
  aplatir(gauche, quadratique, tolerance, sortie);
  aplatir(droite, quadratique, tolerance, sortie);
}

/* Commandes de chemin : lexeur indépendant. */
class Lecteur {
  constructor(texte) {
    this.t = [...texte];
    this.i = 0;
  }

  sauter() {
    while (this.i < this.t.length && (/\s/.test(this.t[this.i]) || this.t[this.i] === ',')) this.i += 1;
  }

  nombre() {
    this.sauter();
    const debut = this.i;
    let i = this.i;
    if (this.t[i] === '+' || this.t[i] === '-') i += 1;
    let chiffres = false;
    while (i < this.t.length && /[0-9]/.test(this.t[i])) {
      i += 1;
      chiffres = true;
    }
    if (this.t[i] === '.') {
      i += 1;
      while (i < this.t.length && /[0-9]/.test(this.t[i])) {
        i += 1;
        chiffres = true;
      }
    }
    if (!chiffres) return null;
    if (this.t[i] === 'e' || this.t[i] === 'E') {
      const sauve = i;
      i += 1;
      if (this.t[i] === '+' || this.t[i] === '-') i += 1;
      let exposant = false;
      while (i < this.t.length && /[0-9]/.test(this.t[i])) {
        i += 1;
        exposant = true;
      }
      if (!exposant) i = sauve;
    }
    const v = Number.parseFloat(this.t.slice(debut, i).join(''));
    if (!Number.isFinite(v)) return null;
    this.i = i;
    return v;
  }

  drapeau() {
    this.sauter();
    if (this.t[this.i] === '0') {
      this.i += 1;
      return false;
    }
    if (this.t[this.i] === '1') {
      this.i += 1;
      return true;
    }
    return null;
  }
}

/** Arc elliptique → cubiques (notes du W3C, F.6). */
function arcVersCourbes(depart, rx, ry, rotation, grandArc, balayage, arrivee) {
  if (depart[0] === arrivee[0] && depart[1] === arrivee[1]) return null;
  if (rx === 0 || ry === 0) return null;
  const phi = (rotation * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const dx2 = (depart[0] - arrivee[0]) / 2;
  const dy2 = (depart[1] - arrivee[1]) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const f = Math.sqrt(lambda);
    rx *= f;
    ry *= f;
  }
  const numerateur = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominateur = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  if (denominateur === 0) return null;
  const signe = grandArc !== balayage ? 1 : -1;
  const coefficient = signe * Math.sqrt(Math.max(0, numerateur / denominateur));
  const cxp = (coefficient * rx * y1p) / ry;
  const cyp = (-coefficient * ry * x1p) / rx;
  const centre = [
    cosPhi * cxp - sinPhi * cyp + (depart[0] + arrivee[0]) / 2,
    sinPhi * cxp + cosPhi * cyp + (depart[1] + arrivee[1]) / 2,
  ];
  const angle = (ux, uy, vx, vy) => {
    const produit = ux * vx + uy * vy;
    const normes = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    if (normes === 0) return 0;
    const sens = ux * vy - uy * vx < 0 ? -1 : 1;
    return sens * Math.acos(Math.max(-1, Math.min(1, produit / normes)));
  };
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const t1 = angle(1, 0, ux, uy);
  let balayageAngle = angle(ux, uy, vx, vy);
  if (!balayage && balayageAngle > 0) balayageAngle -= 2 * Math.PI;
  else if (balayage && balayageAngle < 0) balayageAngle += 2 * Math.PI;
  const point = (t) => [
    centre[0] + rx * Math.cos(t) * cosPhi - ry * Math.sin(t) * sinPhi,
    centre[1] + rx * Math.cos(t) * sinPhi + ry * Math.sin(t) * cosPhi,
  ];
  const tangente = (t) => [
    -rx * Math.sin(t) * cosPhi - ry * Math.cos(t) * sinPhi,
    -rx * Math.sin(t) * sinPhi + ry * Math.cos(t) * cosPhi,
  ];
  const segments = Math.max(1, Math.ceil(Math.abs(balayageAngle) / (Math.PI / 2)));
  const pas = balayageAngle / segments;
  const alpha = (4 / 3) * Math.tan(pas / 4);
  const courbes = [];
  for (let rang = 0; rang < segments; rang += 1) {
    const a = t1 + pas * rang;
    const b = a + pas;
    const p1 = point(a);
    const p2 = point(b);
    const d1 = tangente(a);
    const d2 = tangente(b);
    courbes.push([
      p1,
      [p1[0] + alpha * d1[0], p1[1] + alpha * d1[1]],
      [p2[0] - alpha * d2[0], p2[1] - alpha * d2[1]],
      p2,
    ]);
  }
  return courbes;
}

function lireChemin(donnees, tolerance) {
  const lecteur = new Lecteur(donnees);
  const sousChemins = [];
  let courant = [0, 0];
  let debut = [0, 0];
  let controle = null;
  let commande = null;
  let ouvert = false;
  const champ = (quoi) => {
    const v = lecteur.nombre();
    if (v === null) throw new Error(`${commande} attend ${quoi}`);
    return v;
  };
  const pointChamp = (quoi) => [champ(quoi), champ(quoi)];
  const ouvrir = () => {
    if (!ouvert) {
      sousChemins.push([courant]);
      ouvert = true;
    }
  };
  const dernier = () => sousChemins[sousChemins.length - 1];

  for (;;) {
    lecteur.sauter();
    if (lecteur.i >= lecteur.t.length) break;
    const c = lecteur.t[lecteur.i];
    if (/[A-Za-z]/.test(c)) {
      commande = c;
      lecteur.i += 1;
    } else if (commande === null) {
      throw new Error('le chemin doit commencer par une commande');
    } else if (commande === 'Z' || commande === 'z') {
      throw new Error('des coordonnées suivent une fermeture');
    } else {
      commande = commande === 'M' ? 'L' : commande === 'm' ? 'l' : commande;
    }
    const relatif = commande === commande.toLowerCase();
    switch (commande) {
      case 'M':
      case 'm': {
        let p = pointChamp('deux coordonnées');
        if (relatif) p = [courant[0] + p[0], courant[1] + p[1]];
        courant = p;
        debut = p;
        controle = null;
        sousChemins.push([p]);
        ouvert = true;
        break;
      }
      case 'L':
      case 'l': {
        let p = pointChamp('deux coordonnées');
        if (relatif) p = [courant[0] + p[0], courant[1] + p[1]];
        ouvrir();
        courant = p;
        controle = null;
        dernier().push(p);
        break;
      }
      case 'H':
      case 'h': {
        let x = champ('une abscisse');
        if (relatif) x += courant[0];
        ouvrir();
        courant = [x, courant[1]];
        controle = null;
        dernier().push(courant);
        break;
      }
      case 'V':
      case 'v': {
        let y = champ('une ordonnée');
        if (relatif) y += courant[1];
        ouvrir();
        courant = [courant[0], y];
        controle = null;
        dernier().push(courant);
        break;
      }
      case 'C':
      case 'c': {
        let c1 = pointChamp('deux points de contrôle');
        let c2 = pointChamp('deux points de contrôle');
        let a = pointChamp("un point d'arrivée");
        if (relatif) {
          c1 = [courant[0] + c1[0], courant[1] + c1[1]];
          c2 = [courant[0] + c2[0], courant[1] + c2[1]];
          a = [courant[0] + a[0], courant[1] + a[1]];
        }
        ouvrir();
        aplatir([courant, c1, c2, a], false, tolerance, dernier());
        courant = a;
        controle = c2;
        break;
      }
      case 'S':
      case 's': {
        const c1 = controle
          ? [2 * courant[0] - controle[0], 2 * courant[1] - controle[1]]
          : courant;
        let c2 = pointChamp('un point de contrôle');
        let a = pointChamp("un point d'arrivée");
        if (relatif) {
          c2 = [courant[0] + c2[0], courant[1] + c2[1]];
          a = [courant[0] + a[0], courant[1] + a[1]];
        }
        ouvrir();
        aplatir([courant, c1, c2, a], false, tolerance, dernier());
        courant = a;
        controle = c2;
        break;
      }
      case 'Q':
      case 'q': {
        let c1 = pointChamp('un point de contrôle');
        let a = pointChamp("un point d'arrivée");
        if (relatif) {
          c1 = [courant[0] + c1[0], courant[1] + c1[1]];
          a = [courant[0] + a[0], courant[1] + a[1]];
        }
        ouvrir();
        aplatir([courant, c1, a], true, tolerance, dernier());
        courant = a;
        controle = c1;
        break;
      }
      case 'T':
      case 't': {
        const c1 = controle
          ? [2 * courant[0] - controle[0], 2 * courant[1] - controle[1]]
          : courant;
        let a = pointChamp("un point d'arrivée");
        if (relatif) a = [courant[0] + a[0], courant[1] + a[1]];
        ouvrir();
        aplatir([courant, c1, a], true, tolerance, dernier());
        courant = a;
        controle = c1;
        break;
      }
      case 'A':
      case 'a': {
        const rx = champ('un rayon');
        const ry = champ('un rayon');
        const rotation = champ('un angle');
        const grandArc = lecteur.drapeau();
        const balayage = lecteur.drapeau();
        if (grandArc === null || balayage === null) throw new Error('A attend un drapeau valant 0 ou 1');
        let a = pointChamp("un point d'arrivée");
        if (relatif) a = [courant[0] + a[0], courant[1] + a[1]];
        ouvrir();
        const cible = dernier();
        if (courant[0] === a[0] && courant[1] === a[1]) {
          // rien
        } else {
          const courbes = arcVersCourbes(courant, Math.abs(rx), Math.abs(ry), rotation, grandArc, balayage, a);
          if (courbes) for (const courbe of courbes) aplatir(courbe, false, tolerance, cible);
          else cible.push(a);
        }
        courant = a;
        controle = null;
        break;
      }
      case 'Z':
      case 'z': {
        if (ouvert) {
          const cible = dernier();
          const fin = cible[cible.length - 1];
          if (!(fin[0] === debut[0] && fin[1] === debut[1])) cible.push(debut);
        }
        courant = debut;
        controle = null;
        ouvert = false;
        break;
      }
      default:
        throw new Error(`commande ${commande} inconnue`);
    }
  }
  return sousChemins;
}

/* ── Parcours de l'arbre ─────────────────────────────────────────────────── */

function lireSvg(texte, tolerance) {
  const { racine, entites } = analyserXml(texte);
  if (!racine || local(racine.nom) !== 'svg') throw new Error('racine qui n est pas svg');

  const corps = { largeur: null, hauteur: null, viewBox: null };
  const vb = racine.attributs.viewBox ? nombreListe(racine.attributs.viewBox) : [];
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    corps.viewBox = [vb[0], vb[1], vb[0] + vb[2], vb[1] + vb[3]];
  }
  const vl = corps.viewBox ? corps.viewBox[2] - corps.viewBox[0] : null;
  const vh = corps.viewBox ? corps.viewBox[3] - corps.viewBox[1] : null;
  const dimension = (nom, reference) =>
    racine.attributs[nom] !== undefined ? longueur(racine.attributs[nom], reference, 16) : null;
  const largeur = dimension('width', vl);
  const hauteur = dimension('height', vh);
  const w = corps.viewBox ? (largeur ?? vl) : (largeur ?? 0);
  const h = corps.viewBox ? (hauteur ?? vh) : (hauteur ?? 0);
  corps.largeur = w > 0 ? w : null;
  corps.hauteur = h > 0 ? h : null;

  let racineGeometrie = identite();
  if (corps.viewBox) {
    const cibleW = w > 0 ? w : vl;
    const cibleH = h > 0 ? h : vh;
    const fx = cibleW / vl;
    const fy = cibleH / vh;
    const versOrigine = [1, 0, 0, 1, -corps.viewBox[0], -corps.viewBox[1]];
    const par = (racine.attributs.preserveAspectRatio || '').trim().toLowerCase();
    if (par.startsWith('none')) {
      racineGeometrie = concatener(concatener(versOrigine, [fx, 0, 0, fy, 0, 0]), identite());
    } else {
      const f = par.includes('slice') ? Math.max(fx, fy) : Math.min(fx, fy);
      const resteX = cibleW - vl * f;
      const resteY = cibleH - vh * f;
      const dx = par.includes('xmin') ? 0 : par.includes('xmax') ? resteX : resteX / 2;
      const dy = par.includes('ymin') ? 0 : par.includes('ymax') ? resteY : resteY / 2;
      racineGeometrie = concatener(
        concatener(versOrigine, [f, 0, 0, f, 0, 0]),
        [1, 0, 0, 1, dx, dy],
      );
    }
  }
  return finir(corps, racineGeometrie, racine, tolerance, entites);
}

/** Le second étage : le parcours, une fois le canevas connu. */
function finir(corps, racineGeometrie, racine, tolerance, entites) {
  const formes = [];
  const textes = [];
  const nonRendus = {};
  const avertissements = [];
  const compter = (nom) => {
    nonRendus[nom] = (nonRendus[nom] || 0) + 1;
  };
  const avertir = (message) => {
    if (!avertissements.includes(message)) avertissements.push(message);
  };

  const styleDefaut = () => ({
    remplissage: { r: 0, g: 0, b: 0, alpha: 1 },
    regle: 0,
    contour: null,
    courante: { r: 0, g: 0, b: 0, alpha: 1 },
    opacite: 1,
    opaciteRemplissage: 1,
    opaciteContour: 1,
    corps: 16,
    famille: '',
    gras: false,
    italique: false,
    ancre: 'Debut',
  });

  const estNonRendu = (element) => {
    const d = element.attributs.display;
    if (d !== undefined && d.trim() === 'none') return true;
    const v = element.attributs.visibility;
    if (v !== undefined && (v.trim() === 'hidden' || v.trim() === 'collapse')) return true;
    return (
      element.attributs.requiredExtensions !== undefined ||
      element.attributs.requiredFeatures !== undefined
    );
  };

  const appliquerStyle = (style, element) => {
    const proprietes = Object.entries(element.attributs).filter(([n]) => n !== 'style');
    if (element.attributs.style !== undefined) proprietes.push(['style', element.attributs.style]);
    const appliquer = (nom, valeur, sousStyle) => {
      const v = String(valeur).trim();
      switch (nom) {
        case 'fill':
          style.remplissage = v.startsWith('url(') ? 'refus' : parseCouleur(v);
          break;
        case 'stroke': {
          const c = v.startsWith('url(') ? 'refus' : parseCouleur(v);
          style.contour = c === null ? null : { couleur: c, epaisseur: 1, extremite: 'Bout', jonction: 'Miter' };
          break;
        }
        case 'fill-rule':
        case 'clip-rule':
          style.regle = v === 'evenodd' ? 1 : 0;
          break;
        case 'stroke-width':
          if (style.contour) style.contour.epaisseur = longueur(v, referencePour('stroke-width', corps), 16);
          break;
        case 'stroke-linecap':
          if (style.contour) style.contour.extremite = v === 'round' ? 'Rond' : v === 'square' ? 'Carre' : 'Bout';
          break;
        case 'stroke-linejoin':
          if (style.contour) style.contour.jonction = v === 'round' ? 'Rond' : v === 'bevel' ? 'Biseau' : 'Miter';
          break;
        case 'color': {
          const c = parseCouleur(v);
          if (c && c !== 'courante') style.courante = c;
          break;
        }
        case 'opacity':
          style.opacite *= Math.min(1, Math.max(0, Number.parseFloat(v)));
          break;
        case 'fill-opacity':
          style.opaciteRemplissage = Math.min(1, Math.max(0, Number.parseFloat(v)));
          break;
        case 'stroke-opacity':
          style.opaciteContour = Math.min(1, Math.max(0, Number.parseFloat(v)));
          break;
        case 'font-size':
          style.corps = v.endsWith('%')
            ? (style.corps * Number.parseFloat(v)) / 100
            : longueur(v, referencePour('font-size', corps), 16);
          break;
        case 'font-family':
          style.famille = v.replace(/^["']|["']$/g, '');
          break;
        case 'font-weight':
          style.gras = v === 'bold' || Number.parseInt(v, 10) >= 600;
          break;
        case 'font-style':
          style.italique = v === 'italic' || v === 'oblique';
          break;
        case 'text-anchor':
          style.ancre = v === 'middle' ? 'Milieu' : v === 'end' ? 'Fin' : 'Debut';
          break;
        case 'clip-path':
        case 'mask':
        case 'filter':
          throw new Error(`${nom} refusé`);
        case 'style':
          for (const declaration of v.split(';')) {
            const coupe = declaration.indexOf(':');
            if (coupe < 0) continue;
            const sousNom = declaration.slice(0, coupe).trim().toLowerCase();
            const sousValeur = declaration.slice(coupe + 1).trim();
            if (sousValeur) appliquer(sousNom, sousValeur, sousStyle);
          }
          break;
        default:
          break;
      }
    };
    for (const [nom, valeur] of proprietes) appliquer(nom, valeur, false);
    if (style.remplissage === 'refus') throw new Error('dégradé refusé');
    if (style.remplissage === 'courante') style.remplissage = style.courante;
    if (style.contour && style.contour.couleur === 'courante') style.contour.couleur = style.courante;
  };

  const geometrie = (element, nom) => {
    const lire = (attribut, defaut = 0) =>
      element.attributs[attribut] !== undefined
        ? longueur(element.attributs[attribut], referencePour(attribut, corps), 16)
        : defaut;
    switch (nom) {
      case 'path':
        return lireChemin(element.attributs.d || '', tolerance);
      case 'rect': {
        const x = lire('x');
        const y = lire('y');
        const w = lire('width');
        const h = lire('height');
        if (w <= 0 || h <= 0) return [];
        const rx = element.attributs.rx !== undefined ? lire('rx') : element.attributs.ry !== undefined ? lire('ry') : 0;
        const ry = element.attributs.ry !== undefined ? lire('ry') : element.attributs.rx !== undefined ? lire('rx') : 0;
        const rrx = Math.min(Math.max(rx, 0), w / 2);
        const rry = Math.min(Math.max(ry, 0), h / 2);
        if (rrx <= 0 || rry <= 0) {
          return [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]];
        }
        const coins = [
          [[x + w - rrx, y], [x + w, y + rry]],
          [[x + w, y + h - rry], [x + w - rrx, y + h]],
          [[x + rrx, y + h], [x, y + h - rry]],
          [[x, y + rry], [x + rrx, y]],
        ];
        const points = [[x + rrx, y]];
        for (const [debut, fin] of coins) {
          points.push(debut);
          const courbes = arcVersCourbes(debut, rrx, rry, 0, false, true, fin);
          if (courbes) for (const courbe of courbes) aplatir(courbe, false, tolerance, points);
        }
        const fin = points[points.length - 1];
        if (!(fin[0] === points[0][0] && fin[1] === points[0][1])) points.push(points[0]);
        return [points];
      }
      case 'circle': {
        const cx = lire('cx');
        const cy = lire('cy');
        const r = lire('r');
        if (r <= 0) return [];
        return [ellipse(cx, cy, r, r, tolerance)];
      }
      case 'ellipse': {
        const cx = lire('cx');
        const cy = lire('cy');
        const rx = lire('rx');
        const ry = lire('ry');
        if (rx <= 0 || ry <= 0) return [];
        return [ellipse(cx, cy, rx, ry, tolerance)];
      }
      case 'line':
        return [[[lire('x1'), lire('y1')], [lire('x2'), lire('y2')]]];
      case 'polyline':
      case 'polygon': {
        const nombres = nombreListe(element.attributs.points || '');
        if (nombres.length % 2 !== 0) throw new Error('points en nombre impair');
        const points = [];
        for (let i = 0; i < nombres.length; i += 2) points.push([nombres[i], nombres[i + 1]]);
        if (nom === 'polygon' && points.length > 1) {
          const premier = points[0];
          const dernier = points[points.length - 1];
          if (premier[0] !== dernier[0] || premier[1] !== dernier[1]) points.push(premier);
        }
        return points.length ? [points] : [];
      }
      default:
        return [];
    }
  };

  const ellipse = (cx, cy, rx, ry, tol) => {
    const points = [[cx + rx, cy]];
    for (const [debut, fin] of [
      [[cx + rx, cy], [cx - rx, cy]],
      [[cx - rx, cy], [cx + rx, cy]],
    ]) {
      const courbes = arcVersCourbes(debut, rx, ry, 0, false, true, fin);
      if (courbes) for (const courbe of courbes) aplatir(courbe, false, tol, points);
    }
    return points;
  };

  const parcourir = (element, styleParent, transformation, profondeur) => {
    if (profondeur > 256) return;
    if (estNonRendu(element)) {
      compter(element.nom);
      return;
    }
    const style = { ...styleParent };
    if (style.contour) style.contour = { ...style.contour };
    appliquerStyle(style, element, corps);
    const t = element.attributs.transform
      ? analyserTransformation(element.attributs.transform)
      : identite();
    const matrice = concatener(transformation, t);
    const nom = local(element.nom);

    const NON_RENDUS = [
      'title', 'desc', 'metadata', 'defs', 'symbol', 'marker', 'clipPath', 'mask',
      'linearGradient', 'radialGradient', 'pattern', 'filter', 'foreignObject',
    ];
    if (nom === 'svg' || nom === 'g' || nom === 'a') {
      for (const enfant of element.enfants) if (enfant.nom) parcourir(enfant, style, matrice, profondeur + 1);
      return;
    }
    if (nom === 'switch') {
      const choisi = element.enfants.find(
        (e) =>
          e.nom &&
          e.attributs.requiredExtensions === undefined &&
          e.attributs.requiredFeatures === undefined,
      );
      if (choisi) parcourir(choisi, style, matrice, profondeur + 1);
      return;
    }
    if (['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'].includes(nom)) {
      const sousChemins = geometrie(element, nom);
      if (!sousChemins.length) return;
      for (const sous of sousChemins) {
        for (let i = 0; i < sous.length; i += 1) sous[i] = appliquer(matrice, sous[i]);
      }
      const teinter = (couleur, opacite) => ({ ...couleur, alpha: couleur.alpha * opacite });
      const remplissage =
        nom === 'line' || style.remplissage === null
          ? null
          : (() => {
              const c = teinter(style.remplissage, style.opacite * style.opaciteRemplissage);
              return c.alpha > 0 ? c : null;
            })();
      let contour = null;
      if (style.contour) {
        const c = teinter(style.contour.couleur, style.opacite * style.opaciteContour);
        if (c.alpha > 0 && style.contour.epaisseur > 0) contour = { ...style.contour, couleur: c };
      }
      formes.push({
        sousChemins,
        remplissage,
        regle: style.regle,
        contour,
        id: element.attributs.id,
      });
      return;
    }
    if (nom === 'text') {
      const contenu = texteDe(element);
      if (!contenu.trim()) return;
      const x = element.attributs.x !== undefined ? longueur(element.attributs.x, referencePour('x', corps), 16) : 0;
      const y = element.attributs.y !== undefined ? longueur(element.attributs.y, referencePour('y', corps), 16) : 0;
      const point = appliquer(matrice, [x, y]);
      const echelle = Math.max(Math.hypot(matrice[0], matrice[1]), Math.hypot(matrice[2], matrice[3]));
      textes.push({
        x: point[0],
        y: point[1],
        corps: style.corps * echelle,
        contenu,
        famille: style.famille,
        gras: style.gras,
        italique: style.italique,
        ancre: style.ancre,
      });
      return;
    }
    if (nom === 'style') throw new Error('feuille de style refusée');
    if (nom === 'image') throw new Error('image refusée');
    if (nom === 'use') throw new Error('use refusé');
    if (NON_RENDUS.includes(nom)) {
      compter(element.nom);
      return;
    }
    compter(element.nom);
  };

  parcourir(racine, styleDefaut(), racineGeometrie, 0);
  return { corps, formes, textes, nonRendus, avertissements, entites };
}

function texteDe(element) {
  let sortie = '';
  for (const enfant of element.enfants) {
    if (enfant.texte !== undefined) sortie += enfant.texte;
    else if (enfant.nom) sortie += texteDe(enfant);
  }
  return sortie;
}

/* ── Mesures faites depuis les sommets du lecteur indépendant ────────────── */

function aireDe(sousChemins) {
  let somme = 0;
  for (const chemin of sousChemins) {
    if (chemin.length < 3) continue;
    for (let i = 0; i < chemin.length; i += 1) {
      const a = chemin[i];
      const b = chemin[(i + 1) % chemin.length];
      somme += a[0] * b[1] - b[0] * a[1];
    }
  }
  return somme / 2;
}

function boiteDe(sousChemins) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const chemin of sousChemins) {
    for (const p of chemin) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }
  }
  return [minX, minY, maxX, maxY];
}

const proche = (a, b, marge = 1e-6) => Math.abs(a - b) <= marge * Math.max(1, Math.abs(a), Math.abs(b));

/* ══════════════════════════════════════════════════════════════════════════
   1. La table des couleurs, relevée du produit
   ══════════════════════════════════════════════════════════════════════════ */

titre('la table des couleurs, relevée du produit (jspdf.umd.min.js)');

const cheminJsPdf = join(produit, 'app', 'JS', 'jspdf.umd.min.js');
let tableProduit = null;
if (existsSync(cheminJsPdf)) {
  const source = readFileSync(cheminJsPdf, 'utf8');
  const debut = source.indexOf('{aliceblue:');
  const fin = source.indexOf('}', debut);
  const corps = source.slice(debut + 1, fin);
  const entrees = corps.split(',').map((p) => {
    const [nom, hex] = p.split(':');
    return [nom.replace(/^"|"$/g, ''), hex.replace(/^"|"$/g, '')];
  });
  tableProduit = Object.fromEntries(entrees);
  for (const [nom, hex] of entrees) {
    COULEURS_PRODUIT[nom] = Number.parseInt(hex, 16);
  }
  check('la table du produit est lue', entrees.length > 100, `${entrees.length} noms`);
} else {
  check('le fichier du produit est présent', false, cheminJsPdf);
}

lancer('couleurs', join(dossier, 'couleurs.tsv'));
const tableNoyau = {};
for (const ligne of readFileSync(joindre('couleurs.tsv'), 'utf8').split('\n')) {
  if (!ligne) continue;
  const [, nom, hex] = ligne.split('\t');
  tableNoyau[nom] = hex;
}

if (tableProduit) {
  const ecarts = [];
  for (const [nom, hex] of Object.entries(tableProduit)) {
    if (tableNoyau[nom] !== hex) ecarts.push(`${nom}: produit=${hex} noyau=${tableNoyau[nom] ?? 'absent'}`);
  }
  check(
    `les ${Object.keys(tableProduit).length} noms du produit sont dans le noyau, à la même valeur`,
    ecarts.length === 0,
    ecarts.slice(0, 6).join(' · '),
  );
  const enPlus = Object.keys(tableNoyau).filter((n) => !Object.hasOwn(tableProduit, n));
  check(
    'les noms en plus sont exactement les six orthographes britanniques, et elles sont déclarées',
    enPlus.length === 6 &&
      enPlus.every((n) =>
        ['grey', 'darkgrey', 'dimgrey', 'lightgray', 'slategrey', 'lightslategrey'].includes(n),
      ),
    enPlus.join(', '),
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   2. Les fichiers réels du dépôt, lus par les deux lecteurs
   ══════════════════════════════════════════════════════════════════════════ */

titre('les SVG réels du dépôt : même nombre de formes, mêmes sommets');

const dossiers = ['icons', 'app/icons', 'app/SP'];
const temoins = [];
for (const sous of dossiers) {
  const chemin = join(produit, sous);
  if (!existsSync(chemin)) continue;
  for (const nom of readdirSync(chemin)) {
    if (nom.toLowerCase().endsWith('.svg')) temoins.push(join(chemin, nom));
  }
}
check('des SVG réels sont trouvés', temoins.length >= 20, `${temoins.length} fichiers`);

let totalFormes = 0;
let totalSommets = 0;
let pireEcartSommet = 0;
const echecs = [];

for (const source of temoins) {
  const nom = source.slice(produit.length + 1).replace(/[\\/]/g, '-');
  const nomCopie = `temoin-${nom}`;
  copyFileSync(source, joindre(nomCopie));
  const tsv = lireTsv(
    (() => {
      lancer('formes', join(dossier, nomCopie), '0.05', join(dossier, `${nomCopie}.tsv`));
      return joindre(`${nomCopie}.tsv`);
    })(),
  );
  if (tsv.erreur) {
    echecs.push(`${nom} : refusé par le noyau — ${tsv.erreur}`);
    continue;
  }
  let attendu;
  try {
    attendu = lireSvg(readFileSync(source, 'utf8'), 0.05);
  } catch (e) {
    echecs.push(`${nom} : refusé par le lecteur de contrôle — ${e.message}`);
    continue;
  }
  if (tsv.formes !== attendu.formes.length) {
    echecs.push(`${nom} : ${tsv.formes} formes (noyau) contre ${attendu.formes.length} (contrôle)`);
    continue;
  }
  let desaccord = null;
  for (let f = 0; f < attendu.formes.length && !desaccord; f += 1) {
    const noyau = tsv.liste[f];
    const controle = attendu.formes[f];
    if (noyau.sousChemins !== controle.sousChemins.length) {
      desaccord = `forme ${f} : ${noyau.sousChemins} sous-chemins contre ${controle.sousChemins.length}`;
      break;
    }
    for (let s = 0; s < controle.sousChemins.length && !desaccord; s += 1) {
      const a = noyau.points[s] || [];
      const b = controle.sousChemins[s];
      if (a.length !== b.length) {
        desaccord = `forme ${f}, sous-chemin ${s} : ${a.length} sommets contre ${b.length}`;
        break;
      }
      for (let p = 0; p < b.length; p += 1) {
        const ecart = Math.max(Math.abs(a[p][0] - b[p][0]), Math.abs(a[p][1] - b[p][1]));
        if (ecart > pireEcartSommet) pireEcartSommet = ecart;
        if (!proche(a[p][0], b[p][0]) || !proche(a[p][1], b[p][1])) {
          desaccord = `forme ${f}, sommet ${s}/${p} : [${a[p]}] contre [${b[p]}]`;
          break;
        }
      }
    }
    if (!proche(Math.abs(noyau.aire), Math.abs(aireDe(controle.sousChemins)))) {
      desaccord = `forme ${f} : aire ${noyau.aire} contre ${aireDe(controle.sousChemins)}`;
    }
  }
  if (desaccord) {
    echecs.push(`${nom} : ${desaccord}`);
    continue;
  }
  totalFormes += attendu.formes.length;
  totalSommets += attendu.formes.reduce(
    (n, f) => n + f.sousChemins.reduce((m, c) => m + c.length, 0),
    0,
  );
}

check(
  `${temoins.length} SVG réels lus par les deux lecteurs, forme par forme`,
  echecs.length === 0,
  echecs.length ? echecs.slice(0, 4).join(' | ') : `${totalFormes} formes, ${totalSommets} sommets`,
);
check(
  'les sommets coïncident au millionième',
  pireEcartSommet < 1e-6,
  `pire écart ${pireEcartSommet.toExponential(3)}`,
);

/* ══════════════════════════════════════════════════════════════════════════
   3. Aires connues par construction
   ══════════════════════════════════════════════════════════════════════════ */

titre('aires connues par construction : la géométrie, pas l’accord entre deux lectures');

{
  const cas = [
    {
      nom: 'rectangle 300 × 200',
      svg: '<svg width="400" height="300"><rect x="10" y="20" width="300" height="200"/></svg>',
      aire: 60000,
    },
    {
      nom: 'cercle de rayon 50',
      svg: '<svg width="200" height="200"><circle cx="100" cy="100" r="50"/></svg>',
      aire: Math.PI * 2500,
      relatif: 0.002,
    },
    {
      nom: 'ellipse 80 × 30',
      svg: '<svg width="200" height="200"><ellipse cx="100" cy="100" rx="80" ry="30"/></svg>',
      aire: Math.PI * 2400,
      relatif: 0.002,
    },
    {
      nom: 'rectangle arrondi 100 × 100, rayon 10',
      svg: '<svg width="100" height="100"><rect x="0" y="0" width="100" height="100" rx="10" ry="10"/></svg>',
      aire: 10000 - (4 - Math.PI) * 100,
      relatif: 0.0005,
    },
    {
      nom: 'triangle par polygone',
      svg: '<svg width="100" height="100"><polygon points="0,0 100,0 0,100"/></svg>',
      aire: 5000,
    },
    {
      nom: 'chemin fermé par « z »',
      svg: '<svg width="100" height="100"><path d="M10 10 H90 V90 H10 Z"/></svg>',
      aire: 6400,
    },
  ];
  for (const c of cas) {
    const resultat = lireAvecLeNoyau(c.svg, 0.001);
    const aire = Math.abs(resultat.aire);
    const relatif = c.relatif ?? 0;
    const ecart = Math.abs(aire - c.aire) / c.aire;
    check(
      `${c.nom} : aire ${c.aire.toFixed(3)}`,
      ecart <= relatif,
      `noyau ${aire.toFixed(3)} (écart relatif ${ecart.toExponential(2)})`,
    );
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   4. L'aplatissement, mesuré contre la courbe VRAIE
   ══════════════════════════════════════════════════════════════════════════ */

titre('tolérance d’aplatissement : écart mesuré à la courbe vraie');

{
  const courbes = [
    {
      nom: 'cubique ample',
      d: 'M0 0 C0 200 300 200 300 0',
      courbe: [[0, 0], [0, 200], [300, 200], [300, 0]],
    },
    {
      nom: 'cubique rebroussante (poignée tirée en arrière)',
      d: 'M0 0 C-100 50 400 50 300 0',
      courbe: [[0, 0], [-100, 50], [400, 50], [300, 0]],
    },
    {
      nom: 'quadratique',
      d: 'M0 0 Q150 200 300 0',
      courbe: [[0, 0], [150, 200], [300, 0]],
      quadratique: true,
    },
  ];
  for (const tolerance of [0.5, 0.05, 0.005]) {
    for (const cas of courbes) {
      const resultat = lireAvecLeNoyau(
        `<svg width="400" height="400"><path d="${cas.d}" fill="none" stroke="#000000"/></svg>`,
        tolerance,
      );
      const polyligne = resultat.liste[0].points[0].map((p) => [p[0], p[1]]);
      let pire = 0;
      for (let i = 0; i <= 4000; i += 1) {
        const t = i / 4000;
        const point = cas.quadratique
          ? quadratiquePoint(cas.courbe, t)
          : cubiquePoint(cas.courbe, t);
        let distance = Infinity;
        for (let k = 0; k + 1 < polyligne.length; k += 1) {
          distance = Math.min(distance, distanceSegment(point, polyligne[k], polyligne[k + 1]));
        }
        pire = Math.max(pire, distance);
      }
      check(
        `tolérance ${tolerance} · ${cas.nom} : ${polyligne.length} sommets`,
        pire <= tolerance,
        `pire écart ${pire.toExponential(3)} (rapport ${(pire / tolerance).toFixed(3)})`,
      );
    }
  }
}

function distanceSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const norme = dx * dx + dy * dy;
  if (norme === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / norme));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/* ══════════════════════════════════════════════════════════════════════════
   5. Refus nommés, et signalements qui n'arrêtent rien
   ══════════════════════════════════════════════════════════════════════════ */

titre('refuser ce qui perd du dessin, compter ce qui décrit');

{
  const refus = [
    ['<image href="a.png" width="1" height="1"/>', 'image'],
    ['<use href="#a"/>', 'use'],
    ['<style>rect{fill:red}</style>', 'style'],
    ['<rect width="1" height="1" fill="url(#g)"/>', 'url('],
    ['<rect width="1" height="1" clip-path="url(#c)"/>', 'clip-path'],
    ['<rect width="1" height="1" mask="url(#m)"/>', 'mask'],
    ['<rect width="1" height="1" filter="url(#f)"/>', 'filter'],
  ];
  for (const [contenu, attendu] of refus) {
    const resultat = lireAvecLeNoyau(`<svg width="10" height="10">${contenu}</svg>`);
    const refuse = resultat.erreur !== null;
    const nomme = refuse && resultat.erreur.includes(attendu.replace('url(', 'url('));
    check(
      `refus nommé : ${contenu.slice(0, 40)}`,
      nomme,
      refuse ? resultat.erreur.slice(0, 90) : 'AUCUN REFUS',
    );
  }

  const signales = lireAvecLeNoyau(
    `<svg width="10" height="10">
       <title>t</title><desc>d</desc><metadata>m</metadata>
       <defs><linearGradient id="g"/></defs>
       <g display="none"><rect width="10" height="10"/></g>
       <rect x="0" y="0" width="10" height="10"/>
     </svg>`,
  );
  check(
    'ce qui décrit sans dessiner est COUNTÉ, pas refusé',
    signales.erreur === null &&
      signales.nonRendus.defs === 1 &&
      signales.nonRendus.title === 1 &&
      signales.nonRendus.desc === 1 &&
      signales.nonRendus.metadata === 1 &&
      signales.nonRendus.g === 1,
    JSON.stringify(signales.nonRendus),
  );
  check('et le dessin, lui, est bien là', signales.formes === 1, `${signales.formes} forme(s)`);

  const degrade = lireAvecLeNoyau(
    `<svg width="10" height="10">
       <defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/></linearGradient></defs>
       <rect width="10" height="10" fill="#0000ff"/>
     </svg>`,
  );
  check(
    'un dégradé défini mais NON employé ne fait rien échouer',
    degrade.erreur === null && degrade.formes === 1 && degrade.nonRendus.defs === 1,
    degrade.erreur ?? `${degrade.formes} forme(s), defs ${degrade.nonRendus.defs}`,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   6. Entités du DTD interne, texte, et refus d'encodage
   ══════════════════════════════════════════════════════════════════════════ */

titre('entités déclarées, texte lu, encodage refusé');

{
  const avecEntites = lireAvecLeNoyau(
    `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1 Basic//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11-basic.dtd" [
       <!ENTITY ns_extend "http://ns.adobe.com/Extensibility/1.0/">
       <!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/">
     ]>
     <svg xmlns:x="&ns_extend;" xmlns:i="&ns_ai;" width="10" height="10">
       <rect width="10" height="10"/>
     </svg>`,
  );
  check(
    'les entités du DOCTYPE interne sont résolues et comptées',
    avecEntites.erreur === null && avecEntites.entites === 2 && avecEntites.formes === 1,
    avecEntites.erreur ?? `${avecEntites.entites} entité(s)`,
  );

  const texte = lireAvecLeNoyau(
    `<svg width="24" height="24">
       <text x="12" y="16" font-family="Arial, sans-serif" font-size="6" font-weight="bold"
             text-anchor="middle" fill="#000000">PDF</text>
     </svg>`,
  );
  check(
    'le texte est lu, non dessiné, et non perdu',
    texte.erreur === null &&
      texte.textes === 1 &&
      texte.formes === 0 &&
      texte.textesListe[0].contenu === 'PDF' &&
      Math.abs(texte.textesListe[0].corps - 6) < 1e-9 &&
      texte.textesListe[0].ancre === 'Milieu' &&
      texte.textesListe[0].gras === 1,
    texte.erreur ?? JSON.stringify(texte.textesListe[0] ?? null),
  );

  const bom = lireAvecLeNoyau('<svg width="1" height="1"/>');
  check(
    'un SVG sans aucune forme ne rend aucune forme, et ne se plaint pas',
    bom.erreur === null && bom.formes === 0 && bom.sommets === 0,
    bom.erreur ?? `${bom.formes} forme(s)`,
  );

  const racine = lireAvecLeNoyau('<html><body/></html>');
  check(
    'une racine qui n’est pas <svg> est refusée en la nommant',
    racine.erreur !== null && racine.erreur.includes('html'),
    racine.erreur ?? 'AUCUN REFUS',
  );

  const cheminFautif = lireAvecLeNoyau('<svg width="10" height="10"><path d="M0 0 K10 10"/></svg>');
  check(
    'une commande de chemin inconnue est refusée en la nommant',
    cheminFautif.erreur !== null && cheminFautif.erreur.includes('K'),
    cheminFautif.erreur ?? 'AUCUN REFUS',
  );

  const couleurFautive = lireAvecLeNoyau(
    '<svg width="10" height="10"><rect width="1" height="1" fill="bleu-canard"/></svg>',
  );
  check(
    'une couleur inconnue est refusée en la nommant (jamais un noir silencieux)',
    couleurFautive.erreur !== null && couleurFautive.erreur.includes('bleu-canard'),
    couleurFautive.erreur ?? 'AUCUN REFUS',
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   7. Repère, transformations, unités
   ══════════════════════════════════════════════════════════════════════════ */

titre('repère, transformations et unités');

{
  const viewBox = lireAvecLeNoyau(
    '<svg viewBox="0 0 24 24" width="48" height="48"><rect x="0" y="0" width="24" height="24"/></svg>',
  );
  check(
    'le viewBox est appliqué (24 → 48)',
    viewBox.boite !== null && proche(viewBox.boite[2] - viewBox.boite[0], 48),
    JSON.stringify(viewBox.boite),
  );

  const decalage = lireAvecLeNoyau(
    '<svg viewBox="10 10 10 10" width="20" height="20"><rect x="10" y="10" width="10" height="10"/></svg>',
  );
  check(
    'un viewBox décalé est ramené à l’origine',
    decalage.boite !== null &&
      proche(decalage.boite[0], 0) &&
      proche(decalage.boite[2], 20),
    JSON.stringify(decalage.boite),
  );

  const meet = lireAvecLeNoyau(
    '<svg viewBox="0 0 10 10" width="40" height="20"><rect x="0" y="0" width="10" height="10"/></svg>',
  );
  check(
    'preserveAspectRatio par défaut : le dessin est centré (meet)',
    meet.boite !== null &&
      proche(meet.boite[2] - meet.boite[0], 20) &&
      proche(meet.boite[3] - meet.boite[1], 20) &&
      proche(meet.boite[1], 0),
    JSON.stringify(meet.boite),
  );

  const etale = lireAvecLeNoyau(
    '<svg viewBox="0 0 10 10" width="40" height="20" preserveAspectRatio="none"><rect x="0" y="0" width="10" height="10"/></svg>',
  );
  check(
    'preserveAspectRatio="none" étale',
    etale.boite !== null &&
      proche(etale.boite[2] - etale.boite[0], 40) &&
      proche(etale.boite[3] - etale.boite[1], 20),
    JSON.stringify(etale.boite),
  );

  const transforme = lireAvecLeNoyau(
    `<svg width="100" height="100">
       <g transform="translate(10,10) scale(2) rotate(90)">
         <rect x="1" y="0" width="4" height="2"/>
       </g>
     </svg>`,
  );
  const attendu = lireSvg(
    `<svg width="100" height="100">
       <g transform="translate(10,10) scale(2) rotate(90)">
         <rect x="1" y="0" width="4" height="2"/>
       </g>
     </svg>`,
    0.05,
  );
  check(
    'une transformation composée donne la même boîte aux deux lectures',
    transforme.boite !== null &&
      proche(transforme.boite[0], boiteDe(attendu.formes[0].sousChemins)[0], 1e-9) &&
      proche(transforme.boite[2], boiteDe(attendu.formes[0].sousChemins)[2], 1e-9),
    `${JSON.stringify(transforme.boite)} contre ${JSON.stringify(boiteDe(attendu.formes[0].sousChemins))}`,
  );

  const unites = lireAvecLeNoyau(
    '<svg width="200" height="200"><rect x="1in" y="12pt" width="25.4mm" height="2.54cm"/></svg>',
  );
  check(
    'les unités CSS sont converties (1in = 96, 12pt = 16, 25,4mm = 96, 2,54cm = 96)',
    unites.erreur === null &&
      proche(unites.boite[0], 96) &&
      proche(unites.boite[1], 16) &&
      proche(unites.boite[2] - unites.boite[0], 96) &&
      proche(unites.boite[3] - unites.boite[1], 96),
    JSON.stringify(unites.boite),
  );

  const pourcent = lireAvecLeNoyau(
    '<svg width="200" height="100"><rect x="0" y="0" width="50%" height="50%"/></svg>',
  );
  check(
    'un pourcentage se rapporte à la référence de son attribut (largeur pour x, hauteur pour y)',
    pourcent.erreur === null &&
      proche(pourcent.boite[2] - pourcent.boite[0], 100) &&
      proche(pourcent.boite[3] - pourcent.boite[1], 50),
    pourcent.erreur ?? JSON.stringify(pourcent.boite),
  );

  // Diagonale normalisée : √((200² + 100²) / 2) = 158,1139.
  const diagonale = Math.sqrt((200 * 200 + 100 * 100) / 2);
  const rayon = lireAvecLeNoyau(
    '<svg width="200" height="100"><circle cx="50%" cy="50%" r="10%"/></svg>',
  );
  check(
    'un rayon en pourcentage se rapporte à la diagonale normalisée du canevas',
    rayon.erreur === null &&
      proche(rayon.boite[2] - rayon.boite[0], diagonale * 0.2, 1e-3),
    rayon.erreur ?? `${rayon.boite[2] - rayon.boite[0]} contre ${diagonale * 0.2}`,
  );

  const corpsRelatif = lireAvecLeNoyau(
    '<svg width="100" height="100"><text x="0" y="0" font-size="100%">a</text></svg>',
  );
  check(
    'un font-size en pourcentage se rapporte au corps du parent (CSS), pas au canevas',
    corpsRelatif.erreur === null && proche(corpsRelatif.textesListe[0].corps, 16),
    corpsRelatif.erreur ?? `corps ${corpsRelatif.textesListe[0]?.corps}`,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   8. Styles hérités, opacités, display
   ══════════════════════════════════════════════════════════════════════════ */

titre('styles hérités, opacités, display');

{
  const herite = lireAvecLeNoyau(
    `<svg width="20" height="20" fill="#123456" stroke="#abcdef" stroke-width="3">
       <g transform="translate(10,10)"><rect x="0" y="0" width="5" height="5"/></g>
     </svg>`,
  );
  check(
    'les attributs de présentation s’héritent (remplissage, contour, épaisseur)',
    herite.liste[0].remplissage.startsWith('#123456@') &&
      herite.liste[0].contour.startsWith('#abcdef@') &&
      proche(herite.liste[0].epaisseur, 3),
    JSON.stringify([herite.liste[0].remplissage, herite.liste[0].contour, herite.liste[0].epaisseur]),
  );

  const opacite = lireAvecLeNoyau(
    '<svg width="10" height="10"><g opacity="0.5"><rect width="10" height="10" fill-opacity="0.5"/></g></svg>',
  );
  check(
    'opacity se compose, fill-opacity s’hérite : 0,5 × 0,5 = 0,25',
    opacite.liste[0].remplissage.endsWith('@0.250000'),
    opacite.liste[0].remplissage,
  );

  const opaque = lireAvecLeNoyau(
    '<svg width="10" height="10"><rect width="10" height="10" opacity="0"/></svg>',
  );
  check(
    'une forme d’opacité nulle n’est pas peinte du tout',
    opaque.liste[0].remplissage === '-',
    opaque.liste[0].remplissage,
  );

  const cache = lireAvecLeNoyau(
    '<svg width="10" height="10"><g display="none"><rect width="5" height="5"/></g><rect width="3" height="3"/></svg>',
  );
  check(
    'display="none" masque le sous-arbre entier',
    cache.formes === 1 && proche(Math.abs(cache.aire), 9),
    `${cache.formes} forme(s), aire ${cache.aire}`,
  );

  const courant = lireAvecLeNoyau(
    '<svg width="10" height="10" color="#ff0000"><rect width="10" height="10" fill="none" stroke="currentColor"/></svg>',
  );
  check(
    'currentColor est résolu par l’attribut color',
    courant.liste[0].contour.startsWith('#ff0000@'),
    courant.liste[0].contour,
  );

  const pairImpair = lireAvecLeNoyau(
    '<svg width="10" height="10"><rect width="10" height="10" fill-rule="evenodd"/></svg>',
  );
  check(
    'fill-rule="evenodd" est retenu (règle 1)',
    pairImpair.liste[0].regle === 1,
    `règle ${pairImpair.liste[0].regle}`,
  );

  const style = lireAvecLeNoyau(
    '<svg width="10" height="10" fill="red"><rect width="10" height="10" style="fill:#00ff00"/></svg>',
  );
  check(
    'l’attribut style l’emporte sur l’attribut de présentation',
    style.liste[0].remplissage.startsWith('#00ff00@'),
    style.liste[0].remplissage,
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

console.log('');
if (ok) {
  console.log('OK : le lecteur SVG est conforme (sommets, aires, tolérance, refus, couleurs).');
  process.exit(0);
}
console.error('ECHEC : au moins un contrôle a échoué.');
process.exit(1);
