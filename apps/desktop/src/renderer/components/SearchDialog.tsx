import * as Dialog from '@radix-ui/react-dialog';
import { DialogOverlay } from '@codepawl/orglet-ui';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CornerDownLeft, Search, X } from 'lucide-react';
import type { Task, Team, Worker, Workspace } from '../../shared/contracts';
import { markMatches, type ChatSearchHit, type ChatSearchResult, type SnippetPart } from '../../shared/chat-search';
import { liveTeamTask, liveWorkerTask } from '../../shared/live-task';
import { Button } from './ui';
import { Avatar, RosterAvatars } from './Avatar';
import { currentLocale, t, tMessage } from '../i18n';
import { orglet } from '../api';
import { taskWorkers, teamRoster } from '../assignees';

/** Vietnamese relative day labels like the reference palette; older items fall back to a short date. */
export function relativeDay(iso: string, now = new Date()) {
  const date = new Date(iso);
  if (now.getTime() - date.getTime() < 60_000) return t('Vừa xong');
  const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days <= 0) return t('Hôm nay');
  if (days === 1) return t('Hôm qua');
  if (days < 7) return t('{0} ngày trước', [days]);
  return date.toLocaleDateString(currentLocale(), { day: '2-digit', month: '2-digit', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

type SearchWorkspace = Pick<Workspace, 'tasks' | 'workers' | 'teams' | 'archivedWorkers'>;

type SearchRow =
  | { key: string; kind: 'orglet'; worker: Worker }
  | { key: string; kind: 'crew'; team: Team }
  | { key: string; kind: 'chat'; task: Task; hit?: ChatSearchHit };

const GROUP_TITLES: Record<SearchRow['kind'], () => string> = {
  orglet: () => t('Tí'),
  crew: () => t('Hội'),
  chat: () => t('Các cuộc trò chuyện'),
};

const firstLine = (text: string) => text.split('\n')[0].trim();

/** The orglets whose faces a chat wears: a crew's members, a group chat's orglets, or its one orglet, archived or not. */
function chatFaces(task: Task, workspace: SearchWorkspace): Worker[] {
  const live = taskWorkers(task, workspace);
  if (live.length || task.teamId || task.assignees) return live;
  return workspace.archivedWorkers.filter(worker => worker.id === task.workerId);
}

/** Whose chat it is, by name: the crew, the group's orglets, or the orglet. */
function chatOwner(task: Task, workspace: SearchWorkspace, faces: readonly Worker[]): string | undefined {
  if (task.teamId) return workspace.teams.find(team => team.id === task.teamId)?.name ?? task.teamSnapshot?.name;
  if (task.assignees === 'all') return t('Toàn bộ Tí');
  if (task.assignees) return faces.map(worker => worker.name).join(', ') || undefined;
  return faces[0]?.name;
}

/**
 * How a result names its chat (COD-267): the chat's title, else whose chat it is. Beside a title sits whose chat it
 * is, so a result always says which orglet or crew it belongs to; beside an owner's name sits the first message, so
 * several untitled chats of one orglet can be told apart. A side thread says so, as it does in the Send to picker.
 */
function chatLabel(task: Task, workspace: SearchWorkspace, faces: readonly Worker[]): { name: string; detail?: string } {
  const owner = chatOwner(task, workspace, faces);
  if (task.sideOf) return { name: task.title || firstLine(task.brief), detail: owner ? t('chat phụ · {0}', [owner]) : t('chat phụ') };
  if (task.title) return { name: task.title, detail: owner };
  if (owner) return { name: owner, detail: firstLine(task.brief) };
  return { name: firstLine(task.brief) };
}

function Marked({ parts }: { parts: readonly SnippetPart[] }) {
  return <>{parts.map((part, index) => part.match
    ? <mark key={index} className="search-mark">{part.text}</mark>
    : <Fragment key={index}>{part.text}</Fragment>)}</>;
}

/** A single face for an orglet, two for anything with several, in the same slot width so the names line up. */
function Faces({ workers, several, fallbackName, fallbackSeed }: { workers: readonly Worker[]; several: boolean; fallbackName: string; fallbackSeed: string }) {
  if (several && workers.length) return <RosterAvatars workers={workers.slice(0, 2)} size="sm" max={2} countRest={false} />;
  const worker = workers[0];
  if (!worker) return <Avatar name={fallbackName} seed={fallbackSeed} size="sm" />;
  return <Avatar name={worker.name} seed={worker.id} emoji={worker.avatar?.emoji} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="sm" />;
}

/**
 * Ctrl+K search (COD-267). Empty, it lists the chats newest first. With words typed, the core searches every message
 * the person sent, every answer and report, and the names of chats, orglets and crews; each chat comes back once, at
 * its best-matching message, with a snippet around the match. Choosing a chat opens it scrolled to that message;
 * choosing an orglet or crew opens its chat.
 */
export function SearchDialog({ open, onClose, workspace, onOpenChat, onOpenOrglet, onOpenCrew, onDwellTask }: {
  open: boolean;
  onClose: () => void;
  workspace: SearchWorkspace;
  /** Opens a chat, scrolled to the message the search found when there is one. */
  onOpenChat: (taskId: string, messageId?: string) => void;
  onOpenOrglet: (workerId: string) => void;
  onOpenCrew: (teamId: string) => void;
  /** The chat Enter or a click would open is resting under the pointer or the arrow keys, or no longer is (COD-218). */
  onDwellTask?: (id: string, resting: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ query: string; result: ChatSearchResult }>();
  const [failure, setFailure] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  // Set when a result is chosen, so closing leaves focus where the result took it instead of on the search button.
  const chosen = useRef(false);
  const searching = query.trim().length > 0;
  useEffect(() => {
    if (!open || !searching) return;
    let current = true;
    orglet.call('searchChats', { query }).then(result => {
      if (!current) return;
      setFound({ query, result });
      setFailure('');
    }).catch(error => {
      if (current) setFailure((error as Error).message);
    });
    return () => { current = false; };
  }, [open, query, searching]);
  const rows = useMemo<SearchRow[]>(() => {
    if (!searching) return workspace.tasks.slice(0, 50).map(task => ({ key: `chat:${task.id}`, kind: 'chat', task }));
    if (!found) return [];
    const orglets = found.result.orgletIds.flatMap((id): SearchRow[] => {
      const worker = workspace.workers.find(item => item.id === id);
      return worker ? [{ key: `orglet:${id}`, kind: 'orglet', worker }] : [];
    });
    const crews = found.result.crewIds.flatMap((id): SearchRow[] => {
      const team = workspace.teams.find(item => item.id === id);
      return team ? [{ key: `crew:${id}`, kind: 'crew', team }] : [];
    });
    const chats = found.result.chats.flatMap((hit): SearchRow[] => {
      const task = workspace.tasks.find(item => item.id === hit.taskId);
      return task ? [{ key: `chat:${hit.taskId}`, kind: 'chat', task, hit }] : [];
    });
    return [...orglets, ...crews, ...chats];
  }, [searching, found, workspace]);
  const terms = searching ? found?.result.terms ?? [] : [];
  // Titles only help when orglets or crews sit above the chats; a list of chats alone needs none.
  const grouped = rows.some(row => row.kind !== 'chat');
  useEffect(() => {
    if (open) return;
    setQuery('');
    setActive(0);
    setFound(undefined);
    setFailure('');
  }, [open]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  // The active result is the one about to open, whichever way it became active, so its chat is fetched ahead of Enter.
  const activeRow = open ? rows[active] : undefined;
  const dwellId = activeRow?.kind === 'chat' ? activeRow.task.id
    : activeRow?.kind === 'orglet' ? liveWorkerTask(workspace.tasks, activeRow.worker.id)?.id
      : activeRow?.kind === 'crew' ? liveTeamTask(workspace.tasks, activeRow.team.id)?.id : undefined;
  useEffect(() => {
    if (!dwellId || !onDwellTask) return;
    onDwellTask(dwellId, true);
    return () => onDwellTask(dwellId, false);
  }, [dwellId, onDwellTask]);
  const choose = (index: number) => {
    const row = rows[index];
    if (!row) return;
    chosen.current = true;
    onClose();
    if (row.kind === 'orglet') onOpenOrglet(row.worker.id);
    else if (row.kind === 'crew') onOpenCrew(row.team.id);
    else onOpenChat(row.task.id, row.hit?.messageId);
  };
  const empty = !searching
    ? workspace.tasks.length ? '' : t('Chưa có cuộc trò chuyện nào.')
    : failure ? tMessage(failure)
      : found && !rows.length ? t('Không có tin nhắn, Tí hay hội nào khớp.') : '';

  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <Dialog.Portal>
      <DialogOverlay />
      <Dialog.Content className="search-dialog" aria-describedby={undefined} onCloseAutoFocus={event => {
        if (!chosen.current) return;
        chosen.current = false;
        event.preventDefault();
      }}>
        <Dialog.Title className="sr-only">{t('Tìm cuộc trò chuyện')}</Dialog.Title>
        <div className="search-dialog-input">
          <Search size={20} aria-hidden="true" />
          <input autoFocus role="combobox" aria-expanded={rows.length > 0} aria-controls="search-results" aria-activedescendant={activeRow ? `search-result-${activeRow.key}` : undefined} aria-autocomplete="list" aria-label={t('Tìm cuộc trò chuyện')} placeholder={t('Tìm tin nhắn, Tí và hội')} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(index + 1, rows.length - 1)); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); }
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); choose(active); }
          }} />
          <Dialog.Close asChild><Button size="icon" aria-label={t('Đóng tìm kiếm')}><X size={18} /></Button></Dialog.Close>
        </div>
        <ul className="search-results" id="search-results" role="listbox" aria-label={t('Kết quả')} ref={list}>
          {rows.map((row, index) => {
            const startsGroup = grouped && (index === 0 || rows[index - 1].kind !== row.kind);
            return <li key={row.key} role="presentation" className={startsGroup ? 'search-group-start' : undefined}>
              {startsGroup && <span className="search-group" aria-hidden="true">{GROUP_TITLES[row.kind]()}</span>}
              <SearchResult row={row} index={index} active={index === active} terms={terms} workspace={workspace} onPoint={() => setActive(index)} onChoose={() => choose(index)} />
            </li>;
          })}
        </ul>
        {empty && <p className="search-empty">{empty}</p>}
        {searching && found?.result.indexing && <p className="search-note">{t('Vẫn đang thêm các cuộc trò chuyện cũ vào tìm kiếm, nên có thể thiếu vài kết quả.')}</p>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function SearchResult({ row, index, active, terms, workspace, onPoint, onChoose }: { row: SearchRow; index: number; active: boolean; terms: readonly string[]; workspace: SearchWorkspace; onPoint: () => void; onChoose: () => void }) {
  let faces: ReactNode;
  let name: string;
  let detail: string | undefined;
  let snippet: ReactNode = null;
  let at: string | undefined;
  if (row.kind === 'orglet') {
    faces = <Faces workers={[row.worker]} several={false} fallbackName={row.worker.name} fallbackSeed={row.worker.id} />;
    name = row.worker.name;
    detail = row.worker.description;
  } else if (row.kind === 'crew') {
    const members = teamRoster(row.team, workspace.workers);
    faces = <Faces workers={members} several fallbackName={row.team.name} fallbackSeed={row.team.id} />;
    name = row.team.name;
    detail = members.map(worker => worker.name).join(', ');
  } else {
    const workers = chatFaces(row.task, workspace);
    const label = chatLabel(row.task, workspace, workers);
    faces = <Faces workers={workers} several={Boolean(row.task.teamId || row.task.assignees)} fallbackName={label.name} fallbackSeed={row.task.workerId} />;
    name = label.name;
    detail = label.detail;
    at = row.hit?.at ?? row.task.createdAt;
    const hit = row.hit;
    if (hit?.snippet.length) {
      const sender = hit.sender?.kind === 'orglet' ? hit.sender.name : t('Bạn');
      snippet = <span className="search-result-snippet"><span className="search-result-sender">{sender}: </span><Marked parts={hit.snippet} /></span>;
    }
  }
  return <div id={`search-result-${row.key}`} data-index={index} role="option" aria-selected={active} className="search-result" onMouseMove={onPoint} onClick={onChoose}>
    {faces}
    <span className="search-result-text">
      <span className="search-result-head">
        <span className="search-result-name"><Marked parts={markMatches(name, terms)} /></span>
        {detail && <span className="search-result-detail">{detail}</span>}
      </span>
      {snippet}
    </span>
    {active
      ? <CornerDownLeft size={16} className="search-result-enter" aria-hidden="true" />
      : at && <time className="search-result-time" dateTime={at}>{relativeDay(at)}</time>}
  </div>;
}
