import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import { resolve } from 'path'

const projectRoot = process.env.PROJECT_ROOT || import.meta.dirname

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(Date.now().toString()),
  },
  resolve: {
    alias: {
      '@': resolve(projectRoot, 'src')
    }
  },
  build: {
    sourcemap: false,  // Disabled for production — don't expose source code
    cssMinify: 'esbuild',  // Workaround: lightningcss can't parse TW 4.2 output (tailwindlabs/tailwindcss#19789)
  },
});
