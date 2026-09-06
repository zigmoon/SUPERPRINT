/* ─────────────────────────────────────────────────────────────
   SUPER PRINT – Service Worker
   App-shell precache + smart fetch strategies + clean updates.
   ───────────────────────────────────────────────────────────── */

const CACHE_NAME = 'superprint-shell-v1.7.335-no-whatsapp';

/* ── App shell (precached on install) ─────────────────────── */
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.png',
  './CSS/main.css',
  './CSS/mobile-widgets.css',
  './SP/super_print_logo_blanc.svg',
  './JS/main.js',
  './JS/patches-core.js',
  './JS/pwa.js',
  './JS/simple-pen-tool.js',
  './JS/mobile-widgets.js',
  './JS/collab.js',
  './JS/fabric.min.js',
  './JS/jspdf.umd.min.js',
  './JS/svg2pdf.umd.min.js',
  './JS/opentype.min.js',
  './JS/wawoff2.js',
  './JS/fontkit.min.js',
  './JS/pdf-lib.min.js',
  './JS/cmyk-lcms.js',
  // NB: ./JS/lcms-wasm/lcms.js (~66 KB ESM) and ./JS/lcms-wasm/lcms.wasm
  //     (~310 KB) are intentionally NOT precached. They are fetched + cached
  //     lazily on the first CMYK export via the default cacheFirst strategy,
  //     so users who never export CMYK never pay the bandwidth cost.
  './JS/jszip.min.js',
  './JS/pdf.min.js',
  './JS/pdf.worker.min.js',
  './JS/paper-full.min.js',
  './JS/mammoth.min.js',
  './JS/hypher.js',
  './JS/hyphenation-fr.js',
  './JS/hyphenation-en.js',
  './JS/hyphenation-de.js',
  './JS/hyphenation-es.js',
  './JS/hyphenation-it.js',
  './CSS/fonts.css',
  './CSS/fonts/BebasNeue-400-normal-latin.woff2',
  './CSS/fonts/BebasNeue-400-normal-latin-ext.woff2',
  './CSS/fonts/FiraCode-400-normal-latin.woff2',
  './CSS/fonts/FiraCode-400-normal-latin-ext.woff2',
  './CSS/fonts/IBMPlexMono-400-italic-latin.woff2',
  './CSS/fonts/IBMPlexMono-400-italic-latin-ext.woff2',
  './CSS/fonts/IBMPlexMono-400-normal-latin.woff2',
  './CSS/fonts/IBMPlexMono-400-normal-latin-ext.woff2',
  './CSS/fonts/JetBrainsMono-400-italic-latin.woff2',
  './CSS/fonts/JetBrainsMono-400-italic-latin-ext.woff2',
  './CSS/fonts/JetBrainsMono-400-normal-latin.woff2',
  './CSS/fonts/JetBrainsMono-400-normal-latin-ext.woff2',
  './CSS/fonts/Lato-400-italic-latin.woff2',
  './CSS/fonts/Lato-400-italic-latin-ext.woff2',
  './CSS/fonts/Lato-400-normal-latin.woff2',
  './CSS/fonts/Lato-400-normal-latin-ext.woff2',
  './CSS/fonts/Lato-700-italic-latin.woff2',
  './CSS/fonts/Lato-700-italic-latin-ext.woff2',
  './CSS/fonts/Lato-700-normal-latin.woff2',
  './CSS/fonts/Lato-700-normal-latin-ext.woff2',
  './CSS/fonts/Montserrat-400-italic-latin.woff2',
  './CSS/fonts/Montserrat-400-italic-latin-ext.woff2',
  './CSS/fonts/Montserrat-400-normal-latin.woff2',
  './CSS/fonts/Montserrat-400-normal-latin-ext.woff2',
  './CSS/fonts/OpenSans-400-italic-latin.woff2',
  './CSS/fonts/OpenSans-400-italic-latin-ext.woff2',
  './CSS/fonts/OpenSans-400-normal-latin.woff2',
  './CSS/fonts/OpenSans-400-normal-latin-ext.woff2',
  './CSS/fonts/PlayfairDisplay-400-italic-latin.woff2',
  './CSS/fonts/PlayfairDisplay-400-italic-latin-ext.woff2',
  './CSS/fonts/PlayfairDisplay-400-normal-latin.woff2',
  './CSS/fonts/PlayfairDisplay-400-normal-latin-ext.woff2',
  './CSS/fonts/Poppins-400-italic-latin.woff2',
  './CSS/fonts/Poppins-400-italic-latin-ext.woff2',
  './CSS/fonts/Poppins-400-normal-latin.woff2',
  './CSS/fonts/Poppins-400-normal-latin-ext.woff2',
  './CSS/fonts/Poppins-600-italic-latin.woff2',
  './CSS/fonts/Poppins-600-italic-latin-ext.woff2',
  './CSS/fonts/Poppins-600-normal-latin.woff2',
  './CSS/fonts/Poppins-600-normal-latin-ext.woff2',
  './CSS/fonts/Poppins-700-italic-latin.woff2',
  './CSS/fonts/Poppins-700-italic-latin-ext.woff2',
  './CSS/fonts/Poppins-700-normal-latin.woff2',
  './CSS/fonts/Poppins-700-normal-latin-ext.woff2',
  './CSS/fonts/Roboto-400-italic-latin.woff2',
  './CSS/fonts/Roboto-400-italic-latin-ext.woff2',
  './CSS/fonts/Roboto-400-normal-latin.woff2',
  './CSS/fonts/Roboto-400-normal-latin-ext.woff2',
  './CSS/fonts/SpaceMono-400-italic-latin.woff2',
  './CSS/fonts/SpaceMono-400-italic-latin-ext.woff2',
  './CSS/fonts/SpaceMono-400-normal-latin.woff2',
  './CSS/fonts/SpaceMono-400-normal-latin-ext.woff2',
  './CSS/fonts/SpaceMono-700-italic-latin.woff2',
  './CSS/fonts/SpaceMono-700-italic-latin-ext.woff2',
  './CSS/fonts/SpaceMono-700-normal-latin.woff2',
  './CSS/fonts/SpaceMono-700-normal-latin-ext.woff2',
  './icons/icon-72x72.png',
  './icons/icon-96x96.png',
  './icons/icon-128x128.png',
  './icons/icon-144x144.png',
  './icons/icon-152x152.png',
  './icons/icon-192x192.png',
  './icons/icon-384x384.png',
  './icons/icon-512x512.png',
  './icons/text.svg',
  './icons/image.svg',
  './icons/rect.svg',
  './icons/circle.svg',
  './icons/star.svg',
  './icons/freeform-pen.svg',
  './icons/pen.svg',
  './icons/assets.svg',
  './icons/rulers.svg',
  './icons/grid.svg',
  // ICC profiles (Adobe end-user license, bundled 2026-05-02 v062)
  './icc/CoatedFOGRA39.icc',
  './icc/USWebCoatedSWOP.icc',
  './icc/JapanColor2001Coated.icc'
];

