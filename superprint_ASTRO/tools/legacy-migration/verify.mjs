/**
 * Contrôle de non-régression : compare chaque page générée dans `dist/` avec son
 * original conservé dans `_legacy/`.
 *
 *   node tools/legacy-migration/verify.mjs
 *
 * Ce qui compte comme ÉCHEC :
 *   • ÉLÉMENTS — multiset des balises et de leurs attributs, hors `<script>` et
 *     `<style>` : rien de perdu, rien d'ajouté ;
 *   • TEXTE visible — identique ;
 *   • SCRIPTS — contenu en ligne identique (les scripts déplacés en fichier sont
 *     listés).
 *
 * Ce qui est signalé comme AVERTISSEMENT :
 *   • COMMENTAIRES — les composants partagés (barre quadri, bandeau, nav, pied)
 *     portent désormais un commentaire canonique unique, là où les pages
 *     d'origine avaient chacune leur variante ;
 *   • CSS — le texte des feuilles extraites (Astro peut réécrire `\r\n`).
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'parse5';

import { PAGES, ROOT, SOURCE_ROOT } from './pages.mjs';

const ORIGINAL_ROOT = SOURCE_ROOT;

const sha = (t) => createHash('sha1').update(t.replace(/\r\n/g, '\n'), 'utf8').digest('hex').slice(0, 10);

const parseDoc = (html) => parse(html, { sourceCodeLocationInfo: false });

function walk(node, visit) {
  visit(node);
  for (const child of node.childNodes ?? []) walk(child, visit);
}

const attrsOf = (node) =>
  (node.attrs ?? [])
    .map((a) => `${a.name}=${a.value}`)
    .sort()
    .join(' ');

/** Signature des ÉLÉMENTS : balises + attributs, hors script/style. */
function shape(doc) {
  const out = [];
  walk(doc, (n) => {
    if (!n.tagName || n.tagName === 'script' || n.tagName === 'style') return;
    out.push(`${n.tagName}[${attrsOf(n)}]`);
  });
  return out;
}

/** Commentaires du corps (hors <script>/<style>). */
function comments(doc) {
  const out = [];
  const visit = (n, raw) => {
    const inRaw = raw || n.tagName === 'script' || n.tagName === 'style';
    if (n.nodeName === '#comment' && !inRaw) {
      const t = (n.data ?? '').replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    }
    for (const c of n.childNodes ?? []) visit(c, inRaw);
  };
  visit(doc, false);
  return out;
}

