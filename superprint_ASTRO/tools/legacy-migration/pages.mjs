/**
 * Inventaire des pages historiques à convertir, et de leur destination Astro.
 *
 * `layout`    : `marketing` (barre quadri + bandeau + nav + pied) ou `minimal`
 * `active`    : entrée de nav à marquer `active` (null = aucune)
 * `logoHash`  : cible de l'ancre du logo (`#hero` sur la landing, `index.html` ailleurs)
 * `brand`     : variante du bandeau de marque (voir `src/lib/layout.ts`)
 * `footer`    : variante du pied de page (voir `src/lib/layout.ts`)
 * `lang` / `translate` / `bodyClass` : attributs de `<html>` et `<body>`
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Racine des sources HTML d'origine.
 *
 * Les pages historiques sont conservées dans `_legacy/` (ignoré par Git, comme
 * le documente `.gitignore`) : c'est l'entrée de `convert.mjs` et la référence
 * de comparaison de `verify.mjs`. Elles ne sont ni servies ni construites.
 */
export const SOURCE_ROOT = resolve(ROOT, '_legacy');

/** Version publiée, reprise de `version.txt`. */
export const VERSION = '1.7.669';

const NAV_HEADING = { fr: 'Navigation', en: 'Navigation', ja: 'ナビゲーション' };
const DESK_HEADING = { fr: 'Bureau SuperPrint', en: 'The SuperPrint desk', ja: 'SuperPrint デスク' };

export const PAGES = [
  {
    src: 'index.html',
    route: 'index',
    layout: 'marketing',
    active: null,
    logoHash: '#hero',
    featuresHref: '#features',
    footer: {
      faqHref: 'faq.html',
      featuresHref: '#features',
      authorsHref: '#auteurs',
      heading: NAV_HEADING,
      legal: 'overlays',
    },
  },
  {
    src: 'faq.html',
    route: 'faq',
    layout: 'marketing',
    active: 'faq.html',
    logoHash: 'index.html',
    featuresHref: 'index.html#features',
    footer: {
      faqHref: '#faq',
      featuresHref: '#features',
      authorsHref: '#auteurs',
      heading: NAV_HEADING,
      legal: 'overlays',
    },
  },
  {
    src: 'price.html',
    route: 'price',
    layout: 'marketing',
    active: 'price.html',
    logoHash: '#hero',
    featuresHref: 'index.html#features',
    footer: {
      faqHref: 'faq.html',
      featuresHref: 'index.html#features',
      authorsHref: 'index.html#auteurs',
      heading: DESK_HEADING,
      pressKit: true,
      legal: 'anchors',
    },
  },
  {
    src: 'rock.html',
    route: 'rock',
    layout: 'marketing',
    active: 'rock.html',
    logoHash: 'index.html',
    featuresHref: 'index.html#features',
    brand: {
      ariaLabel: 'SuperPrint — Accueil',
      /* ⚠️ v1.7.669 — PLUS DE VERSION EN DUR ICI. La valeur était figée à
         « 1.7.591 » et le bump ne la voyait pas (il remplace la version
         COURANTE, pas une version périmée) : la page ROCK affichait donc une
         version vieille de 69 livraisons, quand `rock.html` — la source —
         affichait la bonne. `BrandHeader` et `SiteFooter` retombent sur
         `VERSION` (src/data/site.ts), que le bump met à jour : la valeur ne
         peut plus diverger. */
      tag: { fr: 'Notre moteur', en: 'Our engine', ja: '私たちのエンジン' },
    },
    footer: {
      faqHref: 'faq.html',
      featuresHref: 'index.html#features',
      authorsHref: null,
      heading: NAV_HEADING,
      pressKit: true,
      legal: 'anchors',
    },
  },
  {
    src: 'documentation.html',
    route: 'documentation',
    layout: 'minimal',
  },
  {
    src: 'api.html',
    route: 'api',
    layout: 'minimal',
    bodyClass: 'lang-en',
  },
  {
    src: 'install.html',
    route: 'install',
    layout: 'minimal',
    translate: true,
  },
  {
    src: 'sp213-studio.html',
    route: 'sp213-studio',
    layout: 'minimal',
    translate: true,
  },
  {
    src: 'supertypo/index.html',
    route: 'supertypo/index',
    layout: 'minimal',
    translate: true,
  },
];
