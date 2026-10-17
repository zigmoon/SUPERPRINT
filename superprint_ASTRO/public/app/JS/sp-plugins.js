/* ═══════════════════════════════════════════════════════════════════════════════
   SUPERPRINT — PLUG-INS  (v1.7.648)
   ═══════════════════════════════════════════════════════════════════════════════

   Un plug-in SuperPrint est un fichier `.plugin.js` que l'utilisateur installe
   depuis le panneau PLUG-INS (en bas de la barre de droite). Il s'exécute dans la
   page, reçoit une API hôte, et peut ajouter des objets au document.

   ⚠️ CE QUE CETTE API EST, ET CE QU'ELLE N'EST PAS.
   Un plug-in tourne avec les droits de la page : il peut lire le document et
   écrire dedans. Il n'y a PAS de bac à sable réel — JavaScript dans un navigateur
   n'en fournit pas d'étanche. C'est le même compromis qu'une extension VS Code ou
   qu'un script Photoshop : un plug-in est un script qu'on choisit d'installer.
   Ce que l'API apporte, c'est un CONTRAT : le plug-in ne touche jamais au DOM de
   l'application ni aux variables internes, il passe par les fonctions ci-dessous.
   C'est ce qui rend les plug-ins stables quand l'application évolue, et c'est ce
   que la documentation promet.

   ⚠️ POURQUOI UNE API ET PAS UN ACCÈS DIRECT À `fabric` ET `pages`.
   `canvases`, `pages`, `currentPageIndex`, `history` sont des variables de
   `main.js` déclarées dans une portée de module : elles ne sont PAS sur `window`.
   Un plug-in qui les chercherait par leur nom échouerait selon le contexte de
   chargement — un défaut déjà rencontré sur ce dépôt. On expose donc des
   accesseurs (`api.document`, `api.add`) qui, eux, sont garantis.
   ─────────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var VERSION = '1.7.648';
  var CLE_REGISTRE = 'sp_plugins_v1';        // plug-ins installés (code source + manifeste)
  var CLE_ACTIFS = 'sp_plugins_actifs_v1';   // { [id]: true/false }

  /* ── Accès à l'hôte ──────────────────────────────────────────────────────────
     Tout est résolu À L'APPEL, jamais à la définition : `main.js` peut finir de
     charger après nous, et une référence figée au moment du chargement serait
     `undefined` pour toujours. C'est exactement le défaut qui a rendu le module
     d'import Figma incorrigeable (URL figée) puis silencieusement périmé. */
  function H() {
    var h = window.__SP_PLUGIN_HOST__;
    if (h) return h;
    /* Repli minimal : si le pont de `main.js` n'est pas encore posé (plug-in lancé
       depuis la console avant la fin du chargement, par exemple), on retombe sur
       les fonctions publiques. Aucune de ces fonctions n'est garantie : c'est un
       repli, pas le chemin normal. */
    return {
      canvasActif: function () {
        try { if (typeof window.getActiveCanvas === 'function') return window.getActiveCanvas(); } catch (_) {}
        return null;
      },
      page: function () { return { index: 0, total: 1 }; },
      fondPerdu: function () { return 0; },
      apres: function () {}
    };
  }

  /* ── Conversions que les plug-ins n'ont pas à réinventer ──────────────────── */
  function mmVersPx(mm) { return (Number(mm) || 0) * 72 / 25.4; }
  function pxVersMm(px) { return (Number(px) || 0) * 25.4 / 72; }

  /* ── API donnée à chaque plug-in ───────────────────────────────────────────── */
  function creerApi(manifeste, options) {
    var id = manifeste.id;
    var apercu = !!(options && options.apercu);

    function canevas() {
      var c = H().canvasActif ? H().canvasActif() : null;
      if (!c) throw new Error('aucun plan de travail actif');
      return c;
    }

    function apres(libelle) {
      try { H().apres(libelle || ('Plug-in : ' + manifeste.name)); } catch (_) {}
    }

    var api = {
      version: VERSION,

      /* 🆕 v1.7.648 — L'APERÇU EST UN MODE, ET LE PLUG-IN DOIT LE SAVOIR.
         Une trappe peut exécuter un plug-in à chaque mouvement de tirette. Dans ce
         mode, `api.apercu` vaut `true` : un plug-in qui écrit quelque chose de
         coûteux (un historique, un message, un dialogue) peut s'en abstenir. Le
         registre, lui, n'écrit JAMAIS d'entrée d'historique en aperçu — la
         validation s'en charge une seule fois. */
      apercu: apercu,

      /* Le moteur graphique, pour construire des objets. */
      get fabric() { return window.fabric; },

      /* Conversions — la seule unité de l'application est le point (1 mm = 72/25,4). */
      mm: mmVersPx,
      px: pxVersMm,

      /* 🆕 v1.7.648 — TOUS LES PLANS DE TRAVAIL.
         Un plug-in qui remplace son propre dessin doit pouvoir le RETIRER partout
         où il l'a posé. Sans cette liste, le plug-in Motif devait passer par
         `window._spMaquette._debug.vues()` — l'échafaudage de débogage d'un autre
         module. Une dépendance pareille casse au premier remaniement. */
      canvases: function () {
        try {
          var l = (H().canvases && H().canvases()) || [];
          return l.filter(Boolean);
        } catch (_) { return []; }
      },

      /* Le document, en lecture. */
      get document() {
        var c = canevas();
        var h = H();
        var info = (h.page && typeof h.page === 'function') ? h.page() : { index: 0, total: 1 };
        var fp = (h.fondPerdu && typeof h.fondPerdu === 'function') ? h.fondPerdu() : 0;
        return {
          largeur: c.width,          // en points
          hauteur: c.height,
          largeurMm: pxVersMm(c.width),
          hauteurMm: pxVersMm(c.height),
          page: info.index + 1,
          pages: info.total,
          fondPerdu: fp,
          marges: (typeof window.spMargesMm === 'function') ? window.spMargesMm() : null,
          objets: c.getObjects().length
        };
      },

      /* La sélection, en lecture. */
      selection: function () {
        var c = canevas();
        var a = c.getActiveObjects ? c.getActiveObjects() : [];
        return a || [];
      },

      /* Ajout d'objets. Chaque ajout est enregistré dans l'historique de
         l'application : un plug-in reste annulable par Ctrl+Z, comme n'importe
         quelle action de l'utilisateur.
         ⚠️ SAUF EN APERÇU : voir `api.apercu`. On synchronise alors `pages[]` sans
         écrire d'entrée, sinon une tirette = un Ctrl+Z. */
      add: function (obj, options) {
        if (!obj) return null;
        var c = canevas();
        var opts = options || {};
        if (opts.selectable === undefined) obj.set({ selectable: !opts.verrouille, evented: !opts.verrouille });
        c.add(obj);
        if (opts.envoyerEnArriere) c.sendToBack(obj);
        else if (opts.envoyerAuFond !== false) { /* laissé devant, comme un ajout normal */ }
        c.requestRenderAll ? c.requestRenderAll() : c.renderAll();
        if (apercu) api.sync();
        else apres(opts.libelle);
        return obj;
      },

      addMany: function (liste, options) {
        var c = canevas();
        var sortie = [];
        (liste || []).forEach(function (o) { if (o) { c.add(o); sortie.push(o); } });
        c.requestRenderAll ? c.requestRenderAll() : c.renderAll();
        if (apercu) api.sync();
        else apres((options && options.libelle) || ('Plug-in : ' + manifeste.name));
        return sortie;
      },

      /* Synchronise `pages[]` sans écrire d'historique. C'est ce que fait `add`
         en aperçu ; un plug-in qui touche aux objets directement peut l'appeler. */
      sync: function () {
        try { if (H().sync) H().sync(); } catch (_) {}
      },

      /* 🆕 v1.7.648 — LA GRANDE TOILE D'APERÇU DE LA TRAPPE.
         Renvoie `{ canvas, ctx, largeur, hauteur }` (en pixels du support, donc
         déjà doublé pour un écran à densité 2), ou `null` si le plug-in n'a pas
         déclaré de champ `{ type: 'apercu' }` ou si aucune trappe n'est ouverte.
         Le plug-in y dessine CE QU'IL S'APPRÊTE À POSER : c'est la seule façon
         honnête de montrer un motif — une vignette d'une seule forme ne dit rien
         du rythme, de la densité ni des raccords. */
      toileApercu: function () {
        try {
          var t = window.__SP_PLUGIN_TRAP__;
          return (t && typeof t.toileApercu === 'function') ? t.toileApercu() : null;
        } catch (_) { return null; }
      },

      /* Écrit l'entrée d'historique. En aperçu, c'est la VALIDATION qui l'appelle,
         une seule fois — jamais le plug-in. */
      commit: function (libelle) {
        if (apercu) return;
        apres(libelle);
      },

      /* Retire un objet ajouté (pour les aperçus successifs d'un même plug-in). */
      remove: function (objs) {
        var c = canevas();
        var liste = Array.isArray(objs) ? objs : [objs];
        liste.forEach(function (o) { if (o) c.remove(o); });
        c.requestRenderAll ? c.requestRenderAll() : c.renderAll();
      },

      /* Dialogue natif de l'application (jamais window.alert : la DA est cohérente). */
      alert: function (msg, titre) {
        try {
          if (typeof window.spAlert === 'function') return window.spAlert(String(msg), titre ? { title: String(titre) } : undefined);
        } catch (_) {}
        try { window.alert(String(msg)); } catch (_) {}
      },
      prompt: function (question, defaut) {
        if (typeof window.spPrompt === 'function') return window.spPrompt(String(question), { value: defaut || '' });
        var r = null;
        try { r = window.prompt(String(question), defaut || ''); } catch (_) {}
        return Promise.resolve(r);
      },

      /* Choisir une image Sur le disque et la recevoir en dataURL. C'est ainsi que
         le plug-in Motif récupère la forme à répéter. */
      imageDataUrl: function () {
        return new Promise(function (res) {
          try {
            var inp = document.createElement('input');
            inp.type = 'file';
            inp.accept = 'image/*,.svg';
            inp.style.display = 'none';
            /* ⚠️ v1.7.648 — L'ÉLÉMENT EST RETIRÉ DÈS QU'IL A SERVI.
               MESURÉ : le retrait n'était prévu qu'au bout de 60 s, et le champ
               n'était jamais enlevé si l'utilisateur fermait le sélecteur sans
               choisir de fichier. Un mixeur d'images demande plusieurs choix de
               suite : on accumulait ainsi un `<input type=file>` invisible par
               clic (24 relevés en une session de test). On nettoie donc dans tous
               les cas — changement, annulation, et le délai de sécurité. */
            var nettoyer = function () {
              try { if (inp.parentNode) inp.parentNode.removeChild(inp); } catch (_) {}
            };
            inp.addEventListener('change', function () {
              var f = inp.files && inp.files[0];
              if (!f) { nettoyer(); res(null); return; }
              var r = new FileReader();
              r.onload = function () { nettoyer(); res(String(r.result)); };
              r.onerror = function () { nettoyer(); res(null); };
              r.readAsDataURL(f);
            });
            /* Le sélecteur fermé sans choix n'émet pas `change` sur tous les
               navigateurs : `cancel` le fait, quand il existe. */
            inp.addEventListener('cancel', function () { nettoyer(); res(null); });
            document.body.appendChild(inp);
            inp.click();
            setTimeout(nettoyer, 60000);
          } catch (_) { res(null); }
        });
      },

      log: function (msg) {
        try { console.log('[' + manifeste.name + '] ' + msg); } catch (_) {}
      },

      /* Un petit stockage persistant, propre au plug-in. */
      store: {
        get: function (cle, defaut) {
          try {
            var tout = JSON.parse(localStorage.getItem('sp_plugin_data_' + id) || '{}');
            return (cle in tout) ? tout[cle] : defaut;
          } catch (_) { return defaut; }
        },
        set: function (cle, valeur) {
          try {
            var tout = {};
            try { tout = JSON.parse(localStorage.getItem('sp_plugin_data_' + id) || '{}'); } catch (_) {}
            tout[cle] = valeur;
            localStorage.setItem('sp_plugin_data_' + id, JSON.stringify(tout));
          } catch (_) {}
        }
      }
    };
    return api;
  }

  /* ── Registre ──────────────────────────────────────────────────────────────── */
  var MANIFESTES = {};      // { [id]: manifeste }  (le `run` n'est pas persisté)

  function lireInstalles() {
    try { return JSON.parse(localStorage.getItem(CLE_REGISTRE) || '{}'); } catch (_) { return {}; }
  }
  function ecrireInstalles(o) {
    try { localStorage.setItem(CLE_REGISTRE, JSON.stringify(o)); } catch (e) {
      try { console.warn('[SP-Plugin] registre non enregistré :', e.message); } catch (_) {}
    }
  }
  function lireActifs() {
    try { return JSON.parse(localStorage.getItem(CLE_ACTIFS) || '{}'); } catch (_) { return {}; }
  }
  function ecrireActifs(o) {
    try { localStorage.setItem(CLE_ACTIFS, JSON.stringify(o)); } catch (_) {}
  }

  /* Normalise un manifeste : un plug-in mal écrit ne doit pas casser le panneau. */
  function normaliser(m, source) {
    if (!m || typeof m !== 'object') throw new Error('manifeste absent');
    var id = String(m.id || '').trim();
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(id)) {
      throw new Error('identifiant de plug-in invalide (lettres, chiffres, point, tiret ; 2 à 64 caractères)');
    }
    if (!m.name) throw new Error('nom du plug-in manquant');
    var options = Array.isArray(m.options) ? m.options.map(function (o) {
      return {
        key: String(o.key || ''),
        label: String(o.label || o.key || ''),
        /* 🆕 v1.7.648 — `apercu` (grande toile dessinée par le plug-in) et
           `images` (mixeur multi-images) rejoignent les types reconnus. Sans
           cette ligne, le normalisateur les rabattait sur `text` : la trappe
           affichait alors une bêtise au lieu du champ demandé. */
        type: ['text', 'number', 'color', 'select', 'checkbox', 'image', 'images', 'range', 'apercu'].indexOf(o.type) >= 0 ? o.type : 'text',
        defaut: (o.defaut !== undefined) ? o.defaut : '',
        choix: Array.isArray(o.choix) ? o.choix.slice() : null,
        min: (typeof o.min === 'number') ? o.min : undefined,
        max: (typeof o.max === 'number') ? o.max : undefined,
        pas: (typeof o.pas === 'number') ? o.pas : undefined,
        /* Unité affichée à côté de la valeur (mm, °, %, ×) : purement cosmétique,
           mais sans elle « 8 » ne veut rien dire sur une tirette. */
        unite: o.unite ? String(o.unite) : '',
        /* Rapport hauteur/largeur de la toile d'aperçu (1.414 = A4 portrait). */
        ratio: (typeof o.ratio === 'number' && o.ratio > 0.1 && o.ratio < 10) ? o.ratio : undefined,
        aide: o.aide ? String(o.aide) : ''
      };
    }).filter(function (o) { return o.key; }) : [];
    return {
      id: id,
      name: String(m.name),
      version: String(m.version || '1.0.0'),
      author: String(m.author || ''),
      description: String(m.description || ''),
      icon: String(m.icon || '◆'),
      options: options,
      /* 🆕 v1.7.648 — UN PLUG-IN PEUT AVOIR SA PROPRE TRAPPE.
         « Global Refactor » n'est pas un formulaire : c'est un panneau entier, avec
         un aperçu en direct, un Annuler et un Valider qui existaient déjà. Le
         réécrire dans une trappe générique aurait été un second code à maintenir
         pour le même résultat. Le manifeste déclare donc l'identifiant du panneau
         qu'il ouvre (`trappe`), et son `run()` s'occupe de l'ouvrir : la bibliothèque
         se contente alors de l'EXÉCUTER, sans construire de formulaire.
         ⚠️ RESERVÉ AUX PLUG-INS INTÉGRÉS. Un `.plugin.js` déposé par l'utilisateur
         ne peut pas réclamer une trappe du produit : `liste()` ne transmet ce champ
         que si `integre` est vrai, donc le champ est inerte pour tout le reste.
         Sans cela, n'importe quel fichier installé contournerait le formulaire pour
         s'exécuter d'un seul clic. */
      trappe: String(m.trappe || ''),
      source: (typeof source === 'string') ? source : (m.source || ''),
      integre: !!m.integre,
      run: (typeof m.run === 'function') ? m.run : null
    };
  }

  /* Charge un manifeste depuis son code source. Le code reçoit un objet unique et
     n'a donc accès ni aux variables de `main.js` ni à celles de ce module. */
  function evaluerSource(src, nom) {
    if (typeof src !== 'string' || !src.trim()) throw new Error('code source vide');
    var capture = null;
    function SPPluginAPI(manifeste) { capture = manifeste; }
    /* eslint-disable no-new-func */
    var f = new Function('SPPluginAPI', '"use strict";\n' + src + '\n//# sourceURL=sp-plugin://' + encodeURIComponent(nom || 'plugin'));
    try { f(SPPluginAPI); } catch (e) {
      throw new Error('le plug-in a échoué au chargement : ' + (e && e.message ? e.message : e));
    }
    if (!capture) throw new Error('le plug-in n\'appelle pas SPPluginAPI({ … })');
    return capture;
  }

  function installerSource(src, nomFichier) {
    var m = normaliser(evaluerSource(src, nomFichier), src);
    var installes = lireInstalles();
    installes[m.id] = {
      source: src, name: m.name, version: m.version, author: m.author, integre: false,
      description: m.description, icon: m.icon, options: m.options, fichier: nomFichier || '',
      /* 🆕 v1.7.648 — DATE D'INSTALLATION, pour les filtres de la bibliothèque.
         Les plug-ins installés AVANT cette version n'en ont pas : le filtre les
         traite alors comme « anciens » (visibles dans « Tous » et « 30 jours »),
         jamais comme « récents » — on ne date pas rétroactivement un fichier
         qu'on n'a pas vu arriver. */
      installe: Date.now()
    };
    ecrireInstalles(installes);
    MANIFESTES[m.id] = m;
    var actifs = lireActifs(); actifs[m.id] = true; ecrireActifs(actifs);
    return { id: m.id, name: m.name, version: m.version };
  }

  /* Charge tous les plug-ins installés (et enregistre ceux livrés avec l'app). */
  function chargerTous() {
    var installes = lireInstalles();
    Object.keys(installes).forEach(function (id) {
      if (MANIFESTES[id]) return;
      try {
        var m = normaliser(evaluerSource(installes[id].source, installes[id].fichier || id), installes[id].source);
        MANIFESTES[id] = m;
      } catch (e) {
        try { console.warn('[SP-Plugin] ' + id + ' : ' + e.message); } catch (_) {}
      }
    });
  }

  /* ── Exécution ─────────────────────────────────────────────────────────────── */
  function executer(id, valeurs, options) {
    var m = MANIFESTES[id] || null;
    if (!m) {
      /* Peut-être installé mais pas encore évalué : on retente une fois. */
      chargerTous();
      m = MANIFESTES[id] || null;
    }
    if (!m) throw new Error('plug-in inconnu : ' + id);
    if (!m.run) throw new Error('ce plug-in n\'a pas de fonction run()');
    /* ⚠️ v1.7.648 — UN PLUG-IN DÉSACTIVÉ NE S'EXÉCUTE PAS, ET C'EST LE REGISTRE QUI
       LE DIT. L'état `actif` existait depuis 1.7.642 mais n'était qu'une pastille
       d'affichage : `definirActif` écrivait dans le stockage et personne ne le
       relisait. Un interrupteur qui ne coupe rien est un mensonge — la garde est
       donc posée ici, au seul endroit par lequel passe toute exécution (la trappe
       comme un appel direct). Le message nomme le plug-in et dit quoi faire. */
    var actifs = lireActifs();
    if (actifs[id] === false) {
      throw new Error('« ' + m.name + ' » est désactivé. Réactivez-le dans la bibliothèque de plug-ins.');
    }
    var opts = {};
    (m.options || []).forEach(function (o) { opts[o.key] = (valeurs && o.key in valeurs) ? valeurs[o.key] : o.defaut; });
    var api = creerApi(m, options);
    var apercu = !!(options && options.apercu);
    /* 🆕 v1.7.648 — L'APERÇU SE DÉROULE EN SILENCE D'HISTORIQUE.
       ⚠️ MESURÉ : sans cela, chaque forme posée par le plug-in déclenchait le
       `object:added` global de `main.js` → `debouncedSaveState('Objet ajouté')`.
       La pile d'undo montait de 13 à 29 en trente secondes d'aperçus, et Ctrl+Z
       ne ramenait plus au dessin d'avant. Le silence est posé ICI, au seul point
       par lequel passe toute exécution, et TOUJOURS levé (succès comme échec) :
       un silence oublié figerait l'historique pour le reste de la session.
       En exécution normale (`apercu` faux), rien n'est posé : le plug-in écrit
       son entrée comme n'importe quelle action. */
    if (!apercu) return Promise.resolve().then(function () { return m.run(api, opts); });
    var h = H();
    try { if (h.muet) h.muet(true); } catch (_) {}
    return Promise.resolve()
      .then(function () { return m.run(api, opts); })
      .then(
        function (v) { try { if (h.muet) h.muet(false); } catch (_) {} return v; },
        function (e) { try { if (h.muet) h.muet(false); } catch (_) {} throw e; }
      );
  }

  /* 🆕 v1.7.648 — VALIDER UN APERÇU.
     Une trappe en aperçu direct peut avoir exécuté le plug-in trente fois. Une
     seule entrée d'historique doit en sortir, et c'est celle-ci : elle synchronise
     puis fige. Le plug-in n'a rien à en savoir. */
  function valider(libelle) {
    try { if (H().apres) { H().apres(libelle || 'Plug-in'); return true; } } catch (_) {}
    return false;
  }

  /* Enregistrement d'un plug-in intégré (livré dans `app/plugins/`). */
  function enregistrerIntegre(manifeste) {
    try {
      var m = normaliser(manifeste, manifeste && manifeste.source ? manifeste.source : '');
      m.integre = true;
      MANIFESTES[m.id] = m;
      /* Un plug-in intégré est ACTIF d'office : c'est une fonction du produit. */
      var actifs = lireActifs();
      if (!(m.id in actifs)) { actifs[m.id] = true; ecrireActifs(actifs); }
      return m.id;
    } catch (e) {
      try { console.warn('[SP-Plugin] intégré refusé : ' + e.message); } catch (_) {}
      return null;
    }
  }

  function liste() {
    chargerTous();
    var installes = lireInstalles();
    var actifs = lireActifs();
    var out = [];
    Object.keys(MANIFESTES).forEach(function (id) {
      var m = MANIFESTES[id];
      var inst = installes[id] || null;
      out.push({
        id: id, name: m.name, version: m.version, author: m.author,
        description: m.description, icon: m.icon, options: m.options,
        integre: !!m.integre || !!(inst && inst.integre),
        actif: actifs[id] !== false,
        /* Date d'installation, pour les filtres de la bibliothèque (cf. installe
           dans installerSource). `null` = plug-in intégré ou installé avant 1.7.648. */
        installe: (inst && inst.installe) ? inst.installe : null,
        /* Trappe propre au plug-in (cf. `normaliser`) — intégrés uniquement. */
        trappe: m.integre ? m.trappe : ''
      });
    });
    out.sort(function (a, b) {
      if (a.integre !== b.integre) return a.integre ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return out;
  }

  function definirActif(id, actif) {
    var a = lireActifs();
    a[id] = !!actif;
    ecrireActifs(a);
  }

  function desinstaller(id) {
    var installes = lireInstalles();
    delete installes[id];
    ecrireInstalles(installes);
    delete MANIFESTES[id];
    try { localStorage.removeItem('sp_plugin_data_' + id); } catch (_) {}
    /* La préférence d'activation part avec le plug-in. Sans cette ligne, une
       réinstallation retrouverait l'ancien `false` et le plug-in reviendrait
       éteint sans que personne ne l'ait demandé. */
    var a = lireActifs();
    if (id in a) { delete a[id]; ecrireActifs(a); }
  }

  /* ⚠️ `SPPluginAPI` EST AUSSI GLOBAL. Un plug-in installé est évalué dans une
     fonction où `SPPluginAPI` est un paramètre local (cf. evaluerSource), donc
     parfaitement isolé. Mais un plug-in INTÉGRÉ est chargé par une balise
     `<script>` ordinaire : il n'a alors que la portée globale. On pose donc le
     nom globalement — c'est le point d'entrée que la documentation décrit.
     MESURÉ : sans cette ligne, le plug-in livré échouait au chargement avec
     « SPPluginAPI is not defined » et le panneau restait vide. */
  window.SPPluginAPI = function (manifeste) {
    return enregistrerIntegre(manifeste);
  };

  window.SPPlugins = {
    version: VERSION,
    register: enregistrerIntegre,
    /* 🆕 v1.7.648 — le sélecteur d'image, exposé pour la trappe. Le panneau en a
       besoin AVANT qu'un plug-in tourne : c'est un champ de son formulaire, pas un
       appel du plug-in. Il délègue à la même fonction que `api.imageDataUrl`, donc
       un seul comportement pour les deux chemins. */
    imageDataUrl: function () { return creerApi({ id: 'panneau', name: 'Panneau', options: [] }).imageDataUrl(); },
    list: liste,
    get: function (id) { chargerTous(); return MANIFESTES[id] || null; },
    run: executer,
    valider: valider,
    installerSource: installerSource,
    /* ⚠️ DEUX ORTHOGRAPHES, ET C'EST VOLONTAIRE.
       La clé publique a été publiée « definerActif » (sans le second « i ») en
       1.7.642 ; le nom interne, lui, est bien `definirActif`. Un premier essai
       d'interrupteur a appelé la forme correcte et s'est brisé sur « is not a
       function » — MESURÉ, et c'est exactement le genre de faute qu'une relecture
       ne voit pas, puisqu'elle se lit comme une faute de frappe dans un éditeur
       qui ne colore pas les clés d'objet. On garde donc l'ancienne clé pour ne
       rien casser, et on expose la bonne. */
    definerActif: definirActif,   // orthographe historique (1.7.642)
    definirActif: definirActif,   // orthographe correcte
    desinstaller: desinstaller,
    recharger: function () { MANIFESTES = {}; chargerTous(); return liste(); }
  };
})();
