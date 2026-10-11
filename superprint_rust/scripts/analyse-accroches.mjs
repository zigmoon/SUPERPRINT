/* Reconnaissance : quelles fonctions de l'application sont **substituables** ?

   Une fonction est substituable si l'application l'atteint à travers `window` :
   `window.X(...)`, ou `window.X || X` (le motif des gestionnaires `onclick` de
   `index.html`). Poser une autre fonction sur `window.X` suffit alors à prendre
   la main, **sans modifier une ligne de `main.js`**.

   ⚠️ Regarder `main.js` SEUL ne suffit pas, et c'est une erreur commise une fois
   dans ce dépôt : `exportImposedPDF` et `confirmExport` n'y sont jamais appelées
   par `window.X(`, mais `index.html` les lit en `window.X || X` depuis les
   boutons d'export. Ce script lit donc **les deux fichiers**.

   Usage :
     node scripts/analyse-accroches.mjs                → la liste complète
     node scripts/analyse-accroches.mjs <nom> <nom>…   → le verdict par nom
*/
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));
const app = join(ici, '..', '..', 'superprint', 'app');

const cibles = [
  ['index.html', join(app, 'index.html')],
  ['main.js', join(app, 'JS', 'main.js')],
].filter(([, chemin]) => existsSync(chemin));

if (cibles.length === 0) {
  console.error(`introuvable : ${join(app, 'JS', 'main.js')}`);
  process.exit(2);
}

/** Les trois façons dont l'application atteint une fonction par `window`. */
const MOTIFS = [
  ['appel', /window\.(\w+)\s*\(/g],
  ['repli ||', /window\.(\w+)\s*\|\|/g],
  ['garde &&', /window\.(\w+)\s*&&/g],
];

/** nom → ensemble de « genre (fichier) ». */
const atteintes = new Map();
for (const [nomFichier, chemin] of cibles) {
  const texte = readFileSync(chemin, 'utf8');
  for (const [genre, motif] of MOTIFS) {
    for (const m of texte.matchAll(motif)) {
      if (!atteintes.has(m[1])) atteintes.set(m[1], new Set());
      atteintes.get(m[1]).add(`${genre} (${nomFichier})`);
    }
  }
}

const noms = process.argv.slice(2);
if (noms.length === 0) {
  console.log(`=== atteintes par window : ${atteintes.size} noms ===`);
  console.log([...atteintes.keys()].sort().join('\n'));
  process.exit(0);
}

for (const nom of noms) {
  const vues = atteintes.get(nom);
  const verdict = vues ? 'SUBSTITUABLE' : 'interne — non substituable';
  console.log(
    `${nom.padEnd(34)} ${verdict.padEnd(28)} ${vues ? [...vues].sort().join(', ') : ''}`,
  );
}
