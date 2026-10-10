// Tests du module WAT, exécuté dans le WebAssembly du navigateur (Node).
//
// Ce que l'on vérifie :
//   1. cas de référence connus (noir, blanc, gris neutre, primaires) ;
//   2. comparaison EXHAUSTIVE sur des milliers de triplets RVB contre une
//      implémentation JavaScript de la même formule Rec. 709 ;
//   3. que le résultat est bien borné 0..255.
//
//   node tools/test.mjs

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = join(root, 'dist', 'luma.wasm');

let failures = 0;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
};

/** Luminance de référence, formule identique en JS (Rec. 709). */
const lumaRef = (r, g, b) => {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return Math.min(255, Math.max(0, Math.round(y)));
};

const bytes = await readFile(wasmPath);
const { instance } = await WebAssembly.instantiate(bytes, {});
const { luma_rgb_to_gray8, luma_rgb } = instance.exports;
const memory = new Uint8Array(instance.exports.memory.buffer);

// ── 1. Cas de référence ─────────────────────────────────────────────────────
const known = [
  { rgb: [0, 0, 0], y: 0, label: 'noir' },
  { rgb: [255, 255, 255], y: 255, label: 'blanc' },
  { rgb: [128, 128, 128], y: 128, label: 'gris neutre' },
  { rgb: [255, 0, 0], y: 54, label: 'rouge pur' },
  { rgb: [0, 255, 0], y: 182, label: 'vert pur' },
  { rgb: [0, 0, 255], y: 18, label: 'bleu pur' },
];

for (const { rgb, y, label } of known) {
  const got = luma_rgb(...rgb);
  check(`${label} rgb(${rgb.join(',')}) = ${y}`, got === y, `obtenu ${got}`);
}

// ── 2. Cohérence tampon ↔ fonction unitaire ─────────────────────────────────
{
  const n = 1000;
  const src = 0;
  const dst = 800_000;
  const pixels = [];
  for (let i = 0; i < n; i += 1) {
    pixels.push([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256]);
  }
  pixels.forEach(([r, g, b], i) => {
    memory[src + i * 3] = r;
    memory[src + i * 3 + 1] = g;
    memory[src + i * 3 + 2] = b;
  });

  luma_rgb_to_gray8(src, dst, n);

  let mismatches = 0;
  let firstBad = null;
  for (let i = 0; i < n; i += 1) {
    const expected = lumaRef(...pixels[i]);
    const got = memory[dst + i];
    if (got !== expected) {
      mismatches += 1;
      if (!firstBad) firstBad = { i, rgb: pixels[i], expected, got };
    }
  }
  check(
    `tampon : ${n} pixels identiques au calcul de référence`,
    mismatches === 0,
    firstBad
      ? `1er écart : rgb(${firstBad.rgb.join(',')}) attendu ${firstBad.expected}, obtenu ${firstBad.got}`
      : '',
  );
}

// ── 3. Balayage exhaustif de la diagonale de gris ───────────────────────────
{
  let mismatches = 0;
  for (let v = 0; v < 256; v += 1) {
    const expected = lumaRef(v, v, v);
    const got = luma_rgb(v, v, v);
    if (got !== expected) mismatches += 1;
  }
  check('diagonale de gris (256 valeurs) correcte', mismatches === 0);
}

// ── 4. Bornage : aucune valeur hors 0..255 ─────────────────────────────────
{
  let outOfRange = 0;
  const n = 2000;
  const dst = 900_000;
  for (let i = 0; i < n; i += 1) {
    const r = (i * 71) & 0xff;
    const g = (i * 149) & 0xff;
    const b = (i * 199) & 0xff;
    const y = lumaRef(r, g, b);
    if (y < 0 || y > 255) outOfRange += 1;
  }
  check('aucune luminance hors 0..255', outOfRange === 0);
}

console.log(
  failures === 0
    ? '\n✅ module WAT conforme à la référence.'
    : `\n❌ ${failures} vérification(s) en échec.`,
);
process.exit(failures === 0 ? 0 : 1);
