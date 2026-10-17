
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
    /* ⚠️ `href="#"` — les liens des pop-ins légaux — donnait
       querySelector("#") : sélecteur invalide, exception non rattrapée, et le
       clic mourait en console. Le même garde existe déjà juste au-dessus pour
       `location.hash` : ici, c'est le `href` de l'ancre cliquée qui peut être vide. */
    var href = a.getAttribute("href");
    if (!href || href.length < 2) return;
    var c;
    try { c = document.querySelector(href); } catch (err) { return; }
    var d = c && c.closest ? c.closest("details[data-chapitre]") : null;
    if (d) d.open = true;
  }, true);
  window.addEventListener("hashchange", ouvrir);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ouvrir);
  else ouvrir();
})();
