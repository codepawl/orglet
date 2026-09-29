import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MessageSquarePlus, Save } from 'lucide-react';
import type { Source, SourceBytes } from '../../shared/contracts';
import { Button } from './ui';
import { confirmAction } from './confirm';
import { SourceViewer, type SourceViewerFrame } from './SourceViewer';
import type { TextEditorHandle } from './TextEditor';
import { Skeleton, SkeletonGroup, SkeletonText } from '@codepawl/orglet-ui';
import { MarkupCanvas, MarkupToolbar, markupPalette, markupPng, markupTools, strokeWidth, textSize, usePicture } from './ImageMarkup';
import { commit, isChanged, redo, startHistory, undo, type History, type Markup, type MarkupHistory, type MarkupTool, type StrokeLevel } from '../markup';
import { PDF_TOOLS, changedPage, emptyPdfMarkup, isPdfChanged, markedPages, noteSize, pageMarks, stepPage, withPageMarks, type PdfMarkup } from '../pdfMarkup';
import { PdfPageNavigator, loadPdfWriting, usePdfDocument, usePdfPage } from './PdfMarkup';
import { PDF_PAGE_WIDTH } from './PdfPreview';
import type { PageTransform } from '../pdfWriter';
import { t, tMessage } from '../i18n';
import type { Language } from './highlight';

// The editor (CodeMirror) loads the first time a file is edited, so a window that never edits one never pays for it.
const TextEditor = lazy(() => import('./TextEditor').then(module => ({ default: module.TextEditor })));

/** What saving an edit gives the edit modes: the new source, once the core kept it. */
export type SaveVersion = (content: { text: string } | { bytes: Uint8Array<ArrayBuffer> }) => Promise<Source>;

/**
 * The one question every way out of an unsaved edit asks: closing the viewer, Escape, Cancel. The original is never
 * at risk; what would be lost is the edit.
 */
export async function leaveUnsaved(dirty: boolean): Promise<boolean> {
  if (!dirty) return true;
  return confirmAction({
    title: t('Bỏ các thay đổi chưa lưu?'),
    description: t('Bản sửa chưa được lưu thành bản mới. Tệp gốc vẫn giữ nguyên.'),
    confirmLabel: t('Bỏ thay đổi'),
    cancelLabel: t('Tiếp tục sửa'),
  });
}

/**
 * The actions of an edit mode, on the viewer's toolbar: Cancel goes back to reading, Ask about this saves if needed
 * and puts the version on the chat's next message, and Save keeps the edit as a new version (Ctrl+S). Save is the
 * primary action while editing, last in the row (COD-292).
 */
function EditActions({ dirty, busy, onCancel, onSave, onAsk }: { dirty: boolean; busy: boolean; onCancel: () => void; onSave: () => void; onAsk: () => void }) {
  return <>
    <Button type="button" variant="ghost" className="doc-action" disabled={busy} onClick={onCancel}>{t('Hủy')}</Button>
    <Button type="button" variant="outline" className="doc-action edit-ask" aria-label={t('Hỏi về bản này')} disabled={busy} onClick={onAsk}>
      <MessageSquarePlus size={15} /><span className="edit-action-label">{t('Hỏi về bản này')}</span>
    </Button>
    <Button type="button" variant="primary" className="doc-action edit-save" aria-label={t('Lưu bản mới')} disabled={busy || !dirty} title={t('Lưu thành bản mới (Ctrl+S)')} aria-keyshortcuts="Control+S" onClick={onSave}>
      <Save size={15} /><span className="edit-action-label">{t('Lưu bản mới')}</span>
    </Button>
  </>;
}

