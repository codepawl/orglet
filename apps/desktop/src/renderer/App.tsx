import { RevisionEditor } from './components/RevisionEditor';
import { SkillLibrary, SkillLibraryActions } from './components/SkillReview';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
// The sidebar draws Orglet's own icons; the rest of this file stays on lucide until the sweep (the Lucide* aliases mark what is left).
import { Archive, BookOpen, CalendarClock, Download, EllipsisVertical, PanelLeft, Pencil, Plus, Search, Settings, Trash } from './components/icons';
import { ArrowLeft, ChevronRight, Pencil as LucidePencil, Plus as LucidePlus, SlidersHorizontal, CalendarClock as LucideCalendarClock, Wallet, X, Archive as LucideArchive, ArchiveRestore, Trash2 } from 'lucide-react';
import { emptyConnections, isPaidApi, type Connections, type Skill, type Source, type Task, type TaskDetail, type Worker, type Workspace, type Team, type TaskInput } from '../shared/contracts';
import { Button, Drawer } from './components/ui';
import { SkillEditor } from './components/Editors';
import { WorkerDialog } from './components/WorkerDialog';
import { SettingsDialog, type SettingsTab } from './components/SettingsDialog';
import { TaskThread } from './components/TaskThread';
import { SourcePanel, type SourceTarget } from './components/SourcePanel';
import { TeamDialog } from './components/TeamEditor';
import { TaskDialog } from './components/TaskDialog';
import { FormatPreferences } from './components/FormatAction';
import { assigneeLabel, taskWorkers, teamRoster } from './assignees';
import { liveTeamTask, liveWorkerTask } from '../shared/live-task';
import { ArchivedList, ArchivedRow, type ArchiveState } from './components/SidebarTree';
import { RoutinesPanel, type RoutineView } from './components/RoutinesPanel';
import { Confirmer, confirmAction } from './components/confirm';
import { SourcePicker } from './components/SourcePicker';
import { Composer, FollowUpComposer } from './components/Composer';
import { SidebarSection } from './components/SidebarSection';
import { Avatar, RosterAvatars } from './components/Avatar';
import { Starters } from './components/Starters';
import { DetailsPanel } from './components/DetailsPanel';
import { suggestStarters } from '../shared/starters';
import { DEFAULT_MENTION_COLOR } from '../shared/mentions';
import { ProviderMark } from './components/ProviderMark';
import { SidebarTreeRow, useReorder } from './components/SidebarTree';
import { SearchDialog } from './components/SearchDialog';
import { tasksStatusMark, rollupStatusMarks, type StatusMarkState } from './components/StatusMark';
import { taskResultSeen } from '../shared/task-seen';
import { RowMenu } from './components/RowMenu';
import { Select } from './components/Select';
import { setDisplayCurrency, formatMoney } from './components/money';
import { Toaster, toast } from './components/toast';
import { KnowledgeEditor, KnowledgeLibrary } from './components/KnowledgeLibrary';
import type { Knowledge } from '../shared/knowledge';
import type { HarnessInfo } from '../shared/harness';
import { providerLabel, readiness, settingsTabFor, setupHint } from './components/providers';
import { workerModelLabel, providerName } from './components/workerModel';
import { usePaneWidth, shellGap } from './usePaneWidth';
import { ComposerModel } from './components/ComposerModel';
import { t, setLanguage, useLanguage } from './i18n';
import { orglet } from './api';

type SeenInfo = { seenStamp: string; lastArtifactId?: string };
const seenStorageKey = 'orglet.task-seen-stamps';
function readSeenStorage(): Record<string, SeenInfo> {
  try { return JSON.parse(localStorage.getItem(seenStorageKey) || '{}') as Record<string, SeenInfo>; } catch { return {}; }
}
function writeSeenStorage(value: Record<string, SeenInfo>) {
  try { localStorage.setItem(seenStorageKey, JSON.stringify(value)); } catch { /* ignore quota */ }
}

const SIDEBAR_WIDTH = { min: 190, max: 420, default: 228, step: 16 };
const DETAILS_WIDTH = { min: 280, max: 560, default: 320, step: 16 };

/**
 * Ids that were not in the sidebar a moment ago. Everything present when the workspace first arrives counts as
 * already known, so launching does not animate every row at once — only a worker or team you just created rises in.
 */
function useArrivals(ids: readonly string[], ready: boolean): (id: string) => boolean {
  const known = useRef<Set<string> | null>(null);
  const arrived = useRef(new Set<string>());
  // Both refs are read before this, so the hook count never changes while the workspace is still loading.
  if (!ready) return () => false;
  if (known.current === null) known.current = new Set(ids);
  const seen = known.current;
  arrived.current = new Set(ids.filter(id => !seen.has(id)));
  for (const id of ids) seen.add(id);
  return (id: string) => arrived.current.has(id);
}

