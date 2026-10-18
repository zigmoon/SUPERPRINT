/* ═══════════════════════════════════════════════════════════════════════════════
   SUPERPRINT — PLUG-IN « MOTIF VECTORIEL »  (v3.0.0, app 1.7.673)
   ═══════════════════════════════════════════════════════════════════════════════

   Ce que fait ce plug-in : il habille un fond de page — ou un bloc sélectionné —
   d'un MOTIF répété, d'une ROSACE, d'un KALÉIDOSCOPE construit à partir de la page,
   ou d'un MOTIF « CRAZY » volontairement chaotique. Le motif est une forme
   géométrique dessinée, ou UNE À SIX IMAGES importées, mélangées entre elles.

   ── v3.0.0 : CE QUI CHANGE, ET POURQUOI ──────────────────────────────────────
   Demande utilisateur, mot pour mot : « beaucoup trop de texte d'info partout,
   plus de réglage en tirette, un mode crazy, une preview plus grande de mon image
   ou de mes images (un mixer ?) ». Quatre chantiers, donc.

   1. LE TEXTE D'AIDE A DISPARU. Les 14 phrases d'explication sous les champs sont
      retirées — la bibliothèque les disait déjà, et une trappe qu'on parcourt du
      pouce n'est pas un mode d'emploi. Ne restent que les libellés, la valeur
      chiffrée de chaque tirette, et le grand aperçu qui montre le résultat.
   2. TOUT CE QUI SE RÈGLE À L'ŒIL EST UNE TIRETTE. Douze réglages passent en
      `range` avec leur valeur affichée (mm, °, %). Les deux seules listes gardées
      sont des choix discrets et nombreux (forme, symétrie) qu'une tirette
      rendrait illisibles.
   3. LE GRAND APERÇU. Un champ `apercu` en tête de trappe pose une toile de
      316 × 316 px où le plug-in dessine LA TUILE RÉPÉTÉE — pas une vignette d'une
      seule forme. C'est le seul moyen de juger un rythme, une densité, un raccord.
   4. LE MIXEUR D'IMAGES. Un champ `images` porte un TABLEAU de dataURL : on en
      ajoute autant qu'on veut, chacune se retire par sa croix. Elles sont
      superposées dans la tuile avec un mode de fusion (`multiply`, `screen`,
      `difference`…) et une opacité réglable — c'est ce qui fait un mixeur, et pas
      un simple sélecteur de fichier.

   ⚠️ POURQUOI UN MOTIF (fabric.Pattern) ET PAS DES MILLIERS D'OBJETS.
   Une page A4 à 8 mm de pas demande ~2 300 formes. Autant d'objets Fabric, c'est
   un ralenti immédiat à la sélection, à l'export PDF et à la sauvegarde — mesuré
   sur ce dépôt : un document de 130 objets pèse déjà 128 Ko.
   Un `fabric.Pattern` est UN objet : le navigateur répète la tuile au rendu, et
   l'export PDF la répète de la même façon.

   ⚠️ LA TUILE EST DESSINÉE À LA RÉSOLUTION DU DOCUMENT, PAS À 72 dpi.
   On la dessine `facteur` fois plus grande (×4 par défaut) : nette à l'impression,
   et le motif la réduit au rendu — d'où le `patternTransform` de 1/4.

   ⚠️ LA SUPER-TUILE, ET POURQUOI ELLE EXISTE.
   Un `fabric.Pattern` répète UNE tuile à l'identique : impossible, avec une seule
   tuile, d'obtenir une variation d'une répétition à l'autre. On dessine donc une
   tuile de N × N CELLULES, chacune avec sa propre graine — la répétition reste
   parfaite (c'est la super-tuile qui se répète), mais l'œil voit N² cellules
   différentes. N = 1 par défaut, 2 ou 3 pour la variété.
   La graine est explicite : un même jeu de réglages redonne exactement le même
   dessin, donc un motif enregistré se réouvre à l'identique.

   ⚠️ LE KALÉIDOSCOPE EST LE GROUPE DU CARRÉ (D4), ET C'EST LE SEUL QUI PAVAILLE.
   Une rosace à 6 branches dans une tuile carrée laisse des coutures : 60° ne
   ramène pas un carré sur lui-même. Les 8 symétries qui le font sont les 4
   rotations et les 4 réflexions. « kaléidoscope dense » applique D4 deux fois, à
   deux échelles : plus rempli, toujours jointif.

   ⚠️ UNE FORME CENTRÉE EST INVARIANTE SOUS D4 — MESURÉ, ET C'EST POURQUOI
   « ÉCART AU CENTRE » EXISTE. Premier essai : 1 588 pixels opaques avec symétrie
   contre 1 595 sans, c'est-à-dire rien. Les huit copies se superposaient. En
   décalant la forme du centre, chacune part dans sa propre direction et la
   couronne apparaît (5 806 pixels opaques). Second piège, mesuré aussi : l'ordre
   des transformations. `translate` AVANT `rotate` fait tourner autour du point
   déjà décalé, donc le centre ne bouge pas et les copies se superposent encore.
   Il faut `rotate` d'abord, `translate` ensuite, dans le repère déjà tourné.

   ⚠️ LE MODE « KALÉIDOSCOPE DE LA PAGE » EST UN VRAI KALÉIDOSCOPE, PAS UNE TUILE.
   Il prend le rendu de la page (le motif précédent ayant été retiré juste avant),
   le réduit dans un quadrant et le reflète dans les trois autres. Il coûte un
   `toDataURL` par application — d'où le fait qu'il soit un mode parmi d'autres.

   ⚠️ APERÇU EN DIRECT — `api.apercu`.
   La trappe exécute ce plug-in à chaque mouvement de tirette. En aperçu,
   `api.apercu` vaut true : aucune entrée d'historique n'est écrite (sinon il
   faudrait vingt Ctrl+Z pour revenir au dessin d'avant), on synchronise seulement
   `pages[]`. La validation écrit UNE entrée, quel que soit le nombre d'aperçus.

   ⚠️ CE PLUG-IN EST AUSSI LE BANC D'ESSAI DE L'API.
   Il n'utilise QUE l'API documentée : `api.fabric`, `api.mm`, `api.document`,
   `api.selection`, `api.canvases`, `api.add`, `api.commit`, `api.sync`,
   `api.apercu`, `api.toileApercu`. S'il fonctionne sans rien d'autre, l'API est
   suffisante pour un plug-in réel.
   ─────────────────────────────────────────────────────────────────────────────── */
