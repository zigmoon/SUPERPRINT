// Tests des modules WAT exécutés dans le WebAssembly du navigateur (Node).
//
//   • luma.wasm   — luminance Rec. 709 (RVB -> gris)
//   • color8.wasm — conversions entières RVB <-> CMJN
//
//   node tools/test.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
};

async function load(name) {
  const bytes = readFileSync(join(root, 'dist', name));
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return { exports: instance.exports, mem: new Uint8Array(instance.exports.memory.buffer) };
}

// ── Références JavaScript (mêmes formules que le WAT et le Rust) ─────────────
const lumaRef = (r, g, b) =>
  Math.min(255, Math.max(0, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)));

function cmykRef(r, g, b) {
  const max = Math.max(r, g, b);
  if (max === 0) return [0, 0, 0, 255];
  const half = Math.floor(max / 2);
  const component = (v) => Math.trunc(((max - v) * 255 + half) / max);
  return [component(r), component(g), component(b), 255 - max];
}
function rgbRef(c, m, y, k) {
  const kc = 255 - k;
  const component = (v) => Math.trunc(((255 - v) * kc + 127) / 255);
  return [component(c), component(m), component(y)];
}

// ══════════════════════════ luminance ═══════════════════════════════════════
{
  console.log('\n== luma.wasm (luminance Rec. 709)');
  const { exports } = await load('luma.wasm');

  const known = [
    [[0, 0, 0], 0, 'noir'],
    [[255, 255, 255], 255, 'blanc'],
    [[128, 128, 128], 128, 'gris neutre'],
    [[255, 0, 0], 54, 'rouge pur'],
    [[0, 255, 0], 182, 'vert pur'],
    [[0, 0, 255], 18, 'bleu pur'],
  ];
  for (const [rgb, y, label] of known) {
    const got = exports.luma_rgb(...rgb);
    check(`${label} rgb(${rgb.join(',')}) = ${y}`, got === y, `obtenu ${got}`);
  }

  // Tampon : 1000 pixels identiques à la référence.
  const { exports: e2, mem } = await load('luma.wasm');
  const n = 1000;
  const src = 0;
  const dst = 800_000;
  const pixels = Array.from({ length: n }, (_, i) => [(i * 7) % 256, (i * 13) % 256, (i * 29) % 256]);
  pixels.forEach(([r, g, b], i) => {
    mem[src + i * 3] = r;
    mem[src + i * 3 + 1] = g;
    mem[src + i * 3 + 2] = b;
  });
  e2.luma_rgb_to_gray8(src, dst, n);
  let bad = 0;
  for (let i = 0; i < n; i += 1) if (mem[dst + i] !== lumaRef(...pixels[i])) bad += 1;
  check(`tampon de ${n} pixels identique à la référence`, bad === 0, `${bad} écart(s)`);
}

// ══════════════════════════ couleurs ════════════════════════════════════════
{
  console.log('\n== color8.wasm (RVB <-> CMJN)');
  const { exports, mem } = await load('color8.wasm');
  const src = 0;
  const dstCmyk = 1_000_000;
  const dstRgb = 1_100_000;

  const writeRgb = (r, g, b) => {
    mem[src] = r;
    mem[src + 1] = g;
    mem[src + 2] = b;
  };

  // Cas connus.
  const known = [
    [[255, 0, 0], [0, 255, 255, 0], 'rouge pur'],
    [[255, 255, 255], [0, 0, 0, 0], 'blanc'],
    [[0, 0, 0], [0, 0, 0, 255], 'noir'],
  ];
  for (const [rgb, cmyk, label] of known) {
    writeRgb(...rgb);
    exports.rgb_to_cmyk(src, dstCmyk, 1);
    const got = [mem[dstCmyk], mem[dstCmyk + 1], mem[dstCmyk + 2], mem[dstCmyk + 3]];
    check(
      `${label} rgb(${rgb.join(',')}) -> CMJN ${cmyk.join(',')}`,
      got.join(',') === cmyk.join(','),
      `obtenu ${got.join(',')}`,
    );
  }

  // Aller-retour stable + comparaison à la référence, sur un grand échantillon.
  let roundTripBad = 0;
  let forwardBad = 0;
  let backBad = 0;
  const sample = 20_000;
  for (let i = 0; i < sample; i += 1) {
    const r = (i * 71 + (i >> 4)) & 0xff;
    const g = (i * 149) & 0xff;
    const b = (i * 199 + 7) & 0xff;

    writeRgb(r, g, b);
    exports.rgb_to_cmyk(src, dstCmyk, 1);
    const cmyk = [mem[dstCmyk], mem[dstCmyk + 1], mem[dstCmyk + 2], mem[dstCmyk + 3]];
    if (cmyk.join(',') !== cmykRef(r, g, b).join(',')) forwardBad += 1;

    mem[src] = cmyk[0];
    mem[src + 1] = cmyk[1];
    mem[src + 2] = cmyk[2];
    mem[src + 3] = cmyk[3];
    exports.cmyk_to_rgb(src, dstRgb, 1);
    const back = [mem[dstRgb], mem[dstRgb + 1], mem[dstRgb + 2]];
    if (back.join(',') !== rgbRef(...cmyk).join(',')) backBad += 1;
    if (back[0] !== r || back[1] !== g || back[2] !== b) roundTripBad += 1;
  }
  check(`RVB -> CMJN : ${sample} pixels conformes à la référence`, forwardBad === 0, `${forwardBad} écart(s)`);
  check(`CMJN -> RVB : ${sample} pixels conformes à la référence`, backBad === 0, `${backBad} écart(s)`);
  check(
    `aller-retour RVB -> CMJN -> RVB identique : ${sample} pixels`,
    roundTripBad === 0,
    `${roundTripBad} écart(s)`,
  );
}

console.log(
  failures === 0
    ? '\n✅ modules WAT conformes à la référence.'
    : `\n❌ ${failures} vérification(s) en échec.`,
);
process.exit(failures === 0 ? 0 : 1);
