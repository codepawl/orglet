import { RevisionEditor } from './components/RevisionEditor';
import { SkillLibrary, SkillLibraryActions } from './components/SkillReview';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, SquarePen, BookOpen, Download, FileText, PanelLeft, Pencil, Plus, Search, Settings2, SlidersHorizontal, Sparkles, CalendarClock, Wallet, X, Archive, Trash2 } from 'lucide-react';
import type { Connections, Skill, Source, Task, TaskDetail, Worker, Workspace, Team, TaskInput } from '../shared/contracts';
import { Button, Drawer } from './components/ui';
import { SkillEditor } from './components/Editors';
import { WorkerDialog } from './components/WorkerDialog';
import { SettingsDialog, type SettingsTab } from './components/SettingsDialog';
import { TaskThread, statusLabel } from './components/TaskThread';
import { SourcePanel, type SourceTarget } from './components/SourcePanel';
import { TeamDialog } from './components/TeamEditor';
import { TaskDialog } from './components/TaskDialog';
import { FormatPreferences } from './components/FormatAction';
import { assigneeLabel, taskWorkers, teamRoster } from './assignees';
import { liveTeamTask } from '../shared/live-task';
import { ArchivedList, ArchivedRow, type ArchiveState } from './components/SidebarTree';
import { RoutinesPanel, type RoutineView } from './components/RoutinesPanel';
import { Confirmer, confirmAction } from './components/confirm';
import { SourcePicker } from './components/SourcePicker';
import { Composer, FollowUpComposer } from './components/Composer';
import { SidebarSection } from './components/SidebarSection';
import { Avatar, RosterAvatars } from './components/Avatar';
import { ProviderMark } from './components/ProviderMark';
import { ShowMore, SidebarTreeRow, TaskRow, useReorder, statusMarkLabel } from './components/SidebarTree';
import { SearchDialog } from './components/SearchDialog';
import { StatusMark, tasksStatusMark, rollupStatusMarks, type StatusMarkState } from './components/StatusMark';
import { taskResultSeen } from '../shared/task-seen';
import { RowMenu } from './components/RowMenu';
import { Select } from './components/Select';
import { setDisplayCurrency, formatMoney } from './components/money';
import { Toaster, toast } from './components/toast';
import { ContextManifestView, KnowledgeEditor, KnowledgeLibrary } from './components/KnowledgeLibrary';
import type { Knowledge } from '../shared/knowledge';
import type { HarnessInfo } from '../shared/harness';
import { isHarness } from '../shared/harness';
import { readiness, settingsTabFor, setupHint } from './components/providers';
import { workerModelLabel } from './components/workerModel';
import { t } from './i18n';import { currentLocale, setLanguage, tMessage, useLanguage } from './i18n';
import { orglet } from './api';

type SeenInfo = { seenStamp: string; lastArtifactId?: string };
const seenStorageKey = 'orglet.task-seen-stamps';
function readSeenStorage(): Record<string, SeenInfo> {
  try { return JSON.parse(localStorage.getItem(seenStorageKey) || '{}') as Record<string, SeenInfo>; } catch { return {}; }
}
function writeSeenStorage(value: Record<string, SeenInfo>) {
  try { localStorage.setItem(seenStorageKey, JSON.stringify(value)); } catch { /* ignore quota */ }
}

