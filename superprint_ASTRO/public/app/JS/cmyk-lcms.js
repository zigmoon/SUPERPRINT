/* ─────────────────────────────────────────────────────────────────────────
 * SuperPrint — CMYK engine wrapper around lcms-wasm (Little CMS / MIT)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Why LittleCMS:
 *   • Industry-grade ICC color management engine (the same C library used by
 *     GIMP, Krita, Inkscape, Scribus and darktable).
 *   • MIT licence — no copyleft, safe for the SuperPrint commercial PWA.
 *   • Tiny footprint (~310 KB wasm + 65 KB ESM loader) compared to the
 *     previous Ghostscript build (~19 MB, AGPL-3.0).
 *
 * What this wrapper does:
 *   • Lazy-loads `./JS/lcms-wasm/lcms.js` (ES module) on first call.
 *   • Builds and **caches per ICC profile** an sRGB → CMYK transform with
 *     relative-colorimetric intent + black-point compensation + high-res
 *     precalc — the standard prepress recipe.
 *   • Exposes two transform helpers:
 *       _spLcmsTransformRgbBatch(rgbU8, pixelCount, iccBytes, iccName)
 *           → Uint8Array of pixelCount*4 bytes (interleaved C M Y K, 0..255)
 *       _spLcmsTransformRgbColor(r01, g01, b01, iccBytes, iccName)
 *           → { c, m, y, k }   (each in [0..1])
 *   • Plus the bookkeeping helpers _spLcmsAvailable / _spLcmsPreload /
 *     _spLcmsCleanup.
 *
 * Notes:
 *   • The wrapper runs entirely in-browser, no network calls beyond the
 *     local ./JS/lcms-wasm/ folder — respects SuperPrint's "vendor libs
 *     LOCAL ONLY, zero CDN" policy (see index.html, vendor section).
 *   • Each export reuses the cached transform — only the very first
 *     conversion pays the wasm-load + transform-build cost (~50 ms total
 *     on a recent laptop).
 *   • Single-pixel transforms (vector colors in PDF content streams) reuse
 *     the same cached transform via a 1-pixel `cmsDoTransform` call.
 * ───────────────────────────────────────────────────────────────────────── */

