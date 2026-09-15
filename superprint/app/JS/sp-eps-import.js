/* ============================================================================
   SuperPrint — sp-eps-import.js
   Import EPS / AI (PostScript, l'ancetre du SVG) — MODULE PARTAGE app + studio.

   Deux cas, tranches par SIGNATURE (jamais par extension) :

   1. EPS/AI « compatible PDF » -> le fichier EST un PDF (%PDF-1.x).
      Les .ai modernes (Illustrator CS+) sont TOUS dans ce cas : quelques centaines
      de Ko de PostScript prive + un PDF complet. On delegue alors a l'import PDF
      existant (pdf.js) qui rend le vectoriel, les polices et les images.
      Mesure sur un vrai .ai : 18 constructPath, 15 fill, 3 clip, 0 texte (les
      lettres sont converties en courbes).

   2. EPS PostScript pur (%!PS-Adobe) -> il faut l'interpreter. C'est ce module :
      un interpreteur du sous-ensemble Adobe Illustrator niveau 2, qui produit des
      sous-chemins peints convertis en fabric.Path groupes (comme l'import SVG).

   ⚠️ NE JAMAIS afficher le SVG/tmp de conversion dans un conteneur masque
      (visibility/opacity/display) : meme piege que svg2pdf, verifie ici aussi.

   API :  window.SPEps.detect(bytes)        -> 'pdf' | 'eps' | null
          window.SPEps.extractPsText(bytes) -> texte PostScript ou null
          window.SPEps.parse(text)          -> { paths, bbox, stats, warnings }
          window.SPEps.toFabricGroup(parsed, fabric) -> fabric.Group
          window.SPEps.importance(parsed)   -> score 0..1 (fichier utile ?)
   ============================================================================ */
