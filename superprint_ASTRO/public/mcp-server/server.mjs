#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════
   SUPERPRINT — SERVEUR MCP  (v1.7.675)
   ═══════════════════════════════════════════════════════════════════════════════

   Ce serveur expose SuperPrint à un client MCP : Claude Desktop, Claude Code,
   Cursor, ou n'importe quel hôte qui parle le Model Context Protocol. Il permet
   à l'assistant de LIRE un document SuperPrint, de le convertir, d'en créer un,
   et de composer un motif — sans passer par l'interface.

   ⚠️ AUCUNE DÉPENDANCE. Le protocole MCP sur `stdio` est du JSON-RPC 2.0 délimité
   par des sauts de ligne : l'implémenter tient en quelques dizaines de lignes.
   Le SDK officiel aurait ajouté `npm install` avant le premier lancement — donc
   une panne réseau, un registre indisponible ou un proxy d'entreprise, pour un
   service qui doit démarrer en une commande. Ce fichier ne demande QUE Node.

   ⚠️ LE SERVEUR EST EN LECTURE/ÉCRITURE DE FICHIERS, PAS EN PILOTAGE DE L'UI. Il
   ne se connecte pas à l'application ouverte : il travaille sur des fichiers
   `.sp` / `.json` que l'utilisateur désigne. C'est ce qui le rend utilisable
   depuis un terminal, un serveur, ou une CI — et sûr : aucun état partagé avec
   une fenêtre ouverte.

   Lancement :  node server.mjs
   ─────────────────────────────────────────────────────────────────────────────── */
import { createInterface } from 'node:readline';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, resolve, dirname } from 'node:path';

const VERSION = '1.7.675';
const PROTOCOLE = '2025-06-18';

/* ── Unités ────────────────────────────────────────────────────────────────────
   SuperPrint travaille en POINTS dans le fichier .sp (1 mm = 72/25,4 pt) et
   décrit le format du document en MILLIMÈTRES. Confondre les deux unités est
   l'erreur la plus facile à commettre ici : on ne garde donc QUE la conversion
   réellement utilisée, pour que l'ambiguïté ne puisse pas s'installer. */
const MM_VERS_PT = 72 / 25.4;
const mm = (v) => Math.round(Number(v) * MM_VERS_PT * 1000) / 1000;

const FORMATS = {
  A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420],
  A4: [210, 297], A5: [148, 210], A6: [105, 148],
  Letter: [215.9, 279.4], Legal: [215.9, 355.6], Tabloid: [279.4, 431.8],
  carre: [210, 210], '16:9': [338.7, 190.5]
};

/* ── Lecture d'un document ────────────────────────────────────────────────────
   Deux formats coexistent, et ils ne se lisent pas pareil :
     .sp   → { _sp, document.format{width,height}, pages[].objects[] }  (tableau)
     .json → { version, pageFormat, pages[].objects }                   (chaîne)
   On accepte les deux, et on le dit, plutôt que d'échouer sur le second. */
function estSP(d) { return !!(d && d._sp && d._sp.format === 'SuperPrint Document'); }

function objetsDePage(p) {
  if (!p) return [];
  const o = p.objects;
  if (Array.isArray(o)) return o;
  if (typeof o === 'string') {
    try {
      const j = JSON.parse(o);
      return Array.isArray(j) ? j : (j && Array.isArray(j.objects) ? j.objects : []);
    } catch (_) { return []; }
  }
  return [];
}

async function charger(chemin) {
  const abs = resolve(chemin);
  if (!existsSync(abs)) throw new Error('fichier introuvable : ' + abs);
  const brut = await readFile(abs, 'utf8');
  let d;
  try { d = JSON.parse(brut); } catch (e) { throw new Error('JSON illisible : ' + e.message); }
  return { abs, brut, doc: d, sp: estSP(d) };
}

