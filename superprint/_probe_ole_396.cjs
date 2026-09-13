// _probe_ole_396.cjs — sonde l'execution exacte de spDocTextFromOle
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'sp213-studio.html'), 'utf8').replace(/\r\n/g, '\n');
const start = html.indexOf('  // ══════════════════════════════════════════════════════════════════════\n  // 🆕 v1.7.396 — IMPORT DOCUMENTAIRE UNIVERSEL');
const end = html.indexOf("  // 🆕 v1.7.388 — EXTRACTION RICHE D'UN .docx");
console.log('bornes module : start=' + start + ' end=' + end + '  (taille=' + (end - start) + ')');
const module_ = html.slice(start, end);
console.log('spDocTextFromOle dans le module : ' + (module_.indexOf('function spDocTextFromOle') !== -1));
console.log('spOleRead dans le module        : ' + (module_.indexOf('function spOleRead') !== -1));
console.log('spCp1252Byte dans le module     : ' + (module_.indexOf('function spCp1252Byte') !== -1));
console.log('SP_DOC_CP1252 dans le module    : ' + (module_.indexOf('SP_DOC_CP1252') !== -1));

const ctx = { console, Uint8Array, DataView, Buffer, parseInt, Math, String, Object, Array, Error, RegExp };
vm.createContext(ctx);
vm.runInContext(module_, ctx);

const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, '_fixtures_396', 'vrai8.doc')));

// Appel de chaque brique reelle.
const ole = ctx.spOleRead(bytes);
const wd = ole.stream('WordDocument');
console.log('\nwd.length = ' + wd.length + '   wd.buffer.byteLength = ' + wd.buffer.byteLength);
console.log('wd[0]=' + wd[0] + ' wd[1]=' + wd[1] + '  (attendu 236, 165)');
console.log('spCp1252Byte(0x4C) = ' + JSON.stringify(ctx.spCp1252Byte(0x4C)));
console.log('spCp1252Byte(0xE9) = ' + JSON.stringify(ctx.spCp1252Byte(0xE9)));

const dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
console.log('DataView ok : ccpText=' + dv.getUint32(0x4C, true));
console.log('octets 1024..1040 = ' + JSON.stringify(ctx.spBytesToLatin1(wd.subarray(1024, 1040))));

console.log('\napres decodeur :');
const t = ctx.spDocTextFromOle(bytes);
console.log('  longueur = ' + t.length);
console.log('  ' + JSON.stringify(t.slice(0, 200)));
