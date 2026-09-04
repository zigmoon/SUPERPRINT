// ═══════════════════════════════════════════════════════════════
//  SuperPrint — patches-core.js
//  Patches Fabric/navigateur 100% autonomes extraits de main.js
//  (extraction modules 2026-08-30 — aucun changement de logique)
//
//  ⚠️ Ce fichier DOIT être chargé avec `defer` AVANT main.js
//  (même ordre d'exécution qu'avant extraction : ces blocs étaient
//   en tête de main.js).
// ═══════════════════════════════════════════════════════════════

// ── FIX 2026-08-31 (filtres images « carré en haut à gauche ») ──
// Le backend WebGL de Fabric applique les filtres dans une texture de
// 2048×2048 px (fabric.textureSize). Pour une image dont une dimension
// dépasse 2048 px, SEUL un carré 2048×2048 en haut à gauche est filtré,
// le reste de l'image devient transparent (PNG) ou blanc (JPEG) — à la
// fois dans l'éditeur et dans les exports. On force le backend Canvas2D
// (sans limite de taille) pour que le filtre couvre TOUTE l'image.
// Ce patch doit être exécuté APRÈS le chargement de fabric.min.js mais
// AVANT tout usage de fabric.initFilterBackend() (fait par main.js).
// NB : fabric.enableGLFiltering est lu par initFilterBackend() au premier
// applyFilters() — le forcer à false suffit (pas besoin de patcher
// initFilterBackend lui-même).
(function spForceCanvas2DFilterBackend() {
    try {
        if (window.fabric && typeof window.fabric.isWebglSupported === 'function') {
            // Désactiver le backend WebGL (limite texture 2048 px) au profit
            // du backend Canvas2D (pas de limite) → filtres sur TOUTE l'image.
            window.fabric.enableGLFiltering = false;
            // Invalider tout backend déjà initialisé pour qu'il soit recréé
            // en Canvas2D au prochain applyFilters().
            if (window.fabric.filterBackend) window.fabric.filterBackend = null;
            console.log('[SP-filter] Backend filtres forcé en Canvas2D (limite WebGL 2048px contournée).');
        }
    } catch (e) {
        console.warn('[SP-filter] Échec force Canvas2D filter backend:', e);
    }
})();

// ── Alerte petit écran : suppression des popups bloquants ──
(function spSuppressSmallScreenAlerts() {
    try {
        const originalAlert = window.alert;
        const originalConfirm = window.confirm;

        const shouldSuppress = (message) => {
            if (typeof message !== 'string') return false;
            return /\b(Écran trop petit|Ecran trop petit|Largeur minimum|Hauteur minimum|SuperPrint nécessite un ordinateur)\b/i.test(message);
        };

        if (typeof originalAlert === 'function') {
            window.alert = function (message) {
                if (shouldSuppress(message)) {
                    console.warn('[SUPERPRINT] Alerte petit écran supprimée:', message);
                    return;
                }
                return originalAlert.apply(this, arguments);
            };
        }

        if (typeof originalConfirm === 'function') {
            window.confirm = function (message) {
                if (shouldSuppress(message)) {
                    console.warn('[SUPERPRINT] Confirmation petit écran supprimée:', message);
                    return true;
                }
                return originalConfirm.apply(this, arguments);
            };
        }
    } catch (e) {
        console.warn('[SUPERPRINT] Échec suppression alertes petit écran:', e);
    }
})();

// ── FIX: Empêcher la sélection native du navigateur sur la zone canvas ──
// Quand l'utilisateur glisse la souris entre des blocs texte Fabric.js,
// le navigateur peut créer une sélection DOM parasite visible en haut à gauche.
(function spPreventNativeCanvasSelection() {
    document.addEventListener('selectstart', function(e) {
        // Allow selection inside form fields (inputs, textareas, contenteditable)
        const tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (e.target && e.target.getAttribute && e.target.getAttribute('contenteditable')) return;
        // Prevent native selection on canvas area and its containers
        const canvasArea = e.target && e.target.closest && (
            e.target.closest('.canvas-wrapper') ||
            e.target.closest('.canvas-scroll-area') ||
            e.target.closest('.canvas-container')
        );
        if (canvasArea) {
            e.preventDefault();
        }
    });
})();

// ── FIX: FileReader — handler onerror par défaut (évite erreurs silencieuses) ──
(function spInstallFileReaderErrorShim() {
    try {
        if (typeof FileReader === 'undefined' || FileReader.prototype.__spErrorShim) return;
        FileReader.prototype.__spErrorShim = true;
        const _origRead = {
            asArrayBuffer: FileReader.prototype.readAsArrayBuffer,
            asDataURL: FileReader.prototype.readAsDataURL,
            asText: FileReader.prototype.readAsText,
            asBinaryString: FileReader.prototype.readAsBinaryString
        };
        function ensureDefaultOnError(reader) {
            if (!reader.onerror) {
                reader.onerror = function (ev) {
                    try {
                        const err = (reader && reader.error) || ev;
                        console.warn('[SP][FileReader] read error (default handler):', err);
                    } catch (_) {}
                };
            }
        }
        FileReader.prototype.readAsArrayBuffer = function () { ensureDefaultOnError(this); return _origRead.asArrayBuffer.apply(this, arguments); };
        FileReader.prototype.readAsDataURL    = function () { ensureDefaultOnError(this); return _origRead.asDataURL.apply(this, arguments); };
        FileReader.prototype.readAsText       = function () { ensureDefaultOnError(this); return _origRead.asText.apply(this, arguments); };
        if (_origRead.asBinaryString) {
            FileReader.prototype.readAsBinaryString = function () { ensureDefaultOnError(this); return _origRead.asBinaryString.apply(this, arguments); };
        }
    } catch (_) { /* no-op : si le shim échoue, comportement identique à avant */ }
})();
