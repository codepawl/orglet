import { Viewer } from '@codepawl/orglet-ui';
import { useEffect, useState, type ReactNode } from 'react';
import { ExternalLink, FolderOpen, MessageSquarePlus, Pencil, PenLine, ShieldOff, X } from 'lucide-react';
import type { Source, SourceBytes, TaskDetail } from '../../shared/contracts';
import { INLINE_PREVIEW_LIMIT } from '../../shared/source-kinds';
import { versionName } from '../../shared/source-versions';
import { Button } from './ui';
import { InfoTip, type InfoTipRow } from './InfoTip';
import { RowMenu, type RowMenuItem } from './RowMenu';
import { fileKindIcon, fileKindLabel, fileSize } from './Attachment';
import { SourcePreview, previewKindOf } from './SourcePreview';
import { ImageEditing, TextEditing } from './SourceEditing';
import { languageOf } from './highlight';
import { currentLocale, t, tMessage } from '../i18n';
import { orglet } from '../api';
import { Skeleton, SkeletonGroup, SkeletonText } from '@codepawl/orglet-ui';
import { sourcePreviews } from '../caches';
import { useCached } from '../prefetch';
import type { Icon } from './icons';

/** What every mode of the source viewer shows the same way: the name, kind and size, the info and the options. */
export type SourceViewerFrame = {
  name: string; meta: ReactNode; icon: Icon; info: InfoTipRow[]; infoLabel: string; menu?: RowMenuItem[]; menuLabel: string;
};

/**
 * One attached file, opened on its own (user, 2026-09-21: never every source of the chat stacked in one dialog).
 * Modelled on the document viewer: a slim toolbar with close on the left, the file's name and kind in the middle
 * and its actions on the right, above the file's content on a grey backdrop. Technical detail (kind, size, where it
 * came from, id, hash, access) lives behind the info button; revoking is a quiet menu item with its own question.
 * An edit mode (COD-280) adds its tools in a second row (`toolbar`) and its own actions.
 */
export function SourceViewer({ open = true, onClose, name, meta, icon: KindIcon, info, infoLabel, menu, menuLabel, actions, toolbar, className, children }: SourceViewerFrame & {
  open?: boolean; onClose: () => void; actions?: ReactNode; toolbar?: ReactNode; className?: string; children: ReactNode;
}) {
  return <Viewer open={open} onClose={onClose} id="source-viewer" className={className ? `source-viewer ${className}` : 'source-viewer'} title={name} icon={<KindIcon size={16} aria-hidden="true" />} meta={meta}
    closeLabel={t('Đóng tệp')} closeIcon={<X size={18} />} toolbar={toolbar}
    actions={<>
      {actions}
      <InfoTip label={infoLabel} rows={info} />
      {menu && menu.length > 0 && <RowMenu label={menuLabel} className="source-action" items={menu} />}
    </>}>
    <div className="source-stage">{children}</div>
  </Viewer>;
}

/** What has been fetched for the open source: text for text kinds, bytes for media, or why nothing could be. */
type Content = { loading: boolean; text?: string; media?: SourceBytes; error?: string };

/** Whether the window can show the source's content, or the one reason it cannot. */
function inlineState(source: Source): 'ready' | 'revoked' | 'parquet' | 'too-large' {
  if (source.revoked) return 'revoked';
  if (source.format === 'parquet') return 'parquet';
  if (source.media && source.bytes > INLINE_PREVIEW_LIMIT) return 'too-large';
  return 'ready';
}

function extensionOf(name: string) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : '';
}

/** What a source can be edited as in the viewer (COD-280), or undefined when it cannot be. */
export function editKindOf(source: Source): 'text' | 'image' | undefined {
  if (inlineState(source) !== 'ready') return undefined;
  if (source.media === 'image') return 'image';
  if (source.media) return undefined;
  return 'text';
}

/** Whether a key press belongs to a field being typed in. */
function typingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

/** E starts editing while the file is being read, unless a field has the keyboard. */
function useEditShortcut(enabled: boolean, onEdit: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'e' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (typingInField(event.target)) return;
      event.preventDefault();
      onEdit();
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [enabled, onEdit]);
}

/**
 * The viewer wired to the core for one source of a chat: fetches its content through the same permission, revoke and
 * hash gate a worker faces, and offers the person's own controls (open in the default app, revoke). A text or code
 * file can be edited and a picture marked up (COD-280); saving keeps the edit as a new source of the chat, next to the
 * original, and Ask about this puts a file on the chat's next message.
 */
