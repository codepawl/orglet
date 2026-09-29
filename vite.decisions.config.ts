import { defineConfig } from 'vite';
// The worker thread Tacet runs in (COD-303): the tokenizer, packing and decoding in one CommonJS file next to core.js.
// ONNX Runtime's native addon stays outside the bundle and is loaded from node_modules (unpacked from the asar).
export default defineConfig({ build: { rollupOptions: { external: [/^node:/, 'onnxruntime-node'], output: { entryFileNames: 'decisions.js', codeSplitting: false } } } });
