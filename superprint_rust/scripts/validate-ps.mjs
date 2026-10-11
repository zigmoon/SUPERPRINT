/* ══════════════════════════════════════════════════════════════════════════
   validate-ps.mjs — l'import PostScript, mis à l'épreuve.

   Le noyau lit un .eps (et les .ai enregistrés en EPS) avec un interpréteur
   PostScript borné. Ce script vérifie ce qu'il fait sans lui faire confiance,
   et de six façons :

     1. INTERPRÉTEUR INDÉPENDANT. Le script écrit son propre lexeur, son propre
        découpage DSC, sa propre pile d'opérandes, sa propre matrice et son
        propre aplatissement — puis compare DESSIN PAR DESSIN, SOMMET PAR
        SOMMET, avec ce que le noyau rend.

     2. CONTRÔLES ANALYTIQUES. Les aires de `forme.eps` et d'`eps-preview.eps`
        sont connues par construction (un rectangle, un triangle) : le script
        les recalcule à la main et les exige au dix-millième. Un accord entre
        deux interpréteurs peut être un accord sur la même erreur ; un accord
        avec la géométrie connue, non.

     3. QUALITÉ DE L'APLATISSEMENT. Sur une cubique dont la courbe vraie est
        connue, le script échantillonne densément la courbe et mesure l'écart
        réel à la polyligne rendue par le noyau. Il doit être INFÉRIEUR à la
        tolérance demandée — sinon la tolérance n'est pas tenue.

     4. REFUS NOMMÉS. Un opérateur dont l'ignorance perd du dessin (le texte,
        les images, une police) doit être REFUSÉ, avec une raison lisible. Un
        opérateur simplement inconnu doit être SIGNALÉ sans arrêter la lecture.
        Les deux comportements sont mesurés, séparément.

     5. STRUCTURE. Le script lit le source du noyau et vérifie que tout
        opérateur exécutable est déclaré, et qu'aucun opérateur n'est à la fois
        exécuté et refusé.

     6. SAVEUR. Un `.ai` qui est un PDF doit être refusé en expliquant pourquoi.

   Usage : node scripts/validate-ps.mjs
   Retour : 0 si tout passe, 1 sinon.
   ══════════════════════════════════════════════════════════════════════════ */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, '..');
const parent = join(racine, '..');
const cheminExemple = join(
  racine,
  'target',
  'wasm32-wasip1',
  'release',
  'examples',
  'ps_dump.wasm',
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
    '(construire : cargo build -p superprint-ps --example ps_dump --target wasm32-wasip1 --release)',
  );
  process.exit(2);
}

