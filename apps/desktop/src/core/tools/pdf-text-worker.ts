import { parentPort, workerData } from 'node:worker_threads';
import { extractPdfPages } from './pdf-extract';
import type { PdfWorkerInput } from './pdf-text';

/**
 * The worker thread the core starts for each PDF it reads (COD-260). It gets the bytes of a file that already passed
 * the source checks, reads its text layer with pdf.js and posts the pages back; the core bounds its time and heap.
 */
async function readPdf() {
  const input = workerData as PdfWorkerInput;
  const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  const pages = await extractPdfPages(bytes, input.characterBudget);
  parentPort?.postMessage(pages);
}

void readPdf();
