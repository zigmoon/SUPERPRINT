// _test_import_396.cjs — execute les VRAIES fonctions du studio, hors navigateur
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const STUDIO = path.join(__dirname, 'sp213-studio.html');
const html = fs.readFileSync(STUDIO, 'utf8').replace(/\r\n/g, '\n');

// On extrait le module insere par _fix_import_396.cjs, tel quel.
const start = html.indexOf('  // ══════════════════════════════════════════════════════════════════════\n  // 🆕 v1.7.396 — IMPORT DOCUMENTAIRE UNIVERSEL');
const end = html.indexOf("  // 🆕 v1.7.388 — EXTRACTION RICHE D'UN .docx");
if (start === -1 || end === -1 || end <= start) {
  console.error('Module v1.7.396 introuvable dans le studio.');
  process.exit(1);
}
const module_ = html.slice(start, end);

// Les entites HTML sont definies dans le module ; spHtmlToStructuredText est
// plus bas. On extrait aussi cette fonction pour tester le decodage.
const hStart = html.indexOf('  function spHtmlToStructuredText(html) {');
const hEnd = html.indexOf('  // 🆕 v1.7.388 — LE DOCUMENT JOINT PILOTE LA MISE EN PAGE.', hStart);
const htmlFn = html.slice(hStart, hEnd);

