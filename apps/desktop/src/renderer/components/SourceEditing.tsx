import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { MessageSquarePlus, Save } from 'lucide-react';
import type { Source, SourceBytes } from '../../shared/contracts';
import { Button } from './ui';
import { confirmAction } from './confirm';
import { SourceViewer, type SourceViewerFrame } from './SourceViewer';
import type { TextEditorHandle } from './TextEditor';
import { SkeletonGroup, SkeletonText } from '@codepawl/orglet-ui';
import { MarkupCanvas, MarkupToolbar, markupPalette, markupPng, markupTools, strokeWidth, textSize, usePicture } from './ImageMarkup';
import { commit, isChanged, redo, startHistory, undo, type MarkupHistory, type MarkupTool, type StrokeLevel } from '../markup';
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
 * The actions of an edit mode, on the viewer's toolbar: Cancel goes back to reading, Save keeps the edit as a new
 * version (Ctrl+S), and Ask about this saves if needed and puts the version on the chat's next message.
 */
function EditActions({ dirty, busy, onCancel, onSave, onAsk }: { dirty: boolean; busy: boolean; onCancel: () => void; onSave: () => void; onAsk: () => void }) {
  return <>
    <Button type="button" variant="ghost" className="doc-action" disabled={busy} onClick={onCancel}>{t('Hủy')}</Button>
    <Button type="button" variant="outline" className="doc-action edit-save" aria-label={t('Lưu bản mới')} disabled={busy || !dirty} title={t('Lưu thành bản mới (Ctrl+S)')} aria-keyshortcuts="Control+S" onClick={onSave}>
      <Save size={15} /><span className="edit-action-label">{t('Lưu bản mới')}</span>
    </Button>
    <Button type="button" variant="primary" className="doc-action edit-ask" aria-label={t('Hỏi về bản này')} disabled={busy} onClick={onAsk}>
      <MessageSquarePlus size={15} /><span className="edit-action-label">{t('Hỏi về bản này')}</span>
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
  const shortcuts = useRef<(event: KeyboardEvent) => void>(() => {});
  shortcuts.current = event => {
    if (typingInField(event.target) || event.altKey) return;
    const key = event.key.toLowerCase();
    const command = event.ctrlKey || event.metaKey;
    if (command && key === 's') { event.preventDefault(); void flow.saveVersion(); return; }
    if (command && (key === 'y' || (key === 'z' && event.shiftKey))) { event.preventDefault(); setHistory(current => redo(current)); return; }
    if (command && key === 'z') { event.preventDefault(); setHistory(current => undo(current)); return; }
    if (command) return;
    const picked = markupTools().find(item => item.shortcut?.toLowerCase() === key);
    if (picked) { setTool(picked.value); return; }
    if (key === '1') setLevel('thin');
    if (key === '2') setLevel('medium');
    if (key === '3') setLevel('thick');
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => shortcuts.current(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);
  const color = palette.find(entry => entry.id === colorId)?.value ?? palette[0].value;
  let body: ReactNode;
  if (!loaded) body = null;
  else if (!picture) body = <p className="preview-state">{t('Không mở được ảnh này để đánh dấu.')}</p>;
  else {
    const markCount = history.present.marks.length;
    const label = markCount > 0 ? t('{0}, {1} dấu', [source.name, markCount]) : source.name;
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