const APP_SHELL_PATHS = new Set(
  APP_SHELL.map((asset) => new URL(asset, self.location.href).pathname)
);

/* ── CDN: politique 100% local (2026-05-05) ───────────────
 * SuperPrint ne charge plus aucune ressource depuis un CDN.
 * Toutes les polices, scripts et profils ICC sont auto-heberges.
 * On garde la liste vide pour conserver la branche de strategie
 * mais aucune URL n'y est jamais matchee.
 */
const CDN_HOSTS = new Set([]);

/* ── Never cache (dynamic / API / user-side endpoints) ────── */
const NEVER_CACHE_PATTERNS = [
  'ai-proxy.php',
  'download.php',
  'picsum.photos',
  'api.pinata.cloud',
  'gateway.pinata.cloud'
];

/* ── Helpers ──────────────────────────────────────────────── */
function isCacheableResponse(response) {
  return !!response && (response.status === 200 || response.type === 'opaque');
}

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  // Use individual fetches so a single 404 doesn't blow up the install.
  await Promise.all(APP_SHELL.map(async (asset) => {
    try {
      const url = new URL(asset, self.location.href);
      const response = await fetch(url, { cache: 'no-cache' });
      if (isCacheableResponse(response)) {
        await cache.put(url, response.clone());
      }
    } catch (err) {
      // Non-fatal: tolerate missing optional assets in dev/local.
      console.warn('[SW] Precache skipped:', asset, err && err.message);
    }
  }));
}

/* ── Install ──────────────────────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(precacheAppShell());
  // 🛡️ NOTE 2026-06-14 : skipWaiting() N'est PAS appelé ici.
  //   On laisse l'utilisateur décider quand activer la nouvelle
  //   version via le toast "Update available" → bouton Reload.
  //   Le skipWaiting est déclenché par message depuis pwa.js.
});

/* ── Skip-waiting from page (update toast → reload) ───────── */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ── Activate: drop old caches + claim + nav preload ──────── */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => {
      if (key !== CACHE_NAME) return caches.delete(key);
      return Promise.resolve();
    }));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (_) {}
    }
    await self.clients.claim();
  })());
});

/* ── Fetch strategy ───────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache: let the network handle it.
  if (NEVER_CACHE_PATTERNS.some((p) => url.href.includes(p))) return;

  // CDN assets: stale-while-revalidate
  if (CDN_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Cross-origin (other than CDN) → bypass.
  if (url.origin !== self.location.origin) return;

  // HTML navigations: network-first (fresh shell), fallback to cached index.
  if (request.mode === 'navigate') {
    event.respondWith(navigationStrategy(event));
    return;
  }

  // Same-origin shell asset → stale-while-revalidate
  if (APP_SHELL_PATHS.has(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Same-origin everything else → cache-first with network fallback
  event.respondWith(cacheFirst(request));
});

/* ── Strategies ───────────────────────────────────────────── */
function isShellNavigation(url) {
  // Treat only the SUPERPRINT root or explicit index.html as the offline shell —
  // sub-pages like landing.html must not overwrite the cached app shell.
  return url.pathname.endsWith('/')
      || url.pathname.endsWith('/index.html');
}

async function navigationStrategy(event) {
  const requestUrl = new URL(event.request.url);
  const shellKey   = new URL('./index.html', self.location.href);

  try {
    const preload = await event.preloadResponse;
    if (preload) {
      if (isShellNavigation(requestUrl)) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(shellKey, preload.clone()).catch(() => {});
      }
      return preload;
    }
    const response = await fetch(event.request);
    if (isCacheableResponse(response) && isShellNavigation(requestUrl)) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(shellKey, response.clone()).catch(() => {});
    }
    return response;
  } catch (_) {
    const cached = await caches.match(shellKey);
    if (cached) return cached;
    return new Response('Offline — SUPER PRINT cache not ready', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (_) {
    return new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkPromise = fetch(request).then((response) => {
    if (isCacheableResponse(response)) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  }).catch(() => cached);
  return cached || networkPromise;
}
