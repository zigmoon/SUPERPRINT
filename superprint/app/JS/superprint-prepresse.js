/* ══════════════════════════════════════════════════════════════════════════
   superprint-prepresse.js — le contrôle prépresse par le noyau Rust.

   ## Le joint, et pourquoi il ne coûte rien

   `index.html` appelle `window.confirmExport || confirmExport`, et `main.js` pose
   `window.confirmExport` (ligne 31754). Cette colle **enveloppe** cette porte :
   elle n'ajoute **aucune ligne à `main.js`**, contrairement au branchement de
   l'import de documents.

   Elle n'ajoute **aucun téléchargement** non plus : le prépresse vit dans
   `superprint_core.wasm`, le module précaché — `sp_preflight` est l'un des
   49 exports, mesuré par `scripts/validate-wasm.mjs`. Le noyau est déjà chargé
   au démarrage par `superprint-branchement.js`, et l'API `createDocument()` /
   `preflight()` de `superprint-core.js` existe depuis les travaux précédents.

   ## Ce que ce contrôle conduit, et ce qu'il ne conduit PAS

   Le prépresse connaît treize constats. Cette colle en conduit **huit**, et elle
   **nomme les autres** dans le rapport, parce qu'un contrôle qu'on croit actif
   mais qui ne s'applique pas est pire qu'un contrôle absent :

   | Conduit | Pourquoi il peut l'être |
   |---|---|
   | `fond-perdu-absent` | le format et le fond perdu sont dans le projet |
   | `reperes-sans-reserve` | la case des traits de coupe est dans la modale |
   | `image-basse-resolution` | les pixels de l'image et sa boîte posée se lisent |
   | `couverture-encre-excessive` | les rectangles, cercles et traits portent leur peinture |
   | `noir-quadri-trait-fin` | idem |
   | `debordement-fond-perdu` | idem |
   | `document-vide` | le nombre de pages se compte |
   | `image-espace-inattendu` | l'espace de chaque image est déclaré |

   | Non conduit | Ce qui le manque |
   |---|---|
   | `police-non-embarquee` | les polices : l'application ne livre que du **WOFF2**, et le noyau lit le **TrueType** (il refuse même l'OpenType à contours CFF) |
   | `noir-quadri-texte-fin` | les opérations de **texte** — donc la police, encore |
   | `texte-vivant` | idem |
   | `profil-sortie-incoherent` | un profil de sortie n'est déclaré qu'en CMJN |

   ## Ce qui n'est pas décrit, et qui est compté

   Un objet dont la géométrie ne peut pas être convertie **sans deviner** n'est
   pas décrit : les **tracés** (`Fabric.Path`), les **groupes**, le **texte**, un
   objet **tourné**, un rectangle dont le trait déborde du cadre. Ils sont
   **comptés**, et le rapport dit combien. Le traduire de travers produirait un
   constat faux — et un constat faux fait désactiver le contrôle.

   ## La seule chose qui est filtrée, et pourquoi elle est nommée

   En **RVB**, l'export du produit n'écrit aucun profil de sortie, et le noyau le
   signale (un avertissement **par page**). Ce n'est pas un défaut du fichier :
   c'est une conséquence du modèle décrit ici. Ce **seul** constat est donc
   retiré du rapport, et la ligne de bas de page le dit. Tout le reste passe tel
   quel — jamais de tri, jamais d'arrondi de gravité.
   ══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  /** Version de ce branchement (sert aussi de paramètre `?v=` dans `index.html`). */
  var VERSION = '20261013-v637-rust-prepresse';

  /** URL du noyau, relative à la page. Le même fichier que le branchement. */
  var URL_NOYAU = 'JS/superprint_core.wasm';

  /** Unités : les objets du projet sont en points PostScript (72 dpi). */
  var MM_PAR_PT = 25.4 / 72;
  var MM_PAR_POUCE = 25.4;

  /** Codes de la frontière. */
  var ERR_TOO_SMALL = -1000002;

  /**
   * Ce qui n'est pas à imprimer, recopié de `main.js` (`buildImposedSheetCanvas`)
   * et de `superprint-montage.js` — les **mêmes quatorze** drapeaux, dans le même
   * ordre. `validate-prepresse-branchement.mjs` exige l'identité des deux listes,
   * et **dit** lesquels de ces drapeaux existent réellement dans le produit : les
   * autres sont des garde-fous, et le taire laisserait croire qu'ils sont mesurés.
   */
  var NON_IMPRIMABLES = [
    'isMargin',
    'isBleed',
    'isTrimBox',
    'isGuide',
    'isManualGuide',
    'isGridGuide',
    'isBaselineGuide',
    '_isSpreadMirror',
    'excludeFromExport',
    '_isChainBadge',
    '_isLinkArrow',
    '_isOverflowIndicator',
    '_isOverflowFromLeft',
    '_isOverflowFromRight',
  ];
  var TRAITS_PARASITES = ['0D99FF', '0d99ff', 'rgba(13,153,255', 'rgba(13, 153, 255'];

  /** Les constats que cette colle ne conduit pas, et ce qui les manquerait. */
  var NON_CONDUITS = [
    ['police-non-embarquee', 'les polices (l’application ne livre que du WOFF2, le noyau lit du TrueType)'],
    ['noir-quadri-texte-fin', 'le noir quadrichrome sur un texte fin (il faudrait décrire le texte)'],
    ['texte-vivant', 'le texte vivant (idem)'],
    ['profil-sortie-incoherent', 'la cohérence du profil de sortie (déclaré seulement en CMJN)'],
  ];

  var etat = {
    version: VERSION,
    /** Le noyau est chargé et prêt. */
    pret: false,
    chargement: null,
    raison: null,
    /** Ce qui a servi : `'rust'`, `'js'` ou `null` avant le premier export. */
    dernier: null,
    /** Nombre d'exports contrôlés, et nombre de fois où l'on a délégué. */
    controles: 0,
    delegues: 0,
    /** Le dernier rapport rendu, en texte — pour le diagnostic et les contrôles. */
    dernierRapport: null,
    /** Le dernier refus, en clair : ce qui a empêché de décrire le document. */
    dernierRefus: null,
    /** Ce que le noyau a rendu au dernier contrôle, sans le filtrage du RVB. */
    dernierConstats: 0,
  };

  var dejaJournalise = false;
  function journaliser(message) {
    if (dejaJournalise) return;
    dejaJournalise = true;
    if (global.console && global.console.info) global.console.info('[SuperPrint·Rust] ' + message);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Chargement du noyau — celui du branchement, pas un second
  // ─────────────────────────────────────────────────────────────────────────

  function charger() {
    if (etat.pret) return Promise.resolve(etat.noyau);
    if (etat.chargement) return etat.chargement;
    if (!global.SuperPrintCore || typeof global.SuperPrintCore.load !== 'function') {
      etat.raison = new Error('colle absente (JS/superprint-core.js non chargée)');
      etat.chargement = Promise.resolve(null);
      return etat.chargement;
    }
    etat.chargement = global.SuperPrintCore.load({ url: URL_NOYAU })
      .then(function (moteur) {
        if (!moteur || moteur.backend !== 'wasm' || typeof moteur.preflight !== 'function') {
          etat.raison = new Error('module WebAssembly sans prépresse');
          return null;
        }
        etat.noyau = moteur;
        etat.pret = true;
        etat.raison = null;
        journaliser(
          'prépresse branché sur le noyau Rust (' +
            moteur.preflightVersion +
            ' contrôles connus, aucun téléchargement de plus)',
        );
        return moteur;
      })
      .catch(function (erreur) {
        etat.raison = erreur;
        etat.chargement = null;
        journaliser(
          'prépresse : noyau indisponible, l’export du produit reste en place (' +
            (erreur && erreur.message ? erreur.message : erreur) +
            ')',
        );
        return null;
      });
    return etat.chargement;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Les réglages, lus aux MÊMES sources que confirmExport
  // ─────────────────────────────────────────────────────────────────────────

  function element(id) {
    return global.document && global.document.getElementById
      ? global.document.getElementById(id)
      : null;
  }

  function coche(id, defaut) {
    var el = element(id);
    return el ? !!el.checked : defaut;
  }

  function radio(nom) {
    var el = global.document && global.document.querySelector
      ? global.document.querySelector('input[name="' + nom + '"]:checked')
      : null;
    return el ? el.value : null;
  }

  /**
   * Les réglages du chemin d'export courant.
   *
   * ⚠️ Les identifiants et les valeurs par défaut sont **recopiés de
   * `confirmExport`** (`main.js`), et le contrôle les relit là-bas : un champ
   * renommé côté produit fait échouer `validate-prepresse-branchement.mjs`
   * au lieu de faire décrire le mauvais document.
   */
  function lireReglages() {
    var fondPerdu = element('bleed') ? parseFloat(element('bleed').value) : NaN;
    if (!isFinite(fondPerdu) || fondPerdu < 0) fondPerdu = 3;
    return {
      fondPerduMm: fondPerdu,
      traitsDeCoupe: coche('cropMarks', false),
      inclureFondPerdu: coche('exportIncludeBleed', false),
      mode: (radio('colorMode') || 'rgb').toLowerCase(),
      profilIcc: element('cmykIccProfile') ? element('cmykIccProfile').value : 'CoatedFOGRA39',
      qualite: (radio('exportQuality') || 'medium').toLowerCase(),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  La description du document
  // ─────────────────────────────────────────────────────────────────────────

  /** Un objet Fabric est-il une décoration à ne pas imprimer ? */
  function horsImpression(objet) {
    for (var i = 0; i < NON_IMPRIMABLES.length; i += 1) {
      if (objet[NON_IMPRIMABLES[i]]) return true;
    }
    return false;
  }

  /** Retire les traits de sélection et de chaînage restés dans le document. */
  function traitParasite(objet) {
    var trait = objet ? objet.stroke : null;
    if (objet && objet.type === 'image') return true;
    if (trait == null) return false;
    if (typeof trait !== 'string') return false;
    for (var i = 0; i < TRAITS_PARASITES.length; i += 1) {
      if (trait.indexOf(TRAITS_PARASITES[i]) !== -1) return true;
    }
    return false;
  }

  /** Un objet peut-il être décrit **sans deviner** ? */
  function decrivable(objet) {
    if (!objet || typeof objet !== 'object') return false;
    if (objet.angle && Math.abs(Number(objet.angle)) > 1e-9) return false;
    var ox = objet.originX === undefined ? 'left' : objet.originX;
    var oy = objet.originY === undefined ? 'top' : objet.originY;
    if (ox !== 'left' || oy !== 'top') return false;
    return true;
  }

  /** Un nombre fini, ou la valeur de repli. */
  function nombre(valeur, defaut) {
    var n = Number(valeur);
    return isFinite(n) ? n : defaut;
  }

  /**
   * Les couleurs CSS que ce contrôle sait lire, et rien d'autre.
   *
   * `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)`, `rgba(...)`. Une couleur non
   * reconnue fait **refuser** l'objet, qui est alors compté comme non décrit :
   * inventer une teinte fausserait le constat de couverture d'encre.
   */
  function couleurRgb(css) {
    if (typeof css !== 'string') return null;
    var s = css.trim().toLowerCase();
    if (s === '' || s === 'none' || s === 'transparent') return null;
    var m = /^#([0-9a-f]{3})$/.exec(s);
    if (m) {
      return {
        r: parseInt(m[1][0] + m[1][0], 16),
        g: parseInt(m[1][1] + m[1][1], 16),
        b: parseInt(m[1][2] + m[1][2], 16),
      };
    }
    m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
    if (m) {
      return {
        r: parseInt(m[1].slice(0, 2), 16),
        g: parseInt(m[1].slice(2, 4), 16),
        b: parseInt(m[1].slice(4, 6), 16),
      };
    }
    m = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/.exec(s);
    if (m) {
      return {
        r: Math.round(Number(m[1])),
        g: Math.round(Number(m[2])),
        b: Math.round(Number(m[3])),
      };
    }
    return null;
  }

  /** Une peinture pour le noyau, dans l'espace de la page. */
  function peinture(rgb, mode, noyau) {
    if (!rgb) return null;
    if (mode !== 'cmjn' && mode !== 'cmyk') {
      return { rgb: { r: rgb.r, g: rgb.g, b: rgb.b } };
    }
    // La conversion est celle du **produit** (`_spCmykConvert`), que le noyau
    // reproduit et que `scripts/validate-cmyk.mjs` compare sur 655 024 cas.
    var cmyk = noyau.rgbToCmyk ? noyau.rgbToCmyk([rgb.r, rgb.g, rgb.b]) : null;
    if (!cmyk) return null;
    return { cmyk: { c: cmyk[0] / 255, m: cmyk[1] / 255, y: cmyk[2] / 255, k: cmyk[3] / 255 } };
  }

  /** Les deux peintures d'un objet Fabric : remplissage et trait. */
  function peintures(objet) {
    return {
      remplissage: couleurRgb(objet.fill),
      trait: traitParasite(objet) ? null : couleurRgb(objet.stroke),
      epaisseurPt: traitParasite(objet) ? 0 : nombre(objet.strokeWidth, 0),
    };
  }

  /**
   * Les pixels d'une image, par son `src` (une URL de données).
   *
   * Rend `{ pixels, largeur, hauteur }` — les dimensions **naturelles**, qui sont
   * celles que le noyau compare à la boîte posée pour calculer la résolution.
   */
  function pixelsDeImage(src, noyau) {
    return new Promise(function (resoudre) {
      if (typeof src !== 'string' || !src || typeof global.Image !== 'function') {
        resoudre(null);
        return;
      }
      var image = new global.Image();
      image.onload = function () {
        try {
          var largeur = image.naturalWidth || image.width;
          var hauteur = image.naturalHeight || image.height;
          if (!largeur || !hauteur) {
            resoudre(null);
            return;
          }
          var toile = global.document.createElement('canvas');
          toile.width = largeur;
          toile.height = hauteur;
          var contexte = toile.getContext('2d');
          contexte.drawImage(image, 0, 0);
          var donnees = contexte.getImageData(0, 0, largeur, hauteur).data;
          var rgb = new Uint8Array(largeur * hauteur * 3);
          for (var i = 0, j = 0; i < donnees.length; i += 4, j += 3) {
            rgb[j] = donnees[i];
            rgb[j + 1] = donnees[i + 1];
            rgb[j + 2] = donnees[i + 2];
          }
          resoudre({ pixels: rgb, largeur: largeur, hauteur: hauteur });
        } catch (erreur) {
          // Une image d'une autre origine fait échouer `getImageData` : on ne
          // devine pas ses pixels, on la compte comme non décrite.
          resoudre(null);
        }
      };
      image.onerror = function () {
        resoudre(null);
      };
      image.src = src;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Le contrôle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Décrit le projet dans le noyau, et rend le rapport.
   *
   * Rend `{ rapport, nonDecrits, pages }`, ou `{ refus }` quand le document ne
   * peut pas être décrit fidèlement — et le refus **nomme** ce qui manque, parce
   * qu'un contrôle qui devine est pire qu'un contrôle qui s'abstient.
   */
  function controler(projet, reglages, noyau) {
    if (!projet || !projet.pages || !projet.pages.length) {
      return Promise.resolve({ refus: 'aucun document' });
    }
    var format = projet.document && projet.document.format;
    if (!format || !(format.width > 0) || !(format.height > 0)) {
      return Promise.resolve({ refus: 'format de page illisible' });
    }
    var quadri = reglages.mode === 'cmjn' || reglages.mode === 'cmyk' ? 'cmyk' : 'rgb';

    var doc = null;
    try {
      if (typeof noyau.createDocument !== 'function') {
        return Promise.resolve({ refus: 'le noyau ne sait pas décrire un document' });
      }
      doc = noyau.createDocument();
    } catch (erreur) {
      return Promise.resolve({ refus: 'document impossible : ' + (erreur.message || erreur) });
    }

    var nonDecrits = 0;
    var images = [];
    var texte = '';
    var champs = ['polices', 'texte'];

    for (var p = 0; p < projet.pages.length; p += 1) {
      doc.addPage({
        trimWidthMm: format.width,
        trimHeightMm: format.height,
        bleedMm: reglages.fondPerduMm,
        quadri: quadri,
      });
      var objets = (projet.pages[p] && projet.pages[p].objects) || [];
      for (var o = 0; o < objets.length; o += 1) {
        var objet = objets[o];
        if (horsImpression(objet)) continue;
        if (!decrivable(objet)) {
          nonDecrits += 1;
          continue;
        }
        // Le repère du noyau part du **bas** à gauche du format fini, celui de
        // Fabric du **haut** à gauche : c'est le retournement qui décide de tout,
        // et `validate-prepresse-branchement.mjs` le mesure au dixième de
        // millimètre avant de s'y fier.
        var gauche = nombre(objet.left, 0) * MM_PAR_PT;
        var haut = nombre(objet.top, 0) * MM_PAR_PT;
        var largeur = nombre(objet.width, 0) * MM_PAR_PT;
        var hauteur = nombre(objet.height, 0) * MM_PAR_PT;
        var bas = format.height - haut - hauteur;
        var pein = peintures(objet);

        try {
          if (objet.type === 'image') {
            images.push({ objet: objet, gauche: gauche, bas: bas, largeur: largeur, hauteur: hauteur });
            continue;
          }
          if (objet.type === 'line') {
            var ep = pein.epaisseurPt * MM_PAR_PT;
            var peintureTrait = peinture(pein.trait, reglages.mode, noyau);
            if (!peintureTrait) {
              nonDecrits += 1;
              continue;
            }
            doc.line({
              x1: gauche,
              y1: format.height - haut,
              x2: gauche + largeur,
              y2: format.height - (haut + hauteur),
              thickness: ep,
              paint: peintureTrait,
            });
            continue;
          }
          if (objet.type === 'circle') {
            var rayon = (nombre(objet.radius, 0) || largeur / 2) * MM_PAR_PT;
            var cx = gauche + largeur / 2;
            var cy = bas + hauteur / 2;
            var pF = peinture(pein.remplissage, reglages.mode, noyau);
            var pT = peinture(pein.trait, reglages.mode, noyau);
            if (pF) doc.fillCircle({ cx: cx, cy: cy, r: rayon, paint: pF });
            if (pT) {
              doc.strokeCircle({
                cx: cx,
                cy: cy,
                r: rayon,
                thickness: pein.epaisseurPt * MM_PAR_PT,
                paint: pT,
              });
            }
            if (!pF && !pT) nonDecrits += 1;
            continue;
          }
          if (objet.type === 'rect') {
            var pf = peinture(pein.remplissage, reglages.mode, noyau);
            var pt = peinture(pein.trait, reglages.mode, noyau);
            // Un trait déborde de la moitié de son épaisseur de chaque côté du
            // cadre : décrire le cadre seul laisserait passer un débordement de
            // 2 pt, et c'est exactement la grandeur qui compte en prépresse.
            var demi = (pein.epaisseurPt * MM_PAR_PT) / 2;
            if (pf) {
              doc.fillRect({ x: gauche, y: bas, width: largeur, height: hauteur, paint: pf });
            }
            if (pt) {
              doc.strokeRect({
                x: gauche + demi,
                y: bas + demi,
                width: Math.max(0, largeur - 2 * demi),
                height: Math.max(0, hauteur - 2 * demi),
                thickness: pein.epaisseurPt * MM_PAR_PT,
                paint: pt,
              });
            }
            if (!pf && !pt) nonDecrits += 1;
            continue;
          }
          nonDecrits += 1;
        } catch (erreur) {
          // Le noyau a refusé cette forme : elle n'est pas décrite, et elle est
          // comptée. Une exception ici ne doit pas perdre tout le rapport.
          nonDecrits += 1;
          texte = String((erreur && erreur.message) || erreur);
        }
      }
    }

    // Les images : il faut leurs pixels, donc c'est asynchrone, et c'est ce qui
    // donne au noyau la résolution **posée** — le contrôle qui attrape une photo
    // à 85 dpi.
    var chaine = Promise.resolve();
    images.forEach(function (info) {
      chaine = chaine.then(function () {
        var src = info.objet.src || info.objet._element && info.objet._element.src;
        return pixelsDeImage(src, noyau).then(function (px) {
          if (!px) {
            nonDecrits += 1;
            return;
          }
          var rang = doc.addImageRgb(px.pixels, px.largeur, px.hauteur, 0);
          doc.placeImage({
            image: rang,
            x: info.gauche,
            y: info.bas,
            width: info.largeur,
            height: info.hauteur,
          });
        });
      });
    });

    return chaine
      .then(function () {
        var rapport = doc.preflight('');
        return { rapport: rapport, nonDecrits: nonDecrits, pages: projet.pages.length, note: texte };
      })
      .catch(function (erreur) {
        return { refus: 'le noyau a refusé la description : ' + (erreur.message || erreur) };
      });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Le rapport, mis en mots pour l'utilisateur
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Le rapport lisible : les constats du noyau, puis ce qui n'a PAS été contrôlé.
   *
   * Le noyau rend un code et une gravité par constat ; la traduction est ici, à
   * un seul endroit, et **jamais** un tri par gravité : le noyau trie déjà.
   */
  function message(rapport, nonDecrits, mode) {
    var lignes = [];
    var erreurs = rapport.compte ? rapport.compte.erreurs : 0;
    var avertissements = rapport.compte ? rapport.compte.avertissements : 0;
    var infos = rapport.compte ? rapport.compte.informations : 0;

    if (erreurs + avertissements === 0) {
      lignes.push('Aucun défaut prépresse détecté sur ce document.');
    } else {
      lignes.push(
        (erreurs ? erreurs + ' erreur(s)' : '') +
          (erreurs && avertissements ? ', ' : '') +
          (avertissements ? avertissements + ' avertissement(s)' : '') +
          '.',
      );
    }
    rapport.constats.forEach(function (constat) {
      if (mode !== 'cmjn' && mode !== 'cmyk' && constat.code === 'profil-sortie-absent') return;
      lignes.push('• ' + constat.message + (constat.page ? ' (page ' + constat.page + ')' : ''));
    });

    lignes.push('');
    lignes.push('Non contrôlé :');
    NON_CONDUITS.forEach(function (paire) {
      lignes.push('• ' + paire[1]);
    });
    if (mode !== 'cmjn' && mode !== 'cmyk') {
      lignes.push('• le profil de sortie (l’export RVB n’en écrit aucun)');
    }
    if (nonDecrits > 0) {
      lignes.push(
        '• ' +
          nonDecrits +
          ' objet(s) non décrit(s) : les tracés, le texte et les groupes, dont la ' +
          'géométrie ne peut pas être convertie sans deviner',
      );
    }
    void infos;
    return lignes.join('\n');
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  L'enveloppe
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Contrôle le document **sans passer par le bouton**.
   *
   * Rend `{ rapport, message, constats }` ou `{ refus }`. C'est la porte que le
   * contrôle automatique éprouve, et celle qu'un jour un bouton « Vérifier »
   * pourra appeler.
   */
  function verifier() {
    var reglages = lireReglages();
    var projet = null;
    try {
      projet = typeof global.saveProjectSP_toObject === 'function'
        ? global.saveProjectSP_toObject()
        : null;
    } catch (erreur) {
      return Promise.resolve({ refus: 'document illisible : ' + (erreur.message || erreur) });
    }
    return charger().then(function (noyau) {
      if (!noyau) return { refus: 'noyau indisponible' };
      return controler(projet, reglages, noyau).then(function (resultat) {
        if (resultat.refus) {
          etat.dernierRefus = resultat.refus;
          return resultat;
        }
        etat.dernierConstats = resultat.rapport.constats.length;
        etat.dernierRapport = resultat.rapport.constats
          .map(function (c) {
            return c.code + (c.page ? ' (page ' + c.page + ')' : '');
          })
          .join('\n');
        etat.controles += 1;
        return {
          rapport: resultat.rapport,
          constats: resultat.rapport.constats.length,
          nonDecrits: resultat.nonDecrits,
          message: message(resultat.rapport, resultat.nonDecrits, reglages.mode),
        };
      });
    });
  }

  /** Reprend `window.confirmExport`, sans jamais perdre l'original. */
  function reprendreLeBouton() {
    var original = global.confirmExport;
    if (typeof original !== 'function') {
      journaliser('⚠️ window.confirmExport absent : le joint de main.js manque');
      return false;
    }
    var remplacant = function () {
      var args = arguments;
      var contexte = this;
      return charger()
        .then(function (noyau) {
          if (!noyau) return null;
          return verifier();
        })
        .then(function (resultat) {
          if (!resultat) {
            etat.delegues += 1;
            return original.apply(contexte, args);
          }
          if (resultat.refus) {
            // Le document n'a pas pu être décrit : on **ne montre rien**. Un
            // rapport construit sur une description incomplète ferait des
            // constats faux, et un constat faux fait désactiver le contrôle.
            etat.delegues += 1;
            if (global.console && global.console.info) {
              global.console.info('[SuperPrint·Rust] prépresse : non conduit — ' + resultat.refus);
            }
            return original.apply(contexte, args);
          }
          if (resultat.constats === 0) {
            // Rien à signaler : ne pas interrompre l'export. Le rapport vide est
            // gardé pour le diagnostic.
            etat.dernier = 'rust';
            return original.apply(contexte, args);
          }
          var demander = global.spConfirm || global.confirm;
          var question =
            'Contrôle prépresse — avant l’envoi à l’imprimeur\n\n' +
            resultat.message +
            '\n\nExporter quand même ?';
          return Promise.resolve(demander(question, { type: 'info', ok: 'Exporter' })).then(
            function (accepte) {
              if (!accepte) {
                etat.dernier = 'refuse';
                return false;
              }
              etat.dernier = 'rust';
              return original.apply(contexte, args);
            },
          );
        })
        .catch(function (erreur) {
          // Toute panne de la colle rend la main au produit, sans un mot de plus.
          etat.raison = erreur;
          etat.delegues += 1;
          return original.apply(contexte, args);
        });
    };
    remplacant.__spPrepresse = true;
    remplacant.__spPrepresseOriginal = original;
    global.confirmExport = remplacant;
    return true;
  }

  function demarrer() {
    reprendreLeBouton();
    // Le noyau est déjà chargé au démarrage par `superprint-branchement.js` :
    // ce chargement ne demande rien de plus, il prend la même instance.
    charger();
  }

  global.SPPrepresse = {
    version: VERSION,
    get etat() {
      return {
        pret: etat.pret,
        dernier: etat.dernier,
        controles: etat.controles,
        delegues: etat.delegues,
        dernierRefus: etat.dernierRefus,
        constats: etat.dernierConstats,
        rapport: etat.dernierRapport,
        raison: etat.raison ? String(etat.raison.message || etat.raison) : null,
      };
    },
    /** Charge le noyau sans attendre un export. */
    charger: charger,
    /** Contrôle le document courant, sans rien exporter. */
    verifier: verifier,
    /** Les constats que cette colle ne conduit pas. */
    nonConduits: NON_CONDUITS,
    /** Réinstalle l'enveloppe (utile quand le joint est posé après coup). */
    reprendre: reprendreLeBouton,
    /** Détache l'enveloppe : l'état d'avant, exactement. */
    retirer: function () {
      if (global.confirmExport && global.confirmExport.__spPrepresse) {
        global.confirmExport = global.confirmExport.__spPrepresseOriginal;
        return true;
      }
      return false;
    },
  };

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', demarrer);
    } else {
      demarrer();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
