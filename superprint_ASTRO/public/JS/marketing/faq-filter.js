
/* 🆕 v1.7.493 — LE FILTRE DE LA FAQ. Il cherche dans le TEXTE des questions et des réponses,
   qui porte les trois langues : une requête en français, en anglais ou en japonais trouve la
   même question. Échap (ou le bouton Effacer) remet tout. */
(function () {
  var champ = document.getElementById('faqRecherche');
  var vide = document.getElementById('faqRechercheVide');
  var etat = document.getElementById('faqRechercheAide');
  var boite = document.querySelector('.faq-search-boite');
  var effacer = document.getElementById('faqRechercheEff');
  var liste = document.querySelector('#faq .faq-list');
  if (!champ || !liste) return;
  var items = Array.prototype.slice.call(liste.querySelectorAll('details.faq-item'));

  function langue() { return document.documentElement.lang === 'fr' ? 'fr' : (document.documentElement.lang === 'ja' ? 'ja' : 'en'); }
  function majExemple() {
    var l = langue();
    champ.setAttribute('placeholder', champ.getAttribute('data-ph-' + l) || '');
    champ.setAttribute('title', champ.getAttribute('data-ph-' + l) || '');
  }
  function compterTexte() {
    var l = langue();
    var n = items.filter(function (d) { return !d.classList.contains('faq-cache'); }).length;
    if (!champ.value.trim()) { etat.textContent = ''; return; }
    if (l === 'ja') { etat.textContent = n + ' / 10 件'; }
    else if (l === 'fr') { etat.textContent = n + (n > 1 ? ' questions sur 10' : ' question sur 10'); }
    else { etat.textContent = n + ' of 10 questions'; }
  }
  function filtrer() {
    var q = champ.value.trim().toLowerCase();
    var n = 0;
    items.forEach(function (d) {
      var ok = !q || d.textContent.toLowerCase().indexOf(q) >= 0;
      d.classList.toggle('faq-cache', !ok);
      if (ok) n++;
    });
    liste.classList.toggle('vide', n === 0);
    vide.hidden = n !== 0;
    boite.classList.toggle('pleine', !!q);
    compterTexte();
  }
  champ.addEventListener('input', filtrer);
  champ.addEventListener('keydown', function (e) { if (e.key === 'Escape') { champ.value = ''; filtrer(); } });
  if (effacer) effacer.addEventListener('click', function () { champ.value = ''; filtrer(); champ.focus(); });
  /* le libellé d'exemple suit la langue choisie */
  var _setLang = window.setLang;
  if (typeof _setLang === 'function') {
    window.setLang = function (l) { _setLang(l); majExemple(); filtrer(); };
  }
  majExemple();
  filtrer();
  /* la page peut poser la langue APRÈS ce script : on remet l'exemple d'aplomb au chargement */
  window.addEventListener('load', function () { majExemple(); filtrer(); });
})();