/** The save and ask flow both edit modes share, with the busy state and the error line. */
function useEditFlow({ dirty, content, save, onSaved, onAsk, onDone }: {
  dirty: boolean; content: () => Promise<{ text: string } | { bytes: Uint8Array<ArrayBuffer> }>; save: SaveVersion;
  onSaved: (source: Source) => void; onAsk: (source: Source) => void; onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function keep(): Promise<Source | undefined> {
    setBusy(true);
    setError('');
    try { return await save(await content()); }
    catch (err) { setError(tMessage((err as Error).message)); return undefined; }
    finally { setBusy(false); }
  }
  return {
    busy, error,
    async saveVersion() {
      if (!dirty || busy) return;
      const saved = await keep();
      if (saved) onSaved(saved);
    },
    async ask(original: Source) {
      if (busy) return;
      if (!dirty) { onAsk(original); return; }
      const saved = await keep();
      if (saved) onAsk(saved);
    },
    async cancel() { if (await leaveUnsaved(dirty)) onDone(); },
  };
}

type EditModeProps = {
  frame: SourceViewerFrame; source: Source; save: SaveVersion;
  /** Back to reading; after a save, the viewer opens the new version. */
  onDone: () => void; onSaved: (source: Source) => void; onAsk: (source: Source) => void;
  /** Closes the whole viewer. */
  onClose: () => void;
};

/** A text or code file in the editor, inside the same viewer. */
export function TextEditing({ frame, source, text, language, save, onDone, onSaved, onAsk, onClose }: EditModeProps & { text: string; language: Language }) {
  const [dirty, setDirty] = useState(false);
  const editor = useRef<TextEditorHandle>(null);
  const flow = useEditFlow({ dirty, content: async () => ({ text: editor.current?.text() ?? text }), save, onSaved, onAsk, onDone });
  const close = async () => { if (await leaveUnsaved(dirty)) onClose(); };
  return <SourceViewer {...frame} className="source-file source-editing" onClose={() => void close()}
    actions={<EditActions dirty={dirty} busy={flow.busy} onCancel={() => void flow.cancel()} onSave={() => void flow.saveVersion()} onAsk={() => void flow.ask(source)} />}>
    {flow.error && <p role="alert" className="error">{flow.error}</p>}
    <Suspense fallback={<SkeletonGroup label={t('Đang mở…')} className="source-shape"><SkeletonText lines={8} /></SkeletonGroup>}>
      <TextEditor initialText={text} language={language} label={t('Nội dung của {0}', [source.name])} onDirtyChange={setDirty} onSave={() => void flow.saveVersion()} handle={editor} />
    </Suspense>
  </SourceViewer>;
}

/** Whether a key press belongs to a field being typed in, where the drawing keys must not act. */
function typingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

/**
 * The keys of a markup mode, anywhere in the viewer except a field being typed in: Ctrl+S saves, Ctrl+Z and
 * Ctrl+Shift+Z (or Ctrl+Y) undo and redo, a tool's letter picks it, 1 2 3 pick the width, and Page Up and Page Down
 * turn the page when there are pages.
 */
function useMarkupKeys(actions: {
  tools?: readonly MarkupTool[];
  onSave: () => void; onUndo: () => void; onRedo: () => void;
  onTool: (tool: MarkupTool) => void; onLevel: (level: StrokeLevel) => void;
  onPage?: (delta: number) => void;
}) {
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const current = latest.current;
      if (typingInField(event.target) || event.altKey) return;
      const key = event.key.toLowerCase();
      const command = event.ctrlKey || event.metaKey;
      if (command && key === 's') { event.preventDefault(); current.onSave(); return; }
      if (command && (key === 'y' || (key === 'z' && event.shiftKey))) { event.preventDefault(); current.onRedo(); return; }
      if (command && key === 'z') { event.preventDefault(); current.onUndo(); return; }
      if (command) return;
      if (current.onPage && (event.key === 'PageUp' || event.key === 'PageDown')) {
        event.preventDefault();
        current.onPage(event.key === 'PageUp' ? -1 : 1);
        return;
      }
      const picked = markupTools().find(item => item.shortcut?.toLowerCase() === key && (!current.tools || current.tools.includes(item.value)));
      if (picked) { current.onTool(picked.value); return; }
      if (key === '1') current.onLevel('thin');
      if (key === '2') current.onLevel('medium');
      if (key === '3') current.onLevel('thick');
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);
}