(function (global) {
    'use strict';

    var VERSION = '1.0.0';
    var MM_PER_PT = 25.4 / 72;      // 1 pt PostScript = 0.352777… mm

    /* ---------------------------------------------------------------- */
    /* 1. DETECTION PAR SIGNATURE                                       */
    /* ---------------------------------------------------------------- */

    function asUint8(bytes) {
        if (!bytes) return null;
        if (bytes instanceof Uint8Array) return bytes;
        if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
        if (bytes.buffer) return new Uint8Array(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength);
        return null;
    }

    function ascii(bytes, start, len) {
        var s = '';
        for (var i = 0; i < len && start + i < bytes.length; i++) {
            var c = bytes[start + i];
            s += (c >= 32 && c < 127) ? String.fromCharCode(c) : '.';
        }
        return s;
    }

    // Cherche une signature dans les N premiers octets (les EPS a prefixe binaire
    // DOS/Windows — magic C5 D0 D3 C6 — portent le PostScript plus loin).
    function findAscii(bytes, motif, limite) {
        var max = Math.min(bytes.length - motif.length, limite || 4096);
        for (var i = 0; i <= max; i++) {
            var ok = true;
            for (var j = 0; j < motif.length; j++) {
                if (bytes[i + j] !== motif.charCodeAt(j)) { ok = false; break; }
            }
            if (ok) return i;
        }
        return -1;
    }

    function detect(bytes) {
        var b = asUint8(bytes);
        if (!b || b.length < 8) return null;
        // PDF en tete -> .ai moderne ou EPS compatible PDF
        if (ascii(b, 0, 5) === '%PDF-') return 'pdf';
        // PostScript en tete
        if (ascii(b, 0, 4) === '%!PS') return 'eps';
        // Prefixe binaire DOS EPS (C5 D0 D3 C6) : adresse du PostScript a l'offset 4
        if (b[0] === 0xC5 && b[1] === 0xD0 && b[2] === 0xD3 && b[3] === 0xC6) return 'eps';
        // PostScript plus loin (prefixe PICT/TIFF/MetaFile, BOM, espaces…)
        var pos = findAscii(b, '%!PS', 4096);
        if (pos > 0) return 'eps';
        // PDF plus loin (BOM, ligne vide avant %PDF)
        var posPdf = findAscii(b, '%PDF-', 4096);
        if (posPdf > 0) return 'pdf';
        return null;
    }

    /* ---------------------------------------------------------------- */
    /* 2. EXTRACTION DU TEXTE POSTSCRIPT                                */
    /* ---------------------------------------------------------------- */

    // Renvoie le texte PostScript, en sautant un eventuel prefixe binaire et les
    // blocs de prevualisation (%%BeginPreview … %%EndPreview) qui contiennent des
    // octets binaires et non du PostScript.
    function extractPsText(bytes) {
        var b = asUint8(bytes);
        if (!b) return null;
        var pos = findAscii(b, '%!PS', 4096);
        if (pos < 0) return null;

        // Prefixe binaire DOS EPS : l'en-tete fait 30 octets et donne l'offset du PS.
        if (b[0] === 0xC5 && b[0 + 1] === 0xD0 && pos !== 30) {
            var off = b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24);
            if (off >= 0 && off < b.length && ascii(b, off, 4) === '%!PS') pos = off;
        }

        // Decodage latin1 (les EPS sont en ASCII/latin1 dans leur partie utile)
        var brut = '';
        var CH = 32768;
        for (var i = pos; i < b.length; i += CH) {
            brut += String.fromCharCode.apply(null, b.subarray(i, Math.min(i + CH, b.length)));
        }
        // Sauts de ligne normalises
        brut = brut.replace(/\r\n?/g, '\n');

        // Sections de DONNEES NON POSTSCRIPT : elles contiennent des octets
        // binaires ou de l'hexa qui perturberaient le tokeniseur. On les retire.
        // (%%BeginPreview / %%BeginBinary / %%BeginData — l'equivalent de
        //  %%EndPreview / %%EndBinary / %%EndData.)
        var lignes = brut.split('\n');
        var garde = [];
        var saut = null;
        for (var li = 0; li < lignes.length; li++) {
            var l = lignes[li];
            if (saut) {
                if (l.indexOf(saut) === 0) { saut = null; }
                continue;
            }
            if (l.indexOf('%%BeginPreview') === 0) { saut = '%%EndPreview'; continue; }
            if (l.indexOf('%%BeginBinary') === 0) { saut = '%%EndBinary'; continue; }
            if (l.indexOf('%%BeginData') === 0) { saut = '%%EndData'; continue; }
            garde.push(l);
        }
        return garde.join('\n');
    }

    /* ---------------------------------------------------------------- */
    /* 3. LECTURE DES COMMENTAIRES STRUCTURANTS (%%BoundingBox …)       */
    /* ---------------------------------------------------------------- */

    function lireEntete(texte) {
        var info = { bbox: null, hires: null, creator: '', ai: '' };
        var lignes = texte.split('\n', 200);
        for (var i = 0; i < lignes.length; i++) {
            var l = lignes[i];
            var m;
            if ((m = l.match(/^%%BoundingBox:\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/))) {
                info.bbox = [+m[1], +m[2], +m[3], +m[4]];
            } else if ((m = l.match(/^%%HiResBoundingBox:\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/))) {
                info.hires = [+m[1], +m[2], +m[3], +m[4]];
            } else if ((m = l.match(/^%%Creator:\s*(.*)$/))) {
                info.creator = m[1].trim();
            } else if ((m = l.match(/^%AI\d*_FileFormat\s+(\S+)/))) {
                info.ai = m[1];
            }
            if (/^%%EndComments/.test(l)) break;
        }
        return info;
    }

    /* ---------------------------------------------------------------- */
    /* 4. TOKENISEUR POSTSCRIPT                                         */
    /* ---------------------------------------------------------------- */

    // Produit une suite de tokens : {t:'num'|'name'|'str'|'proc'|'op', v:…}
    // - les commentaires % … sont ignores (sauf s'ils sont demandes)
    // - les chaines (...) avec parentheses imbriquees et echappements
    // - les chaines hexa <…>
    // - les procedures { … } sont comptees en profondeur et rendues comme un bloc
    function tokenize(src) {
        var toks = [];
        var i = 0, n = src.length;
        var DELIM = '()<>[]{}/%';

        function estDelim(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\v'; }

        while (i < n) {
            var c = src[i];
            if (estDelim(c)) { i++; continue; }

            // Commentaire : jusqu'a fin de ligne
            if (c === '%') {
                while (i < n && src[i] !== '\n') i++;
                continue;
            }

            // Chaine litterale ( … )
            if (c === '(') {
                var prof = 1, s = '';
                i++;
                while (i < n && prof > 0) {
                    var ch = src[i];
                    if (ch === '\\') {
                        var nx = src[i + 1];
                        // \nnn octal, \( \) \\ etc.
                        if (nx >= '0' && nx <= '7') {
                            var oct = '';
                            i++;
                            while (oct.length < 3 && src[i] >= '0' && src[i] <= '7') { oct += src[i]; i++; }
                            s += String.fromCharCode(parseInt(oct, 8) & 0xFF);
                            continue;
                        }
                        if (nx === 'n') { s += '\n'; i += 2; continue; }
                        if (nx === 'r') { s += '\r'; i += 2; continue; }
                        if (nx === 't') { s += '\t'; i += 2; continue; }
                        if (nx === '\n') { i += 2; continue; }   // continuation de ligne
                        s += (nx === undefined ? '' : nx);
                        i += 2;
                        continue;
                    }
                    if (ch === '(') { prof++; s += ch; i++; continue; }
                    if (ch === ')') { prof--; if (prof === 0) { i++; break; } s += ch; i++; continue; }
                    s += ch; i++;
                }
                toks.push({ t: 'str', v: s });
                continue;
            }

            // Chaine hexa < … >
            if (c === '<') {
                // attention : << est un dictionnaire
                if (src[i + 1] === '<') { toks.push({ t: 'op', v: '<<' }); i += 2; continue; }
                var hx = '', k = i + 1;
                while (k < n && src[k] !== '>') { hx += src[k]; k++; }
                i = k + 1;
                toks.push({ t: 'str', v: hx, hex: true });
                continue;
            }
            if (c === '>') {
                if (src[i + 1] === '>') { toks.push({ t: 'op', v: '>>' }); i += 2; continue; }
                i++; continue;
            }

            // Procedure { … }
            if (c === '{') {
                var prof2 = 1, debut = i + 1;
                i++;
                while (i < n && prof2 > 0) {
                    var c2 = src[i];
                    if (c2 === '{') prof2++;
                    else if (c2 === '}') { prof2--; if (prof2 === 0) break; }
                    else if (c2 === '(') {           // sauter une chaine dans la procedure
                        var p3 = 1; i++;
                        while (i < n && p3 > 0) {
                            if (src[i] === '\\') { i += 2; continue; }
                            if (src[i] === '(') p3++;
                            else if (src[i] === ')') { p3--; if (p3 === 0) break; }
                            i++;
                        }
                    }
                    i++;
                }
                toks.push({ t: 'proc', v: src.slice(debut, i) });
                i++;
                continue;
            }
            // Tableau [ … ]
            if (c === '[') { toks.push({ t: 'op', v: '[' }); i++; continue; }
            if (c === ']') { toks.push({ t: 'op', v: ']' }); i++; continue; }
            if (c === '}') { toks.push({ t: 'op', v: '}' }); i++; continue; }

            // Nom litteral /xxx  — ATTENTION : '/' est un delimiteur, donc la
            // boucle de lecture ci-dessous ne consommerait RIEN et le nom serait
            // lu comme un OPERATEUR inconnu (/GS0 gs -> parametre fantome).
            if (c === '/') {
                var jn = i + 1;
                while (jn < n && !estDelim(src[jn]) && DELIM.indexOf(src[jn]) < 0) jn++;
                toks.push({ t: 'name', v: src.slice(i + 1, jn) });
                i = jn;
                continue;
            }

            // Jeton simple
            var j = i;
            while (j < n && !estDelim(src[j]) && DELIM.indexOf(src[j]) < 0) j++;
            var mot = src.slice(i, j);
            if (j === i) { i++; continue; }

            if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(mot)) {
                toks.push({ t: 'num', v: parseFloat(mot) });
            } else if (mot === 'true' || mot === 'false') {
                toks.push({ t: 'num', v: mot === 'true' ? 1 : 0 });
            } else {
                toks.push({ t: 'op', v: mot });
            }
            i = j;
        }
        return toks;
    }

    /* ---------------------------------------------------------------- */
    /* 5. COULEURS                                                      */
    /* ---------------------------------------------------------------- */

    function cmykToHex(c, m, y, k) {
        c = min1(c); m = min1(m); y = min1(y); k = min1(k);
        var r = Math.round(255 * (1 - c) * (1 - k));
        var g = Math.round(255 * (1 - m) * (1 - k));
        var b = Math.round(255 * (1 - y) * (1 - k));
        return rgbToHex(r, g, b);
    }
    function rgbToHex(r, g, b) {
        var h = function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); };
        return '#' + h(r) + h(g) + h(b);
    }
    function grayToHex(v) { var n = Math.round(255 * (1 - min1(v))); return rgbToHex(n, n, n); }
    function min1(v) { v = Number(v); if (!isFinite(v)) return 0; return v < 0 ? 0 : (v > 1 ? 1 : v); }

    /* ---------------------------------------------------------------- */
    /* 6. INTERPRETEUR (sous-ensemble Adobe Illustrator niveau 2)        */
    /* ---------------------------------------------------------------- */

    // Le sous-ensemble couvre tout ce qu'Illustrator / CorelDraw / Inkscape
    // ecrivent pour un logo vectoriel. Tout ce qui n'est pas reconnu est
    // IGNORE silencieusement mais compte dans les statistiques (jamais de
    // blocage : un EPS inconnu doit produire quelque chose, pas une erreur).
    var OPS_CHEMIN = [
        'm', 'moveto', 'l', 'lineto', 'c', 'curveto', 'v', 'y', 'h', 'closepath',
        'rmoveto', 'rlineto', 'rcurveto', 'arc', 'arcn', 'arct', 'arcto', 'rect', 're'
    ];
    var OPS_PEINT = ['f', 'F', 'fill', 'eofill', 'b', 'B', 'b*', 'B*', 'S', 's', 'stroke', 'n', 'N'];
    var OPS_CLIP = ['W', 'W*', 'clip', 'eoclip'];
    var OPS_SAVE = ['q', 'gsave', 'save'];
    var OPS_REST = ['Q', 'grestore', 'restore'];
    var OPS_NOISE = [
        'setlinewidth', 'w', 'setlinejoin', 'j', 'setlinecap', 'J', 'setmiterlimit', 'M',
        'setdash', 'd', 'showpage', 'gs', 'setcolorspace', 'currentdict', 'def', 'begin',
        'end', 'dict', 'pop', 'dup', 'exch', 'roll', 'index', 'copy', 'clear', 'mark',
        'cleartomark', 'bind', 'exec', 'if', 'ifelse', 'for', 'repeat', 'loop', 'quit',
        'setcachedevice', 'setcharwidth', 'settransfer', 'setflat', 'true', 'false',
        'concat', 'setmatrix', 'initclip', 'banddevice', 'framedevice', 'nulldevice',
        'setpagedevice', 'setstrokeadjust', 'setoverprint', 'setopacityalpha',
        'setshapealpha', 'setblendmode', 'setcolorrendering', 'setcmykcolor', 'setrgbcolor',
        'setgray', 'push', 'systemdict', 'userdict', 'currentdict', 'version', 'save'
    ];

    function mkMtx(a, b, c, d) { return [a, b, c, d, 0, 0]; }
    function mtxMul(m1, m2) {
        // m2 applique apres m1 : resultat = m1 x m2
        return [
            m1[0] * m2[0] + m1[2] * m2[1],
            m1[1] * m2[0] + m1[3] * m2[1],
            m1[0] * m2[2] + m1[2] * m2[3],
            m1[1] * m2[2] + m1[3] * m2[3],
            m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
            m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
        ];
    }
    function mtxPoint(m, x, y) {
        return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    }

    function parse(src) {
        var entete = lireEntete(src);
        var toks = tokenize(src);

        var st = {
            pile: [],
            ctm: [1, 0, 0, 1, 0, 0],
            pileCtm: [],
            fill: { hex: '#000000' },
            stroke: { hex: '#000000' },
            lineWidth: 1,
            lineJoin: 'miter',
            lineCap: 'butt',
            dash: null
        };

        var chemins = [];       // sous-chemins fermes/a peindre
        var courant = null;     // sous-chemin en cours
        var segments = [];      // segments du chemin courant (tous sous-chemins)
        var stats = { ops: 0, inconnus: {}, ignoreDefs: 0, tokens: toks.length };
        var warnings = [];
        var bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

        function suivrePoint(x, y) {
            if (x < bbox.minX) bbox.minX = x;
            if (y < bbox.minY) bbox.minY = y;
            if (x > bbox.maxX) bbox.maxX = x;
            if (y > bbox.maxY) bbox.maxY = y;
        }

        function nouveauSousChemin() { courant = []; segments.push(courant); }

        function pt(x, y) {
            var p = mtxPoint(st.ctm, x, y);
            suivrePoint(p[0], p[1]);
            return p;
        }

        function vide() { return st.pile.length; }
        function nombre() { var v = st.pile.pop(); return typeof v === 'number' ? v : 0; }

        // ── Peinture du chemin courant ──────────────────────────────────
        function peindre(type) {
            // type : 'fill' | 'stroke' | 'both' | 'none'
            if (!segments.length) return;
            var garder = segments.filter(function (s) { return s.length > 1; });
            if (garder.length) {
                var d = construireD(garder);
                if (d) {
                    chemins.push({
                        d: d,
                        fill: (type === 'fill' || type === 'both') ? st.fill.hex : null,
                        stroke: (type === 'stroke' || type === 'both') ? st.stroke.hex : null,
                        strokeWidth: st.lineWidth,
                        lineJoin: st.lineJoin,
                        lineCap: st.lineCap,
                        dash: st.dash
                    });
                }
            }
            segments = [];
            courant = null;
        }

        function construireD(subs) {
            var out = [];
            for (var i = 0; i < subs.length; i++) {
                var s = subs[i];
                for (var j = 0; j < s.length; j++) {
                    var seg = s[j];
                    if (seg[0] === 'M') out.push('M', r(seg[1]), r(seg[2]));
                    else if (seg[0] === 'L') out.push('L', r(seg[1]), r(seg[2]));
                    else if (seg[0] === 'C') out.push('C', r(seg[1]), r(seg[2]), r(seg[3]), r(seg[4]), r(seg[5]), r(seg[6]));
                    else if (seg[0] === 'Z') out.push('Z');
                }
            }
            return out.join(' ');
        }
        function r(v) {
            var n = Math.round(v * 1000) / 1000;
            return String(n);
        }

        // Applique la transformation courante a un point de controle RELATIF
        // pour un curveto : on doit transformer les points de controle par la
        // matrice courante (une transformation affine conserve les Bezier).
        function ctrl(x, y, dernier) {
            if (dernier) { var p = mtxPoint(st.ctm, x, y); return [p[0], p[1]]; }
            var p2 = mtxPoint(st.ctm, x, y); return [p2[0], p2[1]];
        }

        for (var ti = 0; ti < toks.length; ti++) {
            var tok = toks[ti];
            stats.ops++;

            if (tok.t === 'num') { st.pile.push(tok.v); continue; }
            if (tok.t === 'name') { st.pile.push({ name: tok.v }); continue; }
            if (tok.t === 'str') { st.pile.push({ str: tok.v }); continue; }
            if (tok.t === 'proc') { st.pile.push({ proc: tok.v }); continue; }

            var op = tok.v;

            // Dictionnaire / tableau : on ne suit pas la pile, on l'ignore
            if (op === '<<' || op === '>>' || op === '[' || op === ']' || op === '}') { continue; }

            // ── Constructions de chemin ──
            if (op === 'newpath') { segments = []; courant = null; continue; }
            if (op === 'm' || op === 'moveto') {
                var ym = nombre(), xm = nombre();
                var pm = pt(xm, ym);
                nouveauSousChemin();
                courant.push(['M', pm[0], pm[1]]);
                continue;
            }
            if (op === 'rmoveto') {
                var dy = nombre(), dx = nombre();
                var base = courant && courant.length ? courant[courant.length - 1] : null;
                // rmoveto se refere au point courant en coordonnees UTILISATEUR :
                // on repasse en local via la matrice inverse — cas rare, on approxime
                // en utilisant le dernier point transforme.
                var bx = base ? base[base.length - 2] : 0;
                var by = base ? base[base.length - 1] : 0;
                // Le delta est en coordonnees utilisateur : on le transforme par la
                // partie lineaire de la matrice.
                var ddx = st.ctm[0] * dx + st.ctm[2] * dy;
                var ddy = st.ctm[1] * dx + st.ctm[3] * dy;
                nouveauSousChemin();
                courant.push(['M', bx + ddx, by + ddy]);
                continue;
            }
            if (op === 'l' || op === 'lineto') {
                var yl = nombre(), xl = nombre();
                var pl = pt(xl, yl);
                if (!courant) nouveauSousChemin();
                courant.push(['L', pl[0], pl[1]]);
                continue;
            }
            if (op === 'rlineto') {
                var dy2 = nombre(), dx2 = nombre();
                var last = courant && courant.length ? courant[courant.length - 1] : null;
                var lx = last ? last[last.length - 2] : 0;
                var ly = last ? last[last.length - 1] : 0;
                var ddx2 = st.ctm[0] * dx2 + st.ctm[2] * dy2;
                var ddy2 = st.ctm[1] * dx2 + st.ctm[3] * dy2;
                if (!courant) nouveauSousChemin();
                courant.push(['L', lx + ddx2, ly + ddy2]);
                continue;
            }
            if (op === 'c' || op === 'curveto') {
                var y3 = nombre(), x3 = nombre(), y2 = nombre(), x2 = nombre(), y1 = nombre(), x1 = nombre();
                var c1 = pt(x1, y1), c2 = pt(x2, y2), c3 = pt(x3, y3);
                if (!courant) nouveauSousChemin();
                courant.push(['C', c1[0], c1[1], c2[0], c2[1], c3[0], c3[1]]);
                continue;
            }
            if (op === 'v') {   // curveto : point courant + 2 points
                var yv3 = nombre(), xv3 = nombre(), yv2 = nombre(), xv2 = nombre();
                var vc2 = pt(xv2, yv2), vc3 = pt(xv3, yv3);
                var vlast = courant && courant.length ? courant[courant.length - 1] : null;
                var vx = vlast ? vlast[vlast.length - 2] : 0;
                var vy = vlast ? vlast[vlast.length - 1] : 0;
                if (!courant) nouveauSousChemin();
                courant.push(['C', vx, vy, vc2[0], vc2[1], vc3[0], vc3[1]]);
                continue;
            }
            if (op === 'y') {   // curveto : 2 points + point final
                var yy3 = nombre(), xy3 = nombre(), yy2 = nombre(), xy2 = nombre();
                var yc2 = pt(xy2, yy2), yc3 = pt(xy3, yy3);
                if (!courant) nouveauSousChemin();
                courant.push(['C', yc2[0], yc2[1], yc3[0], yc3[1], yc3[0], yc3[1]]);
                continue;
            }
            if (op === 'rcurveto') {
                var r6 = nombre(), r5 = nombre(), r4 = nombre(), r3 = nombre(), r2 = nombre(), r1 = nombre();
                var rlast = courant && courant.length ? courant[courant.length - 1] : null;
                var rx = rlast ? rlast[rlast.length - 2] : 0;
                var ry = rlast ? rlast[rlast.length - 1] : 0;
                var R1 = mtxPoint(st.ctm, r1, r2), R2 = mtxPoint(st.ctm, r3, r4), R3 = mtxPoint(st.ctm, r5, r6);
                var O = mtxPoint(st.ctm, 0, 0);
                if (!courant) nouveauSousChemin();
                courant.push(['C',
                    rx + (R1[0] - O[0]), ry + (R1[1] - O[1]),
                    rx + (R2[0] - O[0]), ry + (R2[1] - O[1]),
                    rx + (R3[0] - O[0]), ry + (R3[1] - O[1])]);
                continue;
            }
            if (op === 'h' || op === 'closepath') {
                if (courant) courant.push(['Z']);
                continue;
            }
            if (op === 're' || op === 'rect') {
                var rh = nombre(), rw = nombre(), ry0 = nombre(), rx0 = nombre();
                var q1 = pt(rx0, ry0), q2 = pt(rx0 + rw, ry0), q3 = pt(rx0 + rw, ry0 + rh), q4 = pt(rx0, ry0 + rh);
                nouveauSousChemin();
                courant.push(['M', q1[0], q1[1]]);
                courant.push(['L', q2[0], q2[1]]);
                courant.push(['L', q3[0], q3[1]]);
                courant.push(['L', q4[0], q4[1]]);
                courant.push(['Z']);
                courant = null;   // 're' termine le sous-chemin : la peinture suit
                continue;
            }
            if (op === 'arc' || op === 'arcn' || op === 'arct' || op === 'arcto') {
                // Approximation : on consomme les operandes et on trace une ligne
                // vers le point d'arrivee (cas marginal pour un logo).
                var nargs = (op === 'arcto') ? 5 : 5;
                var args = [];
                for (var ai = 0; ai < nargs; ai++) args.unshift(nombre());
                var ax = args[0], ay = args[1], aw = args[2], ah = args[3];
                var pa = pt(ax + aw, ay + ah / 2);
                if (!courant) nouveauSousChemin();
                courant.push(['L', pa[0], pa[1]]);
                stats.inconnus[op] = (stats.inconnus[op] || 0) + 1;
                continue;
            }

            // ── Peinture / clip ──
            if (op === 'f' || op === 'F' || op === 'fill' || op === 'eofill' ||
                op === 'b' || op === 'B' || op === 'b*' || op === 'B*') {
                var both = (op === 'b' || op === 'B' || op === 'b*' || op === 'B*');
                peindre(both ? 'both' : 'fill');
                continue;
            }
            if (op === 'S' || op === 's' || op === 'stroke') { peindre('stroke'); continue; }
            if (op === 'n' || op === 'N') { peindre('none'); continue; }
            if (op === 'W' || op === 'W*' || op === 'clip' || op === 'eoclip') {
                // Un clip n'est PAS peint : on le laisse au chemin courant, le
                // 'n' qui suit generalement le jettera. S'il n'y a pas de 'n',
                // c'est la peinture suivante (fill/stroke) qui l'utilisera.
                continue;
            }

            // ── Couleurs ──
            if (op === 'g' || op === 'setgray') { st.fill = { hex: grayToHex(nombre()) }; continue; }
            if (op === 'G') { st.stroke = { hex: grayToHex(nombre()) }; continue; }
            if (op === 'rg' || op === 'setrgbcolor') {
                var b1 = nombre(), g1 = nombre(), r1c = nombre();
                st.fill = { hex: rgbToHex(r1c * 255, g1 * 255, b1 * 255) };
                continue;
            }
            if (op === 'RG') {
                var b2 = nombre(), g2 = nombre(), r2c = nombre();
                st.stroke = { hex: rgbToHex(r2c * 255, g2 * 255, b2 * 255) };
                continue;
            }
            if (op === 'k' || op === 'setcmykcolor') {
                var kk = nombre(), ky = nombre(), km = nombre(), kc = nombre();
                st.fill = { hex: cmykToHex(kc, km, ky, kk) };
                continue;
            }
            if (op === 'K') {
                var kk2 = nombre(), ky2 = nombre(), km2 = nombre(), kc2 = nombre();
                st.stroke = { hex: cmykToHex(kc2, km2, ky2, kk2) };
                continue;
            }

            // ── Etat graphique ──
            if (op === 'q' || op === 'gsave' || op === 'save') {
                st.pileCtm.push({ ctm: st.ctm.slice(), fill: st.fill, stroke: st.stroke, lineWidth: st.lineWidth, lineJoin: st.lineJoin, lineCap: st.lineCap, dash: st.dash });
                continue;
            }
            if (op === 'Q' || op === 'grestore' || op === 'restore') {
                var e = st.pileCtm.pop();
                if (e) {
                    st.ctm = e.ctm; st.fill = e.fill; st.stroke = e.stroke;
                    st.lineWidth = e.lineWidth; st.lineJoin = e.lineJoin; st.lineCap = e.lineCap; st.dash = e.dash;
                }
                continue;
            }
            if (op === 'cm' || op === 'concat') {
                var m6 = nombre(), m5 = nombre(), m4 = nombre(), m3 = nombre(), m2 = nombre(), m1 = nombre();
                st.ctm = mtxMul(st.ctm, [m1, m2, m3, m4, m5, m6]);
                continue;
            }
            if (op === 'translate') {
                var ty = nombre(), tx = nombre();
                st.ctm = mtxMul(st.ctm, [1, 0, 0, 1, tx, ty]);
                continue;
            }
            if (op === 'scale') {
                // sx sy scale : le dernier pousse est sy
                var s2 = nombre();
                var s1 = (st.pile.length && typeof st.pile[st.pile.length - 1] === 'number') ? st.pile.pop() : s2;
                st.ctm = mtxMul(st.ctm, [s1, 0, 0, s2, 0, 0]);
                continue;
            }
            if (op === 'rotate') {
                var ang = nombre() * Math.PI / 180;
                var ca = Math.cos(ang), sa = Math.sin(ang);
                st.ctm = mtxMul(st.ctm, [ca, sa, -sa, ca, 0, 0]);
                continue;
            }
            if (op === 'setlinewidth' || op === 'w') { st.lineWidth = nombre(); continue; }
            if (op === 'setlinejoin' || op === 'j') {
                var lj = nombre();
                st.lineJoin = (lj === 1) ? 'round' : (lj === 2 ? 'bevel' : 'miter');
                continue;
            }
            if (op === 'setlinecap' || op === 'J') {
                var lc = nombre();
                st.lineCap = (lc === 1) ? 'round' : (lc === 2 ? 'square' : 'butt');
                continue;
            }
            if (op === 'setdash' || op === 'd') {
                // [a b] offset setdash : le tableau a ete empile comme tokens op.
                // On vide la pile jusqu'au prochain marqueur utilisable.
                st.pile.length = 0;
                continue;
            }

            // ── Ignore explicitement ──
            if (op === 'def') {
                // /nom valeur def -> on depile les 2 operandes pour garder une
                // pile coherente (sinon les definitions de prologue s'accumulent).
                st.pile.pop(); st.pile.pop();
                stats.ignoreDefs++;
                continue;
            }
            if (op === 'gs') {
                // /GS0 gs -> on depile le nom
                if (st.pile.length) st.pile.pop();
                continue;
            }
            if (OPS_NOISE.indexOf(op) >= 0) {
                stats.ignoreDefs++;
                continue;
            }

            // Operateur inconnu : on note et on continue (jamais de blocage)
            stats.inconnus[op] = (stats.inconnus[op] || 0) + 1;
            // Securite : si la pile grossit trop (structure non comprise), la vider
            if (st.pile.length > 400) st.pile.length = 0;
        }

        // Un EPS peut laisser un chemin non peint : on l'oublie (comportement PostScript).
        // REPERE : on prefere TOUJOURS le %%BoundingBox declare, car il definit le
        // cadre de l'oeuvre (marges comprises). La boite dessinee n'est qu'un repli.
        var dessine = isFinite(bbox.minX) ? bbox : null;
        var bb = entete.hires || entete.bbox || dessine || { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        bbox = { minX: bb[0], minY: bb[1], maxX: bb[2], maxY: bb[3] };

        // ── PASSAGE DU REPERE POSTSCRIPT AU REPERE FABRIC ──
        // PostScript : y vers le HAUT, origine = bas-gauche de la BoundingBox.
        // Fabric     : y vers le BAS,  origine = haut-gauche.
        //    X = x - minX          Y = maxY - y
        // On le fait ici, une fois pour toutes : il n'y a ainsi AUCUNE chance
        // qu'une deuxieme conversion soit appliquee plus loin.
        for (var ci = 0; ci < chemins.length; ci++) {
            chemins[ci].d = convertirD(chemins[ci].d, bbox, 1);
        }

        var nbInconnus = Object.keys(stats.inconnus).reduce(function (a, k) { return a + stats.inconnus[k]; }, 0);

        return {
            version: VERSION,
            entete: entete,
            paths: chemins,
            bbox: bbox,
            stats: {
                tokens: stats.tokens,
                chemins: chemins.length,
                fills: chemins.filter(function (c) { return c.fill; }).length,
                strokes: chemins.filter(function (c) { return c.stroke; }).length,
                inconnus: stats.inconnus,
                nbInconnus: nbInconnus
            },
            warnings: warnings
        };
    }

    /* ---------------------------------------------------------------- */
    /* 7. CONVERSION EN OBJETS FABRIC                                   */
    /* ---------------------------------------------------------------- */

    // Les chemins sont exprimes en POINTS PostScript avec y vers le HAUT.
    // Fabric travaille en px a 72 dpi (1 pt = 1 px) avec y vers le BAS.
    //   X = (x - minX) * echelle
    //   Y = (maxY - y) * echelle
    function convertirD(d, bbox, echelle) {
        var out = [];
        var toks = d.split(/\s+/);
        var k = 0;
        function L(v) { return Math.round((v - bbox.minX) * echelle * 1000) / 1000; }
        function T(v) { return Math.round((bbox.maxY - v) * echelle * 1000) / 1000; }
        while (k < toks.length) {
            var c = toks[k++];
            if (c === 'M' || c === 'L') { out.push(c, L(+toks[k++]), T(+toks[k++])); }
            else if (c === 'C') {
                out.push('C', L(+toks[k++]), T(+toks[k++]), L(+toks[k++]), T(+toks[k++]), L(+toks[k++]), T(+toks[k++]));
            } else if (c === 'Z') { out.push('Z'); }
        }
        return out.join(' ');
    }

    function toFabricGroup(parsed, fabricRef) {
        var F = fabricRef || global.fabric;
        if (!F) throw new Error('fabric absent');
        if (!parsed || !parsed.paths || !parsed.paths.length) return null;

        var bb = parsed.bbox;
        var largPS = Math.max(1, bb.maxX - bb.minX);
        var hautPS = Math.max(1, bb.maxY - bb.minY);

        var objets = [];
        for (var i = 0; i < parsed.paths.length; i++) {
            var p = parsed.paths[i];
            // Les 'd' sont DEJA dans le repere Fabric (y inverse) : voir parse().
            var dd = p.d;
            if (!dd) continue;
            var opts = {
                fill: p.fill || null,
                stroke: p.stroke || null,
                strokeWidth: p.stroke ? Math.max(0.1, p.strokeWidth || 1) : 0,
                strokeLineJoin: p.lineJoin || 'miter',
                strokeLineCap: p.lineCap || 'butt',
                strokeUniform: true,
                objectCaching: false
            };
            if (p.fill) opts.fillRule = 'nonzero';
            try {
                objets.push(new F.Path(dd, opts));
            } catch (e) { /* sous-chemin invalide : ignore */ }
        }
        if (!objets.length) return null;

        var groupe = null;
        try {
            groupe = (objets.length === 1) ? objets[0] : F.util.groupSVGElements(objets, {});
        } catch (e) {
            try { groupe = new F.Group(objets); } catch (e2) { groupe = objets[0]; }
        }
        groupe.set({
            _spEpsImport: true,
            _spEpsPaths: objets.length,
            _spEpsBBoxPS: [bb.minX, bb.minY, bb.maxX, bb.maxY]
        });
        return { group: groupe, largeurPS: largPS, hauteurPS: hautPS, nbPaths: objets.length };
    }

    // Score d'utilite : un EPS exploitable a des chemins peints et peu d'inconnus.
    // Un logo vectoriel simple = 3 a 10 chemins ; le score doit donc monter tôt.
    function importance(parsed) {
        if (!parsed || !parsed.stats) return 0;
        var n = parsed.stats.chemins;
        if (!n) return 0;
        var part = Math.min(1, n / 8);                    // 8 chemins = plein credit
        var inconnuPart = parsed.stats.nbInconnus / Math.max(1, parsed.stats.tokens);
        var penalite = (inconnuPart > 0.05) ? Math.min(0.5, inconnuPart * 5) : 0;
        return Math.max(0, Math.min(1, 0.25 + 0.75 * part - penalite));
    }

    /* ---------------------------------------------------------------- */
    /* 8. SERIALISATION SVG (pour le STUDIO et les apercus)             */
    /* ---------------------------------------------------------------- */

    // Produit un SVG STANDARD a partir de l'analyse. Les 'd' sont deja dans le
    // repere Fabric (y inverse, origine = coin haut-gauche de la BoundingBox),
    // donc le viewBox est simplement la taille de l'oeuvre.
    //   largeur = maxX - minX      hauteur = maxY - minY
    function toSvg(parsed, opts) {
        if (!parsed || !parsed.paths || !parsed.paths.length) return null;
        var o = opts || {};
        var bb = parsed.bbox;
        var W = Math.max(1, bb.maxX - bb.minX);
        var H = Math.max(1, bb.maxY - bb.minY);
        var cible = o.cible || 1000;   // taille maxi du cote le plus long (px SVG)
        var ech = Math.min(1, cible / Math.max(W, H));

        var t = [];
        t.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
            Math.round(W) + ' ' + Math.round(H) + '" width="' + Math.round(W * ech) +
            '" height="' + Math.round(H * ech) + '">');
        for (var i = 0; i < parsed.paths.length; i++) {
            var p = parsed.paths[i];
            if (!p.d) continue;
            var attrs = 'd="' + String(p.d).replace(/"/g, '') + '"';
            if (p.fill) {
                attrs += ' fill="' + p.fill + '" fill-rule="nonzero"';
            } else {
                attrs += ' fill="none"';
            }
            if (p.stroke) {
                attrs += ' stroke="' + p.stroke + '" stroke-width="' + (p.strokeWidth || 1) + '"';
                if (p.lineJoin) attrs += ' stroke-linejoin="' + p.lineJoin + '"';
                if (p.lineCap) attrs += ' stroke-linecap="' + p.lineCap + '"';
            }
            t.push('<path ' + attrs + '/>');
        }
        t.push('</svg>');
        return t.join('');
    }

    // Meme chose, mais en data URI directement consommable par une balise img.
    function toSvgDataUrl(parsed, opts) {
        var svg = toSvg(parsed, opts);
        if (!svg) return null;
        // Encodage base64 UTF-8 sur (les EPS peuvent contenir des accents dans
        // les commentaires, mais le SVG produit est en ASCII : on securise).
        try {
            var b64 = btoa(unescape(encodeURIComponent(svg)));
            return 'data:image/svg+xml;base64,' + b64;
        } catch (e) {
            return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        }
    }

    global.SPEps = {
        version: VERSION,
        MM_PER_PT: MM_PER_PT,
        detect: detect,
        extractPsText: extractPsText,
        lireEntete: lireEntete,
        tokenize: tokenize,
        parse: parse,
        toFabricGroup: toFabricGroup,
        toSvg: toSvg,
        toSvgDataUrl: toSvgDataUrl,
        importance: importance
    };
})(typeof window !== 'undefined' ? window : globalThis);
