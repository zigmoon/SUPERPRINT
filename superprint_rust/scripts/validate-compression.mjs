// Preuve CROISÉE du codec DEFLATE (`superprint-compress`) contre le `zlib` de
// Node, qui est une **autre implémentation**.
//
// Comparer un compresseur à lui-même ne prouve rien : deux erreurs
// symétriques s'annulent. On vérifie donc les deux sens :
//
//   1. ce que le Rust compresse doit être relu par Node ;
//   2. ce que Node compresse doit être relu par le Rust ;
//   3. dans les deux cas, les octets doivent être **exactement** ceux d'origine.
//
// Les jeux d'essai sont choisis pour couvrir ce qui se rencontre vraiment dans
// un PDF d'impression : aplats, dégradés, contenu vectoriel répétitif, texte,
// bruit incompressible (une photographie tramée), et les tailles qui font
// changer de forme de bloc (32 768, 65 535, 65 536).
//
// Usage : node scripts/validate-compression.mjs
// Retour : 0 si tout passe, 1 sinon.

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const cheminExemple = join(
  root,
  'target',
  'wasm32-wasip1',
  'release',
  'examples',
  'compression_dump.wasm',
);

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '\u2713' : '\u2717'} ${label}${detail ? ` \u2014 ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (text) => console.log(`\n== ${text}`);
const nf = (n) => n.toLocaleString('fr-FR');

if (!existsSync(cheminExemple)) {
  console.error(
    `exemple non compilé : ${cheminExemple}\n` +
      '  → cargo build -p superprint-compress --example compression_dump --target wasm32-wasip1 --release',
  );
  process.exit(2);
}

// Le bac à sable WASI n'expose que le dossier du projet : les fichiers de
// travail vivent donc sous `target/`.
const dossier = join(root, 'target', 'compression');
await mkdir(dossier, { recursive: true });
const fichier = (nom) => join(dossier, nom);
const relatif = (nom) => join('target', 'compression', nom);

/** Lance l'exemple Rust. Renvoie `{ code, sortie, erreur }`.
 *
 * `niveau` vaut `null` pour les modes qui n'en prennent pas — attention, les
 * modes `compresser` et `brut` en attendent **toujours** un : sans lui, le
 * premier chemin reçu serait pris pour un niveau. */
function rust(mode, niveau, entree, sortie) {
  const args = [join(here, 'run-wasi.mjs'), cheminExemple, mode];
  if (niveau !== null) args.push(niveau);
  args.push(relatif(entree), relatif(sortie));
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return { code: 0, sortie: stdout, erreur: '' };
  } catch (erreur) {
    return { code: erreur.status ?? 1, sortie: '', erreur: String(erreur.stderr ?? '') };
  }
}

// ── 1. Les jeux d'essai ─────────────────────────────────────────────────────
titre('jeux d’essai');

/** Générateur congruentiel : reproductible, et incompressible. */
function bruit(taille, graine = 0x1234_5678) {
  let etat = graine >>> 0;
  const sortie = Buffer.alloc(taille);
  for (let i = 0; i < taille; i += 1) {
    etat = (Math.imul(etat, 1664525) + 1013904223) >>> 0;
    sortie[i] = (etat >>> 24) & 0xff;
  }
  return sortie;
}

const phrase = 'Le petit chat dort sur le canapé du salon, tranquillement. ';
const jeux = [
  ['vide', Buffer.alloc(0)],
  ['un octet', Buffer.from([0x42])],
  ['trois octets', Buffer.from([1, 2, 3])],
  ['aplat 100 000 octets', Buffer.alloc(100_000, 0)],
  ['aplat d’octets non nuls', Buffer.alloc(70_000, 0xab)],
  ['texte répétitif 20 000', Buffer.from(phrase.repeat(350))],
  ['juste sous la fenêtre (32 767)', bruit(32_767)],
  ['juste au-dessus de la fenêtre (32 769)', bruit(32_769)],
  ['juste sous la limite de bloc stocké (65 535)', bruit(65_535)],
  ['juste au-dessus (65 536)', bruit(65_536)],
  ['bruit 200 000 (incompressible)', bruit(200_000)],
  ['les 256 octets possibles', Buffer.from(Array.from({ length: 256 }, (_, i) => i))],
];

// Contenu vectoriel : ce que produit réellement un export de PAO.
{
  const morceaux = [
    'q\n',
    '1 0 0 1 85.039 42.52 cm\n',
    '0.5 0 0.9 0 k\n',
    '0 0 226.772 170.079 re\nf\n',
    'Q\n',
  ];
  jeux.push(['flux de contenu vectoriel ×2000', Buffer.from(morceaux.join('').repeat(2000))]);
}
// Dégradé : une progression lente, très compressible, mais pas triviale.
{
  const pixels = Buffer.alloc(300_000);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 7) & 0xff;
  jeux.push(['dégradé 300 000', pixels]);
}
// Un vrai fichier du projet : le module WebAssembly livrable.
{
  const module = join(root, 'dist', 'superprint_core.wasm');
  if (existsSync(module)) {
    jeux.push(['le module .wasm livrable', await readFile(module)]);
  }
}

for (const [nom, octets] of jeux) {
  console.log(`  ${nom} : ${nf(octets.length)} octet(s)`);
}

// ── 2. Rust → Node ──────────────────────────────────────────────────────────
titre('ce que le Rust compresse est relu par Node (zlib)');

const versements = [];
for (const [nom, octets] of jeux) {
  const entree = 'entree.bin';
  const comprime = 'rust.zlib';
  const relu = 'rust-relu.bin';
  await writeFile(fichier(entree), octets);
  const resultat = rust('compresser', 'defaut', entree, comprime);
  if (resultat.code !== 0) {
    check(`${nom} : compression Rust`, false, `code ${resultat.code}`);
    continue;
  }
  const flux = await readFile(fichier(comprime));
  let nodeRelu = null;
  let message = '';
  try {
    nodeRelu = zlib.inflateSync(flux);
  } catch (erreur) {
    message = String(erreur.message);
  }
  const identique = nodeRelu !== null && Buffer.compare(nodeRelu, octets) === 0;
  check(
    `${nom} : ${nf(octets.length)} octets relus par Node`,
    identique,
    identique
      ? `${nf(flux.length)} octets compressés (${(octets.length / Math.max(flux.length, 1)).toFixed(1)}×)`
      : message || 'octets différents',
  );
  if (identique) versements.push({ nom, brut: octets.length, rust: flux.length });

  // Le noyau doit aussi relire son propre flux : c'est le contrôle le moins
  // intéressant, mais il localise une faute (compression ou relecture).
  const retour = rust('decompresser', null, comprime, relu);
  const sienRelu = await readFile(fichier(relu));
  check(
    `${nom} : flux relu par le noyau lui-même`,
    retour.code === 0 && Buffer.compare(sienRelu, octets) === 0,
  );
}

// ── 3. Node → Rust ──────────────────────────────────────────────────────────
titre('ce que Node compresse est relu par le Rust');

for (const [nom, octets] of jeux) {
  const flux = zlib.deflateSync(octets);
  await writeFile(fichier('node.zlib'), flux);
  const resultat = rust('decompresser', null, 'node.zlib', 'node-relu.bin');
  if (resultat.code !== 0) {
    check(`${nom} : relecture du flux de Node`, false, `refusé (code ${resultat.code})`);
    continue;
  }
  const relu = await readFile(fichier('node-relu.bin'));
  const identique = Buffer.compare(relu, octets) === 0;
  check(
    `${nom} : flux de Node relu par le Rust`,
    identique,
    identique ? `${nf(flux.length)} octets de flux` : 'octets différents',
  );
}

// ── 4. Les trois niveaux, et le DEFLATE brut ─────────────────────────────────
titre('niveaux de compression et DEFLATE brut');

const echantillon = Buffer.from(phrase.repeat(400));
await writeFile(fichier('entree.bin'), echantillon);
for (const niveau of ['rapide', 'defaut', 'pousse']) {
  const resultat = rust('compresser', niveau, 'entree.bin', `niveau-${niveau}.zlib`);
  const flux = await readFile(fichier(`niveau-${niveau}.zlib`));
  let relu = null;
  try {
    relu = zlib.inflateSync(flux);
  } catch {
    relu = null;
  }
  check(
    `niveau « ${niveau} » : flux accepté par Node`,
    resultat.code === 0 && relu !== null && Buffer.compare(relu, echantillon) === 0,
    `${nf(flux.length)} octets`,
  );
}

for (const [nom, octets] of [['aplat', Buffer.alloc(50_000, 0)], ['bruit', bruit(50_000)]]) {
  await writeFile(fichier('entree.bin'), octets);
  rust('brut', 'defaut', 'entree.bin', 'brut.raw');
  const flux = await readFile(fichier('brut.raw'));
  let relu = null;
  let message = '';
  try {
    // `inflateRawSync` attend du DEFLATE **sans** en-tête zlib : c'est
    // exactement ce que le mode brut doit produire.
    relu = zlib.inflateRawSync(flux);
  } catch (erreur) {
    message = String(erreur.message);
  }
  check(
    `DEFLATE brut (${nom}) relu par Node`,
    relu !== null && Buffer.compare(relu, octets) === 0,
    relu === null ? message : `${nf(flux.length)} octets`,
  );
  // Et le Rust doit relire le brut de Node.
  const brutNode = zlib.deflateRawSync(octets);
  await writeFile(fichier('node.raw'), brutNode);
  const retour = rust('brut-relire', null, 'node.raw', 'node-brut-relu.bin');
  const recupere = await readFile(fichier('node-brut-relu.bin'));
  check(
    `DEFLATE brut de Node relu par le Rust (${nom})`,
    retour.code === 0 && Buffer.compare(recupere, octets) === 0,
  );
}

// ── 5. Les flux corrompus sont refusés ──────────────────────────────────────
titre('les flux corrompus sont refusés, jamais approximés');

const temoin = zlib.deflateSync(Buffer.from(phrase.repeat(50)));
const variantes = [
  ['en-tête abîmé', (flux) => { flux[0] = 0x77; return flux; }],
  ['corps tronqué', (flux) => flux.subarray(0, flux.length - 6)],
  ['somme Adler-32 fausse', (flux) => { const c = Buffer.from(flux); c[c.length - 1] ^= 0xff; return c; }],
  ['flux vide', () => Buffer.alloc(0)],
  ['octets aléatoires', () => Buffer.from([0x78, 0x9c, 0xff, 0xff, 0xff, 0xff, 0x00, 0x00])],
];
for (const [nom, abimer] of variantes) {
  await writeFile(fichier('abime.zlib'), abimer(Buffer.from(temoin)));
  const resultat = rust('decompresser', null, 'abime.zlib', 'abime-relu.bin');
  check(
    `${nom} : refusé`,
    resultat.code === 3 && /refus/.test(resultat.erreur),
    (resultat.erreur.trim().split('\n').pop() ?? '').slice(0, 90),
  );
}

// ── 6. Comparaison de taux, pour information ────────────────────────────────
titre('taux obtenus, comparés à zlib (information)');

if (versements.length) {
  console.log('  jeu                              brut        Rust       zlib     écart');
  for (const { nom, brut, rust: taille } of versements) {
    const octets = jeux.find(([n]) => n === nom)?.[1];
    if (!octets) continue;
    const z = zlib.deflateSync(octets).length;
    const ecart = z > 0 ? ((taille / z - 1) * 100).toFixed(0) : '0';
    console.log(
      `  ${nom.padEnd(32).slice(0, 32)} ${nf(brut).padStart(10)} ${nf(taille).padStart(11)} ${nf(z).padStart(10)} ${String(ecart).padStart(5)} %`,
    );
  }
  const totalBrut = versements.reduce((t, v) => t + v.brut, 0);
  const totalRust = versements.reduce((t, v) => t + v.rust, 0);
  const totalZlib = versements.reduce((t, v) => {
    const octets = jeux.find(([n]) => n === v.nom)?.[1];
    return t + (octets ? zlib.deflateSync(octets).length : 0);
  }, 0);
  console.log(
    `  ${'TOTAL'.padEnd(32)} ${nf(totalBrut).padStart(10)} ${nf(totalRust).padStart(11)} ${nf(totalZlib).padStart(10)} ${(((totalRust / totalZlib - 1) * 100)).toFixed(0).padStart(5)} %`,
  );
  console.log(
    '\n  (le Huffman dynamique n’étant pas implémenté, un écart de quelques pour\n' +
      '   cent est attendu — voir docs/PORTAGE.md. L’essentiel est que le flux se\n' +
      '   relise ailleurs, et qu’il ne gonfle jamais.)',
  );
}

console.log(ok ? '\nOK : le codec est juste dans les deux sens, et refuse ce qui est abîmé.' : '\nÉCHEC.');
process.exit(ok ? 0 : 1);
