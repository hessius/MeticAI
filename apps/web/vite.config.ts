import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import { resolve } from 'path'
import { VitePWA } from 'vite-plugin-pwa'

const projectRoot = process.env.PROJECT_ROOT || import.meta.dirname
const machineMode = process.env.VITE_MACHINE_MODE || 'proxy'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PWA plugin — only active in machine (direct) builds
    ...(machineMode === 'direct'
      ? [
          VitePWA({
            registerType: 'autoUpdate',
            workbox: {
              globPatterns: ['**/*.{js,css,html,ico,svg,json}'],
              globIgnores: ['**/manifest.json'],
              maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
              runtimeCaching: [
                {
                  // Machine API: network-first with 5s timeout
                  urlPattern: /\/api\/v1\//,
                  handler: 'NetworkFirst',
                  options: {
                    cacheName: 'machine-api',
                    networkTimeoutSeconds: 5,
                    expiration: { maxEntries: 100, maxAgeSeconds: 3600 },
                  },
                },
              ],
            },
            manifest: {
              name: 'MeticAI',
              short_name: 'MeticAI',
              description: 'AI-powered Meticulous Espresso Controller',
              theme_color: '#1a1a2e',
              background_color: '#1a1a2e',
              display: 'standalone',
              start_url: '/meticai/',
              scope: '/meticai/',
              icons: [
                { src: '/meticai/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
                { src: '/meticai/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
                { src: '/meticai/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
              ],
            },
          }),
        ]
      : []),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(Date.now().toString()),
  },
  resolve: {
    alias: {
      '@': resolve(projectRoot, 'src')
    }
  },
  // Machine builds set base path for Tornado's /meticai/ static handler
  base: machineMode === 'direct' ? '/meticai/' : '/',
  build: {
    sourcemap: false,
    cssMinify: 'esbuild',
    rolldownOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'recharts'
          if (id.includes('node_modules/framer-motion')) return 'framer-motion'
          // In direct mode, bundle espresso-api + genai together
          if (machineMode === 'direct') {
            if (id.includes('@meticulous-home/espresso-api') || id.includes('@meticulous-home/espresso-profile')) return 'machine-api'
            if (id.includes('@google/genai')) return 'genai'
          }
        },
      },
    },
  },
});