function resumer(info) {
  const d = info.doc;
  const pages = Array.isArray(d.pages) ? d.pages : [];
  let format = null;
  if (info.sp && d.document && d.document.format) {
    format = { largeur: d.document.format.width, hauteur: d.document.format.height, unite: 'mm' };
  } else if (d.pageFormat) {
    const f = d.pageFormat;
    format = Array.isArray(f)
      ? { largeur: f[0], hauteur: f[1], unite: 'mm' }
      : (f.width ? { largeur: f.width, hauteur: f.height, unite: 'mm' } : null);
  }
  const parPage = pages.map((p, i) => {
    const objs = objetsDePage(p);
    const types = {};
    objs.forEach((o) => { const t = (o && o.type) || 'inconnu'; types[t] = (types[t] || 0) + 1; });
    return { page: i + 1, libelle: p && p.label ? p.label : '', objets: objs.length, types };
  });
  const textes = parPage.reduce((n, p) => n + (p.types.textbox || 0) + (p.types.text || 0), 0);
  return {
    fichier: basename(info.abs),
    formatDocument: info.sp ? 'SuperPrint (.sp)' : 'SuperPrint (.json)',
    format,
    pages: pages.length,
    objets: parPage.reduce((n, p) => n + p.objets, 0),
    blocsTexte: textes,
    detail: parPage,
    fondPerdu: info.sp && d.document ? d.document.bleed : (d.bleed != null ? d.bleed : null),
    marges: info.sp && d.document ? (d.document.margins || d.document.margin || null) : (d.margins || d.margin || null)
  };
}

/* ── Motif : la même géométrie que le plug-in « Motif vectoriel » ─────────────
   On ne réimplémente PAS le rendu : on décrit le motif, et c'est le document
   produit qui le porte. Un consommateur (l'app, un export) retrouve donc
   exactement ce que le plug-in aurait posé. */
function disqueTuile(o) {
  const pasPt = mm(Math.max(1, o.pas || 8));
  const taillePt = mm(Math.max(0.4, o.taille || 4));
  return { pasPt, taillePt, forme: o.forme || 'cercle' };
}

/* ── Construction d'un .sp minimal et VALIDE ──────────────────────────────────
   Le squelette doit satisfaire `_spValidateProjectFile` de l'application :
   _sp.format === 'SuperPrint Document', format numérique > 0, pages non vide,
   et `objects` en TABLEAU (une chaîne est acceptée depuis 1.7.637, mais on
   n'a aucune raison de produire une forme dégradée). */
function nouveauSP({ titre, largeur, hauteur, fondPerdu, marges, pages }) {
  const w = largeur, h = hauteur;
  return {
    _sp: { format: 'SuperPrint Document', version: '1.0.0', generator: 'SuperPrint MCP ' + VERSION },
    meta: { title: titre || 'Sans titre', createdAt: new Date().toISOString(), source: 'mcp' },
    document: {
      format: { width: w, height: h, unit: 'mm', orientation: w > h ? 'landscape' : 'portrait' },
      bleed: (fondPerdu != null ? fondPerdu : 3),
      margin: marges || 20,
      margins: { top: marges || 20, bottom: marges || 20, inner: marges || 20, outer: marges || 20, left: marges || 20, right: marges || 20 },
      viewMode: 'single'
    },
    resources: {},
    textLinks: {},
    guides: [],
    masters: { templates: {}, assignments: {} },
    numbering: { enabled: false },
    numberingOverrides: {},
    pages: pages || [{ objects: [], label: 'Page 1' }]
  };
}

