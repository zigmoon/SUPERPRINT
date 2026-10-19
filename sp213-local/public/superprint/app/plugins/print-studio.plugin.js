/* ═══════════════════════════════════════════════════════════════════════════════
   SUPERPRINT — PLUG-IN INTÉGRÉ « PRINT VPS »  (v1.7.682)
   ═══════════════════════════════════════════════════════════════════════════════

   Demande utilisateur : « on doit sortir "printvps" de la top navigation et cette
   partie doit devenir un plug-in à part par défaut dans superprint : il sera
   disponible dans la boîte des plugins par défaut mais pas activé ».

   Ce que faisait le bouton : il ouvrait `window.SPPrintStudio.open()` — le studio
   de contrôle avant impression (format, fond perdu, marges, résolution des images,
   taux d'encre, aperçu réseau). Rien n'est réécrit ici : ce module de 110 Ko reste
   exactement où il est, et ce fichier n'est qu'une PORTE D'ENTRÉE.

   ⚠️ `actifParDefaut: false` — ET C'EST TOUTE LA DEMANDE.
   Un plug-in intégré est normalement allumé d'office (`enregistrerIntegre`), donc
   il aurait repris sa place dans la barre du haut et rien n'aurait changé pour
   l'utilisateur. Éteint au premier lancement, il apparaît dans la bibliothèque,
   s'y allume d'un clic, et c'est alors seulement qu'il s'installe dans la barre —
   comportement normal d'un plug-in. La préférence de l'utilisateur, une fois
   écrite, reste maîtresse aux mises à jour suivantes.

   ⚠️ `trappe: 'vpsOverlay'` — LE STUDIO A DÉJÀ SON PANNEAU.
   Ce studio n'est pas un formulaire : c'est un panneau complet avec ses onglets,
   son aperçu et ses propres boutons. Le déclarer comme « trappe » fait que la
   bibliothèque l'EXÉCUTE directement au lieu de construire un formulaire vide avec
   un bouton « Enregistrer » sans objet (cf. `ouvrirTrappePlugIn`).
   ─────────────────────────────────────────────────────────────────────────────── */
/* ═══ LES TROIS LANGUES (FR / EN / JA) ═══════════════════════════════════════
   Cf. le commentaire équivalent en tête de `motif-vectoriel.plugin.js`. */
var L = window.SPPluginL || function (fr, en, ja) { return { fr: fr, en: en || fr, ja: ja || en || fr }; };

SPPluginAPI({
  id: 'print-studio',
  name: L('Contrôle avant impression', 'Preflight studio', 'プリフライト'),
  version: '1.0.0',
  author: 'SuperPrint',
  icon: '⎙',
  description: L('Vérifie la maquette avant de l\'envoyer : format, fond perdu, marges, résolution des images, taux d\'encre et aperçu réseau. Le studio qui était dans la barre du haut.',
    'Checks the layout before you send it: format, bleed, margins, image resolution, ink coverage and a network preview. The studio that used to sit in the top bar.',
    '入稿前の確認：判型・塗り足し・余白・画像解像度・インク量・ネットワークプレビュー。以前は上部バーにあったスタジオです。'),
  /* Une imprimante, dessinée en contour comme les icônes voisines de la barre du
     haut (24×24, `fill="none"`, `stroke="currentColor"`, épaisseur 1,8). */
  icone: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  /* Le panneau que ce plug-in possède (le studio s'ouvre dans le sien). */
  trappe: 'vpsOverlay',
  /* ⚠️ ARRIVE ÉTEINT — voir l'en-tête. */
  actifParDefaut: false,
  options: [],
  run: function () {
    var st = window.SPPrintStudio;
    if (!st || typeof st.open !== 'function') {
      throw new Error(api.t(L('le studio de contrôle avant impression n\'est pas disponible dans cette version.',
        'the preflight studio is not available in this version.',
        'このバージョンではプリフライトを利用できません。')));
    }
    st.open();
  }
});
