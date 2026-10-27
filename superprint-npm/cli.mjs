#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  SuperPrint — npm launcher
//  A single command: npx superprint
//  Downloads the app (once), installs deps, launches Vite.
//  Works identically on Windows, macOS and Linux.
// ═══════════════════════════════════════════════════════════════
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { get as httpsGet } from 'node:https';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === 'win32';

// ── URLs & chemins ────────────────────────────────────────────
const APP_VERSION_URL = 'https://superprint.cc/version.txt';
const APP_ZIP_URL = 'https://app.zigmoon.com/sp213-local.zip';
// ⚠️ MIN_APP_VERSION est un PLANCHER, pas la version courante : l'installation
//    ÉCHOUE si le zip servi par APP_ZIP_URL est plus ANCIEN que ce plancher
//    (ou que version.txt en ligne). Ne l'avancer donc qu'APRÈS avoir téléversé
//    le zip ET le site, sinon `npx superprint` s'arrête sur « downloaded
//    version is invalid or older than the online version ».
//    La version du paquet npm, elle, vit dans package.json.
// 📌 Dernier plancher avancé : 1.7.696 — et c'est bien la version DÉPLOYÉE,
//    vérifiée DANS l'archive téléchargée, pas celle du dépôt.
//    ⚠️ RÈGLE APPRISE À LA DURE, ET QUI A DÉJÀ SERVI : on ne conclut pas une
//    version sur une empreinte. Le 15/10/2026, « zip 1.7.617 en ligne » était
//    exact — pour le zip de la version PRÉCÉDENTE : le fichier déployé avait été
//    retéléchargé et HACHÉ, jamais OUVERT. LEÇON : on lit la version DANS l'archive.
//    ⚠️ ET LA RÈGLE COMPLÉMENTAIRE, APPRISE LE 19/10/2026 : le script de bump
//    remplace le numéro de version partout, y compris DANS CE COMMENTAIRE. Il avait
//    donc réécrit ce bloc en affirmant « version.txt = 1.7.683 — À JOUR » et « avancer
//    le plancher est sûr », alors que RIEN n'était téléversé. Un plancher en avance
//    ne se voit pas à la lecture : il casse `npx superprint` pour tout le monde
//    (« downloaded version is invalid or older »). D'où la règle : après un bump,
//    RELIRE ce bloc et le remettre sur les mesures réelles. C'est pourquoi ce texte
//    a été réécrit À LA MAIN le 25/10/2026, mesures en main.
//    ÉTAT MESURÉ le 26/10/2026 à 23 h 20, APRÈS le dépôt, ET LE PLANCHER SUIT :
//      · superprint.cc/version.txt ........................ = 1.7.696
//      · app.zigmoon.com/sp213-local.zip .................. HTTP 200, 56 872 090
//        octets, Last-Modified « Mon, 26 Oct 2026 22:14:17 GMT », sha256
//        cfb8a431…0311e1 — IDENTIQUE au zip construit ici. L'archive a été
//        OUVERTE, pas seulement hachée : public/superprint/version.txt y vaut
//        1.7.696, et app/JS/main.js y pèse 6 477 468 octets avec ZÉRO CR.
//      · superprint.cc/app/index.html = 1.7.696 : badge data-sp-sw = v1.7.696,
//        data-sp-js = v696, JS/main.js?v=20261026-v696-artefacts-alignes
//        (le CSS porte la même empreinte).
//      · superprint.cc/app/service-worker.js : CACHE_NAME =
//        superprint-shell-v1.7.696-artefacts-alignes.
//      · superprint.cc/app/JS/main.js : sha256 4ed27359…a522fdb8, IDENTIQUE au
//        dépôt, zéro CR — c'est la preuve binaire que l'écart d'un octet de la
//        1.7.695 est bel et bien clos.
//      · pages racine (index, price, faq, documentation, install, api) et
//        app/documentation.html : toutes en 1.7.696.
//      · release desktop-latest : « SuperPrint 1.7.696 », 21 fichiers remplacés
//        le 26/10 à 21 h 02, compilation partie de 5d293542 — contrôlés un par
//        un (SHA-256 contre SHA256SUMS, PE/ar/koly, Info.plist 1.7.696, .deb
//        1.7.696 avec libwebkit2gtk-4.1-0). Archive figée : desktop-v1.7.696,
//        22 fichiers dont SHA256SUMS.
//      · npm superprint@1.0.120 avait un plancher de 1.7.695 : en retard d'une
//        version depuis ce téléversement.
//    → le plancher passe donc à 1.7.696 DANS CE MÊME GESTE, maintenant que le zip
//      ET le site sont en ligne. Un plancher égal à la version déployée est l'état
//      visé : il refuse un zip plus ancien servi par erreur, sans jamais bloquer
//      une version plus récente.
//    ⚠️ RESTE EN RETARD, ET CE N'EST PAS LE PLANCHER : release.html sur
//      app.zigmoon.com s'arrête à la 1.7.694 (329 blocs ; le dépôt en porte 332,
//      avec 1.7.695, 1.7.696 et 1.7.697). C'est un fichier à déposer SÉPARÉMENT :
//      il ne suit pas le dossier superprint/. Les notes de version sont en retard
//      sur les fichiers, pas l'inverse.
//    ⚠️ CE QUE FAIT RÉELLEMENT LE PLANCHER, dit exactement : `onlineVersion` est le
//      MAXIMUM entre `version.txt` et cette constante. C'est donc `version.txt` qui
//      déclenche les mises à jour, et le plancher qui REFUSE un zip trop ancien —
//      utile précisément quand `version.txt` est en retard ou absent, ce qui s'est
//      déjà produit (il était resté à 1.7.619 un jour de dépôt).
//    ⚠️ POURQUOI LE PLANCHER DOIT SUIVRE CHAQUE LIVRAISON : un zip ancien servi par
//      erreur serait ACCEPTÉ, et `npx superprint` installerait une version sans les
//      correctifs du jour. Une garde ne sert que si elle est à jour.
const MIN_APP_VERSION = '1.7.696';
const APP_DIR = path.join(os.homedir(), '.superprint', 'app');
const ZIP_PATH = path.join(os.homedir(), '.superprint', 'sp213-local.zip');
const VERSION_FILE = path.join(APP_DIR, 'version.txt');