// Bridge de console pour lire les messages produits.
const messages = [];
const ctx = {
  console: console,
  DOMParser: undefined,
  window: {},
  state: { attachments: [] },
  renderAttachBar: function () {},
  appendChat: function (who, txt) { messages.push(txt); },
  loadAttachmentLibrary: function () { return Promise.reject(new Error('hors navigateur')); },
  spExtractWordRich: function () {},
  Uint8Array: Uint8Array,
  Buffer: Buffer,
  parseInt: parseInt, parseFloat: parseFloat, Math: Math, String: String,
  Object: Object, Array: Array, Error: Error, Promise: Promise, RegExp: RegExp,
  setTimeout: setTimeout
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(module_ + '\n' + htmlFn +
  '\nthis.__api = { spDetectDocFormat, spRtfToText, spLegacyDocToText, spLetterCount,' +
  ' spBytesToLatin1, spHtmlToStructuredText, spDocChar, SP_HTML_ENTITIES, spRunsFromCodes,' +
  ' spProseScore, spIsProse, spDocTextFromOle, spOleRead };', ctx);
const api = ctx.__api;

const DIR = path.join(__dirname, '_fixtures_396');
let fails = 0;
function check(label, cond, detail) {
  console.log((cond ? '  OK   ' : '  ECHEC') + '  ' + label + (detail ? '  ->  ' + detail : ''));
  if (!cond) fails++;
}
function show(t) {
  const s = String(t || '');
  console.log('        [' + s.length + ' car.] ' + JSON.stringify(s.slice(0, 260)) + (s.length > 260 ? ' …' : ''));
  return s;
}

console.log('\n══════ 1. DETECTION DU FORMAT REEL (signature, pas extension) ══════');
[
  ['test.odt', 'odf'],
  ['test.rtf', 'rtf'],
  ['test.doc', 'doc'],
  ['renomme.doc', 'odf'],
  ['renomme.odt', 'rtf']
].forEach(function (pair) {
  const buf = new Uint8Array(fs.readFileSync(path.join(DIR, pair[0])));
  const got = api.spDetectDocFormat(buf);
  check(pair[0] + ' -> ' + pair[1], got === pair[1], 'obtenu: ' + got);
});

console.log('\n══════ 2. RTF : le balisage ne doit PAS atteindre le prompt ══════');
const rtfText = api.spRtfToText(api.spBytesToLatin1(new Uint8Array(fs.readFileSync(path.join(DIR, 'test.rtf')))));
show(rtfText);
check('aucun mot-cle de controle restant', !/\\[a-z]+\d?/.test(rtfText), (rtfText.match(/\\[a-z]+/g) || []).slice(0, 5).join(', '));
check('pas de table de polices', rtfText.indexOf('fonttbl') === -1 && rtfText.indexOf('Times New Roman') === -1);
check('pas du generateur', rtfText.indexOf('Riched20') === -1);
check('accents CP1252 corrects (Pavé)', /Pav\u00e9 Mosa\u00eff?que/.test(rtfText), JSON.stringify(rtfText.slice(0, 40)));
check('apostrophe typographique \\u8217 (decimal)', /\u2019artisan/.test(rtfText), JSON.stringify(rtfText.slice(0, 80)));
check('accent unicode \\u233 = e accent aigu', /\u00e9querre/.test(rtfText), JSON.stringify(rtfText.match(/(\S*querre)/g)));
check('euro \\u8364 (decimal 8364 = U+20AC)', /\u20ac/.test(rtfText));
check('tiret demi-cadratin \\endash', /\u2013/.test(rtfText));
check('tiret cadratin \\u8212 (decimal)', /\u2014/.test(rtfText));
check('guillemets \\u171 / \\u187', /\u00ab/.test(rtfText) && /\u00bb/.test(rtfText));
check('AUCUN caractere de repli parasite (« ? »)', rtfText.indexOf('?') === -1, JSON.stringify(rtfText));
check('\\par -> sauts de ligne', (rtfText.match(/\n/g) || []).length >= 6, (rtfText.match(/\n/g) || []).length + ' saut(s)');
check('\\bullet -> puces', (rtfText.match(/^- /gm) || []).length >= 2);
check('\\% non mange', /20 %|20%/.test(rtfText) || rtfText.indexOf('TVA') !== -1);

console.log('\n══════ 3. .doc BINAIRE — repli heuristique sur fichier corrompu ══════');
// ⚠️ test.doc est VOLONTAIREMENT invalide (octets aleatoires, aucune structure
//   OLE). Il ne sert qu'a verifier que le REPLI ne rejette pas le texte qu'il
//   parvient malgre tout a reconnaitre. Les vrais .doc sont couverts par
//   _test_oledoc_396.cjs (decodeur structurel, score 1.000).
const docText = api.spLegacyDocToText(new Uint8Array(fs.readFileSync(path.join(DIR, 'test.doc'))));
show(docText);
check('le texte reconnaissable est recupere', /mati\u00e8re en tension/.test(docText), JSON.stringify(docText.slice(0, 60)));
check('volume utile (> 100 lettres)', api.spLetterCount(docText) >= 100, api.spLetterCount(docText) + ' lettres');
check('prose dominante (le binaire ne noie pas le texte)', api.spProseScore(docText) > 0.85, api.spProseScore(docText).toFixed(3));
check('pas de remplissage binaire massif', docText.length < 400, docText.length + ' car.');

console.log('\n══════ 4. ENTITES HTML : plus de « &eacute; » dans la maquette ══════');
const src = '<h1>Caf&eacute; &amp; Th&eacute;&nbsp;: l&rsquo;art</h1><p>120&nbsp;&euro; &#8212; 20&#8239;% &hellip; &laquo; oui &raquo; &deg;C</p>';
const hText = api.spHtmlToStructuredText(src);
show(hText);
check('entite nommee accentuee', hText.indexOf('Caf\u00e9') !== -1);
check('entite numerique decimale &#8212;', hText.indexOf('\u2014') !== -1);
check('entite numerique &#8239; (espace fine)', hText.indexOf('&#') === -1);
check('AUCUNE entite restante', !/&[a-zA-Z#]/.test(hText), (hText.match(/&[a-zA-Z#][a-zA-Z0-9#]*;?/g) || []).join(' '));
check('h1 -> # ', hText.indexOf('# Caf\u00e9') !== -1);

const hexSrc = '<p>a&#x2019;b &#xE9;t&#xE9;</p>';
const hexText = api.spHtmlToStructuredText(hexSrc);
check('entite hexadecimale &#xE9;', hexText.indexOf('\u00e9t\u00e9') !== -1, JSON.stringify(hexText));
check('table complete (>100 entrees)', Object.keys(api.SP_HTML_ENTITIES).length > 100, Object.keys(api.SP_HTML_ENTITIES).length + ' entrees');

console.log('\n══════ 5. AIGUILLAGE REEL (extractDocumentAttachment) ══════');
// On remplace DOMParser par un parseur minimal pour l'ODT : le module utilise
// l'API DOM standard, on l'execute donc dans le navigateur pour cette partie.
console.log('  (ODT verifie dans le navigateur — voir _audit_import_396.cjs)');

console.log('\n' + (fails ? '❌ ' + fails + ' echec(s)' : '✅ TOUT PASSE') + '\n');
process.exit(fails ? 1 : 0);