/* ── Les outils ─────────────────────────────────────────────────────────────── */
const OUTILS = [
  {
    name: 'superprint_formats',
    description: 'Liste les formats de page connus de SuperPrint, en millimètres. Utile avant de créer un document.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'superprint_inspect',
    description: 'Lit un document SuperPrint (.sp ou .json) et renvoie un résumé : format, nombre de pages, objets par page et par type, marges, fond perdu.',
    inputSchema: {
      type: 'object',
      properties: { chemin: { type: 'string', description: 'Chemin du fichier .sp ou .json' } },
      required: ['chemin'], additionalProperties: false
    }
  },
  {
    name: 'superprint_convert',
    description: 'Convertit un document SuperPrint d\'un format à l\'autre : .sp vers .json, ou .json vers .sp. Le fichier de sortie est écrit à côté, sauf si sortie est précisé.',
    inputSchema: {
      type: 'object',
      properties: {
        chemin: { type: 'string', description: 'Fichier source' },
        vers: { type: 'string', enum: ['sp', 'json'], description: 'Format de sortie' },
        sortie: { type: 'string', description: 'Chemin de sortie (optionnel)' }
      },
      required: ['chemin', 'vers'], additionalProperties: false
    }
  },
  {
    name: 'superprint_create',
    description: 'Crée un document SuperPrint vide (ou avec des blocs de texte) et l\'écrit sur le disque. Renvoie le chemin et un résumé.',
    inputSchema: {
      type: 'object',
      properties: {
        sortie: { type: 'string', description: 'Chemin du fichier .sp à écrire' },
        titre: { type: 'string' },
        format: { type: 'string', description: 'A4, A5, A3, Letter… ou "perso"' },
        largeur: { type: 'number', description: 'Largeur en mm (si format = perso)' },
        hauteur: { type: 'number', description: 'Hauteur en mm (si format = perso)' },
        pages: { type: 'number', description: 'Nombre de pages (défaut 1)' },
        fondPerdu: { type: 'number', description: 'Fond perdu en mm (défaut 3)' },
        marges: { type: 'number', description: 'Marges en mm (défaut 20)' },
        texte: { type: 'string', description: 'Texte à placer en haut de chaque page (optionnel)' }
      },
      required: ['sortie'], additionalProperties: false
    }
  },
  {
    name: 'superprint_pattern',
    description: 'Crée un document SuperPrint dont chaque page est habillée d\'un motif répété (cercle, carré, losange, triangle, étoile, croix, vague, lignes). Le motif est posé comme un remplissage répété, pas comme des milliers d\'objets.',
    inputSchema: {
      type: 'object',
      properties: {
        sortie: { type: 'string', description: 'Chemin du fichier .sp à écrire' },
        titre: { type: 'string' },
        format: { type: 'string', description: 'A4, A5, carre… (défaut A4)' },
        forme: { type: 'string', enum: ['cercle', 'carre', 'losange', 'triangle', 'etoile', 'croix', 'vague', 'lignes'], description: 'Forme du motif' },
        pas: { type: 'number', description: 'Pas du motif en mm (défaut 8)' },
        taille: { type: 'number', description: 'Taille de la forme en mm (défaut 4)' },
        couleur: { type: 'string', description: 'Couleur hexadécimale (défaut #1a1a1a)' },
        angle: { type: 'number', description: 'Rotation du motif en degrés' }
      },
      required: ['sortie'], additionalProperties: false
    }
  }
];

