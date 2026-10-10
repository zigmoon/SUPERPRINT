/**
 * Convertisseur « HTML historique → pages Astro ».
 *
 *   node tools/legacy-migration/convert.mjs
 *
 * Pour chaque page décrite dans `pages.mjs`, le script :
 *   1. répartit le `<head>` entre les props SEO du layout et le HTML résiduel ;
 *   2. extrait les feuilles `<style>` vers `src/styles/pages/<page>.css` ;
 *   3. extrait les `<script>` en ligne vers `public/JS/…` (partagés quand leur
 *      contenu est identique d'une page à l'autre) et référence le fichier ;
 *   4. remplace les blocs répétés du corps (barre quadri, bandeau, nav, pied de
 *      page) par leurs composants ;
 *   5. écrit `src/pages/<route>.astro`.
 *
 * Le contenu n'est jamais réécrit : seuls `{` et `}` hors `<script>`/`<style>`
 * sont encodés en entités, parce qu'Astro les lirait comme des expressions.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { decode } from 'entities';
import { parse, serialize } from 'parse5';

import { attr, blocks, bodyOf, escapeBraces, headOf, mapOutside, readText } from './lib.mjs';
import { PAGES, ROOT, SOURCE_ROOT, VERSION } from './pages.mjs';

const SRC = resolve(ROOT, 'src');
const PUBLIC = resolve(ROOT, 'public');

const sha1 = (t) => createHash('sha1').update(t, 'utf8').digest('hex').slice(0, 12);

/**
 * Scripts strictement identiques sur plusieurs pages → un seul fichier partagé.
 * Les empreintes sont calculées sur le contenu dont les fins de ligne ont été
 * normalisées en `\n` : c'est ce que fait le parseur HTML5, donc ce que voit
 * le convertisseur au moment de découper le corps.
 */
const SHARED_SCRIPTS = {
  '51b330ca0623': 'lang-switcher',
  '70f0d0d4ddce': 'tools-more',
  '72166aa98508': 'data-fold',
  '7b506cb4a538': 'templates-rail',
  'ef2110ac62ea': 'legal-popins',
  'a41d29203fee': 'anchor-open',
  'b35a920299ce': 'faq-filter',
  '6e20e37b0be6': 'contact-form',
  '5601ddcfc34e': 'sidebar-offset',
};

/** Noms lisibles des scripts propres à une page (sinon déduits du commentaire). */
const SCRIPT_NAMES = {
  ad517e379030: 'lang-switcher',
  '7845488de24b': 'bug-form',
  da17e2beaa2c: 'pay-pop',
  '1e49adcb5b01': 'lang-switcher',
  '9bd8806a07ae': 'rock-engine',
  '9661b521163d': 'mobile-menu-and-sidebar',
  '1bf834d6ca38': 'theme',
  '031c4a92eae2': 'installer-copy',
  '6ee3789953f1': 'studio-app',
};

const written = [];

function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
  written.push(file.replace(ROOT, '').replace(/\\/g, '/'));
}

/**
 * Ré-écrit le corps par le parseur HTML5 (celui des navigateurs) avant de le
 * confier à Astro.
 *
 * Les pages historiques contiennent des balises non refermées (`<div>` oublié
 * avant un `</details>`), que les navigateurs corrigent en silence mais qui
 * font échouer le compilateur Astro. On rejoue donc la même correction, en
 * analysant le fragment DANS un `<body>` réel pour que les règles de
 * construction de l'arbre soient exactement celles du navigateur.
 */
