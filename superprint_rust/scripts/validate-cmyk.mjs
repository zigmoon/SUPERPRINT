/* ══════════════════════════════════════════════════════════════════════════
   validate-cmyk.mjs — la conversion RVB → CMJN du noyau contre celle du produit.

   `_spCmykConvert` de `main.js` décide de la couleur qui **part dans le PDF
   livré** : elle porte le seuil de neutralisation, le remplacement de la
   composante grise et la limite d'encre. Le noyau en a maintenant une copie en
   Rust (`superprint_core::color::convertir`), exposée à la frontière.

   Ce script la met à l'épreuve sans lui faire confiance, et de deux façons :

     1. PARITÉ CONTRE LE PRODUIT. La fonction JavaScript est **extraite du
        fichier réel** `superprint/app/JS/main.js` — lu, jamais modifié — et
        confrontée au Rust sur un balayage complet : les 256 gris, les cas
        limites d'échelle, un nuage aléatoire, et les deux réglages dans toutes
        leurs positions. L'écart est mesuré, pas supposé.

     2. LE DÉFAUT DU PRODUIT, MESURÉ. Le remplacement de la composante grise
        (GCR) n'a **aucun effet** : après la conversion naïve, le canal
        d'énergie maximale donne toujours un CMJ nul, donc le minimum de C, M, J
        vaut zéro et `newK = max(k, 0) = k`. Le script le vérifie au lieu de le
        croire sur parole, et le noyau **reproduit ce comportement** — la
        parité passe avant la correction, mais le défaut est publié.

   Usage : node scripts/validate-cmyk.mjs
   Retour : 0 si tout passe, 1 sinon.
   ══════════════════════════════════════════════════════════════════════════ */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, '..');
const parent = join(racine, '..');

