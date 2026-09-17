import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  root: 'apps/desktop/src/renderer',
  plugins: [react(), tailwindcss()],
  server: { host: '127.0.0.1' },
  build: { outDir: '../../../../.vite/renderer/main_window', emptyOutDir: true },
});
