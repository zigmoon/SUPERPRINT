/**
 * Affiche le <head> de chaque page historique, <style>/<script>/commentaires
 * retirés, afin de concevoir les props du layout Astro (SEO, icônes, préchargements).
 *
 *   node tools/legacy-migration/head-dump.mjs [route…]
 */

import { blocks, headEnd, headOf, readText } from './lib.mjs';
import { PAGES, ROOT } from './pages.mjs';
import { resolve } from 'node:path';

const wanted = process.argv.slice(2);
const list = wanted.length ? PAGES.filter((p) => wanted.includes(p.route)) : PAGES;

for (const page of list) {
  const html = readText(resolve(ROOT, page.src));
  const head = headOf(html);
  const guards = [...blocks(head, 'script'), ...blocks(head, 'style')].sort((a, b) => a.start - b.start);
  const parts = [];
  let cursor = 0;
  for (const g of guards) {
    parts.push(head.slice(cursor, g.start));
    parts.push(`\n<!-- [${g.raw.slice(0, 40).replace(/\s+/g, ' ')}… ${g.content.length} o] -->\n`);
    cursor = g.end;
  }
  parts.push(head.slice(cursor));
  const clean = parts.join('')
    .replace(/<!--(?!\s*\[)[\s\S]*?-->/g, '')
    .replace(/\n\s*\n+/g, '\n');
  console.log(`\n########## ${page.route} — <html> =\n${(html.match(/<html[^>]*>/) || [''])[0]}`);
  console.log(clean.trim());
}
void headEnd;
