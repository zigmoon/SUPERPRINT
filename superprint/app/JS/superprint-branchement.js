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
 * ## Premier composant : la CÉSURE
 *
 * Le dictionnaire de césure est celui du produit (`JS/hyphenation-*.js`), lu
 * **tel quel**. Le noyau Rust construit le même arbre de motifs et rend les
 * mêmes fragments — la parité est mesurée par
 * `superprint_rust/scripts/validate-branchement.mjs` sur 2 400 mots réels.
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
 * Licence : AGPL-3.0-or-later — voir ../LICENSE.
 */

(function (global) {
  'use strict';

  /** Version de ce branchement (sert aussi de paramètre `?v=` dans `index.html`). */
  var VERSION = '20261011-v612-rust-cesure';

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
        if (etat.actif) {
          journal(
            'césure branchée sur le noyau Rust (' + Object.keys(etat.rangs).join(', ') + ')',
          );
        } else {
          journal('césure : aucun dictionnaire chargé, Hypher reste en place');
        }
        return etat.actif;
      })
      .catch(function (erreur) {
        etat.raison = erreur;
        journal('césure : noyau indisponible, Hypher reste en place (' + erreur.message + ')');
        return false;
      });
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
      };
    },
    /** Repasse tout sur `Hypher` — retour en arrière d'une ligne. */
    desactiver: function () {
      etat.actif = false;
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
  };

  global.SuperPrintBranchement = api;

  // Installation **synchrone** des moteurs, chargement **asynchrone** du noyau.
  // L'ordre compte : `main.js` doit trouver `window.hyphenators` complet, même
  // s'il s'exécute avant que le WebAssembly ne soit compilé.
  if (installer()) {
    var demarrer = function () {
      chargerNoyau();
    };
    if (global.document && global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', demarrer, { once: true });
    } else {
      demarrer();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