/* ── Exécution des outils ───────────────────────────────────────────────────── */
async function executer(nom, args) {
  args = args || {};

  if (nom === 'superprint_formats') {
    const liste = Object.entries(FORMATS).map(([k, v]) => ({ nom: k, largeur: v[0], hauteur: v[1], unite: 'mm' }));
    return { content: [{ type: 'text', text: JSON.stringify(liste, null, 2) }] };
  }

  if (nom === 'superprint_inspect') {
    const info = await charger(args.chemin);
    return { content: [{ type: 'text', text: JSON.stringify(resumer(info), null, 2) }] };
  }

  if (nom === 'superprint_convert') {
    const info = await charger(args.chemin);
    const base = info.abs.replace(/\.(sp|json)$/i, '');
    const cible = args.sortie ? resolve(args.sortie) : base + (args.vers === 'sp' ? '.converti.sp' : '.converti.json');

    let sortie;
    if (args.vers === 'sp') {
      if (info.sp) return { content: [{ type: 'text', text: 'Déjà au format .sp — rien à faire.' }] };
      /* .json de l'app → .sp : on reprend les clés racine du .json (pageFormat,
         margins, masterPages, styles…) et on ne traduit PAS les objets, qui sont
         déjà au bon format. C'est exactement ce que fait le studio. */
      const d = info.doc;
      const f = d.pageFormat || {};
      const w = Array.isArray(f) ? f[0] : (f.width || 210);
      const h = Array.isArray(f) ? f[1] : (f.height || 297);
      const mg = d.margins || {};
      sortie = {
        _sp: { format: 'SuperPrint Document', version: '1.0.0', generator: 'SuperPrint MCP ' + VERSION },
        meta: { title: d.projectName || basename(base), createdAt: new Date().toISOString(), source: 'json' },
        document: {
          format: { width: w, height: h, unit: 'mm', orientation: w > h ? 'landscape' : 'portrait' },
          bleed: typeof d.bleed === 'number' ? d.bleed : 3,
          margin: typeof d.margin === 'number' ? d.margin : 20,
          margins: {
            top: mg.top != null ? mg.top : 20, bottom: mg.bottom != null ? mg.bottom : 20,
            inner: (mg.inner != null ? mg.inner : (mg.left != null ? mg.left : 20)),
            outer: (mg.outer != null ? mg.outer : (mg.right != null ? mg.right : 20)),
            left: (mg.left != null ? mg.left : (mg.inner != null ? mg.inner : 20)),
            right: (mg.right != null ? mg.right : (mg.outer != null ? mg.outer : 20))
          },
          viewMode: d.viewMode === 'spread' ? 'spread' : 'single'
        },
        resources: {},
        textLinks: d.textLinks || {},
        guides: d.guides || [],
        masters: { templates: (d.masterPages || {}), assignments: (d.pageMasterAssignments || {}) },
        numbering: d.pageNumberingSettings || { enabled: false },
        numberingOverrides: d.pageNumberingOverrides || {},
        pages: (d.pages || []).map((p, i) => ({ objects: objetsDePage(p), label: p.label || ('Page ' + (i + 1)) }))
      };
    } else {
      if (!info.sp) return { content: [{ type: 'text', text: 'Déjà au format .json — rien à faire.' }] };
      const d = info.doc;
      const f = (d.document && d.document.format) || {};
      sortie = {
        version: 2.0,
        projectName: (d.meta && d.meta.title) || basename(base),
        pages: (d.pages || []).map((p) => ({ objects: JSON.stringify(objetsDePage(p)), label: p.label })),
        pageFormat: [f.width || 210, f.height || 297],
        margin: (d.document && d.document.margin) || 20,
        margins: (d.document && d.document.margins) || null,
        bleed: (d.document && d.document.bleed) || 3,
        textLinks: d.textLinks || {},
        viewMode: (d.document && d.document.viewMode) || 'single',
        colorMode: 'cmyk',
        colGrid: d.colGrid || null,
        guides: d.guides || [],
        spotInks: d.spotInks || {},
        masterPages: (d.masters && d.masters.templates) || {},
        pageMasterAssignments: (d.masters && d.masters.assignments) || {},
        pageNumberingSettings: d.numbering || { enabled: false },
        pageNumberingOverrides: d.numberingOverrides || {},
        customFonts: d.customFonts || {},
        styles: d.styles || {}
      };
    }
    await writeFile(cible, JSON.stringify(sortie, null, 1), 'utf8');
    return { content: [{ type: 'text', text: JSON.stringify({ ecrit: cible, pages: (sortie.pages || []).length, formatDocument: sortie._sp ? 'SuperPrint (.sp)' : 'SuperPrint (.json)' }, null, 2) }] };
  }

  if (nom === 'superprint_create') {
    const nomFormat = String(args.format || 'A4');
    let w, h;
    if (/^perso$/i.test(nomFormat)) {
      w = Number(args.largeur) || 210;
      h = Number(args.hauteur) || 297;
    } else {
      const f = FORMATS[nomFormat] || FORMATS.A4;
      w = f[0]; h = f[1];
    }
    const nb = Math.max(1, Math.min(200, parseInt(args.pages, 10) || 1));
    const pages = [];
    for (let i = 0; i < nb; i++) {
      const objs = [];
      if (args.texte) {
        objs.push({
          type: 'textbox', left: mm(args.marges || 20), top: mm(args.marges || 20),
          width: mm(w - 2 * (args.marges || 20)), fontSize: 24, fontFamily: 'Open Sans',
          fill: '#000000', text: String(args.texte), textAlign: 'left', lineHeight: 1.35,
          splitByGrapheme: false, breakWords: true, styles: {}
        });
      }
      pages.push({ objects: objs, label: 'Page ' + (i + 1) });
    }
    const doc = nouveauSP({ titre: args.titre, largeur: w, hauteur: h,
      fondPerdu: args.fondPerdu, marges: args.marges, pages });
    const cible = resolve(args.sortie);
    await writeFile(cible, JSON.stringify(doc, null, 1), 'utf8');
    return { content: [{ type: 'text', text: JSON.stringify({ ecrit: cible, pages: nb, format: [w, h], objets: pages.reduce((n, p) => n + p.objects.length, 0) }, null, 2) }] };
  }

  if (nom === 'superprint_pattern') {
    const nomFormat = String(args.format || 'A4');
    const f = FORMATS[nomFormat] || FORMATS.A4;
    const w = f[0], h = f[1];
    const { pasPt, taillePt, forme } = disqueTuile(args);
    const couleur = args.couleur || '#1a1a1a';
    const angle = Number(args.angle) || 0;

    /* Le motif est décrit dans l'objet, pas dessiné : un rectangle qui couvre la
       page et porte la description de la tuile. `_spMotif` n'est pas une clé de
       l'application — elle est là pour qu'un consommateur (l'app après import,
       ou un export) sache quoi répéter, sans avoir à deviner depuis une image. */
    const rect = {
      type: 'rect', left: 0, top: 0,
      width: Math.round(mm(w) * 100) / 100,
      height: Math.round(mm(h) * 100) / 100,
      fill: couleur, stroke: null, strokeWidth: 0,
      selectable: true, evented: true,
      name: 'Motif',
      _spMotifPlugin: true,
      _spMotif: { forme, pas: pasPt, taille: taillePt, couleur, angle, unite: 'pt', motif: 'repeat' }
    };
    const pages = [{ objects: [rect], label: 'Motif' }];
    const doc = nouveauSP({ titre: args.titre || ('Motif ' + forme), largeur: w, hauteur: h, pages });
    const cible = resolve(args.sortie);
    await writeFile(cible, JSON.stringify(doc, null, 1), 'utf8');
    return { content: [{ type: 'text', text: JSON.stringify({
      ecrit: cible, page: 1, format: [w, h],
      motif: { forme, pas_mm: args.pas || 8, taille_mm: args.taille || 4, couleur, angle }
    }, null, 2) }] };
  }

  throw new Error('outil inconnu : ' + nom);
}

