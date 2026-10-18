/*!
 * superprint-branchement.js — branche le noyau Rust/WebAssembly sur
 * l'application, **composant par composant**.
 *
 * Ce fichier est un AJOUT : il ne modifie rien de l'application. Il pose une
 * seule chose dans l'espace global — `window.hyphenators` — que `main.js`
 * consulte **déjà**, avant son propre moteur :
 *
 * ```js
 * // main.js, ligne 5201 et ligne 11462
 * if (window.hyphenators && window.hyphenators[lang]) return window.hyphenators[lang];
 * ```
 *
 * C'est le point de branchement le plus propre possible : tout le reste du
 * traitement typographique français (bornes, groupes insécables, digraphes,
 * tirets conditionnels) reste dans `main.js`, intact.
 *
 * ## Les composants branchés
 *
 * | Composant | Ce qui est remplacé | Mesure |
 * |---|---|---|
 * | **Césure** | `window.hyphenators[lang]` — le point d'accroche du produit | identique à `Hypher`, 5 langues |
 * | **Imposition** | offerte : `calculateImposition` n'est pas exposée par `main.js` | ordre, feuille et traits de coupe identiques |
 * | **Réduction d'image** | offerte : réduire correctement, à la place de `drawImage` | motif préservé là où l'échantillonnage le perd |
 * | **Prépresse** | offert : le produit n'a aucun contrôle avant impression | chaque défaut détecté, et silence sur un document sain |
 *
 * ### La règle du branchement
 *
 * **Ajouter, jamais modifier.** Or les fonctions d'imposition de `main.js`
 * (`calculateImposition`, `renderImposedSheet`, `buildImposedSheetCanvas`) sont
 * **privées à son IIFE** : rien ne les expose sur `window`, donc rien ne peut les
 * remplacer sans toucher au fichier.
 *
 * Plutôt que de forcer, ces trois composants sont **offerts** ici, mesurés, et
 * prêts. Voir `docs/PORTAGE.md`, section F, pour la ligne exacte à changer le
 * jour où l'utilisateur décidera de les brancher pour de bon.
 *
 * ## Ce que la mesure a appris sur la réduction d'image
 *
 * La vitesse n'est **pas** le point : sur six millions de pixels, le noyau Rust
 * et une boucle JavaScript équivalente mettent le même temps (0,99×) — la copie
 * des 18 Mo dans la mémoire du module annule le gain du calcul.
 *
 * Ce que le noyau apporte, c'est la **méthode**. Sur une image où une colonne
 * sur huit est blanche, réduite huit fois :
 *
 * | Méthode | Résultat | Vérité |
 * |---|---|---|
 * | moyenne de surface (noyau) | **32** | 32 |
 * | interpolation bilinéaire (aussi `drawImage`) | **0** | 32 |
 *
 * Le motif blanc a **disparu** par échantillonnage. Ce n'est pas une nuance de
 * netteté, c'est une couleur qui n'existe pas dans l'image.
 *
 * ## Premier composant : la CÉSURE
 *
 * Le dictionnaire de césure est celui du produit (`JS/hyphenation-*.js`), lu
 * **tel quel**. Le noyau Rust construit le même arbre de motifs et rend les
 * mêmes fragments — la parité est mesurée par
 * `superprint_rust/scripts/validate-branchement.mjs` sur 2 433 mots réels.
 *
 * ## ⚠️ Ce que la césure a appris : elle est PLUS LENTE
 *
 * Mesuré dans le navigateur, sur cette page, 288 000 appels à `hyphenate` sur
 * un même paragraphe de 72 mots :
 *
 * | | |
 * |---|---|
 * | `Hypher` (avant) | 344 ms |
 * | branché sur le noyau Rust | **856 ms** — 2,49× plus lent |
 *
 * La raison est nette : traverser la frontière WebAssembly — sérialiser le mot,
 * allouer, appeler, relire — coûte plus cher que le calcul qu'on remplace. Le
 * trie JavaScript d'`Hypher` est déjà rapide.
 *
 * Ce n'est pas une raison de retirer le branchement, c'en est une de savoir
 * pourquoi il est là : il **unifie le moteur** en Rust, et il se désactive en
 * une ligne (`SuperPrintBranchement.desactiver()`). Le gain viendra des
 * composants qui traitent **de gros volumes en un seul appel** — une image, une
 * compression, une planche, une vérification — jamais de ceux qu'on appelle
 * des milliers de fois sur de petites données. Voir `docs/PORTAGE.md`,
 * section F.
 *
 * ## Pourquoi rien ne peut se casser
 *
 * 1. **Délégation immédiate.** Dès le chargement, `window.hyphenators` est posé
 *    avec des moteurs qui délèguent au `Hypher` du produit. L'application ne
 *    connaît donc aucune fenêtre où la césure serait absente.
 * 2. **Bascule, jamais substitution.** Quand le noyau est prêt, chaque moteur
 *    bascule sur Rust. Si le noyau échoue, la bascule n'a pas lieu : le
 *    comportement reste **exactement** celui d'avant.
 * 3. **Retour en arrière d'une ligne.** `SuperPrintBranchement.desactiver()`
 *    repasse tout sur `Hypher`, et `delete window.hyphenators` rend la main au
 *    moteur interne de `main.js`.
 * 4. **La forme rendue ne change pas.** Un tableau de fragments dont la
 *    concaténation redonne le mot — c'est ce que `Hypher.hyphenate` rend, et
 *    c'est ce que le noyau rend.
 *
 * Licence : propriétaire, tous droits réservés — voir ../LICENSE.
 */

