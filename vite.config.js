import { defineConfig } from 'vite';

// Relative base so the same build works in the Android app and on GitHub Pages.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
});
