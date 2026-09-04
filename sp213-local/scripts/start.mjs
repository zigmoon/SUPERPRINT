#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  SP213 Local — launcher : affiche la bannière SUPERPRINT
//  puis lance le serveur Vite.
//  Utilisé par : npm run dev
// ═══════════════════════════════════════════════════════════════
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ── Bannière ASCII SUPERPRINT (police figlet "ANSI Shadow") ──
const BANNER = String.raw`
███████╗██╗   ██╗██████╗ ███████╗██████╗ ██████╗ ██████╗ ██╗███╗   ██╗████████╗
██╔════╝██║   ██║██╔══██╗██╔════╝██╔══██╗██╔══██╗██╔══██╗██║████╗  ██║╚══██╔══╝
███████╗██║   ██║██████╔╝█████╗  ██████╔╝██████╔╝██████╔╝██║██╔██╗ ██║   ██║
╚════██║██║   ██║██╔═══╝ ██╔══╝  ██╔══██╗██╔═══╝ ██╔══██╗██║██║╚██╗██║   ██║
███████║╚██████╔╝██║     ███████╗██║  ██║██║     ██║  ██║██║██║ ╚████║   ██║
╚══════╝ ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝   ╚═╝
`;

// ── Couleurs ANSI ─────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  bgDark: '\x1b[40m'
};

const SEP = '\n' + C.dim + '─'.repeat(60) + C.reset + '\n';

function printBanner() {
  console.log(SEP);
  console.log(C.bgDark + C.cyan + C.bold + BANNER + C.reset);
  console.log(SEP);
  console.log(C.green + C.bold + '  SUPERPRINT · PAO + Studio SP213 · local-first' + C.reset);
  console.log(C.dim + '  IA cloud utilisée uniquement si vous la sélectionnez.' + C.reset);
  console.log(SEP);
}

// ── Lancer Vite ───────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viteBin = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');
const userArgs = process.argv.slice(2); // passer les arguments (--host, --port, etc.)
const hasExplicitHost = userArgs.some(arg => arg === '--host' || arg.startsWith('--host='));
const args = hasExplicitHost ? userArgs : ['--host', '127.0.0.1', ...userArgs];

printBanner();

const child = spawn(process.execPath, [viteBin, ...args], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..')
});

child.on('close', (code) => {
  if (code !== 0 && code !== null) {
    console.log(C.yellow + '\n  Le serveur s\'est arrêté (code ' + code + ').' + C.reset);
  }
});
