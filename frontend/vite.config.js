import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In production nginx serves the site and forwards these paths to the backend on the same
// origin (see nginx.conf), so src/lib/api.js calls window.location.origin. The dev server
// does the same forwarding here; override the target with DEV_API_TARGET if needed.
const apiTarget = process.env.DEV_API_TARGET || 'http://localhost:4000';
const apiProxy = Object.fromEntries(
  ['/auth', '/users', '/wallet', '/tables', '/health'].map((path) => [path, { target: apiTarget, changeOrigin: true }]),
);

export default defineConfig({
  plugins: [react()],
  envDir: '..',
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      ...apiProxy,
      '/ws': { target: apiTarget.replace(/^http/, 'ws'), ws: true, changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    proxy: apiProxy,
  },
});
