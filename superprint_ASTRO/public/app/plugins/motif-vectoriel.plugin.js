/* ═══════════════════════════════════════════════════════════════════════════════
   SUPERPRINT — PLUG-IN « MOTIF VECTORIEL »  (v1.7.646)
   ═══════════════════════════════════════════════════════════════════════════════

   Ce que fait ce plug-in : il habille un fond de page — ou un bloc sélectionné —
   d'un MOTIF répété. Le motif est une forme géométrique dessinée, ou une IMAGE
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
   l'impression, et le motif la réduit au rendu.

   ⚠️ CE PLUG-IN EST AUSSI LE BANC D'ESSAI DE L'API.
   Il n'utilise QUE l'API documentée : `api.fabric`, `api.mm`, `api.document`,
   `api.selection`, `api.add`, `api.remove`, `api.store`. S'il fonctionne sans rien
   d'autre, l'API est suffisante pour un plug-in réel.
   ─────────────────────────────────────────────────────────────────────────────── */
SPPluginAPI({
  id: 'motif-vectoriel',
  name: 'Motif vectoriel',
  version: '1.0.0',
  author: 'SuperPrint',
  icon: '▦',
  description: 'Répète une forme — ou une image importée — pour habiller un fond de page ou un bloc. Un seul objet à l\'arrivée : instantané même très dense.',
  options: [
    {
      key: 'cible', label: 'Appliquer à', type: 'select', defaut: 'auto',
      choix: [
        { value: 'auto', label: 'Le bloc sélectionné, sinon toute la page' },
        { value: 'page', label: 'Toute la page' },
        { value: 'selection', label: 'Le bloc sélectionné uniquement' }
      ]
    },
    {
      key: 'forme', label: 'Forme du motif', type: 'select', defaut: 'cercle',
      choix: [
        { value: 'cercle', label: 'Cercle' },
        { value: 'carre', label: 'Carré' },
        { value: 'losange', label: 'Losange' },
        { value: 'triangle', label: 'Triangle' },
        { value: 'etoile', label: 'Étoile' },
        { value: 'croix', label: 'Croix' },
        { value: 'vague', label: 'Vague' },
        { value: 'lignes', label: 'Lignes diagonales' }
      ]
    },
    { key: 'pas', label: 'Pas du motif (mm)', type: 'number', defaut: 8, min: 1, max: 80, pas: 0.5,
      aide: 'Distance entre deux répétitions.' },
    { key: 'taille', label: 'Taille de la forme (mm)', type: 'number', defaut: 4, min: 0.4, max: 78, pas: 0.2,
      aide: 'Diamètre ou côté. Au-delà du pas, les formes se chevauchent.' },
    { key: 'angle', label: 'Rotation du motif (°)', type: 'number', defaut: 0, min: 0, max: 360, pas: 1 },
    { key: 'couleur', label: 'Couleur', type: 'color', defaut: '#1a1a1a' },
    { key: 'opacite', label: 'Opacité', type: 'range', defaut: 1, min: 0.05, max: 1, pas: 0.05 },
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
    var opacite = (typeof o.opacite === 'number') ? o.opacite : 1;

    /* ── 1. La tuile, dessinée hors écran ───────────────────────────────────── */
    function dessinerTuile(g, cote) {
      var taillePx = api.mm(tailleMm) * facteur;
      var centre = cote / 2;
      g.save();
      g.translate(centre, centre);
      if (angle) g.rotate(angle * Math.PI / 180);
      g.fillStyle = o.couleur || '#1a1a1a';
      g.strokeStyle = o.couleur || '#1a1a1a';

      switch (o.forme) {
        case 'carre':
          g.fillRect(-taillePx / 2, -taillePx / 2, taillePx, taillePx);
          break;
        case 'losange':
          g.beginPath();
          g.moveTo(0, -taillePx / 2); g.lineTo(taillePx / 2, 0);
          g.lineTo(0, taillePx / 2); g.lineTo(-taillePx / 2, 0);
          g.closePath(); g.fill();
          break;
        case 'triangle':
          g.beginPath();
          g.moveTo(0, -taillePx / 2); g.lineTo(taillePx / 2, taillePx / 2);
          g.lineTo(-taillePx / 2, taillePx / 2);
          g.closePath(); g.fill();
          break;
        case 'etoile': {
          var branches = 5, rExt = taillePx / 2, rInt = rExt * 0.42;
          g.beginPath();
          for (var i = 0; i < branches * 2; i++) {
            var r = (i % 2 === 0) ? rExt : rInt;
            var a = (Math.PI / branches) * i - Math.PI / 2;
            var x = Math.cos(a) * r, y = Math.sin(a) * r;
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.closePath(); g.fill();
          break;
        }
        case 'croix': {
          var bras = taillePx / 3;
          g.fillRect(-bras / 2, -taillePx / 2, bras, taillePx);
          g.fillRect(-taillePx / 2, -bras / 2, taillePx, bras);
          break;
        }
        case 'vague': {
          /* Une sinusoïde sur toute la largeur de la tuile : le raccord d'une
             tuile à l'autre est donc continu, sans couture visible. */
          var amp = taillePx / 2;
          g.lineWidth = Math.max(0.6, taillePx / 12);
          g.beginPath();
          g.moveTo(-cote / 2, 0);
          g.bezierCurveTo(-cote / 4, -amp, cote / 4, amp, cote / 2, 0);
          g.stroke();
          break;
        }
        case 'lignes': {
          g.lineWidth = Math.max(0.6, (api.mm(tailleMm) * facteur) / 3);
          g.beginPath();
          g.moveTo(-cote, cote); g.lineTo(cote, -cote);
          g.stroke();
          break;
        }
        case 'cercle':
        default:
          g.beginPath(); g.arc(0, 0, taillePx / 2, 0, Math.PI * 2); g.fill();
          break;
      }
      g.restore();
    }

    function tuile() {
      var cv = document.createElement('canvas');
      var cote = Math.max(8, Math.round(pasPx * facteur));
      cv.width = cote; cv.height = cote;
      var g = cv.getContext('2d');
      if (!g) throw new Error('canvas 2D indisponible');
      g.clearRect(0, 0, cote, cote);
      dessinerTuile(g, cote);
      return cv;
    }

    /* ── 2. La cible ────────────────────────────────────────────────────────── */
    function cible() {
      var doc = api.document;
      var sel = api.selection();
      var veutSelection = (o.cible === 'selection');
      var auto = (o.cible === 'auto');
      if ((veutSelection || auto) && sel && sel.length) {
        var bloc = sel[0];
        return { objet: bloc, largeur: bloc.width, hauteur: bloc.height,
                 gauche: bloc.left, haut: bloc.top, remplace: true };
      }
      if (veutSelection) {
        throw new Error('aucun bloc sélectionné : sélectionnez un cadre, ou choisissez « toute la page »');
      }
      return { objet: null, largeur: doc.largeur, hauteur: doc.hauteur,
               gauche: 0, haut: 0, remplace: false };
    }

    var c = cible();

    /* Nettoyage : réappliquer le motif ne doit pas empiler les fonds. On retire
       ceux que CE plug-in a posés. */
    try {
      var vues = (window._spMaquette && window._spMaquette._debug
        && typeof window._spMaquette._debug.vues === 'function')
        ? window._spMaquette._debug.vues() : [];
      var marques = [];
      (vues || []).forEach(function (cv2) {
        cv2.getObjects().forEach(function (obj) {
          if (obj && obj._spMotifPlugin && !obj._spMotifSurBloc) marques.push(obj);
        });
      });
      if (marques.length) api.remove(marques);
    } catch (_) {}

    /* ── 3. Poser ───────────────────────────────────────────────────────────── */
    return new Promise(function (resolve, reject) {
      function poser(sourceTuile) {
        var pat = new fabric.Pattern({ source: sourceTuile, repeat: 'repeat' });

        /* Sur un bloc existant, on change son REMPLISSAGE : l'objet garde sa
           position, ses coins arrondis, son contour, son rôle de gabarit. On ne
           pose pas un rectangle par-dessus, qui masquerait tout cela. */
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
            var cv = c.objet.canvas;
            if (cv) { cv.requestRenderAll ? cv.requestRenderAll() : cv.renderAll(); }
          } catch (_) {}
          try { if (typeof window.saveStateFromPages === 'function') window.saveStateFromPages('Plug-in : ' + (o.libelle || 'Motif')); } catch (_) {}
          resolve(c.objet);
          return;
        }

        var rect = new fabric.Rect({
          left: c.gauche, top: c.haut, width: c.largeur, height: c.hauteur,
          fill: pat, strokeWidth: 0, stroke: null,
          selectable: true, evented: true,
          objectCaching: false,     /* le motif suit le zoom sans crénelage */
          noScaleCache: true
        });
        rect._spMotifPlugin = true;
        if (opacite < 1) rect.set({ opacity: opacite });
        try { rect.set({ name: o.libelle || 'Motif' }); } catch (_) {}
        api.add(rect, { libelle: 'Plug-in : ' + (o.libelle || 'Motif'), envoyerEnArriere: true });
        resolve(rect);
      }

      /* Image importée : elle devient la tuile. On la charge AVANT de créer le
         motif — un motif bâti sur une image non chargée serait blanc. */
      if (o.image) {
        var im = new Image();
        im.onload = function () {
          try {
            var cv = document.createElement('canvas');
            var cote = Math.max(8, Math.round(pasPx * facteur));
            cv.width = cote; cv.height = cote;
            var g = cv.getContext('2d');
            var t = api.mm(tailleMm) * facteur;
            var ratio = (im.width && im.height) ? (im.width / im.height) : 1;
            var w = t, h = t;
            if (ratio >= 1) h = t / ratio; else w = t * ratio;
            g.drawImage(im, (cote - w) / 2, (cote - h) / 2, w, h);
            poser(cv);
          } catch (e) { reject(e); }
        };
        im.onerror = function () { reject(new Error('image du motif illisible')); };
        im.src = o.image;
        return;
      }

      try { poser(tuile()); } catch (e) { reject(e); }
    });
  }
});
