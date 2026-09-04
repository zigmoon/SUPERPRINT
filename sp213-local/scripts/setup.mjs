#!/usr/bin/env node
// ===============================================================
//  SuperPrint — Assistant d'installation local
//  Une seule commande : télécharge, décompresse, installe, lance.
//  Interface terminal claire et rassurante (étapes, loader, couleurs).
// ===============================================================
import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { get as httpsGet } from 'node:https';
import path from 'node:path';
import os from 'node:os';

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', white: '\x1b[37m',
  bgGreen: '\x1b[42m', bgRed: '\x1b[41m'
};

const isWin = process.platform === 'win32';
const ZIP_URL = 'https://app.zigmoon.com/sp213-local.zip';
const CWD = process.cwd();

// ── Détection du dossier projet ─────────────────────────────
// Gère les deux cas :
//   1) on est dans le dossier projet        (CWD contient package.json)
//   2) on est dans un parent / doublon      (CWD/sp213-local contient package.json)
function findProjectDir() {
  if (existsSync(path.join(CWD, 'package.json'))) return CWD;
  const nested = path.join(CWD, 'sp213-local');
  if (existsSync(path.join(nested, 'package.json'))) return nested;
  return CWD;
}
const TARGET_DIR = findProjectDir();
const alreadyExtracted = existsSync(path.join(TARGET_DIR, 'package.json'));
// Le zip : dans le parent du dossier projet (ou dans le parent du parent si imbriqué)
const ZIP_PATH = path.join(path.dirname(TARGET_DIR), 'sp213-local.zip');

function title(text) {
  console.log(C.green + '  ' + '='.repeat(58) + C.reset);
  console.log(C.green + C.bold + '  ' + text + C.reset);
  console.log(C.green + '  ' + '='.repeat(58) + C.reset);
}
function step(n, label) {
  console.log('');
  console.log(C.bold + C.blue + '  [' + n + '/4]  ' + label + C.reset);
  console.log(C.dim + '  ' + '─'.repeat(52) + C.reset);
}
function ok(m) { console.log(C.green + '  ✔  ' + m + C.reset); }
function info(m) { console.log(C.dim + '  ·  ' + m + C.reset); }
function fail(m) {
  console.log('');
  console.log(C.bgRed + C.white + '  ERREUR  ' + C.reset);
  console.log(C.red + '  ' + m + C.reset);
  console.log(C.dim + '  Vous pouvez réessayer, ou télécharger le zip manuellement : ' + ZIP_URL + C.reset);
}

const BANNER = String.raw`
███████╗██╗   ██╗██████╗ ███████╗██████╗ ██████╗ ██████╗ ██╗███╗   ██╗████████╗
██╔════╝██║   ██║██╔══██╗██╔════╝██╔══██╗██╔══██╗██╔══██╗██║████╗  ██║╚══██╔══╝
███████╗██║   ██║██████╔╝█████╗  ██████╔╝██████╔╝██████╔╝██║██╔██╗ ██║   ██║
╚════██║██║   ██║██╔═══╝ ██╔══╝  ██╔══██╗██╔═══╝ ██╔══██╗██║██║╚██╗██║   ██║
███████║╚██████╔╝██║     ███████╗██║  ██║██║     ██║  ██║██║██║ ╚████║   ██║
╚══════╝ ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝   ╚═╝
`;

console.log('');
console.log(C.cyan + BANNER + C.reset);
title('SUPERPRINT  ·  Assistant d installation local');
console.log(C.dim + '  Toute l application SuperPrint (PAO + Studio SP213) va être installée.' + C.reset);
console.log(C.dim + '  Local-first ; IA cloud uniquement sur votre choix.  (' + os.platform() + ' / ' + os.arch() + ')' + C.reset);

