// Exécute un binaire wasm32-wasip1 du workspace avec Node (WASI) — sans linker
// natif. Sert à VALIDER réellement les modules (produire un PDF, le relire) sur
// une machine où `cargo test` ne peut pas se lier (Visual Studio absent).
//
// Usage : node scripts/run-wasi.mjs <chemin-du-.wasm> [args...]
//
// Exemple :
//   node scripts/run-wasi.mjs \
//     crates/superprint-pdf/target/wasm32-wasip1/debug/examples/spot_page.wasm out.pdf

import { readFile, readdir } from 'node:fs/promises';
import { WASI } from 'node:wasi';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const [wasmPath, ...args] = process.argv.slice(2);
if (!wasmPath) {
  console.error('usage: node scripts/run-wasi.mjs <fichier.wasm> [args...]');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
// On expose le dossier courant au module WASI, pour qu'il puisse écrire ses sorties.
const preopen = process.cwd();

const wasi = new WASI({
  version: 'preview1',
  args: [wasmPath, ...args],
  env: {},
  preopens: { '.': preopen, '/': preopen },
});

const wasm = await WebAssembly.compile(await readFile(wasmPath));
const instance = await WebAssembly.instantiate(wasm, wasi.getImportObject());
const code = wasi.start(instance);

// Liste le dossier racine du workspace pour montrer ce que le module a écrit.
void here;
void readdir;
process.exit(code);
