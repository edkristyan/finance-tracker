import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built app works at any GitHub Pages path
  // (https://<user>.github.io/<repo>/) without hardcoding the repo name here.
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