let ok = true;
const check = (label, condition, detail = '') => {
  console.log(`${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) ok = false;
};
const titre = (t) => console.log(`\n== ${t}`);

/* ─────────────────────────────────────────────────────────────────────────
   1. La fonction du PRODUIT, extraite telle quelle
   ───────────────────────────────────────────────────────────────────────── */

const CHEMIN_MAIN = join(parent, 'superprint', 'app', 'JS', 'main.js');
if (!existsSync(CHEMIN_MAIN)) {
  console.error(`introuvable : ${CHEMIN_MAIN}`);
  process.exit(2);
}

const source = readFileSync(CHEMIN_MAIN, 'utf8');
const debut = source.indexOf('function _spCmykConvert(');
const fin = source.indexOf('window._spCmykConvert =', debut);
if (debut < 0 || fin < 0 || fin <= debut) {
  console.error('la fonction _spCmykConvert est introuvable dans main.js');
  process.exit(2);
}
const corps = source.slice(debut, fin);
// eslint-disable-next-line no-new-func
const cmykProduit = new Function(`${corps}\nreturn _spCmykConvert;`)();
const lignes = corps.split('\n').length;

titre('La fonction du produit');
check(
  'la fonction _spCmykConvert est bien extraite de main.js, sans le modifier',
  typeof cmykProduit === 'function',
  `${lignes} lignes extraites du fichier réel`,
);
console.log(
  '  (le fichier n’est ouvert qu’en lecture : c’est la règle du dépôt, et c’est ce qui rend la comparaison honnête)',
);

/* ─────────────────────────────────────────────────────────────────────────
   2. Le noyau, chargé tel qu'il est livré
   ───────────────────────────────────────────────────────────────────────── */

const CHEMIN_NOYAU = join(racine, 'dist', 'superprint_core.wasm');
if (!existsSync(CHEMIN_NOYAU)) {
  console.error(`introuvable : ${CHEMIN_NOYAU}`);
  console.error('(construire : pwsh -File scripts/build-wasm.ps1)');
  process.exit(2);
}

const octets = readFileSync(CHEMIN_NOYAU);
const module = await WebAssembly.compile(octets);
const instance = await WebAssembly.instantiate(module, {});
const { memory, sp_alloc, sp_free, sp_cmyk_convert } = instance.exports;

titre('La frontière');
check(
  'le module expose sp_cmyk_convert, et il n’importe rien',
  typeof sp_cmyk_convert === 'function' && WebAssembly.Module.imports(module).length === 0,
  `${(octets.length / 1024).toFixed(1)} Ko, ${WebAssembly.Module.imports(module).length} import`,
);

/** Appelle la conversion du noyau. `gcr`/`limite` : 0 désactive, comme le produit. */
function cmykNoyau(r, g, b, gcr, limite) {
  const p = sp_alloc(32);
  if (!p) throw new Error('allocation refusée');
  try {
    const code = sp_cmyk_convert(r, g, b, gcr || 0, limite || 0, p);
    if (code !== 0) throw new Error(`sp_cmyk_convert a rendu ${code}`);
    // La vue est construite APRÈS l'appel : la règle de la maison.
    const vue = new Float64Array(memory.buffer, p, 4);
    return { c: vue[0], m: vue[1], y: vue[2], k: vue[3] };
  } finally {
    sp_free(p, 32);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   3. Le balayage
   ───────────────────────────────────────────────────────────────────────── */

/** Les jeux de réglages, dans toutes les positions que le produit connaît. */
const REGLAGES = [
  { nom: 'aucun réglage', opts: undefined, rust: [0, 0] },
  { nom: 'GCR vrai (0,8)', opts: { gcr: true }, rust: [0.8, 0] },
  { nom: 'GCR 0 (désactivé)', opts: { gcr: 0 }, rust: [0, 0] },
  { nom: 'GCR 0,5', opts: { gcr: 0.5 }, rust: [0.5, 0] },
  { nom: 'limite 3,0 (300 %)', opts: { inkLimit: 3.0 }, rust: [0, 3.0] },
  { nom: 'limite 1,5', opts: { inkLimit: 1.5 }, rust: [0, 1.5] },
  { nom: 'limite 0 (désactivée)', opts: { inkLimit: 0 }, rust: [0, 0] },
  { nom: 'GCR + limite', opts: { gcr: 0.8, inkLimit: 2.5 }, rust: [0.8, 2.5] },
];

/** Les entrées : gris, primaires, cases de la grille, extrêmes, aléatoire. */
function* entrees() {
  // Les 256 niveaux de gris, en 0–255.
  for (let v = 0; v < 256; v += 1) yield [v, v, v];
  // Les mêmes en 0–1.
  for (let v = 0; v < 256; v += 1) yield [v / 255, v / 255, v / 255];
  // Les arêtes du cube : presque gris, juste au-dessus et en dessous du seuil.
  for (let i = 0; i <= 12; i += 1) {
    const ecart = i / 255;
    yield [0.5, 0.5 - ecart, 0.5];
    yield [0.3, 0.3, 0.3 + ecart];
  }
  // Une grille régulière dans [0,1].
  for (let r = 0; r <= 1.0001; r += 0.1) {
    for (let g = 0; g <= 1.0001; g += 0.1) {
      for (let b = 0; b <= 1.0001; b += 0.1) yield [r, g, b];
    }
  }
  // Les cas limites d'échelle et de bornage.
  yield [0, 0, 0];
  yield [255, 255, 255];
  yield [1, 1, 1];
  yield [1.0000001, 0, 0];
  yield [-1, -1, -1];
  yield [-5, 2, 3];
  yield [300, 300, 300];
  yield [0.5, 200, 0.5];
  yield [200, 0.5, 0.5];
  // Un nuage aléatoire déterministe (générateur congruentiel : pas de
  // dépendance, et deux exécutions donnent le même balayage).
  let graine = 0x2f6e2b1;
  for (let i = 0; i < 40000; i += 1) {
    graine = (graine * 1103515245 + 12345) & 0x7fffffff;
    const r = (graine % 100000) / 100000;
    graine = (graine * 1103515245 + 12345) & 0x7fffffff;
    const g = (graine % 100000) / 100000;
    graine = (graine * 1103515245 + 12345) & 0x7fffffff;
    const b = (graine % 100000) / 100000;
    yield [r * 255, g * 255, b * 255];
    yield [r, g, b];
  }
}

titre('Parité avec le produit, sur le balayage complet');

let compares = 0;
const pires = { ecart: 0, cas: null };
const desaccords = [];

for (const reglage of REGLAGES) {
  let ecartMax = 0;
  let casPire = null;
  for (const [r, g, b] of entrees()) {
    const attendu = cmykProduit(r, g, b, reglage.opts);
    const obtenu = cmykNoyau(r, g, b, reglage.rust[0], reglage.rust[1]);
    compares += 1;
    for (const canal of ['c', 'm', 'y', 'k']) {
      const ecart = Math.abs(attendu[canal] - obtenu[canal]);
      if (ecart > ecartMax) {
        ecartMax = ecart;
        casPire = { r, g, b, canal, attendu: attendu[canal], obtenu: obtenu[canal] };
      }
    }
    if (desaccords.length < 5 && ecartMax > 1e-12) {
      desaccords.push(
        `(${r}, ${g}, ${b}) [${reglage.nom}] : ${attendu.c}/${attendu.m}/${attendu.y}/${attendu.k} ` +
          `≠ ${obtenu.c}/${obtenu.m}/${obtenu.y}/${obtenu.k}`,
      );
    }
  }
  check(
    `${reglage.nom} : écart maximal ${ecartMax.toExponential(2)}`,
    ecartMax <= 1e-12,
    casPire && ecartMax > 1e-12
      ? `pire cas (${casPire.r}, ${casPire.g}, ${casPire.b}).${casPire.canal} : ${casPire.attendu} vs ${casPire.obtenu}`
      : '',
  );
  if (ecartMax > pires.ecart) {
    pires.ecart = ecartMax;
    pires.cas = { reglage: reglage.nom, ...casPire };
  }
}

if (desaccords.length) {
  for (const d of desaccords) console.log(`    ${d}`);
}
check(
  `les ${compares.toLocaleString('fr-FR')} conversions coïncident`,
  desaccords.length === 0 && pires.ecart <= 1e-12,
  `écart maximal ${pires.ecart.toExponential(2)}`,
);

/* ─────────────────────────────────────────────────────────────────────────
   4. Le défaut du produit, mesuré — et reproduit
   ───────────────────────────────────────────────────────────────────────── */

titre('Le GCR du produit, mesuré plutôt que supposé');

{
  // Le raisonnement, vérifié et non affirmé : après la conversion naïve, le
  // canal d'énergie maximale donne (1 - max - k) / (1 - k) = 0, donc le minimum
  // de C, M, J est nul, donc `newK = max(k, minimum × montant) = k` : le GCR
  // ne peut pas mordre.
  let minimumsNuls = 0;
  let minimumsNonNuls = 0;
  let gcrSansEffet = 0;
  let gcrAvecEffet = 0;
  let echantillons = 0;

  for (const [r, g, b] of entrees()) {
    // On ne juge que les cas où la conversion atteint réellement le calcul
    // (la neutralisation, elle, sort avant).
    const brut = cmykProduit(r, g, b, undefined);
    if (brut.c === 0 && brut.m === 0 && brut.y === 0) continue;
    echantillons += 1;
    const minimum = Math.min(brut.c, brut.m, brut.y);
    if (Math.abs(minimum) < 1e-15) minimumsNuls += 1;
    else minimumsNonNuls += 1;

    const avec = cmykProduit(r, g, b, { gcr: 0.8 });
    if (
      avec.c === brut.c &&
      avec.m === brut.m &&
      avec.y === brut.y &&
      avec.k === brut.k
    ) {
      gcrSansEffet += 1;
    } else {
      gcrAvecEffet += 1;
    }
  }

  check(
    'après la conversion naïve, le minimum de C, M, J est toujours nul',
    minimumsNonNuls === 0 && minimumsNuls > 0,
    `${minimumsNuls} cas sur ${echantillons}`,
  );
  check(
    'donc le GCR du produit n’a aucun effet, quel que soit le montant',
    gcrAvecEffet === 0,
    `${gcrSansEffet} cas sans effet, ${gcrAvecEffet} avec effet`,
  );

  if (gcrAvecEffet > 0) {
    console.log(
      '     ⇒ il y a des cas où le GCR agit : le raisonnement ci-dessus est faux, il faut le reprendre',
    );
  } else {
    console.log(
      '     ⇒ défaut réel du produit : l’option « GCR » de l’interface ne change RIEN.',
    );
    console.log(
      '       Le noyau REPRODUIT ce comportement (la parité passe avant la correction) :',
    );
    console.log(
      '       brancher le noyau ne change donc rien à l’impression, et c’est voulu.',
    );
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   5. Ce que le noyau garantit en plus
   ───────────────────────────────────────────────────────────────────────── */

titre('Ce que le noyau garantit');

{
  // Les quatre composantes restent dans [0, 1] : c'est ce qui permet de les
  // écrire dans un PDF sans risquer une encre négative.
  let horsBornes = 0;
  let nonFinies = 0;
  let total = 0;
  for (const [r, g, b] of entrees()) {
    const v = cmykNoyau(r, g, b, 0.8, 3.0);
    total += 1;
    for (const canal of ['c', 'm', 'y', 'k']) {
      if (!Number.isFinite(v[canal])) nonFinies += 1;
      else if (v[canal] < -1e-12 || v[canal] > 1 + 1e-12) horsBornes += 1;
    }
  }
  check(
    'les quatre composantes restent dans [0, 1] et sont finies',
    horsBornes === 0 && nonFinies === 0,
    `${total.toLocaleString('fr-FR')} conversions, ${horsBornes} hors bornes, ${nonFinies} non finies`,
  );

  // Une entrée non finie est **refusée** plutôt que propagée : le produit, lui,
  // laisserait passer un NaN jusque dans le PDF.
  const p = sp_alloc(32);
  // On met le tampon à zéro NOUS-MÊMES. Ce qui compte est que le noyau
  // n'ÉCRIVE rien quand il refuse — et non que la mémoire soit vierge, ce
  // qu'aucun allocateur ne promet : le bloc rendu peut venir d'une allocation
  // précédente et contenir des restes.
  new Float64Array(memory.buffer, p, 4).fill(0);
  const codeNaN = sp_cmyk_convert(Number.NaN, 0, 0, 0, 0, p);
  const codeInfini = sp_cmyk_convert(0, 0, Number.POSITIVE_INFINITY, 0, 0, p);
  const apres = [...new Float64Array(memory.buffer, p, 4)];
  const produitNaN = cmykProduit(Number.NaN, 0, 0, undefined);
  sp_free(p, 32);
  console.log(
    `  une entrée NaN : noyau → refus (code ${codeNaN}) ; produit → ` +
      `${produitNaN.c}, ${produitNaN.m}, ${produitNaN.y}, ${produitNaN.k}`,
  );
  check(
    'le noyau refuse une entrée non finie, là où le produit met un NaN dans le PDF',
    codeNaN === -1000003 && codeInfini === -1000003,
    `NaN → ${codeNaN}, infini → ${codeInfini} (attendu -1000003)`,
  );
  check(
    'et il n’écrit RIEN dans le tampon : aucun reste ne peut être lu comme un résultat',
    apres.every((v) => v === 0),
    `après refus : ${apres.join(', ')}`,
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   6. Le pointeur nul est refusé
   ───────────────────────────────────────────────────────────────────────── */

titre('La frontière refuse ce qu’elle ne peut pas écrire');

check(
  'sp_cmyk_convert refuse un pointeur nul (code -1000001)',
  sp_cmyk_convert(0.5, 0.5, 0.5, 0, 0, 0) === -1000001,
);

console.log(`\n${ok ? '✓ tout est conforme' : '✗ au moins un contrôle a échoué'}`);
process.exit(ok ? 0 : 1);
