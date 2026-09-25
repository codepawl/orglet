import { RevisionEditor } from './components/RevisionEditor';
import { SkillLibrary, SkillLibraryActions } from './components/SkillReview';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
// The sidebar draws Orglet's own icons; the rest of this file stays on lucide until the sweep (the Lucide* aliases mark what is left).
import { Activity, Bell, Archive, BookOpen, CalendarClock, Check, Download, EllipsisVertical, PanelLeft, Pencil, Plus, Search, Settings, Trash, X as SidebarX } from './components/icons';
import { ArrowLeft, ChevronRight, Pencil as LucidePencil, Plus as LucidePlus, SlidersHorizontal, CalendarClock as LucideCalendarClock, Wallet, X, Archive as LucideArchive, ArchiveRestore, Trash2, MessagesSquare } from 'lucide-react';
import { emptyConnections, isPaidApi, MAX_CREW_MEMBERS, type Connections, type FolderIntake, type Skill, type Source, type Task, type TaskDetail, type Worker, type Workspace, type Team, type TaskInput } from '../shared/contracts';
import { Button, Drawer } from './components/ui';
import { SkillEditor } from './components/Editors';
import { WorkerDialog } from './components/WorkerDialog';
import { SettingsDialog, type SettingsTab } from './components/SettingsDialog';
import { TaskThread } from './components/TaskThread';
import { focusMessage } from './components/messageMarks';
import { SourcePanel, type SourceTarget } from './components/SourcePanel';
import { SourceDialog } from './components/SourceViewer';
import { TeamDialog } from './components/TeamEditor';
import { TaskDialog } from './components/TaskDialog';
import { FormatPreferences } from './components/FormatAction';
import { assigneeLabel, taskWorkers, teamRoster } from './assignees';
import { liveChatOf as mainChatOf, liveChatToAdopt, liveTeamTask, liveWorkerTask, newChatKey } from '../shared/live-task';
import type { OpenChatTarget } from '../shared/cli';
import { ArchivedList, ArchivedRow, type ArchiveState } from './components/SidebarTree';
import { RoutinesPanel, type RoutineView } from './components/RoutinesPanel';
import { Confirmer, confirmAction } from './components/confirm';
import { SourcePicker } from './components/SourcePicker';
import { Composer, FollowUpComposer, withPrefill, type ComposerPrefill } from './components/Composer';
import { SidebarSection } from './components/SidebarSection';
import { Avatar, RosterAvatars } from './components/Avatar';
import { rememberCustomConnections } from './customConnections';
import { Startup } from './components/Startup';
import { Starters } from './components/Starters';
import { DetailsPanel } from './components/DetailsPanel';
import type { WorkspaceRecoveryView } from '../shared/workspace-recovery';
import type { RecoveryFocus } from './components/WorkspaceRecovery';
import { suggestStarters } from '../shared/starters';
import { accentInk, DEFAULT_ACCENT_COLOR } from '../shared/accent';
import { fontStack } from '../shared/fonts';
import { ProviderMark } from './components/ProviderMark';
import { SideThreadRow, SidebarTreeRow, ShowMore, useReorder } from './components/SidebarTree';
import { sideThreadsOf } from '../shared/side-threads';
import { useSideThreadNotices } from './sideThreadNotices';
import { SearchDialog } from './components/SearchDialog';
import { SendToPicker } from './components/SendToPicker';
import { sendToOptions, type SendToOption } from './sendTo';
import { attachIntake, carriedDraft, type Incoming, type IncomingChat, type IncomingFiles } from '../shared/incoming';
import { tasksStatusMark, rollupStatusMarks, taskStatusMark, type StatusMarkState } from './components/StatusMark';
import { taskResultSeen } from '../shared/task-seen';
import { RowMenu } from './components/RowMenu';
import { Select } from './components/Select';
import { setDisplayCurrency, formatMoney } from './components/money';
import { Toaster, toast } from './components/toast';
import { NoticeCentre } from './components/NoticeCentre';
import { RunningCentre } from './components/RunningCentre';
import { watchRunProgress } from './runProgress';
import { runningCount } from '../shared/running';
import { recordNotice, useUnreadNotices } from './components/notifications';
import { KnowledgeEditor, KnowledgeLibrary } from './components/KnowledgeLibrary';
import type { Knowledge } from '../shared/knowledge';
import type { HarnessInfo } from '../shared/harness';
import { hasConnection, providerLabel, readiness, settingsTabFor, setupHint } from './components/providers';
import { workerModelLabel, providerName } from './components/workerModel';
import { usePaneWidth, shellGap } from './usePaneWidth';
import { ComposerModel } from './components/ComposerModel';
import { t, tMessage, setLanguage, useLanguage } from './i18n';
import { orglet } from './api';
import { useAppChangeNotices } from './appChangeNotices';
import type { NewChatTarget, WorkspaceGrantView } from '../shared/workspace-access';
import { snapshotCapabilities, type ToolCapability } from '../shared/tool-policy';
import { permissionsForLevel, type WorkspaceLevel } from '../shared/capability-status';
import { appView, createHistory, recordView, replaceView, stepHistory, useNavigationInput, viewKey, type AppView, type NavigationDirection, type NavigationHistory } from './navigation';
import { noSelection, pruneSelection, selectRange, toggleSelection, type SelectionPickMode, type SidebarSelection, type SidebarSelectionSection } from './sidebarSelection';
import { groupChatFromRecipient, groupChatFromSelection, groupChatKey, groupChatNames, groupChatRecipient, groupChatTaskInput, isGroupChatTask, pruneGroupChat, type PendingGroupChat } from './groupChat';
import type { AppProposal, ProposalTarget } from '../shared/app-proposals';
import { proposedMascot, type ProposalActions } from './components/AppProposals';
import { EditableText, Skeleton, SkeletonGroup } from '@codepawl/orglet-ui';
import { dwellAbout, dwellChat, dwellModels, followWorkspace, taskDetails } from './caches';
import { dwellHandlers } from './prefetch';

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

/**
 * The shape of a conversation while its detail is on the way. A sentence on an empty page made the app look like
 * it had stopped; blocks where the message and the answer are about to be say the same thing without the wait
 * reading as a fault (user, 2026-09-20). The sentence stays for screen readers, which cannot see a shape. With
 * chats prefetched on hover and kept once opened (COD-218), this is only ever seen on a chat reached some other way.
 */
/** Up to this many faces greet an empty crew or group chat at full size; more take a size down so eight fit on one line. */
const BIG_FRESH_FACES = 4;

function freshFaceSize(count: number): 'xl' | 'lg' {
  return count > BIG_FRESH_FACES ? 'lg' : 'xl';
}

function ThreadSkeleton() {
  return <SkeletonGroup className="thread-skeleton" label={t('Đang mở cuộc trò chuyện…')}>
    <div className="thread-skeleton-ask"><Skeleton shape="block" className="thread-skeleton-bubble" /></div>
    <div className="thread-skeleton-reply">
      <Skeleton shape="circle" className="thread-skeleton-face" />
      <div><Skeleton width="92%" /><Skeleton width="78%" delay={0.08} /><Skeleton width="46%" delay={0.16} /></div>
    </div>
  </SkeletonGroup>;
}

