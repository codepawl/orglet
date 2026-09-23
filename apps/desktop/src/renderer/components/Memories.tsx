import { useState } from 'react';
import { MessageSquare, Pencil, Pin, PinOff, Trash } from 'lucide-react';
import { Textarea } from '@codepawl/orglet-ui';
import type { Workspace } from '../../shared/contracts';
import { MEMORY_TEXT_LIMIT, type Knowledge } from '../../shared/knowledge';
import { Button } from './ui';
import { RowMenu } from './RowMenu';
import { toast } from './toast';
import { currentLocale, t, tMessage } from '../i18n';
import { orglet } from '../api';

/** The chat a memory came from, by its name in the sidebar; a deleted chat leaves only that it was one. */
function originOf(item: Knowledge, workspace: Pick<Workspace, 'tasks'>): { taskId?: string; label: string } {
  const provenance = item.provenance;
  if (provenance.kind !== 'turn') return { label: t('Bạn') };
  const task = workspace.tasks.find(candidate => candidate.id === provenance.taskId);
  if (!task || task.deletedAt) return { label: t('chat đã xóa') };
  const firstLine = task.brief.split('\n')[0].replace(/\s+/g, ' ').trim();
  const name = task.title ?? (firstLine.length > 48 ? `${firstLine.slice(0, 48).replace(/\s+\S*$/, '')}…` : firstLine);
  return { taskId: task.id, label: name };
}

/**
 * What a worker remembered from its chats (COD-161): one line each, newest first, the chat it came from, and the
 * person's corrections in place. Knows nothing about which scope it lists; the parent picks the rows.
 */
export function MemoryList({ memories, workspace, showScope, onOpenChat }: { memories: Knowledge[]; workspace: Workspace; /** Name the scope on each row, for a list that mixes workers, teams and the workspace. */ showScope?: boolean; onOpenChat: (taskId: string) => void }) {
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState('');
  const [busyId, setBusyId] = useState<string>();
  const act = (item: Knowledge, perform: () => Promise<unknown>) => {
    setBusyId(item.id);
    void perform().catch(error => toast(tMessage(String(error)), 'error', t('Ghi nhớ'))).finally(() => setBusyId(undefined));
  };
  const startEditing = (item: Knowledge) => { setEditingId(item.id); setDraft(item.content); };
  const saveEdit = (item: Knowledge) => {
    const text = draft.trim();
    if (!text || text === item.content) { setEditingId(undefined); return; }
    act(item, async () => { await orglet.call('updateMemory', { id: item.id, text }); setEditingId(undefined); });
  };
  const scopeName = (item: Knowledge) => {
    const scope = item.scope;
    if (scope.type === 'workspace') return t('Toàn workspace');
    if (scope.type === 'team') return workspace.teams.find(team => team.id === scope.id)?.name ?? t('Hội');
    return workspace.workers.find(worker => worker.id === scope.id)?.name ?? t('Tí');
  };
  if (!memories.length) return <p className="muted memory-empty">{t('Chưa ghi nhớ gì từ các cuộc trò chuyện.')}</p>;
  return <ul className="memory-list">
    {memories.map(item => {
      const origin = originOf(item, workspace);
      const when = new Date(item.createdAt).toLocaleDateString(currentLocale(), { dateStyle: 'medium' });
      const editing = editingId === item.id;
      const busy = busyId === item.id;
      return <li key={item.id} className={item.pinned ? 'memory-item pinned' : 'memory-item'}>
        <div className="memory-body">
          {editing
            ? <form className="memory-edit" onSubmit={event => { event.preventDefault(); saveEdit(item); }}>
              <Textarea aria-label={t('Nội dung ghi nhớ')} rows={2} value={draft} maxLength={MEMORY_TEXT_LIMIT} autoFocus onChange={event => setDraft(event.target.value)}
                onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setEditingId(undefined); } if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); saveEdit(item); } }} />
              <div className="memory-edit-actions">
                <Button type="submit" variant="primary" disabled={busy}>{t('Lưu')}</Button>
                <Button type="button" disabled={busy} onClick={() => setEditingId(undefined)}>{t('Hủy')}</Button>
              </div>
            </form>
            : <p className="memory-text">{item.content}</p>}
          <p className="memory-meta">
            {item.status === 'proposed' && <span className="badge pending">{t('Chờ duyệt')}</span>}
            {showScope && <span>{scopeName(item)}</span>}
            {origin.taskId
              ? <button type="button" className="memory-origin" onClick={() => onOpenChat(origin.taskId!)}><MessageSquare size={12} aria-hidden="true" />{t('từ {0}', [origin.label])}</button>
              : <span>{t('từ {0}', [origin.label])}</span>}
            <span>{when}</span>
          </p>
        </div>
        <div className="memory-actions">
          {item.pinned && <Pin size={14} className="memory-pinned-mark" aria-label={t('Đã ghim')} />}
          <RowMenu label={t('Tùy chọn ghi nhớ')} items={[
            { label: t('Sửa'), icon: Pencil, onSelect: () => startEditing(item) },
            item.pinned
              ? { label: t('Bỏ ghim'), icon: PinOff, onSelect: () => act(item, () => orglet.call('updateMemory', { id: item.id, pinned: false })) }
              : { label: t('Ghim'), icon: Pin, onSelect: () => act(item, () => orglet.call('updateMemory', { id: item.id, pinned: true })) },
            { label: t('Xóa'), icon: Trash, danger: true, confirm: { question: t('Xóa ghi nhớ này?'), label: t('Xóa') }, onSelect: () => act(item, () => orglet.call('deleteMemory', { id: item.id })) },
          ]} />
        </div>
      </li>;
    })}
  </ul>;
}
