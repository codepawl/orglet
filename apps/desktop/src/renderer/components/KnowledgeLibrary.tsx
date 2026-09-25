import { useEffect, useState } from 'react';
import { Brain, Check, Clock3, Globe, UserRound, Users, FileText, Pin, Search, Tag, Target, Type, type LucideIcon } from 'lucide-react';
import type { Worker, Workspace } from '../../shared/contracts';
import { isMemory, type Knowledge, type KnowledgeScope, type RunContext } from '../../shared/knowledge';
import { MemoryList } from './Memories';
import { Button, FieldLabel } from './ui';
import { Avatar } from './Avatar';
import { Select } from './Select';
import { t } from '../i18n';
import { orglet } from '../api';
import { SwitchField } from './Switch';
import { Input, Textarea } from '@codepawl/orglet-ui';

export function scopeLabel(scope: KnowledgeScope, workspace: Workspace) {
  if (scope.type === 'workspace') return t('Toàn workspace');
  if (scope.type === 'team') return t('Hội {0}', [workspace.teams.find(team => team.id === scope.id)?.name ?? scope.id]);
  return t('Tí {0}', [workspace.workers.find(worker => worker.id === scope.id)?.name ?? scope.id]);
}
/** Who wrote a note: the orglet that suggested it (recorded since 2026-09-23), else its chat's orglet or crew lead. */
function knowledgeAuthor(item: Knowledge, workspace: Workspace): Worker | undefined {
  if (item.provenance.kind !== 'run') return undefined;
  const workers = [...workspace.workers, ...workspace.archivedWorkers];
  const provenance = item.provenance;
  const recorded = provenance.workerId ? workers.find(worker => worker.id === provenance.workerId) : undefined;
  if (recorded) return recorded;
  const task = workspace.tasks.find(candidate => candidate.id === provenance.taskId);
  if (!task) return undefined;
  const team = task.teamId ? workspace.teams.find(candidate => candidate.id === task.teamId) : undefined;
  const workerId = team?.synthesizerId ?? task.workerId;
  return workers.find(worker => worker.id === workerId);
}

/** The note's author with a face you can play with, how it got here, its version, and whether it still waits for review. */
function KnowledgeAuthor({ item, workspace }: { item: Knowledge; workspace: Workspace }) {
  const author = knowledgeAuthor(item, workspace);
  const kind = item.provenance.kind;
  const name = author?.name ?? (kind === 'user' ? t('Bạn') : kind === 'template' ? t('Template hội') : t('Tí đã xóa'));
  const origin = kind === 'run' ? t('đề xuất') : kind === 'template' ? t('nhập từ template') : t('tạo');
  return <div className="knowledge-author">
    {author
      ? <Avatar name={author.name} seed={author.id} mascot={author.avatar?.mascot} defaultMascot hint={author.description} color={author.avatar?.color} size="lg" alive motion={{ follow: 'hover' }} />
      : <span className="knowledge-author-mark" aria-hidden="true">{kind === 'template' ? <Users size={18} /> : <UserRound size={18} />}</span>}
    <div className="knowledge-author-text"><strong>{name}</strong><span className="muted">{origin} · v{item.revision}</span></div>
    <span className={item.status === 'proposed' ? 'badge pending' : 'badge'}>{item.status === 'proposed' ? t('Chờ duyệt') : t('Đã duyệt')}</span>
  </div>;
}

