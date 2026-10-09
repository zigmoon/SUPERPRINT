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
                    pages.push(shot(px, hw));       capPlan.push(plan(px, hw));
                    pages.push(shot(px + hw, hw));  capPlan.push(plan(px + hw, hw));
                } else {
                    pages.push(shot(px, cw));       capPlan.push(plan(px, cw));
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
    function makeFoldTexture(darkAtLeft) {
        var w = 256, h = 8;
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        var ctx = cv.getContext('2d');
        var g = ctx.createLinearGradient(0, 0, w, 0);
        // [position le long de la feuille, alpha] — position 0 = côté reliure.
        var stops = [
            [0.00, 0.66], [0.14, 0.50], [0.32, 0.22], [0.50, 0.06], [0.66, 0.00], [1.00, 0.00]
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
    function makeContactShadowTexture() {
        var s = 256;
        var cv = document.createElement('canvas'); cv.width = s; cv.height = s;
        var ctx = cv.getContext('2d');
        var g = ctx.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
        g.addColorStop(0, 'rgba(0,0,0,0.72)');
        g.addColorStop(0.42, 'rgba(0,0,0,0.42)');
        g.addColorStop(0.72, 'rgba(0,0,0,0.13)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
        var t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
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
                '<div class="sp3d-row"><label>Rotation</label><input type="range" id="sp3dRot" min="-180" max="180" step="1"><span class="sp3d-val" id="sp3dRotV"></span></div>' +
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
            if (contactShadowMat) contactShadowMat.opacity = (T.shadow != null ? T.shadow : 0.4);
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
        // Le DOS des pages (le papier) : NON ÉCLAIRÉ (MeshBasicMaterial) pour rester
        // d'un BLANC PUR garanti, quel que soit l'éclairage du thème, + fog coupé
        // (sinon une page vue de loin se teinte vers la couleur du brouillard →
        //  effet « papier marron » quand on dézoome).
        var paperMatB = new THREE.MeshBasicMaterial({ map: paperTex, side: THREE.FrontSide });
        paperMatB.toneMapped = false;
        paperMatB.fog = false;

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
            var b = new THREE.Mesh(geoPlane, paperMatB);
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

        layoutLeaves();
        updateContactShadowSize();
    }

    function updateContactShadowSize() {
        if (!contactShadow) return;
        contactShadow.scale.set(pageW * 2 + pageW * 0.55, pageW * 0.95, 1);
    }

    // Positionne les demies-feuilles de part et d'autre de la reliure (x = 0)
    // et leur donne un léger « V » (volume du pli d'un livre ouvert).
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
        var ffA = flipper.userData && flipper.userData.foldA;
        var ffB = flipper.userData && flipper.userData.foldB;
        [ffA, ffB].forEach(function (f) { if (f) { f.scale.set(foldW, PAGE_H, 1); f.position.x = foldW / 2; } });
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
        setMat(f, leafTexture(frontIdx));
        setMat(b, leafTexture(backIdx));
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
                if (contactShadow) contactShadow.position.x = bookGroup.position.x;
                if (intro >= 1) {
                    // Flottement d'ambiance : il s'ESTOMPE à mesure qu'on se rapproche de
                    // la vue « à plat » (phi → 90°) pour ne pas gêner la lecture précise
                    // et laisser le document parfaitement droit sur demande.
                    var idle = 1 - clamp((phi - 1.34) / (Math.PI / 2 - 1.34), 0, 1);
                    bookGroup.position.y = PAGE_H * 0.5 + 0.06 + Math.sin(t * 0.7) * 0.014 * idle;
                    bookGroup.rotation.z = roll + Math.sin(t * 0.45) * 0.008 * idle;
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
            setTimeout(function () {
                if (!open) return;
                requestAnimationFrame(function () {
                    if (!open) return;
                    try { bootCapture(); } catch (e) { console.warn('[SP-3D] boot :', e); close(); }
                });
            }, 90);
        } catch (e) {
            console.warn('[SP-3D] ouverture :', e);
            close();
        }
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
            // Une entrée par page (les échecs valent null → texture papier).
            texes = arr; N = arr.length;
            if (!N) { toast('Aperçu 3D : impossible de préparer les pages.'); close(); return; }

            // Aspect : on prend la première page réellement chargée.
            var ref = null;
            for (var i = 0; i < arr.length; i++) { if (arr[i] && arr[i].image && arr[i].image.width) { ref = arr[i]; break; } }
            if (ref) {
                var aspect = ref.image.width / ref.image.height;
                pageW = PAGE_H * aspect;
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
            layoutLeaves();
            fitCamera();
            views = buildViews(N);
            spread = 0;
            updateOffsetFor(0);
            if (bookGroup) bookGroup.position.x = offsetTarget;   // pas de glissement à la 1re vue
            applyView();
            updateGutterVisibility();
            syncSettings();
            syncBgSeg();

            // Re-capture des pages dont la texture a échoué (souvent la couverture
            // ou le dos de couverture) → on ne « perd » plus une page.
            var missingIdx = [];
            for (var mi = 0; mi < arr.length; mi++) if (!arr[mi]) missingIdx.push(mi);
            if (missingIdx.length) {
                Promise.all(missingIdx.map(function (idx) {
                    return recapturePage(idx).then(function (t) { if (t) texes[idx] = t; });
                })).then(function () {
                    if (open) applyView();   // réapplique les feuilles avec les textures récupérées
                });
            }

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
                views: views.map(function (v) { return (v.l + 1) + '/' + (v.r + 1); }),
                leafL: leafInfo(leafL), leafR: leafInfo(leafR), flip: leafInfo(flipper),
                bookX: bookGroup ? +bookGroup.position.x.toFixed(3) : null,
                foldCount: foldMats.length,
                ndc: ndc
            } : null;
        },
        _version: 'v14-ombre-instantanee-flip'
    };
})();
