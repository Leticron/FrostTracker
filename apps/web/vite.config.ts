import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const api = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'FrostTracker',
        short_name: 'FrostTracker',
        description: 'Campaign and character tracker for your Frosthaven group',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only; API data and mounted game assets are always fetched from the network.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/trpc/, /^\/media\//, /^\/healthz/],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  server: {
    port: 5173,
    host: process.env.VITE_HOST ?? 'localhost',
    proxy: {
      '/trpc': api,
      '/media': api,
      '/healthz': api,
    },
  },
  build: { sourcemap: true },
});
