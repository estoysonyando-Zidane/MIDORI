import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Directive 06 §1: GitHub Pages serves a project site (not a user/org site)
// at https://<owner>.github.io/<repo>/, so every asset and fetch()'d path
// must be prefixed with '/<repo>/'. Overridable via VITE_BASE for local
// preview or a different host — defaults to '/' so `npm run dev` still
// serves from the root.
export default defineConfig({
  root: '.',
  publicDir: 'public',
  base: process.env.VITE_BASE ?? '/MIDORI/',
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Directive 09 §7: the 2D Spatial Index map view is a separate page
    // (`/map`), not a mode of the 3D World — a second Vite entry point.
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        map: resolve(__dirname, 'map.html'),
      },
    },
  },
});