export function SourceDialog({ detail, sourceId, lines, onClose, refresh, openSource, onAsk }: {
  detail: TaskDetail; sourceId: string; lines?: [number, number]; onClose: () => void; refresh: () => void;
  /** Opens another source of the chat in the viewer, such as the version just saved. */
  openSource: (sourceId: string) => void;
  /** Attaches a source to the chat's next message and closes the viewer. */
  onAsk: (source: Source) => void;
}) {
  const source = detail.sources.find(item => item.id === sourceId);
  const taskId = detail.task.id;
  // A text source seen this session is drawn at once (COD-218); the hash in the key pins the copy to the file as it was.
  const previewKey = source && !source.media ? `${taskId}:${sourceId}:${source.hash}` : undefined;
  const keptText = useCached(sourcePreviews, previewKey);
  const [content, setContent] = useState<Content>(() => (keptText !== undefined ? { loading: false, text: keptText } : { loading: true }));
  // Where the file was picked from: undefined until the core answers, null for a source restored from a backup.
  const [origin, setOrigin] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  // A version just saved opens as soon as the chat's list of sources has it.
  const [opening, setOpening] = useState<string>();
  const state = source ? inlineState(source) : 'revoked';
  const editKind = source ? editKindOf(source) : undefined;
  const ready = !content.loading && !content.error && (content.text !== undefined || content.media !== undefined);
  useEditShortcut(Boolean(editKind) && ready && !editing, () => setEditing(true));
  useEffect(() => {
    let active = true;
    void orglet.call('sourceOrigins', { taskId }).then(rows => { if (active) setOrigin(rows.find(row => row.id === sourceId)?.path ?? null); }).catch(() => { /* the popover simply omits the origin */ });
    return () => { active = false; };
  }, [taskId, sourceId, source?.revoked]);
  useEffect(() => {
    if (!source || state !== 'ready') { setContent({ loading: false }); return; }
    if (keptText !== undefined) { setContent({ loading: false, text: keptText }); return; }
    let active = true;
    setContent({ loading: true });
    const request = source.media
      ? orglet.call('sourceBytes', { taskId, id: sourceId }).then(media => ({ loading: false, media }))
      : sourcePreviews.read(previewKey!).then(text => ({ loading: false, text }));
    void request.then(next => { if (active) setContent(next); })
      .catch(err => { if (active) setContent({ loading: false, error: (err as Error).message }); });
    return () => { active = false; };
  }, [taskId, sourceId, state, source?.hash, keptText]);
  useEffect(() => {
    if (lines && content.text !== undefined) document.querySelector('#source-viewer .line-highlight')?.scrollIntoView({ block: 'center' });
  }, [content, lines?.[0], lines?.[1]]);
  useEffect(() => {
    if (opening && detail.sources.some(item => item.id === opening)) openSource(opening);
  }, [opening, detail.sources]);
  if (!source) return null;
  async function revoke() {
    setError('');
    try { await orglet.call('revoke', { id: sourceId }); refresh(); }
    catch (err) { setError((err as Error).message); }
  }
  async function relink() {
    setError('');
    try {
      const relinked = await orglet.relinkSource(taskId, sourceId);
      if (relinked) refresh();
    } catch (err) { setError(tMessage((err as Error).message)); }
  }
  async function openExternally() {
    setError('');
    try { await orglet.openSource(taskId, sourceId); }
    catch (err) { setError((err as Error).message); }
  }
  const editedFrom = source.editedFrom ? detail.sources.find(item => item.id === source.editedFrom) : undefined;
  const info: InfoTipRow[] = [
    { label: t('Loại'), value: `${fileKindLabel(source.name)}${extensionOf(source.name) ? ` · ${extensionOf(source.name)}` : ''}` },
    { label: t('Kích thước'), value: `${fileSize(source.bytes)} (${source.bytes.toLocaleString(currentLocale())} bytes)` },
  ];
  if (editedFrom) info.push({ label: t('Sửa từ'), value: editedFrom.name });
  if (origin) info.push({ label: source.editedFrom ? t('Bản lưu') : t('Nguồn gốc'), value: origin, mono: true, onCopy: () => orglet.copyText(origin) });
  info.push({ label: 'ID', value: source.id, mono: true, onCopy: () => orglet.copyText(source.id) });
  info.push({ label: 'SHA-256', value: source.hash, mono: true, onCopy: () => orglet.copyText(source.hash) });
  const restoredWithoutFile = source.revoked && origin === null;
  info.push({ label: t('Quyền truy cập'), value: restoredWithoutFile ? t('Từ bản sao lưu, chưa có tệp trên máy này') : source.revoked ? t('Đã thu hồi quyền đọc') : t('Chỉ đọc trong task') });
  const menu: RowMenuItem[] = source.revoked ? [] : [{
    label: t('Thu hồi quyền đọc'), icon: ShieldOff, danger: true, onSelect: () => void revoke(),
    confirm: { question: t('Tí sẽ không đọc được tệp này nữa. Nội dung đã gửi đến provider không thu hồi được.'), label: t('Thu hồi quyền đọc') },
  }];
  const kindAndSize = `${fileKindLabel(source.name)} · ${fileSize(source.bytes)}`;
  const meta = editedFrom ? t('{0} · sửa từ {1}', [kindAndSize, editedFrom.name]) : kindAndSize;
  const frame: SourceViewerFrame = { name: source.name, meta, icon: fileKindIcon(source.name), info, infoLabel: t('Thông tin về {0}', [source.name]), menu, menuLabel: t('Tùy chọn cho {0}', [source.name]) };
  const original = source;
  async function saveVersion(edit: { text: string } | { bytes: Uint8Array<ArrayBuffer> }): Promise<Source> {
    const takenNames = detail.sources.map(item => item.name);
    const name = versionName(original.name, takenNames, t('đã sửa'), editKind === 'image' ? 'png' : undefined);
    return orglet.call('saveSourceVersion', { taskId, sourceId, name, ...edit });
  }
  // The viewer opening the new version, with its name and "edited from" line, is the confirmation; a toast would sit
  // over that very title.
  function saved(version: Source) {
    refresh();
    setEditing(false);
    setOpening(version.id);
  }
  if (editing && editKind === 'text' && content.text !== undefined) {
    return <TextEditing frame={frame} source={source} text={content.text} language={languageOf(source.name)} save={saveVersion}
      onDone={() => setEditing(false)} onSaved={saved} onAsk={onAsk} onClose={onClose} />;
  }
  if (editing && editKind === 'image' && content.media) {
    return <ImageEditing frame={frame} source={source} media={content.media} save={saveVersion}
      onDone={() => setEditing(false)} onSaved={saved} onAsk={onAsk} onClose={onClose} />;
  }
  const externally = source.media && !source.revoked
    ? <Button variant="outline" className="doc-action source-open-external" aria-label={t('Mở bằng ứng dụng mặc định')} title={t('Mở bằng ứng dụng mặc định')} onClick={() => void openExternally()}><ExternalLink size={15} /><span className="source-action-label">{t('Mở bằng ứng dụng mặc định')}</span></Button>
    : undefined;
  const actions = <>
    {!source.revoked && <Button variant="ghost" className="doc-action source-ask" aria-label={t('Hỏi về tệp này')} title={t('Đính kèm tệp này vào tin nhắn tiếp theo')} onClick={() => onAsk(source)}>
      <MessageSquarePlus size={15} /><span className="source-action-label">{t('Hỏi về tệp này')}</span>
    </Button>}
    {editKind && <Button variant="outline" className="doc-action source-edit" aria-label={editKind === 'image' ? t('Đánh dấu') : t('Chỉnh sửa')} disabled={!ready} aria-keyshortcuts="E" title={editKind === 'image' ? t('Đánh dấu ảnh (E)') : t('Chỉnh sửa (E)')} onClick={() => setEditing(true)}>
      {editKind === 'image' ? <PenLine size={15} /> : <Pencil size={15} />}<span className="source-action-label">{editKind === 'image' ? t('Đánh dấu') : t('Chỉnh sửa')}</span>
    </Button>}
    {externally}
  </>;
  function body(source: Source) {
    // A backup carries no file contents, so a restored file waits until the person points it at the same file here.
    if (state === 'revoked' && restoredWithoutFile) return <div className="preview-state source-restored">
      <p>{t('Tệp này đến từ bản sao lưu nên chưa có trên máy này. Chọn đúng tệp {0} để mở lại.', [source.name])}</p>
      <Button variant="outline" onClick={() => void relink()}><FolderOpen size={14} />{t('Chọn tệp trên máy')}</Button>
    </div>;
    if (state === 'revoked') return <p className="preview-state">{t('Đã thu hồi quyền đọc')}</p>;
    if (state === 'parquet') return <p className="preview-state">{t('Parquet chưa xem được; chạy checker local để xem cột và số dòng.')}</p>;
    if (state === 'too-large') return <p className="preview-state">{t('Tệp quá lớn để xem trong Orglet.')}</p>;
    if (content.loading) return <SkeletonGroup label={t('Đang mở…')} className="source-shape">{source.media ? <Skeleton shape="block" className="source-shape-media" /> : <SkeletonText lines={8} />}</SkeletonGroup>;
    if (content.error) return <p className="preview-state">{tMessage(content.error)}</p>;
    return <SourcePreview name={source.name} kind={previewKindOf(source)} text={content.text} media={content.media} citedLines={lines} openExternally={externally} />;
  }
  return <SourceViewer {...frame} className="source-file" onClose={onClose} actions={actions}>
    {error && <p role="alert" className="error">{error}</p>}
    {body(source)}
  </SourceViewer>;
}