// ── Couleurs ANSI ─────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', white: '\x1b[37m',
  bgDark: '\x1b[40m', bgGreen: '\x1b[42m', bgRed: '\x1b[41m'
};

const BANNER = String.raw`
███████╗██╗   ██╗██████╗ ███████╗██████╗ ██████╗ ██████╗ ██╗███╗   ██╗████████╗
██╔════╝██║   ██║██╔══██╗██╔════╝██╔══██╗██╔══██╗██╔══██╗██║████╗  ██║╚══██╔══╝
███████╗██║   ██║██████╔╝█████╗  ██████╔╝██████╔╝██████╔╝██║██╔██╗ ██║   ██║
╚════██║██║   ██║██╔═══╝ ██╔══╝  ██╔══██╗██╔═══╝ ██╔══██╗██║██║╚██╗██║   ██║
███████║╚██████╔╝██║     ███████╗██║  ██║██║     ██║  ██║██║██║ ╚████║   ██║
╚══════╝ ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═══╝
`;

const SEP = '\n' + C.dim + '─'.repeat(60) + C.reset + '\n';

function title(text) {
  console.log(C.green + '  ' + '='.repeat(56) + C.reset);
  console.log(C.green + C.bold + '  ' + text + C.reset);
  console.log(C.green + '  ' + '='.repeat(56) + C.reset);
}
function step(n, label) {
  console.log('');
  console.log(C.bold + C.blue + '  [' + n + '/4]  ' + label + C.reset);
  console.log(C.dim + '  ' + '─'.repeat(50) + C.reset);
}
function ok(m) { console.log(C.green + '  ✔  ' + m + C.reset); }
function info(m) { console.log(C.dim + '  ·  ' + m + C.reset); }
function warn(m) { console.log(C.yellow + '  ⚠  ' + m + C.reset); }
function fail(m) {
  console.log('');
  console.log(C.bgRed + C.white + '  ERROR  ' + C.reset);
  console.log(C.red + '  ' + m + C.reset);
  console.log(C.dim + '  Download manually: https://app.zigmoon.com/sp213-local.zip' + C.reset);
}

