/* SUPER PRINT — PWA bootstrap
   - Registers ./service-worker.js with no HTTP cache for the SW file.
   - Detects new versions and surfaces an "Update available" toast.
   - One-shot reload on controllerchange after user accepts.
   - Periodic + visibility-change update checks. */
(function () {
  if (location.protocol === 'file:' || !('serviceWorker' in navigator)) return;

  const TOAST_ID         = 'sp-update-toast';
  const RELOAD_BTN_ID    = 'sp-update-reload-btn';
  const DISMISS_BTN_ID   = 'sp-update-dismiss-btn';
  const UPDATE_CHECK_MS  = 30 * 60 * 1000; // 30 min

  let waitingWorker      = null;
  let hasReloaded        = false;
  // 💡 FIX 2026-05-01 (double splash a la 1re ouverture / cache vide) :
  //   Capturer l'etat du controleur AU CHARGEMENT. Si la page n'avait pas
  //   de controleur (= toute 1re visite ou cache vide), l'evenement
  //   controllerchange qui suit l'install initiale du SW NE DOIT PAS
  //   declencher un reload — sinon le splash s'affiche deux fois.
  //   On ne reload que pour une vraie mise a jour (controleur deja present
  //   au depart, puis remplace par un nouveau SW).
  const _hadControllerAtBoot = !!navigator.serviceWorker.controller;

  const $ = (id) => document.getElementById(id);

  function setToastVisible(visible) {
    const toast = $(TOAST_ID);
    if (!toast) return;
    toast.hidden = !visible;
    toast.classList.toggle('show', visible);
  }

  function showUpdateToast(registration) {
    if (!registration || !registration.waiting) return;
    // Only show after the page already had a controller — first install is silent.
    if (!navigator.serviceWorker.controller) return;
    waitingWorker = registration.waiting;
    setToastVisible(true);
  }

  function bindUpdates(registration) {
    if (!registration) return;

    if (registration.waiting) showUpdateToast(registration);

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed') showUpdateToast(registration);
      });
    });
  }

  function wireToastButtons() {
    const reloadBtn  = $(RELOAD_BTN_ID);
    const dismissBtn = $(DISMISS_BTN_ID);
    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => {
        if (!waitingWorker) { window.location.reload(); return; }
        reloadBtn.disabled = true;
        reloadBtn.textContent = 'Reloading…';
        waitingWorker.postMessage({ type: 'SKIP_WAITING' });
        // 🛡️ Safety net : si après 4s le controllerchange n'a pas
        // déclenché le reload, on force.
        setTimeout(() => {
          if (!hasReloaded) {
            hasReloaded = true;
            window.location.reload();
          }
        }, 4000);
      });
    }
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => setToastVisible(false));
    }
  }

  // Reload exactly once when the new SW takes control — but only if the page
  // ALREADY had a controller at boot (= real update). On a fresh install
  // (cleared cache / first visit), skip the reload so the splash screen
  // doesn't appear twice.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hasReloaded) return;
    if (!_hadControllerAtBoot) return; // 1re install : pas de reload
    hasReloaded = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    wireToastButtons();
    setToastVisible(false);
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js', {
        updateViaCache: 'none'
      });
      console.log('[SUPER PRINT] Service Worker registered:', registration.scope);
      bindUpdates(registration);

      // Immediate update probe.
      try { await registration.update(); } catch (_) {}

      // Periodic update probe.
      setInterval(() => { registration.update().catch(() => {}); }, UPDATE_CHECK_MS);

      // Update on tab refocus.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          registration.update().catch(() => {});
        }
      });
    } catch (err) {
      console.warn('[SUPER PRINT] Service Worker registration failed:', err);
    }
  });

  // PWA install prompt is captured by the inline script in index.html (subscription gate).
  // We still log appinstalled for diagnostics.
  window.addEventListener('appinstalled', () => {
    console.log('[SUPER PRINT] App installed');
  });
})();
