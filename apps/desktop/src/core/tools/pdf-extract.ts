import { PDF_CHARACTER_BUDGET, type PdfPages, type PdfTextExtractor } from './pdf-text';

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type PdfDocument = Awaited<ReturnType<PdfJs['getDocument']>['promise']>;
type TextItems = Awaited<ReturnType<Awaited<ReturnType<PdfDocument['getPage']>>['getTextContent']>>['items'];

let pdfJs: Promise<PdfJs> | undefined;

/**
 * pdf.js, loaded on first use. With its worker module on `globalThis.pdfjsWorker` it parses on this thread (its "fake
 * worker") instead of looking for a web Worker, which is what lets it run in plain Node and in a worker thread of
 * Electron's utility process alike. The legacy build is the one pdf.js publishes for Node.
 */
function loadPdfJs(): Promise<PdfJs> {
  if (!pdfJs) {
    pdfJs = (async () => {
      const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
      (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
      return import('pdfjs-dist/legacy/build/pdf.mjs');
    })();
  }
  return pdfJs;
}

/** One page's text, with a line break wherever pdf.js saw a line end. */
function pageText(items: TextItems): string {
  let text = '';
  for (const item of items) {
    if (!('str' in item)) continue;
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  return text.trim();
}

/**
 * The text layer of a PDF, page by page, until `characterBudget` characters have come out. Nothing in the file runs:
 * no scripts, no fonts loaded into anything, no network. A password or a file pdf.js cannot open is reported, not thrown.
 */
export async function extractPdfPages(bytes: Uint8Array, characterBudget = PDF_CHARACTER_BUDGET): Promise<PdfPages> {
  const pdf = await loadPdfJs();
  const task = pdf.getDocument({
    data: bytes,
    // Image decoders are all pdf.js builds in WebAssembly, and text needs none of them.
    useWasm: false,
    disableFontFace: true,
    useSystemFonts: false,
    disableAutoFetch: true,
    stopAtErrors: false,
    verbosity: 0,
  });
  try {
    const document = await task.promise;
    const pages: string[] = [];
    let characters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages && characters < characterBudget; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = pageText(content.items);
      pages.push(text);
      characters += text.length;
      page.cleanup();
    }
    return { pageCount: document.numPages, pages };
  } catch (error) {
    if ((error as { name?: string })?.name === 'PasswordException') return { pageCount: 0, pages: [], failure: 'password' };
    return { pageCount: 0, pages: [], failure: 'unreadable' };
  } finally {
    await task.destroy();
  }
}

/** Reads on the calling thread. Tests use it; the app reads in a worker thread instead (`pdfTextInWorker`). */
export const extractPdfPagesHere: PdfTextExtractor = async bytes => extractPdfPages(bytes);
