// Vérification CROISÉE : les modules WebAssembly écrits à la main (WAT) doivent
// produire EXACTEMENT le même résultat que le noyau Rust.
//
//   • luminance  : Rust `color::Rgb::luma`  ↔  `luma.wat`
//   • CMJN ↔ RVB : Rust `color8`            ↔  `color8.wat`
//
// Méthode, pour chaque noyau :
//   1. compiler l'exemple Rust correspondant pour wasm32-wasip1 ;
//   2. l'exécuter via Node (WASI) et lire ses lignes de résultats ;
//   3. rejouer les MÊMES entrées dans le module WAT et comparer.
//
//   node tools/cross-check.mjs [nombre-de-pixels]

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rustRoot = join(root, '..', 'superprint_rust');
const count = Number(process.argv[2] ?? 5000);

const cargo = join(
  process.env.USERPROFILE ?? process.env.HOME ?? '',
  '.cargo',
  'bin',
  'cargo.exe',
);
const runner = join(rustRoot, 'scripts', 'run-wasi.mjs');

if (!existsSync(cargo)) {
  console.error(`cargo introuvable : ${cargo}`);
  process.exit(1);
}

/** Compile un exemple Rust et renvoie ses lignes de sortie (exécuté via WASI). */
function runRustExample(example, args) {
  console.log(`-- compilation de l'exemple Rust (${example})`);
  execFileSync(
    cargo,
    ['build', '--target', 'wasm32-wasip1', '-p', 'superprint-core', '--example', example],
    { cwd: rustRoot, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  const wasm = join(rustRoot, 'target', 'wasm32-wasip1', 'debug', 'examples', `${example}.wasm`);
  const out = execFileSync(process.execPath, [runner, wasm, ...args], {
    cwd: rustRoot,
    encoding: 'utf8',
  });
  return out.trim().split('\n').map((line) => line.trim()).filter(Boolean);
}

/** Charge un module wasm de `dist/` et renvoie ses exports + une vue mémoire. */
async function loadModule(name) {
  const bytes = readFileSync(join(root, 'dist', name));
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return {
    exports: instance.exports,
    heap: () => new Uint8Array(instance.exports.memory.buffer),
  };
}

let failed = false;

function report(total, mismatches, firstBad, describe) {
  console.log(`${total} pixels comparés — ${mismatches} écart(s)`);
  if (firstBad) {
    console.log(`1er écart : ${describe(firstBad)}`);
    failed = true;
  }
}

async function checkLuma() {
  console.log('\n== luminance (RVB -> gris, Rec. 709)');
  const lines = runRustExample('luma_dump', [String(count)]);
  const { exports } = await loadModule('luma.wasm');

  let mismatches = 0;
  let firstBad = null;
  for (const line of lines) {
    const [r, g, b, yRust] = line.split(/\s+/).map(Number);
    const yWat = exports.luma_rgb(r, g, b);
    if (yWat !== yRust) {
      mismatches += 1;
      if (!firstBad) firstBad = { rgb: [r, g, b], yRust, yWat };
    }
  }
  report(lines.length, mismatches, firstBad, (bad) => `rgb(${bad.rgb})`);
}

async function checkColor8() {
  console.log('\n== couleurs (RVB <-> CMJN, entiers)');
  const lines = runRustExample('color8_dump', [String(count)]);
  const { exports, heap } = await loadModule('color8.wasm');
  const mem = heap();

  const src = 0;
  const dstCmyk = 1_000_000;
  const dstRgb = 1_100_000;

  let mismatches = 0;
  let firstBad = null;
  for (const line of lines) {
    const [r, g, b, cRef, mRef, yRef, kRef, r2Ref, g2Ref, b2Ref] = line.split(/\s+/).map(Number);

    // RVB -> CMJN
    mem[src] = r;
    mem[src + 1] = g;
    mem[src + 2] = b;
    exports.rgb_to_cmyk(src, dstCmyk, 1);
    const c = mem[dstCmyk];
    const m = mem[dstCmyk + 1];
    const y = mem[dstCmyk + 2];
    const k = mem[dstCmyk + 3];

    // CMJN -> RVB
    mem[src] = c;
    mem[src + 1] = m;
    mem[src + 2] = y;
    mem[src + 3] = k;
    exports.cmyk_to_rgb(src, dstRgb, 1);
    const r2 = mem[dstRgb];
    const g2 = mem[dstRgb + 1];
    const b2 = mem[dstRgb + 2];

    const bad =
      c !== cRef ||
      m !== mRef ||
      y !== yRef ||
      k !== kRef ||
      r2 !== r2Ref ||
      g2 !== g2Ref ||
      b2 !== b2Ref;
    if (bad) {
      mismatches += 1;
      if (!firstBad) {
        firstBad = {
          rgb: [r, g, b],
          rust: [cRef, mRef, yRef, kRef, r2Ref, g2Ref, b2Ref],
          wat: [c, m, y, k, r2, g2, b2],
        };
      }
    }
  }
  report(lines.length, mismatches, firstBad, (bad) =>
    `rgb(${bad.rgb})\n     Rust : ${bad.rust.join(' ')}\n     WAT  : ${bad.wat.join(' ')}`,
  );
}

await checkLuma();
await checkColor8();

if (!failed) {
  console.log('\nRust et WebAssembly (ecrits differemment) donnent le MEME resultat.');
  process.exit(0);
}
console.log('\ndivergence entre Rust et WebAssembly.');
process.exit(1);
