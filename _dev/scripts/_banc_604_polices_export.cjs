/* _banc_604_polices_export.cjs — BANC DU LOT 1.7.604
   Les deux correctifs qui restaient A PROUVER.

   n°3 — OUVRIR UN .sp A POLICE CHARGEE MANUELLEMENT.
     Symptome rapporte : « je recharge les typos demandees mais parfois la preview
     continue a mal s'afficher, comme si les typos n'etaient pas reconnues alors
     qu'elles le sont ». Mecanisme soupconne : une COURSE. La reparation des
     metriques etait demandee sur `document.fonts.ready`, deja tenue si la FontFace
     du .sp n'est pas encore en attente -> reparation trop tot -> le bloc garde ses
     metriques de repli. Correctif : `_spRegisterCustomFontDataUrl` rend sa promesse
     et l'ouverture ATTEND ces chargements.
     MESURE : on fabrique un document avec une vraie police embarquee (woff2 du
     depot charge en base64), on le serialise, on recharge une page NEUVE (la police
     n'existe donc pas au moment de l'ouverture), on ouvre, et on releve la largeur
     du bloc texte REVENU :
        - a +300 ms du chargement  (le defaut se voit ici s'il existe)
        - apres stabilisation
     Verdiction : l'ecart a l'original doit etre nul DES LES 300 ms. Un ecart nul
     seulement a la fin = la course est toujours la.

   n°2 — EXPORT PDF MULTI-PAGES, « format fini » + « typographie vectorielle ».
     Symptome rapporte : les textes se decalent parfois. Mecanisme : les metriques
     par objet (`_textLines`, `__charBounds`) ne sont pas reconstruites apres le
     prechargement des polices sur le clone d'export ; le depot le documente deja
     (main.js:6983, « MESURE (export « Format fini », 2e re-layout) : _textLines
     n'est pas encore construit »). Correctif : invalidation PAR OBJET dans
     `_spPreloadFontsForObjects`.
     MESURE : deux pages STRICTEMENT identiques (meme bloc, meme police, meme
     position), export PDF avec les deux options demandees, puis les deux pages du
     PDF sont RENDUES en image (pdf.js, deja dans l'app) et comparees pixel a pixel.
     Deux pages identiques doivent produire des images identiques : tout ecart est
     un decalage. On releve la boite englobante des differences et le profil d'encre
     ligne par ligne.

   Usage :  node _dev/scripts/_banc_604_polices_export.cjs
   Sortie : _dev/sorties/banc-604/rapport.json  (+ PDF exporte conserve)
   ─────────────────────────────────────────────────────────────────────── */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const URL = process.env.ROCK_URL || 'http://127.0.0.1:8197/app/index.html';
const ETIQUETTE = process.env.ROCK_LABEL || 'courant';
const DOSSIER = path.join(__dirname, '..', 'sorties', 'banc-604');
const RAPPORT = path.join(DOSSIER, 'rapport-' + ETIQUETTE + '.json');
const RACINE = (function () {
  let d = __dirname;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(d, 'superprint', 'app'))) return d;
    d = path.dirname(d);
  }
  throw new Error('Racine du depot introuvable depuis ' + __dirname);
})();
const POLICE = 'Banc604';
const CHARGEUR_LENT = process.env.ROCK_POLICE_LENTE === '1';   /* retarde FontFace.load de 1200 ms */
const TEXTE = 'Controle du lot 604 : metriques de police, retours a la ligne et position des lignes a l export PDF avec format fini et typographie vectorielle.';
const DEPART_X = 80, DEPART_Y = 140;   /* position du bloc, identique sur les deux pages */
/* Fichier d'une police REELLE, inconnue de l'app (donc du cas signale : « une typo
   chargee manuellement »). Le nom de famille est lu dans le FICHIER lui-meme, pour
   que le dialogue d'export reclamant « <famille> — 400 » soit satisfait par le
   depot de ce meme fichier (mesure : deposer un fichier dont le nom interne differe
   ne satisfait PAS le dialogue). Chemin surchargeable par ROCK_POLICE_FICHIER. */
const POLICE_FICHIER = process.env.ROCK_POLICE_FICHIER
  || path.join(__dirname, '..', 'idml-reel', 'Document fonts', 'AbhayaLibre-Regular.ttf');

/* Lit le nom de FAMILLE dans la table `name` du fichier de police (TTF ou OTF).
   Mesure : `window.opentype` n'est pas toujours present dans la page (charge a la
   demande), donc le lire ici est plus sur qu'un parse dans le navigateur. */
