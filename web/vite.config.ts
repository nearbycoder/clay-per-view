import { resolve } from 'node:path';

import { defineConfig } from 'vite';

// Two pages: the website (index.html) and the game (play/index.html). Relative URLs throughout, so the
// build works from any folder - GitHub Pages serves it from /<repository>/.
export default defineConfig({
  base: './',
  build: {
    assetsDir: 'bundle',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        site: resolve(import.meta.dirname, 'index.html'),
        play: resolve(import.meta.dirname, 'play/index.html'),
      },
    },
  },
  server: { port: 5199, strictPort: true },
  preview: { port: 5198, strictPort: true },
});
