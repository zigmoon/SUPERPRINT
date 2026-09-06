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
const MIN_APP_VERSION = '1.7.335';
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
    if (!localVer || compareVersions(localVer, onlineVersion) < 0) {
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
  const userArgs = process.argv.slice(2);
  const hasExplicitHost = userArgs.some(arg => arg === '--host' || arg.startsWith('--host='));
  const portArgIndex = userArgs.findIndex(arg => arg === '--port');
  const inlinePort = userArgs.find(arg => arg.startsWith('--port='));
  const displayPort = inlinePort ? inlinePort.slice('--port='.length) : (portArgIndex >= 0 ? userArgs[portArgIndex + 1] : '5173');
  const args = hasExplicitHost ? userArgs : ['--host', '127.0.0.1', ...userArgs];

  console.log(SEP);
  console.log(C.green + C.bold + '  Starting SuperPrint…' + C.reset);
  console.log(C.dim + '  Open your browser at: http://127.0.0.1:' + displayPort + C.reset);
  console.log(SEP);
  const child = spawn(process.execPath, [viteBin, ...args], {
    stdio: 'inherit', cwd: APP_DIR
  });
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
