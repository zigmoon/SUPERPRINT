/* ═══════════════════════════════════════════════════════════════════════════════
   SUPERPRINT — PLUG-IN « MOTIF VECTORIEL »  (v2.0.0, app 1.7.647)
   ═══════════════════════════════════════════════════════════════════════════════

   Ce que fait ce plug-in : il habille un fond de page — ou un bloc sélectionné —
   d'un MOTIF répété, d'une ROSACE, ou d'un KALÉIDOSCOPE construit à partir de la
   page elle-même. Le motif est une forme géométrique dessinée, ou une IMAGE
   importée (SVG, PNG, JPG) qui devient la tuile.

   ⚠️ POURQUOI UN MOTIF (fabric.Pattern) ET PAS DES MILLIERS D'OBJETS.
   Une page A4 à 8 mm de pas demande ~2 300 formes. Autant d'objets Fabric, c'est
   un ralenti immédiat à la sélection, à l'export PDF et à la sauvegarde — mesuré
   sur ce dépôt : un document de 130 objets pèse déjà 128 Ko.
   Un `fabric.Pattern` est UN objet : le navigateur répète la tuile au rendu, et
   l'export PDF la répète de la même façon. Le motif est donc instantané quelle que
   soit la densité, et il reste modifiable : on peut changer le pas ou la forme et
   réappliquer, l'ancien motif est retiré.

   ⚠️ LA TUILE EST DESSINÉE SUR UN CANVAS HORS ÉCRAN, À LA RÉSOLUTION DU DOCUMENT.
   La dessiner à 72 dpi donnerait des bords crénelés dès qu'on zoome ou qu'on
   exporte. On la dessine `facteur` fois plus grande (×4 par défaut) : nette à
   l'impression, et le motif la réduit au rendu — d'où le `patternTransform` de 1/4.

   ⚠️ v2.0.0 — LA SUPER-TUILE, ET POURQUOI ELLE EXISTE.
   Un `fabric.Pattern` répète UNE tuile à l'identique : impossible, avec une seule
   tuile, d'obtenir une variation d'une répétition à l'autre. On dessine donc une
   tuile de N × N CELLULES, chacune avec sa propre graine — la répétition reste
   parfaite (c'est la super-tuile qui se répète), mais l'œil voit N² cellules
   différentes. N = 1 par défaut (répétition pure), 2 ou 3 pour la variété.
   La graine est explicite : un même jeu de réglages redonne exactement le même
   dessin, donc un motif enregistré se réouvre à l'identique.

   ⚠️ LE KALÉIDOSCOPE EST LE GROUPE DU CARRÉ (D4), ET C'EST LE SEUL QUI PAVAILLE.
   Une rosace à 6 branches dans une tuile carrée laisse des coutures : 60° ne
   ramène pas un carré sur lui-même. Les 8 symétries qui le font sont les 4
   rotations (0/90/180/270°) et les 4 réflexions (horizontal, vertical, deux
   diagonales). Appliquées à une forme centrée, elles produisent une rosace
   kaléidoscopique ET jointive à la tuile suivante.
   « kaléidoscope dense » applique D4 deux fois, à deux échelles : plus rempli,
   toujours jointif.

   ⚠️ LE MODE « KALÉIDOSCOPE DE LA PAGE » EST UN VRAI KALÉIDOSCOPE, PAS UNE TUILE.
   Il prend le rendu de la page (le motif précédent ayant été retiré juste avant),
   le réduit dans un quadrant et le reflète dans les trois autres. C'est l'effet
   qu'on attend d'un kaléidoscope : la composition de l'utilisateur, démultipliée.
   Il coûte un `toDataURL` par application — d'où le fait qu'il soit un mode parmi
   d'autres et pas le comportement par défaut.

   ⚠️ APERÇU EN DIRECT — `api.apercu`.
   La trappe exécute ce plug-in à chaque mouvement de tirette. En aperçu,
   `api.apercu` vaut true : on ne valide pas d'entrée d'historique par mouvement
   (sinon il faudrait vingt Ctrl+Z pour revenir au dessin d'avant), on synchronise
   seulement `pages[]` pour qu'un rafraîchissement ne perde pas l'aperçu. La
   validation écrit UNE entrée, quel que soit le nombre d'aperçus.

   ⚠️ CE PLUG-IN EST AUSSI LE BANC D'ESSAI DE L'API.
   Il n'utilise QUE l'API documentée : `api.fabric`, `api.mm`, `api.document`,
   `api.selection`, `api.canvases`, `api.add`, `api.commit`, `api.sync`,
   `api.apercu`. S'il fonctionne sans rien d'autre, l'API est suffisante pour un
   plug-in réel.
   ─────────────────────────────────────────────────────────────────────────────── */
