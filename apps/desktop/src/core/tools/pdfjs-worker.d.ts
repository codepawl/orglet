/** pdf.js ships its worker module without types; the core only hands the module to pdf.js (pdf-extract.ts). */
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