function normalizeBody(html) {
  const doc = parse(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`);
  const root = doc.childNodes.find((n) => n.tagName === 'html');
  const body = root.childNodes.find((n) => n.tagName === 'body');
  return serialize(body);
}

/**
 * Décode les entités des valeurs passées en props au layout.
 *
 * Les métadonnées historiques sont écrites pour du HTML (`Word &amp; IDML`) ;
 * Astro, lui, échappe ce qu'on lui donne en attribut. Sans décodage, `&amp;`
 * ressortait en `&amp;amp;` et la page affichait « &amp; » en clair.
 */
function decodeSeo(value) {
  if (typeof value === 'string') return decode(value);
  if (Array.isArray(value)) return value.map(decodeSeo);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decodeSeo(v)]));
  }
  return value;
}

/** Slug lisible tiré du premier commentaire d'un script (sinon `script-N`). */
function scriptSlug(content, index) {
  const head = content.slice(0, 400);
  const block = /\/\*([\s\S]{3,200}?)\*\//.exec(head) || /\/\/\s*(.{3,120})/.exec(head);
  const raw = block ? block[1] : '';
  const slug = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter((w) => w.length > 2 && !['les', 'des', 'une', 'the', 'sur', 'pour', 'avec'].includes(w))
    .slice(0, 4)
    .join('-');
  return slug || `script-${index}`;
}

/** `{` et `}` hors commentaires HTML uniquement. */
function escapeOutsideComments(text) {
  let out = '';
  let cursor = 0;
  const re = /<!--[\s\S]*?-->/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out += escapeBraces(text.slice(cursor, m.index)) + m[0];
    cursor = m.index + m[0].length;
  }
  return out + escapeBraces(text.slice(cursor));
}

/**
 * Compacte les blancs laissés par les balises extraites, sans jamais toucher au
 * contenu d'un `<script>` ni d'un `<style>` (leur mise en forme est du code).
 */
function tidy(text) {
  return mapOutside(text, (plain) =>
    plain.replace(/[ \t]+\r?\n/g, '\n').replace(/(\r?\n){3,}/g, '\n\n'),
  ).trim();
}

/* ───────────────────────────── HEAD ───────────────────────────── */

const TOKEN =
  /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<title\b[^>]*>[\s\S]*?<\/title>|<[a-zA-Z][^>]*>/g;

function splitHead(head) {
  const tokens = [];
  let last = 0;
  let m;
  while ((m = TOKEN.exec(head)) !== null) {
    if (m.index > last) tokens.push({ kind: 'text', raw: head.slice(last, m.index) });
    tokens.push({ kind: 'node', raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < head.length) tokens.push({ kind: 'text', raw: head.slice(last) });
  return tokens;
}

function analyseHead(head, page) {
  const tokens = splitHead(head);
  const seo = { title: '' };
  const jsonLd = [];
  const headExtra = [];
  const headTop = [];
  const css = [];

  const viewportAt = tokens.findIndex(
    (t) => t.kind === 'node' && /^<meta\b/i.test(t.raw) && /name="viewport"/i.test(t.raw),
  );

  const meta = (name, value) => {
    if (value == null || value === '') return;
    seo[name] = value;
  };

  for (const [i, token] of tokens.entries()) {
    const raw = token.raw;

    if (i < viewportAt) {
      // Avant le viewport : correctifs de premier rendu (studio). Tel quel,
      // sauf le charset que BaseLayout émet lui-même.
      if (token.kind === 'node' && /^<meta\b/i.test(raw) && /charset/i.test(raw)) continue;
      headTop.push(raw);
      continue;
    }

    if (token.kind === 'text') {
      headExtra.push(raw);
      continue;
    }

    // Marqueur de section du bloc SEO : le composant <Seo /> en émet un.
    if (token.kind === 'node' && /^<!--\s*[═=─-]{3,}\s*(SEO|GEO|AEO)/i.test(raw)) continue;

    if (/^<meta\b/i.test(raw)) {
      if (/charset/i.test(raw)) continue;
      if (/name="viewport"/i.test(raw)) continue;

      const name = attr(raw, 'name');
      const property = attr(raw, 'property');
      const content = attr(raw, 'content');

      if (property?.startsWith('og:')) {
        const og = (seo.og ??= {});
        if (property === 'og:locale') (og.locales ??= []).push(content);
        else if (property === 'og:locale:alternate') (og.locales ??= []).push(content);
        else {
          const key = {
            'og:type': 'type',
            'og:url': 'url',
            'og:title': 'title',
            'og:description': 'description',
            'og:image': 'image',
            'og:image:width': 'imageWidth',
            'og:image:height': 'imageHeight',
            'og:image:type': 'imageType',
            'og:image:alt': 'imageAlt',
            'og:site_name': 'siteName',
          }[property];
          if (key) og[key] = content;
          else headExtra.push(raw);
        }
        continue;
      }

      if (name?.startsWith('twitter:')) {
        const tw = (seo.twitter ??= {});
        const key = {
          'twitter:card': 'card',
          'twitter:title': 'title',
          'twitter:description': 'description',
          'twitter:image': 'image',
        }[name];
        if (key) tw[key] = content;
        else headExtra.push(raw);
        continue;
      }

      switch (name) {
        case 'description':
          meta('description', content);
          break;
        case 'keywords':
          meta('keywords', content);
          break;
        case 'robots':
          meta('robots', content);
          break;
        case 'author':
          meta('author', content);
          break;
        case 'application-name':
          meta('applicationName', content);
          break;
        case 'google':
          meta('google', content);
          break;
        case 'language':
          meta('language', content);
          break;
        case 'coverage':
          meta('coverage', content);
          break;
        case 'distribution':
          meta('distribution', content);
          break;
        case 'theme-color': {
          const media = attr(raw, 'media') || undefined;
          (seo.themeColors ??= []).push({ content, media });
          break;
        }
        case 'geo.region':
          (seo.geo ??= {}).region = content;
          break;
        case 'geo.placename':
          (seo.geo ??= {}).placename = content;
          break;
        case 'geo.position':
          (seo.geo ??= {}).position = content;
          break;
        case 'ICBM':
          (seo.geo ??= {}).icbm = content;
          break;
        default:
          headExtra.push(raw);
      }
      continue;
    }

    if (/^<title\b/i.test(raw)) {
      seo.title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)[1];
      continue;
    }

    if (/^<link\b/i.test(raw)) {
      const rel = (attr(raw, 'rel') || '').toLowerCase();
      const href = attr(raw, 'href');
      const hreflang = attr(raw, 'hreflang');
      if (rel === 'canonical') {
        seo.canonical = href;
        continue;
      }
      if (rel === 'alternate' && hreflang) {
        (seo.hreflangs ??= []).push({ hreflang, href });
        continue;
      }
      headExtra.push(raw);
      continue;
    }

    if (/^<script\b/i.test(raw) && /application\/ld\+json/i.test(raw)) {
      jsonLd.push(/<script[^>]*>([\s\S]*?)<\/script>/i.exec(raw)[1]);
      continue;
    }

    if (/^<script\b/i.test(raw)) {
      // Scripts d'en-tête (studio) : gardés en ligne, leur place compte.
      headExtra.push(raw);
      continue;
    }

    if (/^<style\b/i.test(raw)) {
      css.push(/<style[^>]*>([\s\S]*?)<\/style>/i.exec(raw)[1]);
      continue;
    }

    headExtra.push(raw);
  }

  if (!seo.title) throw new Error(`${page.src}: <title> introuvable`);
  seo.jsonLd = jsonLd;

  return {
    seo,
    headTop: tidy(headTop.join('')),
    headExtra: tidy(headExtra.join('')),
    css,
  };
}

/* ───────────────────────────── BODY ───────────────────────────── */

/** Éléments HTML sans contenu : ils ne doivent pas compter dans la profondeur. */const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

/**
 * Un commentaire placé en enfant DIRECT d'un composant est supprimé par le
 * compilateur Astro (`<!-- x -->` en tête de slot disparaît, mesuré). On le
 * réémet donc via `set:html`, qui traverse la compilation intact.
 *
 * Les marqueurs de section des pages historiques (`<!-- ═══ SIDEBAR ═══ -->`,
 * `<!-- _NAV_HERO_590 -->`…) sont donc conservés au lieu de s'évaporer.
 */
function protectTopLevelComments(markup) {
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  const out = [];
  let depth = 0;
  let last = 0;
  let m;
  while ((m = re.exec(markup)) !== null) {
    out.push(markup.slice(last, m.index));
    last = m.index + m[0].length;

    if (m[0].startsWith('<!--')) {
      out.push(depth === 0 ? `<Fragment set:html={${JSON.stringify(m[0])}} />` : m[0]);
      continue;
    }
    if (m[1]) depth = Math.max(0, depth - 1);
    else if (!/\/\s*>$/.test(m[0]) && !VOID_ELEMENTS.has(m[2].toLowerCase())) depth += 1;
    out.push(m[0]);
  }
  out.push(markup.slice(last));
  return out.join('');
}

/**
 * Remplace les blocs répétés du corps par des composants Astro et renvoie le
 * HTML découpé en deux : le contenu (slot par défaut) et ce qui suit le pied de
 * page (slot `after` — bouton WhatsApp, pop-ins légaux, scripts).
 */
function splitBody(body, page) {
  if (page.layout !== 'marketing') return { navNotes: '', content: body.trim(), after: '' };

  const navEnd = body.indexOf('</nav>');
  const footerStart = body.indexOf('<footer');
  const footerEnd = body.indexOf('</footer>');
  if (navEnd < 0 || footerStart < 0 || footerEnd < 0) {
    throw new Error(`${page.src}: blocs marketing introuvables`);
  }

  // Entre le bandeau de marque et la balise `<nav>` ne vivent que des
  // commentaires de repère (`<!-- _NAV_HERO_590 -->`) : on les remonte dans le
  // layout pour ne pas les perdre. Le titre de section « NAVIGATION » est déjà
  // émis par le composant `SiteNav`, on ne le duplique pas.
  const headerEnd = body.indexOf('</header>');
  const navStart = body.indexOf('<nav>');
  const navNotes =
    headerEnd >= 0 && navStart > headerEnd
      ? body
          .slice(headerEnd + '</header>'.length, navStart)
          .replace(/<!--\s*[═=─-]{3,}\s*NAVIGATION\s*[═=─-]{3,}\s*-->/i, '')
          .trim()
      : '';

  return {
    navNotes,
    content: body.slice(navEnd + '</nav>'.length, footerStart).trim(),
    after: body.slice(footerEnd + '</footer>'.length).trim(),
  };
}

/* ─────────────────────── ASSEMBLAGE D'UN FICHIER ─────────────────────── */

function renderMarkup(html, cssOut, routeSlug) {
  const guards = [...blocks(html, 'script'), ...blocks(html, 'style')].sort((a, b) => a.start - b.start);
  const parts = [];
  let cursor = 0;
  let scriptIndex = 0;

  for (const g of guards) {
    if (g.start < cursor) continue;
    parts.push(escapeOutsideComments(html.slice(cursor, g.start)));

    if (g.openTag.toLowerCase().startsWith('<style')) {
      cssOut.push(g.content);
      parts.push('');
    } else {
      const hasSrc = /\bsrc\s*=/i.test(g.attrs);
      const hash = sha1(g.content);
      const shared = !hasSrc && SHARED_SCRIPTS[hash];
      const named = !hasSrc && SCRIPT_NAMES[hash];

      if (hasSrc) {
        // Déjà externe : on ne touche qu'à la façon dont Astro le lit.
        const attrs = g.attrs.replace(/\bis:inline\b/i, '').trim();
        parts.push(`<script is:inline${attrs ? ` ${attrs}` : ''}>${g.content}</script>`);
      } else {
        const file = shared
          ? `JS/marketing/${shared}.js`
          : `JS/pages/${routeSlug}/${scriptIndex}-${named || scriptSlug(g.content, scriptIndex)}.js`;
        write(join(PUBLIC, file), g.content);
        const attrs = g.attrs.trim();
        parts.push(`<script is:inline${attrs ? ` ${attrs}` : ''} src="/${file}?v=${VERSION}"></script>`);
        scriptIndex += 1;
      }
    }
    cursor = g.end;
  }
  parts.push(escapeOutsideComments(html.slice(cursor)));
  return parts.join('');
}

/* ─────────────────────────────── PAGE ─────────────────────────────── */

function renderPage(page) {
  const html = readText(resolve(SOURCE_ROOT, page.src));
  const routeSlug = page.route.replace(/\//g, '-');
  /** Profondeur du fichier de page : `supertypo/index` → `../../`. */
  const up = '../'.repeat(page.route.split('/').length);
  const { seo, headTop, headExtra, css } = analyseHead(headOf(html), page);
  const { navNotes, content, after } = splitBody(normalizeBody(bodyOf(html)), page);
  // Les URL et le JSON-LD ne passent pas par l'échappement d'Astro.
  const decodedSeo = {
    ...decodeSeo({ ...seo, jsonLd: undefined }),
    jsonLd: seo.jsonLd,
  };

  const cssOut = [...css];
  const bodyContent = protectTopLevelComments(renderMarkup(content, cssOut, routeSlug));
  const bodyAfter = after
    ? protectTopLevelComments(renderMarkup(after, cssOut, routeSlug))
    : '';

  if (cssOut.length) {
    write(join(SRC, 'styles', 'pages', `${routeSlug}.css`), `${cssOut.map((c) => c.trim()).join('\n\n')}\n`);
  }

  const imports = cssOut.length ? `import '${up}styles/pages/${routeSlug}.css';` : '';
  const seoLiteral = `const seo = ${JSON.stringify(decodedSeo, null, 2)};`;

  const frontmatter = [
    '---',
    '/*',
    ` * ⚠️ Fichier généré par tools/legacy-migration/convert.mjs.`,
    ` * Source d'origine : ${page.src} (conservée dans _legacy/).`,
    ' * Modifier la page ici, puis retirer la source de la liste de conversion.',
    ' */',
  ].join('\n');

  let body;
  if (page.layout === 'marketing') {
    const props = [
      'seo={seo}',
      `active={${JSON.stringify(page.active)}}`,
      `logoHref=${JSON.stringify(page.logoHash)}`,
      `featuresHref=${JSON.stringify(page.featuresHref ?? 'index.html#features')}`,
    ];
    if (page.brand) props.push('brand={brand}');
    if (page.footer) props.push('footer={footer}');
    if (navNotes) props.push('navNotes={navNotes}');
    if (page.bodyClass) props.push(`bodyClass=${JSON.stringify(page.bodyClass)}`);
    if (headTop) props.push('headTop={headTop}');
    if (headExtra) props.push('headExtra={headExtra}');
    body = `<MarketingLayout
  ${props.join('\n  ')}
>
${bodyContent}
<Fragment slot="after">
${bodyAfter}
</Fragment>
</MarketingLayout>`;
  } else {
    const props = ['seo={seo}'];
    if (page.lang && page.lang !== 'en') props.push(`lang=${JSON.stringify(page.lang)}`);
    if (page.translate) props.push('translate');
    if (page.bodyClass) props.push(`bodyClass=${JSON.stringify(page.bodyClass)}`);
    if (headTop) props.push('headTop={headTop}');
    if (headExtra) props.push('headExtra={headExtra}');
    body = `<MinimalLayout
  ${props.join('\n  ')}
>
${bodyContent}
</MinimalLayout>`;
  }

  const layoutImport =
    page.layout === 'marketing'
      ? `import MarketingLayout from '${up}layouts/MarketingLayout.astro';`
      : `import MinimalLayout from '${up}layouts/MinimalLayout.astro';`;

  const extras = [];
  if (headTop) extras.push(`const headTop = ${JSON.stringify(headTop)};`);
  if (headExtra) extras.push(`const headExtra = ${JSON.stringify(headExtra)};`);
  // `as const` : sans lui, `legal: "overlays"` serait élargi en `string` et ne
  // satisferait plus l'union `FooterLegal` du layout (erreur astro check).
  if (page.brand) extras.push(`const brand = ${JSON.stringify(page.brand, null, 2)} as const;`);
  if (page.footer) extras.push(`const footer = ${JSON.stringify(page.footer, null, 2)} as const;`);
  if (navNotes) extras.push(`const navNotes = ${JSON.stringify(navNotes)};`);

  const file = [
    frontmatter,
    layoutImport,
    ...(imports ? [imports] : []),
    '',
    seoLiteral,
    ...(extras.length ? ['', ...extras] : []),
    '---',
    '',
    body,
    '',
  ].join('\n');

  write(join(SRC, 'pages', `${page.route}.astro`), file);
  return {
    seo,
    css: cssOut.length,
    scripts: (bodyContent + bodyAfter).split('<script is:inline').length - 1,
  };
}

/* ─────────────────────────────── MAIN ─────────────────────────────── */

let total = 0;
// Les scripts extraits sont régénérés à chaque passage : on vide d'abord, sinon
// un script renommé laisserait son ancien fichier derrière lui.
rmSync(join(PUBLIC, 'JS', 'marketing'), { recursive: true, force: true });
rmSync(join(PUBLIC, 'JS', 'pages'), { recursive: true, force: true });
for (const page of PAGES) {
  const r = renderPage(page);
  total += 1;
  console.log(
    `  ✓ ${page.route.padEnd(18)} titre=${JSON.stringify(r.seo.title.slice(0, 46))} styles=${r.css} scripts=${r.scripts}`,
  );
}
console.log(`\n${total} pages écrites, ${written.length} fichiers au total.`);