SPPluginAPI({
  id: 'motif-vectoriel',
  name: 'Motif vectoriel',
  version: '2.0.0',
  author: 'SuperPrint',
  icon: '▦',
  description: 'Répète une forme — ou une image — en motif, en rosace ou en kaléidoscope de la page. Aperçu en direct : chaque tirette se voit immédiatement.',

  options: [
    /* ── Cible et composition ─────────────────────────────────────────────── */
    {
      key: 'cible', label: 'Appliquer à', type: 'select', defaut: 'auto',
      choix: [
        { value: 'auto', label: 'Le bloc sélectionné, sinon toute la page' },
        { value: 'page', label: 'Toute la page' },
        { value: 'selection', label: 'Le bloc sélectionné uniquement' }
      ]
    },
    {
      key: 'mode', label: 'Effet', type: 'select', defaut: 'tuile',
      choix: [
        { value: 'tuile', label: 'Motif répété' },
        { value: 'rosette', label: 'Rosace (une seule, centrée)' },
        { value: 'miroir', label: 'Kaléidoscope de la page' }
      ],
      aide: 'Rosace et kaléidoscope ne se répètent pas : ils composent une seule image.'
    },

    /* ── Forme ────────────────────────────────────────────────────────────── */
    {
      key: 'forme', label: 'Forme', type: 'select', defaut: 'cercle',
      choix: [
        { value: 'cercle', label: 'Cercle' },
        { value: 'anneau', label: 'Anneau' },
        { value: 'carre', label: 'Carré' },
        { value: 'losange', label: 'Losange' },
        { value: 'triangle', label: 'Triangle' },
        { value: 'hexagone', label: 'Hexagone' },
        { value: 'etoile5', label: 'Étoile à 5 branches' },
        { value: 'etoile6', label: 'Étoile à 6 branches' },
        { value: 'croix', label: 'Croix' },
        { value: 'goutte', label: 'Goutte' },
        { value: 'fleur', label: 'Fleur (4 pétales)' },
        { value: 'spirale', label: 'Spirale' },
        { value: 'vague', label: 'Vague' },
        { value: 'lignes', label: 'Lignes diagonales' },
        { value: 'nid', label: 'Nid d\'abeille' }
      ]
    },
    {
      key: 'symetrie', label: 'Symétrie dans la tuile', type: 'select', defaut: 'aucune',
      choix: [
        { value: 'aucune', label: 'Aucune' },
        { value: 'miroir-x', label: 'Miroir horizontal' },
        { value: 'miroir-y', label: 'Miroir vertical' },
        { value: 'miroir-xy', label: 'Miroir deux axes' },
        { value: 'quart', label: 'Rotation 90° (4 branches)' },
        { value: 'kaleido', label: 'Kaléidoscope (8 branches)' },
        { value: 'kaleido16', label: 'Kaléidoscope dense (16)' }
      ],
      aide: 'Seules les symétries du carré pavillent sans couture — d\'où l\'absence de 6 branches.'
    },
    {
      key: 'graine', label: 'Graine du hasard', type: 'number', defaut: 7, min: 1, max: 9999, pas: 1,
      aide: 'Même graine + mêmes réglages = même dessin, à la réouverture comme à l\'écran.'
    },

    /* ── Géométrie ────────────────────────────────────────────────────────── */
    { key: 'pas', label: 'Pas du motif (mm)', type: 'number', defaut: 8, min: 1, max: 80, pas: 0.5,
      aide: 'Distance entre deux répétitions.' },
    { key: 'taille', label: 'Taille de la forme (mm)', type: 'number', defaut: 4, min: 0.4, max: 78, pas: 0.2,
      aide: 'Diamètre ou côté. Au-delà du pas, les formes se chevauchent.' },
    {
      key: 'ecart', label: 'Écart au centre de la cellule', type: 'range', defaut: 0.3, min: 0, max: 0.5, pas: 0.01,
      aide: 'Distance de la forme au centre, en fraction de cellule. À 0, les symétries se superposent : le kaléidoscope ne se voit pas.'
    },
    { key: 'angle', label: 'Rotation de la forme (°)', type: 'number', defaut: 0, min: 0, max: 360, pas: 1 },
    { key: 'rotationCellule', label: 'Rotation d\'une cellule à l\'autre (°)', type: 'number', defaut: 0, min: -90, max: 90, pas: 1,
      aide: 'Chaque cellule tourne un peu plus que la précédente : effet de vrille.' },
    { key: 'variation', label: 'Variation entre cellules', type: 'range', defaut: 0, min: 0, max: 1, pas: 0.05,
      aide: 'Déplace et redimensionne chaque cellule au hasard. 0 = répétition parfaite.' },
    { key: 'quinconce', label: 'Quinconce', type: 'range', defaut: 0, min: 0, max: 1, pas: 0.05,
      aide: 'Décale une ligne sur deux d\'une demi-cellule — appareil de briques.' },
    { key: 'onde', label: 'Onde (mm)', type: 'number', defaut: 0, min: 0, max: 40, pas: 0.5,
      aide: 'Fait onduler les rangées, sur une période égale à la tuile : le raccord reste continu.' },
    {
      key: 'cellules', label: 'Cellules par tuile', type: 'select', defaut: '1',
      choix: [
        { value: '1', label: '1 × 1 — répétition pure' },
        { value: '2', label: '2 × 2 — quatre variantes' },
        { value: '3', label: '3 × 3 — neuf variantes' }
      ],
      aide: 'La tuile est répétée telle quelle : plus de cellules = plus de variété, tuile plus lourde.'
    },

    /* ── Couleur ──────────────────────────────────────────────────────────── */
    { key: 'couleur', label: 'Couleur 1', type: 'color', defaut: '#1a1a1a' },
    { key: 'couleur2', label: 'Couleur 2', type: 'color', defaut: '#c8102e' },
    {
      key: 'degrade', label: 'Dégradé', type: 'select', defaut: 'aucun',
      choix: [
        { value: 'aucun', label: 'Aucun (couleur 1)' },
        { value: 'lineaire', label: 'Linéaire 1 → 2' },
        { value: 'radial', label: 'Radial 1 → 2' }
      ]
    },
    { key: 'fondTuile', label: 'Fond de la tuile', type: 'color', defaut: '#ffffff' },
    { key: 'fondActif', label: 'Remplir le fond de la tuile', type: 'checkbox', defaut: false,
      aide: 'Sans fond, la tuile est transparente : le papier ou le bloc se voit dessous.' },
    { key: 'trait', label: 'Trait seulement (pas de remplissage)', type: 'checkbox', defaut: false,
      aide: 'La forme est dessinée à la plume : l\'intérieur reste transparent.' },
    { key: 'epaisseur', label: 'Épaisseur du trait (mm)', type: 'number', defaut: 0.5, min: 0.05, max: 8, pas: 0.05 },
    { key: 'opacite', label: 'Opacité', type: 'range', defaut: 1, min: 0.05, max: 1, pas: 0.05 },

    /* ── Divers ───────────────────────────────────────────────────────────── */
    { key: 'image', label: 'Utiliser une image comme forme', type: 'image',
      aide: 'Un SVG, un PNG ou un JPG : l\'image devient la tuile répétée. Remplace la forme géométrique.' },
    {
      key: 'facteur', label: 'Netteté de la tuile', type: 'select', defaut: '4',
      choix: [
        { value: '2', label: '×2 — aperçu rapide' },
        { value: '4', label: '×4 — recommandé' },
        { value: '8', label: '×8 — très fin (export)' }
      ]
    },
    { key: 'libelle', label: 'Nom de l\'objet', type: 'text', defaut: 'Motif' }
  ],

  run: function (api, o) {
    var fabric = api.fabric;
    if (!fabric) throw new Error('moteur graphique indisponible');

    var pasMm = Math.max(1, Number(o.pas) || 8);
    var tailleMm = Math.max(0.4, Number(o.taille) || 4);
    var pasPx = api.mm(pasMm);
    var facteur = Math.max(1, Math.min(8, parseInt(o.facteur, 10) || 4));
    var angle = Number(o.angle) || 0;
    var rotationCellule = Number(o.rotationCellule) || 0;
    var variation = clamp01(o.variation);
    var quinconce = clamp01(o.quinconce);
    var ondeMm = Math.max(0, Number(o.onde) || 0);
    var cellules = Math.max(1, Math.min(3, parseInt(o.cellules, 10) || 1));
    var opacite = (typeof o.opacite === 'number') ? o.opacite : 1;
    var epaisseurPx = Math.max(0.5, api.mm(Math.max(0.05, Number(o.epaisseur) || 0.5)));
    var traitSeul = !!o.trait;
    var graine = Math.max(1, parseInt(o.graine, 10) || 7);
    var c1 = o.couleur || '#1a1a1a';
    var c2 = o.couleur2 || c1;

    function clamp01(v) {
      var n = Number(v);
      return isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
    }

    /* ── Générateur pseudo-aléatoire à graine (mulberry32) ──────────────────
       `Math.random()` ne convient pas : un motif doit se réouvrir à l'identique.
       Cette fonction rend la même suite pour une graine donnée, sur toutes les
       machines, sans dépendance. */
    function alea(s) {
      var a = s >>> 0;
      return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        var t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    /* ── Les symétries du carré (D4) ────────────────────────────────────────
       Appliquées autour du centre de la cellule. Ce sont les 8 transformations
       qui ramènent le carré sur lui-même : aucune ne crée de couture. */
    var D4 = [
      { rot: 0, mirX: 1, mirY: 1 },
      { rot: 90, mirX: 1, mirY: 1 },
      { rot: 180, mirX: 1, mirY: 1 },
      { rot: 270, mirX: 1, mirY: 1 },
      { rot: 0, mirX: -1, mirY: 1 },
      { rot: 0, mirX: 1, mirY: -1 },
      { rot: 90, mirX: -1, mirY: 1 },
      { rot: 90, mirX: 1, mirY: -1 }
    ];
    function symetries(mode) {
      switch (mode) {
        case 'miroir-x': return [{ rot: 0, mirX: 1, mirY: 1 }, { rot: 0, mirX: 1, mirY: -1 }];
        case 'miroir-y': return [{ rot: 0, mirX: 1, mirY: 1 }, { rot: 0, mirX: -1, mirY: 1 }];
        case 'miroir-xy': return [
          { rot: 0, mirX: 1, mirY: 1 }, { rot: 0, mirX: -1, mirY: 1 },
          { rot: 0, mirX: 1, mirY: -1 }, { rot: 0, mirX: -1, mirY: -1 }
        ];
        case 'quart': return D4.slice(0, 4);
        case 'kaleido': return D4;
        case 'kaleido16': return D4;
        default: return [{ rot: 0, mirX: 1, mirY: 1 }];
      }
    }

    /* ── Une forme, dessinée centrée en (0,0) ─────────────────────────────── */
    function dessinerForme(g, taillePx) {
      var r = taillePx / 2;
      var i, a, x, y, rr;
      switch (o.forme) {
        case 'carre':
          g.fillRect(-r, -r, taillePx, taillePx);
          break;
        case 'anneau':
          g.beginPath();
          g.arc(0, 0, r, 0, Math.PI * 2);
          g.arc(0, 0, r * 0.55, 0, Math.PI * 2, true);
          g.fill();
          break;
        case 'losange':
          g.beginPath();
          g.moveTo(0, -r); g.lineTo(r, 0); g.lineTo(0, r); g.lineTo(-r, 0);
          g.closePath(); g.fill();
          break;
        case 'triangle':
          g.beginPath();
          g.moveTo(0, -r); g.lineTo(r * 0.92, r * 0.72); g.lineTo(-r * 0.92, r * 0.72);
          g.closePath(); g.fill();
          break;
        case 'hexagone':
        case 'nid':
          g.beginPath();
          for (i = 0; i < 6; i++) {
            a = Math.PI / 3 * i - Math.PI / 2;
            x = Math.cos(a) * r; y = Math.sin(a) * r;
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.closePath(); g.fill();
          break;
        case 'etoile5':
        case 'etoile6': {
          var branches = (o.forme === 'etoile6') ? 6 : 5;
          var rInt = r * 0.44;
          g.beginPath();
          for (i = 0; i < branches * 2; i++) {
            rr = (i % 2 === 0) ? r : rInt;
            a = (Math.PI / branches) * i - Math.PI / 2;
            x = Math.cos(a) * rr; y = Math.sin(a) * rr;
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.closePath(); g.fill();
          break;
        }
        case 'croix': {
          var bras = taillePx / 3;
          g.fillRect(-bras / 2, -r, bras, taillePx);
          g.fillRect(-r, -bras / 2, taillePx, bras);
          break;
        }
        case 'goutte':
          g.beginPath();
          g.moveTo(0, -r);
          g.bezierCurveTo(r * 0.55, -r * 0.45, r * 0.85, r * 0.25, 0, r);
          g.bezierCurveTo(-r * 0.85, r * 0.25, -r * 0.55, -r * 0.45, 0, -r);
          g.closePath(); g.fill();
          break;
        case 'fleur':
          for (i = 0; i < 4; i++) {
            g.save();
            g.rotate(Math.PI / 2 * i);
            g.beginPath();
            g.ellipse(0, -r * 0.55, r * 0.34, r * 0.5, 0, 0, Math.PI * 2);
            g.fill();
            g.restore();
          }
          break;
        case 'spirale': {
          g.beginPath();
          var tours = 2.5, pasS = r / (tours * Math.PI * 2);
          for (i = 0; i <= 220; i++) {
            var t = i / 220 * tours * Math.PI * 2;
            var rad = pasS * t;
            x = Math.cos(t) * rad; y = Math.sin(t) * rad;
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.stroke();
          break;
        }
        case 'vague': {
          /* Une période exactement sur la largeur : le raccord d'une cellule à la
             suivante est continu, sans couture visible. */
          g.beginPath();
          var amp = r * 0.7;
          for (i = 0; i <= 32; i++) {
            var u = i / 32;
            x = -r + u * taillePx;
            y = Math.sin(u * Math.PI * 2) * amp;
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.stroke();
          break;
        }
        case 'lignes':
          g.beginPath();
          g.moveTo(-r, r); g.lineTo(r, -r);
          g.stroke();
          break;
        case 'cercle':
        default:
          g.beginPath();
          g.arc(0, 0, r, 0, Math.PI * 2);
          g.fill();
          break;
      }
    }

    /* ── Le remplissage : couleur unie ou dégradé ─────────────────────────── */
    function style(g, r) {
      if (traitSeul) {
        g.strokeStyle = (o.degrade === 'aucun') ? c1 : c2;
        g.lineWidth = epaisseurPx;
        g.lineCap = 'round';
        g.lineJoin = 'round';
      } else if (o.degrade === 'lineaire') {
        var gl = g.createLinearGradient(-r, -r, r, r);
        gl.addColorStop(0, c1); gl.addColorStop(1, c2);
        g.fillStyle = gl;
      } else if (o.degrade === 'radial') {
        var gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
        gr.addColorStop(0, c1); gr.addColorStop(1, c2);
        g.fillStyle = gr;
      } else {
        g.fillStyle = c1;
      }
    }

    /* ── Une cellule : la forme, multipliée par la symétrie choisie ───────── */
    function cellule(g, cx, cy, cote, angleExtra, aleatoire) {
      var sym = symetries(o.symetrie);
      var echelle = (variation > 0) ? (1 - variation * 0.45 * aleatoire()) : 1;
      var taille = api.mm(tailleMm) * facteur * echelle;
      /* ⚠️ L'ÉCART AU CENTRE EST CE QUI REND LE KALÉIDOSCOPE VISIBLE.
         MESURÉ au premier essai : une forme CENTRÉE est invariante par les huit
         symétries du carré — un cercle au centre donne un cercle, à l'identique.
         Les 8 copies se superposaient, et la tuile comptait 1 683 pixels opaques
         pour 1 679 sans symétrie : le réglage ne faisait RIEN de visible.
         En décalant la forme du centre, chaque symétrie en pose une copie ailleurs
         et l'on obtient la couronne de pétales qu'on attend d'un kaléidoscope.
         L'écart est exprimé en fraction de cellule, plafonné à 0,5 : au-delà, la
         forme sortirait de la cellule et le pavage aurait des trous. */
      var ecartPx = Math.min(0.5, Math.max(0, Number(o.ecart) || 0)) * cote;
      /* En kaléidoscope dense, une seconde passe à mi-échelle remplit les vides
         entre les branches — c'est ce qui donne l'aspect « rosace pleine ». */
      var passes = (o.symetrie === 'kaleido16')
        ? [{ f: 1, a: 0 }, { f: 0.55, a: Math.PI / 4 }]
        : [{ f: 1, a: 0 }];

      passes.forEach(function (p) {
        var rayon = taille * p.f / 2;
        sym.forEach(function (s) {
          g.save();
          g.translate(cx, cy);
          /* ⚠️ L'ORDRE DES TRANSFORMATIONS EST LE CŒUR DU KALÉIDOSCOPE, ET IL SE
             MESURE. Premier essai : `translate(écart)` PUIS `rotate(symétrie)`.
             La rotation s'appliquait alors autour du point déjà décalé, donc le
             CENTRE de la forme ne bougeait pas d'une copie à l'autre : les huit
             se superposaient exactement. Mesure : 1 588 pixels opaques sans
             symétrie, 1 595 avec — c'est-à-dire rien.
             Il faut tourner AUTOUR DU CENTRE DE LA CELLULE d'abord, puis décaler
             dans le repère déjà tourné : chaque copie part alors dans sa propre
             direction et la couronne apparaît. */
          g.rotate(((angle + angleExtra) * Math.PI / 180) + p.a);
          g.rotate(s.rot * Math.PI / 180);
          g.scale(s.mirX, s.mirY);
          g.translate(ecartPx * p.f, 0);
          style(g, rayon);
          dessinerForme(g, taille * p.f);
          g.restore();
        });
      });
    }

    /* ── La tuile (ou la super-tuile) ─────────────────────────────────────── */
    function tuile() {
      var N = cellules;
      var coteCellule = Math.max(6, pasPx * facteur);
      var cote = coteCellule * N;
      var cv = document.createElement('canvas');
      cv.width = Math.max(8, Math.round(cote));
      cv.height = Math.max(8, Math.round(cote));
      var g = cv.getContext('2d');
      if (!g) throw new Error('canvas 2D indisponible');

      if (o.fondActif) {
        g.fillStyle = o.fondTuile || '#ffffff';
        g.fillRect(0, 0, cv.width, cv.height);
      }

      var ondePx = api.mm(ondeMm) * facteur;
      for (var j = 0; j < N; j++) {
        for (var i = 0; i < N; i++) {
          var aleatoire = alea(graine * 7919 + j * 131 + i * 17 + 1);
          var cx = (i + 0.5) * coteCellule;
          var cy = (j + 0.5) * coteCellule;
          /* Quinconce : une ligne sur deux est décalée d'une demi-cellule. La forme
             peut alors sortir par la droite — on la redessine à gauche plus bas,
             sinon le motif aurait un trou d'un demi-pas. */
          if (quinconce > 0 && (j % 2 === 1)) cx += coteCellule * 0.5 * quinconce;
          if (variation > 0) {
            cx += (aleatoire() - 0.5) * coteCellule * 0.28 * variation;
            cy += (aleatoire() - 0.5) * coteCellule * 0.28 * variation;
          }
          if (ondePx > 0) {
            /* Période = largeur de la tuile : sin(2π x / W) retombe exactement sur
               sa valeur au bord, le raccord reste invisible. */
            cy += Math.sin((cx / cv.width) * Math.PI * 2) * ondePx;
          }
          var angleExtra = rotationCellule * (j * N + i);
          cellule(g, cx % cv.width, cy, coteCellule, angleExtra, aleatoire);
          if (cx > cv.width) {
            cellule(g, cx - cv.width, cy, coteCellule, angleExtra, alea(graine + i + j));
          }
        }
      }
      return cv;
    }

    /* ── La cible ────────────────────────────────────────────────────────── */
    function cible() {
      var doc = api.document;
      var sel = api.selection();
      if ((o.cible === 'selection' || o.cible === 'auto') && sel && sel.length) {
        var bloc = sel[0];
        return {
          objet: bloc,
          largeur: bloc.width * (bloc.scaleX || 1),
          hauteur: bloc.height * (bloc.scaleY || 1),
          gauche: bloc.left,
          haut: bloc.top,
          remplace: true
        };
      }
      if (o.cible === 'selection') {
        throw new Error('aucun bloc sélectionné : sélectionnez un cadre, ou choisissez « toute la page »');
      }
      return { objet: null, largeur: doc.largeur, hauteur: doc.hauteur, gauche: 0, haut: 0, remplace: false };
    }

    var c = cible();

    /* ── Nettoyage : le motif précédent de CE plug-in s'en va ──────────────
       Sur TOUS les plans de travail, pas seulement l'actif : changer de page puis
       revenir ne doit pas révéler un ancien motif resté en place. */
    try {
      api.canvases().forEach(function (cv2) {
        if (!cv2 || typeof cv2.getObjects !== 'function') return;
        cv2.getObjects().slice().forEach(function (obj) {
          if (obj && obj._spMotifPlugin) cv2.remove(obj);
        });
        if (cv2.requestRenderAll) cv2.requestRenderAll();
      });
    } catch (_) {}

    /* ── Le kaléidoscope de page : miroir du rendu, sans le motif ────────── */
    function sourcePage() {
      try {
        var el = null;
        var actif = (typeof window.getActiveCanvas === 'function') ? window.getActiveCanvas() : null;
        if (actif && actif.lowerCanvasEl) el = actif.lowerCanvasEl;
        if (!el) el = document.querySelector('#pagesContainer canvas');
        if (!el) return null;
        return el.toDataURL('image/png');
      } catch (_) { return null; }
    }

    function poserMiroir() {
      var source = sourcePage();
      if (!source) throw new Error('la page ne peut pas être relue pour le kaléidoscope');
      var cote = Math.max(64, Math.round(Math.min(c.largeur, c.hauteur) * 2));
      return new Promise(function (resolve, reject) {
        var src = new Image();
        src.onload = function () {
          try {
            var demi = cote / 2;
            var cv = document.createElement('canvas');
            cv.width = cote; cv.height = cote;
            var g = cv.getContext('2d');
            if (o.fondActif) { g.fillStyle = o.fondTuile || '#ffffff'; g.fillRect(0, 0, cote, cote); }
            /* Le rendu de la page est réduit dans le quadrant haut-gauche, puis
               reflété dans les trois autres : c'est la définition d'un kaléidoscope
               à quatre miroirs. */
            function quadrant(x, y, sx, sy) {
              g.save();
              g.translate(x, y);
              g.scale(sx, sy);
              g.drawImage(src, 0, 0, demi, demi);
              g.restore();
            }
            quadrant(0, 0, 1, 1);
            quadrant(cote, 0, -1, 1);
            quadrant(0, cote, 1, -1);
            quadrant(cote, cote, -1, -1);
            resolve(cv);
          } catch (e) { reject(e); }
        };
        src.onerror = function () { reject(new Error('kaléidoscope : rendu de page illisible')); };
        src.src = source;
      });
    }

    /* ── Poser ──────────────────────────────────────────────────────────── */
    return new Promise(function (resolve, reject) {
      function poser(sourceTuile, echelleMotif) {
        var echelle = (echelleMotif && isFinite(echelleMotif) && echelleMotif > 0) ? echelleMotif : 1;
        var pat = new fabric.Pattern({
          source: sourceTuile,
          repeat: 'repeat',
          /* Le facteur de netteté a déjà agrandi la tuile : il faut la remettre à
             l'échelle du document, sinon le motif serait `facteur` fois trop gros. */
          patternTransform: (echelle !== 1) ? [echelle, 0, 0, echelle, 0, 0] : undefined
        });

        if (c.remplace && c.objet) {
          if (!c.objet._spMotifAvant) {
            try { c.objet._spMotifAvant = c.objet.fill; } catch (_) {}
          }
          c.objet.set({ fill: pat });
          if (opacite < 1) c.objet.set({ opacity: opacite });
          c.objet._spMotifPlugin = true;
          c.objet._spMotifSurBloc = true;
          try { c.objet.dirty = true; } catch (_) {}
          try {
            var cvb = c.objet.canvas;
            if (cvb) { cvb.requestRenderAll ? cvb.requestRenderAll() : cvb.renderAll(); }
          } catch (_) {}
          if (api.apercu) api.sync();
          else api.commit('Plug-in : ' + (o.libelle || 'Motif'));
          resolve(c.objet);
          return;
        }

        var rect = new fabric.Rect({
          left: c.gauche, top: c.haut, width: c.largeur, height: c.hauteur,
          fill: pat, strokeWidth: 0, stroke: null,
          selectable: true, evented: true,
          objectCaching: false,
          noScaleCache: true
        });
        rect._spMotifPlugin = true;
        if (opacite < 1) rect.set({ opacity: opacite });
        try { rect.set({ name: o.libelle || 'Motif' }); } catch (_) {}
        api.add(rect, { libelle: 'Plug-in : ' + (o.libelle || 'Motif'), envoyerEnArriere: true });
        resolve(rect);
      }

      try {
        if (o.mode === 'miroir') {
          poserMiroir().then(function (cv) { poser(cv, 1); }).catch(reject);
          return;
        }

        if (o.mode === 'rosette') {
          /* Une seule rosace : une tuile de la taille du bloc, posée comme image.
             On ne peut pas s'en servir comme motif — `repeat: 'no-repeat'` n'existe
             pas dans Fabric 5 — mais une image donne exactement le même résultat
             pour une rosace unique. */
          var cote = Math.max(c.largeur, c.hauteur);
          var cvr = document.createElement('canvas');
          cvr.width = Math.round(cote); cvr.height = Math.round(cote);
          var gr = cvr.getContext('2d');
          if (o.fondActif) { gr.fillStyle = o.fondTuile || '#ffffff'; gr.fillRect(0, 0, cote, cote); }
          cellule(gr, cote / 2, cote / 2, cote, 0, alea(graine));
          var img = new fabric.Image(cvr, {
            left: c.gauche, top: c.haut,
            selectable: true, evented: true, objectCaching: false
          });
          try { img.set({ name: o.libelle || 'Rosace' }); } catch (_) {}
          img._spMotifPlugin = true;
          if (opacite < 1) img.set({ opacity: opacite });
          api.add(img, { libelle: 'Plug-in : ' + (o.libelle || 'Rosace'), envoyerEnArriere: true });
          resolve(img);
          return;
        }

        if (o.image) {
          var im = new Image();
          im.onload = function () {
            try {
              var coteI = Math.max(8, Math.round(pasPx * facteur * cellules));
              var cv = document.createElement('canvas');
              cv.width = coteI; cv.height = coteI;
              var g = cv.getContext('2d');
              if (o.fondActif) { g.fillStyle = o.fondTuile || '#ffffff'; g.fillRect(0, 0, coteI, coteI); }
              var t = api.mm(tailleMm) * facteur;
              var ratio = (im.width && im.height) ? (im.width / im.height) : 1;
              var w = t, h = t;
              if (ratio >= 1) h = t / ratio; else w = t * ratio;
              /* L'image est répétée dans chaque cellule de la super-tuile. */
              for (var jj = 0; jj < cellules; jj++) {
                for (var ii = 0; ii < cellules; ii++) {
                  var ccx = (ii + 0.5) * pasPx * facteur;
                  var ccy = (jj + 0.5) * pasPx * facteur;
                  g.save();
                  g.translate(ccx, ccy);
                  if (angle) g.rotate(angle * Math.PI / 180);
                  g.drawImage(im, -w / 2, -h / 2, w, h);
                  g.restore();
                }
              }
              poser(cv, 1 / facteur);
            } catch (e) { reject(e); }
          };
          im.onerror = function () { reject(new Error('image du motif illisible')); };
          im.src = o.image;
          return;
        }

        poser(tuile(), 1 / facteur);
      } catch (e) { reject(e); }
    });
  }
});
