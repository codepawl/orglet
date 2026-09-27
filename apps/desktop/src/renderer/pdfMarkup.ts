/**
 * Marking up a PDF in the viewer (COD-302): the same marks as a picture (`markup.ts`), kept per page. A page's marks are
 * in page units, the page as pdf.js lays it out at scale 1 (points, origin at the top left, the page's own rotation
 * applied), so they paint the screen at any zoom and go into the saved PDF through the inverse of that layout.
 */
import type { Mark, MarkupTool, Size, StrokeLevel } from './markup';

/** Every page's marks, by page number (1 for the first page). A page without marks has no entry. */
export type PdfMarkup = { pages: Readonly<Record<number, readonly Mark[]>> };

export const emptyPdfMarkup: PdfMarkup = { pages: {} };

/** The tools a PDF page offers: the picture's tools without crop, since a page keeps its size. */
export const PDF_TOOLS: readonly MarkupTool[] = ['pen', 'highlighter', 'arrow', 'rectangle', 'ellipse', 'text'];

export function pageMarks(markup: PdfMarkup, page: number): readonly Mark[] {
  return markup.pages[page] ?? [];
}

/** The markup with one page's marks replaced; a page left with none drops out. */
export function withPageMarks(markup: PdfMarkup, page: number, marks: readonly Mark[]): PdfMarkup {
  const pages = { ...markup.pages };
  if (marks.length > 0) pages[page] = marks;
  else delete pages[page];
  return { pages };
}

/** The numbers of the pages that carry marks, in page order. */
export function markedPages(markup: PdfMarkup): number[] {
  return Object.keys(markup.pages).map(Number).filter(page => markup.pages[page].length > 0).sort((first, second) => first - second);
}

export function isPdfChanged(markup: PdfMarkup): boolean {
  return markedPages(markup).length > 0;
}

/**
 * The first page whose marks differ between two states of the markup, or undefined when none does. Undo and redo use
 * it to show the page they changed, so a step never lands out of sight.
 */
export function changedPage(before: PdfMarkup, after: PdfMarkup): number | undefined {
  const pages = new Set([...markedPages(before), ...markedPages(after)]);
  return [...pages].sort((first, second) => first - second).find(page => pageMarks(before, page) !== pageMarks(after, page));
}

/**
 * The size of a typed note on a page, in points: a document's own text is usually 10 to 12 points, so a note reads as
 * one step above it. Larger pages (a poster) scale up as a picture's marks do.
 */
export function noteSize(level: StrokeLevel, size: Size): number {
  const base = level === 'thin' ? 12 : level === 'medium' ? 16 : 24;
  return base * Math.max(1, Math.max(size.width, size.height) / 1000);
}

/** The next page number after a step of `delta`, kept inside the document. */
export function stepPage(current: number, delta: number, pageCount: number): number {
  return Math.min(pageCount, Math.max(1, current + delta));
}
