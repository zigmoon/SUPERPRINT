/* ══════════════════════════════════════════════════════════════════════════
   superprint-doc.js — l'import de documents par le noyau Rust.

   ## Le joint, et pourquoi il tient sans rien casser

   `main.js` a une fonction privée `_spTexteOdf(buf)` (ligne 40748) qui extrait
   le **texte** d'un document OpenDocument : elle ouvre l'archive avec JSZip,
   découpe `content.xml` sur `</text:p>|</text:h>`, **remplace chaque balise par
   une espace** et apparie trois entités à la main. Trente lignes, et trois
   défauts mesurés :

     - `Pa<text:span>pier</text:span>` devient `Pa pier` — une balise au milieu
       d'un mot le coupe en deux ;
     - `<text:s text:c="3"/>` (trois espaces insécables) devient **une** espace,
       et `&apos;`, `&quot;` et les entités numériques restent littérales ;
     - un **`.ods`** ou un **`.odp`** — que cette fonction reçoit aussi, la
       condition étant `odf || odt || ods || odp` — est lu de la même façon.

   Le noyau Rust a un vrai analyseur XML, une vraie table d'entités, et il
   **refuse** un classeur `.ods` en le nommant, au lieu d'en inventer le texte.

   ## Ce qui est branché, et ce qui ne l'est PAS

   | Chemin | Verdict | Pourquoi |
   |---|---|---|
   | bouton « DOC / DOCX / ODT / RTF » et dépôt de fichier → `_spTexteOdf` | ✅ **branché** | le produit ne demande que du **texte**, et il le dit lui-même à l'utilisateur (« mise en forme non lisible dans ce format ») |
   | `.idml` sur le même chemin | ✅ **branche ajoutée** | il tombait sur `_spDecodeTexte(buf)` — le décodage d'une archive ZIP, donc du binaire. Le noyau lit ses paragraphes |
   | bouton « Open Office » → `extractOdtHtml` | ❌ **non branché** | cette fonction rend du **HTML avec les images** (`extractImagesFromNode`), et le noyau ne porte pas les données d'image (`Memoire::images` n'est qu'une liste de **noms**). Brancher perdrait les images : c'est une régression, pas un portage |
   | `.docx` → mammoth | ❌ **non branché** | mammoth rend le gras, l'italique, les tailles de run, les exposants et les images ; le modèle du noyau les **compte et les signale** au lieu de les porter. Même raison |
   | `.rtf` | ❌ **non branché** | le noyau a la parité, mais `sp-doc-import.js` est chargé de toute façon : brancher **ajoute** un téléchargement sans en retirer aucun |

   ## Le repli n'est jamais perdu

   `main.js` pose `window._spTexteOdf = _spTexteOdf` (une ligne **ajoutée**), et
   lit `(window._spTexteOdf || _spTexteOdf)`. Cette colle **enveloppe** l'original
   au lieu de le remplacer :

     - elle le garde dans `window.__spTexteOdfJs` **avant** de poser la sienne ;
     - elle délègue dès que le noyau n'est pas prêt, qu'il **refuse** le document
       ou qu'il lève — jamais l'inverse ;
     - `retirer()` remet l'état d'avant, exactement.

   ## Pourquoi un module à part, et le prix, mesuré

   Le module principal est **précaché** : tout le monde le télécharge. Les
   chiffres, relevés en construisant les deux variantes :

   | Montage | Coût |
   |---|---|
   | lecteur de documents **dans** `superprint_core.wasm` | 406,5 → **585,8 Ko**, soit **+179,3 Ko pour tout le monde**, à vie |
   | lecteur de documents dans **son propre** module | 406,5 Ko inchangé, **+290,1 Ko** à la demande |

   Les deux chiffres disent la même chose : le module à part coûte **+110,8 Ko de
   plus** en valeur absolue (290,1 − 179,3), parce qu'il réembarque le lecteur
   ZIP que le noyau possède déjà — mais il ne les fait payer qu'à **qui ouvre un
   document**. C'est le motif déjà appliqué deux fois (PostScript, montage), et
   c'est ici le bon.

   ## Quand le noyau se charge

   Sur **intention** : un `dragover` de fichier, ou un contact avec l'un des trois
   boutons d'import de documents. Le chargement prend quelques centaines de
   millisecondes, et un dépôt de fichier en prend toujours plus. Aucun octet n'est
   dépensé par qui n'importe jamais un document.
   ══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  /** Version de ce branchement (sert aussi de paramètre `?v=` dans `index.html`). */
  var VERSION = '20261013-v618-rust-doc';

  /** URL du module, relative à la page. */
  var URL_NOYAU = 'JS/superprint_doc.wasm';

  /** Codes de la frontière (`crates/superprint-doc-wasm/src/lib.rs`). */
  var ERR_TOO_SMALL = -1000002;
  var ERR_REFUS = -1000003;

  var etat = {
    version: VERSION,
    /** Le module est chargé et prêt. */
    pret: false,
    /** Chargement en cours, pour ne pas le lancer deux fois. */
    chargement: null,
    raison: null,
    /** Ce qui a servi : `'rust'`, `'js'` ou `null` avant le premier document. */
    dernier: null,
    /** Nombre de fois où le noyau a servi, et où l'on a délégué. */
    servis: 0,
    delegues: 0,
    /** Le dernier refus du noyau, en clair — pour le diagnostic. */
    dernierRefus: null,
    /**
     * Vrai quand `window._spTexteOdf` existait déjà à l'installation. C'est le
     * cas normal : `main.js` la pose. Faux si la colle est chargée seule, et
     * c'est alors le signal que le joint de `main.js` manque.
     */
    jointTrouve: false,
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
        // tromper donne `instance.exports === undefined`.
        var e = resultat && resultat.instance ? resultat.instance.exports : resultat.exports;
        // On vérifie ce dont on a besoin AVANT de se déclarer prêt : un module
        // sans son export serait pire qu'absent, parce que le premier import
        // échouerait au lieu de retomber sur le JavaScript.
        if (
          !e ||
          typeof e.sp_doc_texte !== 'function' ||
          typeof e.sp_alloc !== 'function' ||
          typeof e.sp_free !== 'function' ||
          !(e.memory instanceof WebAssembly.Memory)
        ) {
          throw new Error('le module ne ressemble pas au noyau de documents');
        }
        etat.exports = e;
        etat.pret = true;
        etat.raison = null;
        journal('import de documents branché sur le noyau Rust');
        return true;
      })
      .catch(function (erreur) {
        etat.raison = erreur;
        etat.chargement = null;
        journal(
          'import de documents : module indisponible, le JavaScript reste en place (' +
            (erreur && erreur.message ? erreur.message : erreur) + ')',
        );
        return false;
      });
    return etat.chargement;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Appel de la frontière
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Lit le texte d'un document par le noyau.
   *
   * Rend `{ texte }` quand le document a été lu — `texte` pouvant être **vide**,
   * ce qui n'est pas un refus — ou `{ refus, raison }` quand le noyau l'a
   * écarté, la raison étant alors en clair.
   *
   * Le protocole est en deux passes : la première avec un tampon nul donne la
   * taille nécessaire (`SP_ERR_TOO_SMALL`) ou, si le texte est vide, un zéro
   * immédiat. Un succès rend le **nombre d'octets écrits**, pas zéro : un
   * `!== 0` ici ferait passer un document illisible pour un refus.
   */
  function texteDuNoyau(donnees) {
    var e = etat.exports;
    var pSrc = e.sp_alloc(donnees.length || 1);
    if (!pSrc) throw new Error('allocation refusée');
    new Uint8Array(e.memory.buffer, pSrc, donnees.length).set(donnees);
    var pLen = e.sp_alloc(4);
    try {
      var sonde = e.sp_doc_texte(pSrc, donnees.length, 0, 0, pLen);
      // La vue est construite APRÈS l'appel : celui-ci peut avoir agrandi la
      // mémoire du module, ce qui **détache** les vues construites avant.
      var besoin = new Uint32Array(e.memory.buffer, pLen, 1)[0];
      if (sonde === 0 && besoin === 0) return { texte: '' };
      if (sonde !== ERR_TOO_SMALL) {
        throw new Error('réponse inattendue de la frontière (code ' + sonde + ')');
      }
      var tampon = e.sp_alloc(besoin);
      try {
        var code = e.sp_doc_texte(pSrc, donnees.length, tampon, besoin, pLen);
        var vue = new Uint8Array(e.memory.buffer, tampon, besoin);
        var texte = new TextDecoder('utf-8').decode(vue);
        if (code === ERR_REFUS) return { refus: true, raison: texte };
        if (code < 0) throw new Error('lecture refusée (code ' + code + ')');
        return { texte: texte };
      } finally {
        e.sp_free(tampon, besoin);
      }
    } finally {
      e.sp_free(pLen, 4);
      e.sp_free(pSrc, donnees.length || 1);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  L'enveloppe
  // ─────────────────────────────────────────────────────────────────────────

  /** Un `buf` peut être un `ArrayBuffer`, une vue, ou rien du tout. */
  function enOctets(buf) {
    if (buf instanceof Uint8Array) return buf;
    if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
    if (buf && buf.buffer) return new Uint8Array(buf.buffer);
    return null;
  }

  /**
   * Lit le texte d'un document **par le noyau seul**, sans repli.
   *
   * C'est la porte que la branche `.idml` de `main.js` appelle : elle rend
   * `{ texte }` ou `{ refus, raison }`, et l'appelant décide. Attendre le
   * chargement est délibéré — c'est le seul moment où l'attente a un sens, et
   * elle évite de rendre « pas de texte » sur un module encore en vol.
   */
  function texteNoyau(buf) {
    var donnees = enOctets(buf);
    if (!donnees) return Promise.resolve({ refus: true, raison: 'entrée illisible' });
    return charger().then(function (pret) {
      if (!pret) return { refus: true, raison: 'noyau indisponible' };
      try {
        var r = texteDuNoyau(donnees);
        if (r.refus) {
          etat.dernierRefus = r.raison;
          return r;
        }
        return { texte: r.texte };
      } catch (erreur) {
        etat.raison = erreur;
        return { refus: true, raison: String((erreur && erreur.message) || erreur) };
      }
    });
  }

  /**
   * Installe l'enveloppe sur `window._spTexteOdf`.
   *
   * L'original est conservé **sous son nom** (`window.__spTexteOdfJs`) avant que
   * quoi que ce soit d'autre soit posé : à partir de là, aucun chemin ne peut le
   * perdre, même si l'enveloppe lève.
   */
  function installer() {
    var original = global._spTexteOdf;
    etat.jointTrouve = typeof original === 'function';
    global.__spTexteOdfJs = original;

    var remplacant = function (buf) {
      var donnees = enOctets(buf);
      var replier = function () {
        etat.delegues += 1;
        if (typeof original !== 'function') return '';
        return original(buf);
      };
      if (!donnees) return Promise.resolve(replier());
      return charger().then(function (pret) {
        if (!pret) return replier();
        try {
          var r = texteDuNoyau(donnees);
          if (r.refus) {
            // Un `.ods`, un `.odp`, une archive abîmée : le noyau le dit, et
            // c'est le JavaScript du produit qui décide de la suite. On ne
            // remplace jamais un texte par un vide.
            etat.dernierRefus = r.raison;
            return replier();
          }
          etat.dernier = 'rust';
          etat.servis += 1;
          return r.texte;
        } catch (erreur) {
          etat.raison = erreur;
          return replier();
        }
      });
    };
    remplacant.__spDocNatif = true;
    remplacant.__spDocOriginal = original;
    global._spTexteOdf = remplacant;

    journal(
      etat.jointTrouve
        ? 'import de documents branché (le JavaScript du produit reste le repli)'
        : '⚠️ window._spTexteOdf absent : la ligne de main.js qui la pose manque',
    );
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Le chargement, sur intention
  // ─────────────────────────────────────────────────────────────────────────

  /** Déclenche le chargement au premier signe d'un import de document. */
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
      ['importDocxBtn', 'importOdtBtn', 'importIdmlBtn'].forEach(function (id) {
        var bouton = global.document.getElementById(id);
        if (!bouton) return;
        bouton.addEventListener('pointerdown', uneFois, { once: true, passive: true });
        bouton.addEventListener('click', uneFois, { once: true, passive: true });
      });
    }
  }

  function demarrer() {
    installer();
    surIntention();
  }

  global.SuperPrintDoc = {
    version: VERSION,
    get etat() {
      return {
        pret: etat.pret,
        dernier: etat.dernier,
        servis: etat.servis,
        delegues: etat.delegues,
        jointTrouve: etat.jointTrouve,
        dernierRefus: etat.dernierRefus,
        raison: etat.raison ? String(etat.raison.message || etat.raison) : null,
      };
    },
    /** Force le chargement, sans attendre une intention. */
    charger: charger,
    /** Le texte par le noyau seul : `{ texte }` ou `{ refus, raison }`. */
    texteNoyau: texteNoyau,
    /** Réinstalle l'enveloppe (utile quand le joint est posé après coup). */
    installer: installer,
    /** Détache l'enveloppe : l'état d'avant, exactement. */
    retirer: function () {
      if (global._spTexteOdf && global._spTexteOdf.__spDocNatif) {
        global._spTexteOdf = global._spTexteOdf.__spDocOriginal;
        return true;
      }
      return false;
    },
  };

  if (global.document) {
    // `main.js` est un script `defer` : il a donc **déjà** posé
    // `window._spTexteOdf` quand `DOMContentLoaded` arrive. C'est ce qui rend
    // l'enveloppe possible sans deviner d'ordre de chargement.
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', demarrer);
    } else {
      demarrer();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
