import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The SPA is served same-origin with the API behind `/api` in every
 * environment. In development Vite proxies to the API container, which keeps
 * the browser origin identical to production and means CORS never has to be
 * relaxed for local work.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
});
