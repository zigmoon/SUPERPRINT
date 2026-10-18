/* sp-export-designer.js — EXPORT EPS ET WORD (.docx) — v1.7.670.
 *
 * Demande : « dans Sauvegarder, on doit pouvoir enregistrer les .eps designer, et
 * enregistrer sa maquette en Word ».
 *
 * DEUX FORMATS, DEUX PROMESSES DIFFÉRENTES — et c'est le cœur de ce fichier :
 *
 *   · EPS — PostScript encapsulé, VECTORIEL. Les formes (rectangles, ellipses,
 *     tracés, filets, polygones) sortent en opérateurs PostScript avec leur
 *     remplissage, leur contour, leur épaisseur, leurs pointillés et leur rotation ;
 *     les images sont embarquées en JPEG (filtre DCTDecode, PostScript niveau 3).
 *     ⚠️ LE TEXTE EST ÉCRIT EN TEXTE, avec les polices PostScript standard : un
 *     navigateur ne sait pas extraire les contours d'une police. Une famille
 *     inconnue est ramenée à Times/Helvetica/Courier — la POSITION et le CORPS sont
 *     exacts, le dessin de la lettre n'est exact que pour ces trois familles. C'est
 *     écrit dans l'interface, pas caché.
 *     ⚠️ L'OPACITÉ N'EST PAS APLATIE : PostScript niveau 2 ne connaît pas la
 *     transparence. Un objet à 40 % sort à 100 %, et le fichier le DIT en clair
 *     (`%%SP:opacite …`) plutôt que de faire semblant.
 *
 *   · DOCX — un document Word où CHAQUE PAGE EST UNE IMAGE pleine page. C'est le
 *     choix de la FIDÉLITÉ : une maquette est un objet graphique (colonnes, chemin
 *     de fer, images posées au millimètre) ; la convertir en paragraphes donnerait
 *     un document éditable mais faux. Le format de CHAQUE page est respecté : une
 *     section Word par page, avec sa taille de papier — c'est la seule construction
 *     qui garde juste un document multi-format.
 *
 * ⚠️ CE MODULE NE MODIFIE RIEN. Il lit les plans de travail par le pont public
 * (`window.__SP_PLUGIN_HOST__.canvases()`), n'ajoute ni ne retire aucun objet, ne
 * touche ni à la sélection ni au zoom. Un export qui laisse le document dans un
 * autre état que celui où il l'a trouvé est un export dangereux.
 */
