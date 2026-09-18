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
    /* 🆕 v1.7.480 : une SEULE page à la racine. `studio.html` (ancienne page du studio
       local) a été retiré : le studio de l'application, `public/superprint/sp213-studio.html`,
       tourne déjà en local (modèles WebLLM) comme en ligne (clé Groq). */
    rollupOptions: {
      input: {
        main: 'index.html'
      }
    }
  },
  optimizeDeps: {
    include: ['@mlc-ai/web-llm']
  }
});
