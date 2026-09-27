import { defineConfig } from 'vite';
import { resolveOsxSign } from './forge.macos';
export default defineConfig({
  // Whether this macOS build is Developer ID signed is decided at make time, and Squirrel.Mac refuses an unsigned
  // app, so the updater learns it from the same flag the signing step reads (COD-176).
  // An update test build (COD-304) is asked for at make time too, and a normal build always compiles it out.
  define: {
    ORGLET_MACOS_SIGNED: JSON.stringify(resolveOsxSign() !== undefined),
    ORGLET_UPDATE_TEST_BUILD: JSON.stringify(process.env.ORGLET_UPDATE_TEST_BUILD === '1'),
  },
  build: { rollupOptions: { external: ['electron', /^node:/], output: { entryFileNames: 'main.js' } } },
});
