/* ═══════════════════════════════════════════════════════════════════════════════
   SUPERPRINT — PLUG-IN INTÉGRÉ « GLOBAL REFACTOR »  (v1.7.666)
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
/* ═══ v1.7.666 — LES TROIS LANGUES (FR / EN / JA) ═══════════════════════════
   Le nom et la description sont désormais écrits `L(français, english, 日本語)`.
   Cf. le commentaire équivalent en tête de `motif-vectoriel.plugin.js`. */
var L = window.SPPluginL || function (fr, en, ja) { return { fr: fr, en: en || fr, ja: ja || en || fr }; };

SPPluginAPI({
  id: 'global-refactor',
  name: L('Global Refactor', 'Global Refactor', 'グローバルリファクター'),
  version: '1.1.0',
  author: 'SuperPrint',
  icon: '≡',
  description: L('Règle d\'un coup les styles, tailles, marges et couleurs de tout le document — aperçu en direct, et un seul « Annuler » pour revenir à l\'état d\'avant.', 'Rules styles, sizes, margins and colours across the whole document in one pass — live preview, and a single “Undo” to get back where you were.', '文書全体のスタイル・サイズ・余白・色を一度に整えます — ライブプレビュー、元に戻すは 1 回だけ。'),
  /* 🆕 v1.7.666 — L'ICÔNE DE LA BARRE DU HAUT.
     Demande utilisateur : « affiche une icône dans la top nav quand c'est en on
     (global refactor on doit encore l'avoir, elle était dans la top nav avant en
     permanence) ». Ce dessin est donc celui du bouton que l'outil occupait là
     avant la 1.7.643 : des réglettes à curseur, c'est-à-dire « on règle des
     valeurs », et non « on refait la mise en page ».
     ⚠️ MÊME FACTURE QUE LES AUTRES ICÔNES DE CETTE ZONE : 24×24, `fill="none"`,
     `stroke="currentColor"`, épaisseur 1,8.
     ⚠️ v1.7.666 — DEUX RÉGLETTES ET NON TROIS, ET C'EST UNE MESURE.
     Demande utilisateur : « les icons que les plugins ajoute dans la top
     navigation me semble plus noir que les autre en chromie ». La COULEUR était
     identique (`rgb(26,26,26)` relevé sur les deux, comme sur la loupe) : c'est
     l'ENCRE qui différait. Comptée en pixels opaques sur un rendu 48×48, la
     première version pesait 732 px contre 421 pour la loupe et 411 pour l'étoile
     IA — presque le double, d'où l'impression de noir. Trois réglettes sur toute
     la largeur, c'était trop de trait pour un carré de 24. Deux réglettes plus
     courtes ramènent le dessin dans la gamme des icônes voisines. */
  icone: '<line x1="4.5" y1="8.5" x2="19.5" y2="8.5"/><circle cx="9.5" cy="8.5" r="2.1"/>' +
         '<line x1="4.5" y1="15.5" x2="19.5" y2="15.5"/><circle cx="15.5" cy="15.5" r="2.1"/>',
  /* Le panneau que ce plug-in possède. Reconnu uniquement pour un plug-in INTÉGRÉ
     (cf. `normaliser` et `liste` dans `sp-plugins.js`). */
  trappe: 'maquettePanel',
  options: [],
  run: function () {
    var mq = window._spMaquette;
    if (!mq || typeof mq.ouvrir !== 'function') {
      throw new Error(api.t(L('le module Global Refactor n\'est pas disponible dans cette version.', 'the Global Refactor module is not available in this version.', 'このバージョンではグローバルリファクターを利用できません。')));
    }
    if (typeof mq.estOuvert === 'function' && mq.estOuvert()) return;
    mq.ouvrir();
  }
});
