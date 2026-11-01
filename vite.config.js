import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Relative base so the same build works in the Android app and on GitHub Pages.
// APP_VERSION and APP_BUILD come from the release workflow.
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || pkg.version),
    __APP_BUILD__: JSON.stringify(Number(process.env.APP_BUILD || 0)),
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
});
