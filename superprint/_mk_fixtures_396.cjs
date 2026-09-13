// _mk_fixtures_396.cjs — construit de vrais fichiers de test sans npm
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIR = path.join(__dirname, '_fixtures_396');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

// ── Mini ecrivain ZIP (deflate + entrees) ───────────────────────────────
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xFF;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zip(entries) {
  const locals = [], centrals = [];
  let off = 0;
  entries.forEach(function (e) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const method = e.store ? 0 : 8;
    const body = e.store ? data : zlib.deflateRawSync(data);
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(e.store ? 0 : 0, 38);
    ch.writeUInt32LE(off, 42);
    centrals.push(ch, name);

    off += lh.length + name.length + body.length;
  });
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(off, 16);
  return Buffer.concat([Buffer.concat(locals), cd, eocd]);
}

// ── 1) ODT realiste (style LibreOffice, accents, listes, tableau, image) ──
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=',
  'base64');

const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
 xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
 xmlns:xlink="http://www.w3.org/1999/xlink">
 <office:body><office:text>
  <text:h text:outline-level="1">Le Pavé Mosaïque</text:h>
  <text:p>Dans la <text:span>franc-maçonnerie</text:span>, le pavé est un symbole — « clé » de l\'édifice.</text:p>
  <text:h text:outline-level="2">L\'Équerre et le Compas</text:h>
  <text:p>Deux outils indissociables :</text:p>
  <text:list><text:list-item><text:p>l\'équerre pour la rectitude</text:p></text:list-item>
   <text:list-item><text:p>le compas pour la mesure</text:p></text:list-item></text:list>
  <text:p>Tarifs : 120&#160;€ · dégressif · TVA 20&#8239;%</text:p>
  <table:table>
   <table:table-row><table:table-cell><text:p>Ligne</text:p></table:table-cell><table:table-cell><text:p>Prix</text:p></table:table-cell></table:table-row>
   <table:table-row><table:table-cell><text:p>Atelier</text:p></table:table-cell><table:table-cell><text:p>25 €</text:p></table:table-cell></table:table-row>
  </table:table>
  <text:p>Illustration :</text:p>
  <text:p><draw:frame><draw:image xlink:href="Pictures/mosaique.png" /></draw:frame></text:p>
  <text:h text:outline-level="3">Tension et matière</text:h>
  <text:p>Le pavé mosaïque : la matière en tension.</text:p>
 </office:text></office:body>
</office:document-content>`;

const odt = zip([
  { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text', store: true },
  { name: 'content.xml', data: contentXml },
  { name: 'Pictures/mosaique.png', data: PNG }
]);
fs.writeFileSync(path.join(DIR, 'test.odt'), odt);

// ── 2) RTF realiste (accents \'e9, unicode \uNNNN DECIMAL, groupes ignorables)
//   Rappel de spec : \uNNNN est un code DECIMAL, pas hexa. \u8217 = U+2019 (’),
//   \u233 = U+00E9 (é), \u8212 = U+2014 (—). Le caractere qui suit \uNNNN est un
//   repli a IGNORER.
const rtf = '{\\rtf1\\ansi\\ansicpg1252\\deff0\\nouicompat' +
  '{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}}' +
  '{\\colortbl ;\\red0\\green0\\blue0;}' +
  '{\\*\\generator Riched20 10.0.19041;}' +
  '{\\info{\\title Mariage}}' +
  '\\viewkind4\\uc1\\pard\\f0\\fs24\\lang1036 ' +
  'Le Pav\\\'e9 Mosa\\\'efque et l\\u233?querre.\\par ' +
  'L\\u8217?artisan pose la pierre.\\par ' +
  '\\pard\\li360\\bullet\\tab l\\u233?querre pour la rectitude\\par ' +
  '\\bullet\\tab le compas pour la mesure\\par ' +
  '\\pard Tarifs : 120 \\u8364? d\\\'e9gressif \\endash  TVA 20 \\%\\par ' +
  'Texte en \\b gras\\b0  et en \\i italique\\i0 .\\par ' +
  '\\u8212? tiret cadratin et \\u171?guillemet\\u187? francais\\par }';
fs.writeFileSync(path.join(DIR, 'test.rtf'), Buffer.from(rtf, 'latin1'));

// ── 3) Faux .doc : OLE binaire contenant du texte CP1252 et de l'UTF-16LE ──
const oleHead = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
const filler = Buffer.alloc(512, 0x00);
for (let i = 0; i < filler.length; i++) filler[i] = (i * 37 + 11) & 0xFF;
const cpText = Buffer.from(
  'Le Pav\u00e9 Mosa\u00efque et l\u2019\u00c9querre du Compas\r' +
  'Le pav\u00e9 mosa\u00efque : la mati\u00e8re en tension.\r' +
  'Tarifs d\u00e9gressifs, TVA 20 %. R\u00e9servation obligatoire.\r' +
  'Contact : atelier@exemple.fr \u2014 06 12 34 56 78\r', 'latin1');
const utfText = Buffer.from(
  'LE PAVE MOSAIQUE ET LE COMPAS\r' +
  'Document de reference pour la mise en page du livret.\r' +
  'Les ateliers se tiennent le mardi soir, entree libre sur reservation.\r',
  'utf16le');
fs.writeFileSync(path.join(DIR, 'test.doc'),
  Buffer.concat([oleHead, filler, cpText, filler, utfText]));

// ── 4) Faux .doc qui est en realite un ODT (cas Gmail/Outlook) ─────────
fs.writeFileSync(path.join(DIR, 'renomme.doc'), odt);
fs.writeFileSync(path.join(DIR, 'renomme.odt'), Buffer.from(rtf, 'latin1'));

console.log('Fixtures ecrites dans ' + DIR);
fs.readdirSync(DIR).forEach(function (f) {
  console.log('  ' + f.padEnd(18) + fs.statSync(path.join(DIR, f)).size + ' octets');
});
