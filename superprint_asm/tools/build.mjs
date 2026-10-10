// Assemble les modules WAT de `src/` en WebAssembly binaire dans `dist/`.
//
// WAT = WebAssembly Text, « l'assembleur du web ». Il est assemblé ici par
// `wabt` (WebAssembly Binary Toolkit), la référence du domaine, disponible
// comme bibliothèque JavaScript — donc aucune chaîne de compilation native
// n'est nécessaire.
//
//   node tools/build.mjs

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import wabtFactory from 'wabt';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const outDir = join(root, 'dist');

const files = (await readdir(srcDir)).filter((name) => name.endsWith('.wat'));
if (files.length === 0) {
  console.error('aucun fichier .wat dans src/');
  process.exit(1);
}

await mkdir(outDir, { recursive: true });

const wabt = await wabtFactory();

let total = 0;
for (const name of files.sort()) {
  const watPath = join(srcDir, name);
  const wat = await readFile(watPath, 'utf8');

  // parseWat lève une exception si la syntaxe WAT est invalide.
  const module = wabt.parseWat(name, wat, { mutable_globals: true });
  try {
    module.resolveNames();
    module.validate();
    const { buffer } = module.toBinary({ log: false, write_debug_names: true });
    const outPath = join(outDir, `${basename(name, '.wat')}.wasm`);
    await writeFile(outPath, buffer);
    total += buffer.length;
    console.log(
      `  ✓ ${name} → dist/${basename(name, '.wat')}.wasm (${buffer.length} octets)`,
    );
  } finally {
    module.destroy();
  }
}

console.log(`\n${files.length} module(s) assemblé(s), ${total} octets au total.`);
