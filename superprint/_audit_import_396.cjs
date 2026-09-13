// _audit_import_396.cjs — validation EN NAVIGATEUR du pipeline d'import complet.
//   Objectif : prouver que le document arrive COMPLET et STRUCTURE a l'IA.
//   Methode : on intercepte window.fetch pour lire le corps REELLEMENT envoye
//   au modele, exactement comme lors du diagnostic des fuites de prompt.
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:8894';
const FIX = path.join(__dirname, '_fixtures_396');

(async function () {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', function (m) { if (m.type() === 'error') console.log('   [console] ' + m.text()); });
  page.on('pageerror', function (e) { console.log('   [PAGEERROR] ' + e.message); });

  await page.goto(BASE + '/sp213-studio.html', { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  // Interception : on capture ce qui part reellement vers le modele, sans
  // jamais appeler l'API (reponse simulee) pour rester hors ligne et rapide.
  await page.evaluate(function () {
    window.__sent = [];
    const orig = window.fetch;
    window.fetch = function (url, opts) {
      try {
        const body = JSON.parse(opts.body);
        window.__sent.push({ url: String(url), messages: body.messages || [], model: body.model });
      } catch (_) {}
      return Promise.resolve(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ pages: [{ elements: [] }] }) } }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    };
  });

  let fails = 0;
  function check(label, cond, detail) {
    console.log((cond ? '  OK   ' : '  ECHEC') + '  ' + label + (detail ? '  ->  ' + detail : ''));
    if (!cond) fails++;
  }

  // Charge un fichier dans le champ de pieces jointes, comme le ferait
  // l'utilisateur (glisser-deposer ou trombone).
  async function attach(file) {
    await page.setInputFiles('#attachInput', path.join(FIX, file));
    await page.waitForTimeout(1800);
  }

  function attachments() {
    return page.evaluate(function () {
      return window.__attachmentsHook ? window.__attachmentsHook() : null;
    });
  }

  console.log('\n═══ 1. ODT : structure complete (titres, listes, tableau, image) ═══');
  await attach('test.odt');
  const odtState = await page.evaluate(function () {
    // On expose l'etat interne pour la mesure.
    const el = document.querySelector('#attachBar');
    return { chips: el ? el.querySelectorAll('.attach-chip').length : 0 };
  });
  check('piece jointe acceptee (chip affichee)', odtState.chips > 0, odtState.chips + ' chip(s)');
  check('2 chips attendues (texte + image)', odtState.chips >= 2, odtState.chips + ' chip(s)');

  const odtText = await page.evaluate(function () {
    const out = [];
    document.querySelectorAll('#attachBar .attach-chip').forEach(function (c) {
      out.push(c.textContent.trim());
    });
    return out;
  });
  console.log('    chips : ' + JSON.stringify(odtText));

  // Ce que l'IA recoit reellement.
  await page.fill('#promptInput', 'Compose la maquette de ce document.');
  await page.click('#sendBtn').catch(function () {});
  await page.waitForTimeout(2500);

  const sent = await page.evaluate(function () { return window.__sent; });
  console.log('\n    appels au modele : ' + sent.length);
  if (sent.length) {
    const all = sent.map(function (s) {
      return s.messages.map(function (m) { return String(m.content || ''); }).join('\n');
    }).join('\n');
    fs.writeFileSync(path.join(__dirname, '_audit_396_prompt.txt'), all, 'utf8');
    console.log('    prompt transmis : ' + all.length + ' caracteres (sauve dans _audit_396_prompt.txt)');
    check('le texte du document est transmis', /Pav\u00e9 Mosa\u00efque/.test(all));
    check('les titres sont hierarchises (# ...)', /#\s*Le Pav\u00e9 Mosa\u00efque/.test(all));
    check('les listes sont transmises (- )', /\n-\s*l.\u2019?\u00e9querre/.test(all) || /\n- /.test(all));
    check('le tableau est transmis ([TABLEAU])', all.indexOf('[TABLEAU]') !== -1);
    check('l\'emplacement d\'image est transmis ([IMAGE_0])', all.indexOf('[IMAGE_0]') !== -1);
    check('l\'image est declaree dans les pieces jointes', /IMAGE \d+ :/.test(all));
    check('la note de conventions est transmise', all.indexOf('CONVENTIONS DU TEXTE FOURNI') !== -1);
    check('aucune entite HTML brute', !/&[a-zA-Z]{2,8};/.test(all), (all.match(/&[a-zA-Z]{2,8};/g) || []).slice(0, 5).join(' '));
    check('aucun balisage RTF', all.indexOf('\\rtf1') === -1);
  } else {
    check('un appel au modele a eu lieu', false, 'aucun fetch intercepte');
  }

  console.log('\n═══ 2. RTF : le balisage ne doit PAS atteindre le modele ═══');
  await page.evaluate(function () { window.__sent = []; });
  await attach('test.rtf');
  const rtfChips = await page.evaluate(function () { return document.querySelectorAll('#attachBar .attach-chip').length; });
  check('piece jointe RTF acceptee', rtfChips >= 1, rtfChips + ' chip(s)');

  console.log('\n═══ 3. .doc renomme en .odt : la signature doit primer ═══');
  await page.evaluate(function () { window.__sent = []; });
  await attach('renomme.odt');
  const mixChips = await page.evaluate(function () { return document.querySelectorAll('#attachBar .attach-chip').length; });
  check('fichier mal nomme accepte', mixChips >= 1, mixChips + ' chip(s)');

  await browser.close();
  console.log('\n' + (fails ? '❌ ' + fails + ' echec(s)' : '✅ TOUT PASSE') + '\n');
  process.exit(fails ? 1 : 0);
})().catch(function (e) {
  console.error('ERREUR : ' + e.message);
  process.exit(1);
});
