/* ═══════════════════════════════════════════════════════════════════════════════
   SUPERPRINT — PLUG-IN INTÉGRÉ « GLOBAL REFACTOR »  (v1.7.650)
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
  version: '1.1.0',
  author: 'SuperPrint',
  icon: '≡',
  description: 'Règle d\'un coup les styles, tailles, marges et couleurs de tout le document — aperçu en direct, et un seul « Annuler » pour revenir à l\'état d\'avant.',
  /* 🆕 v1.7.650 — L'ICÔNE DE LA BARRE DU HAUT.
     Demande utilisateur : « affiche une icône dans la top nav quand c'est en on
     (global refactor on doit encore l'avoir, elle était dans la top nav avant en
     permanence) ». Ce dessin est donc celui du bouton que l'outil occupait là
     avant la 1.7.643 : trois réglettes à curseur, c'est-à-dire « on règle des
     valeurs », et non « on refait la mise en page ».
     ⚠️ MÊME FACTURE QUE LES AUTRES ICÔNES DE CETTE ZONE : 24×24, `fill="none"`,
     `stroke="currentColor"`, épaisseur 1,8. Une icône pleine aurait la même
     couleur mais beaucoup plus d'encre, donc paraîtrait plus sombre que ses
     voisines (même raisonnement que pour l'icône « Prompt IA »). */
  icone: '<line x1="3.5" y1="6.5" x2="20.5" y2="6.5"/><circle cx="9" cy="6.5" r="2.3"/>' +
         '<line x1="3.5" y1="12" x2="20.5" y2="12"/><circle cx="15.5" cy="12" r="2.3"/>' +
         '<line x1="3.5" y1="17.5" x2="20.5" y2="17.5"/><circle cx="7.5" cy="17.5" r="2.3"/>',
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
