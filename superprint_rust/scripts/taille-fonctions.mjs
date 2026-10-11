/* Mesure la taille des fonctions de main.js, pour juger si leur portage en Rust
   a un sens. Une fonction d'une ligne multipliée par un constant ne justifie pas
   une traversée de frontière WebAssembly.

   Usage : node scripts/taille-fonctions.mjs <noms…>
*/
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(ici, '..', '..', 'superprint', 'app', 'JS', 'main.js'), 'utf8');

/** Extrait le corps d'une fonction déclarée, par équilibrage des accolades. */
function corps(nom) {
  const motif = new RegExp(`function\\s+${nom}\\s*\\(`);
  const m = source.match(motif);
  if (!m) return null;
  const debut = m.index;
  const ouvrante = source.indexOf('{', debut);
  if (ouvrante < 0) return null;
  let profondeur = 0;
  for (let i = ouvrante; i < source.length; i += 1) {
    if (source[i] === '{') profondeur += 1;
    else if (source[i] === '}') {
      profondeur -= 1;
      if (profondeur === 0) return source.slice(debut, i + 1);
    }
  }
  return null;
}

for (const nom of process.argv.slice(2)) {
  const c = corps(nom);
  if (!c) {
    console.log(`${nom.padEnd(34)} introuvable`);
    continue;
  }
  const lignes = c.split('\n').length;
  const signature = c.slice(0, c.indexOf('{')).replace(/\s+/g, ' ').trim();
  // Ce qui décide, ce n'est pas la longueur mais la nature des entrées.
  const prendFabric = /textbox|obj|cible|canvas|fabricCanvas|blanc|selection/i.test(signature);
  const verdict = lignes <= 12 ? 'trop petit pour Rust' : prendFabric ? 'entrees d’interface' : 'candidat';
  console.log(
    `${nom.padEnd(34)} ${String(lignes).padStart(4)} lignes  ${verdict.padEnd(20)} ${signature.slice(0, 80)}`,
  );
}
