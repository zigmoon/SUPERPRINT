/* Vérifie l'analyse PostScript à travers la frontière WebAssembly.

   Le module `dist/superprint_eps.wasm` est chargé tel qu'il est livré, et ses
   deux exports sont exercés sur les témoins réels du dépôt. Ce n'est pas encore
   le branchement dans l'application : c'est la vérification que la frontière
   rend bien ce qu'on croit, avant d'écrire la colle.

   Usage : node scripts/verifier-eps-wasm.mjs
*/
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

const chemin = join(racine, 'dist', 'superprint_eps.wasm');
if (!existsSync(chemin)) {
  console.error(`introuvable : ${chemin}`);
  console.error('(construire : pwsh -File scripts/build-wasm.ps1)');
  process.exit(2);
}

const octets = readFileSync(chemin);
const module = await WebAssembly.compile(octets);
const instance = await WebAssembly.instantiate(module, {});
const { memory, sp_alloc, sp_free, sp_eps_detect, sp_eps_analyse } = instance.exports;

console.log(`module : ${(octets.length / 1024).toFixed(1)} Ko, ${WebAssembly.Module.imports(module).length} import`);
check('les deux exports sont présents', typeof sp_eps_detect === 'function' && typeof sp_eps_analyse === 'function');

/** Dépose des octets dans la mémoire du module et rend le pointeur. */
function poser(donnees) {
  const p = sp_alloc(donnees.length);
  if (!p) throw new Error('allocation refusée');
  new Uint8Array(memory.buffer, p, donnees.length).set(donnees);
  return p;
}

function detecter(donnees) {
  const p = poser(donnees);
  try {
    return sp_eps_detect(p, donnees.length);
  } finally {
    sp_free(p, donnees.length);
  }
}

/** Analyse en deux passes, puis rend le rapport texte. */
function analyser(donnees, tolerance = 0.05) {
  const p = poser(donnees);
  const pLen = sp_alloc(4);
  try {
    // Première passe : tampon vide, le module annonce la taille nécessaire.
    let code = sp_eps_analyse(p, donnees.length, tolerance, 0, 0, pLen);
    if (code !== -1000002) throw new Error(`attendu TOO_SMALL, reçu ${code}`);
    const besoin = new Uint32Array(memory.buffer, pLen, 1)[0];
    const tampon = sp_alloc(besoin);
    try {
      // ⚠️ Le succès d'un export à deux passes rend le NOMBRE D'OCTETS écrits,
      // pas zéro : c'est la convention de toute la frontière. Un `!== 0` ici
      // ferait passer une réussite pour un échec (vu : code 1297).
      code = sp_eps_analyse(p, donnees.length, tolerance, tampon, besoin, pLen);
      if (code < 0) throw new Error(`analyse refusée (code ${code})`);
      const ecrit = new Uint32Array(memory.buffer, pLen, 1)[0];
      return new TextDecoder().decode(new Uint8Array(memory.buffer, tampon, ecrit));
    } finally {
      sp_free(tampon, besoin);
    }
  } finally {
    sp_free(pLen, 4);
    sp_free(p, donnees.length);
  }
}

/** Le rapport, rangé par étiquette. */
function lire(rapport) {
  const sortie = { entete: null, bbox: null, superficie: null, stats: null, dessins: [], inconnus: [], erreur: null };
  for (const ligne of rapport.split('\n')) {
    if (!ligne) continue;
    const c = ligne.split('\t');
    switch (c[0]) {
      case '!entete': sortie.entete = { version: c[1], createur: c[2], titre: c[3], eps: c[4] === '1' }; break;
      case '!bbox': sortie.bbox = c.slice(1).map(Number); break;
      case '!superficie': sortie.superficie = c.slice(1).map(Number); break;
      case '!stats': sortie.stats = { dessins: +c[1], sommets: +c[2], inconnus: +c[3], blocs: +c[4], pages: +c[5], objets: +c[6] }; break;
      case '!dessin': sortie.dessins.push({ peinture: c[2], epaisseur: c[3], espace: c[4], composantes: c.slice(5, 5 + +c[5]).map(Number), sousChemins: [], nbSous: +c[6 + +c[5]] }); break;
      case '!sous': {
        const d = sortie.dessins[+c[1]];
        const nb = +c[3];
        const points = [];
        for (let i = 0; i < nb; i += 1) points.push([+c[4 + i * 2], +c[5 + i * 2]]);
        d.sousChemins.push(points);
        break;
      }
      case '!inconnu': sortie.inconnus.push(c[1]); break;
      case '!erreur': sortie.erreur = c.slice(1).join('\t'); break;
    }
  }
  return sortie;
}

