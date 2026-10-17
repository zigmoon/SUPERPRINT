/* ══════════════════════════════════════════════════════════════════════════
   superprint-eps.js — window.SPEps, l'import PostScript par le noyau Rust.

   ## Le joint, et pourquoi il tient sans toucher à main.js

   `main.js` importe un EPS à travers un **module** à cinq fonctions, chargé à la
   demande par `_spEpsEnsureModule()` :

       function _spEpsEnsureModule() {
           if (window.SPEps) return Promise.resolve(window.SPEps);
           ... charge JS/sp-eps-import.js ...
       }

   ⚠️ **`if (window.SPEps)`** : si l'objet existe déjà, le module de 869 lignes
   n'est jamais chargé. C'est un vrai joint de conception, et c'est celui-ci qui
   est utilisé — sans modifier une ligne de `main.js`.

   ## Ce qui passe en Rust, et ce qui reste ici

   | Fonction | Où | Pourquoi |
   |---|---|---|
   | `detect` | **Rust** | reconnaître une signature est du calcul |
   | `extractPsText` | **Rust** | c'est le découpage DSC, fait dans l'analyse |
   | `parse` | **Rust** | l'interpréteur PostScript complet, borné et testé |
   | `importance` | **ici** | un score d'interface sur des données que Rust fournit |
   | `toFabricGroup` | **ici** | elle crée des objets Fabric : c'est du dessin dans le navigateur |

   ## Quand le module se charge

   Sur **intention**, jamais au démarrage : au premier `dragover` de fichier ou au
   premier contact avec le bouton d'import. Un utilisateur qui n'ouvre jamais de
   fichier PostScript ne télécharge donc **rien** — c'est ce que la mesure
   imposait, le module faisant 245 Ko contre 44 Ko pour le JavaScript qu'il
   remplace.

   Et si l'intention n'a pas suffi — un import lancé avant que le module ne soit
   prêt — `window.SPEps` n'existe pas encore, donc `main.js` charge son module
   JavaScript comme avant. Rien ne casse, et l'import suivant passe par Rust.
   ══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  /** Version de ce branchement (sert aussi de paramètre `?v=` dans `index.html`). */
  var VERSION = '20261011-v646-rust-eps';

  /** URL du module, relative à la page. */
  var URL_NOYAU = 'JS/superprint_eps.wasm';

  /** Code de `SP_ERR_TOO_SMALL` à la frontière. */
  var ERR_TOO_SMALL = -1000002;

  /** Épaisseur de trait par défaut, en points, quand l'EPS n'en donne pas. */
  var EPAISSEUR_DEFAUT = 1;

  var etat = {
    version: VERSION,
    /** Le module est chargé et prêt. */
    pret: false,
    /** Chargement en cours, pour ne pas le lancer deux fois. */
    chargement: null,
    raison: null,
    /** Ce qui a servi : `'rust'`, `'js'` ou `null` avant le premier import. */
    dernier: null,
    /**
     * Vrai si `sp-eps-import.js` avait déjà posé son `window.SPEps` quand le
     * noyau s'est chargé — donc si le PREMIER import de la session est passé par
     * JavaScript. Ce n'est pas une panne : c'est le repli prévu.
     */
    jsRemplace: false,
  };

  var dejaJournalise = false;
  function journal(message) {
    if (dejaJournalise) return;
    dejaJournalise = true;
    if (global.console && global.console.info) global.console.info('[SuperPrint·Rust] ' + message);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Chargement du module
  // ─────────────────────────────────────────────────────────────────────────

  function charger() {
    if (etat.pret) return Promise.resolve(true);
    if (etat.chargement) return etat.chargement;
    etat.chargement = fetch(URL_NOYAU)
      .then(function (reponse) {
        if (!reponse.ok) throw new Error('module introuvable (' + reponse.status + ')');
        return reponse.arrayBuffer();
      })
      .then(function (octets) {
        return WebAssembly.instantiate(octets, {});
      })
      .then(function (resultat) {
        // ⚠️ `WebAssembly.instantiate` sur des OCTETS rend `{ module, instance }`,
        // alors que sur un MODULE compilé il rend l'instance directement. Se
        // tromper donne `instance.exports === undefined`, donc « Cannot read
        // properties of undefined » — et le module paraîtrait cassé alors qu'il
        // est bon. On accepte les deux formes.
        var e = resultat && resultat.instance ? resultat.instance.exports : resultat.exports;
        // On vérifie ce dont on a besoin AVANT de se déclarer prêt : un module
        // sans ses deux exports serait pire qu'absent, parce que le premier
        // import échouerait au lieu de retomber sur le module JavaScript.
        if (
          !e ||
          typeof e.sp_eps_detect !== 'function' ||
          typeof e.sp_eps_analyse !== 'function' ||
          typeof e.sp_alloc !== 'function' ||
          typeof e.sp_free !== 'function' ||
          !(e.memory instanceof WebAssembly.Memory)
        ) {
          throw new Error('le module ne ressemble pas au noyau EPS');
        }
        etat.exports = e;
        etat.pret = true;
        etat.raison = null;
        installer();
        journal(
          'import PostScript branché sur le noyau Rust' +
            (etat.jsRemplace
              ? ' (le module JavaScript avait déjà été chargé : il sera remplacé au prochain import)'
              : ''),
        );
        return true;
      })
      .catch(function (erreur) {
        etat.raison = erreur;
        etat.chargement = null;
        journal(
          'import PostScript : module indisponible, le module JavaScript reste en place (' +
            (erreur && erreur.message ? erreur.message : erreur) +
            ')',
        );
        return false;
      });
    return etat.chargement;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Appel de la frontière
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Appelle une fonction à deux passes.
   *
   * ⚠️ Le succès rend le **nombre d'octets écrits**, pas zéro : un `!== 0` ici
   * ferait passer une réussite pour un échec. C'est une faute commise en
   * écrivant le contrôle de cette frontière, et elle est notée pour ne pas
   * revenir.
   */
  function deuxPasses(donnees, appel) {
    var e = etat.exports;
    var pSrc = e.sp_alloc(donnees.length || 1);
    if (!pSrc) throw new Error('allocation refusée');
    new Uint8Array(e.memory.buffer, pSrc, donnees.length).set(donnees);
    var pLen = e.sp_alloc(4);
    try {
      var code = appel(pSrc, donnees.length, 0, 0, pLen);
      if (code !== ERR_TOO_SMALL) {
        throw new Error('le module a accepté un tampon vide (code ' + code + ')');
      }
      var besoin = new Uint32Array(e.memory.buffer, pLen, 1)[0];
      var tampon = e.sp_alloc(besoin);
      try {
        var ecrit = appel(pSrc, donnees.length, tampon, besoin, pLen);
        if (ecrit < 0) throw new Error('analyse refusée (code ' + ecrit + ')');
        // La vue est construite APRÈS l'appel : `sp_alloc` peut avoir détaché le
        // tampon en agrandissant la mémoire du module.
        var vue = new Uint8Array(e.memory.buffer, tampon, besoin);
        return new TextDecoder('utf-8').decode(vue);
      } finally {
        e.sp_free(tampon, besoin);
      }
    } finally {
      e.sp_free(pLen, 4);
      e.sp_free(pSrc, donnees.length || 1);
    }
  }

  /** Le rapport complet de l'analyse, en texte. */
  function rapport(donnees, tolerance) {
    return deuxPasses(donnees, function (pSrc, len, dst, cap, pLen) {
      return etat.exports.sp_eps_analyse(pSrc, len, tolerance || 0.05, dst, cap, pLen);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Lecture du rapport
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Range le rapport en lignes indexées par étiquette.
   *
   * Le rapport est du texte : c'est plus gros qu'un format binaire, mais il se
   * relit à l'œil pendant la mise au point, et il évite d'inventer une ABI
   * supplémentaire pour transporter des tableaux de points.
   */
  function lire(texte) {
    var sortie = {
      entete: null,
      bbox: null,
      hires: null,
      superficie: null,
      dessinee: null,
      stats: null,
      erreur: null,
      inconnus: [],
      avertissements: [],
      dessins: [],
    };
    var lignes = texte.split('\n');
    for (var i = 0; i < lignes.length; i++) {
      var ligne = lignes[i];
      if (!ligne) continue;
      var c = ligne.split('\t');
      switch (c[0]) {
        case '!entete':
          sortie.entete = { version: c[1] || '', createur: c[2] || '', titre: c[3] || '', eps: c[4] === '1' };
          break;
        case '!bbox':
          sortie.bbox = c.length >= 5 ? [+c[1], +c[2], +c[3], +c[4]] : null;
          break;
        case '!hires':
          sortie.hires = c.length >= 5 ? [+c[1], +c[2], +c[3], +c[4]] : null;
          break;
        case '!superficie':
          sortie.superficie = [+c[1], +c[2]];
          break;
        case '!dessinee':
          sortie.dessinee = [+c[1], +c[2], +c[3], +c[4]];
          break;
        case '!stats':
          sortie.stats = {
            dessins: +c[1],
            sommets: +c[2],
            inconnus: +c[3],
            blocs: +c[4],
            pages: +c[5],
            objets: +c[6],
          };
          break;
        case '!inconnu':
          sortie.inconnus.push(c[1]);
          break;
        case '!avert':
          sortie.avertissements.push(c[1]);
          break;
        case '!erreur':
          sortie.erreur = c.slice(1).join('\t');
          break;
        case '!dessin':
          sortie.dessins.push({
            peinture: c[2],
            epaisseur: c[3] ? parseFloat(c[3]) : 0,
            espace: c[4],
            nombreComposantes: +c[5],
            composantes: c.slice(6, 6 + +c[5]).map(Number),
            nombreSousChemins: +c[6 + +c[5]],
            sousChemins: [],
          });
          break;
        case '!sous': {
          var dessin = sortie.dessins[+c[1]];
          if (!dessin) break;
          var nb = +c[3];
          var points = [];
          for (var k = 0; k < nb; k++) points.push([+c[4 + k * 2], +c[5 + k * 2]]);
          dessin.sousChemins.push(points);
          break;
        }
        default:
          break;
      }
    }
    return sortie;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Couleurs : les composantes du noyau vers le `#rrggbb` de Fabric
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * CMJN → RVB, **formule naïve**, comme `cmykToHex` du module du produit.
   *
   * ⚠️ Ce n'est pas `_spCmykConvert`. L'import EPS du produit emploie la formule
   * naïve, sans seuil neutre ni limite d'encre — c'est une incohérence du
   * produit, et la reproduire est ce qui garde l'aperçu identique. La couleur
   * d'un tracé importé n'est pas une donnée d'impression : elle sera reconvertie
   * par le pipeline colorimétrique au moment de l'export.
   */
  function cmjnVersHex(c, m, j, n) {
    var k = 1 - borne(n);
    return hex(
      Math.round(255 * (1 - borne(c)) * k),
      Math.round(255 * (1 - borne(m)) * k),
      Math.round(255 * (1 - borne(j)) * k),
    );
  }

  function borne(v) {
    if (!isFinite(v)) return 0;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function hex(r, g, b) {
    var deux = function (v) {
      var s = Math.max(0, Math.min(255, Math.round(v))).toString(16);
      return s.length < 2 ? '0' + s : s;
    };
    return '#' + deux(r) + deux(g) + deux(b);
  }

  /** La couleur d'un dessin, dans l'espace de Fabric. */
  function couleurDuDessin(dessin) {
    var v = dessin.composantes;
    switch (dessin.espace) {
      case 'rvb':
        return hex(v[0] * 255, v[1] * 255, v[2] * 255);
      case 'cmjn':
        return cmjnVersHex(v[0], v[1], v[2], v[3]);
      default:
        // Gris PostScript : 0 = noir, 1 = blanc, comme `grayToHex` du produit.
        return hex((1 - borne(v[0])) * 255, (1 - borne(v[0])) * 255, (1 - borne(v[0])) * 255);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Le passage du repère PostScript au repère Fabric
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Écrit un sous-chemin en commandes de Fabric.
   *
   * | | PostScript | Fabric |
   * |---|---|---|
   * | y | vers le **haut** | vers le **bas** |
   * | origine | bas-gauche de la boîte | haut-gauche de la boîte |
   *
   * donc `X = x - minX` et `Y = maxY - y`. C'est la transformation du produit,
   * appliquée une seule fois, ici.
   *
   * Les courbes sont déjà **aplaties** par le noyau, à la tolérance demandée :
   * le chemin ne contient donc que des segments droits. Ce n'est pas une perte —
   * à 0,05 point, l'écart est de 17 millièmes de millimètre — et cela supprime
   * une classe entière de fautes : aucun critère de platitude à contredire entre
   * deux implémentations.
   */
  function chemin(dessin, boite, echelle) {
    var parts = [];
    for (var i = 0; i < dessin.sousChemins.length; i++) {
      var points = dessin.sousChemins[i];
      if (points.length < 2) continue;
      for (var k = 0; k < points.length; k++) {
        var x = (points[k][0] - boite.minX) * echelle;
        var y = (boite.maxY - points[k][1]) * echelle;
        parts.push((k === 0 ? 'M' : 'L') + arrondi(x) + ' ' + arrondi(y));
      }
      // Fermer quand le premier et le dernier point coïncident : c'est
      // exactement ce que le noyau a écrit, et Fabric trace alors le contour
      // fermé plutôt que de laisser un côté ouvert.
      var premier = points[0];
      var dernier = points[points.length - 1];
      if (Math.abs(premier[0] - dernier[0]) < 1e-6 && Math.abs(premier[1] - dernier[1]) < 1e-6) {
        parts.push('Z');
      }
    }
    return parts.join(' ');
  }

  function arrondi(v) {
    return Math.round(v * 1000) / 1000;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  L'API `window.SPEps`
  // ─────────────────────────────────────────────────────────────────────────

  /** Les fonctions de calcul, servies par Rust. */
  function apiRust() {
    return {
      detect: function (octets) {
        var e = etat.exports;
        var donnees = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
        var p = e.sp_alloc(donnees.length || 1);
        if (!p) return 'inconnu';
        try {
          new Uint8Array(e.memory.buffer, p, donnees.length).set(donnees);
          var code = e.sp_eps_detect(p, donnees.length);
          // ⚠️ `main.js` compare `genre === 'pdf'` et `genre !== 'eps'` : c'est
          // ICI que l'entier de la frontière redevient la chaîne du produit, à
          // un seul endroit.
          return code === 1 ? 'eps' : code === 2 ? 'pdf' : code === 3 ? 'zip' : 'inconnu';
        } finally {
          e.sp_free(p, donnees.length || 1);
        }
      },

      parse: function (octets, tolerance) {
        var donnees = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
        return lire(rapport(donnees, tolerance));
      },
    };
  }

  /**
   * `importance` — le score d'utilité, calculé ici.
   *
   * C'est un score d'**interface** : sous 0,3, `main.js` prévient l'utilisateur
   * que l'import est partiel. Il dépend de ce que Rust fournit (nombre de
   * chemins, part d'opérateurs inconnus) mais il décide d'un message : il reste
   * donc du côté de l'interface, là où il est lu.
   */
  function importance(analyse) {
    if (!analyse || !analyse.stats) return 0;
    var n = analyse.stats.dessins;
    if (!n) return 0;
    var part = Math.min(1, n / 8);
    var inconnuPart = analyse.stats.inconnus / Math.max(1, analyse.stats.objets);
    var penalite = inconnuPart > 0.05 ? Math.min(0.5, inconnuPart * 5) : 0;
    return Math.max(0, Math.min(1, 0.25 + 0.75 * part - penalite));
  }

  /**
   * `toFabricGroup` — la seule fonction qui reste en JavaScript, et c'est sa
   * place : elle construit des objets Fabric, c'est-à-dire du dessin dans le
   * navigateur.
   */
  function toFabricGroup(analyse, fabricRef) {
    var F = fabricRef || global.fabric;
    if (!F) throw new Error('fabric absent');
    if (!analyse || !analyse.dessins || !analyse.dessins.length) return null;

    var boite = boiteDe(analyse);
    if (!boite) return null;
    var largeurPS = Math.max(1, boite.maxX - boite.minX);
    var hauteurPS = Math.max(1, boite.maxY - boite.minY);

    var objets = [];
    for (var i = 0; i < analyse.dessins.length; i++) {
      var dessin = analyse.dessins[i];
      var d = chemin(dessin, boite, 1);
      if (!d) continue;
      var couleur = couleurDuDessin(dessin);
      var rempli = dessin.peinture === 'fill' || dessin.peinture === 'eofill';
      var trace = dessin.peinture === 'stroke';
      // Un découpage n'est pas peint : le noyau l'enregistre, et l'ignorer ici
      // est le comportement du produit — qui ne le conservait pas du tout.
      if (!rempli && !trace) continue;
      var options = {
        fill: rempli ? couleur : null,
        stroke: trace ? couleur : null,
        strokeWidth: trace ? Math.max(0.1, dessin.epaisseur || EPAISSEUR_DEFAUT) : 0,
        strokeUniform: true,
        objectCaching: false,
      };
      if (rempli) options.fillRule = 'nonzero';
      try {
        objets.push(new F.Path(d, options));
      } catch (_) {
        /* sous-chemin que Fabric refuse : ignoré, comme le produit */
      }
    }
    if (!objets.length) return null;

    var groupe = null;
    try {
      groupe = objets.length === 1 ? objets[0] : F.util.groupSVGElements(objets, {});
    } catch (_) {
      try {
        groupe = new F.Group(objets);
      } catch (_) {
        groupe = objets[0];
      }
    }
    groupe.set({
      _spEpsImport: true,
      _spEpsRust: true,
      _spEpsPaths: objets.length,
      _spEpsBBoxPS: [boite.minX, boite.minY, boite.maxX, boite.maxY],
    });
    return { group: groupe, largeurPS: largeurPS, hauteurPS: hauteurPS, nbPaths: objets.length };
  }

  /** La boîte de référence : celle de l'en-tête si elle est valide, sinon celle qui est dessinée. */
  function boiteDe(analyse) {
    var b = analyse.bbox || analyse.hires;
    if (b && isFinite(b[0]) && isFinite(b[2]) && b[2] > b[0] && b[3] > b[1]) {
      return { minX: b[0], minY: b[1], maxX: b[2], maxY: b[3] };
    }
    var d = analyse.dessinee;
    if (d && isFinite(d[0]) && d[2] > d[0] && d[3] > d[1]) {
      return { minX: d[0], minY: d[1], maxX: d[2], maxY: d[3] };
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  L'objet exposé
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Pose `window.SPEps`.
   *
   * Appelée seulement quand le module est prêt : tant qu'il ne l'est pas,
   * `window.SPEps` reste **absent**, et `main.js` charge son propre module
   * JavaScript. C'est ce qui garantit qu'aucun import n'échoue — au pire, le
   * premier passe par JavaScript.
   *
   * ⚠️ **La course, et pourquoi elle est sans danger.**
   * `main.js` lit `if (window.SPEps)` au moment du dépôt. Si l'utilisateur lâche
   * son fichier plus vite que le noyau ne se charge (moins d'une seconde : les
   * 245 Ko viennent du cache local), `main.js` charge alors `sp-eps-import.js`,
   * qui pose **son** `window.SPEps`. Quand le noyau arrive à son tour, il
   * écrase cet objet.
   *
   * Écraser est sans danger, et c'est même le but :
   *  - le contrat est le même (les cinq fonctions rendues ici sont celles que
   *    `main.js` appelle, et la forme des objets est celle du module d'origine) ;
   *  - un import déjà commencé ne peut pas être cassé : `_spImportEpsFile` garde
   *    sa propre référence dans une fermeture, l'objet qu'il utilise ne change
   *    pas sous lui ;
   *  - ne pas écraser serait pire : le module JavaScript resterait en place pour
   *    toute la session, et le noyau Rust ne servirait jamais.
   * On note quand même le cas dans `etat.jsRemplace`, pour que le diagnostic
   * puisse dire quel moteur a réellement servi au premier import.
   */
  function installer() {
    var rust = apiRust();
    if (etat.pret && global.SPEps && global.SPEps._spEpsRust) return; // déjà posé
    etat.jsRemplace = !!(global.SPEps && !global.SPEps._spEpsRust);
    global.SPEps = {
      version: VERSION,
      MM_PER_PT: 25.4 / 72,
      /** Marque de fabrique : distingue cet objet de celui de `sp-eps-import.js`. */
      _spEpsRust: true,
      /** Vrai quand le calcul vient du noyau Rust. Pour les diagnostics. */
      get rust() {
        return etat.pret;
      },
      detect: function (octets) {
        etat.dernier = 'rust';
        return rust.detect(octets);
      },
      /**
       * Le producteur du produit rend le **texte** du programme PostScript.
       * Ici, le découpage DSC et l'interprétation se font dans le même appel :
       * cette fonction rend donc les octets, et `parse` accepte les deux formes.
       * C'est ce qui permet à `_spImportEpsFile` de continuer à écrire
       * `parse(extractPsText(bytes))` sans changement.
       */
      extractPsText: function (octets) {
        return octets;
      },
      parse: function (entree, tolerance) {
        etat.dernier = 'rust';
        var donnees =
          entree instanceof Uint8Array
            ? entree
            : typeof entree === 'string'
              ? new TextEncoder().encode(entree)
              : new Uint8Array(entree);
        var analyse = rust.parse(donnees, tolerance);
        // `main.js` lit `analyse.stats.chemins` : on garde les **deux** noms,
        // parce que le produit compte des « chemins » là où le noyau compte des
        // « dessins », et qu'un renommage silencieux casserait l'appelant.
        if (analyse.stats) {
          analyse.stats.chemins = analyse.stats.dessins;
          analyse.stats.fills = analyse.dessins.filter(function (d) {
            return d.peinture === 'fill' || d.peinture === 'eofill';
          }).length;
          analyse.stats.strokes = analyse.dessins.filter(function (d) {
            return d.peinture === 'stroke';
          }).length;
          analyse.stats.tokens = analyse.stats.objets;
          analyse.stats.nbInconnus = analyse.inconnus.length;
        }
        analyse.paths = analyse.dessins;
        analyse.warnings = analyse.avertissements;
        analyse.entete = analyse.entete || {};
        return analyse;
      },
      importance: importance,
      toFabricGroup: toFabricGroup,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Le chargement, sur intention
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Déclenche le chargement au premier signe que l'utilisateur va importer un
   * fichier : un survol de fichier ou un contact avec le bouton d'import.
   *
   * Le chargement prend quelques centaines de millisecondes, et un dépôt de
   * fichier en prend toujours plus — le glisser dure, le choix dans la boîte de
   * dialogue dure. L'avance est donc gagnée dans tous les cas réalistes.
   */
  function surIntention() {
    var declenche = false;
    var uneFois = function () {
      if (declenche) return;
      declenche = true;
      charger();
    };
    if (global.document) {
      global.document.addEventListener('dragover', uneFois, { once: true, passive: true });
      global.document.addEventListener('drop', uneFois, { once: true, passive: true });
      var bouton = global.document.getElementById('importEpsBtn');
      if (bouton) {
        bouton.addEventListener('pointerdown', uneFois, { once: true, passive: true });
        bouton.addEventListener('click', uneFois, { once: true, passive: true });
      }
      // Filet de sécurité : `main.js` peut aussi importer un EPS par le bouton
      // « Importer » du ruban, dont l'identifiant n'est pas connu ici.
      var ruban = global.document.getElementById('importBtn');
      if (ruban) ruban.addEventListener('pointerdown', uneFois, { once: true, passive: true });
    }
  }

  global.SuperPrintEps = {
    version: VERSION,
    get etat() {
      return {
        pret: etat.pret,
        dernier: etat.dernier,
        jsRemplace: etat.jsRemplace,
        raison: etat.raison ? String(etat.raison.message || etat.raison) : null,
      };
    },
    /** Force le chargement, sans attendre une intention. */
    charger: charger,
  };

  surIntention();
})(typeof globalThis !== 'undefined' ? globalThis : this);
