/* ═══════════════════════════════════════════════════════════════════════════
   v1.7.664 — LA VERSION AFFICHÉE EST CELLE QUI SE TÉLÉCHARGE VRAIMENT
   _SP_VERSIONS_GITHUB

   POURQUOI CE FICHIER EXISTE. La page de présentation annonçait « v1.7.662 »
   (la version du dépôt) alors que les liens servaient 1.7.636 — mesuré : la
   release `desktop-latest` portait un nom à 1.7.636, ses 21 fichiers ayant été
   déposés le 17/10 à 00 h 56, et `version.txt` valait 1.7.662. Le visiteur
   lisait donc un numéro qui ne correspondait à aucun fichier téléchargeable.

   UNE SEULE SOURCE DE VÉRITÉ : GITHUB. C'est la seule qui dise ce que le
   visiteur reçoit réellement, puisque les liens passent par l'alias
   `releases/download/desktop-latest/…` que GitHub fait pointer sur la dernière
   publication. `version.txt` ne participe PLUS à cet affichage : c'est le
   marqueur de compilation du dépôt, et il peut légitimement être en avance sur
   ce qui est publié — c'est précisément ce qui produisait le mensonge.

   LA RÈGLE EST : JUSTE OU RIEN. Le CSS masque les numéros tant que ce script
   n'a pas confirmé la version (voir la règle `[data-sp-version]` dans chaque
   page). Si GitHub ne répond pas — réseau filtré, quota d'API, panne — les
   numéros restent invisibles au lieu d'afficher une valeur non vérifiée.
   ⚠️ ON MASQUE PAR `visibility`, PAS PAR `display`: la place du numéro reste
   réservée, donc la barre de téléchargement ne saute pas quand il apparaît.

   ⚠️ AUCUN LIEN N'EST MODIFIÉ ICI. Les adresses sont déjà bonnes — l'alias est
   la bonne façon de toujours servir la dernière publication sans retoucher le
   HTML à chaque livraison. Ce script ne fait que LIRE et DIRE.

   DIAGNOSTIC LAISSÉ DANS LE DOCUMENT (lisible sans console, pour vérifier au
   lieu d'espérer) :
     <html data-version-source="github:1.7.636">   version lue, et d'où
     <html data-version-source="indisponible">      GitHub n'a pas répondu
     <html data-version-fichiers="21/21">           fichiers attendus présents
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var API = 'https://api.github.com/repos/zigmoon/SUPERPRINT/releases/tags/desktop-latest';

  /* Les 21 fichiers que le sous-menu « Télécharger » promet — sept par
     application (deux Windows, deux macOS, trois Linux), trois applications.
     Cette liste ne sert qu'à VÉRIFIER : si une publication en oublie un, le
     document le dit (`data-version-fichiers`) et la console le nomme. Un lien
     mort ne se voit pas à l'œil nu, un compte se lit. */
  var ATTENDUS = [
    'SuperPrint-Windows-x64-setup.exe', 'SuperPrint-Windows-x64.msi',
    'SuperPrint-macOS-AppleSilicon.dmg', 'SuperPrint-macOS-Intel.dmg',
    'SuperPrint-Linux-x86_64.AppImage', 'SuperPrint-Linux-x86_64.deb', 'SuperPrint-Linux-x86_64.rpm',
    'Studio-IA-Windows-x64-setup.exe', 'Studio-IA-Windows-x64.msi',
    'Studio-IA-macOS-AppleSilicon.dmg', 'Studio-IA-macOS-Intel.dmg',
    'Studio-IA-Linux-x86_64.AppImage', 'Studio-IA-Linux-x86_64.deb', 'Studio-IA-Linux-x86_64.rpm',
    'SuperTyPo-Windows-x64-setup.exe', 'SuperTyPo-Windows-x64.msi',
    'SuperTyPo-macOS-AppleSilicon.dmg', 'SuperTyPo-macOS-Intel.dmg',
    'SuperTyPo-Linux-x86_64.AppImage', 'SuperTyPo-Linux-x86_64.deb', 'SuperTyPo-Linux-x86_64.rpm'
  ];

  /* Ce qui s'écrit (les chiffres) et ce qu'on rend visible (les blocs). Les deux
     listes diffèrent : `.lg-ver` porte aussi le mot « Version », qu'il ne faut
     pas laisser seul si le numéro manque. */
  var CHIFFRES = '.brand-ver, .nav-dd-app-ver, .lg-ver b';
  var BLOCS = '.brand-ver, .nav-dd-app-ver, .lg-ver';

  var CHIFFRE = /^\d+\.\d+\.\d+$/;

  function racine() { return document.documentElement; }

  function reveler(version) {
    var v = String(version == null ? '' : version).replace(/^v/, '').trim();
    if (!CHIFFRE.test(v)) return false;
    var cibles = document.querySelectorAll(CHIFFRES);
    for (var i = 0; i < cibles.length; i++) cibles[i].textContent = 'v' + v;
    racine().setAttribute('data-sp-version', 'ok');
    racine().setAttribute('data-version-source', 'github:' + v);
    return true;
  }

  function masquer() {
    racine().removeAttribute('data-sp-version');
    racine().setAttribute('data-version-source', 'indisponible');
  }

  /* La version téléchargeable est dans le NOM de la publication
     (« SuperPrint 1.7.636 — desktop applications »). Le corps de l'annonce la
     répète : c'est le repli si le nom a été changé à la main. On ne se fie PAS
     au nom d'un fichier joint, qui peut être renommé sans changer de contenu. */
  function versionDeLaPublication(j) {
    var m = String(j && j.name || '').match(/(\d+\.\d+\.\d+)/)
      || String(j && j.body || '').match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : null;
  }

  function verifierFichiers(joints) {
    var presents = Object.create(null);
    (joints || []).forEach(function (n) { presents[n] = true; });
    var manquants = ATTENDUS.filter(function (n) { return !presents[n]; });
    racine().setAttribute('data-version-fichiers', (ATTENDUS.length - manquants.length) + '/' + ATTENDUS.length);
    if (manquants.length) {
      try {
        console.warn('[SuperPrint] publication incomplète — fichiers annoncés par la page et absents de desktop-latest : ' + manquants.join(', '));
      } catch (_) {}
    }
  }

  function commencer() {
    /* ⚠️ `cache: 'no-store'` EST INDISPENSABLE ICI. Une réponse d'API mise en
       cache par le navigateur afficherait la version de la veille après une
       publication — exactement le défaut qu'on corrige. */
    if (typeof fetch !== 'function') { masquer(); return; }
    fetch(API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) { masquer(); return; }
        var v = versionDeLaPublication(j);
        if (!v || !reveler(v)) { masquer(); return; }
        verifierFichiers((j.assets || []).map(function (a) { return a.name; }));
      })
      .catch(function () { masquer(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', commencer);
  else commencer();
})();