// ── détection ───────────────────────────────────────────────────────────────
console.log('\n== Détection');
check('PostScript → 1', detecter(Buffer.from('%!PS-Adobe-3.0')) === 1);
check('PDF (donc .ai moderne) → 2', detecter(Buffer.from('%PDF-1.6\n')) === 2);
check('archive ZIP → 3', detecter(Buffer.from([0x50, 0x4b, 0x03, 0x04])) === 3);
check('inconnu → 0', detecter(Buffer.from([0x89, 0x50, 0x4e, 0x47])) === 0);

// ── témoins réels ───────────────────────────────────────────────────────────
const TEMOINS = [
  ['eps-simple.eps', '_dev/fixtures/eps-simple.eps', 3],
  ['eps-preview.eps', '_dev/fixtures/eps-preview.eps', 1],
  ['eps-illustrator.eps', '_dev/fixtures/eps-illustrator.eps', 5],
  ['forme.eps', '_dev/sorties/forme.eps', 2],
];

console.log('\n== Témoins réels');
let totalDessins = 0;
let totalSommets = 0;
for (const [nom, relatif, attendus] of TEMOINS) {
  const cheminFichier = join(parent, relatif);
  if (!existsSync(cheminFichier)) {
    console.log(`  (absent du dépôt : ${nom})`);
    continue;
  }
  const donnees = readFileSync(cheminFichier);
  const r = lire(analyser(donnees));
  if (r.erreur) {
    check(`${nom} : interprété`, false, r.erreur);
    continue;
  }
  totalDessins += r.stats.dessins;
  totalSommets += r.stats.sommets;
  check(
    `${nom} : ${r.stats.dessins} dessin(s), ${r.stats.sommets} sommet(s)`,
    r.stats.dessins === attendus,
    `boîte ${r.bbox ? r.bbox.map((v) => v.toFixed(0)).join(' ') : '—'} · ${r.entete.createur || 'sans auteur'}`,
  );
}
check('total des dessins', totalDessins === 11, `${totalDessins} dessins, ${totalSommets} sommets`);

// ── un .ai qui est un PDF ───────────────────────────────────────────────────
console.log('\n== Un .ai qui est un PDF');
{
  const cheminAi = join(parent, '_dev/fixtures/Logo_licra_vecto.ai');
  if (existsSync(cheminAi)) {
    const donnees = readFileSync(cheminAi);
    check('détecté comme PDF', detecter(donnees) === 2);
    const r = lire(analyser(donnees));
    check(
      'l’analyse le REFUSE en expliquant pourquoi',
      r.erreur !== null && r.erreur.includes('PDF'),
      r.erreur ? r.erreur.slice(0, 110) : 'aucune erreur',
    );
  }
}

// ── le bloc DSC %%BeginPreview ──────────────────────────────────────────────
console.log('\n== Le piège du bloc d’aperçu');
{
  const source = Buffer.from(
    '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\n' +
      '%%BeginPreview: 10 10 1 10\n% A5A5A5A5\nA5A5A5A5A5A5A5A5A5\n%%EndPreview\n' +
      'newpath 0 0 moveto 10 10 lineto stroke\n',
    'latin1',
  );
  const r = lire(analyser(source));
  check(
    'l’hexadécimal de l’aperçu n’est pas lu comme du PostScript',
    r.erreur === null && r.stats.dessins === 1 && r.stats.blocs === 1,
    r.erreur || `${r.stats.dessins} dessin, ${r.stats.blocs} bloc sauté`,
  );
}

// ── le refus nommé ──────────────────────────────────────────────────────────
console.log('\n== Ce qui perdrait du dessin est refusé, et nommé');
{
  const r = lire(analyser(Buffer.from('%!PS-Adobe-3.0\n(Bonjour) show\n')));
  check(
    '`show` est refusé, et la raison parle du texte',
    r.erreur !== null && r.erreur.includes('show') && r.erreur.includes('texte'),
    r.erreur ? r.erreur.slice(0, 110) : 'aucune erreur',
  );
}

console.log(`\n${ok ? '✓ la frontière EPS dit ce qu’elle doit dire' : '✗ un contrôle a échoué'}`);
process.exit(ok ? 0 : 1);
