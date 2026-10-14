/* ════════════════════════════════════════════════════════════════════════════
   superprint-papiers.js — LES PAPIERS : catalogue, dépôt, matière.

   CE QUE CE MODULE AJOUTE À SUPERPRINT
     · les ASPÉRITÉS de papier dans le SOUS-MENU DE L'ICÔNE IMAGE de la colonne de
       gauche, APRÈS « SVG » — c'est là, et NULLE PART AILLEURS, qu'elles se
       prennent. Le bloc du sous-menu ne contient plus qu'UNE ligne — « Papier » —
       qui ouvre la PALETTE (le widget) ; c'est la palette qui porte le catalogue
       entier, pastille et gestes compris. Un sous-menu n'est pas un catalogue :
       « Image » et « SVG » tiennent en une ligne, « Papier » aussi ;
     · le DÉPÔT d'un papier sur une page par glisser-déposer, ou par simple clic
       sur une entrée de la palette quand une page est active ;
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

    var VERSION = 'v10-sous-menu-image';
    /* ── LE NOM DE LA PALETTE, DANS LES TROIS LANGUES ──────────────────────
       « Aspérités papier » s'est révélé trop long pour une barre de titre, et
       moins clair que le mot simple : on appelle cette palette « Papier ».

       Pourquoi ces trois chaines existent AUSSI dans le dictionnaire de l'app
       (`papierTitle`, main.js) : les elements portent `data-translate`, donc
       l'app les retraduit a chaque changement de langue. Mais le module est
       charge `defer` et construit ses elements APRES le premier passage de la
       traduction : sans ce repli, le libelle resterait vide jusqu'au prochain
       changement de langue. Le repli pose donc le texte initial.
       ⚠️ Toute modification ici doit etre reportee dans `papierTitle`. */
    var NOM_PALETTE = { fr: 'Papier', en: 'Paper', ja: '紙' };

    /* ── LA LANGUE COURANTE, SELON LA MÊME RÈGLE QUE L'APPLICATION ────────────
       ⚠️ CE N'EST PAS UN DÉTAIL DE CONFORT, ET LA PREMIÈRE VERSION SE TROMPAIT.
       Elle lisait `sp_lang` en premier. Or depuis la v1.7.599 l'app impose au
       démarrage la langue du POSTE (`navigator.language`), SAUF si l'utilisateur
       a fait un choix explicite — marqué par la clé `sp_lang_choisi`. Sur un
       navigateur en anglais, l'app affichait donc « Paper » pendant que le repli
       croyait lire « Papier » : deux langues dans le même panneau.
       La règle est recopiée de `main.js` (bloc _SP_LANGUE_599), dans le même
       ordre : le paramètre d'adresse, puis le choix explicite, puis le poste.
       Repli final : l'anglais, comme l'application. */
    function langueCourante() {
        try {
            if (window.currentLanguage && NOM_PALETTE[window.currentLanguage]) return window.currentLanguage;
            var q = '';
            try {
                var requete = (typeof window.__spBootQuery === 'string') ? window.__spBootQuery : (window.location.search || '');
                q = String(new URLSearchParams(requete).get('lang') || '').toLowerCase();
            } catch (_) {}
            if (q === 'jp') q = 'ja';
            if (NOM_PALETTE[q]) return q;
            var choixExplicite = false;
            try { choixExplicite = (localStorage.getItem('sp_lang_choisi') === '1'); } catch (_) {}
            if (choixExplicite) {
                var enregistree = '';
                try { enregistree = String(localStorage.getItem('sp_lang') || '').toLowerCase(); } catch (_) {}
                if (NOM_PALETTE[enregistree]) return enregistree;
            }
            var poste = '';
            try { poste = String(navigator.language || (navigator.languages && navigator.languages[0]) || '').toLowerCase(); } catch (_) {}
            if (poste.indexOf('fr') === 0) return 'fr';
            if (poste.indexOf('ja') === 0) return 'ja';
            return 'en';
        } catch (_) { return 'en'; }
    }

    /** Le nom de la palette, dans la langue courante. */
    function nomPalette() { return NOM_PALETTE[langueCourante()]; }

    /* ─────────────────────────────────────────────────────────── Catalogue ──
       `grain`      : quantité d'ASPÉRITÉS, de 0 (lisse) à 1 (très marqué).
       `matiere`    : 'mat' ou 'brillant' — la demande de l'utilisateur.
       `transparent`: 0 = opaque, 1 = invisible. Au-delà de 0 le papier fait
                      CALQUE : c'est un feuillet translucide posé sur la page.
       `calque`     : true si le dépôt par défaut est un feuillet par-dessus le
                      contenu, false s'il s'agit du SUPPORT de la page.
       `grammage`   : g/m², donné à titre indicatif (et lisible par le prépresse).
       `style`      : LA MATIÈRE, et ce n'est pas `grain` qui la donne. `grain` dit
                      COMBIEN, `style` dit COMMENT — trois familles, relevées sur
                      les papiers réels :
                        · 'fin'      — bruit régulier, point de fibre visible. Pâtes
                                       couchées, satinées, vélin : surfaces fermées.
                        · 'fibreux'  — LONGUES fibres alignées dans le sens de
                                       fabrication, et un fond irrégulier par
                                       « nuages ». C'est le signe du KRAFT (pâte
                                       non blanchie : les fibres de bois restent
                                       visibles) et du JOURNAL.
                        · 'mouchete' — fibres courtes + MOUCHETURES sombres, ces
                                       petits points bruns qu'on voit dans le
                                       RECYCLÉ (impuretés de la pâte de récupération).
    */
    var PAPIERS = [
        /* ⚠️ « AUCUN » EN TÊTE, ET CE N'EST PAS QU'UNE QUESTION D'ORDRE.
           C'est le choix par défaut — la page sans papier — et l'entrée qu'on
           cherche le plus souvent, pour RETIRER un papier. Reléguée en dernière
           position, elle obligeait à parcourir les douze autres à chaque fois.
           L'ordre de ce tableau est celui des deux listes (aucune n'a de tri
           propre) : le corriger ici suffit pour le sous-menu Image. */
        { id: 'aucun',    nom: 'Aucun (défaut)',  teinte: null,      grain: 0,    matiere: 'mat',      transparent: 0,    calque: false, grammage: 0,   style: 'fin' },
        { id: 'blanc',    nom: 'Blanc couché',    teinte: '#ffffff', grain: 0.05, matiere: 'mat',      transparent: 0,    calque: false, grammage: 115, style: 'fin' },
        { id: 'ivoire',   nom: 'Ivoire',          teinte: '#f7f2e6', grain: 0.11, matiere: 'mat',      transparent: 0,    calque: false, grammage: 120, style: 'fin' },
        /* ⚠️ JUMEAU EXACT D'« Ivoire », À LA MATIÈRE PRÈS. Sans lui, « le brillant
           se voit-il ? » serait impossible à mesurer : deux papiers brillants du
           commerce n'ont ni la même teinte ni le même grain que leurs équivalents
           mats, et toute différence constatée serait attribuable à la teinte
           autant qu'à la matière. Ici TEINTE ET GRAIN SONT IDENTIQUES : la seule
           variable est `matiere`, et l'écart mesuré ne peut venir que d'elle. */
        { id: 'ivoire-satin', nom: 'Ivoire satiné', teinte: '#f7f2e6', grain: 0.11, matiere: 'brillant', transparent: 0, calque: false, grammage: 170, style: 'fin' },
        { id: 'creme',    nom: 'Crème',           teinte: '#f3e9d6', grain: 0.14, matiere: 'mat',      transparent: 0,    calque: false, grammage: 130, style: 'fin' },
        { id: 'recycle',  nom: 'Recyclé',         teinte: '#eae5da', grain: 0.42, matiere: 'mat',      transparent: 0,    calque: false, grammage: 140, style: 'mouchete' },
        { id: 'journal',  nom: 'Journal',         teinte: '#efeae0', grain: 0.34, matiere: 'mat',      transparent: 0,    calque: false, grammage: 48,  style: 'fibreux' },
        /* KRAFT — pâte NON BLANCHIE. Ce qui le fait reconnaître, dans l'ordre :
             1. une teinte chaude de bois, plus franche que celle des autres papiers ;
             2. de LONGUES fibres visibles, alignées (le sens de la machine) ;
             3. une teinte IRRÉGULIÈRE, par nuages — jamais un aplat ;
             4. quelques mouchetures sombres.
           Avant, le kraft ne portait qu'un bruit isotrope et court : à l'écran, il
           se lisait comme du GRIS BRUITÉ, pas comme du kraft. */
        { id: 'kraft',    nom: 'Kraft',           teinte: '#cbb08a', grain: 0.40, matiere: 'mat',      transparent: 0,    calque: false, grammage: 200, style: 'fibreux' },
        { id: 'glace',    nom: 'Glacé brillant',  teinte: '#ffffff', grain: 0.04, matiere: 'brillant', transparent: 0,    calque: false, grammage: 135, style: 'fin' },
        { id: 'satin',    nom: 'Satiné',          teinte: '#fdfcf9', grain: 0.07, matiere: 'brillant', transparent: 0,    calque: false, grammage: 170, style: 'fin' },
        { id: 'calque',   nom: 'Calque',          teinte: '#fbfbf7', grain: 0.06, matiere: 'mat',      transparent: 0.62, calque: true,  grammage: 90,  style: 'fin' },
        { id: 'tracing',  nom: 'Calque brillant', teinte: '#fcfcf8', grain: 0.05, matiere: 'brillant', transparent: 0.55, calque: true,  grammage: 95,  style: 'fin' },
        { id: 'velin',    nom: 'Vélin transparent', teinte: '#faf9f4', grain: 0.09, matiere: 'mat',    transparent: 0.45, calque: true,  grammage: 110, style: 'fin' },
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

    /** Borne une valeur entre deux autres. */
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

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
     * QUATRE COUCHES, et chacune vient d'un papier réel :
     *   1. un bruit LISSÉ (interpolation bilinéaire entre les coins de blocs) —
     *      le grain de la pâte ;
     *   2. des NUAGES, un bruit bien plus grossier, pour l'irrégularité de teinte.
     *      Un kraft n'est JAMAIS un aplat : sa couleur ondule. Sans cette couche,
     *      même très texturé, il se lit comme un gris bruité ;
     *   3. des FIBRES — traits courts pour les pâtes couchées, LONGS et alignés
     *      pour le kraft et le journal (les fibres de bois restent visibles) ;
     *   4. des MOUCHETURES — petits points sombres, pour le recyclé.
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
        var style = papier.style || 'fin';
        var pas = Math.max(2, Math.round(s / 64));
        /* ⚠️ LE NOMBRE DE BLOCS EST EXACTEMENT `s / pas`, ET LE BRUIT SE REFERME SUR
           LUI-MÊME (voir l'échantillonnage). C'est ce qui rend la tuile SANS COUTURE :
           elle est répétée 4 × 6 fois sur la page (voir `reglerRepetitionGrain`), et un
           bruit qui ne se referme pas y dessinerait une grille de lignes — un papier
           quadrillé, pas un papier texturé. */
        var blocs = Math.max(2, Math.round(s / pas));
        pas = s / blocs;                            // pas exact → la tuile se referme
        var bruit = new Float32Array(blocs * blocs);
        for (var i = 0; i < bruit.length; i++) bruit[i] = rnd();

        /* LES NUAGES : le même bruit, mais échantillonné sur une grille quatre fois
           plus large, donc quatre fois plus lent — l'ondulation de teinte. Il se
           referme lui aussi (modulo), pour la même raison que le grain. */
        var blocsN = Math.max(2, Math.round(blocs / 4));
        var pasN = s / blocsN;
        var nuages = new Float32Array(blocsN * blocsN);
        for (var j = 0; j < nuages.length; j++) nuages[j] = rnd();
        var forceNuages = (style === 'fibreux') ? 0.34 * force
                        : (style === 'mouchete' ? 0.22 * force : 0.10 * force);

        for (var y = 0; y < s; y++) {
            for (var x = 0; x < s; x++) {
                var bx = (x / pas) | 0, by = (y / pas) | 0;
                // Interpolation bilinéaire entre les coins du bloc, avec RETOUR AU
                // DÉBUT : la dernière colonne touche la première (modulo).
                var fx = (x % pas) / pas, fy = (y % pas) / pas;
                var bx1 = (bx + 1) % blocs, by1 = (by + 1) % blocs;
                var v00 = bruit[by * blocs + bx];
                var v10 = bruit[by * blocs + bx1];
                var v01 = bruit[by1 * blocs + bx];
                var v11 = bruit[by1 * blocs + bx1];
                var v = (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
                // En plus du lissé, une pointe de bruit fin : les aspérités.
                // (Celui-là se referme par construction : il est tiré PIXEL par PIXEL,
                //  donc la tuile est déjà périodique au pixel près.)
                v = v * 0.82 + rnd() * 0.18;

                // Les nuages, en bilinéaire eux aussi.
                var nx = (x / pasN) | 0, ny = (y / pasN) | 0;
                var nfx = (x % pasN) / pasN, nfy = (y % pasN) / pasN;
                var nx1 = (nx + 1) % blocsN, ny1 = (ny + 1) % blocsN;
                var n00 = nuages[ny * blocsN + nx], n10 = nuages[ny * blocsN + nx1];
                var n01 = nuages[ny1 * blocsN + nx], n11 = nuages[ny1 * blocsN + nx1];
                var nv = (n00 * (1 - nfx) + n10 * nfx) * (1 - nfy) + (n01 * (1 - nfx) + n11 * nfx) * nfy;
                if (style === 'fibreux') {
                    /* Le kraft se lit par BANDES dans le sens machine : on étire les
                       nuages horizontalement (une colonne de nuage sur trois en
                       hauteur) pour que l'ondulation suive le fil du papier. */
                    var bande = nuages[(((y / (pasN * 3)) | 0) % blocsN) * blocsN + nx];
                    nv = nv * 0.45 + bande * 0.55;
                }
                v += (nv - 0.5) * forceNuages * 2;

                /* ⚠️ LES DEUX COEFFICIENTS DÉCIDENT SI LE GRAIN SE VOIT, et ils ont
                   été relevés à l'usage : à 0,55 / 0,85, un papier très texturé
                   (recyclé, kraft) restait à peine perceptible dans l'aperçu 3D —
                   parce que l'aperçu multiplie encore ce calque par SA propre
                   opacité. Le grain est donc franc ICI, et c'est le dépôt qui dose
                   (`u.grain.material.opacity` dans sp-3d-preview.js). */
                var a = (v - 0.5) * 2 * force * 255;
                var k = (y * s + x) * 4;
                if (a >= 0) { d[k] = 255; d[k + 1] = 255; d[k + 2] = 255; d[k + 3] = Math.min(255, a * 0.70); }
                else { d[k] = 0; d[k + 1] = 0; d[k + 2] = 0; d[k + 3] = Math.min(255, -a * 1.0); }
            }
        }
        ctx.putImageData(img, 0, 0);

        /* ── LES FIBRES. Elles sont LONGUES et alignées dans les pâtes non blanchies
           (kraft, journal), COURTES et clairsemées dans les autres. Toutes vont
           dans le même sens général : c'est celui de la fabrication de la feuille.
           ⚠️ CHAQUE FIBRE EST TRACÉE CINQ FOIS (elle, et ses quatre copies d'un bord à
           l'autre) : sans cela, une fibre qui sort du canevas est COUPÉE NET au bord et
           la répétition montre un liseré de fibres tronquées à chaque jointure. */
        var fibreux = (style === 'fibreux');
        var fibres = fibreux ? Math.max(10, Math.round(s / 2.2)) : Math.max(6, Math.round(s / 5));
        var longMax = fibreux ? 0.34 : 0.09;      // longueur, en part du canevas
        var longMin = fibreux ? 0.08 : 0.03;
        var ecart = fibreux ? 0.22 : 0.7;         // dispersion angulaire (rad)
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(1, s / (fibreux ? 200 : 256));
        for (var n = 0; n < fibres; n++) {
            var x0 = rnd() * s, y0 = rnd() * s;
            var ang = (rnd() - 0.5) * ecart;
            var len = s * (longMin + rnd() * (longMax - longMin));
            var dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
            /* Une fibre claire OU sombre, jamais la même : un papier fibreux montre
               les deux (des fibres qui accrochent la lumière, d'autres qui
               l'absorbent). */
            ctx.strokeStyle = (rnd() < 0.5)
                ? 'rgba(255,255,255,' + (force * 0.55).toFixed(3) + ')'
                : 'rgba(0,0,0,' + (force * 0.8).toFixed(3) + ')';
            [[0, 0], [-s, 0], [s, 0], [0, -s], [0, s]].forEach(function (o) {
                ctx.beginPath();
                ctx.moveTo(x0 + o[0], y0 + o[1]);
                ctx.lineTo(x0 + o[0] + dx, y0 + o[1] + dy);
                ctx.stroke();
            });
        }

        /* ── LES MOUCHETURES. Ces petits points sombres sont la signature du RECYCLÉ
           (impuretés de la pâte de récupération). Elles sont posées APRÈS les fibres,
           donc au-dessus : dans le papier, ce sont des agglomérats en surface. */
        if (style === 'mouchete') {
            var points = Math.max(20, Math.round(s * s / 900));
            for (var m = 0; m < points; m++) {
                var px = rnd() * s, py = rnd() * s;
                var ray = (0.7 + rnd() * 1.9) * (s / 256);
                ctx.fillStyle = 'rgba(0,0,0,' + (force * (0.45 + rnd() * 0.45)).toFixed(3) + ')';
                ctx.beginPath();
                ctx.arc(px, py, ray, 0, Math.PI * 2);
                ctx.fill();
            }
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
     * ⚠️ RIEN DE TOUT CELA NE PART DANS LE PDF, ET C'EST STRUCTUREL, PAS UNE PROMESSE.
     * Les trois calques vivent dans le DOM, À CÔTÉ des planches fabric ; ils ne sont
     * donc pas dans le pixel des planches. Mesuré (page de contrôle gris moyen) :
     *
     *     toDataURL() sans papier  18 174 caractères
     *     toDataURL() recyclé      18 174 caractères — IDENTIQUE
     *     toDataURL() kraft        18 174 caractères — IDENTIQUE
     *
     * L'export PDF et l'aperçu 3D dessinent tous deux à partir de ces mêmes planches
     * (`toDataURL`) : aucune aspérité ne peut donc y entrer, même si un jour le rendu
     * change. L'aspérité est VIRTUELLE — un aperçu, jamais un objet du document.
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
                'background-size:256px 256px',
                /* 256 px pour une tuile de 128 : les aspérités font ~4 px à l'écran.
                   C'est une EXAGÉRATION ASSUMÉE : à l'échelle réelle, les fibres d'un
                   papier sont plus fines qu'un pixel — un grain exact serait un grain
                   invisible, et la demande est qu'on le voie.
                   ⚠️ MÊME COURBE QUE L'APERÇU 3D (`grain^0,7`, voir
                   sp-3d-preview.js) : sans cela, l'éditeur et l'aperçu ne montreraient
                   pas la même intensité pour le même papier — et l'aperçu cesserait
                   d'être une prévision. */
                'opacity:' + Math.min(0.85, Math.pow(p.grain, 0.7) * 1.35).toFixed(3),
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
        if (i === pageActive()) majMarqueActive();
        prevenirLApercu(i);
        return true;
    }

    /** Enlève le papier d'une page. */
    function retirer(i) {
        if (i == null) i = pageActive();
        delete papiersParPage[i];
        delete papiersParPage['calque:' + i];
        habillerPage(i);
        majMarqueActive();
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

    /* ═══════════════════════ INTERFACE : UNE SEULE PORTE ══════════════════════
       LES ASPÉRITÉS SE PRENNENT DANS LE SOUS-MENU DE L'ICÔNE IMAGE, ET LÀ SEULEMENT.
       La palette s'appelle « Papier » — `papierTitle` dans les trois langues.

         · le SOUS-MENU DE L'ICÔNE IMAGE, APRÈS « SVG ». Le menu et son ouverture
           restent ceux de l'app (`setupImportDropdown`, `main.js:23163`) : on n'y
           ajoute que nos entrées ;
         · sa PREMIÈRE LIGNE, « Papier », ouvre la PALETTE — le widget
           flottant. Un second clic la ferme (`basculeWidget`). Le widget est
           déplaçable par sa barre de titre, et sa position est retenue d'une
           session à l'autre, comme celle des autres widgets.

       ⚠️ IL N'Y A PLUS D'ICÔNE DANS LA COLONNE DE GAUCHE. Elle a été retirée :
       une même chose à deux endroits obligeait à deviner lequel fait quoi. La
       colonne garde donc ses outils, et les aspérités se rangent sous l'import
       d'image — leur place, puisque c'est une matière d'image.

       Les deux listes sont construites par le MÊME `creerEntreeDePapier` : il n'y a
       donc pas deux façons de déposer un papier selon l'endroit d'où on l'a pris.
    */

    var racine = null, menu = null, ancrage = null;      // le bloc dans le menu Image
    var bouton = null, widget = null, listeWidget = null; // l'icône et son widget
    var widgetVisible = false;

    /** Le contenu d'une pastille de papier — la vignette qui porte sa matière. */
    function pastilleDe(p, tailleCss) {
        var pastille = document.createElement('span');
        pastille.className = 'tool-icon';
        var url = p.grain ? urlGrain(p, 64) : null;
        pastille.style.cssText = 'display:inline-block;width:16px;height:16px;border-radius:3px;' +
            'border:1px solid rgba(128,128,128,.45);flex:0 0 auto;position:relative;overflow:hidden;' +
            'background-color:' + (p.teinte || 'transparent') + ';' +
            (url ? 'background-image:url(' + url + ');' : '') +
            /* 22 px pour une tuile de 64 : l'aspérité reste LISIBLE dans une vignette
                   de 16 px — c'est ce qui permet de choisir un papier à l'œil. Le grain est
                   plus grossier que sur la page, et c'est voulu : une vignette qui montrerait
                   le grain à l'échelle réelle serait une vignette unie. */
            'background-size:' + (tailleCss || 22) + 'px ' + (tailleCss || 22) + 'px;';
        if (p.matiere === 'brillant') {
            // Le brillant se lit à la diagonale, comme dans l'aperçu 3D.
            var refl = document.createElement('span');
            refl.style.cssText = 'position:absolute;inset:0;pointer-events:none;' +
                    'background:linear-gradient(135deg,rgba(255,255,255,0) 38%,rgba(255,255,255,.85) 50%,rgba(255,255,255,0) 62%);';
            pastille.appendChild(refl);
        }
        return pastille;
    }

    /** L'icône de la colonne : des ÉTOILES — les ASPÉRITÉS du papier. */
    function iconeEtoiles() {
        return '<svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M12 3l1.9 4.1L18 9l-4.1 1.9L12 15l-1.9-4.1L6 9l4.1-1.9z"/>' +
            '<path d="M18.5 14.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z"/>' +
            '<path d="M5.5 15l.6 1.3 1.4.7-1.4.7L5.5 19l-.6-1.3L3.5 17l1.4-.7z"/>' +
            '</svg>';
    }

    /**
     * Une entrée de papier — la MÊME pour le widget et pour le sous-menu Image.
     * @param {object} p      une entrée du catalogue
     * @param {string} classe la classe de l'élément (le style diffère, pas le geste)
     */
    function creerEntreeDePapier(p, classe) {
        var b = document.createElement('button');
        b.className = classe;
        b.setAttribute('draggable', 'true');
        b.setAttribute('data-papier', p.id);
            b.title = 'Papier ' + p.nom + (p.grammage ? ' — ' + p.grammage + ' g/m²' : '') +
                ' — ' + p.matiere + (p.transparent ? ' — calque (translucide)' : '') +
                ' — ' + (p.style === 'fibreux' ? 'fibres longues visibles'
                        : p.style === 'mouchete' ? 'mouchetures (recyclé)' : 'grain fin') +
                ' — glisser sur la page, ou cliquer pour la page active';

        /* Le nom tel quel, plus le signe du brillant. La mention « (calque) » a été
           RETIRÉE, pour deux raisons : elle était redondante — « Calque (calque) »,
           « Vélin transparent (calque) » — et ses 9 caractères poussaient le widget
           jusqu'à sa largeur maximale (200 px) là où Styles et Pathfinder tiennent
           en 160. La translucidité reste dite deux fois : par le nom lui-même, et
           par l'infobulle, qui précise « calque (translucide) ». */
        var nom = document.createElement('span');
        nom.textContent = p.nom + (p.matiere === 'brillant' ? ' ✦' : '');
        b.appendChild(pastilleDe(p, 22));
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
            majMarqueActive();
        });

        return b;
    }

    /* ─────────────────────────────────────────── Le bloc du sous-menu Image ── */
    function construireBlocImage() {
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

        /* ── LA LIGNE QUI OUVRE LA PALETTE, ET POURQUOI ELLE EST ICI.
           Il n'y a PLUS d'icône « Papier » dans la colonne de gauche :
           les aspérités ne vivent que dans ce sous-menu, et c'est donc cette ligne
           qui ouvre le widget. Elle porte la classe `dropdown-item`, comme « Image »
           et « SVG » juste au-dessus, pour ne pas détonner dans le menu.
           L'ancien titre (« Papiers — aspérités »), purement décoratif et en
           `pointer-events:none`, devient donc un bouton. */
        bouton = document.createElement('button');
        bouton.className = 'dropdown-item sp-papier-ouvrir';
        bouton.id = 'spPapierOuvrir';
        bouton.type = 'button';
        bouton.setAttribute('aria-label', nomPalette());
        bouton.setAttribute('aria-pressed', 'false');
        bouton.title = nomPalette() + ' — ' + 'ouvrir la palette (un second clic la ferme)';
        bouton.innerHTML = iconeEtoiles() +
            '<span class="sp-papier-ouvrir-nom" data-translate="papierTitle">' + nomPalette() + '</span>' +
            '<span class="sp-papier-ouvrir-fleche" aria-hidden="true">▸</span>';
        /* ⚠️ LE MENU NE CONTIENT PLUS QU'UNE SEULE LIGNE, ET C'EST VOULU. Les
           aspérités du catalogue étaient listées ICI, au premier niveau du
           sous-menu : treize papiers déversés dans un menu qui n'en demandait
           pas tant, alors que « Image » et « SVG » au-dessus tiennent en une
           ligne chacun. Le catalogue vit dans le WIDGET — qui les affiche tous,
           avec la même pastille et le même geste (glisser, ou cliquer pour la
           page active) : rien n'est perdu, et la porte est de nouveau unique. */
        bouton.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            basculeWidget();
            fermerMenu();
        });
        racine.appendChild(bouton);

        ancrage.parentNode.insertBefore(racine, ancrage.nextSibling);
        return true;
    }

    /* ───────────────────────────── Le WIDGET : l'icône de la colonne ──
       Gabarit des widgets de l'app (Styles, Nuancier, Filtres) : en-tête avec
       pastille et titre, corps repliable, position retenue. On le pose DANS
       `#widgetsOverlay` quand il existe — l'app y déplace ses propres widgets
       (`moveWidgetsToOverlay`, `main.js:75592`) pour qu'ils ne défilent pas avec
       la page — sinon on le pose dans le corps du document.
    */
    var CLE_POSITION = 'sp_papiers_widget_pos';

    function construireWidget() {
        if (widget && widget.parentNode) return true;

        widget = document.createElement('div');
        widget.className = 'sp-papier-widget sp-papier-widget-ferme';
        widget.id = 'spPapierWidget';
        widget.setAttribute('role', 'dialog');
        widget.setAttribute('aria-label', nomPalette());
        widget.innerHTML =
            '<div class="sp-papier-entete" id="spPapierEntete">' +
            '<span class="sp-papier-point"></span>' +
            '<span class="sp-papier-nom" data-translate="papierTitle">' + nomPalette() + '</span>' +
            '<span class="sp-papier-fleche">▾</span>' +
            '</div>' +
            '<div class="sp-papier-corps" id="spPapierCorps"></div>';

        listeWidget = widget.querySelector('#spPapierCorps');

        var intro = document.createElement('div');
        /* ⚠️ CETTE LIGNE DÉCIDE DE LA LARGEUR DU WIDGET, et ce n'est pas une figure
           de style : le widget est en `position:fixed`, donc sa largeur est ajustée
           à son contenu — c'est-à-dire à sa plus large ligne. Mesurée au canevas,
           « Glisser une pastille sur la page visée » faisait 205,2 px et poussait
           donc le panneau à sa largeur maximale (200 px), quand Styles, Pathfinder,
           Nuancier et Filtres tiennent en 160. La phrase est raccourcie pour
           repasser sous les 160 px, sans rien perdre de ce qu'elle dit. */
        intro.className = 'sp-papier-intro';
        intro.textContent = 'Glisser sur la page visée';
        listeWidget.appendChild(intro);

        PAPIERS.forEach(function (p) { listeWidget.appendChild(creerEntreeDePapier(p, 'sp-papier-ligne')); });

        // ── En-tête : replier / déplier, et DÉPLACER le widget.
        var entete = widget.querySelector('#spPapierEntete');
        entete.addEventListener('click', function () {
            if (widget.dataset.deplace === '1') { widget.dataset.deplace = '0'; return; }
            widget.classList.toggle('sp-papier-widget-ferme');
        });
        rendreDeplacable(entete);

        // On rejoint la couche des widgets si elle est là.
        var couche = document.getElementById('widgetsOverlay');
        (couche || document.body).appendChild(widget);
        poserLeWidget();
        return true;
    }

    /** Position : celle retenue, sinon en haut à gauche de la pile des widgets. */
    function poserLeWidget() {
        if (!widget) return;
        var x = 16, y = null;
        try {
            var sauv = JSON.parse(localStorage.getItem(CLE_POSITION) || 'null');
            if (sauv && typeof sauv.x === 'number' && typeof sauv.y === 'number') { x = sauv.x; y = sauv.y; }
        } catch (_) {}
        widget.style.left = x + 'px';
        if (y != null) {
            widget.style.top = y + 'px';
            widget.style.bottom = 'auto';
        }
        /* Sans position retenue : SOUS les autres widgets de gauche. Ils occupent
           16 px (Filtres), 80 px (Nuancier), 144 px (Styles) et 208 px (Pathfinder),
           soit un pas de 64 px. Le créneau suivant est donc 272 px — et non 216,
           qui mordait sur Pathfinder (208 + 28 px de hauteur) : la valeur d'avant
           avait oublié ce quatrième widget. */
        else {
            widget.style.bottom = '272px';
            widget.style.top = 'auto';
        }
    }

    /** Déplacer le widget par son en-tête (souris), et retenir la position. */
    function rendreDeplacable(poignee) {
        var enCours = false, dx0 = 0, dy0 = 0, l0 = 0, t0 = 0;
        poignee.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            enCours = true;
            widget.dataset.deplace = '0';
            var r = widget.getBoundingClientRect();
            dx0 = e.clientX; dy0 = e.clientY; l0 = r.left; t0 = r.top;
            try { document.body.style.userSelect = 'none'; } catch (_) {}
        });
        document.addEventListener('mousemove', function (e) {
            if (!enCours || !widget) return;
            var nx = l0 + (e.clientX - dx0), ny = t0 + (e.clientY - dy0);
            if (Math.abs(e.clientX - dx0) > 3 || Math.abs(e.clientY - dy0) > 3) widget.dataset.deplace = '1';
            nx = clamp(nx, 0, Math.max(0, window.innerWidth - 60));
            ny = clamp(ny, 0, Math.max(0, window.innerHeight - 30));
            widget.style.left = nx + 'px';
            widget.style.top = ny + 'px';
            widget.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', function () {
            if (!enCours || !widget) return;
            enCours = false;
            try { document.body.style.userSelect = ''; } catch (_) {}
            try {
                    localStorage.setItem(CLE_POSITION, JSON.stringify({
                        x: Math.round(widget.getBoundingClientRect().left),
                        y: Math.round(widget.getBoundingClientRect().top),
                    }));
            } catch (_) {}
            setTimeout(function () { if (widget) widget.dataset.deplace = '0'; }, 60);
        });
    }

    function basculeWidget() {
        if (!construireWidget()) return false;
        widgetVisible = !widgetVisible;
        widget.style.display = widgetVisible ? '' : 'none';
        /* ⚠️ ON OUVRE DÉPLIÉ. Le widget naît replié (classe `-ferme`) pour que sa
           première apparition ne recouvre pas la page ; mais un clic sur l'icône doit
           MONTRER la palette, pas une barre de titre qu'il faudrait encore déplier.
           Le repli reste possible — c'est le clic sur l'en-tête. */
        if (widgetVisible) widget.classList.remove('sp-papier-widget-ferme');
        if (bouton) {
            bouton.classList.toggle('active', widgetVisible);
            bouton.setAttribute('aria-pressed', widgetVisible ? 'true' : 'false');
        }
        if (widgetVisible) majMarqueActive();
        return widgetVisible;
    }

    /** Souligne, dans la palette, le papier de la page ACTIVE. */
    function majMarqueActive() {
        var p = papierDePage(pageActive());
        var id = p ? p.id : null;
        /* Une seule liste porte les papiers : celle du widget (`.sp-papier-ligne`).
           Le sous-menu n'en affiche plus — voir `construireBlocImage`. */
        var toutes = document.querySelectorAll('.sp-papier-ligne');
        for (var i = 0; i < toutes.length; i++) {
            var actif = id != null && toutes[i].getAttribute('data-papier') === id;
            toutes[i].classList.toggle('sp-papier-actif', actif);
        }
    }

    function construireInterface() {
        /* Une seule chose à construire, et une seule porte : le bloc du sous-menu
           Image. C'est lui qui porte aussi la ligne d'ouverture du widget. */
        return construireBlocImage();
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
            /* ── LA LIGNE QUI OUVRE LA PALETTE, dans le sous-menu Image.
                  Elle porte `dropdown-item` — le gabarit des entrées du menu — et
                  n'a donc besoin que de deux choses : que son libellé puisse se
                  couper proprement, et une flèche poussée à droite qui annonce
                  qu'elle ouvre autre chose. */
            '.sp-papier-ouvrir-nom{flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '.sp-papier-ouvrir-fleche{margin-left:auto;opacity:.5;font-size:10px;}',
            '.sp-papier-actif{background:rgba(13,148,136,.16) !important;' +
                'box-shadow:inset 0 0 0 1px rgba(13,148,136,.45);}',

            /* ── LE WIDGET, AU GABARIT EXACT DES WIDGETS DE L'APP.
                  Valeurs relevées dans `CSS/main.css`, aux règles mêmes de Styles
                  (`.typo-styles-widget`, l.1574) et de Pathfinder
                  (`.pathfinder-widget`, l.2817), puis MESURÉES côte à côte dans le
                  navigateur — c'est l'écart que la demande signalait :
                    · boîte   : min-width 160 / max-width 200, radius 10, bord 1 px
                                rgba(0,0,0,.12), ombre 0 8px 24px rgba(0,0,0,.15) ;
                    · en-tête : padding 6px 8px, gap 6px, 11 px / 700, letter-spacing
                                .8 px, MAJUSCULES, et AUCUN filet bas ;
                    · pastille: 5 px, #111 (clair) / #e6e6e6 (sombre) ;
                    · flèche  : 10 px, opacité .6, retournement en .2 s ;
                    · lignes  : 6px 8px, radius 6, 10 px, survol neutre rgba(0,0,0,.06).
                  La version précédente faisait 216 px de large, un en-tête de
                  33,3 px (contre 26,7), un titre en 400 sans majuscules, une
                  pastille de 7 px teal et un filet bas : cinq écarts, tous visibles
                  dès qu'on met les deux panneaux côte à côte.
                  `position:fixed` reste, lui : l'app fait migrer ses widgets de
                  `#widgetsOverlay` au corps du document, et le nôtre ne doit pas
                  dépendre du conteneur où il atterrit. */
            '.sp-papier-widget{position:fixed;z-index:340;min-width:160px;max-width:200px;max-height:74vh;' +
                'display:flex;flex-direction:column;background:rgba(255,255,255,.96);color:#111;' +
                'border:1px solid rgba(0,0,0,.12);border-radius:10px;' +
                'box-shadow:0 8px 24px rgba(0,0,0,.15);backdrop-filter:saturate(1.2) blur(2px);' +
                'overflow:hidden;user-select:none;-webkit-user-select:none;' +
                'font-family:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;}',
            '.theme-dark .sp-papier-widget{background:rgba(24,24,24,.96);color:#e6e6e6;' +
                'border-color:rgba(255,255,255,.1);}',
            '.sp-papier-entete{display:flex;align-items:center;gap:6px;padding:6px 8px;' +
                'font-weight:700;font-size:11px;letter-spacing:.8px;text-transform:uppercase;' +
                'cursor:move;}',
            '.sp-papier-point{width:5px;height:5px;border-radius:50%;background:#111;flex:0 0 auto;}',
            '.theme-dark .sp-papier-point{background:#e6e6e6;}',
            '.sp-papier-fleche{margin-left:auto;opacity:.6;font-size:10px;transition:transform .2s;}',
            '.sp-papier-widget-ferme .sp-papier-fleche{transform:rotate(-90deg);}',
            '.sp-papier-corps{display:flex;flex-direction:column;gap:1px;padding:6px;overflow:auto;}',
            '.sp-papier-widget-ferme .sp-papier-corps{display:none;}',
            '.sp-papier-intro{font-size:9px;line-height:1.4;opacity:.55;padding:1px 6px 7px;}',
            '.sp-papier-ligne{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;' +
                'border:1px solid transparent;border-radius:6px;background:transparent;' +
                'font:inherit;font-size:10px;letter-spacing:.3px;color:inherit;text-align:left;' +
                'cursor:grab;}',
            '.sp-papier-ligne:hover{background:rgba(0,0,0,.06);}',
            '.sp-papier-ligne:active{cursor:grabbing;}',
            '.sp-papier-ligne span:last-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
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
            if (!ok) setTimeout(function () { if (construireInterface()) { reHabillerTout(); majMarqueActive(); } }, 800);
            reHabillerTout();
            majMarqueActive();
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
        if (widget && widget.parentNode) widget.parentNode.removeChild(widget);
        if (bouton && bouton.parentNode) bouton.parentNode.removeChild(bouton);
        racine = menu = ancrage = null;
        bouton = widget = listeWidget = null;
        widgetVisible = false;
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
        catalogue: function () { return PAPIERS.map(function (p) { return { id: p.id, nom: p.nom, teinte: p.teinte, grain: p.grain, matiere: p.matiere, transparent: p.transparent, calque: p.calque, grammage: p.grammage, style: p.style }; }); },
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
                // La ligne du sous-menu qui ouvre le widget (elle a remplacé
                // l'icône de la colonne : le sous-menu est la seule porte).
                ouvreur: !!bouton,
                widget: !!widget,
                widgetVisible: widgetVisible,
                // Le nombre de calques RÉELLEMENT posés dans la page — c'est ce qui
                // dit si le dépôt se voit, et non s'il a été « enregistré ».
                calques: document.querySelectorAll(SELECTEUR_NOS_CALQUES).length,
                marques: document.querySelectorAll('.' + CLASSE_MARQUE).length,
            };
        },
        // Pour les bancs : ouvrir / fermer le widget sans passer par la souris.
        basculerWidget: basculeWidget,
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installer, { once: true });
    else installer();
})();
