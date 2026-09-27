import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import fontkit from '@cantoo/fontkit';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { extractPdfPagesHere } from '../../apps/desktop/src/core/tools/pdf-extract';
import type { Source, Task, Worker } from '../../apps/desktop/src/shared/contracts';
import { versionName } from '../../apps/desktop/src/shared/source-versions';
import { NOTE_ASCENT, commit, noteLines, redo, undo, type History, type Mark, type TextMark } from '../../apps/desktop/src/renderer/markup';
import { changedPage, emptyPdfMarkup, isPdfChanged, markedPages, noteSize, pageMarks, stepPage, withPageMarks, type PdfMarkup } from '../../apps/desktop/src/renderer/pdfMarkup';
import { colorComponents, invert, missingCharacters, writeMarkedPdf, type MarkedPage, type PageTransform } from '../../apps/desktop/src/renderer/pdfWriter';

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfJs: Promise<PdfJs> | undefined;
/** pdf.js on this thread, as the core reads PDFs. */
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

/** Opens a PDF with pdf.js; the loading task is closed after each test. */
const openTasks: { destroy(): Promise<void> }[] = [];
afterEach(async () => {
  for (const task of openTasks.splice(0)) await task.destroy();
});
async function openWithPdfJs(bytes: Uint8Array) {
  const pdf = await loadPdfJs();
  const task = pdf.getDocument({ data: bytes.slice(), useWasm: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  openTasks.push(task);
  return task.promise;
}

const fontPath = join(__dirname, '../../apps/desktop/src/renderer/fonts/Inter-SemiBold.ttf');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * A three-page document with text on every page: an A4 page, a Letter page turned a quarter (/Rotate 90), and a page
 * whose visible area (CropBox) starts away from the origin.
 */
async function sampleDocument(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const helvetica = await document.embedFont(StandardFonts.Helvetica);
  const first = document.addPage([595, 842]);
  first.drawText('Contract terms, page one', { x: 50, y: 790, size: 12, font: helvetica });
  const second = document.addPage([612, 792]);
  second.setRotation(degrees(90));
  second.drawText('Page two, turned', { x: 50, y: 740, size: 12, font: helvetica });
  const third = document.addPage([600, 800]);
  third.setCropBox(100, 100, 400, 500);
  third.drawText('Page three, cropped', { x: 150, y: 550, size: 12, font: helvetica });
  return document.save();
}

async function layoutOf(bytes: Uint8Array, page: number): Promise<PageTransform> {
  const document = await openWithPdfJs(bytes);
  const viewport = (await document.getPage(page)).getViewport({ scale: 1 });
  return viewport.transform as unknown as PageTransform;
}

/** Where a text item's origin lands in the page's layout at scale 1. */
function layoutPoint(transform: PageTransform, item: { transform: number[] }): { x: number; y: number } {
  const [a, b, c, d, e, f] = transform;
  const x = item.transform[4];
  const y = item.transform[5];
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

const note = (text: string, at: { x: number; y: number }, size = 16): TextMark => ({ kind: 'text', at, text, color: '#a82626', size, plain: true });
const vietnameseNote = 'Ghi chú: Hợp đồng đã được ký ngày 27/9, kiểm tra điều khoản ưu đãi';
const englishNote = 'Check the renewal date';

describe('writing marks into a PDF', () => {
  it('draws every kind of mark on the pages that have them and leaves the original bytes alone', async () => {
    const original = await sampleDocument();
    const originalHash = sha256(original);
    const firstLayout = await layoutOf(original, 1);
    const secondLayout = await layoutOf(original, 2);
    const firstMarks: Mark[] = [
      { kind: 'pen', points: [{ x: 60, y: 120 }, { x: 90, y: 140 }, { x: 130, y: 118 }, { x: 170, y: 150 }], color: '#a82626', width: 2 },
      { kind: 'highlighter', points: [{ x: 50, y: 48 }, { x: 200, y: 48 }], color: '#9a6700', width: 4 },
      { kind: 'rectangle', from: { x: 300, y: 300 }, to: { x: 420, y: 380 }, color: '#4473d3', width: 4 },
      { kind: 'ellipse', from: { x: 300, y: 420 }, to: { x: 420, y: 480 }, color: '#2e7a32', width: 4 },
      { kind: 'arrow', from: { x: 100, y: 600 }, to: { x: 250, y: 520 }, color: '#111111', width: 4 },
      note(vietnameseNote, { x: 60, y: 200 }),
    ];
    const pages: MarkedPage[] = [
      { page: 1, transform: firstLayout, marks: firstMarks },
      { page: 2, transform: secondLayout, marks: [note(englishNote, { x: 80, y: 100 }, 12)] },
    ];
    const saved = await writeMarkedPdf(original, pages, await readFile(fontPath));

    expect(sha256(original)).toBe(originalHash);
    expect(new TextDecoder().decode(saved.subarray(0, 5))).toBe('%PDF-');
    const document = await openWithPdfJs(saved);
    expect(document.numPages).toBe(3);
    const pdf = await loadPdfJs();
    const strokesOn = async (page: number) => {
      const operators = await (await document.getPage(page)).getOperatorList();
      return operators.fnArray.filter(operator => operator === pdf.OPS.stroke || operator === pdf.OPS.constructPath).length;
    };
    // Five drawn marks on page one, none on the pages left alone.
    expect(await strokesOn(1)).toBeGreaterThanOrEqual(5);
    expect(await strokesOn(2)).toBe(0);
    expect(await strokesOn(3)).toBe(0);

    // The notes are real text: pdf.js reads them back, in Vietnamese, where they were typed.
    const firstText = (await (await document.getPage(1)).getTextContent()).items.filter(item => 'str' in item);
    const typed = firstText.find(item => item.str === vietnameseNote);
    expect(typed).toBeDefined();
    const landed = layoutPoint(firstLayout, typed!);
    expect(landed.x).toBeCloseTo(60, 1);
    expect(landed.y).toBeCloseTo(200 + NOTE_ASCENT * 16, 1);
    expect(firstText.some(item => item.str === 'Contract terms, page one')).toBe(true);

    // On the turned page the note still lands where it was typed in the page as shown.
    const secondPage = await document.getPage(2);
    expect(secondPage.rotate).toBe(90);
    const secondText = (await secondPage.getTextContent()).items.filter(item => 'str' in item);
    const english = secondText.find(item => item.str === englishNote);
    expect(english).toBeDefined();
    const turned = layoutPoint(secondLayout, english!);
    expect(turned.x).toBeCloseTo(80, 1);
    expect(turned.y).toBeCloseTo(100 + NOTE_ASCENT * 12, 1);
  });

  it('places marks on a cropped page by what is shown, not by the page corner', async () => {
    const original = await sampleDocument();
    const layout = await layoutOf(original, 3);
    const saved = await writeMarkedPdf(original, [{ page: 3, transform: layout, marks: [note('Cropped note', { x: 20, y: 30 }, 12)] }], await readFile(fontPath));
    const document = await openWithPdfJs(saved);
    const items = (await (await document.getPage(3)).getTextContent()).items.filter(item => 'str' in item);
    const typed = items.find(item => item.str === 'Cropped note')!;
    // The crop starts at (100, 100) in page space; a note typed 20 points in sits at x = 120 there.
    expect(typed.transform[4]).toBeCloseTo(120, 1);
    const landed = layoutPoint(layout, typed);
    expect(landed.x).toBeCloseTo(20, 1);
    expect(landed.y).toBeCloseTo(30 + NOTE_ASCENT * 12, 1);
  });

  it('keeps Vietnamese notes readable through the app’s own PDF text read, what an orglet gets', async () => {
    const original = await sampleDocument();
    const saved = await writeMarkedPdf(original, [
      { page: 1, transform: await layoutOf(original, 1), marks: [note(vietnameseNote, { x: 60, y: 200 })] },
      { page: 2, transform: await layoutOf(original, 2), marks: [note(englishNote, { x: 80, y: 100 }, 12)] },
    ], await readFile(fontPath));
    const read = await extractPdfPagesHere(saved);
    expect(read.failure).toBeUndefined();
    expect(read.pageCount).toBe(3);
    expect(read.pages[0]).toContain('Contract terms, page one');
    expect(read.pages[0]).toContain(vietnameseNote);
    expect(read.pages[1]).toContain(englishNote);
    expect(read.pages[2]).toBe('Page three, cropped');
  });

  it('writes decomposed Vietnamese as the composed letters a reader expects', async () => {
    const original = await sampleDocument();
    const decomposed = 'Tiếng Việt có dấu'.normalize('NFD');
    const saved = await writeMarkedPdf(original, [{ page: 1, transform: await layoutOf(original, 1), marks: [note(decomposed, { x: 60, y: 300 })] }], await readFile(fontPath));
    const read = await extractPdfPagesHere(saved);
    expect(read.pages[0]).toContain('Tiếng Việt có dấu'.normalize('NFC'));
  });

  it('embeds only the letters used, so a note adds kilobytes, not the whole font', async () => {
    const original = await sampleDocument();
    const saved = await writeMarkedPdf(original, [{ page: 1, transform: await layoutOf(original, 1), marks: [note(vietnameseNote, { x: 60, y: 200 })] }], await readFile(fontPath));
    const fontSize = (await readFile(fontPath)).length;
    expect(saved.length - original.length).toBeLessThan(fontSize / 10);
  });

  it('refuses a locked PDF, a file that is not a PDF, a page it does not have and characters the font lacks', async () => {
    const fontBytes = await readFile(fontPath);
    const locked = await PDFDocument.create();
    locked.addPage([200, 200]);
    locked.encrypt({ userPassword: '', ownerPassword: 'owner' });
    const lockedBytes = await locked.save();
    const layout: PageTransform = [1, 0, 0, -1, 0, 200];
    const marks: Mark[] = [{ kind: 'pen', points: [{ x: 10, y: 10 }], color: '#111111', width: 2 }];
    await expect(writeMarkedPdf(lockedBytes, [{ page: 1, transform: layout, marks }], fontBytes)).rejects.toThrow('mật khẩu hoặc bị khóa');
    await expect(writeMarkedPdf(new TextEncoder().encode('not a pdf at all'), [{ page: 1, transform: layout, marks }], fontBytes)).rejects.toThrow('Không đọc được PDF');
    const original = await sampleDocument();
    await expect(writeMarkedPdf(original, [{ page: 4, transform: layout, marks }], fontBytes)).rejects.toThrow('không có trong PDF');
    const emoji: MarkedPage[] = [{ page: 1, transform: layout, marks: [note('Xong 🎉 ✓', { x: 10, y: 10 })] }];
    expect(missingCharacters(fontBytes, emoji)).toEqual(['🎉']);
    await expect(writeMarkedPdf(original, emoji, fontBytes)).rejects.toThrow('🎉');
    expect(() => colorComponents('oklch(60% 0.2 30)')).toThrow('không lưu được');
    expect(colorComponents('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(colorComponents('#fff')).toEqual([1, 1, 1]);
  });

  it('uses the ascender of the font it embeds for a note baseline, as the canvas does', async () => {
    const font = fontkit.create(await readFile(fontPath));
    if (!('ascent' in font)) throw new Error('Expected a single font');
    expect(font.ascent / font.unitsPerEm).toBe(NOTE_ASCENT);
    expect(font.postscriptName).toBe('Inter-SemiBold');
  });

  it('inverts a page layout back to page space', () => {
    const layout: PageTransform = [0, 1, 1, 0, 0, 0];
    expect(invert(layout).map(value => value + 0)).toEqual([0, 1, 1, 0, 0, 0]);
    const shifted: PageTransform = [1, 0, 0, -1, -100, 600];
    const back = invert(shifted);
    // (x, y) in layout → page: x + 100, 600 - y.
    expect(back[0] * 20 + back[2] * 30 + back[4]).toBeCloseTo(120);
    expect(back[1] * 20 + back[3] * 30 + back[5]).toBeCloseTo(570);
  });
});

describe('the marks of a PDF, page by page', () => {
  it('keeps each page apart, undoes across pages and says which page a step changed', () => {
    const pen: Mark = { kind: 'pen', points: [{ x: 1, y: 1 }], color: '#111111', width: 2 };
    const box: Mark = { kind: 'rectangle', from: { x: 1, y: 1 }, to: { x: 40, y: 40 }, color: '#111111', width: 2 };
    let history: History<PdfMarkup> = { past: [], present: emptyPdfMarkup, future: [] };
    expect(isPdfChanged(history.present)).toBe(false);
    history = commit(history, withPageMarks(history.present, 1, [pen]));
    history = commit(history, withPageMarks(history.present, 3, [box]));
    expect(markedPages(history.present)).toEqual([1, 3]);
    expect(pageMarks(history.present, 2)).toEqual([]);

    const beforeUndo = history.present;
    history = undo(history);
    expect(changedPage(beforeUndo, history.present)).toBe(3);
    expect(markedPages(history.present)).toEqual([1]);
    const beforeRedo = history.present;
    history = redo(history);
    expect(changedPage(beforeRedo, history.present)).toBe(3);
    history = undo(undo(history));
    expect(isPdfChanged(history.present)).toBe(false);
    expect(withPageMarks(withPageMarks(emptyPdfMarkup, 2, [pen]), 2, []).pages).toEqual({});
  });

  it('sizes notes above body text and keeps page steps inside the document', () => {
    const page = { width: 595, height: 842 };
    expect([noteSize('thin', page), noteSize('medium', page), noteSize('thick', page)]).toEqual([12, 16, 24]);
    expect(noteSize('medium', { width: 2384, height: 3370 })).toBeCloseTo(16 * 3.37);
    expect(stepPage(1, -1, 5)).toBe(1);
    expect(stepPage(4, 1, 5)).toBe(5);
    expect(stepPage(5, 1, 5)).toBe(5);
    // A note's lines sit on baselines below its top-left corner, one line height apart, the same on screen and in the PDF.
    expect(noteLines(note('one\ntwo', { x: 10, y: 20 }, 16))).toEqual([
      { text: 'one', baseline: 20 + NOTE_ASCENT * 16 },
      { text: 'two', baseline: 20 + NOTE_ASCENT * 16 + 20 },
    ]);
  });
});

describe('saving a marked-up PDF as a new version of the chat', () => {
  let directory: string;
  let store: Store;
  let core: CoreService;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-pdf-markup-'));
    store = new Store(join(directory, 'test.sqlite'));
    core = new CoreService(store, () => {}, async () => ({ async request() { throw new Error('No model in this test'); } }));
  });
  afterEach(async () => {
    await core.runner.shutdown();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('keeps the original, names the version "(edited).pdf" and gives an orglet the notes in its text', async () => {
    const path = join(directory, 'contract.pdf');
    const original = await sampleDocument();
    await writeFile(path, original);
    const [source] = await core.sources.import([path]);
    const worker = store.all<Worker>('workers')[0];
    const chat: Task = { id: id(), brief: 'Look', workerId: worker.id, sourceIds: [source.id], consent: false, budgetMicros: 10000, createdAt: now(), status: 'completed', accepted: false };
    store.put('tasks', chat);

    const marked = await writeMarkedPdf(original, [{ page: 1, transform: await layoutOf(original, 1), marks: [note(vietnameseNote, { x: 60, y: 200 })] }], await readFile(fontPath));
    const name = versionName(source.name, [source.name], 'edited');
    expect(name).toBe('contract (edited).pdf');
    const edited = await core.command('saveSourceVersion', { taskId: chat.id, sourceId: source.id, name, bytes: marked }) as Source;
    expect(edited).toMatchObject({ name: 'contract (edited).pdf', media: 'pdf', editedFrom: source.id, hash: sha256(marked) });
    expect(sha256(await readFile(path))).toBe(sha256(original));

    const text = await core.sources.read(edited.id, [source.id, edited.id]);
    expect(text).toContain(vietnameseNote);
    expect(text).toContain('Contract terms, page one');
    const originalText = await core.sources.read(source.id, [source.id, edited.id]);
    expect(originalText).not.toContain(vietnameseNote);

    expect(versionName(edited.name, [source.name, edited.name], 'edited')).toBe('contract (edited 2).pdf');
    await expect(core.command('saveSourceVersion', { taskId: chat.id, sourceId: source.id, name: 'contract (edited 2).pdf', bytes: new TextEncoder().encode('<html>') })).rejects.toThrow('không hợp lệ');
    await expect(core.command('saveSourceVersion', { taskId: chat.id, sourceId: source.id, name: 'contract (edited 2).png', bytes: marked })).rejects.toThrow('PDF');
  });
});
