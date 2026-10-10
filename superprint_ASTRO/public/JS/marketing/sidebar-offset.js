
(function () {
  var som = document.querySelector('.aide-som');
  if (!som) return;
  var nav = document.querySelector('nav');

  /* La hauteur de la barre collante n'est pas devinée : elle est mesurée. Une
     langue plus longue ou un écran plus étroit peut la faire grandir, et le
     sommaire doit rester collé dessous au pixel. */
  function poserTop() {
    if (!nav) return;
    var h = Math.round(nav.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty('--som-top', h + 'px');
  }

  var liens = Array.prototype.slice.call(som.querySelectorAll('a[href^="#"]'));
  var cibles = liens.map(function (a) { return document.querySelector(a.getAttribute('href')); });

  function marquer(courante) {
    liens.forEach(function (a, i) {
      var on = cibles[i] === courante;
      a.classList.toggle('is-on', on);
      if (on) { a.setAttribute('aria-current', 'true'); } else { a.removeAttribute('aria-current'); }
    });
  }

  /* La zone courante est la DERNIÈRE dont le haut est passé sous les deux
     bandes collantes (nav + sommaire) : lecture directe, sans observateur, et
     ça marche aussi pour la dernière zone, courte, quand on est en bas de page. */
  function majZone() {
    var haut = (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--som-top'), 10) || 66) + 62;
    var courante = null;
    for (var i = 0; i < cibles.length; i++) {
      var c = cibles[i];
      if (c && c.getBoundingClientRect().top - haut <= 0) courante = c;
    }
    if (!courante) courante = cibles[0];
    if (window.innerHeight + window.pageYOffset >= document.documentElement.scrollHeight - 4) {
      courante = cibles[cibles.length - 1];
    }
    if (courante) marquer(courante);
  }

  var attente = false;
  function auDefilement() {
    if (attente) return;
    attente = true;
    requestAnimationFrame(function () { attente = false; majZone(); });
  }

  poserTop();
  majZone();
  window.addEventListener('scroll', auDefilement, { passive: true });
  window.addEventListener('resize', function () { poserTop(); majZone(); });
  window.addEventListener('hashchange', function () { setTimeout(majZone, 60); });

  /* setLang est enveloppée (jamais modifiée) : après un changement de langue,
     les libellés du sommaire ne font plus la même largeur, on remesure. */
  var setLangSomOrigine = window.setLang;
  if (typeof setLangSomOrigine === 'function') {
    window.setLang = function (l, explicite) { setLangSomOrigine(l, explicite); poserTop(); majZone(); };
  }
})();
