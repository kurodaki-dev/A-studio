import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// A Voice Studio: a separate app (its own page, code, themes and plugins), built to
// voice/dist. The Android extension APK is made from it, and the web build is copied
// to dist/voice/ for GitHub Pages.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || pkg.version),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
});
