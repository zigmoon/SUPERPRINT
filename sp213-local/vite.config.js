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
    chunkSizeWarningLimit: 4096
  },
  optimizeDeps: {
    include: ['@mlc-ai/web-llm']
  }
});
