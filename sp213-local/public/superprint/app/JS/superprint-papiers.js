/* ════════════════════════════════════════════════════════════════════════════
   superprint-papiers.js — LES PAPIERS : catalogue, dépôt, matière.

   CE QUE CE MODULE AJOUTE À SUPERPRINT
     · les ASPÉRITÉS de papier dans le SOUS-MENU DE L'ICÔNE IMAGE de la colonne de
       gauche, APRÈS « SVG » — c'est là que la demande les range ;
     · le DÉPÔT d'un papier sur une page par glisser-déposer, ou par simple clic
       sur une entrée du menu quand une page est active ;
     · l'HABILLAGE de la page : teinte + grain + une petite marque, posés SUR la
       page en MULTIPLICATION (`mix-blend-mode:multiply`) — un papier TEINTE ce
       qu'il y a dessous (blanc × teinte = teinte, noir × teinte = noir), il ne le
       recouvre pas ;
     · la lecture de tout cela par l'aperçu 3D (`sp-3d-preview.js`), qui applique
       la vraie matière — mat ou brillant, opaque ou calque.

   RÈGLE SUIVIE : AJOUTER, JAMAIS MODIFIER.
   Ce fichier ne touche à RIEN de l'application. Il n'y a AUCUNE ligne ajoutée
   dans `main.js` : le module lit l'état de l'app par ses API publiques déjà
   exposées (`spEnCanvases`, `spCanvasDepuisElement`, `getActiveCanvas`) et agit
   par des éléments DOM qu'il crée lui-même. `desinstaller()` défait tout.

   POINTS D'ACCROCHE — relevés dans le code, pas supposés
     · sous-menu Image : `#importMenu` (ouvert par `#importToggle`), dans lequel on
       INSÈRE nos entrées APRÈS `#importSVG`. On n'ajoute donc AUCUN bouton à la
       colonne : le menu et son ouverture restent ceux de l'app (`setupImportDropdown`,
       `main.js:23163`) — on se contente d'y ranger nos pastilles ;
     · surface de la page : `.canvas-inner` (fond blanc OPAQUE, `z-index:2`,
       `main.css:2091`) — et NON `.page-wrapper`, qui est plus haut de la bande du
       numéro de page (MESURÉ sur A4 : 612×885 pour le wrapper contre 612×859 pour
       la page). Un calque posé DERRIÈRE `.canvas-inner` ne se voyait pas : c'était
       la cause du « je dépose et rien ne change » ;
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

    var VERSION = 'v2-papiers-menu-image';

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
     * DEUX COUCHES, parce qu'une seule ne ressemble pas à du papier :
     *   1. un bruit LISSÉ (interpolation bilinéaire entre les coins de blocs),
     *      qui donne le grain ;
     *   2. des FIBRES — quelques dizaines de traits courts, plus clairs ou plus
     *      sombres — sans lesquelles un bruit lissé se lit comme une trame
     *      numérique, pas comme une matière.
     *
     * ⚠️ L'ÉCHELLE EST PROPORTIONNELLE AU CANEVAS (`pas = s / 64`) : le grain rendu
     * en 128 px (éditeur) et en 512 px (aperçu 3D) a donc exactement la MÊME finesse
     * relative. Sans cette précaution, les deux affichaient deux papiers différents
     * — et la « même matière » promise n'était plus la même.
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
        var pas = Math.max(2, Math.round(s / 64));
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
                // En plus du lissé, une pointe de bruit fin : ce sont les aspérités.
                v = v * 0.82 + rnd() * 0.18;
                /* ⚠️ LES DEUX COEFFICIENTS DÉCIDENT SI LE GRAIN SE VOIT, et ils ont
                   été relevés à l'usage : à 0,55 / 0,85, un papier très texturé
                   (recyclé, kraft) restait à peine perceptible dans l'aperçu 3D —
                   parce que l'aperçu multiplie encore ce calque par SA propre
                   opacité. Le grain est donc franc ICI, et c'est le dépôt qui dose
                   (`u.grain.material.opacity` dans sp-3d-preview.js). */
                var a = (v - 0.5) * 2 * force * 255;
                var k = (y * s + x) * 4;
                if (a >= 0) { d[k] = 255; d[k + 1] = 255; d[k + 2] = 255; d[k + 3] = Math.min(255, a * 0.62); }
                else { d[k] = 0; d[k + 1] = 0; d[k + 2] = 0; d[k + 3] = Math.min(255, -a * 0.95); }
            }
        }
        ctx.putImageData(img, 0, 0);

        /* ── LES FIBRES. Presque toutes dans le même sens (le sens de fabrication de
           la feuille), plus longues et plus douces que les aspérités du bruit. Elles
           sont plus larges quand le canevas l'est (`lineWidth`), pour que la même
           matière apparaisse à toutes les résolutions. */
        var fibres = Math.max(6, Math.round(s / 5));
        ctx.lineCap = 'round';
        for (var n = 0; n < fibres; n++) {
            var x0 = rnd() * s, y0 = rnd() * s;
            var ang = (rnd() - 0.5) * 0.7;
            var len = s * (0.03 + rnd() * 0.09);
            ctx.strokeStyle = (rnd() < 0.5)
                ? 'rgba(255,255,255,' + (force * 0.5).toFixed(3) + ')'
                : 'rgba(0,0,0,' + (force * 0.7).toFixed(3) + ')';
            ctx.lineWidth = Math.max(1, s / 256);
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
            ctx.stroke();
        }
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
       Des calques DOM posés SUR la page : teinte, grain, marque. Ils ne capturent
       aucun clic (`pointer-events:none`) et ne participent à aucun calcul de
       l'app ; `retirerHabillage()` les enlève tous.
    */
    var CLASSE_HABILLAGE = 'sp-papier-habillage';
    var CLASSE_GRAIN = 'sp-papier-grain';
    var CLASSE_MARQUE = 'sp-papier-marque';
    var SELECTEUR_NOS_CALQUES = '.' + CLASSE_HABILLAGE + ',.' + CLASSE_GRAIN + ',.' + CLASSE_MARQUE;

    /**
     * La SURFACE de la page : `.canvas-inner`.
     *
     * ⚠️ C'est `.canvas-inner` et NON `.page-wrapper`, et c'est la correction d'un
     * défaut mesuré. La page porte un fond BLANC OPAQUE (`main.css:2091`,
     * `z-index:2`) ; le premier jet posait le calque *derrière* elle — donc
     * invisible, quel que soit le papier : « je dépose une aspérité et rien ne
     * change sur la page ». Les deux rectangles ne sont d'ailleurs pas les mêmes
     * (MESURÉ sur A4 : wrapper 612×885, page 612×859 — le bas du wrapper est la
     * bande du numéro de page).
     */
    function supportDeLaPage(i) {
        var w = document.querySelectorAll('.page-wrapper')[i];
        if (!w) return null;
        return w.querySelector('.canvas-inner') || w;
    }

    /** Enlève NOS calques d'une page (habillage, grain, marque). */
    function nettoyerHabillage(i) {
        var support = supportDeLaPage(i);
        if (!support) return;
        var l = support.querySelectorAll(SELECTEUR_NOS_CALQUES);
        for (var k = 0; k < l.length; k++) if (l[k].parentNode) l[k].parentNode.removeChild(l[k]);
    }

    /**
     * Habille une page : teinte, grain, et la petite marque du papier.
     *
     * LA TEINTE EST EN MULTIPLICATION (`mix-blend-mode:multiply`), et c'est la
     * seule façon juste de la poser : un papier teinté MULTIPLIE l'image imprimée
     * (blanc × teinte = teinte, noir × teinte = noir). On obtient donc exactement
     * le résultat d'une impression sur ce papier — l'ivoire teinte les blancs, les
     * noirs restent noirs, une photo se réchauffe. Un calque simplement posé
     * par-dessus aurait, lui, LAVÉ tout le contenu.
     *
     * Le GRAIN suit le même chemin : le blanc de la texture ne change rien, le noir
     * assombrit. C'est ce qui donne des aspérités visibles.
     */
    function habillerPage(i) {
        nettoyerHabillage(i);
        var support = supportDeLaPage(i);
        if (!support) return false;
        var p = papierDePage(i);
        if (!p || p.id === 'aucun' || !p.teinte) return false;   // retiré : rien à poser

        /* Un papier « calque » est TRANSLUCIDE : on ne le rend pas opaque, on baisse
           son opacité. Sur la page — qui EST le support — cela se lit comme un voile
           plus léger ; c'est dans l'aperçu 3D que la feuille devient réellement
           transparente (on voit au travers). */
        var opacite = p.transparent ? (1 - p.transparent) : 1;

        var teinte = document.createElement('div');
        teinte.className = CLASSE_HABILLAGE;
        teinte.setAttribute('data-papier', p.id);
        teinte.style.cssText = [
            'position:absolute', 'inset:0', 'pointer-events:none',
            'z-index:4',                    // au-dessus des planches (canvas), sous la marque
            'mix-blend-mode:multiply',      // un papier teinte, il ne recouvre pas
            'background-color:' + p.teinte,
            'opacity:' + opacite,
        ].join(';') + ';';
        support.appendChild(teinte);

        var url = p.grain ? urlGrain(p, 128) : null;
        if (url) {
            var grain = document.createElement('div');
            grain.className = CLASSE_GRAIN;
            grain.setAttribute('data-papier', p.id);
            grain.style.cssText = [
                'position:absolute', 'inset:0', 'pointer-events:none',
                'z-index:5',
                'mix-blend-mode:multiply',
                'background-image:url(' + url + ')',
                'background-repeat:repeat',
                /* 256 px pour une tuile de 128 : les aspérités font ~4 px à l'écran.
                   C'est une EXAGÉRATION ASSUMÉE : à l'échelle réelle, les fibres d'un
                   papier sont plus fines qu'un pixel — un grain exact serait un grain
                   invisible, et la demande est qu'on le voie. */
                'background-size:256px 256px',
                'opacity:' + Math.min(0.8, p.grain * 1.15).toFixed(3),
            ].join(';') + ';';
            support.appendChild(grain);
        }

        /* La MARQUE. Sans elle, un papier blanc pur — ou « Blanc couché » — ne se
           distingue pas de « aucun papier », et l'utilisateur qui vient de déposer
           croit que le dépôt n'a pas marché. Elle n'est PAS dans la maquette : elle
           vit dans le DOM de l'éditeur, donc elle n'est ni capturée par l'aperçu 3D
           (qui lit le canvas) ni exportée dans le PDF. */
        var marque = document.createElement('div');
        marque.className = CLASSE_MARQUE + (p.transparent ? ' sp-papier-marque-calque' : '');
        marque.textContent = p.nom + (p.transparent ? ' · calque' : '');
        marque.title = 'Papier de la page : ' + p.nom + ' — ' + p.matiere +
            (p.grammage ? ' — ' + p.grammage + ' g/m²' : '') + ' (marquage, non exporté)';
        marque.style.cssText = [
            'position:absolute', 'top:5px', 'right:5px', 'z-index:6',
            'pointer-events:none', 'font-family:inherit', 'font-size:9px',
            'line-height:1', 'letter-spacing:.4px', 'padding:3px 6px',
            'border-radius:999px', 'color:#fff', 'background:rgba(13,148,136,.72)',
            'white-space:nowrap',
        ].join(';') + ';';
        support.appendChild(marque);
        return true;
    }

    function retirerHabillage() {
        var l = document.querySelectorAll(SELECTEUR_NOS_CALQUES);
        for (var i = 0; i < l.length; i++) if (l[i].parentNode) l[i].parentNode.removeChild(l[i]);
    }

    function reHabillerTout() {
        var n = nombreDePages();
        var fait = false;
        for (var i = 0; i < n; i++) fait = habillerPage(i) || fait;
        return fait;
    }

    /* ── GARDE-FOU : L'APP PEUT RECONSTRUIRE LE DOM D'UNE PAGE ──
       `reHabillerTout` est appelé à l'installation et après chaque dépôt, mais rien
       ne garantit que l'app ne remplace pas les enfants de `.canvas-inner`
       (changement de mode d'affichage, recadrage, rechargement). Sans garde-fou, un
       papier déposé DISPARAÎTRAIT alors de l'écran sans que rien ne le signale —
       exactement le symptôme « je dépose et ça ne tient pas sur la page ». On
       surveille donc la zone des pages, et on repose ce qui manque.

       ⚠️ AUCUN CYCLE POSSIBLE : nos propres insertions déclenchent l'observateur,
       mais la reprise ne fait rien quand le calque est déjà là. Le travail est
       mutualisé par un délai court, pour ne pas se relancer à chaque mutation. */
    var observateur = null, reposeEnAttente = null;

    function installerLeGardeFou() {
        if (observateur || typeof MutationObserver !== 'function') return false;
        var zone = document.getElementById('pagesContainer') || document.body;
        if (!zone) return false;
        observateur = new MutationObserver(function () {
            if (reposeEnAttente) return;
            reposeEnAttente = setTimeout(function () {
                reposeEnAttente = null;
                try { reposerCeQuiManque(); } catch (_) {}
            }, 180);
        });
        try { observateur.observe(zone, { childList: true, subtree: true }); } catch (_) { observateur = null; return false; }
        return true;
    }

    /** Repose les calques MANQUANTS. Ne touche à rien s'il n'en manque aucun. */
    function reposerCeQuiManque() {
        var n = nombreDePages();
        var repose = false;
        for (var i = 0; i < n; i++) {
            if (!papiersParPage[i]) continue;
            var support = supportDeLaPage(i);
            if (support && !support.querySelector('.' + CLASSE_HABILLAGE)) { habillerPage(i); repose = true; }
        }
        if (repose) prevenirLApercu(0);   // la matière a changé : l'aperçu 3D la relit
        return repose;
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

    /* ─────────────────────────── Interface : le sous-menu de l'icône Image ──
       AUCUN bouton n'est ajouté à la colonne : les papiers se rangent dans le
       sous-menu que l'app possède déjà (`#importMenu`, ouvert par `#importToggle`),
       APRÈS l'entrée « SVG ». On n'y met que nos entrées.
    */

    var racine = null, menu = null, ancrage = null;

    /** Le contenu d'une pastille de papier — la vignette qui porte sa matière. */
    function pastilleDe(p, tailleCss) {
        var pastille = document.createElement('span');
        pastille.className = 'tool-icon';
        var url = p.grain ? urlGrain(p, 64) : null;
        pastille.style.cssText = 'display:inline-block;width:16px;height:16px;border-radius:3px;' +
            'border:1px solid rgba(128,128,128,.45);flex:0 0 auto;' +
            'background-color:' + (p.teinte || 'transparent') + ';' +
            (url ? 'background-image:url(' + url + ');' : '') +
            'background-size:' + (tailleCss || 32) + 'px ' + (tailleCss || 32) + 'px;';
        return pastille;
    }

    function construireInterface() {
        if (racine && racine.parentNode) return true;
        menu = document.getElementById('importMenu');
        ancrage = document.getElementById('importSVG');   // on se range APRÈS « SVG »
        if (!menu || !ancrage || !ancrage.parentNode) return false;

        racine = document.createElement('div');
        racine.className = 'sp-papier-bloc';
        racine.id = 'spPapierBloc';

        var sep = document.createElement('div');
        sep.className = 'sp-papier-sep';
        racine.appendChild(sep);

        var titre = document.createElement('div');
        titre.className = 'sp-papier-titre';
        titre.textContent = 'Papiers — aspérités';
        racine.appendChild(titre);

        var aide = document.createElement('div');
        aide.className = 'sp-papier-aide';
        aide.textContent = 'Glisser sur une page';
        racine.appendChild(aide);

        PAPIERS.forEach(function (p) {
            var b = document.createElement('button');
            b.className = 'dropdown-item sp-papier-item';
            b.setAttribute('draggable', 'true');
            b.setAttribute('data-papier', p.id);
            b.title = 'Papier ' + p.nom + (p.grammage ? ' — ' + p.grammage + ' g/m²' : '') +
                ' — ' + p.matiere + (p.transparent ? ' — calque (translucide)' : '') +
                ' — glisser sur la page, ou cliquer pour la page active';
            var nom = document.createElement('span');
            nom.textContent = p.nom + (p.matiere === 'brillant' ? ' ✦' : '') +
                (p.transparent ? ' (calque)' : '');
            b.appendChild(pastilleDe(p, 32));
            b.appendChild(nom);

            // ── Glisser : notre propre type MIME, pour ne rien confondre avec les
            //    autres glissers de l'app (`trappe-pattern`, fichiers, images).
            b.addEventListener('dragstart', function (e) {
                glisse = { id: p.id };
                var pose = false;
                try { e.dataTransfer.setData('application/x-sp-papier', JSON.stringify({ id: p.id })); pose = true; } catch (_) {}
                /* ⚠️ PAS de repli `text/plain` en temps normal, et ce n'est pas un
                   détail : le gestionnaire GLOBAL de l'app (`main.js:80438`, capture
                   sur `document`) accepte `text/plain` comme un MOTIF déposé et fait
                   `JSON.parse` dessus. Notre charge « sp-papier:kraft » n'étant pas du
                   JSON, chaque dépôt de papier levait à la console :

                       Erreur lors du drop (global): SyntaxError: Unexpected token 's'

                   Le repli n'est donc posé que si le type personnalisé a échoué
                   (navigateur qui refuse un type inconnu). */
                if (!pose) { try { e.dataTransfer.setData('text/plain', 'sp-papier:' + p.id); } catch (_) {} }
                try { e.dataTransfer.effectAllowed = 'copy'; } catch (_) {}
                document.body.classList.add('sp-papier-glisse');
            });
            b.addEventListener('dragend', function () {
                glisse = null;
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

            racine.appendChild(b);
        });

        ancrage.parentNode.insertBefore(racine, ancrage.nextSibling);
        return true;
    }

    /** Referme le menu d'import — c'est celui de l'app (classe `open`). */
    function fermerMenu() {
        try { if (menu) menu.classList.remove('open'); } catch (_) {}
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

       ⚠️ `glisse` — l'état de NOTRE glisser en cours. Deux raisons, toutes deux
       mesurées :
         · pendant un `dragover`, la lecture des données est interdite (le
           navigateur rend une chaîne vide) : sans cet état, un repli par
           `text/plain` serait indétectable pendant le survol, donc le survol
           n'illuminerait jamais la page ;
         · au `drop`, c'est le filet de sécurité si le type personnalisé n'a pas
           traversé (`getData` vide alors que `types` l'annonçait).
    */
    var glisse = null;

    function donneesPapier(e) {
        if (!e || !e.dataTransfer) return null;
        try {
            var brut = e.dataTransfer.getData('application/x-sp-papier');
            if (brut) {
                var o = JSON.parse(brut);
                if (o && o.id) return o;
            }
        } catch (_) {}
        try {
            var t = e.dataTransfer.getData('text/plain') || '';
            if (t.indexOf('sp-papier:') === 0) return { id: t.slice(10) };
        } catch (_) {}
        if (glisse && glisse.id) return { id: glisse.id };
        return null;
    }

    function estNotreDepot(e) {
        if (!e || !e.dataTransfer) return false;
        if (glisse) return true;                  // c'est notre glisser, il est en cours
        var types = [];
        try { types = Array.prototype.slice.call(e.dataTransfer.types || []); } catch (_) { return false; }
        if (types.indexOf('application/x-sp-papier') >= 0) return true;
        return types.some(function (t) { return /^sp-papier/i.test(String(t)); });
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
            glisse = null;
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
            /* La page visée pendant un survol de dépôt. */
            '.sp-papier-cible{outline:2px dashed rgba(13,148,136,.85);outline-offset:3px;}',
            '.sp-papier-glisse{padding:0 !important;}',
            /* Nos entrées, dans le menu Image. */
            '.sp-papier-bloc{margin:1px 0 3px;}',
            '.sp-papier-sep{height:1px;background:rgba(128,128,128,.32);margin:6px 10px;}',
            '.sp-papier-titre{padding:0 12px;font-size:9px;line-height:1.5;letter-spacing:.7px;' +
                'opacity:.62;text-transform:uppercase;pointer-events:none;}',
            '.sp-papier-aide{padding:0 12px 4px;font-size:9px;opacity:.5;pointer-events:none;}',
            '.sp-papier-item{display:flex;align-items:center;gap:8px;}',
            '.sp-papier-item span:last-child{white-space:nowrap;}',
            '.sp-papier-item[draggable="true"]{cursor:grab;}',
            '.sp-papier-item[draggable="true"]:active{cursor:grabbing;}',
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
            installerLeGardeFou();
            return ok;
        } catch (e) {
            console.warn('[Papiers] installation :', e);
            return false;
        }
    }

    function desinstaller() {
        retirerHabillage();
        if (racine && racine.parentNode) racine.parentNode.removeChild(racine);
        racine = menu = ancrage = null;
        glisse = null;
        try { if (observateur) observateur.disconnect(); } catch (_) {}
        observateur = null;
        if (reposeEnAttente) { clearTimeout(reposeEnAttente); reposeEnAttente = null; }
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
        _etat: function () {
            return {
                papiersParPage: JSON.parse(JSON.stringify(papiersParPage)),
                pages: nombreDePages(),
                interface: !!racine,
                // Le nombre de calques RÉELLEMENT posés dans la page — c'est ce qui
                // dit si le dépôt se voit, et non s'il a été « enregistré ».
                calques: document.querySelectorAll(SELECTEUR_NOS_CALQUES).length,
                marques: document.querySelectorAll('.' + CLASSE_MARQUE).length,
            };
        },
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installer, { once: true });
    else installer();
})();
