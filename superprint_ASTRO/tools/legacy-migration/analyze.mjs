/**
 * Analyse des pages HTML historiques : recense les <meta>, <link>, <style> et
 * <script> avec leur position (head/body), et signale les blocs strictement
 * identiques d'une page à l'autre (candidats à devenir des fichiers partagés).
 *
 *   node tools/legacy-migration/analyze.mjs
 */

import { blocks, bodyOf, headEnd, headOf, linkTags, metaTags, readText, sha1, titleOf } from './lib.mjs';
import { PAGES, SOURCE_ROOT } from './pages.mjs';
import { resolve } from 'node:path';

const seen = new Map();
const report = [];

for (const page of PAGES) {
  const html = readText(resolve(SOURCE_ROOT, page.src));
  const head = headOf(html);
  const body = bodyOf(html);
  const limit = headEnd(html);

  const styles = [
    ...blocks(head, 'style').map((s) => ({ content: s.content, where: 'head' })),
    ...blocks(body, 'style').map((s) => ({
      content: s.content,
      where: html.indexOf(s.raw, limit) < limit ? 'head' : 'body',
    })),
  ];
  const scripts = [
    ...blocks(head, 'script').map((s) => ({ content: s.content, attrs: s.attrs, where: 'head' })),
    ...blocks(body, 'script').map((s) => ({
      content: s.content,
      attrs: s.attrs,
      where: html.indexOf(s.raw, limit) < limit ? 'head' : 'body',
    })),
  ];

  const entries = [];
  for (const [i, s] of styles.entries()) {
    const h = sha1(s.content);
    entries.push({ kind: 'style', i, hash: h, len: s.content.length, where: s.where });
    if (!seen.has(h)) seen.set(h, []);
    seen.get(h).push(`${page.route}#style${i}`);
  }
  for (const [i, s] of scripts.entries()) {
    const h = sha1(s.content);
    const isLd = /application\/ld\+json/i.test(s.attrs);
    entries.push({
      kind: isLd ? 'ld+json' : 'script',
      i,
      hash: h,
      len: s.content.length,
      where: s.where,
      src: /\bsrc=/i.test(s.attrs),
    });
    if (!isLd) {
      if (!seen.has(h)) seen.set(h, []);
      seen.get(h).push(`${page.route}#script${i}`);
    }
  }

  report.push({
    route: page.route,
    src: page.src,
    bytes: html.length,
    title: titleOf(head).slice(0, 70),
    metas: metaTags(head).length,
    links: linkTags(head).length,
    entries,
  });
}

for (const r of report) {
  console.log(`\n=== ${r.route}  (${r.src}, ${(r.bytes / 1024).toFixed(0)} ko, ${r.metas} metas, ${r.links} links)`);
  console.log(`    title: ${r.title}`);
  for (const e of r.entries) {
    console.log(`    ${e.kind.padEnd(8)} #${String(e.i).padStart(2)} ${e.where.padEnd(4)} ${String(e.len).padStart(7)}o ${e.hash}${e.src ? ' [src]' : ''}`);
  }
}

console.log('\n\n═══ Blocs PARTAGÉS (≥ 2 pages) ═══');
for (const [hash, where] of seen) {
  const pages = new Set(where.map((w) => w.split('#')[0]));
  if (pages.size > 1) console.log(`  ${hash}  ${where.join(', ')}`);
}