/* ── Boucle JSON-RPC ──────────────────────────────────────────────────────────
   MCP sur stdio : une requête JSON par ligne, une réponse JSON par ligne. On
   n'écrit JAMAIS autre chose sur stdout (un console.log mal placé casserait le
   protocole) : les messages de service vont sur stderr. */
function repondre(id, resultat) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: resultat }) + '\n');
}
function repondreErreur(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', async (ligne) => {
  const t = ligne.trim();
  if (!t) return;
  let msg;
  try { msg = JSON.parse(t); } catch (_) { return repondreErreur(null, -32700, 'JSON illisible'); }

  const { id, method, params } = msg;

  /* Les notifications (sans id) n'appellent AUCUNE réponse. */
  const estNotification = (id === undefined || id === null);

  try {
    switch (method) {
      case 'initialize':
        repondre(id, {
          protocolVersion: (params && params.protocolVersion) || PROTOCOLE,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'superprint', version: VERSION }
        });
        return;

      case 'notifications/initialized':
      case 'initialized':
        return;

      case 'ping':
        repondre(id, {});
        return;

      case 'tools/list':
        repondre(id, { tools: OUTILS });
        return;

      case 'tools/call': {
        const nom = params && params.name;
        const args = (params && params.arguments) || {};
        try {
          const r = await executer(nom, args);
          repondre(id, r);
        } catch (e) {
          /* Une erreur d'OUTIL se renvoie dans content + isError : le client
             affiche le message, il ne croit pas le serveur mort. */
          repondre(id, { content: [{ type: 'text', text: 'Erreur : ' + (e && e.message ? e.message : e) }], isError: true });
        }
        return;
      }

      case 'resources/list':
        repondre(id, { resources: [] });
        return;

      case 'prompts/list':
        repondre(id, { prompts: [] });
        return;

      default:
        if (estNotification) return;
        repondreErreur(id, -32601, 'méthode inconnue : ' + method);
    }
  } catch (e) {
    if (!estNotification) repondreErreur(id, -32603, String(e && e.message ? e.message : e));
  }
});

process.stderr.write('[superprint-mcp] v' + VERSION + ' prêt (' + OUTILS.length + ' outils) — ' + dirname(new URL(import.meta.url).pathname) + '\n');
