/* _banc_604_demarrage.cjs — CONTRÔLE DE DEMARRAGE APRES BUMP.
   Le bump ne touche que des chaines, mais il touche le tag de cache du Service
   Worker et la requete `?v=` de main.js : si l'un des deux est incoherent, l'app
   sert l'ANCIEN moteur (defaut deja rencontre pendant ce chantier) ou ne demarre
   pas. On verifie donc sur la page servie : la version annoncee partout, et que
   le canevas est reellement initialise.
   Usage : node _dev/scripts/_banc_604_demarrage.cjs
   ─────────────────────────────────────────────────────────────────────────── */
'use strict';
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const URL = process.env.ROCK_URL || 'http://127.0.0.1:8197/app/index.html';
const ATTENDU = '1.7.604';

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const r = { url: URL, attendu: ATTENDU, controles: {}, verdict: null };
  try {
    await p.goto(URL, { waitUntil: 'load' });
    await p.waitForFunction(() => window._spInitReadyDone === true
      || (window.spTestDiag && window.spTestDiag().nCanvases > 0), null, { timeout: 90000 }).catch(() => {});
    await p.waitForTimeout(2000);
    /* Le portail de demarrage doit etre CLIQUE (le masquer laisse l'app sur
       « Loading... » — commentaire du source, main.js:93926). Sans ce clic, le
       canevas n'existe pas et le controle d'initialisation serait faux. */
    await p.evaluate(() => {
      const ov = document.getElementById('sp-startup-overlay');
      if (ov && !ov.hasAttribute('hidden') && getComputedStyle(ov).display !== 'none') {
        const b = document.getElementById('sp-startup-new');
        if (b) b.click();
      }
    });
    await p.waitForTimeout(2500);
    await p.evaluate(() => {
      const m = document.getElementById('newProjectModal');
      if (!m) return;
      const b = [...m.querySelectorAll('button')].find(x => x.id === 'npCreateBtn'
        || /^(create|cr[ée]er)$/i.test((x.textContent || '').replace(/\s+/g, ' ').trim()));
      if (b) b.click();
    });
    await p.waitForFunction(() => window.spTestDiag && window.spTestDiag().nCanvases > 0, null, { timeout: 90000 }).catch(() => {});
    await p.waitForTimeout(2000);
    r.controles.page = await p.evaluate(() => ({
      dataSpJs: (document.getElementById('spVersionBadge') || document.querySelector('[data-sp-js]') || {}).getAttribute
        ? (document.querySelector('[data-sp-js]') || {}).dataset.spJs : null,
      titreBadge: (document.querySelector('[data-sp-js]') || {}).getAttribute
        ? (document.querySelector('[data-sp-js]') || {}).title : null,
      splash: (document.querySelector('.splash-version') || {}).textContent || null,
      generator: (document.querySelector('meta[name="generator"]') || {}).content || null,
      jsonLd: (() => {
        try {
          const s = document.querySelector('script[type="application/ld+json"]');
          if (!s) return null;
          /* le JSON-LD du fichier porte un COMMENTAIRE : JSON.parse echoue, mesure
             faite. On lit donc la valeur par expression, avec parse en secours. */
          const m = s.textContent.match(/"softwareVersion"\s*:\s*"([^"]+)"/);
          if (m) return m[1];
          return JSON.parse(s.textContent).softwareVersion || null;
        } catch (_) { return null; }
      })(),
      pagesLen: window.spTestDiag ? window.spTestDiag().pagesLen : null,
      nCanvases: window.spTestDiag ? window.spTestDiag().nCanvases : null,
      mainJsCharge: [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).filter(s => /main\.js/.test(s))
    }));
    /* version.txt vit a la RACINE du site, pas dans app/ : un fetch relatif depuis
       /app/index.html tomberait sur /app/version.txt (404, mesure faite). */
    r.controles.versionTxt = await p.evaluate(async () => (await (await fetch('/version.txt')).text()).trim());
    r.controles.serviceWorker = await p.evaluate(async () => {
      const t = await (await fetch('service-worker.js')).text();
      const m = t.match(/CACHE_NAME\s*=\s*'([^']+)'/);
      return m ? m[1] : null;
    });
    const c = r.controles;
    r.verdict = {
      /* le badge porte le TAG COURT (data-sp-js="v604"), pas la version complete */
      badgeAfficheLaBonneVersion: String(c.page.dataSpJs || '').replace(/^v/, '') === ATTENDU.split('.').pop(),
      badgeCacheTagCoherent: /JS v604/.test(String(c.page.titreBadge || '')),
      splashBon: String(c.page.splash || '').includes(ATTENDU),
      generatorBon: String(c.page.generator || '').includes(ATTENDU),
      jsonLdBon: String(c.page.jsonLd || '') === ATTENDU,
      versionTxtBon: c.versionTxt === ATTENDU,
      cacheServiceWorkerBon: String(c.serviceWorker || '') === 'superprint-shell-v1.7.604-polices-et-export',
      requeteMainJsAVersionDuBump: (c.page.mainJsCharge || []).every(s => /v604/.test(s)),
      applicationDemarree: (c.page.pagesLen || 0) > 0 && (c.page.nCanvases || 0) > 0
    };
    r.verdict.toutConforme = Object.values(r.verdict).every(v => v === true);
  } catch (e) { r.erreur = String(e.message).split('\n')[0]; }
  finally {
    const d = path.join(__dirname, '..', 'sorties', 'banc-604');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'demarrage.json'), JSON.stringify(r, null, 2));
    await b.close();
    console.log(JSON.stringify(r, null, 2));
  }
})();
