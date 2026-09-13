// _diag_ole_396.cjs — etape par etape, ou le parseur OLE s'arrete-t-il ?
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

const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, '_fixtures_396', 'vrai8.doc')));
console.log('fichier : ' + bytes.length + ' octets');

const ole = ctx.spOleRead(bytes);
console.log('spOleRead : ' + (ole ? 'objet renvoye' : 'NULL'));
if (!ole) process.exit(1);

console.log('flux trouves : ' + JSON.stringify(ole.entries.map(function (e) { return e.name + '(type' + e.type + ',' + e.size + 'o)'; })));

const wd = ole.stream('WordDocument');
console.log('WordDocument : ' + (wd ? wd.length + ' octets' : 'NULL'));
if (wd) {
  console.log('  signature 0x' + wd[0].toString(16) + wd[1].toString(16) + ' (attendu a5ec en LE => ec a5)');
  const dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
  console.log('  flags1      = 0x' + dv.getUint16(0x0A, true).toString(16) + '  (0x0200 => 1Table)');
  console.log('  ccpText     = ' + dv.getUint32(0x4C, true));
  console.log('  fcClx       = ' + dv.getUint32(0x1A2, true));
  console.log('  lcbClx      = ' + dv.getUint32(0x1A6, true));
}
const t1 = ole.stream('1Table');
const t0 = ole.stream('0Table');
console.log('1Table : ' + (t1 ? t1.length + ' octets' : 'NULL') + '   0Table : ' + (t0 ? t0.length + ' octets' : 'NULL'));

const tbl = t1 || t0;
if (tbl && wd) {
  const dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
  const fcClx = dv.getUint32(0x1A2, true);
  const lcbClx = dv.getUint32(0x1A6, true);
  console.log('\nzone CLX : fcClx=' + fcClx + ' lcbClx=' + lcbClx + '  (tbl.length=' + tbl.length + ')');
  if (fcClx + lcbClx <= tbl.length) {
    const clx = tbl.subarray(fcClx, fcClx + lcbClx);
    console.log('premiers octets du CLX : ' + Array.from(clx.slice(0, 20)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join(' '));
    console.log('clx[0] = 0x' + clx[0].toString(16) + '  (0x02 = Pcdt attendu, 0x01 = Prc)');
    if (clx[0] === 0x02) {
      const lcb = clx[1] | (clx[2] << 8) | (clx[3] << 16) | (clx[4] << 24);
      const n = Math.floor((lcb - 4) / 12);
      console.log('  lcb(PlcPcd) = ' + lcb + '   n(morceaux) = ' + n);
      const plcStart = 5;
      const plc = clx.subarray(plcStart, plcStart + lcb);
      const pdv = new DataView(plc.buffer, plc.byteOffset, plc.byteLength);
      for (let i = 0; i < n; i++) {
        const cpA = pdv.getUint32(i * 4, true);
        const cpB = pdv.getUint32((i + 1) * 4, true);
        const pcdOff = (n + 1) * 4 + i * 8;
        let fc = pdv.getUint32(pcdOff + 2, true);
        const compresse = (fc & 0x40000000) !== 0;
        fc = compresse ? ((fc & 0x3FFFFFFF) >>> 1) : (fc & 0x3FFFFFFF);
        console.log('  morceau ' + i + ' : cp ' + cpA + '->' + cpB + ' (' + (cpB - cpA) + ' car.)  fc=' + fc +
          '  compresse=' + compresse + '  dansWordDocument=' + (fc < wd.length));
      }
    }
  } else {
    console.log('  HORS BORNES : le CLX n\'est pas dans ce flux de table');
  }
}

console.log('\n=== texte brut du flux WordDocument autour de 0x400 ===');
console.log(JSON.stringify(ctx.spBytesToLatin1(wd.subarray(0x3F0, 0x460))));
