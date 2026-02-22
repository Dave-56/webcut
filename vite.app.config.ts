import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Vite config for building the dev/demo app as a static SPA (e.g. for Vercel).
 * Use: pnpm run build:app
 */
export default defineConfig({
  plugins: [vue()],
  optimizeDeps: {
    entries: [resolve(__dirname, 'index.html')],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
});