(function () {
    'use strict';
    if (typeof window === 'undefined') return;
    if (window._spCmykLcmsLoaded) return;
    window._spCmykLcmsLoaded = true;

    // ── Module-scope cache ────────────────────────────────────────────────
    let _lcmsModulePromise = null;   // Promise<lcms namespace>
    let _lcmsNS            = null;   // resolved lcms namespace
    // Map<iccCacheKey, { transform, srgbProfile, cmykProfile }>
    const _transformCache  = new Map();

    // Identify each ICC by name + first 16 bytes of its header (cheap fingerprint)
    function _iccCacheKey(iccBytes, iccName) {
        const tag = iccName || 'anon';
        if (!iccBytes || iccBytes.length < 16) return tag + ':empty';
        let sig = '';
        for (let i = 0; i < 16; i++) {
            sig += iccBytes[i].toString(16).padStart(2, '0');
        }
        return tag + ':' + sig;
    }

    // ── Lazy ESM loader ───────────────────────────────────────────────────
    async function _loadLcms() {
        if (_lcmsNS) return _lcmsNS;
        if (_lcmsModulePromise) return _lcmsModulePromise;

        _lcmsModulePromise = (async () => {
            // Resolve the ESM relative to the current page (works whether the
            // app is served from /SUPERPRINT/ or from a subpath).
            const moduleUrl = new URL('./JS/lcms-wasm/lcms.js', document.baseURI).href;
            const wasmUrl   = new URL('./JS/lcms-wasm/lcms.wasm', document.baseURI).href;

            // Pre-fetch wasm bytes ourselves so the SW cache + fetch policy
            // applies uniformly, then hand them to Emscripten via locateFile +
            // wasmBinary. We pass wasmBinary too in case `locateFile` resolution
            // races the wasm streaming setup.
            const wasmResp = await fetch(wasmUrl, { cache: 'force-cache' });
            if (!wasmResp.ok) {
                throw new Error('lcms-wasm: HTTP ' + wasmResp.status + ' on ' + wasmUrl);
            }
            const wasmBinary = new Uint8Array(await wasmResp.arrayBuffer());

            // Native dynamic import — no bundler in this app, no CSP wrap needed.
            //
            // ── Workaround: lcms.js (Emscripten MODULARIZE build) calls
            //    `missingGlobal("buffer", ...)` and `missingGlobal("asm", ...)`
            //    at module-eval time, which does
            //       Object.defineProperty(globalThis, "buffer", { configurable:true, get(){…} })
            //    If another vendor library has already installed a
            //    non-configurable own property `buffer` on `globalThis`
            //    (observed in the field with some bundles), this throws
            //    `Cannot redefine property: buffer`, killing the entire
            //    LittleCMS engine and forcing the in-house RGB→CMYK fallback.
            //    Wrap the import + instantiate in a temporary monkey-patch
            //    of `Object.defineProperty` that silently swallows that one
            //    specific clash — strictly scoped to the lcms module load.
            const _origDefineProperty = Object.defineProperty;
            const _isLcmsDiagnosticClash = (target, prop) => {
                if (target !== globalThis && target !== window) return false;
                return prop === 'buffer' || prop === 'asm';
            };
            Object.defineProperty = function (target, prop, descriptor) {
                try {
                    return _origDefineProperty.call(this, target, prop, descriptor);
                } catch (err) {
                    if (_isLcmsDiagnosticClash(target, prop)) {
                        // Diagnostic helper, harmless to drop.
                        return target;
                    }
                    throw err;
                }
            };
            let mod;
            let lcms;
            try {
                mod = await import(moduleUrl);

                lcms = await mod.instantiate({
                    wasmBinary,
                    locateFile(name) {
                        if (name && name.endsWith('.wasm')) return wasmUrl;
                        return name;
                    }
                });
            } finally {
                Object.defineProperty = _origDefineProperty;
            }

            // Hoist constants we'll need at call time onto a plain bag so we
            // don't have to re-import them.
            _lcmsNS = {
                lcms,
                INTENT_RELATIVE_COLORIMETRIC: mod.INTENT_RELATIVE_COLORIMETRIC,
                cmsFLAGS_BLACKPOINTCOMPENSATION: mod.cmsFLAGS_BLACKPOINTCOMPENSATION,
                cmsFLAGS_HIGHRESPRECALC: mod.cmsFLAGS_HIGHRESPRECALC,
                cmsFLAGS_NOCACHE: mod.cmsFLAGS_NOCACHE,
                cmsFLAGS_NOOPTIMIZE: mod.cmsFLAGS_NOOPTIMIZE
            };
            return _lcmsNS;
        })().catch((err) => {
            // Reset so a later retry can re-attempt.
            _lcmsModulePromise = null;
            throw err;
        });

        return _lcmsModulePromise;
    }

    // ── Transform builder (cached per ICC profile) ────────────────────────
    async function _getTransform(iccBytes, iccName) {
        if (!iccBytes || iccBytes.length < 128) {
            throw new Error('lcms-wasm: ICC bytes missing or too short');
        }
        const key = _iccCacheKey(iccBytes, iccName);
        const cached = _transformCache.get(key);
        if (cached) return cached;

        const ns = await _loadLcms();
        const lcms = ns.lcms;

        const srgbProfile = lcms.cmsCreate_sRGBProfile();
        if (!srgbProfile) throw new Error('lcms-wasm: cmsCreate_sRGBProfile() failed');

        const cmykProfile = lcms.cmsOpenProfileFromMem(iccBytes, iccBytes.length);
        if (!cmykProfile) {
            lcms.cmsCloseProfile(srgbProfile);
            throw new Error('lcms-wasm: cmsOpenProfileFromMem() failed for ' + (iccName || 'profile'));
        }

        // 8-bit interleaved formats — picked by the profile's color space.
        // For sRGB → 3-byte RGB; for the destination CMYK profile → 4-byte CMYK.
        const inputFormat  = lcms.cmsFormatterForColorspaceOfProfile(srgbProfile, 1, false);
        const outputFormat = lcms.cmsFormatterForColorspaceOfProfile(cmykProfile, 1, false);

        const flags = ns.cmsFLAGS_BLACKPOINTCOMPENSATION
                    | ns.cmsFLAGS_HIGHRESPRECALC
                    | ns.cmsFLAGS_NOCACHE;

        const transform = lcms.cmsCreateTransform(
            srgbProfile, inputFormat,
            cmykProfile, outputFormat,
            ns.INTENT_RELATIVE_COLORIMETRIC,
            flags
        );
        if (!transform) {
            lcms.cmsCloseProfile(srgbProfile);
            lcms.cmsCloseProfile(cmykProfile);
            throw new Error('lcms-wasm: cmsCreateTransform() failed');
        }

        // Profiles can be released once the transform is created (LCMS
        // copies what it needs internally).
        const entry = { transform, srgbProfile, cmykProfile, ns };
        _transformCache.set(key, entry);
        return entry;
    }

    // ── Public API ────────────────────────────────────────────────────────

    function _spLcmsAvailable() {
        return typeof WebAssembly !== 'undefined';
    }

    async function _spLcmsPreload(iccBytes, iccName) {
        if (!_spLcmsAvailable()) return false;
        try {
            await _getTransform(iccBytes, iccName);
            return true;
        } catch (err) {
            console.warn('[CMYK/lcms] preload failed:', err && err.message ? err.message : err);
            return false;
        }
    }

    async function _spLcmsTransformRgbBatch(rgbU8, pixelCount, iccBytes, iccName) {
        const entry = await _getTransform(iccBytes, iccName);
        const lcms = entry.ns.lcms;
        // cmsDoTransform takes an interleaved typed array sized for the input
        // (3 bytes/pixel for sRGB) and returns a fresh Uint8Array sized for
        // the output (4 bytes/pixel for CMYK). The lcms-wasm wrapper already
        // returns an independent typed-array copy via internal .slice(), so
        // we don't need to re-copy the buffer.
        const need = pixelCount * 3;
        const src = (rgbU8.length === need) ? rgbU8 : rgbU8.subarray(0, need);
        return lcms.cmsDoTransform(entry.transform, src, pixelCount);
    }

    async function _spLcmsTransformRgbColor(r01, g01, b01, iccBytes, iccName) {
        const entry = await _getTransform(iccBytes, iccName);
        const lcms = entry.ns.lcms;
        const clamp = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255);
        const input = new Uint8Array([clamp(r01), clamp(g01), clamp(b01)]);
        const out = lcms.cmsDoTransform(entry.transform, input, 1);
        return {
            c: (out[0] || 0) / 255,
            m: (out[1] || 0) / 255,
            y: (out[2] || 0) / 255,
            k: (out[3] || 0) / 255
        };
    }

    function _spLcmsCleanup() {
        if (!_lcmsNS) return;
        const lcms = _lcmsNS.lcms;
        for (const entry of _transformCache.values()) {
            try { lcms.cmsDeleteTransform(entry.transform); } catch (_) {}
            try { lcms.cmsCloseProfile(entry.srgbProfile); } catch (_) {}
            try { lcms.cmsCloseProfile(entry.cmykProfile); } catch (_) {}
        }
        _transformCache.clear();
    }

    window._spLcmsAvailable = _spLcmsAvailable;
    window._spLcmsPreload = _spLcmsPreload;
    window._spLcmsTransformRgbBatch = _spLcmsTransformRgbBatch;
    window._spLcmsTransformRgbColor = _spLcmsTransformRgbColor;
    window._spLcmsCleanup = _spLcmsCleanup;
})();
