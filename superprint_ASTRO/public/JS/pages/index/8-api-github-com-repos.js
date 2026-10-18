
(function () {
  var API = 'https://api.github.com/repos/zigmoon/SUPERPRINT/releases/tags/desktop-latest';
  var SECOURS = 'version.txt';
  var MOTIF = /^v?(\d+\.\d+\.\d+)$/;

  function ecrire(version, source) {
    var propre = String(version).replace(/^v/, '');
    if (!MOTIF.test('v' + propre)) return false;
    var cibles = document.querySelectorAll('.brand-ver, .nav-dd-app-ver, .lg-ver b');
    Array.prototype.forEach.call(cibles, function (el) { el.textContent = 'v' + propre; });
    /* On note la source dans le document : c'est ce qui permet de VÉRIFIER que la
       synchronisation a eu lieu, au lieu de regarder la page et d'espérer. */
    try { document.documentElement.setAttribute('data-version-source', source + ':' + propre); } catch (_) {}
    return true;
  }

  function depuisGithub() {
    return fetch(API, { headers: { 'Accept': 'application/vnd.github+json' }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return false;
        /* Le numéro est dans le titre de la publication (« SuperPrint 1.7.632 — … »), et
           le corps de l'annonce le répète : on lit le titre d'abord, le corps ensuite.
           On ne se fie PAS au nom du fichier joint : il peut être renommé. */
        var m = String(j.name || '').match(/(\d+\.\d+\.\d+)/) || String(j.body || '').match(/(\d+\.\d+\.\d+)/);
        return m ? ecrire(m[1], 'github') : false;
      })
      .catch(function () { return false; });
  }

  function depuisVersionTxt() {
    return fetch(SECOURS, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (t) { return t ? ecrire(t.trim(), 'version.txt') : false; })
      .catch(function () { return false; });
  }

  function commencer() {
    depuisGithub().then(function (fait) {
      /* `version.txt` prend le relais seulement si GitHub n'a rien donné — et il
         CORRIGE aussi GitHub quand celui-ci est en retard, puisque c'est la valeur que
         l'utilisateur vient de déposer en même temps que le zip. */
      return depuisVersionTxt().then(function (fait2) {
        if (!fait && !fait2) {
          try { document.documentElement.setAttribute('data-version-source', 'html-fige'); } catch (_) {}
        }
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', commencer);
  else commencer();
})();
