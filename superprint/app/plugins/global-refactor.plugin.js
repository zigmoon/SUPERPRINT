/* ═══════════════════════════════════════════════════════════════════════════════
   SUPERPRINT — PLUG-IN INTÉGRÉ « GLOBAL REFACTOR »  (v1.7.647)
   ═══════════════════════════════════════════════════════════════════════════════

   Demande utilisateur : « on va déplacer l'outil global refactor de la top nav sous
   forme de plug-in par défaut de superprint (donc on l'affiche plus dans la top nav
   mais dans plugins use ouvrira comme pour les autres plugins sa trappe) ».

   ⚠️ CE FICHIER NE CONTIENT AUCUN RÉGLAGE, ET C'EST VOLONTAIRE.
   Le module « Global Refactor » vit dans `main.js` (`_SP_MAQUETTE_631`) : il refait
   la maquette en direct, avec un aperçu qu'on annule ou qu'on valide, et il sait
   rendre la grille et l'historique dans l'état exact où il les a trouvés. Le
   réécrire dans la trappe générique des plug-ins aurait produit un SECOND code à
   maintenir pour le même résultat — et un bouton « Appliquer » sans objet, puisque
   le panneau a déjà son « Valider ».

   Ce plug-in est donc une PORTE D'ENTRÉE : il déclare `trappe`, et son `run()`
   appelle `_spMaquette.ouvrir()`. `sp-plugins-ui.js` voit le champ `trappe`, ne
   construit aucun formulaire, et se contente d'exécuter le plug-in. La trappe qui
   s'ouvre est `#maquettePanel`, celle qui existait déjà, à l'octet près.

   ⚠️ POURQUOI `ouvrir()` ET NON `basculer()`.
   « Utiliser » se clique depuis la bibliothèque, qui s'ouvre PAR-DESSUS la trappe
   sans la fermer. Un `basculer()` refermerait donc l'outil au moment précis où on
   le demande. On ouvre, et si c'est déjà ouvert on ne fait rien : l'utilisateur a
   exactement ce qu'il a demandé.
   ─────────────────────────────────────────────────────────────────────────────── */
SPPluginAPI({
  id: 'global-refactor',
  name: 'Global Refactor',
  version: '1.0.0',
  author: 'SuperPrint',
  icon: '≡',
  description: 'Règle d\'un coup les styles, tailles, marges et couleurs de tout le document — aperçu en direct, et un seul « Annuler » pour revenir à l\'état d\'avant.',
  /* Le panneau que ce plug-in possède. Reconnu uniquement pour un plug-in INTÉGRÉ
     (cf. `normaliser` et `liste` dans `sp-plugins.js`). */
  trappe: 'maquettePanel',
  options: [],
  run: function () {
    var mq = window._spMaquette;
    if (!mq || typeof mq.ouvrir !== 'function') {
      throw new Error('le module Global Refactor n\'est pas disponible dans cette version.');
    }
    if (typeof mq.estOuvert === 'function' && mq.estOuvert()) return;
    mq.ouvrir();
  }
});