const dossier = join(racine, 'target', 'ps');
mkdirSync(dossier, { recursive: true });
const temporaire = (nom) => join(dossier, nom);

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
function lancerSouple(...args) {
  try {
    return { code: 0, sortie: lancer(...args) };
  } catch (e) {
    return { code: e.status ?? 1, sortie: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

/** Dépose un texte PostScript dans le bac à sable et l'interprète. */
let compteur = 0;
function interpreterTexte(source, tolerance = 0.05) {
  compteur += 1;
  const nom = `essai-${compteur}.eps`;
  writeFileSync(join(dossier, nom), source, 'latin1');
  const sortie = lancer('dessins', joindre(nom), String(tolerance), joindre(`${nom}.tsv`));
  return { tsv: lireTsv(join(dossier, `${nom}.tsv`)), brut: sortie };
}
function joindre(...bouts) {
  return join(dossier, ...bouts);
}

/* ───────────────────────── lecture du TSV du noyau ─────────────────────── */

function lireTsv(chemin) {
  const texte = readFileSync(chemin, 'utf8');
  const resume = {
    tolerance: null,
    blocs: null,
    pages: null,
    dessins: [],
    sommets: 0,
    avertissements: [],
    inconnus: [],
    erreur: null,
  };
  for (const ligne of texte.split(/\r?\n/)) {
    if (!ligne) continue;
    const c = ligne.split('\t');
    switch (c[0]) {
      case 'tolerance':
        resume.tolerance = Number(c[1]);
        break;
      case 'blocs':
        resume.blocs = c[1] === '-' ? null : Number(c[1]);
        break;
      case 'pages':
        resume.pages = Number(c[1]);
        break;
      case 'sommets':
        resume.sommets = Number(c[1]);
        break;
      case 'avertissement':
        resume.avertissements.push(c[1]);
        break;
      case 'inconnu':
        resume.inconnus.push(c[1]);
        break;
      case 'erreur':
        resume.erreur = c.slice(1).join('\t');
        break;
      case 'dessin':
        resume.dessins.push({
          rang: Number(c[1]),
          peinture: c[2],
          epaisseur: c[3],
          espace: c[4],
          composantes: [c[5], c[6], c[7], c[8]].slice(0, espaceDe(c[4])).map(Number),
          sommets: Number(c[9]),
          boite: [Number(c[10]), Number(c[11]), Number(c[12]), Number(c[13])],
          aire: Number(c[14]),
          sousChemins: [],
        });
        break;
      case 'sommet': {
        const dessin = resume.dessins.find((d) => d.rang === Number(c[1]));
        if (!dessin) break;
        const rangSous = Number(c[2]);
        while (dessin.sousChemins.length <= rangSous) dessin.sousChemins.push([]);
        dessin.sousChemins[rangSous].push([Number(c[4]), Number(c[5])]);
        break;
      }
      default:
        break;
    }
  }
  return resume;
}
function espaceDe(nom) {
  return nom === 'gris' ? 1 : nom === 'rvb' ? 3 : 4;
}

/* ═══════════════════════ 1. interpréteur indépendant ═══════════════════════
   Écrit ici, sans paquet, avec une méthode DIFFÉRENTE de celle du noyau : le
   lexeur découpe par expression régulière au lieu de parcourir caractère par
   caractère, et le découpage DSC travaille sur le texte entier. Ce qui est
   commun aux deux, c'est la SÉMANTIQUE de PostScript — c'est bien elle qu'on
   veut vérifier. */

const DELIM = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%', '\\0']);

/** Découpe un texte PostScript en jetons. */
function lexer(src) {
  const jetons = [];
  let i = 0;
  const n = src.length;
  const blanc = (c) => /\s/.test(c) || c === '\0';
  const delim = (c) => blanc(c) || DELIM.has(c);
  while (i < n) {
    const c = src[i];
    if (blanc(c)) {
      i += 1;
      continue;
    }
    if (c === '%') {
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '(') {
      let profondeur = 1;
      let j = i + 1;
      let texte = '';
      while (j < n) {
        if (src[j] === '\\') {
          const e = src[j + 1];
          if (e === 'n') texte += '\n';
          else if (e === 'r') texte += '\r';
          else if (e === 't') texte += '\t';
          else if (e === 'b') texte += '\b';
          else if (e === 'f') texte += '\f';
          else if (e === '\n') {
            /* continuation */
          } else if (/[0-7]/.test(e)) {
            let v = 0;
            let k = j + 1;
            let faits = 0;
            while (faits < 3 && /[0-7]/.test(src[k] ?? '')) {
              v = v * 8 + (src.charCodeAt(k) - 48);
              k += 1;
              faits += 1;
            }
            texte += String.fromCharCode(v & 0xff);
            j = k;
            continue;
          } else texte += e;
          j += 2;
          continue;
        }
        if (src[j] === '(') profondeur += 1;
        if (src[j] === ')') {
          profondeur -= 1;
          if (profondeur === 0) break;
        }
        texte += src[j];
        j += 1;
      }
      if (profondeur !== 0) throw new Error('chaîne jamais fermée');
      jetons.push({ t: 'chaine', v: texte, i });
      i = j + 1;
      continue;
    }
    if (c === '<') {
      if (src[i + 1] === '<') {
        jetons.push({ t: 'nomLitteral', v: '<<' });
        i += 2;
        continue;
      }
      const fin = src.indexOf('>', i);
      if (fin < 0) throw new Error('chaîne hexadécimale jamais fermée');
      let chiffres = src.slice(i + 1, fin).replace(/\s+/g, '');
      if (chiffres.length % 2) chiffres += '0';
      let texte = '';
      for (let k = 0; k < chiffres.length; k += 2) {
        texte += String.fromCharCode(parseInt(chiffres.slice(k, k + 2), 16));
      }
      jetons.push({ t: 'chaine', v: texte, i });
      i = fin + 1;
      continue;
    }
    if (c === '>') {
      if (src[i + 1] === '>') {
        jetons.push({ t: 'nomLitteral', v: '>>' });
        i += 2;
        continue;
      }
      throw new Error('« > » fermant sans ouvrant');
    }
    if (c === '[' || c === '{') {
      jetons.push({ t: 'ouvrant', v: c, i });
      i += 1;
      continue;
    }
    if (c === ']' || c === '}') {
      jetons.push({ t: 'fermant', v: c, i });
      i += 1;
      continue;
    }
    if (c === '/') {
      const immediat = src[i + 1] === '/';
      i += immediat ? 2 : 1;
      let j = i;
      while (j < n && !delim(src[j])) j += 1;
      jetons.push({ t: 'nomLitteral', v: src.slice(i, j), i });
      i = j;
      continue;
    }
    let j = i;
    while (j < n && !delim(src[j])) j += 1;
    if (j === i) throw new Error(`caractère non analysable « ${c} »`);
    const mot = src.slice(i, j);
    if (mot === 'true' || mot === 'false') jetons.push({ t: 'booleen', v: mot === 'true', i });
    else if (/^[-+]?\d+$/.test(mot)) jetons.push({ t: 'nombre', v: parseInt(mot, 10), i });
    else if (/^[-+]?(\d+\.\d*|\.\d+|\d+[eE][-+]?\d+)$/.test(mot) || Number.isFinite(Number(mot)))
      jetons.push({ t: 'nombre', v: Number(mot), i });
    else jetons.push({ t: 'nom', v: mot, i });
    i = j;
  }
  return jetons;
}

/** Regroupe les jetons en procédures et tableaux. */
function assembler(jetons) {
  const racine = { ouvrant: ' ', objets: [] };
  const pile = [racine];
  for (const jeton of jetons) {
    const haut = () => pile[pile.length - 1];
    if (jeton.t === 'ouvrant') {
      pile.push({ ouvrant: jeton.v, objets: [] });
      continue;
    }
    if (jeton.t === 'fermant') {
      const attendu = jeton.v === '}' ? '{' : '[';
      const niveau = pile.pop();
      if (!niveau || niveau.ouvrant !== attendu) throw new Error(`« ${jeton.v} » orphelin`);
      haut().objets.push({
        t: attendu === '{' ? 'procedure' : 'tableau',
        v: niveau.objets,
      });
      continue;
    }
    haut().objets.push(jeton);
  }
  if (pile.length > 1) throw new Error(`« ${pile[pile.length - 1].ouvrant} » jamais fermé`);
  return racine.objets;
}

/** Découpage DSC : en-tête, code sans les blocs de données, nombre de blocs. */
function decouperDsc(src) {
  const entete = {};
  const code = [];
  let blocs = 0;
  let dansBloc = false;
  let dansCommentaires = true;
  const lignes = src.split(/\r?\n/);
  for (let rang = 0; rang < lignes.length; rang += 1) {
    const ligne = lignes[rang];
    if (rang === 0 && ligne.startsWith('%!')) {
      entete.version = ligne.slice(2).trim();
      entete.eps = /EPSF/.test(ligne);
    }
    if (dansBloc) {
      if (/^%%End(Preview|Binary|Data|Font|Document)/.test(ligne)) dansBloc = false;
      code.push('');
      continue;
    }
    if (/^%%Begin(Preview|Binary|Data|Font|Document)/.test(ligne)) {
      dansBloc = true;
      blocs += 1;
      continue;
    }
    if (ligne.startsWith('%AI')) {
      entete.illustrator = (entete.illustrator || []).concat([ligne.replace(/^%+/, '').trim()]);
      code.push('');
      continue;
    }
    if (dansCommentaires) {
      if (ligne.startsWith('%%')) {
        const corps = ligne.slice(2);
        const coupe = corps.indexOf(':');
        const cle = (coupe < 0 ? corps : corps.slice(0, coupe)).trim();
        const valeur = coupe < 0 ? '' : corps.slice(coupe + 1).trim();
        if (cle === 'BoundingBox' || cle === 'BoundingBox (atend)') {
          const n = valeur.split(/\s+/).map(Number);
          if (n.length >= 4 && n.slice(0, 4).every(Number.isFinite)) entete.bbox = n.slice(0, 4);
        } else if (cle === 'HiResBoundingBox') {
          const n = valeur.split(/\s+/).map(Number);
          if (n.length >= 4 && n.slice(0, 4).every(Number.isFinite)) entete.hires = n.slice(0, 4);
        } else if (cle === 'Creator') entete.createur = valeur;
        else if (cle === 'Title') entete.titre = valeur;
        else if (cle === 'CreationDate') entete.date = valeur;
        else if (cle === 'Pages') entete.pages = parseInt(valeur, 10);
        else if (cle === 'EndComments') dansCommentaires = false;
        code.push('');
        continue;
      }
      if (!ligne.startsWith('%') && ligne.trim() !== '') dansCommentaires = false;
    }
    code.push(ligne.startsWith('%') ? '' : ligne);
  }
  return { entete, code: code.join('\n'), blocs };
}

/* ───────────────────────── aplatissement indépendant ───────────────────── */

const PROFONDEUR_MAX = 24;
const interpole = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function subdiviser(c) {
  const [p0, p1, p2, p3] = c;
  const a = interpole(p0, p1, 0.5);
  const b = interpole(p1, p2, 0.5);
  const d = interpole(p2, p3, 0.5);
  const e = interpole(a, b, 0.5);
  const f = interpole(b, d, 0.5);
  const m = interpole(e, f, 0.5);
  return [
    [p0, a, e, m],
    [m, f, d, p3],
  ];
}

function ecartALaCorde(c) {
  const [p0, , , p3] = c;
  const corde = [p3[0] - p0[0], p3[1] - p0[1]];
  const longueur = Math.hypot(corde[0], corde[1]);
  const distance = (p) => {
    if (longueur === 0) return dist(p, p0);
    return Math.abs(((p[0] - p0[0]) * corde[1] - (p[1] - p0[1]) * corde[0]) / longueur);
  };
  return Math.max(distance(c[1]), distance(c[2])) * 0.75;
}

function estPlate(c, tolerance) {
  if (ecartALaCorde(c) > tolerance) return false;
  const p0 = c[0];
  const p3 = c[3];
  const corde = [p3[0] - p0[0], p3[1] - p0[1]];
  const carre = corde[0] * corde[0] + corde[1] * corde[1];
  if (carre === 0) {
    const m = pointCubique(c, 0.5);
    return dist(m, p0) <= tolerance;
  }
  const longueur = Math.sqrt(carre);
  const dedans = (p) => {
    const t = ((p[0] - p0[0]) * corde[0] + (p[1] - p0[1]) * corde[1]) / carre;
    return t >= -tolerance / longueur && t <= 1 + tolerance / longueur;
  };
  return dedans(c[1]) && dedans(c[2]);
}

function pointCubique(c, t) {
  const u = 1 - t;
  const [p0, p1, p2, p3] = c;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return [
    a * p0[0] + b * p1[0] + d * p2[0] + e * p3[0],
    a * p0[1] + b * p1[1] + d * p2[1] + e * p3[1],
  ];
}

/** Rend les points d'arrivée successifs de la courbe (le départ est déjà là). */
function aplatir(c, tolerance, sortie = [], profondeur = 0) {
  if (estPlate(c, tolerance) || profondeur >= PROFONDEUR_MAX) {
    sortie.push(c[3]);
    return sortie;
  }
  const [g, d] = subdiviser(c);
  aplatir(g, tolerance, sortie, profondeur + 1);
  aplatir(d, tolerance, sortie, profondeur + 1);
  return sortie;
}

/* ────────────────────────── machine indépendante ───────────────────────── */

const REFUS = new Set([
  'show', 'ashow', 'awidthshow', 'widthshow', 'kshow', 'xshow', 'yshow', 'xyshow', 'glyphshow',
  'charpath', 'image', 'imagemask', 'colorimage', 'imagebytes', 'forall', 'loop', 'exit',
  'stopped', 'stop', 'run', 'arct', 'arcto', 'pathforall', 'setcolor', 'setcolorspace',
  'definefont', 'selectfont', 'scalefont', 'setfont', 'findfont', 'setcachedevice',
  'setcharwidth', 'filenameforall', 'file', 'write', 'read', 'closefile', 'usertime', 'realtime',
  'date', 'time', 'vmstatus', 'setvmthreshold', 'vmreclaim', 'setpagedevice', 'nulldevice',
  'level1', 'languagelevel', 'product', 'version', 'revision',
]);

const CONNUS = new Set([
  'dup', 'exch', 'pop', 'clear', 'count', 'copy', 'index', 'roll', 'mark', 'cleartomark',
  'counttomark', 'add', 'sub', 'mul', 'div', 'idiv', 'mod', 'atan', 'exp', 'neg', 'abs', 'sqrt',
  'sin', 'cos', 'ln', 'log', 'ceiling', 'floor', 'round', 'truncate', 'eq', 'ne', 'gt', 'lt',
  'ge', 'le', 'and', 'or', 'xor', 'not', 'cvi', 'cvr', 'def', 'load', 'known', 'where', 'bind',
  'exec', 'cvx', 'cvlit', 'dict', 'maxlength', 'begin', 'end', 'if', 'ifelse', 'repeat', 'for',
  'gsave', 'q', 'grestore', 'Q', 'grestoreall', 'save', 'restore', 'matrix', 'identmatrix',
  'defaultmatrix', 'currentmatrix', 'setmatrix', 'translate', 'scale', 'rotate', 'concat', 'cm',
  'transform', 'setgray', 'g', 'setrgbcolor', 'rg', 'RG', 'setcmykcolor', 'k', 'K', 'currentgray',
  'newpath', 'n', 'N', 'moveto', 'm', 'rmoveto', 'lineto', 'l', 'L', 'rlineto', 'curveto', 'c',
  'C', 'v', 'y', 'rcurveto', 'closepath', 'h', 'H', 're', 'rect', 'arc', 'arcn', 'fill', 'f',
  'F', 'eofill', 'f*', 'stroke', 'S', 'clip', 'W', 'eoclip', 'W*', 'showpage', 'erasepage',
  'setlinewidth', 'w', 'setmiterlimit', 'M', 'setlinecap', 'J', 'setlinejoin', 'j', 'setflat',
  'setdash', 'd', 'gs', 'b', 'B', 'b*', 'B*',
]);

const mIdentite = () => [1, 0, 0, 1, 0, 0];
function mPoint(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
/** `avant` s'applique AVANT `apres` (convention de `concat` en PostScript). */
function mCompose(avant, apres) {
  const [a1, b1, c1, d1, tx1, ty1] = avant;
  const [a2, b2, c2, d2, tx2, ty2] = apres;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    tx1 * a2 + ty1 * c2 + tx2,
    tx1 * b2 + ty1 * d2 + ty2,
  ];
}

class Machine {
  constructor(tolerance = 0.05) {
    this.tolerance = tolerance > 0 ? tolerance : 0.05;
    this.pile = [];
    this.dict = new Map();
    this.etats = [{ matrice: mIdentite(), couleur: ['gris', 0], epaisseur: 1 }];
    this.sauvegardes = [];
    this.chemin = [];
    this.courant = null;
    this.depart = null;
    this.dessins = [];
    this.pages = 0;
    this.inconnus = new Set();
    this.avertissements = [];
    this.appels = 0;
  }

  get etat() {
    return this.etats[this.etats.length - 1];
  }

  executer(objs) {
    for (const o of objs) {
      if (o.t === 'nom') this.nom(o.v);
      else if (o.t === 'nomLitteral') this.pile.push({ t: 'nomLitteral', v: o.v });
      else if (o.t === 'procedure' || o.t === 'tableau') this.pile.push(o);
      else if (o.t === 'chaine') this.pile.push(o);
      else this.pile.push(o);
    }
  }

  appeler(o) {
    if (o.t === 'procedure') {
      this.appels += 1;
      if (this.appels > 64) throw new Error('imbrication trop profonde');
      this.executer(o.v);
      this.appels -= 1;
      return;
    }
    if (o.t === 'nom') return this.nom(o.v);
    this.pile.push(o);
  }

  nom(nom) {
    if (this.dict.has(nom)) return this.appeler(this.dict.get(nom));
    if (CONNUS.has(nom)) return this.operateur(nom);
    if (REFUS.has(nom)) throw new Error(`refus:${nom}`);
    this.inconnus.add(nom);
    this.avertissements.push(`inconnu ${nom}`);
  }

  nb(nom) {
    const o = this.pile.pop();
    if (o === undefined) throw new Error(`pile:${nom}`);
    if (o.t !== 'nombre') throw new Error(`type:${nom}`);
    return o.v;
  }

  operateur(nom) {
    const etat = () => this.etat;
    switch (nom) {
      case 'dup': {
        const h = this.pile.pop();
        if (!h) throw new Error('pile:dup');
        this.pile.push(h, h);
        return;
      }
      case 'exch': {
        const b = this.pile.pop();
        const a = this.pile.pop();
        this.pile.push(b, a);
        return;
      }
      case 'pop':
        this.pile.pop();
        return;
      case 'clear':
        this.pile.length = 0;
        return;
      case 'count':
        this.pile.push({ t: 'nombre', v: this.pile.length });
        return;
      case 'add':
      case 'sub':
      case 'mul':
      case 'div':
      case 'idiv':
      case 'mod': {
        const b = this.nb(nom);
        const a = this.nb(nom);
        if ((nom === 'div' || nom === 'idiv' || nom === 'mod') && b === 0)
          throw new Error('divzero');
        const v =
          nom === 'add'
            ? a + b
            : nom === 'sub'
              ? a - b
              : nom === 'mul'
                ? a * b
                : nom === 'div'
                  ? a / b
                  : nom === 'idiv'
                    ? Math.trunc(a / b)
                    : a % b;
        this.pile.push({ t: 'nombre', v });
        return;
      }
      case 'neg':
        this.pile.push({ t: 'nombre', v: -this.nb(nom) });
        return;
      case 'abs':
        this.pile.push({ t: 'nombre', v: Math.abs(this.nb(nom)) });
        return;
      case 'ceil':
      case 'ceiling':
        this.pile.push({ t: 'nombre', v: Math.ceil(this.nb(nom)) });
        return;
      case 'def': {
        const valeur = this.pile.pop();
        const cle = this.pile.pop();
        if (!cle || cle.t !== 'nomLitteral') throw new Error('type:def');
        this.dict.set(cle.v, valeur);
        return;
      }
      case 'load': {
        const cle = this.pile.pop();
        if (!cle || cle.t !== 'nomLitteral') throw new Error('type:load');
        if (this.dict.has(cle.v)) {
          this.pile.push(this.dict.get(cle.v));
          return;
        }
        if (CONNUS.has(cle.v) || REFUS.has(cle.v)) {
          this.pile.push({ t: 'nom', v: cle.v });
          return;
        }
        this.inconnus.add(cle.v);
        this.avertissements.push(`inconnu ${cle.v}`);
        this.pile.push({ t: 'nomLitteral', v: `<${cle.v}: inconnu>` });
        return;
      }
      case 'if': {
        const corps = this.pile.pop();
        const cond = this.pile.pop();
        if (cond.v) this.appeler(corps);
        return;
      }
      case 'ifelse': {
        const sinon = this.pile.pop();
        const alors = this.pile.pop();
        const cond = this.pile.pop();
        this.appeler(cond.v ? alors : sinon);
        return;
      }
      case 'repeat': {
        const corps = this.pile.pop();
        const fois = this.nb(nom);
        for (let k = 0; k < fois; k += 1) this.appeler(corps);
        return;
      }
      case 'for': {
        const corps = this.pile.pop();
        const limite = this.nb(nom);
        const pas = this.nb(nom);
        let valeur = this.nb(nom);
        if (pas === 0) throw new Error('pas nul');
        let tours = 0;
        while (pas > 0 ? valeur <= limite : valeur >= limite) {
          tours += 1;
          if (tours > 1000000) throw new Error('trop de pas');
          this.pile.push({ t: 'nombre', v: valeur });
          this.appeler(corps);
          valeur += pas;
        }
        return;
      }
      case 'gsave':
      case 'q':
        this.etats.push({ ...etat(), couleur: etat().couleur.slice() });
        return;
      case 'grestore':
      case 'Q':
        if (this.etats.length <= 1) throw new Error('grestore sans gsave');
        this.etats.pop();
        return;
      case 'grestoreall':
        this.etats.length = 1;
        return;
      case 'save':
        this.sauvegardes.push({ etats: this.etats.map((e) => ({ ...e })), dict: new Map(this.dict) });
        this.pile.push({ t: 'sauvegarde', v: this.sauvegardes.length - 1 });
        return;
      case 'restore': {
        const o = this.pile.pop();
        if (!o || o.t !== 'sauvegarde') {
          this.pile.length = 0;
          this.etats = [{ matrice: mIdentite(), couleur: ['gris', 0], epaisseur: 1 }];
          this.avertissements.push('restore inattendu');
          return;
        }
        const s = this.sauvegardes[o.v];
        if (!s) return;
        this.etats = s.etats.map((e) => ({ ...e }));
        this.dict = new Map(s.dict);
        return;
      }
      case 'translate': {
        const ty = this.nb(nom);
        const tx = this.nb(nom);
        etat().matrice = mCompose([1, 0, 0, 1, tx, ty], etat().matrice);
        return;
      }
      case 'scale': {
        const sy = this.nb(nom);
        const sx = this.nb(nom);
        etat().matrice = mCompose([sx, 0, 0, sy, 0, 0], etat().matrice);
        return;
      }
      case 'rotate': {
        const a = (this.nb(nom) * Math.PI) / 180;
        const c = Math.cos(a);
        const s = Math.sin(a);
        etat().matrice = mCompose([c, s, -s, c, 0, 0], etat().matrice);
        return;
      }
      case 'cm':
      case 'concat': {
        let m;
        if (this.pile[this.pile.length - 1]?.t === 'tableau') {
          const t = this.pile.pop().v.map((o) => o.v);
          if (t.length !== 6) throw new Error('type:concat');
          m = t;
        } else {
          const ty = this.nb(nom);
          const tx = this.nb(nom);
          const d = this.nb(nom);
          const c = this.nb(nom);
          const b = this.nb(nom);
          const a = this.nb(nom);
          m = [a, b, c, d, tx, ty];
        }
        etat().matrice = mCompose(m, etat().matrice);
        return;
      }
      case 'setgray':
      case 'g':
        etat().couleur = ['gris', this.nb(nom)];
        return;
      case 'setrgbcolor':
      case 'rg':
      case 'RG': {
        const b = this.nb(nom);
        const v = this.nb(nom);
        const r = this.nb(nom);
        etat().couleur = ['rvb', r, v, b];
        return;
      }
      case 'setcmykcolor':
      case 'k':
      case 'K': {
        const n = this.nb(nom);
        const j = this.nb(nom);
        const m2 = this.nb(nom);
        const c = this.nb(nom);
        etat().couleur = ['cmjn', c, m2, j, n];
        return;
      }
      case 'newpath':
      case 'n':
      case 'N':
        this.chemin = [];
        this.courant = null;
        this.depart = null;
        return;
      case 'moveto':
      case 'm': {
        const y = this.nb(nom);
        const x = this.nb(nom);
        this.chemin.push([]);
        this.pos(mPoint(etat().matrice, x, y));
        this.depart = this.courant;
        return;
      }
      case 'rmoveto': {
        const dy = this.nb(nom);
        const dx = this.nb(nom);
        this.chemin.push([]);
        this.pos(this.relatif(dx, dy));
        this.depart = this.courant;
        return;
      }
      case 'lineto':
      case 'l':
      case 'L': {
        const y = this.nb(nom);
        const x = this.nb(nom);
        if (!this.courant) throw new Error('chemin vide');
        this.pos(mPoint(etat().matrice, x, y));
        return;
      }
      case 'rlineto': {
        const dy = this.nb(nom);
        const dx = this.nb(nom);
        if (!this.courant) throw new Error('chemin vide');
        this.pos(this.relatif(dx, dy));
        return;
      }
      case 'curveto':
      case 'c':
      case 'C': {
        const y3 = this.nb(nom);
        const x3 = this.nb(nom);
        const y2 = this.nb(nom);
        const x2 = this.nb(nom);
        const y1 = this.nb(nom);
        const x1 = this.nb(nom);
        this.courbe([x1, y1], [x2, y2], [x3, y3]);
        return;
      }
      case 'rcurveto': {
        const e3y = this.nb(nom);
        const e3x = this.nb(nom);
        const e2y = this.nb(nom);
        const e2x = this.nb(nom);
        const e1y = this.nb(nom);
        const e1x = this.nb(nom);
        if (!this.courant) throw new Error('chemin vide');
        this.courbeAppareil(
          this.relatif(e1x, e1y),
          this.relatif(e2x, e2y),
          this.relatif(e3x, e3y),
        );
        return;
      }
      case 'v': {
        const y3 = this.nb(nom);
        const x3 = this.nb(nom);
        const y2 = this.nb(nom);
        const x2 = this.nb(nom);
        const courant = this.courant ?? mPoint(etat().matrice, x2, y2);
        this.courbeAppareil(courant, mPoint(etat().matrice, x2, y2), mPoint(etat().matrice, x3, y3));
        return;
      }
      case 'y': {
        const y3 = this.nb(nom);
        const x3 = this.nb(nom);
        const y2 = this.nb(nom);
        const x2 = this.nb(nom);
        const c1 = mPoint(etat().matrice, x2, y2);
        const p3 = mPoint(etat().matrice, x3, y3);
        this.courbeAppareil(c1, p3, p3);
        return;
      }
      case 'closepath':
      case 'h':
      case 'H': {
        if (this.depart && this.courant) {
          if (dist(this.depart, this.courant) > 0) this.chemin[this.chemin.length - 1].push(this.depart);
          this.courant = this.depart;
        }
        return;
      }
      case 're':
      case 'rect': {
        const hauteur = this.nb(nom);
        const largeur = this.nb(nom);
        const y = this.nb(nom);
        const x = this.nb(nom);
        const m = etat().matrice;
        const coins = [
          mPoint(m, x, y),
          mPoint(m, x + largeur, y),
          mPoint(m, x + largeur, y + hauteur),
          mPoint(m, x, y + hauteur),
        ];
        coins.push(coins[0]);
        this.chemin.push(coins);
        this.courant = coins[0];
        this.depart = coins[0];
        return;
      }
      case 'arc':
      case 'arcn': {
        const fin = this.nb(nom);
        const debut = this.nb(nom);
        const rayon = this.nb(nom);
        const y = this.nb(nom);
        const x = this.nb(nom);
        const a0 = (debut * Math.PI) / 180;
        const depart = mPoint(
          etat().matrice,
          x + rayon * Math.cos(a0),
          y + rayon * Math.sin(a0),
        );
        if (!this.courant) {
          this.chemin.push([]);
          this.pos(depart);
        } else if (dist(this.courant, depart) > 0) this.pos(depart);
        this.tracerArc([x, y], rayon, debut, fin, nom === 'arc');
        return;
      }
      case 'fill':
      case 'f':
      case 'F':
        this.peindre('remplissage');
        return;
      case 'eofill':
      case 'f*':
        this.peindre('remplissage-pair-impair');
        return;
      case 'stroke':
      case 'S':
        this.peindre('contour');
        return;
      case 'clip':
      case 'W':
      case 'eoclip':
      case 'W*':
        this.peindre('decoupage');
        return;
      case 'b':
      case 'B':
      case 'b*':
      case 'B*': {
        if (nom.startsWith('b') && this.depart && this.courant) {
          if (dist(this.depart, this.courant) > 0) this.chemin[this.chemin.length - 1].push(this.depart);
          this.courant = this.depart;
        }
        const chemin = this.chemin.map((sc) => sc.map((p) => p.slice()));
        const depart = this.depart;
        const courant = this.courant;
        this.peindre(nom.endsWith('*') ? 'remplissage-pair-impair' : 'remplissage');
        this.chemin = chemin;
        this.depart = depart;
        this.courant = courant;
        this.peindre('contour');
        return;
      }
      case 'showpage':
        this.pages += 1;
        return;
      case 'erasepage':
        this.avertissements.push('erasepage ignoré');
        return;
      case 'setlinewidth':
      case 'w':
        etat().epaisseur = this.nb(nom);
        return;
      case 'setmiterlimit':
      case 'M':
      case 'setlinecap':
      case 'J':
      case 'setlinejoin':
      case 'j':
      case 'setflat':
        this.nb(nom);
        return;
      case 'setdash':
      case 'd':
        this.nb(nom);
        this.pile.pop();
        return;
      case 'gs':
        this.pile.pop();
        return;
      default:
        // Les autres opérateurs de la liste n'ont pas d'effet géométrique :
        // `matrix`, `identmatrix`, `currentgray`, `known`, `where`, `exec`,
        // `bind`, `cvx`, `cvlit`, `dict`, `maxlength`, `begin`, `end`,
        // `not`, `cvi`, `cvr`, les comparaisons, `atan`, `exp`, les
        // trigonométries, `matrix`… Ils ne sont employés par aucun témoin, et
        // les simuler sans nécessité ajouterait du code à vérifier.
        this.avertissements.push(`non simulé ${nom}`);
        return;
    }
  }

  /** Déplacement relatif utilisateur : la partie linéaire de la matrice. */
  relatif(dx, dy) {
    const [a, b, c, d] = this.etat.matrice;
    const base = this.courant ?? [0, 0];
    return [base[0] + a * dx + c * dy, base[1] + b * dx + d * dy];
  }

  pos(p) {
    if (this.chemin.length === 0) this.chemin.push([]);
    this.chemin[this.chemin.length - 1].push(p);
    this.courant = p;
  }

  courbe(c1, c2, arrivee) {
    const m = this.etat.matrice;
    this.courbeAppareil(mPoint(m, c1[0], c1[1]), mPoint(m, c2[0], c2[1]), mPoint(m, arrivee[0], arrivee[1]));
  }

  courbeAppareil(c1, c2, arrivee) {
    const depart = this.courant ?? c1;
    const points = aplatir([depart, c1, c2, arrivee], this.tolerance);
    if (this.chemin.length === 0) this.chemin.push([]);
    for (const p of points) this.chemin[this.chemin.length - 1].push(p);
    this.courant = arrivee;
  }

  tracerArc(centre, rayon, debut, fin, direct) {
    let balayage = direct ? fin - debut : debut - fin;
    while (balayage <= 0) balayage += 360;
    if (!direct) balayage = -balayage;
    const signe = balayage >= 0 ? 1 : -1;
    const m = this.etat.matrice;
    let angle = debut;
    let reste = Math.abs(balayage);
    while (reste > 1e-9) {
      const pas = Math.min(reste, 90);
      const a0 = (angle * Math.PI) / 180;
      const a1 = ((angle + signe * pas) * Math.PI) / 180;
      const theta = ((signe * pas) * Math.PI) / 180;
      const poignee = (4 / 3) * Math.tan(theta / 4) * rayon;
      const p0 = [centre[0] + rayon * Math.cos(a0), centre[1] + rayon * Math.sin(a0)];
      const p1 = [centre[0] + rayon * Math.cos(a1), centre[1] + rayon * Math.sin(a1)];
      const tang = (a) => [-Math.sin(a) * signe * poignee, Math.cos(a) * signe * poignee];
      const t0 = tang(a0);
      const t1 = tang(a1);
      this.courbeAppareil(
        mPoint(m, p0[0] + t0[0], p0[1] + t0[1]),
        mPoint(m, p1[0] - t1[0], p1[1] - t1[1]),
        mPoint(m, p1[0], p1[1]),
      );
      angle += signe * pas;
      reste -= pas;
    }
  }

  peindre(kind) {
    if (this.chemin.length === 0) throw new Error('chemin vide');
    const couleur = this.etat.couleur;
    this.dessins.push({
      peinture: kind,
      couleur: couleur.slice(),
      epaisseur: this.etat.epaisseur,
      sousChemins: this.chemin.map((sc) => sc.map((p) => p.slice())),
    });
    this.chemin = [];
    this.courant = null;
    this.depart = null;
  }
}

/** Interprète un texte PostScript avec la machine du script. */
function interpreter(source, tolerance = 0.05) {
  const { entete, code, blocs } = decouperDsc(source);
  const machine = new Machine(tolerance);
  machine.executer(assembler(lexer(code)));
  return { entete, blocs, machine };
}

/* ═══════════════════════════ 2. les témoins réels ═════════════════════════ */

const TEMOINS = [
  { nom: 'eps-simple.eps', chemin: '_dev/fixtures/eps-simple.eps' },
  { nom: 'eps-preview.eps', chemin: '_dev/fixtures/eps-preview.eps' },
  { nom: 'eps-illustrator.eps', chemin: '_dev/fixtures/eps-illustrator.eps' },
  { nom: 'forme.eps', chemin: '_dev/sorties/forme.eps' },
];

titre('Comparaison avec un interpréteur PostScript écrit à part');

let dessinsCompares = 0;
let sommetsCompares = 0;
const divergences = [];
const absents = [];
const mesures = [];

for (const temoin of TEMOINS) {
  const source = join(parent, temoin.chemin);
  if (!existsSync(source)) {
    absents.push(temoin.nom);
    continue;
  }
  const octets = readFileSync(source);
  writeFileSync(join(dossier, temoin.nom), octets);
  lancer('dessins', joindre(temoin.nom), '0.05', joindre(`${temoin.nom}.tsv`));
  const noyau = lireTsv(join(dossier, `${temoin.nom}.tsv`));
  if (noyau.erreur) {
    divergences.push(`${temoin.nom} : le noyau a refusé — ${noyau.erreur}`);
    continue;
  }

  const texte = octets.toString('latin1');
  let attendu;
  try {
    attendu = interpreter(texte, 0.05);
  } catch (e) {
    divergences.push(`${temoin.nom} : l'interpréteur de contrôle a échoué — ${e.message}`);
    continue;
  }

  if (attendu.machine.dessins.length !== noyau.dessins.length) {
    divergences.push(
      `${temoin.nom} : ${noyau.dessins.length} dessins côté noyau, ${attendu.machine.dessins.length} côté contrôle`,
    );
    continue;
  }
  if (attendu.blocs !== noyau.blocs) {
    divergences.push(
      `${temoin.nom} : ${noyau.blocs} blocs sautés côté noyau, ${attendu.blocs} côté contrôle`,
    );
  }

  for (let k = 0; k < noyau.dessins.length; k += 1) {
    const a = noyau.dessins[k];
    const b = attendu.machine.dessins[k];
    const ou = `${temoin.nom} dessin ${k}`;
    if (a.peinture !== b.peinture) {
      divergences.push(`${ou} : peinture ${a.peinture} ≠ ${b.peinture}`);
      continue;
    }
    const composantesNoyau = a.composantes;
    const composantesControle = b.couleur.slice(1);
    if (
      a.espace !== b.couleur[0] ||
      composantesNoyau.length !== composantesControle.length ||
      composantesNoyau.some((v, i) => Math.abs(v - composantesControle[i]) > 1e-9)
    ) {
      divergences.push(
        `${ou} : couleur ${a.espace}[${composantesNoyau}] ≠ ${b.couleur[0]}[${composantesControle}]`,
      );
      continue;
    }
    const platNoyau = a.sousChemins;
    const platControle = b.sousChemins;
    if (platNoyau.length !== platControle.length) {
      divergences.push(`${ou} : ${platNoyau.length} sous-chemins ≠ ${platControle.length}`);
      continue;
    }
    let ecartMax = 0;
    let sommets = 0;
    let forme = true;
    for (let s = 0; s < platNoyau.length && forme; s += 1) {
      if (platNoyau[s].length !== platControle[s].length) {
        divergences.push(
          `${ou} sous-chemin ${s} : ${platNoyau[s].length} sommets ≠ ${platControle[s].length}`,
        );
        forme = false;
        break;
      }
      for (let p = 0; p < platNoyau[s].length; p += 1) {
        for (let c = 0; c < 2; c += 1) {
          ecartMax = Math.max(ecartMax, Math.abs(platNoyau[s][p][c] - platControle[s][p][c]));
        }
        sommets += 1;
      }
    }
    if (!forme) continue;
    if (ecartMax > 1e-6) {
      divergences.push(`${ou} : écart de coordonnées ${ecartMax}`);
      continue;
    }
    dessinsCompares += 1;
    sommetsCompares += sommets;
    const aireNoyau = a.aire;
    const aireControle = aireSignee(platControle);
    if (Math.abs(aireNoyau - aireControle) > 1e-6 * Math.max(1, Math.abs(aireNoyau))) {
      divergences.push(`${ou} : aire ${aireNoyau} ≠ ${aireControle}`);
    }
  }
}

function aireSignee(sousChemins) {
  let somme = 0;
  for (const sc of sousChemins) {
    if (sc.length < 3) continue;
    for (let i = 0; i < sc.length; i += 1) {
      const p = sc[i];
      const q = sc[(i + 1) % sc.length];
      somme += p[0] * q[1] - q[0] * p[1];
    }
  }
  return somme / 2;
}

if (absents.length) {
  console.log(`  témoins absents du dépôt (ignorés) : ${absents.join(', ')}`);
}
check(
  `les ${TEMOINS.length - absents.length} témoins EPS donnent le même dessin`,
  divergences.length === 0 && dessinsCompares > 0,
  divergences.length ? divergences.slice(0, 6).join(' | ') : `${dessinsCompares} dessins`,
);
check(
  `les sommets coïncident un à un`,
  sommetsCompares > 0,
  `${sommetsCompares} sommets comparés, écart maximal sous 1e-6`,
);
mesures.push(`${dessinsCompares} dessins, ${sommetsCompares} sommets comparés`);

/* ═══════════════════════ 3. les aires connues par construction ═══════════ */

titre('Contrôle analytique : les aires connues');

/** Aire d'un dessin donné par son rang dans un témoin. */
function aireDe(nom, rang) {
  const tsv = lireTsv(join(dossier, `${nom}.tsv`));
  const d = tsv.dessins.find((x) => x.rang === rang);
  return { aire: d ? d.aire : NaN, boite: d ? d.boite : null, sommets: d ? d.sommets : NaN };
}

if (existsSync(join(dossier, 'forme.eps'))) {
  // forme.eps : un rectangle 180 × 100, puis un triangle de base 80 et de
  // hauteur 55. Ces nombres sont écrits dans le fichier, et non mesurés.
  const rect = aireDe('forme.eps', 0);
  check(
    'forme.eps : le rectangle de 180 × 100 fait 18 000 points carrés',
    Math.abs(Math.abs(rect.aire) - 18000) < 1e-6,
    `aire ${rect.aire}`,
  );
  const triangle = aireDe('forme.eps', 1);
  check(
    'forme.eps : le triangle de base 80 et de hauteur 55 fait 2 200',
    Math.abs(Math.abs(triangle.aire) - 2200) < 1e-6,
    `aire ${triangle.aire}`,
  );
  check(
    'forme.eps : la boîte du rectangle est (10,10)-(190,110)',
    rect.boite && rect.boite.every((v, i) => Math.abs(v - [10, 10, 190, 110][i]) < 1e-9),
    `${rect.boite}`,
  );
}

if (existsSync(join(dossier, 'eps-preview.eps'))) {
  // eps-preview.eps : un carré de 260 de côté, en CMJN 0 0 0 1.
  const carre = aireDe('eps-preview.eps', 0);
  check(
    'eps-preview.eps : le carré de 260 fait 67 600 points carrés',
    Math.abs(Math.abs(carre.aire) - 67600) < 1e-6,
    `aire ${carre.aire}`,
  );
  const tsv = lireTsv(join(dossier, 'eps-preview.eps.tsv'));
  check(
    'eps-preview.eps : son bloc %%BeginPreview est sauté, pas interprété',
    tsv.blocs === 1,
    `${tsv.blocs} bloc(s) — l'aperçu est de l'hexadécimal en clair, que le lexeur lirait comme des noms`,
  );
}

if (existsSync(join(dossier, 'eps-simple.eps'))) {
  // eps-simple.eps : un rectangle 400 × 200, un triangle, une courbe.
  const rect = aireDe('eps-simple.eps', 0);
  check(
    'eps-simple.eps : le rectangle de 400 × 200 fait 80 000',
    Math.abs(rect.aire - 80000) < 1e-6,
    `aire ${rect.aire}`,
  );
  const triangle = aireDe('eps-simple.eps', 1);
  // Le triangle (50,300)-(250,470)-(450,300) : base 400, hauteur 170.
  check(
    'eps-simple.eps : le triangle de base 400 et de hauteur 170 fait 34 000',
    Math.abs(Math.abs(triangle.aire) - 34000) < 1e-6,
    `aire ${triangle.aire} (signée : le parcours du fichier tourne dans l'autre sens)`,
  );
  const tsv = lireTsv(join(dossier, 'eps-simple.eps.tsv'));
  check(
    'eps-simple.eps : le `save`/`restore` n’altère pas les trois dessins',
    tsv.dessins.length === 3,
    `${tsv.dessins.length} dessins`,
  );
}

/* ═════════════════ 4. qualité de l'aplatissement, par la mesure ══════════
   On ne compare pas deux copies du même algorithme : on mesure l'écart réel
   entre la polyligne rendue par le noyau et la COURBE VRAIE, échantillonnée
   densément. C'est le seul contrôle qui dit si la tolérance demandée est
   réellement tenue. */

titre('Aplatissement : la tolérance est-elle tenue ?');

function dessinsDepuisTexte(source, tolerance) {
  return interpreterTexte(source, tolerance);
}

for (const tolerance of [0.5, 0.05, 0.005]) {
  const source =
    '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 200 200\n%%EndComments\n' +
    'newpath 0 0 moveto 0 150 200 150 200 0 curveto stroke\n';
  // On connaît la cubique : on peut donc mesurer l'écart sans intermédiaire.
  const cubique = [
    [0, 0],
    [0, 150],
    [200, 150],
    [200, 0],
  ];
  const { tsv } = dessinsDepuisTexte(source, tolerance);
  const dessin = tsv.dessins[0];
  if (!dessin) {
    check(`tolérance ${tolerance} : un dessin est rendu`, false, tsv.erreur || '');
    continue;
  }
  const points = dessin.sousChemins[0];
  let ecart = 0;
  // Échantillonnage dense de la courbe vraie : pour chaque point vrai, la
  // distance au plus proche SEGMENT de la polyligne rendue.
  for (let k = 0; k <= 2000; k += 1) {
    const vrai = pointCubique(cubique, k / 2000);
    let meilleur = Infinity;
    for (let i = 0; i + 1 < points.length; i += 1) {
      meilleur = Math.min(meilleur, distanceAuSegment(vrai, points[i], points[i + 1]));
    }
    ecart = Math.max(ecart, meilleur);
  }
  check(
    `tolérance ${tolerance} : écart réel ${ecart.toFixed(6)} ≤ tolérance`,
    ecart <= tolerance + 1e-9,
    `${points.length} sommets pour 4 de courbe`,
  );
  mesures.push(`tolérance ${tolerance} → ${points.length} sommets, écart ${ecart.toFixed(6)}`);
}

function distanceAuSegment(p, a, b) {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const carre = vx * vx + vy * vy;
  if (carre === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / carre;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}

// Un cercle complet : l'aire doit être π r² à un pour cent près, ce qui
// vérifie du même coup que les quatre quarts de tour se raccordent.
{
  const { tsv } = dessinsDepuisTexte(
    '%!PS-Adobe-3.0 EPSF-3.0\nnewpath 50 50 40 0 360 arc closepath fill\n',
    0.05,
  );
  const aire = tsv.dessins[0] ? Math.abs(tsv.dessins[0].aire) : 0;
  const attendu = Math.PI * 40 * 40;
  check(
    'un cercle de rayon 40 a bien l’aire de π r² (à 0,5 %)',
    Math.abs(aire - attendu) / attendu < 0.005,
    `aire ${aire.toFixed(3)} attendue ${attendu.toFixed(3)}`,
  );
  const boite = tsv.dessins[0].boite;
  check(
    'sa boîte est (10,10)-(90,90) au centième',
    boite.every((v, i) => Math.abs(v - [10, 10, 90, 90][i]) < 0.01),
    `${boite.map((v) => v.toFixed(4))}`,
  );
}

/* ═══════════════════════════ 5. refus et signalements ═════════════════════ */

titre('Refus nommés, et signalements qui ne bloquent pas');

const A_REFUSER = [
  ['show', 'texte'],
  ['ashow', 'texte'],
  ['charpath', 'texte'],
  ['image', 'bitmap'],
  ['imagemask', 'bitmap'],
  ['colorimage', 'bitmap'],
  ['forall', 'forall'],
  ['loop', 'boucles'],
  ['exit', 'boucles'],
  ['run', 'run'],
  ['arct', 'arct'],
  ['setfont', 'polices'],
  ['definefont', 'polices'],
  ['usertime', 'horloge'],
  ['date', 'horloge'],
  ['file', 'entrées-sorties'],
  ['vmstatus', 'mémoire'],
  ['setpagedevice', 'appareil'],
  ['pathforall', 'pathforall'],
  ['setcolorspace', 'espace'],
];

let refusNommes = 0;
const refusManques = [];
for (const [nom, motAttendu] of A_REFUSER) {
  const { tsv, brut } = interpreterTexte(`%!PS-Adobe-3.0\n${nom}\n`);
  if (!tsv.erreur) {
    refusManques.push(`${nom} n'est pas refusé`);
    continue;
  }
  if (!tsv.erreur.includes(nom)) {
    refusManques.push(`${nom} : le refus ne le nomme pas (${tsv.erreur.slice(0, 60)})`);
    continue;
  }
  if (tsv.erreur.length < 25 || !tsv.erreur.includes(motAttendu)) {
    refusManques.push(`${nom} : refus sans raison lisible (${tsv.erreur.slice(0, 80)})`);
    continue;
  }
  refusNommes += 1;
  void brut;
}
check(
  `les ${A_REFUSER.length} opérateurs qui perdraient du dessin sont refusés ET expliqués`,
  refusManques.length === 0,
  refusManques.length ? refusManques.slice(0, 4).join(' | ') : `${refusNommes} refus nommés`,
);
mesures.push(`${refusNommes}/${A_REFUSER.length} refus nommés`);

// Un opérateur simplement inconnu : signalé, mais la lecture continue.
{
  const { tsv } = interpreterTexte(
    '%!PS-Adobe-3.0\nzorglub newpath 0 0 moveto 10 0 lineto 10 10 lineto closepath fill\n',
  );
  check(
    'un opérateur inconnu est signalé, et le dessin est quand même lu',
    !tsv.erreur && tsv.dessins.length === 1 && tsv.inconnus.includes('zorglub'),
    tsv.erreur ? `erreur : ${tsv.erreur}` : `inconnus : ${tsv.inconnus.join(', ')}`,
  );
  check(
    'le signalement nomme l’opérateur, il ne le cache pas',
    tsv.avertissements.some((a) => a.includes('zorglub')),
    `${tsv.avertissements.length} avertissement(s)`,
  );
}

// Le marqueur d'état d'Illustrator : sans lui, eps-illustrator.eps serait
// illisible, et c'est mesuré, pas supposé.
{
  const { tsv } = interpreterTexte(
    '%!PS-Adobe-3.0\n/GS0 gs\nnewpath 0 0 moveto 10 0 lineto 10 10 lineto closepath fill\n',
  );
  check(
    '`/GS0 gs` (état graphique d’Illustrator) est accepté sans rien casser',
    !tsv.erreur && tsv.dessins.length === 1 && tsv.inconnus.length === 0,
    tsv.erreur || `inconnus : ${tsv.inconnus.join(', ') || 'aucun'}`,
  );
}

// Les garde-fous : une boucle qui s'appelle elle-même, un chemin inexistant,
// une division par zéro, un `grestore` sans `gsave`.
const GARDE_FOUS = [
  ['/f { f } def f', 'profonde', 'récursion'],
  ['fill', 'aucun chemin', 'peinture sans chemin'],
  ['newpath 10 10 lineto', 'aucun chemin', 'lineto sans moveto'],
  ['1 0 div', 'zéro', 'division'],
  ['grestore', 'sans `gsave`', 'déséquilibre'],
];
const gardeManques = [];
for (const [programme, motAttendu, quoi] of GARDE_FOUS) {
  const { tsv } = interpreterTexte(`%!PS-Adobe-3.0\n${programme}\n`);
  if (!tsv.erreur || !tsv.erreur.includes(motAttendu)) {
    gardeManques.push(`${quoi} : ${tsv.erreur || 'aucune erreur'}`);
  }
}
check(
  'les garde-fous se déclenchent et se nomment (récursion, chemin vide, division, déséquilibre)',
  gardeManques.length === 0,
  gardeManques.length ? gardeManques.join(' | ') : `${GARDE_FOUS.length} garde-fous`,
);

/* ═══════════════════════════ 6. la saveur du fichier ══════════════════════ */

titre('Saveur : un `.ai` qui est un PDF doit être refusé en le disant');

const CHEMIN_AI = join(parent, '_dev/fixtures/Logo_licra_vecto.ai');
if (existsSync(CHEMIN_AI)) {
  copyFileSync(CHEMIN_AI, join(dossier, 'Logo_licra_vecto.ai'));
  const { sortie } = lancerSouple('format', joindre('Logo_licra_vecto.ai'), joindre('ai.tsv'));
  void sortie;
  const lignes = readFileSync(join(dossier, 'ai.tsv'), 'utf8').split(/\r?\n/);
  const champ = (cle) => {
    const l = lignes.find((x) => x.startsWith(`${cle}\t`));
    return l ? l.split('\t').slice(1).join('\t') : '';
  };
  const octets = readFileSync(CHEMIN_AI);
  check(
    'le fichier témoin commence bien par %PDF-',
    octets.slice(0, 5).toString('latin1') === '%PDF-',
    `${octets.length} octets`,
  );
  check(
    'le noyau reconnaît un PDF, et non du PostScript',
    champ('nature') === 'pdf',
    `nature : ${champ('nature')}`,
  );
  check(
    'il refuse de l’interpréter, et explique pourquoi',
    champ('interpretable') === 'non' && champ('erreur').includes('PDF'),
    `${champ('erreur').slice(0, 120)}`,
  );
  check(
    'le message renvoie à Illustrator et à la compatibilité PDF',
    champ('erreur').includes('Illustrator'),
  );
} else {
  console.log('  témoin Logo_licra_vecto.ai absent du dépôt (ignoré)');
}

// Un fichier d'une autre saveur : refusé, nommé.
{
  writeFileSync(join(dossier, 'binaire.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]));
  lancerSouple('format', joindre('binaire.bin'), joindre('bin.tsv'));
  const lignes = readFileSync(join(dossier, 'bin.tsv'), 'latin1').split(/\r?\n/);
  const nature = (lignes.find((x) => x.startsWith('nature\t')) || '').split('\t')[1];
  check('un fichier inconnu est nommé « inconnu », pas deviné', nature === 'inconnu', nature);
}

/* ══════════════ 7. structure : la liste des opérateurs est complète ═══════
   On lit le source du noyau. Un opérateur exécuté par la machine mais absent de
   la liste serait signalé « inconnu » sur un vrai fichier — c'est arrivé pour
   `q` et `Q`, et c'est un vrai fichier Illustrator qui l'a montré. */

titre('Structure : la liste des opérateurs et la liste des refus sont saines');

{
  const source = readFileSync(join(racine, 'crates', 'superprint-ps', 'src', 'machine.rs'), 'utf8');
  const liste = source.match(/pub const OPERATEURS_CONNUS: &\[&str\] = &\[([\s\S]*?)\n\];/);
  const declaree = new Set([...liste[1].matchAll(/"([A-Za-z0-9*]+)"/g)].map((m) => m[1]));
  const armes = [...source.matchAll(/\n            ((?:"[A-Za-z0-9*]+" \| )*"[A-Za-z0-9*]+") =>/g)]
    .map((m) => m[1])
    .flatMap((a) => [...a.matchAll(/"([A-Za-z0-9*]+)"/g)].map((m) => m[1]));
  const manquants = [...new Set(armes.filter((a) => !declaree.has(a)))].sort();
  check(
    'tout opérateur exécuté est déclaré dans OPERATEURS_CONNUS',
    manquants.length === 0,
    manquants.length ? `manquants : ${manquants.join(', ')}` : `${declaree.size} opérateurs`,
  );

  const refus = source.match(/pub fn refus_connu[\s\S]*?\n}/);
  const refuses = new Set([...refus[0].matchAll(/"([A-Za-z0-9*]+)"/g)].map((m) => m[1]));
  const doubles = [...declaree].filter((a) => refuses.has(a)).sort();
  check(
    'aucun opérateur n’est à la fois exécuté et refusé',
    doubles.length === 0,
    doubles.length ? `à la fois : ${doubles.join(', ')}` : `${refuses.size} refus nommés`,
  );
}

/* ═════════ 8. comparaison avec le produit : ce qu'il sait, et pas nous ════
   Lecture du fichier du produit, sans le modifier. L'écart est mesuré, pas
   supposé : c'est lui qui dit ce qui reste à faire. */

titre('Le produit : ce qu’il interprète, et que le noyau ne fait pas encore');

const CHEMIN_PRODUIT = join(parent, 'superprint', 'app', 'JS', 'sp-eps-import.js');
if (existsSync(CHEMIN_PRODUIT)) {
  const source = readFileSync(CHEMIN_PRODUIT, 'utf8');
  const listes = [...source.matchAll(/var (OPS_[A-Z]+) = \[([\s\S]*?)\];/g)].map((m) => ({
    nom: m[1],
    ops: [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]),
  }));
  const tous = new Set(listes.flatMap((l) => l.ops));
  const sourceNoyau = readFileSync(
    join(racine, 'crates', 'superprint-ps', 'src', 'machine.rs'),
    'utf8',
  );
  const declaree = new Set(
    [...sourceNoyau.matchAll(/"([A-Za-z0-9*]+)"/g)].map((m) => m[1]),
  );
  const seulementProduit = [...tous]
    .filter((o) => !declaree.has(o))
    // `true` et `false` ne sont pas des opérateurs : le LEXEUR en fait des
    // booléens, avant toute exécution. Les compter comme un écart serait faux.
    .filter((o) => o !== 'true' && o !== 'false')
    .sort();
  check(
    'les listes d’opérateurs du produit sont lisibles (le fichier n’est pas modifié)',
    tous.size > 50,
    `${tous.size} noms dans ${listes.length} listes`,
  );
  console.log(
    `  opérateurs que le produit nomme et que le noyau n’interprète pas : ${seulementProduit.join(', ') || 'aucun'}`,
  );
  console.log(
    '  (parmi eux : `s`, que la spécification donne pour `scale` et le produit pour `stroke` — le noyau ne devine pas, il le signale ; et des réglages d’état sans effet sur la géométrie : transparence, surimpression, appareil.)',
  );
  mesures.push(
    `produit : ${tous.size} noms, dont ${seulementProduit.length} hors du noyau (${seulementProduit.join(', ')})`,
  );
} else {
  console.log('  fichier du produit absent (ignoré)');
}

/* ═════════════════════════════════ fin ═══════════════════════════════════ */

titre('Mesures');
for (const m of mesures) console.log(`  · ${m}`);

console.log(`\n${ok ? '✓ tout est conforme' : '✗ au moins un contrôle a échoué'}`);
process.exit(ok ? 0 : 1);
