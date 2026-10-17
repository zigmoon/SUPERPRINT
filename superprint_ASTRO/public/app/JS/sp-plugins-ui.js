/* ═══════════════════════════════════════════════════════════════════════════════
   SUPERPRINT — PANNEAU PLUG-INS  (v1.7.654)
   ═══════════════════════════════════════════════════════════════════════════════

   DEUX SURFACES, ET C'EST VOULU :

     · la BIBLIOTHÈQUE est une pop-in — on y installe, on supprime, on allume ou
       on éteint. Elle n'a pas besoin de voir la page : elle gère des fichiers.
       ⚠️ v1.7.654 — ELLE NE FILTRE PLUS. La barre « Tous / 7 jours / 30 jours /
       intégrés » a été retirée sur demande : elle découpait une liste qui tient à
       l'écran. La date d'installation reste écrite sur chaque carte.

     · l'EXÉCUTION est une TRAPPE (`#pluginPanel`), comme « Global Refactor ».
       Un plug-in se règle en REGARDANT son effet : la trappe pousse l'interface
       au lieu de la recouvrir, donc la page reste visible. Demande utilisateur :
       « quand on utilise un plug-in via Utiliser, il doit arriver sous forme de
       trappe side barre de droite ».

   ⚠️ LES RÉGLAGES SONT DÉCLARÉS PAR LE PLUG-IN, LE FORMULAIRE EST CONSTRUIT ICI.
   Un plug-in ne fabrique jamais son propre DOM : il décrit ses options et le
   panneau les rend avec les classes de la maison — celles de « Global Refactor »,
   pour que les deux trappes se lisent d'un seul tenant. Un plug-in ne peut donc
   pas casser l'interface, et il hérite du thème clair comme du sombre.
   ─────────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var ID_MODAL = 'spPluginsModal';

  function el(tag, style, texte) {
    var e = document.createElement(tag);
    if (style) e.setAttribute('style', style);
    if (texte !== undefined) e.textContent = texte;
    return e;
  }

  /* ⚠️ v1.7.654 — `el()` PREND UN STYLE, PAS UNE CLASSE. Et ça s'était vu.
     MESURÉ : `el('div', 'sp-pl-aide', …)` posait `style="sp-pl-aide"` — une
     déclaration invalide, donc ignorée par le navigateur. Résultat : les textes
     d'aide des plug-ins s'affichaient SANS leur style (9 px gris), et la valeur
     chiffrée que cette livraison ajoute aux tirettes n'aurait pas eu le sien non
     plus. Ce raccourci nomme donc la classe pour de bon. */
  function elC(tag, classe, texte) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texte !== undefined) e.textContent = texte;
    return e;
  }

  /* Traduction avec repli : `translate()` renvoie la clé elle-même quand elle
     n'existe pas, ce qui afficherait « pluginsUse » à l'écran. On garde donc un
     texte français en second, et on ne l'utilise que si la clé a échoué. */
  function texte(k, repli) {
    try {
      if (typeof window.translate === 'function') {
        var t = window.translate(k);
        if (t && t !== k) return t;
      }
    } catch (_) {}
    return repli;
  }

  /* ── Pop-in de la DA SuperPrint (carré, en-tête 56 px, croix) ─────────────── */
  function creerModal(titre, largeurPx) {
    var ancien = document.getElementById(ID_MODAL);
    if (ancien && ancien.parentNode) ancien.parentNode.removeChild(ancien);

    var voile = el('div', '');
    voile.className = 'sp-pl-voile';
    voile.id = ID_MODAL;

    /* ⚠️ `sp-modal-card` ET `sp-pl-carte` ENSEMBLE. La première porte l'ombre et
       la police de toutes les pop-in du produit ; la seconde porte les couleurs,
       avec sa variante sombre. Les deux classes cohabitent — une affectation de
       `className` écrase, donc on les écrit dans la MÊME chaîne. */
    var carte = el('div', 'width:' + (largeurPx || 640) + 'px;');
    carte.className = 'sp-modal-card sp-pl-carte';

    var entete = el('div', '');
    entete.className = 'sp-pl-entete';
    var titreEl = el('div', '', titre);
    titreEl.className = 'sp-pl-titre';
    entete.appendChild(titreEl);

    var croix = el('button', '', '✕');
    croix.type = 'button';
    croix.className = 'sp-pl-croix';
    croix.setAttribute('aria-label', 'Fermer');
    croix.addEventListener('click', fermer);
    entete.appendChild(croix);

    var corps = el('div', '');
    corps.className = 'sp-pl-corps';

    carte.appendChild(entete);
    carte.appendChild(corps);
    voile.appendChild(carte);
    document.body.appendChild(voile);
    /* Le fond NE FERME PAS : même règle que les autres pop-in — un clic à côté
       fait clignoter le carton au lieu d'abandonner une installation en cours. */
    voile.addEventListener('click', function (ev) {
      if (ev.target !== voile) return;
      ev.stopPropagation();
      carte.classList.remove('sp-nudge');
      void carte.offsetWidth;
      carte.classList.add('sp-nudge');
    });
    function fermer() {
      if (voile.parentNode) voile.parentNode.removeChild(voile);
      document.removeEventListener('keydown', surTouche);
    }
    function surTouche(e) { if (e.key === 'Escape') fermer(); }
    document.addEventListener('keydown', surTouche);
    return { voile: voile, carte: carte, corps: corps, entete: entete, fermer: fermer };
  }

  /* ── Bouton compact de la DA (26 px, mono 9 px) ───────────────────────────── */
  function petitBouton(libelle, principal) {
    var b = el('button', '', libelle);
    b.type = 'button';
    b.className = 'sp-pl-btn' + (principal ? ' principal' : '');
    return b;
  }

  /* Icône corbeille dessinée, pas un emoji : même graisse que les autres traits
     de l'interface, et nette en thème sombre. */
  function iconeCorbeille() {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', '13'); s.setAttribute('height', '13');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.7'); s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.innerHTML = '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6"/>';
    return s;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     CHAMPS DE RÉGLAGE — rendus avec les classes de la trappe
     ══════════════════════════════════════════════════════════════════════════ */
  function champ(option, valeurs) {
    var ligne = el('div', 'padding:0 12px;margin-bottom:5px;');
    var id = 'spPluginOpt_' + option.key;

    /* ═══ v1.7.654 — LE GRAND APERÇU ═══════════════════════════════════════
       Demande utilisateur : « une preview plus grand de mon image ou de mes
       images ». Un motif ne se juge pas sur une vignette de 28 px : ce champ pose
       une TOILE de la largeur de la trappe, et le plug-in y dessine lui-même la
       tuile qu'il s'apprête à répéter. C'est donc la même géométrie que le dessin
       final, à l'échelle — pas une illustration séparée qui pourrait mentir.
       La toile est enregistrée dans `trappe.toile` et publiée par
       `window.__SP_PLUGIN_TRAP__` (voir plus bas) : `sp-plugins.js` la sert au
       plug-in par `api.toileApercu()`. Le plug-in qui n'en veut pas n'a qu'à ne
       pas déclarer ce champ. */
    if (option.type === 'apercu') {
      var boite = el('div', 'padding:0 12px 8px;');
      var toile = document.createElement('canvas');
      toile.className = 'sp-pl-apercu-grand';
      /* 632 = 316 px utiles × 2 : la trappe fait 340 px de large, moins 12 px de
         marge de chaque côté. Deux fois, pour que le dessin soit net sur un écran
         à densité doublée — la taille d'affichage, elle, reste 100 % de la largeur. */
      toile.width = 632;
      toile.height = Math.round(632 * (typeof option.ratio === 'number' ? option.ratio : 1.414));
      boite.appendChild(toile);
      ligne.appendChild(boite);
      return { ligne: ligne, champ: null, option: option, toile: toile };
    }

    /* ═══ v1.7.654 — LE MIXEUR D'IMAGES ════════════════════════════════════
       Demande utilisateur : « une preview plus grand de mon image ou de mes
       images (un mixer ?) ». Ce champ porte un TABLEAU de dataURL : on en ajoute
       autant qu'on veut, chacune se retire par sa croix, et le plug-in les
       mélange comme il l'entend (le Motif les superpose avec un mode de fusion).
       La valeur vit dans `valeurs[key]` — un tableau, jamais une chaîne : c'est
       ce qui le distingue du champ « image » simple, et c'est ce que `lireValeur`
       renvoie pour un plug-in qui déclare ce type. */
    if (option.type === 'images') {
      if (!Array.isArray(valeurs[option.key])) valeurs[option.key] = [];
      var liste = valeurs[option.key];
      var rappels = [];
      var boiteI = el('div', '');

      var grille = elC('div', 'sp-pl-images-grille');
      boiteI.appendChild(grille);

      function prevenir() { rappels.forEach(function (f) { try { f(); } catch (_) {} }); }

      function redessiner() {
        grille.innerHTML = '';
        if (!liste.length) {
          grille.appendChild(elC('div', 'sp-pl-images-vide', texte('pluginsNoImage', 'Aucune image')));
        } else {
          liste.forEach(function (url, i) {
            var v = elC('div', 'sp-pl-vignette');
            v.style.backgroundImage = 'url("' + url + '")';
            var x = elC('button', 'sp-pl-vignette-x', '×');
            x.type = 'button';
            x.title = texte('pluginsClearImage', 'Retirer l\'image');
            x.addEventListener('click', function () {
              liste.splice(i, 1);
              redessiner();
              prevenir();
            });
            v.appendChild(x);
            grille.appendChild(v);
          });
        }
      }
      redessiner();

      var bAjout = petitBouton(texte('pluginsAddImage', '+ Image'), false);
      bAjout.type = 'button';
      bAjout.addEventListener('click', function () {
        var p = (window.SPPlugins && window.SPPlugins.imageDataUrl) ? window.SPPlugins.imageDataUrl() : Promise.resolve(null);
        p.then(function (url) {
          if (!url) return;
          liste.push(url);
          redessiner();
          prevenir();
        });
      });
      boiteI.appendChild(bAjout);
      ligne.appendChild(boiteI);
      if (option.aide) ligne.appendChild(elC('div', 'sp-pl-aide', option.aide));
      return {
        ligne: ligne, champ: null, option: option, valeurs: valeurs,
        rafraichir: function (f) { if (typeof f === 'function') rappels.push(f); }
      };
    }

    if (option.type === 'checkbox') {
      var lab = el('label', '');
    lab.className = 'sp-pl-case';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = id;
      cb.checked = !!option.defaut;
      cb.style.cssText = 'width:14px;height:14px;accent-color:#111;cursor:pointer;flex:0 0 auto;';
      lab.appendChild(cb);
      lab.appendChild(el('span', '', option.label));
      ligne.appendChild(lab);
      if (option.aide) ligne.appendChild(elC('div', 'sp-pl-aide', option.aide));
      return { ligne: ligne, champ: cb, option: option };
    }

    var lib = el('label', '', option.label);
    lib.className = 'sp-pl-label';
    lib.setAttribute('for', id);
    ligne.appendChild(lib);

    var v;
    /* La valeur chiffrée d'une tirette, à droite du libellé. Créée avant le champ
       pour pouvoir être mise à jour par son écouteur juste en dessous. */
    var lecture = null;
    if (option.type === 'range' || option.type === 'number') {
      lecture = elC('span', 'sp-pl-valeur', String(option.defaut !== undefined ? option.defaut : 0) + (option.unite || ''));
      lib.appendChild(lecture);
    }

    if (option.type === 'select') {
      v = el('select', '');
      v.className = 'sp-pl-input';
      (option.choix || []).forEach(function (c) {
        var o = document.createElement('option');
        if (c && typeof c === 'object') { o.value = c.value; o.textContent = c.label || c.value; }
        else { o.value = c; o.textContent = c; }
        v.appendChild(o);
      });
      if (option.defaut !== undefined && option.defaut !== '') v.value = String(option.defaut);
    } else if (option.type === 'color') {
      v = document.createElement('input');
      v.type = 'color';
      v.className = 'sp-pl-input';
      v.value = option.defaut || '#1a1a1a';
    } else if (option.type === 'image') {
      /* L'image n'est pas un champ : c'est un bouton qui rend une dataURL. */
      var boite = el('div', 'display:flex;align-items:center;gap:8px;min-height:28px;');
      var apercu = el('div', 'background-position:center;background-size:contain;background-repeat:no-repeat;');
      apercu.className = 'sp-pl-apercu';
      if (valeurs && valeurs[option.key]) apercu.style.backgroundImage = 'url("' + valeurs[option.key] + '")';
      var bImg = petitBouton(texte('pluginsChooseImage', 'Image'), false);
      var etat = el('span', 'font-size:9px;color:#999;font-family:"IBM Plex Mono",monospace;', '—');
      /* 🆕 v1.7.654 — l'aperçu doit RELANCER le plug-in quand l'image change.
         Le bouton n'émet aucun événement natif : on publie donc un rappel, que la
         trappe branche sur l'aperçu en direct. Sans lui, choisir une image ne
         montrait rien tant qu'on n'avait pas cliqué « Appliquer » — exactement le
         défaut que l'aperçu en direct est censé supprimer. */
      var rappels = [];
      bImg.addEventListener('click', function () {
        var p = (window.SPPlugins && window.SPPlugins.imageDataUrl) ? window.SPPlugins.imageDataUrl() : Promise.resolve(null);
        p.then(function (url) {
          if (!url) return;
          valeurs[option.key] = url;
          apercu.style.backgroundImage = 'url("' + url + '")';
          etat.textContent = texte('pluginsImageLoaded', 'chargée');
          rappels.forEach(function (f) { try { f(); } catch (_) {} });
        });
      });
      /* Effacer l'image : on doit pouvoir revenir à la forme géométrique sans
         recharger un fichier. */
      var bEffacer = petitBouton('✕', false);
      bEffacer.type = 'button';
      bEffacer.title = texte('pluginsClearImage', 'Retirer l\'image');
      bEffacer.addEventListener('click', function () {
        valeurs[option.key] = '';
        apercu.style.backgroundImage = '';
        etat.textContent = '—';
        rappels.forEach(function (f) { try { f(); } catch (_) {} });
      });
      boite.appendChild(apercu); boite.appendChild(bImg); boite.appendChild(bEffacer); boite.appendChild(etat);
      ligne.appendChild(boite);
      if (option.aide) ligne.appendChild(elC('div', 'sp-pl-aide', option.aide));
      return {
        ligne: ligne, champ: null, option: option, valeurs: valeurs,
        rafraichir: function (f) { if (typeof f === 'function') rappels.push(f); }
      };
    } else if (option.type === 'range') {
      v = document.createElement('input');
      v.type = 'range';
      v.className = 'sp-pl-input';
      if (option.min !== undefined) v.min = option.min;
      if (option.max !== undefined) v.max = option.max;
      if (option.pas !== undefined) v.step = option.pas;
      v.value = (option.defaut !== undefined) ? option.defaut : 0;
    } else if (option.type === 'number') {
      v = document.createElement('input');
      v.type = 'number';
      v.className = 'sp-pl-input';
      if (option.min !== undefined) v.min = option.min;
      if (option.max !== undefined) v.max = option.max;
      if (option.pas !== undefined) v.step = option.pas;
      v.value = (option.defaut !== undefined) ? option.defaut : '';
    } else {
      v = document.createElement('input');
      v.type = 'text';
      v.className = 'sp-pl-input';
      v.value = (option.defaut !== undefined) ? option.defaut : '';
    }
    v.id = id;
    ligne.appendChild(v);
    if (lecture) {
      var _majLecture = function () { lecture.textContent = String(v.value) + (option.unite || ''); };
      v.addEventListener('input', _majLecture);
      v.addEventListener('change', _majLecture);
      _majLecture();
    }
    if (option.aide) ligne.appendChild(elC('div', 'sp-pl-aide', option.aide));
    return { ligne: ligne, champ: v, option: option };
  }

  function lireValeur(desc) {
    var o = desc.option, c = desc.champ;
    if (o.type === 'image') return (desc.valeurs && desc.valeurs[o.key]) || '';
    if (o.type === 'images') {
      var l = desc.valeurs && desc.valeurs[o.key];
      return Array.isArray(l) ? l.slice() : [];
    }
    if (o.type === 'apercu') return null;
    if (!c) return o.defaut;
    if (o.type === 'checkbox') return !!c.checked;
    if (o.type === 'number' || o.type === 'range') {
      var n = parseFloat(c.value);
      return isFinite(n) ? n : (typeof o.defaut === 'number' ? o.defaut : 0);
    }
    return c.value;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     TRAPPE D'EXÉCUTION
     ══════════════════════════════════════════════════════════════════════════ */
  var trappe = { id: null, champs: [], valeurs: {}, occupe: false };

  /* ⚠️ v1.7.654 — L'APERÇU EN DIRECT.
     Demande utilisateur : « pourquoi et temps réel c'est-à-dire que je n'ai pas
     besoin de faire apply à chaque fois pour visualiser les modifications ».
     Chaque champ relance donc le plug-in, 140 ms après le dernier mouvement (assez
     pour ne pas relancer pendant qu'on fait glisser une tirette, assez court pour
     que ce soit perçu comme instantané).

     ⚠️ TROIS DRAPEAUX, ET CHACUN CORRIGE UN DÉFAUT RÉEL :
       · `apercuEnCours` — un plug-in peut être lent (le kaléidoscope relit la page).
         Sans lui, trois mouvements de tirette lancent trois exécutions concurrentes,
         et la DERNIÈRE arrivée n'est pas forcément la dernière demandée : le dessin
         affiché ne correspond plus aux réglages.
       · `apercuEnAttente` — un mouvement arrivé pendant une exécution ne doit pas
         être perdu : on le rejoue à la fin, une seule fois.
       · `aValider` — savoir s'il reste un aperçu non enregistré. C'est ce qui permet
         de n'écrire qu'UNE entrée d'historique, et de la fermeture comme de la
         validation. */
  var apercuEnCours = false;
  var apercuEnAttente = false;
  var aValider = false;
  var minuteurApercu = null;

  function valeursTrappe() {
    var vals = {};
    trappe.champs.forEach(function (d) { vals[d.option.key] = lireValeur(d); });
    return vals;
  }

  function nomPlugIn() {
    var p = trappe.id ? window.SPPlugins.get(trappe.id) : null;
    return p ? p.name : 'Plug-in';
  }

  /* Écrit l'entrée d'historique UNE fois, quel que soit le nombre d'aperçus. */
  function validerApercu(silencieux) {
    if (!aValider || !trappe.id) {
      if (!silencieux) trappeEtat(texte('pluginsNothingToApply', 'Rien à enregistrer'));
      return;
    }
    aValider = false;
    var ok = false;
    try { ok = window.SPPlugins.valider('Plug-in : ' + nomPlugIn()); } catch (_) { ok = false; }
    trappeEtat(ok ? texte('pluginsSaved', 'Enregistré — Ctrl+Z pour annuler')
                  : texte('pluginsFailed', 'Échec'));
  }

  function lancerApercu() {
    if (!trappe.id) return;
    if (minuteurApercu) { clearTimeout(minuteurApercu); minuteurApercu = null; }
    minuteurApercu = setTimeout(function () {
      minuteurApercu = null;
      if (apercuEnCours) { apercuEnAttente = true; return; }
      apercuEnCours = true;
      trappeEtat(texte('pluginsPreviewing', 'Aperçu…'));
      Promise.resolve()
        .then(function () { return window.SPPlugins.run(trappe.id, valeursTrappe(), { apercu: true }); })
        .then(function () {
          aValider = true;
          trappeEtat(texte('pluginsPreview', 'Aperçu en direct'));
        })
        .catch(function (e) {
          trappeEtat(texte('pluginsFailed', 'Échec') + (e && e.message ? ' — ' + e.message : ''));
        })
        .then(function () {
          apercuEnCours = false;
          if (apercuEnAttente) { apercuEnAttente = false; lancerApercu(); }
        });
    }, 140);
  }

  /* Branche l'aperçu sur TOUS les champs de la trappe. `input` couvre les
     tirettes et les champs texte, `change` les listes et les cases à cocher ;
     on écoute les deux, le minuteur absorbe le doublon. */
  function brancherApercu() {
    trappe.champs.forEach(function (d) {
      if (!d || !d.champ) return;
      ['input', 'change'].forEach(function (n) {
        d.champ.addEventListener(n, lancerApercu);
      });
    });
    /* Le sélecteur d'image ne déclenche pas d'événement natif : il appelle une
       promesse. `champ()` pose la valeur dans `trappe.valeurs` ; on surveille donc
       ce changement par un rappel, plutôt que d'inventer un événement. */
    trappe.champs.forEach(function (d) {
      if (d && d.option && d.option.type === 'image' && d.rafraichir) {
        d.rafraichir(lancerApercu);
      }
    });
  }

  function trappeEls() {
    return {
      panneau: document.getElementById('pluginPanel'),
      titre: document.getElementById('pluginPanelTitle'),
      corps: document.getElementById('pluginPanelBody'),
      etat: document.getElementById('pluginPanelEtat'),
      retour: document.getElementById('pluginPanelRetour'),
      appliquer: document.getElementById('pluginPanelAppliquer'),
      fermer: document.getElementById('pluginPanelClose')
    };
  }

  function trappeEtat(msg) {
    var e = trappeEls().etat;
    if (e) e.textContent = msg || '';
  }

  /* Publier la largeur des DEUX trappes : le widget de zoom et les encarts
     flottants s'y accrochent. Sans cet appel, ils resteraient sous le panneau. */
  function publier() {
    try { if (typeof window.spPublierLargeursPanneauxDroits === 'function') window.spPublierLargeursPanneauxDroits(); } catch (_) {}
  }

  function fermerTrappe() {
    var t = trappeEls();
    if (!t.panneau || !t.panneau.classList.contains('ouvert')) return;
    t.panneau.classList.remove('ouvert');
    t.panneau.setAttribute('aria-hidden', 'true');
    publier();
  }

  function ouvrirTrappe() {
    var t = trappeEls();
    if (!t.panneau) return;
    /* ⚠️ UNE SEULE TRAPPE À LA FOIS. « Global Refactor » et un plug-in occupent le
       même bord droit ; ouvertes ensemble, elles prennent 680 px et poussent le
       plan de travail hors de l'écran. On referme Global Refactor par SON bouton —
       il sait alors rendre l'aperçu et l'historique à leur état, ce qu'un simple
       retrait de classe ne ferait pas. */
    try {
      var mq = document.getElementById('maquettePanel');
      if (mq && mq.classList.contains('ouvert')) {
        var cb = document.getElementById('maquetteClose');
        if (cb) cb.click();
      }
    } catch (_) {}
    t.panneau.classList.add('ouvert');
    t.panneau.setAttribute('aria-hidden', 'false');
    publier();
  }

  /* Remplit la trappe pour un plug-in donné. Le formulaire est reconstruit à
     chaque ouverture : un plug-in rouvert montre ses valeurs par défaut, pas
     celles de l'exécution précédente. */
  function remplirTrappe(id) {
    var p = window.SPPlugins.get(id);
    var t = trappeEls();
    if (!p || !t.corps) return false;
    trappe.id = id;
    trappe.champs = [];
    trappe.valeurs = {};
    trappe.occupe = false;

    if (t.titre) t.titre.textContent = p.name + '  ·  v' + p.version;
    t.corps.innerHTML = '';
    /* ⚠️ v1.7.654 — LA DESCRIPTION DU PLUG-IN N'EST PLUS RÉPÉTÉE DANS LA TRAPPE.
       Demande utilisateur : « il y a beaucoup trop de texte d'info partout ».
       Elle est déjà sur la carte de la bibliothèque, où elle sert à choisir le
       plug-in ; ici, on a déjà choisi. La reprendre en tête de trappe repoussait
       les réglages d'une trentaine de pixels vers le bas, pour une phrase qu'on
       vient de lire. */
    if (!(p.options || []).length) {
      t.corps.appendChild(el('div', 'padding:0 12px 12px;font-size:10px;color:#999;',
        texte('pluginsNoOptions', 'Ce plug-in n\'a aucun réglage.')));
    }
    trappe.toile = null;
    (p.options || []).forEach(function (o) {
      var d = champ(o, trappe.valeurs);
      trappe.champs.push(d);
      t.corps.appendChild(d.ligne);
      if (d.toile) trappe.toile = d.toile;
      /* « images » a déjà posé son tableau ; « aperçu » n'a pas de valeur. */
      if (o.type !== 'image' && o.type !== 'images' && o.type !== 'apercu') trappe.valeurs[o.key] = o.defaut;
    });
    if (t.appliquer) {
      t.appliquer.disabled = !(p.options || []).length;
      t.appliquer.textContent = texte('pluginsApplySave', 'Enregistrer');
      t.appliquer.title = texte('pluginsApplyHint', 'Crée le point d\'annulation — Ctrl+Z revient à l\'état d\'avant.');
    }
    aValider = false;
    apercuEnCours = false;
    apercuEnAttente = false;
    if (minuteurApercu) { clearTimeout(minuteurApercu); minuteurApercu = null; }
    trappeEtat((p.options || []).length ? texte('pluginsLivePreview', 'Aperçu en direct — modifiez, le résultat est immédiat')
                                       : '');
    brancherApercu();
    /* On dessine tout de suite : sans cela, ouvrir la trappe ne montrerait rien
       tant qu'on n'a pas touché un champ, et l'utilisateur croirait l'outil inerte. */
    if ((p.options || []).length) lancerApercu();
    return true;
  }

  function brancherTrappe() {
    var t = trappeEls();
    if (!t.panneau || t.panneau.dataset.pret) return;
    t.panneau.dataset.pret = '1';

    if (t.fermer) t.fermer.addEventListener('click', function () {
      /* Fermer ne perd rien : ce qui est à l'écran a été vu, donc il est enregistré.
         Les réglages sont conservés pour la prochaine ouverture — c'est le même
         document, et re-régler un motif à chaque fois serait hostile. */
      validerApercu(true);
      fermerTrappe();
    });
    if (t.retour) t.retour.addEventListener('click', function () {
      validerApercu(true);
      fermerTrappe();
      ouvrirPanneau();
    });

    /* ⚠️ v1.7.654 — « ENREGISTRER » N'EXÉCUTE PLUS LE PLUG-IN.
       L'aperçu l'a déjà fait, et une exécution de plus écraserait le dessin par un
       état identique en apparence — mais avec un nouveau tirage de hasard si la
       graine avait changé entre-temps. Ce bouton ne fait donc qu'une chose :
       écrire l'entrée d'historique. */
    if (t.appliquer) t.appliquer.addEventListener('click', function () {
      validerApercu(false);
    });
  }
  /* ══════════════════════════════════════════════════════════════════════════
     BIBLIOTHÈQUE (pop-in)
     ══════════════════════════════════════════════════════════════════════════
     ⚠️ v1.7.654 — PLUS DE BARRE DE FILTRES. Demande utilisateur : « supprime toute
     cette ligne de filtre All 2 / 7 days / 30 days / built-in 2 ».
     Elle coûtait 28 px de haut sur une liste qui en fait 83 par carte, pour
     découper une liste qui tient à l'écran — deux plug-ins livrés, et le plus
     souvent un ou deux ajoutés. Un filtre qui ne filtre presque rien ne rend pas
     service : il ajoute une décision avant chaque coup d'œil.
     `filtrer`, `chipFiltre` et `joursDepuis` sont retirés avec elle, et non
     laissés en place : du code mort qui reference un état disparu se relit comme
     une fonctionnalité qu'on aurait oublié de brancher.
     La DATE d'installation reste affichée sur chaque carte : c'est l'information
     qui manquerait vraiment, et elle ne prend aucune décision à la place de
     l'utilisateur. */

  function dateCourte(ts) {
    if (!ts) return '';
    try {
      var d = new Date(Number(ts));
      var lang = document.documentElement.lang || 'fr';
      var loc = lang === 'fr' ? 'fr-FR' : (lang === 'ja' ? 'ja-JP' : 'en-GB');
      return d.toLocaleDateString(loc, { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (_) { return ''; }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     INTERRUPTEUR D'ACTIVATION
     ══════════════════════════════════════════════════════════════════════════
     Demandé : « sur chaque plug-in activé/désactivé, plus que USE ».
     Un interrupteur, et non une case à cocher : il a deux états et un seul geste,
     et son dessin dit lequel est le courant sans lire de libellé.
     ⚠️ `role="switch"` ET `aria-checked` : un `<button>` stylé en interrupteur
     reste annoncé comme un bouton par un lecteur d'écran, et l'état n'est alors
     porté par RIEN. Les deux attributs sont donc posés, et l'étiquette dit
     l'action à venir (« Désactiver X »), pas l'état courant. */
  function interrupteur(p, m) {
    var b = el('button', '');
    b.type = 'button';
    b.className = 'sp-pl-switch' + (p.actif ? ' on' : '');
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', p.actif ? 'true' : 'false');
    var libelle = (p.actif ? texte('pluginsDeactivate', 'Désactiver') : texte('pluginsActivate', 'Activer')) + ' ' + p.name;
    b.title = libelle;
    b.setAttribute('aria-label', libelle);
    b.appendChild(el('span', '')).className = 'sp-pl-switch-piste';
    b.appendChild(el('span', '')).className = 'sp-pl-switch-bouton';
    /* ⚠️ L'ÉTAT ÉCRIT EST DANS LE BOUTON, PAS À CÔTÉ. Posé comme frère, il aurait
       changé la largeur de la colonne d'actions d'une carte à l'autre (« on » et
       « off » n'ont pas la même longueur) et fait danser les boutons Use. Ici il
       occupe une largeur fixe, et son texte ne participe pas au calcul du nom
       accessible — `aria-label` porte déjà l'action. */
    b.appendChild(el('span', '', p.actif ? 'on' : 'off')).className = 'sp-pl-switch-etat';
    b.addEventListener('click', function () {
      var actif = !p.actif;
      try { window.SPPlugins.definirActif(p.id, actif); } catch (e) {
        var _m = texte('pluginsToggleFail', 'Changement impossible : ') + e.message; try { window.spAlert(_m); } catch (_) { alert(_m); }
        return;
      }
      /* ⚠️ DÉSACTIVER FERME CE QUI TOURNE. Laisser la trappe d'un plug-in qu'on
         vient d'éteindre, c'est laisser à l'écran un outil que la bibliothèque
         déclare hors service — et pour « Global Refactor », un aperçu en direct
         qui modifie le document sans plus aucune porte pour le refermer.
         On ferme par le bouton du panneau concerné, pour que l'annulation de
         l'aperçu et la restitution de l'historique soient faites correctement.
         À l'ACTIVATION on ne touche à rien : il n'y a rien à refermer. */
      if (!actif) {
        try {
          if (p.trappe) {
            var cb = document.getElementById('maquetteClose');
            var panneau = document.getElementById(p.trappe);
            if (cb && panneau && panneau.classList.contains('ouvert')) cb.click();
          }
          if (trappe.id === p.id) fermerTrappe();
        } catch (_) {}
      }
      m.fermer();
      ouvrirPanneau();
      /* 🆕 v1.7.654 — L'ICÔNE DE LA BARRE DU HAUT SUIT L'INTERRUPTEUR. Sans cet
         appel, éteindre un plug-in laissait son icône dans la barre : elle ouvrait
         un outil que la bibliothèque venait de déclarer hors service. */
      actualiserBarrePlugIns();
      try {
        window.spShowToast(p.name + ' — ' + (actif ? texte('pluginsActivated', 'activé') : texte('pluginsDeactivated', 'désactivé')),
          { kind: 'info', duration: 2400 });
      } catch (_) {}
    });
    return b;
  }

  function carte(p, m) {
    var d = el('div', '');
    /* ⚠️ L'ÉTAT EST DANS LA CLASSE, PAS DANS UN STYLE. La carte éteinte doit être
       visiblement en retrait (icône et titre grisés) sans changer sa géométrie :
       une carte qui rétrécit ferait sauter la liste d'un pixel à chaque bascule. */
    d.className = 'sp-pl-item' + (p.actif ? '' : ' sp-pl-inactif');
    d.appendChild(el('div', '', p.icon || '◆')).className = 'sp-pl-icon';

    var centre = el('div', 'flex:1 1 auto;min-width:0;');
    var haut = el('div', 'display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;');
    haut.appendChild(el('span', '', p.name)).className = 'sp-pl-nom';
    haut.appendChild(el('span', '', 'v' + p.version)).className = 'sp-pl-vers';
    if (p.integre) {
      haut.appendChild(el('span', '', texte('pluginsBuiltin', 'intégré'))).className = 'sp-pl-badge';
    } else {
      var dt = dateCourte(p.installe);
      if (dt) haut.appendChild(el('span', '', dt)).className = 'sp-pl-date';
    }
    /* L'état écrit, en plus de l'interrupteur : la carte éteinte se lit sans
       interpréter la position d'un dessin. */
    if (!p.actif) haut.appendChild(el('span', '', texte('pluginsInactive', 'désactivé'))).className = 'sp-pl-badge sp-pl-badge-off';
    centre.appendChild(haut);

    if (p.description) centre.appendChild(el('div', '', p.description)).className = 'sp-pl-desc';
    /* Un plug-in qui apporte sa propre trappe n'a pas de formulaire : annoncer
       « 0 réglage(s) » serait faux — il en a, ils sont dans son panneau. */
    var meta = p.trappe
      ? texte('pluginsOwnTrap', 'trappe dédiée')
      : (p.options || []).length + ' ' + texte('pluginsSettings', 'réglage(s)');
    if (p.author) meta += '  ·  ' + p.author;
    centre.appendChild(el('div', '', meta)).className = 'sp-pl-meta';
    d.appendChild(centre);

    var actions = el('div', '');
    actions.className = 'sp-pl-actions';

    actions.appendChild(interrupteur(p, m));

    /* 🆕 v1.7.654 — « UTILISER » EST UNE GÉLULE, SANS FLÈCHE (cf. `.sp-pl-use`).
       La flèche a été retirée : elle allongeait le bouton de 12 px pour redire ce
       que le mot dit déjà. Le libellé seul se lit d'un coup d'œil. */
    var bUtiliser = el('button', '');
    bUtiliser.type = 'button';
    bUtiliser.className = 'sp-pl-use';
    bUtiliser.textContent = texte('pluginsUse', 'Utiliser');
    /* ⚠️ « UTILISER » S'ÉTEINT AVEC LE PLUG-IN, IL NE DISPARAÎT PAS. Le retirer
       ferait sauter la colonne d'un cran et l'utilisateur chercherait le bouton
       qu'il voyait à l'instant. Désactivé, il reste à sa place, et le registre
       refuse de toute façon l'exécution (cf. `executer`). */
    if (!p.actif) {
      bUtiliser.disabled = true;
      bUtiliser.title = texte('pluginsInactiveHint', 'Réactivez le plug-in pour l\'utiliser.');
    }
    bUtiliser.addEventListener('click', function () { m.fermer(); ouvrirTrappePlugIn(p.id); });
    actions.appendChild(bUtiliser);

    /* Corbeille : uniquement pour les plug-ins INSTALLÉS. Un plug-in intégré fait
       partie du produit — le retirer supprimerait une fonction, pas une extension. */
    if (!p.integre) {
      var bSuppr = el('button', '');
      bSuppr.type = 'button';
      bSuppr.className = 'sp-pl-corbeille';
      bSuppr.title = texte('pluginsDelete', 'Désinstaller');
      bSuppr.setAttribute('aria-label', texte('pluginsDelete', 'Désinstaller'));
      bSuppr.appendChild(iconeCorbeille());
      bSuppr.addEventListener('click', function () {
        var q = texte('pluginsConfirmDelete', 'Désinstaller « {0} » ? Le fichier reste où il est ; il sera simplement retiré de SuperPrint.')
          .replace('{0}', p.name);
        var suite = function (ok) {
          if (!ok) return;
          try {
            window.SPPlugins.desinstaller(p.id);
            if (trappe.id === p.id) fermerTrappe();
            ouvrirPanneau();
            /* 🆕 v1.7.654 — l'icône du plug-in désinstallé doit quitter la barre. */
            actualiserBarrePlugIns();
            try { window.spShowToast(p.name + ' — ' + texte('pluginsDeleted', 'désinstallé'), { kind: 'info', duration: 2600 }); } catch (_) {}
          } catch (e) {
            var _m2 = texte('pluginsDeleteFail', 'Suppression impossible : ') + e.message; try { window.spAlert(_m2); } catch (_) { alert(_m2); }
          }
        };
        try {
          if (typeof window.spConfirm === 'function') window.spConfirm(q, { type: 'warn' }).then(suite);
          else suite(window.confirm(q));
        } catch (_) { suite(window.confirm(q)); }
      });
      actions.appendChild(bSuppr);
    }

    d.appendChild(actions);
    return d;
  }

  function ouvrirPanneau() {
    var tous = (window.SPPlugins ? window.SPPlugins.list() : []);
    var m = creerModal(texte('pluginsTitle', 'Plug-ins SuperPrint'), 660);

    /* ── Zone de dépôt ── */
    var zone = el('div', '');
    zone.className = 'sp-pl-zone';
    var zt = el('div', '', texte('pluginsDropHere', 'Déposez un fichier .plugin.js ici, ou cliquez pour le choisir'));
    zt.className = 'sp-pl-zone-titre';
    var za = el('div', '', texte('pluginsDropHint', 'glisser-déposer  ·  un fichier à la fois'));
    za.className = 'sp-pl-zone-aide';
    zone.appendChild(zt);
    zone.appendChild(za);
    /* Le retour visuel passe par une CLASSE, pas par `style` : en thème sombre un
       fond blanc posé en ligne resterait blanc sous la souris. */
    var survol = function (on) { zone.classList.toggle('survol', !!on); };
    ['dragenter', 'dragover'].forEach(function (n) {
      zone.addEventListener(n, function (e) { e.preventDefault(); e.stopPropagation(); survol(true); });
    });
    zone.addEventListener('dragleave', function (e) { e.preventDefault(); e.stopPropagation(); survol(false); });
    zone.addEventListener('drop', function (e) {
      e.preventDefault(); e.stopPropagation(); survol(false);
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) installerFichier(f);
    });
    zone.addEventListener('click', choisirFichier);
    m.corps.appendChild(zone);

    /* Le glisser-déposer vaut pour TOUTE la fenêtre : viser une bande de 70 px de
       haut serait inutilement précis. On écoute sur le voile, qui couvre l'écran. */
    m.voile.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); survol(true); });
    m.voile.addEventListener('dragleave', function (e) {
      if (e.target === m.voile) survol(false);
    });
    m.voile.addEventListener('drop', function (e) {
      e.preventDefault(); e.stopPropagation(); survol(false);
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) installerFichier(f);
    });

    /* ── Liste ── */
    /* Plus de filtre : la liste est complète, et le pied ne compte donc plus
       « n / n » — un compteur qui affiche toujours le même nombre ne dit rien. */
    var boite = el('div', '');
    boite.className = 'sp-pl-liste';
    if (!tous.length) {
      boite.appendChild(el('div', '', texte('pluginsEmpty', 'Aucun plug-in pour le moment.'))).className = 'sp-pl-vide';
    } else {
      tous.forEach(function (p) { boite.appendChild(carte(p, m)); });
    }
    m.corps.appendChild(boite);

    /* ── Pied ── */
    var pied = el('div', '');
    pied.className = 'sp-pl-pied';
    /* Le pied ne garde QUE la fermeture. Sans le compteur, `justify-content` est
       passé à `flex-end` dans la feuille de style : un `space-between` laisserait
       un vide à gauche qui se lit comme un élément manquant. */
    var bF = petitBouton(texte('close', 'Fermer'), false);
    bF.addEventListener('click', m.fermer);
    pied.appendChild(bF);
    m.carte.appendChild(pied);

    return m;
  }

  function choisirFichier() {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.js,.plugin.js,text/javascript';
    inp.style.display = 'none';
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (f) installerFichier(f);
    });
    document.body.appendChild(inp);
    inp.click();
    setTimeout(function () { if (inp.parentNode) inp.parentNode.removeChild(inp); }, 60000);
  }

  function installerFichier(f) {
    if (!/\.js$/i.test(f.name || '')) {
      var msg = texte('pluginsNotJs', 'Ce fichier n\'est pas un plug-in : un plug-in SuperPrint est un fichier .plugin.js.');
      try { window.spAlert(msg, { title: 'Plug-in' }); } catch (_) { alert(msg); }
      return;
    }
    var r = new FileReader();
    r.onload = function () {
      try {
        var res = window.SPPlugins.installerSource(String(r.result), f.name);
        ouvrirPanneau();
        /* 🆕 v1.7.654 — un plug-in fraîchement installé est actif : sa place dans
           la barre du haut doit apparaître sans attendre un rechargement. */
        actualiserBarrePlugIns();
        try { window.spShowToast(texte('pluginsInstalled', 'Plug-in installé : ') + res.name, { kind: 'info' }); } catch (_) {}
      } catch (e) {
        ouvrirPanneau();
        var m2 = texte('pluginsInstallFail', 'Installation impossible : ') + e.message;
        try { window.spAlert(m2, { title: 'Plug-in' }); } catch (_) { alert(m2); }
      }
    };
    r.readAsText(f);
  }

  /* ── Ouverture de la trappe pour un plug-in donné ─────────────────────────── */
  /* ═══ v1.7.654 — LES ICÔNES DE LA BARRE DU HAUT ═══════════════════════════
     Demande utilisateur : « affiche une icône dans la top nav quand c'est en on
     (global refactor on doit encore l'avoir, elle était dans la top nav avant en
     permanence) ». Un plug-in ALLUMÉ apparaît donc dans la barre du haut ; éteint,
     son icône s'en va.

     ⚠️ POURQUOI CE N'EST PAS UN BOUTON FIXE ÉCRIT DANS `index.html`. La barre du
     haut ne sait pas quels plug-ins existent : les fichiers de `app/plugins/` sont
     chargés de façon asynchrone, et un fichier déposé par l'utilisateur arrive
     encore plus tard. Une icône écrite à la main mentirait donc dès le premier
     plug-in éteint, et n'apparaîtrait jamais pour un plug-in installé.
     On reconstruit la rangée à chaque changement d'état, en repartant de `liste()`.

     ⚠️ LE BOUTON OUVRE LA TRAPPE, PAS LA BIBLIOTHÈQUE. C'est tout l'intérêt : un
     plug-in allumé doit être à UN clic. Passer par la bibliothèque pour retrouver
     « Utiliser » reviendrait à ne pas avoir d'icône du tout.

     ⚠️ UN PLUG-IN SANS ICÔNE VECTORIELLE GARDE SON GLYPHE. Un fichier déposé par
     l'utilisateur n'a pas forcément de dessin : on affiche alors son `icon`
     (n'importe quel caractère), et à défaut un losange. La rangée reste lisible
     dans tous les cas. */
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function boutonBarre(p) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-square sp-pl-topbar-btn';
    b.setAttribute('data-plugin-id', p.id);
    b.title = p.name + (p.trappe ? '' : ' — ' + texte('pluginsOpenTrap', 'Ouvrir le plug-in'));
    b.setAttribute('aria-label', p.name);
    b.style.pointerEvents = 'auto';

    if (p.icone) {
      var s = document.createElementNS(SVG_NS, 'svg');
      s.setAttribute('width', '16');
      s.setAttribute('height', '16');
      s.setAttribute('viewBox', '0 0 24 24');
      s.setAttribute('fill', 'none');
      s.setAttribute('stroke', 'currentColor');
      s.setAttribute('stroke-width', '1.8');
      s.setAttribute('stroke-linecap', 'round');
      s.setAttribute('stroke-linejoin', 'round');
      s.setAttribute('aria-hidden', 'true');
      /* `p.icone` a déjà passé le filtre de `normaliser` : pas de balise, pas de
         gestionnaire, pas de `javascript:`. */
      s.innerHTML = p.icone;
      b.appendChild(s);
    } else {
      var g = el('span', 'font-size:14px;line-height:1;');
      g.textContent = p.icon || '◆';
      b.appendChild(g);
    }

    b.addEventListener('click', function () {
      /* La bibliothèque s'ouvre PAR-DESSUS la trappe sans la fermer (cf.
         `ouvrirPanneau`) : si elle est là, on la referme avant d'ouvrir l'outil,
         sinon l'utilisateur clique une icône et voit une pop-in par-dessus. */
      try {
        var voile = document.getElementById(ID_MODAL);
        if (voile && voile.parentNode) voile.parentNode.removeChild(voile);
      } catch (_) {}
      ouvrirTrappePlugIn(p.id);
    });
    return b;
  }

  function actualiserBarrePlugIns() {
    var zone = document.getElementById('spPluginsTopbar');
    if (!zone) return;
    zone.innerHTML = '';
    var liste;
    try { liste = (window.SPPlugins && window.SPPlugins.list) ? window.SPPlugins.list() : []; } catch (_) { liste = []; }
    /* On n'affiche que les plug-ins ALLUMÉS. L'ordre est celui du registre, donc
       stable d'un rafraîchissement à l'autre : les icônes ne dansent pas. */
    (liste || []).forEach(function (p) {
      if (!p || !p.actif) return;
      zone.appendChild(boutonBarre(p));
    });
    /* La rangée disparaît entièrement quand plus rien n'est allumé : sinon elle
       laisserait un trou de 2 px dans l'alignement de la barre. */
    zone.style.display = zone.children.length ? 'flex' : 'none';
  }

  function ouvrirTrappePlugIn(id) {
    var p = window.SPPlugins.get(id);

    /* 🆕 v1.7.654 — LE PLUG-IN APPORTE SA PROPRE TRAPPE (« Global Refactor »).
       Il n'a pas de formulaire à construire : son `run()` ouvre le panneau qu'il
       possède déjà. On l'EXÉCUTE donc directement, sans passer par la trappe
       générique — sinon on aurait deux panneaux pour un seul outil, et un bouton
       « Appliquer » sans objet. `trappe` n'est transmis que pour les plug-ins
       intégrés (cf. `liste()` dans `sp-plugins.js`), donc un fichier déposé par
       l'utilisateur ne peut pas emprunter ce chemin. */
    if (p && p.integre && p.trappe) {
      fermerTrappe();
      return Promise.resolve()
        .then(function () { return window.SPPlugins.run(id, {}); })
        .catch(function (e) {
          var msg = texte('pluginsRunFail', 'Le plug-in a échoué : ') + (e && e.message ? e.message : e);
          try { window.spAlert(msg, { title: p.name }); } catch (_) { alert(msg); }
        });
    }

    brancherTrappe();
    if (!remplirTrappe(id)) { ouvrirPanneau(); return; }
    ouvrirTrappe();
  }

  /* ── Boutons de la barre de droite ────────────────────────────────────────── */
  function installerBoutons() {
    brancherTrappe();
    var bPlug = document.getElementById('openPluginsPanel');
    if (bPlug) bPlug.addEventListener('click', function () {
      /* ⚠️ v1.7.654 — CE BOUTON OUVRE LA BIBLIOTHÈQUE, TOUJOURS.
         Il la refermait quand la trappe d'un plug-in était ouverte (« va-et-vient,
         pas une ouverture forcée »). MESURÉ : depuis que « Global Refactor » est un
         plug-in, cela fait deux clics pour l'atteindre — le premier referme la
         trappe du plug-in courant, le second ouvre enfin la liste. La bibliothèque
         est devenue LA porte d'entrée des outils ; elle doit s'ouvrir d'un clic.
         Rien n'est perdu : la trappe a sa croix, et « Bibliothèque » dans son pied. */
      try { if (typeof window.toggleSidebar === 'function') window.toggleSidebar('right'); } catch (_) {}
      ouvrirPanneau();
    });
    var bMcp = document.getElementById('openMcpPanel');
    if (bMcp) bMcp.addEventListener('click', ouvrirPanneauMCP);

    /* 🆕 v1.7.654 — LA RANGÉE D'ICÔNES DE LA BARRE DU HAUT.
       ⚠️ ELLE SE REMPLIT ICI, ET PAS AU CHARGEMENT DU SCRIPT : les fichiers de
       `app/plugins/` sont insérés par `index.html` APRÈS `main.js` et s'enregistrent
       de façon asynchrone. Un premier remplissage immédiat trouverait donc une liste
       vide, et la barre resterait nue jusqu'à la première bascule d'interrupteur.
       On repasse donc une fois la file d'attente vidée, puis à chaque événement qui
       change la liste : bascule, installation, désinstallation. */
    actualiserBarrePlugIns();
    setTimeout(actualiserBarrePlugIns, 0);
    setTimeout(actualiserBarrePlugIns, 400);
    setTimeout(actualiserBarrePlugIns, 1500);

    /* 🆕 v1.7.654 — LA RANGÉE SUIT LA LANGUE DE L'INTERFACE.
       MESURÉ : `setLanguage('fr')` changeait bien les libellés de la bibliothèque
       (`liste()` traduit à la lecture), mais la barre du haut restait dans la
       langue précédente — elle avait été dessinée une fois, et rien ne la
       redessinait. Ses `aria-label` et ses infobulles annonçaient donc «ベクター柄»
       dans une interface française.
       ⚠️ ON OBSERVE L'ATTRIBUT `lang` DE `<html>`, PAS `setLanguage`. `main.js`
       pose cet attribut à chaque changement de langue (ligne « document.
       documentElement.lang = lang ») : c'est le seul signal public, et il évite de
       dépendre d'une fonction interne qui pourrait être renommée. L'observateur ne
       coûte rien : il ne se déclenche que sur cet attribut. */
    try {
      if (window.MutationObserver) {
        var obs = new MutationObserver(function (mutations) {
          for (var i = 0; i < mutations.length; i++) {
            if (mutations[i].attributeName === 'lang') { actualiserBarrePlugIns(); return; }
          }
        });
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
      }
    } catch (_) {}
  }

  /* ══════════════════════════════════════════════════════════════════════════
     MCP SERVER
     ══════════════════════════════════════════════════════════════════════════ */
  function ouvrirPanneauMCP() {
    var m = creerModal('Serveur MCP — SuperPrint', 640);
    var corps = el('div', 'padding:16px;');
    corps.appendChild(el('div', 'font-size:11px;line-height:1.6;color:#666;margin-bottom:6px;',
      'Ce dossier expose SuperPrint à un client MCP (Claude Desktop, Claude Code, Cursor…). '
      + 'Le client peut lire un .sp, le convertir, lister les formats, et composer un document.'));

    function bloc(titre, contenu, note) {
      corps.appendChild(el('div', 'font-size:8px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;color:#666;margin:16px 0 5px;font-family:"IBM Plex Mono",monospace;', titre));
      var pre = el('pre', 'margin:0;padding:10px 12px;background:#f7f7f7;border-left:3px solid #1a1a1a;font-family:"IBM Plex Mono",monospace;font-size:10px;line-height:1.55;overflow:auto;max-height:180px;white-space:pre-wrap;word-break:break-all;color:#222;');
      pre.textContent = contenu;
      corps.appendChild(pre);
      if (note) corps.appendChild(el('div', 'font-size:9px;line-height:1.5;color:#888;margin-top:5px;', note));
      var b = petitBouton(texte('copy', 'Copier'), false);
      b.style.marginTop = '6px';
      b.addEventListener('click', function () {
        try {
          navigator.clipboard.writeText(contenu);
          b.textContent = texte('copied', 'Copié');
          setTimeout(function () { b.textContent = texte('copy', 'Copier'); }, 1400);
        } catch (_) {}
      });
      corps.appendChild(b);
    }

    /* ⚠️ On affiche un chemin ABSOLU quand on peut le connaître : servi en file://, le
       chemin du dossier se déduit de location.href. Le bloc de configuration d'un client
       MCP exige « args: ["<chemin absolu>/server.mjs"] » ; un chemin relatif y est résolu
       depuis le répertoire courant du client, donc presque toujours faux. Mesuré : la
       version précédente affichait « superprint/mcp-server/ » et un placeholder
       « /chemin/absolu/… » — exactement la panne que ce bouton est censé éviter.
       En http(s) (serveur de développement, coquille Tauri) le chemin disque n'est pas
       connaissable depuis la page : on le dit, au lieu de laisser croire. */
    function cheminAbsoluDossier() {
      if (location.protocol !== 'file:') return null;
      var u = new URL('../mcp-server/', location.href);
      var p = decodeURIComponent(u.pathname);
      if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);              // /C:/… → C:/…
      return p.replace(/\//g, '\\');                           // Windows
    }
    function cheminConfigClient() {
      var ua = navigator.userAgent || '';
      if (/Win/i.test(ua)) return '%APPDATA%\\Claude\\claude_desktop_config.json';
      if (/Mac/i.test(ua)) return '~/Library/Application Support/Claude/claude_desktop_config.json';
      return '~/.config/Claude/claude_desktop_config.json';
    }

    var dossier = cheminAbsoluDossier();
    var serveur = dossier
      ? dossier.replace(/\\+$/, '') + '\\server.mjs'
      : '/chemin/absolu/vers/superprint/mcp-server/server.mjs';

    bloc('Dossier du serveur',
      dossier || 'superprint/mcp-server/',
      dossier ? null : 'Chemin disque non lisible depuis une page servie en http : préfixez par le dossier où SuperPrint est installé.');
    bloc('Installation', (dossier ? 'cd "' + dossier.replace(/\\+$/, '') + '"' : 'cd superprint/mcp-server') + '\nnode server.mjs');
    bloc('Fichier de configuration du client', cheminConfigClient());
    bloc('Configuration cliente (claude_desktop_config.json)', JSON.stringify({
      mcpServers: {
        superprint: { command: 'node', args: [serveur] }
      }
    }, null, 2), 'Le bloc ci-dessus exige un chemin absolu : un relatif est résolu depuis le répertoire courant du client MCP.');

    var barre = el('div', 'display:flex;gap:6px;justify-content:flex-end;margin-top:18px;padding-top:12px;border-top:1px solid #eee;');
    var bDoc = petitBouton(texte('pluginsDoc', 'Documentation'), false);
    bDoc.addEventListener('click', function () {
      try { window.open('documentation.html#m-mcp', '_blank'); } catch (_) {}
    });
    var bF = petitBouton(texte('close', 'Fermer'), true);
    bF.addEventListener('click', m.fermer);
    barre.appendChild(bDoc);
    barre.appendChild(bF);
    corps.appendChild(barre);
    m.corps.appendChild(corps);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installerBoutons);
  else installerBoutons();

  /* ⚠️ UN PLUG-IN DÉPOSÉ SUR LE PLAN DE TRAVAIL PASSE PAR ICI.
     MESURÉ : le gestionnaire `drop` de `main.js` est en CAPTURE et appelle
     `stopPropagation()` — les écouteurs du voile et de la zone de dépôt ne
     reçoivent donc JAMAIS l'événement. `main.js` route explicitement les
     `.plugin.js` vers ce point d'entrée (cf. `matchExt(f, ['.plugin.js'])`). */
  window._spInstallerPlugIn = function (fichier) {
    ouvrirPanneau();
    installerFichier(fichier);
  };

  /* Fichier lâché SUR la bibliothèque qui n'est pas un `.plugin.js` : on montre le
     refus, on n'importe pas un PNG derrière la pop-in. */
  window._spFichierSurPlugIns = function (fichier) {
    if (fichier) installerFichier(fichier);
  };

  window.SPPluginsUI = {
    ouvrirPanneau: ouvrirPanneau,
    ouvrirPlugIn: ouvrirTrappePlugIn,
    ouvrirPanneauMCP: ouvrirPanneauMCP,
    fermerTrappe: fermerTrappe,
    installerFichier: installerFichier
  };

  /* ═══ v1.7.654 — LA TOILE D'APERÇU, VUE PAR LE REGISTRE ═══════════════════
     `sp-plugins.js` construit l'API offerte au plug-in, mais c'est CE module qui
     possède la trappe et donc la toile du champ « aperçu ». On publie un
     accesseur, et rien de plus : le registre n'a pas à connaître la structure de
     la trappe, et la trappe n'a pas à savoir qui la lit.
     Renvoie `null` quand aucune trappe n'est ouverte ou que le plug-in courant
     n'a pas déclaré de champ « aperçu » — un plug-in qui appelle `api.toileApercu()`
     sans avoir déclaré le champ reçoit donc `null` au lieu d'une erreur. */
  window.__SP_PLUGIN_TRAP__ = {
    toileApercu: function () {
      try {
        if (!trappe || !trappe.toile) return null;
        var c = trappe.toile;
        var ctx = c.getContext('2d');
        if (!ctx) return null;
        return { canvas: c, ctx: ctx, largeur: c.width, hauteur: c.height };
      } catch (_) { return null; }
    }
  };
})();
