/* ══════════════════════════════════════════════════════════════════════════
   validate-doc.mjs — l'import de documents, mis à l'épreuve.

   Le produit importait un .docx avec Mammoth (621 Ko) et son propre analyseur
   XML, un .odt avec le DOMParser du navigateur, et un .idml avec du code
   maison. Le noyau fait les trois. Ce script vérifie ce qu'il fait, sans lui
   faire confiance, et de quatre façons :

     1. EXTRACTEUR INDÉPENDANT. Le script écrit son propre analyseur XML et ses
        propres extracteurs pour les trois formats, puis compare paragraphe par
        paragraphe avec ce que le noyau rend.
     2. INVARIANTE DE TEXTE. Le texte importé, espaces ôtés, doit être
        exactement le texte brut du XML, espaces ôtés. Rien de perdu, rien
        d'inventé. C'est l'invariante qui attrape ce qu'une comparaison
        paragraphe par paragraphe peut manquer.
     3. FORMATS DE PAGE. Le script recalcule les millimètres depuis les unités
        d'origine (vingtièmes de point, centimètres, points).
     4. REFUS. Un .rtf renommé, une archive qui n'est pas un document, un
        classeur ODF renommé en .odt, un XML abîmé, une entité inconnue.

   Usage : node scripts/validate-doc.mjs
   Retour : 0 si tout passe, 1 sinon.
   ══════════════════════════════════════════════════════════════════════════ */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, '..');
const parent = join(racine, '..');
const cheminExemple = join(
  racine,
  'target',
  'wasm32-wasip1',
  'release',
  'examples',
  'doc_dump.wasm',
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
    '(construire : cargo build -p superprint-doc --example doc_dump --target wasm32-wasip1 --release)',
  );
  process.exit(2);
}