type Panel = 'task' | 'revision' | 'routines' | 'settings' | 'worker' | 'team' | 'library' | 'skill' | 'knowledge' | 'activity' | 'sources' | null;
export function App() {
  useLanguage();
  const [workspace, setWorkspace] = useState<Workspace>(); const [connections, setConnections] = useState<Connections>(emptyConnections());
  const [harnesses, setHarnesses] = useState<HarnessInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null); const [detail, setDetail] = useState<TaskDetail>();
  const [workerId, setWorkerId] = useState(''); const [brief, setBrief] = useState(''); const [sources, setSources] = useState<Source[]>([]);
  const [skippedSources, setSkippedSources] = useState<{ name: string; reason: string }[]>([]);
  const [teamId, setTeamId] = useState(''); const [editingTeam, setEditingTeam] = useState<Team>();
  const [routineDraft, setRoutineDraft] = useState<TaskInput>();
  const [routineView, setRoutineView] = useState<RoutineView>({ editing: false });
  const routineDirty = useRef(false);
  const markRoutineDirty = useCallback((dirty: boolean) => { routineDirty.current = dirty; }, []);
  /** Every way out of an edited schedule (breadcrumb, Back, close) asks the same question. */
  const leaveRoutine = async (then: () => void) => {
    if (routineDirty.current && !await confirmAction({ title: t('Bỏ thay đổi của lịch này?'), description: t('Những gì vừa nhập sẽ không được lưu.'), confirmLabel: t('Bỏ thay đổi'), cancelLabel: t('Tiếp tục chỉnh sửa') })) return;
    routineDirty.current = false; then();
  };
  const [sourceTarget, setSourceTarget] = useState<SourceTarget>();
  // Chat details list the team behind a team chat; a worker chat has none.
  const detailTeam = detail ? workspace?.teams.find(team => team.id === detail.task.teamId) : undefined;
  const openSources = (target?: SourceTarget) => { setSourceTarget(target); setPanel('sources'); };
  
  const [panel, setPanel] = useState<Panel>(null); const [editingWorker, setEditingWorker] = useState<Worker>(); const [editingTask, setEditingTask] = useState<string>(); const [editingSkill, setEditingSkill] = useState<Skill>();
  const [editingKnowledge, setEditingKnowledge] = useState<Knowledge>(); const [libraryTab, setLibraryTab] = useState<'skills' | 'knowledge'>('skills');
  const openKnowledge = (item?: Knowledge) => { setEditingKnowledge(item); setPanel('knowledge'); };
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const openSettings = (tab: SettingsTab = 'general') => { setSettingsTab(tab); setPanel('settings'); };
  // Chat details sit in the shell next to the conversation, not over it.
  const detailsOpen = panel === 'activity';
  const detailsOpenRef = useRef(detailsOpen); detailsOpenRef.current = detailsOpen;
  const [searchOpen, setSearchOpen] = useState(false); const [sidebar, setSidebar] = useState(() => innerWidth > 780); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  // Dragging tracks the pointer; a width is the distance from the window edge minus the gap the panel sits in.
  const sidebarPane = usePaneWidth({ storageKey: 'orglet.sidebar-width', bounds: SIDEBAR_WIDTH, widthFromPointer: clientX => clientX - shellGap(), widerKey: 'ArrowRight' });
  const detailsPane = usePaneWidth({ storageKey: 'orglet.details-width', bounds: DETAILS_WIDTH, widthFromPointer: clientX => innerWidth - clientX - shellGap(), widerKey: 'ArrowLeft' });
  const sidebarWidth = sidebarPane.width;
  const resizing = sidebarPane.resizing || detailsPane.resizing;
  const [panelMoving, setPanelMoving] = useState(false);
  useEffect(() => {
    setPanelMoving(true);
    const motion = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--motion-base')) || 170;
    const timer = setTimeout(() => setPanelMoving(false), motion + 40);
    return () => clearTimeout(timer);
  }, [sidebar, detailsOpen]);
  const [dismissedCatchUpNotice, setDismissedCatchUpNotice] = useState('');
  const composer = useRef<HTMLTextAreaElement>(null); const refreshId = useRef(0);
  const bootedLiveThread = useRef(false);
  /** Stamps from core + localStorage; renderer HMR can update before the core utility process restarts. */
  const seenInfo = useRef<Record<string, SeenInfo>>(readSeenStorage());
  const rememberSeen = useCallback((id: string, info: SeenInfo) => {
    seenInfo.current = { ...seenInfo.current, [id]: info };
    writeSeenStorage(seenInfo.current);
    // Patch the sidebar row immediately so leaving before refresh finishes keeps the grey mark.
    setWorkspace(current => current ? {
      ...current,
      tasks: current.tasks.map(task => task.id === id
        ? { ...task, seenStamp: info.seenStamp, ...(info.lastArtifactId ? { lastArtifactId: info.lastArtifactId } : {}) }
        : task),
    } : current);
  }, []);
  // Refreshes started by older callbacks (an action finishing, a change event) must load the task shown now, not the
  // one selected when they were created; otherwise a late refresh replaces the open task with nothing.
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const refresh = useCallback(async () => {
    const requestId = ++refreshId.current;
    const selected = selectedRef.current;
    try {
      // Load the open task first so markTaskSeen lands in SQLite before workspace is read.
      const taskDetail = selected ? await orglet.call('task', { id: selected }) : undefined;
      const [next, connectionState, detected] = await Promise.all([orglet.call('workspace', {}), orglet.connections(), orglet.call('harnesses', { refresh: false })]);
      if (requestId !== refreshId.current) return;
      if (taskDetail?.task.seenStamp) {
        seenInfo.current[taskDetail.task.id] = { seenStamp: taskDetail.task.seenStamp, lastArtifactId: taskDetail.task.lastArtifactId };
      }
      const tasks = next.tasks.map(task => {
        const opened = taskDetail?.task.id === task.id ? taskDetail.task : undefined;
        const cached = seenInfo.current[task.id];
        const lastArtifactId = opened?.lastArtifactId ?? task.lastArtifactId ?? cached?.lastArtifactId;
        const seenStamp = opened?.seenStamp ?? task.seenStamp ?? cached?.seenStamp;
        if (seenStamp) seenInfo.current[task.id] = { seenStamp, lastArtifactId };
        return { ...task, ...(lastArtifactId ? { lastArtifactId } : {}), ...(seenStamp ? { seenStamp } : {}) };
      });
      writeSeenStorage(seenInfo.current);
      setWorkspace({ ...next, tasks }); setConnections(connectionState); setHarnesses(detected); setDetail(taskDetail); setWorkerId(value => value || next.workers[0]?.id || '');
    } catch (err) { if (requestId === refreshId.current) setError((err as Error).message); }
  }, []);
  useEffect(() => {
    if (!window.orglet) { setError(t('Mở Orglet bằng pnpm dev để dùng desktop core. Bản web không có quyền truy cập dữ liệu.')); return; }
    return orglet.onChange(() => void refresh());
  }, [refresh]);
  useEffect(() => { if (window.orglet) void refresh(); }, [refresh, selected]);
  useEffect(() => { setLanguage(workspace?.language); }, [workspace?.language]);
  useEffect(() => {
    if (!workspace) return;
    if (workerId && !workspace.workers.some(worker => worker.id === workerId)) setWorkerId(workspace.workers[0]?.id ?? '');
    if (teamId && !workspace.teams.some(team => team.id === teamId)) setTeamId('');
  }, [workspace, workerId, teamId]);
  useEffect(() => { document.documentElement.dataset.theme = workspace?.theme ?? 'system'; }, [workspace?.theme]);
  // The colour of @name tags is the user's to pick, so it rides on the root rather than being baked into the sheet.
  useEffect(() => { document.documentElement.style.setProperty('--mention', workspace?.mentionColor ?? DEFAULT_MENTION_COLOR); }, [workspace?.mentionColor]);
  useEffect(() => {
    const media = matchMedia('(max-width: 780px)');
    const collapse = () => { if (media.matches) setSidebar(false); };
    media.addEventListener('change', collapse); return () => media.removeEventListener('change', collapse);
  }, []);
  const leaveThread = () => { setSelected(null); setDetail(undefined); setBrief(''); setSources([]); setSkippedSources([]); setError(''); };
  const hideTaskLocally = (taskId: string, field: 'archivedAt' | 'deletedAt') => {
    const stamp = new Date().toISOString();
    setWorkspace(current => current ? { ...current, tasks: current.tasks.map(task => task.id === taskId ? { ...task, [field]: task[field] ?? stamp } : task) } : current);
  };
  // Re-opening the task already shown keeps its detail; clearing it would wait for a reload that never comes.
  const openTask = (id: string) => {
    if (id !== selected) { setSelected(id); setDetail(undefined); }
    setError('');
    const opened = workspace?.tasks.find(task => task.id === id);
    if (opened?.teamId && !opened.routineId) setTeamId(opened.teamId);
    else {
      setTeamId('');
      if (opened && !opened.assignees) setWorkerId(opened.workerId);
    }
    // Apply the returned stamp even after leaving — waiting for selected refresh drops the grey mark.
    void orglet.call('markTaskSeen', { id }).then((task: Task) => {
      if (task.seenStamp) rememberSeen(task.id, { seenStamp: task.seenStamp, lastArtifactId: task.lastArtifactId });
      if (selectedRef.current === id) void refresh();
    }).catch(err => { if (selectedRef.current === id) setError((err as Error).message); });
    if (matchMedia('(max-width: 780px)').matches) { setSidebar(false); setTimeout(() => document.getElementById('main-content')?.focus(), 0); }
  };
  const openTeam = (id: string) => {
    setTeamId(id);
    const live = workspace ? liveTeamTask(workspace.tasks, id) : undefined;
    if (live) { setBrief(''); openTask(live.id); return; }
    leaveThread();
    if (matchMedia('(max-width: 780px)').matches) setSidebar(false);
    setTimeout(() => composer.current?.focus(), 0);
  };
  const openWorker = (id: string) => {
    setWorkerId(id);
    setTeamId('');
    const live = workspace ? liveWorkerTask(workspace.tasks, id) : undefined;
    if (live) { setBrief(''); openTask(live.id); return; }
    leaveThread();
    if (matchMedia('(max-width: 780px)').matches) setSidebar(false);
    setTimeout(() => composer.current?.focus(), 0);
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        if (teamId) openTeam(teamId);
        else if (workerId) openWorker(workerId);
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true); }
      // The details panel is part of the page, not a dialog, so Escape has to close it here.
      if (event.key === 'Escape' && detailsOpenRef.current) { event.preventDefault(); setPanel(null); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [teamId, workerId, workspace]);
  // First paint only: if this worker already has a live thread, show it so the empty composer cannot silently
  // reviseTask a hidden row. After the user archives or leaves, stay on the empty chat — re-running this from a
  // stale workspace would reopen the same thread and hide Thêm nguồn (desktop-smoke attach-sources after archive).
  useEffect(() => {
    if (!workspace || !workerId || bootedLiveThread.current) return;
    bootedLiveThread.current = true;
    if (selected || teamId) return;
    const live = liveWorkerTask(workspace.tasks, workerId);
    if (live) openTask(live.id);
  }, [workspace, selected, teamId, workerId]);
  const action = (fn: () => Promise<unknown>) => { setError(''); void fn().then(() => refresh()).catch(err => setError((err as Error).message)); };
  const worker = workspace?.workers.find(item => item.id === workerId);
  const team = workspace?.teams.find(item => item.id === teamId);
  const executionWorkers = team ? teamRoster(team, workspace!.workers) : worker ? [worker] : [];
  const nativeProviders = [...new Set(executionWorkers.map(item => item.provider).filter(provider => provider !== 'demo'))];
  const isDemo = nativeProviders.length === 0;
  const ready = readiness(connections, harnesses);
  const missingConnections = nativeProviders.filter(provider => !ready[provider]);
  // Choosing a model and attaching sources is the user's consent to send them; no separate permission step.
  const taskBudgetMicros = (team ?? worker)?.taskBudgetMicros ?? 500_000;
  const unavailable = t('Chưa sẵn sàng');
  const recipientReady = (providers: Worker['provider'][]) => providers.every(provider => provider === 'demo' || ready[provider as keyof typeof ready]);
  const recipientValue = teamId ? `team:${teamId}` : workerId;
  const pickRecipient = (value: string) => {
    if (value.startsWith('team:')) { openTeam(value.slice(5)); return; }
    openWorker(value);
  };
  const send = async () => {
    if (!brief.trim() || busy || (!team && !worker)) return;
    setBusy(true); setError('');
    try {
      const thread = team ? liveTeamTask(workspace!.tasks, team.id) : liveWorkerTask(workspace!.tasks, workerId);
      if (thread) {
        await orglet.call('reviseTask', { taskId: thread.id, brief, sourceIds: sources.map(source => source.id), excludedSources: skippedSources, consent: true, providerScopes: nativeProviders, budgetMicros: thread.budgetMicros });
        setSelected(thread.id);
      } else {
        const id = await orglet.call('createTask', { workerId: team?.synthesizerId ?? workerId, ...(team ? { teamId: team.id } : {}), brief, sourceIds: sources.map(source => source.id), excludedSources: skippedSources, consent: true, providerScopes: nativeProviders, budgetMicros: taskBudgetMicros });
        setSelected(id);
      }
      setBrief(''); setSources([]);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const close = () => { setPanel(null); void refresh(); };
  const openRoutines = (view: RoutineView = { editing: false }) => { setRoutineDraft(undefined); setRoutineView(view); setPanel('routines'); };
  const teamOrder = useReorder(workspace?.teams.map(item => item.id) ?? [], ids => action(() => orglet.call('reorder', { kind: 'teams', ids })));
  const workerOrder = useReorder(workspace?.workers.map(item => item.id) ?? [], ids => action(() => orglet.call('reorder', { kind: 'workers', ids })));
  const deleteTask = (taskId: string) => action(async () => {
    await orglet.call('deleteTask', { id: taskId });
    if (selectedRef.current === taskId) { hideTaskLocally(taskId, 'deletedAt'); leaveThread(); }
    toast(t('Đã xóa cuộc trò chuyện'));
  });
  const archiveTask = (taskId: string, archived: boolean) => action(async () => {
    await orglet.call('archiveTask', { id: taskId, archived });
    if (archived && selectedRef.current === taskId) { hideTaskLocally(taskId, 'archivedAt'); leaveThread(); }
    toast(archived ? t('Đã lưu trữ cuộc trò chuyện') : t('Đã khôi phục cuộc trò chuyện'));
  });
  setDisplayCurrency(workspace?.currency);
  // Phase 5 of the avatar animations: a row that was just created rises into the list once. This sits above the
  // loading return, because a hook must run on every render and the workspace arrives after the first one.
  const isArriving = useArrivals(workspace ? [...workspace.teams.map(item => `team-${item.id}`), ...workspace.workers.map(item => `worker-${item.id}`)] : [], Boolean(workspace));
  if (!workspace) return <div className="startup"><span className="orglet-mark">o</span><h1>Orglet</h1><p role={error ? 'alert' : 'status'}>{error || t('Đang mở workspace…')}</p>{error && window.orglet && <Button onClick={() => void refresh()}>{t('Thử lại')}</Button>}</div>;
  const recipientOptions = [
    ...workspace.workers.map(item => {
      const available = recipientReady([item.provider]);
      return {
        value: item.id,
        label: item.name,
        detail: workerModelLabel(item),
        group: t('Tí'),
        icon: <Avatar name={item.name} seed={item.id} mascot={item.avatar?.mascot} defaultMascot hint={item.description} color={item.avatar?.color} size="xs" badge={item.provider === 'demo' ? undefined : <ProviderMark provider={item.provider} size="small" decorative />} />,
        ...(available ? {} : { dimmed: true, badge: unavailable }),
      };
    }),
    ...workspace.teams.map(item => {
      const members = teamRoster(item, workspace.workers);
      const available = recipientReady(members.map(member => member.provider));
      return {
        value: `team:${item.id}`,
        label: item.name,
        detail: t('{0} Tí', [members.length]),
        group: t('Hội'),
        icon: <RosterAvatars workers={members} max={3} />,
        ...(available ? {} : { dimmed: true, badge: unavailable }),
      };
    }),
  ];
  const archiveState = ({ archivedAt }: { archivedAt?: string }): ArchiveState | undefined => {
    if (!archivedAt || !workspace) return undefined;
    const retention = workspace.archiveRetentionDays;
    if (!retention) return { daysLeft: null, tone: 'fresh' };
    const daysLeft = Math.max(0, Math.ceil(retention - (Date.now() - new Date(archivedAt).getTime()) / 86_400_000));
    const share = daysLeft / retention;
    return { daysLeft, tone: share > 0.5 ? 'fresh' : share > 0.2 ? 'aging' : 'expiring' };
  };
  const archiveEntity = (kind: 'worker' | 'team', entityId: string, archived: boolean) => action(async () => { await orglet.call('archiveEntity', { kind, id: entityId, archived }); toast(archived ? t('Đã lưu trữ') : t('Đã khôi phục')); });
  const deleteEntity = (kind: 'worker' | 'team', entityId: string) => action(async () => { await orglet.call('deleteEntity', { kind, id: entityId }); toast(t('Đã xóa')); });
  const activeTasks = workspace.tasks.filter(task => !task.archivedAt);
  const taskSeen = (task: Workspace['tasks'][number]) => {
    if (selected === task.id) return true;
    const cached = seenInfo.current[task.id];
    return taskResultSeen({
      status: task.status,
      inputRevision: task.inputRevision,
      lastArtifactId: task.lastArtifactId ?? cached?.lastArtifactId,
      seenStamp: task.seenStamp ?? cached?.seenStamp,
    });
  };
  const workerStatus = (id: string): StatusMarkState => {
    const live = liveWorkerTask(activeTasks, id);
    return live
      ? tasksStatusMark([{ status: live.status, seen: taskSeen(live) }])
      : tasksStatusMark(activeTasks.filter(task => taskWorkers(task, workspace).some(item => item.id === id)).map(task => ({ status: task.status, seen: taskSeen(task) })));
  };
  const teamStatus = (team: Team): StatusMarkState => {
    const live = liveTeamTask(activeTasks, team.id);
    return rollupStatusMarks([
      ...(live ? [tasksStatusMark([{ status: live.status, seen: taskSeen(live) }])] : []),
      ...teamRoster(team, workspace.workers).map(member => workerStatus(member.id)),
    ]);
  };
  const openTaskWorkers = detail ? taskWorkers(detail.task, workspace) : [];
  const openTaskPaid = openTaskWorkers.some(item => isPaidApi(item.provider));
  const openTaskUsed = detail ? detail.usage.chargedMicros + detail.usage.reservedMicros : 0;
  const pendingCatchUp = workspace.routines.filter(item => item.pending);
  const catchUpNoticeKey = pendingCatchUp.map(item => item.id).sort().join(',');
  const catchUpNotice = pendingCatchUp.length > 0 && dismissedCatchUpNotice !== catchUpNoticeKey && panel !== 'routines';
  const singleCatchUp = pendingCatchUp.length === 1 ? pendingCatchUp[0] : undefined;
  const roster = team ? teamRoster(team, workspace.workers) : [];
  // The details panel is about the chat you are in: a selected task carries its own team or worker, otherwise
  // it is whichever chat is open, so a team can be read before anything has been sent (COD-68).
  const detailsTeam = detailTeam ?? team;
  const detailsWorker = detailsTeam ? undefined : detail ? workspace.workers.find(item => item.id === detail.task.workerId) : worker;
  // Openers for the empty chat, read from this workspace rather than a fixed list (COD-48).
  const chatTasks = workspace.tasks.filter(task => team ? task.teamId === team.id : !task.teamId && task.workerId === workerId);
  const starters = suggestStarters({ worker, team, members: roster, skills: workspace.skills, tasks: chatTasks, hasSources: sources.length > 0 });
  const pickStarter = (prompt: string) => {
    setBrief(prompt);
    const textarea = composer.current;
    if (!textarea) return;
    // The caret belongs at the end: most openers stop at a colon for the person to keep typing.
    setTimeout(() => { textarea.focus(); textarea.setSelectionRange(prompt.length, prompt.length); }, 0);
  };
  // The prompt bar's right-hand control. A one-to-one chat names its worker in the header already, so the spot
  // carries the model the worker will answer with instead of a list holding that one name (user, 2026-09-19).
  // A team keeps the recipient list, and so does a chat with nobody chosen yet, where it is how you choose.
  const composerTrailing = worker && !team && worker.provider !== 'demo'
    // An empty choice means whatever the provider defaults to, and a stored id may not be empty, so it is dropped.
    ? <ComposerModel worker={{ ...worker, provider: worker.provider }}
      onChange={modelId => action(() => orglet.call('saveWorker', { ...worker, modelId: modelId || undefined }))} />
    : recipientOptions.length > 0
      ? <Select className="composer-to-select" ariaLabel={t('Đang nhắn với {0}', [team?.name ?? worker?.name ?? t('Tí')])} value={recipientValue} onChange={pickRecipient} showDetail={false} showIcon={false} menuMinWidth={280} options={recipientOptions} />
      : undefined;
  // One provider behind this chat, or none to name: a team split across providers says nothing in the header and
  // lets the details panel list them.
  const chatProviders = [...new Set((selected && detail ? detail.runs.map(run => run.snapshot.worker.provider) : executionWorkers.map(item => item.provider)))];
  const headerProvider = chatProviders.length === 1 ? chatProviders[0] : undefined;
  const chatName = team?.name ?? worker?.name ?? 'Orglet';
  const [chatHeadingBefore = '', chatHeadingAfter = ''] = t('Đang nhắn với {0}').split('{0}');
  const composerBar = <Composer textareaRef={composer} value={brief} onChange={setBrief} onSubmit={() => void send()} label={t('Tin nhắn')} placeholder={team ? t('Nhắn với hội…') : t('Nhắn với {0}…', [worker?.name ?? t('Tí')])} sendLabel={t('Gửi tin nhắn')} disabled={busy} sendDisabled={!isDemo && missingConnections.length > 0} mentions={team ? { people: executionWorkers, allNames: [team.name] } : undefined}
    leading={<SourcePicker onFiles={() => action(async () => { const picked = await orglet.pickSources(); setSources(previous => [...previous, ...picked].slice(0, 20)); })} onFolder={() => action(async () => { const intake = await orglet.pickFolder(); const available = 20 - sources.length; setSources(previous => [...previous, ...intake.sources].slice(0, 20)); setSkippedSources(previous => [...previous, ...intake.skipped, ...intake.sources.slice(available).map(source => ({ name: source.name, reason: t('Task đã có đủ 20 tệp.') }))]); })} />}
    trailing={composerTrailing}
    attachments={sources} onRemoveAttachment={id => setSources(sources.filter(source => source.id !== id))} />;
  const composerHint = isDemo ? <p className="composer-note">{team?.preflight ? t('Demo · không gọi API; checker local sẽ chạy trước báo cáo mẫu.') : t('Đang dùng Demo · không gọi API, không phân tích tệp.')}<button onClick={() => { if (team) { setEditingTeam(team); setPanel('team'); } else { setEditingWorker(worker); setPanel('worker'); } }}>{team ? t('Thiết lập hội') : t('Đổi model')}</button></p> : missingConnections.length > 0 ? <p className="composer-note">{t('Cần kết nối trước khi gửi.')}<button onClick={() => openSettings(settingsTabFor(missingConnections))}>{missingConnections.map(provider => setupHint(provider, harnesses)).join(t(' và '))}</button></p> : null;
  return <div className={`app ${sidebar ? '' : 'sidebar-hidden'}${resizing ? ' resizing' : ''}${panelMoving ? ' panel-moving' : ''}${detailsOpen ? ' with-details' : ''}`} style={{ '--sidebar-width': `${sidebarWidth}px`, '--details-width': `${detailsPane.width}px` } as CSSProperties}>
    <a className="skip-link" href="#main-content">{t('Đến nội dung chính')}</a>
    {sidebar && <button type="button" className="sidebar-resizer" aria-label={t('Kéo để đổi độ rộng thanh bên')} {...sidebarPane.handleProps} />}
    {detailsOpen && <button type="button" className="details-resizer" aria-label={t('Kéo để đổi độ rộng panel chi tiết')} {...detailsPane.handleProps} />}
    <aside className={`sidebar${sidebar ? '' : ' collapsed'}`} aria-label={t('Điều hướng')} inert={!sidebar || undefined}>
      <div className="brand"><span className="orglet-mark">o</span><strong>Orglet</strong><Button size="icon" aria-label={t('Tìm cuộc trò chuyện (Ctrl K)')} aria-haspopup="dialog" onClick={() => setSearchOpen(true)}><Search size={18} /></Button><Button size="icon" aria-label={t('Thu gọn sidebar')} onClick={() => setSidebar(false)}><PanelLeft size={18} /></Button></div>
      <div className="sidebar-scroll">
      
      <SidebarSection id="teams" title={t('Hội')} action={<Button size="icon" className="row-action" aria-label={t('Tạo hội')} onClick={() => { setEditingTeam(undefined); setPanel('team'); }}><Plus size={16} /></Button>}>
        {teamOrder.order.map(id => workspace.teams.find(team => team.id === id)).filter((item): item is Team => Boolean(item)).map(item => <SidebarTreeRow key={item.id} id={`team-${item.id}`} arriving={isArriving(`team-${item.id}`)} name={item.name} avatar={<RosterAvatars workers={teamRoster(item, workspace.workers)} size="sm" max={3} />} active={teamId === item.id && (!selected || selected === liveTeamTask(workspace.tasks, item.id)?.id)} status={teamStatus(item)} onSelect={() => openTeam(item.id)} reorder={teamOrder.bind(item.id)}
          menu={<RowMenu label={t('Tùy chọn hội {0}', [item.name])} icon={EllipsisVertical} items={[{ label: t('Chỉnh sửa'), icon: Pencil, onSelect: () => { setEditingTeam(item); setPanel('team'); } }, { label: t('Xuất template'), icon: Download, onSelect: () => action(() => orglet.exportTemplate(item.id)) }, { label: t('Lưu trữ'), icon: Archive, onSelect: () => archiveEntity('team', item.id, true) }, { label: t('Xóa'), icon: Trash, danger: true, onSelect: () => deleteEntity('team', item.id), confirm: { question: t('Xóa {0}? Cuộc trò chuyện cũ vẫn giữ lịch sử.', [item.name]), label: t('Xóa') } }]} />} />
        )}{!workspace.teams.length && <p className="empty-history">{t('Chưa có hội nào.')}</p>}
        <ArchivedList count={workspace.archivedTeams.length}>{workspace.archivedTeams.map(item => <ArchivedRow key={item.id} name={item.name} mark={<Avatar name={item.name} seed={item.id} size="xs" />} archive={archiveState(item)!} onRestore={() => archiveEntity('team', item.id, false)} onDelete={() => deleteEntity('team', item.id)} />)}</ArchivedList>
      </SidebarSection>
      <SidebarSection id="workers" title={t('Tí')} action={<Button size="icon" className="row-action" aria-label={t('Tạo Tí')} onClick={() => { setEditingWorker(undefined); setPanel('worker'); }}><Plus size={16} /></Button>}>
        {workerOrder.order.map(id => workspace.workers.find(worker => worker.id === id)).filter((item): item is Worker => Boolean(item)).map(item => <SidebarTreeRow key={item.id} id={`worker-${item.id}`} arriving={isArriving(`worker-${item.id}`)} name={item.name} description={item.description} avatar={<Avatar name={item.name} seed={item.id} emoji={item.avatar?.emoji} mascot={item.avatar?.mascot} defaultMascot hint={item.description} color={item.avatar?.color} size="sm" badge={item.provider === 'demo' ? undefined : <ProviderMark provider={item.provider} size="small" decorative />} />} active={!teamId && workerId === item.id && (!selected || selected === liveWorkerTask(workspace.tasks, item.id)?.id)} status={workerStatus(item.id)} reorder={workerOrder.bind(item.id)} onSelect={() => openWorker(item.id)}
          menu={<RowMenu label={t('Tùy chọn {0}', [item.name])} icon={EllipsisVertical} items={[{ label: t('Chỉnh sửa'), icon: Pencil, onSelect: () => { setEditingWorker(item); setPanel('worker'); } }, { label: t('Lưu trữ'), icon: Archive, onSelect: () => archiveEntity('worker', item.id, true) }, { label: t('Xóa'), icon: Trash, danger: true, onSelect: () => deleteEntity('worker', item.id), confirm: { question: t('Xóa {0}? Cuộc trò chuyện cũ vẫn giữ lịch sử.', [item.name]), label: t('Xóa') } }]} />} />)}{!workspace.workers.length && <p className="empty-history">{t('Chưa có Tí nào.')}</p>}
        <ArchivedList count={workspace.archivedWorkers.length}>{workspace.archivedWorkers.map(item => <ArchivedRow key={item.id} name={item.name} mark={<Avatar name={item.name} seed={item.id} mascot={item.avatar?.mascot} defaultMascot hint={item.description} color={item.avatar?.color} size="xs" />} archive={archiveState(item)!} onRestore={() => archiveEntity('worker', item.id, false)} onDelete={() => deleteEntity('worker', item.id)} />)}</ArchivedList>
      </SidebarSection>
      </div>
      <div className="sidebar-footer"><Button onClick={() => openRoutines()}><CalendarClock size={18} />{t('Lịch chạy')}{workspace.routines.some(item => item.pending) && <span className="badge">{t('Cần xem')}</span>}</Button><Button onClick={() => { if (workspace.knowledge.some(item => item.status === 'proposed')) setLibraryTab('knowledge'); setPanel('library'); }}><BookOpen size={18} />{t('Thư viện')}{workspace.knowledge.some(item => item.status === 'proposed') && <span className="badge">{t('Cần duyệt')}</span>}</Button><Button onClick={() => openSettings()}><Settings size={18} />{t('Cài đặt')}<span className={`connection-dot ${Object.values(connections).some(Boolean) ? 'connected' : ''}`} /></Button></div>
    </aside>
    {/* Collapsed sidebar keeps its two most used actions in a narrow rail, stacked like ChatGPT. */}

    <main className="main-pane" id="main-content" tabIndex={-1}>
      <header className="topbar">
        {/* With the sidebar collapsed these live here, inside the panel, rather than on the window behind it. */}
        {!sidebar && <div className="topbar-rail">
          <Button size="icon" aria-label={t('Mở sidebar')} title={t('Mở sidebar')} onClick={() => setSidebar(true)}><PanelLeft size={18} /></Button>
          <Button size="icon" aria-label={t('Tìm cuộc trò chuyện (Ctrl K)')} aria-keyshortcuts="Control+K" aria-haspopup="dialog" title={t('Tìm cuộc trò chuyện (Ctrl K)')} onClick={() => setSearchOpen(true)}><Search size={18} /></Button>
        </div>}
        <div>
          <span>{selected ? (detail && assigneeLabel(detail.task, workspace, { all: t('Toàn bộ Tí'), many: count => t('{0} Tí', [count]) })) ?? team?.name ?? t('Công việc') : team?.name ?? worker?.name ?? 'Orglet'}</span>
          {/* Which model is answering, not only whether it is Demo (user, 2026-09-19). A team running on several
              providers says nothing here; the details panel lists them one by one. */}
          {headerProvider && <span className="topbar-provider" title={headerProvider === 'demo' ? t('Demo · không gọi API') : providerLabel(headerProvider)}>
            {headerProvider !== 'demo' && <ProviderMark provider={headerProvider} size="small" decorative />}
            {providerName(headerProvider)}
          </span>}
        </div>
        <div className="topbar-actions">
          {selected && detail && openTaskPaid && <span className="task-cost" role="status" title={detail.usage.reservedMicros > 0 ? t('Đã dùng {0} / {1} · đang giữ chỗ {2}', [formatMoney(detail.usage.chargedMicros), formatMoney(detail.task.budgetMicros), formatMoney(detail.usage.reservedMicros)]) : t('Đã dùng {0} / {1}', [formatMoney(openTaskUsed), formatMoney(detail.task.budgetMicros)])}><Wallet size={14} aria-hidden="true" />{t('Đã dùng {0} / {1}', [formatMoney(openTaskUsed), formatMoney(detail.task.budgetMicros)])}</span>}

          {(selected || team || worker) && <RowMenu className="thread-menu" label={t('Tùy chọn cuộc trò chuyện')} items={[{ label: t('Chi tiết'), icon: SlidersHorizontal, onSelect: () => setPanel('activity') }, ...(selected ? [{ label: t('Chỉnh sửa'), icon: LucidePencil, onSelect: () => { setEditingTask(selected); setPanel('task'); } }, detail?.task.archivedAt ? { label: t('Khôi phục'), icon: ArchiveRestore, onSelect: () => archiveTask(selected, false) } : { label: t('Lưu trữ'), icon: LucideArchive, onSelect: () => archiveTask(selected, true) }, { label: t('Xóa'), icon: Trash2, danger: true, onSelect: () => deleteTask(selected), confirm: { question: t('Xóa cuộc trò chuyện này? Không thể hoàn tác.'), label: t('Xóa') } }] : [])]} />}
        </div>
      </header>
      {error && <div className="error-banner" role="alert"><span>{error}</span><Button size="icon" aria-label={t('Đóng thông báo')} onClick={() => setError('')}><X size={16} /></Button></div>}
      {catchUpNotice && <div className="notice-banner" role="status"><LucideCalendarClock size={16} aria-hidden="true" /><div><p>{singleCatchUp ? t('{0} đã bỏ qua lần chạy vì app tắt hoặc máy ngủ. Lịch không mất. Bạn có thể chạy bù một lần hoặc bỏ qua.', [singleCatchUp.name]) : t('{0} lịch đã bỏ qua lần chạy vì app tắt hoặc máy ngủ. Lịch không mất. Mỗi lịch chỉ chạy bù một lần.', [pendingCatchUp.length])}</p><div className="actions">{singleCatchUp?.enabled && <Button variant="primary" onClick={() => action(async () => openTask(await orglet.call('catchUpRoutine', { id: singleCatchUp.id })))}>{t('Chạy bù một lần')}</Button>}<Button onClick={() => openRoutines()}>{t('Xem lịch chạy')}</Button></div></div><Button size="icon" aria-label={t('Đóng thông báo lịch bị lỡ')} onClick={() => setDismissedCatchUpNotice(catchUpNoticeKey)}><X size={16} /></Button></div>}
      {selected ? <>{detail ? <><FormatPreferences.Provider value={{ copy: workspace.copyFormat, download: workspace.downloadFormat }}><TaskThread key={selected} detail={detail} action={action} showSources={openSources} proposals={workspace.knowledge.filter(item => item.status === 'proposed' && item.provenance.kind === 'run' && item.provenance.taskId === selected)} openKnowledge={openKnowledge} mentionPeople={openTaskWorkers} mentionAllNames={detail.task.teamId ? [workspace.teams.find(item => item.id === detail.task.teamId)?.name ?? ''].filter(Boolean) : undefined} /></FormatPreferences.Provider><FollowUpComposer key={`follow:${selected}`} detail={detail} workspace={workspace} ready={ready} openRevision={() => setPanel('revision')} openSettings={tab => openSettings(tab ?? 'connections')} action={action} /></> : <div className="loading" role="status">{t('Đang mở cuộc trò chuyện…')}</div>}</> : (team || worker) ? <div className="team-chat team-chat-fresh">
        {/* Nothing has been sent yet, so the greeting, the prompt bar and the starters sit together in the
            middle of the pane instead of a greeting up top and a bar pinned to the bottom (user, 2026-09-19). */}
        <div className="fresh-chat team-chat-empty">
          <h1 className="welcome">{chatHeadingBefore}<span className="welcome-who">{team ? <RosterAvatars workers={roster} size="sm" max={2} alive /> : worker ? <Avatar name={worker.name} seed={worker.id} emoji={worker.avatar?.emoji} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="sm" alive /> : null}{chatName}</span>{chatHeadingAfter}</h1>
          <div className="thread-composer">
            {composerBar}
            {composerHint}
            {skippedSources.length > 0 && <details className="intake-skipped"><summary>{t('{0} mục không được thêm vào task', [skippedSources.length])}</summary><ul>{skippedSources.map((item, index) => <li key={index}>{item.name}: {item.reason}</li>)}</ul></details>}
          </div>
          <Starters starters={starters} onPick={pickStarter}
            canSchedule={Boolean(brief.trim())}
            onSchedule={worker && !team ? () => { setRoutineDraft({ workerId, brief, sourceIds: sources.map(source => source.id), excludedSources: skippedSources, consent: false, providerScopes: [], budgetMicros: taskBudgetMicros }); setRoutineView({ editing: true }); setPanel('routines'); } : undefined} />
        </div>
      </div> : null}
      <footer className="main-footer">{t('Orglet không đảm bảo câu trả lời luôn chính xác. Hãy kiểm chứng với nguồn gốc trước khi dùng.')}</footer>
    </main>
    {detailsOpen && (detail || detailsTeam || detailsWorker) && <DetailsPanel workspace={workspace} team={detailsTeam} worker={detailsWorker} detail={detail}
      workerStatus={workerStatus} onClose={close} onOpenSources={() => openSources()} onExport={artifactId => action(() => orglet.exportArtifact(artifactId))} />}
    <Drawer open={panel !== null && !['settings', 'worker', 'team', 'task', 'activity'].includes(panel)} onClose={() => panel === 'routines' ? void leaveRoutine(close) : close()} description={panel === 'routines' && !routineView.editing ? t('Chỉ chạy khi Orglet đang mở; lỡ thì chạy bù một lần') : panel === 'library' ? (libraryTab === 'skills' ? t('Hướng dẫn dùng lại được. Gói nhập từ thư mục cần được review trước khi gắn cho Tí.') : t('Ghi chú dùng lại được. Chỉ mục đã duyệt mới được nạp vào context, và chỉ trong phạm vi đã chọn.')) : undefined} actions={panel === 'routines' && !routineView.editing ? <Button variant="outline" onClick={() => setRoutineView({ editing: true })}><LucideCalendarClock size={16} />{t('Tạo lịch')}</Button> : undefined} title={panel === 'revision' ? t('Đính kèm tệp') : panel === 'routines' ? (routineView.editing ? <span className="breadcrumb"><Button size="icon" aria-label={t('Quay lại danh sách lịch')} onClick={() => void leaveRoutine(() => setRoutineView({ editing: false }))}><ArrowLeft size={18} /></Button><button type="button" className="breadcrumb-link" onClick={() => void leaveRoutine(() => setRoutineView({ editing: false }))}>{t('Lịch chạy')}</button><ChevronRight size={15} aria-hidden="true" className="breadcrumb-separator" /><span aria-current="page">{routineView.routine ? routineView.routine.name : t('Lịch mới')}</span></span> : t('Lịch chạy')) :panel === 'skill' ? editingSkill?.package ? 'Review skill' : t('Chỉnh skill') : panel === 'knowledge' ? editingKnowledge ? 'Knowledge' : t('Knowledge mới') : panel === 'library' ? t('Thư viện') : panel === 'sources' ? t('Nguồn của cuộc trò chuyện') : t('Chi tiết cuộc trò chuyện')}>
      {panel === 'revision' && detail && <RevisionEditor key={`${detail.task.id}:${detail.task.inputRevision ?? 0}`} detail={detail} workspace={workspace} connections={ready} done={close} />}
      {panel === 'routines' && <RoutinesPanel workspace={workspace} draft={routineDraft} view={routineView} onView={setRoutineView} onDirty={markRoutineDirty} onBack={() => void leaveRoutine(() => setRoutineView({ editing: false }))} openTask={id => { openTask(id); close(); }} />}
      
      {panel === 'skill' && <SkillEditor key={editingSkill?.id ?? 'new'} skill={editingSkill} done={close} />}
      {panel === 'library' && <div className="form">
        <div className="tab-row"><div className="tabs" role="tablist" aria-label={t('Thư viện')} onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const next = libraryTab === 'skills' ? 'knowledge' : 'skills'; setLibraryTab(next); document.getElementById(`library-tab-${next}`)?.focus(); }}>{(['skills', 'knowledge'] as const).map(tab => <Button key={tab} id={`library-tab-${tab}`} role="tab" aria-selected={libraryTab === tab} aria-controls="library-panel" tabIndex={libraryTab === tab ? 0 : -1} onClick={() => setLibraryTab(tab)}>{tab === 'skills' ? 'Skills' : 'Knowledge'}<span className="tab-count" aria-hidden="true">{tab === 'skills' ? workspace.skills.length : workspace.knowledge.filter(item => item.status !== 'archived').length}</span></Button>)}</div>
          <div className="tab-row-actions">{libraryTab === 'skills' ? <SkillLibraryActions onOpen={skill => { setEditingSkill(skill); setPanel('skill'); }} /> : <Button variant="outline" onClick={() => openKnowledge()}><LucidePlus size={16} />{t('Tạo knowledge')}</Button>}</div></div>
        <div id="library-panel" role="tabpanel" aria-labelledby={`library-tab-${libraryTab}`}>{libraryTab === 'skills' ? <SkillLibrary skills={workspace.skills} onOpen={skill => { setEditingSkill(skill); setPanel('skill'); }} /> : <KnowledgeLibrary workspace={workspace} onOpen={openKnowledge} />}</div>
      </div>}
      {panel === 'knowledge' && <KnowledgeEditor key={editingKnowledge ? `${editingKnowledge.id}:${editingKnowledge.revision}` : 'new'} item={editingKnowledge} workspace={workspace} done={close} />}
      {panel === 'sources' && detail && <SourcePanel detail={detail} target={sourceTarget} refresh={() => void refresh()} />}
    </Drawer>
    <WorkerDialog key={`worker:${panel === 'worker'}:${editingWorker?.id ?? 'new'}`} open={panel === 'worker'} worker={editingWorker} workspace={workspace} connections={connections} harnesses={harnesses} onClose={close} />
    <TeamDialog key={`team:${panel === 'team'}:${editingTeam?.id ?? 'new'}`} open={panel === 'team'} team={editingTeam} workspace={workspace} onClose={close} />
    <TaskDialog key={`task:${panel === 'task'}:${editingTask ?? ''}`} open={panel === 'task'} task={workspace.tasks.find(item => item.id === editingTask)} workspace={workspace} usedMicros={editingTask && detail?.task.id === editingTask ? detail.usage.chargedMicros + detail.usage.reservedMicros : 0} onClose={close} />
    <Toaster />
    <Confirmer />
    <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} tasks={workspace.tasks} teams={workspace.teams} onOpenTask={openTask} />
    <SettingsDialog open={panel === 'settings'} tab={settingsTab} onTab={setSettingsTab} onClose={close} workspace={workspace} connections={connections} onConnections={setConnections} harnesses={harnesses} onHarnesses={setHarnesses} />
  </div>;
}