
(function () {
  var boutons = Array.prototype.slice.call(document.querySelectorAll('[data-fold]'));
  boutons.forEach(function (bouton) {
    var cible = document.getElementById(bouton.getAttribute('data-fold'));
    if (!cible) return;
    var plies = cible.querySelectorAll('.is-folded');
    if (!plies.length) { if (bouton.parentNode) bouton.parentNode.style.display = 'none'; return; }
    var compteur = bouton.querySelector('.tm-count');
    if (compteur) compteur.textContent = '+' + plies.length;
    bouton.addEventListener('click', function () {
      var ouvert = cible.classList.toggle('is-open');
      bouton.classList.toggle('is-open', ouvert);
      bouton.setAttribute('aria-expanded', ouvert ? 'true' : 'false');
      if (!ouvert) {
        var barre = document.querySelector('nav');
        var h = barre ? Math.round(barre.getBoundingClientRect().height) : 0;
        window.scrollTo({ top: window.pageYOffset + cible.getBoundingClientRect().top - h - 24, behavior: 'smooth' });
      }
    });
  });
})();
