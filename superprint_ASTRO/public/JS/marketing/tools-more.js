
(function () {
  var bouton = document.getElementById('toolsMore');
  var grille = document.getElementById('tgridOutils');
  if (!bouton || !grille) return;
  var pliees = Array.prototype.slice.call(grille.querySelectorAll('.tcard.is-folded'));
  var compteur = bouton.querySelector('.tm-count');
  if (!pliees.length) { bouton.parentNode.style.display = 'none'; return; }  /* rien à déplier : pas de bouton */
  if (compteur) compteur.textContent = '+' + pliees.length;
  bouton.addEventListener('click', function () {
    var ouvert = grille.classList.toggle('is-open');
    bouton.classList.toggle('is-open', ouvert);
    bouton.setAttribute('aria-expanded', ouvert ? 'true' : 'false');
    if (!ouvert) {
      /* Replié, les neuf cartes disparaissent AU-DESSUS du bouton : la page raccourcit d'un coup
         et la vue reste dans le vide. On la repose sur le titre de la galerie, sous la barre. */
      var cible = document.querySelector('.tools-head');
      if (!cible) return;
      var barre = document.querySelector('nav');
      var h = barre ? Math.round(barre.getBoundingClientRect().height) : 0;
      window.scrollTo({ top: window.pageYOffset + cible.getBoundingClientRect().top - h - 16, behavior: 'smooth' });
    }
  });
})();
