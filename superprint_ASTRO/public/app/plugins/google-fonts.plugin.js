/* ═══════════════════════════════════════════════════════════════════════════════
   SUPERPRINT — PLUG-IN INTÉGRÉ « POLICES GOOGLE »  (v1.7.673)
   ═══════════════════════════════════════════════════════════════════════════════

   Demande utilisateur : « créer un plugin fonts qui affichera les plus grandes typo
   du moment de Google Fonts avec preview, installable automatiquement dans
   SuperPrint ».

   ── CE QUE FAIT CE FICHIER ────────────────────────────────────────────────────
   Un panneau qui présente une sélection de familles Google Fonts, CHACUNE DESSINÉE
   DANS SA PROPRE POLICE, avec un bouton qui l'installe pour de bon : la famille
   rejoint les sélecteurs de police de l'application (`#fontFamily`, les styles, la
   numérotation de page) et reste disponible aux lancements suivants.

   ── POURQUOI IL PASSE PAR `_spRegisterCustomFontDataUrl` ──────────────────────
   L'application sait déjà accueillir une police depuis un fichier (« Charger
   polices ») : FontFace + `document.fonts`, ajout au `<select>`, `customFonts`,
   rafraîchissement des blocs, et embarquement dans le `.sp` SEULEMENT si la police
   sert dans le document. Réécrire ce chemin aurait produit une seconde vérité, et
   une police qui s'affiche mais qu'on ne peut pas enregistrer. On réutilise donc
   l'existant, en lui donnant les octets d'un fichier Google.

   ⚠️ POURQUOI UNE SEULE FICHE PAR FAMILLE, ET PAS UNE PAR GRAISSE.
   `customFonts` range une police par NOM : deux graisses du même nom s'écraseraient.
   Google sert justement des POLICES VARIABLES — un seul fichier qui contient toute
   la plage de graisses. On demande donc la plage quand la famille est variable
   (`wght@100..900`) : un fichier, toutes les graisses, embarqué une fois.
   Pour les familles statiques, on demande 400 et 700 ; la 400 est celle qu'on
   embarque, et `_spSetFontWeights` annonce les deux au sélecteur de graisse.

   ⚠️ LE RÉSEAU EST UNE DÉPENDANCE ASSUMÉE, ET ON LE DIT.
   Rien de tout cela ne fonctionne hors ligne. Chaque échec a son message : pas de
   réseau, famille refusée par Google, ou fichier vide. Un bouton qui ne fait rien
   en silence est le pire des trois.

   ⚠️ `trappe: 'spFontsOverlay'` — CE PLUG-IN A SON PANNEAU.
   La trappe générique ne connaît que des champs (texte, nombre, couleur, image…) :
   une galerie de polices n'y entre pas. Déclarer un panneau fait que la
   bibliothèque EXÉCUTE le plug-in au lieu de construire un formulaire vide avec un
   bouton « Enregistrer » sans objet (cf. `ouvrirTrappePlugIn`).

   ⚠️ LES APERÇUS SE CHARGENT À LA DEMANDE (IntersectionObserver).
   Trente familles, c'est trente fichiers de police. Tout charger à l'ouverture
   ferait payer plusieurs mégaoctets pour des cartes que personne n'a regardées.
   Chaque carte demande SA police quand elle entre dans la zone visible — et la
   demande est mémorisée, donc un aller-retour dans la liste ne relance rien.
   ─────────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var L = window.SPPluginL || function (fr, en, ja) { return { fr: fr, en: en || fr, ja: ja || en || fr }; };
  var api = null;

  /* La liste conservée des installations, pour les retrouver au lancement suivant. */
  var CLE = 'sp_google_fonts_v1';
  /* Marque de la session : évite de réinstaller deux fois la même famille. */
  var dejaChargees = Object.create(null);

  /* ══ LA SÉLECTION ══════════════════════════════════════════════════════════════
     « Les plus grandes typo du moment » : ce sont les familles qui occupent le
     haut du classement d'usage de Google Fonts depuis des années, plus celles que
     la vague graphique actuelle a mises partout (Inter, Space Grotesk, Sora,
     Outfit…). La liste est FIGÉE dans le fichier et non interrogée en ligne : une
     galerie qui dépend d'une API de classement tombe en panne le jour où l'API
     change de forme, et personne ne comprend pourquoi la fenêtre est vide.
     `axe` : la plage de graisses demandée. `var.` = police variable, un seul
     fichier pour toute la plage. `poids` : ce qu'on annonce au sélecteur. */
  var FAMILLES = [
    /* ── Sans-serif ── */
    { n: 'Inter', c: 'sans', axe: '100..900', variable: true, poids: ['300', '400', '500', '600', '700', '800'], echant: 'Le texte courant, net à toutes les tailles' },
    { n: 'Roboto', c: 'sans', axe: '100..900', variable: true, poids: ['300', '400', '500', '700', '900'], echant: 'La sans-serif la plus utilisée du web' },
    { n: 'Open Sans', c: 'sans', axe: '300..800', variable: true, poids: ['300', '400', '600', '700', '800'], echant: 'Lisible, neutre, faite pour lire longtemps' },
    { n: 'Montserrat', c: 'sans', axe: '100..900', variable: true, poids: ['300', '400', '500', '600', '700', '800', '900'], echant: 'Titres urbains, affiches, identités' },
    { n: 'Poppins', c: 'sans', axe: '400;700', variable: false, poids: ['400', '700'], echant: 'Géométrique, ronde, très années 2020' },
    { n: 'Lato', c: 'sans', axe: '400;700', variable: false, poids: ['400', '700'], echant: 'Chaleureuse et sobre à la fois' },
    { n: 'Raleway', c: 'sans', axe: '100..900', variable: true, poids: ['300', '400', '600', '700', '800'], echant: 'Élégante, avec un W reconnaissable' },
    { n: 'Nunito', c: 'sans', axe: '200..1000', variable: true, poids: ['300', '400', '600', '700', '800'], echant: 'Arrondie, douce, jamais enfantine' },
    { n: 'Work Sans', c: 'sans', axe: '100..900', variable: true, poids: ['300', '400', '500', '600', '700'], echant: 'Une grotesque de travail, sans maniérisme' },
    { n: 'DM Sans', c: 'sans', axe: '100..1000', variable: true, poids: ['400', '500', '700'], echant: 'Compacte, contemporaine, très lisible' },
    { n: 'Manrope', c: 'sans', axe: '200..800', variable: true, poids: ['300', '400', '500', '600', '700', '800'], echant: 'Géométrique semi-condensée, nette' },
    { n: 'Sora', c: 'sans', axe: '100..800', variable: true, poids: ['300', '400', '600', '700'], echant: 'Technique, dessinée pour les écrans' },
    { n: 'Outfit', c: 'sans', axe: '100..900', variable: true, poids: ['300', '400', '500', '600', '700'], echant: 'Géométrique large, esprit start-up' },
    { n: 'Plus Jakarta Sans', c: 'sans', axe: '200..800', variable: true, poids: ['300', '400', '500', '600', '700', '800'], echant: 'Moderne, un peu humaniste' },
    { n: 'Figtree', c: 'sans', axe: '300..900', variable: true, poids: ['300', '400', '500', '600', '700', '900'], echant: 'Amicale, excellente en petit corps' },
    { n: 'Space Grotesk', c: 'sans', axe: '300..700', variable: true, poids: ['300', '400', '500', '600', '700'], echant: 'Les accents décalés de la Space Mono' },
    { n: 'Oswald', c: 'sans', axe: '200..700', variable: true, poids: ['300', '400', '500', '600', '700'], echant: 'Condensée, pour les titres qui prennent de la place' },
    { n: 'Archivo', c: 'sans', axe: '100..900', variable: true, poids: ['300', '400', '500', '600', '700', '800'], echant: 'Grotesque solide, née pour la presse' },
    /* ── Serif ── */
    { n: 'Playfair Display', c: 'serif', axe: '400..900', variable: true, poids: ['400', '500', '600', '700', '800', '900'], echant: 'Le grand contraste des journaux de mode' },
    { n: 'Merriweather', c: 'serif', axe: '400;700', variable: false, poids: ['400', '700'], echant: 'Faite pour le corps de texte à l\'écran' },
    { n: 'Libre Baskerville', c: 'serif', axe: '400;700', variable: false, poids: ['400', '700'], echant: 'Le livre classique, généreux en hauteur' },
    { n: 'Cormorant Garamond', c: 'serif', axe: '400;700', variable: false, poids: ['400', '700'], echant: 'Fine, précieuse, pour les grands corps' },
    { n: 'Fraunces', c: 'serif', axe: '100..900', variable: true, poids: ['300', '400', '600', '700', '900'], echant: 'Serif expressive, un peu « old style »' },
    { n: 'Newsreader', c: 'serif', axe: '200..800', variable: true, poids: ['300', '400', '600', '700', '800'], echant: 'Écrite pour la lecture d\'actualité' },
    { n: 'Instrument Serif', c: 'serif', axe: '400', variable: false, poids: ['400'], echant: 'Haute et étroite, une seule graisse' },
    /* ── Monospace ── */
    { n: 'JetBrains Mono', c: 'mono', axe: '100..800', variable: true, poids: ['300', '400', '500', '600', '700', '800'], echant: 'Code, tableaux, chiffres alignés' },
    { n: 'Fira Code', c: 'mono', axe: '300..700', variable: true, poids: ['300', '400', '500', '600', '700'], echant: 'La monospace des développeurs' },
    { n: 'Source Code Pro', c: 'mono', axe: '200..900', variable: true, poids: ['300', '400', '500', '600', '700'], echant: 'Neutre, lisible en petit corps' },
    { n: 'IBM Plex Mono', c: 'mono', axe: '400;700', variable: false, poids: ['400', '700'], echant: 'Le caractère technique d\'IBM' },
    /* ── Display ── */
    { n: 'Bebas Neue', c: 'display', axe: '400', variable: false, poids: ['400'], echant: 'LA capitale condensée des affiches' },
    { n: 'Anton', c: 'display', axe: '400', variable: false, poids: ['400'], echant: 'Très grasse, faite pour un seul mot' },
    { n: 'Archivo Black', c: 'display', axe: '400', variable: false, poids: ['400'], echant: 'Le block le plus épais de la famille Archivo' },
    /* ── Manuscrite ── */
    { n: 'Caveat', c: 'manuscrite', axe: '400..700', variable: true, poids: ['400', '500', '600', '700'], echant: 'Écriture au feutre, annotations' },
    { n: 'Dancing Script', c: 'manuscrite', axe: '400..700', variable: true, poids: ['400', '500', '600', '700'], echant: 'Pleine de boucles, pour les invitations' }
  ];

  var CATEGORIES = [
    { id: '', fr: 'Toutes', en: 'All', ja: 'すべて' },
    { id: 'sans', fr: 'Sans empattement', en: 'Sans-serif', ja: 'サンセリフ' },
    { id: 'serif', fr: 'Avec empattement', en: 'Serif', ja: 'セリフ' },
    { id: 'mono', fr: 'Chasse fixe', en: 'Monospace', ja: '等幅' },
    { id: 'display', fr: 'Titrage', en: 'Display', ja: 'ディスプレイ' },
    { id: 'manuscrite', fr: 'Manuscrite', en: 'Handwriting', ja: '手書き' }
  ];

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
  function oublier(nom) {
    try {
      var a = journal().filter(function (x) { return x !== nom; });
      localStorage.setItem(CLE, JSON.stringify(a));
    } catch (_) {}
  }

  function famille(nom) {
    for (var i = 0; i < FAMILLES.length; i++) if (FAMILLES[i].n === nom) return FAMILLES[i];
    return null;
  }

  /* L'adresse de la feuille Google qui décrit une famille. `display=swap` : le
     texte s'affiche tout de suite dans la police de repli et se redessine quand la
     police arrive — sans lui, un bloc resterait invisible pendant le téléchargement. */
  function urlCss(f) {
    return 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(f.n).replace(/%20/g, '+') +
           ':wght@' + f.axe + '&display=swap';
  }

  /* Pose (une seule fois) la feuille Google d'une famille, et rend une promesse
     tenue quand la police est réellement utilisable. */
  function chargerFeuille(f) {
    var id = 'spgf-' + f.n.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    if (dejaChargees[id]) return dejaChargees[id];
    dejaChargees[id] = new Promise(function (resolve, reject) {
      var lien = document.getElementById(id);
      if (lien) {
        /* Déjà dans la page : il ne reste qu'à attendre que le navigateur l'ait
           appliquée. `document.fonts.load` rend une promesse qui ne se résout que
           lorsque le dessin est disponible — c'est la seule mesure fiable. */
        attendre(f).then(resolve, reject);
        return;
      }
      lien = document.createElement('link');
      lien.id = id;
      lien.rel = 'stylesheet';
      lien.href = urlCss(f);
      lien.onload = function () { attendre(f).then(resolve, reject); };
      lien.onerror = function () { delete dejaChargees[id]; reject(new Error(t(L('Google Fonts est injoignable.', 'Google Fonts is unreachable.', 'Google フォントに接続できません。')))); };
      document.head.appendChild(lien);
    });
    return dejaChargees[id];
  }

  function attendre(f) {
    var poids = (f.poids && f.poids.length) ? f.poids[f.poids.length > 1 ? 1 : 0] : '400';
    if (!document.fonts || typeof document.fonts.load !== 'function') return Promise.resolve();
    return document.fonts.load(poids + ' 32px "' + f.n + '"').then(function () { return true; },
      function () { return true; });
  }

  /* ── Le fichier de police lui-même ────────────────────────────────────────────
     On relit la feuille Google pour y trouver l'adresse du fichier, puis on
     télécharge ce fichier. C'est ce qu'il faut pour que la police soit EMBARQUÉE
     dans un .sp et pas seulement affichée par le navigateur. */
  function fichierDeLaFamille(f) {
    return fetch(urlCss(f), { mode: 'cors', credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (css) {
        /* ⚠️ ON PREND LA PREMIÈRE DÉCLARATION QUI PORTE UNE ADRESSE.
           Une famille variable n'en a qu'une, avec `font-weight: 100 900`. Une
           famille statique en a une par graisse : la première est la 400, et c'est
           elle qu'on embarque (les autres restent fournies par la feuille Google
           pour l'affichage). */
        var m = /src:\s*url\((https:\/\/[^)]+)\)/.exec(css);
        if (!m) throw new Error(t(L('réponse inattendue de Google Fonts', 'unexpected answer from Google Fonts', 'Google フォントから予期しない応答'))); 
        return m[1].replace(/^["']|["']$/g, '');
      })
      .then(function (url) {
        return fetch(url, { mode: 'cors', credentials: 'omit' });
      })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) {
        if (!buf || !buf.byteLength) throw new Error(t(L('fichier de police vide', 'empty font file', 'フォントファイルが空です')));
        /* Conversion en data URL : `_spRegisterCustomFontDataUrl` attend une chaîne,
           et c'est aussi la forme sous laquelle la police est rangée dans un .sp. */
        var octets = new Uint8Array(buf), morceaux = [], taille = 0x8000, i;
        for (i = 0; i < octets.length; i += taille) {
          morceaux.push(String.fromCharCode.apply(null, octets.subarray(i, i + taille)));
        }
        return 'data:font/woff2;base64,' + btoa(morceaux.join(''));
      });
  }

  /* ── L'INSTALLATION ─────────────────────────────────────────────────────────── */
  function installer(f, silencieux) {
    if (!f) return Promise.reject(new Error('?'));
    return chargerFeuille(f)
      .then(function () { return fichierDeLaFamille(f); })
      .then(function (dataUrl) {
        if (typeof window._spRegisterCustomFontDataUrl !== 'function') {
          throw new Error(t(L('cette version de SuperPrint ne sait pas accueillir de police externe.',
            'this build of SuperPrint cannot take an external font.',
            'このバージョンの SuperPrint は外部フォントを登録できません。')));
        }
        return Promise.resolve(window._spRegisterCustomFontDataUrl(f.n, dataUrl));
      })
      .then(function () {
        /* La plage réelle, annoncée au sélecteur de graisse (cf. `_spSetFontWeights`). */
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
  /* Le texte d'aperçu par défaut : une phrase qui montre les lettres et les accents
     d'un seul coup d'œil, et qui tient sur une ligne dans la colonne. */
  var ECHANTILLON_DEFAUT = 'Portez ce vieux whisky au juge blond qui fume';
  var etat = { filtre: '', recherche: '', observer: null,
               mode: 'liste', texte: ECHANTILLON_DEFAUT };

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
     Demande utilisateur : « il faut en haut de la liste un filtre d'affichage pour
     les afficher aussi en ligne avec une grosse preview de la part de la font, qui
     sera sur une ligne ; une par ligne par défaut ».

     C'est donc l'affichage PAR DÉFAUT. Il montre la phrase d'aperçu — la sienne si
     on en a écrit une — dans le corps de chaque famille, sur UNE ligne, coupée
     proprement si elle dépasse. Le nom reste petit à gauche : il sert à savoir ce
     qu'on installe, pas à décorer. */
  function ligne(f) {
    var c = el('div', 'display:flex;align-items:center;gap:14px;border-bottom:1px solid #ececec;padding:9px 2px;min-width:0;');
    c.setAttribute('data-famille', f.n);

    var gauch = el('div', 'flex:0 0 152px;min-width:0;overflow:hidden;');
    var nom = el('div', 'font-size:11px;font-weight:600;color:#1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', f.n);
    gauch.appendChild(nom);
    var meta = el('div', 'font-size:9px;color:#aaa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
                  categorieTexte(f.c) + ' · ' + f.poids.length + ' ' + t(L('graisses', 'weights', 'ウェイト')));
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
    /* ⚠️ LA CARTE EST ÉCRITE DANS SA PROPRE POLICE, dès qu'elle est chargée. Le
       nom seul ne dit rien : « Fraunces » ou « Sora » ne s'imaginent pas. */
    var nom = el('div', 'font-size:19px;line-height:1.15;color:#1a1a1a;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', f.n);
    nom.className = 'spgf-nom';
    nom.style.fontFamily = "'" + f.n + "', sans-serif";
    haut.appendChild(nom);
    var badge = el('span', 'flex:0 0 auto;font-size:9px;letter-spacing:.4px;text-transform:uppercase;color:#999;border:1px solid #e6e6e6;padding:1px 5px;', categorieTexte(f.c));
    haut.appendChild(badge);
    c.appendChild(haut);

    var ech = el('div', 'font-size:12px;line-height:1.35;color:#666;min-height:33px;overflow:hidden;', etat.texte || f.echant);
    ech.className = 'spgf-ech';
    ech.style.fontFamily = "'" + f.n + "', serif";
    c.appendChild(ech);

    var pied = el('div', 'display:flex;align-items:center;gap:8px;margin-top:auto;');
    var poids = el('span', 'font-size:9px;color:#aaa;flex:1;', f.variable ? t(L('variable', 'variable', 'バリアブル')) + ' · ' + f.poids.length + ' ' + t(L('graisses', 'weights', 'ウェイト'))
                                                                          : f.poids.length + ' ' + t(L('graisses', 'weights', 'ウェイト')));
    pied.appendChild(poids);
    pied.appendChild(boutonInstaller(f));
    c.appendChild(pied);

    /* L'aperçu se charge quand la carte devient visible (cf. en-tête). */
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
          /* Injoignable : la carte garde sa police de repli et le dit une fois. */
          if (!c._spgfMuette) {
            c._spgfMuette = true;
            refs.ech.textContent = f.echant + ' — ' + t(L('aperçu indisponible hors ligne', 'preview unavailable offline', 'オフラインではプレビューできません'));
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
      return f.n.toLowerCase().indexOf(q) >= 0 || f.echant.toLowerCase().indexOf(q) >= 0;
    });
  }

  function dessiner(grille, compteur) {
    grille.innerHTML = '';
    var l = listeFiltree();
    if (compteur) compteur.textContent = l.length + ' ' + t(L('familles', 'families', 'ファミリー'));
    if (!l.length) {
      grille.appendChild(el('div', 'padding:26px 4px;color:#999;font-size:12px;text-align:center;',
        t(L('Aucune famille ne correspond à cette recherche.', 'No family matches this search.', 'この検索に一致するファミリーはありません。'))));
      return;
    }
    if (etat.mode === 'liste') {
      grille.style.display = 'block';
      l.forEach(function (f) { grille.appendChild(ligne(f)); });
    } else {
      grille.style.display = 'grid';
      l.forEach(function (f) { grille.appendChild(carte(f)); });
    }
  }

  function ouvrir() {
    if (document.getElementById(ID)) return;
    /* Les préférences d'affichage sont relues À CHAQUE OUVERTURE : le mode et la
       phrase d'aperçu survivent à la fermeture du panneau et au rechargement. */
    etat.mode = (lirePreference(CLE_MODE, 'liste') === 'grille') ? 'grille' : 'liste';
    var texteMemorise = lirePreference(CLE_TEXTE, ECHANTILLON_DEFAUT);
    etat.texte = texteMemorise || ECHANTILLON_DEFAUT;

    var ov = el('div', '');
    ov.id = ID;
    /* Voile plein écran, comme les autres fenêtres de l'application. */
    ov.setAttribute('style', 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100020;display:flex;align-items:center;justify-content:center;padding:24px;');
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) fermer(); });

    var carteCadre = el('div', '');
    carteCadre.className = 'sp-modal-card';
    carteCadre.setAttribute('style', 'position:relative;width:1020px;max-width:96vw;height:86vh;max-height:88vh;display:flex;flex-direction:column;background:#fff;border-radius:0;overflow:hidden;min-height:0;');

    /* En-tête : même facture que les 22 fenêtres (titre 13 px, croix 28×28). */
    var entete = el('div', 'display:flex;align-items:center;gap:8px;padding:16px;border-bottom:1px solid #e6e6e6;flex:0 0 auto;');
    entete.className = 'modal-header';
    var titre = el('div', '', t(L('Polices Google', 'Google Fonts', 'Google フォント')));
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
    /* ⚠️ `min-height: 0` — LA PANNE CLASSIQUE DU FLEX, ET ELLE A ÉTÉ MESURÉE.
       Sans cette ligne, un enfant flex refuse de descendre sous la hauteur de son
       CONTENU : le corps du panneau ne défilait donc pas, il débordait simplement
       de la carte (coupé par `overflow: hidden`), et l'IntersectionObserver voyait
       les 34 familles à la fois. Résultat mesuré : 34 feuilles Google et 34
       fichiers de police téléchargés à l'ouverture, pour une liste où 9 cartes
       tiennent à l'écran. Avec `min-height: 0`, le corps défile et chaque aperçu
       n'est demandé qu'en entrant dans la zone visible. */
    corps.style.minHeight = '0';
    carteCadre.appendChild(corps);

    /* Ligne de conduite : une phrase, pas un paragraphe. */
    var intro = el('div', 'font-size:11px;color:#777;line-height:1.45;margin-bottom:10px;',
      t(L('Choisissez une famille, installez-la : elle rejoint les polices de SuperPrint et y reste.',
          'Pick a family, install it: it joins SuperPrint\'s fonts and stays there.',
          'ファミリーを選んでインストールすると、SuperPrint のフォントとして残ります。')));
    corps.appendChild(intro);

    /* ══ LE TEXTE D'APERÇU (demande utilisateur) ══════════════════════════════════
       « un champ écrire mon texte serait possible simplement ? »
       Oui : une phrase à soi, appliquée à TOUS les aperçus. Elle est enregistrée :
       on la retrouve à l'ouverture suivante, ce qui évite de la retaper à chaque
       essai — c'est justement l'usage (comparer deux familles sur son propre titre). */
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
    rech.placeholder = t(L('Rechercher une famille…', 'Search a family…', 'ファミリーを検索…'));
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
        dessiner(grille, compteur);
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
      dessiner(grille, compteur);
    }
    bListe.addEventListener('click', function () { poserMode('liste'); });
    bGrille.addEventListener('click', function () { poserMode('grille'); });

    /* Le texte d'aperçu se réécrit SANS reconstruire la liste : on change le
       contenu des nœuds visibles, ce qui évite de relancer les polices. */
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

    var piedInfo = el('div', 'margin-top:14px;padding-top:11px;border-top:1px solid #eee;font-size:10px;color:#999;line-height:1.5;',
      t(L('Les polices viennent de Google Fonts et sont libres d\'usage, y compris commercial. Une police installée est enregistrée avec le document qui l\'utilise : il s\'ouvre à l\'identique sur une autre machine.',
          'The fonts come from Google Fonts and are free to use, including commercially. An installed font is saved with the document that uses it: it opens the same way on another machine.',
          'フォントは Google Fonts 提供で、商用利用も自由です。インストールしたフォントは使用した文書と一緒に保存されるため、他のマシンでも同じ表示になります。')));
    corps.appendChild(piedInfo);

    document.body.appendChild(ov);
    ov.appendChild(carteCadre);

    /* IntersectionObserver : la carte demande sa police en devenant visible. */
    try {
      etat.observer = new IntersectionObserver(function (entrees) {
        entrees.forEach(function (e) {
          if (!e.isIntersecting) return;
          var c = e.target;
          if (typeof c._spgf === 'function') { c._spgf(); etat.observer.unobserve(c); }
        });
      }, { root: corps, rootMargin: '160px' });
    } catch (_) { etat.observer = null; }

    dessiner(grille, compteur);
    /* Sans IntersectionObserver (navigateur ancien), on charge tout : mieux vaut
       des mégaoctets que des cartes muettes. */
    if (!etat.observer) FAMILLES.forEach(function (f) { chargerFeuille(f).catch(function () {}); });

    rech.addEventListener('input', function () { etat.recherche = rech.value || ''; dessiner(grille, compteur); });
    document.addEventListener('keydown', surEchap, true);
    try { rech.focus(); } catch (_) {}
  }

  /* ── RETROUVER LES POLICES INSTALLÉES AU LANCEMENT ────────────────────────────
     Sans ceci, une police installée hier aurait disparu aujourd'hui : le `<link>`
     Google vit dans la page, pas dans le produit. On réinstalle donc en silence les
     familles mémorisées (une requête chacune, et le navigateur les a en cache).

     ⚠️ ON ATTEND QUE L'APPLICATION SOIT PRÊTE, ET C'EST UNE MESURE.
     Un premier montage restaurait à +1,2 s après `DOMContentLoaded`. MESURÉ : le
     `<link>` Google était bien posé, la police était bien disponible à l'écran…
     et le `<select>` restait sans elle. La raison : `_spRegisterCustomFontDataUrl`
     — le point d'entrée qui range la police dans le produit — est défini au milieu
     de `main.js`, un fichier de 6 Mo dont l'exécution dépasse ce délai. L'appel
     partait donc avant que la fonction existe, et l'échec était avalé.
     On sonde maintenant son apparition (400 ms, jusqu'à 40 s) avant de restaurer.

     ⚠️ ON N'INSTALLE QUE CELLES DE NOTRE LISTE. Une famille mémorisée puis retirée
     du catalogue laisse simplement son nom dans la liste : on l'ignore au lieu de
     lancer une requête pour une fiche devenue inconnue. */
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
    /* ══ 🆕 v1.7.673 — UNE POLICE GOOGLE ARRIVÉE PAR UN DOCUMENT EST RETENUE ══════
       Question de l'utilisateur : « comment on va avec le .sp et le .json pour les
       typo Google, il va les retrouver, les recharger ? ».

       MESURÉ : oui. Le .sp embarque la police dans `resources.customFonts` (20 Ko
       pour Sora, et SEULEMENT si un bloc l'utilise) et le .json dans `customFonts`
       à la racine ; à l'ouverture, l'application l'enregistre elle-même — vérifié en
       effaçant Sora du sélecteur et du registre : le réenregistrement la ramène et
       `document.fonts.check` repasse à vrai.
       ⚠️ MAIS ELLE NE SURVIVAIT PAS AU LANCEMENT SUIVANT, et c'est ce que ce bloc
       corrige : le journal du plug-in ne connaissait que les polices installées
       DEPUIS LE PANNEAU. Un document reçu d'un collègue s'ouvrait donc correctement
       une fois… puis le lendemain, sans ce document, la famille avait disparu du
       sélecteur. On écoute le point d'entrée que l'application utilise pour TOUTES
       ses restaurations (ouverture de .sp, de .json, autosave) : si la famille est
       dans notre catalogue, elle rejoint le journal et sera réinstallée au prochain
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
    noms.forEach(function (nom) {
      var f = famille(nom);
      if (!f || estInstallee(nom)) return;
      installer(f, true).catch(function () {});
    });
  }

  SPPluginAPI({
    id: 'google-fonts',
    name: L('Polices Google', 'Google Fonts', 'Google フォント'),
    version: '1.0.0',
    author: 'SuperPrint',
    icon: 'Aa',
    description: L('Les grandes familles typographiques du moment, dessinées dans leur propre police. Un clic les installe dans SuperPrint, pour de bon.',
      'The big type families of the moment, drawn in their own font. One click installs them in SuperPrint for good.',
      '今を代表する書体を、その書体そのもので見比べられます。ワンクリックで SuperPrint にインストール。'),
    icone: '<path d="M4 19h5.5"/><path d="M6.75 19V6.2L11 15.4 15.25 6.2V19"/><path d="M17.5 19h4"/><circle cx="19.5" cy="13.5" r="2.1"/>',
    /* Le panneau que ce plug-in possède. */
    trappe: ID,
    options: [],
    run: function (a) { api = a; return new Promise(function (resolve) { restaurer(); ouvrir(); resolve(true); }); }
  });

  /* Le panneau est déjà monté par `run`. `restaurer` a besoin que `main.js` ait
     fini (cf. `pret`) : il sonde son propre prérequis, donc l'instant exact du
     lancement n'a plus d'importance. */
  try {
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(restaurer, 600);
    else document.addEventListener('DOMContentLoaded', function () { setTimeout(restaurer, 600); });
  } catch (_) {}
})();