export function KnowledgeLibrary({ workspace, onOpen, onOpenChat }: { workspace: Workspace; onOpen: (item?: Knowledge) => void; /** Opens the chat a memory came from. */ onOpenChat: (taskId: string) => void }) {
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
  // A memory waiting for review sits with the other proposals; an active one has its own list below the notes.
  const proposed = visible.filter(item => item.status === 'proposed');
  const approved = visible.filter(item => item.status === 'approved' && !isMemory(item));
  const memories = visible.filter(item => item.status === 'approved' && isMemory(item)).sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  const row = (item: Knowledge) => <Button key={item.id} variant="outline" className="library-item" onClick={() => onOpen(item)}>
    <span className="library-text">{item.title}<small className="muted">{scopeLabel(item.scope, workspace)}{item.tags.length ? ` · ${item.tags.join(', ')}` : ''}</small></span>
    {item.pinned && <Pin size={14} aria-label={t('Luôn nạp')} />}<span className="badge">v{item.revision}</span>
  </Button>;
  return <div className="form">
    <label><FieldLabel icon={Search}>{t('Tìm knowledge')}</FieldLabel><Input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Từ khóa hoặc tag')} maxLength={200} /></label>
    {proposed.length > 0 && <section aria-label={t('Chờ duyệt')}><LibraryHeading tone="pending" icon={Clock3}>{t('Chờ duyệt ({0})', [proposed.length])}</LibraryHeading>{proposed.map(row)}</section>}
    <section aria-label={t('Đã duyệt')}><LibraryHeading tone="approved" icon={Check}>{t('Đã duyệt ({0})', [approved.length])}</LibraryHeading>{approved.map(row)}{!approved.length && <p className="muted">{query ? t('Không có mục khớp.') : t('Chưa có knowledge đã duyệt.')}</p>}</section>
    {(memories.length > 0 || !query) && <section aria-label={t('Ghi nhớ')}><LibraryHeading tone="memory" icon={Brain}>{t('Ghi nhớ ({0})', [memories.length])}</LibraryHeading><MemoryList memories={memories} workspace={workspace} showScope onOpenChat={onOpenChat} /></section>}
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
  return <form className="form floating-form" onSubmit={event => { event.preventDefault(); void run(save); }}>
    <div className="floating-form-fields">
      {item && <KnowledgeAuthor item={item} workspace={workspace} />}
      <label><FieldLabel icon={Type} required>{t('Tiêu đề')}</FieldLabel><Input value={title} onChange={event => setTitle(event.target.value)} required maxLength={200} /></label>
      {/* Six rows keep a pending note's Scope whole above the action bar when it opens (COD-250); the box still resizes. */}
      <label><FieldLabel icon={FileText} required>{t('Nội dung')}</FieldLabel><Textarea rows={6} value={content} onChange={event => setContent(event.target.value)} required maxLength={8000} /></label>
      <label><FieldLabel icon={Tag}>Tags</FieldLabel><Input value={tags} onChange={event => setTags(event.target.value)} placeholder="scoring, dataset" /></label>
      <Select label={<FieldLabel icon={Target} required>{t('Phạm vi')}</FieldLabel>} value={scope} onChange={setScope} options={[{ value: 'workspace', label: t('Toàn workspace'), icon: <Globe size={16} /> }, ...workspace.teams.map(team => ({ value: `team:${team.id}`, label: team.name, group: t('Hội'), icon: <Users size={16} /> })), ...workspace.workers.map(worker => ({ value: `worker:${worker.id}`, label: worker.name, group: t('Tí'), icon: <UserRound size={16} /> }))]} />
      <p className="muted">{t('Knowledge của hội chỉ nạp khi chạy trong hội đó.')}</p>
      <SwitchField checked={pinned} onChange={setPinned} description={t('Không ghim thì chỉ nạp khi yêu cầu khớp từ khóa.')}>{t('Luôn nạp khi còn chỗ trong context')}</SwitchField>
    </div>
    <div className="actions floating-actions">
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
  const names: Record<string, string> = { platform: t('Chính sách Orglet'), team: t('Hướng dẫn hội'), worker: t('Hướng dẫn Tí'), skill: t('Kỹ năng'), knowledge: 'Knowledge', summary: t('Tóm tắt hội thoại'), memory: t('Đoạn hội thoại cũ'), remembered: t('Ghi nhớ'), turn: t('Lượt cũ'), main_chat: t('Chat chính') };
  const reasons: Record<string, string> = { duplicate: t('trùng nội dung đã nạp'), context_limit: t('vượt giới hạn context'), not_relevant: t('không khớp yêu cầu'), summarized: t('đã tóm tắt'), truncated: t('bị cắt') };
  const knowledgeTitle = (id?: string) => context.knowledge.find(entry => entry.id === id)?.title ?? workspace.knowledge.find(entry => entry.id === id)?.title;
  const memoryText = (id?: string) => { const text = context.memories?.find(entry => entry.id === id)?.text ?? workspace.knowledge.find(entry => entry.id === id)?.content; return text && text.length > 80 ? `${text.slice(0, 80)}…` : text; };
  const detail = (entry: { kind: string; id?: string }) => entry.kind === 'knowledge' ? `: ${knowledgeTitle(entry.id) ?? entry.id}` : entry.kind === 'remembered' ? `: ${memoryText(entry.id) ?? entry.id}` : '';
  return <details><summary>{t('Context đã nạp · {0} phần', [context.manifest.loaded.length])}</summary>
    {context.manifest.mainChatTurns != null && <p className="muted">{t('Đọc {0} tin gần nhất của chat chính', [context.manifest.mainChatTurns])}</p>}
    {context.manifest.verbatimTurns != null && <p className="muted">{t('Lượt gần: {0} · tóm tắt {1} ký tự · {2} ghi chú cũ', [context.manifest.verbatimTurns, context.manifest.summaryChars ?? 0, context.manifest.retrievedSnippets ?? 0])}</p>}
    <ul>{context.manifest.loaded.map((entry, index) => <li key={index}>{names[entry.kind]}{detail(entry)}{entry.revision ? ` · v${entry.revision}` : ''} · {entry.bytes} bytes</li>)}</ul>
    {context.manifest.omitted.length > 0 && <><h4>{t('Không nạp')}</h4><ul>{context.manifest.omitted.map((entry, index) => <li key={index}>{names[entry.kind]}{entry.kind === 'knowledge' || entry.kind === 'remembered' ? detail(entry) : entry.revision ? ` · v${entry.revision}` : ''} · {reasons[entry.reason]}</li>)}</ul></>}
  </details>;
}

/**
 * A Library section title with a small round mark before it, the way the sidebar puts a face before each orglet
 * (owner, 2026-09-25): amber for what waits for review, green for what is approved, a brain for memory. The mark
 * repeats what the words say, so it is hidden from assistive technology.
 */
function LibraryHeading({ tone, icon: Icon, children }: { tone: 'pending' | 'approved' | 'memory'; icon: LucideIcon; children: string }) {
  return <h3 className="library-heading">
    <span className={`library-mark ${tone}`} aria-hidden="true"><Icon size={11} strokeWidth={2.5} /></span>
    {children}
  </h3>;
}
