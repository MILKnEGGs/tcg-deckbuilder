import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // Relative URLs so the same build works at a site root or under a subpath
  // (this app is served from https://<user>.github.io/tcg-deckbuilder/destiny/).
  base: './',
  build: { outDir: '../../dist/destiny', emptyOutDir: true },
  // Visual Studio keeps files under .vs locked, which breaks the file watcher; obj/bin are its build output.
  server: { watch: { ignored: ['**/.vs/**', '**/obj/**', '**/bin/**'] } },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    svelte(),
    VitePWA({
      // 'prompt': a new version (including the daily price refresh) downloads in the background,
      // and the app shows an "Update ready" banner instead of reloading mid-edit.
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'icon.svg'],
      manifest: {
        name: "Milk's Destiny Deck Builder",
        short_name: "Milk's Destiny",
        description: 'Star Wars Destiny team and deck builder with ARH formats, dice and TCGplayer prices',
        theme_color: '#061416',
        background_color: '#061416',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app and the card list so search and deck editing work fully offline.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,json}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // Card images are deliberately not stored by the app: they load like any website's images and the
        // browser's own cache keeps and clears them as space allows.
      },
    }),
  ],
});
