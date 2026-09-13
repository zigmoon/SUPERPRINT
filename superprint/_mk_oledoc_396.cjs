// _mk_oledoc_396.cjs — construit de VRAIS conteneurs OLE « .doc » (Word 97-2003)
//   conformes a la specification : en-tete OLE + FAT + repertoire + flux
//   « WordDocument » (signature 0xA5EC, FIB complet) + flux « 1Table » (CLX).
//   C'est le seul moyen de valider le decodeur structurel sur le vrai format.
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '_fixtures_396');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const SEC = 512;

// Repartit un flux sur ses secteurs consecutifs (Buffer.copy tronque).
function copySectors(stream, sectors, first) {
  for (let i = 0; i * SEC < stream.length; i++) {
    stream.copy(sectors[first + i], 0, i * SEC, Math.min(stream.length, (i + 1) * SEC));
  }
}

// ── Fabrique un .doc OLE valide ─────────────────────────────────────────
//   texte   : chaine JS (les \n deviennent des retours paragraphe 0x0D)
//   unicode : false -> morceau 8 bits (CP1252) ; true -> morceau UTF-16LE
function buildDoc(textes, unicode) {
  // 1) Le texte principal, encode.
  const sources = textes.map(function (t) { return t.replace(/\n/g, '\r'); });
  let wd = Buffer.alloc(0x800, 0);           // flux WordDocument (2 048 octets)
  const TEXT_OFF = 0x400;                    // le texte commence apres le FIB
  let cursor = TEXT_OFF;
  const pieces = [];
  sources.forEach(function (src) {
    const buf = unicode ? Buffer.from(src, 'utf16le') : Buffer.from(src, 'latin1');
    const nChars = unicode ? src.length : buf.length;
    pieces.push({ off: cursor, nChars: nChars });
    buf.copy(wd, cursor);
    cursor += buf.length;
    // Alignement pair : Word place toujours les morceaux sur un offset pair,
    // car l'offset est stocke divise par 2 pour un morceau 8 bits.
    if (cursor % 2) cursor++;
  });

  // 2) FIB : signature, drapeaux (choix du flux de table), ccpText, fcClx.
  wd[0] = 0xEC; wd[1] = 0xA5;
  wd.writeUInt16LE(0x0200, 0x0A);            // fWhichTblStm = 1 -> flux « 1Table »
  const ccpText = pieces.reduce(function (s, p) { return s + p.nChars; }, 0);
  wd.writeUInt32LE(ccpText, 0x4C);
  const FC_CLX = 0;
  wd.writeUInt32LE(FC_CLX, 0x1A2);

  // 3) CLX : Pcdt (0x02) + PlcPcd = (n+1) CP + n PCD.
  const n = pieces.length;
  const plcLen = (n + 1) * 4 + n * 8;
  const clx = Buffer.alloc(5 + plcLen, 0);
  clx[0] = 0x02;
  clx.writeUInt32LE(plcLen, 1);
  let cp = 0;
  pieces.forEach(function (p, i) {
    clx.writeUInt32LE(cp, 5 + i * 4);
    cp += p.nChars;
  });
  clx.writeUInt32LE(cp, 5 + n * 4);
  const pcdBase = 5 + (n + 1) * 4;
  pieces.forEach(function (p, i) {
    const o = pcdBase + i * 8;
    // Specification FcCompressed : le bit 0x40000000 signale un morceau 8 bits,
    // et dans CE cas seulement l'offset est stocke double. Un morceau UTF-16
    // stocke l'offset BRUT (ni double, ni decale).
    const fc = unicode ? p.off : (((p.off << 1) | 0x40000000) >>> 0);
    clx.writeUInt32LE(fc, o + 2);
  });
  wd.writeUInt32LE(clx.length, 0x1A6);

  const tbl = Buffer.alloc(0x800, 0);
  clx.copy(tbl, FC_CLX);

  // ── Conteneur OLE ───────────────────────────────────────────────────
  // Repertoire (1 secteur), FAT (1 secteur), WordDocument (4 secteurs),
  // 1Table (4 secteurs).
  const SEC_DIR = 0, SEC_FAT = 1, SEC_WD = 2, SEC_TBL = 6;
  const NB_WD = wd.length / SEC, NB_TBL = tbl.length / SEC;
  const total = 10;

  const header = Buffer.alloc(SEC, 0);
  Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]).copy(header, 0);
  header.writeUInt16LE(0x003E, 0x18);        // version mineure
  header.writeUInt16LE(0x0003, 0x1A);        // version majeure (512)
  header.writeUInt16LE(0xFFFE, 0x1C);        // little endian
  header.writeUInt16LE(9, 0x1E);             // secteur = 2^9
  header.writeUInt16LE(6, 0x20);             // mini secteur = 2^6
  header.writeUInt32LE(1, 0x2C);             // 1 secteur de FAT
  header.writeUInt32LE(SEC_DIR, 0x30);       // 1er secteur du repertoire
  header.writeUInt32LE(4096, 0x38);          // seuil du mini-flux
  header.writeUInt32LE(0xFFFFFFFE, 0x3C);    // pas de mini-FAT
  header.writeUInt32LE(0, 0x40);
  header.writeUInt32LE(0xFFFFFFFE, 0x44);    // pas de DIFAT
  header.writeUInt32LE(0, 0x48);
  for (let i = 0; i < 109; i++) header.writeUInt32LE(0xFFFFFFFF, 0x4C + i * 4);
  header.writeUInt32LE(SEC_FAT, 0x4C);       // DIFAT[0] = secteur de la FAT

  // FAT
  const fat = Buffer.alloc(SEC, 0xFF);
  const set = function (i, v) { fat.writeUInt32LE(v >>> 0, i * 4); };
  set(SEC_DIR, 0xFFFFFFFD);                  // ENDOFCHAIN
  set(SEC_FAT, 0xFFFFFFFD);
  for (let i = 0; i < NB_WD; i++) set(SEC_WD + i, i === NB_WD - 1 ? 0xFFFFFFFD : SEC_WD + i + 1);
  for (let i = 0; i < NB_TBL; i++) set(SEC_TBL + i, i === NB_TBL - 1 ? 0xFFFFFFFD : SEC_TBL + i + 1);

  // Repertoire
  const dir = Buffer.alloc(SEC, 0);
  function entry(o, name, type, start, size) {
    const nm = name + '\0';
    for (let i = 0; i < nm.length; i++) dir.writeUInt16LE(nm.charCodeAt(i), o + i * 2);
    dir.writeUInt16LE(nm.length * 2, o + 0x40);
    dir[o + 0x42] = type;
    dir[o + 0x43] = 1;                       // noir
    dir.writeUInt32LE(0xFFFFFFFF, o + 0x44);
    dir.writeUInt32LE(0xFFFFFFFF, o + 0x48);
    dir.writeUInt32LE(0xFFFFFFFF, o + 0x4C);
    dir.writeUInt32LE(start, o + 0x74);
    dir.writeUInt32LE(size, o + 0x78);
    dir.writeUInt32LE(0, o + 0x7C);
  }
  entry(0, 'Root Entry', 5, 0xFFFFFFFE, 0);
  entry(128, 'WordDocument', 2, SEC_WD, wd.length);
  entry(256, '1Table', 2, SEC_TBL, tbl.length);

  const sectors = [];
  for (let i = 0; i < total; i++) sectors.push(Buffer.alloc(SEC, 0));
  dir.copy(sectors[SEC_DIR]);
  fat.copy(sectors[SEC_FAT]);
  // ⚠️ Buffer.copy() TRONQUE a la taille de la cible : « wd.copy(sectors[2]) »
  //   ne copiait que les 512 premiers octets du flux (le texte est a l'offset
  //   1024). Il faut copier secteur par secteur.
  copySectors(wd, sectors, SEC_WD);
  copySectors(tbl, sectors, SEC_TBL);

  return Buffer.concat([header].concat(sectors));
}