type Panel = 'task' | 'revision' | 'routines' | 'settings' | 'worker' | 'team' | 'library' | 'skill' | 'knowledge' | 'activity' | 'sources' | null;
export function App() {
  useLanguage();
  const [workspace, setWorkspace] = useState<Workspace>(); const [connections, setConnections] = useState<Connections>(emptyConnections());
  // Undefined until the first detection finishes: it runs each CLI and takes about three seconds cold, so nothing waits on it.
  const [harnesses, setHarnesses] = useState<HarnessInfo[]>();
  const [selected, setSelected] = useState<string | null>(null); const [detail, setDetail] = useState<TaskDetail>();
  // Chats opened this session keep their last detail in `taskDetails`, and a sidebar row prefetches its chat while
  // the pointer rests on it (COD-198, COD-218), so opening shows the kept copy at once instead of a blank pane
  // while the fresh copy loads. The fresh copy replaces it as soon as it arrives.
  const showingCachedDetail = useRef<string | null>(null);
  const [workspaceAccess, setWorkspaceAccess] = useState<{ taskId: string; grant: WorkspaceGrantView | null }>();
  const [workspaceRecovery, setWorkspaceRecovery] = useState<WorkspaceRecoveryView>();
  // The attempt the chat asked to review (COD-191); `at` changes on every request so the same row scrolls again.
  const [recoveryFocus, setRecoveryFocus] = useState<RecoveryFocus>();
  const [toolPolicyBusy, setToolPolicyBusy] = useState(false);
  const [workerId, setWorkerId] = useState(''); const [brief, setBrief] = useState(''); const [sources, setSources] = useState<Source[]>([]);
  const [skippedSources, setSkippedSources] = useState<{ name: string; reason: string }[]>([]);
  // What Explorer's Send to menu and orglet:// links sent (COD-246): files waiting for a chat, files headed for the
  // next message of a chat that already has one, and a link's text for such a chat's message bar.
  const [sentFiles, setSentFiles] = useState<IncomingFiles>();
  const [revisionIntake, setRevisionIntake] = useState<{ taskId: string; intake: FolderIntake; text?: string; at: number }>();
  const [followUpPrefill, setFollowUpPrefill] = useState<ComposerPrefill & { taskId: string }>();
  const pendingIncoming = useRef<Incoming[]>([]);
  const [incomingCount, setIncomingCount] = useState(0);
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
  // One source per dialog (user, 2026-09-21): a file opens in its own viewer; the panel lists the chat's files and holds the checkers.
  const [viewingSource, setViewingSource] = useState<{ id: string; lines?: [number, number] }>();
  // Chat details list the team behind a team chat; a worker chat has none.
  const detailTeam = detail ? workspace?.teams.find(team => team.id === detail.task.teamId) : undefined;
  const openSources = (target?: SourceTarget) => {
    if (target?.type === 'source') { setViewingSource({ id: target.id, lines: target.lines }); return; }
    setSourceTarget(target); setPanel('sources');
  };
  
  const [panel, setPanel] = useState<Panel>(null); const [editingWorker, setEditingWorker] = useState<Worker>(); const [workerDialogTab, setWorkerDialogTab] = useState<'memory'>(); const [editingTask, setEditingTask] = useState<string>(); const [editingSkill, setEditingSkill] = useState<Skill>();
  const [editingKnowledge, setEditingKnowledge] = useState<Knowledge>(); const [libraryTab, setLibraryTab] = useState<'skills' | 'knowledge'>('skills');
  // An editor opened from the Library offers the way back to it. One opened from a chat's knowledge proposal does not:
  // "back" would lead somewhere the user never was.
  const [fromLibrary, setFromLibrary] = useState(false);
  const openKnowledge = (item?: Knowledge) => { setFromLibrary(false); setEditingKnowledge(item); setPanel('knowledge'); };
  const openLibraryKnowledge = (item?: Knowledge) => { setFromLibrary(true); setEditingKnowledge(item); setPanel('knowledge'); };
  const openLibrarySkill = (skill?: Skill) => { setFromLibrary(true); setEditingSkill(skill); setPanel('skill'); };
  const backToLibrary = () => setPanel('library');
  /** The breadcrumb the schedules editor uses, pointing back at the Library. */
  const libraryTitle = (current: string) => fromLibrary
    ? <span className="breadcrumb">
      <button type="button" className="breadcrumb-link" onClick={backToLibrary}>{t('Thư viện')}</button>
      <ChevronRight size={15} aria-hidden="true" className="breadcrumb-separator" />
      <span aria-current="page">{current}</span>
    </span>
    : current;
  /**
   * The way back out of an editor, drawn beside the close button rather than in front of the title (user,
   * 2026-09-23): the two ways out of the panel sit together, and the title reads as a path, not a control.
   */
  const drawerBack = panel === 'routines' && routineView.editing
    ? <Button size="icon" aria-label={t('Quay lại danh sách lịch')} onClick={() => void leaveRoutine(() => setRoutineView({ editing: false }))}><ArrowLeft size={18} /></Button>
    : (panel === 'skill' || panel === 'knowledge') && fromLibrary
      ? <Button size="icon" aria-label={t('Quay lại Thư viện')} onClick={backToLibrary}><ArrowLeft size={18} /></Button>
      : undefined;
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const openSettings = (tab: SettingsTab = 'general') => { setSettingsTab(tab); setPanel('settings'); };
  // Chat details sit in the shell next to the conversation, not over it.
  const detailsOpen = panel === 'activity';
  const detailsOpenRef = useRef(detailsOpen); detailsOpenRef.current = detailsOpen;
  // Several crews or orglets picked in the sidebar (COD-214), and the section whose edit button is in its Done
  // state. Both live here only: nothing is stored, and rows that leave the workspace leave the selection.
  const [selection, setSelection] = useState<SidebarSelection>(noSelection);
  const [selecting, setSelecting] = useState<SidebarSelectionSection | null>(null);
  const selectionActiveRef = useRef(false); selectionActiveRef.current = selection.section !== null || selecting !== null;
  const clearSelection = () => { setSelection(noSelection); setSelecting(null); };
  // The orglets an empty group chat is addressed to (COD-215). Renderer state only: the first message creates the
  // row, and leaving the empty chat drops the group, since nothing was created.
  const [groupChat, setGroupChat] = useState<PendingGroupChat>();
  useEffect(() => {
    if (!workspace) return;
    const listed = (section: SidebarSelectionSection) => (section === 'teams' ? workspace.teams : workspace.workers).map(item => item.id);
    setSelection(current => current.section ? pruneSelection(current, listed(current.section)) : current);
    setGroupChat(current => current ? pruneGroupChat(current, listed('workers')) : current);
  }, [workspace]);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [runningOpen, setRunningOpen] = useState(false);
  const unreadNotices = useUnreadNotices();
  useAppChangeNotices(workspace?.recentAppChanges);
  // A side thread that finishes while the person is elsewhere says so, with Open (COD-247).
  useSideThreadNotices(workspace?.tasks, selected, workerId => workspace?.workers.find(item => item.id === workerId)?.name, taskId => openTask(taskId));
  // Everything in the sidebar footer that waits for you reads the same way: a dot on the icon and a count (user, 2026-09-23).
  const pendingRoutines = workspace?.routines.filter(item => item.pending).length ?? 0;
  const knowledgeToReview = workspace?.knowledge.filter(item => item.status === 'proposed').length ?? 0;
  // Runs under way or in line (COD-244). A plain count, not the accent dot: nothing here waits for the person.
  const runningNow = runningCount(workspace?.running ?? []);
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
  // Where the user has been (COD-202). A view the app shows on its own, or one a step restored, rewrites the current
  // entry instead of adding one, so a step is only ever something the user did.
  const viewHistory = useRef<NavigationHistory<AppView> | undefined>(undefined);
  const replaceNextView = useRef(false);
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
  /** What was being done when the banner's error was set; the notice centre shows it under the message (COD-174). */
  const errorAbout = useRef<string | undefined>(undefined);
  /** How a chat is named in the sidebar: its title, or the first line of what was asked. */
  const taskName = (taskId: string) => {
    const task = workspace?.tasks.find(item => item.id === taskId);
    if (!task) return undefined;
    return task.title || task.brief.split('\n')[0].trim();
  };
  const entityName = (kind: 'worker' | 'team', entityId: string) => {
    if (!workspace) return undefined;
    const listed = kind === 'worker' ? [...workspace.workers, ...workspace.archivedWorkers] : [...workspace.teams, ...workspace.archivedTeams];
    return listed.find(item => item.id === entityId)?.name;
  };
  const refresh = useCallback(async () => {
    const requestId = ++refreshId.current;
    const selected = selectedRef.current;
    try {
      // Harness detection is cached after its first, slow run. Waiting for it here held every refresh — and so the first
      // settings change after launch — for about three seconds, so it lands on its own.
      void orglet.call('harnesses', { refresh: false }).then(setHarnesses).catch(() => undefined);
      // Everything a refresh needs goes out at once (COD-218): reading the open task before the workspace was a
      // waterfall on every change event. Its seen stamp is merged below from whichever copy is newer, so the
      // order the two land in does not matter.
      const [taskDetail, next, connectionState, grant, recovery] = await Promise.all([
        selected ? taskDetails.refresh(selected) : Promise.resolve(undefined),
        orglet.call('workspace', {}), orglet.connections(),
        selected ? orglet.call('workspaceAccess', { taskId: selected }) : Promise.resolve(null),
        selected ? orglet.call('workspaceRecovery', { taskId: selected }) : Promise.resolve(undefined)]);
      if (requestId !== refreshId.current) return;
      followWorkspace(next);
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
      if (taskDetail) showingCachedDetail.current = null;
      setWorkspace({ ...next, tasks }); setConnections(connectionState); setDetail(taskDetail); setWorkerId(value => value || next.workers[0]?.id || '');
      setWorkspaceAccess(selected ? { taskId: selected, grant } : undefined);
      setWorkspaceRecovery(recovery);
    } catch (err) { if (requestId === refreshId.current) { errorAbout.current = t('Đọc dữ liệu từ phần lõi'); setError((err as Error).message); } }
  }, []);
  useEffect(() => {
    if (!window.orglet) { setError(t('Mở Orglet bằng pnpm dev để dùng desktop core. Bản web không có quyền truy cập dữ liệu.')); return; }
    return orglet.onChange(() => void refresh());
  }, [refresh]);
  // Every run's live step, from launch, so the Running view shows what a run is doing even if it opens mid-run.
  useEffect(() => {
    if (!window.orglet) return;
    return watchRunProgress();
  }, []);
  // A downloaded update asks once, quietly: a notice that stays in the centre, and the restart button in
  // Settings → Giới thiệu. Nothing interrupts the chat, and Squirrel uses the new build on the next launch anyway (COD-176).
  useEffect(() => {
    if (!window.orglet) return;
    return orglet.onUpdate(state => {
      if (state.status !== 'ready') return;
      toast(state.version
        ? t('Orglet {0} đã tải xong. Khởi động lại từ Cài đặt → Giới thiệu.', [state.version])
        : t('Bản Orglet mới đã tải xong. Khởi động lại từ Cài đặt → Giới thiệu.'), 'success', t('Cập nhật'));
    });
  }, []);
  useEffect(() => { if (window.orglet) void refresh(); }, [refresh, selected]);
  useEffect(() => { setLanguage(workspace?.language); }, [workspace?.language]);
  useEffect(() => {
    if (!workspace) return;
    if (workerId && !workspace.workers.some(worker => worker.id === workerId)) setWorkerId(workspace.workers[0]?.id ?? '');
    if (teamId && !workspace.teams.some(team => team.id === teamId)) setTeamId('');
  }, [workspace, workerId, teamId]);
  // An error shown in the banner is also kept, so dismissing it does not lose it (user, 2026-09-20), together with
  // what was being done when it happened, which whoever set the error wrote into `errorAbout` first (COD-174).
  useEffect(() => { if (error) recordNotice(error, 'error', errorAbout.current); }, [error]);
  useEffect(() => { document.documentElement.dataset.theme = workspace?.theme ?? 'system'; }, [workspace?.theme]);
  // The accent is the user's to pick, so it rides on the root rather than being baked into the sheet. What sits on
  // top of it comes with it: a pale accent needs dark ink, or the send arrow disappears into its own button.
  useEffect(() => {
    const accent = workspace?.accentColor ?? DEFAULT_ACCENT_COLOR;
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-ink', accentInk(accent));
  }, [workspace?.accentColor]);
  // The brand mark's colour is the user's too (COD-154): the text colour, or the accent. It rides on the root so
  // every mark follows; before the workspace arrives there is nothing to read, so the startup mark stays monochrome.
  useEffect(() => { document.documentElement.dataset.logoColor = workspace?.logoColor ?? 'mono'; }, [workspace?.logoColor]);
  // Both fonts ride on the root the same way, so a change reaches every surface at once. A family the machine does
  // not have falls through to the bundled one, which is why the stack keeps it behind whatever was picked.
  useEffect(() => {
    document.documentElement.style.setProperty('--font', fontStack('interface', workspace?.interfaceFont));
    document.documentElement.style.setProperty('--font-mono', fontStack('code', workspace?.codeFont));
  }, [workspace?.interfaceFont, workspace?.codeFont]);
  useEffect(() => {
    const media = matchMedia('(max-width: 780px)');
    const collapse = () => { if (media.matches) setSidebar(false); };
    media.addEventListener('change', collapse); return () => media.removeEventListener('change', collapse);
  }, []);
  // The copy on screen is the one worth keeping: a handful of recent chats makes switching instant.
  useEffect(() => { if (detail) taskDetails.set(detail.task.id, detail); }, [detail]);
  const leaveThread = () => { setSelected(null); setDetail(undefined); setGroupChat(undefined); setBrief(''); setSources([]); setSkippedSources([]); setError(''); };
  const hideTaskLocally = (taskId: string, field: 'archivedAt' | 'deletedAt') => {
    const stamp = new Date().toISOString();
    setWorkspace(current => current ? { ...current, tasks: current.tasks.map(task => task.id === taskId ? { ...task, [field]: task[field] ?? stamp } : task) } : current);
  };
  // Re-opening the task already shown keeps its detail; clearing it would wait for a reload that never comes.
  const openTask = (id: string) => {
    if (id !== selected) {
      const cached = taskDetails.get(id);
      showingCachedDetail.current = cached ? id : null;
      setSelected(id);
      setDetail(cached);
    }
    setError('');
    setGroupChat(undefined);
    const opened = workspace?.tasks.find(task => task.id === id);
    if (opened?.teamId && !opened.routineId) setTeamId(opened.teamId);
    else {
      setTeamId('');
      if (opened && !opened.assignees) setWorkerId(opened.workerId);
    }
    // The thread only needs its own detail, so fetch it now instead of waiting for the refresh below, which also
    // reads the workspace and the connections before it hands anything back. A prefetch still on its way is
    // shared rather than repeated.
    void taskDetails.refresh(id).then((opened: TaskDetail) => {
      if (selectedRef.current !== id) return;
      const replacesCachedCopy = showingCachedDetail.current === id;
      showingCachedDetail.current = null;
      setDetail(current => current?.task.id === id && !replacesCachedCopy ? current : opened);
    }).catch(() => { /* the refresh below reports anything that is actually wrong */ });
    // Apply the returned stamp even after leaving — waiting for selected refresh drops the grey mark.
    void orglet.call('markTaskSeen', { id }).then((task: Task) => {
      if (task.seenStamp) rememberSeen(task.id, { seenStamp: task.seenStamp, lastArtifactId: task.lastArtifactId });
      if (selectedRef.current === id) void refresh();
    }).catch(err => { if (selectedRef.current === id) { errorAbout.current = taskName(id); setError((err as Error).message); } });
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
  /** The empty chat of several orglets at once (COD-215). Nothing is created until the first message is sent. */
  const openGroupChat = (group: PendingGroupChat) => {
    setTeamId('');
    leaveThread();
    setGroupChat(group);
    if (matchMedia('(max-width: 780px)').matches) setSidebar(false);
    setTimeout(() => composer.current?.focus(), 0);
  };
  const startGroupChatFromSelection = () => {
    const group = groupChatFromSelection(selection);
    if (!group) return;
    clearSelection();
    openGroupChat(group);
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        if (teamId) openTeam(teamId);
        else if (groupChat) composer.current?.focus();
        else if (workerId) openWorker(workerId);
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true); }
      // A dialog or menu that took this Escape has already prevented it; otherwise a sidebar selection goes first.
      if (event.key === 'Escape' && !event.defaultPrevented && selectionActiveRef.current) { event.preventDefault(); clearSelection(); return; }
      // The details panel is part of the page, not a dialog, so Escape has to close it here.
      if (event.key === 'Escape' && detailsOpenRef.current) { event.preventDefault(); setPanel(null); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [teamId, workerId, groupChat, workspace]);
  // First paint only: if this worker already has a live thread, show it so the empty composer cannot silently
  // reviseTask a hidden row. After the user archives or leaves, stay on the empty chat — re-running this from a
  // stale workspace would reopen the same thread and hide Thêm nguồn (desktop-smoke attach-sources after archive).
  useEffect(() => {
    if (!workspace || !workerId || bootedLiveThread.current) return;
    bootedLiveThread.current = true;
    if (selected || teamId) return;
    const live = liveWorkerTask(workspace.tasks, workerId);
    if (live) { replaceNextView.current = true; openTask(live.id); }
  }, [workspace, selected, teamId, workerId]);
  /** Runs one command and shows its failure in the banner; `about` names what it concerned for the notice centre. */
  const action = (fn: () => Promise<unknown>, about?: string) => {
    errorAbout.current = about;
    setError('');
    void fn().then(() => refresh()).catch(err => setError((err as Error).message));
  };
  const toolAction = (perform: () => Promise<unknown>) => {
    if (toolPolicyBusy) return;
    setToolPolicyBusy(true);
    setError('');
    void (async () => {
      try {
        await perform();
        await refresh();
      } catch (error) {
        setError((error as Error).message);
      }
      finally { setToolPolicyBusy(false); }
    })();
  };
  const toggledCapabilities = (previous: ToolCapability[], capability: ToolCapability, enabled: boolean) => {
    const capabilities = previous.filter(item => item !== capability);
    if (enabled) capabilities.push(capability);
    return capabilities;
  };
  const changeTaskCapability = (taskDetail: TaskDetail, capability: ToolCapability, enabled: boolean) => toolAction(() => {
    const provider = taskWorkers(taskDetail.task, workspace!)[0]?.provider ?? 'demo';
    const previous = taskDetail.task.toolCapabilities ?? snapshotCapabilities(provider);
    return orglet.call('setToolCapabilities', { taskId: taskDetail.task.id, capabilities: toggledCapabilities(previous, capability, enabled) });
  });
  /**
   * The app-change cards' buttons (COD-199). Apply runs the core command; a template proposal then needs a save
   * location, which only main can ask for, so the export dialog follows the apply. "Apply all" goes one by one in
   * order, because a later card may point at what an earlier one creates.
   */
  const [proposalBusy, setProposalBusy] = useState(false);
  const proposalWork = (perform: () => Promise<void>, about: string) => {
    if (proposalBusy) return;
    setProposalBusy(true);
    errorAbout.current = about;
    setError('');
    void perform().catch(err => setError((err as Error).message)).finally(() => { setProposalBusy(false); void refresh(); });
  };
  const applyProposal = async (proposal: AppProposal) => {
    const createsOrglet = proposal.kind === 'orglet' && proposal.action === 'create';
    const avatar = createsOrglet ? { mascot: proposedMascot(proposal) } : undefined;
    const applied = await orglet.call('applyAppProposal', { id: proposal.id, avatar });
    if (applied.target?.kind === 'template') {
      const saved = await orglet.exportTemplate(applied.target.id);
      toast(saved ? t('Đã lưu template') : t('Chưa lưu template. Xuất lại từ menu của hội khi cần.'), saved ? 'success' : 'error', proposal.title);
    }
  };
  const openProposalTarget = (target: ProposalTarget) => {
    if (!workspace) return;
    if (target.kind === 'worker') { const found = workspace.workers.find(item => item.id === target.id); if (found) { setEditingWorker(found); setPanel('worker'); } return; }
    if (target.kind === 'team' || target.kind === 'template') { const found = workspace.teams.find(item => item.id === target.id); if (found) { setEditingTeam(found); setPanel('team'); } return; }
    if (target.kind === 'skill') { const found = workspace.skills.find(item => item.id === target.id); if (found) { setFromLibrary(false); setEditingSkill(found); setPanel('skill'); } return; }
    if (target.kind === 'routine') { const found = workspace.routines.find(item => item.id === target.id); openRoutines(found ? { editing: true, routine: found } : { editing: false }); return; }
    openSettings('general');
  };
  const proposalActions: ProposalActions = {
    busy: proposalBusy,
    onApply: proposal => proposalWork(() => applyProposal(proposal), proposal.title),
    onApplyAll: proposals => proposalWork(async () => { for (const proposal of proposals) await applyProposal(proposal); }, t('Áp dụng tất cả ({0})', [proposals.length])),
    onDismiss: proposal => proposalWork(() => orglet.call('dismissAppProposal', { id: proposal.id }), proposal.title),
    onDismissAll: proposals => proposalWork(async () => { for (const proposal of proposals) await orglet.call('dismissAppProposal', { id: proposal.id }); }, t('Bỏ qua {0} Tí', [proposals.length])),
    onUndo: proposal => proposalWork(async () => { await orglet.call('undoAppProposal', { id: proposal.id }); }, proposal.title),
    onOpen: openProposalTarget,
    onOpenChat: openTask,
  };
  // Every label, mark and byline below names a custom connection from this list (COD-242).
  rememberCustomConnections(workspace?.customConnections);
  const worker = workspace?.workers.find(item => item.id === workerId);
  const team = workspace?.teams.find(item => item.id === teamId);
  // The group only stands while every orglet in it is still listed; the prune above drops it otherwise.
  const groupWorkers = groupChat ? groupChat.workerIds.map(id => workspace?.workers.find(item => item.id === id)).filter((item): item is Worker => Boolean(item)) : [];
  const group = groupChat && groupWorkers.length === groupChat.workerIds.length ? groupChat : undefined;
  const executionWorkers = team ? teamRoster(team, workspace!.workers) : group ? groupWorkers : worker ? [worker] : [];
  /**
   * An orglet's or crew's chat is its one live row. When that row starts somewhere other than this composer (the
   * `orglet` terminal command) while the empty chat is on screen, the view switches to it, so a question it asks,
   * such as an MCP approval (COD-241), is not left behind the empty screen. Only a row that appears while the empty
   * chat is shown is adopted; a chat that already existed when the view was entered, as at startup, is left alone.
   */
  const emptyChatBaseline = useRef<{ key: string; liveId?: string }>(undefined);
  /**
   * Switches to the live chat that appeared. Whatever the empty chat's message box held, typed, linked or sent from
   * Explorer, moves to that chat's next message instead of being dropped (COD-246): files open the next-message form
   * with the text, text alone goes into the message bar. A message being sent right now is not a draft.
   */
  const adoptLiveChat = (liveId: string) => {
    const carried = busy ? {} : carriedDraft({ text: brief, sources, skipped: skippedSources });
    openTask(liveId);
    if (!carried.text && !carried.intake) return;
    setBrief('');
    setSources([]);
    setSkippedSources([]);
    if (carried.intake) {
      setRevisionIntake({ taskId: liveId, intake: carried.intake, text: carried.text, at: Date.now() });
      setPanel('revision');
      return;
    }
    if (carried.text) setFollowUpPrefill({ taskId: liveId, text: carried.text, at: Date.now() });
  };
  useEffect(() => {
    const key = team ? `team:${team.id}` : worker ? `worker:${worker.id}` : '';
    if (selected || !workspace || group || !key) {
      emptyChatBaseline.current = undefined;
      return;
    }
    const chat = team ? { teamId: team.id } : { workerId: worker!.id };
    const baseline = emptyChatBaseline.current;
    if (!baseline || baseline.key !== key) {
      emptyChatBaseline.current = { key, liveId: mainChatOf(workspace.tasks, chat)?.id };
      return;
    }
    // A side thread appearing is never this chat (COD-247): only a new main chat is adopted, with the draft.
    const adopted = liveChatToAdopt(workspace.tasks, chat, baseline.liveId);
    if (adopted) adoptLiveChat(adopted);
  }, [workspace, selected, team?.id, worker?.id, group]);
  // An empty chat has no row yet, so its permissions wait under the worker, team or group until the first message
  // (COD-178, COD-215), and so does its working folder (COD-186).
  const newChatTarget: NewChatTarget | undefined = team ? { teamId: team.id } : group ? { workerIds: group.workerIds } : worker ? { workerId: worker.id } : undefined;
  const newChatCapabilities = newChatTarget ? workspace?.newChatCapabilities[newChatKey(newChatTarget)] : undefined;
  const newChatWorkspace = newChatTarget ? workspace?.newChatWorkspace[newChatKey(newChatTarget)] : undefined;
  const changeNewChatCapability = (capability: ToolCapability, enabled: boolean) => toolAction(() => {
    if (!newChatTarget) return Promise.resolve();
    const previous = newChatCapabilities ?? snapshotCapabilities(executionWorkers[0]?.provider ?? 'demo');
    const capabilities = toggledCapabilities(previous, capability, enabled);
    return orglet.call('setToolCapabilities', { ...newChatTarget, capabilities });
  });
  const changeNewChatWorkspace = (level: WorkspaceLevel) => toolAction(async () => {
    if (!newChatTarget) return;
    if (level === 'none') await orglet.call('revokeWorkspace', newChatTarget);
    else await orglet.pickNewChatWorkspace(newChatTarget, permissionsForLevel(level));
  });
  const nativeProviders = [...new Set(executionWorkers.map(item => item.provider).filter(provider => provider !== 'demo'))];
  const isDemo = nativeProviders.length === 0;
  const ready = readiness(connections, harnesses, workspace?.customConnections);
  const missingConnections = nativeProviders.filter(provider => !ready[provider]);
  // Choosing a model and attaching sources is the user's consent to send them; no separate permission step.
  // A group chat is budgeted like a chat with the orglet that owns its row, the first one picked.
  const taskBudgetMicros = (team ?? groupWorkers[0] ?? worker)?.taskBudgetMicros ?? 500_000;
  // A few names read at a glance; more than that is a count, as the header of an open group chat says it.
  const groupName = group ? groupChatNames(groupWorkers.map(item => item.name)) ?? t('{0} Tí', [groupWorkers.length]) : undefined;
  const unavailable = t('Chưa sẵn sàng');
  const recipientReady = (providers: Worker['provider'][]) => providers.every(provider => provider === 'demo' || ready[provider as keyof typeof ready]);
  const recipientValue = teamId ? `team:${teamId}` : group ? groupChatRecipient(group) : workerId;
  const pickRecipient = (value: string) => {
    if (value.startsWith('team:')) { openTeam(value.slice(5)); return; }
    openWorker(value);
  };
  /** The row the first message of this empty chat creates: a team's lead, the group's first orglet, or the worker. */
  const firstMessageInput = (message: Omit<TaskInput, 'workerId' | 'teamId' | 'assignees'>): TaskInput => {
    if (team) return { ...message, workerId: team.synthesizerId, teamId: team.id };
    if (group) return groupChatTaskInput(group, message);
    return { ...message, workerId };
  };
  const send = async () => {
    if (!brief.trim() || busy || (!team && !worker && !group)) return;
    setBusy(true); setError('');
    try {
      // A group chat has no live thread to continue: its first message always creates the row.
      const thread = team ? liveTeamTask(workspace!.tasks, team.id) : group ? undefined : liveWorkerTask(workspace!.tasks, workerId);
      if (thread) {
        await orglet.call('reviseTask', { taskId: thread.id, brief, sourceIds: sources.map(source => source.id), excludedSources: skippedSources, consent: true, providerScopes: nativeProviders, budgetMicros: thread.budgetMicros });
        setSelected(thread.id);
      } else {
        const id = await orglet.call('createTask', firstMessageInput({ brief, sourceIds: sources.map(source => source.id), excludedSources: skippedSources, consent: true, providerScopes: nativeProviders, budgetMicros: taskBudgetMicros }));
        setGroupChat(undefined);
        setSelected(id);
      }
      setBrief(''); setSources([]);
    } catch (err) { errorAbout.current = t('Gửi tin cho {0}', [team?.name ?? groupName ?? worker?.name ?? '']); setError((err as Error).message); } finally { setBusy(false); }
  };
  const close = () => { setPanel(null); setWorkerDialogTab(undefined); void refresh(); };
  /** The trace above an answer links to the worker's Memory tab (COD-220): the dialog opens on that tab this once. */
  const openWorkerMemories = (workerId: string) => {
    const found = workspace?.workers.find(item => item.id === workerId);
    if (!found) return;
    setWorkerDialogTab('memory');
    setEditingWorker(found);
    setPanel('worker');
  };
  const openRoutines = (view: RoutineView = { editing: false }) => { setRoutineDraft(undefined); setRoutineView(view); setPanel('routines'); };
  // Back and forward through what was opened (COD-202). The view is read off the state each render, so whatever
  // changed it is the step; a data refresh changes none of these fields and records nothing.
  const view = appView({ chat: selected, recipient: recipientValue, panel, settingsTab, libraryTab, fromLibrary, skillId: editingSkill?.id, knowledgeId: editingKnowledge?.id, workerId: editingWorker?.id, teamId: editingTeam?.id, taskId: editingTask, routineEditing: routineView.editing, routineId: routineView.editing ? routineView.routine?.id : undefined, noticesOpen, runningOpen, sourceId: viewingSource?.id });
  const viewId = viewKey(view);
  useEffect(() => {
    if (!workspace) return;
    if (!viewHistory.current) { viewHistory.current = createHistory(view, viewKey); return; }
    if (replaceNextView.current) { replaceNextView.current = false; viewHistory.current = replaceView(viewHistory.current, view); return; }
    viewHistory.current = recordView(viewHistory.current, view);
  }, [viewId, Boolean(workspace)]);
  /** A step is skipped when what it showed has since been deleted. */
  const viewExists = (target: AppView): boolean => {
    if (!workspace) return false;
    if (target.chat) return workspace.tasks.some(task => task.id === target.chat && !task.deletedAt);
    if (target.recipient) {
      const groupTarget = groupChatFromRecipient(target.recipient);
      const known = target.recipient.startsWith('team:') ? workspace.teams.some(item => `team:${item.id}` === target.recipient)
        : groupTarget ? groupTarget.workerIds.every(id => workspace.workers.some(item => item.id === id))
        : workspace.workers.some(item => item.id === target.recipient);
      if (!known) return false;
    }
    if (!target.item) return true;
    switch (target.panel) {
      case 'skill': return workspace.skills.some(item => item.id === target.item);
      case 'knowledge': return workspace.knowledge.some(item => item.id === target.item);
      case 'worker': return [...workspace.workers, ...workspace.archivedWorkers].some(item => item.id === target.item);
      case 'team': return [...workspace.teams, ...workspace.archivedTeams].some(item => item.id === target.item);
      case 'task': return workspace.tasks.some(item => item.id === target.item);
      case 'routines': return workspace.routines.some(item => item.id === target.item);
      default: return true;
    }
  };
  const showView = (target: AppView) => {
    if (!workspace) return;
    if (target.chat) { if (target.chat !== selected) openTask(target.chat); }
    else if (selected || target.recipient !== recipientValue) {
      // The empty chat of that worker, team or group; if a worker or team has a live thread by now, that thread
      // opens and the entry is rewritten. A group's empty chat is only its orglets, so it comes back as it was.
      const groupTarget = groupChatFromRecipient(target.recipient);
      if (target.recipient.startsWith('team:')) openTeam(target.recipient.slice('team:'.length));
      else if (groupTarget) openGroupChat(groupTarget);
      else if (target.recipient) openWorker(target.recipient);
      else leaveThread();
    }
    setPanel(target.panel as Panel);
    switch (target.panel) {
      case 'settings': setSettingsTab(target.tab as SettingsTab); break;
      case 'library': setLibraryTab(target.tab as 'skills' | 'knowledge'); break;
      case 'skill': setFromLibrary(Boolean(target.fromLibrary)); setEditingSkill(workspace.skills.find(item => item.id === target.item)); break;
      case 'knowledge': setFromLibrary(Boolean(target.fromLibrary)); setEditingKnowledge(workspace.knowledge.find(item => item.id === target.item)); break;
      case 'worker': setEditingWorker([...workspace.workers, ...workspace.archivedWorkers].find(item => item.id === target.item)); break;
      case 'team': setEditingTeam([...workspace.teams, ...workspace.archivedTeams].find(item => item.id === target.item)); break;
      case 'task': setEditingTask(target.item); break;
      case 'routines': setRoutineDraft(undefined); setRoutineView(target.editing ? { editing: true, routine: workspace.routines.find(item => item.id === target.item) } : { editing: false }); break;
      default: break;
    }
    setNoticesOpen(Boolean(target.notices));
    setRunningOpen(Boolean(target.running));
    setViewingSource(target.source ? { id: target.source } : undefined);
  };
  const stepView = (direction: NavigationDirection) => {
    if (!viewHistory.current) return;
    const moved = stepHistory(viewHistory.current, direction, viewExists);
    if (!moved) return;
    const go = () => {
      viewHistory.current = moved.history;
      // Nothing re-renders when the step shows what is already on screen, so nothing would clear the flag.
      replaceNextView.current = viewKey(moved.view) !== viewId;
      showView(moved.view);
    };
    // Leaving an edited schedule asks the same question every other way out does.
    const staysInRoutineEditor = moved.view.panel === 'routines' && moved.view.editing && moved.view.item === view.item;
    if (panel === 'routines' && routineView.editing && !staysInRoutineEditor) void leaveRoutine(go);
    else go();
  };
  useNavigationInput(stepView, window.orglet?.onNavigate);
  // `orglet open --to <name>` in a terminal (COD-234): main names the chat, the window opens it like a sidebar click.
  const openChatFromCli = useRef<(target: OpenChatTarget) => void>(() => undefined);
  openChatFromCli.current = target => {
    setPanel(null);
    if (target.kind === 'team') openTeam(target.id);
    else openWorker(target.id);
  };
  useEffect(() => window.orglet?.onOpenChat?.(target => openChatFromCli.current(target)), []);
  // Send to and orglet:// links (COD-246). Main queues them; the window takes the queue when it mounts and whenever
  // main says more arrived, and handles it once the workspace is there to open chats in.
  useEffect(() => {
    if (!window.orglet?.takeIncoming) return;
    const take = () => void orglet.takeIncoming().then(items => {
      if (!items.length) return;
      pendingIncoming.current.push(...items);
      setIncomingCount(count => count + items.length);
    }).catch(() => undefined);
    take();
    return window.orglet.onIncoming(take);
  }, []);
  /** The empty chat of this orglet or crew is the one on screen, so opening it again would clear its draft. */
  const showsEmptyChat = (target: { kind: 'worker' | 'team'; id: string }) => {
    if (selected || group) return false;
    if (target.kind === 'team') return teamId === target.id;
    return !teamId && workerId === target.id;
  };
  const liveChatOf = (target: { kind: 'worker' | 'team'; id: string }) => {
    if (!workspace) return undefined;
    return target.kind === 'team' ? liveTeamTask(workspace.tasks, target.id) : liveWorkerTask(workspace.tasks, target.id);
  };
  const openOrgletOrCrew = (target: { kind: 'worker' | 'team'; id: string }) => {
    if (showsEmptyChat(target)) return;
    if (target.kind === 'team') openTeam(target.id);
    else openWorker(target.id);
  };
  /** A link opens the chat it names and puts its text in the message bar. It never sends. */
  const openLinkedChat = (item: IncomingChat) => {
    setPanel(null);
    const live = liveChatOf(item.chat);
    openOrgletOrCrew(item.chat);
    if (!item.text) return;
    if (live) {
      setFollowUpPrefill({ taskId: live.id, text: item.text, at: Date.now() });
      return;
    }
    const text = item.text;
    setBrief(current => showsEmptyChat(item.chat) ? withPrefill(current, text) : text);
    setTimeout(() => composer.current?.focus(), 0);
  };
  const handleIncoming = useRef<(item: Incoming) => void>(() => undefined);
  handleIncoming.current = item => {
    if (item.kind === 'notice') toast(item.message, 'info', t('Liên kết orglet://'));
    else if (item.kind === 'chat') openLinkedChat(item);
    else setSentFiles(item);
  };
  useEffect(() => {
    if (!workspace || !pendingIncoming.current.length) return;
    for (const item of pendingIncoming.current.splice(0)) handleIncoming.current(item);
  }, [incomingCount, Boolean(workspace)]);
  // Files for the next message belong to the one form they were opened in; leaving it forgets them.
  useEffect(() => { if (panel !== 'revision') setRevisionIntake(undefined); }, [panel]);
  const closeSendTo = () => {
    if (sentFiles) void orglet.dropSentFiles(sentFiles.id).catch(() => undefined);
    setSentFiles(undefined);
  };
  /**
   * The files go where the person picked, the way the file picker's files do: into the message box of an empty chat,
   * or into the next message of a chat that already has one. Nothing is sent.
   */
  const sendFilesTo = async (option: SendToOption) => {
    if (!sentFiles) return;
    const handOff = sentFiles;
    setSentFiles(undefined);
    errorAbout.current = t('Gửi tới {0}', [option.name]);
    setError('');
    try {
      const intake = await orglet.takeSentFiles(handOff.id);
      setPanel(null);
      const target = option.target;
      const thread = target.kind === 'task' ? target.id : liveChatOf({ kind: target.kind, id: target.id })?.id;
      if (target.kind === 'task') openTask(target.id);
      else openOrgletOrCrew({ kind: target.kind, id: target.id });
      if (thread) {
        setRevisionIntake({ taskId: thread, intake, at: Date.now() });
        setPanel('revision');
        return;
      }
      const keepsDraft = target.kind !== 'task' && showsEmptyChat({ kind: target.kind, id: target.id });
      const merged = attachIntake(keepsDraft ? sources : [], intake);
      setSources(merged.sources);
      setSkippedSources(current => keepsDraft ? [...current, ...merged.skipped] : merged.skipped);
      setTimeout(() => composer.current?.focus(), 0);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const teamOrder = useReorder(workspace?.teams.map(item => item.id) ?? [], ids => action(() => orglet.call('reorder', { kind: 'teams', ids })));
  const workerOrder = useReorder(workspace?.workers.map(item => item.id) ?? [], ids => action(() => orglet.call('reorder', { kind: 'workers', ids })));
  const sectionOrder = (section: SidebarSelectionSection) => section === 'teams' ? teamOrder.order : workerOrder.order;
  const sectionKind = (section: SidebarSelectionSection) => section === 'teams' ? 'team' as const : 'worker' as const;
  /** The edit button of a section: on, that section is in select mode; off again, or on for the other section, drops the selection. */
  const toggleSelecting = (section: SidebarSelectionSection) => {
    if (selecting === section) { clearSelection(); return; }
    if (selection.section !== section) setSelection(noSelection);
    setSelecting(section);
  };
  const pickRow = (section: SidebarSelectionSection, id: string, mode: SelectionPickMode) => {
    // A pick in the other section moves the selection there, so that section's edit button is the one in its Done state.
    if (selecting && selecting !== section) setSelecting(null);
    setSelection(current => mode === 'range' ? selectRange(current, section, sectionOrder(section), id) : toggleSelection(current, section, sectionOrder(section), id));
  };
  const rowSelection = (section: SidebarSelectionSection, id: string) => ({
    picking: selecting === section,
    selected: selection.section === section && selection.ids.includes(id),
    onPick: (mode: SelectionPickMode) => pickRow(section, id, mode),
  });
  /**
   * Archives or deletes every selected row, one command each, and says what happened in one toast. A row that fails
   * is named; the ones that went through are gone from the list, so nothing claims more than it did.
   */
  const applyToSelection = async (verb: 'archive' | 'delete') => {
    const section = selection.section;
    if (!section) return;
    const kind = sectionKind(section);
    const ids = selection.ids;
    const failed: string[] = [];
    clearSelection();
    setError('');
    for (const id of ids) {
      try {
        if (verb === 'archive') await orglet.call('archiveEntity', { kind, id, archived: true });
        else await orglet.call('deleteEntity', { kind, id });
      } catch {
        failed.push(entityName(kind, id) ?? id);
      }
    }
    await refresh();
    if (failed.length) {
      toast(verb === 'archive' ? t('Không lưu trữ được {0}', [failed.join(', ')]) : t('Không xóa được {0}', [failed.join(', ')]), 'error');
      return;
    }
    const done = ids.length;
    if (section === 'teams') toast(verb === 'archive' ? t('Đã lưu trữ {0} hội', [done]) : t('Đã xóa {0} hội', [done]), 'success');
    else toast(verb === 'archive' ? t('Đã lưu trữ {0} Tí', [done]) : t('Đã xóa {0} Tí', [done]), 'success');
  };
  /** After the chat on screen was archived or deleted: a side thread goes back to its orglet's main chat. */
  const leaveClosedChat = (closed: Task | undefined) => {
    if (closed?.sideOf) { openWorker(closed.workerId); return; }
    leaveThread();
  };
  const deleteTask = (taskId: string) => action(async () => {
    const name = taskName(taskId);
    const closed = workspace?.tasks.find(item => item.id === taskId);
    await orglet.call('deleteTask', { id: taskId });
    if (selectedRef.current === taskId) { hideTaskLocally(taskId, 'deletedAt'); leaveClosedChat(closed); }
    toast(t('Đã xóa cuộc trò chuyện'), 'success', name);
  }, taskName(taskId));
  const archiveTask = (taskId: string, archived: boolean) => action(async () => {
    const name = taskName(taskId);
    const closed = workspace?.tasks.find(item => item.id === taskId);
    await orglet.call('archiveTask', { id: taskId, archived });
    if (archived && selectedRef.current === taskId) { hideTaskLocally(taskId, 'archivedAt'); leaveClosedChat(closed); }
    toast(archived ? t('Đã lưu trữ cuộc trò chuyện') : t('Đã khôi phục cuộc trò chuyện'), 'success', name);
  }, taskName(taskId));
  const renameTask = (taskId: string, title: string) => action(() => orglet.call('renameTask', { id: taskId, title }), taskName(taskId));
  setDisplayCurrency(workspace?.currency);
  // Phase 5 of the avatar animations: a row that was just created rises into the list once. This sits above the
  // loading return, because a hook must run on every render and the workspace arrives after the first one.
  const isArriving = useArrivals(workspace ? [...workspace.teams.map(item => `team-${item.id}`), ...workspace.workers.map(item => `worker-${item.id}`)] : [], Boolean(workspace));
  // The shell is drawn before the workspace arrives (COD-218): the same frame, the same sidebar width, the lists
  // and the chat filled in as skeletons, so the window never opens on a blank page or a centred wait.
  if (!workspace) return <Startup error={error} onRetry={window.orglet ? () => void refresh() : undefined} sidebar={sidebar} sidebarWidth={sidebarWidth} />;
  /** A worker row resting under the pointer fetches its live chat and its model list ahead of the click. */
  const dwellWorker = (item: Worker) => (resting: boolean) => {
    const live = liveWorkerTask(workspace.tasks, item.id);
    if (live) dwellChat(live.id, resting);
    dwellModels(item.provider, resting);
  };
  const dwellTeam = (item: Team) => (resting: boolean) => {
    const live = liveTeamTask(workspace.tasks, item.id);
    if (live) dwellChat(live.id, resting);
  };
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
        icon: <RosterAvatars workers={members} max={2} />,
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
  const archiveEntity = (kind: 'worker' | 'team', entityId: string, archived: boolean) => action(async () => {
    const name = entityName(kind, entityId);
    await orglet.call('archiveEntity', { kind, id: entityId, archived });
    toast(archived ? t('Đã lưu trữ') : t('Đã khôi phục'), 'success', name);
  }, entityName(kind, entityId));
  const deleteEntity = (kind: 'worker' | 'team', entityId: string) => action(async () => {
    const name = entityName(kind, entityId);
    await orglet.call('deleteEntity', { kind, id: entityId });
    toast(t('Đã xóa'), 'success', name);
  }, entityName(kind, entityId));
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
  /** An orglet's side threads under its row (COD-247), a few at a time, each with its own mark. */
  const sideThreadRows = (orgletId: string) => {
    const threads = sideThreadsOf(workspace.tasks, orgletId);
    if (!threads.length) return undefined;
    return <ShowMore items={threads} limit={3} empty="" render={thread => <SideThreadRow key={thread.id} name={taskName(thread.id) ?? thread.brief}
      active={selected === thread.id} status={taskStatusMark(thread.status, taskSeen(thread))}
      onOpen={() => { clearSelection(); openTask(thread.id); }} onDwell={resting => dwellChat(thread.id, resting)}
      onRename={title => renameTask(thread.id, title)} onArchive={() => archiveTask(thread.id, true)} onDelete={() => deleteTask(thread.id)} />} />;
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
  const detailsWorker = detailsTeam || group ? undefined : detail ? workspace.workers.find(item => item.id === detail.task.workerId) : worker;
  // Openers for the empty chat, read from this workspace rather than a fixed list (COD-48).
  const chatTasks = workspace.tasks.filter(task => team ? task.teamId === team.id : group ? isGroupChatTask(task, group) : !task.teamId && task.workerId === workerId);
  const starters = suggestStarters({ worker: group ? undefined : worker, team, members: group ? groupWorkers : roster, skills: workspace.skills, tasks: chatTasks, hasSources: sources.length > 0 });
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
  // A group is named in the header and is not in the recipient list, so its prompt bar carries neither control.
  const composerTrailing = group ? undefined
    : worker && !team && worker.provider !== 'demo'
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
  const chatName = team?.name ?? groupName ?? worker?.name ?? 'Orglet';
  const openSideThread = selected && detail?.task.sideOf ? detail.task : undefined;
  const headerName = openSideThread ? taskName(openSideThread.id) ?? openSideThread.brief
    : selected ? (detail && assigneeLabel(detail.task, workspace!, { all: t('Toàn bộ Tí'), many: count => t('{0} Tí', [count]) })) ?? team?.name ?? t('Công việc') : chatName;
  const headerRename = renameTargetOf();
  /**
   * The one orglet or crew this chat belongs to, whose name the header can rename in place (owner, 2026-09-25).
   * A group chat, a chat for every orglet, or one whose detail has not loaded yet has no single owner to rename.
   */
  function renameTargetOf(): { kind: 'team'; team: Team } | { kind: 'worker'; worker: Worker } | { kind: 'thread'; taskId: string } | undefined {
    if (!workspace) return undefined;
    if (selected) {
      const task = detail?.task;
      if (!task) return undefined;
      // A side thread's header is the thread, so it renames the thread, not the orglet (COD-247).
      if (task.sideOf) return { kind: 'thread', taskId: task.id };
      const taskTeam = task.teamId ? workspace.teams.find(item => item.id === task.teamId) : undefined;
      if (taskTeam) return { kind: 'team', team: taskTeam };
      if (task.assignees === 'all') return undefined;
      const owners = taskWorkers(task, workspace);
      return owners.length === 1 ? { kind: 'worker', worker: owners[0] } : undefined;
    }
    if (team) return { kind: 'team', team };
    if (group || !worker) return undefined;
    return { kind: 'worker', worker };
  }
  /** Saves the new name as a new revision, the same way the orglet or crew editor would. */
  const renameFromHeader = async (name: string) => {
    errorAbout.current = t('Đổi tên');
    setError('');
    try {
      if (headerRename?.kind === 'team') await orglet.call('saveTeam', { ...headerRename.team, name });
      if (headerRename?.kind === 'worker') await orglet.call('saveWorker', { ...headerRename.worker, name });
      if (headerRename?.kind === 'thread') await orglet.call('renameTask', { id: headerRename.taskId, title: name });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  };
  const composerBar = <Composer textareaRef={composer} value={brief} onChange={setBrief} onSubmit={() => void send()} label={t('Tin nhắn')} placeholder={team ? t('Nhắn với hội…') : t('Nhắn với {0}…', [groupName ?? worker?.name ?? t('Tí')])} sendLabel={t('Gửi tin nhắn')} disabled={busy} sendDisabled={!isDemo && missingConnections.length > 0} mentions={team ? { people: executionWorkers, allNames: [team.name] } : group ? { people: groupWorkers } : undefined}
    leading={<SourcePicker onFiles={() => action(async () => { const picked = await orglet.pickSources(); setSources(previous => [...previous, ...picked].slice(0, 20)); })} onFolder={() => action(async () => { const intake = await orglet.pickFolder(); const available = 20 - sources.length; setSources(previous => [...previous, ...intake.sources].slice(0, 20)); setSkippedSources(previous => [...previous, ...intake.skipped, ...intake.sources.slice(available).map(source => ({ name: source.name, reason: t('Task đã có đủ 20 tệp.') }))]); })} />}
    trailing={composerTrailing}
    attachments={sources} onRemoveAttachment={id => setSources(sources.filter(source => source.id !== id))} />;
  /** A section's header buttons: the edit button that turns select mode on (a check while it is), then create. */
  const sectionActions = (section: SidebarSelectionSection, selectLabel: string, createLabel: string, create: () => void) => {
    const done = selecting === section;
    return <>
      <Button size="icon" className="row-action" aria-pressed={done} aria-label={done ? t('Xong') : selectLabel} title={done ? t('Xong') : selectLabel} onClick={() => toggleSelecting(section)}>{done ? <Check size={16} /> : <Pencil size={16} />}</Button>
      <Button size="icon" className="row-action" aria-label={createLabel} title={createLabel} onClick={create}><Plus size={16} /></Button>
    </>;
  };
  const selectionCount = selection.ids.length;
  const deleteSelectionQuestion = selection.section === 'teams'
    ? t('Xóa {0} hội đã chọn? Cuộc trò chuyện cũ vẫn giữ lịch sử.', [selectionCount])
    : t('Xóa {0} Tí đã chọn? Cuộc trò chuyện cũ vẫn giữ lịch sử.', [selectionCount]);
  // Two or more orglets can talk in one chat (COD-215); a crew already has its own, and one orglet is a plain chat.
  const canStartGroupChat = groupChatFromSelection(selection) !== undefined;
  const selectionBar = selection.section && <div className="selection-bar" role="toolbar" aria-label={t('Mục đã chọn')}>
    <span className="selection-count">{t('{0} đã chọn', [selectionCount])}</span>
    {canStartGroupChat && <Button size="icon" className="row-action" aria-label={t('Trò chuyện nhóm')} title={t('Trò chuyện nhóm')} onClick={startGroupChatFromSelection}><MessagesSquare size={16} /></Button>}
    <Button size="icon" className="row-action" aria-label={t('Lưu trữ')} title={t('Lưu trữ')} onClick={() => void applyToSelection('archive')}><Archive size={16} /></Button>
    <RowMenu className="row-action danger" label={t('Xóa')} icon={Trash} asksOnOpen items={[{ label: t('Xóa'), icon: Trash, danger: true, onSelect: () => void applyToSelection('delete'), confirm: { question: deleteSelectionQuestion, label: t('Xóa') } }]} />
    <Button size="icon" className="row-action" aria-label={t('Bỏ chọn')} title={t('Bỏ chọn')} onClick={clearSelection}><SidebarX size={16} /></Button>
  </div>;
  const composerHint = isDemo ? <p className="composer-note">{team?.preflight ? t('Demo · không gọi API; checker local sẽ chạy trước báo cáo mẫu.') : t('Đang dùng Demo · không gọi API, không phân tích tệp.')}<button onClick={() => { if (team) { setEditingTeam(team); setPanel('team'); } else { setEditingWorker(groupWorkers[0] ?? worker); setPanel('worker'); } }}>{team ? t('Thiết lập hội') : t('Đổi model')}</button></p> : missingConnections.length > 0 ? <p className="composer-note">{t('Cần kết nối trước khi gửi.')}<button onClick={() => openSettings(settingsTabFor(missingConnections))}>{missingConnections.map(provider => setupHint(provider, harnesses)).join(t(' và '))}</button></p> : null;
  return <div className={`app ${sidebar ? '' : 'sidebar-hidden'}${resizing ? ' resizing' : ''}${panelMoving ? ' panel-moving' : ''}${detailsOpen ? ' with-details' : ''}`} style={{ '--sidebar-width': `${sidebarWidth}px`, '--details-width': `${detailsPane.width}px` } as CSSProperties}>
    <a className="skip-link" href="#main-content">{t('Đến nội dung chính')}</a>
    {sidebar && <button type="button" className="sidebar-resizer" aria-label={t('Kéo để đổi độ rộng thanh bên')} {...sidebarPane.handleProps} />}
    {detailsOpen && <button type="button" className="details-resizer" aria-label={t('Kéo để đổi độ rộng panel chi tiết')} {...detailsPane.handleProps} />}
    <aside className={`sidebar${sidebar ? '' : ' collapsed'}`} aria-label={t('Điều hướng')} inert={!sidebar || undefined}>
      <div className="brand"><span className="orglet-mark">o</span><strong>Orglet</strong><Button size="icon" aria-label={t('Tìm cuộc trò chuyện (Ctrl K)')} aria-haspopup="dialog" onClick={() => setSearchOpen(true)}><Search size={18} /></Button><Button size="icon" aria-label={t('Thu gọn sidebar')} onClick={() => setSidebar(false)}><PanelLeft size={18} /></Button></div>
      <div className="sidebar-scroll">
      
      <SidebarSection id="teams" title={t('Hội')} action={sectionActions('teams', t('Chọn nhiều hội'), t('Tạo hội'), () => { setEditingTeam(undefined); setPanel('team'); })}>
        {teamOrder.order.map(id => workspace.teams.find(team => team.id === id)).filter((item): item is Team => Boolean(item)).map(item => <SidebarTreeRow key={item.id} id={`team-${item.id}`} arriving={isArriving(`team-${item.id}`)} name={item.name} avatar={<RosterAvatars workers={teamRoster(item, workspace.workers)} size="sm" max={2} />} active={teamId === item.id && (!selected || selected === liveTeamTask(workspace.tasks, item.id)?.id)} status={teamStatus(item)} onSelect={() => { clearSelection(); openTeam(item.id); }} onDwell={dwellTeam(item)} reorder={teamOrder.bind(item.id)} selection={rowSelection('teams', item.id)}
          menu={<RowMenu label={t('Tùy chọn hội {0}', [item.name])} icon={EllipsisVertical} contextMenuOf=".tree-item" items={[{ label: t('Chỉnh sửa'), icon: Pencil, onSelect: () => { setEditingTeam(item); setPanel('team'); } }, { label: t('Xuất template'), icon: Download, onSelect: () => action(() => orglet.exportTemplate(item.id)) }, { label: t('Lưu trữ'), icon: Archive, onSelect: () => archiveEntity('team', item.id, true) }, { label: t('Xóa'), icon: Trash, danger: true, onSelect: () => deleteEntity('team', item.id), confirm: { question: t('Xóa {0}? Cuộc trò chuyện cũ vẫn giữ lịch sử.', [item.name]), label: t('Xóa') } }]} />} />
        )}{!workspace.teams.length && <p className="empty-history">{t('Chưa có hội nào.')}</p>}
        <ArchivedList count={workspace.archivedTeams.length}>{workspace.archivedTeams.map(item => <ArchivedRow key={item.id} name={item.name} mark={<Avatar name={item.name} seed={item.id} size="xs" />} archive={archiveState(item)!} onRestore={() => archiveEntity('team', item.id, false)} onDelete={() => deleteEntity('team', item.id)} />)}</ArchivedList>
      </SidebarSection>
      <SidebarSection id="workers" title={t('Tí')} action={sectionActions('workers', t('Chọn nhiều Tí'), t('Tạo Tí'), () => { setEditingWorker(undefined); setPanel('worker'); })}>
        {workerOrder.order.map(id => workspace.workers.find(worker => worker.id === id)).filter((item): item is Worker => Boolean(item)).map(item => <SidebarTreeRow key={item.id} id={`worker-${item.id}`} arriving={isArriving(`worker-${item.id}`)} name={item.name} description={item.description} avatar={<Avatar name={item.name} seed={item.id} emoji={item.avatar?.emoji} mascot={item.avatar?.mascot} defaultMascot hint={item.description} color={item.avatar?.color} size="sm" badge={item.provider === 'demo' ? undefined : <ProviderMark provider={item.provider} size="small" decorative />} />} active={!teamId && !group && workerId === item.id && (!selected || selected === liveWorkerTask(workspace.tasks, item.id)?.id)} status={workerStatus(item.id)} reorder={workerOrder.bind(item.id)} onSelect={() => { clearSelection(); openWorker(item.id); }} onDwell={dwellWorker(item)} selection={rowSelection('workers', item.id)}
          menu={<RowMenu label={t('Tùy chọn {0}', [item.name])} icon={EllipsisVertical} contextMenuOf=".tree-item" items={[{ label: t('Chỉnh sửa'), icon: Pencil, onSelect: () => { setEditingWorker(item); setPanel('worker'); } }, { label: t('Lưu trữ'), icon: Archive, onSelect: () => archiveEntity('worker', item.id, true) }, { label: t('Xóa'), icon: Trash, danger: true, onSelect: () => deleteEntity('worker', item.id), confirm: { question: t('Xóa {0}? Cuộc trò chuyện cũ vẫn giữ lịch sử.', [item.name]), label: t('Xóa') } }]} />}>
          {sideThreadRows(item.id)}
        </SidebarTreeRow>)}{!workspace.workers.length && <p className="empty-history">{t('Chưa có Tí nào.')}</p>}
        <ArchivedList count={workspace.archivedWorkers.length}>{workspace.archivedWorkers.map(item => <ArchivedRow key={item.id} name={item.name} mark={<Avatar name={item.name} seed={item.id} mascot={item.avatar?.mascot} defaultMascot hint={item.description} color={item.avatar?.color} size="xs" />} archive={archiveState(item)!} onRestore={() => archiveEntity('worker', item.id, false)} onDelete={() => deleteEntity('worker', item.id)} />)}</ArchivedList>
      </SidebarSection>
      </div>
      {selectionBar}
      <div className="sidebar-footer"><Button onClick={() => setNoticesOpen(true)} aria-label={unreadNotices > 0 ? t('Thông báo, {0} chưa đọc', [unreadNotices]) : t('Thông báo')}><span className="notice-bell"><Bell size={18} />{unreadNotices > 0 && <span className="notice-dot" aria-hidden="true" />}</span>{t('Thông báo')}{unreadNotices > 0 && <span className="badge unread" aria-hidden="true">{unreadNotices > 99 ? '99+' : unreadNotices}</span>}</Button><Button onClick={() => setRunningOpen(true)} aria-label={runningNow > 0 ? t('Đang chạy, {0} lượt', [runningNow]) : t('Đang chạy')}><Activity size={18} />{t('Đang chạy')}{runningNow > 0 && <span className="badge running-count" aria-hidden="true">{runningNow > 99 ? '99+' : runningNow}</span>}</Button><Button onClick={() => openRoutines()} aria-label={pendingRoutines > 0 ? t('Lịch chạy, {0} cần xem', [pendingRoutines]) : t('Lịch chạy')}><span className="notice-bell"><CalendarClock size={18} />{pendingRoutines > 0 && <span className="notice-dot" aria-hidden="true" />}</span>{t('Lịch chạy')}{pendingRoutines > 0 && <span className="badge unread" aria-hidden="true">{pendingRoutines > 99 ? '99+' : pendingRoutines}</span>}</Button><Button onClick={() => { if (knowledgeToReview > 0) setLibraryTab('knowledge'); setPanel('library'); }} aria-label={knowledgeToReview > 0 ? t('Thư viện, {0} cần duyệt', [knowledgeToReview]) : t('Thư viện')}><span className="notice-bell"><BookOpen size={18} />{knowledgeToReview > 0 && <span className="notice-dot" aria-hidden="true" />}</span>{t('Thư viện')}{knowledgeToReview > 0 && <span className="badge unread" aria-hidden="true">{knowledgeToReview > 99 ? '99+' : knowledgeToReview}</span>}</Button><Button onClick={() => openSettings()} {...dwellHandlers(dwellAbout)}><Settings size={18} />{t('Cài đặt')}<span className={`connection-dot ${hasConnection(connections, workspace.customConnections) ? 'connected' : ''}`} /></Button></div>
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
          {/* An empty group chat shows who is in it, the way a crew's row does; a count alone names nobody. */}
          {!selected && group && <RosterAvatars workers={groupWorkers} size="sm" max={4} />}
          <span className="topbar-title">
          {headerRename
            ? <EditableText key={headerRename.kind === 'team' ? headerRename.team.id : headerRename.kind === 'worker' ? headerRename.worker.id : headerRename.taskId} className="topbar-name" value={headerName} maxLength={headerRename.kind === 'thread' ? 120 : 80}
              label={t('Đổi tên {0}', [headerName])} onCommit={renameFromHeader} />
            : <span className="topbar-name">{headerName}</span>}
          {/* Which model is answering, not only whether it is Demo (user, 2026-09-19). A team running on several
              providers says nothing here; the details panel lists them one by one. */}
          {headerProvider && <span className="topbar-provider" title={headerProvider === 'demo' ? t('Demo · không gọi API') : providerLabel(headerProvider)}>
            {headerProvider !== 'demo' && <ProviderMark provider={headerProvider} size="small" decorative />}
            {providerName(headerProvider)}
          </span>}
          </span>
        </div>
        <div className="topbar-actions">
          {selected && detail && openTaskPaid && <span className="task-cost" role="status" title={detail.usage.reservedMicros > 0 ? t('Đã dùng {0} / {1} · đang giữ chỗ {2}', [formatMoney(detail.usage.chargedMicros), formatMoney(detail.task.budgetMicros), formatMoney(detail.usage.reservedMicros)]) : t('Đã dùng {0} / {1}', [formatMoney(openTaskUsed), formatMoney(detail.task.budgetMicros)])}><Wallet size={14} aria-hidden="true" />{t('Đã dùng {0} / {1}', [formatMoney(openTaskUsed), formatMoney(detail.task.budgetMicros)])}</span>}

          {(selected || team || worker) && <RowMenu className="thread-menu" label={t('Tùy chọn cuộc trò chuyện')} items={[{ label: t('Chi tiết'), icon: SlidersHorizontal, onSelect: () => setPanel('activity') }, ...(selected ? [...(openSideThread ? [] : [{ label: t('Chỉnh sửa'), icon: LucidePencil, onSelect: () => { setEditingTask(selected); setPanel('task'); } }]), detail?.task.archivedAt ? { label: t('Khôi phục'), icon: ArchiveRestore, onSelect: () => archiveTask(selected, false) } : { label: t('Lưu trữ'), icon: LucideArchive, onSelect: () => archiveTask(selected, true) }, { label: t('Xóa'), icon: Trash2, danger: true, onSelect: () => deleteTask(selected), confirm: { question: t('Xóa cuộc trò chuyện này? Không thể hoàn tác.'), label: t('Xóa') } }] : [])]} />}
        </div>
      </header>
      {error && <div className="error-banner" role="alert"><span>{error}</span><Button size="icon" aria-label={t('Đóng thông báo')} onClick={() => setError('')}><X size={16} /></Button></div>}
      {catchUpNotice && <div className="notice-banner" role="status"><LucideCalendarClock size={16} aria-hidden="true" /><div><p>{singleCatchUp ? t('{0} đã lỡ một lần chạy khi app tắt. Có thể chạy bù một lần.', [singleCatchUp.name]) : t('{0} lịch đã lỡ lần chạy khi app tắt. Mỗi lịch chạy bù được một lần.', [pendingCatchUp.length])}</p><div className="actions">{singleCatchUp?.enabled && <Button variant="primary" onClick={() => action(async () => openTask(await orglet.call('catchUpRoutine', { id: singleCatchUp.id })))}>{t('Chạy bù một lần')}</Button>}<Button onClick={() => openRoutines()}>{t('Xem lịch chạy')}</Button></div></div><Button size="icon" aria-label={t('Đóng thông báo lịch bị lỡ')} onClick={() => setDismissedCatchUpNotice(catchUpNoticeKey)}><X size={16} /></Button></div>}
      {selected ? <>{detail ? <><FormatPreferences.Provider value={{ copy: workspace.copyFormat, download: workspace.downloadFormat }}><TaskThread key={selected} detail={detail} workspace={workspace} recovery={workspaceRecovery} action={action} showSources={openSources} reviewRecovery={runId => { setRecoveryFocus({ runId, at: Date.now() }); setPanel('activity'); }} openMessage={messageId => {
        // Team messages live in Details, so that panel opens first and the message is found after it renders.
        if (detail.events.some(event => event.id === messageId && event.teamMessage)) setPanel('activity');
        requestAnimationFrame(() => focusMessage(messageId));
      }} proposals={workspace.knowledge.filter(item => item.status === 'proposed' && item.provenance.kind === 'run' && item.provenance.taskId === selected)} openKnowledge={openKnowledge} reviewKnowledge={() => { setLibraryTab('knowledge'); setPanel('library'); }} proposalActions={proposalActions} mentionPeople={openTaskWorkers} mentionAllNames={detail.task.teamId ? [workspace.teams.find(item => item.id === detail.task.teamId)?.name ?? ''].filter(Boolean) : undefined} openMemories={openWorkerMemories} openChat={openTask} openMainChat={openWorker} /></FormatPreferences.Provider><FollowUpComposer key={`follow:${selected}`} detail={detail} workspace={workspace} ready={ready} openRevision={() => setPanel('revision')} openSettings={tab => openSettings(tab ?? 'connections')} openChat={openTask} action={action} prefill={followUpPrefill?.taskId === selected ? followUpPrefill : undefined} onPrefilled={() => setFollowUpPrefill(undefined)} /></> : <ThreadSkeleton />}</> : (team || group || worker) ? <div className="team-chat team-chat-fresh">
        {/* Nothing has been sent yet, so the greeting, the prompt bar and the starters sit together in the
            middle of the pane instead of a greeting up top and a bar pinned to the bottom (user, 2026-09-19). */}
        <div className="fresh-chat team-chat-empty">
          {/* The faces you are about to talk to, big and in 3D (COD-156): a worker alone, or a team or group side by
              side. They hop in when the chat opens, turn to follow the pointer, and a team glances at each other
              first. Keyed by the chat so switching to another worker greets again. */}
          <div className="fresh-faces" key={team ? `team-${team.id}` : group ? groupChatKey(group) : worker?.id}>
            {team
              ? roster.map(member => <Avatar key={member.id} name={member.name} seed={member.id} mascot={member.avatar?.mascot} defaultMascot hint={member.description} color={member.avatar?.color} size={freshFaceSize(roster.length)} motion={{ lead: true, greet: true, group: `team-${team.id}` }} />)
              : group
                ? groupWorkers.slice(0, MAX_CREW_MEMBERS).map(member => <Avatar key={member.id} name={member.name} seed={member.id} mascot={member.avatar?.mascot} defaultMascot hint={member.description} color={member.avatar?.color} size={freshFaceSize(groupWorkers.length)} motion={{ lead: true, greet: true, group: groupChatKey(group) }} />)
                : worker ? <Avatar name={worker.name} seed={worker.id} emoji={worker.avatar?.emoji} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="xxl" motion={{ lead: true, greet: true }} /> : null}
          </div>
          <h1 className="welcome">{t('Đang nhắn với {0}', [chatName])}</h1>
          <div className="thread-composer">
            {composerBar}
            {composerHint}
            {skippedSources.length > 0 && <details className="intake-skipped"><summary>{t('{0} mục không được thêm vào task', [skippedSources.length])}</summary><ul>{skippedSources.map((item, index) => <li key={index}>{item.name}: {tMessage(item.reason)}</li>)}</ul></details>}
          </div>
          <Starters starters={starters} onPick={pickStarter}
            canSchedule={Boolean(brief.trim())}
            onSchedule={worker && !team && !group ? () => { setRoutineDraft({ workerId, brief, sourceIds: sources.map(source => source.id), excludedSources: skippedSources, consent: false, providerScopes: [], budgetMicros: taskBudgetMicros }); setRoutineView({ editing: true }); setPanel('routines'); } : undefined} />
        </div>
      </div> : null}
      <footer className="main-footer">{t('Câu trả lời có thể sai. Kiểm chứng với nguồn gốc trước khi dùng.')}</footer>
    </main>
    {detailsOpen && (detail || detailsTeam || detailsWorker || group) && <DetailsPanel workspace={workspace} team={detailsTeam} worker={detailsWorker} group={!selected && group ? groupWorkers : undefined} detail={detail}
      recovery={workspaceRecovery} recoveryFocus={recoveryFocus}
      readProcessOutput={detail ? (processId, stream, offset) => orglet.call('recoveryProcessOutput', { taskId: detail.task.id, processId, stream, offset }) : undefined}
      readPrivateFile={detail ? (runId, path, offset) => orglet.call('recoveryFile', { taskId: detail.task.id, runId, path, offset }) : undefined}
      onRetireWorkspace={detail ? (runId, reviewToken) => toolAction(async () => {
        const confirmed = await confirmAction({ title: t('Giữ file hiện tại và kết thúc bản làm việc này?'),
          description: t('File hiện tại không đổi và thay đổi chưa tích hợp không tự áp dụng. Lần cũ không chạy tiếp được; bấm Thử lại để chạy mới.'),
          confirmLabel: t('Giữ file hiện tại'), cancelLabel: t('Quay lại kiểm tra') });
        if (confirmed) await orglet.call('retireWorkspaceAttempt', { taskId: detail.task.id, runId, reviewToken, keepCurrentFiles: true });
      }) : undefined}
      tools={detail ? {
        workers: taskWorkers(detail.task, workspace),
        connectedProviders: (Object.keys(ready) as Worker['provider'][]).filter(provider => ready[provider as keyof typeof ready]),
        onConfigure: provider => openSettings(settingsTabFor([provider])),
        grant: workspaceAccess?.taskId === detail.task.id ? workspaceAccess.grant : undefined,
        busy: toolPolicyBusy,
        onCapability: (capability, enabled) => changeTaskCapability(detail, capability, enabled),
        onWorkspace: level => toolAction(() => level === 'none'
          ? orglet.call('revokeWorkspace', { taskId: detail.task.id })
          : orglet.pickWorkspace(detail.task.id, permissionsForLevel(level))),
      } : !selected && newChatTarget ? {
        workers: executionWorkers,
        connectedProviders: (Object.keys(ready) as Worker['provider'][]).filter(provider => ready[provider as keyof typeof ready]),
        onConfigure: provider => openSettings(settingsTabFor([provider])),
        capabilities: newChatCapabilities,
        grant: null,
        pending: newChatWorkspace,
        busy: toolPolicyBusy,
        onCapability: changeNewChatCapability,
        onWorkspace: changeNewChatWorkspace,
      } : undefined}
      workerStatus={workerStatus} onClose={close} onOpenSources={() => openSources()} onExport={artifactId => action(() => orglet.exportArtifact(artifactId))} />}
    <Drawer open={panel !== null && !['settings', 'worker', 'team', 'task', 'activity'].includes(panel)} onClose={() => panel === 'routines' ? void leaveRoutine(close) : close()} description={panel === 'routines' && !routineView.editing ? t('Chỉ chạy khi Orglet đang mở; lịch theo giờ bị lỡ thì chạy bù một lần') : panel === 'library' ? (libraryTab === 'skills' ? t('Hướng dẫn dùng lại được; gói nhập từ thư mục cần review trước.') : t('Ghi chú dùng lại được; chỉ mục đã duyệt mới được nạp.')) : undefined} actions={panel === 'routines' && !routineView.editing ? <Button variant="outline" onClick={() => setRoutineView({ editing: true })}><LucideCalendarClock size={16} />{t('Tạo lịch')}</Button> : drawerBack} title={panel === 'revision' ? t('Đính kèm tệp') : panel === 'routines' ? (routineView.editing ? <span className="breadcrumb"><button type="button" className="breadcrumb-link" onClick={() => void leaveRoutine(() => setRoutineView({ editing: false }))}>{t('Lịch chạy')}</button><ChevronRight size={15} aria-hidden="true" className="breadcrumb-separator" /><span aria-current="page">{routineView.routine ? routineView.routine.name : t('Lịch mới')}</span></span> : t('Lịch chạy')) :panel === 'skill' ? libraryTitle(editingSkill?.package ? 'Review skill' : t('Chỉnh skill')) : panel === 'knowledge' ? libraryTitle(editingKnowledge ? 'Knowledge' : t('Knowledge mới')) : panel === 'library' ? t('Thư viện') : panel === 'sources' ? t('Nguồn của cuộc trò chuyện') : t('Chi tiết cuộc trò chuyện')}>
      {panel === 'revision' && detail && <RevisionEditor key={`${detail.task.id}:${detail.task.inputRevision ?? 0}:${revisionIntake?.at ?? 0}`} detail={detail} workspace={workspace} connections={ready} added={revisionIntake?.taskId === detail.task.id ? revisionIntake.intake : undefined} initialText={revisionIntake?.taskId === detail.task.id ? revisionIntake.text : undefined} done={close} />}
      {panel === 'routines' && <RoutinesPanel workspace={workspace} draft={routineDraft} view={routineView} onView={setRoutineView} onDirty={markRoutineDirty} onBack={() => void leaveRoutine(() => setRoutineView({ editing: false }))} openTask={id => { openTask(id); close(); }} />}
      
      {panel === 'skill' && <SkillEditor key={editingSkill?.id ?? 'new'} skill={editingSkill} done={fromLibrary ? backToLibrary : close} />}
      {panel === 'library' && <div className="form">
        <div className="tab-row"><div className="tabs" role="tablist" aria-label={t('Thư viện')} onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const next = libraryTab === 'skills' ? 'knowledge' : 'skills'; setLibraryTab(next); document.getElementById(`library-tab-${next}`)?.focus(); }}>{(['skills', 'knowledge'] as const).map(tab => <Button key={tab} id={`library-tab-${tab}`} role="tab" aria-selected={libraryTab === tab} aria-controls="library-panel" tabIndex={libraryTab === tab ? 0 : -1} onClick={() => setLibraryTab(tab)}><span className="tab-label">{tab === 'skills' ? 'Skills' : 'Knowledge'}<span className="tab-count" aria-hidden="true">{tab === 'skills' ? workspace.skills.length : workspace.knowledge.filter(item => item.status !== 'archived').length}</span></span></Button>)}</div>
          <div className="tab-row-actions">{libraryTab === 'skills' ? <SkillLibraryActions onOpen={openLibrarySkill} /> : <Button variant="outline" onClick={() => openLibraryKnowledge()}><LucidePlus size={16} />{t('Tạo knowledge')}</Button>}</div></div>
        <div id="library-panel" role="tabpanel" aria-labelledby={`library-tab-${libraryTab}`}>{libraryTab === 'skills' ? <SkillLibrary skills={workspace.skills} onOpen={openLibrarySkill} /> : <KnowledgeLibrary workspace={workspace} onOpen={openLibraryKnowledge} onOpenChat={taskId => { close(); openTask(taskId); }} />}</div>
      </div>}
      {panel === 'knowledge' && <KnowledgeEditor key={editingKnowledge ? `${editingKnowledge.id}:${editingKnowledge.revision}` : 'new'} item={editingKnowledge} workspace={workspace} done={fromLibrary ? backToLibrary : close} />}
      {panel === 'sources' && detail && <SourcePanel detail={detail} target={sourceTarget} refresh={() => void refresh()} openSource={id => setViewingSource({ id })} />}
    </Drawer>
    {viewingSource && detail && <SourceDialog key={viewingSource.id} detail={detail} sourceId={viewingSource.id} lines={viewingSource.lines} onClose={() => setViewingSource(undefined)} refresh={() => void refresh()} />}
    <WorkerDialog key={`worker:${panel === 'worker'}:${editingWorker?.id ?? 'new'}`} open={panel === 'worker'} worker={editingWorker} workspace={workspace} connections={connections} harnesses={harnesses ?? []} initialTab={workerDialogTab} onClose={close} onOpenChat={taskId => { close(); openTask(taskId); }} />
    <TeamDialog key={`team:${panel === 'team'}:${editingTeam?.id ?? 'new'}`} open={panel === 'team'} team={editingTeam} workspace={workspace} onClose={close} />
    <TaskDialog key={`task:${panel === 'task'}:${editingTask ?? ''}`} open={panel === 'task'} task={workspace.tasks.find(item => item.id === editingTask)} workspace={workspace} usedMicros={editingTask && detail?.task.id === editingTask ? detail.usage.chargedMicros + detail.usage.reservedMicros : 0} onClose={close} />
    <NoticeCentre open={noticesOpen} onClose={() => setNoticesOpen(false)} />
    <RunningCentre open={runningOpen} items={workspace.running ?? []} tasks={workspace.tasks} teams={workspace.teams} onClose={() => setRunningOpen(false)} onOpenChat={taskId => { setRunningOpen(false); openTask(taskId); }} />
    <Toaster />
    <Confirmer />
    <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} tasks={workspace.tasks} teams={workspace.teams} onOpenTask={openTask} onDwellTask={dwellChat} />
    <SendToPicker open={Boolean(sentFiles)} count={sentFiles?.count ?? 0} names={sentFiles?.names ?? []} options={sentFiles ? sendToOptions(workspace) : []} onChoose={option => void sendFilesTo(option)} onClose={closeSendTo} />
    <SettingsDialog open={panel === 'settings'} tab={settingsTab} onTab={setSettingsTab} onClose={close} workspace={workspace} connections={connections} onConnections={setConnections} harnesses={harnesses} onHarnesses={setHarnesses} />
  </div>;
}
