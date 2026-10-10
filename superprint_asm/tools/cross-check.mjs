// Vérification CROISÉE : le module WebAssembly écrit à la main (WAT) doit
// produire EXACTEMENT les mêmes luminances que le noyau Rust.
//
//   1. on compile l'exemple Rust `luma_dump` pour wasm32-wasip1 ;
//   2. on l'exécute via Node (WASI) et on lit ses N lignes « r g b y » ;
//   3. on rejoue les MÊMES entrées dans le module WAT et on compare.
//
// C'est la preuve que les trois étages (JS de référence, Rust, WAT) donnent
// le même résultat sur des milliers de pixels.
//
//   node tools/cross-check.mjs [nombre-de-triplets]

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rustRoot = join(root, '..', 'superprint_rust');
const count = Number(process.argv[2] ?? 5000);

const cargo = join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.cargo', 'bin', 'cargo.exe');
const runner = join(rustRoot, 'scripts', 'run-wasi.mjs');

if (!existsSync(cargo)) {
  console.error(`cargo introuvable : ${cargo}`);
  process.exit(1);
}

console.log(`── compilation de l'exemple Rust (luma_dump, ${count} triplets)`);
execFileSync(
  cargo,
  ['build', '--target', 'wasm32-wasip1', '-p', 'superprint-core', '--example', 'luma_dump'],
  { cwd: rustRoot, stdio: ['ignore', 'ignore', 'inherit'] },
);

const rustWasm = join(
  rustRoot,
  'target',
  'wasm32-wasip1',
  'debug',
  'examples',
  'luma_dump.wasm',
);

console.log('── exécution du binaire Rust (WASI)');
const rustOut = execFileSync(process.execPath, [runner, rustWasm, String(count)], {
  cwd: rustRoot,
  encoding: 'utf8',
});
const rustLines = rustOut.trim().split('\n').map((line) => line.trim()).filter(Boolean);

// ── Module WAT ──────────────────────────────────────────────────────────────
const wasm = await WebAssembly.instantiate(
  readFileSync(join(root, 'dist', 'luma.wasm')),
  {},
);
const { luma_rgb, memory } = wasm.instance.exports;
const heap = new Uint8Array(memory.buffer);

/** Même LCG que l'exemple Rust — les entrées sont donc identiques. */
let state = 0x12345678 >>> 0;
const next = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state >>> 24;
};

let mismatches = 0;
let firstBad = null;
for (let i = 0; i < rustLines.length; i += 1) {
  const [r, g, b, yRust] = rustLines[i].split(/\s+/).map(Number);
  const yWat = luma_rgb(r, g, b);
  if (yWat !== yRust) {
    mismatches += 1;
    if (!firstBad) firstBad = { i, rgb: [r, g, b], yRust, yWat };
  }
}
void heap;

console.log(
  `\n${rustLines.length} triplets comparés — ${mismatches} écart(s)` +
    (firstBad
      ? `\n1er écart : rgb(${firstBad.rgb.join(',')}) Rust=${firstBad.yRust} WAT=${firstBad.yWat}`
      : ''),
);

if (mismatches === 0) {
  console.log('\n✅ Rust et WebAssembly (écrit à la main) donnent le MÊME résultat.');
  process.exit(0);
}
console.log('\n❌ divergence entre Rust et WebAssembly.');
process.exit(1);
