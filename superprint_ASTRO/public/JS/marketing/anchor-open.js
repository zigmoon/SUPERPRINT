
/* 🆕 v1.7.486 — si l’on arrive par une ancre rangée derrière un « Voir la suite »
   (lien du menu, lien partagé, rechargement avec #hash), le chapitre s’ouvre tout seul. */
(function () {
  function ouvrir() {
    if (!location.hash || location.hash.length < 2) return;
    var c;
    try { c = document.querySelector(location.hash); } catch (e) { return; }
    if (!c || !c.closest) return;
    var d = c.closest("details[data-chapitre]");
    if (d) d.open = true;
  }
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a) return;
    var c = document.querySelector(a.getAttribute("href"));
    var d = c && c.closest ? c.closest("details[data-chapitre]") : null;
    if (d) d.open = true;
  }, true);
  window.addEventListener("hashchange", ouvrir);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ouvrir);
  else ouvrir();
})();
