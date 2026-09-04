// Régénérer sp213-local.zip depuis sp213-local/ (structure plate, sans sorties générées)
import { readdirSync, statSync, createWriteStream, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const SRC = 'C:/Users/zigmoon/Desktop/2.13/sp213-local';
const OUT = 'C:/Users/zigmoon/Desktop/2.13/superprint/sp213-local.zip';

// Utiliser PowerShell Compress-Archive (fiable sur Windows) ou tar (disponible Win10+)
// On liste d'abord le contenu pour vérifier
const entries = readdirSync(SRC);
console.log('Racine sp213-local:', entries.join(', '));
console.log('node_modules present:', existsSync(path.join(SRC, 'node_modules')));
console.log('dist present:', existsSync(path.join(SRC, 'dist')));

// On utilise tar (présent sur Windows 10+ avec bsdtar) pour créer un zip depuis le contenu
// en excluant les dépendances installées et les sorties de build reproductibles.
const cmd = `cd /d "${SRC}" && tar -a -c -f "${OUT}" --exclude=node_modules --exclude=dist --exclude=sp213-local.zip *`;
console.log('CMD:', cmd);
try {
  execSync(cmd, { stdio: 'inherit', shell: 'cmd.exe' });
  const size = statSync(OUT).size;
  console.log('ZIP OK:', OUT, size, 'octets (' + Math.round(size / 1048576) + ' Mo)');
} catch (e) {
  console.error('ERREUR zip:', e.message);
  process.exit(1);
}