(function (global) {
  'use strict';

  /** Version de ce branchement (sert aussi de paramètre `?v=` dans `index.html`). */
  var VERSION = '20261011-v662-rust-couleurs';

  /** Langues branchables, et nom du dictionnaire dans `window.Hyphenation`. */
  var LANGUES = { fr: 'fr', en: 'en-us', de: 'de', es: 'es', it: 'it' };

  /** URL du noyau, relative à la page. */
  var URL_NOYAU = 'JS/superprint_core.wasm';

  var etat = {
    version: VERSION,
    actif: false,
    backend: null,
    /** Rangs des dictionnaires chargés dans le noyau, par langue. */
    rangs: {},
    /** Raison de l'échec, si le noyau n'a pas pu être utilisé. */
    raison: null,
    moteur: null,
    /** Les moteurs posés dans `window.hyphenators`, par langue. */
    poses: {},
    /**
     * Les fonctions de `main.js` réellement remplacées, et leur original.
     *
     * Garder l'original est ce qui rend le branchement **réversible** : si le
     * noyau échoue en cours de route, on rend la main à la fonction du produit
     * au lieu de planter, et l'utilisateur ne voit rien.
     */
    composants: {},
  };

  var dejaJournalise = false;
  function journal(message) {
    // Un seul message : un branchement qui réussit n'a rien à raconter pendant
    // la frappe, et un branchement qui échoue n'a pas à remplir la console.
    if (dejaJournalise) return;
    dejaJournalise = true;
    if (global.console && global.console.info) global.console.info('[SuperPrint·Rust] ' + message);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Le moteur de repli : exactement ce que fait l'application aujourd'hui
  // ─────────────────────────────────────────────────────────────────────────

  var cacheRepli = {};
  /**
   * Un moteur `Hypher` du produit, construit **à la première utilisation**
   * (comme `main.js`, qui ne paie pas les cinq dictionnaires au démarrage).
   *
   * Renvoie `null` si `Hypher` ou le dictionnaire manquent : l'appelant laisse
   * alors `main.js` faire son travail.
   */
  function moteurRepli(cle) {
    if (cacheRepli[cle]) return cacheRepli[cle];
    try {
      var source = global.Hyphenation && global.Hyphenation[LANGUES[cle]];
      if (typeof global.Hypher !== 'function' || !source) return null;
      cacheRepli[cle] = new global.Hypher(source);
    } catch (_) {
      return null;
    }
    return cacheRepli[cle] || null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  L'installation des moteurs
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Pose un moteur pour une langue. La fonction est **stable** : elle change de
   * comportement quand le noyau devient prêt, mais jamais de forme. Tout code
   * qui a gardé une référence continue de fonctionner.
   */
  function poser(cle) {
    var rang = null;
    var moteur = {
      lang: cle,
      /** Renseigné une fois le noyau prêt : sert aux diagnostics, pas au calcul. */
      get rust() {
        return etat.actif && rang !== null;
      },
      hyphenate: function (mot) {
        if (etat.actif && rang !== null) {
          try {
            return etat.moteur.fragments(rang, mot);
          } catch (erreur) {
            // Une panne du noyau ne doit pas casser la composition en cours :
            // on repasse sur le moteur du produit, et on le signale une fois.
            journal('césure : le noyau a échoué, retour à Hypher (' + erreur.message + ')');
            etat.actif = false;
            etat.raison = erreur;
          }
        }
        var repli = moteurRepli(cle);
        if (repli && typeof repli.hyphenate === 'function') return repli.hyphenate(mot);
        // Aucun moteur : `main.js` gère ce cas (il retombe sur son découpage
        // syllabique). On rend le mot entier, jamais `null`.
        return [String(mot)];
      },
    };
    etat.poses[cle] = { moteur: moteur, definirRang: function (valeur) { rang = valeur; } };
    return moteur;
  }

  /**
   * Installe les moteurs **tout de suite**, en délégation. C'est ce qui garantit
   * qu'aucun appel de `main.js` ne trouve `window.hyphenators` incomplet.
   */
  function installer() {
    if (!global.Hyphenation) return false;
    var cibles = global.hyphenators && typeof global.hyphenators === 'object' ? global.hyphenators : {};
    var poses = 0;
    for (var cle in LANGUES) {
      if (!Object.prototype.hasOwnProperty.call(LANGUES, cle)) continue;
      // On n'écrase jamais un moteur posé par quelqu'un d'autre : si
      // `window.hyphenators.fr` existe déjà, ce n'est pas à nous de le remplacer.
      if (cibles[cle]) continue;
      if (!global.Hyphenation[LANGUES[cle]]) continue;
      cibles[cle] = poser(cle);
      poses += 1;
    }
    global.hyphenators = cibles;
    return poses > 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Le chargement du noyau, ensuite seulement
  // ─────────────────────────────────────────────────────────────────────────

  function chargerNoyau() {
    if (!global.SuperPrintCore || typeof global.SuperPrintCore.load !== 'function') {
      etat.raison = new Error('colle absente (JS/superprint-core.js non chargée)');
      return Promise.resolve(false);
    }
    return global.SuperPrintCore
      .load({ url: URL_NOYAU })
      .then(function (moteur) {
        etat.moteur = moteur;
        etat.backend = moteur.backend;
        if (moteur.backend !== 'wasm') {
          // Le repli JavaScript de la colle ne sait pas faire la césure — et
          // c'est volontaire : une seconde implémentation approximative serait
          // pire que pas de repli. On reste donc sur `Hypher`.
          etat.raison = new Error('module WebAssembly indisponible');
          return false;
        }
        for (var cle in LANGUES) {
          if (!Object.prototype.hasOwnProperty.call(LANGUES, cle)) continue;
          var entree = etat.poses[cle];
          var definition = global.Hyphenation && global.Hyphenation[LANGUES[cle]];
          if (!entree || !definition) continue;
          try {
            var rang = moteur.chargerMotifs(definition);
            entree.definirRang(rang);
            etat.rangs[cle] = rang;
          } catch (erreur) {
            // Une langue qui refuse de se charger n'empêche pas les autres.
            etat.raison = erreur;
          }
        }
        etat.actif = Object.keys(etat.rangs).length > 0;
        // La conversion de couleurs ne dépend PAS des dictionnaires de césure :
        // elle s'installe dès que le noyau est là. C'est la règle du fichier —
        // un composant ne doit pas échouer parce qu'un autre n'a pas trouvé ses
        // données.
        var couleurs = installerCouleurs();
        // Une seule ligne, quel que soit le nombre de composants : un
        // branchement qui réussit n'a rien à raconter pendant la frappe, et un
        // branchement qui échoue n'a pas à remplir la console.
        var composants = [];
        if (couleurs) composants.push('couleurs');
        composants.push('imposition', 'réduction d’image');
        if (etat.actif) composants.push('césure (' + Object.keys(etat.rangs).join(', ') + ')');
        journal('noyau Rust branché — ' + composants.join(', '));
        return etat.actif || couleurs > 0;
      })
      .catch(function (erreur) {
        etat.raison = erreur;
        journal('noyau indisponible, l’application garde ses chemins habituels (' + erreur.message + ')');
        return false;
      });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  La conversion de couleurs
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remplace `window._spCmykConvert` par la version Rust, en gardant celle de
   * `main.js` sous la main.
   *
   * ## Pourquoi cette fonction, et pas une autre
   *
   * `main.js` **appelle** déjà la conversion à travers `window._spCmykConvert`
   * (`main.js:35707`, avec un garde `typeof`). C'est un point d'accroche prévu
   * par le produit : la remplacer ne demande de toucher à rien.
   *
   * Et elle est partout : la couleur d'un objet, l'aperçu, l'export, la
   * simulation CMJN de l'écran. Une seule fonction, et c'est toute la chaîne
   * colorimétrique qui passe en Rust.
   *
   * ## Ce qui rend le remplacement sûr
   *
   * La fonction posée a la **même forme** que l'originale : mêmes arguments,
   * même objet rendu (`{c, m, y, k}` en 0–1). Un appelant qui a gardé une
   * référence avant le chargement du noyau continue de fonctionner — il appelle
   * la même fonction, dont le comportement change quand le noyau devient prêt.
   *
   * Et si le noyau échoue **en cours d'exécution**, on le désactive et on rend
   * la main à `main.js` : l'impression reste possible, et le message le dit
   * une fois.
   *
   * @returns {number} 1 si la conversion est passée au noyau, 0 sinon.
   */
  function installerCouleurs() {
    if (etat.backend !== 'wasm' || !etat.moteur) return 0;
    var original = global._spCmykConvert;
    if (typeof original !== 'function') {
      // `main.js` n'a pas encore défini la fonction : on n'installe rien
      // plutôt que de poser une fonction que personne n'appellerait. Le
      // chargement du noyau a lieu après `DOMContentLoaded`, donc ce cas ne
      // devrait pas se produire — mais le constater vaut mieux que de le
      // supposer.
      return 0;
    }
    var convert = function (r, g, b, opts) {
      if (etat.backend === 'wasm' && etat.moteur) {
        try {
          return etat.moteur.cmykConvert(r, g, b, opts);
        } catch (erreur) {
          journal(
            'couleurs : le noyau a échoué, retour à main.js (' +
              (erreur && erreur.message ? erreur.message : erreur) +
              ')',
          );
          etat.raison = erreur;
          etat.backend = 'js';
        }
      }
      return original(r, g, b, opts);
    };
    global._spCmykConvert = convert;
    etat.composants.couleurs = { pose: true, original: original };
    return 1;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Surface publique
  // ─────────────────────────────────────────────────────────────────────────

  var api = {
    version: VERSION,
    get etat() {
      return {
        actif: etat.actif,
        backend: etat.backend,
        rangs: etat.rangs,
        raison: etat.raison,
        /** Les fonctions de `main.js` réellement remplacées. */
        composants: Object.keys(etat.composants),
      };
    },
    /**
     * Repasse tout sur `main.js` — retour en arrière d'une ligne.
     *
     * Ce n'est pas seulement la césure : **chaque** fonction remplacée rend la
     * main à son original. C'est la promesse de réversibilité, et elle doit
     * tenir à chaud : un utilisateur qui constate un défaut doit pouvoir
     * revenir en arrière sans recharger la page, et sans qu'il reste un
     * composant branché quelque part.
     */
    desactiver: function () {
      etat.actif = false;
      for (var nom in etat.composants) {
        if (!Object.prototype.hasOwnProperty.call(etat.composants, nom)) continue;
        var entree = etat.composants[nom];
        if (nom === 'couleurs' && entree && typeof entree.original === 'function') {
          global._spCmykConvert = entree.original;
        }
      }
      etat.composants = {};
      journal('branchement désactivé');
      return api.etat;
    },
    /** Réessaie le chargement du noyau (utile si le fichier est arrivé après). */
    reprendre: function () {
      return chargerNoyau().then(function () {
        return api.etat;
      });
    },
    /** Le moteur posé pour une langue — pour inspecter depuis la console. */
    moteur: function (lang) {
      var pose = etat.poses[lang];
      return pose ? pose.moteur : null;
    },

    // ───────────────────────────────────────────────────────────────────────
    //  Imposition et réduction d'image
    // ───────────────────────────────────────────────────────────────────────

    /**
     * L'**ordre d'impression** d'un livret, pour `nbPages` pages.
     *
     * Rend une place par élément, `null` pour une place vide. Sans noyau, rend
     * `null` — l'appelant sait alors qu'il doit utiliser `calculateImposition`
     * de `main.js`.
     *
     * ```
     * SuperPrintBranchement.orderPages(20)
     * // [20, 1, 2, 19, 18, 3, …]
     * ```
     */
    orderPages: function (nbPages) {
      if (!etat.moteur) return null;
      try {
        return etat.moteur.orderPages(nbPages);
      } catch (erreur) {
        journal('imposition : ' + erreur.message);
        return null;
      }
    },

    /**
     * Le **plan d'une planche** : taille de la feuille, place de chaque page,
     * traits de coupe, le tout en millimètres depuis le coin haut-gauche du
     * média.
     *
     * ```js
     * SuperPrintBranchement.imposition({
     *   largeurPageMm: 210, hauteurPageMm: 297,
     *   fondPerduMm: 3, inclureFondPerdu: true,
     *   decoupePageAPage: false, reperesDeCoupe: true,
     *   gauche: 20, droite: 1,
     * });
     * // { feuille: { largeurMm: 446, hauteurMm: 323 },
     * //   places: [ { page: 20, xMm: 10, trimXMm: 13, … }, … ],
     * //   reperes: [ { x1: 0.5, y1: 13, x2: 5.5, y2: 13, … }, … ],
     * //   formatFini: { xMm: 13, yMm: 13, largeurMm: 420, hauteurMm: 297 } }
     * ```
     *
     * Sans noyau, rend `null`.
     */
    imposition: function (options) {
      if (!etat.moteur) return null;
      try {
        return etat.moteur.plan(options);
      } catch (erreur) {
        journal('imposition : ' + erreur.message);
        return null;
      }
    },

    /**
     * La taille utile d'une image **posée** : le calcul qui décide avant de
     * réduire. Sans noyau, rend `null`.
     */
    tailleUtile: function (width, height, largeurMm, dpi) {
      if (!etat.moteur) return null;
      try {
        return etat.moteur.sizeForPlacement(width, height, largeurMm, dpi);
      } catch (erreur) {
        journal('réduction : ' + erreur.message);
        return null;
      }
    },

    /**
     * Réduit les pixels d'une image RVB pour qu'elle tienne exactement la
     * résolution demandée à la taille où elle est posée.
     *
     * ```js
     * const { pixels, width, height, reduite } =
     *   SuperPrintBranchement.reduireImage(rgb, 6000, 4000, 210, 300);
     * ```
     *
     * ## Pourquoi la **moyenne de surface**, et pas un redimensionnement
     *
     * Le navigateur, quand il rééchantillonne par `drawImage`, échantillonne
     * quelques pixels voisins — comme l'interpolation bilinéaire du noyau. Sur un
     * motif fin, cela ne donne pas seulement une image moins nette : cela donne
     * une **couleur fausse**, et parfois la disparition complète du motif.
     *
     * Mesuré : sur une image où une colonne sur huit est blanche, réduite huit
     * fois, la bonne réponse est 32 (le gris moyen). L'interpolation bilinéaire
     * rend **0** — la colonne blanche a disparu. Voir
     * `superprint_rust/scripts/validate-reduction.mjs`.
     *
     * ⚠️ La vitesse, elle, n'est pas le point : sur six millions de pixels, le
     * noyau Rust et une boucle JavaScript équivalente mettent **le même temps**
     * (0,99×) — la copie des pixels dans la mémoire du module annule le gain du
     * calcul. Ce que ce module apporte, c'est la justesse.
     *
     * Sans noyau, rend `null` : l'appelant garde alors son propre chemin.
     */
    reduireImage: function (rgb, srcW, srcH, largeurMm, dpi) {
      if (!etat.moteur) return null;
      try {
        return etat.moteur.reduceForPlacement(rgb, srcW, srcH, largeurMm, dpi);
      } catch (erreur) {
        journal('réduction : ' + erreur.message);
        return null;
      }
    },

    /**
     * Le **rapport prépresse** d'un document **du noyau**, ou `null` si le
     * branchement n'est pas actif.
     *
     * ⚠️ Ce n'est pas le document en cours d'édition. Le prépresse examine un
     * `Document` construit dans le noyau — celui que rend
     * `SuperPrintCore.createDocument()` — et ce document-là n'existe pas encore
     * dans l'application : la composition vit dans Fabric, et rien ne la
     * convertit. Cette fonction est donc utilisable par ce qui *construit* un
     * document du noyau ; la relier à l'espace de travail demande un pont qui
     * reste à faire.
     *
     * ```js
     * const doc = SuperPrintCore.createDocument();
     * doc.addPage({ widthMm: 210, heightMm: 297, bleedMm: 3, markMm: 10 });
     * doc.fillRect({ x: -3, y: -3, width: 216, height: 303, paint: noir });
     *
     * const rapport = SuperPrintBranchement.prepresse(doc);
     * rapport.acceptable;              // le fichier passerait-il ?
     * rapport.constats;                // la liste, gravité décroissante
     * rapport.parCode('FondPerduAbsent');
     * ```
     *
     * `regles` est une spécification textuelle facultative ; les valeurs par
     * défaut sont celles d'un offset **couché** :
     *
     * ```text
     * !preset<TAB>journal          encre serrée, à la place des défauts
     * !image<TAB>300               résolution minimale des images (dpi)
     * !encre<TAB>300               couverture d'encre maximale (%)
     * !exiger<TAB>profil<TAB>1     exiger un profil de sortie
     * ```
     *
     * Une règle illisible est **refusée** — l'appel lève, il ne rend pas un
     * rapport approximatif. Un rapport qui décrit autre chose que ce qu'on a
     * demandé est pire qu'une absence de rapport, parce qu'il est plausible.
     */
    prepresse: function (document, regles) {
      if (!etat.moteur || !document || typeof document.preflight !== 'function') return null;
      return regles === undefined ? document.preflight() : document.preflight(regles);
    },
  };

  global.SuperPrintBranchement = api;

  // ─────────────────────────────────────────────────────────────────────────
  //  Démarrage
  // ─────────────────────────────────────────────────────────────────────────
  //
  // L'ordre compte, et les deux étapes sont **indépendantes** :
  //
  //  1. les moteurs de césure sont posés **tout de suite**, en délégation, pour
  //     que `main.js` trouve `window.hyphenators` complet même s'il s'exécute
  //     avant que le WebAssembly ne soit compilé ;
  //  2. le noyau est chargé **ensuite**, de façon asynchrone.
  //
  // ⚠️ Le chargement du noyau n'est **pas** conditionné à la présence des
  // dictionnaires de césure. L'imposition et la réduction d'image n'en ont pas
  // besoin : les lier à un fichier de motifs ferait échouer deux composants
  // parce qu'un troisième n'a pas trouvé ses données.

  // Étape 1 — les moteurs de césure, si le produit a livré ses dictionnaires.
  installer();

  // Étape 2 — le noyau, quelle que soit l'étape 1.
  var demarrer = function () {
    chargerNoyau();
  };
  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', demarrer, { once: true });
  } else {
    demarrer();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
