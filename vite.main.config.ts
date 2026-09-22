import { defineConfig } from 'vite';
import { resolveOsxSign } from './forge.macos';
export default defineConfig({
  // Whether this macOS build is Developer ID signed is decided at make time, and Squirrel.Mac refuses an unsigned
  // app, so the updater learns it from the same flag the signing step reads (COD-176).
  define: { ORGLET_MACOS_SIGNED: JSON.stringify(resolveOsxSign() !== undefined) },
  build: { rollupOptions: { external: ['electron', /^node:/], output: { entryFileNames: 'main.js' } } },
});