/* ═══ v1.7.673 — LES TROIS LANGUES (FR / EN / JA) ═══════════════════════════
   Demande utilisateur : « relie bien la partie plug-in et nos deux plugins en
   trois langue EN fr ja ».
   Chaque libellé visible est écrit `L(français, english, 日本語)` et résolu à
   l'affichage : par `traduireManifeste` pour les réglages (dans `sp-plugins.js`),
   par `api.t()` pour les messages d'exécution. Rien n'est figé à l'enregistrement,
   donc changer de langue prend effet à la prochaine ouverture du panneau, sans
   recharger la page.
   ⚠️ `L` EST REPRIS DU GLOBAL quand il existe, avec un repli local. Les fichiers
   de `app/plugins/` sont insérés APRÈS `sp-plugins.js`, donc `window.SPPluginL`
   est déjà là ; le repli couvre le cas d'un chargement dans un autre ordre, et
   évite un « L is not defined » qui viderait la bibliothèque d'un coup. */
var L = window.SPPluginL || function (fr, en, ja) { return { fr: fr, en: en || fr, ja: ja || en || fr }; };

SPPluginAPI({
  id: 'motif-vectoriel',
  name: L('Motif vectoriel', 'Vector Pattern', 'ベクター柄'),
  version: '3.1.0',
  author: 'SuperPrint',
  icon: '▦',
  description: L('Motif, rosace, kaléidoscope ou chaos — à partir d\'une forme ou d\'un mélange d\'images. Aperçu en direct dans la trappe.', 'Pattern, rosette, kaleidoscope or chaos — from a shape or a mix of images. Live preview in the panel.', 'パターン・ロゼット・万華鏡・混沌 — 図形または画像のミックスから。パネル内でライブプレビュー。'),

  /* 🆕 v1.7.673 — L'ICÔNE DE LA BARRE DU HAUT.
     Demande utilisateur : « pour motif trouve une icône ». On dessine un MOTIF :
     des points en quinconce, c'est-à-dire ce que fait ce plug-in — une forme
     répétée en grille décalée.
     ⚠️ MÊME FACTURE QUE LES AUTRES ICÔNES DE CETTE ZONE : 24×24, `fill="none"`,
     `stroke="currentColor"`, épaisseur 1,8.
     ⚠️ v1.7.673 — CINQ PETITS CERCLES AU LIEU DE CINQ CARRÉS, ET C'EST UNE MESURE.
     Demande utilisateur : « les icons que les plugins ajoute dans la top
     navigation me semble plus noir que les autre en chromie ». La couleur était la
     même ; c'est l'encre qui pesait. Mesuré en pixels opaques sur un rendu 48×48 :
     cinq carrés de 3,2 = 526 px contre 421 pour la loupe. Un carré de 3,2 unités a
     un périmètre de 12,8 ; un cercle de rayon 1,55 n'en a que 9,7, pour une surface
     visuelle équivalente. Cinq cercles ramènent le dessin dans la gamme. */
  icone: '<circle cx="5.2" cy="5.2" r="1.55"/><circle cx="18.8" cy="5.2" r="1.55"/>' +
         '<circle cx="12" cy="12" r="1.55"/>' +
         '<circle cx="5.2" cy="18.8" r="1.55"/><circle cx="18.8" cy="18.8" r="1.55"/>',

  options: [
    /* ── Le grand aperçu. En tête, et sans libellé : il se comprend seul. ──── */
    { key: 'apercu', label: L('Aperçu', 'Preview', 'プレビュー'), type: 'apercu', ratio: 1 },

    /* ── Où poser ─────────────────────────────────────────────────────────── */
    {
      key: 'cible', label: L('Appliquer à', 'Apply to', '適用先'), type: 'select', defaut: 'auto',
      choix: [
        { value: 'auto', label: L('Le bloc sélectionné, sinon la page', 'Selected block, otherwise the page', '選択ブロック、なければページ全体') },
        { value: 'page', label: L('Toute la page', 'Whole page', 'ページ全体') },
        { value: 'selection', label: L('Le bloc sélectionné', 'Selected block', '選択ブロック') }
      ]
    },
    {
      key: 'mode', label: L('Effet', 'Effect', '効果'), type: 'select', defaut: 'tuile',
      choix: [
        { value: 'tuile', label: L('Motif répété', 'Repeated pattern', '繰り返しパターン') },
        { value: 'crazy', label: L('Crazy — chaos contrôlé', 'Crazy — controlled chaos', 'クレイジー — 制御された混沌') },
        { value: 'rosette', label: L('Rosace (une seule)', 'Rosette (single)', 'ロゼット（1 つ）') },
        { value: 'miroir', label: L('Kaléidoscope de la page', 'Page kaleidoscope', 'ページ万華鏡') }
      ]
    },

    /* ── La forme ─────────────────────────────────────────────────────────── */
    {
      key: 'forme', label: L('Forme', 'Shape', '図形'), type: 'select', defaut: 'cercle',
      choix: [
        { value: 'cercle', label: L('Cercle', 'Circle', '円') },
        { value: 'anneau', label: L('Anneau', 'Ring', 'リング') },
        { value: 'carre', label: L('Carré', 'Square', '正方形') },
        { value: 'losange', label: L('Losange', 'Diamond', 'ひし形') },
        { value: 'triangle', label: L('Triangle', 'Triangle', '三角形') },
        { value: 'hexagone', label: L('Hexagone', 'Hexagon', '六角形') },
        { value: 'etoile5', label: L('Étoile 5 branches', '5-point star', '5 芒星') },
        { value: 'etoile6', label: L('Étoile 6 branches', '6-point star', '6 芒星') },
        { value: 'croix', label: L('Croix', 'Cross', '十字') },
        { value: 'goutte', label: L('Goutte', 'Drop', 'しずく') },
        { value: 'fleur', label: L('Fleur', 'Flower', '花') },
        { value: 'spirale', label: L('Spirale', 'Spiral', '渦巻き') },
        { value: 'vague', label: L('Vague', 'Wave', '波') },
        { value: 'lignes', label: L('Lignes', 'Lines', '線') },
        { value: 'nid', label: L('Nid d\'abeille', 'Honeycomb', 'ハニカム') }
      ]
    },
    {
      key: 'symetrie', label: L('Symétrie', 'Symmetry', '対称'), type: 'select', defaut: 'aucune',
      choix: [
        { value: 'aucune', label: L('Aucune', 'None', 'なし') },
        { value: 'miroir-x', label: L('Miroir horizontal', 'Horizontal mirror', '左右反転') },
        { value: 'miroir-y', label: L('Miroir vertical', 'Vertical mirror', '上下反転') },
        { value: 'miroir-xy', label: L('Miroir deux axes', 'Two-axis mirror', '上下左右反転') },
        { value: 'quart', label: L('Rotation 90°', '90° rotation', '90° 回転') },
        { value: 'kaleido', label: L('Kaléidoscope 8', 'Kaleidoscope 8', '万華鏡 8') },
        { value: 'kaleido16', label: L('Kaléidoscope 16', 'Kaleidoscope 16', '万華鏡 16') }
      ]
    },

    /* ── Géométrie : des tirettes, avec leur valeur en clair ──────────────── */
    { key: 'pas', label: L('Pas du motif', 'Pattern step', 'パターンの間隔'), type: 'range', defaut: 8, min: 1, max: 60, pas: 0.5, unite: ' mm' },
    { key: 'taille', label: L('Taille de la forme', 'Shape size', '図形のサイズ'), type: 'range', defaut: 4, min: 0.4, max: 60, pas: 0.2, unite: ' mm' },
    { key: 'ecart', label: L('Écart au centre', 'Offset from centre', '中心からのずれ'), type: 'range', defaut: 30, min: 0, max: 50, pas: 1, unite: '%' },
    { key: 'angle', label: L('Rotation de la forme', 'Shape rotation', '図形の回転'), type: 'range', defaut: 0, min: 0, max: 360, pas: 1, unite: '°' },
    { key: 'rotationCellule', label: L('Vrille d\'une cellule à l\'autre', 'Twist per cell', 'セルごとのひねり'), type: 'range', defaut: 0, min: -90, max: 90, pas: 1, unite: '°' },
    { key: 'variation', label: L('Variation', 'Variation', 'ばらつき'), type: 'range', defaut: 0, min: 0, max: 100, pas: 1, unite: '%' },
    { key: 'quinconce', label: L('Quinconce', 'Stagger', '市松ずらし'), type: 'range', defaut: 0, min: 0, max: 100, pas: 1, unite: '%' },
    { key: 'onde', label: L('Onde', 'Ripple', '波打ち'), type: 'range', defaut: 0, min: 0, max: 40, pas: 0.5, unite: ' mm' },
    { key: 'folie', label: L('Folie', 'Wildness', '奔放さ'), type: 'range', defaut: 45, min: 0, max: 100, pas: 1, unite: '%' },
    { key: 'graine', label: L('Graine', 'Seed', 'シード'), type: 'range', defaut: 7, min: 1, max: 200, pas: 1, unite: '' },

    /* ── Couleur ──────────────────────────────────────────────────────────── */
    { key: 'couleur', label: L('Couleur 1', 'Colour 1', '色 1'), type: 'color', defaut: '#1a1a1a' },
    { key: 'couleur2', label: L('Couleur 2', 'Colour 2', '色 2'), type: 'color', defaut: '#c8102e' },
    {
      key: 'degrade', label: L('Dégradé', 'Gradient', 'グラデーション'), type: 'select', defaut: 'aucun',
      choix: [
        { value: 'aucun', label: L('Aucun', 'None', 'なし') },
        { value: 'lineaire', label: L('Linéaire', 'Linear', '線形') },
        { value: 'radial', label: L('Radial', 'Radial', '放射状') }
      ]
    },
    { key: 'opacite', label: L('Opacité', 'Opacity', '不透明度'), type: 'range', defaut: 100, min: 5, max: 100, pas: 1, unite: '%' },
    { key: 'fondActif', label: L('Remplir le fond', 'Fill the background', '背景を塗る'), type: 'checkbox', defaut: false },
    { key: 'fondTuile', label: L('Fond', 'Background', '背景'), type: 'color', defaut: '#ffffff' },
    { key: 'trait', label: L('Trait seulement', 'Stroke only', '線のみ'), type: 'checkbox', defaut: false },
    { key: 'epaisseur', label: L('Épaisseur du trait', 'Stroke width', '線の太さ'), type: 'range', defaut: 0.5, min: 0.05, max: 8, pas: 0.05, unite: ' mm' },

    /* ── Le mixeur d'images ───────────────────────────────────────────────── */
    /* Déclaré APRÈS la couleur : une image remplace la forme géométrique, et la
       couleur ne sert plus qu'aux modes où aucune image n'est chargée. */
    { key: 'images', label: L('Images (mixeur)', 'Images (mixer)', '画像（ミキサー）'), type: 'images' },
    {
      key: 'melange', label: L('Fusion', 'Blend', '合成'), type: 'select', defaut: 'source-over',
      choix: [
        { value: 'source-over', label: L('Normale', 'Normal', '通常') },
        { value: 'multiply', label: L('Produit', 'Multiply', '乗算') },
        { value: 'screen', label: L('Écran', 'Screen', 'スクリーン') },
        { value: 'overlay', label: L('Incrustation', 'Overlay', 'オーバーレイ') },
        { value: 'difference', label: L('Différence', 'Difference', '差の絶対値') },
        { value: 'lighter', label: L('Addition', 'Add', '加算') },
        { value: 'hard-light', label: L('Lumière crue', 'Hard light', 'ハードライト') }
      ]
    },
    { key: 'melangeOpacite', label: L('Opacité des images', 'Image opacity', '画像の不透明度'), type: 'range', defaut: 100, min: 5, max: 100, pas: 1, unite: '%' },

    /* ── Technique ────────────────────────────────────────────────────────── */
    {
      key: 'cellules', label: L('Cellules par tuile', 'Cells per tile', 'タイルあたりのセル数'), type: 'select', defaut: '1',
      choix: [
        { value: '1', label: L('1 × 1', '1 × 1', '1 × 1') },
        { value: '2', label: L('2 × 2', '2 × 2', '2 × 2') },
        { value: '3', label: L('3 × 3', '3 × 3', '3 × 3') }
      ]
    },
    {
      key: 'facteur', label: L('Netteté', 'Sharpness', '精細さ'), type: 'select', defaut: '4',
      choix: [
        { value: '2', label: L('×2 — rapide', '×2 — fast', '×2 — 高速') },
        { value: '4', label: L('×4 — recommandé', '×4 — recommended', '×4 — 推奨') },
        { value: '8', label: L('×8 — export', '×8 — export', '×8 — 書き出し') }
      ]
    },
    { key: 'libelle', label: L('Nom de l\'objet', 'Object name', 'オブジェクト名'), type: 'text', defaut: 'Motif' }
  ],

  run: function (api, o) {
    var fabric = api.fabric;
    if (!fabric) throw new Error(api.t(L('moteur graphique indisponible', 'graphics engine unavailable', '描画エンジンが利用できません')));

    /* ── Les réglages, normalisés une fois pour toutes ──────────────────────
       Les tirettes rendent des POURCENTAGES (0–100). Le dessin, lui, raisonne en
       fractions (0–1) et en pixels : la conversion se fait ici, à un seul endroit,
       pour qu'aucune formule plus bas n'ait à se demander quelle unité elle reçoit. */
    var pasMm = Math.max(1, Number(o.pas) || 8);
    var tailleMm = Math.max(0.4, Number(o.taille) || 4);
    var pasPx = api.mm(pasMm);
    var facteur = Math.max(1, Math.min(8, parseInt(o.facteur, 10) || 4));
    var angle = Number(o.angle) || 0;
    var rotationCellule = Number(o.rotationCellule) || 0;
    var variation = pct(o.variation);
    var quinconce = pct(o.quinconce);
    var folie = pct(o.folie);
    var melangeOpacite = pct(o.melangeOpacite, 1);
    var ondeMm = Math.max(0, Number(o.onde) || 0);
    var cellules = Math.max(1, Math.min(3, parseInt(o.cellules, 10) || 1));
    var opacite = pct(o.opacite, 1);
    var epaisseurPx = Math.max(0.5, api.mm(Math.max(0.05, Number(o.epaisseur) || 0.5)));
    var traitSeul = !!o.trait;
    var graine = Math.max(1, parseInt(o.graine, 10) || 7);
    var c1 = o.couleur || '#1a1a1a';
    var c2 = o.couleur2 || c1;
    var mode = o.mode || 'tuile';
    /* Le mode « crazy » n'est pas un dessin différent : c'est le même moteur poussé
       par une folie minimale. Sans ce plancher, choisir « Crazy » avec la tirette
       Folie à zéro ne changerait RIEN — et l'utilisateur croirait le mode cassé. */
    var folieEffective = (mode === 'crazy') ? Math.max(folie, 0.42) : folie;
    var MELANGES = ['source-over', 'multiply', 'screen', 'overlay', 'difference', 'lighter', 'hard-light'];
    var melange = MELANGES.indexOf(o.melange) >= 0 ? o.melange : 'source-over';

    function pct(v, defaut) {
      var n = Number(v);
      if (!isFinite(n)) return (defaut === undefined ? 0 : defaut);
      return Math.max(0, Math.min(1, n / 100));
    }

    /* ── Générateur pseudo-aléatoire à graine (mulberry32) ──────────────────
       `Math.random()` ne convient pas : un motif doit se réouvrir à l'identique.
       Cette fonction rend la même suite pour une graine donnée, sur toutes les
       machines, sans dépendance. */
    function alea(s) {
      var a = s >>> 0;
      return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        var t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    /* ── Les symétries du carré (D4) ────────────────────────────────────────
       Appliquées autour du centre de la cellule. Ce sont les 8 transformations
       qui ramènent le carré sur lui-même : aucune ne crée de couture. */
    var D4 = [
      { rot: 0, mirX: 1, mirY: 1 },
      { rot: 90, mirX: 1, mirY: 1 },
      { rot: 180, mirX: 1, mirY: 1 },
      { rot: 270, mirX: 1, mirY: 1 },
      { rot: 0, mirX: -1, mirY: 1 },
      { rot: 0, mirX: 1, mirY: -1 },
      { rot: 90, mirX: -1, mirY: 1 },
      { rot: 90, mirX: 1, mirY: -1 }
    ];
    function symetries(m) {
      switch (m) {
        case 'miroir-x': return [{ rot: 0, mirX: 1, mirY: 1 }, { rot: 0, mirX: 1, mirY: -1 }];
        case 'miroir-y': return [{ rot: 0, mirX: 1, mirY: 1 }, { rot: 0, mirX: -1, mirY: 1 }];
        case 'miroir-xy': return [
          { rot: 0, mirX: 1, mirY: 1 }, { rot: 0, mirX: -1, mirY: 1 },
          { rot: 0, mirX: 1, mirY: -1 }, { rot: 0, mirX: -1, mirY: -1 }
        ];
        case 'quart': return D4.slice(0, 4);
        case 'kaleido': return D4;
        case 'kaleido16': return D4;
        default: return [{ rot: 0, mirX: 1, mirY: 1 }];
      }
    }

    /* ── Couleurs du mode crazy ─────────────────────────────────────────────
       Un tirage entre les deux couleurs ne suffit pas à faire du « chaos » : on
       fait aussi tourner la TEINTE de la première. D'où ces deux conversions, qui
       restent en HSL pour ne pas passer par un espace colorimétrique plus lourd. */
    function hexVersHsl(hex) {
      var s = String(hex || '#1a1a1a').replace('#', '');
      if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
      var r = parseInt(s.slice(0, 2), 16) / 255;
      var g = parseInt(s.slice(2, 4), 16) / 255;
      var b = parseInt(s.slice(4, 6), 16) / 255;
      if (!isFinite(r) || !isFinite(g) || !isFinite(b)) return { h: 0, s: 0, l: 0.1 };
      var max = Math.max(r, g, b), min = Math.min(r, g, b);
      var l = (max + min) / 2, h = 0, sat = 0;
      if (max !== min) {
        var d = max - min;
        sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
      }
      return { h: h, s: sat, l: l };
    }
    function hslCss(h, s, l) {
      return 'hsl(' + Math.round(((h % 1) + 1) % 1 * 360) + ',' +
        Math.round(Math.max(0, Math.min(1, s)) * 100) + '%,' +
        Math.round(Math.max(0, Math.min(1, l)) * 100) + '%)';
    }
    var hsl1 = hexVersHsl(c1);
    /* Une couleur tirée au sort : soit un mélange des deux couleurs de référence,
       soit la première avec la teinte décalée. Le décalage est plafonné à un tiers
       de tour pour que le motif reste de la même famille chromatique. */
    function couleurFolie(rnd) {
      if (rnd() < 0.45) {
        var t = rnd();
        var a = hexVersHsl(c1), b = hexVersHsl(c2);
        return hslCss(a.h + (b.h - a.h) * t, a.s + (b.s - a.s) * t, a.l + (b.l - a.l) * t);
      }
      return hslCss(hsl1.h + (rnd() - 0.5) * 0.66, hsl1.s, hsl1.l);
    }

    /* ── Les images du mixeur, chargées une fois ────────────────────────────
       `cellule()` est appelée des centaines de fois par tuile : y charger une image
       à chaque fois ferait un `new Image()` par copie. On les précharge donc en
       amont, et le dessin se contente de `drawImage` sur des objets déjà prêts. */
    var urlsImages = [];
    if (Array.isArray(o.images)) urlsImages = o.images.slice();
    else if (o.image) urlsImages = [o.image];      /* ancienne forme, un seul champ */
    urlsImages = urlsImages.filter(function (u) { return typeof u === 'string' && u; }).slice(0, 8);
    var imagesChargees = [];

    function chargerImages() {
      if (!urlsImages.length) return Promise.resolve();
      return Promise.all(urlsImages.map(function (url) {
        return new Promise(function (res) {
          var im = new Image();
          im.onload = function () { res(im); };
          im.onerror = function () { res(null); };
          im.src = url;
        });
      })).then(function (liste) {
        imagesChargees = liste.filter(Boolean);
      });
    }

    /* ── Une forme, dessinée centrée en (0,0) ───────────────────────────────
       `forme` est un paramètre et non plus une lecture de `o.forme` : le mode crazy
       change de forme d'une copie à l'autre, et une fonction qui lit la config
       globale ne pourrait pas. */
    function dessinerForme(g, taillePx, forme) {
      var r = taillePx / 2;
      var i, a, x, y, rr;
      switch (forme) {
        case 'carre':
          g.fillRect(-r, -r, taillePx, taillePx);
          break;
        case 'anneau':
          g.beginPath();
          g.arc(0, 0, r, 0, Math.PI * 2);
          g.arc(0, 0, r * 0.55, 0, Math.PI * 2, true);
          g.fill();
          break;
        case 'losange':
          g.beginPath();
          g.moveTo(0, -r); g.lineTo(r, 0); g.lineTo(0, r); g.lineTo(-r, 0);
          g.closePath(); g.fill();
          break;
        case 'triangle':
          g.beginPath();
          g.moveTo(0, -r); g.lineTo(r * 0.92, r * 0.72); g.lineTo(-r * 0.92, r * 0.72);
          g.closePath(); g.fill();
          break;
        case 'hexagone':
        case 'nid':
          g.beginPath();
          for (i = 0; i < 6; i++) {
            a = Math.PI / 3 * i - Math.PI / 2;
            x = Math.cos(a) * r; y = Math.sin(a) * r;
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.closePath(); g.fill();
          break;
        case 'etoile5':
        case 'etoile6': {
          var branches = (forme === 'etoile6') ? 6 : 5;
          var rInt = r * 0.44;
          g.beginPath();
          for (i = 0; i < branches * 2; i++) {
            rr = (i % 2 === 0) ? r : rInt;
            a = (Math.PI / branches) * i - Math.PI / 2;
            x = Math.cos(a) * rr; y = Math.sin(a) * rr;
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.closePath(); g.fill();
          break;
        }
        case 'croix': {
          var bras = taillePx / 3;
          g.fillRect(-bras / 2, -r, bras, taillePx);
          g.fillRect(-r, -bras / 2, taillePx, bras);
          break;
        }
        case 'goutte':
          g.beginPath();
          g.moveTo(0, -r);
          g.bezierCurveTo(r * 0.55, -r * 0.45, r * 0.85, r * 0.25, 0, r);
          g.bezierCurveTo(-r * 0.85, r * 0.25, -r * 0.55, -r * 0.45, 0, -r);
          g.closePath(); g.fill();
          break;
        case 'fleur':
          for (i = 0; i < 4; i++) {
            g.save();
            g.rotate(Math.PI / 2 * i);
            g.beginPath();
            g.ellipse(0, -r * 0.55, r * 0.34, r * 0.5, 0, 0, Math.PI * 2);
            g.fill();
            g.restore();
          }
          break;
        case 'spirale': {
          g.beginPath();
          var tours = 2.5, pasS = r / (tours * Math.PI * 2);
          for (i = 0; i <= 220; i++) {
            var t = i / 220 * tours * Math.PI * 2;
            var rad = pasS * t;
            x = Math.cos(t) * rad; y = Math.sin(t) * rad;
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.stroke();
          break;
        }
        case 'vague': {
          /* Une période exactement sur la largeur : le raccord d'une cellule à la
             suivante est continu, sans couture visible. */
          g.beginPath();
          var amp = r * 0.7;
          for (i = 0; i <= 32; i++) {
            var u = i / 32;
            x = -r + u * taillePx;
            y = Math.sin(u * Math.PI * 2) * amp;
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.stroke();
          break;
        }
        case 'lignes':
          g.beginPath();
          g.moveTo(-r, r); g.lineTo(r, -r);
          g.stroke();
          break;
        case 'cercle':
        default:
          g.beginPath();
          g.arc(0, 0, r, 0, Math.PI * 2);
          g.fill();
          break;
      }
    }

    /* ── Le remplissage : couleur unie, dégradé, ou tirage du mode crazy ──── */
    function style(g, r, rnd) {
      if (traitSeul) {
        g.strokeStyle = (folieEffective > 0 && rnd) ? couleurFolie(rnd) : ((o.degrade === 'aucun') ? c1 : c2);
        g.lineWidth = epaisseurPx;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        return;
      }
      if (folieEffective > 0 && rnd) {
        g.fillStyle = couleurFolie(rnd);
        return;
      }
      if (o.degrade === 'lineaire') {
        var gl = g.createLinearGradient(-r, -r, r, r);
        gl.addColorStop(0, c1); gl.addColorStop(1, c2);
        g.fillStyle = gl;
      } else if (o.degrade === 'radial') {
        var gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
        gr.addColorStop(0, c1); gr.addColorStop(1, c2);
        g.fillStyle = gr;
      } else {
        g.fillStyle = c1;
      }
    }

    /* ── Le mixeur : les images superposées, avec leur mode de fusion ─────── */
    function dessinerImages(g, taillePx) {
      if (!imagesChargees.length) return false;
      imagesChargees.forEach(function (im) {
        var ratio = (im.width && im.height) ? (im.width / im.height) : 1;
        var w = taillePx, h = taillePx;
        if (ratio >= 1) h = taillePx / ratio; else w = taillePx * ratio;
        g.save();
        g.globalCompositeOperation = melange;
        g.globalAlpha = melangeOpacite;
        g.drawImage(im, -w / 2, -h / 2, w, h);
        g.restore();
      });
      return true;
    }

    /* ── Une cellule : le contenu, multiplié par la symétrie choisie ──────── */
    var FORMES = ['cercle', 'anneau', 'carre', 'losange', 'triangle', 'hexagone',
      'etoile5', 'etoile6', 'croix', 'goutte', 'fleur', 'spirale', 'vague', 'lignes', 'nid'];

    function cellule(g, cx, cy, cote, angleExtra, aleatoire) {
      /* En mode crazy, on part de D4 quoi qu'affiche la liste : c'est la définition
         du mode, et le laisser dépendre d'un autre réglage rendrait le résultat
         imprévisible d'une façon qui n'aide personne. */
      var sym = symetries(mode === 'crazy' ? 'kaleido16' : o.symetrie);
      var echelle = (variation > 0) ? (1 - variation * 0.45 * aleatoire()) : 1;
      /* ⚠️ L'ÉCART AU CENTRE EST CE QUI REND LE KALÉIDOSCOPE VISIBLE.
         Une forme CENTRÉE est invariante par les huit symétries du carré : les
         copies se superposent et le réglage ne fait rien de visible (mesuré :
         1 588 pixels opaques avec symétrie, 1 595 sans). Le plafond à 0,5 de cellule
         évite qu'une copie sorte de la cellule et laisse un trou dans le pavage. */
      var ecartPx = Math.min(0.5, Math.max(0, pct(o.ecart))) * cote;
      var passes = (mode === 'crazy')
        ? [{ f: 1, a: 0 }, { f: 0.62, a: Math.PI / 6 }, { f: 0.38, a: Math.PI / 3 }]
        : (o.symetrie === 'kaleido16')
          ? [{ f: 1, a: 0 }, { f: 0.55, a: Math.PI / 4 }]
          : [{ f: 1, a: 0 }];

      passes.forEach(function (p) {
        var rayon = (api.mm(tailleMm) * facteur * echelle) * p.f / 2;
        sym.forEach(function (s) {
          g.save();
          g.translate(cx, cy);
          /* ⚠️ L'ORDRE DES TRANSFORMATIONS EST LE CŒUR DU KALÉIDOSCOPE.
             `translate(écart)` PUIS `rotate` fait tourner autour du point déjà
             décalé : le centre ne bouge pas d'une copie à l'autre et les huit se
             superposent (mesuré : 1 588 pixels opaques avec et sans symétrie).
             `rotate` d'abord, `translate` ensuite, dans le repère déjà tourné. */
          var folieRot = (folieEffective > 0) ? (aleatoire() - 0.5) * 360 * folieEffective : 0;
          var folieEch = (folieEffective > 0) ? (0.55 + aleatoire() * 0.9 * folieEffective + (1 - folieEffective)) : 1;
          var folieEcart = (folieEffective > 0) ? (0.5 + aleatoire()) * folieEffective : 1;
          g.rotate(((angle + angleExtra + folieRot) * Math.PI / 180) + p.a);
          g.rotate(s.rot * Math.PI / 180);
          g.scale(s.mirX, s.mirY);
          g.translate(ecartPx * p.f * folieEcart, 0);
          var taille = api.mm(tailleMm) * facteur * echelle * p.f * folieEch;
          if (!dessinerImages(g, taille)) {
            style(g, rayon, (folieEffective > 0) ? aleatoire : null);
            var forme = (mode === 'crazy' && folieEffective > 0.25)
              ? FORMES[Math.floor(aleatoire() * FORMES.length) % FORMES.length]
              : o.forme;
            dessinerForme(g, taille, forme);
          }
          g.restore();
        });
      });
    }

    /* ── La tuile (ou la super-tuile) ─────────────────────────────────────── */
    function tuile() {
      var N = cellules;
      var coteCellule = Math.max(6, pasPx * facteur);
      var cote = coteCellule * N;
      var cv = document.createElement('canvas');
      cv.width = Math.max(8, Math.round(cote));
      cv.height = Math.max(8, Math.round(cote));
      var g = cv.getContext('2d');
      if (!g) throw new Error(api.t(L('canvas 2D indisponible', '2D canvas unavailable', '2D キャンバスが利用できません')));

      if (o.fondActif) {
        g.fillStyle = o.fondTuile || '#ffffff';
        g.fillRect(0, 0, cv.width, cv.height);
      }

      var ondePx = api.mm(ondeMm) * facteur;
      for (var j = 0; j < N; j++) {
        for (var i = 0; i < N; i++) {
          var aleatoire = alea(graine * 7919 + j * 131 + i * 17 + 1);
          var cx = (i + 0.5) * coteCellule;
          var cy = (j + 0.5) * coteCellule;
          /* Quinconce : une ligne sur deux est décalée d'une demi-cellule. La forme
             peut alors sortir par la droite — on la redessine à gauche plus bas,
             sinon le motif aurait un trou d'un demi-pas. */
          if (quinconce > 0 && (j % 2 === 1)) cx += coteCellule * 0.5 * quinconce;
          if (variation > 0) {
            cx += (aleatoire() - 0.5) * coteCellule * 0.28 * variation;
            cy += (aleatoire() - 0.5) * coteCellule * 0.28 * variation;
          }
          if (ondePx > 0) {
            /* Période = largeur de la tuile : sin(2π x / W) retombe exactement sur
               sa valeur au bord, le raccord reste invisible. */
            cy += Math.sin((cx / cv.width) * Math.PI * 2) * ondePx;
          }
          var angleExtra = rotationCellule * (j * N + i);
          cellule(g, cx % cv.width, cy, coteCellule, angleExtra, aleatoire);
          if (cx > cv.width) {
            cellule(g, cx - cv.width, cy, coteCellule, angleExtra, alea(graine + i + j));
          }
        }
      }
      return cv;
    }

    /* ═══ LE GRAND APERÇU — UN ROND, DÉCOUPÉ DANS LE CANEVAS ════════════════
       On dessine la tuile RÉPÉTÉE, pas une vignette d'une forme : c'est le rythme
       et le raccord qu'on vient juger. Un motif à 8 mm de pas ne se voit pas sur
       une vignette de 28 px.
       ⚠️ LE DÉCOUPAGE CIRCULAIRE SE FAIT ICI, PAS SEULEMENT EN CSS. Le champ est
       affiché en rond (`border-radius: 50%`), mais un rond n'a pas de coin : si le
       dessin restait carré, la répétition s'arrêterait net sur la diagonale et le
       rond paraîtrait rogné. On clippe donc au cercle inscrit, et la boucle de
       répétition part d'un pas AVANT le bord pour couvrir le débord.
       Trois présentations, parce que les trois effets ne se lisent pas pareil :
       la tuile se RÉPÈTE, la rosace se voit ENTIÈRE, le kaléidoscope COUVRE. */
    function previsualiser(source) {
      var t = (api.toileApercu ? api.toileApercu() : null);
      if (!t || !t.ctx || !source) return;
      var g = t.ctx;
      var W = t.largeur, H = t.hauteur;
      try {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;
        g.clearRect(0, 0, W, H);
        g.save();
        g.beginPath();
        g.arc(W / 2, H / 2, Math.min(W, H) / 2, 0, Math.PI * 2);
        g.clip();
        if (o.fondActif) {
          g.fillStyle = o.fondTuile || '#ffffff';
          g.fillRect(0, 0, W, H);
        }
        var cote = Math.max(1, source.width);
        if (mode === 'rosette' || mode === 'miroir') {
          var e = Math.min(W / cote, H / source.height);
          var w1 = cote * e, h1 = source.height * e;
          g.drawImage(source, (W - w1) / 2, (H - h1) / 2, w1, h1);
          g.restore();
          return;
        }
        /* Trois répétitions en largeur : assez pour voir le motif s'installer,
           assez peu pour que chaque forme reste lisible. */
        var ech = (W / 3) / cote;
        var pas = cote * ech;
        for (var y = -pas; y < H + pas; y += pas) {
          for (var x = -pas; x < W + pas; x += pas) {
            g.drawImage(source, x, y, pas, pas);
          }
        }
        g.restore();
      } catch (_) {}
    }

    /* ── La cible ────────────────────────────────────────────────────────── */
    function cible() {
      var doc = api.document;
      var sel = api.selection();
      if ((o.cible === 'selection' || o.cible === 'auto') && sel && sel.length) {
        var bloc = sel[0];
        return {
          objet: bloc,
          largeur: bloc.width * (bloc.scaleX || 1),
          hauteur: bloc.height * (bloc.scaleY || 1),
          gauche: bloc.left,
          haut: bloc.top,
          remplace: true
        };
      }
      if (o.cible === 'selection') {
        throw new Error(api.t(L('aucun bloc sélectionné : sélectionnez un cadre, ou choisissez « toute la page »', 'no block selected: select a frame, or choose “whole page”', 'ブロックが選択されていません。フレームを選ぶか「ページ全体」を選んでください')));
      }
      return { objet: null, largeur: doc.largeur, hauteur: doc.hauteur, gauche: 0, haut: 0, remplace: false };
    }

    /* ── Le kaléidoscope de page : miroir du rendu, sans le motif ────────── */
    function sourcePage() {
      try {
        var el = null;
        var actif = (typeof window.getActiveCanvas === 'function') ? window.getActiveCanvas() : null;
        if (actif && actif.lowerCanvasEl) el = actif.lowerCanvasEl;
        if (!el) el = document.querySelector('#pagesContainer canvas');
        if (!el) return null;
        return el.toDataURL('image/png');
      } catch (_) { return null; }
    }

    function poserMiroir(c) {
      var source = sourcePage();
      if (!source) throw new Error(api.t(L('la page ne peut pas être relue pour le kaléidoscope', 'the page cannot be re-read for the kaleidoscope', '万華鏡のためにページを読み直せません')));
      var cote = Math.max(64, Math.round(Math.min(c.largeur, c.hauteur) * 2));
      return new Promise(function (resolve, reject) {
        var src = new Image();
        src.onload = function () {
          try {
            var demi = cote / 2;
            var cv = document.createElement('canvas');
            cv.width = cote; cv.height = cote;
            var g = cv.getContext('2d');
            if (o.fondActif) { g.fillStyle = o.fondTuile || '#ffffff'; g.fillRect(0, 0, cote, cote); }
            /* Le rendu de la page est réduit dans le quadrant haut-gauche, puis
               reflété dans les trois autres : c'est la définition d'un kaléidoscope
               à quatre miroirs. */
            function quadrant(x, y, sx, sy) {
              g.save();
              g.translate(x, y);
              g.scale(sx, sy);
              g.drawImage(src, 0, 0, demi, demi);
              g.restore();
            }
            quadrant(0, 0, 1, 1);
            quadrant(cote, 0, -1, 1);
            quadrant(0, cote, 1, -1);
            quadrant(cote, cote, -1, -1);
            resolve(cv);
          } catch (e) { reject(e); }
        };
        src.onerror = function () { reject(new Error(api.t(L('kaléidoscope : rendu de page illisible', 'kaleidoscope: page render unreadable', '万華鏡：ページの描画を読み取れません')))); };
        src.src = source;
      });
    }

    /* ── Poser ──────────────────────────────────────────────────────────── */
    return chargerImages().then(function () {
      return new Promise(function (resolve, reject) {
        function poser(c, sourceTuile, echelleMotif) {
          var echelle = (echelleMotif && isFinite(echelleMotif) && echelleMotif > 0) ? echelleMotif : 1;
          var pat = new fabric.Pattern({
            source: sourceTuile,
            repeat: 'repeat',
            /* Le facteur de netteté a déjà agrandi la tuile : il faut la remettre à
               l'échelle du document, sinon le motif serait `facteur` fois trop gros. */
            patternTransform: (echelle !== 1) ? [echelle, 0, 0, echelle, 0, 0] : undefined
          });

          if (c.remplace && c.objet) {
            if (!c.objet._spMotifAvant) {
              try { c.objet._spMotifAvant = c.objet.fill; } catch (_) {}
            }
            c.objet.set({ fill: pat });
            if (opacite < 1) c.objet.set({ opacity: opacite });
            c.objet._spMotifPlugin = true;
            c.objet._spMotifSurBloc = true;
            try { c.objet.dirty = true; } catch (_) {}
            try {
              var cvb = c.objet.canvas;
              if (cvb) { cvb.requestRenderAll ? cvb.requestRenderAll() : cvb.renderAll(); }
            } catch (_) {}
            if (api.apercu) api.sync();
            else api.commit('Plug-in : ' + (o.libelle || 'Motif'));
            resolve(c.objet);
            return;
          }

          var rect = new fabric.Rect({
            left: c.gauche, top: c.haut, width: c.largeur, height: c.hauteur,
            fill: pat, strokeWidth: 0, stroke: null,
            selectable: true, evented: true,
            objectCaching: false,
            noScaleCache: true
          });
          rect._spMotifPlugin = true;
          if (opacite < 1) rect.set({ opacity: opacite });
          try { rect.set({ name: o.libelle || 'Motif' }); } catch (_) {}
          api.add(rect, { libelle: 'Plug-in : ' + (o.libelle || 'Motif'), envoyerEnArriere: true });
          resolve(rect);
        }

        try {
          /* ⚠️ LE NETTOYAGE PASSE AVANT TOUT, ET C'EST UNE NÉCESSITÉ, PAS UN ORDRE.
             Le mode « kaléidoscope de la page » relit le rendu du plan de travail :
             si le motif de l'aperçu précédent est encore posé, il se reflète
             lui-même, et chaque mouvement de tirette empile une génération de plus
             — le dessin se dégrade visiblement en quelques réglages.
             On retire donc le motif d'AVANT sur TOUS les plans de travail, pas
             seulement l'actif : changer de page puis revenir ne doit pas révéler un
             ancien motif resté en place. */
          try {
            api.canvases().forEach(function (cv2) {
              if (!cv2 || typeof cv2.getObjects !== 'function') return;
              cv2.getObjects().slice().forEach(function (obj) {
                if (obj && obj._spMotifPlugin) cv2.remove(obj);
              });
              if (cv2.requestRenderAll) cv2.requestRenderAll();
            });
          } catch (_) {}

          /* ⚠️ LA CIBLE PEUT ÉCHOUER SANS QUE L'APERÇU DOIVE ÉCHOUER.
             En mode « bloc sélectionné » sans sélection, `cible()` lève. Si l'on
             sortait tout de suite, la trappe afficherait une erreur ET un aperçu
             vide : impossible de régler le motif avant d'avoir choisi sa cible. On
             note donc l'erreur, on montre l'aperçu, puis on la relève. */
          var c = null, errCible = null;
          try { c = cible(); } catch (e) { errCible = e; }

          if (mode === 'miroir') {
            var tailleRef = c || { largeur: api.document.largeur, hauteur: api.document.hauteur };
            poserMiroir(tailleRef).then(function (cv) {
              previsualiser(cv);
              if (errCible) { reject(errCible); return; }
              poser(c, cv, 1);
            }).catch(reject);
            return;
          }

          if (mode === 'rosette') {
            /* Une seule rosace : une tuile de la taille du bloc. On ne peut pas s'en
               servir comme motif — `repeat: 'no-repeat'` n'existe pas dans Fabric 5 —
               mais une image donne exactement le même résultat pour une rosace unique. */
            var coteR = c ? Math.max(c.largeur, c.hauteur) : Math.max(api.document.largeur, api.document.hauteur);
            var cvr = document.createElement('canvas');
            cvr.width = Math.round(coteR); cvr.height = Math.round(coteR);
            var gr = cvr.getContext('2d');
            if (o.fondActif) { gr.fillStyle = o.fondTuile || '#ffffff'; gr.fillRect(0, 0, coteR, coteR); }
            cellule(gr, coteR / 2, coteR / 2, coteR, 0, alea(graine));
            previsualiser(cvr);
            if (errCible) { reject(errCible); return; }
            var img = new fabric.Image(cvr, {
              left: c.gauche, top: c.haut,
              selectable: true, evented: true, objectCaching: false
            });
            try { img.set({ name: o.libelle || 'Rosace' }); } catch (_) {}
            img._spMotifPlugin = true;
            if (opacite < 1) img.set({ opacity: opacite });
            api.add(img, { libelle: 'Plug-in : ' + (o.libelle || 'Rosace'), envoyerEnArriere: true });
            resolve(img);
            return;
          }

          var cvT = tuile();
          previsualiser(cvT);
          if (errCible) { reject(errCible); return; }
          poser(c, cvT, 1 / facteur);
        } catch (e) { reject(e); }
      });
    });
  }
});