// ── Fixture A : un seul morceau 8 bits (cas le plus courant) ────────────
const docA = buildDoc([
  "Le Pavé Mosaïque et l'Équerre du Compas\n" +
  "Le pavé mosaïque : la matière en tension.\n" +
  "Tarifs dégressifs, TVA 20 %. Réservation obligatoire.\n" +
  "Contact : atelier@exemple.fr \u2014 06 12 34 56 78\n" +
  "« Le trait juste ouvre l'espace ; l'équerre le referme. »\n"
], false);
fs.writeFileSync(path.join(DIR, 'vrai8.doc'), docA);

// ── Fixture B : deux morceaux dont un en UTF-16LE (texte collé depuis Word) ─
const docB = buildDoc([
  "Chapitre premier : le pavé mosaïque.\n",
  "Le pavé mosaïque : la matière en tension — deuxième partie, saisie au clavier.\n" +
  "Les ateliers se tiennent le mardi soir, entrée libre sur réservation.\n"
], true);
fs.writeFileSync(path.join(DIR, 'vrai16.doc'), docB);

// ── Fixture C : mixte 8 bits + UTF-16 dans le MEME fichier ──────────────
//   Cas réel : Word produit un morceau 8 bits pour le texte courant et un
//   morceau UTF-16 pour le texte collé depuis un autre document.
const piecesC = [];
(function () {
  // On force le mode par morceau en construisant a la main.
  const t1 = "Le pavé mosaïque, la matière en tension.\n";
  const t2 = "Texte collé depuis un autre logiciel : équerre, compas, niveau.\n";
  const b1 = Buffer.from(t1.replace(/\n/g, '\r'), 'latin1');
  const b2 = Buffer.from(t2.replace(/\n/g, '\r'), 'utf16le');
  const wd = Buffer.alloc(0x800, 0);
  const OFF1 = 0x400, OFF2 = 0x600;
  b1.copy(wd, OFF1);
  b2.copy(wd, OFF2);
  wd[0] = 0xEC; wd[1] = 0xA5;
  wd.writeUInt16LE(0x0200, 0x0A);
  const n1 = t1.length, n2 = t2.length;
  wd.writeUInt32LE(n1 + n2, 0x4C);
  wd.writeUInt32LE(0, 0x1A2);
  const plcLen = 3 * 4 + 2 * 8;
  const clx = Buffer.alloc(5 + plcLen, 0);
  clx[0] = 0x02; clx.writeUInt32LE(plcLen, 1);
  clx.writeUInt32LE(0, 5); clx.writeUInt32LE(n1, 9); clx.writeUInt32LE(n1 + n2, 13);
  const base = 5 + 12;
  clx.writeUInt32LE((((OFF1 << 1) | 0x40000000) >>> 0), base + 2);
  // Morceau UTF-16 : offset BRUT (pas de doublement, pas de bit de compression).
  clx.writeUInt32LE(OFF2, base + 10);
  wd.writeUInt32LE(clx.length, 0x1A6);
  const tbl = Buffer.alloc(0x800, 0); clx.copy(tbl, 0);
  piecesC.push({ wd: wd, tbl: tbl, att: { n1: n1, n2: n2 } });

  // Conteneur (meme mise en page que buildDoc).
  const SEC_DIR = 0, SEC_FAT = 1, SEC_WD = 2, SEC_TBL = 6, total = 10;
  const header = Buffer.alloc(SEC, 0);
  Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]).copy(header, 0);
  header.writeUInt16LE(0x003E, 0x18); header.writeUInt16LE(0x0003, 0x1A);
  header.writeUInt16LE(0xFFFE, 0x1C); header.writeUInt16LE(9, 0x1E);
  header.writeUInt16LE(6, 0x20); header.writeUInt32LE(1, 0x2C);
  header.writeUInt32LE(SEC_DIR, 0x30); header.writeUInt32LE(4096, 0x38);
  header.writeUInt32LE(0xFFFFFFFE, 0x3C); header.writeUInt32LE(0, 0x40);
  header.writeUInt32LE(0xFFFFFFFE, 0x44); header.writeUInt32LE(0, 0x48);
  for (let i = 0; i < 109; i++) header.writeUInt32LE(0xFFFFFFFF, 0x4C + i * 4);
  header.writeUInt32LE(SEC_FAT, 0x4C);
  const fat = Buffer.alloc(SEC, 0xFF);
  const set = function (i, v) { fat.writeUInt32LE(v >>> 0, i * 4); };
  set(SEC_DIR, 0xFFFFFFFD); set(SEC_FAT, 0xFFFFFFFD);
  for (let i = 0; i < 4; i++) set(SEC_WD + i, i === 3 ? 0xFFFFFFFD : SEC_WD + i + 1);
  for (let i = 0; i < 4; i++) set(SEC_TBL + i, i === 3 ? 0xFFFFFFFD : SEC_TBL + i + 1);
  const dir = Buffer.alloc(SEC, 0);
  function entry(o, name, type, start, size) {
    const nm = name + '\0';
    for (let i = 0; i < nm.length; i++) dir.writeUInt16LE(nm.charCodeAt(i), o + i * 2);
    dir.writeUInt16LE(nm.length * 2, o + 0x40);
    dir[o + 0x42] = type; dir[o + 0x43] = 1;
    dir.writeUInt32LE(0xFFFFFFFF, o + 0x44); dir.writeUInt32LE(0xFFFFFFFF, o + 0x48);
    dir.writeUInt32LE(0xFFFFFFFF, o + 0x4C);
    dir.writeUInt32LE(start, o + 0x74); dir.writeUInt32LE(size, o + 0x78);
  }
  entry(0, 'Root Entry', 5, 0xFFFFFFFE, 0);
  entry(128, 'WordDocument', 2, SEC_WD, wd.length);
  entry(256, '1Table', 2, SEC_TBL, tbl.length);
  const sectors = [];
  for (let i = 0; i < total; i++) sectors.push(Buffer.alloc(SEC, 0));
  dir.copy(sectors[SEC_DIR]); fat.copy(sectors[SEC_FAT]);
  copySectors(wd, sectors, SEC_WD);
  copySectors(tbl, sectors, SEC_TBL);
  fs.writeFileSync(path.join(DIR, 'mixte.doc'), Buffer.concat([header].concat(sectors)));
})();

console.log('Faux .doc OLE conformes ecrits dans ' + DIR);
['vrai8.doc', 'vrai16.doc', 'mixte.doc'].forEach(function (f) {
  const p = path.join(DIR, f);
  const b = fs.readFileSync(p);
  console.log('  ' + f.padEnd(14) + b.length + ' octets   signature OLE=' +
    (b[0] === 0xD0 && b[1] === 0xCF ? 'oui' : 'NON') +
    '   signature Word=' + (b[512] === 0xEC && b[513] === 0xA5 ? 'oui' : 'NON'));
});
