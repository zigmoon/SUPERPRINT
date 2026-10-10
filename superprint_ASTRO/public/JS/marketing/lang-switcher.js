
// ── Language switcher ──
/* Ajoute (ou retire) « ?lang=xx » sur les liens vers les trois outils. Les paramètres
   déjà présents (?tpl=…, ?from=…) sont conservés. Fonction déclarée : elle est hissée,
   donc utilisable par setLang() juste en dessous. */
function appliquerLangueAuxLiens(lang) {
  var outils = ["app/index.html", "sp213-studio.html", "supertypo/index.html"];
  document.querySelectorAll("a[href]").forEach(function (a) {
    var href = a.getAttribute("href") || "";
    var q = href.indexOf("?");
    var chemin = (q < 0 ? href : href.slice(0, q));
    if (outils.indexOf(chemin.replace(/^\.\//, "")) < 0) return;
    var params = new URLSearchParams(q < 0 ? "" : href.slice(q + 1));
    if (lang === "en") params["delete"]("lang"); else params.set("lang", lang);
    /* 🆕 v1.7.580tt — LE STUDIO PART SUR SA PRÉ-HOME (demande utilisateur) :
       « home=1 » demande à sp213-studio.html d'afficher son écran de démarrage,
       avec la langue choisie ici (les deux paramètres cohabitent). */
    if (chemin.replace(/^\.\//, "") === "sp213-studio.html") params.set("home", "1");
    var s = params.toString();
    a.setAttribute("href", chemin + (s ? "?" + s : ""));
  });
}
function setLang(lang, explicite) {
  document.documentElement.lang = lang;
  document.getElementById('btn-fr').classList.toggle('active', lang === 'fr');
  document.getElementById('btn-en').classList.toggle('active', lang === 'en');
  document.getElementById('btn-ja').classList.toggle('active', lang === 'ja');
  // Langues du menu mobile
  document.querySelectorAll('.mbtn-lang').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-lang') === lang);
  });
  /* 🆕 v1.7.468 — Référencement trilingue : chaque langue a son URL et se déclare
     elle-même en canonical (un hreflang pointant vers une URL canonisée ailleurs est
     ignoré). L'adresse doit suivre, d'où le replaceState : sans lui, le canonical
     désignerait une autre URL que celle affichée dans la barre. */
  /* 🆕 v1.7.470 — l'adresse canonique suit la LANGUE *et* la PAGE : la page d'aide
     (price.html) réutilise ce script et doit se déclarer elle-même, pas la racine. */
  var _chemin = location.pathname.replace(/\/index\.html$/, '/');
  var _base = 'https://superprint.cc' + _chemin;
  var _ref = (lang === 'en') ? _base : _base + '?lang=' + lang;
  var _c = document.querySelector('link[rel="canonical"]');
  if (_c) _c.setAttribute('href', _ref);
  var _o = document.querySelector('meta[property="og:url"]');
  if (_o) _o.setAttribute('content', _ref);
  try {
    history.replaceState(null, '', location.pathname + (lang === 'en' ? '' : '?lang=' + lang) + location.hash);
  } catch (e) {}
  try { localStorage.setItem('sp_landing_lang', lang); } catch(e) {}
  /* 🆕 v1.7.503 — LA LANGUE CHOISIE ICI SUIT LE VISITEUR DANS NOS LOGICIELS.
     On écrit la clé PARTAGÉE `sp_lang` (celle que relisent l'application et le studio)
     et on pose « ?lang=xx » sur les liens des trois outils : le choix s'applique donc
     à l'ouverture, même si le stockage local est bloqué ou vidé.
     `explicite === false` = langue de référence par défaut (anglais) : on n'écrit RIEN,
     sinon une simple visite sur cette page remettrait à zéro un choix fait dans l'app. */
  if (explicite !== false) {
    try { localStorage.setItem('sp_lang', lang); } catch (e) {}
  }
  appliquerLangueAuxLiens(lang);
}

// ── Langue initiale : ANGLAIS PAR DÉFAUT ──
//   🎯 v1.7.417 — On ne se base PLUS sur navigator.language.
//   Avant : la détection du navigateur faisait qu'un visiteur francophone voyait
//   la page en français, alors que le document se déclare <html lang="en">, que
//   les métadonnées et le JSON-LD sont en anglais, que les hreflang donnent
//   x-default à la page SANS paramètre, et que llms.txt / llms-full.txt sont en
//   anglais. Cette incohérence nuisait au référencement : le moteur voyait de
//   l'anglais, l'utilisateur du français.
//   Ordre de priorité conservé :
//     1. ?lang=xx    — les hreflang et les liens partagés gardent la main ;
//     2. préférence enregistrée — si l'utilisateur a choisi FR ou JP, on la respecte ;
//     3. anglais     — sinon, la langue de référence.
(function() {
  var saved = null;
  try { saved = localStorage.getItem('sp_landing_lang'); } catch(e) {}
  var params = new URLSearchParams(location.search);
  var urlLang = params.get('lang');
  var lang = urlLang || saved || 'en';
  /* `false` sur la branche par défaut : l'anglais de référence n'est pas un choix,
     on n'écrase donc pas la préférence enregistrée par l'application. */
  if (lang === 'fr') setLang('fr');
  else if (lang === 'ja') setLang('ja');
  else setLang('en', false);
})();

// ── Smooth anchor scrolling for nav ──
document.querySelectorAll('a[href^="#"]').forEach(function(a) {
  a.addEventListener('click', function(e) {
    /* v1.7.467 — `href="#"` (liens des pop-ins légaux) donnait querySelector('#') :
       sélecteur invalide, erreur en console. On ignore les ancres vides. */
    var href = this.getAttribute('href');
    if (!href || href.length < 2) return;
    var target = document.querySelector(href);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// ── Menu mobile (burger) ──
(function () {
  var burger = document.getElementById('navBurger');
  var menu = document.getElementById('mobileMenu');
  if (!burger || !menu) return;
  function close() {
    burger.classList.remove('open');
    menu.classList.remove('open');
    burger.setAttribute('aria-expanded', 'false');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    document.documentElement.classList.remove('sp-menu-ouvert');   /* 🆕 v1.7.591 — on déping le la barre */
  }
  /* 🆕 v1.7.472 — LE MENU SE POSE SOUS LA BARRE COLLANTE, ET PAS SOUS UNE HAUTEUR FIXE.
     Le header mobile n’est pas une bande unique : bandeau quadri + colophon (logo) + nav
     collante. Un « top: 66px » figé recouvrait donc le colophon et laissait la fin du menu
     sortir de l’écran. On mesure le bas de la nav À L’OUVERTURE et on borne la hauteur au
     reste visible ; on refait la mesure au redimensionnement et à la rotation. */
  function spPlacerMenu() {
    var barre = document.querySelector('nav');
    var bande = document.querySelector('.brand-header');
    var colo = document.querySelector('.mm-colo');   /* 🆕 v1.7.572 — il est HORS du menu (voir la règle CSS) */
    var bas = barre ? Math.round(barre.getBoundingClientRect().bottom) : 0;
    if (!(bas > 0) || bas > window.innerHeight - 90) bas = 66;
    /* 🆕 v1.7.495 — LE LOGO NE DESCEND PLUS. Le colophon du menu n'est plus empilé sous la barre
       collante : on le repose EXACTEMENT sur la bande de la page (même haut, même hauteur),
       donc le logo icon ne bouge pas à l'ouverture. Quand la bande de la page est sortie de
       l'écran (page défilée), on la range sous la barre — sinon elle passerait derrière elle. */
    var rb = bande ? bande.getBoundingClientRect() : null;
    var hB = rb ? Math.round(rb.height) : 0;
    var haut = (rb && rb.top >= -1) ? Math.round(rb.top) : (bas + 8);
    if (colo) {
      colo.style.top = haut + 'px';
      colo.style.height = hB ? (hB + 'px') : '';
    }
    /* 🆕 v1.7.472 — menu PLEIN ÉCRAN : il occupe tout le viewport et c'est son contenu qui
       démarre sous la barre (padding), la barre restant au-dessus pour fermer — et sous le
       colophon s'il a été rangé là. */
    /* 🆕 v1.7.572 — l'air sous la barre passe de 8 à 14 px (les entrées « étaient un peu
       hautes ») : le bandeau du logo étant en position:fixed, il est hors flux, et c'est ce
       rembourrage qui réserve sa place au-dessus de la première entrée. */
    menu.style.paddingTop = (Math.max(bas, haut + hB) + 14) + 'px';
    menu.style.maxHeight = '';
    menu.style.top = '';
  }
  /* 🆕 v1.7.472 — LA BARRE EST « RÉTRACTÉE » QUAND ELLE EST COLLÉE EN HAUT.
     Le logotype n’a pas le même centrage optique au repos et une fois collé : on pose une
     classe quand le défilement atteint le haut de la nav (mesuré, pas une valeur en dur). */
  (function () {
    var barre = document.querySelector('nav');
    if (!barre) return;
    function majEtat() {
      var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      var haut = barre.getBoundingClientRect().top + y;   /* position naturelle dans la page */
      var colle = y >= (haut - 1);
      barre.classList.toggle('is-stuck', colle);
      if (menu.classList.contains('open')) spPlacerMenu();
    }
    window.addEventListener('scroll', majEtat, { passive: true });
    window.addEventListener('resize', majEtat);
    majEtat();
  })();
  window.addEventListener('resize', function () { if (menu.classList.contains('open')) spPlacerMenu(); });
  window.addEventListener('orientationchange', function () { if (menu.classList.contains('open')) spPlacerMenu(); });
  burger.addEventListener('click', function () {
    var open = menu.classList.toggle('open');
    burger.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    /* 🆕 v1.7.549 — verrouille le scroll de fond : sinon la scrollbar de la page reste active
       et passe par-dessus la ligne du burger/logo pendant que le menu plein écran est ouvert. */
    /* 🆕 v1.7.591 — ON MESURE AVANT DE POSER LE VERROU : `overflow: hidden` sur html/body
       DÉTRUIT la position collante, la barre retombe à sa place statique et le bouton burger
       quitte l'écran (mesuré : top −624, menu impossible à refermer). On épingle donc la
       barre quand elle était DÉJÀ collée — jamais dans l'autre cas, sinon elle sauterait vers
       le haut. Le style de la classe `sp-menu-ouvert` est dans le bloc @media(max-width:1000px). */
    var navEl = document.querySelector('nav');
    var hautColle = parseFloat(getComputedStyle(navEl).top) || 0;
    var colle = navEl.getBoundingClientRect().top <= hautColle + 0.5;
    document.documentElement.style.overflow = open ? 'hidden' : '';
    document.body.style.overflow = open ? 'hidden' : '';
    document.documentElement.classList.toggle('sp-menu-ouvert', open && colle);
    if (open) spPlacerMenu();          /* mesure au moment où l’on ouvre */
  });
  /* Un ancrage du menu referme et remet la barre en haut, prête pour la prochaine ouverture. */
  menu.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () { menu.style.paddingTop = ''; menu.style.top = ''; menu.style.maxHeight = ''; });
  });
  menu.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', close);
  });
  // Ferme si redimensionnement vers desktop
  window.addEventListener('resize', function () {
    if (window.innerWidth > 1000) close();
  });
  // Ferme à l'appui sur Échap
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });
})();