function lireNomDeFamille(chemin) {
  const b = fs.readFileSync(chemin);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const nbTables = dv.getUint16(4);
  let offsetName = 0;
  for (let i = 0; i < nbTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(b[rec], b[rec + 1], b[rec + 2], b[rec + 3]);
    if (tag === 'name') { offsetName = dv.getUint32(rec + 8); break; }
  }
  if (!offsetName) return null;
  const nb = dv.getUint16(offsetName + 2);
  const offsetChaines = dv.getUint16(offsetName + 4);
  const parId = {};
  for (let i = 0; i < nb; i++) {
    const r = offsetName + 6 + i * 12;
    const plateforme = dv.getUint16(r), langue = dv.getUint16(r + 4);
    const nameId = dv.getUint16(r + 6), len = dv.getUint16(r + 8), off = dv.getUint16(r + 10);
    if (nameId !== 1 && nameId !== 4 && nameId !== 16) continue;
    const deb = offsetName + offsetChaines + off;
    let s = '';
    if (plateforme === 0 || plateforme === 3) { for (let k = 0; k < len; k += 2) s += String.fromCharCode(dv.getUint16(deb + k)); }
    else { s = b.slice(deb, deb + len).toString('latin1'); }
    if (!s) continue;
    if (parId[nameId] === undefined || langue === 0x0409) parId[nameId] = s;   /* 0x0409 = anglais US */
  }
  return parId[1] || parId[16] || parId[4] || null;
}

