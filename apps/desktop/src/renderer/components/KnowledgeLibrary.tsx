import { useEffect, useState } from 'react';
import { Globe, UserRound, Users, FileText, Pin, Search, Tag, Target, Type } from 'lucide-react';
import type { Workspace } from '../../shared/contracts';
import type { Knowledge, KnowledgeScope, RunContext } from '../../shared/knowledge';
import { Button, FieldLabel } from './ui';
import { Select } from './Select';
import { t } from '../i18n';
import { orglet } from '../api';
import { SwitchField } from './Switch';

export function scopeLabel(scope: KnowledgeScope, workspace: Workspace) {
  if (scope.type === 'workspace') return t('Toàn workspace');
  if (scope.type === 'team') return t('Hội {0}', [workspace.teams.find(team => team.id === scope.id)?.name ?? scope.id]);
  return t('Tí {0}', [workspace.workers.find(worker => worker.id === scope.id)?.name ?? scope.id]);
}
const provenanceLabel = (item: Knowledge) => item.provenance.kind === 'run' ? t('Đề xuất từ một lần chạy') : item.provenance.kind === 'template' ? t('Nhập từ template hội') : t('Bạn tạo');

export function KnowledgeLibrary({ workspace, onOpen }: { workspace: Workspace; onOpen: (item?: Knowledge) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Knowledge[]>(workspace.knowledge);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      orglet.call('searchKnowledge', { query }).then(items => { if (active) { setResults(items); setError(''); } }).catch(err => { if (active) setError((err as Error).message); });
    }, 150);
    return () => { active = false; clearTimeout(timer); };
  }, [query, workspace.knowledge]);
  const visible = results.filter(item => item.status !== 'archived');
  const proposed = visible.filter(item => item.status === 'proposed');
  const approved = visible.filter(item => item.status === 'approved');
  const row = (item: Knowledge) => <Button key={item.id} variant="outline" className="library-item" onClick={() => onOpen(item)}>
    <span className="library-text">{item.title}<small className="muted">{scopeLabel(item.scope, workspace)}{item.tags.length ? ` · ${item.tags.join(', ')}` : ''}</small></span>
    {item.pinned && <Pin size={14} aria-label={t('Luôn nạp')} />}<span className="badge">v{item.revision}</span>
  </Button>;
  return <div className="form">
    <label><FieldLabel icon={Search}>{t('Tìm knowledge')}</FieldLabel><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Từ khóa hoặc tag')} maxLength={200} /></label>
    {proposed.length > 0 && <section aria-label={t('Chờ duyệt')}><h3>{t('Chờ duyệt ({0})', [proposed.length])}</h3>{proposed.map(row)}</section>}
    <section aria-label={t('Đã duyệt')}><h3>{t('Đã duyệt ({0})', [approved.length])}</h3>{approved.map(row)}{!approved.length && <p className="muted">{query ? t('Không có mục khớp.') : t('Chưa có knowledge đã duyệt.')}</p>}</section>
    {error && <p role="alert" className="error">{error}</p>}
  </div>;
}

