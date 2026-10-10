// Validation indépendante d'un PDF produit par le noyau Rust :
//   1) il s'ouvre dans pdf-lib (donc c'est un PDF bien formé) ;
//   2) la page a la bonne taille ;
//   3) les espaces /Separation des tons directs sont bien présents.
//
// Usage : node scripts/validate-pdf.mjs <fichier.pdf> [chemin-pdf-lib]
//
// pdf-lib est emprunté au produit (superprint/app/JS/pdf-lib.min.js) : la
// validation utilise donc un lecteur PDF éprouvé, pas notre propre code.

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

const [pdfPath, libPathArg] = process.argv.slice(2);
if (!pdfPath) {
  console.error('usage: node scripts/validate-pdf.mjs <fichier.pdf> [chemin-pdf-lib]');
  process.exit(2);
}

const libPath = resolve(
  libPathArg ?? '../superprint/app/JS/pdf-lib.min.js',
);

const bytes = await readFile(pdfPath);
const raw = bytes.toString('latin1');

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) ok = false;
};

// 1) Signature et fin de fichier.
check('en-tête %PDF-', raw.startsWith('%PDF-'));
check('pied %%EOF', raw.trimEnd().endsWith('%%EOF'));

// 2) Tons directs : chaque encre doit apparaître comme un espace /Separation.
const separations = raw.match(/\/Separation\b/g)?.length ?? 0;
check('/Separation ×2 (deux encres)', separations === 2, `${separations} trouvé(s)`);
check('encre « PANTONE WARM RED C »', raw.includes('/PANTONE#20WARM#20RED#20C'));
check('encre « PANTONE VIOLET C »', raw.includes('/PANTONE#20VIOLET#20C'));

// 3) Boîtes de page (196×266 mm ≈ 555.59×754.02 pt).
check('/MediaBox présent', raw.includes('/MediaBox'));
check('/TrimBox présent', raw.includes('/TrimBox'));
check('/BleedBox présent', raw.includes('/BleedBox'));

// 4) Lecture par pdf-lib (analyseur éprouvé).
try {
  const PDFLib = require(libPath);
  const doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages();
  check('pdf-lib ouvre le document', true, `${pages.length} page(s)`);
  if (pages[0]) {
    const { width, height } = pages[0].getSize();
    const mmW = (width / 72) * 25.4;
    const mmH = (height / 72) * 25.4;
    check(
      'taille de page = 196×266 mm',
      Math.abs(mmW - 196) < 0.5 && Math.abs(mmH - 266) < 0.5,
      `${mmW.toFixed(2)}×${mmH.toFixed(2)} mm`,
    );
  }
} catch (error) {
  check('pdf-lib ouvre le document', false, String(error.message ?? error));
}

console.log(ok ? '\n✅ PDF valide et conforme.' : '\n❌ PDF NON conforme.');
process.exit(ok ? 0 : 1);
