/*!
 * superprint-core.js — colle entre le noyau Rust/WebAssembly et l'application.
 *
 * ⚠️ CE FICHIER EST UN SCRIPT CLASSIQUE (pas un module ES) : l'application charge
 * ses scripts par `<script src="…">`, sans étape de compilation. Il n'y a donc
 * aucune instruction `import`/`export` ici — la surface publique est posée sur
 * `globalThis.SuperPrintCore`.
 *
 * ## Ce que fait cette colle
 *
 * Elle charge `superprint_core.wasm` (le module construit par
 * `scripts/build-wasm.ps1`), et présente au reste du code des fonctions
 * **amicales** — des `Uint8Array` en entrée et en sortie, des exceptions
 * explicites — au lieu du contrat C brut (pointeurs, codes d'erreur négatifs,
 * protocole d'écriture en deux passes).
 *
 * ## Pourquoi un REPLI JavaScript
 *
 * La règle du projet est claire : aucune bascule à l'aveugle. Si le module
 * hôte refuse le WebAssembly (navigateur ancien, politique de sécurité,
 * fichier absent d'un déploiement), l'application doit continuer de
 * fonctionner — moins vite, mais juste. `load()` charge donc le module, et
 * retombe sur des implémentations JavaScript **si et seulement si** il échoue,
 * en annonçant lequel est actif dans `api.backend`.
 *
 * Le repli ne couvre pas tout : produire un PDF est le cœur du module Rust, on
 * ne le réécrit pas en JavaScript — ces fonctions **lèvent une erreur claire**
 * au lieu de rendre un résultat approximatif. C'est l'exporteur JS existant de
 * SuperPrint qui prend le relais dans ce cas.
 *
 * ## Le piège à connaître
 *
 * `memory.buffer` est **détaché** dès qu'une fonction Rust agrandit la mémoire.
 * Toute vue `TypedArray` construite avant l'appel devient alors inutilisable
 * (longueur 0, accès qui lèvent). Cette colle reconstruit donc **systématiquement**
 * une vue neuve à chaque lecture ou écriture, et ne conserve jamais une vue
 * au-delà de l'appel courant.
 *
 * Licence : AGPL-3.0-or-later — voir ../LICENSE.
 */

