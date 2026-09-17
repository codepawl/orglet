import { defineConfig } from 'vite';
export default defineConfig({ build: { rollupOptions: { external: [/^node:/, '@duckdb/node-api'], output: { entryFileNames: 'profiler.js' } } } });
