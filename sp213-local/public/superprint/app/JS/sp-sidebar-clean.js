/* ═══════════════════════════════════════════════════════════════════════════
   v1.7.673 — _SP_RANGEMENT_655 : LES SOUFFLETS DES DEUX COLONNES
   Demande utilisateur : « ajouter un soufflet aux titres suivants et ranger
   leur partie dedans » — Justification, Tons directs, Éléments de texte dans la
   colonne de droite, Calques dans la colonne de gauche.

   ⚠️ POURQUOI CE FICHIER EXISTE AU LIEU D'UN <details>
   Le balisage de ces quatre parties est déplacé et réécrit par trois autres
   modules (traduction, détachement en widget, nuanciers). Un <details>/<summary>
   aurait imposé de transformer leurs <label> en <summary>, or c'est justement
   le <label> DIRECT que le détachement cherche (`:scope > label`). On garde donc
   le balisage d'origine et on n'ajoute QU'UNE CLASSE sur le conteneur.

   ⚠️ L'ÉTAT EST MÉMORISÉ, ET C'EST DÉLIBÉRÉ
   Un soufflet qu'on rouvre à chaque démarrage n'économise rien. La clé porte le
   numéro de livraison : si la disposition change un jour, l'ancien état ne
   s'applique pas à la nouvelle.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ⚠️ v1.7.673 — LA CLÉ CHANGE DE NUMÉRO, ET C'EST VOULU. La colonne de droite
     a été réorganisée (onze filets, Césure entrée dans Justification, Retrait
     remonté sous Alignement du texte) : un état mémorisé sur l'ancienne
     disposition rouvrirait des soufflets qui n'existent plus sous cette forme et
     laisserait les nouveaux fermés sans raison. */
  var CLEF = 'sp.soufflets.v669';
  var etats = {};
  try { etats = JSON.parse(localStorage.getItem(CLEF) || '{}') || {}; } catch (_) { etats = {}; }

  /* Le nom d'un soufflet est son id, sinon son attribut data-sp-fold. Deux
     soufflets sans nom ne se mémorisent pas mais fonctionnent quand même. */
  function nomDe(soufflet) {
    return soufflet.id || soufflet.getAttribute('data-sp-fold') || null;
  }

  function titreDe(soufflet) {
    var enfants = soufflet.children;
    for (var i = 0; i < enfants.length; i++) {
      var e = enfants[i];
      if (e.tagName === 'LABEL' || e.classList.contains('section-title')) return e;
    }
    return null;
  }

  function poser(soufflet, ouvert, memoriser) {
    soufflet.classList.toggle('ouvert', !!ouvert);
    var titre = titreDe(soufflet);
    if (titre) titre.setAttribute('aria-expanded', ouvert ? 'true' : 'false');
    var nom = nomDe(soufflet);
    if (memoriser && nom) {
      etats[nom] = !!ouvert;
      try { localStorage.setItem(CLEF, JSON.stringify(etats)); } catch (_) {}
    }
  }

  function basculer(soufflet) {
    if (!soufflet) return;
    poser(soufflet, !soufflet.classList.contains('ouvert'), true);
  }

  function souffletDe(cible) {
    var n = cible;
    while (n && n !== document.body) {
      if (n.classList && n.classList.contains('sp-fold')) return n;
      n = n.parentElement;
    }
    return null;
  }

  /* Le clic est DÉLÉGUÉ au document : les quatre soufflets existent au chargement,
     mais la colonne de droite est réécrite par d'autres modules et un écouteur
     posé sur chaque titre deviendrait orphelin. */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    /* Le « + » de détachement vit DANS le titre : il ne doit pas replier. */
    if (t.closest('.sp-detach-btn, [data-dock-ignore], button, a, input, select')) return;
    var titre = t.closest('.sp-fold > label, .sp-fold > .section-title');
    if (!titre) return;
    e.preventDefault();
    basculer(souffletDe(titre));
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    var t = e.target;
    if (!t || !t.closest) return;
    var titre = t.closest('.sp-fold > label, .sp-fold > .section-title');
    if (!titre || t !== titre) return;
    e.preventDefault();
    basculer(souffletDe(titre));
  });

  function init() {
    var liste = document.querySelectorAll('.sp-fold');
    for (var i = 0; i < liste.length; i++) {
      var s = liste[i];
      var nom = nomDe(s);
      /* Sans état mémorisé, un soufflet est FERMÉ : c'est le but du rangement. */
      var ouvert = (nom && Object.prototype.hasOwnProperty.call(etats, nom))
        ? !!etats[nom]
        : s.classList.contains('ouvert');
      poser(s, ouvert, false);
    }
  }

  window.spSoufflets = {
    init: init,
    rafraichir: init,
    basculer: function (nom) { basculer(document.getElementById(nom)); },
    ouvrir: function (nom) { poser(document.getElementById(nom), true, true); },
    fermer: function (nom) { poser(document.getElementById(nom), false, true); },
    estOuvert: function (nom) {
      var s = document.getElementById(nom);
      return !!(s && s.classList.contains('ouvert'));
    },
    oublier: function () {
      etats = {};
      try { localStorage.removeItem(CLEF); } catch (_) {}
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
