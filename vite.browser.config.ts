import { defineConfig } from 'vite';
// The browser host process (COD-261). playwright-core ships as-is in node_modules rather than bundled.
export default defineConfig({ build: { rollupOptions: { external: [/^node:/, 'playwright-core'], output: { entryFileNames: 'browser-host.js' } } } });
