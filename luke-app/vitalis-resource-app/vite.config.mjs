import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// My Vitalis Health dashboard (React) dev server. The Express API (server.js) is the
// source of truth and stays server-authoritative on :3100 — Vite only proxies to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
    proxy: {
      '/api': { target: 'http://localhost:3100', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