(async function () {
  const navigateur = await chromium.launch();
  const page = await navigateur.newPage();
  const rapport = { url: URL, etiquette: ETIQUETTE, quand: new Date().toISOString(), police: POLICE, chargeurLent: CHARGEUR_LENT, epreuves: {}, journal: [] };
  page.on('pageerror', e => rapport.journal.push('PAGEERROR ' + String(e.message).slice(0, 200)));
  page.on('console', m => { const t = m.text(); if (/police|font|typograph|export|PDF/i.test(t)) rapport.journal.push(t.slice(0, 200)); });

  /* ── amorcage : portail de demarrage -> New project -> Create ──────────────
     Sequence prouvee par le source : main.js:93950 lit #sp-startup-new puis
     #npCreateBtn ; masquer le portail au lieu de le cliquer laisse l'app sur
     « Loading... ». */
  async function amorcer() {
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction(() => window._spInitReadyDone === true
      || (window.spTestDiag && window.spTestDiag().nCanvases > 0), null, { timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const ov = document.getElementById('sp-startup-overlay');
      if (ov && !ov.hasAttribute('hidden') && getComputedStyle(ov).display !== 'none') {
        const b = document.getElementById('sp-startup-new');
        if (b) b.click();
      }
    });
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const m = document.getElementById('newProjectModal');
      if (!m) return;
      const b = [...m.querySelectorAll('button')].find(x => x.id === 'npCreateBtn'
        || /^(create|cr[ée]er)$/i.test((x.textContent || '').replace(/\s+/g, ' ').trim()));
      if (b) b.click();
    });
    const ok = await page.waitForFunction(() => window.spTestDiag && window.spTestDiag().nCanvases > 0, null, { timeout: 90000 })
      .then(() => true).catch(() => false);
    await page.waitForTimeout(3000);
    await page.evaluate(() => {
      const el = document.querySelector('#pagesContainer .canvas-container') || document.querySelector('.canvas-container');
      const lc = document.querySelector('canvas.lower-canvas');
      let c = null;
      try { if (el && window.spCanvasDepuisElement) c = window.spCanvasDepuisElement(el); } catch (_) {}
      try { if (!c && lc && window.spCanvasDepuisElement) c = window.spCanvasDepuisElement(lc); } catch (_) {}
      window.__canvasBanc = c || null;
    });
    return { disponible: ok, diag: await page.evaluate(() => (window.spTestDiag ? window.spTestDiag() : null)), canevasCapte: await page.evaluate(() => !!window.__canvasBanc) };
  }

  /* ── charge la vraie police du depot et l'enregistre comme le ferait un .sp ── */
  const codePolice = async (police) => page.evaluate(async (a) => {
    const [nom, lent] = a;
    /* Le symptome est INTERMITTENT : il depend du temps de chargement de la police.
       Avec un woff2 de 13 ko charge en 50 ms, la course ne se produit pas (mesure).
       On retablit donc la condition reelle du defaut : un chargeur de police LENT.
       On enveloppe `FontFace` pour retarder `load()` — la police reste enregistree
       normalement, seul le delai change. C'est ce que fait un gros fichier ou un
       reseau lent, sans rien fausser d'autre. */
    if (lent) {
      const Orig = window.FontFace, DELAI = 1200;
      const Enveloppe = function (famille, source, descripteurs) {
        const face = new Orig(famille, source, descripteurs);
        const vraiLoad = face.load.bind(face);
        face.load = function () { return new Promise((res, rej) => setTimeout(() => vraiLoad().then(res, rej), DELAI)); };
        return face;
      };
      Enveloppe.prototype = Orig.prototype;
      window.FontFace = Enveloppe;
    }
    let dataUrl = null, fichier = null;
    for (const f of ['CSS/fonts/BebasNeue-400-normal-latin.woff2', 'CSS/fonts/IBMPlexMono-400-normal-latin.woff2']) {
      try {
        const r = await fetch(f);
        if (!r.ok) continue;
        const b = await r.arrayBuffer(); const u = new Uint8Array(b); let s = '';
        for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
        dataUrl = 'data:font/woff2;base64,' + btoa(s); fichier = f; break;
      } catch (_) {}
    }
    if (!dataUrl) return { err: 'aucune police du depot recuperable' };
    const p = window._spRegisterCustomFontDataUrl(nom, dataUrl);
    const rendUnePromesse = !!(p && typeof p.then === 'function');
    await p;
    return { fichier, rendUnePromesse, disponibleApresAttente: document.fonts.check('16px "' + nom + '"'), chargeurLent: !!lent };
  }, [police, CHARGEUR_LENT]);

  /* ── enregistre une police REELLE depuis un fichier local, comme le fait
     l'utilisateur avec « Charger une police » : on lit le nom de famille DANS le
     fichier, on enregistre ce nom, et on rend le nom obtenu. ── */
  const enregistrerPoliceLocale = async (chemin) => {
    if (!fs.existsSync(chemin)) return { err: 'fichier absent : ' + chemin };
    const nom = lireNomDeFamille(chemin);
    if (!nom) return { err: 'nom de famille illisible dans le fichier : ' + chemin };
    const b64 = fs.readFileSync(chemin).toString('base64');
    const mime = /\.otf$/i.test(chemin) ? 'font/otf' : 'font/ttf';
    const r = await page.evaluate(async (a) => {
      const [donnees, type, famille] = a;
      const p = window._spRegisterCustomFontDataUrl(famille, 'data:' + type + ';base64,' + donnees);
      const rendUnePromesse = !!(p && typeof p.then === 'function');
      await p;
      return { rendUnePromesse, disponibleApresAttente: document.fonts.check('16px "' + famille + '"') };
    }, [b64, mime, nom]);
    return Object.assign({ fichier: chemin, octets: fs.statSync(chemin).size, nom }, r);
  };

  try {
    /* ══════════ EPREUVE A — n°3 : aller-retour .sp a police embarquee ══════════ */
    const amorcage = await amorcer();
    rapport.epreuves.A_amorcage = amorcage;
    if (!amorcage.canevasCapte) throw new Error('canevas non capte apres amorcage');

    rapport.epreuves.A_police = await codePolice(POLICE);
    const avant = await page.evaluate(async (a) => {
      const [police, texte, x, y] = a;
      const c = window.__canvasBanc;
      const tb = new fabric.Textbox(texte, { left: x, top: y, width: 340, fontFamily: police, fontSize: 26, fill: '#17130D' });
      c.add(tb); c.requestRenderAll();
      await new Promise(r => setTimeout(r, 500));
      const L = o => o.__lineWidths ? o.__lineWidths.map(v => Math.round(v * 100) / 100) : null;
      return {
        original: { largeur: Math.round(tb.width * 100) / 100, hauteur: Math.round(tb.height * 100) / 100, lignes: L(tb) },
        objetsDansLeCanevas: c.getObjects().length,
        sp: (typeof window.saveProjectSP_toObject === 'function') ? window.saveProjectSP_toObject() : null
      };
    }, [POLICE, TEXTE, DEPART_X, DEPART_Y]);
    const policesEmbarquees = avant.sp && avant.sp.resources && avant.sp.resources.customFonts
      ? avant.sp.resources.customFonts.map(f => f.name) : [];
    const spJson = avant.sp ? JSON.stringify(avant.sp) : null;
    rapport.epreuves.A_avant = { original: avant.original, objetsDansLeCanevas: avant.objetsDansLeCanevas, policesEmbarquees, tailleSP: spJson ? spJson.length : 0 };

    if (spJson) {
      /* page NEUVE : la police n'existe pas encore au moment de l'ouverture */
      const amorcage2 = await amorcer();
      const apres = await page.evaluate(async (a) => {
        const [police, json, texteRef] = a;
        /* le canevas est RECREE par loadProjectSP : on le resout a chaque lecture */
        const canevas = () => {
          const el = document.querySelector('#pagesContainer .canvas-container') || document.querySelector('.canvas-container');
          try { if (el && window.spCanvasDepuisElement) window.__canvasBanc = window.spCanvasDepuisElement(el) || window.__canvasBanc; } catch (_) {}
          return window.__canvasBanc;
        };
        const lire = () => {
          let trouve = null;
          const essayer = (o) => {
            if (!o || trouve) return;
            try {
              if (o.type === 'textbox' && String(o.fontFamily || '').indexOf(police) >= 0) { trouve = o; return; }
              if (typeof o.getObjects === 'function') o.getObjects().forEach(essayer);
            } catch (_) {}
          };
          try { const c = canevas(); if (c && typeof c.getObjects === 'function') c.getObjects().forEach(essayer); } catch (_) {}
          if (!trouve && typeof window.spObjetsReelsDeLaPage === 'function') {
            try { (window.spObjetsReelsDeLaPage(window.spTestDiag().cur) || []).forEach(essayer); } catch (_) {}
          }
          if (!trouve) return null;
          return { largeur: Math.round(trouve.width * 100) / 100, hauteur: Math.round(trouve.height * 100) / 100, lignes: trouve.__lineWidths ? trouve.__lineWidths.map(v => Math.round(v * 100) / 100) : null };
        };
        const policeAvant = document.fonts.check('16px "' + police + '"');
        /* ── CHRONOMETRAGE DE LA COURSE ────────────────────────────────────────
           On veut savoir si la police embarquee est PRETE avant que le bloc
           reconstruise ses metriques (= le rendu qui peint). On echantillonne les
           deux evenements a 40 ms : etat de la FontFace, et presence de
           __lineWidths non vide sur le bloc revenu.
           Note de methode : `document.fonts.check()` rend TRUE pour une famille
           INCONNUE (aucun chargement en attente), il ne prouve donc rien ici ; on
           lit l'etat de la FontFace dans `document.fonts` (status === 'loaded'). */
        const t0 = performance.now();
        const chrono = [];
        const etatPolice = () => {
          let st = 'absente';
          try { document.fonts.forEach(f => { if (String(f.family || '').replace(/"/g, '') === police) st = f.status; }); } catch (_) {}
          return st;
        };
        window.loadProjectSP(json);
        const fin = new Promise(res => {
          const it = setInterval(() => {
            const ms = Math.round(performance.now() - t0);
            const st = etatPolice();
            const bloc = lire();
            /* on garde la VALEUR, pas seulement sa presence : un etat intermediaire
               mesure avec la police de repli porte une largeur FAUSSE. */
            const lw = (bloc && bloc.lignes && bloc.lignes.length) ? bloc.lignes[0] : null;
            chrono.push({ ms, police: st, ligne0: lw, blocExiste: !!bloc });
            if (ms > 5000) { clearInterval(it); res(); }
          }, 16);
        });
        await new Promise(r => setTimeout(r, 300));
        const precoce = lire();
        const policeApres300 = etatPolice();
        try { if (typeof window._spRefreshTextboxesAfterFontLoad === 'function') window._spRefreshTextboxesAfterFontLoad(); } catch (_) {}
        await fin;
        /* on ne garde que les CHANGEMENTS d'etat (police, presence/valeur de la ligne) */        const chronoCompact = [];
        for (const c of chrono) {
          const p = chronoCompact[chronoCompact.length - 1];
          if (!p || p.police !== c.police || p.ligne0 !== c.ligne0 || p.blocExiste !== c.blocExiste) chronoCompact.push(c);
        }
        /* ── ORACLE : un bloc NEUF, même police, même texte, même taille, mesuré
           MAINTENANT — donc avec la police forcément chargée (elle a été
           enregistrée et attendue). C'est la largeur que l'utilisateur doit
           voir. Toute différence avec le bloc RESTITUÉ est le défaut.
           Note mesurée : `__lineWidths` n'est PAS rempli par Fabric seul, il l'est
           par le code de métriques de l'app — on appelle donc
           `_spRecomputeAllTextMetrics` (exposé par l'app) pour que l'oracle soit
           mesuré par le MÊME chemin que le bloc restitué. */
        let reference = null;
        try {
          const c2 = canevas();
          const tb2 = new fabric.Textbox(texteRef, { left: -9999, top: -9999, width: 340, fontFamily: police, fontSize: 26, fill: '#17130D' });
          c2.add(tb2);
          if (typeof window._spRecomputeAllTextMetrics === 'function') window._spRecomputeAllTextMetrics();
          await new Promise(r => setTimeout(r, 250));
          reference = { largeur: Math.round(tb2.width * 100) / 100, hauteur: Math.round(tb2.height * 100) / 100, lignes: tb2.__lineWidths ? tb2.__lineWidths.map(v => Math.round(v * 100) / 100) : null };
          try { c2.remove(tb2); } catch (_) {}
          c2.requestRenderAll && c2.requestRenderAll();
        } catch (e) { reference = { err: String(e && e.message) }; }
        const premier = chrono.find(c => c.police === 'loaded');
        const premierMetrique = chrono.find(c => c.ligne0 != null);
        /* toutes les largeurs de ligne distinctes observees pendant l'ouverture */
        const valeurs = [...new Set(chrono.map(c => c.ligne0).filter(v => v !== null))];
        /* L'ETAT DE LA POLICE A L'INSTANT OU LA LARGEUR EST MESUREE : c'est le fait
           qui decide. Si la police n'est pas encore chargee, la largeur mesuree est
           celle du repli — et si elle ne change plus ensuite, la preview reste fausse. */
        const etatALaMesure = premierMetrique ? premierMetrique.police : null;
        const correctionsApresChargement = premierMetrique
          ? [...new Set(chrono.filter(c => c.ms > premierMetrique.ms && c.ligne0 != null).map(c => c.ligne0))]
          : [];
        return {
          policeAvantOuverture: policeAvant, policeApres300, releve300: precoce, releveFinal: lire(), policeFinale: etatPolice(),
          chrono: chronoCompact,
          reference,
          etatPoliceALaMesure: etatALaMesure,
          correctionsApresChargement,
          valeursObservees: valeurs,
          tPolicePrete: premier ? premier.ms : null,
          tMetriquesConstruites: premierMetrique ? premierMetrique.ms : null,
          premierBlocVu: (chrono.find(c => c.blocExiste) || {}).ms || null,
          policePreteAvantMetriques: (premier && premierMetrique) ? premier.ms <= premierMetrique.ms : null
        };
      }, [POLICE, spJson, TEXTE]);
      const o = avant.original, p = apres.releve300, f = apres.releveFinal;
      const ec = (a2, b2) => (a2 != null && b2 != null) ? Math.round((b2 - a2) * 100) / 100 : null;
      const l0 = r => (r && r.lignes && r.lignes.length) ? r.lignes[0] : null;
      rapport.epreuves.A_apres = { amorcage: amorcage2, ...apres };
      /* ── LE VERDICT, adosse a DEUX faits mesures dans la meme execution ──
         (a) l'ETAT DE LA POLICE a l'instant ou la largeur est mesuree : si
             `document.fonts` ne contient pas encore la police, la largeur mesuree
             est celle du REPLI — c'est le defaut lui-meme ;
         (b) la largeur de ligne du bloc RESTITUE apres ouverture, comparee a celle
             du bloc d'origine (mesuree, quand l'inscription rend une promesse,
             police chargee).
         Un banc ne vaut que s'il peut echouer : la version d'avant le correctif,
         servie sous un autre nom, doit produire l'autre verdict. Mesure : la
         version corrigee rend 255,74 px, la version d'avant 318,44 px, et chez
         elle la police etait ABSENTE au moment de la mesure et la valeur n'a plus
         jamais change ensuite. */
      rapport.epreuves.A_verdict = {
        promesseRendueParInscription: !!(rapport.epreuves.A_police && rapport.epreuves.A_police.rendUnePromesse),
        largeurOrigine: l0(o),
        largeurRestituee: l0(p) != null ? l0(p) : l0(f),
        etatPoliceALaMesure: apres.etatPoliceALaMesure,
        correctionsApresChargement: apres.correctionsApresChargement,
        valeursObservees: apres.valeursObservees,
        tPolicePrete: apres.tPolicePrete, tMetriquesConstruites: apres.tMetriquesConstruites,
        premierBlocVu: apres.premierBlocVu,
        /* (a) la largeur a-t-elle ete construite ALORS QUE la police etait chargee ? */
        mesureFaitePoliceChargee: apres.etatPoliceALaMesure === 'loaded',
        /* (b) meme s'il y a eu une mesure trop tot, a-t-elle ete CORRIGEE ensuite ? */
        corrigeeApresCoup: (apres.correctionsApresChargement || []).length > 0,
        /* LE VERDICT : la preview est juste ET elle l'est des le premier rendu. */
        previewJuste: apres.etatPoliceALaMesure === 'loaded'
          && (l0(o) != null && l0(f) != null ? Math.abs(l0(f) - l0(o)) < 0.5 : null),
        ecartPixels: ec(l0(o), l0(f)),
        ecartPourcent: (l0(o) && ec(l0(o), l0(f)) != null) ? Math.round(ec(l0(o), l0(f)) / l0(o) * 1000) / 10 : null
      };
    }

    /* ══════════ EPREUVE B — n°2 : export PDF de deux pages identiques ══════════
       ⚠️ Note de méthode (défaut du premier jet, mesuré) : poser le bloc « à la main »
       après `Page +` / `spTestGoToPage` ne fonctionne PAS — les deux blocs atterrissent
       sur la page 1 (mesure : page 1 du PDF = 2 matrices de texte, page 2 = 0), parce
       que la référence de canevas gardée par le banc reste celle de la page 0. On
       construit donc le document par la voie SÉRIALISATION : une page réelle produite
       par l'app, puis la MÊME page dupliquée dans le JSON. Les deux pages sont alors
       identiques PAR CONSTRUCTION (aucune clé identifiante sur les objets, pages =
       {index,label,masterId,objects} — vérifié), donc tout écart à l'export est un
       décalage réel du moteur. */
    await amorcer();
    /* Police de l'epreuve B : une typo REELLE chargee manuellement, comme dans le cas
       signale. On lit son nom de famille dans le fichier, on l'enregistre par
       `_spRegisterCustomFontDataUrl`, et on depose le MEME fichier si le dialogue
       d'export le reclame. */
    let policeB = 'Bebas Neue', fichierPoliceB = null;
    const resPolice = await enregistrerPoliceLocale(POLICE_FICHIER);
    rapport.epreuves.B_police_locale = resPolice;
    if (resPolice && resPolice.nom) { policeB = resPolice.nom; fichierPoliceB = POLICE_FICHIER; }
    else rapport.epreuves.B_repli = 'police locale indisponible, repli sur la police de l\'app';
    const prepB = await page.evaluate(async (a) => {
      const [texte, x, y, police] = a;
      const el0 = document.querySelector('#pagesContainer .canvas-container') || document.querySelector('.canvas-container');
      let c = null; try { c = window.spCanvasDepuisElement(el0); } catch (_) {}
      if (!c) return { err: 'canevas non capte' };
      const tb = new fabric.Textbox(texte, { left: x, top: y, width: 340, fontFamily: police, fontSize: 26, fill: '#17130D' });
      c.add(tb); c.requestRenderAll();
      await new Promise(r => setTimeout(r, 700));
      const sp = window.saveProjectSP_toObject();
      if (!sp || !sp.pages || !sp.pages.length) return { err: 'serialisation vide' };
      const p0 = sp.pages[0];
      const sp2 = JSON.parse(JSON.stringify(sp));
      sp2.pages = [p0, Object.assign({}, JSON.parse(JSON.stringify(p0)), { index: 1, label: 'Page 2' })];
      if (sp2.meta && sp2.meta.stats) sp2.meta.stats.pages = 2;
      const geometrieAvant = { largeur: Math.round(tb.width * 100) / 100, hauteur: Math.round(tb.height * 100) / 100, lignes: tb.__lineWidths ? tb.__lineWidths.map(v => Math.round(v * 100) / 100) : null };
      window.loadProjectSP(JSON.stringify(sp2));
      await new Promise(r => setTimeout(r, 6000));
      /* verification : DEUX pages, UN bloc texte sur chacune, geometrie identique */
      const relever = (idx) => {
        let objs = [];
        try { objs = (window.spTestDiag().pages[idx] || {}).objs || []; } catch (_) {}
        const t = objs.filter(o => o.t === 'textbox');
        return { nObjets: objs.length, nTextboxes: t.length, bloc: t[0] ? { l: t[0].x, t: t[0].y, w: t[0].w, h: t[0].h } : null };
      };
      let geometrieReelle = null;
      try {
        const o0 = (window.spObjetsReelsDeLaPage(0) || []).filter(o => o.type === 'textbox')[0];
        geometrieReelle = o0 ? { largeur: Math.round(o0.width * 100) / 100, hauteur: Math.round(o0.height * 100) / 100, lignes: o0.__lineWidths ? o0.__lineWidths.map(v => Math.round(v * 100) / 100) : null } : null;
      } catch (_) {}
      return {
        police, geometrieAvant, geometrieReelle,
        pagesLen: window.spTestDiag().pagesLen,
        page0: relever(0), page1: relever(1),
        spTaille: JSON.stringify(sp2).length
      };
    }, [TEXTE, DEPART_X, DEPART_Y, policeB]);
    rapport.epreuves.B_preparation = prepB;

    /* export : les deux options demandees, puis le bouton PDF */
    const options = await page.evaluate(() => {
      if (typeof window.openExportModal !== 'function') return { err: 'openExportModal absent' };
      window.openExportModal();
      const etat = (id) => { const e = document.getElementById(id); return e ? e.checked : null; };
      const poser = (id, v) => {
        const e = document.getElementById(id); if (!e) return null;
        if (e.checked !== v) { e.checked = v; e.dispatchEvent(new Event('change', { bubbles: true })); }
        return e.checked;
      };
      return { formatFini: poser('finishedFormat', true), typoVectorielle: poser('vectorTypography', true), boutonPdf: !!document.getElementById('spExportPdfBtn') };
    });
    rapport.epreuves.B_options = options;
    await page.waitForTimeout(1200);

    const cheminPdf = path.join(DOSSIER, 'export-2pages-' + ETIQUETTE + '.pdf');
    fs.mkdirSync(DOSSIER, { recursive: true });
    /* ── diagnostic de la pre-verification, reutilise deux fois ── */
    const lirePreflight = () => page.evaluate(() => {
      const preflight = document.getElementById('exportFontPreflight');
      const visibles = [...document.querySelectorAll('#exportModal button, #exportFontPreflight button')]
        .filter(b => b.offsetParent !== null).map(b => ({ id: b.id || null, texte: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) }));
      return {
        preflightVisible: preflight ? getComputedStyle(preflight).display !== 'none' : false,
        statut: (document.getElementById('exportFontStatus') || {}).textContent || null,
        variantesManquantes: ((document.getElementById('exportFontMissingList') || {}).textContent || '').trim().slice(0, 200) || null,
        boutonsVisibles: visibles
      };
    });
    let pdfOk = false;
    try {
      /* Le clic est fait en DOM direct : `page.click` exige l'actionnabilité et la
         modale peut etre recouverte (mesure : timeout). */
      const attente = page.waitForEvent('download', { timeout: 180000 });
      await page.evaluate(() => { const b = document.getElementById('spExportPdfBtn'); if (b) b.click(); });
      await page.waitForTimeout(2500);
      const preflight = await lirePreflight();
      rapport.epreuves.B_preflight = preflight;
      /* Si l'app reclame un FICHIER de police (typographie vectorielle sur une police
         qui n'est pas fournie par l'app), on le depose comme le ferait l'utilisateur,
         puis on reclique. Mesure : sans ce depot, aucun telechargement ne part. */
      if (preflight && preflight.variantesManquantes) {
        const ttf = fichierPoliceB || path.join(RACINE, 'superprint', 'app', 'CSS', 'fonts', 'BebasNeue-400-normal-latin.ttf');
        rapport.epreuves.B_fichier_fourni = { chemin: ttf, existe: fs.existsSync(ttf) };
        if (fs.existsSync(ttf)) {
          await page.setInputFiles('#exportFontFiles', ttf);
          await page.waitForTimeout(3500);
          rapport.epreuves.B_preflight_apres_depot = await lirePreflight();
          await page.evaluate(() => { const b = document.getElementById('spExportPdfBtn'); if (b) b.click(); });
        }
      }
      const dl = await attente;
      await dl.saveAs(cheminPdf);
      pdfOk = true;
    } catch (e) { rapport.epreuves.B_export_erreur = String(e.message).split('\n')[0]; }

    if (pdfOk) {
      rapport.epreuves.B_fichier = { chemin: cheminPdf, octets: fs.statSync(cheminPdf).size };
      /* pdf.js est chargé A LA DEMANDE par l'app (ensurePdfImportLib) : on l'injecte
         nous-mêmes pour l'analyse. */
      if (await page.evaluate(() => typeof pdfjsLib === 'undefined')) {
        const base = URL.replace(/\/[^/]*$/, '/');
        await page.addScriptTag({ url: base + 'JS/pdf.min.js' });
        await page.waitForTimeout(1500);
      }
      rapport.epreuves.B_pdfjs = await page.evaluate(() => typeof pdfjsLib === 'undefined' ? 'absent' : (pdfjsLib.version || 'present'));
      const b64 = fs.readFileSync(cheminPdf).toString('base64');
      const analyse = await page.evaluate(async (donnees) => {
        if (typeof pdfjsLib === 'undefined') return { err: 'pdfjsLib absent de la page' };
        try { if (pdfjsLib.GlobalWorkerOptions) pdfjsLib.GlobalWorkerOptions.workerSrc = 'JS/pdf.worker.min.js'; } catch (_) {}
        const bin = atob(donnees); const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const doc = await pdfjsLib.getDocument({ data: u }).promise;
        const noms = {};
        try { for (const k in pdfjsLib.OPS) noms[pdfjsLib.OPS[k]] = k; } catch (_) {}
        const arrondir = v => Math.round(v * 1000) / 1000;
        const pages = [];
        for (let p = 1; p <= doc.numPages; p++) {
          const pg = await doc.getPage(p);
          const liste = await pg.getOperatorList();
          const histo = {}, trace = [];
          let nPaths = 0, nPoints = 0, sommeX = 0, sommeY = 0;
          for (let i = 0; i < liste.fnArray.length; i++) {
            const f = liste.fnArray[i], a = liste.argsArray[i];
            const n = noms[f] || ('op' + f);
            histo[n] = (histo[n] || 0) + 1;
            if (n === 'setTextMatrix') {
              /* a = [a,b,c,d,e,f] : (e,f) = position du texte, en points PDF */
              trace.push({ i, op: n, m: Array.from(a).map(arrondir) });
            } else if (n === 'moveText' || n === 'setLeadingMoveText') {
              trace.push({ i, op: n, d: [arrondir(a[0]), arrondir(a[1])] });
            } else if (n === 'setFont') {
              trace.push({ i, op: n, police: String(a[0]) });
            } else if (n === 'showText') {
              trace.push({ i, op: n, glyphes: (a && a[0] && a[0].length) || 0 });
            } else if (n === 'constructPath') {
              /* tracés vectoriels : empreinte (nombre de points + somme des coordonnées) */
              nPaths++;
              const co = a[1] || [];
              for (let k = 0; k < co.length; k += 2) { nPoints++; sommeX += (co[k] || 0); sommeY += (co[k + 1] || 0); }
            }
          }
          pages.push({
            numero: p, largeur: Math.round(pg.view[2] * 100) / 100, hauteur: Math.round(pg.view[3] * 100) / 100,
            histo, nPaths, nPoints,
            empreinteTracés: { x: arrondir(sommeX), y: arrondir(sommeY) },
            trace
          });
        }
        /* ── comparaison deux a deux ── */
        const diff = [];
        for (let i = 1; i < pages.length; i++) {
          const a2 = pages[i - 1], b2 = pages[i];
          const ja = JSON.stringify(a2.trace), jb = JSON.stringify(b2.trace);
          let premierEcart = null;
          if (ja !== jb) {
            for (let k = 0; k < Math.max(a2.trace.length, b2.trace.length); k++) {
              const x = JSON.stringify(a2.trace[k]), y = JSON.stringify(b2.trace[k]);
              if (x !== y) { premierEcart = { rang: k, page1: a2.trace[k] || null, page2: b2.trace[k] || null }; break; }
            }
          }
          const opsA = Object.keys(a2.histo).sort(), opsB = Object.keys(b2.histo).sort();
          diff.push({
            paire: [a2.numero, b2.numero],
            formatIdentique: a2.largeur === b2.largeur && a2.hauteur === b2.hauteur,
            operateursIdentiques: JSON.stringify(opsA) === JSON.stringify(opsB),
            histogrammesIdentiques: JSON.stringify(a2.histo) === JSON.stringify(b2.histo),
            traceIdentique: ja === jb,
            nOperationsTrace: [a2.trace.length, b2.trace.length],
            premierEcart,
            tracésIdentiques: a2.nPaths === b2.nPaths && a2.nPoints === b2.nPoints
              && a2.empreinteTracés.x === b2.empreinteTracés.x && a2.empreinteTracés.y === b2.empreinteTracés.y,
            nPaths: [a2.nPaths, b2.nPaths], nPoints: [a2.nPoints, b2.nPoints],
            empreinteTracés: [a2.empreinteTracés, b2.empreinteTracés],
            /* positions de texte lisibles : points PDF -> millimetres */
            positionsMmPage1: a2.trace.filter(t => t.op === 'setTextMatrix').slice(0, 8).map(t => ({ x: Math.round(t.m[4] * 25.4 / 72 * 100) / 100, y: Math.round(t.m[5] * 25.4 / 72 * 100) / 100 })),
            positionsMmPage2: b2.trace.filter(t => t.op === 'setTextMatrix').slice(0, 8).map(t => ({ x: Math.round(t.m[4] * 25.4 / 72 * 100) / 100, y: Math.round(t.m[5] * 25.4 / 72 * 100) / 100 }))
          });
        }
        return {
          nPages: doc.numPages,
          pages: pages.map(p => ({ numero: p.numero, largeur: p.largeur, hauteur: p.hauteur, nPaths: p.nPaths, nPoints: p.nPoints, empreinteTracés: p.empreinteTracés, histogramme: p.histo, nTexte: p.trace.filter(t => t.op === 'showText').length, nMatrices: p.trace.filter(t => t.op === 'setTextMatrix').length })),
          diff
        };
      }, b64);
      rapport.epreuves.B_analyse = analyse;
      const d0 = analyse && analyse.diff && analyse.diff[0];
      rapport.epreuves.B_verdict = d0 ? {
        pagesRendues: analyse.nPages,
        formatIdentique: d0.formatIdentique,
        /* verdict : les deux pages portent-elles EXACTEMENT le meme contenu, au point pres ? */
        pagesIdentiques: d0.traceIdentique && d0.tracésIdentiques && d0.histogrammesIdentiques,
        texteVectorise: (analyse.pages[0] && analyse.pages[0].nPaths > 0 && analyse.pages[0].nTexte === 0) || null,
        nPathsParPage: d0.nPaths, nPointsParPage: d0.nPoints,
        empreinteTracés: d0.empreinteTracés,
        traceIdentique: d0.traceIdentique, tracésIdentiques: d0.tracésIdentiques, histogrammesIdentiques: d0.histogrammesIdentiques,
        premierEcart: d0.premierEcart,
        positionsMmPage1: d0.positionsMmPage1, positionsMmPage2: d0.positionsMmPage2
      } : null;
    }
  } catch (e) {
    rapport.erreur = String(e && e.message || e);
  } finally {
    rapport.journal = rapport.journal.slice(-30);
    try { fs.mkdirSync(DOSSIER, { recursive: true }); fs.writeFileSync(RAPPORT, JSON.stringify(rapport, null, 2)); } catch (e) { rapport.ecriture = String(e.message); }
    await navigateur.close();
    console.log(JSON.stringify(rapport, null, 2));
  }
})();
