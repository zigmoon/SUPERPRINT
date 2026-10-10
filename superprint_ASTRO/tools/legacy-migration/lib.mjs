/**
 * Bibliothèque partagée du convertisseur « HTML legacy → Astro ».
 *
 * Le site SuperPrint historique est fait de pages HTML autonomes de plusieurs
 * centaines de kilo-octets : un <head> très riche (SEO/GEO/AEO), une grosse
 * feuille <style> et une dizaine de <script> en ligne. Ce module découpe ce
 * document en morceaux nommés, sans jamais réécrire le contenu (octets
 * préservés), pour que `convert.mjs` puisse le répartir dans la structure Astro.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function readText(file) {
  return readFileSync(file, 'utf8');
}

export function sha1(text) {
  return createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 12);
}

/** Position de la fin du `</head>` (borne de référence du document). */
export function headEnd(html) {
  const i = html.toLowerCase().indexOf('</head>');
  return i === -1 ? 0 : i + '</head>'.length;
}

/**
 * Contenu interne du `<head>`. On part de `<html>` pour ne pas confondre avec un
 * `<head>` cité dans un commentaire.
 */
export function headOf(html) {
  const start = /<head\b[^>]*>/i.exec(html);
  if (!start) return '';
  return html.slice(start.index + start[0].length, headEnd(html) - '</head>'.length);
}

/**
 * Contenu interne du `<body>`. On cherche la balise OUVERTE **après** `</head>` :
 * certains commentaires du head citent le mot `<body`, ce qui tromperait une
 * recherche naïve.
 */
export function bodyOf(html) {
  const from = headEnd(html);
  const open = /<body\b[^>]*>/i.exec(html.slice(from));
  if (!open) return '';
  const start = from + open.index + open[0].length;
  const end = html.toLowerCase().lastIndexOf('</body>');
  return html.slice(start, end === -1 ? html.length : end);
}

export function attr(tagText, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tagText)
    || new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i').exec(tagText);
  return m ? m[1] : null;
}

/**
 * Liste les blocs `<style>` ou `<script>` d'un fragment HTML avec leurs bornes,
 * afin de ne jamais toucher à leur contenu lors des réécritures.
 */
export function blocks(html, tag) {
  const out = [];
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, 'gi');
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      attrs: m[1],
      openTag: `<${tag}${m[1]}>`,
      content: m[2],
      raw: m[0],
    });
  }
  return out;
}

/**
 * Applique des remplacements sur les seules zones « hors <style>/<script> ».
 * Sert à échapper `{` et `}` (syntaxe d'expression Astro) sans abîmer le JS
 * ni le CSS, dont les accolades sont légitimes.
 */
export function mapOutside(html, fn) {
  const guards = [...blocks(html, 'script'), ...blocks(html, 'style')]
    .sort((a, b) => a.start - b.start);
  const parts = [];
  let cursor = 0;
  for (const g of guards) {
    if (g.start < cursor) continue;
    parts.push(fn(html.slice(cursor, g.start)));
    parts.push(g.raw);
    cursor = g.end;
  }
  parts.push(fn(html.slice(cursor)));
  return parts.join('');
}

export function escapeBraces(text) {
  return text.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
}

/** Extrait tous les <meta> du head sous forme d'objets. */
export function metaTags(head) {
  const out = [];
  const re = /<meta\b[^>]*>/gi;
  let m;
  while ((m = re.exec(head)) !== null) {
    const tag = m[0];
    out.push({
      raw: tag,
      name: attr(tag, 'name'),
      property: attr(tag, 'property'),
      content: attr(tag, 'content'),
      httpEquiv: attr(tag, 'http-equiv'),
      charset: /\bcharset\b/i.test(tag),
      media: attr(tag, 'media'),
      index: m.index,
    });
  }
  return out;
}

export function linkTags(head) {
  const out = [];
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(head)) !== null) {
    const tag = m[0];
    out.push({
      raw: tag,
      rel: attr(tag, 'rel'),
      href: attr(tag, 'href'),
      as: attr(tag, 'as'),
      type: attr(tag, 'type'),
      sizes: attr(tag, 'sizes'),
      hreflang: attr(tag, 'hreflang'),
      index: m.index,
    });
  }
  return out;
}

export function titleOf(head) {
  const m = /<title>([\s\S]*?)<\/title>/i.exec(head);
  return m ? m[1] : '';
}

export function jsonLd(head) {
  const out = [];
  const re = /<script\b([^>]*type="application\/ld\+json"[^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(head)) !== null) out.push({ attrs: m[1], content: m[2] });
  return out;
}
