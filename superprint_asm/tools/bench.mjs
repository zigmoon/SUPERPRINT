// Mesure du passage RVB → niveaux de gris sur un grand tampon :
// module WebAssembly écrit à la main (WAT) contre une boucle JavaScript pure.
//
// But : montrer POURQUOI on descend jusqu'à l'assembleur — le calcul pixel par
// pixel est plus rapide et surtout plus prévisible en WebAssembly.
//
//   node tools/bench.mjs [nombre-de-pixels]

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pixelCount = Number(process.argv[2] ?? 4_000_000);

const bytes = await readFile(join(root, 'dist', 'luma.wasm'));
const { instance } = await WebAssembly.instantiate(bytes, {});
const { luma_rgb_to_gray8, memory } = instance.exports;
const heap = new Uint8Array(memory.buffer);

const src = 0;
const dst = pixelCount * 3 + 1024; // zone de sortie après la source

if (dst + pixelCount > heap.length) {
  console.error(
    `tampon trop grand pour la mémoire du module (${heap.length} octets) : réduis le nombre de pixels.`,
  );
  process.exit(1);
}

// Remplit la source avec un motif déterministe.
for (let i = 0; i < pixelCount * 3; i += 1) {
  heap[i] = (i * 7 + (i >> 3)) & 0xff;
}

const time = (label, fn) => {
  const start = process.hrtime.bigint();
  fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  console.log(`  ${label.padEnd(28)} ${ms.toFixed(1)} ms`);
  return ms;
};

console.log(`${pixelCount.toLocaleString('fr-FR')} pixels RVB → niveaux de gris\n`);

const msWasm = time('WebAssembly (WAT à la main)', () => {
  luma_rgb_to_gray8(src, dst, pixelCount);
});

// Référence JS : même formule, boucle serrée.
const out = new Float64Array(pixelCount);
const msJs = time('JavaScript (boucle pure)', () => {
  for (let i = 0; i < pixelCount; i += 1) {
    const p = i * 3;
    out[i] = Math.min(255, Math.max(0, Math.round(
      0.2126 * heap[p] + 0.7152 * heap[p + 1] + 0.0722 * heap[p + 2],
    )));
  }
});

// Contrôle : les deux résultats doivent coïncider.
let mismatches = 0;
for (let i = 0; i < pixelCount; i += 1) {
  if (heap[dst + i] !== out[i]) mismatches += 1;
}

console.log(
  `\n  écart WebAssembly/JavaScript : ${mismatches}` +
    `\n  rapport : ${(msJs / msWasm).toFixed(2)}× ` +
    `${msWasm < msJs ? '(WebAssembly plus rapide)' : '(JavaScript plus rapide ici)'}`,
);
