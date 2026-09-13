// tools/make-release-zip.mjs — assemble sp213-local.zip (le livrable téléchargé par le lanceur npm)
//
// Le zip est volontairement GITIGNORÉ : il est produit puis publié sur
// app.zigmoon.com/sp213-local.zip, pas versionné dans le dépôt.
//
// Usage :  node tools/make-release-zip.mjs
//
// Structure PLATE, sans dépendances installées ni sorties de build :
//   node_modules/  dist/  *.log  sont exclus.

import { readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Racine du dépôt = dossier parent de tools/
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'sp213-local');
const OUT = path.join(ROOT, 'superprint', 'sp213-local.zip');

if (!existsSync(SRC)) {
  console.error('ERREUR : dossier introuvable ->', SRC);
  process.exit(1);
}

console.log('Racine dépôt      :', ROOT);
console.log('Source            :', SRC);
console.log('Destination       :', OUT);
console.log('Contenu source    :', readdirSync(SRC).join(', '));
console.log('node_modules      :', existsSync(path.join(SRC, 'node_modules')) ? 'présent (exclu)' : 'absent');
console.log('dist              :', existsSync(path.join(SRC, 'dist')) ? 'présent (exclu)' : 'absent');

// tar de Windows 10+ (bsdtar) est fiable ; -a choisit le format ZIP d'après l'extension.
const cmd = `cd /d "${SRC}" && tar -a -c -f "${OUT}" --exclude=node_modules --exclude=dist ` +
            `--exclude=sp213-local.zip --exclude=vite-studio.log --exclude="*.log" *`;

try {
  execSync(cmd, { stdio: 'inherit', shell: 'cmd.exe' });
  const size = statSync(OUT).size;
  console.log(`ZIP OK: ${OUT}  ${size} octets (${Math.round(size / 1048576)} Mo)`);
} catch (e) {
  console.error('ERREUR zip :', e.message);
  process.exit(1);
}
