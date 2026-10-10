/**
 * Modèle des métadonnées `<head>` du site.
 *
 * Chaque page historique répétait à la main ~30 balises (SEO, GEO, Open Graph,
 * Twitter, JSON-LD). Elles sont désormais décrites par un objet `Seo` que
 * `<Seo />` rend dans un ordre unique, et dont chaque champ est optionnel :
 * une page qui n'avait pas de `keywords` n'en émet toujours pas.
 */

export interface Hreflang {
  hreflang: string;
  href: string;
}

export interface OpenGraph {
  type?: string;
  url?: string;
  title?: string;
  description?: string;
  image?: string;
  imageWidth?: string;
  imageHeight?: string;
  imageType?: string;
  imageAlt?: string;
  siteName?: string;
  /** `og:locale`, puis `og:locale:alternate` pour les suivants. */
  locales?: string[];
}

export interface TwitterCard {
  card?: string;
  title?: string;
  description?: string;
  image?: string;
}

export interface Geo {
  region?: string;
  placename?: string;
  position?: string;
  /** Balise `<meta name="ICBM">`. */
  icbm?: string;
}

export interface ThemeColor {
  content: string;
  /** Sans `media`, la couleur s'applique partout (Safari ignore `media`). */
  media?: string;
}

export interface Seo {
  title: string;
  description?: string;
  keywords?: string;
  robots?: string;
  author?: string;
  applicationName?: string;
  /** Dans l'ordre : le dernier dont la condition `media` est vraie gagne. */
  themeColors?: ThemeColor[];
  geo?: Geo;
  language?: string;
  coverage?: string;
  distribution?: string;
  /** `<meta name="google" content="notranslate">`. */
  google?: string;
  canonical?: string;
  hreflangs?: Hreflang[];
  og?: OpenGraph;
  twitter?: TwitterCard;
  /** Blocs `application/ld+json`, passés tels quels (JSON déjà sérialisé). */
  jsonLd?: string[];
}
