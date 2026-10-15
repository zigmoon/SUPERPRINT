/* ============================================================================
   sp-3d-preview.js — Aperçu « magazine » 3D de la maquette (three.js).
   ----------------------------------------------------------------------------
   Bouton PLAY de la barre d'outils SuperPrint.

   • Capture les planches de l'éditeur (une par canvas fabric) : si le document
     est en double page, chaque canvas est découpé en deux (page gauche / droite)
     pour reconstituer l'ordre de lecture d'un vrai feuillet.
   • Affiche un livre ouvert dans un studio 3D confortable (lumière chaude,
     sol doux, ombre portée) et permet de feuilleter les pages (animation de
     « tourne de page » autour de la reliure), d'orbiter et de zoomer.

   ⚠️ Module 100 % autonome : il ne modifie AUCUN état persistant de l'app. La
      seule manipulation des canvas (masquage temporaire des repères) est
      annulée immédiatement après la capture.
   ========================================================================== */
import * as THREE from './three.module.min.js';

(function () {
    'use strict';

    /* ---------------------------------------------------------------- Réglages */
    var PAGE_H = 2.0;          // hauteur d'une page dans la scène (unités three)
    var TEX_MULT = 2;          // qualité de capture des planches
    var FLIP_MS = 680;         // durée d'un tourne de page (ms)
    var RADIUS_BASE = 4.7;     // distance caméra par défaut (recalculée selon le format)
    var PHI_MIN = 0.55, PHI_MAX = Math.PI / 2;   // 90° = caméra FACE à la page → document À PLAT
    var RADIUS_MIN = 1.8, RADIUS_MAX = 26;
    /* ⚠️ _SP3D_ORBITE_716 — ON NE PASSE JAMAIS DERRIÈRE LE LIVRE.
       Défaut signalé : « quand je rotate le document, il perd le recto de couverture
       et le verso ». MESURÉ, et ce n'est pas une texture perdue : après une rotation
       de 172°, la page montrée au centre de l'écran est le VERSO NU de la feuille —
       relevé (218,196,161), c'est-à-dire la teinte du papier kraft, alors que la
       couverture de l'essai est rouge (200,30,30). Les textures restent intactes
       (`leafR` garde `texIdx: 0`), mais les feuilles sont des plans à UNE seule face
       utile : `side: FrontSide`, l'avant porte la page, l'arrière est du papier nu.
       C'est physiquement juste (le dos d'une couverture est vierge) mais l'aperçu
       devient inutilisable : l'utilisateur croit avoir perdu ses pages.
       Le remède est de BORNER l'orbite : ±62° autour de la reliure. On garde le
       relief (le livre s'incline, les pages prennent du volume), on ne peut plus se
       placer derrière le livre, donc plus jamais de page « disparue ». */
    var THETA_MAX = 62 * Math.PI / 180;
    function bornerTheta() { theta = clamp(theta, -THETA_MAX, THETA_MAX); }

    /* ----------------------------------------------------------------- Thèmes
       SOMBRE par défaut à l'ouverture (demande utilisateur).
       Le thème CLAIR est « clinique / mathématique » : fond quasi blanc avec
       une grille fine (cadrillage), papier des pages PUR BLANC (les pages sont
       affichées NON ÉCLAIRÉES pour rester fidèles à la maquette). */
    var THEMES = {
        light: {
            cls: 'sp3d-light',
            bgBase: ['#fbfcfe', '#f1f4f9', '#e3e8f0'],
            gridLine: 'rgba(30,41,59,.10)', gridStep: 64,
            gridMajor: 'rgba(30,41,59,.20)', gridMajorStep: 256,
            fogColor: 0xeef0f4, fogNear: 13, fogFar: 46,
            floor: [[0, '#ffffff'], [0.5, '#f2f4f8'], [1, '#e2e6ee']],
            hemiSky: 0xffffff, hemiGround: 0xe2e6ee, hemiI: 1.05,
            keyColor: 0xffffff, keyI: 2.0,
            fillColor: 0xf2f6ff, fillI: 0.5,
            rimColor: 0xffffff, rimI: 4,
            exposure: 1.0,
            gutter: 0.5,
            shadow: 0.34,
            loaderBg: '#f2f3f7', loaderSpin: '#0d9488'
        },
        dark: {
            cls: 'sp3d-dark',
            bgBase: ['#242a3a', '#171a24', '#0a0b10'],
            gridLine: 'rgba(255,255,255,.05)', gridStep: 64,
            gridMajor: 'rgba(255,255,255,.09)', gridMajorStep: 256,
            fogColor: 0x0c0d12, fogNear: 8, fogFar: 22,
            floor: [[0, '#3a3f4d'], [0.5, '#1a1d26'], [1, '#0a0b10']],
            hemiSky: 0xbcd0ff, hemiGround: 0x2a2622, hemiI: 0.55,
            keyColor: 0xfff0da, keyI: 2.35,
            fillColor: 0x9ab6ff, fillI: 0.55,
            rimColor: 0xffd9a8, rimI: 18,
            exposure: 1.05,
            gutter: 0.5,
            shadow: 0.5,
            loaderBg: '#0b0c10', loaderSpin: '#5eead4'
        }
    };
    var theme = 'dark';        // 🎯 thème SOMBRE par défaut

    /* ----------------------------------------------------------------- État */
    var open = false;
    var overlay = null, canvasEl = null, renderer = null, scene = null, camera = null;
    var rafId = 0, clock = null;
    var texes = [], paperTex = null, floorTex = null, bgTex = null, bgImageTex = null;
    /* _SP3D_CALQUE_616 — la couche « ENCRE SEULE » des pages en calque, une entrée
       par page (null quand la page n'est pas un calque). Voir `appliquerPapierAuFeuillet`. */
    var texesEncre = [];
    var pageW = 1.414, geoPlane = null;
    var bookGroup = null, leafL = null, leafR = null, flipper = null;
    var flipFrontMat = null, flipBackMat = null;
    var flipAnim = null, spread = 0, N = 0, views = [];
    var theta = 0, phi = 1.16, radius = RADIUS_BASE, intro = 0;
    var zoomPct = 100;         // facteur de zoom (100 % = cadrage ajusté au format)
    var roll = 0;              // inclinaison (roulis) du plan du livre
    var leafTilt = 0.028;      // léger « V » des pages ouvertes (volume du pli)
    var target = null;
    var dragging = false, lastX = 0, lastY = 0, moved = false;
    var prevOverflow = '';
    var indicatorEl = null, prevBtn = null, nextBtn = null;
    var offsetTarget = 0;   // décalage du livre pour recentrer une page seule (couverture / dernière)
    var frameErrors = 0;    // garde-fou : si le rendu échoue en boucle, on ferme proprement
    // Références scène (pour changer de thème à la volée)
    var hemiLight = null, keyLight = null, fillLight = null, rimLight = null;
    var floorMesh = null, floorMat = null, settingsBtn = null;
    // Ombre de PLI : un dégradé ENFANT de chaque feuille (côté reliure). Elle suit
    // la page (tourne/penche avec elle), ne clignote jamais et s'affiche aussi sur
    // une page seule (couverture / dos) — plus de « flash », plus de retard.
    var foldMats = [];
    var foldScale = 1;   // gain d'opacité de l'ombre de pli (plein partout)
    var contactShadow = null, contactShadowMat = null, contactShadowTex = null;
    var tAmbiance = 0;           // horloge du flottement d'ambiance (gelable, voir tick)
    var fige = false;            // _SP3D_OMBRE_713 : gel du flottement — diagnostic
    var gutterIntensity = 0.7;   // 0..1.4 (réglable)
    // Réglages / fond / enregistrement
    var bgMode = 'grid';         // 'gradient' | 'grid' | 'image'  (cadrillage par défaut)
    var settingsEl = null, settingsOpen = false;
    var recordBtn = null, recorder = null, recChunks = [], recording = false;
    var settingInputs = {};

    /* ------------------------------------------------------------- Utilitaires */
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function toast(msg) {
        try { if (typeof window.spShowToast === 'function') { window.spShowToast(msg); return; } } catch (_) {}
        console.log('[SP-3D]', msg);
    }

    /* ------------------------------------------- Accès aux planches de l'app */
    function getAppCanvases() {
        try {
            if (typeof window.spEnCanvases === 'function') {
                var a = window.spEnCanvases();
                if (Array.isArray(a) && a.length) return a.filter(Boolean);
            }
        } catch (_) {}
        try { if (Array.isArray(window.canvases) && window.canvases.length) return window.canvases.filter(Boolean); } catch (_) {}
        try { if (Array.isArray(window.spCanvases) && window.spCanvases.length) return window.spCanvases.filter(Boolean); } catch (_) {}
        return [];
    }

    /* ⚠️ _SP3D_PRET_712 — L'APP EST-ELLE PRÊTE À ÊTRE CAPTURÉE ?
       L'app (main.js) marque chaque planche `_spRenderReady = false` (ou `_isLoading`) pendant
       son rendu asynchrone, et remet `true` une fois peinte. Tant qu'une seule planche n'est
       pas prête, capturer donne des images vides (couverture / dos « disparus »). */
    function canvasesReady() {
        var cs = getAppCanvases();
        if (!cs.length) return false;
        for (var i = 0; i < cs.length; i++) {
            var c = cs[i];
            if (c && (c._isLoading || c._spRenderReady === false)) return false;
        }
        return true;
    }
    // Attend la disponibilité (poll 100 ms, budget 3 s) puis rappelle cb() — DANS TOUS LES CAS.
    function waitAppReady(cb) {
        var t0 = performance.now ? performance.now() : Date.now();
        var essai = 0;
        var pas = function () {
            if (!open) return;
            var pret = false;
            try { pret = canvasesReady(); } catch (_) {}
            var now = performance.now ? performance.now() : Date.now();
            if (pret || (now - t0) > 3000 || essai++ > 40) { cb(); return; }
            setTimeout(pas, 100);
        };
        // Une image au moins, pour laisser la planche se peindre, puis on sonde.
        try { requestAnimationFrame(function () { setTimeout(pas, 60); }); } catch (_) { pas(); }
    }

    /* ════════════════════════════════════════════════════════════════════════
       _SP3D_STABLE_713 — LE DOCUMENT EST-IL STABLE AVANT DE LE CAPTURER ?

       DÉFAUT SIGNALÉ : « souvent je n'ai pas de dos document immédiatement ou il
       ne charge pas avant que j'ouvre une première fois le document. »

       CAUSE, MESURÉE par `_dev/scripts/_banc_3d_dos.cjs` : au démarrage, l'app
       possède UNE planche (« Page 1 », vide) et `_isLoading` y est DÉJÀ faux.
       `canvasesReady()` répond donc « prêt » — et c'est vrai : ce qu'elle regarde
       est prêt. Mais le DOCUMENT, lui, n'est pas encore chargé : l'import (ou la
       restauration) remplace `pages[]` quelques centaines de millisecondes plus
       tard. La capture partait donc sur 1 page, et l'aperçu restait bloqué à
       1 page pour toujours — la dernière page (le dos) n'existait pas encore au
       moment où on l'a regardée.

       MESURE du défaut, avec un document de 5 pages :
           1000 ms → projet 1 page,  aperçu N=1   (capture trop tôt)
           2000 ms → projet 5 pages, aperçu N=1   (jamais recapturé)
           8000 ms → projet 5 pages, aperçu N=1
       Quand on ouvre le document UNE FOIS avant de cliquer sur play, le projet a
       déjà ses 5 pages et tout va bien — d'où l'impression « ça marche après ».

       LE REMÈDE a deux moitiés, et les deux sont nécessaires :
         1. AVANT de capturer, attendre que le NOMBRE DE PAGES ne bouge PLUS
            (`attendreDocumentStable`) — c'est le seul signal disponible, l'app
            n'émettant aucun événement « document chargé » ;
         2. APRÈS avoir capturé, SURVEILLER le document : si le nombre de pages
            change encore, recapturer. Sans cette moitié, un document chargé plus
            lentement que le budget d'attente serait figé sur ses premières pages.
       ════════════════════════════════════════════════════════════════════════ */

    /** Nombre de pages du projet — AUTORITÉ (l'app le sait, elle le sérialise). */
    function nombreDePagesProjet() {
        try {
            var p = (typeof window.saveProjectSP_toObject === 'function')
                ? window.saveProjectSP_toObject() : null;
            return (p && Array.isArray(p.pages)) ? p.pages.length : null;
        } catch (_) { return null; }
    }

    /** Nombre de planches exposées — SIGNAL BON MARCHÉ (une longueur de tableau). */
    function nombreDePlanches() {
        try { return getAppCanvases().length; } catch (_) { return null; }
    }

    /**
     * Nombre de pages « vu » par l'aperçu.
     *
     * MESURÉ : le relevé bon marché (longueur du tableau de planches) suffit à
     * détecter l'arrivée du document — au démarrage 1 planche, après import 5 —
     * et il ne coûte rien. `saveProjectSP_toObject()` sérialise TOUT le projet
     * (objets, styles, métadonnées) : on ne l'appelle donc jamais en boucle, il
     * ne sert que d'autorité quand le signal bon marché a bougé.
     */
    function pagesVues(surAutorite) {
        var c = nombreDePlanches();
        if (!surAutorite) return c;
        var p = nombreDePagesProjet();
        if (p == null) return c;
        if (c == null) return p;
        return Math.max(c, p);
    }

    var STABILITE_POLL_MS = 130;      // intervalle entre deux relevés
    var STABILITE_ECHANTILLONS = 3;   // nombre de relevés IDENTIQUES exigés
    var STABILITE_BUDGET_MS = 6000;   // plafond : on ne fait jamais attendre plus

    /**
     * L'app est-elle EN TRAIN de charger un document ?
     *
     * LE SIGNAL, et il est précis : `loadProjectSP` (main.js) encadre tout son
     * travail par `enableHighPerformance()` … puis, 300 ms après, par
     * `disableHighPerformance()` — y compris dans son `catch`. Or cette paire
     * laisse une trace LISIBLE DE L'EXTÉRIEUR : `enableHighPerformance()` met
     * `fabric.Canvas.prototype.renderOnAddRemove = false`, et
     * `disableHighPerformance()` le remet à `true`. Pendant toute la
     * reconstruction du document — et 300 ms après — cette valeur vaut donc
     * `false`. `fabric` étant global, on la lit sans rien modifier.
     *
     * MESURÉ par `_dev/scripts/_sonde_signaux.cjs` (document de 5 pages importé
     * par le studio) — c'est la chronologie exacte de l'import :
     *     854 ms   la clé `sp213_import_sp` disparaît (import accepté, voir plus bas)
     *     1560 ms  `renderOnAddRemove` PASSE À FALSE, `pages[]` 1 → 5
     *     1695 ms  les planches finissent de charger
     *     1816 ms  `renderOnAddRemove` revient à true (+300 ms après la fin)
     * La fenêtre `false` couvre donc bien tout le remplacement du document.
     *
     * ⚠️ MODE DE DÉFAILLANCE, dit franchement : si un futur appel à
     * `enableHighPerformance()` oubliait son `disableHighPerformance()`, ce
     * signal resterait « occupé » et l'aperçu attendrait son plafond
     * (`STABILITE_BUDGET_MS`, 6 s) avant de capturer. C'est borné, jamais infini,
     * et les 5 sites actuels (vérifiés un par un) sont tous appairés — y compris
     * le `catch` de `loadProjectSP`.
     */
    function chargementDeDocument() {
        try {
            return !!(window.fabric && window.fabric.Canvas
                && window.fabric.Canvas.prototype
                && window.fabric.Canvas.prototype.renderOnAddRemove === false);
        } catch (_) { return false; }
    }

    /* ════════════════════════════════════════════════════════════════════════
       L'ANNONCE D'UN DOCUMENT INITIAL — petite machine à états.

       Un import venu du studio traverse TROIS temps, et il faut les trois pour
       ne jamais capturer le document par défaut :

         1. ANNONCÉ   — la clé `sp213_import_sp` est là. Le studio a déposé un
                        projet ; l'app ne l'a pas encore pris. Rien à capturer.
         2. EN ROUTE  — la clé a DISPARU. Et c'est une information FORTE, pas une
                        devinette : `_spLoadStudioImport` (main.js) valide le
                        projet, et ne retire la clé QUE si la validation réussit,
                        immédiatement AVANT le `setTimeout(…, 600)` qui appelle
                        `loadProjectSP`. Retrait ⇒ un document arrive, sous 600 ms.
                        MESURÉ : clé retirée à 854 ms, `loadProjectSP` à 1560 ms.
         3. LIVRÉ     — la fenêtre de chargement a été observée
                        (`renderOnAddRemove === false`) : le document est là.
       ════════════════════════════════════════════════════════════════════════ */

    /* Délai après lequel une annonce NON PRISE est considérée comme refusée.
       Justifié par le code, pas deviné : `_spLoadStudioImport` est appelé à
       `sp:initReady` + 400 ms (main.js) ; s'il refuse le projet — clé invalide —
       il GARDE la clé « pour récupération ». Passé ce délai, attendre ne sert
       donc plus à rien. 700 ms = les 400 ms + une marge d'ordonnancement.
       MESURÉ dans le cas normal : le retrait a lieu à 854 ms, soit pendant. */
    var ANNONCE_REFUS_MS = 700;

    var annonce = { vu: false, remise: false, chargeVu: false, refusee: false, tInit: 0 };

    /** L'heure de `sp:initReady`, ou `null` s'il n'a pas encore eu lieu. */
    function heureInitReady() {
        try {
            if (window._spInitReadyDone && !annonce.tInit) {
                annonce.tInit = performance.now ? performance.now() : Date.now();
            }
            return annonce.tInit || null;
        } catch (_) { return null; }
    }

    /**
     * Pourquoi faut-il encore attendre ? `null` = on peut capturer.
     * @returns {string|null}
     */
    function raisonDattente() {
        var q = null;
        try { q = new URLSearchParams(window.location.search); } catch (_) { q = null; }
        if (q && q.get('from') === 'sp213') {
            var presente = false;
            try { presente = !!localStorage.getItem('sp213_import_sp'); } catch (_) {}
            if (presente) {
                annonce.vu = true;
                /* On n'attend que si l'import n'a pas DÉJÀ été tenté et refusé. */
                var t = heureInitReady();
                var maintenant = performance.now ? performance.now() : Date.now();
                if (t == null || (maintenant - t) <= ANNONCE_REFUS_MS) {
                    return 'document annoncé par le studio (pas encore pris)';
                }
                if (!annonce.refusee) {
                    annonce.refusee = true;
                    console.log('[SP-3D] annonce non prise après ' + ANNONCE_REFUS_MS +
                        ' ms suivant sp:initReady — l’import a été refusé, on n’attend plus');
                }
            } else if (annonce.vu && !annonce.remise) {
                annonce.remise = true;
                console.log('[SP-3D] import accepté : un document est en route');
            }
        }
        if (chargementDeDocument()) { annonce.chargeVu = true; return 'chargement du document en cours'; }
        if (annonce.remise && !annonce.chargeVu) return 'document annoncé mais pas encore livré';
        return null;
    }

    /**
     * Attend que le document ne bouge plus, puis rappelle `cb(nbPages)`.
     *
     * « Stable » veut dire TOUTES ces choses à la fois :
     *   · aucune planche en chargement (`spPlanchesEnChargementPourExport`) ;
     *   · aucune attente d'annonce (`raisonDattente`) ;
     *   · le nombre de planches est le MÊME sur `STABILITE_ECHANTILLONS` relevés.
     * Trois relevés à 130 ms font ~390 ms dans le cas normal (document déjà
     * chargé) — c'est le prix, et il est modeste : le voile de chargement est déjà
     * affiché pendant ce temps.
     *
     * Plafond : `STABILITE_BUDGET_MS` (6 s). Après, on capture ce qu'il y a — la
     * veille corrigera si le document arrive plus tard. On ne bloque donc JAMAIS
     * l'aperçu indéfiniment.
     */
    function attendreDocumentStable(cb) {
        var t0 = performance.now ? performance.now() : Date.now();
        var dernier = null;
        var stables = 0;
        var dit = null;
        var pas = function () {
            if (!open) { cb(dernier); return; }
            var n = nombreDePlanches();
            var raisons = [];
            try {
                if ((typeof window.spPlanchesEnChargementPourExport === 'function')
                    && window.spPlanchesEnChargementPourExport() === true) raisons.push('planches en chargement');
            } catch (_) {}
            var r = raisonDattente();
            if (r) raisons.push(r);
            var maintenant = performance.now ? performance.now() : Date.now();
            if (n != null && n === dernier && !raisons.length) stables += 1;
            else stables = 0;
            var resume = raisons.join(' | ');
            if (resume !== dit) {
                dit = resume;
                if (resume) console.log('[SP-3D] attente avant capture — ' + resume);
            }
            dernier = n;
            if (stables >= STABILITE_ECHANTILLONS) { cb(pagesVues(true)); return; }
            if ((maintenant - t0) > STABILITE_BUDGET_MS) {
                if (resume) console.log('[SP-3D] plafond d’attente (' + STABILITE_BUDGET_MS + ' ms) atteint sur « ' + resume + ' » — capture quand même');
                cb(pagesVues(true));
                return;
            }
            setTimeout(pas, STABILITE_POLL_MS);
        };
        pas();
    }

    // Rend une planche en PNG (page entière, sans repères ni pasteboard).
    // Reproduit la logique « export » de l'app pour rester fidèle au rendu.
    // ⚠️ On renvoie AUSSI une entrée vide ('') pour une page qui échoue, afin
    //    de garder l'alignement page ↔ texture (sinon la couverture se décale).
    // Chaque page mémorise de quoi la RE-CAPTURER (canvas + découpe) : ainsi une
    // page blanche (souvent la couverture) peut être retentée sans tout refaire.
    var capPlan = [];
    function capturePages() {
        var cvs = getAppCanvases();
        var pages = [];
        capPlan = [];
        // Qualité adaptative : on baisse la définition sur les gros documents
        // pour garder une capture fluide (opération synchrone).
        var mult = cvs.length > 10 ? 1 : TEX_MULT;
        cvs.forEach(function (c) {
            if (!c || typeof c.toDataURL !== 'function' || typeof c.getObjects !== 'function') { pages.push(''); capPlan.push(null); return; }
            var bi = c.bleedInfo || {};
            var px = bi.pasteboardPx || 0;
            var vy = bi.pasteboardVPx || 0;
            var cw = bi.pageCanvasWidth || c.getWidth();
            var ch = bi.pageCanvasHeight || c.getHeight();
            var hidden = [];
            var plan = function (left, width) { return { canvas: c, left: left, top: vy, width: width, height: ch, mult: mult }; };
            var shot = function (left, width) {
                // Deux tentatives : une capture peut revenir vide si la planche
                // n'était pas encore peinte (→ sinon une page, dont la couverture,
                // disparaît dans l'aperçu).
                for (var k = 0; k < 2; k++) {
                    try {
                        var url = c.toDataURL({ format: 'png', multiplier: mult, left: left, top: vy, width: width, height: ch });
                        if (url && url.length > 64) return url;
                    } catch (e) {
                        if (k === 1) console.warn('[SP-3D] capture planche :', e);
                    }
                    try { c.renderAll(); } catch (_) {}
                }
                return '';
            };
            /**
             * Ajoute UNE page (image + plan de recapture) — et, si son papier est
             * un CALQUE, sa couche « ENCRE SEULE ».
             *
             * ⚠️ POURQUOI DEUX CAPTURES, ET POURQUOI SEULEMENT POUR LES CALQUES.
             * MESURÉ : l'image de page est BLANCHE OPAQUE (255/255/255/255 aux
             * quatre coins) — l'encre et le support y sont les MÊMES pixels. On ne
             * peut donc pas rendre la feuille translucide sans délaver
             * l'impression. Mais avec `backgroundColor = null` le coin de page
             * devient rgba(0,0,0,0) alors que l'objet GARDE ses valeurs : une
             * couche « encre seule », transparente là où rien n'est imprimé,
             * existe donc bel et bien. Elle n'est capturée que pour les pages qui
             * en ont besoin — une capture double coûte cher, et un document sans
             * calque ne doit rien payer.
             */
            var ajouter = function (left, width) {
                var iPage = pages.length;                  // l'index de page EST la longueur
                var url = shot(left, width);
                var pl = plan(left, width);
                pages.push(url);
                capPlan.push(pl);
                var papier = papierDeLaPage(iPage);
                if (papier && (papier.calque || papier.transparent)) {
                    var fond = c.backgroundColor, encre = '';
                    try {
                        c.backgroundColor = null;
                        c.renderAll();
                        encre = shot(left, width);
                    } catch (e2) {
                        console.warn('[SP-3D] capture encre :', e2);
                    } finally {
                        try { c.backgroundColor = fond; c.renderAll(); } catch (_) {}
                    }
                    pl.encre = encre;
                }
                return pl;
            };
            try {
                c.getObjects().forEach(function (o) {
                    if (!o) return;
                    var isMark = o.isMargin || o.isBleed || o.isGuide || o.isManualGuide
                        || o.isTrimBox || o.excludeFromExport
                        || o._isChainBadge || o._isLinkArrow || o._isOverflowIndicator;
                    if (isMark && o.visible !== false) { hidden.push(o); o.visible = false; }
                });
                if (bi.isSpread) {
                    var hw = cw / 2;
                    ajouter(px, hw);
                    ajouter(px + hw, hw);
                } else {
                    ajouter(px, cw);
                }
            } catch (e) {
                console.warn('[SP-3D] capture planche :', e);
                if (bi.isSpread) {
                    pages.push(''); pages.push('');
                    capPlan.push(plan(px, cw / 2)); capPlan.push(plan(px + cw / 2, cw / 2));
                } else {
                    pages.push('');
                    capPlan.push(plan(px, cw));
                }
            } finally {
                hidden.forEach(function (o) { try { o.visible = true; } catch (_) {} });
                try { c.requestRenderAll(); } catch (_) {}
            }
        });
        return pages;
    }

    // Re-capture UNE page (par index) — utilisé si sa texture n'a pas pu être
    // chargée/peinte. Renvoie une texture three.js ou null.
    function recapturePage(index) {
        var plan = capPlan[index];
        if (!plan || !plan.canvas) return Promise.resolve(null);
        try { plan.canvas.renderAll(); } catch (_) {}
        var url = '';
        try {
            // ⚠️ Le plan mémorise `top` et `height` (et non `vy` / `ch`) : les
            //    LIRE SOUS LEUR VRAI NOM. Avant, `plan.vy` / `plan.ch` valaient
            //    `undefined` → la page re-capturée (souvent la COUVERTURE, la
            //    première planche) était recadrée sans son décalage de pasteboard
            //    et prenait toute la hauteur : elle apparaissait décalée ou vide,
            //    comme « perdue » dans l'aperçu 3D.
            url = plan.canvas.toDataURL({ format: 'png', multiplier: plan.mult, left: plan.left, top: plan.top, width: plan.width, height: plan.height });
        } catch (e) { console.warn('[SP-3D] recapture :', e); }
        if (!url || url.length <= 64) return Promise.resolve(null);
        return loadTextures([url]).then(function (a) { return a[0] || null; });
    }

    /* ------------------------------------------------------- Textures « papier » */
    // ⚠️ PAPIER PUR BLANC : le dos des pages et le papier doivent rester BLANCS
    //    (un magazine imprimé n'a pas de papier gris). Grain très léger seulement.
    function makePaperTexture() {
        var cv = document.createElement('canvas');
        cv.width = 256; cv.height = 362;
        var ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
        var img = ctx.getImageData(0, 0, cv.width, cv.height);
        var d = img.data;
        for (var i = 0; i < d.length; i += 4) {
            var n = (Math.random() * 5) | 0;      // grain à peine perceptible
            d[i] -= n; d[i + 1] -= n; d[i + 2] -= n;
        }
        ctx.putImageData(img, 0, 0);
        var t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    }

    // Ombre de PLI : dégradé sombre côté reliure → transparent vers l'extérieur.
    // `darkAtLeft` = le bord SOMBRE (reliure) est à GAUCHE de la texture.
    //   • feuille GAUCHE (leafL) : reliure à droite → darkAtLeft = false ;
    //   • feuille DROITE (leafR) : reliure à gauche → darkAtLeft = true.
    // Le profil est FORT au pli, décroît vite puis garde un replat à 0 (aucune arête
    // visible en bout de plan). Petit canvas : c'est un simple dégradé 1D.
    //
    // ⚠️ NEUF ARRÊTS, et c'est la qualité qui l'exige : à cinq arrêts, un dégradé de
    //    256 px sur une largeur de 0,22·pageW laissait voir des BANDES (le dégradé
    //    était interpolé linéairement entre des points trop espacés). Le profil
    //    couvre maintenant la décroissance en huit segments, ce qui la rend lisse —
    //    et c'est cette ombre-là qui tombe SUR LE DOCUMENT, le long de la reliure.
    function makeFoldTexture(darkAtLeft) {
        var w = 256, h = 8;
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        var ctx = cv.getContext('2d');
        var g = ctx.createLinearGradient(0, 0, w, 0);
        // [position le long de la feuille, alpha] — position 0 = côté reliure.
        var stops = [
            [0.00, 0.72], [0.06, 0.62], [0.14, 0.48], [0.24, 0.32], [0.34, 0.18],
            [0.46, 0.08], [0.58, 0.02], [0.68, 0.00], [1.00, 0.00]
        ].map(function (s) {
            return { o: darkAtLeft ? s[0] : (1 - s[0]), a: s[1] };
        }).sort(function (x, y) { return x.o - y.o; });
        stops.forEach(function (s) { g.addColorStop(s.o, 'rgba(0,0,0,' + s.a + ')'); });
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        var t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        return t;
    }

    function makeGradientTexture(stops, w, h, radial) {
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        var ctx = cv.getContext('2d');
        var g;
        if (radial) {
            g = ctx.createRadialGradient(w / 2, h * 0.42, 10, w / 2, h * 0.42, Math.max(w, h) * 0.75);
        } else {
            g = ctx.createLinearGradient(0, 0, 0, h);
        }
        stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        var t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    }

    // Fond de scène : dégradé, ou « cadrillage » (clinique / mathématique).
    function makeSceneBackground(T, mode) {
        var w = 1024, h = 1024;
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        var ctx = cv.getContext('2d');
        var g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, T.bgBase[0]);
        g.addColorStop(0.5, T.bgBase[1]);
        g.addColorStop(1, T.bgBase[2]);
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        if (mode === 'grid') {
            ctx.lineWidth = 1;
            ctx.strokeStyle = T.gridLine;
            for (var x = 0; x <= w; x += T.gridStep) { ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, h); ctx.stroke(); }
            for (var y = 0; y <= h; y += T.gridStep) { ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(w, y + .5); ctx.stroke(); }
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = T.gridMajor;
            for (var x2 = 0; x2 <= w; x2 += T.gridMajorStep) { ctx.beginPath(); ctx.moveTo(x2 + .5, 0); ctx.lineTo(x2 + .5, h); ctx.stroke(); }
            for (var y2 = 0; y2 <= h; y2 += T.gridMajorStep) { ctx.beginPath(); ctx.moveTo(0, y2 + .5); ctx.lineTo(w, y2 + .5); ctx.stroke(); }
        }
        var t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    }

    // Ombre portée douce au sol (radial sombre, transparent).
    /* ════════════════════════════════════════════════════════════════════════
       _SP3D_OMBRE_713 — L'OMBRE DE CONTACT, ENFIN CONSTRUITE.

       DÉFAUT SIGNALÉ : « l'ombre n'est pas encore au niveau dans la preview 3d ».

       CE QUI EXISTAIT, et c'est tout : le DÉGRADÉ DE PLIURE (le long de la
       reliure), dessiné par `makeFoldTexture` et appliqué par `foldMats`. C'est
       une ombre de gouttière, pas une ombre. Le reste de l'infrastructure était
       là mais DORMANT :
         · `makeContactShadowTexture()`  — écrite, JAMAIS appelée ;
         · `updateContactShadowSize()`   — appelée, mais sortait aussitôt
                                           (`if (!contactShadow) return`) ;
         · `contactShadowMat.opacity`    — réglé par le thème, sur un matériau nul ;
         · `tick()` : `contactShadow.position.x = bookGroup.position.x` — du code
                                           mort qui attendait ce maillage ;
         · `close()`                     — libérait `contactShadowTex` (jamais créée).
       Autrement dit la scène portait les branchements d'une ombre absente. On la
       construit, au lieu d'en écrire une seconde.

       ELLE EST AU SOL, et ce n'est pas un choix esthétique gratuit : la scène
       place le livre à `y = PAGE_H/2 + 0,06`, c'est-à-dire DÉTACHÉ de 6 cm
       au-dessus de `y = 0`, avec un léger flottement (`Math.sin(t*0.7)*0,014`).
       Un objet qui flotte au-dessus d'une surface projette une ombre SOUS lui :
       c'est ce que `updateContactShadowSize` dimensionnait déjà
       (`largeur du livre + marge` × `profondeur`), et c'est ce qui manquait pour
       qu'il ne se lise pas comme une image collée sur le fond.

       LA TEXTURE EST UNE SILHOUETTE, PAS UN ROND. Un livre ouvert est un
       rectangle : un dégradé radial posé dessous se lit comme une tache. On
       dessine donc un rectangle aux bords très adoucis, et on le DENSIFIE VERS
       LE BAS, parce que la lumière clé vient du haut (`keyLight` à y = 8,5).
       ════════════════════════════════════════════════════════════════════════ */
    function makeContactShadowTexture() {
        var s = 256;
        var cv = document.createElement('canvas');
        cv.width = s; cv.height = s;
        var ctx = cv.getContext('2d');
        /* Adoucissement par ACCUMULATION : on empile des ELLIPSES concentriques
           de plus en plus grandes et de plus en plus faibles. Là où elles se
           recouvrent (le cœur) l'opacité s'accumule, vers le bord elle décroît —
           même résultat qu'un flou, sans dépendre du support de `ctx.filter`.

           ⚠️ PREMIER JET, ET SON DÉFAUT MESURÉ : le rayon variait de 0 à 22 % du
           canevas seulement. Le « cœur » couvrait donc presque tout le rectangle
           et le dégradé n'occupait qu'un mince liseré → à 140 % de réglage
           l'ombre se lisait comme une PLAQUE NOIRE, pas comme une ombre (44 % des
           pixels de la bande basse changeaient, écart moyen 39/765). Le rayon
           couvre maintenant TOUT le canevas (`k` de 1 à 0), le dégradé occupe
           donc toute l'étendue, et le pic est plus bas. */
        /* ⚠️ DEUX COUCHES, parce qu'une ombre de contact n'est pas un dégradé
           régulier : elle a un CŒUR dense (là où le livre touche le sol) et une
           PÉNOMBRE large qui s'éteint loin de lui. Un seul empilement à pas constant
           donne une tache plate — mesuré au premier jet : l'ombre ne se lisait pas
           comme une occlusion, mais comme un aplat gris.
             · PÉNOMBRE : 26 passes, rayon de 1,00 à 0,55 du canevas, 0,016/passe ;
             · CŒUR     : 18 passes, rayon de 0,72 à 0,04,             0,045/passe.
           Au centre : ≈ 0,34 (pénombre) puis ≈ 0,71 avec le cœur. Le bord visible
           — qui est la partie faible, le cœur étant caché par le livre — reste donc
           franchement plus dense qu'avant, ce qui est exactement le défaut corrigé
           ci-dessus (5,2 niveaux sur 255, invisible à l'œil). */
        ctx.globalAlpha = 1;
        var penombre = 26, pasP = 1 / penombre;
        for (var i = penombre; i >= 1; i--) {
            var kp = 0.55 + 0.45 * (i * pasP);        // 1,00 → 0,55
            ctx.globalAlpha = 0.016;
            ctx.beginPath();
            ctx.ellipse(s / 2, s / 2, (s / 2) * kp, (s / 2) * kp, 0, 0, Math.PI * 2);
            ctx.fillStyle = '#000000';
            ctx.fill();
        }
        var coeur = 18, pasC = 1 / coeur;
        for (var j = coeur; j >= 1; j--) {
            var kc = 0.72 * (j * pasC);               // 0,72 → 0,04
            ctx.globalAlpha = 0.045;
            /* Léger décalage vers le BAS : la lumière clé vient du haut
               (`keyLight` à y = 8,5), la densité se déplace donc vers le bas. */
            var cyc = s / 2 + (1 - (j * pasC)) * s * 0.035;
            ctx.beginPath();
            ctx.ellipse(s / 2, cyc, (s / 2) * kc, (s / 2) * kc, 0, 0, Math.PI * 2);
            ctx.fillStyle = '#000000';
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        var t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    }

    /** Construit l'ombre de contact et l'ajoute à la scène. Idempotent. */
    function creerLOmbreDeContact() {
        if (contactShadow) return contactShadow;
        var T = THEMES[theme] || THEMES.dark;
        contactShadowTex = makeContactShadowTexture();
        contactShadowMat = new THREE.MeshBasicMaterial({
            map: contactShadowTex,
            transparent: true,
            depthWrite: false,               // une ombre ne masque rien
            opacity: (T.shadow != null ? T.shadow : 0.4),
        });
        contactShadowMat.toneMapped = false; // une ombre reste noire, quel que soit le thème
        contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), contactShadowMat);
        contactShadow.rotation.x = -Math.PI / 2;   // posée au sol
        /* 0,002 au-dessus du sol : assez pour ne pas lutter avec le fond
           (z-fighting), assez peu pour rester collée à la surface. */
        contactShadow.position.y = 0.002;
        contactShadow.renderOrder = -1;
        // Elle est ajoutée à la SCÈNE, pas au livre : `tick()` recopie la position
        // horizontale du livre dessus. Dans le groupe, elle suivrait aussi son
        // inclinaison (rotation.y du groupe à l'ouverture) — un sol ne s'incline pas.
        scene.add(contactShadow);
        updateContactShadowSize();
        return contactShadow;
    }

    /* ------------------------------------------------------------------ UI */
    function injectStyle() {
        if (document.getElementById('sp3d-style')) return;
        var st = document.createElement('style');
        st.id = 'sp3d-style';
        st.textContent = [
            '.sp3d-overlay{position:fixed;inset:0;z-index:2147483000;opacity:0;',
            'transition:opacity .32s ease;font-family:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;',
            '-webkit-user-select:none;user-select:none;overflow:hidden;',
            '--sp3d-fg:#1a1a1a;--sp3d-bg:#eef0f5;--sp3d-btn-bg:rgba(0,0,0,.04);--sp3d-btn-bd:rgba(0,0,0,.14);',
            '--sp3d-btn-hbg:rgba(0,0,0,.09);--sp3d-btn-hbd:rgba(0,0,0,.28);--sp3d-spin:#0d9488;',
            '--sp3d-panel-bg:rgba(255,255,255,.92);color:var(--sp3d-fg);}',
            '.sp3d-overlay.sp3d-dark{--sp3d-fg:#f2f2f4;--sp3d-bg:#0b0c10;--sp3d-btn-bg:rgba(255,255,255,.06);',
            '--sp3d-btn-bd:rgba(255,255,255,.16);--sp3d-btn-hbg:rgba(255,255,255,.14);--sp3d-btn-hbd:rgba(255,255,255,.32);--sp3d-spin:#5eead4;',
            '--sp3d-panel-bg:rgba(16,18,24,.86);}',
            '.sp3d-overlay.sp3d-visible{opacity:1;}',
            '.sp3d-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab;}',
            '.sp3d-canvas.sp3d-grab{cursor:grabbing;}',
            '.sp3d-top{position:absolute;top:0;left:0;right:0;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 18px;pointer-events:none;}',
            '.sp3d-brand{display:flex;flex-direction:column;gap:3px;}',
            '.sp3d-brand b{font-size:12px;letter-spacing:2.4px;font-weight:700;opacity:.95;}',
            '.sp3d-brand span{font-size:10px;letter-spacing:1px;opacity:.5;}',
            '.sp3d-count{font-size:11px;letter-spacing:1.4px;opacity:.72;padding-top:3px;white-space:nowrap;}',
            '.sp3d-actions{display:flex;gap:8px;pointer-events:none;}',
            '.sp3d-btn{pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;gap:8px;',
            'height:38px;min-width:38px;padding:0 14px;border-radius:9px;border:1px solid var(--sp3d-btn-bd);',
            'background:var(--sp3d-btn-bg);color:var(--sp3d-fg);font-family:inherit;font-size:11px;font-weight:700;',
            'letter-spacing:1.4px;cursor:pointer;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);',
            'transition:background .18s ease,border-color .18s ease,transform .12s ease;}',
            '.sp3d-btn:hover{background:var(--sp3d-btn-hbg);border-color:var(--sp3d-btn-hbd);}',
            '.sp3d-btn:active{transform:scale(.95);}',
            '.sp3d-btn[disabled]{opacity:.32;cursor:default;transform:none;}',
            '.sp3d-icon{padding:0;width:38px;}',
            '.sp3d-bottom{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;gap:10px;padding:18px;pointer-events:none;}',
            '.sp3d-nav{display:flex;align-items:center;gap:10px;pointer-events:auto;}',
            '.sp3d-help{font-size:10px;letter-spacing:.8px;opacity:.5;text-align:center;max-width:660px;line-height:1.6;}',
            '.sp3d-load{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:var(--sp3d-bg);transition:opacity .3s ease;}',
            '.sp3d-spin{width:34px;height:34px;border-radius:50%;border:2px solid var(--sp3d-btn-bd);border-top-color:var(--sp3d-spin);animation:sp3dspin .8s linear infinite;}',
            '@keyframes sp3dspin{to{transform:rotate(360deg);}}',
            '.sp3d-load p{font-size:11px;letter-spacing:2px;opacity:.7;margin:0;}',
            '.sp3d-rec{color:#ff4d4d !important;border-color:rgba(255,77,77,.6) !important;animation:sp3drec 1s ease-in-out infinite;}',
            '@keyframes sp3drec{50%{opacity:.4;}}',
            /* ── Panneau de réglages ── */
            '.sp3d-panel{position:absolute;top:62px;right:18px;box-sizing:border-box;',
            'width:min(284px,calc(100vw - 36px));max-height:calc(100vh - 190px);',
            'overflow-y:auto;overflow-x:hidden;scrollbar-gutter:stable;overscroll-behavior:contain;',
            'pointer-events:auto;padding:14px;border-radius:12px;border:1px solid var(--sp3d-btn-bd);',
            'background:var(--sp3d-panel-bg);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);',
            'box-shadow:0 18px 48px rgba(0,0,0,.28);display:none;color:var(--sp3d-fg);}',
            '.sp3d-panel *,.sp3d-panel *::before,.sp3d-panel *::after{box-sizing:border-box;}',
            '.sp3d-panel::-webkit-scrollbar{width:8px;height:0;}',
            '.sp3d-panel::-webkit-scrollbar-track{background:transparent;}',
            '.sp3d-panel::-webkit-scrollbar-thumb{background:var(--sp3d-btn-bd);border-radius:4px;}',
            '.sp3d-panel::-webkit-scrollbar-thumb:hover{background:var(--sp3d-btn-hbd);}',
            '.sp3d-panel.sp3d-on{display:block;}',
            '.sp3d-panel h4{margin:0 0 10px;font-size:10px;letter-spacing:1.8px;font-weight:700;opacity:.6;text-transform:uppercase;}',
            '.sp3d-panel h4:not(:first-child){margin-top:16px;}',
            '.sp3d-row{display:flex;align-items:center;gap:8px;margin:9px 0;font-size:10.5px;letter-spacing:.4px;min-width:0;}',
            '.sp3d-row label{flex:0 0 74px;min-width:0;opacity:.8;}',
            '.sp3d-row input[type=range]{flex:1 1 auto;width:0;min-width:0;-webkit-appearance:none;appearance:none;height:3px;border-radius:2px;',
            'background:var(--sp3d-btn-bd);outline:none;}',
            '.sp3d-row input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;',
            'background:var(--sp3d-fg);cursor:pointer;border:0;}',
            '.sp3d-row input[type=range]::-moz-range-thumb{width:13px;height:13px;border-radius:50%;background:var(--sp3d-fg);cursor:pointer;border:0;}',
            '.sp3d-row .sp3d-val{flex:0 0 40px;text-align:right;opacity:.6;font-variant-numeric:tabular-nums;}',
            '.sp3d-seg{display:flex;gap:6px;margin-top:6px;}',
            '.sp3d-seg button{flex:1 1 0;min-width:0;padding:7px 4px;border-radius:7px;border:1px solid var(--sp3d-btn-bd);',
            'background:var(--sp3d-btn-bg);color:inherit;font:inherit;font-size:9.5px;letter-spacing:.8px;cursor:pointer;',
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '.sp3d-seg button:hover{background:var(--sp3d-btn-hbg);}',
            '.sp3d-seg button.on{background:var(--sp3d-fg);color:var(--sp3d-bg);border-color:var(--sp3d-fg);}',
            '.sp3d-panel .sp3d-note{font-size:9.5px;line-height:1.55;opacity:.5;margin:8px 0 0;}'
        ].join('');
        document.head.appendChild(st);
    }

    var ICON_SLIDERS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><circle cx="9" cy="7" r="2.2" fill="currentColor" stroke="none"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="15" cy="17" r="2.2" fill="currentColor" stroke="none"/></svg>';
    var ICON_REC = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="12" cy="12" r="7.4"/><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/></svg>';

    function buildOverlay() {
        injectStyle();
        overlay = document.createElement('div');
        overlay.className = 'sp3d-overlay ' + THEMES[theme].cls;
        overlay.innerHTML =
            '<canvas class="sp3d-canvas"></canvas>' +
            '<div class="sp3d-top">' +
                '<div class="sp3d-brand"><b>APERÇU 3D</b><span>SUPERPRINT · FEUILLETAGE</span></div>' +
                '<div class="sp3d-count" id="sp3dCount"></div>' +
                '<div class="sp3d-actions">' +
                    '<button class="sp3d-btn sp3d-icon" id="sp3dSettings" title="Réglages de la scène" aria-label="Réglages">' + ICON_SLIDERS + '</button>' +
                    '<button class="sp3d-btn sp3d-icon" id="sp3dRec" title="Enregistrer une vidéo (webm)" aria-label="Enregistrer">' + ICON_REC + '</button>' +
                    '<button class="sp3d-btn sp3d-icon" id="sp3dClose" title="Fermer (Échap)" aria-label="Fermer">' +
                        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>' +
                    '</button>' +
                '</div>' +
            '</div>' +
            '<div class="sp3d-panel" id="sp3dPanel">' +
                '<h4>Caméra</h4>' +
                '<div class="sp3d-row"><label>Rotation</label><input type="range" id="sp3dRot" min="-62" max="62" step="1"><span class="sp3d-val" id="sp3dRotV"></span></div>' +
                '<div class="sp3d-row"><label>Plongée</label><input type="range" id="sp3dTilt" min="0" max="58" step="1"><span class="sp3d-val" id="sp3dTiltV"></span></div>' +
                '<div class="sp3d-row"><label>Zoom</label><input type="range" id="sp3dZoom" min="60" max="220" step="1"><span class="sp3d-val" id="sp3dZoomV"></span></div>' +
                '<div class="sp3d-row"><label>Roulis</label><input type="range" id="sp3dRoll" min="-45" max="45" step="1"><span class="sp3d-val" id="sp3dRollV"></span></div>' +
                '<h4>Double page (reliure)</h4>' +
                '<div class="sp3d-row"><label>Ombre</label><input type="range" id="sp3dGutter" min="0" max="140" step="1"><span class="sp3d-val" id="sp3dGutterV"></span></div>' +
                '<div class="sp3d-row"><label>Volume du pli</label><input type="range" id="sp3dTiltPages" min="0" max="100" step="1"><span class="sp3d-val" id="sp3dTiltPagesV"></span></div>' +
                '<h4>Fond</h4>' +
                '<div class="sp3d-seg" id="sp3dBgSeg">' +
                    '<button data-bg="gradient">Dégradé</button>' +
                    '<button data-bg="grid">Grille</button>' +
                    '<button data-bg="image">Image…</button>' +
                '</div>' +
                '<input type="file" id="sp3dBgFile" accept="image/*" style="display:none">' +
                '<p class="sp3d-note">« Grille » donne un fond clinique (cadrillage). « Image » utilise une photo comme décor de studio.</p>' +
            '</div>' +
            '<div class="sp3d-bottom">' +
                '<div class="sp3d-nav">' +
                    '<button class="sp3d-btn" id="sp3dPrev" title="Page précédente (←)">‹ &nbsp;PRÉC.</button>' +
                    '<button class="sp3d-btn" id="sp3dNext" title="Page suivante (→)">SUIV. &nbsp;›</button>' +
                '</div>' +
                '<div class="sp3d-help">Couverture seule, intérieur en double page, dernière page seule &nbsp;·&nbsp; glissez pour tourner &nbsp;·&nbsp; molette pour zoomer &nbsp;·&nbsp; <b>←</b> <b>→</b> pour feuilleter &nbsp;·&nbsp; <b>Échap</b> pour fermer</div>' +
            '</div>' +
            '<div class="sp3d-load" id="sp3dLoad"><div class="sp3d-spin"></div><p>PRÉPARATION DES PAGES…</p></div>';
        document.body.appendChild(overlay);

        indicatorEl = overlay.querySelector('#sp3dCount');
        prevBtn = overlay.querySelector('#sp3dPrev');
        nextBtn = overlay.querySelector('#sp3dNext');
        settingsBtn = overlay.querySelector('#sp3dSettings');
        recordBtn = overlay.querySelector('#sp3dRec');
        settingsEl = overlay.querySelector('#sp3dPanel');
        canvasEl = overlay.querySelector('.sp3d-canvas');

        overlay.querySelector('#sp3dClose').addEventListener('click', close);
        prevBtn.addEventListener('click', function () { startFlip(-1); });
        nextBtn.addEventListener('click', function () { startFlip(1); });
        if (settingsBtn) settingsBtn.addEventListener('click', toggleSettings);
        if (recordBtn) recordBtn.addEventListener('click', toggleRecording);

        bindSettings();
    }

    // Sliders : rotation, plongée, zoom, roulis, ombre de reliure, volume du pli.
    function bindSettings() {
        settingInputs.rot = settingsEl.querySelector('#sp3dRot');
        settingInputs.tilt = settingsEl.querySelector('#sp3dTilt');
        settingInputs.zoom = settingsEl.querySelector('#sp3dZoom');
        settingInputs.roll = settingsEl.querySelector('#sp3dRoll');
        settingInputs.gutter = settingsEl.querySelector('#sp3dGutter');
        settingInputs.tiltPages = settingsEl.querySelector('#sp3dTiltPages');

        on(settingInputs.rot, function () {
            theta = deg(parseFloat(settingInputs.rot.value));
            bornerTheta();      // _SP3D_ORBITE_716 : jamais derrière le livre
        });
        on(settingInputs.tilt, function () {
            // Plongée : de presque rasant (haut) à la verticale (bas de piste).
            phi = clamp(rad(90 - parseFloat(settingInputs.tilt.value)), PHI_MIN, PHI_MAX);
        });
        on(settingInputs.zoom, function () {
            zoomPct = clamp(parseFloat(settingInputs.zoom.value), 60, 220);
            applyZoom();
        });
        on(settingInputs.roll, function () {
            roll = deg(parseFloat(settingInputs.roll.value));
        });
        on(settingInputs.gutter, function () {
            gutterIntensity = parseFloat(settingInputs.gutter.value) / 100;
            applyGutterOpacity();
        });
        on(settingInputs.tiltPages, function () {
            leafTilt = 0.001 + (parseFloat(settingInputs.tiltPages.value) / 100) * 0.06;
            layoutLeaves();
        });

        // Fond : dégradé / grille / image
        var seg = settingsEl.querySelector('#sp3dBgSeg');
        var file = settingsEl.querySelector('#sp3dBgFile');
        seg.querySelectorAll('button').forEach(function (b) {
            b.addEventListener('click', function () { setBgMode(b.getAttribute('data-bg'), file); });
        });
        file.addEventListener('change', function (e) {
            var f = e.target.files && e.target.files[0];
            if (!f) return;
            var url = URL.createObjectURL(f);
            var loader = new THREE.TextureLoader();
            loader.load(url, function (t) {
                t.colorSpace = THREE.SRGBColorSpace;
                if (bgImageTex && bgImageTex.dispose) bgImageTex.dispose();
                bgImageTex = t;
                bgMode = 'image';
                applyBackground();
                syncBgSeg();
                URL.revokeObjectURL(url);
            }, undefined, function () { toast('Aperçu 3D : image de fond illisible.'); });
            e.target.value = '';
        });
    }

    // Branche un slider : applique la valeur, puis rafraîchit les étiquettes.
    function on(el, fn) {
        if (!el) return;
        el.addEventListener('input', function () { fn(); syncSettings(); });
    }
    function deg(d) { return d * Math.PI / 180; }
    function rad(r) { return r * Math.PI / 180; }

    function toggleSettings() {
        settingsOpen = !settingsOpen;
        if (settingsEl) settingsEl.classList.toggle('sp3d-on', settingsOpen);
        syncSettings();
    }

    // Recale les sliders sur l'état réel (utile après une rotation à la souris).
    function syncSettings() {
        if (!settingsEl) return;
        var set = function (key, val, txt) {
            var el = settingInputs[key]; if (!el) return;
            el.value = val;
            var v = settingsEl.querySelector('#' + el.id + 'V');
            if (v) v.textContent = txt;
        };
        var tDeg = ((theta * 180 / Math.PI) % 360 + 540) % 360 - 180;
        set('rot', Math.round(tDeg), Math.round(tDeg) + '°');
        set('tilt', Math.round(90 - phi * 180 / Math.PI), Math.round(90 - phi * 180 / Math.PI) + '°');
        set('zoom', Math.round(zoomPct), Math.round(zoomPct) + '%');
        set('roll', Math.round(roll * 180 / Math.PI), Math.round(roll * 180 / Math.PI) + '°');
        set('gutter', Math.round(gutterIntensity * 100), Math.round(gutterIntensity * 100) + '%');
        set('tiltPages', Math.round((leafTilt - 0.001) / 0.06 * 100), Math.round((leafTilt - 0.001) / 0.06 * 100) + '%');
        syncBgSeg();
    }

    function setBgMode(mode, fileInput) {
        if (mode === 'image') {
            if (bgImageTex) { bgMode = 'image'; applyBackground(); syncBgSeg(); }
            else if (fileInput) fileInput.click();
            return;
        }
        bgMode = mode;
        applyBackground();
        syncBgSeg();
    }

    function syncBgSeg() {
        if (!settingsEl) return;
        var seg = settingsEl.querySelector('#sp3dBgSeg');
        seg.querySelectorAll('button').forEach(function (b) {
            b.classList.toggle('on', b.getAttribute('data-bg') === bgMode);
        });
    }

    /* ── Enregistrement vidéo (webm) via MediaRecorder ── */
    function toggleRecording() {
        if (recording) stopRecording();
        else startRecording();
    }

    function startRecording() {
        if (!canvasEl || !canvasEl.captureStream || typeof MediaRecorder === 'undefined') {
            toast('Aperçu 3D : enregistrement vidéo non pris en charge par ce navigateur.');
            return;
        }
        try {
            var stream = canvasEl.captureStream(30);
            var types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
            var mime = '';
            for (var i = 0; i < types.length; i++) {
                if (window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(types[i])) { mime = types[i]; break; }
            }
            recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
            recChunks = [];
            recorder.ondataavailable = function (e) { if (e.data && e.data.size) recChunks.push(e.data); };
            recorder.onstop = function () {
                try {
                    var blob = new Blob(recChunks, { type: 'video/webm' });
                    var url = URL.createObjectURL(blob);
                    var a = document.createElement('a');
                    var d = new Date();
                    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
                    a.href = url;
                    a.download = 'superprint-3d-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
                        pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.webm';
                    document.body.appendChild(a); a.click(); a.remove();
                    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
                    toast('Vidéo enregistrée (webm).');
                } catch (_) {}
                recChunks = [];
            };
            recorder.start(200);
            recording = true;
            if (recordBtn) { recordBtn.classList.add('sp3d-rec'); recordBtn.title = 'Arrêter et télécharger la vidéo'; }
        } catch (e) {
            console.warn('[SP-3D] enregistrement :', e);
            toast('Aperçu 3D : impossible de démarrer l\'enregistrement.');
        }
    }

    function stopRecording() {
        try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (_) {}
        recorder = null; recording = false;
        if (recordBtn) { recordBtn.classList.remove('sp3d-rec'); recordBtn.title = 'Enregistrer une vidéo (webm)'; }
    }

    // Applique le thème courant à la scène 3D (fond, sol, lumières, exposition).
    // ⚠️ Thème SOMBRE uniquement dans l'aperçu 3D (plus de bascule clair/sombre).
    function applyTheme() {
        var T = THEMES[theme];
        if (!T || !scene) return;
        try {
            applyBackground();
            scene.fog = new THREE.Fog(T.fogColor, T.fogNear, T.fogFar);
            if (floorTex && floorTex.dispose) floorTex.dispose();
            floorTex = makeGradientTexture(T.floor, 512, 512, true);
            if (floorMat) { floorMat.map = floorTex; floorMat.needsUpdate = true; }
            if (hemiLight) { hemiLight.color.setHex(T.hemiSky); hemiLight.groundColor.setHex(T.hemiGround); hemiLight.intensity = T.hemiI; }
            if (keyLight) { keyLight.color.setHex(T.keyColor); keyLight.intensity = T.keyI; }
            if (fillLight) { fillLight.color.setHex(T.fillColor); fillLight.intensity = T.fillI; }
            if (rimLight) { rimLight.color.setHex(T.rimColor); rimLight.intensity = T.rimI; }
            if (renderer) renderer.toneMappingExposure = T.exposure;
            /* _SP3D_OMBRE_713 — l'opacité de l'ombre de contact n'est plus posée
               ici en dur : elle dépend aussi du réglage « Ombre ». Un seul point
               de vérité, `appliquerLOpacityDeLOmbre()`, sinon le thème écraserait
               le réglage de l'utilisateur à chaque changement de thème. */
            appliquerLOpacityDeLOmbre();
            applyGutterOpacity();
        } catch (e) { console.warn('[SP-3D] thème :', e); }
    }

    // Fond de scène selon le mode (dégradé / grille / image).
    function applyBackground() {
        if (!scene) return;
        var T = THEMES[theme];
        if (bgMode === 'image' && bgImageTex) {
            scene.background = bgImageTex;
            return;
        }
        if (bgTex && bgTex.dispose) bgTex.dispose();
        bgTex = makeSceneBackground(T, bgMode === 'grid' ? 'grid' : 'gradient');
        scene.background = bgTex;
    }

    function applyGutterOpacity() {
        var T = THEMES[theme];
        var base = (T && T.gutter != null) ? T.gutter : 0.6;
        // Le réglage « Ombre » va de 0 % (aucune) à 140 % (très marquée) ;
        // le dégradé de la texture s'occupe de l'intensité pli → extérieur.
        var op = clamp(base * gutterIntensity * foldScale, 0, 1);
        for (var i = 0; i < foldMats.length; i++) foldMats[i].opacity = op;
        // _SP3D_OMBRE_713 — le même réglage commande aussi l'ombre de contact.
        appliquerLOpacityDeLOmbre();
    }

    function setIndicator() {
        if (!indicatorEl) return;
        var v = views[spread] || { l: -1, r: -1 };
        var parts = [];
        if (v.l >= 0) parts.push(v.l + 1);
        if (v.r >= 0) parts.push(v.r + 1);
        var label = parts.length ? ('PAGE' + (parts.length > 1 ? 'S ' : ' ') + parts.join('\u2013')) : '\u2014';
        indicatorEl.textContent = label + ' / ' + N;
        if (prevBtn) prevBtn.disabled = !(spread > 0);
        if (nextBtn) nextBtn.disabled = !(spread < views.length - 1);
    }

    /* --------------------------------------------------------------- Scène 3D */
    function buildScene() {
        renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        // ⚠️ Pas de sol : le livre flotte sur un fond (dégradé ou cadrillage).
        //    Les ombres projetées n'ont plus de receveur → on les désactive.
        renderer.shadowMap.enabled = false;

        scene = new THREE.Scene();

        camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
        target = new THREE.Vector3(0, PAGE_H * 0.5, 0);

        // Lumières (intensités/couleurs selon le thème)
        hemiLight = new THREE.HemisphereLight(0xffffff, 0xcfd3dc, 0.9);
        scene.add(hemiLight);

        keyLight = new THREE.DirectionalLight(0xfff6ea, 2.0);
        keyLight.position.set(4.5, 8.5, 5.5);
        scene.add(keyLight);

        fillLight = new THREE.DirectionalLight(0xdfe8ff, 0.55);
        fillLight.position.set(-6, 3.5, -4);
        scene.add(fillLight);

        rimLight = new THREE.PointLight(0xffe6c2, 8, 16, 2);
        rimLight.position.set(-1.5, 2.6, -3.2);
        scene.add(rimLight);

        // Applique le thème courant (fond, sol, lumières)
        applyTheme();

        // Livre
        bookGroup = new THREE.Group();
        bookGroup.position.y = PAGE_H * 0.5 + 0.06;
        scene.add(bookGroup);

        paperTex = makePaperTexture();
        /* ⚠️ _SP3D_PAPIER_714 — LE VERSO DE CHAQUE FEUILLE A SON PROPRE MATÉRIAU.
           Avant, un seul `paperMatB` était partagé par TOUTES les feuilles : teinter
           le papier d'une page (sa couleur) revenait donc à teinter le verso de
           tout le livre. Le matériau est maintenant créé par feuille, dans `mkLeaf`.
           Le réglage commun (non éclairé, sans brouillard) est appliqué à chacun. */

        // ⚠️ LES PAGES SONT AFFICHÉES NON ÉCLAIRÉES (MeshBasicMaterial) : c'est la
        //    condition d'un rendu « clinique » où le blanc du papier reste BLANC et
        //    où les couleurs de la maquette sont exactes (fidèles à l'impression).
        //    `toneMapped = false` évite que le mappage tonal grise les blancs.
        var mkLeaf = function (isLeft) {
            var g = new THREE.Group();
            var frontMat = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
            frontMat.toneMapped = false;
            frontMat.fog = false;   // le papier ne se teinte JAMAIS selon la distance
            var f = new THREE.Mesh(geoPlane, frontMat);
            f.position.z = 0.0015;
            var paperMat = new THREE.MeshBasicMaterial({ map: paperTex, side: THREE.FrontSide });
            paperMat.toneMapped = false;
            paperMat.fog = false;
            var b = new THREE.Mesh(geoPlane, paperMat);
            b.rotation.y = Math.PI;
            b.position.z = -0.0015;
            g.add(f); g.add(b);
            // ── Ombre de PLI, ENFANT de la feuille : elle épouse le bord côté
            //    reliure et SUIT la page (rotation / penché) → jamais de clignotement,
            //    et elle existe aussi quand la page est SEULE (couverture / dos).
            var foldMat = new THREE.MeshBasicMaterial({
                map: makeFoldTexture(!isLeft), transparent: true, opacity: 0.9,
                depthWrite: false, side: THREE.DoubleSide
            });
            foldMat.toneMapped = false;
            foldMat.fog = false;
            var fold = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), foldMat);
            fold.position.z = 0.008;
            fold.renderOrder = 10;
            g.add(fold);
            foldMats.push(foldMat);
            g.userData = { front: f, back: b, fold: fold, isLeft: !!isLeft };
            return g;
        };
        leafL = mkLeaf(true);
        leafR = mkLeaf(false);
        bookGroup.add(leafL); bookGroup.add(leafR);

        // Feuille de tourne (invisible au repos) — les 2 faces montrent une page.
        flipper = new THREE.Group();
        flipFrontMat = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
        flipBackMat = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
        flipFrontMat.toneMapped = false;
        flipBackMat.toneMapped = false;
        flipFrontMat.fog = false;
        flipBackMat.fog = false;
        var ff = new THREE.Mesh(geoPlane, flipFrontMat);
        var fb = new THREE.Mesh(geoPlane, flipBackMat);
        fb.rotation.y = Math.PI;
        flipper.add(ff); flipper.add(fb);
        // ── Ombre de pli de la FEUILLE QUI TOURNE. Sans elle, la page entrante de
        //    GAUCHE (affichée par cette feuille pendant la 2e moitié du tourne)
        //    n'avait pas d'ombre → impression que « l'ombre de gauche arrive en
        //    retard ». Le bord sombre est au pivot (x local = 0 = reliure) et reste
        //    en place quelle que soit la rotation. On met 2 plans (avant + arrière)
        //    pour que l'ombre soit toujours du bon côté de la feuille pendant le
        //    demi-tour (la face visible change à 90°).
        var flipFoldA = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
            (function () { var m = new THREE.MeshBasicMaterial({ map: makeFoldTexture(true), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }); m.toneMapped = false; m.fog = false; return m; })());
        flipFoldA.position.z = 0.012;                 // face avant
        flipFoldA.renderOrder = 11;
        var flipFoldB = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
            (function () { var m = new THREE.MeshBasicMaterial({ map: makeFoldTexture(true), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }); m.toneMapped = false; m.fog = false; return m; })());
        flipFoldB.position.z = -0.012;                // face arrière (après 90°)
        flipFoldB.renderOrder = 11;
        flipper.add(flipFoldA); flipper.add(flipFoldB);
        foldMats.push(flipFoldA.material); foldMats.push(flipFoldB.material);
        flipper.userData = { front: ff, back: fb, foldA: flipFoldA, foldB: flipFoldB };
        flipper.visible = false;
        bookGroup.add(flipper);

        // ── L'ombre de pli vit désormais DANS les feuilles (voir mkLeaf) : plus de
        //    maillage séparé à masquer/afficher → aucun « flash » au feuilletage.

        /* _SP3D_OMBRE_713 — l'ombre de contact, enfin créée. Elle vivait à l'état
           de branchements morts depuis l'origine (voir le tableau de bord de
           `makeContactShadowTexture`). */
        creerLOmbreDeContact();

        layoutLeaves();
        applyGutterOpacity();
    }

    /* _SP3D_OMBRE_713 — l'opacité de l'ombre de contact suit le réglage « Ombre »
       du panneau. AVANT, ce réglage n'agissait que sur le dégradé de pliure : on
       réglait « l'ombre » sans jamais voir d'ombre. Le facteur ne peut pas être
       celui de la pliure (`gutterIntensity * foldScale`, qui est un réglage de
       pliure épais) : on prend `gutterIntensity` seul, borné, et on le multiplie
       par l'intensité du thème (`T.shadow`). */
    function appliquerLOpacityDeLOmbre() {
        if (!contactShadowMat) return;
        var T = THEMES[theme] || THEMES.dark;
        var base = (T.shadow != null) ? T.shadow : 0.4;
        contactShadowMat.opacity = clamp(base * (gutterIntensity / 0.62), 0, 1);
    }

    function updateContactShadowSize() {
        if (!contactShadow) return;
        /* Étendue de l'ombre au sol, en unités de `pageW`.
           ⚠️ Ces deux nombres viennent du code d'origine (`pageW*2 + 0,55*pageW` ×
           `0,95*pageW`), mais ils n'avaient JAMAIS été éprouvés : l'ombre n'existait
           pas. Mesuré en la construisant : la profondeur de 0,95·pageW amène le
           bord AVANT de l'ombre à ~0,67 unité devant le livre — soit 30 % de la
           hauteur d'écran occupée par une plaque sombre au premier plan, parce que
           la caméra est basse (`phi` ≈ 66°) et voit le sol de très près. On resserre
           donc la profondeur.
           ⚠️ ET ON LA CENTRE (z = 0) : un premier jet la décalait vers l'arrière au
           nom de la physique (la lumière clé est devant, `keyLight.z = 5,5`), mais
           l'écran montre le sol DEVANT le livre — la moitié arrière de l'ombre est
           cachée par les pages. Décalée en arrière, l'ombre devenait donc invisible
           au lieu d'être juste : mesuré à 5,2 niveaux sur 255. Centrée, sa moitié
           visible tombe juste sous le livre, là où on la regarde. */
        contactShadow.scale.set(pageW * 2 + pageW * 0.42, pageW * 0.70, 1);
        contactShadow.position.z = 0;
    }

    // Positionne les demies-feuilles de part et d'autre de la reliure (x = 0)
    // et leur donne un léger « V » (volume du pli d'un livre ouvert).
    // ⚠️ `layoutLeaves` ne place QUE les faces avant/arrière et le pli. Le grain et
    //    le reflet sont recalés à l'application du papier (`appliquerPapierAuFeuillet`),
    //    parce qu'ils n'existent qu'à partir du moment où une page a un papier.
    function layoutLeaves() {
        if (!leafL || !leafR || !flipper) return;
        var hw = pageW / 2;
        leafL.userData.front.position.x = -hw; leafL.userData.back.position.x = -hw;
        leafR.userData.front.position.x = hw; leafR.userData.back.position.x = hw;
        leafL.rotation.y = leafTilt;
        leafR.rotation.y = -leafTilt;
        flipper.userData.back.position.x = flipper.userData.front.position.x;
        // Ombre de pli : largeur et position (côté reliure) recalculées selon le format.
        var foldW = pageW * 0.22;
        [leafL, leafR].forEach(function (leaf) {
            var fold = leaf && leaf.userData && leaf.userData.fold;
            if (!fold) return;
            fold.scale.set(foldW, PAGE_H, 1);
            fold.position.x = leaf.userData.isLeft ? (-foldW / 2) : (foldW / 2);
        });
        // Ombre de la feuille qui tourne : bord sombre au PIVOT (x local = 0).
        placeFlipFold(1);
    }

    /* ⚠️ _SP3D_OMBRE_711 — LE REPLI DE LA FEUILLE QUI TOURNE SUIT LE SENS DU FEUILLETAGE.
       Défaut signalé : « les ombres ont du mal à revenir dans le sens inverse quand on
       défile page à page ». MESURÉ (lecture du code) : les deux plans d'ombre du `flipper`
       (`foldA`/`foldB`) étaient positionnés UNE SEULE FOIS, à `+foldW/2` — c'est-à-dire à
       DROITE du pivot (la reliure). Or `startFlip(dir)` place la feuille à GAUCHE
       (`xPos = -pageW/2`) quand on RECULE : l'ombre restait donc du côté droit, loin de la
       feuille qui tourne → invisible, et l'impression que « l'ombre ne revient pas » en
       marche arrière. On recale donc le repli à CHAQUE tourne, selon le sens :
         · dir > 0 (on avance) : repli à DROITE du pivot, encre sombre vers la reliure ;
         · dir < 0 (on recule) : repli à GAUCHE du pivot, MIRÉ (scale.x négatif) pour que le
           bord sombre reste bien du côté de la reliure.
       La position/échelle est recalculée depuis `pageW` (aucune dépendance à l'ordre des
       appels), et les deux faces (avant z>0 / arrière z<0) sont traitées ensemble. */
    function placeFlipFold(dir) {
        if (!flipper || !flipper.userData) return;
        var foldW = pageW * 0.22;
        var avant = (dir >= 0);
        var a = flipper.userData.foldA, b = flipper.userData.foldB;
        [a, b].forEach(function (f) {
            if (!f) return;
            f.scale.set(avant ? foldW : -foldW, PAGE_H, 1);
            f.position.x = avant ? (foldW / 2) : (-foldW / 2);
        });
        flipper.userData.foldDir = (dir >= 0) ? 1 : -1;   // diagnostic (voir _debug)
    }

    /* 🎯 CADRAGE ADAPTATIF AU FORMAT : la hauteur de page est fixe (PAGE_H) mais
       la LARGEUR dépend du format (A4, A3, A5, Letter, Tabloid, paysage, formats
       magazine…). On calcule la distance caméra pour que le livre ouvert
       (2 × pageW) tienne entièrement dans l'image, avec une marge. */
    function fitCamera() {
        if (!camera) return;
        var vFov = camera.fov * Math.PI / 180;
        var halfBookW = pageW * 1.10;           // demie-largeur du livre ouvert + marge
        var halfBookH = PAGE_H * 0.5 * 1.22;    // demie-hauteur + marge
        var dV = halfBookH / Math.tan(vFov / 2);
        var hFov = 2 * Math.atan(Math.tan(vFov / 2) * (camera.aspect || 1));
        var dH = halfBookW / Math.tan(hFov / 2);
        RADIUS_BASE = clamp(Math.max(dV, dH) * 1.12, RADIUS_MIN, RADIUS_MAX);
        applyZoom();
    }

    function applyZoom() {
        radius = clamp(RADIUS_BASE * (100 / zoomPct), RADIUS_MIN, RADIUS_MAX);
    }

    /* --------------------------------------------------------- Textures pages */
    // ⚠️ IMPORTANT : on CONSERVE un emplacement par page (même en cas d'échec,
    //    avec `null`). Sinon les indices se décalent : la « couverture » pouvait
    //    afficher la page 2 (ou rien) dès qu'une seule texture ne chargeait pas.
    function loadTextures(urls) {
        var loader = new THREE.TextureLoader();
        var maxAniso = renderer.capabilities.getMaxAnisotropy();
        var MAXTEX = 2048;
        return Promise.all(urls.map(function (u) {
            if (!u) return Promise.resolve(null);
            return loader.loadAsync(u).then(function (t) {
                t.colorSpace = THREE.SRGBColorSpace;
                t.anisotropy = maxAniso;
                var img = t.image;
                if (img && (img.width > MAXTEX || img.height > MAXTEX)) {
                    // Limite mémoire GPU : on plafonne la taille des grandes planches.
                    t.generateMipmaps = false;
                    t.minFilter = THREE.LinearFilter;
                } else {
                    t.generateMipmaps = true;
                    t.minFilter = THREE.LinearMipmapLinearFilter;
                }
                return t;
            }).catch(function (e) {
                console.warn('[SP-3D] texture de page non chargée :', e && e.message);
                return null;
            });
        }));
    }

    function leafTexture(index) {
        if (index < 0 || index >= N) return paperTex;
        return texes[index] || paperTex;
    }

    /* ════════════════════════════════════════════════════════════════════════
       _SP3D_PAPIER_714 — LE PAPIER D'UNE PAGE, DANS L'APERÇU 3D.

       Ce que l'application dépose sur une page (`superprint-papiers.js`) doit se
       VOIR ici, sinon la promesse « l'aperçu montre la matière » serait fausse.
       On lit le catalogue par l'API publique `window.spPapiers.dePage(i)` — le
       module reste libre de changer son intérieur, et l'aperçu n'a pas besoin de
       le connaître.

       QUATRE EFFETS, et ce que chacun a de vérifiable :
         · TEINTE  — la couleur du papier MULTIPLIE l'image de la page. Comme les
                     pages sont rendues en clair (non éclairées, blanc pur), une
                     multiplication est exactement ce que fait un papier teinté.
         · GRAIN   — les ASPÉRITÉS, dessinées par le module (bruit + fibres),
                     posées en calque DEVANT la page, et RECALÉES sur elle
                     (`position.x`, _SP3D_PAPIER_714a). Relevé : le bloc `papiers`
                     de `_debug` (grain, grainOp, grainX, matiere).
         · BRILLANT — un reflet en bande diagonale, en fondu additif.
                     ⚠️ HONNÊTETÉ : sur un papier DÉJÀ blanc pur, ce reflet n'ajoute
                     rien — on ne peut pas éclaircir du blanc, et c'est la vérité
                     physique. La différence ne se mesure donc que sur un papier
                     TEINTÉ (ivoire, crème, kraft). Le banc le vérifie sur l'ivoire
                     et le dit.
         · CALQUE — « calque » VEUT DIRE TRANSPARENT, et on va jusqu'au bout : la
                     feuille est rendue avec `transparent:true`, une opacité
                     inférieure à 1, et `depthWrite` COUPÉ (_SP3D_PAPIER_714b).
                     Sans cette dernière précaution la feuille marquait la
                     profondeur et masquait ce qui est derrière elle : on ne voyait
                     RIEN au travers, et « calque » n'était qu'un mot. Ici on voit
                     réellement au travers — le fond, et l'autre page de la double
                     page. Les trois papiers concernés (calque 45 %, calque brillant
                     55 %, vélin 62 %) sont ceux que le catalogue déclare translucides.
       ════════════════════════════════════════════════════════════════════════ */

    var cacheGrainTex = {}, cacheSheenTex = null;
    var texturesDePapier = [];   // libérées à la fermeture

    function papierDeLaPage(i) {
        if (i < 0 || i == null) return null;
        try {
            if (window.spPapiers && typeof window.spPapiers.dePage === 'function') {
                return window.spPapiers.dePage(i) || null;
            }
        } catch (_) {}
        return null;
    }

    /**
     * Charge la couche « encre seule » des pages en calque, puis réapplique la vue.
     *
     * On la charge EN UNE FOIS, avant l'affichage, et non à la demande : un
     * `THREE.TextureLoader` est ASYNCHRONE, donc charger au premier affichage
     * d'une page en calque produirait un clignotement — la page apparaîtrait
     * opaque, puis se dégagerait. Une seule application de vue après le
     * chargement suffit, et `applyView` est idempotent.
     */
    function preparerEncre() {
        var idx = [];
        for (var i = 0; i < capPlan.length; i++) {
            if (capPlan[i] && capPlan[i].encre && !texesEncre[i]) idx.push(i);
        }
        if (!idx.length) return Promise.resolve(false);
        return loadTextures(idx.map(function (k) { return capPlan[k].encre; })).then(function (arr) {
            idx.forEach(function (k, j) { texesEncre[k] = arr[j] || null; });
            if (open) applyView();
            return true;
        }).catch(function () { return false; });
    }

    /**
     * Le grain du papier, en texture three.js. SYNCHRONE : le module rend un
     * canevas déjà dessiné (`spPapiers.grain`), on n'attend donc aucun
     * chargement — le papier est visible dès la première image, sans clignoter.
     *
     * 512 px (et non 256) : la tuile est vue de près quand on zoome, et c'est la
     * définition qui décide si les aspérités se lisent comme une matière ou comme
     * une bouillie. Le grain est FOURNI PAR LE MÊME GÉNÉRATEUR que l'éditeur
     * (`dessinerGrain`), à une résolution différente : la finesse relative est la
     * même (l'échelle du bruit suit le canevas), donc les deux montrent le même
     * papier.
     */
    function textureDeGrain(p) {
        if (!p || !p.id || !p.grain) return null;
        if (cacheGrainTex[p.id]) return cacheGrainTex[p.id];
        var cv = null;
        try { cv = window.spPapiers.grain(p.id, 512); } catch (_) {}
        if (!cv) return null;
        var t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = (renderer && renderer.capabilities) ? renderer.capabilities.getMaxAnisotropy() : 1;
        // Mipmaps conservés (qualité au loin) : le grain est dessiné assez franc
        // pour survivre à la minification (voir `dessinerGrain`, contraste).
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        cacheGrainTex[p.id] = t;
        texturesDePapier.push(t);
        return t;
    }

    /**
     * La répétition de la tuile de grain pour le format COURANT.
     *
     * ⚠️ Elle suit `pageW` / `PAGE_H`, et ce n'est pas un détail : un grain réglé
     * pour l'A4 afficherait, en A3, des aspérités deux fois plus grosses — donc un
     * AUTRE papier. Appelée à chaque application, elle suit aussi un changement de
     * format (`appliquerTextures` reconstruit `geoPlane`).
     */
    function reglerRepetitionGrain(t) {
        if (!t) return;
        t.repeat.set(Math.max(1, Math.round(pageW / 0.34)), Math.max(1, Math.round(PAGE_H / 0.34)));
        t.needsUpdate = true;
    }

    /** Le reflet « brillant » : une bande diagonale douce, en fondu ADDITIF. */
    function textureDeReflet() {
        if (cacheSheenTex) return cacheSheenTex;
        var s = 256;
        var cv = document.createElement('canvas'); cv.width = s; cv.height = s;
        var ctx = cv.getContext('2d');
        /* ⚠️ UNE BANDE LARGE ET DOUCE, PAS UNE RAIE. Une première version montait à
           0,85 sur 12 % de la diagonale : sur une page blanche, cela se lisait comme un
           DÉFAUT D'IMPRESSION (une raie claire en travers) plutôt que comme une
           brillance. Une matière brillante renvoie la lumière sur une plage étendue et
           sans arête : le profil est donc étalé, et son maximum n'est qu'à 0,42. */
        var g = ctx.createLinearGradient(0, s, s, 0);   // diagonale bas-gauche → haut-droite
        g.addColorStop(0.00, 'rgba(255,255,255,0)');
        g.addColorStop(0.22, 'rgba(255,255,255,0.06)');
        g.addColorStop(0.40, 'rgba(255,255,255,0.26)');
        g.addColorStop(0.50, 'rgba(255,255,255,0.42)');
        g.addColorStop(0.62, 'rgba(255,255,255,0.22)');
        g.addColorStop(0.80, 'rgba(255,255,255,0.05)');
        g.addColorStop(1.00, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
        var t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        cacheSheenTex = t;
        texturesDePapier.push(t);
        return t;
    }

    /**
     * Applique le papier d'une page à la feuille qui la porte.
     * @param {THREE.Group} group une feuille (`leafL` / `leafR` / `flipper`)
     * @param {number} idx       index de la page montrée en face avant
     */
    function appliquerPapierAuFeuillet(group, idx) {
        if (!group || !group.userData) return;
        var u = group.userData;
        var p = papierDeLaPage(idx);
        u.papierIdx = idx;
        u.papier = p ? {
            id: p.id, nom: p.nom, matiere: p.matiere,
            transparent: p.transparent || 0, calque: !!p.calque,
        } : null;

        var teinte = (p && p.teinte) ? new THREE.Color(p.teinte) : new THREE.Color(0xffffff);
        var opacite = (p && p.transparent) ? clamp(1 - p.transparent, 0.15, 1) : 1;
        var translucide = opacite < 0.999;

        /* ⚠️ _SP3D_CALQUE_616 — UN CALQUE NE SE REND PAS COMME UNE PAGE OPAQUE.
           MESURÉ : l'image de page capturée est BLANCHE OPAQUE (255/255/255/255
           aux quatre coins). L'encre et le support y sont donc les MÊMES pixels :
           rendre la feuille translucide revient à MÉLANGER L'IMPRESSION AVEC LE
           FOND DU LIVRE — le texte pâlit, et c'est le défaut signalé (une typo de
           la page 3 disparaissait sous un calque posé sur les pages 1 et 2).
           Le remède ne se devine pas, il se mesure : avec `backgroundColor = null`
           le coin de page devient rgba(0,0,0,0) alors que l'objet GARDE exactement
           ses valeurs — on peut donc capturer une couche « ENCRE SEULE »,
           transparente là où rien n'est imprimé. D'où un rendu en DEUX ÉPAISSEURS :
             · la FEUILLE (le papier : teinte × opacité) juste derrière ;
             · l'ENCRE par-dessus, NON TEINTÉE et NON DÉLAVÉE (opacité 1).
           Le calque se voit au travers — le fond, et la page d'en face — ET le
           texte reste net : les deux exigences tenues ensemble, au lieu d'une
           seule, ce qui était exactement le compromis demandé. */
        var estCalque = !!(p && (p.calque || p.transparent));
        var texEncre = estCalque ? (texesEncre[idx] || null) : null;

        // ── Le VERSO : toujours le papier (teinte + translucidité).
        if (u.back && u.back.material) {
            u.back.material.color.copy(teinte);
            u.back.material.transparent = translucide;
            u.back.material.opacity = opacite;
            /* ⚠️ CALQUE = TRANSPARENT, et il faut aller jusqu'au bout : `depthWrite`
               doit être COUPÉ sur une feuille translucide. Sinon la feuille écrit
               dans le tampon de profondeur et MASQUE ce qui est derrière elle :
               mesuré, la page d'en face et le fond ne se voyaient pas au travers —
               donc « calque » ne se lisait pas comme un calque. */
            u.back.material.depthWrite = !translucide;
            u.back.material.needsUpdate = true;
        }

        // ── La FACE : l'encre par-dessus la feuille, ou la page telle quelle.
        if (texEncre && u.front && u.front.material) {
            setMat(u.front, texEncre);
            u.front.material.color.setRGB(1, 1, 1);      // l'encre n'est pas teintée
            u.front.material.transparent = true;         // les vides de l'encre le restent
            u.front.material.opacity = 1;                // et l'encre n'est PAS délavée
            u.front.material.depthWrite = false;
            u.front.material.needsUpdate = true;

            if (!u.feuille) {
                var fm = new THREE.MeshBasicMaterial({ map: paperTex, side: THREE.FrontSide });
                fm.toneMapped = false; fm.fog = false;
                u.feuille = new THREE.Mesh(geoPlane, fm);
                /* Juste DERRIÈRE l'encre (0,0015) et devant le verso (-0,0015) :
                   c'est l'épaisseur du papier. Deux maillages transparents, donc
                   l'ordre de peinture suit la distance à la caméra — aucun
                   `renderOrder` à imposer, et rien à reclasser si la caméra tourne. */
                u.feuille.position.z = 0.0008;
                group.add(u.feuille);
            }
            var fmc = u.feuille.material;
            fmc.map = paperTex;
            fmc.color.copy(teinte);
            fmc.transparent = true;
            fmc.opacity = opacite;
            fmc.depthWrite = false;
            fmc.needsUpdate = true;
            if (u.feuille.geometry !== geoPlane) u.feuille.geometry = geoPlane;
            u.feuille.position.x = u.front.position.x;
            u.feuille.visible = true;
        } else {
            if (u.feuille) u.feuille.visible = false;
            if (u.front && u.front.material) {
                /* ⚠️ ON REMET LA PAGE APLATIE, et ce n'est pas redondant :
                   `appliquerPapierAuFeuillet` est rappelée à CHAQUE changement de
                   vue, donc passer d'une page en calque à une page opaque doit
                   rendre sa texture à la face. Sans cette remise, la page opaque
                   suivante garderait l'encre seule de la précédente. */
                setMat(u.front, leafTexture(idx));
                u.front.material.color.copy(teinte);
                u.front.material.transparent = translucide;
                u.front.material.opacity = opacite;
                u.front.material.depthWrite = !translucide;
                u.front.material.needsUpdate = true;
            }
        }

        // ── Le GRAIN : un calque devant la page, créé une fois par feuille.
        if (!u.grain) {
            var gm = new THREE.MeshBasicMaterial({
                transparent: true, depthWrite: false, side: THREE.FrontSide,
                /* ⚠️ MÉLANGE NORMAL, ET PAS `MultiplyBlending` — ESSAYÉ, MESURÉ, REJETÉ.
                   Le modèle juste serait une multiplication (c'est ce que fait l'éditeur,
                   `mix-blend-mode:multiply` : le grain assombrit, il n'éclaircit pas).
                   Mais en WebGL la multiplication fixe (`MultiplyBlending`) ne peut PAS
                   être pondérée par l'alpha de la texture : elle multiplie TOUTES les
                   composantes, y compris là où le grain est transparent. Mesuré dans
                   l'aperçu 3D, même carré de page : le grain passait de 10,35 à
                   29,5/255, la TEINTE du papier disparaissait (ivoire 244/247/247 au
                   lieu de 247/242/230 — donc plus chaud du tout) et les zones
                   transparentes de la texture écrasaient la page vers le noir.
                   Le mélange normal, lui, module le contraste de part et d'autre de la
                   teinte (le blanc de la texture n'est présent QUE là où l'alpha est
                   non nul) : mesuré 1,47/255 sur l'ivoire et 10,35/255 sur le kraft,
                   avec la teinte exacte. C'est ce qu'on garde. */
            });
            gm.toneMapped = false; gm.fog = false;
            u.grain = new THREE.Mesh(geoPlane, gm);
            u.grain.position.z = 0.0035;    // devant la page (0,0015), derrière le pli (0,008)
            u.grain.renderOrder = 9;
            u.grain.visible = false;
            group.add(u.grain);
        }
        var texGrain = p ? textureDeGrain(p) : null;
        u.grain.visible = !!texGrain;
        if (texGrain && u.grain.material) {
            u.grain.material.map = texGrain;
            reglerRepetitionGrain(texGrain);
            /* La géométrie suit un changement de FORMAT : `appliquerTextures`
               remplace `geoPlane` pour les faces avant/arrière, mais rien ne
               rebranchait le grain ni le reflet — ils gardaient donc les dimensions
               du format précédent (un calque de grain trop petit ou trop grand après
               un passage A4 → A5). */
            if (u.grain.geometry !== geoPlane) u.grain.geometry = geoPlane;
            /* ⚠️ _SP3D_PAPIER_714a — LE GRAIN ÉTAIT À CÔTÉ DE LA PAGE.
               `u.grain.position.x` n'était JAMAIS posé : la tuile restait centrée
               sur la RELIURE, donc à cheval sur la page voisine et à moitié dans le
               vide — une page sur deux sans grain, l'autre à moitié couverte. On la
               recale sur la page, exactement comme les faces avant/arrière
               (`layoutLeaves`, qui ne traitait que celles-ci). */
            u.grain.position.x = u.front ? u.front.position.x : 0;
            /* Le grain DOSE la matière.
               ⚠️ LA COURBE EST EN PUISSANCE (`grain^0,7`), ET CE N'EST PAS UN DÉTAIL :
               l'opacité multiplie une texture dont le CONTRASTE est lui-même
               proportionnel à `grain`. Une simple proportion rendait donc le résultat
               quadratique — mesuré dans l'aperçu 3D, écart-type de luminance sur un
               même carré de page : 0,61/255 pour l'ivoire (invisible, et c'est juste :
               c'est un papier fin) mais seulement 6,84/255 pour le kraft, c'est-à-dire
               à peine perceptible alors qu'il s'agit d'un papier très texturé.
               Avec `grain^0,7` les papiers texturés montent (kraft → 0,75 d'opacité)
               et les papiers lisses restent lisses (blanc couché → 0,19). */
            var facteurFeuille = translucide ? (0.45 + 0.55 * opacite) : 1;
            u.grain.material.opacity = clamp(Math.pow(p.grain || 0, 0.7) * 1.6 * facteurFeuille, 0, 0.88);
            u.grain.material.needsUpdate = true;
        }

        // ── Le REFLET, pour la matière brillante.
        if (!u.reflet) {
            var rm = new THREE.MeshBasicMaterial({
                transparent: true, depthWrite: false, side: THREE.FrontSide,
                blending: THREE.AdditiveBlending,
            });
            rm.toneMapped = false; rm.fog = false;
            u.reflet = new THREE.Mesh(geoPlane, rm);
            u.reflet.position.z = 0.005;
            u.reflet.renderOrder = 9;
            u.reflet.visible = false;
            group.add(u.reflet);
        }
        var brillant = !!(p && p.matiere === 'brillant');
        u.reflet.visible = brillant;
        if (brillant && u.reflet.material) {
            // Même recalage que le grain (même raison).
            u.reflet.position.x = u.front ? u.front.position.x : 0;
            if (u.reflet.geometry !== geoPlane) u.reflet.geometry = geoPlane;
            u.reflet.material.map = textureDeReflet();
            // Le reflet ne doit jamais LAVER la page : il suggère une brillance.
            u.reflet.material.opacity = 0.34 * (translucide ? opacite : 1);
            u.reflet.material.needsUpdate = true;
        }
    }
    function setMat(mesh, tex) {
        if (!mesh.material) {
            mesh.material = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
            mesh.material.toneMapped = false;
        }
        mesh.material.map = tex;
        mesh.material.needsUpdate = true;
    }
    function setLeaf(group, frontIdx) {
        if (!group) return;
        if (frontIdx < 0) { group.visible = false; return; }
        group.visible = true;
        setMat(group.userData.front, leafTexture(frontIdx));
        // _SP3D_PAPIER_714 — le papier de la page montrée ici.
        appliquerPapierAuFeuillet(group, frontIdx);
    }
    /* 🆕 Structure ÉDITORIALE (et non une simple suite de paires) :
       — vue 0   : page 1 seule (COUVERTURE, à droite) ;
       — vues 1+ : DOUBLE PAGE de l'intérieur (2‑3, 4‑5, 6‑7…) ;
       — dernière vue : dernière page seule (dos, à gauche) si le nombre de
         pages est impair après la couverture.
       C'est la logique d'un vrai magazine, demandée par l'utilisateur. */
    function buildViews(n) {
        var v = [];
        if (n <= 0) return v;
        v.push({ l: -1, r: 0 });                                  // couverture (page 1) seule
        for (var i = 1; i < n; i += 2) {
            v.push({ l: i, r: (i + 1 < n) ? i + 1 : -1 });        // double page ; dernière seule
        }
        return v;
    }
    function updateOffsetFor(v) {
        var view = views[v] || {};
        if (view.l < 0) offsetTarget = -pageW / 2;      // couverture → recentrer la page
        else if (view.r < 0) offsetTarget = pageW / 2;  // dernière page → recentrer
        else offsetTarget = 0;                          // double page → centré sur la reliure
    }
    function applyView() {
        var v = views[spread] || { l: -1, r: -1 };
        setLeaf(leafL, v.l);
        setLeaf(leafR, v.r);
        updateOffsetFor(spread);
        updateGutterVisibility();
        setIndicator();
    }

    // L'ombre de pli est INTRINSÈQUE aux feuilles (enfant de chacune) : elle ne se
    // cache plus jamais et ne « pop » donc plus. On ne fait que recaler son opacité
    // L'ombre de pli est INTRINSÈQUE aux feuilles (enfant de chacune) : elle ne se
    // cache plus jamais et ne « pop » donc plus. On ne fait que recaler son opacité
    // selon le thème / le réglage.
    // 🕮 PENSE LIVRE : l'ombre est PLEINE aussi quand une SEULE page est visible
    //    (couverture / dos) — un livre relié a toujours son ombre de reliure.
    function updateGutterVisibility() {
        foldScale = 1;
        applyGutterOpacity();
    }

    /* ---------------------------------------------------------- Tourne de page */
    function startFlip(dir) {
        if (!open) return;
        if (flipAnim) {
            // Un tourne est en cours. S'il traîne anormalement (images sautées car
            // le fil principal était occupé), on le solde — puis on IGNORE ce clic
            // (ne pas démarrer un 2e tourne ici, sinon on avancerait de 2 vues).
            var now0 = performance.now ? performance.now() : Date.now();
            if ((now0 - (flipAnim.started || 0)) > 5000) forceFinishFlip();
            return;
        }
        var to = spread + dir;
        if (to < 0 || to >= views.length) return;

        var cur = views[spread], nxt = views[to];
        var frontIdx, backIdx, xPos;
        if (dir > 0) { frontIdx = cur.r; backIdx = nxt.l; xPos = pageW / 2; }
        else { frontIdx = cur.l; backIdx = nxt.r; xPos = -pageW / 2; }
        if (frontIdx < 0 || backIdx < 0) return;   // rien à tourner de ce côté

        var f = flipper.userData.front, b = flipper.userData.back;
        f.position.x = xPos; b.position.x = xPos;
        /* ⚠️ _SP3D_OMBRE_711 — le repli suit le sens (voir placeFlipFold) : à droite quand
           on avance, à gauche (miré) quand on recule. Sinon l'ombre « ne revient pas ». */
        placeFlipFold(dir);
        setMat(f, leafTexture(frontIdx));
        setMat(b, leafTexture(backIdx));
        /* _SP3D_PAPIER_714 — la feuille qui tourne porte le papier de SA page :
           sans cela, la page qu'on tourne perdrait sa matière pendant le geste et
           la retrouverait à l'arrivée — un défaut visible en plein feuilletage. */
        appliquerPapierAuFeuillet(flipper, frontIdx);
        flipper.rotation.y = 0;
        flipper.visible = true;
        flipAnim = { dir: dir, t: 0, swapped: false, from: spread, to: to, started: (performance.now ? performance.now() : Date.now()) };
        updateOffsetFor(to);
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
    }

    // Termine immédiatement un tourne de page (garde-fou anti-blocage).
    function forceFinishFlip() {
        if (!flipAnim) return;
        var a = flipAnim;
        spread = a.to;
        flipper.visible = false;
        flipper.rotation.y = 0;
        flipAnim = null;
        applyView();
        updateGutterVisibility();
    }

    function doSwap(a) {
        var nxt = views[a.to];
        if (a.dir > 0) { setLeaf(leafL, -1); setLeaf(leafR, nxt.r); }
        else { setLeaf(leafR, -1); setLeaf(leafL, nxt.l); }
    }

    function finishFlip(a) {
        spread = a.to;
        flipper.visible = false;
        flipper.rotation.y = 0;
        flipAnim = null;
        applyView();
        updateGutterVisibility();
    }

    function updateFlip(dt) {
        if (!flipAnim) return;
        var a = flipAnim;
        // ⏱️ Pilotage au TEMPS RÉEL : si le navigateur saute des images (onglet
        //    occupé, app qui re-rend en arrière-plan), le tourne se termine quand
        //    même au lieu de rester figé.
        var now = performance.now ? performance.now() : Date.now();
        a.t = (now - a.started) / FLIP_MS;
        var p = Math.min(1, a.t);
        var e = easeInOutCubic(p);
        flipper.rotation.y = -e * Math.PI * a.dir;
        if (!a.swapped && p >= 0.5) { a.swapped = true; doSwap(a); }
        if (p >= 1) finishFlip(a);
    }

    /* -------------------------------------------------------------- Caméra */
    function applyCamera() {
        var e = easeOutCubic(clamp(intro, 0, 1));
        var r = radius + (1 - e) * 2.8;
        var th = theta + (1 - e) * -0.8;
        var sinPhi = Math.sin(phi);
        camera.position.set(
            r * sinPhi * Math.sin(th),
            target.y + r * Math.cos(phi),
            r * sinPhi * Math.cos(th)
        );
        camera.lookAt(target);
        if (bookGroup) {
            bookGroup.rotation.y = (1 - e) * -0.5;
            bookGroup.position.y = PAGE_H * 0.5 + 0.06 - (1 - e) * 0.35;
        }
    }

    function tick() {
        rafId = requestAnimationFrame(tick);
        try {
            var dt = Math.min(clock.getDelta(), 0.05);
            var t = clock.elapsedTime;

            if (intro < 1) intro = Math.min(1, intro + dt / 0.85);

            updateFlip(dt);
            applyCamera();

            if (bookGroup) {
                bookGroup.position.x += (offsetTarget - bookGroup.position.x) * Math.min(1, dt * 5.5);
                /* _SP3D_PAPIER_714 — quand la scène est GELÉE, on recale aussi cette
                   approche asymptotique sur sa cible. Sans ce recalage, deux
                   captures « identiques » diffèrent encore de ces fractions de
                   pixel qui continuent de converger : mesuré, 1 041 pixels de bruit
                   résiduel — assez pour qu'un contrôle négatif ne soit pas propre,
                   et donc pour qu'une comparaison d'images ne prouve plus rien. */
                if (fige) bookGroup.position.x = offsetTarget;
                if (contactShadow) contactShadow.position.x = bookGroup.position.x;
                /* _SP3D_OMBRE_713 — `tAmbiance` remplace `clock.elapsedTime` dans le
                   flottement d'ambiance, pour pouvoir le GELER (`fige`). Ce gel
                   n'est pas un réglage utilisateur : il existe pour que les bancs
                   puissent comparer deux rendus de la MÊME image. Sans lui, deux
                   captures ne diffèrent jamais que par l'ombre — elles diffèrent
                   aussi de tout le flottement (mesuré : c'est ce qui a fait croire
                   à un premier banc que l'ombre se voyait, avec 44 % de pixels
                   « changés » qui n'étaient que le balancement du livre). */
                if (!fige) tAmbiance = t;
                if (intro >= 1) {
                    // Flottement d'ambiance : il s'ESTOMPE à mesure qu'on se rapproche de
                    // la vue « à plat » (phi → 90°) pour ne pas gêner la lecture précise
                    // et laisser le document parfaitement droit sur demande.
                    var idle = 1 - clamp((phi - 1.34) / (Math.PI / 2 - 1.34), 0, 1);
                    bookGroup.position.y = PAGE_H * 0.5 + 0.06 + Math.sin(tAmbiance * 0.7) * 0.014 * idle;
                    bookGroup.rotation.z = roll + Math.sin(tAmbiance * 0.45) * 0.008 * idle;
                } else {
                    bookGroup.rotation.z = roll;
                }
            }
            renderer.render(scene, camera);
            frameErrors = 0;
        } catch (e) {
            // Un contexte WebGL perdu / une texture détruite ne doit pas laisser
            // l'aperçu bloqué « ouvert » sans rien afficher : on ferme proprement.
            frameErrors++;
            console.warn('[SP-3D] rendu :', e);
            if (frameErrors > 3) close();
        }
    }

    function resize() {
        if (!renderer || !camera || !overlay) return;
        var w = overlay.clientWidth || window.innerWidth;
        var h = overlay.clientHeight || window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        // Le cadrage dépend du format ET de la fenêtre : on le réajuste.
        if (!dragging) fitCamera();
    }

    /* ------------------------------------------------------------ Interaction */
    function bindInput() {
        canvasEl.addEventListener('pointerdown', function (e) {
            dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY;
            if (canvasEl) canvasEl.classList.add('sp3d-grab');
            try { canvasEl.setPointerCapture(e.pointerId); } catch (_) {}
        });
        canvasEl.addEventListener('pointermove', function (e) {
            if (!dragging) return;
            var dx = e.clientX - lastX, dy = e.clientY - lastY;
            lastX = e.clientX; lastY = e.clientY;
            if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
            theta -= dx * 0.006;
            phi = clamp(phi - dy * 0.006, PHI_MIN, PHI_MAX);
            /* ⚠️ _SP3D_ORBITE_716 — LE PLAFOND EST DANS LE GESTE, PAS SEULEMENT DANS
               LE RÉGLAGE. Sans lui, un glissement de 300 px (theta -= 1,8 rad ≈ 103°)
               amène la caméra derrière le livre : on ne voit plus que le verso nu des
               feuilles, et la couverture comme le dos semblent perdus (mesuré, voir
               `THETA_MAX`). Le plafond s'applique donc aussi ici. */
            bornerTheta();
        });
        var endDrag = function (e) {
            if (!dragging) return;
            dragging = false;
            // ⚠️ l'aperçu peut avoir été fermé entre-temps → canvasEl peut être null.
            try { if (canvasEl) canvasEl.classList.remove('sp3d-grab'); } catch (_) {}
            try { if (canvasEl && canvasEl.releasePointerCapture) canvasEl.releasePointerCapture(e.pointerId); } catch (_) {}
            syncSettings();   // recale les sliders sur la position atteinte à la souris
        };
        canvasEl.addEventListener('pointerup', endDrag);
        canvasEl.addEventListener('pointercancel', endDrag);
        canvasEl.addEventListener('dblclick', function () { if (!moved) startFlip(1); });
        canvasEl.addEventListener('wheel', function (e) {
            e.preventDefault();
            zoomPct = clamp(zoomPct - e.deltaY * 0.08, 60, 220);
            applyZoom();
            syncSettings();
        }, { passive: false });

        window.addEventListener('resize', resize);
        window.addEventListener('keydown', onKey, true);
    }

    function onKey(e) {
        if (!open) return;
        var k = e.key;
        if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
        if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); e.stopPropagation(); startFlip(1); return; }
        if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); e.stopPropagation(); startFlip(-1); return; }
    }

    /* -------------------------------------------------- Ouverture / Fermeture */
    function openPreview() {
        if (open) {
            // Si un état incohérent subsiste (overlay détaché après une erreur),
            // on nettoie AVANT de ré-ouvrir — sinon l'aperçu devenait « impossible
            // à rouvrir » (le drapeau restait bloqué à true).
            if (overlay && overlay.parentNode) return;
            try { close(); } catch (_) {}
        }
        open = true;
        intro = 0; spread = 0; theta = 0; phi = 1.16; radius = RADIUS_BASE;
        roll = 0; gutterIntensity = 0.62; leafTilt = 0.028; bgMode = 'grid'; zoomPct = 100;
        dragging = false; flipAnim = null; texes = []; N = 0; settingsOpen = false;
        theme = 'dark';   // 🎯 thème SOMBRE par défaut à chaque ouverture

        try {
            buildOverlay();
            prevOverflow = document.documentElement.style.overflow;
            document.documentElement.style.overflow = 'hidden';
            requestAnimationFrame(function () { if (overlay) overlay.classList.add('sp3d-visible'); });
            // Laisse le spinner s'afficher ET le document se stabiliser avant la
            // capture (sinon une planche — souvent la couverture — peut être prise
            // encore vide si l'app finissait un rendu).
            /* ⚠️ _SP3D_PRET_712 — ON ATTEND QUE L'APP AIT FINI DE PEINDRE AVANT DE CAPTURER.
               Défaut signalé : « la cover et le dos disparaissent parfois ». MESURÉ : la capture
               partait 90 ms après l'ouverture, sans regarder si les planches étaient PRÊTES. Or
               l'app rend ses pages de façon ASYNCHRONE et marque chaque planche
               `_spRenderReady = false` (ou `_isLoading`) tant qu'elle n'est pas peinte (le
               contenu des planches — `loadSpreadContent` — charge aussi des images en fond).
               Capter une planche non prête donne une image VIDE (la couverture, la première
               planche, est la plus exposée) → elle semblait « disparue ». On attend donc que
               TOUTES les planches soient prêtes (ou un budget de 3 s), comme le fait déjà le
               studio pour ses propres captures. */
            setTimeout(function () {
                if (!open) return;
                waitAppReady(function () {
                    if (!open) return;
                    /* ⚠️ _SP3D_STABLE_713 — ON N'ATTEND PAS SEULEMENT QUE L'APP SOIT PRÊTE,
                       ON ATTEND QUE LE DOCUMENT SOIT STABLE. `waitAppReady` seule répond
                       « prêt » sur les 1 planche(s) du document PAR DÉFAUT : le vrai document
                       arrive après. Voir le tableau de bord `_SP3D_STABLE_713` plus haut. */
                    attendreDocumentStable(function () {
                        if (!open) return;
                        try { bootCapture(); } catch (e) { console.warn('[SP-3D] boot :', e); close(); }
                    });
                });
            }, 90);
        } catch (e) {
            console.warn('[SP-3D] ouverture :', e);
            close();
        }
    }

    /**
     * Applique un jeu de textures à la maquette DÉJÀ construite.
     *
     * Extrait de `bootCapture` par `_SP3D_STABLE_713` pour être RÉUTILISABLE : la
     * surveillance du document recapture les mêmes pages quand le document change
     * et doit pouvoir les remettre en place sans reconstruire la scène (reconstruire
     * `buildScene()` créerait un second `WebGLRenderer` sans libérer le premier).
     */
    function appliquerTextures(arr, premier) {
        if (!open || !geoPlane) return false;
        // Une entrée par page (les échecs valent null → texture papier).
        texes = arr; N = arr.length;
        if (!N) return false;

        // Aspect : on prend la première page réellement chargée.
        var ref = null;
        for (var i = 0; i < arr.length; i++) { if (arr[i] && arr[i].image && arr[i].image.width) { ref = arr[i]; break; } }
        if (ref) {
            var aspect = ref.image.width / ref.image.height;
            var nouvelle = PAGE_H * aspect;
            // On ne refait la géométrie que si le format a réellement changé : une
            // recapture à format identique ne doit pas recréer de géométrie.
            if (Math.abs(nouvelle - pageW) > 1e-6) {
                pageW = nouvelle;
                var oldGeo = geoPlane;
                geoPlane = new THREE.PlaneGeometry(pageW, PAGE_H);
                [leafL, leafR, flipper].forEach(function (grp) {
                    if (grp && grp.userData) {
                        if (grp.userData.front) grp.userData.front.geometry = geoPlane;
                        if (grp.userData.back) grp.userData.back.geometry = geoPlane;
                    }
                });
                try { oldGeo.dispose(); } catch (_) {}
            }
        }
        layoutLeaves();
        if (premier) fitCamera();
        views = buildViews(N);
        if (premier) {
            spread = 0;
            updateOffsetFor(0);
            if (bookGroup) bookGroup.position.x = offsetTarget;   // pas de glissement à la 1re vue
        } else {
            if (spread > views.length - 1) { spread = Math.max(0, views.length - 1); updateOffsetFor(spread); }
        }
        applyView();
        updateGutterVisibility();
        if (premier) { syncSettings(); syncBgSeg(); }
        return true;
    }

    /* ⚠️ _SP3D_STABLE_713 — LE DOCUMENT PEUT CHANGER APRÈS LA CAPTURE.
       Deuxième moitié du remède (la première est `attendreDocumentStable`). Un import lourd,
       une restauration lente ou un « Ouvrir un document » lancé juste après le clic sur play
       peuvent encore modifier le nombre de pages une fois la capture faite : sans veille,
       l'aperçu restait figé sur ce qu'il avait vu. La veille s'arrête d'elle-même (délai
       écoulé, aperçu fermé, ou document redevenu stable pendant assez longtemps).
       Un délai de 500 ms suffit : le relevé est une simple longueur de tableau. */
    var veilleId = 0, veillePages = null, veilleTours = 0;
    var VEILLE_PREMIER_MS = 150;      // premier contrôle tôt : c'est là que ça se joue
    var VEILLE_POLL_MS = 500;         // puis toutes les 500 ms (une longueur de tableau)
    var VEILLE_TOURS_MAX = 60;        // 30 s : au-delà, on ne surveille plus

    function surveillerLeDocument() {
        arreterLaVeille();
        veillePages = pagesVues(false);
        veilleTours = 0;
        var pas = function () {
            if (!open) { arreterLaVeille(); return; }
            if (++veilleTours > VEILLE_TOURS_MAX) { arreterLaVeille(); return; }
            var n = pagesVues(false);
            if (n != null && n !== veillePages) {
                veillePages = n;
                recapturer('document');
            }
            veilleId = setTimeout(pas, VEILLE_POLL_MS);
        };
        veilleId = setTimeout(pas, VEILLE_PREMIER_MS);
    }

    function arreterLaVeille() {
        if (veilleId) { clearTimeout(veilleId); veilleId = 0; }
    }

    /**
     * Recapture tout le document et remet les textures en place.
     * @param {string} motif  'document' (veille) ou 'manuel' (API publique)
     */
    function recapturer(motif) {
        if (!open || !geoPlane) return Promise.resolve(false);
        var urls = capturePages();
        if (!urls.filter(Boolean).length) return Promise.resolve(false);
        return loadTextures(urls).then(function (arr) {
            if (!open) return false;
            var ok = appliquerTextures(arr, false);
            preparerEncre();                       // _SP3D_CALQUE_616 — les calques ont pu changer
            if (motif === 'document') retenterLesPagesVides(arr);
            return ok;
        }).catch(function (e) {
            console.warn('[SP-3D] recapture :', e);
            return false;
        });
    }

    /** Re-tente les pages restées vides (même logique que dans `bootCapture`). */
    function retenterLesPagesVides(arr) {
        var missingIdx = [];
        for (var mi = 0; mi < arr.length; mi++) if (!arr[mi]) missingIdx.push(mi);
        if (!missingIdx.length) return;
        var rattraper = function (idx, essai) {
            return recapturePage(idx).then(function (t) {
                if (t) { texes[idx] = t; return true; }
                if (essai >= 2) return false;
                return new Promise(function (res) {
                    setTimeout(function () {
                        try { var cs = getAppCanvases(); if (cs[idx] && cs[idx].renderAll) cs[idx].renderAll(); } catch (_) {}
                        res(rattraper(idx, essai + 1));
                    }, essai === 0 ? 220 : 500);
                });
            });
        };
        Promise.all(missingIdx.map(function (idx) { return rattraper(idx, 0); })).then(function () {
            if (open) applyView();   // réapplique les feuilles avec les textures récupérées
        });
    }

    function bootCapture() {
        var urls = capturePages();
        var usable = urls.filter(function (u) { return !!u; });
        if (!usable.length) {
            toast('Aperçu 3D : aucune page à afficher.');
            close();
            return;
        }

        pageW = 1.414;
        geoPlane = new THREE.PlaneGeometry(pageW, PAGE_H);
        buildScene();
        resize();
        bindInput();

        loadTextures(urls).then(function (arr) {
            if (!open) return;
            if (!appliquerTextures(arr, true)) {
                toast('Aperçu 3D : impossible de préparer les pages.');
                close();
                return;
            }

            // Re-capture des pages dont la texture a échoué (souvent la couverture
            // ou le dos de couverture) → on ne « perd » plus une page.
            /* ⚠️ _SP3D_PRET_712 — DEUX CHANCES SUPPLÉMENTAIRES, ÉTALÉES DANS LE TEMPS.
               Une planche qui n'était pas prête au premier essai le devient quelques centaines
               de ms plus tard : on retente donc les pages vides DEUX fois, avec un délai, et
               on re-rend la maquette entre les tentatives. La couverture et le dos de
               couverture (première et dernière planches) étaient les plus exposés. */
            retenterLesPagesVides(arr);

            /* _SP3D_CALQUE_616 — la couche « encre seule » des pages en calque.
               Chargée AVANT la première image (voir `preparerEncre`) : on ne fait
               donc jamais apparaître une page opaque qui se dégagerait ensuite. */
            preparerEncre();

            /* _SP3D_STABLE_713 — et on continue de surveiller le document. */
            surveillerLeDocument();

            var load = overlay && overlay.querySelector('#sp3dLoad');
            if (load) {
                load.style.opacity = '0';
                setTimeout(function () { if (load && load.parentNode) load.parentNode.removeChild(load); }, 320);
            }
            clock = new THREE.Clock();
            if (rafId) cancelAnimationFrame(rafId);
            frameErrors = 0;
            tick();
        }).catch(function (e) {
            console.warn('[SP-3D] textures :', e);
            toast('Aperçu 3D : impossible de préparer les pages.');
            close();
        });
    }

    function close() {
        if (!open && !overlay) return;
        open = false;
        try { arreterLaVeille(); } catch (_) {}
        try { stopRecording(); } catch (_) {}
        try { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } } catch (_) {}
        try { window.removeEventListener('keydown', onKey, true); } catch (_) {}
        try { window.removeEventListener('resize', resize); } catch (_) {}
        try { document.documentElement.style.overflow = prevOverflow || ''; } catch (_) {}

        try { if (renderer) { renderer.dispose(); if (renderer.forceContextLoss) renderer.forceContextLoss(); } } catch (_) {}
        // Libère le contexte WebGL (évite l'épuisement des contextes après
        // plusieurs ouvertures/fermetures → « impossible de rouvrir »).
        try { if (canvasEl) { canvasEl.width = 1; canvasEl.height = 1; } } catch (_) {}
        [bgTex, floorTex, paperTex].forEach(function (t) { try { t && t.dispose(); } catch (_) {} });
        foldMats.forEach(function (m) { try { if (m.map) m.map.dispose(); m.dispose(); } catch (_) {} });
        foldMats = [];
        texes.forEach(function (t) { try { t && t.dispose(); } catch (_) {} });
        /* _SP3D_CALQUE_616 — les couches « encre seule » sont à nous aussi : les
           garder ferait fuir la mémoire GPU à chaque ouverture/fermeture. */
        texesEncre.forEach(function (t) { try { t && t.dispose(); } catch (_) {} });
        texesEncre = [];
        // _SP3D_PAPIER_714 — les textures de papier (grain, reflet) sont à nous.
        texturesDePapier.forEach(function (t) { try { t && t.dispose(); } catch (_) {} });
        texturesDePapier = []; cacheGrainTex = {}; cacheSheenTex = null;
        try { if (flipFrontMat && flipFrontMat.map) flipFrontMat.map.dispose(); } catch (_) {}
        try { if (flipBackMat && flipBackMat.map) flipBackMat.map.dispose(); } catch (_) {}
        try { if (scene) scene.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); } catch (_) {}
        try { if (geoPlane) geoPlane.dispose(); } catch (_) {}

        texes = []; N = 0; spread = 0; views = []; flipAnim = null; offsetTarget = 0; frameErrors = 0;
        capPlan = [];
        renderer = null; scene = null; camera = null; bookGroup = null;
        flipper = null; leafL = null; leafR = null; geoPlane = null;
        bgTex = null; floorTex = null; paperTex = null; clock = null;
        flipFrontMat = null; flipBackMat = null;
        try { if (bgImageTex && bgImageTex.dispose) bgImageTex.dispose(); } catch (_) {}
        bgImageTex = null;
        try { if (contactShadowTex && contactShadowTex.dispose) contactShadowTex.dispose(); } catch (_) {}
        contactShadow = null; contactShadowMat = null; contactShadowTex = null;
        settingsEl = null; settingsOpen = false; settingInputs = {};
        recordBtn = null; settingsBtn = null;

        if (overlay && overlay.parentNode) {
            var ov = overlay;
            ov.classList.remove('sp3d-visible');
            setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 340);
        }
        overlay = null; canvasEl = null; indicatorEl = null; prevBtn = null; nextBtn = null;
    }

    /* -------------------------------------------------------- API publique */
    window.SP3DPreview = {
        open: openPreview,
        close: close,
        isOpen: function () { return open; },
        _capturePages: capturePages,
        _debug: function () {
            function leafInfo(grp) {                if (!grp || !grp.userData || !grp.userData.front) return null;
                var m = grp.userData.front.material;
                var map = m && m.map;
                return {
                    vis: grp.visible,
                    hasMap: !!map,
                    isPaper: !!(map && paperTex && map === paperTex),
                    texIdx: (map && texes.indexOf(map)),
                    w: (map && map.image && map.image.width) || 0
                };
            }
            // Étendue projetée à l'écran (NDC : [-1,1] = entièrement visible) des
            // pages RÉELLEMENT visibles — calculée depuis les maillages réels
            // (fiable, sans supposition d'offset).
            var ndc = null;
            try {
                if (camera && pageW) {
                    var meshes = [];
                    if (leafL && leafL.visible && leafL.userData.front) meshes.push(leafL.userData.front);
                    if (leafR && leafR.visible && leafR.userData.front) meshes.push(leafR.userData.front);
                    if (!meshes.length && flipper && flipper.visible && flipper.userData.front) meshes.push(flipper.userData.front);
                    if (meshes.length) {
                        var minX = 9, maxX = -9, minY = 9, maxY = -9;
                        meshes.forEach(function (mesh) {
                            var g = mesh.geometry && mesh.geometry.parameters;
                            var hw = (g && g.width ? g.width : pageW) / 2;
                            var hh = (g && g.height ? g.height : PAGE_H) / 2;
                            [-1, 1].forEach(function (ex) { [-1, 1].forEach(function (ey) {
                                var pt = new THREE.Vector3(ex * hw, ey * hh, 0).applyMatrix4(mesh.matrixWorld);
                                pt.applyMatrix4(camera.matrixWorldInverse);
                                var p = pt.applyMatrix4(camera.projectionMatrix);
                                minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                                minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
                            }); });
                        });
                        ndc = { minX: +minX.toFixed(2), maxX: +maxX.toFixed(2), minY: +minY.toFixed(2), maxY: +maxY.toFixed(2),
                                cx: +((minX + maxX) / 2).toFixed(2), cy: +((minY + maxY) / 2).toFixed(2),
                                fits: (maxX <= 1.001 && minX >= -1.001 && maxY <= 1.001 && minY >= -1.001) };
                    }
                }
            } catch (_) {}
            return renderer ? {
                frame: renderer.info.render.frame,
                calls: renderer.info.render.calls,
                tris: renderer.info.render.triangles,
                pageW: pageW, N: N, spread: spread, theme: theme, radius: radius, base: RADIUS_BASE,
                roll: roll, leafTilt: leafTilt, bgMode: bgMode, gutter: gutterIntensity,
                recording: recording, settingsOpen: settingsOpen,
                flipping: !!flipAnim,
                texCount: texes.length,
                texEncreCount: texesEncre.filter(Boolean).length,
                views: views.map(function (v) { return (v.l + 1) + '/' + (v.r + 1); }),
                leafL: leafInfo(leafL), leafR: leafInfo(leafR), flip: leafInfo(flipper),
                bookX: bookGroup ? +bookGroup.position.x.toFixed(3) : null,
                foldCount: foldMats.length,
                // _SP3D_PAPIER_714 — la matière des pages TELLES QUE L'APERÇU LES
                // AFFICHE, page par page. Sans ce relevé, « le papier se voit » ne
                // se vérifierait qu'à l'œil, sur une image.
                papiers: (function () {
                    var out = [];
                    [leafL, leafR].forEach(function (g) {
                        if (!g || !g.visible || !g.userData || !g.userData.front) return;
                        var m = g.userData.front.material;
                        var c = m && m.color ? m.color : null;
                        out.push({
                            page: g.userData.papierIdx,
                            papier: g.userData.papier ? g.userData.papier.id : null,
                            matiere: g.userData.papier ? g.userData.papier.matiere : null,
                            teinte: c ? '#' + c.getHexString() : null,
                            opacite: m ? +(m.opacity).toFixed(3) : null,
                            depthWrite: m ? !!m.depthWrite : null,
                            grain: !!(g.userData.grain && g.userData.grain.visible),
                            grainOp: (g.userData.grain && g.userData.grain.visible && g.userData.grain.material)
                                ? +(g.userData.grain.material.opacity).toFixed(3) : null,
                            // _SP3D_PAPIER_714a — la position du grain DANS la feuille :
                            // elle doit valoir celle de la face avant (± pageW/2), sinon
                            // la tuile est à cheval sur la reliure.
                            grainX: (g.userData.grain && g.userData.grain.visible)
                                ? +g.userData.grain.position.x.toFixed(3) : null,
                            faceX: +g.userData.front.position.x.toFixed(3),
                            reflet: !!(g.userData.reflet && g.userData.reflet.visible),
                            /* _SP3D_CALQUE_616 — le calque se vérifie ici, et pas à
                               l'œil sur une image : la face porte-t-elle la couche
                               ENCRE (et non la page aplatie), et la feuille de
                               papier est-elle bien DERRIÈRE elle ? */
                            encre: !!(m && m.map && texesEncre.indexOf(m.map) >= 0),
                            feuille: !!(g.userData.feuille && g.userData.feuille.visible),
                            feuilleOpacite: (g.userData.feuille && g.userData.feuille.visible)
                                ? +(g.userData.feuille.material.opacity).toFixed(3) : null,
                            feuilleTeinte: (g.userData.feuille && g.userData.feuille.visible
                                && g.userData.feuille.material.color)
                                ? '#' + g.userData.feuille.material.color.getHexString() : null,
                        });
                    });
                    return out;
                })(),
                // _SP3D_OMBRE_713 — l'ombre de contact : présence, taille, opacité
                // et position. Sans ce relevé, « l'ombre est là » resterait une
                // impression : les bancs ne pourraient que regarder une image.
                ombre: (function () {
                    if (!contactShadow) return null;
                    return {
                        y: +contactShadow.position.y.toFixed(4),
                        x: +contactShadow.position.x.toFixed(3),
                        larg: +contactShadow.scale.x.toFixed(3),
                        prof: +contactShadow.scale.y.toFixed(3),
                        op: contactShadowMat ? +contactShadowMat.opacity.toFixed(3) : null,
                        dansScene: contactShadow.parent === scene,
                    };
                })(),
                // _SP3D_PRET_712 — état de CHAQUE page : texture présente (non papier) et taille.
                // Permet de voir d'un coup d'œil une couverture / un dos manquant.
                pages: texes.map(function (t, i) {
                    return { i: i, ok: !!t, w: (t && t.image && t.image.width) || 0, h: (t && t.image && t.image.height) || 0 };
                }),
                appReady: (function () { try { return canvasesReady(); } catch (_) { return null; } })(),
                // _SP3D_STABLE_713 — état de la veille du document : le nombre de pages
                // surveillé, et combien de tours de veille ont été faits.
                veille: { actif: veilleId ? 1 : 0, pages: veillePages, tours: veilleTours },
                // _SP3D_OMBRE_711 — sens et position du repli de la feuille qui tourne :
                // dir +1 = à droite du pivot (on avance), -1 = à gauche, miré (on recule).
                flipFold: (flipper && flipper.userData) ? {
                    dir: flipper.userData.foldDir || 0,
                    x: flipper.userData.foldA ? +flipper.userData.foldA.position.x.toFixed(3) : null,
                    sx: flipper.userData.foldA ? +flipper.userData.foldA.scale.x.toFixed(3) : null
                } : null,
                ndc: ndc
            } : null;
        },
        // _SP3D_PRET_712 — échantillonne la texture d'une page : renvoie son aspect réel
        // (moyenne rouge/vert/bleu) pour vérifier qu'une page n'est pas BLANCHE alors
        // qu'elle devrait avoir du contenu. Sert au diagnostic et aux bancs de test.
        _pageSample: function (i) {
            try {
                var t = texes[i];
                if (!t || !t.image) return null;
                var im = t.image;
                var cv = document.createElement('canvas');
                cv.width = 24; cv.height = 24;
                var cx = cv.getContext('2d');
                cx.drawImage(im, 0, 0, 24, 24);
                var d = cx.getImageData(0, 0, 24, 24).data;
                var r = 0, g = 0, b = 0, a = 0;
                for (var k = 0; k < d.length; k += 4) { r += d[k]; g += d[k + 1]; b += d[k + 2]; a += d[k + 3]; }
                var n = d.length / 4;
                return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), a: Math.round(a / n) };
            } catch (_) { return null; }
        },
        // _SP3D_STABLE_713 — recapture À LA DEMANDE tout le document. Utile pour un
        // appelant qui sait que le document vient de changer, et pour les bancs de test.
        recapture: function () { return recapturer('manuel'); },
        /* _SP3D_PAPIER_714 — mise à jour des MATIÈRES après un dépôt de papier.
           On ne recapture PAS : le contenu des pages n'a pas changé, seule leur
           matière. Recapturer pour si peu coûterait des dizaines de millisecondes
           et ferait clignoter l'aperçu pour rien. */
        majPapiers: function () {
            if (!open) return false;
            try {
                appliquerPapierAuFeuillet(leafL, (views[spread] || {}).l);
                appliquerPapierAuFeuillet(leafR, (views[spread] || {}).r);
                return true;
            } catch (e) { console.warn('[SP-3D] papiers :', e); return false; }
        },

        /* _SP3D_OMBRE_713 — DEUX LEVIERS DE DIAGNOSTIC, et leur raison d'être.

           Comparer deux rendus pour prouver qu'une ombre se voit ne marche PAS
           tant que la scène bouge : le livre flotte (`Math.sin(t*0.7)*0,014`), donc
           deux captures diffèrent de tout ce balancement. Un premier banc a ainsi
           conclu « 44 % des pixels changent » — et il mesurait le flottement.
           Mesuré ensuite, dans les mêmes conditions : l'ombre ne changeait que
           4 niveaux sur 255, c'est-à-dire RIEN.

           Ces deux leviers rendent la question mesurable : on gèle l'ambiance, on
           pose l'ombre à une valeur choisie, on capture, on recommence. Toute
           différence restante vient alors de l'ombre, et de rien d'autre. */
        _figer: function (v) {
            fige = !!v;
            if (!fige && clock) tAmbiance = clock.elapsedTime;
            return fige;
        },
        _ombreOpacite: function (op) {
            if (!contactShadowMat) return null;
            contactShadowMat.opacity = clamp(Number(op) || 0, 0, 1);
            return contactShadowMat.opacity;
        },
        _ombreVisible: function (v) {
            if (!contactShadow) return null;
            contactShadow.visible = !!v;
            return contactShadow.visible;
        },
        _version: 'v18-papiers-visibles'
    };
})();
