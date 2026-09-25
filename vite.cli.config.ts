import { defineConfig } from 'vite';
// The `orglet` terminal command (COD-234): Node only, one CommonJS file shipped in the app's resources.
export default defineConfig({ build: { rollupOptions: { external: [/^node:/], output: { entryFileNames: 'orglet-cli.cjs' } } } });
