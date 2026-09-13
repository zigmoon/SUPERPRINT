// _fix_import_396.cjs — v1.7.395 -> v1.7.396
// Import documentaire universel dans le studio : .doc, .docx, .odt/.ods/.odp, .rtf
// Usage : node _fix_import_396.cjs [--apply]
'use strict';
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const ROOT = __dirname;
const TARGETS = [
  path.join(ROOT, 'sp213-studio.html'),
  path.join(ROOT, '..', 'sp213-local', 'public', 'superprint', 'sp213-studio.html')
];
const MODULE = fs.readFileSync(path.join(ROOT, '_new_import_396.js'), 'utf8').replace(/\r\n/g, '\n');

function eolOf(s) {
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf = (s.match(/\n/g) || []).length;
  return crlf > lf / 2 ? '\r\n' : '\n';
}

// 1 remplacement, exactement une occurrence, sinon on leve.
function sub(src, label, from, to, counters) {
  const n = src.split(from).length - 1;
  if (n !== 1) {
    throw new Error('ANCRE "' + label + '" : ' + n + ' occurrence(s) au lieu de 1');
  }
  counters.push(label);
  return src.split(from).join(to);
}

// ── Les remplacements ────────────────────────────────────────────────────
const A1_FROM = 'accept=".jpg,.jpeg,.png,.webp,.gif,.svg,.bmp,.txt,.md,.rtf,.csv,.html,.doc,.docx,.xls,.xlsx,.pdf"';
const A1_TO   = 'accept=".jpg,.jpeg,.png,.webp,.gif,.svg,.bmp,.txt,.md,.csv,.html,.doc,.docx,.odt,.ods,.odp,.odg,.rtf,.xls,.xlsx,.pdf"';

const A2_FROM = "    const txtExts = ['txt','md','rtf','csv','html'];";
const A2_TO   = "    const txtExts = ['txt','md','csv','html'];\n" +
                "    // 🆕 v1.7.396 — formats documentaires pris en charge par l'aiguillage\n" +
                "    //   universel (extractDocumentAttachment). .rtf a quitte txtExts : il\n" +
                "    //   etait lu brut, donc le balisage polluait le prompt.\n" +
                "    const docExts = ['doc','docx','odt','ods','odp','odg','rtf'];";

const A3_FROM = `    } else if (ext === 'doc' || ext === 'docx') {
      // Extraction texte via mammoth (chargé dynamiquement comme dans SuperPrint)
      const reader = new FileReader();
      reader.onload = function(e) {
        const buf = e.target.result;
        if (ext === 'docx') {
          const doExtract = function() {
            if (!window.mammoth) {
              state.attachments.push({ id, name: file.name, type: 'text', text: '(contenu Word non lisible : bibliothèque manquante)', ext });
              renderAttachBar();
              return;
            }
            spExtractWordRich(buf, file, id, ext);
          };
          if (window.mammoth) { doExtract(); }
          else {
            const s = document.createElement('script');
            s.src = 'JS/mammoth.min.js';
            s.onload = doExtract;
            s.onerror = function() { state.attachments.push({ id, name: file.name, type: 'text', text: '(contenu Word non lisible : bibliothèque manquante)', ext }); renderAttachBar(); };
            document.head.appendChild(s);
          }
        } else {
          state.attachments.push({ id, name: file.name, type: 'text', text: '(fichier Word .doc — ancien format binaire, non lisible en ligne)', ext });
          renderAttachBar();
        }
      };
      reader.readAsArrayBuffer(file);
    } else {`;

const A3_TO = `    } else if (docExts.includes(ext)) {
      // 🆕 v1.7.396 — aiguillage documentaire universel.
      //   AVANT : .docx -> mammoth (OK) ; .doc -> « non lisible » (0 caractere
      //   transmis) ; .odt -> « unsupported type » (0 caractere transmis) ;
      //   .rtf -> balisage brut dans le prompt.
      //   MAINTENANT : extractDocumentAttachment lit la SIGNATURE REELLE du
      //   fichier (un « .doc » exporte par Gmail/Outlook est presque toujours
      //   un .docx ou un .rtf renomme) puis route vers le decodeur adapte.
      extractDocumentAttachment(file, id, ext).catch(function (error) {
        state.attachments.push({ id, name: file.name, type: 'text', ext, text: '(document illisible : ' + error.message + ')' });
        renderAttachBar();
        appendChat('assistant', 'Unable to read "' + file.name + '": ' + error.message);
      });
    } else {`;

const A4_FROM = `      appendChat('assistant', 'File "' + file.name + '" ignored: unsupported type. Accepted formats: images, TXT/MD/RTF/CSV/HTML, Word (.docx), Excel (.xls/.xlsx) and PDF.');`;
const A4_TO   = `      appendChat('assistant', 'File "' + file.name + '" ignored: unsupported type. Accepted formats: images, TXT/MD/CSV/HTML, Word (.doc/.docx), OpenDocument (.odt/.ods/.odp), RTF (.rtf), Excel (.xls/.xlsx) and PDF.');`;

const A5_FROM = `    t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
         .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
         .replace(/&rsquo;/g, '\\u2019').replace(/&lsquo;/g, '\\u2018')
         .replace(/&laquo;/g, '\\u00ab').replace(/&raquo;/g, '\\u00bb')
         .replace(/&eacute;/g, '\\u00e9').replace(/&egrave;/g, '\\u00e8');`;

