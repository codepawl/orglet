import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { TEXT_SOURCE_LIMIT } from '../../shared/source-kinds';

/**
 * What pdf.js found in a PDF: how many pages it has and the text of the pages it read, in order. `failure` says the file
 * could not be opened at all: it has a password, or it is damaged, too large or too slow to read within the limits.
 */
export const PdfPages = z.object({
  pageCount: z.number().int().nonnegative(),
  pages: z.array(z.string()),
  failure: z.enum(['password', 'unreadable']).optional(),
}).strict();
export type PdfPages = z.infer<typeof PdfPages>;

/** Reads the text layer of a PDF whose bytes already passed the source checks. */
export type PdfTextExtractor = (bytes: Uint8Array, signal?: AbortSignal) => Promise<PdfPages>;

/** A PDF as a worker is given it, with the counts the runner reports in the chat's activity. */
export type PdfText = { text: string; pageCount: number; pagesWithText: number; cutAfterPage: number | null; failure?: PdfPages['failure'] };

/**
 * Pages are read until this much text has come out. It matches the source limit: a character is at least one byte, so
 * this always reads enough to fill the limit and never reads the rest of a very long PDF.
 */
export const PDF_CHARACTER_BUDGET = TEXT_SOURCE_LIMIT;

/** Longer than a normal PDF needs, and shorter than read_source's own 20-second deadline, so a slow file is a note, not a failed run. */
export const PDF_READ_TIMEOUT_MS = 15_000;

/** The worker thread's heap. pdf.js keeps a parsed PDF well under this; a hostile file that grows past it stops only the thread. */
const PDF_WORKER_HEAP_MB = 512;

/** What the worker thread is started with: the PDF's bytes as a view on a transferred buffer. */
export type PdfWorkerInput = { buffer: ArrayBuffer; byteOffset: number; byteLength: number; characterBudget: number };

/**
 * Reads each PDF in a Node worker thread built from `scriptPath` (pdf-text-worker.ts), so a slow or hostile file can be
 * stopped without stalling the core: past the deadline, or past its heap, only the thread goes. Cancelling stops it too.
 */
export function pdfTextInWorker(scriptPath: string, timeoutMs = PDF_READ_TIMEOUT_MS): PdfTextExtractor {
  return (bytes, signal) => new Promise<PdfPages>((resolve, reject) => {
    signal?.throwIfAborted();
    // The caller is done with these bytes once their hash is checked, so the buffer moves to the thread uncopied.
    const input: PdfWorkerInput = { buffer: bytes.buffer as ArrayBuffer, byteOffset: bytes.byteOffset, byteLength: bytes.byteLength, characterBudget: PDF_CHARACTER_BUDGET };
    const worker = new Worker(scriptPath, {
      workerData: input,
      transferList: [input.buffer],
      resourceLimits: { maxOldGenerationSizeMb: PDF_WORKER_HEAP_MB },
      // pdf.js warns about the canvas it does not need for text; the warnings are dropped, not shown.
      stdout: true,
      stderr: true,
    });
    worker.stdout.resume();
    worker.stderr.resume();
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      void worker.terminate();
      settle();
    };
    const unreadable = () => finish(() => resolve({ pageCount: 0, pages: [], failure: 'unreadable' }));
    const abort = () => finish(() => reject(signal?.reason));
    const timer = setTimeout(unreadable, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', message => {
      const parsed = PdfPages.safeParse(message);
      if (parsed.success) finish(() => resolve(parsed.data));
      else unreadable();
    });
    worker.once('error', (error: NodeJS.ErrnoException) => {
      // A file that outgrows the heap is the file's problem; any other thread failure is Orglet's, and says so.
      if (error.code === 'ERR_WORKER_OUT_OF_MEMORY') unreadable();
      else finish(() => reject(new Error(`Trình đọc PDF gặp lỗi: ${error.message}`)));
    });
    worker.once('exit', unreadable);
  });
}

const pageMarker = (pageNumber: number, pageCount: number) => `[Page ${pageNumber} of ${pageCount}]`;
const EMPTY_PAGE = '(no text on this page)';
/** Room kept for the closing line, so adding it never takes the text over the limit. */
const CLOSING_LINE_ROOM = 200;

/** The line a worker reads in place of the text when there is none to give. */
function missingTextLine(pages: PdfPages): string {
  if (pages.failure === 'password') return '[This PDF is protected by a password, so its text cannot be read. Ask the user for a copy without a password. Do not guess at its contents.]';
  if (pages.failure === 'unreadable') return '[This PDF could not be read: it is damaged, or too large or too complex to read within the limits. Its text is not included. Do not guess at its contents.]';
  const pageWord = pages.pageCount === 1 ? 'page' : 'pages';
  return `[This PDF has ${pages.pageCount} ${pageWord} and no text layer, so it is probably a scan or a picture of a document. Its text cannot be read. Ask the user to paste the text or attach a PDF with selectable text. Do not guess at its contents.]`;
}

/**
 * The PDF as a worker reads it: each page's text under a `[Page n of N]` line, within `limit` bytes of UTF-8 like any
 * text source. When pages are left out for size, a last line says after which page the text stops; a PDF with no text
 * at all is one line saying so.
 */
export function pdfTextForWorker(pages: PdfPages, limit = TEXT_SOURCE_LIMIT): PdfText {
  const pagesWithText = pages.pages.filter(page => page.length > 0).length;
  if (pages.failure || pagesWithText === 0) {
    return { text: missingTextLine(pages), pageCount: pages.pageCount, pagesWithText: 0, cutAfterPage: null, ...(pages.failure ? { failure: pages.failure } : {}) };
  }
  const blocks: string[] = [];
  let bytes = 0;
  let cutAfterPage: number | null = null;
  for (const [index, page] of pages.pages.entries()) {
    const block = `${pageMarker(index + 1, pages.pageCount)}\n${page || EMPTY_PAGE}\n`;
    // One more byte for the blank line that joins it to the next page.
    const blockBytes = Buffer.byteLength(block, 'utf8') + 1;
    if (bytes + blockBytes > limit - CLOSING_LINE_ROOM) {
      cutAfterPage = index;
      break;
    }
    blocks.push(block);
    bytes += blockBytes;
  }
  // The extractor stops early on a long PDF, so the pages it never read are cut as well.
  if (cutAfterPage === null && pages.pages.length < pages.pageCount) cutAfterPage = pages.pages.length;
  if (cutAfterPage !== null) {
    const kept = cutAfterPage === 0 ? 'The first page alone is' : `Text stops after page ${cutAfterPage} of ${pages.pageCount}: the rest is`;
    blocks.push(`[${kept} over the 256 KB limit for one source, so it is not included.]`);
  }
  return { text: blocks.join('\n'), pageCount: pages.pageCount, pagesWithText, cutAfterPage };
}
