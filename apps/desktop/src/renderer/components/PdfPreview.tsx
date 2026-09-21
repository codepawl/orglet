import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';
import { t } from '../i18n';

const PAGE_BATCH = 10;
const RENDER_WIDTH = 720;

type PdfModule = typeof import('pdfjs-dist');
type PdfDocument = import('pdfjs-dist').PDFDocumentProxy;

let pdfModule: Promise<PdfModule> | undefined;
/**
 * pdf.js is loaded on first use, so a chat with no PDF never pays for it. The worker script is a same-origin file;
 * when the window cannot start a Worker from it (a `file:` page cannot), pdf.js falls back to running the same
 * module on the main thread, which is what the packaged app does.
 */
function loadPdf(): Promise<PdfModule> {
  if (!pdfModule) {
    pdfModule = import('pdfjs-dist').then(module => {
      module.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
      return module;
    });
  }
  return pdfModule;
}

/** Draws one page into a canvas sized to the preview column, at the screen's pixel density. */
function PdfPage({ document, pageNumber }: { document: PdfDocument; pageNumber: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void } | undefined;
    void document.getPage(pageNumber).then(page => {
      if (cancelled || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      const scale = RENDER_WIDTH / base.width;
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * ratio });
      const element = canvas.current;
      element.width = Math.floor(viewport.width);
      element.height = Math.floor(viewport.height);
      element.style.width = `${Math.floor(viewport.width / ratio)}px`;
      element.style.height = `${Math.floor(viewport.height / ratio)}px`;
      const context = element.getContext('2d');
      if (!context) return;
      renderTask = page.render({ canvasContext: context, viewport, canvas: element });
    }).catch(() => { /* a page that fails to draw stays blank; the file itself already opened */ });
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [document, pageNumber]);
  return <canvas ref={canvas} className="pdf-page" role="img" aria-label={t('Trang {0}', [pageNumber])} />;
}

/**
 * Pages of a PDF drawn with pdf.js, ten at a time. Rendering is pure canvas work in the renderer: no plugin, no
 * navigation, no script from the file. When pdf.js cannot open the file the caller's fallback (open in the
 * default app) is shown instead.
 */
export function PdfPreview({ bytes, name, fallback }: { bytes: Uint8Array; name: string; fallback: React.ReactNode }) {
  const [document, setDocument] = useState<PdfDocument>();
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(PAGE_BATCH);
  useEffect(() => {
    let active = true;
    let task: { destroy(): Promise<void>; promise: Promise<PdfDocument> } | undefined;
    setDocument(undefined); setFailed(false); setShown(PAGE_BATCH);
    void loadPdf().then(async pdf => {
      // A copy: pdf.js transfers the buffer to its worker, and the bytes are still wanted for another open.
      task = pdf.getDocument({ data: bytes.slice(), disableAutoFetch: true });
      const loaded = await task.promise;
      if (active) setDocument(loaded);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; void task?.destroy(); };
  }, [bytes]);
  if (failed) return <>{fallback}</>;
  if (!document) return <p className="preview-state">{t('Đang mở {0}…', [name])}</p>;
  const total = document.numPages;
  const visible = Math.min(total, shown);
  return <div className="pdf-preview">
    <div className="pdf-pages">
      {Array.from({ length: visible }, (_, index) => <PdfPage key={index + 1} document={document} pageNumber={index + 1} />)}
    </div>
    <p className="preview-note">
      {visible < total ? t('Đang hiện {0} trong {1} trang.', [visible, total]) : t('{0} trang', [total])}
      {visible < total && <Button variant="outline" onClick={() => setShown(current => current + PAGE_BATCH)}>{t('Thêm {0} trang', [Math.min(PAGE_BATCH, total - visible)])}</Button>}
    </p>
  </div>;
}