function text(doc) {
  const parts = [];
  const visit = (n, raw) => {
    const inRaw = raw || n.tagName === 'script' || n.tagName === 'style';
    if (n.nodeName === '#text' && !inRaw) parts.push(n.value);
    for (const c of n.childNodes ?? []) visit(c, inRaw);
  };
  visit(doc, false);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Contenu de TOUS les scripts : ceux restés en ligne et ceux déplacés en
 * fichier. C'est cette liste qui doit être identique, sinon un script a été
 * perdu ou altéré en chemin.
 */
function scriptContents(doc) {
  const out = [];
  walk(doc, (n) => {
    if (n.tagName !== 'script') return;
    const src = (n.attrs ?? []).find((a) => a.name === 'src')?.value;
    const body = (n.childNodes ?? []).map((c) => c.value ?? '').join('');
    if (body.trim()) out.push(sha(body));
    if (src) {
      const rel = src.replace(/\?.*$/, '').replace(/^\//, '');
      const file = resolve(ROOT, 'public', rel);
      out.push(existsSync(file) ? sha(readFileSync(file, 'utf8')) : `MANQUANT:${rel}`);
    }
  });
  return out.sort();
}

function scripts(doc) {
  const inline = [];
  const sources = [];
  walk(doc, (n) => {
    if (n.tagName !== 'script') return;
    const src = (n.attrs ?? []).find((a) => a.name === 'src')?.value;
    const body = (n.childNodes ?? []).map((c) => c.value ?? '').join('');
    if (src) sources.push(src.replace(/\?v=.*$/, ''));
    if (body.trim()) inline.push(sha(body));
  });
  return { inline: inline.sort(), sources: sources.sort() };
}

function styleText(doc) {
  const parts = [];
  walk(doc, (n) => {
    if (n.tagName !== 'style') return;
    parts.push((n.childNodes ?? []).map((c) => c.value ?? '').join(''));
  });
  return parts.join('\n');
}

function counts(arr) {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

/** Ce que `a` contient en plus grande quantité que `b`. */
function missing(a, b) {
  const ca = counts(a);
  const cb = counts(b);
  const out = [];
  for (const [k, v] of ca) if ((cb.get(k) ?? 0) < v) out.push({ item: k, n: v - (cb.get(k) ?? 0) });
  return out;
}

function firstDiffs(a, b, limit = 3) {
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n && out.length < limit; i += 1) {
    if (a[i] !== b[i]) out.push({ i, orig: a[i], gen: b[i] });
  }
  return out;
}

let failures = 0;
let warnings = 0;

for (const page of PAGES) {
  const srcPath = resolve(ORIGINAL_ROOT, page.src);
  const outPath = resolve(ROOT, 'dist', `${page.route}.html`);
  if (!existsSync(srcPath) || !existsSync(outPath)) {
    console.log(`?? ${page.route} : fichier manquant`);
    failures += 1;
    continue;
  }

  const orig = parseDoc(readFileSync(srcPath, 'utf8'));
  const gen = parseDoc(readFileSync(outPath, 'utf8'));

  const elsOrig = shape(orig);
  const elsGen = shape(gen);
  const lostEls = missing(elsOrig, elsGen);
  const extraEls = missing(elsGen, elsOrig);
  const sameText = text(orig) === text(gen);
  const so = scripts(orig);
  const sg = scripts(gen);
  const sameScripts =
    JSON.stringify(scriptContents(orig)) === JSON.stringify(scriptContents(gen));
  const movedScripts = sg.sources.filter((x) => !so.sources.includes(x));
  const reordered = JSON.stringify(elsOrig) !== JSON.stringify(elsGen);
  const lostComments = missing(comments(orig), comments(gen));
  const extraComments = missing(comments(gen), comments(orig));

  const ok =
    lostEls.length === 0 && extraEls.length === 0 && sameText && sameScripts;
  if (!ok) failures += 1;
  if (lostComments.length || extraComments.length || reordered) warnings += 1;

  console.log(`${ok ? '✓' : '✗'} ${page.route}`);
  for (const l of lostEls.slice(0, 5)) console.log(`    ÉLÉMENT PERDU ×${l.n} : ${l.item.slice(0, 130)}`);
  for (const l of extraEls.slice(0, 3)) console.log(`    élément en plus ×${l.n} : ${l.item.slice(0, 130)}`);
  if (reordered) {
    for (const d of firstDiffs(elsOrig, elsGen, 2)) {
      console.log(`    ⚠ ordre #${d.i}\n       orig: ${(d.orig ?? '').slice(0, 120)}\n       géné: ${(d.gen ?? '').slice(0, 120)}`);
    }
  }
  if (!sameText) {
    const a = text(orig);
    const b = text(gen);
    let i = 0;
    while (i < Math.min(a.length, b.length) && a[i] === b[i]) i += 1;
    console.log(`    TEXTE différent @${i}`);
    console.log(`       orig: …${JSON.stringify(a.slice(Math.max(0, i - 50), i + 50))}`);
    console.log(`       géné: …${JSON.stringify(b.slice(Math.max(0, i - 50), i + 50))}`);
  }
  if (!sameScripts) console.log(`    SCRIPTS différents (en ligne + fichiers)`);
  if (movedScripts.length) console.log(`    scripts extraits → ${movedScripts.length} fichier(s)`);
  for (const c of lostComments.slice(0, 3)) console.log(`    ⚠ commentaire absent ×${c.n} : ${c.item.slice(0, 110)}`);
  for (const c of extraComments.slice(0, 3)) console.log(`    ⚠ commentaire ajouté ×${c.n} : ${c.item.slice(0, 110)}`);

  const so2 = styleText(orig).replace(/\s+/g, ' ').trim();
  const sg2 = styleText(gen).replace(/\s+/g, ' ').trim();
  if (so2 !== sg2) console.log(`    ⚠ CSS différent (normalisé) : ${so2.length} vs ${sg2.length} caractères`);
}

console.log(
  `${failures === 0 ? '✅ structure, texte et scripts conformes' : `❌ ${failures} page(s) en échec`}` +
    (warnings ? `\n⚠️  ${warnings} page(s) avec des écarts de commentaires (composants partagés)` : ''),
);
