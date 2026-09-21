import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState, type ReactNode } from 'react';
import { ExternalLink, ShieldOff, X } from 'lucide-react';
import type { Source, SourceBytes, TaskDetail } from '../../shared/contracts';
import { INLINE_PREVIEW_LIMIT } from '../../shared/source-kinds';
import { Button, keepOpenForPopup } from './ui';
import { InfoTip, type InfoTipRow } from './InfoTip';
import { RowMenu, type RowMenuItem } from './RowMenu';
import { fileKindIcon, fileKindLabel, fileSize } from './Attachment';
import { SourcePreview, previewKindOf } from './SourcePreview';
import { currentLocale, t, tMessage } from '../i18n';
import { orglet } from '../api';
import type { Icon } from './icons';

/**
 * One attached file, opened on its own (user, 2026-09-21: never every source of the chat stacked in one dialog).
 * Modelled on the document viewer: a slim toolbar with close on the left, the file's name and kind in the middle
 * and its actions on the right, above the file's content on a grey backdrop. Technical detail (kind, size, where it
 * came from, id, hash, access) lives behind the info button; revoking is a quiet menu item with its own question.
 */
export function SourceViewer({ open, onClose, name, meta, icon: KindIcon, info, infoLabel, menu, menuLabel, actions, children }: {
  open: boolean; onClose: () => void; name: string; meta: string; icon: Icon; info: InfoTipRow[]; infoLabel: string;
  menu?: RowMenuItem[]; menuLabel: string; actions?: ReactNode; children: ReactNode;
}) {
  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="modal-overlay" />
      <Dialog.Content id="source-viewer" className="doc-viewer source-viewer" aria-describedby={undefined} onEscapeKeyDown={keepOpenForPopup}>
        <div className="doc-toolbar">
          <Dialog.Close asChild><Button size="icon" aria-label={t('Đóng tệp')} title={t('Đóng tệp')}><X size={18} /></Button></Dialog.Close>
          <div className="source-viewer-heading">
            <Dialog.Title className="doc-title"><KindIcon size={16} aria-hidden="true" /><span>{name}</span></Dialog.Title>
            <span className="source-viewer-meta">{meta}</span>
          </div>
          <div className="doc-actions">
            {actions}
            <InfoTip label={infoLabel} rows={info} />
            {menu && menu.length > 0 && <RowMenu label={menuLabel} className="source-action" items={menu} />}
          </div>
        </div>
        <div className="doc-scroll"><div className="source-stage">{children}</div></div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
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

/**
 * The viewer wired to the core for one source of a chat: fetches its content through the same permission, revoke and
 * hash gate a worker faces, and offers the person's own controls (open in the default app, revoke).
 */
export function SourceDialog({ detail, sourceId, lines, onClose, refresh }: { detail: TaskDetail; sourceId: string; lines?: [number, number]; onClose: () => void; refresh: () => void }) {
  const source = detail.sources.find(item => item.id === sourceId);
  const taskId = detail.task.id;
  const [content, setContent] = useState<Content>({ loading: true });
  const [origin, setOrigin] = useState<string | null>(null);
  const [error, setError] = useState('');
  const state = source ? inlineState(source) : 'revoked';
  useEffect(() => {
    let active = true;
    void orglet.call('sourceOrigins', { taskId }).then(rows => { if (active) setOrigin(rows.find(row => row.id === sourceId)?.path ?? null); }).catch(() => { /* the popover simply omits the origin */ });
    return () => { active = false; };
  }, [taskId, sourceId]);
  useEffect(() => {
    if (!source || state !== 'ready') { setContent({ loading: false }); return; }
    let active = true;
    setContent({ loading: true });
    const request = source.media
      ? orglet.call('sourceBytes', { taskId, id: sourceId }).then(media => ({ loading: false, media }))
      : orglet.call('previewSource', { taskId, id: sourceId }).then(result => ({ loading: false, text: result.text }));
    void request.then(next => { if (active) setContent(next); })
      .catch(err => { if (active) setContent({ loading: false, error: (err as Error).message }); });
    return () => { active = false; };
  }, [taskId, sourceId, state, source?.hash]);
  useEffect(() => {
    if (lines && content.text !== undefined) document.querySelector('#source-viewer .line-highlight')?.scrollIntoView({ block: 'center' });
  }, [content, lines?.[0], lines?.[1]]);
  if (!source) return null;
  async function revoke() {
    setError('');
    try { await orglet.call('revoke', { id: sourceId }); refresh(); }
    catch (err) { setError((err as Error).message); }
  }
  async function openExternally() {
    setError('');
    try { await orglet.openSource(taskId, sourceId); }
    catch (err) { setError((err as Error).message); }
  }
  const info: InfoTipRow[] = [
    { label: t('Loại'), value: `${fileKindLabel(source.name)}${extensionOf(source.name) ? ` · ${extensionOf(source.name)}` : ''}` },
    { label: t('Kích thước'), value: `${fileSize(source.bytes)} (${source.bytes.toLocaleString(currentLocale())} bytes)` },
  ];
  if (origin) info.push({ label: t('Nguồn gốc'), value: origin, mono: true, onCopy: () => orglet.copyText(origin) });
  info.push({ label: 'ID', value: source.id, mono: true, onCopy: () => orglet.copyText(source.id) });
  info.push({ label: 'SHA-256', value: source.hash, mono: true, onCopy: () => orglet.copyText(source.hash) });
  info.push({ label: t('Quyền truy cập'), value: source.revoked ? t('Đã thu hồi quyền đọc') : t('Chỉ đọc trong task') });
  const menu: RowMenuItem[] = source.revoked ? [] : [{
    label: t('Thu hồi quyền đọc'), icon: ShieldOff, danger: true, onSelect: () => void revoke(),
    confirm: { question: t('Tí sẽ không đọc được tệp này nữa. Nội dung đã gửi đến provider không thu hồi được.'), label: t('Thu hồi quyền đọc') },
  }];
  const externally = source.media && !source.revoked
    ? <Button variant="outline" className="doc-action" onClick={() => void openExternally()}><ExternalLink size={15} />{t('Mở bằng ứng dụng mặc định')}</Button>
    : undefined;
  function body(source: Source) {
    if (state === 'revoked') return <p className="preview-state">{t('Đã thu hồi quyền đọc')}</p>;
    if (state === 'parquet') return <p className="preview-state">{t('Parquet chưa xem trực tiếp được; chạy checker local trong Nguồn của cuộc trò chuyện để xem cột và số dòng.')}</p>;
    if (state === 'too-large') return <p className="preview-state">{t('Tệp quá lớn để xem trong Orglet.')}</p>;
    if (content.loading) return <p className="preview-state">{t('Đang mở…')}</p>;
    if (content.error) return <p className="preview-state">{tMessage(content.error)}</p>;
    return <SourcePreview name={source.name} kind={previewKindOf(source)} text={content.text} media={content.media} citedLines={lines} openExternally={externally} />;
  }
  return <SourceViewer open onClose={onClose} name={source.name} meta={`${fileKindLabel(source.name)} · ${fileSize(source.bytes)}`} icon={fileKindIcon(source.name)}
    info={info} infoLabel={t('Thông tin về {0}', [source.name])} menu={menu} menuLabel={t('Tùy chọn cho {0}', [source.name])} actions={externally}>
    {error && <p role="alert" className="error">{error}</p>}
    {body(source)}
  </SourceViewer>;
}
