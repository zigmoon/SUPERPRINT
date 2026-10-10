// Validation indépendante d'un PDF produit par le noyau Rust :
//   1) il s'ouvre dans pdf-lib (donc c'est un PDF bien formé) ;
//   2) la page a la taille annoncée ;
//   3) les espaces /Separation des tons directs sont présents ;
//   4) le cas échéant, l'image XObject existe, a la bonne définition et son
//      flux n'est pas plus gros que ses pixels bruts.
//
// Usage :
//   node scripts/validate-pdf.mjs <fichier.pdf> [options]
//
// Options :
//   --mm=196x266     dimensions attendues de la MediaBox, en millimètres
//   --spots=2        nombre d'encres directes (/Separation) attendu
//   --image=WxH      une image XObject de cette définition est attendue
//   --lib=<chemin>   chemin de pdf-lib.min.js
//
// pdf-lib est emprunté au produit (superprint/app/JS/pdf-lib.min.js) : la
// validation utilise donc un lecteur PDF éprouvé, pas notre propre code.

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const pdfPath = argv.find((value) => !value.startsWith('--'));
if (!pdfPath) {
  console.error(
    'usage: node scripts/validate-pdf.mjs <fichier.pdf> [--mm=WxH] [--spots=N] [--image=WxH]',
  );
  process.exit(2);
}

const option = (name) => {
  const prefix = `--${name}=`;
  const found = argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
};

const expectedMm = (option('mm') ?? '196x266').split('x').map(Number);
const expectedSpots = Number(option('spots') ?? 2);
const expectedImage = option('image')?.split('x').map(Number);
const libPath = resolve(option('lib') ?? '../superprint/app/JS/pdf-lib.min.js');

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '\u2713' : '\u2717'} ${label}${detail ? ` \u2014 ${detail}` : ''}`);
  if (!condition) ok = false;
};

const bytes = await readFile(pdfPath);
const raw = bytes.toString('latin1');

// 1) Signature et fin de fichier.
check('en-tête %PDF-', raw.startsWith('%PDF-'));
check('pied %%EOF', raw.trimEnd().endsWith('%%EOF'));

// 2) Tons directs : chaque encre doit apparaître comme un espace /Separation.
const separations = raw.match(/\/Separation\b/g)?.length ?? 0;
check(`/Separation ×${expectedSpots}`, separations === expectedSpots, `${separations} trouvé(s)`);

// 3) Boîtes de page.
check('/MediaBox présent', raw.includes('/MediaBox'));
check('/TrimBox présent', raw.includes('/TrimBox'));
check('/BleedBox présent', raw.includes('/BleedBox'));

// 4) Lecture par pdf-lib (analyseur éprouvé).
let document;
try {
  const PDFLib = require(libPath);
  document = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
  const pages = document.getPages();
  check('pdf-lib ouvre le document', true, `${pages.length} page(s)`);

  if (pages[0]) {
    const { width, height } = pages[0].getSize();
    const mmW = (width / 72) * 25.4;
    const mmH = (height / 72) * 25.4;
    const [wantW, wantH] = expectedMm;
    check(
      `taille de page = ${wantW}×${wantH} mm`,
      Math.abs(mmW - wantW) < 0.5 && Math.abs(mmH - wantH) < 0.5,
      `${mmW.toFixed(2)}×${mmH.toFixed(2)} mm`,
    );
  }
} catch (error) {
  check('pdf-lib ouvre le document', false, String(error.message ?? error));
}

// 5) Image XObject — lue par pdf-lib, pas par expression régulière.
if (expectedImage && document) {
  const [wantWidth, wantHeight] = expectedImage;
  try {
    const { PDFName } = require(libPath);
    const page = document.getPages()[0];
    const xobjects = page.node.Resources().lookup(PDFName.of('XObject'));
    const stream = xobjects ? document.context.lookup(xobjects.entries()[0][1]) : undefined;

    check('un objet XObject est déclaré', Boolean(stream));
    if (stream) {
      const dict = stream.dict;
      const number = (key) => Number(dict.lookup(PDFName.of(key))?.asNumber() ?? 0);
      const width = number('Width');
      const height = number('Height');
      const isRgb = dict.lookup(PDFName.of('ColorSpace'))?.toString() === '/DeviceRGB';
      const contents = stream.contents;
      const rawLen = width * height * (isRgb ? 3 : 1);

      check(
        `/Subtype /Image ${width}×${height} px`,
        dict.lookup(PDFName.of('Subtype'))?.toString() === '/Image' &&
          width === wantWidth &&
          height === wantHeight,
      );
      check(
        'flux image ≤ pixels bruts (défaut « 131 Mo » interdit)',
        contents.length <= rawLen,
        `${contents.length} ≤ ${rawLen} octets`,
      );
    }
  } catch (error) {
    check('lecture de l’image XObject', false, String(error.message ?? error));
  }
}

console.log(ok ? '\n✅ PDF valide et conforme.' : '\n❌ PDF NON conforme.');
process.exit(ok ? 0 : 1);
