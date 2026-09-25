import { defineConfig } from 'vite';
// The worker thread the core reads PDFs in (COD-260): pdf.js and the page loop, one CommonJS file next to core.js.
export default defineConfig({ build: { rollupOptions: { external: [/^node:/], output: { entryFileNames: 'pdf-text.js', codeSplitting: false } } } });