/** A picture marked up in the viewer: the drawing bar under the toolbar and the picture on the backdrop. */
export function ImageEditing({ frame, source, media, save, onDone, onSaved, onAsk, onClose }: EditModeProps & { media: SourceBytes }) {
  const loaded = usePicture(media.bytes, media.mimeType);
  const [palette] = useState(markupPalette);
  const [tool, setTool] = useState<MarkupTool>('pen');
  const [colorId, setColorId] = useState(palette[0].id);
  const [level, setLevel] = useState<StrokeLevel>('medium');
  const [history, setHistory] = useState<MarkupHistory>(startHistory);
  const dirty = isChanged(history.present);
  const picture = loaded && 'picture' in loaded ? loaded : undefined;
  const flow = useEditFlow({
    dirty, save, onSaved, onAsk, onDone,
    content: async () => {
      if (!picture) throw new Error(t('Ảnh chưa mở xong.'));
      return { bytes: await markupPng(picture.picture, picture.size, history.present) };
    },
  });
  const close = async () => { if (await leaveUnsaved(dirty)) onClose(); };
  useMarkupKeys({
    onSave: () => void flow.saveVersion(),
    onUndo: () => setHistory(current => undo(current)),
    onRedo: () => setHistory(current => redo(current)),
    onTool: setTool,
    onLevel: setLevel,
  });
  const color = palette.find(entry => entry.id === colorId)?.value ?? palette[0].value;
  let body: ReactNode;
  if (!loaded) body = null;
  else if (!picture) body = <p className="preview-state">{t('Không mở được ảnh này để đánh dấu.')}</p>;
  else {
    const markCount = history.present.marks.length;
    const label = markCount === 1 ? t('{0}, 1 dấu', [source.name]) : markCount > 0 ? t('{0}, {1} dấu', [source.name, markCount]) : source.name;
    body = <MarkupCanvas picture={picture.picture} size={picture.size} markup={history.present} tool={tool} color={color}
      width={strokeWidth(level, picture.size)} fontSize={textSize(level, picture.size)} label={label}
      onCommit={next => setHistory(current => commit(current, next))} />;
  }
  return <SourceViewer {...frame} className="source-file source-editing source-markup" onClose={() => void close()}
    actions={<EditActions dirty={dirty} busy={flow.busy || !picture} onCancel={() => void flow.cancel()} onSave={() => void flow.saveVersion()} onAsk={() => void flow.ask(source)} />}
    toolbar={<MarkupToolbar tool={tool} onTool={setTool} palette={palette} color={colorId} onColor={setColorId} level={level} onLevel={setLevel}
      canUndo={history.past.length > 0} canRedo={history.future.length > 0} onUndo={() => setHistory(current => undo(current))} onRedo={() => setHistory(current => redo(current))} />}>
    {flow.error && <p role="alert" className="error">{flow.error}</p>}
    {body}
  </SourceViewer>;
}

/** The PDF writer and its font once they have loaded and the file opened for writing, or why the file cannot be marked up. */
type PdfWriting = { writer: Awaited<ReturnType<typeof loadPdfWriting>>['writer']; fontBytes: Uint8Array } | { refused: string };

/**
 * A PDF marked up in the viewer (COD-302): the picture's tools without crop, notes typed onto the page, and the pages
 * one at a time with the page controls at the end of the bar. Marks stay with their page; undo and redo reach across
 * pages and turn to the page they changed. Saving writes the marks into a new PDF next to the original.
 */