(function () {
    'use strict';

    var PT_PAR_MM = 72 / 25.4;          /* 1 mm = 2,8346 pt PostScript */
    var TWIPS_PAR_MM = 1440 / 25.4;     /* 1 mm = 56,6929 twips Word */
    var EMU_PAR_MM = 36000;             /* 1 mm = 36 000 EMU */
    var DPI_WORD = 200;                 /* rendu des pages pour Word */

    function hotes() {
        try { return (window.__SP_PLUGIN_HOST__ && window.__SP_PLUGIN_HOST__.canvases) ? window.__SP_PLUGIN_HOST__.canvases() : []; }
        catch (_) { return []; }
    }
    function formatDePage(i) {
        try { if (typeof window._spFormatDePage === 'function') return window._spFormatDePage(i); } catch (_) {}
        return { width: 210, height: 297 };
    }
    function fondPerduMm() {
        try { return (window.__SP_PLUGIN_HOST__.fondPerdu ? window.__SP_PLUGIN_HOST__.fondPerdu() : 0); } catch (_) { return 0; }
    }
    function telecharger(blob, nom) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = nom;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }
    function nomPropre(base, ext, suffixe) {
        var n = String(base || 'superprint').replace(/[\\/:*?"<>|]+/g, '_').replace(/\.(sp|json|docx|eps)$/i, '').trim();
        if (!n) n = 'superprint';
        return n + (suffixe || '') + '.' + ext;
    }

    /* ── Couleurs ──────────────────────────────────────────────────────────────
       Fabric donne « #rrggbb », « rgb(...) » ou un objet dégradé. Un dégradé ne peut
       pas s'écrire `setrgbcolor` : on prend sa première couleur et on le signale par
       un commentaire PostScript, pour qu'un contrôleur sache ce qui a été simplifié. */
    function troisComposantes(couleur) {
        if (!couleur) return null;
        if (typeof couleur === 'object') {
            var arrets = couleur.colorStops || [];
            return (arrets.length && arrets[0].color) ? troisComposantes(arrets[0].color) : null;
        }
        var s = String(couleur).trim();
        var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
        if (m) {
            var h = m[1];
            if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
            return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
        }
        var r = /^rgba?\(([^)]+)\)$/i.exec(s);
        if (r) {
            var p = r[1].split(',').map(parseFloat);
            if (p.length >= 3) return [p[0] / 255, p[1] / 255, p[2] / 255];
        }
        return null;
    }
    function psCouleur(c) { return c[0].toFixed(4) + ' ' + c[1].toFixed(4) + ' ' + c[2].toFixed(4) + ' setrgbcolor'; }

    /* Une chaîne PostScript : Latin-1, octets > 127 échappés en octal, `(` `)` `\`
       échappés. Sans cela, un texte français casse le fichier au premier « é ».
       ⚠️ POSTSCRIPT EST UN MONDE D'OCTETS : les caractères typographiques qui
       n'existent pas en Latin-1 (tiret cadratin, apostrophes courbes, points de
       suspension) n'ont AUCUNE représentation. Les passer tels quels produisait un
       échappement octal à 5 chiffres, que PostScript lit comme deux caractères
       arbitraires — mesuré : « 0 octet échappé » sur un texte accentué, parce que le
       tiret cadratin cassait la chaîne avant les accents. On les RAMÈNE donc à leur
       équivalent ASCII, ce qui est exactement ce que fait un exporteur sérieux. */
    var TYPO_VERS_ASCII = {
        '\u2014': '-', '\u2013': '-', '\u2212': '-', '\u2018': "'", '\u2019': "'",
        '\u201C': '"', '\u201D': '"', '\u2026': '...', '\u00A0': ' ', '\u202F': ' ',
        '\u2009': ' ', '\u2022': '-', '\u00B7': '.', '\u0153': 'oe', '\u0152': 'OE',
        '\u20AC': 'EUR'
    };
    function psTexte(txt) {
        var out = '';
        for (var i = 0; i < txt.length; i++) {
            var ch = txt[i], code = txt.charCodeAt(i);
            if (TYPO_VERS_ASCII[ch]) { out += TYPO_VERS_ASCII[ch].replace(/[\\()]/g, '\\$&'); continue; }
            if (code > 255) { out += '?'; continue; }        /* hors Latin-1 : on ne ment pas, on remplace */
            if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
            else if (code > 126 || code < 32) out += '\\' + ('000' + code.toString(8)).slice(-3);
            else out += ch;
        }
        return '(' + out + ')';
    }

    /* Famille → une des trois familles PostScript standard, en gardant gras/italique.
       C'est la seule approximation de cet export, et elle est annoncée. */
    function psPolice(famille, graisse, style) {
        var f = String(famille || '').toLowerCase();
        var base = 'Times-Roman';
        if (/courier|mono|consolas|menlo|monaco/.test(f)) base = 'Courier';
        else if (/helvetica|arial|verdana|tahoma|inter|roboto|open sans|noto|lato|montserrat|futura|gill|grotesk|frutiger|univers/.test(f)) base = 'Helvetica';
        else if (!/times|georgia|garamond|baskerville|playfair|didot|bodoni|serif|cambria|minion|palatino/.test(f)) base = 'Helvetica';
        var gras = /bold|700|800|900|black/i.test(String(graisse || '') + ' ' + String(style || ''));
        var ital = /italic|oblique/i.test(String(style || ''));
        if (base === 'Courier') return ital && gras ? 'Courier-BoldOblique' : ital ? 'Courier-Oblique' : gras ? 'Courier-Bold' : 'Courier';
        if (base === 'Helvetica') return ital && gras ? 'Helvetica-BoldOblique' : ital ? 'Helvetica-Oblique' : gras ? 'Helvetica-Bold' : 'Helvetica';
        return ital && gras ? 'Times-BoldItalic' : ital ? 'Times-Italic' : gras ? 'Times-Bold' : 'Times-Roman';
    }

    /* Le coin haut-gauche d'un objet, corrigé de son origine — la même règle que
       Fabric, sans laquelle tout objet centré sort décalé d'une demi-taille. */
    function coin(obj, decalX, decalY) {
        var w = (obj.width || 0) * (obj.scaleX || 1);
        var h = (obj.height || 0) * (obj.scaleY || 1);
        var x = (obj.left || 0) - decalX, y = (obj.top || 0) - decalY;
        if (obj.originX === 'center') x -= w / 2; else if (obj.originX === 'right') x -= w;
        if (obj.originY === 'center') y -= h / 2; else if (obj.originY === 'bottom') y -= h;
        return { x: x, y: y, w: w, h: h };
    }

    /* ══════════════════════════════════════════════════════════════════════════
       EPS
       ══════════════════════════════════════════════════════════════════════════ */

    function peindre(sortie, remplissage, trait, epaisseur, tirets) {
        if (remplissage) sortie.push('gsave ' + psCouleur(remplissage) + ' fill grestore');
        if (trait && epaisseur > 0) {
            sortie.push('gsave ' + psCouleur(trait) + ' ' + epaisseur + ' setlinewidth 1 setlinecap 1 setlinejoin');
            if (tirets) sortie.push('[' + tirets.join(' ') + '] 0 setdash');
            sortie.push('stroke grestore');
        }
    }

    /* Les quadratiques (Q) de Fabric deviennent des cubiques : PostScript n'en a pas,
       et approximer par des droites casserait les courbes. */
    function cheminDeLObjet(obj, decalX, decalY) {
        if (obj.type === 'line') {
            var c = coin(obj, decalX, decalY);
            var ox = 0, oy = 0;
            if (obj.pathOffset) { ox = obj.pathOffset.x; oy = obj.pathOffset.y; }
            return (c.x + (obj.x1 || 0) - ox) + ' ' + (c.y + (obj.y1 || 0) - oy) + ' moveto '
                + (c.x + (obj.x2 || 0) - ox) + ' ' + (c.y + (obj.y2 || 0) - oy) + ' lineto';
        }
        if (obj.type === 'triangle' || obj.type === 'polygon') {
            var ps = obj.points || [];
            if (!ps.length) return null;
            var cc = coin(obj, decalX, decalY);
            var px = cc.x, py = cc.y;
            if (obj.pathOffset) { px -= obj.pathOffset.x; py -= obj.pathOffset.y; }
            var d = '';
            for (var i = 0; i < ps.length; i++) d += (px + ps[i].x) + ' ' + (py + ps[i].y) + (i ? ' lineto ' : ' moveto ');
            return d;
        }
        if (obj.type === 'path') {
            var p = obj.path || [];
            var cp = coin(obj, decalX, decalY);
            var bx = cp.x, by = cp.y;
            if (obj.pathOffset) { bx -= obj.pathOffset.x; by -= obj.pathOffset.y; }
            var sx = obj.scaleX || 1, sy = obj.scaleY || 1;
            var X = function (v) { return (bx + v * sx).toFixed(3); };
            var Y = function (v) { return (by + v * sy).toFixed(3); };
            var out = '', dernier = null;
            for (var j = 0; j < p.length; j++) {
                var seg = p[j], cmd = seg[0];
                if (cmd === 'M') { out += X(seg[1]) + ' ' + Y(seg[2]) + ' moveto '; dernier = [seg[1], seg[2]]; }
                else if (cmd === 'L') { out += X(seg[1]) + ' ' + Y(seg[2]) + ' lineto '; dernier = [seg[1], seg[2]]; }
                else if (cmd === 'C') { out += [X(seg[1]), Y(seg[2]), X(seg[3]), Y(seg[4]), X(seg[5]), Y(seg[6])].join(' ') + ' curveto '; dernier = [seg[5], seg[6]]; }
                else if (cmd === 'Q') {
                    var p0 = dernier || [seg[1], seg[2]];
                    var c1 = [p0[0] + 2 / 3 * (seg[1] - p0[0]), p0[1] + 2 / 3 * (seg[2] - p0[1])];
                    var c2 = [seg[3] + 2 / 3 * (seg[1] - seg[3]), seg[4] + 2 / 3 * (seg[2] - seg[4])];
                    out += [X(c1[0]), Y(c1[1]), X(c2[0]), Y(c2[1]), X(seg[3]), Y(seg[4])].join(' ') + ' curveto ';
                    dernier = [seg[3], seg[4]];
                } else if (cmd === 'Z' || cmd === 'z') out += 'closepath ';
            }
            return out || null;
        }
        return null;
    }

    function texteEnPS(obj, decalX, decalY, sortie, ressources) {
        var txt = String(obj.text || '');
        if (!txt) return;
        var taille = obj.fontSize || 12;
        var police = psPolice(obj.fontFamily, obj.fontWeight, obj.fontStyle);
        var res = ressources.police(police);
        var interligne = (obj.lineHeight && obj.lineHeight > 0.5) ? obj.lineHeight * taille : taille * 1.16;
        var lignes = txt.split('\n');
        var c = coin(obj, decalX, decalY);
        var align = obj.textAlign || 'left';
        var couleur = troisComposantes(obj.fill) || [0, 0, 0];

        sortie.push('/' + res + ' findfont ' + taille + ' scalefont setfont');
        sortie.push(psCouleur(couleur));
        for (var i = 0; i < lignes.length; i++) {
            /* PostScript pose le texte sur la LIGNE DE BASE ; Fabric donne le haut de
               la première ligne. On descend de ~0,8 corps — la même proportion que
               celle qu'utilise le rendu de l'application. */
            var y = c.y + taille * 0.8 + i * interligne;
            if (align === 'center' || align === 'right') {
                /* Le centrage est calculé PAR POSTSCRIPT avec `stringwidth` : il est
                   exact, contrairement à un décalage deviné d'après le nombre de
                   caractères (qui se trompe dès qu'une lettre est grasse). */
                var ancre = (align === 'center') ? (c.x + c.w / 2) : (c.x + c.w);
                sortie.push('gsave ' + ancre.toFixed(3) + ' ' + y.toFixed(3) + ' translate');
                sortie.push('/' + res + ' findfont ' + taille + ' scalefont setfont ' + psTexte(lignes[i])
                    + ' dup stringwidth pop ' + (align === 'center' ? '-2 div' : '-1 mul') + ' 0 rmoveto show');
                sortie.push('grestore');
            } else {
                sortie.push(c.x.toFixed(3) + ' ' + y.toFixed(3) + ' moveto ' + psTexte(lignes[i]) + ' show');
            }
        }
    }

    function objetEnPS(obj, decalX, decalY, sortie, ressources) {
        if (!obj || obj.visible === false) return;
        var type = obj.type;
        var angle = obj.angle || 0;
        var cx, cy;
        try { var centre = obj.getCenterPoint(); cx = centre.x - decalX; cy = centre.y - decalY; } catch (_) { return; }

        sortie.push('gsave');
        if (angle) {
            /* Rotation autour du CENTRE, comme Fabric. Le signe est inversé parce que
               le repère du fichier est retourné (Y vers le bas). */
            sortie.push(cx.toFixed(3) + ' ' + cy.toFixed(3) + ' translate ' + (-angle).toFixed(4) + ' rotate '
                + (-cx).toFixed(3) + ' ' + (-cy).toFixed(3) + ' translate');
        }
        if (typeof obj.opacity === 'number' && obj.opacity < 0.999) {
            sortie.push('%%SP:opacite ' + obj.opacity.toFixed(3) + ' non-aplatie-en-PostScript-niveau-2');
        }

        var remplissage = troisComposantes(obj.fill);
        var trait = troisComposantes(obj.stroke);
        var epaisseur = obj.strokeWidth || 0;
        var tirets = (Array.isArray(obj.strokeDashArray) && obj.strokeDashArray.length) ? obj.strokeDashArray : null;

        if (type === 'rect') {
            var c = coin(obj, decalX, decalY);
            var rayon = Math.max(0, Math.min(obj.rx || 0, c.w / 2, c.h / 2));
            if (rayon > 0.01) {
                var k = 0.5523 * rayon;
                sortie.push('newpath');
                sortie.push((c.x + rayon) + ' ' + c.y + ' moveto');
                sortie.push((c.x + c.w - rayon) + ' ' + c.y + ' lineto');
                sortie.push([c.x + c.w - rayon + k, c.y, c.x + c.w, c.y + rayon - k, c.x + c.w, c.y + rayon].join(' ') + ' curveto');
                sortie.push((c.x + c.w) + ' ' + (c.y + c.h - rayon) + ' lineto');
                sortie.push([c.x + c.w, c.y + c.h - rayon + k, c.x + c.w - rayon + k, c.y + c.h, c.x + c.w - rayon, c.y + c.h].join(' ') + ' curveto');
                sortie.push((c.x + rayon) + ' ' + (c.y + c.h) + ' lineto');
                sortie.push([c.x + rayon - k, c.y + c.h, c.x, c.y + c.h - rayon + k, c.x, c.y + c.h - rayon].join(' ') + ' curveto');
                sortie.push(c.x + ' ' + (c.y + rayon) + ' lineto');
                sortie.push([c.x, c.y + rayon - k, c.x + rayon - k, c.y, c.x + rayon, c.y].join(' ') + ' curveto');
                sortie.push('closepath');
            } else {
                sortie.push('newpath ' + c.x + ' ' + c.y + ' moveto ' + c.w + ' 0 rlineto 0 ' + c.h + ' rlineto ' + (-c.w) + ' 0 rlineto closepath');
            }
            peindre(sortie, remplissage, trait, epaisseur, tirets);
        } else if (type === 'ellipse' || type === 'circle') {
            var e = coin(obj, decalX, decalY);
            var rx = e.w / 2, ry = e.h / 2, mcx = e.x + rx, mcy = e.y + ry;
            var kx = 0.5523 * rx, ky = 0.5523 * ry;
            sortie.push('newpath');
            sortie.push((mcx + rx) + ' ' + mcy + ' moveto');
            sortie.push([mcx + rx, mcy + ky, mcx + kx, mcy + ry, mcx, mcy + ry].join(' ') + ' curveto');
            sortie.push([mcx - kx, mcy + ry, mcx - rx, mcy + ky, mcx - rx, mcy].join(' ') + ' curveto');
            sortie.push([mcx - rx, mcy - ky, mcx - kx, mcy - ry, mcx, mcy - ry].join(' ') + ' curveto');
            sortie.push([mcx + kx, mcy - ry, mcx + rx, mcy - ky, mcx + rx, mcy].join(' ') + ' curveto');
            sortie.push('closepath');
            peindre(sortie, remplissage, trait, epaisseur, tirets);
        } else if (type === 'line' || type === 'polyline' || type === 'polygon' || type === 'path' || type === 'triangle') {
            var chemin = cheminDeLObjet(obj, decalX, decalY);
            if (chemin) {
                sortie.push('newpath ' + chemin);
                if (type === 'polygon' || type === 'triangle') sortie.push('closepath');
                peindre(sortie, remplissage, trait, epaisseur, tirets);
            }
        } else if (type === 'textbox' || type === 'i-text' || type === 'text') {
            texteEnPS(obj, decalX, decalY, sortie, ressources);
        } else if (type === 'image') {
            ressources.images.push({ obj: obj, coin: coin(obj, decalX, decalY) });
        } else if (type === 'group') {
            (obj._objects || []).forEach(function (enfant) { objetEnPS(enfant, decalX, decalY, sortie, ressources); });
        }
        sortie.push('grestore');
    }

    /* ASCII85, tel que `/ASCII85Decode filter` l'attend : 5 caractères par bloc de
       4 octets, « z » pour un bloc nul, `~>` pour la fin. Les octets produits ne sont
       pas du texte : on assemble le fichier en tableau d'octets. */
    function ascii85(u8) {
        var morceaux = [];
        for (var i = 0; i < u8.length; i += 4) {
            var bloc = [u8[i], u8[i + 1], u8[i + 2], u8[i + 3]];
            var n = 0;
            while (n < 4) { if (bloc[n] === undefined) bloc[n] = 0; n++; }
            var reste = u8.length - i;
            var v = ((bloc[0] << 24) >>> 0) + (bloc[1] << 16) + (bloc[2] << 8) + bloc[3];
            if (v === 0 && reste >= 4) { morceaux.push('z'); continue; }
            var c = new Array(5);
            for (var k = 4; k >= 0; k--) { c[k] = String.fromCharCode((v % 85) + 33); v = Math.floor(v / 85); }
            morceaux.push(c.slice(0, reste >= 4 ? 5 : reste + 1).join(''));
        }
        var s = morceaux.join('');
        var lignes = [];
        for (var j = 0; j < s.length; j += 78) lignes.push(s.slice(j, j + 78));
        return lignes.join('\n') + '~>';
    }

    /* Le JPEG d'un objet image, via un canevas hors écran : c'est le navigateur qui
       convertit, donc aucun décodeur PNG/JPEG à écrire ni à maintenir. */
    function jpegDeLObjet(obj) {
        return new Promise(function (resolve) {
            var w = Math.max(1, Math.round((obj.width || 1) * Math.abs(obj.scaleX || 1)));
            var h = Math.max(1, Math.round((obj.height || 1) * Math.abs(obj.scaleY || 1)));
            var k = Math.min(1, 3000 / Math.max(w, h));   /* plafond : un EPS de 200 Mo n'est pas un livrable */
            var cnv = document.createElement('canvas');
            cnv.width = Math.max(1, Math.round(w * k));
            cnv.height = Math.max(1, Math.round(h * k));
            var ctx = cnv.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, cnv.width, cnv.height);
            try { ctx.drawImage(obj._element, 0, 0, cnv.width, cnv.height); } catch (_) {}
            var url = cnv.toDataURL('image/jpeg', 0.92);
            var bin = atob(String(url).split(',')[1] || '');
            var u8 = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            resolve({ u8: u8, w: cnv.width, h: cnv.height });
        });
    }

    /* Le PostScript d'une page — asynchrone parce que les images doivent être
       converties AVANT que leur place dans le fichier ne soit écrite. */
    async function epsDePage(index) {
        var liste = hotes();
        var cv = liste[index];
        if (!cv) throw new Error('page ' + (index + 1) + ' introuvable');
        var format = formatDePage(index);
        var largeurPt = format.width * PT_PAR_MM;
        var hauteurPt = format.height * PT_PAR_MM;
        var fondPerduPt = fondPerduMm() * PT_PAR_MM;

        var ressources = { liste: {}, images: [] };
        ressources.police = function (nom) {
            var cle = nom.replace(/[^A-Za-z0-9]/g, '');
            ressources.liste[cle] = nom;
            return cle;
        };

        /* ⚠️ LE REPÈRE. PostScript a l'axe Y vers le HAUT, Fabric vers le BAS. On
           retourne la page UNE fois : tout le reste du fichier s'écrit alors dans les
           coordonnées du document, ce qui rend la conversion vérifiable à l'œil. */
        var corps = [];
        corps.push('gsave');
        corps.push('0 ' + hauteurPt.toFixed(3) + ' translate 1 -1 scale');
        (cv._objects || []).forEach(function (obj) { objetEnPS(obj, fondPerduPt, fondPerduPt, corps, ressources); });
        corps.push('grestore');

        /* Les images, converties maintenant, sont ajoutées après le corps : les
           données JPEG ne peuvent pas être entrecoupées d'opérateurs. */
        var imagesPS = ['% --- images (JPEG, filtre DCTDecode) ---'];
        for (var n = 0; n < ressources.images.length; n++) {
            var im = ressources.images[n];
            var jpg = await jpegDeLObjet(im.obj);
            imagesPS.push('gsave ' + im.coin.x.toFixed(3) + ' ' + im.coin.y.toFixed(3) + ' translate '
                + im.coin.w.toFixed(3) + ' ' + im.coin.h.toFixed(3) + ' scale');
            imagesPS.push('<< /ImageType 1 /Width ' + jpg.w + ' /Height ' + jpg.h
                + ' /BitsPerComponent 8 /ColorSpace /DeviceRGB /Decode [0 1 0 1 0 1]'
                + ' /ImageMatrix [1 0 0 -1 0 1] /Filter /DCTDecode /DataSource currentfile /ASCII85Decode filter >> image');
            imagesPS.push(ascii85(jpg.u8));
            imagesPS.push('grestore');
        }

        var entete = [
            '%!PS-Adobe-3.0 EPSF-3.0',
            '%%Creator: SuperPrint (sp-export-designer 1.7.670)',
            '%%Title: page ' + (index + 1) + ' — ' + format.width + 'x' + format.height + ' mm',
            '%%CreationDate: ' + new Date().toISOString(),
            '%%BoundingBox: 0 0 ' + Math.ceil(largeurPt) + ' ' + Math.ceil(hauteurPt),
            '%%HiResBoundingBox: 0 0 ' + largeurPt.toFixed(3) + ' ' + hauteurPt.toFixed(3),
            '%%LanguageLevel: 3',
            '%%Pages: 1',
            '%%EndComments'
        ];
        /* Chaque police est redéclarée avec ISOLatin1Encoding : sans cela « é à ç »
           sortent en caractères de contrôle sur un RIP. */
        Object.keys(ressources.liste).forEach(function (cle) {
            entete.push('/' + cle + ' /' + ressources.liste[cle] + ' findfont dup length dict begin');
            entete.push('  { 1 index /FID ne { def } { pop pop } ifelse } forall');
            entete.push('  /Encoding ISOLatin1Encoding def currentdict end definefont pop');
        });
        entete.push('%%EndProlog');
        entete.push('%%Page: 1 1');
        /* Fond de page blanc explicite : sans lui, certains RIP composent sur du noir. */
        entete.push('1 1 1 setrgbcolor 0 0 ' + largeurPt.toFixed(3) + ' ' + hauteurPt.toFixed(3) + ' rectfill');

        return entete.concat(corps, imagesPS, ['showpage', '%%EOF', '']).join('\n');
    }

    /* ══════════════════════════════════════════════════════════════════════════
       DOCX
       ══════════════════════════════════════════════════════════════════════════ */

    function echapperXml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /* Une page rendue en PNG à `dpi`, cadrée sur la PAGE (fond perdu exclu). */
    function pageEnPng(index, dpi) {
        return new Promise(function (resolve) {
            var cv = hotes()[index];
            if (!cv) { resolve(null); return; }
            var format = formatDePage(index);
            var ptW = format.width * PT_PAR_MM, ptH = format.height * PT_PAR_MM;
            var bp = fondPerduMm() * PT_PAR_MM;
            var mult = Math.max(1, dpi / 72);
            while (ptW * mult > 6000 || ptH * mult > 6000) mult *= 0.9;
            var el = null;
            try { el = cv.toCanvasElement({ multiplier: mult }); } catch (_) { el = cv.lowerCanvasEl; }
            if (!el) { resolve(null); return; }
            var cnv = document.createElement('canvas');
            cnv.width = Math.max(1, Math.round(ptW * mult));
            cnv.height = Math.max(1, Math.round(ptH * mult));
            var ctx = cnv.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, cnv.width, cnv.height);
            try { ctx.drawImage(el, bp * mult, bp * mult, ptW * mult, ptH * mult, 0, 0, cnv.width, cnv.height); } catch (_) {}
            resolve(cnv.toDataURL('image/png'));
        });
    }

    async function exporterDOCX(baseNom) {
        if (typeof window.ensureZipLib === 'function') await window.ensureZipLib();
        if (!window.JSZip) throw new Error('JSZip indisponible');
        var liste = hotes();
        if (!liste.length) throw new Error('aucune page');

        var zip = new JSZip();
        var medias = [];
        var paragraphes = [];

        for (var i = 0; i < liste.length; i++) {
            var format = formatDePage(i);
            var dataUrl = await pageEnPng(i, DPI_WORD);
            if (!dataUrl) continue;
            var bin = atob(dataUrl.split(',')[1] || '');
            var u8 = new Uint8Array(bin.length);
            for (var k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
            var nom = 'page' + (i + 1) + '.png';
            zip.file('word/media/' + nom, u8);
            medias.push({ nom: nom, index: i + 1, format: format });

            var wTw = Math.round(format.width * TWIPS_PAR_MM);
            var hTw = Math.round(format.height * TWIPS_PAR_MM);
            var cx = Math.round(format.width * EMU_PAR_MM);
            var cy = Math.round(format.height * EMU_PAR_MM);
            /* ⚠️ UNE SECTION WORD PAR PAGE, avec SON format : c'est la seule façon
               qu'un document multi-format reste juste dans Word — un saut de page ne
               change pas la taille du papier, un saut de section oui. Les marges sont
               à ZÉRO pour que l'image couvre la page exactement. */
            paragraphes.push(
                '<w:p><w:pPr>'
                + '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>'
                + '<w:jc w:val="center"/>'
                + '<w:sectPr>'
                + '<w:pgSz w:w="' + wTw + '" w:h="' + hTw + '"/>'
                + '<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/>'
                + '</w:sectPr>'
                + '</w:pPr>'
                + '<w:r><w:drawing>'
                + '<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
                + '<wp:extent cx="' + cx + '" cy="' + cy + '"/>'
                + '<wp:docPr id="' + (i + 1) + '" name="Page ' + (i + 1) + '"/>'
                + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
                + '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
                + '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
                + '<pic:nvPicPr><pic:cNvPr id="' + (i + 1) + '" name="' + nom + '"/><pic:cNvPicPr/></pic:nvPicPr>'
                + '<pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rIdImg' + (i + 1) + '"/>'
                + '<a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
                + '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>'
                + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
                + '</pic:pic></a:graphicData></a:graphic>'
                + '</wp:inline></w:drawing></w:r></w:p>'
            );
        }

        zip.file('[Content_Types].xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            + '<Default Extension="xml" ContentType="application/xml"/>'
            + '<Default Extension="png" ContentType="image/png"/>'
            + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
            + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
            + '</Types>');

        zip.file('_rels/.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
            + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
            + '</Relationships>');

        zip.file('word/_rels/document.xml.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + medias.map(function (m) {
                return '<Relationship Id="rIdImg' + m.index + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + m.nom + '"/>';
            }).join('')
            + '</Relationships>');

        zip.file('word/document.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            + '<w:body>' + paragraphes.join('') + '</w:body></w:document>');

        zip.file('docProps/core.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            + 'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
            + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            + '<dc:title>' + echapperXml(baseNom || 'SuperPrint') + '</dc:title>'
            + '<dc:creator>SuperPrint</dc:creator>'
            + '<cp:lastModifiedBy>SuperPrint</cp:lastModifiedBy>'
            + '<dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString() + '</dcterms:created>'
            + '</cp:coreProperties>');

        zip.file('docProps/app.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
            + '<Application>SuperPrint</Application><Pages>' + medias.length + '</Pages></Properties>');

        var blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        telecharger(blob, nomPropre(baseNom, 'docx'));
        return { pages: medias.length };
    }

    /* ══════════════════════════════════════════════════════════════════════════
       API PUBLIQUE
       ══════════════════════════════════════════════════════════════════════════ */

    async function exporterEPS(baseNom) {
        var liste = hotes();
        if (!liste.length) throw new Error('aucune page');
        var base = baseNom || window._spProjectName || 'superprint';
        for (var i = 0; i < liste.length; i++) {
            var ps = await epsDePage(i);
            var octets = new TextEncoder().encode(ps);
            telecharger(new Blob([octets], { type: 'application/postscript' }),
                nomPropre(base, 'eps', liste.length > 1 ? '-page' + String(i + 1).padStart(2, '0') : ''));
            /* Une petite pause entre deux téléchargements : les navigateurs bloquent
               la troisième pièce jointe déclenchée sans interaction. */
            if (liste.length > 1) await new Promise(function (r) { setTimeout(r, 350); });
        }
        return { pages: liste.length };
    }

    window.SPExportDesigner = {
        version: '1.7.670',
        eps: exporterEPS,
        docx: exporterDOCX,
        /* Exposés pour les bancs d'audit : contenu d'une page, sans téléchargement. */
        _epsDePage: epsDePage,
        _pageEnPng: pageEnPng
    };

    /* ── Branchement des deux boutons de la popin « Sauvegarder » ────────────────
       ⚠️ ON NE FERME LA POPIN QU'APRÈS COUP, et seulement en cas de succès : un
       export qui échoue doit laisser la fenêtre ouverte avec son message, sinon
       l'utilisateur voit la popin disparaître et croit que le fichier est écrit. */
    function dire(msg, genre) {
        try {
            if (typeof window.spShowToast === 'function') { window.spShowToast(msg, { kind: genre || 'info', duration: 6000 }); return; }
        } catch (_) {}
    }

    function brancher() {
        var boutonEPS = document.getElementById('saveEPS');
        var boutonDOCX = document.getElementById('saveDOCX');

        if (boutonEPS) boutonEPS.onclick = async function () {
            var avant = boutonEPS.disabled;
            boutonEPS.disabled = true;
            try {
                var r = await exporterEPS();
                if (typeof window.closeSaveModal === 'function') window.closeSaveModal();
                dire('EPS exporté — ' + r.pages + (r.pages > 1 ? ' fichiers (un par page)' : ' fichier'));
            } catch (e) {
                dire('Export EPS impossible : ' + (e && e.message ? e.message : e), 'error');
            } finally { boutonEPS.disabled = avant; }
        };

        if (boutonDOCX) boutonDOCX.onclick = async function () {
            var avant = boutonDOCX.disabled;
            boutonDOCX.disabled = true;
            try {
                var r = await exporterDOCX();
                if (typeof window.closeSaveModal === 'function') window.closeSaveModal();
                dire('Word exporté — ' + r.pages + ' page' + (r.pages > 1 ? 's' : '') + ' (une image pleine page par page)');
            } catch (e) {
                dire('Export Word impossible : ' + (e && e.message ? e.message : e), 'error');
            } finally { boutonDOCX.disabled = avant; }
        };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', brancher);
    else brancher();
})();