const dossier = join(racine, 'target', 'doc');
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
function lancerSouple(...args) {
  try {
    return { code: 0, sortie: lancer(...args) };
  } catch (e) {
    return { code: e.status ?? 1, sortie: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

/* ─────────────────── analyseur XML indépendant ───────────────────────────
   Écrit ici, sans paquet, avec une méthode différente de celle du Rust : on
   découpe le document en jetons par expression régulière, puis on assemble.
   Deux implémentations de la même idée valent mieux qu'une crue sur parole. */

const ENTITES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: '\u00a0', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', hellip: '\u2026',
  mdash: '\u2014', ndash: '\u2013', lsquo: '\u2018', rsquo: '\u2019',
  ldquo: '\u201c', rdquo: '\u201d', laquo: '\u00ab', raquo: '\u00bb',
  times: '\u00d7', divide: '\u00f7', deg: '\u00b0', euro: '\u20ac',
};

function decoderEntites(texte) {
  return texte.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (tout, corps) => {
    if (corps[0] === '#') {
      const point =
        corps[1] === 'x' || corps[1] === 'X'
          ? parseInt(corps.slice(2), 16)
          : parseInt(corps.slice(1), 10);
      if (!Number.isFinite(point) || point > 0x10ffff) throw new Error(`entité invalide : ${tout}`);
      return String.fromCodePoint(point);
    }
    if (Object.hasOwn(ENTITES, corps)) return ENTITES[corps];
    throw new Error(`entité inconnue : ${tout}`);
  });
}

/**
 * Analyse un document XML et rend un arbre `{ nom, attributs, enfants }` où
 * `enfants` contient des chaînes (texte) et d'autres nœuds.
 */
function analyserXml(source) {
  const racine = { nom: '#racine', attributs: {}, enfants: [] };
  const pile = [racine];
  const jetons =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[?][\s\S]*?[?]>|<!DOCTYPE[^>]*>|<\/[^>]+>|<[^>]+>|[^<]+/g;
  let jeton;
  while ((jeton = jetons.exec(source)) !== null) {
    const br = jeton[0];
    const parent = pile[pile.length - 1];
    if (br.startsWith('<!--') || br.startsWith('<?') || br.startsWith('<!DOCTYPE')) continue;
    if (br.startsWith('<![CDATA[')) {
      parent.enfants.push(br.slice(9, -3));
      continue;
    }
    if (br.startsWith('</')) {
      const nom = br.slice(2, -1).trim();
      const ouvert = pile[pile.length - 1];
      if (pile.length < 2 || ouvert.nom !== nom) {
        throw new Error(`balise fermante </${nom}> sans ouverture`);
      }
      pile.pop();
      continue;
    }
    if (br.startsWith('<')) {
      const autoFermante = br.endsWith('/>');
      const corps = br.slice(1, autoFermante ? -2 : -1);
      const espace = corps.search(/[\s/]/);
      const nom = espace < 0 ? corps : corps.slice(0, espace);
      if (!nom) throw new Error(`balise illisible : ${br}`);
      const attributs = {};
      const motif = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')|([^\s=]+)/g;
      let a;
      while ((a = motif.exec(corps.slice(nom.length))) !== null) {
        if (a[1]) attributs[a[1]] = decoderEntites(a[3] ?? a[4] ?? '');
        else if (a[5]) attributs[a[5]] = '';
      }
      const noeud = { nom, attributs, enfants: [] };
      parent.enfants.push(noeud);
      if (!autoFermante) pile.push(noeud);
      continue;
    }
    parent.enfants.push(decoderEntites(br));
  }
  if (pile.length !== 1) throw new Error(`balise ouverte non fermée : <${pile[pile.length - 1].nom}>`);
  const elements = racine.enfants.filter((e) => typeof e !== 'string');
  if (elements.length !== 1) throw new Error('le document doit avoir un seul élément racine');
  return elements[0];
}

const local = (nom) => (nom.includes(':') ? nom.slice(nom.indexOf(':') + 1) : nom);

function enfants(element, nom) {
  return element.enfants.filter((e) => typeof e !== 'string' && (nom === undefined || local(e.nom) === nom || e.nom === nom));
}
function premier(element, nom) {
  return enfants(element, nom)[0];
}
function attr(element, nom) {
  if (!element) return undefined;
  if (Object.hasOwn(element.attributs, nom)) return element.attributs[nom];
  for (const [cle, valeur] of Object.entries(element.attributs)) {
    if (local(cle) === nom) return valeur;
  }
  return undefined;
}
/** Tous les descendants (éléments) dans l'ordre du document. */
function descendants(element, nom) {
  const trouves = [];
  const visiter = (e) => {
    for (const enfant of enfants(e)) {
      if (nom === undefined || local(enfant.nom) === nom || enfant.nom === nom) trouves.push(enfant);
      visiter(enfant);
    }
  };
  visiter(element);
  return trouves;
}
function texteDe(element) {
  let sortie = '';
  for (const enfant of element.enfants) {
    if (typeof enfant === 'string') sortie += enfant;
    else sortie += texteDe(enfant);
  }
  return sortie;
}

/* ─────────────────── lecteur ZIP indépendant ───────────────────────────── */
function ouvrirZip(octets) {
  const eocd = octets.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return null;
  const nombre = octets.readUInt16LE(eocd + 10);
  let position = octets.readUInt32LE(eocd + 16);
  const entrees = new Map();
  for (let i = 0; i < nombre; i += 1) {
    const methode = octets.readUInt16LE(position + 10);
    const compressee = octets.readUInt32LE(position + 20);
    const longNom = octets.readUInt16LE(position + 28);
    const longExtra = octets.readUInt16LE(position + 30);
    const longCommentaire = octets.readUInt16LE(position + 32);
    const local2 = octets.readUInt32LE(position + 42);
    const nom = octets.toString('utf8', position + 46, position + 46 + longNom);
    entrees.set(nom, () => {
      const ln = octets.readUInt16LE(local2 + 26);
      const le = octets.readUInt16LE(local2 + 28);
      const debut = local2 + 30 + ln + le;
      const brut = octets.subarray(debut, debut + compressee);
      return methode === 8 ? inflateRawSync(brut) : Buffer.from(brut);
    });
    position += 46 + longNom + longExtra + longCommentaire;
  }
  return {
    noms: [...entrees.keys()],
    contient: (nom) => entrees.has(nom),
    lire: (nom) => {
      const f = entrees.get(nom);
      return f ? f().toString('utf8') : null;
    },
  };
}

/* ─────────────────── extracteurs indépendants ──────────────────────────── */

/** Texte d'un paragraphe Word, selon les règles du format. */
function texteWord(paragraphe) {
  let sortie = '';
  const visiter = (e) => {
    for (const enfant of enfants(e)) {
      switch (local(enfant.nom)) {
        case 't': sortie += texteDe(enfant); break;
        case 'tab': sortie += '\t'; break;
        case 'br': case 'cr': sortie += '\n'; break;
        case 'noBreakHyphen': sortie += '\u2011'; break;
        case 'softHyphen': sortie += '\u00ad'; break;
        case 'sym': {
          const code = parseInt(attr(enfant, 'char') || '0', 16);
          const point = code & 0xff;
          sortie += point === 0xb7 ? '\u2022' : String.fromCodePoint(point);
          break;
        }
        default: visiter(enfant);
      }
    }
  };
  visiter(paragraphe);
  return sortie;
}

function extraireDocx(zip) {
  const racine = analyserXml(zip.lire('word/document.xml'));
  const corps = premier(racine, 'body');
  const paragraphes = [];
  const images = [];
  const relations = new Map();
  const rels = zip.noms.find((n) => n.toLowerCase() === 'word/_rels/document.xml.rels');
  if (rels) {
    for (const relation of descendants(analyserXml(zip.lire(rels)), 'Relationship')) {
      if (attr(relation, 'TargetMode') === 'External') continue;
      relations.set(attr(relation, 'Id'), attr(relation, 'Target'));
    }
  }
  const lireBloc = (p, table) => {
    const proprietes = premier(p, 'pPr');
    let style = null;
    let niveau = null;
    let liste = false;
    let alignement = 'defaut';
    if (proprietes) {
      const pStyle = premier(proprietes, 'pStyle');
      style = attr(pStyle, 'val') ?? null;
      if (style) {
        const m = /^(?:heading|titre|h)\s*(\d)$/i.exec(style);
        if (m) niveau = Number(m[1]);
      }
      const jc = premier(proprietes, 'jc');
      if (jc) {
        alignement =
          { left: 'gauche', start: 'gauche', center: 'centre', right: 'droite', end: 'droite', both: 'justifie', justify: 'justifie' }[
            (attr(jc, 'val') || '').toLowerCase()
          ] ?? 'defaut';
      }
      liste = Boolean(premier(proprietes, 'numPr'));
    }
    const texte = texteWord(p);
    let image = null;
    for (const blip of descendants(p, 'blip')) {
      const id = attr(blip, 'embed') ?? attr(blip, 'link');
      const cible = relations.get(id);
      if (cible) {
        const chemin = cible.startsWith('word/') ? cible : `word/${cible.replace(/^\.\//, '')}`;
        if (!image) image = chemin;
        if (!images.includes(chemin)) images.push(chemin);
      }
    }
    paragraphes.push({ texte, style, niveau, liste, alignement, table, image });
  };

  for (const enfant of enfants(corps)) {
    const nom = local(enfant.nom);
    if (nom === 'p') lireBloc(enfant, null);
    else if (nom === 'tbl') {
      enfants(enfant, 'tr').forEach((ligne, ligneRang) => {
        enfants(ligne, 'tc').forEach((cellule, colonneRang) => {
          for (const p of enfants(cellule, 'p')) lireBloc(p, [ligneRang, colonneRang]);
        });
      });
    } else if (nom === 'sdt') {
      for (const p of descendants(enfant, 'p')) lireBloc(p, null);
    }
  }

  const sections = descendants(racine, 'sectPr');
  let page = null;
  for (const section of sections) {
    const taille = premier(section, 'pgSz');
    if (!taille) continue;
    const l = Number(attr(taille, 'w'));
    const h = Number(attr(taille, 'h'));
    if (!(l > 0 && h > 0)) continue;
    const marges = premier(section, 'pgMar');
    const mm = (v) => (v === undefined ? null : Number(v) * (25.4 / 1440));
    page = {
      largeur_mm: l * (25.4 / 1440),
      hauteur_mm: h * (25.4 / 1440),
      paysage: l > h,
      gauche: mm(attr(marges, 'left')),
      haut: mm(attr(marges, 'top')),
      droite: mm(attr(marges, 'right')),
    };
    break;
  }
  return { format: 'docx', paragraphes, page, images, notes: [] };
}

function extraireOdt(zip) {
  const racine = analyserXml(zip.lire('content.xml'));
  const corps = premier(premier(racine, 'body'), 'text') ?? premier(racine, 'text');
  const paragraphes = [];
  const images = [];
  const texteOdf = (element) => {
    let sortie = '';
    for (const enfant of element.enfants) {
      if (typeof enfant === 'string') {
        sortie += enfant;
        continue;
      }
      switch (local(enfant.nom)) {
        case 's': {
          const nombre = Number(attr(enfant, 'c') ?? 1);
          sortie += ' '.repeat(Math.min(nombre, 4096));
          break;
        }
        case 'tab': sortie += '\t'; break;
        case 'line-break': sortie += '\n'; break;
        case 'image': {
          const href = attr(enfant, 'href');
          if (href) images.push(href);
          break;
        }
        default: sortie += texteOdf(enfant);
      }
    }
    return sortie;
  };
  const ajouter = (element, table, liste, niveau) => {
    const texte = texteOdf(element);
    const style = attr(element, 'style-name') ?? (niveau ? `Titre${niveau}` : null);
    paragraphes.push({ texte, style, niveau, liste, alignement: 'defaut', table, image: null });
    const trouvees = [];
    const collecter = (e) => {
      for (const enfant of enfants(e)) {
        if (local(enfant.nom) === 'image') {
          const href = attr(enfant, 'href');
          if (href) trouvees.push(href);
        }
        collecter(enfant);
      }
    };
    collecter(element);
    if (trouvees.length) {
      paragraphes[paragraphes.length - 1].image = trouvees[0];
      for (const i of trouvees) if (!images.includes(i)) images.push(i);
    }
  };
  const parcourir = (element, table, liste) => {
    for (const enfant of enfants(element)) {
      switch (local(enfant.nom)) {
        case 'h': ajouter(enfant, table, liste, Number(attr(enfant, 'outline-level')) || null); break;
        case 'p': ajouter(enfant, table, liste, null); break;
        case 'list':
          for (const item of enfants(enfant, 'list-item')) {
            for (const dedans of enfants(item)) parcourir({ enfants: [dedans] }, table, true);
          }
          break;
        case 'table':
          enfants(enfant, 'table-row').forEach((ligne, ligneRang) => {
            enfants(ligne).forEach((cellule, colonneRang) => {
              if (!['table-cell', 'covered-table-cell'].includes(local(cellule.nom))) return;
              const avant = paragraphes.length;
              parcourir(cellule, [ligneRang, colonneRang], liste);
              if (paragraphes.length === avant) {
                paragraphes.push({ texte: '', style: null, niveau: null, liste, alignement: 'defaut', table: [ligneRang, colonneRang], image: null });
              }
            });
          });
          break;
        case 'frame': case 'image': case 'g': case 'rect': case 'ellipse': {
          const trouvees = [];
          const collecter = (e) => {
            for (const enfant2 of enfants(e)) {
              if (local(enfant2.nom) === 'image') {
                const href = attr(enfant2, 'href');
                if (href) trouvees.push(href);
              }
              collecter(enfant2);
            }
          };
          if (local(enfant.nom) === 'image') {
            const href = attr(enfant, 'href');
            if (href) trouvees.push(href);
          }
          collecter(enfant);
          if (trouvees.length) {
            paragraphes.push({ texte: '', style: null, niveau: null, liste, alignement: 'defaut', table, image: trouvees[0] });
            for (const i of trouvees) if (!images.includes(i)) images.push(i);
          }
          break;
        }
        case 'section': case 'text-section':
          parcourir(enfant, table, liste);
          break;
        default: break;
      }
    }
  };
  for (const enfant of enfants(corps)) parcourir({ enfants: [enfant] }, null, false);

  // Format de page : première mise en page qui déclare une taille.
  let page = null;
  for (const p of descendants(racine, 'page-layout-properties')) {
    const l = mesure(attr(p, 'page-width'));
    const h = mesure(attr(p, 'page-height'));
    if (l && h) {
      page = {
        largeur_mm: l,
        hauteur_mm: h,
        paysage: l > h,
        gauche: mesure(attr(p, 'margin-left')),
        haut: mesure(attr(p, 'margin-top')),
        droite: mesure(attr(p, 'margin-right')),
      };
      break;
    }
  }
  const mimetype = zip.lire('mimetype');
  return { format: 'odt', paragraphes, page, images, notes: [], mimetype: (mimetype || '').trim() };
}

/** Convertit une mesure ODF en millimètres. */
function mesure(valeur) {
  if (!valeur) return null;
  const unites = [['mm', 1], ['cm', 10], ['in', 25.4], ['pt', 25.4 / 72], ['pc', 25.4 / 6], ['px', 25.4 / 96]];
  for (const [unite, facteur] of unites) {
    if (valeur.endsWith(unite)) {
      const nombre = Number(valeur.slice(0, -unite.length));
      return Number.isFinite(nombre) ? nombre * facteur : null;
    }
  }
  return null;
}

function extraireIdml(zip) {
  const carte = analyserXml(zip.lire('designmap.xml'));
  let histoires = descendants(carte, 'Story').map((e) => attr(e, 'src')).filter(Boolean);
  const planches = descendants(carte, 'Spread').map((e) => attr(e, 'src')).filter(Boolean);
  if (!histoires.length) {
    histoires = zip.noms.filter((n) => n.startsWith('Stories/') && n.endsWith('.xml')).sort();
  }
  const paragraphes = [];
  const notes = [];
  const images = [];
  const aligner = (v) => {
    const base = (v || '').replace(/Align$/, '').toLowerCase();
    if (base === 'left' || base === 'leftjustified') return 'gauche';
    if (base === 'center') return 'centre';
    if (base === 'right') return 'droite';
    if (base === 'fullyjustified' || base === 'justified' || base === 'both') return 'justifie';
    return 'defaut';
  };
  for (const histoire of histoires) {
    const brut = zip.lire(histoire);
    if (!brut) continue;
    const racine = analyserXml(brut);
    const story = premier(racine, 'Story') ?? (local(racine.nom) === 'Story' ? racine : null);
    if (!story) continue;
    const visiter = (element, table) => {
      for (const enfant of enfants(element)) {
        const nom = local(enfant.nom);
        if (nom === 'ParagraphStyleRange') {
          const styleBrut = attr(enfant, 'AppliedParagraphStyle');
          const style = styleBrut ? styleBrut.split('/').pop().replace(/^\$ID\//, '') : null;
          let niveau = null;
          if (styleBrut) {
            const m = /^(?:titre|heading|h)(\d)$/i.exec(style || '');
            if (m) niveau = Number(m[1]);
          }
          let texte = '';
          const collecter = (e) => {
            for (const enfant2 of enfants(e)) {
              const n2 = local(enfant2.nom);
              if (n2 === 'Content') texte += texteDe(enfant2);
              else if (n2 === 'Br') texte += '\n';
              else if (n2 === 'Tab') texte += '\t';
              else if (n2 === 'Link') {
                const uri = attr(enfant2, 'LinkResourceURI') ?? attr(enfant2, 'URI');
                if (uri) {
                  const i = uri.indexOf('Links/');
                  const nom2 = i >= 0 ? uri.slice(i) : uri;
                  if (!images.includes(nom2)) images.push(nom2);
                }
              } else if (n2 === 'Footnote' || n2 === 'Endnote' || n2 === 'Table') continue;
              else collecter(enfant2);
            }
          };
          collecter(enfant);
          paragraphes.push({ texte, style, niveau, liste: false, alignement: aligner(attr(enfant, 'Justification')), table, image: null });
          for (const note of [...descendants(enfant, 'Footnote'), ...descendants(enfant, 'Endnote')]) {
            const morceaux = descendants(note, 'ParagraphStyleRange')
              .map((r) => {
                let t = '';
                for (const c of descendants(r, 'Content')) t += texteDe(c);
                return t.replace(/\s+$/, '');
              })
              .filter((t) => t.length);
            const bloc = morceaux.join('\n');
            if (bloc && !notes.includes(bloc)) notes.push(bloc);
          }
        } else if (nom === 'Footnote' || nom === 'Endnote') {
          const morceaux = descendants(enfant, 'ParagraphStyleRange')
            .map((r) => {
              let t = '';
              for (const c of descendants(r, 'Content')) t += texteDe(c);
              return t.replace(/\s+$/, '');
            })
            .filter((t) => t.length);
          const bloc = morceaux.join('\n');
          if (bloc && !notes.includes(bloc)) notes.push(bloc);
        } else if (nom === 'Table') {
          for (const cellule of enfants(enfant, 'Cell')) {
            const nom2 = attr(cellule, 'Name');
            let position = null;
            if (nom2 && nom2.includes(':')) {
              const [a, b] = nom2.split(':').map((v) => Number(v.trim()));
              if (Number.isFinite(a) && Number.isFinite(b)) position = [a, b];
            }
            visiter(cellule, position);
          }
        } else if (nom === 'Link') {
          const uri = attr(enfant, 'LinkResourceURI') ?? attr(enfant, 'URI');
          if (uri) {
            const i = uri.indexOf('Links/');
            const nom2 = i >= 0 ? uri.slice(i) : uri;
            if (!images.includes(nom2)) images.push(nom2);
          }
        } else visiter(enfant, table);
      }
    };
    visiter(story, null);
  }

  let page = null;
  if (planches.length) {
    const brut = zip.lire(planches[0]);
    if (brut) {
      const pages = descendants(analyserXml(brut), 'Page');
      if (pages.length) {
        const bornes = (attr(pages[0], 'GeometricBounds') || '').split(/\s+/).map(Number);
        if (bornes.length === 4) {
          const mal = premier(pages[0], 'MarginPreference');
          const pt = (v) => (v === undefined || v === null || v === '' ? null : Number(v) * (25.4 / 72));
          page = {
            largeur_mm: Math.abs(bornes[3] - bornes[1]) * (25.4 / 72),
            hauteur_mm: Math.abs(bornes[2] - bornes[0]) * (25.4 / 72),
            paysage: Math.abs(bornes[3] - bornes[1]) > Math.abs(bornes[2] - bornes[0]),
            gauche: pt(attr(mal, 'Left')),
            haut: pt(attr(mal, 'Top')),
            droite: pt(attr(mal, 'Right')),
          };
        }
      }
    }
  }
  return { format: 'idml', paragraphes, page, images: [], notes };
}

/* ─────────────────── lecture des réponses du noyau ─────────────────────── */

function desechapper(texte) {
  let sortie = '';
  for (let i = 0; i < texte.length; i += 1) {
    if (texte[i] === '\\' && i + 1 < texte.length) {
      const suivant = texte[i + 1];
      if (suivant === 'n') { sortie += '\n'; i += 1; continue; }
      if (suivant === 't') { sortie += '\t'; i += 1; continue; }
      if (suivant === 'r') { sortie += '\r'; i += 1; continue; }
      if (suivant === '\\') { sortie += '\\'; i += 1; continue; }
    }
    sortie += texte[i];
  }
  return sortie;
}

function lireTsv(chemin) {
  if (!existsSync(chemin)) return [];
  return readFileSync(chemin, 'utf8').trim().split('\n').map((l) => l.split('\t'));
}

/** Lance `paragraphes` sur un fichier et rend les paragraphes du noyau. */
function paragraphesDuNoyau(chemin) {
  const sortie = temporaire('paragraphes.tsv');
  if (existsSync(sortie)) rmSync(sortie);
  lancer('paragraphes', chemin, sortie);
  const lignes = lireTsv(sortie);
  const erreur = lignes.find((l) => l[0] === 'erreur');
  if (erreur) return { erreur: erreur.slice(1).join('\t') };
  return {
    paragraphes: lignes
      .filter((l) => l[0] === 'para')
      .map((l) => ({
        rang: Number(l[1]),
        niveau: l[2] === '-' ? null : Number(l[2]),
        liste: l[3] === '1',
        alignement: l[4],
        style: l[5] === '-' ? null : l[5],
        table: l[6] === '-' ? null : l[6].split(':').map(Number),
        image: l[7] === '-' ? null : l[7],
        texte: desechapper(l[8]),
      })),
  };
}

function resumeDuNoyau(chemin) {
  const sortie = temporaire('resume.tsv');
  if (existsSync(sortie)) rmSync(sortie);
  const r = lancerSouple('resume', chemin, sortie);
  if (!existsSync(sortie)) return { erreur: r.sortie.trim() };
  const lignes = lireTsv(sortie);
  const erreur = lignes.find((l) => l[0] === 'erreur');
  if (erreur) return { erreur: erreur.slice(1).join('\t') };
  const lire = (cle) => lignes.find((l) => l[0] === cle)?.[1];
  const page = lignes.find((l) => l[0] === 'page');
  return {
    format: lire('format'),
    paragraphes: Number(lire('paragraphes')),
    caracteres: Number(lire('caracteres')),
    titres: Number(lire('titres')),
    listes: Number(lire('listes')),
    notes: Number(lire('notes')),
    images: lignes.filter((l) => l[0] === 'image').map((l) => l[1]),
    page:
      page && page[1] !== '-'
        ? {
            largeur_mm: Number(page[1]),
            hauteur_mm: Number(page[2]),
            paysage: page[3] === '1',
            gauche: page[4] === '?' ? null : Number(page[4]),
            haut: page[5] === '?' ? null : Number(page[5]),
            droite: page[6] === '?' ? null : Number(page[6]),
          }
        : null,
    avertissements: lignes.filter((l) => l[0] === 'avertissement').map((l) => l[1]),
    notesTexte: lignes.filter((l) => l[0] === 'note').map((l) => l[1]),
  };
}

/* ─────────────────── fabricant d'archives, écrit ici ────────────────────
   Nécessaire pour fabriquer des témoins VALIDES : modifier des octets au milieu
   d'un ZIP existant décale l'annuaire central et abîme le fichier, ce qui fait
   Refuser pour la mauvaise raison. On construit donc une archive propre. */

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
  for (let i = 0; i < octets.length; i += 1) c = TABLE_CRC[(c ^ octets[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Fabrique une archive ZIP à partir de `{ nom, contenu }`. */
function fabriquerArchive(entrees) {
  const morceaux = [];
  const annuaire = [];
  let decalage = 0;
  for (const entree of entrees) {
    const contenu = Buffer.from(entree.contenu, 'utf8');
    const nom = Buffer.from(entree.nom, 'utf8');
    const local2 = Buffer.alloc(30);
    local2.writeUInt32LE(0x04034b50, 0);
    local2.writeUInt16LE(20, 4);
    local2.writeUInt16LE(0x0800, 6);
    local2.writeUInt16LE(0, 8);
    local2.writeUInt32LE(crc32(contenu), 14);
    local2.writeUInt32LE(contenu.length, 18);
    local2.writeUInt32LE(contenu.length, 22);
    local2.writeUInt16LE(nom.length, 26);
    morceaux.push(local2, nom, contenu);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc32(contenu), 16);
    central.writeUInt32LE(contenu.length, 20);
    central.writeUInt32LE(contenu.length, 24);
    central.writeUInt16LE(nom.length, 28);
    central.writeUInt32LE(decalage, 42);
    annuaire.push(central, nom);
    decalage += local2.length + nom.length + contenu.length;
  }
  const debut = morceaux.reduce((n, m) => n + m.length, 0);
  const bloc = Buffer.concat(annuaire);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entrees.length, 8);
  eocd.writeUInt16LE(entrees.length, 10);
  eocd.writeUInt32LE(bloc.length, 12);
  eocd.writeUInt32LE(debut, 16);
  return Buffer.concat([...morceaux, bloc, eocd]);
}

/* ─────────────────── 1. extracteur indépendant ─────────────────────────── */

titre('extracteur indépendant : le noyau lit ce qu’un autre lecteur lit');

const FICHIERS = [
  { nom: 'titre4.docx', chemin: '_dev/docx-test/titre4.docx', format: 'docx' },
  { nom: '_test_word.docx', chemin: '_dev/exports/_test_word.docx', format: 'docx' },
  { nom: 'rapport-a5.docx', chemin: '_dev/sorties/rapport-a5.docx', format: 'docx' },
  { nom: '_gros_120p.docx', chemin: '_dev/exports/_gros_120p.docx', format: 'docx' },
  { nom: '_test_fidelite.docx', chemin: '_dev/sorties/_test_fidelite.docx', format: 'docx' },
  { nom: 'test.odt', chemin: '_dev/fixtures-396/_fixtures_396/test.odt', format: 'odt' },
  { nom: '_test_word.odt', chemin: '_dev/sorties/_test_word.odt', format: 'odt' },
  { nom: 'features-561.idml', chemin: '_dev/idml-test/features-561.idml', format: 'idml' },
  { nom: 'cadre-colonnes.idml', chemin: '_dev/idml-test/cadre-colonnes.idml', format: 'idml' },
  { nom: 'gabarit-items.idml', chemin: '_dev/idml-test/gabarit-items.idml', format: 'idml' },
];

let fichiersTestes = 0;
let paragraphesCompares = 0;
let desaccords = 0;
let absents = [];
const detail = [];

/** Comparaison caractère par caractère, espaces ôtés. */
const sec = (texte) => texte.replace(/\s+/g, '');

for (const fichier of FICHIERS) {
  const source = join(parent, fichier.chemin);
  if (!existsSync(source)) {
    absents.push(fichier.nom);
    continue;
  }
  const octets = readFileSync(source);
  const copie = temporaire(fichier.nom);
  writeFileSync(copie, octets);
  const zip = ouvrirZip(octets);
  if (!zip) {
    check(`${fichier.nom} : lisible par le lecteur ZIP du script`, false);
    continue;
  }
  let attendu;
  try {
    attendu =
      fichier.format === 'docx'
        ? extraireDocx(zip)
        : fichier.format === 'odt'
          ? extraireOdt(zip)
          : extraireIdml(zip);
  } catch (e) {
    check(`${fichier.nom} : extracteur indépendant`, false, e.message);
    continue;
  }

  const recu = paragraphesDuNoyau(copie);
  if (recu.erreur) {
    check(`${fichier.nom} : import par le noyau`, false, recu.erreur);
    continue;
  }

  // Nombre de paragraphes.
  if (recu.paragraphes.length !== attendu.paragraphes.length) {
    desaccords += 1;
    check(
      `${fichier.nom} : nombre de paragraphes`,
      false,
      `noyau ${recu.paragraphes.length}, extracteur ${attendu.paragraphes.length}`,
    );
    continue;
  }

  // Paragraphe par paragraphe.
  let justes = 0;
  for (let i = 0; i < attendu.paragraphes.length; i += 1) {
    const a = attendu.paragraphes[i];
    const r = recu.paragraphes[i];
    const memes = (x, y) => (x ?? null) === (y ?? null);
    const problems = [];
    if (a.texte !== r.texte) problems.push(`texte (« ${a.texte.slice(0, 40)}… » contre « ${r.texte.slice(0, 40)}… »)`);
    if (!memes(a.style, r.style)) problems.push(`style (${a.style} contre ${r.style})`);
    if (!memes(a.niveau, r.niveau)) problems.push(`niveau (${a.niveau} contre ${r.niveau})`);
    if (a.liste !== r.liste) problems.push(`liste (${a.liste} contre ${r.liste})`);
    if (!memes(a.alignement, r.alignement)) problems.push(`alignement (${a.alignement} contre ${r.alignement})`);
    if (JSON.stringify(a.table ?? null) !== JSON.stringify(r.table ?? null)) {
      problems.push(`tableau (${JSON.stringify(a.table)} contre ${JSON.stringify(r.table)})`);
    }
    if (problems.length === 0) justes += 1;
    else if (desaccords < 6) {
      desaccords += 1;
      check(`${fichier.nom} : paragraphe ${i}`, false, problems.join(', '));
    } else desaccords += 1;
  }
  paragraphesCompares += justes;
  fichiersTestes += 1;
  detail.push(`${fichier.nom} (${justes}/${attendu.paragraphes.length})`);

  // INVARIANTE : tout le texte, et rien que le texte.
  const texteNoyau = sec(recu.paragraphes.map((p) => p.texte).join(''));
  const texteAttendu = sec(attendu.paragraphes.map((p) => p.texte).join(''));
  if (texteNoyau !== texteAttendu) {
    // On cherche la première divergence pour la montrer.
    let i = 0;
    while (i < Math.min(texteNoyau.length, texteAttendu.length) && texteNoyau[i] === texteAttendu[i]) i += 1;
    check(
      `${fichier.nom} : aucune perte de caractère`,
      false,
      `première divergence au caractère ${i} : « …${texteNoyau.slice(Math.max(0, i - 20), i)}|${texteNoyau.slice(i, i + 20)}… » contre « …${texteAttendu.slice(Math.max(0, i - 20), i)}|${texteAttendu.slice(i, i + 20)}… »`,
    );
  }

  // Les images annoncées doivent exister dans l'archive.
  const resume = resumeDuNoyau(copie);
  for (const image of resume.images) {
    if (!zip.contient(image)) {
      check(`${fichier.nom} : image « ${image} » présente dans l'archive`, false);
    }
  }
  // Et le format de page, recalculé indépendamment.
  if (attendu.page && resume.page) {
    const proche = (x, y) => (x === null || y === null ? true : Math.abs(x - y) < 0.01);
    check(
      `${fichier.nom} : format de page recalculé indépendamment`,
      proche(attendu.page.largeur_mm, resume.page.largeur_mm) &&
        proche(attendu.page.hauteur_mm, resume.page.hauteur_mm) &&
        attendu.page.paysage === resume.page.paysage &&
        proche(attendu.page.gauche, resume.page.gauche) &&
        proche(attendu.page.haut, resume.page.haut),
      `${resume.page.largeur_mm.toFixed(3)}×${resume.page.hauteur_mm.toFixed(3)} contre ${attendu.page.largeur_mm.toFixed(3)}×${attendu.page.hauteur_mm.toFixed(3)}`,
    );
  }
}

check(
  `les ${fichiersTestes} documents réels sont importés comme les lit un extracteur indépendant`,
  desaccords === 0,
  `${paragraphesCompares} paragraphes comparés en tout`,
);
if (absents.length) console.log(`  (absents du dépôt : ${absents.join(', ')})`);
check('au moins 8 témoins testés', fichiersTestes >= 8, `${fichiersTestes} fichiers`);
console.log(`  ${detail.join(' · ')}`);

/* ─────────────────── 2. invariante : rien de perdu ────────────────────── */

titre('l’invariante : tout le texte du XML, et rien d’autre');

{
  /* Contrôle indépendant de la comparaison par paragraphes : on prend le texte
     BRUT du XML (toutes les balises ôtées), on lui retire ses espaces, et on
     exige que le texte importé soit exactement cela. Pour .docx et .idml, où
     les espaces sont littéraux, l'invariante est exacte. Pour .odt, `text:s`
     fabrique des espaces qui ne sont pas dans le texte : on compare alors avec
     et sans les espaces. */
  for (const fichier of FICHIERS) {
    const source = join(parent, fichier.chemin);
    if (!existsSync(source)) continue;
    const zip = ouvrirZip(readFileSync(source));
    if (!zip) continue;
    const entree =
      fichier.format === 'docx'
        ? 'word/document.xml'
        : fichier.format === 'odt'
          ? 'content.xml'
          : null;
    if (!entree) continue; // .idml : plusieurs histoires, traité au point suivant.
    const brut = zip.lire(entree);
    const sansBalises = brut.replace(/<[^>]*>/g, '');
    const recu = paragraphesDuNoyau(temporaire(fichier.nom));
    const texte = sec(recu.paragraphes.map((p) => p.texte).join(''));
    const attendu = sec(decoderEntites(sansBalises));
    check(
      `${fichier.nom} : le texte importé est exactement le texte du XML (espaces ôtés)`,
      texte === attendu,
      `${texte.length} caractères contre ${attendu.length}`,
    );
  }
}

{
  /* Pour .idml : le flux PLUS les notes doit rendre tout le texte **des
     éléments `Content`** des histoires. C'est l'invariante la plus utile du
     format, parce que la note est délibérément sortie du flux : si elle y était
     restée, ou si elle avait disparu, ce contrôle le verrait.
     On ne prend QUE les `Content` : un fichier IDML est plein d'éléments
     `Properties` dont le texte est une donnée technique (nom de police, position
     de taquet, caractère d'alignement), pas du texte de document. Une première
     version de ce contrôle prenait tous les nœuds de texte et comptait donc
     ﻿« Open Sans » et « 60 » comme du contenu — c'est ce qui l'a montré. */
  for (const fichier of FICHIERS.filter((f) => f.format === 'idml')) {
    const source = join(parent, fichier.chemin);
    if (!existsSync(source)) continue;
    const zip = ouvrirZip(readFileSync(source));
    if (!zip) continue;
    const carte = zip.contient('designmap.xml') ? analyserXml(zip.lire('designmap.xml')) : null;
    let histoires = carte
      ? descendants(carte, 'Story')
          .map((e) => attr(e, 'src'))
          .filter(Boolean)
          // Le designmap ne déclare que les histoires de page : les histoires de
          // gabarit (`MasterSpreads`) sont dans l'archive sans y figurer.
          .filter((n) => zip.contient(n))
      : [];
    for (const nom of zip.noms) {
      if (nom.startsWith('Stories/') && nom.endsWith('.xml') && !histoires.includes(nom)) {
        histoires.push(nom);
      }
    }
    let attendu = '';
    for (const histoire of histoires) {
      const racine = analyserXml(zip.lire(histoire));
      for (const contenu of descendants(racine, 'Content')) attendu += texteDe(contenu);
    }
    const recu = paragraphesDuNoyau(temporaire(fichier.nom));
    const resume = resumeDuNoyau(temporaire(fichier.nom));
    const flux = sec(recu.paragraphes.map((p) => p.texte).join(''));
    const notes = sec(resume.notesTexte.join(''));
    const attenduSec = sec(attendu);
    /* Comparaison des CARACTÈRES, pas de leur ordre : la note est délibérément
       sortie du flux et rassemblée à part, donc l'ordre de concaténation diffère
       par construction. Ce qu'il faut prouver ici, c'est qu'aucun caractère n'est
       perdu ni dupliqué — l'ORDRE, lui, est déjà prouvé par la comparaison
       paragraphe par paragraphe du point 1. */
    const tri = (texte) => [...texte].sort().join('');
    check(
      `${fichier.nom} : flux + notes = tout le texte des histoires, caractère pour caractère`,
      tri(flux + notes) === tri(attenduSec),
      `${flux.length} + ${notes.length} contre ${attenduSec.length}`,
    );
    // Et la note n'est PAS dans le flux : c'est la décision du lecteur.
    if (notes.length) {
      check(
        `${fichier.nom} : la note de bas de page n’est pas collée dans son paragraphe`,
        !flux.includes(notes),
        `${notes.length} caractères de note`,
      );
    }
  }
}

/* ─────────────────── 3. les témoins écrits pour piéger ─────────────────── */

titre('les témoins qui piègent : ce qu’ils vérifient');

{
  /* `titre4.docx` existe pour une raison précise, écrite dans son contenu :
     « TITRE QUATRE A NE PAS PERDRE ». Un import qui ne connaît que Titre 1 et
     Titre 2 perd le niveau 4 en silence. On exige les valeurs exactes. */
  const chemin = join(parent, '_dev/docx-test/titre4.docx');
  if (existsSync(chemin)) {
    const recu = paragraphesDuNoyau(temporaire('titre4.docx'));
    const textes = recu.paragraphes.map((p) => p.texte);
    check(
      'titre4.docx : les six paragraphes sont là, dans l’ordre',
      JSON.stringify(textes) ===
        JSON.stringify([
          'TITRE UN',
          'Paragraphe de corps juste apres le titre un, texte normal.',
          'TITRE QUATRE A NE PAS PERDRE',
          'Paragraphe de corps qui suit le titre quatre.',
          'CITATION A NE PAS PERDRE',
          'Dernier paragraphe normal.',
        ]),
      textes.join(' | ').slice(0, 120),
    );
    const niveaux = recu.paragraphes.map((p) => p.niveau);
    check(
      'titre4.docx : le niveau 4 est reconnu',
      niveaux[0] === 1 && niveaux[2] === 4,
      `niveaux : ${JSON.stringify(niveaux)}`,
    );
    check(
      'titre4.docx : les styles sont conservés par leur nom',
      recu.paragraphes[0].style === 'Heading1' && recu.paragraphes[4].style === 'Quote',
      `${recu.paragraphes[0].style}, ${recu.paragraphes[4].style}`,
    );
  }
}

{
  /* `test.odt` contient `text:s` (espaces comptés), une liste, un tableau et
     une image : c'est le témoin des pièges du format OpenDocument. */
  const chemin = join(parent, '_dev/fixtures-396/_fixtures_396/test.odt');
  if (existsSync(chemin)) {
    const copie = temporaire('test.odt');
    const recu = paragraphesDuNoyau(copie);
    const resume = resumeDuNoyau(copie);
    check('test.odt : le type MIME est celui d’un texte', resume.format === 'odt');
    check('test.odt : la liste est vue', resume.listes >= 2, `${resume.listes} paragraphes de liste`);
    check('test.odt : le tableau est vu', resume.paragraphes > 12 && recu.paragraphes.some((p) => p.table), 'positions de cases trouvées');
    check(
      'test.odt : l’image du cadre est vue',
      resume.images.includes('Pictures/mosaique.png'),
      resume.images.join(', '),
    );
    // Le texte exact d'un paragraphe avec espaces insécables.
    const tarifs = recu.paragraphes.find((p) => p.texte.startsWith('Tarifs'));
    check(
      'test.odt : les espaces insécables du texte sont conservés',
      tarifs && tarifs.texte.includes('\u00a0') && tarifs.texte.includes('\u202f'),
      tarifs ? [...tarifs.texte].map((c) => c.codePointAt(0)).join(',') : 'paragraphe absent',
    );
  }
}

{
  /* `features-561.idml` contient une note de bas de page IMBRIQUÉE dans son
     appelant, un tableau à deux colonnes et un lien. */
  const chemin = join(parent, '_dev/idml-test/features-561.idml');
  if (existsSync(chemin)) {
    const copie = temporaire('features-561.idml');
    const resume = resumeDuNoyau(copie);
    check('features-561.idml : la note de bas de page est rassemblée', resume.notes === 1, `${resume.notes} notes`);
    check(
      'features-561.idml : et son texte est celui attendu',
      resume.notesTexte[0] === 'Note de bas de page reelle, sortie du flux et rassemblee.',
      resume.notesTexte[0],
    );
    check('features-561.idml : le tableau est vu', resume.paragraphes === 8, `${resume.paragraphes} paragraphes`);
    const recu = paragraphesDuNoyau(copie);
    const noms = recu.paragraphes.find((p) => p.texte === 'Nom');
    const ville = recu.paragraphes.find((p) => p.texte === 'Ville');
    const alice = recu.paragraphes.find((p) => p.texte === 'Alice');
    check(
      'features-561.idml : les cases du tableau sont à leur place',
      noms?.table?.[0] === 0 && noms?.table?.[1] === 0 &&
        ville?.table?.[0] === 1 && ville?.table?.[1] === 0 &&
        alice?.table?.[0] === 0 && alice?.table?.[1] === 1,
      `${JSON.stringify(noms?.table)}, ${JSON.stringify(ville?.table)}, ${JSON.stringify(alice?.table)}`,
    );
    check(
      'features-561.idml : le style de titre est conservé par son nom',
      recu.paragraphes[0].style === 'Titre',
      recu.paragraphes[0].style,
    );
  }
}

{
  /* `cadre-colonnes.idml` a un `designmap.xml` **qui ne déclare aucune
     histoire**, et des fichiers `Story` à **racine nue**. Il est là pour
     vérifier qu'un lecteur tolérant ouvre quand même. */
  const chemin = join(parent, '_dev/idml-test/cadre-colonnes.idml');
  if (existsSync(chemin)) {
    const copie = temporaire('cadre-colonnes.idml');
    const resume = resumeDuNoyau(copie);
    check(
      'cadre-colonnes.idml : ouvert malgré un designmap sans histoires',
      resume.paragraphes >= 3,
      `${resume.paragraphes} paragraphes`,
    );
    check(
      'cadre-colonnes.idml : et l’avertissement le dit',
      resume.avertissements.some((a) => a.includes('aucune histoire')),
      resume.avertissements.join(' | ') || 'aucun avertissement',
    );
    const recu = paragraphesDuNoyau(copie);
    check(
      'cadre-colonnes.idml : le texte à racine nue est bien lu',
      recu.paragraphes.some((p) => p.texte.includes('RACINE NUE')),
      'le paragraphe témoin est présent',
    );
  }
}

/* ─────────────────── 4. la chaîne vers la pagination ───────────────────── */

titre('la chaîne : un document importé se pagine');

{
  const chemin = join(parent, '_dev/docx-test/titre4.docx');
  if (existsSync(chemin)) {
    const copie = temporaire('titre4.docx');
    const sortie = temporaire('flux.tsv');
    lancer('flux', copie, '5', '2', sortie);
    const lignes = lireTsv(sortie);
    const flux = lignes.filter((l) => l[0] === 'flux');
    check('le flux se construit', flux.length >= 6, `${flux.length} paragraphes de flux`);
    check(
      'l’invariante du flux tient : aucun caractère perdu',
      sec(flux.map((l) => desechapper(l[5])).join('')) ===
        sec(paragraphesDuNoyau(copie).paragraphes.map((p) => p.texte).join('')),
    );
  }
}

{
  /* Le saut de ligne FORCÉ (Maj+Entrée) doit devenir un paragraphe de flux
     SANS retrait de première ligne : c'est la même phrase qui continue. On le
     teste sur un document qui en contient. */
  const candidats = ['_dev/sorties/_test_fidelite.docx', '_dev/exports/_test_word.docx'];
  let trouve = null;
  for (const candidat of candidats) {
    const chemin = join(parent, candidat);
    if (!existsSync(chemin)) continue;
    const copie = temporaire('saut.docx');
    writeFileSync(copie, readFileSync(chemin));
    const recu = paragraphesDuNoyau(copie);
    if (recu.paragraphes.some((p) => p.texte.includes('\n'))) {
      trouve = copie;
      break;
    }
  }
  if (trouve) {
    const sortie = temporaire('flux-saut.tsv');
    lancer('flux', trouve, '7', '3', sortie);
    const flux = lireTsv(sortie).filter((l) => l[0] === 'flux');
    const sansRetrait = flux.filter((l) => Number(l[2]) === 0 && Number(l[3]) === 0);
    check(
      'un saut de ligne forcé devient un paragraphe de flux sans retrait',
      sansRetrait.length > 0,
      `${sansRetrait.length} continuation(s) sans retrait`,
    );
    // Et le premier paragraphe du document, lui, porte bien le retrait.
    check(
      'le premier paragraphe porte le retrait demandé',
      Number(flux[0][2]) === 7,
      `retrait de première ligne : ${flux[0][2]}`,
    );
  } else {
    console.log('  (aucun témoin avec saut de ligne forcé : contrôle ignoré)');
  }
}

/* ─────────────────── 5. les refus ──────────────────────────────────────── */

titre('ce que le noyau refuse, et pourquoi');

function refus(nom, octets, motif) {
  const chemin = temporaire(nom);
  writeFileSync(chemin, octets);
  const sortie = temporaire('refus.tsv');
  if (existsSync(sortie)) rmSync(sortie);
  const r = lancerSouple('resume', chemin, sortie);
  const contenu = existsSync(sortie) ? readFileSync(sortie, 'utf8') : r.sortie;
  const motifVu = /erreur\t(.+)/.exec(contenu)?.[1] || '';
  const refuse = r.code !== 0 || contenu.includes('erreur');
  const conforme = !motif || motifVu.toLowerCase().includes(motif.toLowerCase());
  check(
    `${nom} est refusé${motif ? ` (${motif})` : ''}`,
    refuse && conforme,
    motifVu || (r.code === 0 ? 'AUCUN REFUS' : `code ${r.code}`),
  );
}

{
  // Un RTF renommé : le témoin réel `renomme.odt`.
  const renomme = join(parent, '_dev/fixtures-396/_fixtures_396/renomme.odt');
  if (existsSync(renomme)) {
    refus('renomme.odt', readFileSync(renomme), 'pas une archive');
  }
  // Un PDF renommé en .docx.
  refus('faux.docx', Buffer.from('%PDF-1.6\nun pdf déguisé\n%%EOF'), 'pas une archive');
  // Un ancien .doc binaire.
  const doc = Buffer.alloc(4000);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(doc, 0);
  refus('ancien.doc', doc, 'pas une archive');

  // Une archive qui n'est pas un document : un ZIP de fichiers quelconques.
  const quelconque = readFileSync(join(parent, '_dev/docx-test/titre4.docx'));
  const zip = ouvrirZip(quelconque);
  check('le témoin docx est bien une archive (contrôle du script)', zip !== null);
}

{
  /* Un classeur ODF renommé en .odt : le `mimetype` le dit, et c'est la seule
     autorité. Un lecteur qui se fie à l'extension ouvre un tableur comme un
     texte. L'archive est construite proprement, avec un `content.xml` minimal :
     c'est le type MIME qui doit faire refuser, pas autre chose. */
  refus(
    'classeur.odt',
    fabriquerArchive([
      { nom: 'mimetype', contenu: 'application/vnd.oasis.opendocument.spreadsheet' },
      {
        nom: 'content.xml',
        contenu:
          '<office:document-content><office:body><office:text><text:p>des chiffres</text:p></office:text></office:body></office:document-content>',
      },
    ]),
    'annonce',
  );
  // Et le même contenu avec le BON type MIME doit s'ouvrir.
  const bonOdt = temporaire('bon.odt');
  writeFileSync(
    bonOdt,
    fabriquerArchive([
      { nom: 'mimetype', contenu: 'application/vnd.oasis.opendocument.text' },
      {
        nom: 'content.xml',
        contenu:
          '<office:document-content><office:body><office:text><text:p>un texte ODF minimal</text:p></office:text></office:body></office:document-content>',
      },
    ]),
  );
  const recu = paragraphesDuNoyau(bonOdt);
  check(
    'et le même document avec le bon type MIME s’ouvre',
    recu.paragraphes?.length === 1 && recu.paragraphes[0].texte === 'un texte ODF minimal',
    recu.erreur || `${recu.paragraphes?.length} paragraphes`,
  );
}

{
  /* Un XML abîmé : on construit un .docx dont `word/document.xml` est
     mal formé. Modifier les octets d'une vraie archive décalerait son annuaire
     central et le refus viendrait de l'archive, pas du XML — ce qui ne
     prouverait rien sur l'analyseur. */
  const docx = fabriquerArchive([
    {
      nom: 'word/document.xml',
      contenu:
        '<?xml version="1.0"?><w:document><w:body><w:p><w:t>texte</w:t></w:p></w:documenX>',
    },
  ]);
  refus('xml-abime.docx', docx, 'XML illisible');

  // Une balise jamais fermée.
  refus(
    'balise-ouverte.docx',
    fabriquerArchive([
      {
        nom: 'word/document.xml',
        contenu: '<?xml version="1.0"?><w:document><w:body><w:p><w:t>texte',
      },
    ]),
    'jamais fermée',
  );

  // Un attribut dont la valeur n'est pas refermée.
  refus(
    'guillemet.docx',
    fabriquerArchive([
      {
        nom: 'word/document.xml',
        contenu: '<?xml version="1.0"?><w:document val="inachevé></w:document>',
      },
    ]),
    '',
  );
}

{
  /* Une entité inconnue : le XML n'est pas bien formé, et le noyau ne devine
     pas. */
  refus(
    'entite-inconnue.docx',
    fabriquerArchive([
      {
        nom: 'word/document.xml',
        contenu:
          '<?xml version="1.0"?><w:document><w:body><w:p><w:t>texte &inconnue; ici</w:t></w:p></w:body></w:document>',
      },
    ]),
    'entité inconnue',
  );
  // Et AT&T, qui est du texte ordinaire, ne doit PAS faire refuser.
  const amp = temporaire('amper.docx');
  writeFileSync(
    amp,
    fabriquerArchive([
      {
        nom: 'word/document.xml',
        contenu:
          '<?xml version="1.0"?><w:document><w:body><w:p><w:t>AT&T et R&amp;D</w:t></w:p></w:body></w:document>',
      },
    ]),
  );
  const recuAmp = paragraphesDuNoyau(amp);
  check(
    'un « & » qui n’ouvre pas une entité est du texte, pas une erreur',
    recuAmp.paragraphes?.[0]?.texte === 'AT&T et R&D',
    recuAmp.erreur || recuAmp.paragraphes?.[0]?.texte,
  );
}

{
  /* Un .idml dont le designmap renvoie vers une histoire absente. */
  refus(
    'histoire-absente.idml',
    fabriquerArchive([
      {
        nom: 'designmap.xml',
        contenu:
          '<Document><idPkg:Story src="Stories/Story_absente.xml"/></Document>',
      },
    ]),
    'entrée manquante',
  );
}

{
  /* Une archive qui est bien une archive, mais pas un document : le noyau doit
     le dire en montrant ce qu'elle contient, pas en devinant. */
  refus(
    'pas-un-document.zip',
    fabriquerArchive([
      { nom: 'lisez-moi.txt', contenu: 'ceci est un ZIP quelconque' },
      { nom: 'donnees.csv', contenu: 'a,b,c\n1,2,3\n' },
    ]),
    'pas un document reconnu',
  );
}

console.log(
  `\n${ok ? 'OK : l’import lit les trois formats comme un extracteur indépendant, ne perd aucun caractère, et refuse ce qui est abîmé.' : 'ÉCHEC : voir les lignes \u2717 ci-dessus.'}`,
);
process.exit(ok ? 0 : 1);
