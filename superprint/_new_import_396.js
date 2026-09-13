  // ══════════════════════════════════════════════════════════════════════
  // 🆕 v1.7.396 — IMPORT DOCUMENTAIRE UNIVERSEL
  //   Objectif : qu'un document Word (.doc / .docx), OpenDocument (.odt /
  //   .ods / .odp) ou RTF soit transmis a l'IA de facon COMPLETE et
  //   STRUCTUREE (titres, listes, tableaux, images), quel que soit son
  //   format d'origine.
  //   Mesure AVANT (instrumentation du pipeline) :
  //     .doc  -> 0 caractere transmis (« ancien format binaire, non lisible »)
  //     .odt  -> 0 caractere transmis (« unsupported type »)
  //     .rtf  -> le balisage brut (\rtf1\ansi\deff0{\fonttbl...) polluait le
  //              prompt a la place du texte du document
  //   Les trois formats sont desormais vrais, pas des replis degrades.
  // ══════════════════════════════════════════════════════════════════════

  // ── Outils bas niveau ─────────────────────────────────────────────────

  // Octets -> chaine « latin1 » par blocs. String.fromCharCode.apply() sur un
  // tableau geant fait exploser la pile : on avance par paquets de 8192.
  function spBytesToLatin1(bytes) {
    let out = '';
    const CH = 8192;
    for (let i = 0; i < bytes.length; i += CH) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + CH)));
    }
    return out;
  }

  // Table CP1252 (0x80-0x9F) : ces octets ne sont PAS du latin-1, ce sont les
  // guillemets typographiques francais et le tiret cadratin. Sans cette table,
  // « » ’ – … deviennent des caracteres de remplacement dans les .doc/.rtf.
  var SP_DOC_CP1252 = {
    128: 8364, 130: 8218, 131: 402, 132: 8222, 133: 8230, 134: 8224, 135: 8225,
    136: 710, 137: 8240, 138: 352, 139: 8249, 140: 338, 142: 381, 145: 8216,
    146: 8217, 147: 8220, 148: 8221, 149: 8226, 150: 8211, 151: 8212, 152: 732,
    153: 8482, 154: 353, 155: 8250, 156: 339, 158: 382, 159: 376
  };

  // Table d'entites HTML nommees. AVANT : 12 entites decodees en dur dans
  // spHtmlToStructuredText ; tout le reste (&deg; &hellip; &agrave; &#8217;)
  // arrivait EN CLAIR dans le prompt et l'IA le recopiait dans la maquette.
  var SP_HTML_ENTITIES = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    hellip: '\u2026', mdash: '\u2014', ndash: '\u2013', bull: '\u2022',
    middot: '\u00b7', deg: '\u00b0', plusmn: '\u00b1', times: '\u00d7',
    divide: '\u00f7', frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be',
    sup1: '\u00b9', sup2: '\u00b2', sup3: '\u00b3', permil: '\u2030',
    prime: '\u2032', Prime: '\u2033', laquo: '\u00ab', raquo: '\u00bb',
    lsaquo: '\u2039', rsaquo: '\u203a', lsquo: '\u2018', rsquo: '\u2019',
    ldquo: '\u201c', rdquo: '\u201d', bdquo: '\u201e', sbquo: '\u201a',
    dagger: '\u2020', Dagger: '\u2021', oline: '\u203e', frasl: '\u2044',
    euro: '\u20ac', pound: '\u00a3', yen: '\u00a5', cent: '\u00a2',
    curren: '\u00a4', copy: '\u00a9', reg: '\u00ae', trade: '\u2122',
    sect: '\u00a7', para: '\u00b6', micro: '\u00b5', not: '\u00ac',
    shy: '\u00ad', iexcl: '\u00a1', iquest: '\u00bf', brvbar: '\u00a6',
    uml: '\u00a8', ordf: '\u00aa', ordm: '\u00ba', acute: '\u00b4',
    cedil: '\u00b8', macr: '\u00af', sup: '\u02c6', szlig: '\u00df',
    agrave: '\u00e0', aacute: '\u00e1', acirc: '\u00e2', atilde: '\u00e3',
    auml: '\u00e4', aring: '\u00e5', aelig: '\u00e6', ccedil: '\u00e7',
    egrave: '\u00e8', eacute: '\u00e9', ecirc: '\u00ea', euml: '\u00eb',
    igrave: '\u00ec', iacute: '\u00ed', icirc: '\u00ee', iuml: '\u00ef',
    ntilde: '\u00f1', ograve: '\u00f2', oacute: '\u00f3', ocirc: '\u00f4',
    otilde: '\u00f5', ouml: '\u00f6', oslash: '\u00f8', ugrave: '\u00f9',
    uacute: '\u00fa', ucirc: '\u00fb', uuml: '\u00fc', yacute: '\u00fd',
    yuml: '\u00ff', thorn: '\u00fe', eth: '\u00f0',
    Agrave: '\u00c0', Aacute: '\u00c1', Acirc: '\u00c2', Atilde: '\u00c3',
    Auml: '\u00c4', Aring: '\u00c5', AElig: '\u00c6', Ccedil: '\u00c7',
    Egrave: '\u00c8', Eacute: '\u00c9', Ecirc: '\u00ca', Euml: '\u00cb',
    Igrave: '\u00cc', Iacute: '\u00cd', Icirc: '\u00ce', Iuml: '\u00cf',
    Ntilde: '\u00d1', Ograve: '\u00d2', Oacute: '\u00d3', Ocirc: '\u00d4',
    Otilde: '\u00d5', Ouml: '\u00d6', Oslash: '\u00d8', Ugrave: '\u00d9',
    Uacute: '\u00da', Ucirc: '\u00db', Uuml: '\u00dc', Yacute: '\u00dd',
    THORN: '\u00de', ETH: '\u00d0',
    OElig: '\u0152', oelig: '\u0153', Scaron: '\u0160', scaron: '\u0161',
    Yuml: '\u0178', fnof: '\u0192', circ: '\u02c6', tilde: '\u02dc',
    ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '', zwj: '', lrm: '', rlm: '',
    alaf: '\u2023', lozf: '\u25ca'
  };

  function spCp1252Char(code) {
    if (code >= 160 && code <= 255) return String.fromCharCode(code);
    const mapped = SP_DOC_CP1252[code];
    return mapped ? String.fromCharCode(mapped) : '';
  }

  // Nombre de lettres reelles : sert a comparer deux decodages et a refuser
  // une extraction qui ne contient que du binaire.
  function spLetterCount(s) {
    const t = String(s || '');
    let n = 0;
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) ||
          (c >= 192 && c <= 255) || (c >= 256 && c <= 383)) n++;
    }
    return n;
  }

  // Un « mot » credible doit contenir au moins une lettre ET n'utiliser aucun
  // caractere etranger a la typographie d'un document.
  //   MESURE : un filtre exigeant « uniquement des lettres » rejetait du texte
  //   parfaitement valide (« Tarifs : 120 € », « atelier@exemple.fr », « TVA
  //   20 % ») et faisait tomber son score a 0,58. On raisonne donc par
  //   caractere interdit, ce qui distingue nettement le binaire :
  //     « 0UzŸÄé3X}¢Çì6[€¥Êï9^ƒ¨Íò »   -> « } ¢ [ ¥ ^ ¨ » interdits
  //     « Ej´Ùþ#Hm’·Ü&Kp•ºß »          -> « ´ # · • º » interdits
  var SP_TOKEN_LETTER = /[0-9A-Za-z\u00C0-\u024F]/;
  var SP_TOKEN_BAD = /[^0-9A-Za-z\u00C0-\u024F\u00B0\u00BD\u00BC\u00BE.,'\/@%€&()+:;!?"«»\u2018\u2019\u201C\u201D\u2013\u2014\u00A0\n\-]/;

  function spProseScore(t) {
    const parts = String(t).split(/\s+/);
    let total = 0, good = 0;
    for (let i = 0; i < parts.length; i++) {
      const w = parts[i];
      // Chiffres et ponctuation seuls sont NEUTRES : on ne les compte ni comme
      // bons ni comme mauvais (une ligne « 06 12 34 56 78 » est legitime).
      if (!w || !SP_TOKEN_LETTER.test(w)) continue;
      total++;
      if (!SP_TOKEN_BAD.test(w)) good++;
      if (total >= 300) break;
    }
    // Aucun mot porteur de lettres : n'accepter que du contenu de type chiffres
    // et ponctuation (ligne de tableau), jamais du binaire.
    if (!total) return /^[0-9\s.,;:%€+\-()\/]*$/.test(String(t).trim()) && String(t).trim().length >= 4 ? 1 : 0;
    return good / total;
  }

  function spIsProse(t) {
    const s = String(t || '');
    if (s.length < 40) return false;
    if (spLetterCount(s) < 25) return false;
    // 1) majorite de mots credibles, 2) mots reellement separes par des
    //    espaces, 3) proportion de lettres suffisante.
    if (spProseScore(s) < 0.85) return false;
    const words = s.split(/\s+/).filter(function (w) { return w.length > 1; }).length;
    if (words < 5) return false;
    const lettres = spLetterCount(s);
    return lettres / s.length >= 0.55;
  }

  // ── Detection du VRAI format (on ne se fie jamais a l'extension) ──────
  //   Mesure : un .doc exporte par Gmail/LibreOffice est tres souvent un
  //   .docx (ZIP) ou un .rtf renomme. Un OpenDocument peut arriver en .doc.
  //   On lit donc la signature des premiers octets et on route en consequence.
  function spDetectDocFormat(bytes) {
    if (!bytes || bytes.length < 8) return 'unknown';
    const b = bytes;
    if (b[0] === 0x50 && b[1] === 0x4B) {
      // Archive ZIP : OpenDocument (mimetype non compresse en tete) ou OOXML.
      const head = spBytesToLatin1(b.subarray(0, Math.min(b.length, 8192)));
      if (head.indexOf('application/vnd.oasis.opendocument') !== -1) return 'odf';
      if (head.indexOf('word/') !== -1 || head.indexOf('[Content_Types]') !== -1) return 'docx';
      return 'docx';
    }
    if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return 'doc';
    if (b[0] === 0x7B && b[1] === 0x5C) return 'rtf'; // {\
    const head = spBytesToLatin1(b.subarray(0, 1024)).toLowerCase();
    if (head.indexOf('<html') !== -1 || head.indexOf('<!doctype html') !== -1) return 'html';
    if (head.indexOf('<?xml') !== -1 && head.indexOf('office:document') !== -1) return 'odf';
    return 'unknown';
  }

  // ── RTF ───────────────────────────────────────────────────────────────
  //   AVANT : le .rtf etait dans txtExts et lu avec readAsText -> le modele
  //   recevait « {\rtf1\ansi\deff0{\fonttbl{\f0\froman Times;}}... ».
  //   MAINTENANT : parcours unique de la source, suppression des groupes non
  //   textuels, decodage des echappements \'hh (CP1252) et \uNNNN, \par et
  //   \line conserves comme sauts de paragraphe.
  var SP_RTF_SKIP = {
    fonttbl: 1, colortbl: 1, stylesheet: 1, info: 1, pict: 1, object: 1,
    themedata: 1, colorschememapping: 1, latentstyles: 1, datastore: 1,
    listtable: 1, listoverridetable: 1, rsidtbl: 1, generator: 1, filetbl: 1,
    revtbl: 1, xmlnstbl: 1, upr: 1, mmathPr: 1, wgrffmtfilter: 1,
    pgptbl: 1, docvar: 1, nonshppict: 1, shppict: 1, header: 1, footer: 1,
    footnote: 1, annotation: 1, fldinst: 1
  };

  function spRtfToText(src) {
    const s = String(src || '');
    const out = [];
    let i = 0, depth = 0, skipFrom = -1;
    // \ucN : nombre de caracteres de repli a IGNORER apres un \uNNNN.
    // Defaut = 1 (\uc1). Un document generé en \uc0 n'a AUCUN repli.
    let uc = 1;
    while (i < s.length) {
      const c = s[i];
      if (c === '{') { depth++; i++; continue; }
      if (c === '}') {
        if (skipFrom >= 0 && depth <= skipFrom) skipFrom = -1;
        depth--;
        i++;
        continue;
      }
      if (c === '\\') {
        const rest = s.slice(i, i + 40);
        // \'hh — caractere code en CP1252
        const hex = /^\\'([0-9a-fA-F]{2})/.exec(rest);
        if (hex) {
          i += hex[0].length;
          if (skipFrom < 0) out.push(spCp1252Char(parseInt(hex[1], 16)));
          continue;
        }
        // \uNNNN — Unicode. ATTENTION : la valeur est DECIMALE.
        //   \u8217 = U+2019 (apostrophe), \u233 = U+00E9 (e accent aigu),
        //   \u8364 = (8364 = 0x20AC) le signe euro, \u8212 = U+2014 (tiret).
        //   Une valeur negative (ex. \u-3913) code un point de code > 32767.
        const uni = /^\\u(-?\d+)/.exec(rest);
        if (uni) {
          i += uni[0].length;
          if (skipFrom < 0) {
            let code = parseInt(uni[1], 10);
            if (code < 0) code += 65536;
            if (code > 0 && code <= 1114111) out.push(String.fromCharCode(code));
          }
          // La specification RTF impose d'IGNORER les caracteres de repli qui
          // suivent (« \u8217? » = apostrophe, PAS « ? » : sans ce saut,
          // « l'artisan » devenait « l?artisan »).
          for (let k = 0; k < uc && i < s.length; k++) i++;
          continue;
        }
        // \* — groupe de destination ignorable : {\*\generator Riched20 ...}
        //   Sans ce test, « Riched20 10.0; » entrait dans le texte du document.
        if (rest[1] === '*') {
          i += 2;
          if (skipFrom < 0) skipFrom = depth;
          continue;
        }
        // \word[NNN] — mot-cle de controle
        const word = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rest);
        if (word) {
          const kw = word[1].toLowerCase();
          i += word[0].length;
          if (kw === 'uc') { uc = Math.max(0, parseInt(word[2] || '1', 10) || 0); continue; }
          if (SP_RTF_SKIP[kw] && skipFrom < 0) { skipFrom = depth; continue; }
          if (skipFrom >= 0) continue;
          if (kw === 'par' || kw === 'line' || kw === 'sect' || kw === 'row' || kw === 'page') out.push('\n');
          else if (kw === 'tab' || kw === 'cell') out.push('\t');
          else if (kw === 'bullet') out.push('- ');
          else if (kw === 'emdash') out.push('\u2014');
          else if (kw === 'endash') out.push('\u2013');
          else if (kw === 'lquote') out.push('\u2018');
          else if (kw === 'rquote') out.push('\u2019');
          else if (kw === 'ldblquote') out.push('\u00ab');
          else if (kw === 'rdblquote') out.push('\u00bb');
          // Tout le reste (\b, \i, \fs24, \cf1, \f0...) est de la mise en
          // forme : sans interet pour la mise en page, donc ignore.
          continue;
        }
        // \\ \{ \} et autres symboles litteraux
        const sym = /^\\([^a-zA-Z])/.exec(rest);
        if (sym) {
          i += sym[0].length;
          if (skipFrom < 0) out.push(sym[1]);
          continue;
        }
        i++;
        continue;
      }
      if (c === '\r' || c === '\n') { i++; continue; }
      if (skipFrom < 0) out.push(c);
      i++;
    }
    let t = out.join('');
    t = t.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n');
    return t.trim();
  }

  function spU8Concat(parts) {
    let n = 0;
    for (let i = 0; i < parts.length; i++) n += parts[i].length;
    const out = new Uint8Array(n);
    let o = 0;
    for (let i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; }
    return out;
  }

  // Octet CP1252 -> caractere. Contrairement a spCp1252Char(), les codes de
  // controle 0x00-0x1F sont CONSERVES : dans un .doc, 0x0D est le retour
  // paragraphe et 0x07 la fin de cellule. On les traduit ensuite.
  function spCp1252Byte(b) {
    if (b < 0x80 || b >= 0xA0) return String.fromCharCode(b);
    const m = SP_DOC_CP1252[b];
    return m ? String.fromCharCode(m) : String.fromCharCode(b);
  }

  // ══════════════════════════════════════════════════════════════════════
  // WORD 97-2003 (.doc) — VRAI DECODEUR
  //   Un .doc n'est PAS un fichier plat : c'est un conteneur OLE (Compound
  //   File Binary) qui renferme plusieurs « flux ». Le texte est dans le flux
  //   « WordDocument », et la table qui decrit ses morceaux dans « 0Table » ou
  //   « 1Table ». Mammoth ne lit pas ce format (il ne traite que les .docx/ZIP).
  //   AVANT : on poussait « ancien format binaire, non lisible » -> l'IA ne
  //   recevait RIEN.
  //   La premiere heuristique (extraction des suites de caracteres lisibles)
  //   a ete MESUREE puis abandonnee comme decodeur principal : sur un .doc
  //   reel, le remplissage binaire et le texte seche ressemblaient trop et le
  //   texte utile etait rejete avec le binaire. On lit donc reellement la
  //   structure du fichier (FIB -> CLX -> pieces), ce qui donne un texte exact,
  //   sans un octet de binaire. L'heuristique reste en dernier recours.
  // ══════════════════════════════════════════════════════════════════════

  function spOleRead(bytes) {
    if (!bytes || bytes.length < 512) return null;
    if (!(bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0)) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = function (o) { return dv.getUint16(o, true); };
    const u32 = function (o) { return dv.getUint32(o, true); };

    const sectorShift = u16(0x1E);
    const miniShift = u16(0x20);
    if (sectorShift < 7 || sectorShift > 14) return null;
    if (miniShift < 2 || miniShift > 12) return null;
    const secSize = 1 << sectorShift;
    const miniSize = 1 << miniShift;
    const miniCutoff = u32(0x38);
    const dirStart = u32(0x30);
    const miniFatStart = u32(0x3C);
    const difatStart = u32(0x44);

    // Un secteur « n » commence a 512 + n * secSize.
    const sectorPos = function (n) { return 512 + n * secSize; };
    const readSector = function (n) {
      const p = sectorPos(n);
      if (n < 0 || n >= 0xFFFFFFF0 || p + secSize > bytes.length) return null;
      return bytes.subarray(p, p + secSize);
    };

    // 1) DIFAT -> liste des secteurs de la FAT
    const fatSectors = [];
    for (let i = 0; i < 109; i++) {
      const s = u32(0x4C + i * 4);
      if (s === 0xFFFFFFFF) break;
      fatSectors.push(s);
    }
    let difat = difatStart, guard = 0;
    while (difat !== 0xFFFFFFFF && difat !== 0xFFFFFFFE && guard++ < 4096) {
      const sec = readSector(difat);
      if (!sec) break;
      const sdv = new DataView(sec.buffer, sec.byteOffset, sec.byteLength);
      const per = (secSize / 4) - 1;
      for (let i = 0; i < per; i++) {
        const s = sdv.getUint32(i * 4, true);
        if (s === 0xFFFFFFFF) { i = per; break; }
        fatSectors.push(s);
      }
      difat = sdv.getUint32(secSize - 4, true);
    }

    // 2) FAT
    const fat = [];
    for (let i = 0; i < fatSectors.length; i++) {
      const sec = readSector(fatSectors[i]);
      if (!sec) continue;
      const sdv = new DataView(sec.buffer, sec.byteOffset, sec.byteLength);
      for (let k = 0; k + 4 <= secSize; k += 4) fat.push(sdv.getUint32(k, true));
    }
    if (!fat.length) return null;

    // 3) Une chaine FAT n'est pas contigue : on suit les maillons.
    const chain = function (start) {
      const out = [];
      let n = start, g = 0;
      while (n !== 0xFFFFFFFE && n !== 0xFFFFFFFF && n < fat.length && g++ < 200000) {
        out.push(n);
        n = fat[n];
      }
      return out;
    };
    const readChain = function (start, size) {
      const secs = chain(start);
      const parts = [];
      let got = 0;
      for (let i = 0; i < secs.length; i++) {
        const sec = readSector(secs[i]);
        if (!sec) break;
        parts.push(sec);
        got += sec.length;
        if (size && got >= size) break;
      }
      const all = spU8Concat(parts);
      return size ? all.subarray(0, Math.min(size, all.length)) : all;
    };

    // 4) Repertoire
    const dirBytes = readChain(dirStart, 0);
    const ddv = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
    const entries = [];
    for (let o = 0; o + 128 <= dirBytes.length; o += 128) {
      const nameLen = ddv.getUint16(o + 64, true);
      let name = '';
      const maxName = Math.min(nameLen, 64);
      for (let c = 0; c + 2 <= maxName; c += 2) {
        const code = ddv.getUint16(o + c, true);
        if (!code) break;
        name += String.fromCharCode(code);
      }
      const type = dirBytes[o + 66];
      const start = ddv.getUint32(o + 116, true);
      const size = ddv.getUint32(o + 120, true);
      if (name || type === 5) entries.push({ name: name, type: type, start: start, size: size });
    }

    // 5) Mini-flux : les flux de moins de 4 096 octets (dont « 1Table » tres
    //    souvent) sont stockes dans un flux reduit, avec sa propre FAT.
    const root = entries.filter(function (e) { return e.type === 5; })[0];
    let mini = null;
    const miniFat = [];
    if (root && root.size) {
      mini = readChain(root.start, root.size);
      const mf = readChain(miniFatStart, 0);
      const mdv = new DataView(mf.buffer, mf.byteOffset, mf.byteLength);
      for (let o = 0; o + 4 <= mf.length; o += 4) miniFat.push(mdv.getUint32(o, true));
    }
    const readMini = function (start, size) {
      const out = [];
      let n = start, g = 0;
      while (n !== 0xFFFFFFFE && n !== 0xFFFFFFFF && g++ < 200000) {
        if (!mini || n * miniSize + miniSize > mini.length) break;
        out.push(mini.subarray(n * miniSize, n * miniSize + miniSize));
        n = miniFat[n];
      }
      const all = spU8Concat(out);
      return size ? all.subarray(0, Math.min(size, all.length)) : all;
    };

    const stream = function (name) {
      const e = entries.filter(function (x) { return x.name === name && x.type === 2; })[0];
      if (!e) return null;
      const data = (e.size < miniCutoff && mini) ? readMini(e.start, e.size) : readChain(e.start, e.size);
      return data.length ? data : null;
    };

    return { stream: stream, entries: entries };
  }

  // FIB (File Information Block) -> table de morceaux (CLX) -> texte exact.
  function spDocTextFromOle(bytes) {
    let ole;
    try { ole = spOleRead(bytes); } catch (_) { return ''; }
    if (!ole) return '';
    const wd = ole.stream('WordDocument');
    if (!wd || wd.length < 0x200) return '';
    if (!(wd[0] === 0xEC && wd[1] === 0xA5)) return '';  // signature Word (0xA5EC)
    const dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);

    // FibBase.flags : bit 0x0200 = fWhichTblStm (choix entre 0Table et 1Table).
    const flags1 = dv.getUint16(0x0A, true);
    const tableName = (flags1 & 0x0200) ? '1Table' : '0Table';
    // ccpText = nombre de caracteres du texte principal ; fcClx/lcbClx = position
    // et taille de la table de morceaux dans le flux de table.
    const ccpText = dv.getUint32(0x4C, true);
    const fcClx = dv.getUint32(0x1A2, true);
    const lcbClx = dv.getUint32(0x1A6, true);
    if (!lcbClx || lcbClx > 0x10000000) return '';
    let tbl = ole.stream(tableName);
    if (!tbl) tbl = ole.stream(tableName === '0Table' ? '1Table' : '0Table');
    if (!tbl || fcClx + lcbClx > tbl.length) return '';
    const clx = tbl.subarray(fcClx, fcClx + lcbClx);

    // Le CLX peut commencer par des Prc (0x01, proprietes de paragraphe) ; on
    // avance jusqu'au Pcdt (0x02), qui contient la table des morceaux.
    let p = 0;
    while (p < clx.length && clx[p] === 0x01) {
      if (p + 3 > clx.length) return '';
      const cb = clx[p + 1] | (clx[p + 2] << 8);
      p += 3 + cb;
    }
    if (p + 5 > clx.length || clx[p] !== 0x02) return '';
    const lcb = clx[p + 1] | (clx[p + 2] << 8) | (clx[p + 3] << 16) | (clx[p + 4] << 24);
    const plcStart = p + 5;
    if (lcb < 12 || plcStart + lcb > clx.length) return '';
    const plc = clx.subarray(plcStart, plcStart + lcb);

    // PlcPcd = (n+1) positions CP (4 octets) + n descripteurs PCD (8 octets).
    const n = Math.floor((lcb - 4) / 12);
    if (n < 1 || n > 100000) return '';
    const pdv = new DataView(plc.buffer, plc.byteOffset, plc.byteLength);
    const cpAt = function (i) { return pdv.getUint32(i * 4, true); };

    // Chaque morceau indique son emplacement (fc) et son mode de codage :
    // bit 0x40000000 = texte 8 bits (CP1252), sinon UTF-16LE.
    const morceaux = [];
    for (let i = 0; i < n; i++) {
      const count = cpAt(i + 1) - cpAt(i);
      if (count <= 0 || count > 20000000) continue;
      const pcdOff = (n + 1) * 4 + i * 8;
      if (pcdOff + 8 > plc.length) break;
      let fc = pdv.getUint32(pcdOff + 2, true);
      const compresse = (fc & 0x40000000) !== 0;
      fc = compresse ? ((fc & 0x3FFFFFFF) >>> 1) : (fc & 0x3FFFFFFF);
      if (fc >= wd.length) continue;
      if (compresse) {
        const s = [];
        const fin = Math.min(count, wd.length - fc);
        for (let k = 0; k < fin; k++) s.push(spCp1252Byte(wd[fc + k]));
        morceaux.push(s.join(''));
      } else {
        const s = [];
        for (let k = 0; k < count; k++) {
          const o2 = fc + k * 2;
          if (o2 + 1 >= wd.length) break;
          s.push(String.fromCharCode(wd[o2] | (wd[o2 + 1] << 8)));
        }
        morceaux.push(s.join(''));
      }
    }
    let texte = morceaux.join('');
    // On s'arrete au texte principal : au-dela commencent notes de bas de page,
    // en-tetes et annotations, qui n'ont pas leur place dans une maquette.
    if (ccpText && texte.length > ccpText) texte = texte.slice(0, ccpText);
    // 0x0D = retour paragraphe (Word), 0x07 = fin de cellule, 0x0B/0x0C = saut
    // de ligne / de page. Le reste des codes de controle est supprime.
    texte = texte.replace(/\r/g, '\n')
                 .replace(/[\u0007\u000B\u000C]/g, '\n')
                 .replace(/\u001E/g, '-')
                 .replace(/[\u0000-\u0006\u0008\u000E-\u001D\u001F]/g, '');
    return texte;
  }

  // ── Word 97-2003 (.doc) — repli heuristique ───────────────────────────
  //   Utilise seulement si le vrai decodeur n'a rien trouve (fichier tronque,
  //   variante exotique). On decode les DEUX facons (8 bits et UTF-16LE) et on
  //   ne conserve que les suites qui ressemblent a de la prose.
  //   Mammoth ne lit PAS ce format (il est reserve aux .docx/ZIP). AVANT :
  //   on poussait un simple message -> l'IA n'avait aucun texte.
  function spDocChar(code, eightBit) {
    if (code === 13) return '\n';
    if (code === 10) return '';
    if (code === 9) return ' ';
    if (code >= 32 && code <= 126) return String.fromCharCode(code);
    // 🆕 v1.7.396 — CODES DE CONTROLE STRUCTURELS d'un vrai .doc Word :
    //   un document reel en contient (fin de cellule, saut de page, tiret
    //   insecable, marqueurs de champ). Les traiter comme du binaire
    //   fragmentait le texte en plein milieu d'un paragraphe.
    if (code === 7) return '\n';            // fin de cellule de tableau
    if (code === 11 || code === 12) return '\n'; // saut de ligne / de page
    if (code === 14) return '\n';           // fin de colonne
    if (code === 30) return '-';            // trait d'union insecable
    if (code === 1 || code === 2 || code === 5 || code === 8 ||
        code === 19 || code === 20 || code === 21 || code === 31) return ''; // images, notes, champs
    if (eightBit) {
      // ⚠️ spCp1252Char() renvoie '' pour un octet non mappable : si on
      //   renvoyait '' ici, la coupure de run (qui teste null) ne se
      //   declencherait JAMAIS et le binaire fusionnerait avec le texte.
      //   On renvoie donc explicitement null.
      return spCp1252Char(code) || null;
    }
    if (code >= 160 && code <= 0x024F) return String.fromCharCode(code);
    if (code >= 0x2010 && code <= 0x2027) return String.fromCharCode(code);
    if (code === 0x20AC) return String.fromCharCode(code);
    return null;
  }

  // onRun : callback d'observation optionnel (utilise par _diag_doc_396.cjs et
  // par le rapport de completude ; jamais passe par le pipeline de production).
  function spRunsFromCodes(total, getCode, eightBit, onRun) {
    const runs = [];
    let cur = '';
    let bad = 0;
    let chars = 0;
    // Bornes de securite : un fichier binaire de 20 Mo ne doit ni saturer la
    // memoire ni produire un « texte » plus long que le document lui-meme.
    const MAX_RUNS = 4000;
    const MAX_CHARS = 1500000;
    const flush = function () {
      const t = cur.replace(/\s*\n\s*/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{2,}/g, '\n').trim();
      // 🆕 v1.7.396 — MESURE DECISIVE. Le premier filtre (>= 25 caracteres
      //   alphanumeriques, >= 8 distincts) laissait passer des suites d'octets
      //   binaires : « Ej´Ùþ#Hm’·Ü&Kp•ºß » et « ÐÏà¡±á0UzŸÄé3X}¢Çì6 » les
      //   validaient tous les deux. On exige desormais une VRAIE prose :
      //   majorite de mots credibles, separes par des espaces.
      if (t && spIsProse(t)) { runs.push(t); chars += t.length; if (onRun) onRun(t); }
      cur = '';
      bad = 0;
    };
    for (let i = 0; i < total; i++) {
      if (runs.length >= MAX_RUNS || chars >= MAX_CHARS) break;
      const ch = spDocChar(getCode(i), eightBit);
      // 🆕 v1.7.396 — COUPURE IMMEDIATE sur le premier octet non textuel.
      //   Mesure : avec un seuil de 2 octets consecutifs, le remplissage de
      //   l'en-tete OLE et le vrai texte formaient UN SEUL run de 1218
      //   caracteres, et le score de prose (0,53) faisait alors rejeter le
      //   texte utile avec le binaire. En coupant des le premier octet non
      //   textuel, la zone de texte reelle reste intacte (elle ne contient que
      //   des octets imprimables) et chaque zone binaire est brisee en petits
      //   fragments que spIsProse elimine.
      if (ch === null) { flush(); continue; }
      cur += ch;
      if (cur.length > 200000) flush();
    }
    flush();
    return runs.join('\n\n');
  }

  function spLegacyDocToText(bytes) {
    // 1) Decodeur structurel (exact) : FIB -> CLX -> pieces.
    const propre = spDocTextFromOle(bytes);
    if (spLetterCount(propre) >= 20) return propre.trim();
    // 2) Repli heuristique : suites de caracteres lisibles.
    const n = bytes.length;
    const eight = spRunsFromCodes(n, function (i) { return bytes[i]; }, true);
    let utf16 = '';
    if (n > 4 && bytes[1] === 0) {
      const pairs = Math.floor(n / 2);
      utf16 = spRunsFromCodes(pairs, function (i) {
        return bytes[2 * i] | (bytes[2 * i + 1] << 8);
      }, false);
    }
    return spLetterCount(utf16) > spLetterCount(eight) ? utf16 : eight;
  }

  // ── OpenDocument (.odt / .ods / .odp / .odg) ──────────────────────────
  //   AVANT : totalement absent du pipeline -> « unsupported type ».
  //   Un ODF est une archive ZIP contenant content.xml. On y mappe la
  //   hierarchie reelle (text:h avec outline-level, listes, tableaux,
  //   images) EXACTEMENT comme le fait mammoth pour un .docx, afin que l'IA
  //   recoive le meme langage de structure quel que soit le format source.
  function spOdfAttr(el, name) {
    const attrs = el.attributes || [];
    for (let i = 0; i < attrs.length; i++) {
      if (attrs[i].localName === name || attrs[i].name === name) return attrs[i].value || '';
    }
    return '';
  }

  function spRepeatCh(ch, n) {
    let s = '';
    for (let i = 0; i < n; i++) s += ch;
    return s;
  }

  function spOdfWalk(node, out, imgs) {
    const kids = node.childNodes || [];
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i];
      if (n.nodeType === 3) { out.push(n.nodeValue || ''); continue; }
      if (n.nodeType !== 1) continue;
      const ln = String(n.localName || n.nodeName || '').toLowerCase();
      if (ln === 'h') {
        const lvl = Math.min(6, Math.max(1, parseInt(spOdfAttr(n, 'outline-level') || '1', 10) || 1));
        out.push('\n\n' + spRepeatCh('#', lvl) + ' ');
        spOdfWalk(n, out, imgs);
        out.push('\n');
      } else if (ln === 'p') {
        out.push('\n');
        spOdfWalk(n, out, imgs);
        out.push('\n');
      } else if (ln === 'list-item') {
        const tmp = [];
        spOdfWalk(n, tmp, imgs);
        const line = tmp.join('').replace(/\s+/g, ' ').trim();
        if (line) out.push('\n- ' + line);
      } else if (ln === 'list' || ln === 'list-header') {
        out.push('\n');
        spOdfWalk(n, out, imgs);
        out.push('\n');
      } else if (ln === 'table') {
        const tmp = [];
        spOdfWalk(n, tmp, imgs);
        out.push('\n[TABLEAU]' + tmp.join('') + '\n[/TABLEAU]\n');
      } else if (ln === 'table-row') {
        out.push('\n');
        spOdfWalk(n, out, imgs);
      } else if (ln === 'table-cell') {
        // Un tableur ODS stocke la valeur dans un attribut, pas dans le texte.
        const val = spOdfAttr(n, 'value') || spOdfAttr(n, 'date-value') ||
                    spOdfAttr(n, 'time-value') || spOdfAttr(n, 'boolean-value') ||
                    spOdfAttr(n, 'string-value');
        const tmp = [];
        spOdfWalk(n, tmp, imgs);
        const txt = tmp.join('').replace(/\s+/g, ' ').trim();
        out.push(' | ' + (txt || val || ''));
      } else if (ln === 'image') {
        const href = spOdfAttr(n, 'href') || '';
        if (href) {
          imgs.push(href);
          out.push('[IMAGE_' + (imgs.length - 1) + ']');
        }
      } else if (ln === 's') {
        const c = Math.max(1, parseInt(spOdfAttr(n, 'c') || '1', 10) || 1);
        out.push(spRepeatCh(' ', Math.min(60, c)));
      } else if (ln === 'tab') {
        out.push('\t');
      } else if (ln === 'line-break') {
        out.push('\n');
      } else if (ln === 'page' || ln === 'soft-page-break') {
        out.push('\n\n--- PAGE ---\n\n');
      } else if (ln === 'note' || ln === 'annotation') {
        continue; // notes de bas de page / commentaires : hors maquette
      } else {
        spOdfWalk(n, out, imgs);
      }
    }
  }

  async function extractOdfAttachment(file, id, ext) {
    await loadAttachmentLibrary('app/JS/jszip.min.js', function () { return !!window.JSZip; });
    const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    const contentFile = zip.file('content.xml');
    if (!contentFile) {
      throw new Error('archive OpenDocument sans content.xml');
    }
    const xml = await contentFile.async('string');
    const dom = new DOMParser().parseFromString(xml, 'application/xml');
    if (!dom || !dom.documentElement) throw new Error('content.xml illisible');
    if (dom.getElementsByTagName('parsererror').length) throw new Error('content.xml corrompu');

    const imgs = [];
    const out = [];
    spOdfWalk(dom.documentElement, out, imgs);

    let texte = out.join('');
    texte = texte.replace(/\r/g, '')
                 .replace(/[ \t]{2,}/g, ' ')
                 .replace(/ ?\n ?/g, '\n')
                 .replace(/\n{3,}/g, '\n\n')
                 .replace(/\|\s*\n/g, '|\n')
                 .trim();

    // Les images sont dans Pictures/ : on les joint comme de vraies pieces
    // jointes image pour que l'IA puisse les placer avec « imageIndex ».
    let nbImages = 0;
    for (let k = 0; k < imgs.length; k++) {
      const href = imgs[k];
      let entry = zip.file(href);
      if (!entry) {
        try { entry = zip.file(decodeURIComponent(href)); } catch (_) {}
      }
      if (!entry) continue;
      const b64 = await entry.async('base64');
      const lower = href.toLowerCase();
      let mime = 'image/jpeg';
      if (/\.png$/.test(lower)) mime = 'image/png';
      else if (/\.gif$/.test(lower)) mime = 'image/gif';
      else if (/\.svg$/.test(lower)) mime = 'image/svg+xml';
      else if (/\.webp$/.test(lower)) mime = 'image/webp';
      state.attachments.push({
        id: id + '_img' + k, name: file.name + ' — image ' + (k + 1),
        type: 'image', dataURL: 'data:' + mime + ';base64,' + b64,
        width: 0, height: 0, ext: ext || 'odt', fromDoc: true
      });
      nbImages++;
    }

    state.attachments.push({
      id, name: file.name, type: 'text', text: texte, ext: ext || 'odt',
      doc: true, docLabel: 'DOCUMENT OPEN OFFICE', imageCount: nbImages
    });
    renderAttachBar();
    appendChat('assistant', '📄 « ' + file.name + ' » : ' + texte.length + ' caractères' +
      (nbImages ? ' et ' + nbImages + ' image(s) extraite(s)' : '') + '.');
  }

  // ── RTF : branche dediee ──────────────────────────────────────────────
  function extractRtfAttachment(bytes, file, id, ext) {
    const texte = spRtfToText(spBytesToLatin1(bytes));
    state.attachments.push({
      id, name: file.name, type: 'text', text: texte, ext: ext || 'rtf',
      doc: true, docLabel: 'DOCUMENT RTF'
    });
    renderAttachBar();
    appendChat('assistant', '📄 « ' + file.name + ' » : ' + texte.length + ' caractères.');
  }

  // ── .doc binaire : extraction reelle + repli honnete et actionnable ────
  function extractLegacyDocAttachment(bytes, file, id, ext) {
    const texte = spLegacyDocToText(bytes);
    // ⚠️ MESURE (test navigateur v1.7.396) : un seuil de 300 LETTRES rejetait
    //   un document court parfaitement decode (239 caracteres, 183 lettres
    //   utiles) et affichait a tort le message d'echec. Le bon critere n'est
    //   pas le VOLUME mais la QUALITE : on exige que le texte soit de la prose
    //   (spIsProse) ou, pour un document tres court, quelques mots reels.
    const lettres = spLetterCount(texte);
    const exploitable = texte.length >= 20 && (spIsProse(texte) || lettres >= 40);
    if (!exploitable) {
      state.attachments.push({
        id, name: file.name, type: 'text', ext: ext || 'doc', doc: true,
        docLabel: 'DOCUMENT WORD (ancien format .doc)',
        text: '(document Word ancien format .doc : le texte n\'a pas pu etre extrait de facon fiable — ' +
              'reenregistrez-le en .docx ou .odt puis joignez-le a nouveau pour obtenir la mise en page exacte)'
      });
      renderAttachBar();
      appendChat('assistant', '⚠️ « ' + file.name + ' » : format binaire .doc trop ancien pour une extraction fiable. Réenregistrez-le en .docx (Word) ou .odt (LibreOffice) et joignez-le à nouveau.');
      return;
    }
    state.attachments.push({
      id, name: file.name, type: 'text', text: texte, ext: ext || 'doc',
      doc: true, docLabel: 'DOCUMENT WORD (ancien format .doc)'
    });
    renderAttachBar();
    appendChat('assistant', '📄 « ' + file.name + ' » (.doc) : ' + texte.length + ' caractères extraits.');
  }

  // ── Chargement de mammoth (chemin conserve : JS/mammoth.min.js) ────────
  function spLoadMammoth() {
    return loadAttachmentLibrary('JS/mammoth.min.js', function () { return !!window.mammoth; });
  }

  // ── Aiguillage central : on lit la signature, pas l'extension ──────────
  async function extractDocumentAttachment(file, id, ext) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const reel = spDetectDocFormat(bytes);

    if (reel === 'docx') {
      try {
        await spLoadMammoth();
      } catch (_) {
        state.attachments.push({
          id, name: file.name, type: 'text', ext: ext || 'docx',
          text: '(contenu du document non lisible : bibliotheque d\'extraction indisponible)'
        });
        renderAttachBar();
        return;
      }
      spExtractWordRich(bytes.buffer, file, id, ext || 'docx');
      return;
    }
    if (reel === 'odf') { await extractOdfAttachment(file, id, ext); return; }
    if (reel === 'rtf') { extractRtfAttachment(bytes, file, id, ext); return; }
    if (reel === 'doc') { extractLegacyDocAttachment(bytes, file, id, ext); return; }
    if (reel === 'html') {
      const texte = spHtmlToStructuredText(spBytesToLatin1(bytes));
      state.attachments.push({
        id, name: file.name, type: 'text', text: texte, ext: ext || 'html',
        doc: true, docLabel: 'DOCUMENT (page HTML exportee)'
      });
      renderAttachBar();
      appendChat('assistant', '📄 « ' + file.name + ' » : ' + texte.length + ' caractères.');
      return;
    }
    // Signature inconnue : on tente quand meme le texte du binaire, et le
    // message de repli previent l'utilisateur si le resultat est vide.
    extractLegacyDocAttachment(bytes, file, id, ext);
  }