// ── Network helpers ───────────────────────────────────────────
function httpsGetText(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, (res) => {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); res.resume(); return; }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data.trim()));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(new Error('Timeout')); });
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    mkdirSync(path.dirname(dest), { recursive: true });
    const req = httpsGet(url, (res) => {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); res.resume(); return; }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0, lastPct = -1;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (total) {
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastPct) { lastPct = pct; process.stdout.write('\r  ⬇  Downloading… ' + pct + '%   '); }
        }
      });
      const out = createWriteStream(dest);
      pipeline(res, out).then(() => {
        process.stdout.write('\r' + ' '.repeat(50) + '\r');
        resolve();
      }).catch(reject);
    });
    req.on('error', reject);
    req.setTimeout(0); // pas de timeout sur un gros fichier
  });
}

// ── Extraction ────────────────────────────────────────────────
function unzip(zipPath, destDir) {
  if (isWin) {
    // 🛡️ v1.7.293 : chaîne de fallbacks robuste. Expand-Archive peut échouer
    // ("CouldNotAutoloadMatchingModule") selon la config PowerShell. On essaie
    // ensuite PowerShell 7 (pwsh), puis tar.exe de Windows 10+ (BSDTar gère
    // les zips — c'est le même outil qui fabrique le zip). mkdir d'abord car
    // tar ne crée pas le répertoire de sortie.
    try { mkdirSync(destDir, { recursive: true }); } catch (_) {}
    const attempts = [
      ['powershell', ['-NoProfile', '-Command', 'Expand-Archive -Path "' + zipPath + '" -DestinationPath "' + destDir + '" -Force']],
      ['pwsh', ['-NoProfile', '-Command', 'Expand-Archive -Path "' + zipPath + '" -DestinationPath "' + destDir + '" -Force']],
      ['tar', ['-xf', zipPath, '-C', destDir]]
    ];
    for (const [cmd, args] of attempts) {
      const r = spawnSync(cmd, args, { stdio: 'inherit' });
      if (r.status === 0 && existsSync(path.join(destDir, 'package.json'))) return true;
    }
    return false;
  }
  // macOS / Linux : unzip, sinon tar, sinon python3
  const attempts = [
    ['unzip', ['-oq', zipPath, '-d', destDir]],
    ['tar', ['-xf', zipPath, '-C', destDir]],
    ['python3', ['-c', 'import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zipPath, destDir]]
  ];
  for (const [cmd, args] of attempts) {
    const r = spawnSync(cmd, args, { stdio: 'inherit' });
    if (r.status === 0 && existsSync(path.join(destDir, 'package.json'))) return true;
  }
  return false;
}

// ── Existing install check ────────────────────────────────────
function isInstalled() {
  return existsSync(path.join(APP_DIR, 'package.json'));
}
function installedVersion() {
  try { return JSON.parse(readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')).version || null; } catch {}
  try { return readFileSync(VERSION_FILE, 'utf8').trim(); } catch { return null; }
}
function compareVersions(first, second) {
  const parts = version => String(version || '').split('.').map(value => parseInt(value, 10) || 0);
  const a = parts(first);
  const b = parts(second);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if ((a[index] || 0) > (b[index] || 0)) return 1;
    if ((a[index] || 0) < (b[index] || 0)) return -1;
  }
  return 0;
}
function newestVersion(first, second) {
  return compareVersions(first, second) >= 0 ? (first || second) : second;
}
function extractedVersion() {
  try {
    return JSON.parse(readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')).version || null;
  } catch {
    return null;
  }
}
function dependenciesReady() {
  return [
    path.join(APP_DIR, 'node_modules', 'vite', 'bin', 'vite.js'),
    path.join(APP_DIR, 'node_modules', '@mlc-ai', 'web-llm', 'package.json'),
    path.join(APP_DIR, 'node_modules', '@e965', 'xlsx', 'package.json')
  ].every(existsSync);
}
// 🛡️ v1.0.102 : une installation ABÎMÉE (dossier vidé, extraction interrompue,
// vieux paquet sans le studio local) ne doit jamais être considérée comme bonne :
// sinon `npx superprint` sert un lanceur auquel il manque des pages — c'est le
// symptôme « je ne peux pas ouvrir le Studio IA en local ».
// ⚠️ Les 7 pages du lanceur : s'il en manque UNE, on retélécharge tout.
function installationComplete() {
  return [
    path.join(APP_DIR, 'index.html'),
    path.join(APP_DIR, 'vite.config.js'),
    path.join(APP_DIR, 'public', 'superprint', 'version.txt'),
    path.join(APP_DIR, 'public', 'superprint', 'app', 'index.html'),
    path.join(APP_DIR, 'public', 'superprint', 'sp213-studio.html'),
    path.join(APP_DIR, 'public', 'superprint', 'supertypo', 'index.html'),
    path.join(APP_DIR, 'public', 'superprint', 'documentation.html'),
    path.join(APP_DIR, 'public', 'superprint', 'api.html')
  ].every(existsSync);
}
function runNpmInstall() {
  return spawnSync(isWin ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], {
    stdio: 'inherit', cwd: APP_DIR, shell: isWin
  });
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log(C.cyan + C.bold + BANNER + C.reset);
  console.log(C.bgDark + C.white + '  SUPERPRINT · DTP + SP213 Studio · by 2.13' + C.reset);
  console.log(C.dim + '  Local-first. Cloud AI is used only when you select it.' + C.reset);

  // ---- Step 1/4: check online version ----
  step(1, 'Checking online version');
  let onlineVersion = MIN_APP_VERSION;
  try { onlineVersion = newestVersion(await httpsGetText(APP_VERSION_URL), MIN_APP_VERSION); } catch (e) {}
  const localVer = installedVersion();

  if (isInstalled()) {
    if (!installationComplete()) {
      warn('The local installation is incomplete (pages missing) — reinstalling.');
    }
    if (!localVer || compareVersions(localVer, onlineVersion) < 0 || !installationComplete()) {
      info('Online version (' + onlineVersion + ') is newer than local (' + (localVer || '?') + ') — updating.');
      // Remove the old app to re-download the new one
      const { rmSync } = await import('node:fs');
      rmSync(APP_DIR, { recursive: true, force: true });
    } else {
      info('Already installed (v' + (localVer || '?') + ') — skipping download.');
    }
    ok('SuperPrint is ready.');
  } else {
    info('First install — downloading the application.');
    ok(onlineVersion ? 'Latest online version: v' + onlineVersion : 'Online version: superprint.cc');
  }

  // ---- Step 2/4: download + extract ----
  if (!isInstalled()) {
    step(2, 'Downloading the application');
    info('Source: ' + APP_ZIP_URL);
    try {
      await downloadFile(APP_ZIP_URL, ZIP_PATH);
      ok('Downloaded (' + Math.round(statSync(ZIP_PATH).size / 1048576) + ' MB).');
    } catch (e) {
      fail('Download failed: ' + e.message);
      process.exit(1);
    }

    step(3, 'Extracting');
    info('Into: ' + APP_DIR);
    mkdirSync(APP_DIR, { recursive: true });
    if (!unzip(ZIP_PATH, APP_DIR)) {
      fail('Failed to extract the zip.');
      process.exit(1);
    }
    const downloadedVersion = extractedVersion();
    if (!downloadedVersion || compareVersions(downloadedVersion, onlineVersion) < 0) {
      rmSync(APP_DIR, { recursive: true, force: true });
      fail('Downloaded application version is invalid or older than the online version.');
      process.exit(1);
    }
    ok('Application extracted.');
    try { writeFileSync(VERSION_FILE, downloadedVersion); } catch {}
    // Clean up the zip (save space)
    try { unlinkSync(ZIP_PATH); } catch {}
  }

  // ---- Step 4/4: npm install if needed ----
  if (!dependenciesReady()) {
    step(4, 'Installing dependencies (npm install)');
    info('First install: a few minutes. Subsequent launches will be instant.');
    // shell:true needed on Windows to launch npm (the .cmd wrappers
    // fail with EINVAL via spawnSync without shell).
    let install = runNpmInstall();
    if (install.status !== 0) {
      warn('The dependency folder is incomplete. Cleaning it and retrying once.');
      try { rmSync(path.join(APP_DIR, 'node_modules'), { recursive: true, force: true }); } catch (_) {}
      install = runNpmInstall();
    }
    if (install.status !== 0 || !dependenciesReady()) { fail('npm install failed.'); process.exit(1); }
    // npm 12+ blocks install scripts (e.g. esbuild needs its postinstall
    // to place its native binary). We approve all: this is our own
    // trusted application.
    const appr = spawnSync(isWin ? 'npm.cmd' : 'npm', ['install-scripts', 'approve', '--all'], {
      stdio: 'inherit', cwd: APP_DIR, shell: isWin
    });
    if (appr.status !== 0) {
      // Command missing (npm < 12): not an issue, scripts run by default.
      warn('Install-scripts approval not available — ignored.');
    }
    ok('Dependencies installed.');
  } else {
    info('Dependencies already installed.');
    ok('Everything is ready.');
  }

  // ---- Launch Vite ----
  const viteBin = path.join(APP_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  // v1.0.102 : plus de port calculé ici — c'est Vite qui décide (il bascule de port
  // si 5173 est occupé) et on relaie SON adresse (voir plus bas).
  const userArgs = process.argv.slice(2);
  const hasExplicitHost = userArgs.some(arg => arg === '--host' || arg.startsWith('--host='));
  const args = hasExplicitHost ? userArgs : ['--host', '127.0.0.1', ...userArgs];

  console.log(SEP);
  console.log(C.green + C.bold + '  Starting SuperPrint…' + C.reset);
  console.log(C.dim + '  The address is displayed below as soon as the server is ready.' + C.reset);
  console.log(C.dim + '  (the port changes automatically if 5173 is already taken)' + C.reset);
  console.log(SEP);

  // 🛡️ v1.0.102 : on ne DEVINE plus l'adresse. Avant, le message annonçait 5173 en dur
  // (la valeur par défaut) alors que Vite bascule sur 5174/5175 si 5173 est occupé :
  // l'utilisateur atterrissait sur une AUTRE application et croyait que SuperPrint
  // ne s'ouvrait pas (« je ne peux pas ouvrir le studio en local »).
  // Ici on SONDE les ports, en écartant d'abord ceux qui répondent DÉJÀ (un autre
  // outil, un ancien serveur, une autre copie de SuperPrint) : seuls les ports
  // ouverts APRÈS notre démarrage sont candidats.
  const portDemande = (() => {
    const enLigne = userArgs.find((arg) => arg.startsWith('--port='));
    if (enLigne) return enLigne.slice('--port='.length);
    const index = userArgs.indexOf('--port');
    return index >= 0 ? userArgs[index + 1] : null;
  })();
  const ports = [];
  if (portDemande) ports.push(String(portDemande));
  for (let p = 5173; p <= 5185; p++) if (!ports.includes(String(p))) ports.push(String(p));

  const dejaOuverts = new Set();
  for (const port of ports) {
    try {
      const reponse = await fetch('http://127.0.0.1:' + port + '/', { redirect: 'manual', signal: AbortSignal.timeout(800) });
      await reponse.text();
      dejaOuverts.add(port);
    } catch (_) { /* personne sur ce port : c'est un candidat */ }
  }
  if (dejaOuverts.size) {
    info('Port(s) already busy (ignored): ' + [...dejaOuverts].join(', '));
  }

  const child = spawn(process.execPath, [viteBin, ...args], {
    stdio: 'inherit', cwd: APP_DIR
  });

  (async () => {
    for (let essai = 0; essai < 80; essai++) {
      for (const port of ports) {
        if (dejaOuverts.has(port)) continue;
        let texte = '';
        try {
          const reponse = await fetch('http://127.0.0.1:' + port + '/', { redirect: 'manual', signal: AbortSignal.timeout(1500) });
          if (!reponse.ok) continue;
          texte = await reponse.text();
        } catch (_) { continue; }
        if (texte.indexOf('SuperPrint') < 0) continue; // un autre outil a pris ce port
        console.log('');
        console.log(C.green + C.bold + '  ✔  SuperPrint runs at: http://127.0.0.1:' + port + '/' + C.reset);
        console.log(C.dim + '     Open that exact address, then pick Editor, Studio IA, SuperTyPo,' + C.reset);
        console.log(C.dim + '     Documentation or API on the page.' + C.reset);
        return;
      }
      await new Promise((suite) => setTimeout(suite, 250));
    }
  })();

  child.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.log(C.yellow + '\n  The server stopped (code ' + code + ').' + C.reset);
    }
  });
}

main().catch((e) => {
  console.error(C.red + '  Error: ' + (e && e.message ? e.message : e) + C.reset);
  process.exit(1);
});
