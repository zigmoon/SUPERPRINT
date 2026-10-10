/**
 * Sonde : compte, hors <style>/<script>/commentaires, les caractères que le
 * compilateur Astro interprète ({, }) et les `<` bruts susceptibles de casser
 * l'analyse HTML. Objectif : savoir si une passe d'échappement est nécessaire.
 *
 *   node tools/legacy-migration/probe.mjs
 */

import { blocks, bodyOf, escapeBraces, readText } from './lib.mjs';
import { PAGES, SOURCE_ROOT } from './pages.mjs';
import { resolve } from 'node:path';

function stripGuarded(html, tag) {
  let out = html;
  for (const b of blocks(html, tag).reverse()) {
    out = out.slice(0, b.start) + ' '.repeat(b.end - b.start) + out.slice(b.end);
  }
  return out;
}

function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
}

for (const page of PAGES) {
  const html = readText(resolve(SOURCE_ROOT, page.src));
  const body = bodyOf(html);
  let probe = stripGuarded(stripGuarded(stripComments(body), 'script'), 'style');
  const braces = (probe.match(/[{}]/g) || []).length;
  const lt = (probe.match(/</g) || []).length;
  const examples = [];
  for (const m of probe.matchAll(/[^\n]{0,40}[{}][^\n]{0,40}/g)) {
    examples.push(m[0].trim());
    if (examples.length >= 4) break;
  }
  console.log(`${page.route.padEnd(16)} braces=${String(braces).padStart(4)}  '<'=${String(lt).padStart(5)}  html-chars=${probe.length}`);
  for (const e of examples) console.log(`      • ${e}`);
  void escapeBraces;
}
