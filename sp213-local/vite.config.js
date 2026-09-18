import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 5173,
    strictPort: false,   // ⚠️ si 5173 est occupé, Vite prend automatiquement le port suivant
    open: false,
    host: '127.0.0.1'
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
    /* 🆕 v1.7.480 : DEUX pages à la racine. Sans cette entrée, `npm run build` ne
       produisait que `dist/index.html` (le lanceur) et laissait `studio.html`
       (Studio IA hors ligne) hors du dossier de sortie. */
    rollupOptions: {
      input: {
        main: 'index.html',
        studio: 'studio.html'
      }
    }
  },
  optimizeDeps: {
    include: ['@mlc-ai/web-llm']
  }
});
