import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@codepawlhq/orglet-ui';
import { t } from '../i18n';
import { loadPdf } from './PdfPreview';
import type { Size } from '../markup';
import type { PageTransform } from '../pdfWriter';

type PdfDocument = import('pdfjs-dist').PDFDocumentProxy;

/** A page drawn for marking up: the picture, its size in page units, and the layout that maps page space to it. */
export type PdfPagePicture = { picture: HTMLCanvasElement; size: Size; transform: PageTransform };

/** The most pixels a page picture holds, so a poster-sized page does not take hundreds of megabytes. */
const MAXIMUM_PAGE_PIXELS = 16_000_000;
/** Pages kept drawn, so going back to a page shows it at once. */
const PAGES_KEPT = 6;

/** Opens the PDF with pdf.js for marking up, as the preview does. */
export function usePdfDocument(bytes: Uint8Array): { document: PdfDocument } | { failed: true } | undefined {
  const [state, setState] = useState<{ document: PdfDocument } | { failed: true }>();
  useEffect(() => {
    let active = true;
    let task: { destroy(): Promise<void>; promise: Promise<PdfDocument> } | undefined;
    setState(undefined);
    void loadPdf().then(async pdf => {
      // A copy: pdf.js transfers the buffer to its worker, and the bytes are still wanted for saving.
      task = pdf.getDocument({ data: bytes.slice(), disableAutoFetch: true });
      const document = await task.promise;
      if (active) setState({ document });
    }).catch(() => { if (active) setState({ failed: true }); });
    return () => { active = false; void task?.destroy(); };
  }, [bytes]);
  return state;
}

/**
 * One page of the document drawn into a canvas sharp enough for the screen at up to twice the page's size, with the
 * layout at scale 1 its marks are kept in. Pages already drawn are kept for going back.
 */
export function usePdfPage(document: PdfDocument | undefined, pageNumber: number): PdfPagePicture | 'failed' | undefined {
  const kept = useRef(new Map<number, PdfPagePicture>());
  const [, setDrawn] = useState(0);
  const [failedPage, setFailedPage] = useState<number>();
  useEffect(() => { kept.current.clear(); }, [document]);
  useEffect(() => {
    if (!document || kept.current.has(pageNumber)) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | undefined;
    void (async () => {
      const page = await document.getPage(pageNumber);
      if (cancelled) return;
      const layout = page.getViewport({ scale: 1 });
      const ratio = window.devicePixelRatio || 1;
      const pixelScale = Math.min(ratio * 2, Math.sqrt(MAXIMUM_PAGE_PIXELS / (layout.width * layout.height)));
      const viewport = page.getViewport({ scale: pixelScale });
      const picture = window.document.createElement('canvas');
      picture.width = Math.max(1, Math.floor(viewport.width));
      picture.height = Math.max(1, Math.floor(viewport.height));
      const context = picture.getContext('2d');
      if (!context) throw new Error('No canvas');
      renderTask = page.render({ canvasContext: context, viewport, canvas: picture });
      await renderTask.promise;
      if (cancelled) return;
      kept.current.set(pageNumber, { picture, size: { width: layout.width, height: layout.height }, transform: layout.transform as unknown as PageTransform });
      while (kept.current.size > PAGES_KEPT) {
        const oldest = kept.current.keys().next().value;
        if (oldest === undefined || oldest === pageNumber) break;
        kept.current.delete(oldest);
      }
      setDrawn(count => count + 1);
    })().catch(() => { if (!cancelled) setFailedPage(pageNumber); });
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [document, pageNumber]);
  if (failedPage === pageNumber) return 'failed';
  return kept.current.get(pageNumber);
}

/**
 * Moving between pages while marking up: previous, "page N of M", next (Page Up and Page Down do the same). Marks stay
 * with the page they were drawn on.
 */
export function PdfPageNavigator({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (page: number) => void }) {
  return <span className="markup-pages" role="group" aria-label={t('Các trang')}>
    <Button type="button" size="icon" aria-label={t('Trang trước')} title={t('Trang trước (Page Up)')} aria-keyshortcuts="PageUp" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></Button>
    <span className="markup-page-count" aria-live="polite">{t('Trang {0}/{1}', [page, pageCount])}</span>
    <Button type="button" size="icon" aria-label={t('Trang sau')} title={t('Trang sau (Page Down)')} aria-keyshortcuts="PageDown" disabled={page >= pageCount} onClick={() => onPage(page + 1)}><ChevronRight size={16} /></Button>
  </span>;
}

/**
 * The writer and the font notes are written in, loaded together the first time a PDF is marked up: pdf-lib, fontkit
 * and the font are only needed then.
 */
export async function loadPdfWriting() {
  const [writer, font] = await Promise.all([import('../pdfWriter'), import('../pdfNoteFont')]);
  return { writer, fontBytes: font.noteFontBytes() };
}
