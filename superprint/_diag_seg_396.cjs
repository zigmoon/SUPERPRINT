// _diag_seg_396.cjs — dump des segments reels produits par le decodeur
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'sp213-studio.html'), 'utf8').replace(/\r\n/g, '\n');
const start = html.indexOf('  // ══════════════════════════════════════════════════════════════════════\n  // 🆕 v1.7.396 — IMPORT DOCUMENTAIRE UNIVERSEL');
const end = html.indexOf("  // 🆕 v1.7.388 — EXTRACTION RICHE D'UN .docx");
const module_ = html.slice(start, end);

const ctx = { console, Uint8Array, Buffer, parseInt, Math, String, Object, Array, Error, RegExp };
vm.createContext(ctx);
vm.runInContext(module_, ctx);

const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, '_fixtures_396', 'test.doc')));

// Reconstruction du decodage, octet par octet, avec les VRAIS spDocChar.
console.log('=== octets 510..700 vus par spDocChar ===');
let line = '';
for (let i = 510; i < 700 && i < bytes.length; i++) {
  const ch = ctx.spDocChar(bytes[i], true);
  const tag = ch === null ? 'NULL' : (ch === '' ? 'VIDE' : JSON.stringify(ch));
  if (i < 560 || tag !== 'VIDE') line += i + ':' + bytes[i].toString(16) + '=' + tag + '  ';
}
console.log(line.slice(0, 2500));

// Segments bruts entre deux null.
console.log('\n=== segments bruts (entre null) ===');
let cur = '', segs = [];
for (let i = 0; i < bytes.length; i++) {
  const ch = ctx.spDocChar(bytes[i], true);
  if (ch === null) { if (cur) segs.push(cur); cur = ''; continue; }
  cur += ch;
}
if (cur) segs.push(cur);
console.log('nombre de segments : ' + segs.length);
segs.sort(function (a, b) { return b.length - a.length; });
segs.slice(0, 6).forEach(function (s, i) {
  const t = s.replace(/\s*\n\s*/g, '\n').trim();
  console.log('\n  #' + i + ' (' + s.length + ' car.) score=' + ctx.spProseScore(t).toFixed(3) + ' isProse=' + ctx.spIsProse(t));
  console.log('     ' + JSON.stringify(s.slice(0, 220)));
});

console.log('\n=== le texte attendu est-il present dans le fichier ? ===');
const latin = ctx.spBytesToLatin1(bytes);
['Pav', 'Mosa', 'Compas', 'mati', 'gersif', 'atelier@exemple.fr', 'MOSAIQUE', 'mardi'].forEach(function (m) {
  console.log('  ' + m.padEnd(20) + ' octet brut trouve : ' + (latin.indexOf(m) !== -1 ? 'OUI' : 'non'));
});
