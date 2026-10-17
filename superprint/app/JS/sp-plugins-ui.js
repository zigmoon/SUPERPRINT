/* ═══════════════════════════════════════════════════════════════════════════════
   SUPERPRINT — PANNEAU PLUG-INS  (v1.7.641)
   ═══════════════════════════════════════════════════════════════════════════════

   Le bouton PLUG-INS (bas de la barre de droite) ouvre ce panneau. Il fait trois
   choses : lister les plug-ins installés, en installer un depuis un fichier
   `.plugin.js`, et exécuter un plug-in avec ses réglages.

   ⚠️ LES RÉGLAGES SONT DÉCLARÉS PAR LE PLUG-IN, LE FORMULAIRE EST CONSTRUIT ICI.
   Un plug-in ne fabrique jamais son propre DOM : il décrit ses options
   (`options: [{key, label, type, defaut…}]`) et le panneau les rend avec la DA de
   l'application. Deux conséquences, toutes deux voulues :
     · un plug-in ne peut pas casser l'interface (il n'y touche pas) ;
     · le thème sombre, les tailles et les polices restent ceux du produit, sans
       que chaque auteur ait à les réimplémenter.
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

  /* Le carton suit exactement la DA des autres pop-in (cf. askInsertAtPage) :
     carré, en-tête, croix, boutons de la même famille. */
  function creerModal(titre) {
    var ancien = document.getElementById(ID_MODAL);
    if (ancien && ancien.parentNode) ancien.parentNode.removeChild(ancien);
    var voile = el('div', 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100030;display:flex;align-items:center;justify-content:center;');
    voile.id = ID_MODAL;
    var carte = el('div', 'position:relative;width:520px;max-width:94vw;max-height:86vh;overflow:auto;background:#fff;color:#1a1a1a;border:1px solid #d9d9d9;padding:0;');
    carte.className = 'sp-modal-card';
    var entete = el('div', 'display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e0e0e0;');
    entete.appendChild(el('div', 'font-size:13px;font-weight:600;letter-spacing:.2px;', titre));
    var croix = el('button', 'border:0;background:none;font-size:16px;cursor:pointer;line-height:1;padding:4px 6px;color:#666;', '✕');
    croix.type = 'button';
    croix.setAttribute('aria-label', 'Fermer');
    croix.addEventListener('click', fermer);
    entete.appendChild(croix);
    var corps = el('div', 'padding:16px 18px;');
    carte.appendChild(entete);
    carte.appendChild(corps);
    voile.appendChild(carte);
    document.body.appendChild(voile);
    /* Le fond NE FERME PAS : même règle que la pop-in d'insertion de page — un clic
       à côté fait clignoter le carton au lieu d'abandonner une action en cours. */
    voile.addEventListener('click', function (ev) {
      if (ev.target !== voile) return;
      ev.stopPropagation();
      carte.classList.remove('sp-nudge');
      void carte.offsetWidth;
      carte.classList.add('sp-nudge');
    });
    function fermer() { if (voile.parentNode) voile.parentNode.removeChild(voile); }
    return { voile: voile, carte: carte, corps: corps, fermer: fermer };
  }

  function bouton(texte, principal) {
    var b = el('button', 'height:32px;padding:0 14px;border:1px solid ' + (principal ? '#1a1a1a' : '#d9d9d9')
      + ';background:' + (principal ? '#1a1a1a' : '#fff') + ';color:' + (principal ? '#fff' : '#1a1a1a')
      + ';font-size:11px;letter-spacing:.4px;text-transform:uppercase;cursor:pointer;', texte);
    b.type = 'button';
    return b;
  }

  /* ── Champ de réglage ─────────────────────────────────────────────────────── */
  function champ(option, valeurs) {
    var ligne = el('div', 'margin-bottom:12px;');
    var lab = el('label', 'display:block;font-size:11px;font-weight:600;letter-spacing:.3px;text-transform:uppercase;margin-bottom:5px;color:#444;', option.label);
    ligne.appendChild(lab);
    var v;
    if (option.type === 'select') {
      v = el('select', 'width:100%;height:30px;border:1px solid #d9d9d9;background:#fff;font-size:12px;padding:0 6px;');
      (option.choix || []).forEach(function (c) {
        var o = document.createElement('option');
        if (c && typeof c === 'object') { o.value = c.value; o.textContent = c.label || c.value; }
        else { o.value = c; o.textContent = c; }
        v.appendChild(o);
      });
      v.value = (option.defaut !== undefined && option.defaut !== '') ? option.defaut : ((option.choix && option.choix[0] && (option.choix[0].value || option.choix[0])) || '');
    } else if (option.type === 'color') {
      v = el('input', 'width:100%;height:30px;border:1px solid #d9d9d9;padding:0;background:#fff;cursor:pointer;');
      v.type = 'color';
      v.value = option.defaut || '#1a1a1a';
    } else if (option.type === 'checkbox') {
      v = el('input', 'width:16px;height:16px;cursor:pointer;');
      v.type = 'checkbox';
      v.checked = !!option.defaut;
    } else if (option.type === 'image') {
      /* L'image n'est pas un champ : c'est un bouton qui rend une dataURL. */
      v = el('div', 'display:flex;align-items:center;gap:10px;');
      var apercu = el('div', 'width:44px;height:44px;border:1px solid #d9d9d9;background:#fafafa center/contain no-repeat;flex:0 0 auto;');
      var bImg = bouton('Choisir une image', false);
      var etat = el('span', 'font-size:11px;color:#888;', 'aucune');
      bImg.addEventListener('click', function () {
        var api = window.SPPlugins && window.SPPlugins._apiImage;
        var p = api ? api.imageDataUrl() : Promise.resolve(null);
        p.then(function (url) {
          if (!url) return;
          valeurs[option.key] = url;
          apercu.style.backgroundImage = 'url("' + url + '")';
          etat.textContent = 'image chargée';
        });
      });
      v.appendChild(apercu); v.appendChild(bImg); v.appendChild(etat);
    } else if (option.type === 'number' || option.type === 'range') {
      v = el('input', 'width:100%;height:30px;border:1px solid #d9d9d9;padding:0 8px;font-size:12px;');
      v.type = option.type === 'range' ? 'range' : 'number';
      if (option.min !== undefined) v.min = option.min;
      if (option.max !== undefined) v.max = option.max;
      if (option.pas !== undefined) v.step = option.pas;
      v.value = option.defaut !== undefined ? option.defaut : '';
    } else {
      v = el('input', 'width:100%;height:30px;border:1px solid #d9d9d9;padding:0 8px;font-size:12px;');
      v.type = 'text';
      v.value = option.defaut !== undefined ? option.defaut : '';
    }
    v.id = 'spPluginOpt_' + option.key;
    if (option.type === 'checkbox') {
      var ligneCb = el('div', 'display:flex;align-items:center;gap:8px;');
      ligneCb.appendChild(v);
      ligneCb.appendChild(el('span', 'font-size:12px;', option.aide || ''));
      ligne.appendChild(ligneCb);
    } else {
      ligne.appendChild(v);
    }
    if (option.aide && option.type !== 'checkbox') ligne.appendChild(el('div', 'font-size:11px;color:#888;margin-top:4px;line-height:1.4;', option.aide));
    return { ligne: ligne, champ: v, option: option };
  }

  function lireValeur(desc) {
    var o = desc.option, c = desc.champ;
    if (o.type === 'checkbox') return !!c.checked;
    if (o.type === 'number' || o.type === 'range') {
      var n = parseFloat(c.value);
      return isFinite(n) ? n : (typeof o.defaut === 'number' ? o.defaut : 0);
    }
    return c.value;
  }

  /* ── Panneau principal ────────────────────────────────────────────────────── */
  function ouvrirPanneau() {
    var m = creerModal('Plug-ins SuperPrint');
    var liste = (window.SPPlugins ? window.SPPlugins.list() : []);

    var intro = el('div', 'font-size:12px;line-height:1.55;color:#555;margin-bottom:14px;');
    intro.innerHTML = 'Les plug-ins étendent SuperPrint : motifs, trames, habillages, outils maison. '
      + 'Un plug-in est un fichier <b>.plugin.js</b> que vous installez ici.';
    m.corps.appendChild(intro);

    if (!liste.length) {
      m.corps.appendChild(el('div', 'font-size:12px;color:#888;padding:14px 0;', 'Aucun plug-in pour le moment.'));
    }

    liste.forEach(function (p) {
      var ligne = el('div', 'border:1px solid #e6e6e6;padding:12px;margin-bottom:10px;display:flex;gap:12px;align-items:flex-start;');
      ligne.appendChild(el('div', 'font-size:20px;line-height:1;flex:0 0 auto;width:24px;text-align:center;', p.icon || '◆'));
      var centre = el('div', 'flex:1 1 auto;min-width:0;');
      var titre = el('div', 'font-size:12px;font-weight:600;', p.name + '  ');
      titre.appendChild(el('span', 'font-size:10px;color:#999;font-weight:400;', 'v' + p.version + (p.integre ? ' · intégré' : (p.author ? ' · ' + p.author : ''))));
      centre.appendChild(titre);
      if (p.description) centre.appendChild(el('div', 'font-size:11px;color:#777;margin-top:3px;line-height:1.45;', p.description));
      centre.appendChild(el('div', 'font-size:10px;color:#aaa;margin-top:4px;', p.options.length + ' réglage(s)'));
      ligne.appendChild(centre);

      var actions = el('div', 'display:flex;flex-direction:column;gap:6px;flex:0 0 auto;');
      var bLancer = bouton('Utiliser', true);
      bLancer.addEventListener('click', function () {
        m.fermer();
        ouvrirPlugIn(p.id);
      });
      actions.appendChild(bLancer);
      ligne.appendChild(actions);
      m.corps.appendChild(ligne);
    });

    var barre = el('div', 'display:flex;gap:10px;justify-content:flex-end;margin-top:16px;padding-top:14px;border-top:1px solid #eee;');
    var bInstaller = bouton('Installer un plug-in', false);
    bInstaller.addEventListener('click', installerDepuisFichier);
    var bFermer = bouton('Fermer', false);
    bFermer.addEventListener('click', m.fermer);
    barre.appendChild(bInstaller);
    barre.appendChild(bFermer);
    m.corps.appendChild(barre);

    return m;
  }

  function installerDepuisFichier() {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.js,.plugin.js,text/javascript';
    inp.style.display = 'none';
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var res = window.SPPlugins.installerSource(String(r.result), f.name);
          ouvrirPanneau();
          try { window.spShowToast('Plug-in installé : ' + res.name, { kind: 'info' }); } catch (_) {}
        } catch (e) {
          ouvrirPanneau();
          try { window.spAlert('Installation impossible : ' + e.message, { title: 'Plug-in' }); } catch (_) { alert(e.message); }
        }
      };
      r.readAsText(f);
    });
    document.body.appendChild(inp);
    inp.click();
    setTimeout(function () { if (inp.parentNode) inp.parentNode.removeChild(inp); }, 60000);
  }

  /* ── Formulaire d'un plug-in ──────────────────────────────────────────────── */
  function ouvrirPlugIn(id) {
    var p = window.SPPlugins.get(id);
    if (!p) { ouvrirPanneau(); return; }
    var m = creerModal(p.icon + '  ' + p.name);
    if (p.description) m.corps.appendChild(el('div', 'font-size:12px;line-height:1.5;color:#666;margin-bottom:14px;', p.description));

    var valeurs = {};
    var champs = [];
    (p.options || []).forEach(function (o) {
      var d = champ(o, valeurs);
      champs.push(d);
      m.corps.appendChild(d.ligne);
      valeurs[o.key] = o.defaut;
    });

    var barre = el('div', 'display:flex;gap:10px;justify-content:flex-end;margin-top:8px;padding-top:14px;border-top:1px solid #eee;');
    var bRetour = bouton('Retour', false);
    bRetour.addEventListener('click', function () { m.fermer(); ouvrirPanneau(); });
    var bGo = bouton('Appliquer', true);
    bGo.addEventListener('click', function () {
      champs.forEach(function (d) { valeurs[d.option.key] = lireValeur(d); });
      bGo.disabled = true;
      bGo.textContent = 'Traitement…';
      Promise.resolve()
        .then(function () { return window.SPPlugins.run(id, valeurs); })
        .then(function () {
          m.fermer();
          try { window.spShowToast(p.name + ' — terminé', { kind: 'info' }); } catch (_) {}
        })
        .catch(function (e) {
          bGo.disabled = false;
          bGo.textContent = 'Appliquer';
          try { window.spAlert('Le plug-in a échoué : ' + (e && e.message ? e.message : e), { title: p.name }); }
          catch (_) { alert(e && e.message ? e.message : e); }
        });
    });
    barre.appendChild(bRetour);
    barre.appendChild(bGo);
    m.corps.appendChild(barre);
    return m;
  }

  /* ── MCP Server ───────────────────────────────────────────────────────────── */
  /* Le panneau ne « lance » rien : un serveur MCP est un processus local que le
     client (Claude Desktop, Cursor…) démarre lui-même. Le panneau sert donc à
     donner la commande exacte, le chemin du dossier et le JSON de configuration,
     copiables — c'est tout ce dont l'utilisateur a besoin. */
  function ouvrirPanneauMCP() {
    var m = creerModal('Serveur MCP — SuperPrint');
    m.corps.appendChild(el('div', 'font-size:12px;line-height:1.6;color:#555;margin-bottom:14px;',
      'Ce dossier expose SuperPrint à un client MCP (Claude Desktop, Claude Code, Cursor…). '
      + 'Le client peut lire un .sp, le convertir, lister les formats, et composer un document.'));

    function bloc(titre, contenu) {
      m.corps.appendChild(el('div', 'font-size:11px;font-weight:600;letter-spacing:.3px;text-transform:uppercase;color:#444;margin:14px 0 6px;', titre));
      var pre = el('pre', 'margin:0;padding:10px 12px;background:#f7f7f7;border-left:3px solid #1a1a1a;font-family:"IBM Plex Mono",monospace;font-size:11px;line-height:1.5;overflow:auto;max-height:190px;white-space:pre-wrap;word-break:break-all;');
      pre.textContent = contenu;
      m.corps.appendChild(pre);
      var b = bouton('Copier', false);
      b.style.marginTop = '6px';
      b.addEventListener('click', function () {
        try {
          navigator.clipboard.writeText(contenu);
          b.textContent = 'Copié';
          setTimeout(function () { b.textContent = 'Copier'; }, 1400);
        } catch (_) {}
      });
      m.corps.appendChild(b);
    }

    bloc('Dossier du serveur', 'superprint/mcp-server/');
    bloc('Installation', 'cd superprint/mcp-server\nnpm install\nnode server.mjs');
    bloc('Configuration cliente (claude_desktop_config.json)', JSON.stringify({
      mcpServers: {
        superprint: { command: 'node', args: ['/chemin/absolu/vers/superprint/mcp-server/server.mjs'] }
      }
    }, null, 2));

    var barre = el('div', 'display:flex;gap:10px;justify-content:flex-end;margin-top:18px;padding-top:14px;border-top:1px solid #eee;');
    var bDoc = bouton('Documentation', false);
    bDoc.addEventListener('click', function () {
      try { window.open('documentation.html#plugins', '_blank'); } catch (_) {}
    });
    var bF = bouton('Fermer', false);
    bF.addEventListener('click', m.fermer);
    barre.appendChild(bDoc);
    barre.appendChild(bF);
    m.corps.appendChild(barre);
  }

  /* ── Branchement des deux boutons ─────────────────────────────────────────── */
  function installerBoutons() {
    var bPlug = document.getElementById('openPluginsPanel');
    if (bPlug) bPlug.addEventListener('click', function () {
      try { if (typeof window.toggleSidebar === 'function') window.toggleSidebar('right'); } catch (_) {}
      ouvrirPanneau();
    });
    var bMcp = document.getElementById('openMcpPanel');
    if (bMcp) bMcp.addEventListener('click', ouvrirPanneauMCP);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installerBoutons);
  else installerBoutons();

  window.SPPluginsUI = {
    ouvrirPanneau: ouvrirPanneau,
    ouvrirPlugIn: ouvrirPlugIn,
    ouvrirPanneauMCP: ouvrirPanneauMCP
  };
})();