// ── Installateur local : OS + onglets + copie ──
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var INSTALL_CMDS = { win: 'npx.cmd superprint', mac: 'npx superprint', linux: 'npx superprint' };
  var INSTALL_HINTS = {
    win: { en: 'PowerShell · npx.cmd bypasses the script ExecutionPolicy block', fr: 'PowerShell · npx.cmd contourne le blocage de scripts (ExecutionPolicy)', ja: 'PowerShell · npx.cmd はスクリプト実行ポリシーの制限を回避します' },
    mac: { en: 'Terminal · installs and launches SuperPrint (requires Node.js)', fr: 'Terminal · installe et lance SuperPrint (requiert Node.js)', ja: 'ターミナル · SuperPrint をインストールして起動します（Node.js が必要）' },
    linux: { en: 'Terminal · installs and launches SuperPrint (requires Node.js)', fr: 'Terminal · installe et lance SuperPrint (requiert Node.js)', ja: 'ターミナル · SuperPrint をインストールして起動します（Node.js が必要）' }
  };
  var OS_ICONS = {
    win: '<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><rect x="0" y="0" width="10.5" height="10.5"/><rect x="13.5" y="0" width="10.5" height="10.5"/><rect x="0" y="13.5" width="10.5" height="10.5"/><rect x="13.5" y="13.5" width="10.5" height="10.5"/></svg>',
    mac: '<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.56-1.702"/></svg>',
    linux: '<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 12 18.5 4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M12 12 5 5.8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M12 12 6.2 19.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/></svg>'
  };
  function langKey() { try { var l = localStorage.getItem('sp_landing_lang'); return (l === 'fr' || l === 'ja') ? l : 'en'; } catch(e) { return 'en'; } }
  function setOsIcon(os) { var ic = $('osIcon'); if (ic) ic.innerHTML = OS_ICONS[os] || OS_ICONS.win; }
  function applyOS(os) {
    var tab = document.querySelector('.cmd-tab[data-os="' + os + '"]') || document.querySelector('.cmd-tab[data-os="win"]');
    document.querySelectorAll('.cmd-tab').forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');
    var key = tab.getAttribute('data-os');
    $('installCmd').textContent = INSTALL_CMDS[key];
    var hints = INSTALL_HINTS[key] || {};
    $('installHint').textContent = hints[langKey()] || hints.en || '';
    setOsIcon(key);
  }
  document.querySelectorAll('.cmd-tab').forEach(function (tab) {
    tab.addEventListener('click', function () { applyOS(tab.getAttribute('data-os')); });
  });
  var ua = navigator.userAgent || '';
  var os = /Windows/i.test(ua) ? 'win' : (/Mac|iPhone|iPad|iPod/i.test(ua) ? 'mac' : (/Linux|X11|CrOS/i.test(ua) ? 'linux' : 'win'));
  if (document.querySelector('.cmd-tab')) applyOS(os);

  document.querySelectorAll('[data-copy="installCmd"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = ($('installCmd').textContent || '').trim();
      var oldHTML = btn.innerHTML;
      var doneLabel = { fr: 'Copié', en: 'Copied', ja: 'コピー済み' }[langKey()] || 'Copied';
      var done = function () {
        btn.innerHTML = '<svg viewBox="0 0 24 24" style="width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"><polyline points="20 6 9 17 4 12"/></svg>' + '<span>' + doneLabel + '</span>';
        btn.style.pointerEvents = 'none';
        setTimeout(function () { btn.innerHTML = oldHTML; btn.style.pointerEvents = ''; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
      } else { fallbackCopy(text, done); }
    });
  });
  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove(); done();
  }
})();
