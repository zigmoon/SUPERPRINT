
(function () {
  var rail = document.getElementById('tplRail');
  if (!rail) return;
  var cartes = Array.prototype.slice.call(rail.querySelectorAll('.tpl-card'));
  var prev = document.querySelector('.tpl-prev'), next = document.querySelector('.tpl-next');
  var compteur = document.getElementById('tplCount');
  var total = cartes.length;

  function pas() {
    if (cartes.length < 2) return 240;
    return Math.max(120, Math.round(cartes[1].offsetLeft - cartes[0].offsetLeft));
  }
  function majEtat() {
    var g = rail.scrollLeft, max = rail.scrollWidth - rail.clientWidth;
    var i = 0;
    for (var k = 0; k < cartes.length; k++) { if (cartes[k].offsetLeft - g <= pas() * 0.5) i = k; }
    // En butée droite les dernières cartes s'arrêtent avant le bord : sans ce
    // garde le compteur restait bloqué sur « 39 / 43 » au bout du rail.
    if (max - g <= 2) i = total - 1;
    if (compteur) compteur.textContent = (i + 1) + ' / ' + total;
    if (prev) prev.disabled = g <= 2;
    if (next) next.disabled = g >= max - 2;
  }
  function aller(d) { rail.scrollBy({ left: d * pas(), behavior: 'smooth' }); }
  if (prev) prev.addEventListener('click', function () { aller(-1); });
  if (next) next.addEventListener('click', function () { aller(1); });
  rail.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { aller(1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { aller(-1); e.preventDefault(); }
  });

  // Glisser à la souris (le tactile est déjà géré par le navigateur).
  var actif = false, departX = 0, departScroll = 0, bouge = false;
  rail.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'mouse') return;
    actif = true; bouge = false; departX = e.clientX; departScroll = rail.scrollLeft;
    rail.style.scrollBehavior = 'auto';
  });
  window.addEventListener('pointermove', function (e) {
    if (!actif) return;
    var d = e.clientX - departX;
    if (!bouge && Math.abs(d) > 5) { bouge = true; rail.style.cursor = 'grabbing'; }
    if (bouge) { rail.scrollLeft = departScroll - d; e.preventDefault(); }
  });
  window.addEventListener('pointerup', function () {
    if (!actif) return;
    actif = false; rail.style.scrollBehavior = ''; rail.style.cursor = '';
  });
  rail.addEventListener('click', function (e) { if (bouge) { e.preventDefault(); bouge = false; } }, true);

  var planifie = false;
  rail.addEventListener('scroll', function () {
    if (planifie) return; planifie = true;
    requestAnimationFrame(function () { planifie = false; majEtat(); });
  }, { passive: true });
  window.addEventListener('resize', majEtat);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(majEtat);
  majEtat();
})();
