import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import { resolve } from 'path'

const projectRoot = process.env.PROJECT_ROOT || import.meta.dirname
const machineMode = process.env.VITE_MACHINE_MODE || 'proxy'

// Capacitor builds use direct transport but different base path than machine-hosted
const isCapacitor = machineMode === 'capacitor'
const isDirect = machineMode === 'direct' || isCapacitor

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PWA plugin — disabled: workbox/path-scurry lru-cache compat issue
    // TODO: re-enable once vite-plugin-pwa fixes LRUCache constructor error
  ],
  define: {
    __APP_VERSION__: JSON.stringify(Date.now().toString()),
  },
  resolve: {
    alias: {
      '@': resolve(projectRoot, 'src')
    }
  },
  // Machine-hosted builds: /meticai/ for Tornado static handler
  // Capacitor builds: / (served from local bundle)
  // Proxy builds: /
  base: machineMode === 'direct' ? '/meticai/' : '/',
  build: {
    sourcemap: false,
    cssMinify: 'esbuild',
    rolldownOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'recharts'
          if (id.includes('node_modules/framer-motion')) return 'framer-motion'
          // In direct/capacitor mode, bundle espresso-api + genai together
          if (isDirect) {
            if (id.includes('@meticulous-home/espresso-api') || id.includes('@meticulous-home/espresso-profile')) return 'machine-api'
            if (id.includes('@google/genai')) return 'genai'
          }
        },
      },
    },
  },
});
