import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Atelier — séances de foot',
        short_name: 'Atelier',
        description: 'Exercices animés, séances live et pages joueurs pour les éducateurs.',
        lang: 'fr',
        theme_color: '#f7f6f2',
        background_color: '#f7f6f2',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Lectures API : réseau d'abord, cache si hors-ligne (séance au bord du terrain).
            // Le flux temps réel (/api/live) ne passe jamais par le cache.
            urlPattern: ({ url, request }) => url.pathname.startsWith('/api/') && url.pathname !== '/api/live' && request.method === 'GET',
            handler: 'NetworkFirst',
            options: { cacheName: 'api', networkTimeoutSeconds: 4, expiration: { maxEntries: 300 } },
          },
        ],
      },
    }),
  ],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
});