// ---- Étape 1/4 : Téléchargement (sautée si déjà en place) ----
function downloadZip() {
  return new Promise((resolve, reject) => {
    if (existsSync(ZIP_PATH)) { info('Zip déjà présent — téléchargement ignoré.'); resolve(); return; }
    httpsGet(ZIP_URL, (res) => {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0, lastPct = -1;
      const out = createWriteStream(ZIP_PATH);
      res.on('data', (chunk) => {
        received += chunk.length;
        if (total) {
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastPct) { lastPct = pct; process.stdout.write('\r  ⬇  Téléchargement… ' + pct + '%  '); }
        }
      });
      res.pipe(out);
      out.on('finish', () => { out.close(); resolve(); });
      out.on('error', reject);
    }).on('error', reject);
  });
}

if (!alreadyExtracted) {
  step(1, 'Téléchargement de SuperPrint');
  info('Source : ' + ZIP_URL);
  await downloadZip();
  process.stdout.write('\r' + ' '.repeat(50) + '\r');
  ok('Téléchargement terminé (' + Math.round(statSync(ZIP_PATH).size / 1048576) + ' Mo).');

  step(2, 'Décompression du paquet');
  info('Création du dossier : ' + TARGET_DIR);
  if (!existsSync(TARGET_DIR)) mkdirSync(TARGET_DIR, { recursive: true });
  // 🛡️ v1.7.293 : chaîne de fallbacks robuste (Expand-Archive peut échouer
  // selon la config PowerShell → pwsh → tar.exe de Windows 10+ qui gère les zips).
  const unzipAttempts = isWin
    ? [
        ['powershell', ['-NoProfile', '-Command', 'Expand-Archive -Path "' + ZIP_PATH + '" -DestinationPath "' + TARGET_DIR + '" -Force']],
        ['pwsh', ['-NoProfile', '-Command', 'Expand-Archive -Path "' + ZIP_PATH + '" -DestinationPath "' + TARGET_DIR + '" -Force']],
        ['tar', ['-xf', ZIP_PATH, '-C', TARGET_DIR]]
      ]
    : [
        ['unzip', ['-o', ZIP_PATH, '-d', TARGET_DIR]],
        ['tar', ['-xf', ZIP_PATH, '-C', TARGET_DIR]],
        ['python3', ['-c', 'import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', ZIP_PATH, TARGET_DIR]]
      ];
  let extracted = false;
  for (const [cmd, args] of unzipAttempts) {
    const u = spawnSync(cmd, args, { stdio: 'inherit' });
    if (u.status === 0 && existsSync(path.join(TARGET_DIR, 'package.json'))) { extracted = true; break; }
  }
  if (!extracted) { fail('Échec de la décompression du zip.'); process.exit(1); }
  ok('Paquet décompressé.');
  info('Le dossier ' + TARGET_DIR + ' contient le projet prêt à lancer.');
} else {
  info('Projet déjà en place (' + TARGET_DIR + ') — étapes 1 et 2 ignorées.');
  ok('Paquet déjà décompressé.');
}

// ---- Étape 3/4 : Installation des dépendances ----
step(3, 'Installation des dépendances (npm install)');
info('Première installation : quelques minutes. Les suivantes seront instantanées.');
const npmBin = isWin ? 'npm.cmd' : 'npm';
const install = spawnSync(npmBin, ['install'], { cwd: TARGET_DIR, stdio: 'inherit', shell: isWin });
if (install.status !== 0) { fail('Échec de npm install.'); process.exit(1); }
ok('Dépendances installées.');

// ---- Étape 4/4 : Lancement ----
step(4, 'Lancement du serveur local');
info('Démarrage de Vite… (appuyez sur Ctrl+C pour arrêter)');
const dev = spawnSync(npmBin, ['run', 'dev'], { cwd: TARGET_DIR, stdio: 'inherit', shell: isWin });
console.log('');
console.log(C.yellow + '  Serveur arrêté.' + C.reset);
console.log(C.dim + '  Pour relancer : cd ' + TARGET_DIR + ' puis npm run dev' + C.reset);
process.exit(dev.status || 0);
