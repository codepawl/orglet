import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  root: 'apps/desktop/src/renderer',
  plugins: [react(), tailwindcss()],
  // The kit is source in this repository, not a published package yet, so the renderer reads it straight from
  // packages/orglet-ui. The alias keeps the import name the one it will have once it is published.
  resolve: { alias: { '@codepawl/orglet-ui': fileURLToPath(new URL('packages/orglet-ui/src/index.ts', import.meta.url)) } },
  server: { host: '127.0.0.1' },
  build: { outDir: '../../../../.vite/renderer/main_window', emptyOutDir: true },
});
