import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Keeps the hashed bundles of previous builds (14 days) in node_modules/.cache/kcs-web-assets.
 * The API serves them when a file is missing from dist/assets, so a tab still running the old version
 * can lazy-load its pages and icons instead of showing a blank page until it reloads.
 */
function keepPreviousAssets(): Plugin {
  const dist = fileURLToPath(new URL('./dist/assets', import.meta.url));
  const archive = fileURLToPath(new URL('../../node_modules/.cache/kcs-web-assets', import.meta.url));
  const maxAge = 14 * 24 * 3600_000;
  return {
    name: 'kcs-keep-previous-assets',
    apply: 'build',
    buildStart() {
      try {
        if (!existsSync(dist)) return;
        mkdirSync(archive, { recursive: true });
        cpSync(dist, archive, { recursive: true, force: false, errorOnExist: false });
        const prune = (dir: string) => {
          for (const name of readdirSync(dir)) {
            const f = join(dir, name);
            const st = statSync(f);
            if (st.isDirectory()) prune(f);
            else if (Date.now() - st.mtimeMs > maxAge) rmSync(f, { force: true });
          }
        };
        prune(archive);
      } catch (e) {
        this.warn(`could not archive previous assets: ${(e as Error).message}`);
      }
    },
  };
}

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Tailwind v4 runs as a Vite plugin; an inline (empty) PostCSS config stops Vite from picking up
  // the company website's postcss.config.js in the repository root.
  css: { postcss: {} },
  plugins: [
    keepPreviousAssets(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'KCS ERP - Karya Cipta Solusi',
        short_name: 'KCS ERP',
        description: 'Business management suite: marketing, sales, purchase, inventory, accounting, HR and reports',
        theme_color: '#1e40af',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only. Business data (API) is never cached - always fresh and never stored on the device.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['assets/icons/**'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // the new worker takes control of open tabs as soon as the user accepts an update
        clientsClaim: true,
        // API requests are not routed through the service worker at all: never cached, and the long-lived
        // notification stream (SSE) does not keep the old worker busy, which would delay activating an update
        runtimeCaching: [
          { urlPattern: ({ url }) => url.pathname.startsWith('/assets/icons/'), handler: 'CacheFirst', options: { cacheName: 'icons', expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 } } },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        chunkFileNames: (chunk) => (chunk.moduleIds.some((m) => m.includes('lucide-react/dist/esm/icons')) ? 'assets/icons/[name]-[hash].js' : 'assets/[name]-[hash].js'),
        manualChunks: (id) => {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'charts';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          return undefined;
        },
      },
    },
  },
});
