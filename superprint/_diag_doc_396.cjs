// _diag_doc_396.cjs — pourquoi le filler binaire survit-il ?
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
console.log('taille fichier : ' + bytes.length + ' octets');

// On interroge les VRAIES fonctions du module (jamais une reimplementation :
// c'est ainsi qu'on avait cru que tout fonctionnait).
const runs = [];
ctx.spRunsFromCodes(bytes.length, function (i) { return bytes[i]; }, true, function (t) { runs.push(t); });

console.log('\nruns retenus par le VRAI filtre : ' + runs.length);
runs.forEach(function (r, i) {
  console.log('\n--- run ' + i + ' : ' + r.length + ' caracteres   score=' + ctx.spProseScore(r).toFixed(3));
  console.log('    ' + JSON.stringify(r.slice(0, 300)));
});
if (!runs.length) console.log('  (aucun)');

console.log('\n=== resultat final spLegacyDocToText ===');
const final = ctx.spLegacyDocToText(bytes);
console.log('longueur : ' + final.length);
console.log(JSON.stringify(final));

