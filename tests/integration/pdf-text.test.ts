import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { Sources } from '../../apps/desktop/src/core/tools/sources';
import { extractPdfPages, extractPdfPagesHere } from '../../apps/desktop/src/core/tools/pdf-extract';
import { pdfTextForWorker, pdfTextInWorker, type PdfTextExtractor } from '../../apps/desktop/src/core/tools/pdf-text';
import { TEXT_SOURCE_LIMIT } from '../../apps/desktop/src/shared/source-kinds';
import { invoicePdf, pdfWithPages } from './pdf-fixture';

let directory: string;
let store: Store;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-pdf-'));
  store = new Store(':memory:');
});
afterEach(async () => {
  store.close();
  await rm(directory, { recursive: true, force: true });
});

async function attach(sources: Sources, name: string, bytes: Buffer) {
  const path = join(directory, name);
  await writeFile(path, bytes);
  const [source] = await sources.import([path]);
  return { source, path };
}

describe('the text a worker reads from a PDF', () => {
  it('puts a page line before each page and says which pages have no text', () => {
    const read = pdfTextForWorker({ pageCount: 3, pages: ['First page', '', 'Third page'] });
    expect(read.text).toBe('[Page 1 of 3]\nFirst page\n\n[Page 2 of 3]\n(no text on this page)\n\n[Page 3 of 3]\nThird page\n');
    expect(read).toMatchObject({ pageCount: 3, pagesWithText: 2, cutAfterPage: null });
  });

  it('stops at the text source limit on a page boundary and says after which page', () => {
    const page = 'a'.repeat(100_000);
    const read = pdfTextForWorker({ pageCount: 5, pages: [page, page, page] });
    expect(Buffer.byteLength(read.text)).toBeLessThanOrEqual(TEXT_SOURCE_LIMIT);
    expect(read.cutAfterPage).toBe(2);
    expect(read.text).toContain('[Page 2 of 5]');
    expect(read.text).not.toContain('[Page 3 of 5]');
    expect(read.text.endsWith('[Text stops after page 2 of 5: the rest is over the 256 KB limit for one source, so it is not included.]')).toBe(true);
  });

  it('counts the pages the reader never reached as cut', () => {
    expect(pdfTextForWorker({ pageCount: 40, pages: ['one', 'two'] }).cutAfterPage).toBe(2);
  });

  it('says plainly when there is no text layer, a password, or a file that cannot be read', () => {
    const scanned = pdfTextForWorker({ pageCount: 2, pages: ['', ''] });
    expect(scanned.text).toContain('This PDF has 2 pages and no text layer');
    expect(scanned.text).toContain('Do not guess at its contents');
    expect(scanned.pagesWithText).toBe(0);
    expect(pdfTextForWorker({ pageCount: 0, pages: [], failure: 'password' }).text).toContain('protected by a password');
    expect(pdfTextForWorker({ pageCount: 0, pages: [], failure: 'unreadable' }).text).toContain('could not be read');
  });
});

describe('reading a PDF with pdf.js', () => {
  it('extracts each page of a text PDF, and nothing from a page drawn without text', async () => {
    const pages = await extractPdfPages(new Uint8Array(pdfWithPages([['Line one', 'Line two'], [], ['Closing line (final)']])));
    expect(pages).toEqual({ pageCount: 3, pages: ['Line one\nLine two', '', 'Closing line (final)'] });
  });

  it('reports a file that is not a PDF instead of throwing', async () => {
    await expect(extractPdfPages(new Uint8Array(Buffer.from('not a pdf at all')))).resolves.toEqual({ pageCount: 0, pages: [], failure: 'unreadable' });
  });

  it('reads an attached PDF through the permission, revoke and hash gate', async () => {
    const sources = new Sources(store);
    const { source, path } = await attach(sources, 'invoice-acme.pdf', invoicePdf());
    const read = await sources.readPdf(source.id, [source.id]);
    expect(read.text).toContain('Total due ............... 1.750.000 VND');
    expect(await sources.read(source.id, [source.id])).toBe(read.text);
    await expect(sources.readPdf(source.id, [])).rejects.toThrow('quyền');
    await writeFile(path, pdfWithPages([['Total due ............... 9.999.999 VND']]));
    await expect(sources.readPdf(source.id, [source.id])).rejects.toThrow('thay đổi');
    await writeFile(path, invoicePdf());
    store.update('sources', { ...source, revoked: true });
    await expect(sources.readPdf(source.id, [source.id])).rejects.toThrow('thu hồi');
  });

  it('parses a PDF once, yet reads and checks its file every time', async () => {
    let parses = 0;
    const counting: PdfTextExtractor = async bytes => {
      parses += 1;
      return extractPdfPagesHere(bytes);
    };
    const sources = new Sources(store, undefined, counting);
    const { source, path } = await attach(sources, 'invoice-acme.pdf', invoicePdf());
    await sources.readPdf(source.id, [source.id]);
    await sources.readPdf(source.id, [source.id]);
    expect(parses).toBe(1);
    await writeFile(path, pdfWithPages([['changed']]));
    await expect(sources.readPdf(source.id, [source.id])).rejects.toThrow('thay đổi');
  });

  it('gives a scanned PDF as one line saying there is no text', async () => {
    const sources = new Sources(store);
    const { source } = await attach(sources, 'scan.pdf', pdfWithPages([[], []]));
    const read = await sources.readPdf(source.id, [source.id]);
    expect(read.pagesWithText).toBe(0);
    expect(read.text).toContain('This PDF has 2 pages and no text layer');
  });
});

describe('the worker thread a PDF is read in', () => {
  async function workerScript(name: string, body: string) {
    const path = join(directory, name);
    await writeFile(path, `const { parentPort, workerData } = require('node:worker_threads');\n${body}\n`);
    return path;
  }

  it('hands the bytes to the thread and takes back only a valid answer', async () => {
    const echo = await workerScript('echo.cjs', 'parentPort.postMessage({ pageCount: workerData.byteLength, pages: [String(workerData.characterBudget)] });');
    await expect(pdfTextInWorker(echo)(new Uint8Array(7))).resolves.toEqual({ pageCount: 7, pages: [String(TEXT_SOURCE_LIMIT)] });
    const wrong = await workerScript('wrong.cjs', 'parentPort.postMessage({ pages: "all of them" });');
    await expect(pdfTextInWorker(wrong)(new Uint8Array(1))).resolves.toEqual({ pageCount: 0, pages: [], failure: 'unreadable' });
  });

  it('stops a thread that runs past the deadline and reports the PDF as unreadable', async () => {
    const hang = await workerScript('hang.cjs', 'setInterval(() => {}, 1000);');
    await expect(pdfTextInWorker(hang, 200)(new Uint8Array(1))).resolves.toEqual({ pageCount: 0, pages: [], failure: 'unreadable' });
  });

  it('says so when the thread itself fails, and stops when the run is cancelled', async () => {
    const broken = await workerScript('broken.cjs', 'throw new Error("reader missing");');
    await expect(pdfTextInWorker(broken)(new Uint8Array(1))).rejects.toThrow('Trình đọc PDF gặp lỗi: reader missing');
    const hang = await workerScript('slow.cjs', 'setInterval(() => {}, 1000);');
    const controller = new AbortController();
    const reading = pdfTextInWorker(hang)(new Uint8Array(1), controller.signal);
    controller.abort(new Error('Cancelled'));
    await expect(reading).rejects.toThrow('Cancelled');
  });
});
