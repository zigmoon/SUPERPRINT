// _test_oledoc_396.cjs — valide le decodeur structurel sur de vrais OLE
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'sp213-studio.html'), 'utf8').replace(/\r\n/g, '\n');
const start = html.indexOf('  // ══════════════════════════════════════════════════════════════════════\n  // 🆕 v1.7.396 — IMPORT DOCUMENTAIRE UNIVERSEL');
const end = html.indexOf("  // 🆕 v1.7.388 — EXTRACTION RICHE D'UN .docx");
const module_ = html.slice(start, end);

const ctx = { console, Uint8Array, DataView, Buffer, parseInt, Math, String, Object, Array, Error, RegExp };
vm.createContext(ctx);
vm.runInContext(module_, ctx);

const DIR = path.join(__dirname, '_fixtures_396');
let fails = 0;
function check(label, cond, detail) {
  console.log((cond ? '  OK   ' : '  ECHEC') + '  ' + label + (detail ? '  ->  ' + detail : ''));
  if (!cond) fails++;
}

function txt(f) { return new Uint8Array(fs.readFileSync(path.join(DIR, f))); }

console.log('\n═══ A. .doc OLE, morceau 8 bits (CP1252) ═══');
const a = ctx.spDocTextFromOle(txt('vrai8.doc'));
console.log('    [' + a.length + ' car.] ' + JSON.stringify(a.slice(0, 300)));
check('flux OLE trouve et FIB reconnu', a.length > 100, a.length + ' car.');
check('accents corrects', /Pav\u00e9 Mosa\u00efque/.test(a));
check('\u00c9 majuscule accentuee (l\u2019\u00c9querre)', /\u00c9querre/.test(a));
check('apostrophe conservee', /l'\u00c9querre|du Compas/.test(a));
check('paragraphes separes par saut de ligne', (a.match(/\n/g) || []).length >= 4);
check('email intact', a.indexOf('atelier@exemple.fr') !== -1);
// Le tiret cadratin n'est pas representable en CP1252 : il est teste sur le
// morceau UTF-16 (cas B) et sur le mixte, pas sur le morceau 8 bits.
check('guillemets francais', a.indexOf('\u00ab') !== -1 && a.indexOf('\u00bb') !== -1);
check('AUCUN binaire (pas de caractere exotique)', !/[\u00A1-\u00BF\u0080-\u009F]{2,}/.test(a), JSON.stringify(a.slice(0, 60)));
check('score de prose eleve', ctx.spProseScore(a) > 0.8, ctx.spProseScore(a).toFixed(3));

console.log('\n═══ B. .doc OLE, morceau UTF-16LE ═══');
const b = ctx.spDocTextFromOle(txt('vrai16.doc'));
console.log('    [' + b.length + ' car.] ' + JSON.stringify(b.slice(0, 300)));
check('contenu extrait', /pav\u00e9 mosa\u00efque/i.test(b), b.slice(0, 60));
check('accents corrects', /\u00e9/.test(b));
check('tiret cadratin', /\u2014/.test(b));
check('pas de binaire', ctx.spProseScore(b) > 0.8, ctx.spProseScore(b).toFixed(3));

console.log('\n═══ C. .doc OLE MIXTE (8 bits + UTF-16) ═══');
const c = ctx.spDocTextFromOle(txt('mixte.doc'));
console.log('    [' + c.length + ' car.] ' + JSON.stringify(c.slice(0, 300)));
check('les DEUX morceaux sont lus', /mati\u00e8re en tension/.test(c) && /niveau/.test(c));
check('texte collé (UTF-16) intact', /logiciel/.test(c));

console.log('\n═══ D. spLegacyDocToText : decodeur structurel en priorite ═══');
const d = ctx.spLegacyDocToText(txt('vrai8.doc'));
check('utilise le decodeur structurel', d.indexOf('Pav\u00e9 Mosa\u00efque') !== -1, JSON.stringify(d.slice(0, 60)));
check('pas de binaire residuel', ctx.spProseScore(d) > 0.8, ctx.spProseScore(d).toFixed(3));

console.log('\n═══ E. Repli heuristique : le VIEUX faux .doc (completement casse) ═══');
const e = ctx.spLegacyDocToText(txt('test.doc'));
check('repli actif mais ne produit pas de binaire', ctx.spProseScore(e) > 0.5 || e.length === 0,
  e.length + ' car. score=' + ctx.spProseScore(e).toFixed(3));

console.log('\n' + (fails ? '❌ ' + fails + ' echec(s)' : '✅ TOUT PASSE') + '\n');
process.exit(fails ? 1 : 0);
