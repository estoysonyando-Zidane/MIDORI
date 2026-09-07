import { defineConfig } from 'vite';

// Directive 06 §1: GitHub Pages serves a project site (not a user/org site)
// at https://<owner>.github.io/<repo>/, so every asset and fetch()'d path
// must be prefixed with '/<repo>/'. Overridable via VITE_BASE for local
// preview or a different host — defaults to '/' so `npm run dev` still
// serves from the root.
//
// Directive 09.1 §6: the separate `/map.html` page (Directive 09's own
// design mistake, per the PM) is retired — the Spatial Index overlay now
// lives inside the single 3D World, so this is back to a single-entry build.
export default defineConfig({
  root: '.',
  publicDir: 'public',
  base: process.env.VITE_BASE ?? '/MIDORI/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
