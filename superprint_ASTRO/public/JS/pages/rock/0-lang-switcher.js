
/* ══════════════ CHANGEMENT DE LANGUE ══════════════
   Même mécanisme que la présentation : le CSS affiche la variante de la langue du
   document ([data-lang] et .inline-xx), on ne fait donc que poser html[lang]. */
function setLang(lang) {
  document.documentElement.lang = lang;
  var bf = document.getElementById('btn-fr'), be = document.getElementById('btn-en'), bj = document.getElementById('btn-ja');
  if (bf) bf.classList.toggle('active', lang === 'fr');
  if (be) be.classList.toggle('active', lang === 'en');
  if (bj) bj.classList.toggle('active', lang === 'ja');
  var _c = document.querySelector('link[rel="canonical"]');
  if (_c) _c.setAttribute('href', 'https://superprint.cc/rock.html' + (lang === 'en' ? '' : '?lang=' + lang));
  try { history.replaceState(null, '', location.pathname + (lang === 'en' ? '' : '?lang=' + lang) + location.hash); } catch (e) {}
  try { localStorage.setItem('sp_landing_lang', lang); localStorage.setItem('sp_lang', lang); } catch (e) {}
  if (typeof window.rkLangue === 'function') window.rkLangue();
}
(function () {
  var saved = null;
  try { saved = localStorage.getItem('sp_landing_lang'); } catch (e) {}
  var urlLang = new URLSearchParams(location.search).get('lang');
  var lang = urlLang || saved || 'en';
  setLang(lang === 'fr' || lang === 'ja' ? lang : 'en');
})();

/* ── menu mobile (burger) ──
   Même mécanisme que la présentation : menu plein écran sous la barre collante, langues
   et bas de page dedans, fermeture par Échap ou par un lien. */
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
  function placer() {
    var barre = document.querySelector('nav');
    var bande = document.querySelector('.brand-header');
    var colo = document.querySelector('.mm-colo');
    var bas = barre ? Math.round(barre.getBoundingClientRect().bottom) : 0;
    if (!(bas > 0) || bas > window.innerHeight - 90) bas = 66;
    var rb = bande ? bande.getBoundingClientRect() : null;
    var hB = rb ? Math.round(rb.height) : 0;
    var haut = (rb && rb.top >= -1) ? Math.round(rb.top) : (bas + 8);
    if (colo) { colo.style.top = haut + 'px'; colo.style.height = hB ? (hB + 'px') : ''; }
    menu.style.paddingTop = (Math.max(bas, haut + hB) + 14) + 'px';
  }
  window.addEventListener('resize', function () { if (menu.classList.contains('open')) placer(); });
  burger.addEventListener('click', function () {
    var open = menu.classList.toggle('open');
    burger.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
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
    if (open) placer();
  });
  menu.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', close); });
  window.addEventListener('resize', function () { if (window.innerWidth > 1000) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
})();
