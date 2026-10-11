/*!
 * Banc d'essai du branchement — logique de la page.
 *
 * Chargé par `demo.html` après `superprint-core.js`, comme des scripts
 * classiques (c'est ainsi que l'application charge les siens : aucune étape de
 * compilation, aucun module ES).
 *
 * La page n'affiche rien qui ne soit MESURÉ : chaque ligne du journal vient
 * d'un appel réel au noyau, et les résultats sont aussi déposés dans
 * `window.__preuve` pour qu'un contrôle automatisé lise des faits plutôt que
 * l'apparence de la page.
 */

(function () {
  'use strict';

  var preuve = {
    backend: null,
    raisonRepli: null,
    version: null,
    octetsWasm: null,
    essais: [],
    erreurFatale: null,
  };
  globalThis.__preuve = preuve;

  function ligne(etiquette, valeur, ok) {
    var dl = document.createElement('div');
    dl.className = 'ligne' + (ok === false ? ' ko' : ok === true ? ' ok' : '');
    var dt = document.createElement('span');
    dt.className = 'etiquette';
    dt.textContent = etiquette;
    var dd = document.createElement('span');
    dd.className = 'valeur';
    dd.textContent = valeur;
    dl.appendChild(dt);
    dl.appendChild(dd);
    document.getElementById('journal').appendChild(dl);
  }

  function titre(texte) {
    var h = document.createElement('h2');
    h.textContent = texte;
    document.getElementById('journal').appendChild(h);
  }

  function essai(nom, condition, detail) {
    preuve.essais.push({ nom: nom, ok: !!condition, detail: String(detail == null ? '' : detail) });
    ligne(nom, detail, !!condition);
  }

  /** Générateur congruentiel linéaire : mêmes entrées à chaque exécution. */
  function generateur(graine) {
    var etat = graine >>> 0;
    return function () {
      etat = (Math.imul(etat, 1664525) + 1013904223) >>> 0;
      return etat / 4294967296;
    };
  }

  function identiques(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function moyenne(t) {
    var somme = 0;
    for (var i = 0; i < t.length; i++) somme += t[i];
    return t.length ? somme / t.length : 0;
  }

  function texte(octets, limite) {
    var n = Math.min(octets.length, limite || 8192);
    var morceaux = [];
    for (var i = 0; i < n; i++) morceaux.push(String.fromCharCode(octets[i]));
    return morceaux.join('');
  }

  function compter(octets, motif) {
    var brut = texte(octets, octets.length);
    var total = 0;
    var index = brut.indexOf(motif);
    while (index !== -1) {
      total++;
      index = brut.indexOf(motif, index + motif.length);
    }
    return total;
  }

  function leve(fn) {
    try {
      fn();
      return false;
    } catch (erreur) {
      return erreur && erreur.name === 'CoreError';
    }
  }

  function premiersOctets(octets) {
    var fin = Math.min(12, octets.length);
    var morceaux = [];
    for (var i = 0; i < fin; i++) morceaux.push(octets[i]);
    return morceaux.join(' ') + (octets.length > fin ? ' …' : '');
  }

  function proposerTelechargement(nom, octets) {
    var blob = new Blob([octets], { type: 'application/pdf' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nom;
    a.className = 'lien';
    a.textContent = '↓ ' + nom + ' (' + octets.length.toLocaleString('fr-FR') + ' octets)';
    document.getElementById('telechargements').appendChild(a);
  }

  function dessinerApercu(rgb, gris) {
    var c = document.getElementById('canvas-gris');
    if (!c) return;
    var T = 96;
    c.width = T;
    c.height = T;
    var ctx = c.getContext('2d');
    var image = ctx.createImageData(T, T);
    var pas = Math.max(1, Math.floor(rgb.length / 3 / (T * T)));
    for (var i = 0; i < T * T; i++) {
      var v = gris[Math.min(gris.length - 1, i * pas)];
      image.data[i * 4] = v;
      image.data[i * 4 + 1] = v;
      image.data[i * 4 + 2] = v;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }

  function dessinerImage(octets, largeur, hauteur, id) {
    var c = document.getElementById(id);
    if (!c) return;
    c.width = largeur;
    c.height = hauteur;
    var ctx = c.getContext('2d');
    var image = ctx.createImageData(largeur, hauteur);
    for (var i = 0; i < largeur * hauteur; i++) {
      image.data[i * 4] = octets[i * 3];
      image.data[i * 4 + 1] = octets[i * 3 + 1];
      image.data[i * 4 + 2] = octets[i * 3 + 2];
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }

  async function principal() {
    var Core = globalThis.SuperPrintCore;
    if (!Core) {
      preuve.erreurFatale = 'superprint-core.js non chargé';
      ligne('colle', 'absente', false);
      return;
    }

    var api = await Core.load({ url: '../dist/' + Core.FILENAME });
    preuve.backend = api.backend;
    preuve.raisonRepli = api.fallbackReason || null;
    preuve.version = api.version;
    preuve.octetsWasm = api.byteLength || null;

    titre('Moteur');
    essai(
      'moteur actif',
      api.backend === 'wasm',
      api.backend === 'wasm'
        ? 'WebAssembly, ' + (api.byteLength / 1024).toFixed(1) + ' Ko'
        : 'JavaScript (repli) — ' + (api.fallbackReason || 'sans motif'),
    );
    essai('version du noyau', typeof api.version === 'string', api.version);

    // ── Couleurs : le noyau contre le repli JavaScript ────────────────────
    titre('Couleurs (noyau comparé au repli JavaScript, octet pour octet)');
    var N = 65536;
    var rgb = new Uint8Array(N * 3);
    var alea = generateur(20261011);
    for (var i = 0; i < 256; i++) {
      rgb[i * 3] = i;
      rgb[i * 3 + 1] = i;
      rgb[i * 3 + 2] = i;
    }
    for (var j = 768; j < rgb.length; j++) rgb[j] = Math.floor(alea() * 256);

    var repli = Core.createFallbackEngine();
    var cmykW = api.rgbToCmyk(rgb);
    var cmykJs = repli.rgbToCmyk(rgb);
    essai(
      'RVB → CMJN (' + N.toLocaleString('fr-FR') + ' pixels)',
      identiques(cmykW, cmykJs),
      premiersOctets(cmykW) + '…',
    );

    var rgbW = api.cmykToRgb(cmykW);
    essai('CMJN → RVB', identiques(rgbW, repli.cmykToRgb(cmykJs)), premiersOctets(rgbW) + '…');

    var grisW = api.luma(rgb);
    essai(
      'luminance (Rec. 709)',
      identiques(grisW, repli.luma(rgb)),
      'moyenne ' + moyenne(grisW).toFixed(1) + '/255',
    );

    var pire = 0;
    for (var k = 0; k < rgb.length; k++) pire = Math.max(pire, Math.abs(rgbW[k] - rgb[k]));
    essai('aller-retour RVB → CMJN → RVB', pire <= 1, 'écart maximal ' + pire + '/255');

    dessinerApercu(rgb, grisW);

    // ── RunLength ────────────────────────────────────────────────────────
    titre('Filtre RunLength');
    var aplat = new Uint8Array(65536);
    aplat.fill(200);
    var encode = api.runLengthEncode(aplat);
    essai(
      'aplat 65 536 octets → ' + encode.length + ' octets',
      identiques(api.runLengthDecode(encode), aplat),
      '×' + (aplat.length / encode.length).toFixed(0) + ' sur les pixels bruts',
    );

    var bruit = new Uint8Array(8192);
    var alea2 = generateur(7);
    for (var b = 0; b < bruit.length; b++) bruit[b] = Math.floor(alea2() * 256);
    var encBruit = api.runLengthEncode(bruit);
    essai(
      'bruit incompressible : pas de surcoût notable',
      encBruit.length < bruit.length * 1.02,
      bruit.length + ' → ' + encBruit.length + ' octets',
    );

    // ── Réduction d'image ───────────────────────────────────────────────
    titre('Réduction d’image');
    var cible = api.targetSizeForDpi(6000, 4000, 600, 300);
    essai(
      'ciblage DPI 6000×4000 à 600 DPI → 300 DPI',
      cible.width === 3000 && cible.height === 2000,
      cible.width + '×' + cible.height,
    );
    var inchange = api.targetSizeForDpi(800, 600, 150, 300);
    essai(
      'n’agrandit jamais',
      inchange.width === 800 && inchange.height === 600,
      inchange.width + '×' + inchange.height,
    );

    var grand = new Uint8Array(1200 * 1200 * 3);
    for (var y = 0; y < 1200; y++) {
      for (var x = 0; x < 1200; x++) {
        var p = (y * 1200 + x) * 3;
        grand[p] = (x * 255) / 1199;
        grand[p + 1] = (y * 255) / 1199;
        grand[p + 2] = 128;
      }
    }
    var reduit = api.downscaleBilinearRgb(grand, 1200, 1200, 300, 300);
    essai(
      '1 200×1 200 → 300×300 (bilinéaire, identique au repli)',
      identiques(reduit, repli.downscaleBilinearRgb(grand, 1200, 1200, 300, 300)),
      reduit.length.toLocaleString('fr-FR') + ' octets produits',
    );
    essai(
      'plus proche voisin (identique au repli)',
      identiques(
        api.downscaleNearestRgb(grand, 1200, 1200, 300, 300),
        repli.downscaleNearestRgb(grand, 1200, 1200, 300, 300),
      ),
      'même échantillonnage des deux côtés',
    );
    dessinerImage(reduit, 300, 300, 'canvas-reduit');

    // ── Écriture PDF ────────────────────────────────────────────────────
    titre('Écriture PDF');
    var encres = [
      { space: 'cmyk', name: 'PANTONE WARM RED C', c: 0, m: 0.9, y: 0.8, k: 0 },
      { space: 'rgb', name: 'PANTONE 300 C', r: 0, g: 94, b: 184 },
    ];

    try {
      var page = api.writeSpotPage({
        trimWidthMm: 170,
        trimHeightMm: 240,
        bleedMm: 3,
        markMm: 10,
        inks: encres,
      });
      essai(
        'page avec 2 tons directs',
        page.length > 500 && texte(page, 5).indexOf('%PDF-') === 0,
        page.length + ' octets, ' + compter(page, '/Separation') + ' /Separation',
      );
      proposerTelechargement('page-tons-directs.pdf', page);
    } catch (erreur) {
      essai('page avec 2 tons directs', false, erreur.message);
    }

    try {
      var IMG_W = 1004;
      var IMG_H = 1418;
      var image = new Uint8Array(IMG_W * IMG_H);
      for (var yi = 0; yi < IMG_H; yi++) {
        image.fill(yi < IMG_H / 2 ? 255 : (yi * 7) & 0xff, yi * IMG_W, (yi + 1) * IMG_W);
      }
      var pageImage = api.writeSpotPageGray({
        trimWidthMm: 170,
        trimHeightMm: 240,
        bleedMm: 3,
        markMm: 10,
        inks: encres,
        image: image,
        imageWidth: IMG_W,
        imageHeight: IMG_H,
        filter: 'auto',
      });
      var brut = IMG_W * IMG_H;
      essai(
        'page avec image 1004×1418 (filtre auto)',
        pageImage.length < brut,
        pageImage.length.toLocaleString('fr-FR') + ' octets pour ' + brut.toLocaleString('fr-FR') + ' pixels bruts',
      );
      proposerTelechargement('page-image.pdf', pageImage);
    } catch (erreur) {
      essai('page avec image 1004×1418 (filtre auto)', false, erreur.message);
    }

    // ── Garde-fous ──────────────────────────────────────────────────────
    titre('Garde-fous');
    essai(
      'une encre sans nom est refusée',
      leve(function () {
        api.writeSpotPage({ inks: [{ space: 'rgb', r: 1, g: 2, b: 3 }] });
      }),
      'erreur explicite au lieu d’une plaque silencieusement absente',
    );
    essai(
      'une composante hors bornes est refusée',
      leve(function () {
        api.writeSpotPage({ inks: [{ space: 'rgb', name: 'X', r: 999, g: 0, b: 0 }] });
      }),
      'contrôle fait côté colle, avant le noyau',
    );
    essai(
      'un flux RunLength tronqué est refusé',
      leve(function () {
        api.runLengthDecode(Uint8Array.from([200]));
      }),
      'un flux corrompu ne produit pas une image décalée',
    );

    var total = preuve.essais.length;
    var reussis = preuve.essais.filter(function (e) {
      return e.ok;
    }).length;
    preuve.bilan = { total: total, reussis: reussis, echecs: total - reussis };

    titre('Bilan');
    ligne(
      reussis + '/' + total + ' essais concluants',
      reussis === total ? 'tout est vert' : total - reussis + ' échec(s)',
      reussis === total,
    );
  }

  principal().catch(function (erreur) {
    preuve.erreurFatale = String((erreur && erreur.stack) || erreur);
    ligne('erreur fatale', preuve.erreurFatale, false);
  });
})();