const A5_TO = `    // 🆕 v1.7.396 — AVANT : 12 entites decodees en dur, tout le reste
    //   (&deg; &hellip; &agrave; &#8217; &#233;) arrivait EN CLAIR dans le
    //   prompt et l'IA recopiait « &eacute; » jusque dans la maquette.
    //   MAINTENANT : table complete (accentuation FR + ponctuation tipographique)
    //   puis repli numerique pour toute entite restante.
    t = t.replace(/&([a-zA-Z][a-zA-Z0-9]{1,7});/g, function (m, nom) {
      const rep = SP_HTML_ENTITIES[nom];
      return typeof rep === 'string' ? rep : m;
    });
    t = t.replace(/&#([0-9]{1,7});/g, function (m, dec) {
      const c = parseInt(dec, 10);
      return (c > 0 && c <= 1114111) ? String.fromCharCode(c) : m;
    });
    t = t.replace(/&#[xX]([0-9a-fA-F]{1,6});/g, function (m, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    });`;

const A6_FROM = `        const src = att.docx ? 'DOCUMENT WORD' : 'TEXTE';`;
const A6_TO   = `        // 🆕 v1.7.396 — le libelle du format d'origine est desormais exact
        //   (.doc et .odt sont de vrais documents Word/OpenDocument, pas « TEXTE »).
        const src = att.docLabel || (att.docx ? 'DOCUMENT WORD' : 'TEXTE');`;

const A7_FROM = `    note += 'Chaque page doit porter un folio. Aucune page ne doit rester vide.\\n';
    return note;`;

const A7_TO = `    // 🆕 v1.7.396 — CONVENTIONS DU TEXTE STRUCTURE.
    //   Mesure : les decodeurs produisent « # Titre », « - item », « | cellule »
    //   et « [IMAGE_n] », mais AUCUNE consigne ne disait au modele ce que ces
    //   marques signifient. Il les traitait donc comme du texte litteral et
    //   aplatissait la hierarchie du document dans la maquette.
    note += 'CONVENTIONS DU TEXTE FOURNI (converti depuis le document original) :\\n';
    note += '  • « # » a « ###### » = titre de niveau 1 a 6. Utilise-les comme titres hierarchises\\n';
    note += '    de la maquette (1 = le plus grand). Un titre de niveau 1 ouvre une nouvelle page.\\n';
    note += '  • « - » en debut de ligne = element de liste : restitue une vraie liste a puces,\\n';
    note += '    jamais un paragraphe continu.\\n';
    note += '  • « | » separe les cellules d\\'un tableau, encadre par [TABLEAU] … [/TABLEAU] :\\n';
    note += '    restitue un vrai tableau, pas des lignes de texte.\\n';
    note += '  • « [IMAGE_n] » = emplacement d\\'une photo du document. La photo correspondante est\\n';
    note += '    jointe (« … — image n+1 ») et se place avec "imageIndex". Respecte cet ordre.\\n';
    note += '  • « --- PAGE --- » = saut de page present dans le document d\\'origine.\\n';
    note += 'Chaque page doit porter un folio. Aucune page ne doit rester vide.\\n';
    return note;`;

const A8_FROM = `  // 🆕 v1.7.388 — EXTRACTION RICHE D'UN .docx (images + structure).`;
const A8_TO   = MODULE + `  // 🆕 v1.7.388 — EXTRACTION RICHE D'UN .docx (images + structure).`;

function patch(src, counters) {
  let s = src;
  s = sub(s, 'accept', A1_FROM, A1_TO, counters);
  s = sub(s, 'txtExts', A2_FROM, A2_TO, counters);
  s = sub(s, 'branche doc/docx', A3_FROM, A3_TO, counters);
  s = sub(s, 'message non supporte', A4_FROM, A4_TO, counters);
  s = sub(s, 'entites HTML', A5_FROM, A5_TO, counters);
  s = sub(s, 'libelle buildAttachmentContext', A6_FROM, A6_TO, counters);
  s = sub(s, 'note conventions', A7_FROM, A7_TO, counters);
  s = sub(s, 'insertion module', A8_FROM, A8_TO, counters);
  return s;
}

let ok = true;
TARGETS.forEach(function (file) {
  console.log('\n=== ' + file + ' ===');
  if (!fs.existsSync(file)) { console.log('  ABSENT — ignore'); return; }
  const raw = fs.readFileSync(file, 'utf8');
  const bom = raw.charCodeAt(0) === 0xFEFF ? '\uFEFF' : '';
  const eol = eolOf(raw);
  const body = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const counters = [];
  let out;
  try {
    out = patch(body, counters);
  } catch (e) {
    console.log('  ECHEC : ' + e.message);
    ok = false;
    return;
  }
  counters.forEach(function (c) { console.log('  OK  ' + c); });
  if (out.length < body.length) {
    console.log('  REFUS : taille en baisse (' + body.length + ' -> ' + out.length + ')');
    ok = false;
    return;
  }
  console.log('  taille ' + body.length + ' -> ' + out.length + ' (+' + (out.length - body.length) + ')  bom=' + (bom ? 'oui' : 'non') + '  eol=' + (eol === '\r\n' ? 'CRLF' : 'LF'));
  if (APPLY) {
    fs.writeFileSync(file, bom + (eol === '\r\n' ? out.replace(/\n/g, '\r\n') : out), 'utf8');
    console.log('  ECRIT');
  } else {
    console.log('  (dry-run)');
  }
});

console.log('\n' + (ok ? 'Ancres toutes validees.' : 'DES ANCRES ONT ECHOUE.') + (APPLY ? ' Mode APPLY.' : ' Mode DRY-RUN.'));
if (!ok) process.exit(1);