(function (global) {
  'use strict';

  /** Version de la colle (suit celle du workspace Rust). */
  var VERSION = '0.2.0';

  /**
   * Codes d'erreur de la frontière C. Ils doivent rester **synchronisés** avec
   * `crates/superprint-wasm/src/lib.rs` : ce sont les valeurs que Rust renvoie.
   */
  var ERR = {
    NULL: -1000001,
    TOO_SMALL: -1000002,
    BAD_INPUT: -1000003,
    SHORT_INPUT: -1000004,
    /** Spécifique à la colle : la fonction exige le module WebAssembly. */
    UNAVAILABLE: 'UNAVAILABLE',
  };

  /** Erreur du noyau, avec le code de la frontière et la fonction concernée. */
  function CoreError(message, options) {
    var error = Error.call(this, message);
    this.name = 'CoreError';
    this.message = message;
    this.code = options && options.code !== undefined ? options.code : undefined;
    this.fn = (options && options.fn) || undefined;
    this.cause = options && options.cause;
    if (Error.captureStackTrace) Error.captureStackTrace(this, CoreError);
    else this.stack = error.stack;
  }
  CoreError.prototype = Object.create(Error.prototype);
  CoreError.prototype.constructor = CoreError;

  /** Traduit un code négatif de la frontière en exception explicite. */
  function lever(code, fn) {
    var message;
    switch (code) {
      case ERR.NULL:
        message = 'pointeur nul transmis au noyau';
        break;
      case ERR.TOO_SMALL:
        message = 'tampon de sortie trop petit';
        break;
      case ERR.BAD_INPUT:
        message = 'entrée refusée par le noyau (spécification illisible ou dimensions nulles)';
        break;
      case ERR.SHORT_INPUT:
        message = 'tampon plus court que ce qu’annoncent les dimensions';
        break;
      default:
        message = 'échec du noyau (code ' + code + ')';
    }
    throw new CoreError(message + ' — ' + fn, { code: code, fn: fn });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  MOTEUR JAVASCRIPT (repli)
  //
  //  Chaque fonction reproduit EXACTEMENT l'arithmétique du noyau Rust : mêmes
  //  opérations, même ordre, mêmes arrondis. C'est ce qui permet de comparer les
  //  deux moteurs octet pour octet dans `scripts/validate-web.mjs` — et une
  //  comparaison octet pour octet est la seule façon honnête d'affirmer que le
  //  repli « donne le même résultat ».
  // ─────────────────────────────────────────────────────────────────────────

  var PT_PER_MM = 72 / 25.4;
  var MM_PER_IN = 25.4;

  var MAX_LITERAL = 128;
  var MAX_REPEAT = 128;

  function jsRgbToCmyk(rgb) {
    var n = (rgb.length / 3) | 0;
    var out = new Uint8Array(n * 4);
    for (var i = 0; i < n; i++) {
      var r = rgb[i * 3];
      var g = rgb[i * 3 + 1];
      var b = rgb[i * 3 + 2];
      var max = r > g ? (r > b ? r : b) : g > b ? g : b;
      var d = i * 4;
      if (max === 0) {
        out[d] = 0;
        out[d + 1] = 0;
        out[d + 2] = 0;
        out[d + 3] = 255;
      } else {
        var half = (max / 2) | 0;
        out[d] = (((max - r) * 255 + half) / max) | 0;
        out[d + 1] = (((max - g) * 255 + half) / max) | 0;
        out[d + 2] = (((max - b) * 255 + half) / max) | 0;
        out[d + 3] = 255 - max;
      }
    }
    return out;
  }

  function jsCmykToRgb(cmyk) {
    var n = (cmyk.length / 4) | 0;
    var out = new Uint8Array(n * 3);
    for (var i = 0; i < n; i++) {
      var s = i * 4;
      var kc = 255 - cmyk[s + 3];
      var d = i * 3;
      out[d] = (((255 - cmyk[s]) * kc + 127) / 255) | 0;
      out[d + 1] = (((255 - cmyk[s + 1]) * kc + 127) / 255) | 0;
      out[d + 2] = (((255 - cmyk[s + 2]) * kc + 127) / 255) | 0;
    }
    return out;
  }

  function jsLuma(rgb) {
    var n = (rgb.length / 3) | 0;
    var out = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var y =
        0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
      out[i] = Math.min(255, Math.max(0, Math.round(y)));
    }
    return out;
  }

  function jsRunLengthEncode(data) {
    var out = [];
    var i = 0;
    var n = data.length;
    while (i < n) {
      var run = 1;
      while (i + run < n && data[i + run] === data[i] && run < MAX_REPEAT) run++;
      if (run >= 3) {
        out.push(257 - run);
        out.push(data[i]);
        i += run;
      } else {
        var start = i;
        while (i < n && i - start < MAX_LITERAL) {
          if (i + 2 < n && data[i] === data[i + 1] && data[i] === data[i + 2]) break;
          i++;
        }
        var count = i - start;
        if (count === 0) {
          out.push(0);
          out.push(data[i]);
          i++;
        } else {
          out.push(count - 1);
          for (var k = start; k < i; k++) out.push(data[k]);
        }
      }
    }
    return Uint8Array.from(out);
  }

  function jsRunLengthDecode(data) {
    var out = [];
    var i = 0;
    while (i < data.length) {
      var length = data[i];
      i++;
      if (length === 128) break;
      if (length <= 127) {
        var count = length + 1;
        if (i + count > data.length) {
          throw new CoreError('flux RunLength tronqué (littéral)', {
            code: ERR.BAD_INPUT,
            fn: 'runLengthDecode',
          });
        }
        for (var k = 0; k < count; k++) out.push(data[i + k]);
        i += count;
      } else {
        if (i >= data.length) {
          throw new CoreError('flux RunLength tronqué (répétition)', {
            code: ERR.BAD_INPUT,
            fn: 'runLengthDecode',
          });
        }
        var reps = 257 - length;
        var value = data[i];
        i++;
        for (var j = 0; j < reps; j++) out.push(value);
      }
    }
    return Uint8Array.from(out);
  }

  function jsTargetSizeForDpi(width, height, currentDpi, targetDpi) {
    if (currentDpi <= 0 || targetDpi <= 0 || currentDpi <= targetDpi) {
      return { width: width, height: height };
    }
    var ratio = targetDpi / currentDpi;
    return {
      width: Math.max(1, Math.round(width * ratio)),
      height: Math.max(1, Math.round(height * ratio)),
    };
  }

  /** Coordonnée source du centre du pixel de destination `i` (même règle que Rust). */
  function sourceCoordinate(i, dst, src) {
    return (i + 0.5) * (src / dst) - 0.5;
  }

  function jsDownscaleBilinear(rgb, srcW, srcH, dstW, dstH) {
    dstW = Math.min(Math.max(1, dstW), srcW);
    dstH = Math.min(Math.max(1, dstH), srcH);
    var out = new Uint8Array(dstW * dstH * 3);
    for (var y = 0; y < dstH; y++) {
      var sy = sourceCoordinate(y, dstH, srcH);
      var y0 = Math.max(0, Math.floor(sy));
      var y1 = Math.min(y0 + 1, srcH - 1);
      var fy = Math.min(1, Math.max(0, sy - Math.floor(sy)));
      for (var x = 0; x < dstW; x++) {
        var sx = sourceCoordinate(x, dstW, srcW);
        var x0 = Math.max(0, Math.floor(sx));
        var x1 = Math.min(x0 + 1, srcW - 1);
        var fx = Math.min(1, Math.max(0, sx - Math.floor(sx)));
        for (var c = 0; c < 3; c++) {
          var p00 = rgb[(y0 * srcW + x0) * 3 + c];
          var p10 = rgb[(y0 * srcW + x1) * 3 + c];
          var p01 = rgb[(y1 * srcW + x0) * 3 + c];
          var p11 = rgb[(y1 * srcW + x1) * 3 + c];
          var top = p00 * (1 - fx) + p10 * fx;
          var bottom = p01 * (1 - fx) + p11 * fx;
          var value = top * (1 - fy) + bottom * fy;
          out[(y * dstW + x) * 3 + c] = Math.min(255, Math.max(0, Math.round(value)));
        }
      }
    }
    return out;
  }

  function jsDownscaleNearest(rgb, srcW, srcH, dstW, dstH) {
    dstW = Math.min(Math.max(1, dstW), srcW);
    dstH = Math.min(Math.max(1, dstH), srcH);
    var out = new Uint8Array(dstW * dstH * 3);
    for (var y = 0; y < dstH; y++) {
      var sy = Math.min(srcH - 1, Math.max(0, Math.round(sourceCoordinate(y, dstH, srcH))));
      for (var x = 0; x < dstW; x++) {
        var sx = Math.min(srcW - 1, Math.max(0, Math.round(sourceCoordinate(x, dstW, srcW))));
        var s = (sy * srcW + sx) * 3;
        var d = (y * dstW + x) * 3;
        out[d] = rgb[s];
        out[d + 1] = rgb[s + 1];
        out[d + 2] = rgb[s + 2];
      }
    }
    return out;
  }

  /** Fonction que seul le module WebAssembly sait faire : on refuse, sans approximation. */
  function indisponible(nom, raison) {
    return function () {
      throw new CoreError(
        '« ' + nom + ' » exige le module WebAssembly, qui n’a pas pu être chargé' +
          (raison ? ' (' + raison + ')' : '') +
          '. Utiliser l’exporteur JavaScript de SuperPrint en attendant.',
        { code: ERR.UNAVAILABLE, fn: nom },
      );
    };
  }

  function createFallbackEngine(raison) {
    return {
      backend: 'js',
      fallbackReason: raison ? String(raison.message || raison) : undefined,
      version: VERSION,
      rgbToCmyk: jsRgbToCmyk,
      cmykToRgb: jsCmykToRgb,
      luma: jsLuma,
      runLengthEncode: jsRunLengthEncode,
      runLengthDecode: jsRunLengthDecode,
      targetSizeForDpi: jsTargetSizeForDpi,
      downscaleBilinearRgb: jsDownscaleBilinear,
      downscaleNearestRgb: jsDownscaleNearest,
      mmToPt: function (mm) {
        return mm * PT_PER_MM;
      },
      ptToMm: function (pt) {
        return pt / PT_PER_MM;
      },
      mmToPx: function (mm, dpi) {
        return (mm / MM_PER_IN) * dpi;
      },
      pxToMm: function (px, dpi) {
        return (px / dpi) * MM_PER_IN;
      },
      writeSpotPage: indisponible('writeSpotPage', raison),
      writeSpotPageGray: indisponible('writeSpotPageGray', raison),
      createDocument: indisponible('createDocument', raison),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  DOCUMENT — construction d'un PDF complet
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Formate un nombre pour le protocole texte de la frontière.
   *
   * Six décimales (le micron) suffisent à toutes les coordonnées d'impression, et
   * cette forme n'emploie **jamais** la notation exponentielle — que le lecteur
   * Rust refuserait. `-0` est normalisé en `0`.
   */
  function fmt(valeur) {
    const n = Number(valeur);
    if (!isFinite(n)) {
      throw new CoreError('coordonnée non finie : ' + valeur, {
        code: ERR.BAD_INPUT,
        fn: 'document',
      });
    }
    let s = n.toFixed(6);
    if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
  }

  /**
   * Une composante **0–1** convertie en pour mille (0–1000).
   *
   * La frontière Rust attend des entiers pour mille : c'est ce qui rend le
   * protocole texte sans ambiguïté de séparateur décimal, et ce qui rend la
   * comparaison de parité exacte. Oublier la multiplication par mille ferait
   * silencieusement disparaître toutes les teintes intermédiaires — chaque
   * couleur tomberait à 0 % ou 100 %.
   */
  function perMilleDepuis01(cle, valeur) {
    const n = Number(valeur);
    if (!isFinite(n) || n < 0 || n > 1) {
      throw new CoreError(cle + ' hors bornes (attendu 0–1) : ' + valeur, {
        code: ERR.BAD_INPUT,
        fn: 'document',
      });
    }
    return String(Math.round(n * 1000));
  }

  /** Une composante entière 0–255, forme attendue par la frontière. */
  function entier0255(cle, valeur) {
    const n = Number(valeur);
    if (!isFinite(n) || n < 0 || n > 255) {
      throw new CoreError(cle + ' hors bornes (attendu 0–255) : ' + valeur, {
        code: ERR.BAD_INPUT,
        fn: 'document',
      });
    }
    return String(Math.round(n));
  }

  /** Sérialise une peinture : `q4 c m y k`, `q3 r g b` ou `sp index teinte`. */
  function peintureTexte(paint) {
    if (!paint || typeof paint !== 'object') {
      throw new CoreError('une peinture est requise (cmyk, rgb ou spot)', {
        code: ERR.BAD_INPUT,
        fn: 'document',
      });
    }
    if (paint.cmyk) {
      const c = paint.cmyk;
      return [
        'q4',
        perMilleDepuis01('c', c.c),
        perMilleDepuis01('m', c.m),
        perMilleDepuis01('y', c.y),
        perMilleDepuis01('k', c.k),
      ].join('\t');
    }
    if (paint.rgb) {
      const r = paint.rgb;
      return [
        'q3',
        entier0255('r', r.r),
        entier0255('g', r.g),
        entier0255('b', r.b),
      ].join('\t');
    }
    if (paint.spot) {
      const s = paint.spot;
      if (!Number.isInteger(s.index) || s.index < 0) {
        throw new CoreError('une encre directe se désigne par son rang entier', {
          code: ERR.BAD_INPUT,
          fn: 'document',
        });
      }
      return ['sp', String(s.index), perMilleDepuis01('teinte', s.tint)].join('\t');
    }
    throw new CoreError('peinture inconnue : attendu cmyk, rgb ou spot', {
      code: ERR.BAD_INPUT,
      fn: 'document',
    });
  }

  /**
   * Prépare un texte pour le protocole ligne par ligne.
   *
   * Le protocole sépare les champs par des tabulations et les lignes par des
   * retours : une tabulation ou un vrai retour à la ligne **dans le texte**
   * casserait la commande. On refuse donc l'un et on échappe l'autre (`\n`,
   * `\\`). Les autres caractères de contrôle sont refusés ici, avec un message
   * clair, plutôt que par un « entrée illisible » venu du noyau.
   */
  function echapperTexte(valeur) {
    // Un `\r\n` de Windows est une fin de ligne, pas un caractère à composer.
    const brut = String(valeur == null ? '' : valeur).replace(/\r\n/g, '\n');
    for (const c of brut) {
      if (c === '\n') continue;
      const code = c.codePointAt(0);
      if (c === '\t') {
        throw new CoreError(
          'le texte ne peut pas contenir de tabulation : elle sépare les champs du protocole',
          { code: ERR.BAD_INPUT, fn: 'document.text' },
        );
      }
      if (code < 0x20 || code === 0x7f) {
        throw new CoreError(
          'le texte contient le caractère de contrôle U+' +
            code.toString(16).toUpperCase().padStart(4, '0'),
          { code: ERR.BAD_INPUT, fn: 'document.text' },
        );
      }
    }
    return brut.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
  }

  /**
   * Construit l'API de document d'un moteur WebAssembly.
   *
   * Les opérations sont **accumulées** puis envoyées par lots : une ligne par
   * forme, dans un seul appel à la frontière. Cela évite un aller-retour par
   * rectangle sur une page qui en compte des milliers.
   */
  function creerApiDocument(exports, outils) {
    const { portee, encoder, verifier } = outils;
    let enAttente = [];

    function envoyer() {
      if (enAttente.length === 0) return 0;
      const texte = enAttente.join('\n');
      enAttente = [];
      const octets = encoder.encode(texte);
      return portee(function (ctx) {
        const p = ctx.poser(octets);
        const code = exports.sp_doc_op(p, octets.length);
        verifier(code, 'document.op');
        return code;
      });
    }

    /**
     * Refuse de dessiner s'il n'y a pas de page courante.
     *
     * Deux cas distincts, deux messages distincts : sans document ouvert, ou
     * avec un document encore vide. Sans ce contrôle, le noyau refuserait la
     * forme par un simple « entrée illisible » — exact, mais muet sur la cause.
     */
    function verifierDocument() {
      const pages = exports.sp_doc_page_count();
      if (pages < 0) {
        throw new CoreError(
          'aucun document ouvert : appeler createDocument() avant de dessiner',
          { code: ERR.BAD_INPUT, fn: 'document' },
        );
      }
      if (pages === 0) {
        throw new CoreError(
          'aucune page ouverte : appeler addPage() avant de dessiner',
          { code: ERR.BAD_INPUT, fn: 'document' },
        );
      }
    }

    const api = {
      /** Titre, auteur… `cle` ∈ title, author, subject, keywords, creator, producer. */
      info(cle, valeur) {
        const nom = encoder.encode(String(cle));
        const v = encoder.encode(valeur == null ? '' : String(valeur));
        return portee(function (ctx) {
          const pNom = ctx.poser(nom);
          const pValeur = ctx.poser(v);
          const code = exports.sp_doc_info(pNom, nom.length, pValeur, v.length);
          verifier(code, 'document.info');
          return api;
        });
      },

      /** Ajoute une page et la rend courante. `quadri` : `'cmyk'` ou `'rgb'`. */
      addPage(options) {
        const o = options || {};
        envoyer(); // les formes de la page précédente partent avant le changement
        const code = exports.sp_doc_add_page(
          nombre(o.trimWidthMm, 170),
          nombre(o.trimHeightMm, 240),
          nombre(o.bleedMm, 3),
          nombre(o.markMm, 10),
          o.quadri === 'rgb' ? 1 : 0,
        );
        verifier(code, 'document.addPage');
        return api;
      },

      /** Coupe les traits de coupe (ils sont tracés par défaut). */
      marks(actif) {
        verifier(exports.sp_doc_marks(actif ? 1 : 0), 'document.marks');
        return api;
      },

      /** Déclare une encre directe sur la page courante ; renvoie son rang. */
      addInk(ink) {
        const octets = encoder.encode(ligneEncre(ink));
        return portee(function (ctx) {
          const p = ctx.poser(octets);
          const code = exports.sp_doc_add_ink(p, octets.length);
          verifier(code, 'document.addInk');
          return code;
        });
      },

      /** Enregistre une image en niveaux de gris ; renvoie un descripteur. */
      addImageGray(pixels, width, height, filter) {
        return ajouterImage(exports.sp_doc_add_image_gray, pixels, width, height, filter, 1);
      },

      /** Enregistre une image RVB ; renvoie un descripteur. */
      addImageRgb(pixels, width, height, filter) {
        return ajouterImage(exports.sp_doc_add_image_rgb, pixels, width, height, filter, 3);
      },

      /**
       * Embarque une police TrueType ; renvoie son rang.
       *
       * À passer ensuite à `text({ font })`. La police est embarquée **en
       * entier** : le sous-ensemble n'est pas fait, le fichier est donc plus
       * lourd mais aucun glyphe ne peut manquer à l'impression.
       *
       * Formats refusés, et pourquoi : `.otf`/`.ttc` (contours CFF ou plusieurs
       * polices), `.woff`/`.woff2` (compressés). Le message le dit plutôt que
       * d'embarquer un programme que le lecteur PDF refuserait.
       */
      addFont(donnees) {
        const octets =
          donnees instanceof Uint8Array
            ? donnees
            : donnees instanceof ArrayBuffer
              ? new Uint8Array(donnees)
              : null;
        if (!octets || octets.length === 0) {
          throw new CoreError('addFont exige les octets d’un fichier de police', {
            code: ERR.BAD_INPUT,
            fn: 'document.addFont',
          });
        }
        return portee(function (ctx) {
          const p = ctx.poser(octets);
          const code = exports.sp_doc_add_font(p, octets.length);
          if (code < 0) {
            throw new CoreError(
              'police illisible : attendu un fichier TrueType (.ttf). ' +
                'Les polices à contours CFF (.otf), les collections (.ttc) et ' +
                'les formats compressés (.woff) ne sont pas pris en charge.',
              { code: code, fn: 'document.addFont' },
            );
          }
          return code;
        });
      },

      /** Déclare la destination de sortie avec un profil ICC réel. */
      outputIntent(options) {
        const o = options || {};
        if (!o.icc || !o.icc.length) {
          throw new CoreError('outputIntent exige les octets du profil ICC', {
            code: ERR.BAD_INPUT,
            fn: 'document.outputIntent',
          });
        }
        const identifiant = encoder.encode(o.identifier == null ? '' : String(o.identifier));
        const info = encoder.encode(o.info == null ? '' : String(o.info));
        return portee(function (ctx) {
          const pId = ctx.poser(identifiant);
          const pInfo = ctx.poser(info);
          const pIcc = ctx.poser(o.icc);
          const code = exports.sp_doc_output_intent(
            o.components === 3 ? 3 : 4,
            pId,
            identifiant.length,
            pInfo,
            info.length,
            pIcc,
            o.icc.length,
          );
          verifier(code, 'document.outputIntent');
          return api;
        });
      },

      // ── formes ──────────────────────────────────────────────────────────
      fillRect(o) {
        return forme([
          'rect', fmt(o.x), fmt(o.y), fmt(o.width), fmt(o.height),
          'fill', '0', peintureTexte(o.paint),
        ]);
      },
      strokeRect(o) {
        return forme([
          'rect', fmt(o.x), fmt(o.y), fmt(o.width), fmt(o.height),
          'stroke', fmt(o.widthMm), peintureTexte(o.paint),
        ]);
      },
      fillCircle(o) {
        return forme(['circle', fmt(o.cx), fmt(o.cy), fmt(o.radius), 'fill', '0', peintureTexte(o.paint)]);
      },
      strokeCircle(o) {
        return forme([
          'circle', fmt(o.cx), fmt(o.cy), fmt(o.radius),
          'stroke', fmt(o.widthMm), peintureTexte(o.paint),
        ]);
      },
      fillPolygon(o) {
        return polygone('fill', o);
      },
      strokePolygon(o) {
        return polygone('stroke', o);
      },
      line(o) {
        return forme([
          'line', fmt(o.x1), fmt(o.y1), fmt(o.x2), fmt(o.y2),
          'stroke', fmt(o.widthMm), peintureTexte(o.paint),
        ]);
      },
      placeImage(o) {
        return forme(['image', String(o.image | 0), fmt(o.x), fmt(o.y), fmt(o.width), fmt(o.height)]);
      },

      /**
       * Pose du texte.
       *
       * ```js
       * const f = doc.addFont(octets);           // rang de la police
       * doc.text({ font: f, size: 12, x: 20, y: 200, text: 'Bonjour\ncafé',
       *            paint: { cmyk: { c: 0, m: 0, y: 0, k: 1 } } });
       * ```
       *
       * `x` et `y` sont en millimètres du format fini ; `y` est la ligne de
       * base de la **première** ligne. `size` est en points. Un `\n` passe à la
       * ligne, l'interligne valant 1,2 fois le corps.
       */
      text(o) {
        const t = o || {};
        if (!Number.isInteger(t.font) || t.font < 0) {
          throw new CoreError('text exige le rang d’une police déjà embarquée', {
            code: ERR.BAD_INPUT,
            fn: 'document.text',
          });
        }
        const corps = nombre(t.size, 0);
        if (!(corps > 0)) {
          throw new CoreError('text exige un corps positif, en points', {
            code: ERR.BAD_INPUT,
            fn: 'document.text',
          });
        }
        return forme([
          'text',
          String(t.font),
          fmt(corps),
          fmt(t.x),
          fmt(t.y),
          peintureTexte(t.paint),
          echapperTexte(t.text),
        ]);
      },

      /**
       * Combien de caractères la dernière écriture n'a **pas** su dessiner.
       *
       * Zéro veut dire « tout s'imprimera ». Toute autre valeur signale un texte
       * composé avec une police qui n'a pas les dessins voulus : le PDF est
       * écrit, mais il est incomplet — et il le dit plutôt que de laisser un
       * blanc inexpliqué sur la plaque.
       */
      substitutions() {
        return exports.sp_doc_substitues();
      },

      /** Envoie les formes en attente. Appelé automatiquement par `write()`. */
      flush: envoyer,

      /** Écrit le PDF et renvoie ses octets. */
      write() {
        envoyer();
        const lenPtr = portee(function (ctx) {
          const p = ctx.allouer(4);
          const premier = exports.sp_doc_write(0, 0, p);
          if (premier !== ERR.TOO_SMALL) {
            verifier(premier, 'document.write');
            throw new CoreError(
              'le noyau a accepté un tampon de taille nulle — protocole inattendu',
              { code: premier, fn: 'document.write' },
            );
          }
          return ctx.lu32(p);
        });
        return portee(function (ctx) {
          const tampon = ctx.allouer(lenPtr);
          const p = ctx.allouer(4);
          const code = exports.sp_doc_write(tampon, lenPtr, p);
          verifier(code, 'document.write');
          return ctx.lire(tampon, ctx.lu32(p));
        });
      },
    };

    function forme(champs) {
      verifierDocument();
      enAttente.push(champs.join('\t'));
      return api;
    }

    function polygone(action, o) {
      const points = o.points;
      if (!Array.isArray(points) || points.length < 3) {
        throw new CoreError('un polygone demande au moins trois sommets', {
          code: ERR.BAD_INPUT,
          fn: 'document',
        });
      }
      const champs = ['polygon', action, fmt(o.widthMm || 0), peintureTexte(o.paint)];
      for (const point of points) {
        if (!Array.isArray(point) || point.length !== 2) {
          throw new CoreError('un sommet est une paire [x, y]', {
            code: ERR.BAD_INPUT,
            fn: 'document',
          });
        }
        champs.push(fmt(point[0]), fmt(point[1]));
      }
      return forme(champs);
    }

    function ajouterImage(fonction, pixels, width, height, filter, canaux) {
      if (!(pixels instanceof Uint8Array)) {
        throw new CoreError('une image se donne en Uint8Array', {
          code: ERR.BAD_INPUT,
          fn: 'document',
        });
      }
      const attendu = width * height * canaux;
      if (pixels.length < attendu) {
        throw new CoreError(
          'image trop courte : ' + pixels.length + ' octets pour ' + attendu + ' attendus',
          { code: ERR.BAD_INPUT, fn: 'document' },
        );
      }
      const codeFiltre = filter === 'none' ? 0 : filter === 'runlength' ? 1 : 2;
      return portee(function (ctx) {
        const p = ctx.poser(pixels.subarray(0, attendu));
        const code = fonction(p, width, height, codeFiltre);
        verifier(code, 'document.addImage');
        return code;
      });
    }

    /** Sérialise une encre, même syntaxe que `writeSpotPage`. */
    function ligneEncre(ink) {
      if (!ink || !ink.name || String(ink.name).trim() === '') {
        throw new CoreError('une encre directe doit porter un nom', {
          code: ERR.BAD_INPUT,
          fn: 'document.addInk',
        });
      }
      const nom = String(ink.name).replace(/[\t\r\n]+/g, ' ').trim();
      if (ink.space === 'cmyk') {
        return [
          'cmyk', nom,
          String(Math.round(Number(ink.c) * 1000)),
          String(Math.round(Number(ink.m) * 1000)),
          String(Math.round(Number(ink.y) * 1000)),
          String(Math.round(Number(ink.k) * 1000)),
        ].join('\t');
      }
      if (ink.space === 'rgb') {
        return ['rgb', nom, String(Math.round(ink.r)), String(Math.round(ink.g)), String(Math.round(ink.b))].join('\t');
      }
      if (ink.space === 'gray') {
        return ['gray', nom, String(Math.round(ink.gray === undefined ? ink.value : ink.gray))].join('\t');
      }
      throw new CoreError('espace de remplacement inconnu : ' + ink.space, {
        code: ERR.BAD_INPUT,
        fn: 'document.addInk',
      });
    }

    return api;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  MOTEUR WEBASSEMBLY
  // ─────────────────────────────────────────────────────────────────────────

  /** Construit un moteur à partir des exports d'une instance WebAssembly. */
  function engineFromWasm(exports, bytes) {
    var memory = exports.memory;
    var alloc = exports.sp_alloc;
    var free = exports.sp_free;

    if (!(memory instanceof WebAssembly.Memory) || typeof alloc !== 'function' || typeof free !== 'function') {
      throw new CoreError('le module ne ressemble pas au noyau SuperPrint (mémoire ou gestionnaire absent)', {
        code: ERR.BAD_INPUT,
      });
    }

    var encoder = new TextEncoder();
    /**
     * Vue neuve sur la mémoire. ⚠️ Jamais mise en cache : `memory.buffer` change
     * d'identité dès que Rust agrandit la mémoire.
     */
    function u8(ptr, len) {
      return new Uint8Array(memory.buffer, ptr, len);
    }

    function lu32(ptr) {
      return new DataView(memory.buffer).getUint32(ptr, true);
    }

    /**
     * Exécute `fn` dans une portée qui alloue des tampons et les **rend tous**
     * à la sortie, y compris en cas d'exception. C'est ce qui évite les fuites
     * de mémoire dans la mémoire linéaire du module.
     */
    function portee(fn) {
      var blocs = [];
      var ctx = {
        allouer: function (len) {
          var p = alloc(len);
          if (!p) throw new CoreError('allocation refusée dans la mémoire du module', { code: ERR.NULL });
          blocs.push([p, len]);
          return p;
        },
        poser: function (octets) {
          var p = ctx.allouer(octets.length);
          u8(p, octets.length).set(octets);
          return p;
        },
        lire: function (ptr, len) {
          return Uint8Array.from(u8(ptr, len));
        },
        lu32: lu32,
      };
      try {
        return fn(ctx);
      } finally {
        for (var i = blocs.length - 1; i >= 0; i--) free(blocs[i][0], blocs[i][1]);
      }
    }

    /** Vérifie que le noyau a réussi, sinon lève. */
    function verifier(code, nom, ecrit) {
      if (code < 0) lever(code, nom);
      if (ecrit !== undefined && code !== ecrit) {
        lever(ERR.SHORT_INPUT, nom);
      }
      return code;
    }

    /**
     * Protocole d'écriture en deux passes : on demande d'abord la taille, on
     * alloue, puis on écrit réellement. C'est le contrat de la frontière.
     */
    function deuxPasses(nom, appel) {
      return portee(function (ctx) {
        var lenPtr = ctx.allouer(4);
        var premier = appel(ctx, 0, 0, lenPtr);
        if (premier !== ERR.TOO_SMALL) {
          // Un tampon vide DOIT être refusé : sinon le protocole ne veut rien dire.
          verifier(premier, nom);
          throw new CoreError('le noyau a accepté un tampon de taille nulle — protocole inattendu', {
            code: premier,
            fn: nom,
          });
        }
        var besoin = ctx.lu32(lenPtr);
        var tampon = ctx.allouer(besoin);
        var code = appel(ctx, tampon, besoin, lenPtr);
        verifier(code, nom);
        return ctx.lire(tampon, ctx.lu32(lenPtr));
      });
    }

    return {
      backend: 'wasm',
      version: (function () {
        return (
          exports.sp_version_major() + '.' + exports.sp_version_minor() + '.' + exports.sp_version_patch()
        );
      })(),
      byteLength: bytes ? bytes.byteLength : undefined,

      rgbToCmyk: function (rgb) {
        var n = (rgb.length / 3) | 0;
        return portee(function (ctx) {
          var src = ctx.poser(rgb);
          var dst = ctx.allouer(n * 4);
          verifier(exports.sp_rgb_to_cmyk(src, dst, n), 'rgbToCmyk');
          return ctx.lire(dst, n * 4);
        });
      },

      cmykToRgb: function (cmyk) {
        var n = (cmyk.length / 4) | 0;
        return portee(function (ctx) {
          var src = ctx.poser(cmyk);
          var dst = ctx.allouer(n * 3);
          verifier(exports.sp_cmyk_to_rgb(src, dst, n), 'cmykToRgb');
          return ctx.lire(dst, n * 3);
        });
      },

      luma: function (rgb) {
        var n = (rgb.length / 3) | 0;
        return portee(function (ctx) {
          var src = ctx.poser(rgb);
          var dst = ctx.allouer(n);
          verifier(exports.sp_luma_rgb(src, dst, n), 'luma');
          return ctx.lire(dst, n);
        });
      },

      runLengthEncode: function (octets) {
        var src = octets;
        return portee(function (ctx) {
          // La borne d'écriture : 1 octet par tranche de 128, plus la pire sortie.
          var capacite = src.length * 2 + 1024;
          var pSrc = ctx.poser(src);
          var pDst = ctx.allouer(capacite);
          var pLen = ctx.allouer(4);
          verifier(exports.sp_run_length_encode(pSrc, src.length, pDst, capacite, pLen), 'runLengthEncode');
          return ctx.lire(pDst, ctx.lu32(pLen));
        });
      },

      runLengthDecode: function (octets) {
        var src = octets;
        return portee(function (ctx) {
          var capacite = src.length * 300 + 1024;
          var pSrc = ctx.poser(src);
          var pDst = ctx.allouer(capacite);
          var pLen = ctx.allouer(4);
          verifier(exports.sp_run_length_decode(pSrc, src.length, pDst, capacite, pLen), 'runLengthDecode');
          return ctx.lire(pDst, ctx.lu32(pLen));
        });
      },

      targetSizeForDpi: function (width, height, currentDpi, targetDpi) {
        return portee(function (ctx) {
          var pW = ctx.allouer(4);
          var pH = ctx.allouer(4);
          verifier(
            exports.sp_target_size_for_dpi(width, height, currentDpi, targetDpi, pW, pH),
            'targetSizeForDpi',
          );
          return { width: ctx.lu32(pW), height: ctx.lu32(pH) };
        });
      },

      downscaleBilinearRgb: function (rgb, srcW, srcH, dstW, dstH) {
        return portee(function (ctx) {
          var src = ctx.poser(rgb);
          var dst = ctx.allouer(dstW * dstH * 3);
          verifier(
            exports.sp_downscale_bilinear_rgb(src, srcW, srcH, dst, dstW, dstH),
            'downscaleBilinearRgb',
          );
          return ctx.lire(dst, dstW * dstH * 3);
        });
      },

      downscaleNearestRgb: function (rgb, srcW, srcH, dstW, dstH) {
        return portee(function (ctx) {
          var src = ctx.poser(rgb);
          var dst = ctx.allouer(dstW * dstH * 3);
          verifier(
            exports.sp_downscale_nearest_rgb(src, srcW, srcH, dst, dstW, dstH),
            'downscaleNearestRgb',
          );
          return ctx.lire(dst, dstW * dstH * 3);
        });
      },

      mmToPt: function (mm) {
        return exports.sp_mm_to_pt(mm);
      },
      ptToMm: function (pt) {
        return exports.sp_pt_to_mm(pt);
      },
      mmToPx: function (mm, dpi) {
        return exports.sp_mm_to_px(mm, dpi);
      },
      pxToMm: function (px, dpi) {
        return exports.sp_px_to_mm(px, dpi);
      },

      writeSpotPage: function (options) {
        var o = options || {};
        var encres = encoder.encode(serialiserEncres(o.inks));
        return deuxPasses('writeSpotPage', function (ctx, dst, cap, lenPtr) {
          var pEncres = ctx.poser(encres);
          return exports.sp_write_spot_page(
            nombre(o.trimWidthMm, 170),
            nombre(o.trimHeightMm, 240),
            nombre(o.bleedMm, 3),
            nombre(o.markMm, 10),
            o.quadri === 'rgb' ? 1 : 0,
            pEncres,
            encres.length,
            dst,
            cap,
            lenPtr,
          );
        });
      },

      writeSpotPageGray: function (options) {        var o = options || {};
        var encres = encoder.encode(serialiserEncres(o.inks));
        var image = o.image;
        if (!image || !image.length) {
          throw new CoreError('writeSpotPageGray exige une image en niveaux de gris', {
            code: ERR.BAD_INPUT,
            fn: 'writeSpotPageGray',
          });
        }
        var filtre = o.filter === 'none' ? 0 : o.filter === 'runlength' ? 1 : 2;
        return deuxPasses('writeSpotPageGray', function (ctx, dst, cap, lenPtr) {
          var pEncres = ctx.poser(encres);
          var pImage = ctx.poser(image);
          return exports.sp_write_spot_page_gray(
            nombre(o.trimWidthMm, 170),
            nombre(o.trimHeightMm, 240),
            nombre(o.bleedMm, 3),
            nombre(o.markMm, 10),
            o.quadri === 'rgb' ? 1 : 0,
            filtre,
            pEncres,
            encres.length,
            pImage,
            o.imageWidth | 0,
            o.imageHeight | 0,
            dst,
            cap,
            lenPtr,
          );
        });
      },

      /**
       * Ouvre un **document** : plusieurs pages, formes vectorielles, tons
       * directs teintés, images placées, métadonnées, destination de sortie.
       *
       * Le document est un objet à construire par étapes ; c'est la raison de
       * `createDocument()` plutôt qu'une fonction unique.
       *
       * ```js
       * const doc = noyau.createDocument();
       * doc.info('title', 'Affiche').addPage({ trimWidthMm: 170, trimHeightMm: 240 });
       * doc.addInk({ space: 'cmyk', name: 'PANTONE WARM RED C', c: 0, m: .9, y: .8, k: 0 });
       * doc.fillRect({ x: 10, y: 20, width: 50, height: 30, paint: { spot: { index: 0, tint: .5 } } });
       * const f = doc.addFont(octetsDePolice);          // TrueType requis
       * doc.text({ font: f, size: 12, x: 20, y: 200, text: 'café',
       *            paint: { cmyk: { c: 0, m: 0, y: 0, k: 1 } } });
       * const pdf = doc.write();   // Uint8Array
       * ```
       */
      createDocument: function () {
        portee(function (ctx) {
          void ctx;
          if (exports.sp_doc_reset() !== 0) {
            throw new CoreError('impossible d’ouvrir un document', {
              code: ERR.BAD_INPUT,
              fn: 'createDocument',
            });
          }
          return 0;
        });
        return creerApiDocument(exports, {
          portee: portee,
          encoder: encoder,
          verifier: verifier,
        });
      },

      /**
       * Télécharge un fichier de police et rend ses octets.
       *
       * Raccourci pour `doc.addFont()` :
       *
       * ```js
       * const moteur = await SuperPrintCore.load({ url: 'superprint_core.wasm' });
       * const doc = moteur.createDocument();
       * doc.addPage({});
       * doc.addFont(await moteur.loadFont('fonts/IBMPlexMono-Regular.ttf'));
       * ```
       *
       * Le fichier est lu **tel quel** : aucune conversion n'est faite, et un
       * format non pris en charge est refusé au moment de `addFont`.
       */
      loadFont: async function (url) {
        const reponse = await fetch(url);
        if (!reponse.ok) {
          throw new CoreError(
            'police introuvable : ' + url + ' (' + reponse.status + ')',
            { code: ERR.BAD_INPUT, fn: 'loadFont' },
          );
        }
        return new Uint8Array(await reponse.arrayBuffer());
      },
    };
  }

  function nombre(valeur, defaut) {
    return typeof valeur === 'number' && isFinite(valeur) ? valeur : defaut;
  }

  /**
   * Sérialise les encres directes pour la frontière C.
   *
   * Format attendu par Rust : une ligne par encre, champs séparés par une
   * tabulation, lignes séparées par `\n`. Les noms sont nettoyés : une
   * tabulation ou un saut de ligne dans un nom de Pantone casserait la lecture.
   */
  function serialiserEncres(inks) {
    if (!inks || !inks.length) return '';
    var lignes = [];
    for (var i = 0; i < inks.length; i++) {
      var ink = inks[i];
      var nom = String(ink.name == null ? '' : ink.name).replace(/[\t\r\n]+/g, ' ').trim();
      if (!nom) {
        throw new CoreError('une encre directe doit porter un nom', {
          code: ERR.BAD_INPUT,
          fn: 'writeSpotPage',
        });
      }
      if (ink.space === 'cmyk') {
        lignes.push(
          ['cmyk', nom, pourMille(ink.c), pourMille(ink.m), pourMille(ink.y), pourMille(ink.k)].join('\t'),
        );
      } else if (ink.space === 'rgb') {
        lignes.push(['rgb', nom, octet(ink.r), octet(ink.g), octet(ink.b)].join('\t'));
      } else if (ink.space === 'gray') {
        lignes.push(['gray', nom, octet(ink.gray === undefined ? ink.value : ink.gray)].join('\t'));
      } else {
        throw new CoreError('espace de remplacement inconnu : ' + ink.space, {
          code: ERR.BAD_INPUT,
          fn: 'writeSpotPage',
        });
      }
    }
    return lignes.join('\n');
  }

  function pourMille(valeur) {
    var v = Math.round(Number(valeur) * 1000);
    if (!isFinite(v) || v < 0 || v > 1000) {
      throw new CoreError('composante CMJN hors bornes (attendu 0–1) : ' + valeur, {
        code: ERR.BAD_INPUT,
        fn: 'writeSpotPage',
      });
    }
    return v;
  }

  function octet(valeur) {
    var v = Math.round(Number(valeur));
    if (!isFinite(v) || v < 0 || v > 255) {
      throw new CoreError('composante hors bornes (attendu 0–255) : ' + valeur, {
        code: ERR.BAD_INPUT,
        fn: 'writeSpotPage',
      });
    }
    return v;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  CHARGEMENT
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Charge le noyau.
   *
   * @param {object} [options]
   * @param {string} [options.url]      URL du `.wasm` (fetched).
   * @param {ArrayBuffer|Uint8Array} [options.bytes]  octets déjà en main (évite un aller-retour réseau).
   * @param {boolean} [options.fallback=true]  retomber sur le JavaScript si le module échoue.
   * @returns {Promise<object>} moteur prêt à l'emploi ; `backend` vaut `'wasm'` ou `'js'`.
   */
  async function load(options) {
    var o = options || {};
    var raison = null;
    var bytes = o.bytes;

    try {
      if (!bytes) {
        if (!o.url) throw new TypeError('load() exige `url` ou `bytes`');
        var reponse = await global.fetch(o.url);
        if (!reponse.ok) {
          throw new Error('HTTP ' + reponse.status + ' pour ' + o.url);
        }
        bytes = await reponse.arrayBuffer();
      }

      // `instantiate` refuse un module qui réclame des imports : notre frontière
      // n'en a aucun, donc `{}` doit suffire. Si un import apparaît, c'est un
      // défaut du noyau, pas du déploiement.
      var instantiated = await WebAssembly.instantiate(bytes, {});
      var moteur = engineFromWasm(instantiated.instance.exports, bytes);
      return moteur;
    } catch (erreur) {
      raison = erreur;
      if (o.fallback === false) throw erreur;
    }

    return createFallbackEngine(raison);
  }

  global.SuperPrintCore = {
    version: VERSION,
    ERR: ERR,
    CoreError: CoreError,
    load: load,
    createFallbackEngine: createFallbackEngine,
    /** Nom du fichier attendu, pour éviter les fautes de frappe dans les appels. */
    FILENAME: 'superprint_core.wasm',
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
