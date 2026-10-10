
(function () {
  var pop = document.getElementById('pay-pop');
  if (!pop) return;

  var frame = document.getElementById('pay-pop-frame');
  var fermer = document.getElementById('pay-pop-close');
  var boutons = document.querySelectorAll('a.help-pay-btn');
  var ouvertPar = null;

  var mots = {
    fr: { cadre: 'Paiement PayPal — 39 € par an', fermer: 'Fermer' },
    en: { cadre: 'PayPal payment — €39 per year', fermer: 'Close' },
    ja: { cadre: 'PayPal でのお支払い — 39 ユーロ／年', fermer: '閉じる' }
  };
  function langue() { return mots[document.documentElement.lang] ? document.documentElement.lang : 'fr'; }

  /* Le lien de secours visible dans le pied (une variante par langue). */
  function secours() {
    var l = pop.querySelectorAll('.pay-pop-secours');
    for (var i = 0; i < l.length; i++) { if (l[i].offsetParent !== null) return l[i]; }
    return l[0] || null;
  }

  function ouvrir(bouton) {
    ouvertPar = bouton;
    var url = bouton.getAttribute('href');
    if (frame.getAttribute('src') !== url) frame.setAttribute('src', url);
    var s = secours();
    if (s) s.setAttribute('href', url);
    frame.setAttribute('title', mots[langue()].cadre);
    fermer.setAttribute('aria-label', mots[langue()].fermer);
    fermer.setAttribute('title', mots[langue()].fermer);
    pop.classList.add('open');
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    fermer.focus();
  }

  function fermerPop() {
    pop.classList.remove('open');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    if (ouvertPar) ouvertPar.focus();
    ouvertPar = null;
  }

  for (var i = 0; i < boutons.length; i++) {
    boutons[i].addEventListener('click', function (e) {
      if (this.hasAttribute('data-nopop')) return;  // offre ponctuelle / don : ouverture directe en onglet
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;  // « ouvrir dans un onglet » reste possible
      e.preventDefault();
      ouvrir(this);
    });
  }

  fermer.addEventListener('click', fermerPop);
  pop.addEventListener('mousedown', function (e) { if (e.target === pop) fermerPop(); });
  document.addEventListener('keydown', function (e) {
    if (!pop.classList.contains('open')) return;
    if (e.key === 'Escape') { fermerPop(); return; }
    /* Le tour de tabulation reste dans la pop-in : l'ordre est celui du DOM — fermeture,
       cadre, lien de secours — et non « la fermeture puis le cadre puis le lien » à la
       fortune : mesuré, le lien est APRÈS le cadre, donc un piège qui croit le cadre en
       dernier laisse sortir le focus par le lien. */
    if (e.key !== 'Tab') return;
    var ordre = [fermer, frame];
    var s = secours();
    if (s) ordre.push(s);
    var k = ordre.indexOf(document.activeElement);
    /* « -1 » : le focus est DANS le cadre (document tiers) — le navigateur gère, on n'y touche
       pas, sinon on lutterait contre l'entrée et la sortie du formulaire PayPal lui-même. */
    if (k === -1) return;
    if (e.shiftKey && k === 0) { e.preventDefault(); ordre[ordre.length - 1].focus(); }
    else if (!e.shiftKey && k === ordre.length - 1) { e.preventDefault(); ordre[0].focus(); }
  });
})();
