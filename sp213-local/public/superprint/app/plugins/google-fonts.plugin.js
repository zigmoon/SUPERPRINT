/* ═══════════════════════════════════════════════════════════════════════════════
   SUPERPRINT — PLUG-IN INTÉGRÉ « POLICES GOOGLE »  (v1.7.674)
   ═══════════════════════════════════════════════════════════════════════════════

   Demande utilisateur : « créer un plugin fonts qui affichera les plus grandes typo
   du moment de Google Fonts avec preview, installable automatiquement dans
   SuperPrint », puis « le plugin Polices Google n'est pas assez complet, je dois
   pouvoir avoir plus de polices (plus de choix, load more ou je ne sais pas) ».

   ── CE QUE FAIT CE FICHIER ────────────────────────────────────────────────────
   Un panneau qui présente un CATALOGUE de plus de 200 familles Google, CHACUNE
   DESSINÉE DANS SA PROPRE POLICE — avec la phrase de l'utilisateur s'il en a écrit
   une — et un bouton qui l'installe pour de bon : la famille rejoint les sélecteurs
   de police de l'application et reste disponible aux lancements suivants.

   ── POURQUOI LE CATALOGUE EST ÉCRIT ICI, ET PAS DEMANDÉ À GOOGLE ──────────────
   MESURÉ, les deux routes dynamiques sont fermées depuis un navigateur :
     · `fonts.google.com/metadata/fonts` (le catalogue complet) → refusé par CORS,
       aucun en-tête `Access-Control-Allow-Origin` ;
     · `googleapis.com/webfonts/v1/webfonts` → HTTP 403 « Method doesn't allow
       unregistered callers » (il faut une clé).
   Une galerie qui dépendrait de l'une ou de l'autre serait vide chez tout le monde,
   sans explication. Le catalogue est donc une LISTE ÉCRITE, et c'est un choix : elle
   ne casse pas le jour où Google change une réponse.

   ── POURQUOI IL PASSE PAR `_spRegisterCustomFontDataUrl` ──────────────────────
   L'application sait déjà accueillir une police depuis un fichier (« Charger
   polices ») : FontFace + `document.fonts`, ajout au `<select>`, `customFonts`,
   rafraîchissement des blocs, et embarquement dans le `.sp` SEULEMENT si la police
   sert dans le document. Réécrire ce chemin aurait produit une seconde vérité, et
   une police qui s'affiche mais qu'on ne peut pas enregistrer. On réutilise donc
   l'existant, en lui donnant les octets d'un fichier Google.

   ⚠️ DEUX ADRESSES PAR FAMILLE, ET C'EST UNE MESURE QUI L'IMPOSE.
   `css2?family=Nom:wght@100..900` ne répond QUE pour une police VARIABLE. Pour une
   police statique (Lato, Anton…), Google renvoie une erreur SANS en-tête CORS : côté
   navigateur, cela ressemble à une panne réseau, pas à un refus. Mesuré sur Lato et
   Anton : « Failed to fetch ». `css2?family=Nom` (sans axe), lui, répond 200 pour
   TOUTES les familles et déclare la graisse 400.
   On demande donc la PLAGE pour les familles signalées variables, et on RETOMBE sur
   l'adresse simple en cas d'échec — y compris si la veille s'est trompée. Aucune
   famille ne peut donc rester muette à cause d'une mauvaise case cochée.

   ⚠️ LES GRAISSES SONT LUES DANS LA RÉPONSE, PAS DEVINÉES.
   Le CSS renvoyé contient `font-weight: 100 900` (variable) ou `font-weight: 400`
   (statique). On lit cette valeur et on annonce au sélecteur de graisse EXACTEMENT
   ce que la police possède. Annoncer 800 pour une famille qui s'arrête à 700
   donnerait un gras synthétique, c'est-à-dire un faux.

   ⚠️ LES APERÇUS SE CHARGENT À LA DEMANDE (IntersectionObserver).
   150 familles, c'est 150 fichiers de police. Tout charger à l'ouverture ferait
   payer plusieurs mégaoctets pour des lignes que personne n'a regardées. Chaque ligne
   demande SA police quand elle entre dans la zone visible — et la demande est
   mémorisée, donc un aller-retour dans la liste ne relance rien.

   ⚠️ `trappe: 'spFontsOverlay'` — CE PLUG-IN A SON PANNEAU.
   La trappe générique ne connaît que des champs (texte, nombre, couleur, image…) :
   une galerie de polices n'y entre pas. Déclarer un panneau fait que la bibliothèque
   EXÉCUTE le plug-in au lieu de construire un formulaire vide avec un bouton
   « Enregistrer » sans objet (cf. `ouvrirTrappePlugIn`).
   ─────────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var L = window.SPPluginL || function (fr, en, ja) { return { fr: fr, en: en || fr, ja: ja || en || fr }; };
  var api = null;

  /* La liste conservée des installations, pour les retrouver au lancement suivant. */
  var CLE = 'sp_google_fonts_v1';
  var CLE_PLAGE = 'sp_google_fonts_plage_ko_v1';
  /* Marque de la session : évite de réinstaller deux fois la même famille. */
  var dejaChargees = Object.create(null);

  /* ══ LE CATALOGUE ══════════════════════════════════════════════════════════════
     `n` = nom exact chez Google (il sert à l'adresse ET au nom de la police dans
     l'application). `c` = catégorie. `v` = 1 quand la famille est une police
     VARIABLE : on demande alors la plage de graisses (un seul fichier pour toute la
     plage). Sans `v`, on demande l'adresse simple, qui répond toujours.
     ⚠️ CES TROIS CHAMPS SUFFISENT : aucune graisse n'est écrite à la main, elles sont
     toutes lues dans la réponse de Google (voir `poidsDuCss`). Une famille cochée
     `v` par erreur ne casse rien : l'échec de la plage déclenche le repli simple. */
  var FAMILLES = [
    /* ── Sans empattement ────────────────────────────────────────────────────── */
    { n: 'Inter', c: 'sans', v: 1 },
    { n: 'Roboto', c: 'sans', v: 1 },
    { n: 'Open Sans', c: 'sans', v: 1 },
    { n: 'Montserrat', c: 'sans', v: 1 },
    { n: 'Poppins', c: 'sans' },
    { n: 'Lato', c: 'sans' },
    { n: 'Raleway', c: 'sans', v: 1 },
    { n: 'Nunito', c: 'sans', v: 1 },
    { n: 'Nunito Sans', c: 'sans', v: 1 },
    { n: 'Work Sans', c: 'sans', v: 1 },
    { n: 'DM Sans', c: 'sans', v: 1 },
    { n: 'Manrope', c: 'sans', v: 1 },
    { n: 'Sora', c: 'sans', v: 1 },
    { n: 'Outfit', c: 'sans', v: 1 },
    { n: 'Plus Jakarta Sans', c: 'sans', v: 1 },
    { n: 'Figtree', c: 'sans', v: 1 },
    { n: 'Space Grotesk', c: 'sans', v: 1 },
    { n: 'Oswald', c: 'sans', v: 1 },
    { n: 'Archivo', c: 'sans', v: 1 },
    { n: 'Roboto Condensed', c: 'sans', v: 1 },
    { n: 'Roboto Flex', c: 'sans', v: 1 },
    { n: 'Source Sans 3', c: 'sans', v: 1 },
    { n: 'Noto Sans', c: 'sans', v: 1 },
    { n: 'Noto Sans Display', c: 'sans', v: 1 },
    { n: 'Public Sans', c: 'sans', v: 1 },
    { n: 'Karla', c: 'sans', v: 1 },
    { n: 'Rubik', c: 'sans', v: 1 },
    { n: 'Barlow', c: 'sans', v: 1 },
    { n: 'Barlow Condensed', c: 'sans', v: 1 },
    { n: 'Barlow Semi Condensed', c: 'sans', v: 1 },
    { n: 'Mulish', c: 'sans', v: 1 },
    { n: 'Quicksand', c: 'sans', v: 1 },
    { n: 'Josefin Sans', c: 'sans', v: 1 },
    { n: 'Cabin', c: 'sans', v: 1 },
    { n: 'Heebo', c: 'sans', v: 1 },
    { n: 'Asap', c: 'sans', v: 1 },
    { n: 'Assistant', c: 'sans', v: 1 },
    { n: 'Exo 2', c: 'sans', v: 1 },
    { n: 'Titillium Web', c: 'sans' },
    { n: 'Ubuntu', c: 'sans' },
    { n: 'PT Sans', c: 'sans' },
    { n: 'PT Sans Narrow', c: 'sans' },
    { n: 'Fira Sans', c: 'sans' },
    { n: 'Fira Sans Condensed', c: 'sans' },
    { n: 'Signika', c: 'sans', v: 1 },
    { n: 'Signika Negative', c: 'sans', v: 1 },
    { n: 'Overpass', c: 'sans', v: 1 },
    { n: 'Chivo', c: 'sans', v: 1 },
    { n: 'Epilogue', c: 'sans', v: 1 },
    { n: 'Familjen Grotesk', c: 'sans', v: 1 },
    { n: 'Hanken Grotesk', c: 'sans', v: 1 },
    { n: 'Schibsted Grotesk', c: 'sans', v: 1 },
    { n: 'Bricolage Grotesque', c: 'sans', v: 1 },
    { n: 'Instrument Sans', c: 'sans', v: 1 },
    { n: 'Onest', c: 'sans', v: 1 },
    { n: 'Wix Madefor Display', c: 'sans', v: 1 },
    { n: 'Wix Madefor Text', c: 'sans', v: 1 },
    { n: 'Be Vietnam Pro', c: 'sans' },
    { n: 'Urbanist', c: 'sans', v: 1 },
    { n: 'Red Hat Display', c: 'sans', v: 1 },
    { n: 'Red Hat Text', c: 'sans', v: 1 },
    { n: 'Albert Sans', c: 'sans', v: 1 },
    { n: 'Gabarito', c: 'sans', v: 1 },
    { n: 'Golos Text', c: 'sans', v: 1 },
    /* ⚠️ « Golos UI » A ÉTÉ RETIRÉE APRÈS MESURE, PAS PAR GOUT.
       Elle se présente comme une famille sœur de « Golos Text » sur le site de Google,
       mais l'API css2 la refuse : `family=Golos+UI` rend 400 avec une page HTML — donc
       même la demande la plus simple échoue, l'aperçu reste vide et le navigateur
       bloque la réponse (ERR_BLOCKED_BY_ORB). Sur les 218 familles du catalogue,
       testées une à une, c'était la SEULE en échec. « Onest » la remplace : même
       registre, variable, et vérifiée en 200. */
    { n: 'Onest', c: 'sans', v: 1 },
    { n: 'Inter Tight', c: 'sans', v: 1 },
    { n: 'Jost', c: 'sans', v: 1 },
    { n: 'Comfortaa', c: 'sans', v: 1 },
    { n: 'Varela Round', c: 'sans' },
    { n: 'Hind', c: 'sans' },
    { n: 'Catamaran', c: 'sans', v: 1 },
    { n: 'Maven Pro', c: 'sans', v: 1 },
    { n: 'Kanit', c: 'sans' },
    { n: 'Prompt', c: 'sans' },
    { n: 'Sarabun', c: 'sans' },
    { n: 'Lexend', c: 'sans', v: 1 },
    { n: 'Smooch Sans', c: 'sans', v: 1 },
    { n: 'Darker Grotesque', c: 'sans', v: 1 },
    { n: 'Anybody', c: 'sans', v: 1 },
    { n: 'Anek Latin', c: 'sans', v: 1 },
    { n: 'Bai Jamjuree', c: 'sans' },
    { n: 'Commissioner', c: 'sans', v: 1 },
    { n: 'Encode Sans', c: 'sans', v: 1 },
    { n: 'Sofia Sans', c: 'sans', v: 1 },
    { n: 'Unbounded', c: 'sans', v: 1 },
    { n: 'Manuale', c: 'sans', v: 1 },

    /* ── Avec empattement ────────────────────────────────────────────────────── */
    { n: 'Playfair Display', c: 'serif', v: 1 },
    { n: 'Merriweather', c: 'serif' },
    { n: 'Libre Baskerville', c: 'serif' },
    { n: 'Cormorant Garamond', c: 'serif' },
    { n: 'Fraunces', c: 'serif', v: 1 },
    { n: 'Newsreader', c: 'serif', v: 1 },
    { n: 'Instrument Serif', c: 'serif' },
    { n: 'Lora', c: 'serif', v: 1 },
    { n: 'EB Garamond', c: 'serif', v: 1 },
    { n: 'Crimson Text', c: 'serif' },
    { n: 'Crimson Pro', c: 'serif', v: 1 },
    { n: 'Source Serif 4', c: 'serif', v: 1 },
    { n: 'Noto Serif', c: 'serif', v: 1 },
    { n: 'Noto Serif Display', c: 'serif', v: 1 },
    { n: 'Bitter', c: 'serif', v: 1 },
    { n: 'Zilla Slab', c: 'serif' },
    { n: 'Roboto Serif', c: 'serif', v: 1 },
    { n: 'Spectral', c: 'serif' },
    { n: 'Literata', c: 'serif', v: 1 },
    { n: 'PT Serif', c: 'serif' },
    { n: 'Domine', c: 'serif', v: 1 },
    { n: 'Arvo', c: 'serif' },
    { n: 'Bree Serif', c: 'serif' },
    { n: 'Alegreya', c: 'serif', v: 1 },
    { n: 'Cardo', c: 'serif' },
    { n: 'Libre Caslon Text', c: 'serif' },
    { n: 'Petrona', c: 'serif', v: 1 },
    { n: 'Young Serif', c: 'serif' },
    { n: 'DM Serif Display', c: 'serif' },
    { n: 'DM Serif Text', c: 'serif' },
    { n: 'Bodoni Moda', c: 'serif', v: 1 },
    { n: 'Prata', c: 'serif' },
    { n: 'Abril Fatface', c: 'serif' },
    { n: 'Frank Ruhl Libre', c: 'serif' },
    { n: 'Vollkorn', c: 'serif' },
    { n: 'Gelasio', c: 'serif' },
    { n: 'Tinos', c: 'serif' },
    { n: 'Marcellus', c: 'serif' },
    { n: 'Cinzel', c: 'serif', v: 1 },
    { n: 'Yeseva One', c: 'serif' },
    { n: 'Cormorant', c: 'serif' },
    { n: 'Libre Franklin', c: 'serif', v: 1 },
    { n: 'Eczar', c: 'serif' },
    { n: 'Faustina', c: 'serif', v: 1 },
    { n: 'Besley', c: 'serif', v: 1 },
    { n: 'Italiana', c: 'serif' },
    { n: 'Rufina', c: 'serif' },

    /* ── Chasse fixe ─────────────────────────────────────────────────────────── */
    { n: 'JetBrains Mono', c: 'mono', v: 1 },
    { n: 'Fira Code', c: 'mono', v: 1 },
    { n: 'Source Code Pro', c: 'mono', v: 1 },
    { n: 'IBM Plex Mono', c: 'mono' },
    { n: 'Space Mono', c: 'mono' },
    { n: 'Roboto Mono', c: 'mono', v: 1 },
    { n: 'Inconsolata', c: 'mono', v: 1 },
    { n: 'Ubuntu Mono', c: 'mono' },
    { n: 'Courier Prime', c: 'mono' },
    { n: 'Anonymous Pro', c: 'mono' },
    { n: 'Overpass Mono', c: 'mono', v: 1 },
    { n: 'Red Hat Mono', c: 'mono', v: 1 },
    { n: 'DM Mono', c: 'mono' },
    { n: 'Noto Sans Mono', c: 'mono', v: 1 },
    { n: 'Cutive Mono', c: 'mono' },
    { n: 'Share Tech Mono', c: 'mono' },
    { n: 'PT Mono', c: 'mono' },
    { n: 'Martian Mono', c: 'mono', v: 1 },
    { n: 'Spline Sans Mono', c: 'mono', v: 1 },
    { n: 'Chivo Mono', c: 'mono', v: 1 },

    /* ── Titrage ─────────────────────────────────────────────────────────────── */
    { n: 'Bebas Neue', c: 'display' },
    { n: 'Anton', c: 'display' },
    { n: 'Archivo Black', c: 'display' },
    { n: 'Righteous', c: 'display' },
    { n: 'Lobster', c: 'display' },
    { n: 'Alfa Slab One', c: 'display' },
    { n: 'Bungee', c: 'display' },
    { n: 'Monoton', c: 'display' },
    { n: 'Press Start 2P', c: 'display' },
    { n: 'Rubik Mono One', c: 'display' },
    { n: 'Black Ops One', c: 'display' },
    { n: 'Fugaz One', c: 'display' },
    { n: 'Russo One', c: 'display' },
    { n: 'Teko', c: 'display' },
    { n: 'Orbitron', c: 'display', v: 1 },
    { n: 'Audiowide', c: 'display' },
    { n: 'Chakra Petch', c: 'display' },
    { n: 'Silkscreen', c: 'display' },
    { n: 'Pixelify Sans', c: 'display', v: 1 },
    { n: 'Rowdies', c: 'display' },
    { n: 'Titan One', c: 'display' },
    { n: 'Shrikhand', c: 'display' },
    { n: 'Cinzel Decorative', c: 'display' },
    { n: 'Julius Sans One', c: 'display' },
    { n: 'Syncopate', c: 'display' },
    { n: 'Michroma', c: 'display' },
    { n: 'Staatliches', c: 'display' },
    { n: 'Big Shoulders Display', c: 'display', v: 1 },
    { n: 'Sixtyfour', c: 'display', v: 1 },
    { n: 'Rammetto One', c: 'display' },
    { n: 'Passion One', c: 'display' },
    { n: 'Bowlby One', c: 'display' },
    { n: 'Climate Crisis', c: 'display', v: 1 },
    { n: 'Calistoga', c: 'display' },
    { n: 'Poiret One', c: 'display' },
    { n: 'Unica One', c: 'display' },
    { n: 'Bungee Shade', c: 'display' },
    { n: 'Bungee Inline', c: 'display' },
    { n: 'Krona One', c: 'display' },

    /* ── Manuscrite ──────────────────────────────────────────────────────────── */
    { n: 'Caveat', c: 'manuscrite', v: 1 },
    { n: 'Dancing Script', c: 'manuscrite', v: 1 },
    { n: 'Pacifico', c: 'manuscrite' },
    { n: 'Satisfy', c: 'manuscrite' },
    { n: 'Great Vibes', c: 'manuscrite' },
    { n: 'Courgette', c: 'manuscrite' },
    { n: 'Kaushan Script', c: 'manuscrite' },
    { n: 'Shadows Into Light', c: 'manuscrite' },
    { n: 'Indie Flower', c: 'manuscrite' },
    { n: 'Patrick Hand', c: 'manuscrite' },
    { n: 'Caveat Brush', c: 'manuscrite' },
    { n: 'Amatic SC', c: 'manuscrite' },
    { n: 'Permanent Marker', c: 'manuscrite' },
    { n: 'Gochi Hand', c: 'manuscrite' },
    { n: 'Sacramento', c: 'manuscrite' },
    { n: 'Allura', c: 'manuscrite' },
    { n: 'Parisienne', c: 'manuscrite' },
    { n: 'Tangerine', c: 'manuscrite' },
    { n: 'Alex Brush', c: 'manuscrite' },
    { n: 'Homemade Apple', c: 'manuscrite' },
    { n: 'Reenie Beanie', c: 'manuscrite' },
    { n: 'Gloria Hallelujah', c: 'manuscrite' },
    { n: 'Handlee', c: 'manuscrite' },
    { n: 'Rock Salt', c: 'manuscrite' },
    { n: 'Nothing You Could Do', c: 'manuscrite' },
    { n: 'La Belle Aurore', c: 'manuscrite' }
  ];

  var CATEGORIES = [
    { id: '', fr: 'Toutes', en: 'All', ja: 'すべて' },
    { id: 'sans', fr: 'Sans empattement', en: 'Sans-serif', ja: 'サンセリフ' },
    { id: 'serif', fr: 'Avec empattement', en: 'Serif', ja: 'セリフ' },
    { id: 'mono', fr: 'Chasse fixe', en: 'Monospace', ja: '等幅' },
    { id: 'display', fr: 'Titrage', en: 'Display', ja: 'ディスプレイ' },
    { id: 'manuscrite', fr: 'Manuscrite', en: 'Handwriting', ja: '手書き' }
  ];

  /* Le nombre de familles ajoutées par clic sur « Charger plus ». */
  var PAS = 40;

  /* ── Outils ─────────────────────────────────────────────────────────────────── */
  function t(v) { return api ? api.t(v) : (v && typeof v === 'object' ? (v.fr || '') : v); }

  function journal() {
    try { var a = JSON.parse(localStorage.getItem(CLE) || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; }
  }
  function memoriser(nom) {
    try {
      var a = journal();
      if (a.indexOf(nom) < 0) { a.push(nom); localStorage.setItem(CLE, JSON.stringify(a)); }
    } catch (_) {}
  }

  function famille(nom) {
    for (var i = 0; i < FAMILLES.length; i++) if (FAMILLES[i].n === nom) return FAMILLES[i];
    return null;
  }

  /* L'adresse SANS AXE : elle répond 200 pour toutes les familles (mesuré). C'est
     notre filet de sécurité, et c'est aussi ce qu'on utilise pour l'aperçu des
     familles statiques. */
  function urlSimple(f) {
    return 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(f.n).replace(/%20/g, '+') + '&display=swap';
  }
  /* L'adresse AVEC PLAGE : ne répond que pour une police variable. */
  function urlPlage(f) {
    return 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(f.n).replace(/%20/g, '+') +
           ':wght@100..900&display=swap';
  }

  /* Pose (une seule fois) la feuille Google d'une famille, et rend une promesse
     tenue quand la police est réellement utilisable.
     ⚠️ POUR L'APERÇU, TOUJOURS L'ADRESSE SIMPLE — ET C'EST UNE MESURE.
     Un premier montage tentait la PLAGE d'abord pour les familles variables. Or les
     plages diffèrent d'une famille à l'autre (Sora s'arrête à 800, Inter va à 900) :
     une plage trop large est refusée SANS en-tête CORS, donc le navigateur écrit une
     erreur dans la console et l'aperçu doit retenter. Sur 150 lignes à l'écran, cela
     faisait des dizaines d'erreurs rouges pour un résultat visuel identique — un
     aperçu montre de toute façon la graisse 400. L'aperçu demande donc l'adresse
     simple, qui répond 200 pour toutes les familles. La plage n'est demandée qu'à
     l'INSTALLATION, où elle sert vraiment : c'est elle qui donne les vraies graisses. */
  function chargerFeuille(f) {
    var id = 'spgf-' + f.n.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    if (dejaChargees[id]) return dejaChargees[id];
    dejaChargees[id] = new Promise(function (resolve, reject) {
      var lien = document.getElementById(id);
      if (lien) { attendre(f).then(resolve, reject); return; }
      var l = document.createElement('link');
      l.id = id;
      l.rel = 'stylesheet';
      l.href = urlSimple(f);
      l.onload = function () { attendre(f).then(resolve, reject); };
      l.onerror = function () {
        if (l.parentNode) l.parentNode.removeChild(l);
        delete dejaChargees[id];
        reject(new Error(t(L('Google Fonts est injoignable.', 'Google Fonts is unreachable.', 'Google フォントに接続できません。'))));
      };
      document.head.appendChild(l);
    });
    return dejaChargees[id];
  }

  function attendre(f) {
    var poids = (f.poids && f.poids.length) ? f.poids[f.poids.length > 1 ? 1 : 0] : '400';
    if (!document.fonts || typeof document.fonts.load !== 'function') return Promise.resolve();
    return document.fonts.load(poids + ' 32px "' + f.n + '"').then(function () { return true; },
      function () { return true; });
  }

  /* ⚠️ LES GRAISSES SE LISENT DANS LA RÉPONSE, ELLES NE SE DEVINENT PAS.
     Le CSS renvoyé par Google dit `font-weight: 100 900` pour une police variable et
     `font-weight: 400` pour une statique. On en déduit la liste réelle : une plage se
     lit en pas de 100, une valeur seule donne une seule graisse.
     MESURÉ sur les deux formes : « Lato » → ['400'], « Inter » → 100 à 900. */
  function poidsDuCss(css) {
    var m = /font-weight:\s*([0-9][0-9. ]*)/g, vus = {}, out = [], r;
    while ((r = m.exec(css))) {
      var bouts = String(r[1]).trim().split(/\s+/);
      if (bouts.length >= 2) {
        var a = parseInt(bouts[0], 10), b = parseInt(bouts[1], 10);
        if (isFinite(a) && isFinite(b) && b > a) {
          for (var w = Math.ceil(a / 100) * 100; w <= b; w += 100) vus[w] = 1;
          continue;
        }
      }
      var seul = parseInt(bouts[0], 10);
      if (isFinite(seul) && seul >= 100 && seul <= 900) vus[seul] = 1;
    }
    Object.keys(vus).map(Number).sort(function (x, y) { return x - y; })
      .forEach(function (w) { out.push(String(w)); });
    return out;
  }

  /* ── Le fichier de police lui-même ────────────────────────────────────────────
     On relit la feuille Google pour y trouver l'adresse du fichier, puis on
     télécharge ce fichier. C'est ce qu'il faut pour que la police soit EMBARQUÉE
     dans un .sp et pas seulement affichée par le navigateur.
     ⚠️ C'EST ICI, ET SEULEMENT ICI, QU'ON DEMANDE LA PLAGE DE GRAISSES.
     Elle ne répond que pour une police variable ; une police statique la refuse, et
     le repli prend l'adresse simple. Une requête refusée par installation, sans
     conséquence : le navigateur la signale dans sa console, le repli l'absorbe.
     ⚠️ ET ON RETIENT CELLES QUI LA REFUSENT (mesure, pas supposition).
     La plage `wght@100..900` n'est valable que si la famille monte réellement à 900 :
     pour Sora (100..800) Google rend une erreur SANS en-tête CORS, donc l'échec est
     bruyant. Comme le journal réinstalle les familles mémorisées à chaque démarrage,
     ces deux erreurs revenaient à CHAQUE lancement pour Sora et Caveat. Chaque famille
     n'a désormais le droit qu'à UN essai : son nom rejoint une liste de refus, et les
     démarrages suivants demandent directement l'adresse simple. */
  function plageRefusee(nom) {
    try { return (JSON.parse(localStorage.getItem(CLE_PLAGE) || '[]') || []).indexOf(nom) >= 0; }
    catch (_) { return false; }
  }
  function noterPlageRefusee(nom) {
    try {
      var a = JSON.parse(localStorage.getItem(CLE_PLAGE) || '[]');
      if (!Array.isArray(a)) a = [];
      if (a.indexOf(nom) < 0) { a.push(nom); localStorage.setItem(CLE_PLAGE, JSON.stringify(a)); }
    } catch (_) {}
  }

  function cssDeLaFamille(f) {
    var lire = function (url) {
      return fetch(url, { mode: 'cors', credentials: 'omit' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      });
    };
    if (!f.v || plageRefusee(f.n)) return lire(urlSimple(f));
    return lire(urlPlage(f)).catch(function () {
      noterPlageRefusee(f.n);
      return lire(urlSimple(f));
    });
  }

  function fichierDeLaFamille(f) {
    return cssDeLaFamille(f).then(function (css) {
      /* ⚠️ ON PREND LA PREMIÈRE DÉCLARATION QUI PORTE UNE ADRESSE.
         Une famille variable n'en a qu'une, avec sa plage de graisses. Une famille
         statique en a une par graisse : la première est la 400, et c'est elle qu'on
         embarque (les autres restent fournies par la feuille Google pour l'affichage). */
      var m = /src:\s*url\((https:\/\/[^)]+)\)/.exec(css);
      if (!m) throw new Error(t(L('réponse inattendue de Google Fonts', 'unexpected answer from Google Fonts', 'Google フォントから予期しない応答')));
      return { url: m[1].replace(/^["']|["']$/g, ''), poids: poidsDuCss(css) };
    }).then(function (info) {
      return fetch(info.url, { mode: 'cors', credentials: 'omit' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer().then(function (buf) { return { buf: buf, poids: info.poids }; });
      });
    }).then(function (res) {
      if (!res.buf || !res.buf.byteLength) throw new Error(t(L('fichier de police vide', 'empty font file', 'フォントファイルが空です')));
      /* Conversion en data URL : `_spRegisterCustomFontDataUrl` attend une chaîne, et
         c'est aussi la forme sous laquelle la police est rangée dans un .sp. */
      var octets = new Uint8Array(res.buf), morceaux = [], taille = 0x8000, i;
      for (i = 0; i < octets.length; i += taille) {
        morceaux.push(String.fromCharCode.apply(null, octets.subarray(i, i + taille)));
      }
      return { dataUrl: 'data:font/woff2;base64,' + btoa(morceaux.join('')), poids: res.poids };
    });
  }

  /* ── L'INSTALLATION ─────────────────────────────────────────────────────────── */
  function installer(f, silencieux) {
    if (!f) return Promise.reject(new Error('?'));
    return fichierDeLaFamille(f)
      .then(function (r) {
        if (typeof window._spRegisterCustomFontDataUrl !== 'function') {
          throw new Error(t(L('cette version de SuperPrint ne sait pas accueillir de police externe.',
            'this build of SuperPrint cannot take an external font.',
            'このバージョンの SuperPrint は外部フォントを登録できません。')));
        }
        f.poids = (r.poids && r.poids.length) ? r.poids : ['400'];
        return Promise.resolve(window._spRegisterCustomFontDataUrl(f.n, r.dataUrl));
      })
      .then(function () {
        /* La plage RÉELLE, annoncée au sélecteur de graisse (cf. `_spSetFontWeights`). */
        try { if (typeof window._spSetFontWeights === 'function') window._spSetFontWeights(f.n, f.poids); } catch (_) {}
        memoriser(f.n);
        if (!silencieux) {
          try {
            if (typeof window.spToast === 'function') {
              window.spToast('« ' + f.n + ' » ' + t(L('est prête : elle est dans le sélecteur de police.',
                'is ready: it is in the font picker.', 'を準備しました。フォント選択に表示されます。')), 'success');
            }
          } catch (_) {}
        }
        return true;
      });
  }

  function estInstallee(nom) {
    try {
      var sel = document.getElementById('fontFamily');
      if (!sel) return false;
      return Array.prototype.some.call(sel.options, function (o) { return o.value === nom; });
    } catch (_) { return false; }
  }

  /* ── LE PANNEAU ─────────────────────────────────────────────────────────────── */
  var ID = 'spFontsOverlay';
  var CLE_TEXTE = 'sp_google_fonts_texte_v1';
  var CLE_MODE = 'sp_google_fonts_mode_v1';
  var CLE_LIMITE = 'sp_google_fonts_limite_v1';
  /* Le texte d'aperçu par défaut : une phrase qui montre les lettres et les accents
     d'un seul coup d'œil, et qui tient sur une ligne dans la colonne. */
  var ECHANTILLON_DEFAUT = 'Portez ce vieux whisky au juge blond qui fume';
  var etat = { filtre: '', recherche: '', observer: null,
               mode: 'liste', texte: ECHANTILLON_DEFAUT, limite: PAS };

  function lirePreference(cle, defaut) {
    try { var v = localStorage.getItem(cle); return v === null ? defaut : v; } catch (_) { return defaut; }
  }
  function ecrirePreference(cle, valeur) {
    try { localStorage.setItem(cle, valeur); } catch (_) {}
  }

  function fermer() {
    var ov = document.getElementById(ID);
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    if (etat.observer) { try { etat.observer.disconnect(); } catch (_) {} etat.observer = null; }
    document.removeEventListener('keydown', surEchap, true);
  }
  function surEchap(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermer(); } }

  function el(tag, style, texte) {
    var e = document.createElement(tag);
    if (style) e.setAttribute('style', style);
    if (texte !== undefined) e.textContent = texte;
    return e;
  }

  /* ── LE BOUTON D'INSTALLATION, PARTAGÉ PAR LES DEUX AFFICHAGES ──────────────── */
  function boutonInstaller(f) {
    var b = el('button', 'border:1px solid #1a1a1a;background:#1a1a1a;color:#fff;font-size:10px;letter-spacing:.3px;padding:5px 11px;border-radius:0;cursor:pointer;white-space:nowrap;');
    b.type = 'button';
    b.className = 'spgf-btn';
    var poser = function (txt, desactive, fond) {
      b.textContent = txt;
      b.disabled = !!desactive;
      b.style.cursor = desactive ? 'default' : 'pointer';
      b.style.background = fond || '#1a1a1a';
      b.style.borderColor = fond || '#1a1a1a';
    };
    if (estInstallee(f.n)) poser(t(L('Installée', 'Installed', 'インストール済み')), true, '#8a8a8a');
    else poser(t(L('Installer', 'Install', 'インストール')), false);
    b.addEventListener('click', function () {
      if (b.disabled) return;
      poser(t(L('Installation…', 'Installing…', 'インストール中…')), true, '#8a8a8a');
      installer(f, false).then(function () {
        poser(t(L('Installée', 'Installed', 'インストール済み')), true, '#8a8a8a');
      }, function (e) {
        poser(t(L('Réessayer', 'Retry', '再試行')), false);
        var msg = (e && e.message) ? e.message : String(e);
        try { if (typeof window.spAlert === 'function') window.spAlert(msg, { title: f.n }); else alert(msg); } catch (_) {}
      });
    });
    return b;
  }

  /* ── APERÇU : UNE LIGNE PAR FAMILLE, EN GROS ─────────────────────────────────
     C'est l'affichage PAR DÉFAUT. Il montre la phrase d'aperçu — la sienne si on en a
     écrit une — dans le corps de chaque famille, sur UNE ligne, coupée proprement si
     elle dépasse. Le nom reste petit à gauche : il sert à savoir ce qu'on installe. */
  function ligne(f) {
    var c = el('div', 'display:flex;align-items:center;gap:14px;border-bottom:1px solid #ececec;padding:9px 2px;min-width:0;');
    c.setAttribute('data-famille', f.n);

    var gauch = el('div', 'flex:0 0 152px;min-width:0;overflow:hidden;');
    var nom = el('div', 'font-size:11px;font-weight:600;color:#1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', f.n);
    gauch.appendChild(nom);
    var meta = el('div', 'font-size:9px;color:#aaa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
                  categorieTexte(f.c));
    gauch.appendChild(meta);
    c.appendChild(gauch);

    var apercu = el('div', 'flex:1 1 auto;min-width:0;font-size:30px;line-height:1.18;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;');
    apercu.className = 'spgf-apercu';
    apercu.textContent = etat.texte || ECHANTILLON_DEFAUT;
    apercu.style.fontFamily = "'" + f.n + "', sans-serif";
    c.appendChild(apercu);

    var droite = el('div', 'flex:0 0 auto;');
    droite.appendChild(boutonInstaller(f));
    c.appendChild(droite);

    if (etat.observer) ettiqueter(f, c, { nom: nom, ech: apercu });
    return c;
  }

  function carte(f) {
    var c = el('div', 'border:1px solid #e2e2e2;border-radius:0;padding:11px 12px 10px;background:#fff;display:flex;flex-direction:column;gap:7px;min-height:112px;');
    c.setAttribute('data-famille', f.n);

    var haut = el('div', 'display:flex;align-items:baseline;gap:8px;');
    /* ⚠️ LA CARTE EST ÉCRITE DANS SA PROPRE POLICE, dès qu'elle est chargée. Le nom
       seul ne dit rien : « Fraunces » ou « Sora » ne s'imaginent pas. */
    var nom = el('div', 'font-size:19px;line-height:1.15;color:#1a1a1a;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', f.n);
    nom.className = 'spgf-nom';
    nom.style.fontFamily = "'" + f.n + "', sans-serif";
    haut.appendChild(nom);
    var badge = el('span', 'flex:0 0 auto;font-size:9px;letter-spacing:.4px;text-transform:uppercase;color:#999;border:1px solid #e6e6e6;padding:1px 5px;', categorieTexte(f.c));
    haut.appendChild(badge);
    c.appendChild(haut);

    var ech = el('div', 'font-size:12px;line-height:1.35;color:#666;min-height:33px;overflow:hidden;', etat.texte || ECHANTILLON_DEFAUT);
    ech.className = 'spgf-ech';
    ech.style.fontFamily = "'" + f.n + "', serif";
    c.appendChild(ech);

    var pied = el('div', 'display:flex;align-items:center;gap:8px;margin-top:auto;');
    var poids = el('span', 'font-size:9px;color:#aaa;flex:1;', f.v ? t(L('variable', 'variable', 'バリアブル')) : '');
    pied.appendChild(poids);
    pied.appendChild(boutonInstaller(f));
    c.appendChild(pied);

    if (etat.observer) ettiqueter(f, c, { nom: nom, ech: ech });
    return c;
  }

  function ettiqueter(f, c, refs) {
    try {
      etat.observer.observe(c);
      c._spgf = function () {
        chargerFeuille(f).then(function () {
          refs.nom.style.fontFamily = "'" + f.n + "', sans-serif";
          refs.ech.style.fontFamily = "'" + f.n + "', serif";
        }, function () {
          /* Injoignable : la ligne garde sa police de repli et le dit une fois. */
          if (!c._spgfMuette) {
            c._spgfMuette = true;
            refs.ech.textContent = (etat.texte || ECHANTILLON_DEFAUT) + ' — ' +
              t(L('aperçu indisponible hors ligne', 'preview unavailable offline', 'オフラインではプレビューできません'));
          }
        });
      };
    } catch (_) {}
  }

  function categorieTexte(id) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) return t({ fr: CATEGORIES[i].fr, en: CATEGORIES[i].en, ja: CATEGORIES[i].ja });
    return id;
  }

  function listeFiltree() {
    var q = etat.recherche.trim().toLowerCase();
    return FAMILLES.filter(function (f) {
      if (etat.filtre && f.c !== etat.filtre) return false;
      if (!q) return true;
      return f.n.toLowerCase().indexOf(q) >= 0;
    });
  }

  var vue = { grille: null, compteur: null, plus: null };

  function dessiner() {
    var grille = vue.grille, compteur = vue.compteur, plus = vue.plus;
    if (!grille) return;
    grille.innerHTML = '';
    var l = listeFiltree();
    /* ⚠️ UNE RECHERCHE MONTRE TOUS LES RÉSULTATS, PAS SEULEMENT LA PAGE EN COURS.
       Chercher « mono » et ne rien voir parce que les familles correspondantes sont
       au-delà de la quarantième ligne serait incompréhensible. Le découpage ne
       s'applique donc qu'à la liste complète. */
    var cherche = !!etat.recherche.trim();
    var montrer = cherche ? l : l.slice(0, etat.limite);
    if (compteur) {
      compteur.textContent = montrer.length + ' / ' + l.length + ' ' + t(L('familles', 'families', 'ファミリー'));
    }
    if (!l.length) {
      grille.appendChild(el('div', 'padding:26px 4px;color:#999;font-size:12px;text-align:center;',
        t(L('Aucune famille ne correspond à cette recherche.', 'No family matches this search.', 'この検索に一致するファミリーはありません。'))));
      if (plus) plus.style.display = 'none';
      return;
    }
    if (etat.mode === 'liste') {
      grille.style.display = 'block';
      montrer.forEach(function (f) { grille.appendChild(ligne(f)); });
    } else {
      grille.style.display = 'grid';
      montrer.forEach(function (f) { grille.appendChild(carte(f)); });
    }
    /* Le bouton « Charger plus » n'apparaît que s'il reste des familles à montrer. */
    if (plus) {
      var reste = cherche ? 0 : (l.length - montrer.length);
      plus.style.display = reste > 0 ? 'block' : 'none';
      if (reste > 0) {
        plus.textContent = t(L('Charger plus de polices', 'Load more fonts', 'さらにフォントを読み込む')) +
          '  (' + reste + ')';
      }
    }
  }

  function ouvrir() {
    if (document.getElementById(ID)) return;
    /* Les préférences d'affichage sont relues À CHAQUE OUVERTURE : le mode, la phrase
       d'aperçu et le nombre de familles chargées survivent à la fermeture. */
    etat.mode = (lirePreference(CLE_MODE, 'liste') === 'grille') ? 'grille' : 'liste';
    var texteMemorise = lirePreference(CLE_TEXTE, ECHANTILLON_DEFAUT);
    etat.texte = texteMemorise || ECHANTILLON_DEFAUT;
    var lim = parseInt(lirePreference(CLE_LIMITE, String(PAS)), 10);
    etat.limite = (isFinite(lim) && lim >= PAS) ? lim : PAS;

    var ov = el('div', '');
    ov.id = ID;
    ov.setAttribute('style', 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100020;display:flex;align-items:center;justify-content:center;padding:24px;');
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) fermer(); });

    var carteCadre = el('div', '');
    carteCadre.className = 'sp-modal-card';
    carteCadre.setAttribute('style', 'position:relative;width:1020px;max-width:96vw;height:86vh;max-height:88vh;display:flex;flex-direction:column;background:#fff;border-radius:0;overflow:hidden;min-height:0;');

    /* En-tête : même facture que les 22 fenêtres (titre 13 px, croix 28×28). */
    var entete = el('div', 'display:flex;align-items:center;gap:8px;padding:16px;border-bottom:1px solid #e6e6e6;flex:0 0 auto;');
    entete.className = 'modal-header';
    var titre = el('div', '', t(L('Polices Google', 'Google Fonts', 'Google フォント')) + '  ·  ' + FAMILLES.length);
    titre.className = 'modal-title';
    titre.style.flex = '1';
    entete.appendChild(titre);
    var croix = el('button', '', '✕');
    croix.type = 'button';
    croix.className = 'modal-close sp-modal-close';
    croix.setAttribute('aria-label', 'Fermer');
    croix.addEventListener('click', fermer);
    entete.appendChild(croix);
    carteCadre.appendChild(entete);

    var corps = el('div', 'padding:14px 16px 18px;overflow-y:auto;flex:1 1 auto;');
    corps.style.minHeight = '0';
    carteCadre.appendChild(corps);

    /* Ligne de conduite : une phrase, pas un paragraphe. */
    var intro = el('div', 'font-size:11px;color:#777;line-height:1.45;margin-bottom:10px;',
      t(L('Choisissez une famille, installez-la : elle rejoint les polices de SuperPrint et y reste.',
          'Pick a family, install it: it joins SuperPrint\'s fonts and stays there.',
          'ファミリーを選んでインストールすると、SuperPrint のフォントとして残ります。')));
    corps.appendChild(intro);

    /* ══ LE TEXTE D'APERÇU ══════════════════════════════════════════════════════ */
    var ligneTexte = el('div', 'display:flex;align-items:center;gap:8px;margin-bottom:10px;');
    var etiquette = el('label', 'flex:0 0 auto;font-size:10px;letter-spacing:.3px;text-transform:uppercase;color:#888;',
      t(L('Votre texte', 'Your text', 'テキスト')));
    var champTexte = el('input', 'flex:1 1 auto;min-width:0;border:1px solid #d9d9d9;border-radius:0;padding:6px 9px;font-size:12px;');
    champTexte.type = 'text';
    champTexte.id = 'spgfTexte';
    champTexte.value = etat.texte || ECHANTILLON_DEFAUT;
    champTexte.placeholder = ECHANTILLON_DEFAUT;
    var reinit = el('button', 'flex:0 0 auto;border:1px solid #d9d9d9;background:#fff;color:#666;font-size:10px;padding:5px 9px;border-radius:0;cursor:pointer;',
      t(L('Exemple', 'Sample', '例')));
    reinit.type = 'button';
    reinit.title = t(L('Revenir à la phrase d\'exemple', 'Back to the sample sentence', '例文に戻す'));
    ligneTexte.appendChild(etiquette);
    ligneTexte.appendChild(champTexte);
    ligneTexte.appendChild(reinit);
    corps.appendChild(ligneTexte);

    /* Recherche + filtres + AFFICHAGE */
    var barre = el('div', 'display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap;');
    var rech = el('input', 'flex:1 1 200px;min-width:140px;border:1px solid #d9d9d9;border-radius:0;padding:6px 9px;font-size:12px;');
    rech.type = 'search';
    rech.placeholder = t(L('Rechercher parmi les ' + FAMILLES.length + ' familles…', 'Search the ' + FAMILLES.length + ' families…', FAMILLES.length + ' ファミリーから検索…'));
    barre.appendChild(rech);

    var onglets = el('div', 'display:flex;gap:4px;flex-wrap:wrap;');
    var boutonsCat = [];
    CATEGORIES.forEach(function (cat) {
      var bb = el('button', 'font-size:10px;padding:5px 10px;border-radius:0;border:1px solid #d9d9d9;background:#fff;color:#333;cursor:pointer;');
      bb.type = 'button';
      bb.textContent = t({ fr: cat.fr, en: cat.en, ja: cat.ja });
      bb.addEventListener('click', function () {
        etat.filtre = cat.id;
        boutonsCat.forEach(function (x) {
          var actif = x._cat === cat.id;
          x.style.background = actif ? '#1a1a1a' : '#fff';
          x.style.color = actif ? '#fff' : '#333';
          x.style.borderColor = actif ? '#1a1a1a' : '#d9d9d9';
        });
        dessiner();
      });
      bb._cat = cat.id;
      var actif0 = (cat.id === '');
      bb.style.background = actif0 ? '#1a1a1a' : '#fff';
      bb.style.color = actif0 ? '#fff' : '#333';
      bb.style.borderColor = actif0 ? '#1a1a1a' : '#d9d9d9';
      boutonsCat.push(bb);
      onglets.appendChild(bb);
    });
    barre.appendChild(onglets);

    /* ══ LE FILTRE D'AFFICHAGE (« en ligne » / grille) ══════════════════════════
       Deux boutons, séparés du reste par un filet : c'est un choix de LECTURE, pas
       un filtre de contenu, et les confondre ferait croire qu'on restreint la liste. */
    var filetMode = el('div', '', null);
    filetMode.style.cssText = 'width:1px;height:18px;background:#e0e0e0;flex:0 0 auto;';
    barre.appendChild(filetMode);
    var modes = el('div', 'display:flex;gap:4px;flex:0 0 auto;');
    var bListe = el('button', 'font-size:10px;padding:5px 10px;border-radius:0;border:1px solid #d9d9d9;background:#fff;color:#333;cursor:pointer;',
      t(L('En ligne', 'One line', '1 行')));
    var bGrille = el('button', 'font-size:10px;padding:5px 10px;border-radius:0;border:1px solid #d9d9d9;background:#fff;color:#333;cursor:pointer;',
      t(L('Grille', 'Grid', 'グリッド')));
    bListe.type = 'button'; bGrille.type = 'button';
    bListe.title = t(L('Une famille par ligne, en gros — l\'aperçu par défaut', 'One family per line, large — the default preview', '1 行に 1 ファミリー、大きく表示（既定）'));
    bGrille.title = t(L('Cartes compactes, plusieurs par ligne', 'Compact cards, several per row', 'コンパクトなカードを並べて表示'));
    modes.appendChild(bListe); modes.appendChild(bGrille);
    barre.appendChild(modes);

    var compteur = el('div', 'font-size:10px;color:#aaa;flex:0 0 auto;');
    barre.appendChild(compteur);
    corps.appendChild(barre);

    var grille = el('div', '');
    corps.appendChild(grille);

    /* ══ « CHARGER PLUS DE POLICES » ════════════════════════════════════════════
       Demande utilisateur : « je dois pouvoir avoir plus de polices (plus de choix,
       load more ou je ne sais pas) ». Le catalogue en contient plus de 200 ; on en
       présente 40 à la fois, et ce bouton en ajoute 40. Le compte des familles
       chargées est mémorisé : rouvrir le panneau ne ramène pas la liste à 40. */
    var plus = el('button', 'display:block;width:100%;margin:14px 0 2px;border:1px solid #d9d9d9;background:#fafafa;color:#333;font-size:11px;padding:10px;border-radius:0;cursor:pointer;', '');
    plus.type = 'button';
    plus.addEventListener('click', function () {
      etat.limite += PAS;
      ecrirePreference(CLE_LIMITE, String(etat.limite));
      dessiner();
    });
    corps.appendChild(plus);

    vue = { grille: grille, compteur: compteur, plus: plus };

    function poserMode(m) {
      etat.mode = m;
      ecrirePreference(CLE_MODE, m);
      [[bListe, 'liste'], [bGrille, 'grille']].forEach(function (p) {
        var actif = p[1] === m;
        p[0].style.background = actif ? '#1a1a1a' : '#fff';
        p[0].style.color = actif ? '#fff' : '#333';
        p[0].style.borderColor = actif ? '#1a1a1a' : '#d9d9d9';
      });
      grille.style.gridTemplateColumns = (m === 'grille') ? 'repeat(auto-fill,minmax(232px,1fr))' : '';
      grille.style.gap = (m === 'grille') ? '10px' : '';
      dessiner();
    }
    bListe.addEventListener('click', function () { poserMode('liste'); });
    bGrille.addEventListener('click', function () { poserMode('grille'); });

    /* Le texte d'aperçu se réécrit SANS reconstruire la liste : on change le contenu
       des nœuds visibles, ce qui évite de relancer les polices. */
    function appliquerTexte(v) {
      etat.texte = v;
      ecrirePreference(CLE_TEXTE, v);
      var tete = v || ECHANTILLON_DEFAUT;
      Array.prototype.forEach.call(grille.querySelectorAll('.spgf-apercu, .spgf-ech'), function (n) {
        n.textContent = tete;
      });
    }
    champTexte.addEventListener('input', function () { appliquerTexte(champTexte.value); });
    reinit.addEventListener('click', function () {
      champTexte.value = ECHANTILLON_DEFAUT;
      appliquerTexte(ECHANTILLON_DEFAUT);
      try { champTexte.focus(); champTexte.select(); } catch (_) {}
    });

    /* Pied d'information : la licence, en une phrase. */
    var piedInfo = el('div', 'margin-top:14px;padding-top:11px;border-top:1px solid #eee;font-size:10px;color:#999;line-height:1.5;',
      t(L('Les polices viennent de Google Fonts et sont libres d\'usage, y compris commercial. Une police installée est enregistrée avec le document qui l\'utilise : il s\'ouvre à l\'identique sur une autre machine.',
          'The fonts come from Google Fonts and are free to use, including commercially. An installed font is saved with the document that uses it: it opens the same way on another machine.',
          'フォントは Google Fonts 提供で、商用利用も自由です。インストールしたフォントは使用した文書と一緒に保存されるため、他のマシンでも同じ表示になります。')));
    corps.appendChild(piedInfo);

    document.body.appendChild(ov);
    ov.appendChild(carteCadre);

    /* IntersectionObserver : la ligne demande sa police en devenant visible. */
    try {
      etat.observer = new IntersectionObserver(function (entrees) {
        entrees.forEach(function (e) {
          if (!e.isIntersecting) return;
          var c = e.target;
          if (typeof c._spgf === 'function') { c._spgf(); etat.observer.unobserve(c); }
        });
      }, { root: corps, rootMargin: '160px' });
    } catch (_) { etat.observer = null; }

    poserMode(etat.mode);
    /* Sans IntersectionObserver (navigateur ancien), on charge tout : mieux vaut
       des mégaoctets que des lignes muettes. */
    if (!etat.observer) FAMILLES.forEach(function (f) { chargerFeuille(f).catch(function () {}); });

    rech.addEventListener('input', function () { etat.recherche = rech.value || ''; dessiner(); });
    document.addEventListener('keydown', surEchap, true);
    try { rech.focus(); } catch (_) {}
  }

  /* ── RETROUVER LES POLICES INSTALLÉES AU LANCEMENT ────────────────────────────
     Sans ceci, une police installée hier aurait disparu aujourd'hui : le `<link>`
     Google vit dans la page, pas dans le produit. On réinstalle donc en silence les
     familles mémorisées (une requête chacune, et le navigateur les a en cache).

     ⚠️ ON ATTEND QUE L'APPLICATION SOIT PRÊTE, ET C'EST UNE MESURE.
     Un premier montage restaurait à +1,2 s après `DOMContentLoaded`. MESURÉ : le
     `<link>` Google était bien posé, la police était bien disponible à l'écran… et
     le `<select>` restait sans elle. La raison : `_spRegisterCustomFontDataUrl` —
     le point d'entrée qui range la police dans le produit — est défini au milieu de
     `main.js`, un fichier de 6 Mo dont l'exécution dépasse ce délai. On sonde donc
     son apparition (400 ms, jusqu'à 40 s) avant de restaurer.

     ⚠️ ON N'INSTALLE QUE CELLES DE NOTRE CATALOGUE. Une famille mémorisée puis
     retirée du catalogue laisse simplement son nom dans la liste : on l'ignore au
     lieu de lancer une requête pour une fiche devenue inconnue. */
  function pret(n) {
    n = n || 0;
    if (typeof window._spRegisterCustomFontDataUrl === 'function') return true;
    if (n >= 100) return false;
    setTimeout(function () { if (pret(n + 1)) restaurer(); }, 400);
    return false;
  }

  function restaurer() {
    var noms = journal();
    if (!pret()) return;
    /* ══ 🆕 v1.7.674 — UNE POLICE GOOGLE ARRIVÉE PAR UN DOCUMENT EST RETENUE ══════
       Question de l'utilisateur : « comment on va avec le .sp et le .json pour les
       typo Google, il va les retrouver, les recharger ? ».

       MESURÉ : oui. Le .sp embarque la police dans `resources.customFonts` (20 Ko
       pour Sora, et SEULEMENT si un bloc l'utilise) et le .json dans `customFonts` à
       la racine ; à l'ouverture, l'application l'enregistre elle-même — vérifié en
       effaçant Sora du sélecteur et du registre : le réenregistrement la ramène et
       `document.fonts.check` repasse à vrai.
       ⚠️ MAIS ELLE NE SURVIVAIT PAS AU LANCEMENT SUIVANT, et c'est ce que ce bloc
       corrige : le journal du plug-in ne connaissait que les polices installées
       DEPUIS LE PANNEAU. Un document reçu d'un collègue s'ouvrait donc correctement
       une fois… puis le lendemain, sans ce document, la famille avait disparu.
       On écoute le point d'entrée que l'application utilise pour TOUTES ses
       restaurations (ouverture de .sp, de .json, autosave) : si la famille est dans
       notre catalogue, elle rejoint le journal et sera réinstallée au prochain
       démarrage comme si on l'avait choisie soi-même.
       ⚠️ ON NE FAIT QUE MÉMORISER, on n'appelle rien : la police est déjà chargée
       par l'application à cet instant. Aucun risque de double chargement. */
    try {
      if (!window._spRegisterCustomFontDataUrl.__spgf) {
        var origine = window._spRegisterCustomFontDataUrl;
        var enveloppe = function (nom, data) {
          try { if (famille(nom)) memoriser(nom); } catch (_) {}
          return origine.apply(this, arguments);
        };
        enveloppe.__spgf = true;
        window._spRegisterCustomFontDataUrl = enveloppe;
      }
    } catch (_) {}
    /* ⚠️ ON ATTEND QUE L'APPLICATION AIT FINI SA PROPRE RESTAURATION.
       MESURÉ : `restaurer()` se déclenchait trop tôt. L'application relit ses polices
       personnelles depuis IndexedDB après le démarrage ; à cet instant la liste
       déroulante ne les contient pas encore, donc `estInstallee` répondait non et le
       plug-in RETÉLÉCHARGEait Sora et Caveat À CHAQUE LANCEMENT — deux requêtes CSS
       inutiles, deux erreurs CORS dans la console (la plage de Sora est refusée), et
       un démarrage alourdi pour un résultat identique.
       On laisse donc passer le temps de cette restauration (sondage court) et on
       n'installe que ce qui manque VRAIMENT à la fin. */
    var restants = noms.filter(function (nom) { return !!famille(nom); });
    var essais = 0;
    var veille = setInterval(function () {
      essais++;
      restants = restants.filter(function (nom) { return !estInstallee(nom); });
      if (!restants.length || essais >= 20) {
        clearInterval(veille);
        restants.forEach(function (nom) {
          var f = famille(nom);
          if (!f || estInstallee(nom)) return;
          installer(f, true).catch(function () {});
        });
      }
    }, 400);
  }

  SPPluginAPI({
    id: 'google-fonts',
    name: L('Polices Google', 'Google Fonts', 'Google フォント'),
    version: '1.1.0',
    author: 'SuperPrint',
    icon: 'Aa',
    description: L(FAMILLES.length + ' familles typographiques, dessinées dans leur propre police. Un clic les installe dans SuperPrint, pour de bon.',
      FAMILLES.length + ' type families, drawn in their own font. One click installs them in SuperPrint for good.',
      FAMILLES.length + ' の書体を、その書体そのもので見比べられます。ワンクリックで SuperPrint にインストール。'),
    icone: '<path d="M4 19h5.5"/><path d="M6.75 19V6.2L11 15.4 15.25 6.2V19"/><path d="M17.5 19h4"/><circle cx="19.5" cy="13.5" r="2.1"/>',
    /* Le panneau que ce plug-in possède. */
    trappe: ID,
    options: [],
    run: function (a) { api = a; return new Promise(function (resolve) { try { restaurer(); } catch (_) {} ouvrir(); resolve(true); }); }
  });

  /* Le panneau est monté par `run`. `restaurer` sonde son propre prérequis, donc
     l'instant exact du lancement n'a pas d'importance. */
  try {
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(restaurer, 600);
    else document.addEventListener('DOMContentLoaded', function () { setTimeout(restaurer, 600); });
  } catch (_) {}
})();
