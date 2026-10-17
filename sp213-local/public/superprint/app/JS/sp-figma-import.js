/* ═══════════════════════════════════════════════════════════════════════════════
   SUPERPRINT — IMPORT FIGMA  (v1.7.659)
   ═══════════════════════════════════════════════════════════════════════════════

   CE QUE CE MODULE LIT : le JSON d'un fichier Figma, tel que le rendent
     · l'API REST   GET https://api.figma.com/v1/files/:key   (champ « document ») ;
     · ou le greffon « SuperPrint » (même forme de nœuds, plus les images en base64).
   Les deux sortent la MÊME structure (DOCUMENT → CANVAS → FRAME → nœuds), donc un
   seul lecteur suffit.

   CE QU'IL N'EST PAS : un lecteur de `.fig`. Le format `.fig` est un binaire
   propriétaire non documenté ; s'y attaquer produirait un lecteur qui casse à chaque
   version de Figma. On lit la représentation PUBLIQUE du document, pas son fichier.

   ⚠️ POURQUOI PAS DE CONVERSION D'UNITÉ SUR LES COORDONNÉES.
   Le canevas de SuperPrint est en POINTS (mmToPx(mm) = mm × 72/25,4), et Figma
   exprime ses géométries dans une unité qu'il appelle « px » mais qui vaut 1/72 de
   pouce à l'export print (1 px Figma = 1 pt). Les deux repères coïncident donc
   exactement : une position Figma se recopie telle quelle, sans facteur. Seul le
   FORMAT DE PAGE a besoin d'une conversion en millimètres, parce que c'est l'unité
   dans laquelle SuperPrint décrit un document.

   ⚠️ ORIGINE : les coordonnées d'un document Figma sont ABSOLUES (repère du canevas),
   alors qu'une page SuperPrint a la sienne. On retranche donc l'origine du cadre, et
   on ajoute le fond perdu — c'est la convention du .sp (les objets d'un document à
   3 mm de fond perdu sont décalés de mmToPx(3)).

   ⚠️ CE QUI EST APPROCHÉ, ET POURQUOI ON LE DIT :
     · les dégradés sont ramenés à leur PREMIER arrêt (le modèle SuperPrint connaît
       des dégradés, mais pas ceux de Figma : arrêts, poignées, transformations) ;
     · les images ne sont reprises que si le nœud porte une image déjà résolue
       (`spImageDataUrl`, `imageDataUrl` ou `dataUrl`) — l'API REST ne rend que des
       `imageRef` qu'il faut aller chercher par un second appel ; sans elle on pose
       un cadre vide de la bonne taille, JAMAIS un objet manquant en silence ;
     · VECTOR / BOOLEAN_OPERATION : on lit `fillGeometry` quand il est là (le tracé
       exact), sinon l'enveloppe du nœud ;
     · les effets (ombres, flous), les masques, les composants et les contraintes ne
       sont pas transportés : ils n'ont pas d'équivalent dans le modèle SuperPrint.
   ─────────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var VERSION = '1.7.659';
  var PT_MM = 25.4 / 72;          /* 1 pt (unité Figma) = 0,3528 mm */
  var BLEED_MM_DEFAUT = 3;

  /* ── Couleur d'un remplissage Figma ─────────────────────────────────────────── */
  function hexDepuisPaint(p) {
    if (!p) return null;
    if (p.type === 'SOLID' && p.color) {
      var c = p.color;
      var u = function (v) {
        var n = Math.round((typeof v === 'number' ? v : 0) * 255);
        return ('0' + Math.max(0, Math.min(255, n)).toString(16)).slice(-2);
      };
      var base = '#' + u(c.r) + u(c.g) + u(c.b);
      /* L'opacité d'un remplissage Figma est portée par le paint, pas par le nœud. */
      if (typeof p.opacity === 'number' && p.opacity < 1) {
        return { fill: base, opacity: Math.max(0, Math.min(1, p.opacity)) };
      }
      return { fill: base };
    }
    /* Dégradé : premier arrêt. On ne prétend pas reproduire la rampe. */
    if (Array.isArray(p.gradientStops) && p.gradientStops.length) {
      var s = p.gradientStops[0];
      var c2 = s && s.color;
      if (c2) {
        var u2 = function (v) {
          var n = Math.round((typeof v === 'number' ? v : 0) * 255);
          return ('0' + Math.max(0, Math.min(255, n)).toString(16)).slice(-2);
        };
        return { fill: '#' + u2(c2.r) + u2(c2.g) + u2(c2.b) };
      }
    }
    return null;
  }

  function premierFill(noeud) {
    var fills = noeud && noeud.fills;
    if (!Array.isArray(fills) || !fills.length) return null;
    for (var i = 0; i < fills.length; i++) {
      if (fills[i] && fills[i].visible === false) continue;
      return fills[i];
    }
    return null;
  }

  function imageDe(noeud) {
    var n = noeud || {};
    if (typeof n.spImageDataUrl === 'string' && n.spImageDataUrl) return n.spImageDataUrl;
    if (typeof n.imageDataUrl === 'string' && n.imageDataUrl) return n.imageDataUrl;
    if (typeof n.dataUrl === 'string' && n.dataUrl) return n.dataUrl;
    var f = premierFill(n);
    if (f && f.type === 'IMAGE') {
      if (typeof f.imageDataUrl === 'string' && f.imageDataUrl) return f.imageDataUrl;
      if (typeof f.spImageDataUrl === 'string' && f.spImageDataUrl) return f.spImageDataUrl;
    }
    var direct = n.image && typeof n.image === 'string' ? n.image : null;
    if (direct && /^(data:|https?:)/.test(direct)) return direct;
    return null;
  }

  /* ── Boîte absolue d'un nœud ────────────────────────────────────────────────── */
  function boite(n) {
    var b = n && n.absoluteBoundingBox;
    if (b && isFinite(b.x) && isFinite(b.y) && isFinite(b.width) && isFinite(b.height)) {
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    }
    /* `size` + `absoluteTransform` : la forme de repli quand la boîte manque. */
    if (n && n.size && Array.isArray(n.absoluteTransform)) {
      var t = n.absoluteTransform;
      return { x: t[0][2] || 0, y: t[1][2] || 0, w: n.size.x || 0, h: n.size.y || 0 };
    }
    return null;
  }

  /* ── Alignement de texte ────────────────────────────────────────────────────── */
  function alignFigma(a) {
    switch (String(a || '').toUpperCase()) {
      case 'CENTER': return 'center';
      case 'RIGHT': return 'right';
      case 'JUSTIFIED': return 'justify';
      default: return 'left';
    }
  }

  /* ── Construction d'un objet SuperPrint à partir d'un nœud Figma ────────────── */
  function objetDepuisNoeud(n, dx, dy, produits) {
    var b = boite(n);
    if (!b || b.w <= 0 || b.h <= 0) return;
    var type = String(n.type || '');
    var left = b.x + dx;
    var top = b.y + dy;
    var base = { left: Math.round(left * 100) / 100, top: Math.round(top * 100) / 100 };
    if (typeof n.opacity === 'number' && n.opacity < 1) base.opacity = n.opacity;
    if (typeof n.rotation === 'number' && n.rotation) base.angle = n.rotation;
    if (n.visible === false) base.visible = false;

    /* TEXTE */
    if (type === 'TEXT') {
      var st = n.style || {};
      var taille = typeof st.fontSize === 'number' && st.fontSize > 0 ? st.fontSize : 12;
      var lh = (typeof st.lineHeightPx === 'number' && st.lineHeightPx > 0)
        ? Math.max(0.8, Math.min(3, st.lineHeightPx / taille)) : 1.2;
      /* Figma écrit letterSpacing en points ; SuperPrint (Fabric) en millièmes d'em. */
      var cs = (typeof st.letterSpacing === 'number') ? (st.letterSpacing / taille) * 1000 : 0;
      var poids = Number(st.fontWeight);
      var o = Object.assign({}, base, {
        type: 'textbox',
        width: Math.round(b.w * 100) / 100,
        text: String(n.characters == null ? '' : n.characters),
        fontSize: Math.round(taille * 100) / 100,
        fontFamily: '"' + String(st.fontFamily || 'Open Sans').replace(/"/g, '') + '", "Open Sans", sans-serif',
        fontWeight: (isFinite(poids) && poids >= 600) ? 'bold' : 'normal',
        fontStyle: /italic|oblique/i.test(String(st.fontStyle || n.fontStyle || '')) ? 'italic' : 'normal',
        fill: '#000000',
        textAlign: alignFigma(st.textAlignHorizontal),
        lineHeight: lh,
        charSpacing: Math.round(cs * 100) / 100,
        splitByGrapheme: false,
        breakWords: true,
        styles: {}
      });
      var fp = hexDepuisPaint(premierFill(n));
      if (fp && fp.fill) o.fill = fp.fill;
      produits.push(o);
      return;
    }

    /* IMAGE */
    var url = imageDe(n);
    if (url && (type === 'RECTANGLE' || type === 'FRAME' || type === 'COMPONENT'
      || type === 'INSTANCE' || type === 'GROUP' || type === 'VECTOR'
      || type === 'ELLIPSE' || type === 'IMAGE')) {
      produits.push(Object.assign({}, base, {
        type: 'image',
        src: url,
        width: Math.round(b.w * 100) / 100,
        height: Math.round(b.h * 100) / 100
      }));
      return;
    }

    /* LIGNE */
    /* ⚠️ MESURÉ (banc d'audit, figma-real.json — export REST authentique) : une LINE
       Figma n'a NI `fillGeometry` NI `strokeGeometry` dans la réponse REST. Elle
       tombait donc dans la branche d'enveloppe et ressortait en RECTANGLE de
       123 × 45 — un cadre, là où Figma dessine un trait. Une LINE Figma va toujours
       du coin haut-gauche au coin bas-droit de sa boîte : la géométrie est donc
       entièrement déterminée par `absoluteBoundingBox`. Aucune approximation. */
    if (type === 'LINE') {
      var sl = (Array.isArray(n.strokes) && n.strokes.length) ? hexDepuisPaint(n.strokes[0]) : null;
      var couleurL = sl && sl.fill ? sl.fill : '#000000';
      var epaisL = (typeof n.strokeWeight === 'number' && n.strokeWeight > 0) ? n.strokeWeight : 1;
      try {
        if (typeof fabric !== 'undefined' && fabric.Line) {
          var ligne = new fabric.Line([0, 0, Math.round(b.w * 100) / 100, Math.round(b.h * 100) / 100], {
            left: left, top: top, stroke: couleurL, strokeWidth: epaisL,
            selectable: true, evented: true, originX: 'left', originY: 'top'
          });
          var ligneSer = ligne.toObject(['selectable', 'evented', 'hasControls', 'strokeUniform']);
          if (typeof n.opacity === 'number' && n.opacity < 1) ligneSer.opacity = n.opacity;
          produits.push(ligneSer);
          return;
        }
      } catch (_) { /* on retombe sur l'objet déclaratif ci-dessous */ }
      produits.push(Object.assign({}, base, {
        type: 'line',
        x1: 0, y1: 0,
        x2: Math.round(b.w * 100) / 100, y2: Math.round(b.h * 100) / 100,
        stroke: couleurL, strokeWidth: epaisL,
        fill: ''
      }));
      return;
    }

    /* ELLIPSE */
    if (type === 'ELLIPSE') {
      var fe = hexDepuisPaint(premierFill(n));
      var oe = Object.assign({}, base, {
        type: 'ellipse',
        width: Math.round(b.w * 100) / 100,
        height: Math.round(b.h * 100) / 100,
        rx: Math.round(b.w / 2 * 100) / 100,
        ry: Math.round(b.h / 2 * 100) / 100,
        fill: fe && fe.fill ? fe.fill : 'transparent',
        stroke: 'transparent',
        strokeWidth: 0
      });
      if (fe && fe.opacity !== undefined) oe.opacity = fe.opacity;
      appliquerContour(n, oe);
      produits.push(oe);
      return;
    }

    /* VECTEUR / OPÉRATION BOOLÉENNE : on prend le tracé exact quand il est fourni. */
    if (type === 'VECTOR' || type === 'BOOLEAN_OPERATION' || type === 'STAR'
      || type === 'POLYGON') {
      var geo = null;
      if (Array.isArray(n.fillGeometry) && n.fillGeometry.length && n.fillGeometry[0].path) {
        geo = n.fillGeometry[0].path;
      } else if (Array.isArray(n.strokeGeometry) && n.strokeGeometry.length && n.strokeGeometry[0].path) {
        geo = n.strokeGeometry[0].path;
      }
      if (geo && typeof fabric !== 'undefined' && fabric.Path) {
        try {
          var fpv = hexDepuisPaint(premierFill(n));
          var chemin = new fabric.Path(geo, {
            left: left, top: top,
            fill: fpv && fpv.fill ? fpv.fill : 'transparent',
            originX: 'left', originY: 'top', selectable: true, evented: true
          });
          var ser = chemin.toObject(['selectable', 'evented', 'hasControls']);
          if (typeof n.opacity === 'number' && n.opacity < 1) ser.opacity = n.opacity;
          if (typeof n.rotation === 'number' && n.rotation) ser.angle = n.rotation;
          produits.push(ser);
          return;
        } catch (_) { /* on retombe sur l'enveloppe */ }
      }
    }

    /* RECTANGLE / CADRE / GROUPE / INSTANCE : l'enveloppe, puis les enfants. */
    var f = hexDepuisPaint(premierFill(n));
    var or = Object.assign({}, base, {
      type: 'rect',
      width: Math.round(b.w * 100) / 100,
      height: Math.round(b.h * 100) / 100,
      fill: f && f.fill ? f.fill : 'transparent',
      stroke: 'transparent',
      strokeWidth: 0
    });
    var ray = n.cornerRadius;
    if (Array.isArray(n.rectangleCornerRadii) && n.rectangleCornerRadii.length) {
      ray = Math.max.apply(null, n.rectangleCornerRadii);
    }
    if (typeof ray === 'number' && ray > 0) { or.rx = ray; or.ry = ray; }
    if (f && f.opacity !== undefined) or.opacity = f.opacity;
    appliquerContour(n, or);
    /* Un conteneur sans remplissage ni contour n'a pas besoin d'exister : il
       n'apporterait qu'un rectangle transparent par-dessus lequel on ne peut rien
       faire. On ne le pose que s'il a une raison d'être. */
    if (or.fill !== 'transparent' || or.stroke !== 'transparent') produits.push(or);

    if (Array.isArray(n.children)) {
      for (var i = 0; i < n.children.length; i++) {
        try { objetDepuisNoeud(n.children[i], dx, dy, produits); } catch (_) {}
      }
    }
  }

  function appliquerContour(n, o) {
    var strokes = Array.isArray(n.strokes) ? n.strokes : [];
    if (!strokes.length) return;
    var sc = hexDepuisPaint(strokes[0]);
    if (!sc || !sc.fill) return;
    o.stroke = sc.fill;
    o.strokeWidth = typeof n.strokeWeight === 'number' ? n.strokeWeight : 1;
    if (Array.isArray(n.strokeDashes) && n.strokeDashes.length) o.strokeDashArray = n.strokeDashes.slice();
    if (n.strokeAlign && String(n.strokeAlign).toUpperCase() === 'INSIDE') o.strokeUniform = true;
  }

  /* ── Normalisation de la racine ─────────────────────────────────────────────── */
  /* MESURÉ (banc d'audit, fichiers réels) : le document Figma n'arrive pas toujours
     sous la forme `{ document: { type: 'DOCUMENT', children: [CANVAS] } }`. Quatre
     formes circulent dans la vraie vie, et deux d'entre elles étaient REJETÉES à
     tort — « ce fichier JSON n'est pas un document Figma » sur un fichier Figma :
       a. GET /v1/files/:key        → { document: DOCUMENT }
       b. greffon (racine)          → DOCUMENT directement
       c. GET /v1/files/:key/nodes  → { nodes: { '1:2': { document: <nœud> } } }
       d. sélection d'un cadre      → un FRAME / COMPONENT / GROUP à la racine
                                      (c'est le cas le plus fréquent d'un export de
                                      designer, et il était refusé)
     On ramène les trois dernières à la forme (a) avec un CANVAS de synthèse, pour
     que le reste du lecteur n'ait qu'un seul cas à connaître. */
  var TYPES_CADRE = /^(FRAME|COMPONENT|COMPONENT_SET|INSTANCE|SECTION)$/;

  function estNoeud(n) {
    return !!(n && typeof n === 'object' && typeof n.type === 'string' && n.type);
  }

  function normaliserRacine(json) {
    if (!json || typeof json !== 'object') return null;
    /* a. la forme canonique */
    if (estNoeud(json.document) && String(json.document.type) === 'DOCUMENT'
      && Array.isArray(json.document.children)) {
      return json.document;
    }
    /* b. DOCUMENT à la racine */
    if (String(json.type || '') === 'DOCUMENT' && Array.isArray(json.children)) {
      return json;
    }
    /* c. réponse de l'API « nodes » */
    if (json.nodes && typeof json.nodes === 'object') {
      var cadresNodes = [];
      Object.keys(json.nodes).forEach(function (cle) {
        var entree = json.nodes[cle] || {};
        var d = entree.document || entree;
        if (estNoeud(d)) cadresNodes.push(d);
      });
      if (cadresNodes.length) {
        return {
          type: 'DOCUMENT',
          name: String(json.name || 'Import Figma'),
          children: [{ type: 'CANVAS', name: 'Page 1', children: cadresNodes }]
        };
      }
    }
    /* d. un nœud seul (le cadre exporté) */
    if (estNoeud(json) && json.type !== 'CANVAS') {
      return {
        type: 'DOCUMENT',
        name: 'Import Figma',
        children: [{ type: 'CANVAS', name: 'Page 1', children: [json] }]
      };
    }
    /* Un CANVAS seul : ses enfants sont les cadres. */
    if (estNoeud(json) && json.type === 'CANVAS') {
      return {
        type: 'DOCUMENT',
        name: 'Import Figma',
        children: [json]
      };
    }
    return null;
  }

  /* ── Cadres de premier niveau → pages ───────────────────────────────────────── */
  function cadresDe(json) {
    var out = [];
    var racine = normaliserRacine(json);
    if (!racine) return out;
    var canvases = Array.isArray(racine.children) ? racine.children : [];
    for (var i = 0; i < canvases.length; i++) {
      var cv = canvases[i];
      if (!cv || !Array.isArray(cv.children)) continue;
      var avant = out.length;
      for (var j = 0; j < cv.children.length; j++) {
        var n = cv.children[j];
        if (!n) continue;
        /* Un CADRE est une page. Les nœuds qui traînent sur le canevas (hors cadre)
           ne sont pas des pages : ils sont réunis dans un cadre de synthèse. */
        if (TYPES_CADRE.test(String(n.type || ''))) {
          out.push({ noeud: n, canvas: cv });
        }
      }
      /* Aucun cadre : on fabrique une page avec les nœuds libres du canevas. */
      if (out.length === avant) {
        var libres = cv.children.filter(function (n) {
          return n && !TYPES_CADRE.test(String(n.type || ''));
        });
        if (libres.length) {
          out.push({ noeud: { type: 'FRAME', name: cv.name || 'Canvas', children: libres }, canvas: cv, synthetique: true });
        }
      }
    }
    return out;
  }

  /* ── Détection ──────────────────────────────────────────────────────────────── */
  function estFigma(json) {
    if (!json || typeof json !== 'object') return false;
    /* ⚠️ MESURÉ : la version précédente testait la forme canonique et le DOCUMENT
       à la racine, rien d'autre — un cadre exporté seul (forme la plus courante)
       était donc refusé. On s'appuie sur le NORMALISATEUR : s'il trouve une racine
       documentaire ET au moins un cadre, c'est un fichier Figma. */
    var r = normaliserRacine(json);
    if (!r) return false;
    return cadresDe(json).length > 0;
  }

  /* ── Conversion complète vers un document SuperPrint ────────────────────────── */
  function versSP(json, nomFichier, bleedMm) {
    var racine = normaliserRacine(json);
    if (!racine) throw new Error('document Figma introuvable');
    var bleed = (typeof bleedMm === 'number' && isFinite(bleedMm) && bleedMm >= 0) ? bleedMm : BLEED_MM_DEFAUT;
    var bleedPx = (bleed * 72) / 25.4;
    var cadres = cadresDe(json);
    if (!cadres.length) throw new Error('aucun cadre exploitable dans ce fichier Figma');

    var pages = [];
    var premiereBoite = null;
    for (var i = 0; i < cadres.length; i++) {
      var cadre = cadres[i];
      var n = cadre.noeud;
      var produits = [];
      var b = boite(n);
      if (!b) {
        /* Cadre synthétique : on prend l'union des enfants. */
        var u = null;
        (n.children || []).forEach(function (c) {
          var cb = boite(c);
          if (!cb) return;
          if (!u) u = { x: cb.x, y: cb.y, r: cb.x + cb.w, bo: cb.y + cb.h };
          else {
            u.x = Math.min(u.x, cb.x); u.y = Math.min(u.y, cb.y);
            u.r = Math.max(u.r, cb.x + cb.w); u.bo = Math.max(u.bo, cb.y + cb.h);
          }
        });
        if (!u) continue;
        b = { x: u.x, y: u.y, w: u.r - u.x, h: u.bo - u.y };
      }
      if (!premiereBoite) premiereBoite = b;
      /* dx/dy : origine du cadre → origine de la page, plus le fond perdu. */
      var dx = -b.x + bleedPx;
      var dy = -b.y + bleedPx;
      /* Le cadre lui-même n'est pas un objet (c'est la page) : on pose ses enfants. */
      if (Array.isArray(n.children)) {
        for (var k = 0; k < n.children.length; k++) {
          try { objetDepuisNoeud(n.children[k], dx, dy, produits); } catch (_) {}
        }
      } else {
        /* Cadre sans enfants : on le pose comme un rectangle plein. */
        try { objetDepuisNoeud(n, dx, dy, produits); } catch (_) {}
      }
      pages.push({
        objects: produits,
        label: String(n.name || ('Page ' + (i + 1)))
      });
    }
    if (!pages.length) throw new Error('aucun cadre exploitable dans ce fichier Figma');

    var mm = function (pt) { return Math.round(pt * PT_MM * 100) / 100; };
    var format = {
      width: mm(premiereBoite.w),
      height: mm(premiereBoite.h),
      unit: 'mm',
      orientation: premiereBoite.w > premiereBoite.h ? 'landscape' : 'portrait'
    };

    return {
      _sp: {
        format: 'SuperPrint Document',
        version: '1.0.0',
        generator: 'SuperPrint — import Figma ' + VERSION
      },
      meta: {
        title: String(nomFichier || (json && json.name) || 'Import Figma'),
        createdAt: new Date().toISOString(),
        source: 'figma'
      },
      document: {
        format: format,
        bleed: bleed,
        margin: 20,
        margins: { top: 20, bottom: 20, inner: 20, outer: 20, left: 20, right: 20 },
        viewMode: 'single'
      },
      resources: {},
      textLinks: {},
      guides: [],
      masters: { templates: {}, assignments: {} },
      numbering: { enabled: false },
      numberingOverrides: {},
      pages: pages
    };
  }

  window.SPFigmaImport = {
    version: VERSION,
    estFigma: estFigma,
    versSP: versSP,
    cadres: function (json) { return cadresDe(json).length; }
  };
})();
