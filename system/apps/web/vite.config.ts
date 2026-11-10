import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Tailwind v4 runs as a Vite plugin; an inline (empty) PostCSS config stops Vite from picking up
  // the company website's postcss.config.js in the repository root.
  css: { postcss: {} },
  plugins: [
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
        runtimeCaching: [
          { urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' },
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
