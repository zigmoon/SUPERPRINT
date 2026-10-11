/* ══════════════════════════════════════════════════════════════════════════
   extract-swatchbooks.mjs — les nuanciers du produit → le fichier de données
   du crate `superprint-swatch`.

   Les nuanciers ne sont pas de la logique : c'est une TABLE. La reporter à la
   main serait la recopier, donc la laisser dériver. Ce script la LIT là où
   elle vit déjà :

     1. `superprint/app/JS/swatchbooks.js` — le tableau `BOOKS`
        (Toyo, Focoltone, HKS, RAL, NCS, DIC) ;
     2. `superprint/app/index.html`      — le `<select id="spotColorSelect">`,
        qui est la SOURCE DE VÉRITÉ du catalogue (les <optgroup> Pantone y
        sont écrits en dur ; les autres y sont ajoutés par le module).

   Il écrit `crates/superprint-swatch/data/nuanciers.txt`, que le crate
   inclut avec `include_str!`. Le fichier est versionné : le crate se compile
   sans Node, et le jour où un nuancier change, on relance ce script.

   Usage :  node scripts/extract-swatchbooks.mjs
   ══════════════════════════════════════════════════════════════════════════ */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE_RUST = join(ICI, '..');
const RACINE_PRODUIT = join(RACINE_RUST, '..', 'superprint');

const SORTIE = join(RACINE_RUST, 'crates', 'superprint-swatch', 'data', 'nuanciers.txt');

/* ─────────────── 1. le tableau BOOKS de swatchbooks.js ─────────────── */

/** Extrait `[ ... ]` à partir de l'accolade ouvrante, en ignorant les
    chaînes (un nuancier peut contenir « [ » dans un libellé). */
function extraireCrochets(texte, depart) {
  let niveau = 0;
  let chaine = null;
  for (let i = depart; i < texte.length; i++) {
    const c = texte[i];
    if (chaine) {
      if (c === '\\') { i++; continue; }
      if (c === chaine) chaine = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { chaine = c; continue; }
    if (c === '/' && texte[i + 1] === '/') { while (i < texte.length && texte[i] !== '\n') i++; continue; }
    if (c === '/' && texte[i + 1] === '*') { i = texte.indexOf('*/', i); if (i < 0) break; i++; continue; }
    if (c === '[') niveau++;
    else if (c === ']') { niveau--; if (niveau === 0) return texte.slice(depart, i + 1); }
  }
  throw new Error('portée non refermée');
}

function livresDepuisSwatchbooks() {
  const source = readFileSync(join(RACINE_PRODUIT, 'app', 'JS', 'swatchbooks.js'), 'utf8');
  const ancre = source.indexOf('var BOOKS =');
  if (ancre < 0) throw new Error('tableau BOOKS introuvable');
  const litteral = extraireCrochets(source, source.indexOf('[', ancre));
  /* eslint-disable-next-line no-new-func */
  const books = new Function(`return ${litteral};`)();
  return books.map((b) => ({
    id: b.id,
    nom: b.name,
    echantillon: b.depuisSelect ? (b.maxEchantillon || 50) : 0,
    groupes: (b.groups || []).map((g) => ({
      label: g.label,
      couleurs: (g.colors || []).map((c) => ({ nom: c[0], hex: c[1] })),
    })),
  }));
}

/* ─────────── 2. le catalogue de index.html (Pantone, en dur) ─────────── */

function livresDepuisIndexHtml() {
  const source = readFileSync(join(RACINE_PRODUIT, 'app', 'index.html'), 'utf8');
  const debut = source.indexOf('id="spotColorSelect"');
  if (debut < 0) throw new Error('#spotColorSelect introuvable');
  const bloc = source.slice(debut, source.indexOf('</select>', debut));

  const groupes = [];
  let groupe = null;
  const motifs = /<optgroup\s+label="([^"]*)"[^>]*>|<option\s+value="([^"]*)"[^>]*>([^<]*)<\/option>/g;
  let m;
  while ((m = motifs.exec(bloc)) !== null) {
    if (m[1] !== undefined) {
      groupe = { label: m[1].replace(/\s+/g, ' ').trim(), couleurs: [] };
      groupes.push(groupe);
    } else if (m[2] !== undefined) {
      if (!groupe) continue;
      const hex = m[2];
      if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) continue;      /* option vide « -- Sélectionner -- » */
      const nom = m[3].replace(/\s+/g, ' ').trim();
      if (!nom) continue;
      groupe.couleurs.push({ nom, hex: hex.toUpperCase() });
    }
  }

  /* Un seul livre : « Pantone », toutes les familles du catalogue. Le produit
     regroupe de la même façon (un <optgroup> = une famille, un livre = Pantone). */
  const familles = groupes.filter((g) => g.couleurs.length);
  if (!familles.length) return [];
  return [{ id: 'pantone', nom: 'Pantone', echantillon: 50, groupes: familles }];
}

/* ─────────────── 3. écriture du fichier de données ─────────────── */

function rendre(livres) {
  const lignes = [
    '# Nuanciers de SuperPrint — fichier ENGENDRÉ, ne pas modifier à la main.',
    '# Source : superprint/app/JS/swatchbooks.js (BOOKS) + superprint/app/index.html',
    '#          (#spotColorSelect). Relancer scripts/extract-swatchbooks.mjs.',
    '# Format : !livre<TAB>id<TAB>nom / !echantillon<TAB>n / !groupe<TAB>label',
    '#          !couleur<TAB>nom<TAB>#RRGGBB',
  ];
  let total = 0;
  for (const l of livres) {
    lignes.push(['!livre', l.id, l.nom].join('\t'));
    if (l.echantillon > 0) lignes.push(['!echantillon', String(l.echantillon)].join('\t'));
    for (const g of l.groupes) {
      lignes.push(['!groupe', g.label].join('\t'));
      for (const c of g.couleurs) {
        lignes.push(['!couleur', c.nom, c.hex].join('\t'));
        total++;
      }
    }
  }
  return { texte: lignes.join('\n') + '\n', total, livres };
}

const livres = [...livresDepuisSwatchbooks(), ...livresDepuisIndexHtml()]
  /* Un livre sans teinte ne dit rien : le nuancier « depuisSelect » de BOOKS
     (Pantone) est vide par construction — ses teintes vivent dans index.html. */
  .filter((l) => l.groupes.some((g) => g.couleurs.length));
const { texte, total } = rendre(livres);
mkdirSync(dirname(SORTIE), { recursive: true });
writeFileSync(SORTIE, texte, 'utf8');

console.log(`nuanciers : ${livres.length} livres, ${total} teintes`);
for (const l of livres) {
  const n = l.groupes.reduce((s, g) => s + g.couleurs.length, 0);
  console.log(`  ${l.id.padEnd(10)} ${String(n).padStart(4)} teintes  ${l.groupes.length} familles  (${l.nom})`);
}
console.log(`écrit : ${SORTIE}`);
