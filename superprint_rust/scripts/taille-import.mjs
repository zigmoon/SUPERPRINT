/* Mesure les fonctions d'import de main.js : taille, et bibliothèques qu'elles
   emploient. Sert à savoir si l'analyse du format est séparable de la pose dans
   Fabric.js.

   Usage : node scripts/taille-import.mjs
*/
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(ici, '..', '..', 'superprint', 'app', 'JS', 'main.js'), 'utf8');

const NOMS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['importDocxFile', 'lancerImportWord', '_spImportEpsFile', 'importIdmlFromZip', 'lireIdml', 'importODTFile'];

const BIBLIOTHEQUES = [
  'mammoth',
  'JSZip',
  'DOMParser',
  'pdfjsLib',
  'PDFLib',
  'jspdf',
  'fontkit',
  'opentype',
  'fabric',
  'canvas',
  'Image',
];

for (const nom of NOMS) {
  const motif = new RegExp(`(?:async\\s+)?function\\s+${nom}\\s*\\(`);
  const m = source.match(motif);
  if (!m) {
    console.log(`${nom.padEnd(22)} introuvable`);
    continue;
  }
  const debut = m.index;
  const ouvrante = source.indexOf('{', debut);
  let profondeur = 0;
  let fin = ouvrante;
  for (let i = ouvrante; i < source.length; i += 1) {
    if (source[i] === '{') profondeur += 1;
    else if (source[i] === '}') {
      profondeur -= 1;
      if (profondeur === 0) {
        fin = i;
        break;
      }
    }
  }
  const corps = source.slice(debut, fin + 1);
  const ligne = source.slice(0, debut).split('\n').length;
  console.log(
    `${nom.padEnd(22)} L${String(ligne).padStart(6)}  ${String(corps.split('\n').length).padStart(4)} lignes`,
  );
  const vues = [];
  for (const lib of BIBLIOTHEQUES) {
    const n = (corps.match(new RegExp(lib, 'g')) || []).length;
    if (n) vues.push(`${lib}:${n}`);
  }
  if (vues.length) console.log(`                       ${vues.join('  ')}`);
}