type Panel = 'task' | 'revision' | 'routines' | 'settings' | 'worker' | 'team' | 'library' | 'skill' | 'knowledge' | 'activity' | 'sources' | null;
export function App() {
  useLanguage();
  const [workspace, setWorkspace] = useState<Workspace>(); const [connections, setConnections] = useState<Connections>({ openai: false, anthropic: false, xai: false });
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
  const openSources = (target?: SourceTarget) => { setSourceTarget(target); setPanel('sources'); };
  
  const [panel, setPanel] = useState<Panel>(null); const [editingWorker, setEditingWorker] = useState<Worker>(); const [editingTask, setEditingTask] = useState<string>(); const [editingSkill, setEditingSkill] = useState<Skill>();
  const [editingKnowledge, setEditingKnowledge] = useState<Knowledge>(); const [libraryTab, setLibraryTab] = useState<'skills' | 'knowledge'>('skills');
  const openKnowledge = (item?: Knowledge) => { setEditingKnowledge(item); setPanel('knowledge'); };
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const openSettings = (tab: SettingsTab = 'general') => { setSettingsTab(tab); setPanel('settings'); };
  const [searchOpen, setSearchOpen] = useState(false); const [sidebar, setSidebar] = useState(() => innerWidth > 780); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [dismissedCatchUpNotice, setDismissedCatchUpNotice] = useState('');
  const composer = useRef<HTMLTextAreaElement>(null); const refreshId = useRef(0);
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
  useEffect(() => {
    const media = matchMedia('(max-width: 780px)');
    const collapse = () => { if (media.matches) setSidebar(false); };
    media.addEventListener('change', collapse); return () => media.removeEventListener('change', collapse);
  }, []);
  const newTask = useCallback(() => { setSelected(null); setDetail(undefined); setBrief(''); setSources([]); setSkippedSources([]); setError(''); setTeamId(''); if (matchMedia('(max-width: 780px)').matches) setSidebar(false); setTimeout(() => composer.current?.focus(), 0); }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'n') { event.preventDefault(); newTask(); }
      if (event.ctrlKey && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [newTask]);
  // Re-opening the task already shown keeps its detail; clearing it would wait for a reload that never comes.
  const openTask = (id: string) => {
    if (id !== selected) { setSelected(id); setDetail(undefined); }
    setError('');
    const opened = workspace?.tasks.find(task => task.id === id);
    if (opened?.teamId && !opened.routineId) setTeamId(opened.teamId);
    else setTeamId('');
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
    setSelected(null); setDetail(undefined); setError('');
    if (matchMedia('(max-width: 780px)').matches) setSidebar(false);
    setTimeout(() => composer.current?.focus(), 0);
  };
  const action = (fn: () => Promise<unknown>) => { setError(''); void fn().then(() => refresh()).catch(err => setError((err as Error).message)); };
  const worker = workspace?.workers.find(item => item.id === workerId);
  const team = workspace?.teams.find(item => item.id === teamId);
  const executionWorkers = team ? teamRoster(team, workspace!.workers) : worker ? [worker] : [];
  const nativeProviders = [...new Set(executionWorkers.map(item => item.provider).filter(provider => provider !== 'demo'))];
  const isDemo = nativeProviders.length === 0;
  const paidProviders = nativeProviders.filter(provider => !isHarness(provider));
  const ready = readiness(connections, harnesses);
  const missingConnections = nativeProviders.filter(provider => !ready[provider]);
  // Choosing a model and attaching sources is the user's consent to send them; no separate permission step.
  const taskBudgetMicros = (team ?? worker)?.taskBudgetMicros ?? 500_000;
  const unavailable = t('Chưa sẵn sàng');
  const recipientReady = (providers: Worker['provider'][]) => providers.every(provider => provider === 'demo' || ready[provider as keyof typeof ready]);
  const recipientValue = teamId ? `team:${teamId}` : workerId;
  const pickRecipient = (value: string) => {
    if (value.startsWith('team:')) { openTeam(value.slice(5)); return; }
    setWorkerId(value); setTeamId('');
  };
  const send = async () => {
    if (!brief.trim() || busy || (!team && !worker)) return;
    setBusy(true); setError('');
    try {
      const thread = team ? liveTeamTask(workspace!.tasks, team.id) : undefined;
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
  // A task link under a worker asks beside itself first; choosing not to be asked again saves the setting.
  const openFromWorker = (taskId: string, dontAskAgain = false) => {
    if (dontAskAgain && workspace) action(() => orglet.call('settings', { language: workspace.language, autoTitles: workspace.autoTitles, confirmOpenTask: false, theme: workspace.theme, connectionLimitMicros: workspace.connectionLimitMicros, providerConcurrency: workspace.providerConcurrency, providerConsent: workspace.providerConsent ?? [] }));
    openTask(taskId);
  };
  const renamed = (fn: () => Promise<unknown>) => action(async () => { await fn(); toast(t('Đã đổi tên.')); });
  setDisplayCurrency(workspace?.currency);
  if (!workspace) return <div className="startup"><span className="orglet-mark">o</span><h1>Orglet</h1><p role={error ? 'alert' : 'status'}>{error || t('Đang mở workspace…')}</p>{error && window.orglet && <Button onClick={() => void refresh()}>{t('Thử lại')}</Button>}</div>;
  const recipientOptions = [
    ...workspace.workers.map(item => {
      const available = recipientReady([item.provider]);
      return {
        value: item.id,
        label: item.name,
        detail: workerModelLabel(item.provider),
        group: t('Nhân viên'),
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
        detail: t('{0} nhân viên', [members.length]),
        group: t('Nhóm'),
        icon: <Avatar name={item.name} seed={item.id} size="xs" />,
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
  const archiveEntity = (kind: 'worker' | 'team', entityId: string, archived: boolean) => action(async () => { await orglet.call('archiveEntity', { kind, id: entityId, archived }); toast(archived ? t('Đã lưu trữ.') : t('Đã khôi phục.')); });
  const deleteEntity = (kind: 'worker' | 'team', entityId: string) => action(async () => { await orglet.call('deleteEntity', { kind, id: entityId }); toast(t('Đã xóa.')); });
  const deleteTask = (taskId: string) => action(async () => { await orglet.call('deleteTask', { id: taskId }); if (selected === taskId) newTask(); toast(t('Đã xóa công việc.')); });
  const archiveTask = (taskId: string, archived: boolean) => action(async () => { await orglet.call('archiveTask', { id: taskId, archived }); toast(archived ? t('Đã lưu trữ công việc.') : t('Đã khôi phục công việc.')); });
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
  const workerStatus = (workerId: string): StatusMarkState => tasksStatusMark(activeTasks.filter(task => taskWorkers(task, workspace).some(worker => worker.id === workerId)).map(task => ({ status: task.status, seen: taskSeen(task) })));
  const teamStatus = (team: Team): StatusMarkState => {
    const live = liveTeamTask(activeTasks, team.id);
    return rollupStatusMarks([
      ...(live ? [tasksStatusMark([{ status: live.status, seen: taskSeen(live) }])] : []),
      ...teamRoster(team, workspace.workers).map(member => workerStatus(member.id)),
    ]);
  };
  const taskRow = (task: Workspace['tasks'][number], nested = false) => <TaskRow key={task.id} archive={nested ? undefined : archiveState(task)} onArchive={archived => archiveTask(task.id, archived)} onDelete={() => deleteTask(task.id)} title={task.title} brief={task.brief} nested={nested} active={selected === task.id} status={task.status} statusLabel={statusLabel[task.status]} seen={taskSeen(task)} askFirst={nested && workspace.confirmOpenTask} onOpen={dontAskAgain => nested ? openFromWorker(task.id, dontAskAgain) : openTask(task.id)} onRename={title => renamed(() => orglet.call('renameTask', { id: task.id, title }))} onEdit={() => { setEditingTask(task.id); setPanel('task'); }} />;
  const openTaskWorkers = detail ? taskWorkers(detail.task, workspace) : [];
  const openTaskPaid = openTaskWorkers.some(item => item.provider !== 'demo' && !isHarness(item.provider));
  const openTaskUsed = detail ? detail.usage.chargedMicros + detail.usage.reservedMicros : 0;
  const pendingCatchUp = workspace.routines.filter(item => item.pending);
  const catchUpNoticeKey = pendingCatchUp.map(item => item.id).sort().join(',');
  const catchUpNotice = pendingCatchUp.length > 0 && dismissedCatchUpNotice !== catchUpNoticeKey && panel !== 'routines';
  const singleCatchUp = pendingCatchUp.length === 1 ? pendingCatchUp[0] : undefined;
  const roster = team ? teamRoster(team, workspace.workers) : [];
  const composerBar = <Composer textareaRef={composer} value={brief} onChange={setBrief} onSubmit={() => void send()} label={team ? t('Tin nhắn') : t('Nội dung công việc')} placeholder={team ? t('Nhắn với nhóm…') : t('Nhắn hoặc giao việc cho nhân viên')} sendLabel={team ? t('Gửi tin nhắn') : t('Gửi công việc')} disabled={busy} sendDisabled={!isDemo && missingConnections.length > 0}
    leading={<SourcePicker onFiles={() => action(async () => { const picked = await orglet.pickSources(); setSources(previous => [...previous, ...picked].slice(0, 20)); })} onFolder={() => action(async () => { const intake = await orglet.pickFolder(); const available = 20 - sources.length; setSources(previous => [...previous, ...intake.sources].slice(0, 20)); setSkippedSources(previous => [...previous, ...intake.skipped, ...intake.sources.slice(available).map(source => ({ name: source.name, reason: t('Task đã có đủ 20 tệp.') }))]); })} />}
    trailing={recipientOptions.length > 0 ? <Select className="composer-to-select" ariaLabel={t('Đang nhắn với {0}', [team?.name ?? worker?.name ?? t('Nhân viên')])} value={recipientValue} onChange={pickRecipient} showDetail={false} menuMinWidth={280} options={recipientOptions} /> : undefined}
    attachments={sources.length > 0 ? sources.map(source => <span className="attachment" key={source.id}><FileText size={14} /><span>{source.name}</span><button type="button" aria-label={t('Bỏ {0}', [source.name])} onClick={() => { setSources(sources.filter(s => s.id !== source.id)); }}><X size={14} /></button></span>) : undefined} />;
  const composerHint = isDemo ? <p className="composer-note">{team?.preflight ? t('Demo · không gọi API; checker local sẽ chạy trước báo cáo mẫu.') : t('Đang dùng Demo · không gọi API, không phân tích tệp.')}<button onClick={() => { if (team) { setEditingTeam(team); setPanel('team'); } else { setEditingWorker(worker); setPanel('worker'); } }}>{team ? t('Thiết lập nhóm') : t('Đổi model')}</button></p> : missingConnections.length > 0 ? <p className="composer-note">{t('Cần kết nối trước khi gửi.')}<button onClick={() => openSettings(settingsTabFor(missingConnections))}>{missingConnections.map(provider => setupHint(provider, harnesses)).join(t(' và '))}</button></p> : paidProviders.length === 0 && nativeProviders.length > 0 ? <p className="composer-note">{t('Harness trên máy · chi phí theo gói của công cụ, không qua Orglet.')}</p> : null;
  return <div className={`app ${sidebar ? '' : 'sidebar-hidden'}`}>
    <a className="skip-link" href="#main-content">{t('Đến nội dung chính')}</a>
    {sidebar && <aside className="sidebar" aria-label={t('Điều hướng')}>
      <div className="brand"><span className="orglet-mark">o</span><strong>Orglet</strong><Button size="icon" aria-label={t('Tìm công việc (Ctrl K)')} aria-haspopup="dialog" onClick={() => setSearchOpen(true)}><Search size={18} /></Button><Button size="icon" aria-label={t('Thu gọn sidebar')} onClick={() => setSidebar(false)}><PanelLeft size={18} /></Button></div>
      <Button className="new-task-row" aria-label={t('Công việc mới')} aria-keyshortcuts="Control+N" onClick={newTask}><SquarePen size={17} aria-hidden="true" /><span>{t('Công việc mới')}</span><kbd className="shortcut" aria-hidden="true">Ctrl+N</kbd></Button>
      <div className="sidebar-scroll">
      
      <SidebarSection id="teams" title={t('Nhóm')} action={<Button size="icon" className="row-action" aria-label={t('Tạo nhóm')} onClick={() => { setEditingTeam(undefined); setPanel('team'); }}><Plus size={16} /></Button>}>
        {teamOrder.order.map(id => workspace.teams.find(team => team.id === id)).filter((item): item is Team => Boolean(item)).map(item => <SidebarTreeRow key={item.id} id={`team-${item.id}`} name={item.name} avatar={<Avatar name={item.name} seed={item.id} size="sm" />} active={teamId === item.id && (!selected || selected === liveTeamTask(workspace.tasks, item.id)?.id)} status={teamStatus(item)} onSelect={() => openTeam(item.id)} expandOnSelect reorder={teamOrder.bind(item.id)} expandLabel={t('Xem nhân viên của {0}', [item.name])}
          menu={<RowMenu label={t('Tùy chọn nhóm {0}', [item.name])} items={[{ label: t('Chỉnh sửa'), icon: Pencil, onSelect: () => { setEditingTeam(item); setPanel('team'); } }, { label: t('Xuất template'), icon: Download, onSelect: () => action(() => orglet.exportTemplate(item.id)) }, { label: t('Lưu trữ'), icon: Archive, onSelect: () => archiveEntity('team', item.id, true) }, { label: t('Xóa'), icon: Trash2, danger: true, onSelect: () => deleteEntity('team', item.id), confirm: { question: t('Xóa {0}? Công việc cũ vẫn giữ lịch sử.', [item.name]), label: t('Xóa') } }]} />}>
          <ShowMore items={teamRoster(item, workspace.workers)} empty={t('Nhóm chưa có nhân viên.')} render={member => {
            const mark = workerStatus(member.id);
            return <div key={member.id} className="tree-leaf roster"><StatusMark variant={mark.variant} tone={mark.tone} label={statusMarkLabel(mark)} decorative /><Avatar name={member.name} seed={member.id} emoji={member.avatar?.emoji} mascot={member.avatar?.mascot} defaultMascot hint={member.description} color={member.avatar?.color} size="xs" badge={member.provider === 'demo' ? undefined : <ProviderMark provider={member.provider} size="small" decorative />} /><span className="row-name">{member.name}</span>{member.id === item.synthesizerId && <small>{t('tổng hợp')}</small>}</div>;
          }} />
        </SidebarTreeRow>)}{!workspace.teams.length && <p className="empty-history">{t('Chưa có nhóm.')}</p>}
        <ArchivedList count={workspace.archivedTeams.length}>{workspace.archivedTeams.map(item => <ArchivedRow key={item.id} name={item.name} mark={<Avatar name={item.name} seed={item.id} size="xs" />} archive={archiveState(item)!} onRestore={() => archiveEntity('team', item.id, false)} onDelete={() => deleteEntity('team', item.id)} />)}</ArchivedList>
      </SidebarSection>
      <SidebarSection id="workers" title={t('Nhân viên')} action={<Button size="icon" className="row-action" aria-label={t('Tạo nhân viên')} onClick={() => { setEditingWorker(undefined); setPanel('worker'); }}><Plus size={16} /></Button>}>
        {workerOrder.order.map(id => workspace.workers.find(worker => worker.id === id)).filter((item): item is Worker => Boolean(item)).map(item => <SidebarTreeRow key={item.id} id={`worker-${item.id}`} name={item.name} description={item.description} avatar={<Avatar name={item.name} seed={item.id} emoji={item.avatar?.emoji} mascot={item.avatar?.mascot} defaultMascot hint={item.description} color={item.avatar?.color} size="sm" badge={item.provider === 'demo' ? undefined : <ProviderMark provider={item.provider} size="small" decorative />} />} active={!teamId && workerId === item.id} status={workerStatus(item.id)} reorder={workerOrder.bind(item.id)} onSelect={() => { setWorkerId(item.id); setTeamId(''); }} expandLabel={t('Xem công việc của {0}', [item.name])}
          menu={<RowMenu label={t('Tùy chọn {0}', [item.name])} items={[{ label: t('Chỉnh sửa'), icon: Pencil, onSelect: () => { setEditingWorker(item); setPanel('worker'); } }, { label: t('Lưu trữ'), icon: Archive, onSelect: () => archiveEntity('worker', item.id, true) }, { label: t('Xóa'), icon: Trash2, danger: true, onSelect: () => deleteEntity('worker', item.id), confirm: { question: t('Xóa {0}? Công việc cũ vẫn giữ lịch sử.', [item.name]), label: t('Xóa') } }]} />}>
          <ShowMore items={workspace.tasks.filter(task => !task.archivedAt && !task.teamId && taskWorkers(task, workspace).some(worker => worker.id === item.id))} empty={t('Chưa có công việc.')} render={task => taskRow(task, true)} />
        </SidebarTreeRow>)}{!workspace.workers.length && <p className="empty-history">{t('Chưa có nhân viên.')}</p>}
        <ArchivedList count={workspace.archivedWorkers.length}>{workspace.archivedWorkers.map(item => <ArchivedRow key={item.id} name={item.name} mark={<Avatar name={item.name} seed={item.id} mascot={item.avatar?.mascot} defaultMascot hint={item.description} color={item.avatar?.color} size="xs" />} archive={archiveState(item)!} onRestore={() => archiveEntity('worker', item.id, false)} onDelete={() => deleteEntity('worker', item.id)} />)}</ArchivedList>
      </SidebarSection>
      <SidebarSection id="recent" title={t('Công việc')} as="nav" label={t('Tất cả công việc')} className="history" action={<Button size="icon" className="row-action" aria-label={t('Tạo công việc')} onClick={newTask}><Plus size={16} /></Button>}>
        {workspace.tasks.filter(task => !task.archivedAt).map(task => taskRow(task))}
        {!workspace.tasks.some(task => !task.archivedAt) && <p className="empty-history">{t('Công việc bạn giao sẽ ở đây.')}</p>}
        <ArchivedList count={workspace.tasks.filter(task => task.archivedAt).length}>{workspace.tasks.filter(task => task.archivedAt).map(task => taskRow(task))}</ArchivedList>
      </SidebarSection>
      </div>
      <div className="sidebar-footer"><Button onClick={() => openRoutines()}><CalendarClock size={18} />{t('Lịch chạy')}{workspace.routines.some(item => item.pending) && <span className="badge">{t('Cần xem')}</span>}</Button><Button onClick={() => { if (workspace.knowledge.some(item => item.status === 'proposed')) setLibraryTab('knowledge'); setPanel('library'); }}><BookOpen size={18} />{t('Thư viện')}{workspace.knowledge.some(item => item.status === 'proposed') && <span className="badge">{t('Cần duyệt')}</span>}</Button><Button onClick={() => openSettings()}><Settings2 size={18} />{t('Cài đặt')}<span className={`connection-dot ${connections.openai || connections.anthropic || connections.xai ? 'connected' : ''}`} /></Button></div>
    </aside>}
    {/* Collapsed sidebar keeps its two most used actions in a narrow rail, stacked like ChatGPT. */}
    {!sidebar && <nav className="sidebar-rail" aria-label={t('Thanh bên thu gọn')}><Button size="icon" aria-label={t('Mở sidebar')} title={t('Mở sidebar')} onClick={() => setSidebar(true)}><PanelLeft size={20} /></Button><Button size="icon" aria-label={t('Công việc mới')} aria-keyshortcuts="Control+N" title={t('Công việc mới (Ctrl+N)')} onClick={newTask}><SquarePen size={19} /></Button><Button size="icon" aria-label={t('Tìm công việc (Ctrl K)')} aria-keyshortcuts="Control+K" aria-haspopup="dialog" title={t('Tìm công việc (Ctrl K)')} onClick={() => setSearchOpen(true)}><Search size={19} /></Button></nav>}
    <main className="main-pane" id="main-content" tabIndex={-1}>
      <header className="topbar">
        <div>
          <span>{selected ? (detail && assigneeLabel(detail.task, workspace, { all: t('Toàn bộ nhân viên'), many: count => t('{0} nhân viên', [count]) })) ?? team?.name ?? t('Công việc') : team?.name ?? worker?.name ?? 'Orglet'}</span>
          {team && <span className="topbar-roster" title={roster.map(member => member.name).join(', ')}><RosterAvatars workers={roster} /></span>}
          {(selected ? detail?.runs.every(run => run.snapshot.worker.provider === 'demo') : isDemo) && <span className="badge">Demo</span>}
        </div>
        <div className="topbar-actions">
          {selected && detail && openTaskPaid && <span className="task-cost" role="status" title={detail.usage.reservedMicros > 0 ? t('Đã dùng {0} / {1} · đang giữ chỗ {2}', [formatMoney(detail.usage.chargedMicros), formatMoney(detail.task.budgetMicros), formatMoney(detail.usage.reservedMicros)]) : t('Đã dùng {0} / {1}', [formatMoney(openTaskUsed), formatMoney(detail.task.budgetMicros)])}><Wallet size={14} aria-hidden="true" />{t('Đã dùng {0} / {1}', [formatMoney(openTaskUsed), formatMoney(detail.task.budgetMicros)])}</span>}
          {selected && <Button onClick={() => setPanel('activity')}><SlidersHorizontal size={17} />{t('Chi tiết')}</Button>}
        </div>
      </header>
      {error && <div className="error-banner" role="alert"><span>{error}</span><Button size="icon" aria-label={t('Đóng thông báo')} onClick={() => setError('')}><X size={16} /></Button></div>}
      {catchUpNotice && <div className="notice-banner" role="status"><CalendarClock size={16} aria-hidden="true" /><div><p>{singleCatchUp ? t('{0} đã bỏ qua lần chạy vì app tắt hoặc máy ngủ. Lịch không mất. Bạn có thể chạy bù một lần hoặc bỏ qua.', [singleCatchUp.name]) : t('{0} lịch đã bỏ qua lần chạy vì app tắt hoặc máy ngủ. Lịch không mất. Mỗi lịch chỉ chạy bù một lần.', [pendingCatchUp.length])}</p><div className="actions">{singleCatchUp?.enabled && <Button variant="primary" onClick={() => action(async () => openTask(await orglet.call('catchUpRoutine', { id: singleCatchUp.id })))}>{t('Chạy bù một lần')}</Button>}<Button onClick={() => openRoutines()}>{t('Xem lịch chạy')}</Button></div></div><Button size="icon" aria-label={t('Đóng thông báo lịch bị lỡ')} onClick={() => setDismissedCatchUpNotice(catchUpNoticeKey)}><X size={16} /></Button></div>}
      {selected ? <>{detail ? <><FormatPreferences.Provider value={{ copy: workspace.copyFormat, download: workspace.downloadFormat }}><TaskThread key={selected} detail={detail} action={action} showSources={openSources} proposals={workspace.knowledge.filter(item => item.status === 'proposed' && item.provenance.kind === 'run' && item.provenance.taskId === selected)} openKnowledge={openKnowledge} /></FormatPreferences.Provider><FollowUpComposer key={`follow:${selected}`} detail={detail} workspace={workspace} ready={ready} openRevision={() => setPanel('revision')} openSettings={tab => openSettings(tab ?? 'connections')} action={action} /></> : <div className="loading" role="status">{t('Đang mở công việc…')}</div>}</> : team ? <div className="team-chat">
        <div className="thread-scroll">
          <div className="thread-content team-chat-empty">
            <RosterAvatars workers={roster} size="sm" />
            <h1 className="welcome">{t('Đang nhắn với {0}', [team.name])}</h1>
            <p className="muted" aria-label={t('Nhân viên của {0}', [team.name])}>{roster.map(member => member.name).join(', ')}</p>
          </div>
        </div>
        <div className="thread-composer">
          {composerBar}
          {composerHint}
          {skippedSources.length > 0 && <details className="intake-skipped"><summary>{t('{0} mục không được thêm vào task', [skippedSources.length])}</summary><ul>{skippedSources.map((item, index) => <li key={index}>{item.name}: {item.reason}</li>)}</ul></details>}
        </div>
      </div> : <div className="new-task-content">
        <h1 className="welcome">{t('Bạn muốn giao việc gì?')}</h1>
        {composerBar}
        {composerHint}
        {skippedSources.length > 0 && <details className="intake-skipped"><summary>{t('{0} mục không được thêm vào task', [skippedSources.length])}</summary><ul>{skippedSources.map((item, index) => <li key={index}>{item.name}: {item.reason}</li>)}</ul></details>}
        <ul className="suggestions" aria-label={t('Gợi ý')}>
          <li><button type="button" onClick={() => { setBrief(t('Đọc các tài liệu đã chọn, tóm tắt những điểm chính và chỉ rõ phần còn thiếu bằng chứng.')); composer.current?.focus(); }}><BookOpen size={18} />{t('Tóm tắt tài liệu')}</button></li>
          <li><button type="button" onClick={() => { setBrief(t('Review các tệp đã chọn. Tìm vấn đề có bằng chứng, nêu phạm vi đã kiểm tra và các giới hạn. Không thực thi code.')); composer.current?.focus(); }}><Sparkles size={18} />{t('Review có bằng chứng')}</button></li>
          <li><button type="button" disabled={!brief.trim()} title={brief.trim() ? undefined : t('Viết nội dung công việc trước')} onClick={() => { setRoutineDraft({ workerId, brief, sourceIds: sources.map(source => source.id), excludedSources: skippedSources, consent: false, providerScopes: [], budgetMicros: taskBudgetMicros }); setRoutineView({ editing: true }); setPanel('routines'); }}><CalendarClock size={18} />{t('Lên lịch cho công việc này')}</button></li>
        </ul>
      </div>}
      <footer className="main-footer">{t('Orglet không đảm bảo câu trả lời luôn chính xác. Hãy kiểm chứng với nguồn gốc trước khi dùng.')}</footer>
    </main>
    <Drawer open={panel !== null && !['settings', 'worker', 'team', 'task'].includes(panel)} onClose={() => panel === 'routines' ? void leaveRoutine(close) : close()} description={panel === 'routines' && !routineView.editing ? t('Chỉ chạy khi Orglet đang mở. Máy tắt không làm lịch biến mất: các lần lỡ gộp thành một lần chạy bù.') : panel === 'library' ? (libraryTab === 'skills' ? t('Hướng dẫn dùng lại được. Gói nhập từ thư mục cần được review trước khi gắn cho nhân viên.') : t('Ghi chú dùng lại được. Chỉ mục đã duyệt mới được nạp vào context, và chỉ trong phạm vi đã chọn.')) : undefined} actions={panel === 'routines' && !routineView.editing ? <Button variant="outline" onClick={() => setRoutineView({ editing: true })}><CalendarClock size={16} />{t('Tạo lịch')}</Button> : undefined} title={panel === 'revision' ? t('Đính kèm tệp') : panel === 'routines' ? (routineView.editing ? <span className="breadcrumb"><Button size="icon" aria-label={t('Quay lại danh sách lịch')} onClick={() => void leaveRoutine(() => setRoutineView({ editing: false }))}><ArrowLeft size={18} /></Button><button type="button" className="breadcrumb-link" onClick={() => void leaveRoutine(() => setRoutineView({ editing: false }))}>{t('Lịch chạy')}</button><ChevronRight size={15} aria-hidden="true" className="breadcrumb-separator" /><span aria-current="page">{routineView.routine ? routineView.routine.name : t('Lịch mới')}</span></span> : t('Lịch chạy')) :panel === 'skill' ? editingSkill?.package ? 'Review skill' : t('Chỉnh skill') : panel === 'knowledge' ? editingKnowledge ? 'Knowledge' : t('Knowledge mới') : panel === 'library' ? t('Thư viện') : panel === 'sources' ? t('Nguồn của công việc') : t('Chi tiết công việc')}>
      {panel === 'revision' && detail && <RevisionEditor key={`${detail.task.id}:${detail.task.inputRevision ?? 0}`} detail={detail} workspace={workspace} connections={ready} done={close} />}
      {panel === 'routines' && <RoutinesPanel workspace={workspace} draft={routineDraft} view={routineView} onView={setRoutineView} onDirty={markRoutineDirty} onBack={() => void leaveRoutine(() => setRoutineView({ editing: false }))} openTask={id => { openTask(id); close(); }} />}
      
      {panel === 'skill' && <SkillEditor key={editingSkill?.id ?? 'new'} skill={editingSkill} done={close} />}
      {panel === 'library' && <div className="form">
        <div className="tab-row"><div className="tabs" role="tablist" aria-label={t('Thư viện')} onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const next = libraryTab === 'skills' ? 'knowledge' : 'skills'; setLibraryTab(next); document.getElementById(`library-tab-${next}`)?.focus(); }}>{(['skills', 'knowledge'] as const).map(tab => <Button key={tab} id={`library-tab-${tab}`} role="tab" aria-selected={libraryTab === tab} aria-controls="library-panel" tabIndex={libraryTab === tab ? 0 : -1} onClick={() => setLibraryTab(tab)}>{tab === 'skills' ? 'Skills' : 'Knowledge'}<span className="tab-count" aria-hidden="true">{tab === 'skills' ? workspace.skills.length : workspace.knowledge.filter(item => item.status !== 'archived').length}</span></Button>)}</div>
          <div className="tab-row-actions">{libraryTab === 'skills' ? <SkillLibraryActions onOpen={skill => { setEditingSkill(skill); setPanel('skill'); }} /> : <Button variant="outline" onClick={() => openKnowledge()}><Plus size={16} />{t('Tạo knowledge')}</Button>}</div></div>
        <div id="library-panel" role="tabpanel" aria-labelledby={`library-tab-${libraryTab}`}>{libraryTab === 'skills' ? <SkillLibrary skills={workspace.skills} onOpen={skill => { setEditingSkill(skill); setPanel('skill'); }} /> : <KnowledgeLibrary workspace={workspace} onOpen={openKnowledge} />}</div>
      </div>}
      {panel === 'knowledge' && <KnowledgeEditor key={editingKnowledge ? `${editingKnowledge.id}:${editingKnowledge.revision}` : 'new'} item={editingKnowledge} workspace={workspace} done={close} />}
      {panel === 'activity' && detail && <div className="form"><p>{statusLabel[detail.task.status]}</p>{detail.runs.map(run => <section key={run.id}><h3>{run.snapshot.worker.name} · v{run.snapshot.worker.revision}</h3><p className="muted">Skill v{run.snapshot.skill.revision} · {run.snapshot.worker.provider}</p><code className="hash">{run.id}</code><p className="muted">{run.snapshot.model}</p>{detail.artifacts.filter(artifact => artifact.runId === run.id).map(artifact => <details key={artifact.id}><summary>{t('{0} · xem báo cáo', [tMessage(artifact.report.title)])}</summary><p className="prose">{tMessage(artifact.report.summary)}</p>{artifact.report.findings.map((finding, index) => <section key={index}><h4>{finding.title}</h4><p className="prose">{finding.detail}</p><p className="muted">{finding.coverage}</p></section>)}<ul>{artifact.report.limitations.map((limitation, index) => <li key={index}>{tMessage(limitation)}</li>)}</ul><Button onClick={() => action(() => orglet.exportArtifact(artifact.id))}>{t('Xuất báo cáo này')}</Button></details>)}<ContextManifestView run={run} workspace={workspace} /><ol className="activity">{detail.events.filter(event => event.runId === run.id).map(event => <li key={event.id}><time>{new Date(event.createdAt).toLocaleTimeString(currentLocale())}</time><span>{tMessage(event.message)}</span></li>)}</ol></section>)}<Button variant="outline" onClick={() => openSources()}><FileText size={16} />{t('Xem nguồn')}</Button></div>}
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