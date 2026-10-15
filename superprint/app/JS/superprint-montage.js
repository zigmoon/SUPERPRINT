/* ══════════════════════════════════════════════════════════════════════════
   superprint-montage.js — l'export PDF imposé par le noyau Rust.

   ## Le joint, et pourquoi il tient sans toucher à main.js

   Le bouton « Exporter PDF Imposé » de `index.html` (ligne 5334) fait :

       window._spGuardExport && window._spGuardExport(this, window.exportImposedPDF || exportImposedPDF)

   `window.exportImposedPDF` est posé par `main.js` (ligne 31752) : la porte
   d'entrée est donc **prioritaire** et remplaçable. Cette colle **l'enveloppe**
   au lieu de la remplacer : le noyau assemble la planche quand il est prêt, et
   l'export vectoriel du produit prend le relais dès que quelque chose manque —
   un mode, un document hors de son domaine, une panne, une exception.

   ## Ce qui passe en Rust, et ce qui reste ici

   | Étape | Où | Pourquoi |
   |---|---|---|
   | ordre d'impression | **Rust** | `superprint-impose`, mesuré contre `calculateImposition` |
   | pose, zone autorisée, repères | **Rust** | `superprint-impose` |
   | conversion des pixels, rognage, boîtes de page, PDF | **Rust** | `superprint-montage` |
   | rendu des deux pages | **ici** | Rust ne peut pas posséder un canevas Fabric |
   | lecture des réglages | **ici** | c'est le DOM |
   | repli | **ici** | l'exporteur vectoriel du produit, qui existe |

   ## Quand le noyau se charge

   Au démarrage de l'application, dans un temps mort. L'export imposé n'est pas
   un geste rare, et faire attendre l'utilisateur au premier clic pour charger
   406 Ko serait payer deux fois.

   ⚠️ **Ce chargement ne coûte rien de plus** : `SuperPrintCore.load()` met en
   cache **une seule instance par URL**, et `superprint-branchement.js` charge la
   même URL au démarrage. La colle du montage reçoit donc le moteur qui est déjà
   là, et le partage est mesuré (`scripts/validate-web.mjs`). Deux instances
   auraient signifié deux mémoires linéaires et deux jeux d'état — `sp_doc_*` et
   `sp_montage_*` — qui ne se voient pas.

   ## Les limites, écrites ici pour ne pas être découvertes

   - **la planche est en image.** Le texte de la planche n'est pas du texte
     sélectionnable : l'export du produit, lui, le garde vectoriel (jsPDF +
     svg2pdf). C'est le prix de l'assemblage par le noyau, et il est dit. En
     revanche le noyau écrit un vrai **PDF/X-1a en CMJN** avec `OutputIntent`,
     profil ICC embarqué et rognage porté par le flux — ce que l'export du
     produit ne fait pas ;
   - **les tons directs ne sont pas portés** sur une planche : une encre directe
     serait une plaque sans nom. Un document qui en contient repasse donc par le
     produit ;
   - **les masques d'image** (`_isImageMask`) sont reposés par `main.js` au
     chargement, par une fonction privée (`restoreImageMasksForCanvas`) : la
     colle ne les reconstruit pas, donc un document qui en contient repasse par
     le produit ;
   - **le sous-ensemble des réglages** est celui du produit, à l'identique : la
     colle lit les mêmes identifiants d'éléments que `main.js`, et
     `scripts/validate-montage-branchement.mjs` **extrait ces identifiants de
     `main.js`** pour vérifier qu'aucun n'a bougé.
   ══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  /** Version de ce branchement (sert aussi de paramètre `?v=` dans `index.html`). */
  var VERSION = '20261012-v628-rust-montage';

  /** URL du noyau, relative à la page. Le même fichier que le branchement. */
  var URL_NOYAU = 'JS/superprint_core.wasm';

  /**
   * Les paliers de qualité, en multiples de 72 dpi.
   *
   * ⚠️ **Recopiés de `main.js`** (`getQualityMultiplier`), et comparés par
   * `scripts/validate-montage-branchement.mjs`, qui relit la table dans
   * `main.js` : une valeur qui bouge là-bas et pas ici fait échouer le contrôle.
   * La fonction est privée à l'IIFE de `main.js`, il n'y a donc pas d'autre
   * moyen de l'atteindre — mais le contrôle, lui, est possible.
   */
  var QUALITES = { standard: 1, medium: 2.78, hd: 4.17, ultrahd: 8.33 };
  var QUALITE_DEFAUT = 2.78;

  /**
   * Ce qui n'est pas à imprimer sur une planche imposée.
   *
   * ⚠️ Recopié de `buildImposedSheetCanvas` (`main.js`), et **vérifié** là-bas
   * par le contrôle : les repères de marge et de fond perdu, les guides, les
   * miroirs de double page, les badges de chaînage, et les objets qu'une double
   * page a **dupliqués** dans les deux pages (`_isOverflowFromLeft/Right`) —
   * ceux-là appartiennent à la page voisine, et les garder dessinerait par-dessus
   * elle.
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

  /** Un trait de sélection ou de chaînage laissé dans le document, à retirer. */
  var TRAITS_PARASITES = ['0D99FF', '0d99ff', 'rgba(13,153,255', 'rgba(13, 153, 255'];

  var etat = {
    version: VERSION,
    /** Le noyau est chargé et prêt. */
    pret: false,
    /** Chargement en cours, pour ne pas le lancer deux fois. */
    chargement: null,
    raison: null,
    /** Ce qui a servi au dernier export : `'rust'` ou `'js'`. */
    dernier: null,
    /** Le dernier compte rendu du noyau, tel quel. */
    rapport: null,
  };

  var dejaJournalise = false;
  function journaliser(message) {
    if (dejaJournalise) return;
    dejaJournalise = true;
    if (global.console && global.console.info) global.console.info('[SuperPrint·Rust] ' + message);
  }

  /** Une panne du chemin Rust ne se raconte qu'une fois, elle aussi. */
  var dejaSignale = false;

  // ─────────────────────────────────────────────────────────────────────────
  //  Chargement du noyau
  // ─────────────────────────────────────────────────────────────────────────

  function charger() {
    if (etat.pret) return Promise.resolve(etat.noyau);
    if (etat.chargement) return etat.chargement;
    if (!global.SuperPrintCore || typeof global.SuperPrintCore.load !== 'function') {
      etat.raison = new Error('colle absente (JS/superprint-core.js non chargée)');
      etat.chargement = Promise.resolve(null);
      return etat.chargement;
    }
    etat.chargement = global.SuperPrintCore
      .load({ url: URL_NOYAU })
      .then(function (moteur) {
        if (!moteur || moteur.backend !== 'wasm') {
          // Le repli JavaScript de la colle ne sait pas écrire un PDF — et c'est
          // volontaire : on ne réécrit pas un assembleur PDF par-dessus le
          // marché. Sans noyau, l'export du produit reste en place.
          etat.raison = new Error('module WebAssembly indisponible');
          return null;
        }
        etat.noyau = moteur;
        etat.pret = true;
        etat.raison = null;
        journaliser(
          'export imposé branché sur le noyau Rust (noyau ' +
            moteur.version +
            ', ' +
            Math.round((moteur.byteLength || 0) / 1024) +
            ' Ko)',
        );
        return moteur;
      })
      .catch(function (erreur) {
        etat.raison = erreur;
        etat.chargement = null;
        journaliser(
          'export imposé : noyau indisponible, l’export du produit reste en place (' +
            (erreur && erreur.message ? erreur.message : erreur) +
            ')',
        );
        return null;
      });
    return etat.chargement;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Lecture des réglages — les mêmes éléments que main.js
  // ─────────────────────────────────────────────────────────────────────────

  /** La valeur d'un groupe de boutons radio, ou `null` si le groupe est absent. */
  function radio(nom) {
    var el = global.document && global.document.querySelector
      ? global.document.querySelector('input[name="' + nom + '"]:checked')
      : null;
    return el ? el.value : null;
  }

  /** La valeur d'un champ, ou `null`. */
  function champ(id) {
    var el = global.document && global.document.getElementById ? global.document.getElementById(id) : null;
    return el && el.value !== undefined && el.value !== '' ? el.value : null;
  }

  /**
   * L'état d'une case à cocher : `true`, `false`, ou `null` si elle n'existe pas.
   *
   * ⚠️ Le `null` compte : `main.js` écrit `?.checked === true` pour l'une
   * (« opt-in strict ») et `?.checked !== false` pour l'autre (cochée par
   * défaut). Écraser les deux en `false` changerait le sens d'une case absente,
   * et c'est exactement le défaut corrigé dans `main.js` en v1.7.285.
   */
  function coche(id) {
    var el = global.document && global.document.getElementById ? global.document.getElementById(id) : null;
    if (!el || el.checked === undefined) return null;
    return !!el.checked;
  }

  /** Ce que le modal d'imposition demande, tel que `main.js` le lit. */
  function lireReglages() {
    var qualite = radio('imposedQuality') || 'medium';
    var mode = radio('imposedColorMode') || radio('colorMode') || 'rgb';
    return {
      qualite: qualite,
      multiplier: Object.prototype.hasOwnProperty.call(QUALITES, qualite)
        ? QUALITES[qualite]
        : QUALITE_DEFAUT,
      mode: mode,
      inclureFondPerdu: coche('imposedIncludeBleed') === true,
      reperesDeCoupe: coche('imposedCropMarks') !== false,
      decoupePageAPage: coche('imposedCutApart') === true,
      profilIcc: champ('imposedCmykIccProfile') || champ('cmykIccProfile') || 'CoatedFOGRA39',
    };
  }

  /** Le mode de couleur du noyau, à partir de celui du produit. */
  function modeNoyau(mode) {
    if (mode === 'cmyk') return 'cmjn';
    if (mode === 'bw') return 'gris';
    return 'rvb';
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Le domaine : ce que la colle accepte de faire, et ce qu'elle refuse
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Le document est-il dans le domaine de la colle ?
   *
   * Renvoie `null` si oui, sinon la **raison** du refus, en clair — c'est elle
   * que la console dit avant que l'export du produit ne prenne le relais.
   *
   * Le refus est un choix, pas une panne : le noyau ne porte pas les tons
   * directs sur une planche, et la colle ne repose pas les masques d'image. Dans
   * ces deux cas l'export du produit fait **mieux**, donc c'est lui qui doit le
   * faire.
   */
  function refus(projet, reglages) {
    if (!projet || !projet.pages || !projet.pages.length) return 'aucun document';
    if (reglages.mode === 'cmyk' && reglages.profilIcc === '__custom__') {
      // Le profil personnalisé est gardé en mémoire par `main.js`, dans un cache
      // privé : la colle ne peut pas en lire les octets, donc elle ne peut pas
      // écrire un PDF/X-1a honnête. L'export du produit, lui, le fait.
      return 'profil ICC personnalisé (illisible depuis le branchement)';
    }
    var encres = projet.resources && projet.resources.spotInks;
    if (encres && Object.keys(encres).length) {
      return Object.keys(encres).length + ' encre(s) directe(s) : la planche du noyau ne les porte pas';
    }
    for (var i = 0; i < projet.pages.length; i += 1) {
      var objets = projet.pages[i].objects || [];
      for (var j = 0; j < objets.length; j += 1) {
        if (objets[j] && objets[j]._isImageMask) {
          return 'masque d’image (reposé par main.js, pas par ce branchement)';
        }
      }
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Le rendu d'une page
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * La géométrie d'une cellule de planche, en pixels de référence (72 dpi).
   *
   * ⚠️ `mmToPx = mm × 72 / 25,4` : à 72 dpi, **1 pixel vaut 1 point PostScript**.
   * C'est la raison pour laquelle le plan du noyau tombe exactement sur celui du
   * produit, et pas seulement à un pixel près.
   */
  function cellule(reglages, formatPage) {
    var mmToPx = function (mm) {
      return (mm * 72) / 25.4;
    };
    var bleedPx = mmToPx(reglages.fondPerduMm);
    var marge = reglages.inclureFondPerdu ? bleedPx : 0;
    return {
      largeur: Math.round(mmToPx(formatPage.width) + 2 * marge),
      hauteur: Math.round(mmToPx(formatPage.height) + 2 * marge),
      // Le décalage est celui de `buildImposedSheetCanvas` : `exportBleedPx - bleedPx`,
      // soit 0 quand le fond perdu est inclus, et −bleedPx quand il ne l'est pas
      // (la cellule se réduit alors au format fini).
      decalage: marge - bleedPx,
    };
  }

  /** Un objet Fabric est-il une décoration à ne pas imprimer ? */
  function horsImpression(objet) {
    for (var i = 0; i < NON_IMPRIMABLES.length; i += 1) {
      if (objet[NON_IMPRIMABLES[i]]) return true;
    }
    return false;
  }

  /** Retire les traits de sélection et de chaînage restés dans le document. */
  function nettoyerTrait(objet) {
    var trait = objet.stroke;
    var parasite = objet.type === 'image' || trait == null;
    if (!parasite && typeof trait === 'string') {
      for (var i = 0; i < TRAITS_PARASITES.length; i += 1) {
        if (trait.indexOf(TRAITS_PARASITES[i]) !== -1) {
          parasite = true;
          break;
        }
      }
    }
    if (!parasite) return;
    try {
      objet.set({ stroke: null, strokeWidth: 0, strokeDashArray: null });
    } catch (_) {
      objet.stroke = null;
      objet.strokeWidth = 0;
    }
  }

  /**
   * Rend **une page** dans un canevas Fabric, à la résolution demandée.
   *
   * La page est rendue **seule**, dans une cellule à sa taille : le noyau pose
   * ensuite chaque cellule à sa place et rogne à la zone autorisée. C'est ce
   * rognage — une opération du flux PDF — qui remplace le `clipPath` par objet
   * du produit : les deux disent la même règle, « format fini élargi du fond
   * perdu imprimé, sauf à la couture quand les pages ne sont pas coupées ».
   */
  function rendrePage(numero, contexte) {
    if (numero == null) return Promise.resolve(null);
    var page = contexte.projet.pages[numero - 1];
    if (!page || !page.objects || !page.objects.length) {
      // Une page vide se rend comme un blanc : c'est un cas légitime d'une
      // planche (le dos d'une couverture), pas une erreur.
      return Promise.resolve(blanc(contexte));
    }
    var cell = contexte.cellule;
    var el = global.document.createElement('canvas');
    var toile = new global.fabric.Canvas(el, {
      width: cell.largeur,
      height: cell.hauteur,
      selection: false,
      skipTargetFind: true,
      renderOnAddRemove: false,
    });
    return new Promise(function (resoudre) {
      toile.loadFromJSON({ objects: page.objects }, function () {
        // 1. Ce qui n'est pas à imprimer.
        toile
          .getObjects()
          .slice()
          .forEach(function (objet) {
            if (horsImpression(objet)) toile.remove(objet);
          });
        // 2. Les blocs texte : `initDimensions` a pu étendre la hauteur au
        //    chargement. `spLockTextboxDimensions` est la fonction du produit
        //    qui refait la mise en page sur les dimensions fixes — publique, et
        //    donc appelée plutôt que recopiée.
        toile.getObjects().forEach(function (objet) {
          if (typeof global.spLockTextboxDimensions === 'function') {
            global.spLockTextboxDimensions(objet);
          }
          nettoyerTrait(objet);
          if (typeof objet.left === 'number') objet.left = Math.round(objet.left + cell.decalage);
          if (typeof objet.top === 'number') objet.top = Math.round(objet.top + cell.decalage);
          objet.setCoords();
          objet.hasBorders = false;
          objet.hasControls = false;
        });
        // 3. Les gabarits de page : le produit les injecte pour l'imposition en
        //    RVB et en niveaux de gris, et garde son chemin CMJN. Même règle.
        var suivant = function () {
          toile.renderAll();
          resoudre(toile);
        };
        if (
          contexte.mode !== 'cmjn' &&
          typeof global.injectMasterItemsForExport === 'function'
        ) {
          Promise.resolve(global.injectMasterItemsForExport(toile, numero - 1, { includeBleed: true }))
            .then(suivant)
            .catch(suivant);
          return;
        }
        suivant();
      });
    }).then(function (rendu) {
      var url = rendu.toDataURL({ format: 'png', multiplier: contexte.multiplier });
      try {
        rendu.dispose();
      } catch (_) {}
      try {
        el.width = 0;
        el.height = 0;
      } catch (_) {}
      return dataUrlVersRgb(url, contexte.opaque);
    });
  }

  /** Une page blanche, à la taille de la cellule et à la résolution demandée. */
  function blanc(contexte) {
    return {
      width: Math.round(contexte.cellule.largeur * contexte.multiplier),
      height: Math.round(contexte.cellule.hauteur * contexte.multiplier),
      pixels: new Uint8Array(
        Math.round(contexte.cellule.largeur * contexte.multiplier) *
          Math.round(contexte.cellule.hauteur * contexte.multiplier) *
          3,
      ).fill(255),
    };
  }

  /**
   * Les pixels RVB d'une image PNG, son **alpha composé sur blanc**.
   *
   * Le noyau veut trois octets par pixel : une zone transparente à moitié
   * donnerait sinon sa couleur brute, et un pixel entièrement transparent donne
   * `0,0,0` — donc du noir à l'impression, là où le produit, lui, peint du blanc.
   * Composer ici, avant de retirer le canal alpha, est la seule façon de ne pas
   * transformer une transparence en noir.
   */
  function dataUrlVersRgb(url, opaque) {
    return new Promise(function (resoudre, rejeter) {
      var image = new global.Image();
      image.onload = function () {
        var el = global.document.createElement('canvas');
        el.width = image.width;
        el.height = image.height;
        var ctx = el.getContext('2d');
        if (opaque) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, el.width, el.height);
        }
        ctx.drawImage(image, 0, 0);
        var donnees = ctx.getImageData(0, 0, el.width, el.height).data;
        var rgb = new Uint8Array(el.width * el.height * 3);
        for (var i = 0, j = 0; i < donnees.length; i += 4, j += 3) {
          rgb[j] = donnees[i];
          rgb[j + 1] = donnees[i + 1];
          rgb[j + 2] = donnees[i + 2];
        }
        el.width = 0;
        el.height = 0;
        resoudre({ pixels: rgb, width: image.width, height: image.height });
      };
      image.onerror = function () {
        rejeter(new Error('le rendu de la page n’a pas pu être relu'));
      };
      image.src = url;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Le profil de sortie
  // ─────────────────────────────────────────────────────────────────────────

  /** Les octets d'un profil ICC du produit, ou `null` s'il est introuvable. */
  function chargerProfil(nom) {
    if (!nom || nom === '__custom__') return Promise.resolve(null);
    return global
      .fetch('icc/' + nom + '.icc')
      .then(function (reponse) {
        if (!reponse.ok) return null;
        return reponse.arrayBuffer();
      })
      .then(function (octets) {
        return octets ? new Uint8Array(octets) : null;
      })
      .catch(function () {
        return null;
      });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  L'export
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Assemble la planche imposée par le noyau, et la télécharge.
   *
   * `projet` vient de `window.saveProjectSP_toObject()` — la même source que
   * l'export du produit, donc les mêmes objets, page par page.
   */
  function exporter(projet) {
    var reglages = lireReglages();
    var noyau = etat.noyau;
    var format = projet.document.format;
    var fondPerdu = Number(projet.document.bleed);
    if (!isFinite(fondPerdu) || fondPerdu < 0) fondPerdu = 0;
    reglages.fondPerduMm = fondPerdu;

    var opaque = typeof global.spExportPaintOpaqueBackground !== 'function'
      ? true
      : global.spExportPaintOpaqueBackground() !== false;
    var mode = modeNoyau(reglages.mode);
    var cell = cellule(reglages, format);
    var contexte = {
      projet: projet,
      reglages: reglages,
      cellule: cell,
      multiplier: reglages.multiplier,
      mode: mode,
      opaque: opaque,
    };

    var nombre = projet.meta && projet.meta.stats ? projet.meta.stats.pages : projet.pages.length;
    // L'ordre d'impression est celui du noyau, pas celui du produit : il est
    // mesuré contre `calculateImposition` (scripts/validate-imposition.mjs).
    var ordre = noyau.orderPages(nombre);
    if (!ordre.length) throw new Error('aucune planche à imposer');
    var faces = Math.ceil(ordre.length / 2);

    var barre = progression(ordre.length / 2);
    return chargerProfil(mode === 'cmjn' ? reglages.profilIcc : null).then(function (profil) {
      var options = {
        largeurPageMm: format.width,
        hauteurPageMm: format.height,
        fondPerduMm: fondPerdu,
        inclureFondPerdu: reglages.inclureFondPerdu,
        decoupePageAPage: reglages.decoupePageAPage,
        reperesDeCoupe: reglages.reperesDeCoupe,
        mode: mode,
        fondBlanc: opaque,
        filtre: 'auto',
        info: {
          title: (projet.meta && projet.meta.title) || '',
          creator: 'SuperPrint',
        },
      };
      if (mode === 'cmjn' && profil) {
        // PDF/X-1a **seulement** en CMJN, et seulement avec un profil : le noyau
        // refuse de revendiquer une conformité sans dire pour quelle condition
        // d'impression, et PDF/X-1a interdit le RVB dans le flux.
        options.icc = profil;
        options.sortie = {
          composantes: 4,
          identifiant: reglages.profilIcc,
          description: reglages.profilIcc + ' (profil du produit)',
          conformite: 'pdfx-1a',
        };
      } else if (mode === 'cmjn') {
        options.sortie = { composantes: 4, identifiant: '', description: '', conformite: '' };
      }

      var planche = noyau.ouvrirPlanche(options);
      var chaine = Promise.resolve();
      for (var i = 0; i < ordre.length; i += 2) {
        (function (rang, numeroGauche, numeroDroite) {
          chaine = chaine.then(function () {
            barre(rang + 1);
            return Promise.all([
              rendrePage(numeroGauche, contexte),
              rendrePage(numeroDroite, contexte),
            ]).then(function (rendus) {
              planche.face({
                places: [numeroGauche, numeroDroite],
                rendus: [rendus[0], rendus[1]],
              });
            });
          });
        })(i / 2, ordre[i], ordre[i + 1]);
      }

      return chaine.then(function () {
        var resultat = planche.ecrire();
        etat.rapport = resultat.rapport;
        etat.dernier = 'rust';
        return resultat.pdf;
      });
    }).then(function (pdf) {
      telecharger(pdf, nomDuFichier(reglages));
      return { backend: 'rust', faces: faces, rapport: etat.rapport };
    }).finally(function () {
      barre.fin();
    });
  }

  /**
   * Le nom du fichier, **au caractère près** celui du produit.
   *
   * ⚠️ Recopié de `exportImposedPDF` et vérifié par
   * `scripts/validate-montage-branchement.mjs`, qui relit la ligne dans
   * `main.js` : deux noms différents pour le même export feraient douter de ce
   * qui a produit le fichier.
   */
  function nomDuFichier(reglages) {
    var etiquette = reglages.mode === 'cmyk' ? 'cmyk' : reglages.mode === 'bw' ? 'bw' : 'rgb';
    var maintenant = new Date();
    var date = maintenant
      .toISOString()
      .slice(0, 16)
      .replace(/[-:]/g, '')
      .replace('T', '-');
    return 'superprint-imposed-' + etiquette + '-' + date + '.pdf';
  }

  /** Déclenche le téléchargement, comme le fait `jsPDF.save()`. */
  function telecharger(octets, nom) {
    var blob = new global.Blob([octets], { type: 'application/pdf' });
    var url = global.URL.createObjectURL(blob);
    var lien = global.document.createElement('a');
    lien.href = url;
    lien.download = nom;
    global.document.body.appendChild(lien);
    lien.click();
    global.document.body.removeChild(lien);
    global.setTimeout(function () {
      global.URL.revokeObjectURL(url);
    }, 0);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Le témoin d'avancement
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Un témoin minimal, créé par ce fichier et retiré à la fin.
   *
   * Le produit a le sien (`_spCreatePdfLoader`), privé à son IIFE : la colle ne
   * peut pas l'emprunter. Un export imposé prend plusieurs secondes, donc un
   * témoin est nécessaire — mais il est **à nous**, et il disparaît avec la
   * dernière ligne du fichier.
   */
  function progression(total) {
    var el = global.document.createElement('div');
    el.setAttribute('data-sp-montage', 'attente');
    el.style.cssText =
      'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483000;' +
      'background:#1a1a1a;color:#fff;font:500 12px/1.5 system-ui,sans-serif;' +
      'padding:8px 14px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.28)';
    el.textContent = 'Imposition (noyau Rust)…';
    try {
      global.document.body.appendChild(el);
    } catch (_) {}
    var texter = function (nombre) {
      el.textContent = 'Imposition (noyau Rust)… ' + nombre + '/' + total;
    };
    texter(0);
    return Object.assign(texter, {
      fin: function () {
        try {
          el.remove();
        } catch (_) {}
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  La reprise du bouton
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Enveloppe `window.exportImposedPDF` : le noyau d'abord, le produit ensuite.
   *
   * Rien n'est substitué : l'export du produit est **gardé** et appelé dans tous
   * les cas où le noyau n'est pas la bonne réponse. Retirer la ligne `<script>`
   * de `index.html` remet exactement l'état d'avant.
   */
  function reprendreLeBouton() {
    var original = global.exportImposedPDF;
    if (typeof original !== 'function' || original.__spMontage) return false;
    var remplacant = function () {
      var args = arguments;
      var contexte = this;
      if (!etat.pret) {
        // Le noyau n'est pas encore là : l'export du produit fait le travail, et
        // le chargement continue pour la fois suivante. Aucun clic n'est perdu.
        journaliser('export imposé : noyau pas encore prêt, export du produit');
        return original.apply(contexte, args);
      }
      var projet = null;
      try {
        projet = global.saveProjectSP_toObject();
      } catch (erreur) {
        projet = null;
      }
      var raison = projet ? refus(projet, lireReglages()) : 'document illisible';
      if (raison) {
        journaliser('export imposé : ' + raison + ' — export du produit');
        return original.apply(contexte, args);
      }
      if (typeof global.closeImpositionModal === 'function') {
        try {
          global.closeImpositionModal();
        } catch (_) {}
      }
      // Une image peinte avant le premier rendu : sans elle, le témoin
      // n'apparaîtrait qu'à la fin du premier tour de boucle.
      return new Promise(function (resoudre) {
        global.setTimeout(resoudre, 30);
      })
        .then(function () {
          return exporter(projet);
        })
        .then(function (resultat) {
          journaliser(
            'export imposé : planche assemblée par le noyau — ' +
              resultat.faces +
              ' face(s), ' +
              (resultat.rapport ? resultat.rapport.octets : '?') +
              ' octets, mode ' +
              (resultat.rapport ? resultat.rapport.mode : '?') +
              ', conformité ' +
              (resultat.rapport ? resultat.rapport.conformite : '?'),
          );
          return resultat;
        })
        .catch(function (erreur) {
          // Toute panne du chemin Rust ramène au chemin du produit : l'utilisateur
          // ne se retrouve jamais sans export, et la console dit pourquoi — une
          // fois, pour ne pas remplir la console à chaque clic.
          etat.dernier = 'js';
          var motif = erreur && erreur.message ? erreur.message : String(erreur);
          if (etat.rapport && etat.rapport.erreur) motif = etat.rapport.erreur;
          if (!dejaSignale) {
            dejaSignale = true;
            if (global.console && global.console.warn) {
              global.console.warn(
                '[SuperPrint·Rust] export imposé : le noyau a échoué (' + motif + '), export du produit',
              );
            }
          }
          return original.apply(contexte, args);
        });
    };
    remplacant.__spMontage = true;
    remplacant.__spMontageOriginal = original;
    global.exportImposedPDF = remplacant;
    return true;
  }

  function demarrer() {
    reprendreLeBouton();
    // Chargement du noyau dans un temps mort : l'export imposé n'est pas rare,
    // et le noyau est de toute façon chargé au démarrage par le branchement.
    var planifier =
      global.requestIdleCallback ||
      function (action) {
        return global.setTimeout(action, 1200);
      };
    planifier(function () {
      charger();
    });
  }

  global.SPMontage = {
    version: VERSION,
    etat: etat,
    charger: charger,
    /**
     * L'export imposé, **sans passer par le bouton** : la fonction lit le
     * document elle-même (`saveProjectSP_toObject`), vérifie qu'il est dans le
     * domaine de la colle, et assemble la planche.
     *
     * Elle **lève** au lieu de retomber sur l'export du produit : c'est
     * l'enveloppe du bouton qui décide du repli, et un appelant qui demande
     * explicitement le noyau doit savoir quand il n'a pas pu l'avoir.
     */
    exporter: function () {
      var projet = global.saveProjectSP_toObject();
      var raison = refus(projet, lireReglages());
      if (raison) throw new Error(raison);
      return exporter(projet);
    },
    reprendre: reprendreLeBouton,
    /** Les constantes recopiées de `main.js` : le contrôle les relit là-bas. */
    constantes: {
      qualites: QUALITES,
      qualiteDefaut: QUALITE_DEFAUT,
      nonImprimables: NON_IMPRIMABLES,
      traitsParasites: TRAITS_PARASITES,
    },
    /** Le refus, exposé pour être éprouvé sans cliquer. */
    refus: refus,
    /** Les réglages lus, exposés pour la même raison. */
    lireReglages: lireReglages,
    /** Détache l'enveloppe : l'état d'avant, exactement. */
    retirer: function () {
      if (global.exportImposedPDF && global.exportImposedPDF.__spMontage) {
        global.exportImposedPDF = global.exportImposedPDF.__spMontageOriginal;
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
