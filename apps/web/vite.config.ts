import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const THEME_COLOR = '#0f766e';
const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered in src/main.tsx
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Transit: shared autos, taxis & minibuses',
        short_name: 'Transit',
        description:
          'Plan trips on shared autos, taxis and minibuses, and see how busy each stand is.',
        lang: 'en-IN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: THEME_COLOR,
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Take control on the first visit, so the app opens offline even if the
        // commuter has only loaded it once (vite-plugin-pwa 2 no longer implies this).
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/health/],
        runtimeCaching: [
          {
            // Trip plans: fresh when online, last answer when offline or on a slow link.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/v1/plan'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-plan',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 30, maxAgeSeconds: 7 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Network shape (routes, nearby stops) changes rarely.
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/v1/routes') || url.pathname.startsWith('/api/v1/stops'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'api-network',
              expiration: { maxEntries: 60, maxAgeSeconds: 3 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Map style, tiles, fonts and sprites: areas you've seen keep rendering offline.
            urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org',
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 800, maxAgeSeconds: 14 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Stand status is live data: never served from cache (default NetworkOnly).
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': { target: API_URL, ws: true } },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: API_URL, ws: true } },
  },
});