export function PdfEditing({ frame, source, media, save, onDone, onSaved, onAsk, onClose }: EditModeProps & { media: SourceBytes }) {
  const opened = usePdfDocument(media.bytes);
  const pdf = opened && 'document' in opened ? opened.document : undefined;
  const pageCount = pdf?.numPages ?? 1;
  const [page, setPage] = useState(1);
  const picture = usePdfPage(pdf, page);
  const [writing, setWriting] = useState<PdfWriting>();
  const [palette] = useState(markupPalette);
  const [tool, setTool] = useState<MarkupTool>('pen');
  const [colorId, setColorId] = useState(palette[0].id);
  const [level, setLevel] = useState<StrokeLevel>('medium');
  const [history, setHistory] = useState<History<PdfMarkup>>(() => ({ past: [], present: emptyPdfMarkup, future: [] }));
  // The layout each page was drawn in, kept for every page shown: marks are only ever made on a page on screen.
  const layouts = useRef(new Map<number, PageTransform>());
  if (picture && picture !== 'failed') layouts.current.set(page, picture.transform);
  const dirty = isPdfChanged(history.present);

  useEffect(() => {
    let active = true;
    // The writer checks the file opens for writing before any mark is made, so a locked PDF says so at once.
    void loadPdfWriting()
      .then(async loaded => {
        await loaded.writer.openForMarkup(media.bytes);
        if (active) setWriting(loaded);
      })
      .catch(error => { if (active) setWriting({ refused: (error as Error).message }); });
    return () => { active = false; };
  }, [media.bytes]);

  const refused = (opened !== undefined && 'failed' in opened) || (writing !== undefined && 'refused' in writing);
  const ready = Boolean(pdf) && writing !== undefined && !('refused' in writing);
  const flow = useEditFlow({
    dirty, save, onSaved, onAsk, onDone,
    content: async () => {
      if (!writing || 'refused' in writing) throw new Error(t('PDF chưa mở xong.'));
      const pages = markedPages(history.present).map(number => {
        const transform = layouts.current.get(number);
        if (!transform) throw new Error(t('PDF chưa mở xong.'));
        return { page: number, transform, marks: pageMarks(history.present, number) };
      });
      return { bytes: await writing.writer.writeMarkedPdf(media.bytes, pages, writing.fontBytes) };
    },
  });
  const close = async () => { if (await leaveUnsaved(dirty)) onClose(); };
  /** Undo or redo, then show the page the step changed. */
  function step(next: History<PdfMarkup>) {
    const changed = changedPage(history.present, next.present);
    setHistory(next);
    if (changed !== undefined) setPage(changed);
  }
  useMarkupKeys({
    tools: PDF_TOOLS,
    onSave: () => void flow.saveVersion(),
    onUndo: () => step(undo(history)),
    onRedo: () => step(redo(history)),
    onTool: setTool,
    onLevel: setLevel,
    onPage: delta => setPage(current => stepPage(current, delta, pageCount)),
  });
  const shownMarkup = useMemo<Markup>(() => ({ marks: [...pageMarks(history.present, page)] }), [history.present, page]);
  const color = palette.find(entry => entry.id === colorId)?.value ?? palette[0].value;

  let body: ReactNode;
  if (opened && 'failed' in opened) body = <p className="preview-state">{t('Không mở được PDF này để đánh dấu.')}</p>;
  else if (writing && 'refused' in writing) body = <p className="preview-state">{tMessage(writing.refused)}</p>;
  else if (picture === 'failed') body = <p className="preview-state">{t('Không vẽ được trang {0}.', [page])}</p>;
  else if (!picture || !writing) {
    body = <SkeletonGroup label={t('Đang mở…')} className="markup-stage markup-stage-page"><Skeleton shape="block" className="markup-page-shape" /></SkeletonGroup>;
  } else {
    const markCount = shownMarkup.marks.length;
    const pageName = t('{0}, trang {1}', [source.name, page]);
    const label = markCount === 1 ? t('{0}, 1 dấu', [pageName]) : markCount > 0 ? t('{0}, {1} dấu', [pageName, markCount]) : pageName;
    body = <MarkupCanvas key={page} picture={picture.picture} size={picture.size} markup={shownMarkup} tool={tool} color={color}
      width={strokeWidth(level, picture.size)} fontSize={noteSize(level, picture.size)} label={label} plainText pageWidth={PDF_PAGE_WIDTH}
      onCommit={next => setHistory(current => commit(current, withPageMarks(current.present, page, next.marks)))} />;
  }
  return <SourceViewer {...frame} className="source-file source-editing source-markup" onClose={() => void close()}
    // A PDF that cannot be marked up keeps Cancel and Ask about this (the original goes on the message), and no tools.
    actions={<EditActions dirty={dirty} busy={flow.busy || (!ready && !refused)} onCancel={() => void flow.cancel()} onSave={() => void flow.saveVersion()} onAsk={() => void flow.ask(source)} />}
    toolbar={refused ? undefined : <MarkupToolbar tools={PDF_TOOLS} tool={tool} onTool={setTool} palette={palette} color={colorId} onColor={setColorId} level={level} onLevel={setLevel}
      canUndo={history.past.length > 0} canRedo={history.future.length > 0} onUndo={() => step(undo(history))} onRedo={() => step(redo(history))}>
      {pdf && <PdfPageNavigator page={page} pageCount={pageCount} onPage={setPage} />}
    </MarkupToolbar>}>
    {flow.error && <p role="alert" className="error">{flow.error}</p>}
    {body}
  </SourceViewer>;
}
