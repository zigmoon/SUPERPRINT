import { defineConfig } from 'astro/config';

/**
 * SuperPrint — configuration Astro.
 *
 * Le site était une collection de pages HTML autonomes servies telles quelles
 * (`/index.html`, `/faq.html`, `/app/index.html`…). Astro reprend la main sur
 * leur génération, mais les URL publiées ne doivent PAS bouger : c'est ce que
 * fait `build.format: 'preserve'`, qui reproduit l'arborescence des sources
 * (`src/pages/faq.astro` → `/faq.html`, `src/pages/supertypo/index.astro` →
 * `/supertypo/index.html`).
 */
export default defineConfig({
  site: 'https://superprint.cc',
  srcDir: 'src',
  publicDir: 'public',
  outDir: 'dist',

  build: {
    // Conserve la forme des URL d'origine : /faq.html et non /faq/index.html.
    format: 'preserve',
    // Les pages embarquent leur CSS dans le <head>, comme avant la migration.
    inlineStylesheets: 'always',
  },

  // Le HTML historique contient des commentaires de travail et un espacement
  // significatif entre <span> de langue : on ne touche à rien.
  compressHTML: false,

  trailingSlash: 'ignore',

  devToolbar: { enabled: false },

  server: { host: true, port: 4321 },

  vite: {
    build: {
      // Les gros binaires (modèles WebLLM, archive locale, ICC) sont servis
      // depuis public/ : Vite ne doit pas tenter de les insérer en base64.
      assetsInlineLimit: 0,
      // Les feuilles extraites des pages sont livrées telles quelles : la
      // minification d'esbuild réécrit la cascade CSS historique, qu'on ne
      // veut pas voir bouger d'un pouce.
      cssMinify: false,
    },
  },
});
