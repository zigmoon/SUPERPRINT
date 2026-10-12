/* ════════════════════════════════════════════════════════════════════════════
   superprint-papiers.js — LES PAPIERS : catalogue, dépôt, matière.

   CE QUE CE MODULE AJOUTE À SUPERPRINT
     · un bouton « Papiers » dans la colonne de gauche (icône étoiles : les
       ASPÉRITÉS du papier), avec la liste des papiers ;
     · le DÉPÔT d'un papier sur une page par glisser-déposer, ou par simple clic
       sur une entrée du menu quand une page est active ;
     · l'HABILLAGE de la page : teinte + grain, dessinés DERRIÈRE le contenu ;
     · la lecture de tout cela par l'aperçu 3D (`sp-3d-preview.js`), qui applique
       la vraie matière — mat ou brillant, opaque ou calque.

   RÈGLE SUIVIE : AJOUTER, JAMAIS MODIFIER.
   Ce fichier ne touche à RIEN de l'application. Il n'y a AUCUNE ligne ajoutée
   dans `main.js` : le module lit l'état de l'app par ses API publiques déjà
   exposées (`spEnCanvases`, `spCanvasDepuisElement`, `getActiveCanvas`) et agit
   par des éléments DOM qu'il crée lui-même. `desinstaller()` défait tout.

   POINTS D'ACCROCHE — relevés dans le code, pas supposés
     · colonne de gauche : le motif
       `<div class="tool-dropdown"><button class="btn btn-tool" id="…Toggle">`
       suivi de `<div class="tool-dropdown-menu">`, reproduit ici et inséré
       APRÈS `#importDropdown` (le groupe Import, icône image) — c'est là que la
       demande situe l'icône ;
     · page visée pendant un dépôt : le type de glisser-déposer est notre propre
       type `application/x-sp-papier`, et la cible se trouve comme le fait déjà
       l'app pour ses motifs : élément sous le pointeur → `spCanvasDepuisElement`
       (`main.js`, identifié par le commentaire `_SP_CANVAS_574`) ;
     · index de la page : position de la planche dans `spEnCanvases()`. C'EST LE
       MÊME TABLEAU que celui utilisé par l'aperçu 3D (`getAppCanvases()`), donc
       les deux parlent des mêmes index — sans cette précaution, le papier
       déposé sur la page 3 s'afficherait sur la page 2 en 3D ;
     · DOM d'une page : `document.querySelectorAll('.page-wrapper')`, dans
       l'ordre des pages (même convention que `applySoftProof`, `main.js`).

   CE QUE CE MODULE NE FAIT PAS, dit franchement : le papier n'est PAS exporté
   dans le PDF. C'est une SIMULATION et un MARQUAGE, comme la simulation papier
   déjà présente dans l'app (`soft-proof-paper-*`, `main.js:23406`), et non un
   changement du document. Le PDF s'imprime sur du vrai papier : il n'a pas à en
   contenir la texture.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    if (window.__spPapiersInstalle) return;
    window.__spPapiersInstalle = true;

    var VERSION = 'v1-papiers';

    /* ─────────────────────────────────────────────────────────── Catalogue ──
       `grain`      : quantité d'ASPÉRITÉS, de 0 (lisse) à 1 (très marqué).
       `matiere`    : 'mat' ou 'brillant' — la demande de l'utilisateur.
       `transparent`: 0 = opaque, 1 = invisible. Au-delà de 0 le papier fait
                      CALQUE : c'est un feuillet translucide posé sur la page.
       `calque`     : true si le dépôt par défaut est un feuillet par-dessus le
                      contenu, false s'il s'agit du SUPPORT de la page.
       `grammage`   : g/m², donné à titre indicatif (et lisible par le prépresse).
    */
    var PAPIERS = [
        { id: 'blanc',    nom: 'Blanc couché',    teinte: '#ffffff', grain: 0.05, matiere: 'mat',      transparent: 0,    calque: false, grammage: 115 },
        { id: 'ivoire',   nom: 'Ivoire',          teinte: '#f7f2e6', grain: 0.11, matiere: 'mat',      transparent: 0,    calque: false, grammage: 120 },
        /* ⚠️ JUMEAU EXACT D'« Ivoire », À LA MATIÈRE PRÈS. Sans lui, « le brillant
           se voit-il ? » serait impossible à mesurer : deux papiers brillants du
           commerce n'ont ni la même teinte ni le même grain que leurs équivalents
           mats, et toute différence constatée serait attribuable à la teinte
           autant qu'à la matière. Ici TEINTE ET GRAIN SONT IDENTIQUES : la seule
           variable est `matiere`, et l'écart mesuré ne peut venir que d'elle. */
        { id: 'ivoire-satin', nom: 'Ivoire satiné', teinte: '#f7f2e6', grain: 0.11, matiere: 'brillant', transparent: 0, calque: false, grammage: 170 },
        { id: 'creme',    nom: 'Crème',           teinte: '#f3e9d6', grain: 0.14, matiere: 'mat',      transparent: 0,    calque: false, grammage: 130 },
        { id: 'recycle',  nom: 'Recyclé',         teinte: '#eae5da', grain: 0.42, matiere: 'mat',      transparent: 0,    calque: false, grammage: 140 },
        { id: 'journal',  nom: 'Journal',         teinte: '#efeae0', grain: 0.34, matiere: 'mat',      transparent: 0,    calque: false, grammage: 48  },
        { id: 'kraft',    nom: 'Kraft',           teinte: '#dcc6a2', grain: 0.38, matiere: 'mat',      transparent: 0,    calque: false, grammage: 200 },
        { id: 'glace',    nom: 'Glacé brillant',  teinte: '#ffffff', grain: 0.04, matiere: 'brillant', transparent: 0,    calque: false, grammage: 135 },
        { id: 'satin',    nom: 'Satiné',          teinte: '#fdfcf9', grain: 0.07, matiere: 'brillant', transparent: 0,    calque: false, grammage: 170 },
        { id: 'calque',   nom: 'Calque',          teinte: '#fbfbf7', grain: 0.06, matiere: 'mat',      transparent: 0.62, calque: true,  grammage: 90  },
        { id: 'tracing',  nom: 'Calque brillant', teinte: '#fcfcf8', grain: 0.05, matiere: 'brillant', transparent: 0.55, calque: true,  grammage: 95  },
        { id: 'velin',    nom: 'Vélin transparent', teinte: '#faf9f4', grain: 0.09, matiere: 'mat',    transparent: 0.45, calque: true,  grammage: 110 },
        { id: 'aucun',    nom: 'Aucun (défaut)',  teinte: null,      grain: 0,    matiere: 'mat',      transparent: 0,    calque: false, grammage: 0   },
    ];

    function papierParId(id) {
        for (var i = 0; i < PAPIERS.length; i++) if (PAPIERS[i].id === id) return PAPIERS[i];
        return null;
    }

    /* ──────────────────────────────────────────── Texture : les aspérités ──
       UN SEUL générateur, partagé par l'éditeur et par l'aperçu 3D. Deux
       générateurs différents donneraient deux papiers différents pour le même
       choix — et l'aperçu cesserait d'être une prévision.

       Le grain est un BRUIT DÉTERMINISTE : `aleatoire` est une suite
       pseudo-aléatoire à graine fixe, donc deux appels rendent exactement le même
       papier. Sans cela, l'aperçu 3D et l'éditeur tireraient deux grains
       différents à chaque rendu, et l'écran scintillerait.
    */
    function graineDe(hash) {
        var h = hash >>> 0;
        return function () {
            h ^= h << 13; h >>>= 0;
            h ^= h >> 17;
            h ^= h << 5;  h >>>= 0;
            return h / 4294967296;
        };
    }

    function hashDe(texte) {
        var h = 2166136261;
        for (var i = 0; i < texte.length; i++) { h ^= texte.charCodeAt(i); h = (h * 16777619) >>> 0; }
        return h >>> 0;
    }

    /** Les composantes RGB d'une couleur #rrggbb. */
    function rgbDe(hex) {
        var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '#ffffff'));
        if (!m) return { r: 255, g: 255, b: 255 };
        var n = parseInt(m[1], 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }

    /**
     * Dessine les ASPÉRITÉS du papier dans un canevas carré, en niveaux de gris
     * avec transparence : le blanc éclaircit, le noir assombrit.
     *
     * @param {object} papier  une entrée du catalogue
     * @param {number} taille  côté du canevas en pixels
     * @returns {HTMLCanvasElement}
     */
    function dessinerGrain(papier, taille) {
        var s = Math.max(16, Math.round(taille || 256));
        var cv = document.createElement('canvas');
        cv.width = s; cv.height = s;
        var ctx = cv.getContext('2d');
        if (!papier || !papier.grain) return cv;   // papier lisse : canevas vide

        var rnd = graineDe(hashDe('sp-papier-' + papier.id));
        var img = ctx.createImageData(s, s);
        var d = img.data;
        var force = papier.grain;
        /* Le grain est fin à fort grossissement et DOIT rester fin à l'écran :
           on échantillonne donc un bruit lissé, pas du bruit blanc pixel à pixel
           (qui donnerait un aspect « neige »). On calcule un bruit par bloc de
           `pas` pixels, puis on module chaque pixel dans son bloc. */
        var pas = 3;
        var blocs = Math.ceil(s / pas) + 1;
        var bruit = new Float32Array(blocs * blocs);
        for (var i = 0; i < bruit.length; i++) bruit[i] = rnd();

        for (var y = 0; y < s; y++) {
            for (var x = 0; x < s; x++) {
                var bx = (x / pas) | 0, by = (y / pas) | 0;
                // Interpolation bilinéaire entre les coins du bloc : grain continu.
                var fx = (x % pas) / pas, fy = (y % pas) / pas;
                var v00 = bruit[by * blocs + bx];
                var v10 = bruit[by * blocs + Math.min(bx + 1, blocs - 1)];
                var v01 = bruit[Math.min(by + 1, blocs - 1) * blocs + bx];
                var v11 = bruit[Math.min(by + 1, blocs - 1) * blocs + Math.min(bx + 1, blocs - 1)];
                var v = (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
                // En plus du lissé, une pointe de bruit fin : ce sont les fibres.
                v = v * 0.82 + rnd() * 0.18;
                var a = (v - 0.5) * 2 * force * 255;
                var k = (y * s + x) * 4;
                if (a >= 0) { d[k] = 255; d[k + 1] = 255; d[k + 2] = 255; d[k + 3] = Math.min(255, a * 0.55); }
                else { d[k] = 0; d[k + 1] = 0; d[k + 2] = 0; d[k + 3] = Math.min(255, -a * 0.85); }
            }
        }
        ctx.putImageData(img, 0, 0);
        return cv;
    }

    /** Cache des textures : un papier × une taille, calculé une seule fois. */
    var cacheGrain = {};
    function canevasGrain(papier, taille) {
        if (!papier) return null;
        var cle = papier.id + '@' + taille;
        if (!cacheGrain[cle]) cacheGrain[cle] = dessinerGrain(papier, taille);
        return cacheGrain[cle];
    }

    /** Le grain sous forme de data-URL, pour un `background-image` CSS. */
    var cacheUrl = {};
    function urlGrain(papier, taille) {
        if (!papier || !papier.grain) return null;
        var t = taille || 128;
        var cle = papier.id + '@' + t;
        if (!cacheUrl[cle]) cacheUrl[cle] = canevasGrain(papier, t).toDataURL('image/png');
        return cacheUrl[cle];
    }

    /* ───────────────────────────────────────────────────── État par page ──
       Un papier par page, indexé comme `spEnCanvases()` / `.page-wrapper`.
       `null` = aucun papier particulier (le papier par défaut de l'app).
    */
    var papiersParPage = {};

    function nombreDePages() {
        var n = document.querySelectorAll('.page-wrapper').length;
        if (n) return n;
        try { if (typeof window.spEnCanvases === 'function') return window.spEnCanvases().length; } catch (_) {}
        return 0;
    }

    function papierDePage(i) {
        var id = papiersParPage[i];
        return id ? papierParId(id) : null;
    }

    /* ────────────────────────────────────────── Habillage de l'éditeur ──
       Un calque DOM DERRIÈRE le contenu de la page : teinte + grain. Il ne
       capture aucun clic (`pointer-events:none`) et ne participe à aucun calcul
       de l'app : il est purement visuel, et `retirerHabillage()` l'enlève.
    */
    var CLASSE_HABILLAGE = 'sp-papier-habillage';

    function habillerPage(i) {
        var wrappers = document.querySelectorAll('.page-wrapper');
        var w = wrappers[i];
        if (!w) return false;
        var p = papierDePage(i);
        var ancien = w.querySelector(':scope > .' + CLASSE_HABILLAGE);
        if (ancien && ancien.parentNode) ancien.parentNode.removeChild(ancien);
        if (!p || p.id === 'aucun' || !p.teinte) return false;

        var div = document.createElement('div');
        div.className = CLASSE_HABILLAGE;
        div.setAttribute('data-papier', p.id);
        var url = urlGrain(p, 128);
        div.style.cssText = [
            'position:absolute', 'inset:0', 'pointer-events:none',
            // Derrière le contenu : le papier est le SUPPORT, pas un voile.
            'z-index:0',
            'background-color:' + p.teinte,
            url ? ('background-image:url(' + url + ')') : 'background-image:none',
            'background-repeat:repeat',
            // Un calque translucide laisse voir la page au travers.
            'opacity:' + (p.transparent ? (1 - p.transparent) : 1),
        ].join(';') + ';';
        w.insertBefore(div, w.firstChild);
        // Le conteneur de la page doit être un repère de positionnement pour que
        // « inset:0 » vise bien la PAGE et non la fenêtre. On ne force `relative`
        // que si le style calculé est `static` — on ne modifie donc rien si l'app
        // a déjà posé un repère.
        try {
            if (getComputedStyle(w).position === 'static') w.style.position = 'relative';
        } catch (_) {}
        return true;
    }

    function retirerHabillage() {
        var l = document.querySelectorAll('.' + CLASSE_HABILLAGE);
        for (var i = 0; i < l.length; i++) if (l[i].parentNode) l[i].parentNode.removeChild(l[i]);
    }

    function reHabillerTout() {
        var n = nombreDePages();
        var fait = false;
        for (var i = 0; i < n; i++) fait = habillerPage(i) || fait;
        return fait;
    }

    /* ─────────────────────────────────────── Dépôt : sur la page visée ── */

    /** L'index de la page sous un élément du DOM, ou -1. */
    function indexDeLaPageSous(el) {
        if (!el) return -1;
        // 1) Par la planche (le chemin de l'app pour ses motifs).
        try {
            var c = (typeof window.spCanvasDepuisElement === 'function') ? window.spCanvasDepuisElement(el) : null;
            if (c) {
                var a = planches();
                var k = a.indexOf(c);
                if (k >= 0) return k;
            }
        } catch (_) {}
        // 2) Par le DOM de la page, en dernier recours.
        try {
            var w = el.closest ? el.closest('.page-wrapper') : null;
            if (w) {
                var tous = document.querySelectorAll('.page-wrapper');
                for (var i = 0; i < tous.length; i++) if (tous[i] === w) return i;
            }
        } catch (_) {}
        return -1;
    }

    /** Les planches, dans l'ordre des pages — le MÊME tableau que l'aperçu 3D. */
    function planches() {
        try {
            if (typeof window.spEnCanvases === 'function') {
                var a = window.spEnCanvases();
                if (a && a.length) return Array.prototype.slice.call(a);
            }
        } catch (_) {}
        try {
            if (typeof window._spCanvasCandidats === 'function') {
                var b = window._spCanvasCandidats();
                if (b && b.length) return Array.prototype.slice.call(b);
            }
        } catch (_) {}
        return [];
    }

    /** L'index de la page ACTIVE (celle qui a la sélection), ou 0. */
    function pageActive() {
        try {
            var c = (typeof window.getActiveCanvas === 'function') ? window.getActiveCanvas() : null;
            if (c) { var k = planches().indexOf(c); if (k >= 0) return k; }
        } catch (_) {}
        return 0;
    }

    /**
     * Dépose un papier sur une page.
     * @param {string} id        identifiant du papier
     * @param {number} page      index de la page
     * @param {object} [options] { calque: bool } — feuillet posé OU support
     */
    function deposer(id, page, options) {
        var p = papierParId(id);
        if (!p) return false;
        var i = (typeof page === 'number' && page >= 0) ? page : pageActive();
        var o = options || {};

        if (p.id === 'aucun') { retirer(i); return true; }

        papiersParPage[i] = p.id;
        /* `calque` demandé explicitement, ou celui du catalogue, ou le support :
           l'information FINIT dans le catalogue lu par l'aperçu 3D, qui dessine un
           feuillet translucide dans un cas et la matière de la page dans l'autre. */
        papiersParPage['calque:' + i] = (o.calque != null) ? !!o.calque : !!p.calque;

        habillerPage(i);
        prevenirLApercu(i);
        return true;
    }

    /** Enlève le papier d'une page. */
    function retirer(i) {
        if (i == null) i = pageActive();
        delete papiersParPage[i];
        delete papiersParPage['calque:' + i];
        habillerPage(i);
        prevenirLApercu(i);
        return true;
    }

    /** Prévient l'aperçu 3D s'il est ouvert : il recapture pour se mettre à jour. */
    function prevenirLApercu(i) {
        try {
            var p = window.SP3DPreview;
            if (p && typeof p.isOpen === 'function' && p.isOpen()) {
                if (typeof p.majPapiers === 'function') p.majPapiers();
                else if (typeof p.recapture === 'function') p.recapture();
            }
        } catch (_) {}
    }

    /** Le papier d'une page, tel que l'aperçu 3D doit le comprendre. */
    function descriptionPourLApercu(i) {
        var p = papierDePage(i);
        if (!p || p.id === 'aucun') return null;
        return {
            id: p.id,
            nom: p.nom,
            teinte: p.teinte,
            grain: p.grain,
            matiere: p.matiere,
            transparent: p.transparent || 0,
            calque: !!papiersParPage['calque:' + i],
            grammage: p.grammage || 0,
            // Le grain est fourni DÉJÀ DESSINÉ, et par le même générateur que
            // l'éditeur : les deux montrent donc exactement le même papier.
            grainUrl: urlGrain(p, 256),
        };
    }

    /* ────────────────────────────────────────── Interface : la colonne ── */

    var racine = null, menu = null, bouton = null, notices = null;

    function iconeEtoiles() {
        /* L'icône demandée : des ÉTOILES, pour les aspérités du papier. */
        return '<svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M12 3l1.9 4.1L18 9l-4.1 1.9L12 15l-1.9-4.1L6 9l4.1-1.9z"/>' +
            '<path d="M18.5 14.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z"/>' +
            '<path d="M5.5 15l.6 1.3 1.4.7-1.4.7L5.5 19l-.6-1.3L3.5 17l1.4-.7z"/>' +
            '</svg>';
    }

    function construireInterface() {
        if (racine && racine.parentNode) return true;
        var importDropdown = document.getElementById('importDropdown');
        if (!importDropdown || !importDropdown.parentNode) return false;

        racine = document.createElement('div');
        racine.className = 'tool-dropdown';
        racine.id = 'spPapierDropdown';
        racine.innerHTML =
            '<button class="btn btn-tool" id="spPapierToggle" aria-label="Papiers" ' +
            'title="Papiers — aspérités, matière, calque (glisser une pastille sur une page)">' +
            iconeEtoiles() + '<span class="dropdown-indicator">▾</span></button>' +
            '<div class="tool-dropdown-menu" id="spPapierMenu"></div>';
        importDropdown.parentNode.insertBefore(racine, importDropdown.nextSibling);

        menu = racine.querySelector('#spPapierMenu');
        bouton = racine.querySelector('#spPapierToggle');

        var titre = document.createElement('div');
        titre.className = 'dropdown-item';
        titre.style.cssText = 'pointer-events:none;opacity:.6;font-size:11px;cursor:default;';
        titre.textContent = 'Glisser sur une page';
        menu.appendChild(titre);

        PAPIERS.forEach(function (p) {
            var b = document.createElement('button');
            b.className = 'dropdown-item sp-papier-item';
            b.setAttribute('draggable', 'true');
            b.setAttribute('data-papier', p.id);
            b.title = p.nom + (p.grammage ? ' — ' + p.grammage + ' g/m²' : '') +
                ' — ' + p.matiere + (p.transparent ? ' — calque ' + Math.round((1 - p.transparent) * 100) + ' % opaque' : '');
            var pastille = document.createElement('span');
            pastille.className = 'tool-icon';
            pastille.style.cssText = 'display:inline-block;width:16px;height:16px;border-radius:3px;' +
                'border:1px solid rgba(128,128,128,.45);flex:0 0 auto;' +
                'background-color:' + (p.teinte || 'transparent') + ';' +
                (urlGrain(p, 64) ? 'background-image:url(' + urlGrain(p, 64) + ');' : '') +
                'background-size:32px 32px;';
            var nom = document.createElement('span');
            nom.textContent = p.nom + (p.matiere === 'brillant' ? ' ✦' : '') +
                (p.transparent ? ' (calque)' : '');
            b.appendChild(pastille);
            b.appendChild(nom);

            // ── Glisser : notre propre type MIME, pour ne pas confondre avec les
            //    autres glissers de l'app (`trappe-pattern`, fichiers, images).
            b.addEventListener('dragstart', function (e) {
                var donnees = JSON.stringify({ id: p.id, calque: !!p.calque });
                try { e.dataTransfer.setData('application/x-sp-papier', donnees); } catch (_) {}
                // Un type « texte » de repli : certains navigateurs n'exposent pas
                // les types personnalisés hors de `drop`, mais `types` reste lisible.
                try { e.dataTransfer.setData('text/plain', 'sp-papier:' + p.id); } catch (_) {}
                e.dataTransfer.effectAllowed = 'copy';
                document.body.classList.add('sp-papier-glisse');
            });
            b.addEventListener('dragend', function () {
                document.body.classList.remove('sp-papier-glisse');
            });

            // ── Clic : dépôt sur la page active (le geste de secours, sans glisser).
            b.addEventListener('click', function (e) {
                e.preventDefault();
                var i = pageActive();
                deposer(p.id, i);
                annoncer(p.id === 'aucun' ? 'Papier retiré de la page ' + (i + 1)
                    : p.nom + ' → page ' + (i + 1));
                fermerMenu();
            });

            menu.appendChild(b);
        });

        // Ouverture / fermeture du menu.
        bouton.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            var ouvert = menu.classList.contains('is-open') || menu.style.display === 'block';
            fermerMenu();
            if (!ouvert) ouvrirMenu();
        });
        document.addEventListener('click', function (e) {
            if (racine && !racine.contains(e.target)) fermerMenu();
        }, true);

        return true;
    }

    function ouvrirMenu() {
        if (!menu) return;
        menu.classList.add('is-open');
        menu.style.display = 'block';
        if (bouton) bouton.classList.add('active');
    }

    function fermerMenu() {
        if (!menu) return;
        menu.classList.remove('is-open');
        menu.style.display = '';
        if (bouton) bouton.classList.remove('active');
    }

    /* Une petite annonce à l'écran, sans dépendre de l'app : si elle expose un
       « toast », on l'utilise ; sinon on se tait plutôt que d'imposer le nôtre. */
    function annoncer(texte) {
        try {
            if (typeof window.spShowToast === 'function') { window.spShowToast(texte); return; }
        } catch (_) {}
        console.log('[Papiers]', texte);
    }

    /* ─────────────────────────────────────────── Réception du dépôt ──
       Le dépôt est écouté au niveau du DOCUMENT, en phase de CAPTURE : c'est ce
       que fait déjà l'app pour ses propres glissers (« document-level fallbacks
       at main.js:80247/80254 that run in capture »), afin qu'aucun gestionnaire
       intermédiaire ne puisse l'avaler avant nous. On ne bloque jamais
       l'événement : on ne fait que LIRE notre type et proposer le dépôt.
    */
    function donneesPapier(e) {
        if (!e || !e.dataTransfer) return null;
        try {
            var brut = e.dataTransfer.getData('application/x-sp-papier');
            if (brut) return JSON.parse(brut);
        } catch (_) {}
        try {
            var t = e.dataTransfer.getData('text/plain') || '';
            if (t.indexOf('sp-papier:') === 0) return { id: t.slice(10), calque: null };
        } catch (_) {}
        return null;
    }

    function estNotreDepot(e) {
        if (!e || !e.dataTransfer || !e.dataTransfer.types) return false;
        var types = Array.prototype.slice.call(e.dataTransfer.types);
        return types.indexOf('application/x-sp-papier') >= 0 ||
            types.some(function (t) { return String(t).indexOf('sp-papier') === 0; });
    }

    function installerLEcouteurDeDepot() {
        var dernier = null;

        document.addEventListener('dragover', function (e) {
            if (!estNotreDepot(e)) return;
            e.preventDefault();                 // autorise le dépôt
            try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
            var i = indexDeLaPageSous(e.target);
            if (i !== dernier) {
                dernier = i;
                document.querySelectorAll('.sp-papier-cible').forEach(function (w) { w.classList.remove('sp-papier-cible'); });
                if (i >= 0) {
                    var w = document.querySelectorAll('.page-wrapper')[i];
                    if (w) w.classList.add('sp-papier-cible');
                }
            }
        }, true);

        document.addEventListener('dragleave', function (e) {
            if (!estNotreDepot(e)) return;
            if (e.relatedTarget) return;
            dernier = null;
            document.querySelectorAll('.sp-papier-cible').forEach(function (w) { w.classList.remove('sp-papier-cible'); });
        }, true);

        document.addEventListener('drop', function (e) {
            if (!estNotreDepot(e)) return;
            var d = donneesPapier(e);
            var i = indexDeLaPageSous(e.target);
            document.querySelectorAll('.sp-papier-cible').forEach(function (w) { w.classList.remove('sp-papier-cible'); });
            document.body.classList.remove('sp-papier-glisse');
            if (!d) return;
            if (i < 0) {
                annoncer('Papier : déposez-le sur une page.');
                return;
            }
            /* On EMPÊCHE le geste d'aller plus loin : sans cela, notre dépôt
               pourrait être relu comme un dépôt de fichier par un autre
               gestionnaire de l'app. On ne bloque QUE notre propre type. */
            e.preventDefault();
            e.stopPropagation();
            deposer(d.id, i, { calque: d.calque });
            var p = papierParId(d.id);
            annoncer(p && p.id === 'aucun' ? 'Papier retiré de la page ' + (i + 1)
                : (p ? p.nom : d.id) + ' → page ' + (i + 1));
        }, true);
    }

    function installerLeStyle() {
        if (document.getElementById('sp-papier-style')) return;
        var st = document.createElement('style');
        st.id = 'sp-papier-style';
        st.textContent = [
            '.sp-papier-cible{outline:2px dashed rgba(13,148,136,.85);outline-offset:3px;}',
            '.sp-papier-glisse{padding:0 !important;}',
            '#spPapierMenu .sp-papier-item{display:flex;align-items:center;gap:8px;}',
            '#spPapierMenu .sp-papier-item span:last-child{white-space:nowrap;}',
        ].join('\n');
        document.head.appendChild(st);
    }

    /* ──────────────────────────────────────────────── Cycle de vie ── */

    function installer() {
        try {
            installerLeStyle();
            installerLEcouteurDeDepot();
            var ok = construireInterface();
            // L'app peut ne pas encore avoir posé sa colonne : on réessaie.
            if (!ok) setTimeout(function () { if (construireInterface()) reHabillerTout(); }, 800);
            reHabillerTout();
            return ok;
        } catch (e) {
            console.warn('[Papiers] installation :', e);
            return false;
        }
    }

    function desinstaller() {
        retirerHabillage();
        if (racine && racine.parentNode) racine.parentNode.removeChild(racine);
        racine = menu = bouton = null;
        var st = document.getElementById('sp-papier-style');
        if (st && st.parentNode) st.parentNode.removeChild(st);
    }

    /* ───────────────────────────────────────────── API publique ──
       C'est par ici, et par ici seulement, que l'aperçu 3D lit les papiers.
       Aucune variable interne n'est exposée : le module reste libre de changer.
    */
    window.spPapiers = {
        version: VERSION,
        catalogue: function () { return PAPIERS.map(function (p) { return { id: p.id, nom: p.nom, teinte: p.teinte, grain: p.grain, matiere: p.matiere, transparent: p.transparent, calque: p.calque, grammage: p.grammage }; }); },
        dePage: descriptionPourLApercu,
        nombreDePages: nombreDePages,
        deposer: deposer,
        retirer: retirer,
        installer: installer,
        desinstaller: desinstaller,
        // Pour les bancs de test : le grain sous forme de canevas, sans passer par le DOM.
        grain: function (id, taille) { var p = papierParId(id); return p ? canevasGrain(p, taille || 128) : null; },
        _etat: function () { return { papiersParPage: JSON.parse(JSON.stringify(papiersParPage)), pages: nombreDePages(), interface: !!racine }; },
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installer, { once: true });
    else installer();
})();