export function KnowledgeEditor({ item, workspace, done }: { item?: Knowledge; workspace: Workspace; done: () => void }) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [content, setContent] = useState(item?.content ?? '');
  const [tags, setTags] = useState(item?.tags.join(', ') ?? '');
  const [pinned, setPinned] = useState(item?.pinned ?? false);
  const [scope, setScope] = useState(item ? (item.scope.type === 'workspace' ? 'workspace' : `${item.scope.type}:${item.scope.id}`) : 'workspace');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const proposed = item?.status === 'proposed';
  const changed = !item || title !== item.title || content !== item.content || tags !== item.tags.join(', ') || pinned !== item.pinned || scope !== (item.scope.type === 'workspace' ? 'workspace' : `${item.scope.type}:${item.scope.id}`);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); done(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } };
  const save = () => {
    const [type, id] = scope.split(':');
    return orglet.call('saveKnowledge', { ...(item ? { id: item.id } : {}), title, content, tags: tags.split(',').map(tag => tag.trim()).filter(Boolean), pinned, scope: type === 'workspace' ? { type: 'workspace' } : { type: type as 'team' | 'worker', id } });
  };
  return <form className="form" onSubmit={event => { event.preventDefault(); void run(save); }}>
    {item && <p className="muted">{provenanceLabel(item)} · v{item.revision} · {item.status === 'proposed' ? t('Chờ duyệt') : t('Đã duyệt')}</p>}
    {proposed && <p role="status">{t('Nội dung do model đề xuất hoặc đến từ template. Đọc kỹ trước khi duyệt; knowledge không cấp quyền hay tăng ngân sách.')}</p>}
    <label><FieldLabel icon={Type} required>{t('Tiêu đề')}</FieldLabel><input value={title} onChange={event => setTitle(event.target.value)} required maxLength={200} /></label>
    <label><FieldLabel icon={FileText} required>{t('Nội dung')}</FieldLabel><textarea rows={8} value={content} onChange={event => setContent(event.target.value)} required maxLength={8000} /></label>
    <label><FieldLabel icon={Tag}>Tags</FieldLabel><input value={tags} onChange={event => setTags(event.target.value)} placeholder="scoring, dataset" /></label>
    <Select label={<FieldLabel icon={Target} required>{t('Phạm vi')}</FieldLabel>} value={scope} onChange={setScope} options={[{ value: 'workspace', label: t('Toàn workspace'), icon: <Globe size={16} /> }, ...workspace.teams.map(team => ({ value: `team:${team.id}`, label: team.name, group: t('Hội'), icon: <Users size={16} /> })), ...workspace.workers.map(worker => ({ value: `worker:${worker.id}`, label: worker.name, group: t('Tí'), icon: <UserRound size={16} /> }))]} />
    <p className="muted">{t('Knowledge của hội chỉ nạp khi chạy trong hội đó, kể cả khi Tí tham gia nhiều hội.')}</p>
    <SwitchField checked={pinned} onChange={setPinned} description={t('Không ghim thì chỉ nạp khi yêu cầu có từ khóa khớp. Sửa xong, lần chạy cũ vẫn giữ nội dung nó đã đọc.')}>{t('Luôn nạp khi còn chỗ trong context')}</SwitchField>
    <div className="actions">
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {proposed && !changed && <Button type="button" variant="primary" disabled={busy} onClick={() => void run(() => orglet.call('reviewKnowledge', { id: item.id, revision: item.revision, decision: 'approve' }))}>{t('Duyệt')}</Button>}
      {(!proposed || changed) && <Button variant="primary" disabled={busy}>{proposed ? t('Lưu chỉnh sửa và duyệt') : item ? t('Lưu revision mới') : t('Lưu knowledge')}</Button>}
      {item && <Button type="button" variant="outline" disabled={busy} onClick={() => void run(() => orglet.call('reviewKnowledge', { id: item.id, revision: item.revision, decision: 'archive' }))}>{proposed ? t('Từ chối') : t('Lưu trữ')}</Button>}
    </div>
  </form>;
}

export function ContextManifestView({ run, workspace }: { run: { snapshot: { context?: RunContext } }; workspace: Workspace }) {
  const context = run.snapshot.context;
  if (!context) return null;
  const names: Record<string, string> = { platform: t('Chính sách Orglet'), team: t('Hướng dẫn hội'), worker: t('Hướng dẫn Tí'), skill: t('Kỹ năng'), knowledge: 'Knowledge', summary: t('Tóm tắt hội thoại'), memory: t('Ghi nhớ hội thoại'), turn: t('Lượt cũ') };
  const reasons: Record<string, string> = { duplicate: t('trùng nội dung đã nạp'), context_limit: t('vượt giới hạn context'), not_relevant: t('không khớp yêu cầu'), summarized: t('đã tóm tắt'), truncated: t('bị cắt') };
  const knowledgeTitle = (id?: string) => context.knowledge.find(entry => entry.id === id)?.title ?? workspace.knowledge.find(entry => entry.id === id)?.title;
  return <details><summary>{t('Context đã nạp · {0} phần', [context.manifest.loaded.length])}</summary>
    {context.manifest.verbatimTurns != null && <p className="muted">{t('Lượt gần: {0} · tóm tắt {1} ký tự · {2} ghi chú cũ', [context.manifest.verbatimTurns, context.manifest.summaryChars ?? 0, context.manifest.retrievedSnippets ?? 0])}</p>}
    <ul>{context.manifest.loaded.map((entry, index) => <li key={index}>{names[entry.kind]}{entry.kind === 'knowledge' ? `: ${knowledgeTitle(entry.id)}` : ''}{entry.revision ? ` · v${entry.revision}` : ''} · {entry.bytes} bytes</li>)}</ul>
    {context.manifest.omitted.length > 0 && <><h4>{t('Không nạp')}</h4><ul>{context.manifest.omitted.map((entry, index) => <li key={index}>{names[entry.kind]}{entry.kind === 'knowledge' ? `: ${knowledgeTitle(entry.id) ?? entry.id}` : entry.revision ? ` · v${entry.revision}` : ''} · {reasons[entry.reason]}</li>)}</ul></>}
  </details>;
}
