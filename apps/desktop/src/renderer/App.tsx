import { SkillLibrary, SkillLibraryActions } from './components/SkillReview';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
// The sidebar draws Orglet's own icons; the rest of this file stays on lucide until the sweep (the Lucide* aliases mark what is left).
import { Activity, Bell, Archive, BookOpen, CalendarClock, Check, EllipsisVertical, PanelLeft, Pencil, Plus, Search, Trash, X as SidebarX } from './components/icons';
import { ArrowLeft, Bookmark, BellRing, ChevronRight, CircleCheck, Users, Plus as LucidePlus, SlidersHorizontal, CalendarClock as LucideCalendarClock, Wallet, X, Archive as LucideArchive, ArchiveRestore, Trash2, Hash, MessagesSquare, MessageSquareText, Settings2, UserRoundCog, UserRoundPlus } from 'lucide-react';
import { emptyConnections, isPaidApi, MAX_CREW_MEMBERS, type Connections, type Skill, type Source, type Task, type TaskDetail, type Worker, type Workspace, type Team, type TaskInput } from '../shared/contracts';
import { Button } from './components/ui';
import { PanelPage } from './components/PanelPage';
import { SkillEditor } from './components/Editors';
import { WorkerDialog, workerProviderOptions } from './components/WorkerDialog';
import { chatSettingsTarget, connectModelStep, demoWorkerToConnect } from './chatSettings';
import { SettingsDialog, type SettingsTab } from './components/SettingsDialog';
import { TaskThread, ThreadSkeleton, type ThreadStartInfo } from './components/TaskThread';
import { SideThreadPanel } from './components/SideThreadPanel';
import { focusMessage } from './components/messageMarks';
import { SourcePanel, type SourceTarget } from './components/SourcePanel';
import { SourceDialog } from './components/SourceViewer';
import { TaskDialog } from './components/TaskDialog';
import { LocalOnlyDialog } from './components/LocalOnlyDialog';
import { FormatPreferences } from './components/FormatAction';
import { assigneeLabel, taskWorkers, teamRoster } from './assignees';
import { liveChatOf as mainChatOf, liveChatToAdopt, liveTeamTask, liveWorkerTask, newChatKey } from '../shared/live-task';
import type { OpenChatTarget } from '../shared/cli';
import { RoutinesPanel, type RoutineView } from './components/RoutinesPanel';
import { Confirmer, confirmAction } from './components/confirm';
import { SourcePicker } from './components/SourcePicker';
import { Composer, ComposerFoot, DemoNote, FollowUpComposer, SkippedFiles, planFirstInput, restoreUnsent, usePlanUsageBar, withPrefill, type ComposerPrefill, type ReadOnlyChat } from './components/Composer';
import { SidebarSection } from './components/SidebarSection';
import { Avatar, RosterAvatars } from './components/Avatar';
import { rememberCustomConnections } from './customConnections';
import { Startup } from './components/Startup';
import { NoOrglets } from './components/NoOrglets';
import { AccountChooser } from './components/AccountChooser';
import { useAccount } from './account';
import { needsAccountChoice } from '../shared/account';
import { Starters } from './components/Starters';
import { DetailsPanel } from './components/DetailsPanel';
import type { FolderChoice } from './components/PermissionControls';
import type { WorkspaceRecoveryView } from '../shared/workspace-recovery';
import type { RecoveryFocus } from './components/WorkspaceRecovery';
import { suggestStarters } from '../shared/starters';
import { accentInk, accentText, DEFAULT_ACCENT_COLOR } from '../shared/accent';
import { fontStack } from '../shared/fonts';
import { ProviderMark } from './components/ProviderMark';
import { CHANNEL_DRAG_TYPE, CATEGORY_DRAG_TYPE, ChannelRow, ScheduleRunRow, SideThreadRow, SidebarTreeRow, ShowMore, useReorder } from './components/SidebarTree';
import { chatsUnder, type ChatOwner } from '../shared/schedule-runs';
import { useChatNotices } from './chatNotices';
import { SearchDialog } from './components/SearchDialog';
import { SendToPicker } from './components/SendToPicker';
import { sendToOptions, type SendToOption } from './sendTo';
import { ForwardPicker, type ForwardChoice } from './components/ForwardPicker';
import { forwardOptions, forwardSummary, type ForwardRequest } from './forward';
import { chatHeadline } from '../shared/forward';
import { attachIntake, carriedDraft, type Incoming, type IncomingChat, type IncomingFiles } from '../shared/incoming';
import { dropDraft, emptyChatDraftKey, keepDraft, readDraft, taskDraftKey } from './drafts';
import { movePlanFirst } from './planFirst';
import { ChatModePicker, type ModeChange } from './components/ApprovalModePicker';
import { chatToReopen, rememberedChat, rememberOpenChat } from './lastChat';
import { tasksStatusMark, rollupStatusMarks, taskStatusMark, type StatusMarkState } from './components/StatusMark';
import { taskResultSeen } from '../shared/task-seen';
import { RowMenu } from './components/RowMenu';
import { Select } from './components/Select';
import { setDisplayCurrency, formatMoney } from './components/money';
import { Toaster, toast, type ToastAction } from './components/toast';
import { archiveGroups } from './archive';
import type { ArchivedChatKind } from './sidebarChats';
import { type ArchiveSection, type ArchiveState } from './components/ArchiveSettings';
import { removalBlocker } from '../shared/removal';
import { watchRunProgress } from './runProgress';
import { runningCount, waitingForPersonCount, waitsForPerson } from '../shared/running';
import { maskEmail } from '../shared/pii';
import { runningButtonLabel } from './runningList';
import { recordNotice, useUnreadNotices } from './components/notifications';
import { KnowledgeEditor, KnowledgeLibrary } from './components/KnowledgeLibrary';
import type { Knowledge } from '../shared/knowledge';
import type { HarnessInfo } from '../shared/harness';
import { hasConnection, providerLabel, readiness, settingsTabFor, setupHint } from './components/providers';
import { workerModelLabel, providerName } from './components/workerModel';
import { customProviderId } from '../shared/custom-connections';
import { usePaneWidth, shellGap } from './usePaneWidth';
import { ComposerModel } from './components/ComposerModel';
import { t, setLanguage, useLanguage } from './i18n';
import { orglet } from './api';
import { useAppChangeNotices } from './appChangeNotices';
import type { NewChatTarget, WorkspaceGrantView } from '../shared/workspace-access';
import { snapshotCapabilities, withCapability, type ToolCapability } from '../shared/tool-policy';
import { permissionsForLevel, permissionState, type WorkspaceLevel } from '../shared/capability-status';
import { ComposerPermissionHint, type PermissionHintControls } from './permissionHints';
import { appView, createHistory, recordView, replaceView, stepHistory, useNavigationInput, viewKey, type AppView, type NavigationDirection, type NavigationHistory } from './navigation';
import { noSelection, pruneSelection, selectRange, toggleSelection, type SelectionPickMode, type SidebarSelection, type SidebarSelectionSection } from './sidebarSelection';
import { channelFromRecipient, channelNameOf, channelRecipient, channelTaskInput, emptyChannelKey, memberNames, openChannelChats, openEmptyChannel, sidebarChannels } from './channelChat';
import { CHANNEL_NAME_LIMIT, channelLabel, isChannelChat } from '../shared/channels';
import { ChannelDialog, type ChannelDraft } from './components/ChannelDialog';
import type { AppProposal, ProposalTarget } from '../shared/app-proposals';
import { proposedMascot, type ProposalActions } from './components/AppProposals';
import { EditableText } from '@codepawl/orglet-ui';
import { APP_KEY, dwellAbout, dwellChat, dwellModels, followWorkspace, taskDetails, updateStates } from './caches';
import { useCached } from './prefetch';
import { becameReady, updateIndicator } from '../shared/updates';
import { readyUpdateLabel, UpdateButton } from './components/UpdateButton';
import { restartIntoUpdate } from './updateRestart';
import { chatClosure, closedChatDestination, openChatRefresh, type ChatDestination, type OpenChatReads } from './openChat';
import { swapScreen } from './screenTransition';
import { OpenChatRow, type OpenChatItem } from './components/OpenChats';
import { ChatHeader, ChatViewPanel, ChatViewTabs } from './components/ChatViews';
import { ChangesView, changedRunCount } from './components/ChangesView';
import { MemoryList } from './components/Memories';
import { AreaRail, type AreaRailEntry, type AreaRailFolder } from './components/AreaRail';
import type { RowMenuItem } from './components/RowMenu';
import { SpaceMark } from './components/SpaceMark';
import { BellFilled, BookFilled, CalendarClockFilled, ChatFilled } from './components/railIcons';
import type { HomePageView } from './components/FriendsPage';
import { CHAT_SWITCH_SETTLE_MS, markChatSwitch } from './chatSwitch';
import type { Space } from '../shared/spaces';
import { UserPanel } from './components/UserPanel';
import { Boxes, CircleUserRound, Store, FolderInput, FolderMinus, FolderPlus, FolderTree, Folders, Clock, Database, Info, LogIn, NotebookText, Plug, Sparkles, Upload } from 'lucide-react';
import { FriendsPage, type FriendTemplate } from './components/FriendsPage';
import { MarketPublishingDialog, publishingSourceRevision, publishingRequiresSuggestion } from './components/MarketPublishing';
import { ActivityPage, activityTabLabel, activityCounts } from './components/ActivityPage';
import { MemberColumn } from './components/MemberColumn';
import { readArea, writeArea, readOpenSpace, writeOpenSpace, readClosedFolders, writeClosedFolders, folderKey, spaceFolderNames, workingOrgletIds, groupChannels, type Area, type ActivityTab, activityTabs } from './areas';
import { SpaceDialog, type SpaceDraft } from './components/SpaceDialog';
import { CategoryDialog, type CategoryDraft } from './components/CategoryDialog';
import { scopeOrgletIds, spaceChatCapabilities } from '../shared/spaces';
import { demoReplies, setDemoReplies } from './demoReplies';
import { ConnectWays, type ConnectWay } from './components/ConnectWays';
import { useSavedMessages } from './saved';
import { reportFeature } from './analytics';
import { chatKey, chatKeyForView, closeOpenChat, isRosterChat, openChatState, parseChatKey, pruneOpenChats, readOpenChats, readSidebarMode, shownOpenChats, visitChat, walkRecent, walkSnapshot, writeOpenChats, writeSidebarMode, type OpenChatState, type OpenChats } from './openChats';
import { availableChatViews, viewOwnerOfTask, chatViewToShow, memoriesOf, schedulesOf, type ViewOwner, type ChatViewName } from './chatViews';

type SeenInfo = { seenStamp: string; lastArtifactId?: string };
const seenStorageKey = 'orglet.task-seen-stamps';
function readSeenStorage(): Record<string, SeenInfo> {
  try { return JSON.parse(localStorage.getItem(seenStorageKey) || '{}') as Record<string, SeenInfo>; } catch { return {}; }
}
function writeSeenStorage(value: Record<string, SeenInfo>) {
  try { localStorage.setItem(seenStorageKey, JSON.stringify(value)); } catch { /* ignore quota */ }
}

/** How a chat is named in the sidebar: its title, or the first line of what was asked. */
function taskNameOf(workspace: Pick<Workspace, 'tasks'>, taskId: string): string | undefined {
  const task = workspace.tasks.find(item => item.id === taskId);
  if (!task) return undefined;
  return task.title || chatHeadline(task);
}

// The narrowest sidebar still fits its head: the title and three icon buttons (user, 2026-10-04).
const SIDEBAR_WIDTH = { min: 240, max: 420, default: 240, step: 16 };
// The right panel takes the room the list column gave up to the tab strip (COD-340).
const DETAILS_WIDTH = { min: 280, max: 720, default: 400, step: 16 };
/** Whose rows the sidebar lists: an area's, or those of a page opened from the rail. */
type SidebarList = Area | 'library' | 'schedules' | `space:${string}`;
/** The folded left column, the same as --rail-width in styles.css. */
const RAIL_WIDTH = 52;
/** The chat column never gets narrower than this for the right panel's sake; past it the panel stops growing. */
const CHAT_MIN_WIDTH = 480;
/** The window padding on both sides and the gaps between three columns, each `--shell-gap` (8px). */
const SHELL_GAPS_WIDTH = 32;

/** The right panel's width: what the person dragged it to, held back so the chat beside it keeps its room. */
function detailsPaneWidth(chosen: number, windowWidth: number, leftColumnWidth: number): number {
  const room = windowWidth - leftColumnWidth - SHELL_GAPS_WIDTH - CHAT_MIN_WIDTH;
  return Math.max(DETAILS_WIDTH.min, Math.min(chosen, room));
}

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => innerWidth);
  useEffect(() => {
    const follow = () => setWidth(innerWidth);
    addEventListener('resize', follow);
    return () => removeEventListener('resize', follow);
  }, []);
  return width;
}

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
/** Up to this many faces greet an empty crew or channel at full size; more take a size down so eight fit on one line. */
const BIG_FRESH_FACES = 4;

/** The toast after archiving or deleting several ticked orglets, with its own words for one (COD-292). */
function bulkDoneMessage(verb: 'archive' | 'delete', done: number): string {
  if (verb === 'archive') return done === 1 ? t('Đã lưu trữ 1 Tí') : t('Đã lưu trữ {0} Tí', [done]);
  return done === 1 ? t('Đã xóa 1 Tí') : t('Đã xóa {0} Tí', [done]);
}

function freshFaceSize(count: number): 'xl' | 'lg' {
  return count > BIG_FRESH_FACES ? 'lg' : 'xl';
}


type Panel = 'task' | 'routines' | 'settings' | 'worker' | 'library' | 'skill' | 'knowledge' | 'activity' | 'thread' | null;
export function App() {
  useLanguage();
  const [workspace, setWorkspace] = useState<Workspace>(); const [connections, setConnections] = useState<Connections>(emptyConnections());
  // Undefined until the first detection finishes: it runs each CLI and takes about three seconds cold, so nothing waits on it.
  const [harnesses, setHarnesses] = useState<HarnessInfo[]>();
  const account = useAccount();
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
  // The message the forward picker is open for, and whether its Send is on its way (COD-257).
  const [forwarding, setForwarding] = useState<ForwardRequest>();
  const [forwardSending, setForwardSending] = useState(false);
  const [followUpPrefill, setFollowUpPrefill] = useState<ComposerPrefill & { taskId: string }>();
  const pendingIncoming = useRef<Incoming[]>([]);
  const [incomingCount, setIncomingCount] = useState(0);
  // The crew behind the channel on screen when its lead splits the work and nobody has written in it yet (COD-369):
  // its empty chat is the crew's, so its first message starts the crew's chat with the channel on it.
  const [teamId, setTeamId] = useState('');
  const teamIdRef = useRef(teamId); teamIdRef.current = teamId;
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
  // `detail` is set when the file belongs to the side thread open in the right panel rather than to the chat on screen.
  const [viewingSource, setViewingSource] = useState<{ id: string; lines?: [number, number]; detail?: TaskDetail }>();
  // Chat details list the team behind a team chat; a worker chat has none.
  const detailTeam = detail ? workspace?.teams.find(team => team.id === detail.task.teamId) : undefined;
  const openSources = (target?: SourceTarget) => {
    if (target?.type === 'source') { setViewingSource({ id: target.id, lines: target.lines }); return; }
    // The chat's files are its Files view (COD-355), which also holds the checks a citation can point at.
    setSourceTarget(target);
    showChatView('files');
  };
  
  const [privacyTaskId, setPrivacyTaskId] = useState<string>();
  const [panel, setPanel] = useState<Panel>(null); const [editingWorker, setEditingWorker] = useState<Worker>(); const [workerDialogTab, setWorkerDialogTab] = useState<'memory'>(); const [editingTask, setEditingTask] = useState<string>(); const [editingSkill, setEditingSkill] = useState<Skill>();
  const [editingKnowledge, setEditingKnowledge] = useState<Knowledge>(); const [libraryTab, setLibraryTab] = useState<'skills' | 'knowledge'>('skills');
  const [publishingSource, setPublishingSource] = useState<{ kind: 'orglet' | 'crew' | 'space'; entityId: string; name: string }>();
  // The Demo chat's "Kết nối model" opens the worker dialog on its Model field rather than at the top (COD-255), with
  // the first connection that can run already chosen (COD-293).
  const [workerDialogField, setWorkerDialogField] = useState<'provider'>();
  const [workerDialogConnect, setWorkerDialogConnect] = useState(false);
  // "Kết nối model" with nothing but Demo opens Settings to add a connection first: the orglet whose settings follow
  // once Settings closes, and then the one to open after the refresh that lists the new connection (COD-293).
  const [connectingWorker, setConnectingWorker] = useState<string>();
  const [resumeConnect, setResumeConnect] = useState<string>();
  // An orglet or crew saved for the first time, waiting for a workspace that lists it so its chat can open (COD-255).
  const [justCreated, setJustCreated] = useState<{ kind: 'worker' | 'team'; id: string }>();
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
  // Library and Schedules are pages in the main panel, not dialogs: the rail and the sidebar stay in reach beside
  // them, so going to a chat or an area has to leave the page.
  const pagePanelOpen = panel === 'library' || panel === 'skill' || panel === 'knowledge' || panel === 'routines';
  const pagePanelRef = useRef(pagePanelOpen); pagePanelRef.current = pagePanelOpen;
  /**
   * Leaves the open page before `go` shows something else in the main panel. A schedule with unsaved changes asks
   * first; then this answers true, and `go` runs again only if the person agrees to drop them.
   */
  const leavingPage = (go: () => void): boolean => {
    if (!pagePanelRef.current) return false;
    if (routineDirty.current) {
      void leaveRoutine(() => { pagePanelRef.current = false; setPanel(null); go(); });
      return true;
    }
    pagePanelRef.current = false;
    setPanel(null);
    return false;
  };
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const openSettings = (tab: SettingsTab = 'general') => { setSettingsTab(tab); setPanel('settings'); };
  // Chat details sit in the shell next to the conversation, not over it.
  const detailsOpen = panel === 'activity';
  // A side thread opens in the same right panel, beside its main chat, and takes Details' place while open (COD-365).
  const [sideThread, setSideThread] = useState<{ taskId: string; mainTaskId: string; messageId?: string }>();
  const sideThreadRef = useRef(sideThread); sideThreadRef.current = sideThread;
  // A thread deleted or archived while open leaves the panel with its main chat.
  const sideThreadRow = sideThread ? workspace?.tasks.find(task => task.id === sideThread.taskId && !task.deletedAt && !task.archivedAt) : undefined;
  const threadOpen = panel === 'thread' && sideThreadRow !== undefined && sideThread?.mainTaskId === selected;
  const sidePaneOpen = detailsOpen || threadOpen;
  const detailsOpenRef = useRef(sidePaneOpen); detailsOpenRef.current = sidePaneOpen;
  // Several crews or orglets picked in the sidebar (COD-214), and the section whose edit button is in its Done
  // state. Both live here only: nothing is stored, and rows that leave the workspace leave the selection.
  const [selection, setSelection] = useState<SidebarSelection>(noSelection);
  const [selecting, setSelecting] = useState<SidebarSelectionSection | null>(null);
  const selectionActiveRef = useRef(false); selectionActiveRef.current = selection.section !== null || selecting !== null;
  const clearSelection = () => { setSelection(noSelection); setSelecting(null); };
  // The empty channel on screen (COD-361): created, with no message yet, so it has no row. Its first message creates
  // the row; a channel deleted meanwhile, or written in elsewhere, leaves the screen.
  const [emptyChannelId, setEmptyChannelId] = useState<string>();
  const emptyChannelIdRef = useRef(emptyChannelId); emptyChannelIdRef.current = emptyChannelId;
  // The channel being created or edited in its dialog, if one is open.
  const [channelDraft, setChannelDraft] = useState<ChannelDraft>();
  useEffect(() => {
    if (!workspace) return;
    const listed = (section: SidebarSelectionSection) => section === 'workers' ? workspace.workers.map(item => item.id) : [];
    setSelection(current => current.section ? pruneSelection(current, listed(current.section)) : current);
    setEmptyChannelId(current => current && workspace.emptyChannels.some(channel => channel.id === current) ? current : undefined);
  }, [workspace]);
  // The areas on the far-left rail (COD-366). Which one is open is chrome kept in this browser; Activity's Done and
  // Running views stand where the notices and the running list used to open as dialogs, so the back and forward steps
  // that remember them (COD-202) keep working.
  const [area, setAreaState] = useState<Area>(readArea);
  // The space whose channels the Channels area lists (docs/spaces-design.md); none lists the channels outside every space.
  const [openSpaceId, setOpenSpaceState] = useState(readOpenSpace);
  const setOpenSpace = (spaceId: string) => { setOpenSpaceState(spaceId); writeOpenSpace(spaceId); };
  // The rail folders that are closed, by folded name. UI chrome: a folder itself is the name its spaces carry.
  const [closedFolders, setClosedFoldersState] = useState(readClosedFolders);
  const setClosedFolders = (names: string[]) => { setClosedFoldersState(names); writeClosedFolders(names); };
  const [spaceDraft, setSpaceDraft] = useState<SpaceDraft>();
  // Where a dragged channel would land in the open space: a category's id, or `root` for directly in the space.
  const [channelDropAt, setChannelDropAt] = useState<string>();
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft>();
  const setArea = (next: Area) => { setAreaState(next); writeArea(next); };
  const [friendsOpen, setFriendsOpen] = useState(false);
  // Which of Home's two pages is open: making an orglet, or the marketplace, which has its own row in the sidebar.
  const [homePage, setHomePage] = useState<HomePageView>('add');
  const [activityTab, setActivityTab] = useState<ActivityTab>('needs');
  const [membersOpen, setMembersOpen] = useState(() => { try { return localStorage.getItem('orglet.members') !== 'hidden'; } catch { return true; } });
  const toggleMembers = () => setMembersOpen(current => { try { localStorage.setItem('orglet.members', current ? 'hidden' : 'shown'); } catch { /* chrome only */ } return !current; });
  const [newOrgletName, setNewOrgletName] = useState('');
  const [friendsBusy, setFriendsBusy] = useState(false);
  const savedMessages = useSavedMessages();
  const noticesOpen = area === 'activity' && activityTab === 'done';
  const runningOpen = area === 'activity' && activityTab === 'running';
  const showActivity = (tab: ActivityTab) => { setActivityTab(tab); setArea('activity'); };
  /** Whether a channel is in a space that still exists; one in no space is listed in Home, beside the DMs. */
  const inSpace = (channel: { spaceId?: string } | undefined) => Boolean(channel?.spaceId && workspaceRef.current?.spaces.some(space => space.id === channel.spaceId));
  /** The area a chat belongs to: a space's channel in that space, every other chat in Home. */
  const areaOfTask = (task: Task | undefined): Area => inSpace(task?.channel) ? 'channels' : 'home';
  const leaveActivity = () => setAreaState(current => {
    if (current !== 'activity') return current;
    const open = selectedRef.current ? workspaceRef.current?.tasks.find(task => task.id === selectedRef.current) : undefined;
    const next = areaOfTask(open);
    writeArea(next);
    return next;
  });
  const setNoticesOpen = (open: boolean) => { if (open) showActivity('done'); else if (noticesOpen) leaveActivity(); };
  const setRunningOpen = (open: boolean) => { if (open) showActivity('running'); else if (runningOpen) leaveActivity(); };
  const unreadNotices = useUnreadNotices();
  useAppChangeNotices(workspace?.recentAppChanges);
  // A side thread or a schedule's run that finishes while the person is elsewhere says so, with Open (COD-247,
  // COD-258); any chat that stops while the window is in the background also raises a system notification.
  useChatNotices(workspace, selected, taskId => openTask(taskId), () => openRoutines());
  // Everything in the sidebar footer that waits for you reads the same way: a dot on the icon and a count (user, 2026-09-23).
  // A schedule that did not run (its folder gone, files that could not start) waits for you as much as a missed one (COD-294).
  const pendingRoutines = workspace?.routines.filter(item => item.pending || item.notice).length ?? 0;
  const knowledgeToReview = workspace?.knowledge.filter(item => item.status === 'proposed').length ?? 0;
  // Runs under way or in line (COD-244), a plain count; and beside it, in the accent, the chats that wait for the
  // person (COD-287), which a paused crew used to hide behind a button with no count.
  const runningNow = runningCount(workspace?.running ?? []);
  const waitingForYou = waitingForPersonCount(workspace?.running ?? []);
  // Read when a restart is asked for, which can be from a toast raised long before (COD-304).
  const runningNowRef = useRef(runningNow);
  runningNowRef.current = runningNow;
  const restartToUpdate = () => {
    void restartIntoUpdate(runningNowRef.current).catch(failure => toast((failure as Error).message, 'error', t('Cập nhật')));
  };
  const update = useCached(updateStates, window.orglet ? APP_KEY : undefined);
  const updateMark = updateIndicator(update);
  // Full sidebar or the rail (COD-340): the stored mode, written back when the person folds or opens it, never when a
  // narrow window folds it for them.
  const [searchOpen, setSearchOpen] = useState(false); const [sidebar, setSidebar] = useState(() => readSidebarMode() === 'full' && innerWidth > 780); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  // Dragging tracks the pointer; a width is the distance from the window edge minus the gap the panel sits in.
  const sidebarPane = usePaneWidth({ storageKey: 'orglet.sidebar-width', bounds: SIDEBAR_WIDTH, widthFromPointer: clientX => clientX - shellGap(), widerKey: 'ArrowRight' });
  const detailsPane = usePaneWidth({ storageKey: 'orglet.details-width', bounds: DETAILS_WIDTH, widthFromPointer: clientX => innerWidth - clientX - shellGap(), widerKey: 'ArrowLeft' });
  const sidebarWidth = sidebarPane.width;
  const resizing = sidebarPane.resizing || detailsPane.resizing;
  const windowWidth = useWindowWidth();
  // The rail stays on screen whenever the full sidebar is not a column of its own: folded, or laid over a narrow window.
  const narrowWindow = windowWidth <= 780;
  const railShown = !sidebar || narrowWindow;
  const leftColumnWidth = railShown ? RAIL_WIDTH : sidebarWidth;
  const detailsWidth = detailsPaneWidth(detailsPane.width, windowWidth, leftColumnWidth);
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
  const workspaceRef = useRef(workspace); workspaceRef.current = workspace;
  // Set when the first-run account question is answered, so the refresh that follows moves to the app as a transition.
  const leavingAccountChoice = useRef(false);
  // The open chat, once a refresh found the workspace no longer lists it, and where the view goes instead (COD-282).
  const [goneChat, setGoneChat] = useState<{ taskId: string; destination?: ChatDestination }>();
  /** What was being done when the banner's error was set; the notice centre shows it under the message (COD-174). */
  const errorAbout = useRef<string | undefined>(undefined);
  const taskName = (taskId: string) => workspace ? taskNameOf(workspace, taskId) : undefined;
  const entityName = (kind: 'worker' | 'team', entityId: string) => {
    if (!workspace) return undefined;
    const listed = kind === 'worker' ? [...workspace.workers, ...workspace.archivedWorkers] : [...workspace.teams, ...workspace.archivedTeams];
    return listed.find(item => item.id === entityId)?.name;
  };
  const refresh = useCallback(async () => {
    const requestId = ++refreshId.current;
    const selected = selectedRef.current;
    // The open chat's row as last seen, so a chat that disappears can hand over to its own orglet or crew.
    const previousRow = selected ? workspaceRef.current?.tasks.find(task => task.id === selected) ?? taskDetails.get(selected)?.task : undefined;
    try {
      // Harness detection is cached after its first, slow run. Waiting for it here held every refresh — and so the first
      // settings change after launch — for about three seconds, so it lands on its own.
      void orglet.call('harnesses', { refresh: false }).then(setHarnesses).catch(() => undefined);
      // Everything a refresh needs goes out at once (COD-218): reading the open task before the workspace was a
      // waterfall on every change event. Its seen stamp is merged below from whichever copy is newer, so the
      // order the two land in does not matter. The chat's reads are settled one by one and never fail the refresh
      // (COD-282): a chat archived, deleted or erased since refuses some of them, and the sidebar must still follow.
      const chatReads: Promise<OpenChatReads> | undefined = selected
        ? Promise.allSettled([
          taskDetails.refresh(selected),
          orglet.call('workspaceAccess', { taskId: selected }),
          orglet.call('workspaceRecovery', { taskId: selected }),
        ]).then(([detailRead, grantRead, recoveryRead]) => ({ detail: detailRead, grant: grantRead, recovery: recoveryRead }))
        : undefined;
      const [next, connectionState] = await Promise.all([orglet.call('workspace', {}), orglet.connections()]);
      const reads = chatReads ? await chatReads : undefined;
      if (requestId !== refreshId.current) return;
      followWorkspace(next);
      const openChat = selected && reads ? openChatRefresh(selected, next.tasks, reads) : undefined;
      const taskDetail = openChat && !openChat.gone ? openChat.detail : undefined;
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
      const showWorkspace = () => {
        setWorkspace({ ...next, tasks });
        setConnections(connectionState);
        setWorkerId(value => value || next.workers[0]?.id || '');
      };
      // The first workspace replaces the startup screen, and an answered account choice replaces that screen (COD-341).
      const screenChanges = !workspaceRef.current || leavingAccountChoice.current;
      leavingAccountChoice.current = false;
      if (screenChanges) swapScreen(showWorkspace);
      else showWorkspace();
      if (selected && openChat?.gone) {
        setGoneChat({ taskId: selected, destination: closedChatDestination(previousRow, next) });
        return;
      }
      // A failed read keeps the copy on screen rather than blanking the chat.
      if (!selected || taskDetail) setDetail(taskDetail);
      setWorkspaceAccess(selected && openChat && !openChat.gone && openChat.grant !== undefined ? { taskId: selected, grant: openChat.grant } : undefined);
      setWorkspaceRecovery(openChat && !openChat.gone ? openChat.recovery : undefined);
      if (selected && openChat && !openChat.gone && openChat.error) {
        errorAbout.current = taskNameOf(next, selected);
        setError(openChat.error);
      }
    } catch (err) { if (requestId === refreshId.current) { errorAbout.current = t('Đọc dữ liệu từ phần lõi'); setError((err as Error).message); } }
  }, []);
  // A chat the workspace stopped listing (deleted, or erased with the chat history) closes to its orglet's or crew's
  // main chat, or the first orglet, rewriting the history entry rather than adding one (COD-282).
  useEffect(() => {
    if (!goneChat) return;
    setGoneChat(undefined);
    if (selectedRef.current !== goneChat.taskId) return;
    replaceNextView.current = true;
    const destination = goneChat.destination;
    if (destination?.kind === 'team') openTeam(destination.id);
    else if (destination) openWorker(destination.id);
    else leaveThread();
  }, [goneChat]);
  useEffect(() => {
    if (!window.orglet) { setError(t('Mở Orglet bằng pnpm dev để dùng desktop core. Bản web không có quyền truy cập dữ liệu.')); return; }
    return orglet.onChange(() => void refresh());
  }, [refresh]);
  // Every run's live step, from launch, so the Running view shows what a run is doing even if it opens mid-run.
  useEffect(() => {
    if (!window.orglet) return;
    return watchRunProgress();
  }, []);
  // The updater's state is kept in one place for the sidebar and the About tab. A downloaded update is announced once,
  // quietly: a toast with a restart, kept in Notifications, and the button beside Settings until the restart. Nothing
  // interrupts the chat, and Squirrel uses the new build on the next launch anyway (COD-176, COD-304).
  useEffect(() => {
    if (!window.orglet) return;
    return orglet.onUpdate(state => {
      const previous = updateStates.get(APP_KEY);
      updateStates.set(APP_KEY, state);
      if (!becameReady(previous, state) || state.status !== 'ready') return;
      toast(readyUpdateLabel(state.version), 'success', t('Cập nhật'), { unread: true, update: true, action: { label: t('Khởi động lại'), onSelect: restartToUpdate } });
    });
  }, []);
  useEffect(() => { if (window.orglet) void refresh(); }, [refresh, selected]);
  useEffect(() => { if (selected) rememberOpenChat(selected); }, [selected]);
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
  // top of it comes with it: a pale accent needs dark ink, or the send arrow disappears into its own button. So does
  // the accent as text, one colour per theme, which the palette blocks in styles.css pick from (COD-250).
  useEffect(() => {
    const accent = workspace?.accentColor ?? DEFAULT_ACCENT_COLOR;
    const root = document.documentElement.style;
    root.setProperty('--accent', accent);
    root.setProperty('--accent-ink', accentInk(accent));
    root.setProperty('--accent-text-light', accentText(accent, 'light'));
    root.setProperty('--accent-text-dark', accentText(accent, 'dark'));
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
  // A narrow window folds the sidebar to the rail; widening it again brings back the mode the person chose, which is
  // kept apart from what the width did (dogfood, 2026-09-26: after 740 px and back, the sidebar stayed hidden).
  useEffect(() => {
    const media = matchMedia('(max-width: 780px)');
    const followWidth = () => {
      if (media.matches) setSidebar(false);
      else setSidebar(readSidebarMode() === 'full');
    };
    media.addEventListener('change', followWidth);
    return () => media.removeEventListener('change', followWidth);
  }, []);
  // The sidebar folds into, and opens out of, the rail tile of what it lists, the way a window goes to its icon
  // (user, 2026-10-04): this points the motion's origin at that tile.
  const aimSidebarAtTile = () => {
    const tile = document.querySelector('.area-tile.active') ?? document.querySelector('.area-tile');
    const shell = document.querySelector<HTMLElement>('.app');
    if (!tile || !shell) return;
    const box = tile.getBoundingClientRect();
    shell.style.setProperty('--sidebar-origin-y', `${Math.round(box.top + box.height / 2 - shell.getBoundingClientRect().top)}px`);
  };
  const closeSidebar = () => {
    aimSidebarAtTile();
    setSidebar(false);
    // Closing the sidebar laid over a narrow window is not a choice of mode; folding it in a wide one is.
    if (matchMedia('(max-width: 780px)').matches) return;
    writeSidebarMode('rail');
    reportFeature('rail');
  };
  // A folded sidebar shows itself over the chat while the pointer is on the rail or on it, and goes when the pointer
  // leaves both (user, 2026-10-04). The short delay lets the pointer cross the gap between the two.
  const [sidebarPeek, setSidebarPeek] = useState(false);
  // The look lists the tile the pointer is on, or was last on, not only the area on screen. It is kept while the
  // look closes, so the list does not change on its way out, and forgotten when the next look starts.
  const [peekList, setPeekList] = useState<SidebarList>();
  const peekTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const peekSidebar = (inside: boolean) => {
    clearTimeout(peekTimer.current);
    if (inside) {
      if (!matchMedia('(max-width: 780px)').matches) {
        aimSidebarAtTile();
        if (!sidebarPeek) setPeekList(undefined);
        setSidebarPeek(true);
      }
      return;
    }
    peekTimer.current = setTimeout(() => setSidebarPeek(false), 220);
  };
  const openFullSidebar = () => {
    aimSidebarAtTile();
    clearTimeout(peekTimer.current);
    setSidebarPeek(false);
    setPeekList(undefined);
    setSidebar(true);
    // A narrow window lays the full sidebar over the chat for a moment; only a wide one makes it the mode.
    if (!matchMedia('(max-width: 780px)').matches) writeSidebarMode('full');
  };
  // The copy on screen is the one worth keeping: a handful of recent chats makes switching instant.
  useEffect(() => { if (detail) taskDetails.set(detail.task.id, detail); }, [detail]);
  // A search result opens its chat at the message it found (COD-267), the way a reply's quote jumps to the original.
  // A kept copy of the chat can be older than that message, so the jump waits for the fresh copy before giving up.
  const [messageToShow, setMessageToShow] = useState<{ taskId: string; messageId: string }>();
  useEffect(() => {
    if (!messageToShow) return;
    if (selected !== messageToShow.taskId) { setMessageToShow(undefined); return; }
    if (detail?.task.id !== messageToShow.taskId) return;
    const frame = requestAnimationFrame(() => {
      const found = document.getElementById(`message-${messageToShow.messageId}`);
      if (found) focusMessage(messageToShow.messageId);
      if (found || showingCachedDetail.current !== messageToShow.taskId) setMessageToShow(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [detail, selected, messageToShow]);
  const leaveThread = () => { setSelected(null); setDetail(undefined); setEmptyChannelId(undefined); setBrief(''); setSources([]); setSkippedSources([]); setError(''); };
  const hideTaskLocally = (taskId: string, field: 'archivedAt' | 'deletedAt') => {
    const stamp = new Date().toISOString();
    setWorkspace(current => current ? { ...current, tasks: current.tasks.map(task => task.id === taskId ? { ...task, [field]: task[field] ?? stamp } : task) } : current);
  };
  /** Whether the right panel shows at this window width; the stylesheet hides it below these widths (`.details-pane`). */
  const sidePanelFits = () => innerWidth > 1000 || (innerWidth > 860 && !sidebar);
  /**
   * The main chat a side thread opens beside, in the right panel (COD-365, like a Slack thread), or nothing when the
   * thread should fill the main pane as before: the window has no room for the panel, or its main chat is archived
   * or deleted and so cannot be opened beside it.
   */
  const mainChatBeside = (id: string): string | undefined => {
    const row = workspace?.tasks.find(task => task.id === id);
    if (!row?.sideOf || !sidePanelFits()) return undefined;
    const mainTaskId = row.sideOf.taskId;
    const main = workspace?.tasks.find(task => task.id === mainTaskId && !task.deletedAt && !task.archivedAt);
    return main?.id;
  };
  const showThreadBeside = (id: string, mainTaskId: string, messageId?: string) => {
    if (mainTaskId !== selectedRef.current) openInPane(mainTaskId);
    setSideThread({ taskId: id, mainTaskId, messageId });
    setPanel('thread');
  };
  /** Opens a chat: a side thread beside its main chat when there is room, anything else in the main pane. */
  const openTask = (id: string, options: { toMessage?: boolean } = {}) => {
    if (leavingPage(() => openTask(id, options))) return;
    const mainTaskId = mainChatBeside(id);
    if (mainTaskId) {
      showThreadBeside(id, mainTaskId);
      return;
    }
    openInPane(id, options);
  };
  // Re-opening the task already shown keeps its detail; clearing it would wait for a reload that never comes.
  // `toMessage` is set when a message in the chat takes focus instead of the main pane (a search result, COD-267).
  const openInPane = (id: string, { toMessage = false }: { toMessage?: boolean } = {}) => {
    // The ref, not this render's `selected`: a toast's Undo runs a closure from the render before its chat was left.
    if (id !== selectedRef.current) {
      const cached = taskDetails.get(id);
      showingCachedDetail.current = cached ? id : null;
      setSelected(id);
      setDetail(cached);
    }
    setError('');
    setEmptyChannelId(undefined);
    setFriendsOpen(false);
    const opened = workspace?.tasks.find(task => task.id === id);
    if (opened) setArea(areaOfTask(opened));
    if (opened?.channel) setOpenSpace(opened.channel.spaceId ?? '');
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
    if (matchMedia('(max-width: 780px)').matches) {
      setSidebar(false);
      if (!toMessage) setTimeout(() => document.getElementById('main-content')?.focus(), 0);
    }
  };
  const openChatAt = (taskId: string, messageId?: string) => {
    const mainTaskId = mainChatBeside(taskId);
    if (mainTaskId) {
      // The thread in the panel brings the message into view itself once it has loaded.
      showThreadBeside(taskId, mainTaskId, messageId);
      setMessageToShow(undefined);
      return;
    }
    openInPane(taskId, { toMessage: Boolean(messageId) });
    setMessageToShow(messageId ? { taskId, messageId } : undefined);
  };
  const openTeam = (id: string) => {
    if (leavingPage(() => openTeam(id))) return;
    setTeamId(id);
    setFriendsOpen(false);
    const crewChannel = workspace?.tasks.find(task => task.teamId === id && task.channel)?.channel ?? workspace?.emptyChannels.find(channel => channel.crewId === id);
    if (inSpace(crewChannel)) setOpenSpace(crewChannel!.spaceId!);
    setArea(inSpace(crewChannel) ? 'channels' : 'home');
    const live = workspace ? liveTeamTask(workspace.tasks, id) : undefined;
    if (live) { setBrief(''); openTask(live.id); return; }
    leaveThread();
    if (matchMedia('(max-width: 780px)').matches) setSidebar(false);
    setTimeout(() => composer.current?.focus(), 0);
  };
  const openWorker = (id: string) => {
    if (leavingPage(() => openWorker(id))) return;
    setWorkerId(id);
    setTeamId('');
    setFriendsOpen(false);
    setArea('home');
    const live = workspace ? liveWorkerTask(workspace.tasks, id) : undefined;
    if (live) { setBrief(''); openTask(live.id); return; }
    leaveThread();
    if (matchMedia('(max-width: 780px)').matches) setSidebar(false);
    setTimeout(() => composer.current?.focus(), 0);
  };
  /** A channel nobody has written in yet (COD-361): its empty chat, where the first message creates its row. */
  const showEmptyChannel = (channelId: string) => {
    // One where the lead splits the work is the crew's empty chat (COD-369); the workspace may be newer than this render.
    const crewId = workspaceRef.current?.emptyChannels.find(channel => channel.id === channelId)?.crewId;
    if (crewId) { openTeam(crewId); return; }
    setTeamId('');
    leaveThread();
    setFriendsOpen(false);
    // A channel just made may not be in this render's workspace yet; it was made in the place on screen, which stays.
    const waiting = workspaceRef.current?.emptyChannels.find(channel => channel.id === channelId);
    if (waiting) {
      setOpenSpace(waiting.spaceId ?? '');
      setArea(inSpace(waiting) ? 'channels' : 'home');
    }
    setEmptyChannelId(channelId);
    if (matchMedia('(max-width: 780px)').matches) setSidebar(false);
    setTimeout(() => composer.current?.focus(), 0);
  };
  /** A channel just created opens empty, once the workspace lists it. */
  const channelCreated = (channelId: string) => {
    void refresh().then(() => showEmptyChannel(channelId));
  };
  // Which chat is on screen, Slack-style (COD-355): the roster rows pick an orglet's or crew's main chat, and the Open
  // list keeps the other chats at hand. Whatever opens a chat (the rail, the sidebar, search, a notification, Send to,
  // a forward) changes what is on screen, and the lists follow from that, so no opener has to know about them. Closing
  // an Open row only takes it off the list.
  const [openChats, setOpenChats] = useState<OpenChats>(readOpenChats);
  const activeChatKey = workspace ? chatKeyForView({ selected, teamId, workerId, pendingGroup: Boolean(emptyChannelId) }, workspace.tasks) : undefined;
  // Another chat brings its own layout: the right column is in place at once instead of folding in while the main
  // card changes width under the messages (renderer/chatSwitch.ts). Set while rendering, so it is on the same frame.
  const [layoutChatKey, setLayoutChatKey] = useState(activeChatKey);
  const [chatSwitching, setChatSwitching] = useState(false);
  if (layoutChatKey !== activeChatKey) {
    setLayoutChatKey(activeChatKey);
    setChatSwitching(true);
    markChatSwitch();
  }
  useEffect(() => {
    if (!chatSwitching) return;
    const timer = setTimeout(() => setChatSwitching(false), CHAT_SWITCH_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [chatSwitching, activeChatKey]);
  // The first orglet is on screen for one frame before the start reopens the last chat; it is not a visit.
  const [chatsBooted, setChatsBooted] = useState(false);
  useEffect(() => { if (workspace && !workspace.workers.length) setChatsBooted(true); }, [workspace]);
  useEffect(() => { writeOpenChats(openChats); }, [openChats]);
  // Which chats have a row of their own in the sidebar (a side thread, a schedule's newest run, a listed channel):
  // they are never put on the Open list, so no chat is listed twice (owner, 2026-10-01). Filled in on each render.
  const chatsWithRow = useRef(new Set<string>());
  const chatHasRow = (key: string) => chatsWithRow.current.has(key);
  // The Open list as shown, for Ctrl+W: a chat that is not on it has nothing to close.
  const shownOpenKeys = useRef<readonly string[]>([]);
  // While Ctrl+Tab walks the recent chats, the list stays as it was when the walk began (`walkRecent`).
  const recentWalk = useRef<{ snapshot: readonly string[]; position: number }>(undefined);
  useEffect(() => {
    if (activeChatKey && chatsBooted && !recentWalk.current) setOpenChats(state => visitChat(state, activeChatKey, isRosterChat(activeChatKey) || chatHasRow(activeChatKey)));
  }, [activeChatKey, chatsBooted]);
  useEffect(() => {
    if (!workspace) return;
    setOpenChats(state => pruneOpenChats(state, workspace, activeChatKey));
  }, [workspace, activeChatKey]);
  const openChatByKey = (key: string) => {
    const target = parseChatKey(key);
    if (!target) return;
    clearSelection();
    if (target.kind === 'worker') openWorker(target.id);
    else if (target.kind === 'team') openTeam(target.id);
    else openTask(target.id);
  };
  const closeChat = (key: string) => {
    const closed = closeOpenChat(openChats, key, activeChatKey);
    setOpenChats(closed.state);
    if (closed.activate) openChatByKey(closed.activate);
    else if (key === activeChatKey && workspace?.workers[0]) openWorker(workspace.workers[0].id);
    // The × that was clicked leaves with its row: the keyboard carries on in the chat instead of falling to the page.
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) document.getElementById('main-content')?.focus({ preventScroll: true });
    });
  };
  const stepRecent = (step: 1 | -1) => {
    const walk = recentWalk.current ?? { snapshot: walkSnapshot(openChats.recent, activeChatKey), position: 0 };
    const position = walkRecent(walk.snapshot, walk.position, step);
    if (position === undefined) return;
    recentWalk.current = { snapshot: walk.snapshot, position };
    openChatByKey(walk.snapshot[position]);
  };
  const endRecentWalk = () => {
    if (!recentWalk.current) return;
    recentWalk.current = undefined;
    const landed = shortcutState.current.activeChatKey;
    if (landed) setOpenChats(state => visitChat(state, landed, isRosterChat(landed) || chatHasRow(landed)));
  };
  // Ctrl+Tab and Ctrl+Shift+Tab walk the recent chats while Ctrl is held, Ctrl+W closes the open chat when it is on the
  // Open list. Ctrl+W is always taken: left to the window it would close Orglet. While a dialog is over the page they
  // do nothing.
  const shortcutState = useRef({ stepRecent, closeChat, activeChatKey, endRecentWalk });
  shortcutState.current = { stepRecent, closeChat, activeChatKey, endRecentWalk };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      const walking = event.key === 'Tab';
      const closing = event.key.toLowerCase() === 'w' && !event.shiftKey;
      if (!walking && !closing) return;
      event.preventDefault();
      if (document.querySelector('[role=dialog]')) return;
      const current = shortcutState.current;
      if (walking) current.stepRecent(event.shiftKey ? -1 : 1);
      // Only a chat on the Open list closes; on a roster chat, a side thread or a schedule run Ctrl+W does nothing.
      else if (current.activeChatKey && shownOpenKeys.current.includes(current.activeChatKey)) current.closeChat(current.activeChatKey);
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.key === 'Control') shortcutState.current.endRecentWalk();
    };
    const blur = () => shortcutState.current.endRecentWalk();
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
    };
  }, []);
  // The right panel and the view (COD-355) are remembered per chat for this session: a chat whose details were open,
  // or that was showing its files, opens that way again. The view belongs to the chat's row, not to its orglet: the
  // fresh chat that follows an archived one, or an empty chat's first message, starts on Chat.
  const detailsChats = useRef(new Set<string>());
  const [chatViews, setChatViews] = useState<Record<string, ChatViewName>>({});
  const activeChatKeyRef = useRef(activeChatKey);
  // Anything else that changes what the main panel shows (search, a notification, the Friends row) leaves an open
  // Library or Schedules page too. A schedule with unsaved changes stays until the person decides.
  useEffect(() => {
    if (pagePanelRef.current && !routineDirty.current) setPanel(null);
  }, [activeChatKey, area, friendsOpen]);
  activeChatKeyRef.current = activeChatKey;
  const chatViewKey = selected ?? activeChatKey;
  const chatViewKeyRef = useRef(chatViewKey);
  chatViewKeyRef.current = chatViewKey;
  const showChatView = (view: ChatViewName) => {
    const key = chatViewKeyRef.current;
    if (!key) return;
    if (view !== 'chat') reportFeature('tabs');
    setChatViews(current => current[key] === view ? current : { ...current, [key]: view });
  };
  useEffect(() => {
    if (!activeChatKey) return;
    const wanted = detailsChats.current.has(activeChatKey);
    setPanel(current => {
      // A side thread stays open beside its own main chat; moving to any other chat closes it.
      if (current === 'thread' && sideThreadRef.current?.mainTaskId === selectedRef.current) return current;
      if (current === 'thread') return wanted ? 'activity' : null;
      if (wanted && current === null) return 'activity';
      if (!wanted && current === 'activity') return null;
      return current;
    });
  }, [activeChatKey]);
  useEffect(() => {
    const key = activeChatKeyRef.current;
    if (!key) return;
    if (detailsOpen) detailsChats.current.add(key);
    else detailsChats.current.delete(key);
  }, [detailsOpen]);
  // An orglet or crew just created opens its chat (COD-255), once a workspace that lists it has arrived. Selecting it
  // any earlier would be undone by the check that falls back to the first orglet when the id is not listed yet.
  useEffect(() => {
    if (!workspace || !justCreated) return;
    const listed = justCreated.kind === 'worker'
      ? workspace.workers.some(item => item.id === justCreated.id)
      : workspace.teams.some(item => item.id === justCreated.id);
    if (!listed) return;
    setJustCreated(undefined);
    if (justCreated.kind === 'worker') openWorker(justCreated.id);
    else openTeam(justCreated.id);
  }, [workspace, justCreated]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        if (teamId) openTeam(teamId);
        else if (emptyChannelId) composer.current?.focus();
        else if (workerId) openWorker(workerId);
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true); }
      // A dialog or menu that took this Escape has already prevented it; otherwise a sidebar selection goes first.
      if (event.key === 'Escape' && !event.defaultPrevented && selectionActiveRef.current) { event.preventDefault(); clearSelection(); return; }
      // The details panel is part of the page, not a dialog, so Escape has to close it here, unless a dialog opened from
      // it (the desktop app picker, a screenshot) took this Escape first.
      if (event.key === 'Escape' && !event.defaultPrevented && detailsOpenRef.current) { event.preventDefault(); setPanel(null); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [teamId, workerId, emptyChannelId, workspace]);
  // First paint only: if this worker already has a live thread, show it so the empty composer cannot silently
  // reviseTask a hidden row. After the user archives or leaves, stay on the empty chat — re-running this from a
  // stale workspace would reopen the same thread and hide Thêm nguồn (desktop-smoke attach-sources after archive).
  useEffect(() => {
    if (!workspace || !workerId || bootedLiveThread.current) return;
    bootedLiveThread.current = true;
    setChatsBooted(true);
    if (selected || teamId) return;
    const lastOpen = chatToReopen(workspace.tasks, rememberedChat());
    if (lastOpen) { replaceNextView.current = true; openTask(lastOpen.id); return; }
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
  const toggledCapabilities = (previous: ToolCapability[], capability: ToolCapability, enabled: boolean) => withCapability(previous, capability, enabled);
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
    const avatar = createsOrglet ? { mascot: proposedMascot(proposal, { workers: workspace?.workers ?? [], siblings: detail?.appProposals ?? [proposal] }) } : undefined;
    const applied = await orglet.call('applyAppProposal', { id: proposal.id, avatar });
    if (applied.target?.kind === 'template') {
      const saved = await orglet.exportTemplate(applied.target.id);
      toast(saved ? t('Đã lưu template') : t('Chưa lưu template. Xuất lại từ Thiết lập kênh khi cần.'), saved ? 'success' : 'error', proposal.title);
    }
  };
  const openProposalTarget = (target: ProposalTarget) => {
    if (!workspace) return;
    if (target.kind === 'worker') { const found = workspace.workers.find(item => item.id === target.id); if (found) { setEditingWorker(found); setPanel('worker'); } return; }
    if (target.kind === 'team' || target.kind === 'template') { editCrewChannel(target.id); return; }
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
  // The channel the crew on screen stands for while it is empty (COD-369); once written in, its row carries the record.
  const crewChannel = team ? workspace?.emptyChannels.find(channel => channel.crewId === team.id) : undefined;
  // The empty channel stands while it is listed and someone in it can answer; its orglets are its members expanded.
  const emptyChannel = workspace ? openEmptyChannel(emptyChannelId, workspace.emptyChannels, workspace) : undefined;
  const channelWorkers = emptyChannel ? emptyChannel.workerIds.map(id => workspace?.workers.find(item => item.id === id)).filter((item): item is Worker => Boolean(item)) : [];
  const executionWorkers = team ? teamRoster(team, workspace!.workers) : emptyChannel ? channelWorkers : worker ? [worker] : [];
  // Plan usage by the empty chat's bar (COD-326); an open chat's bar reads its own through FollowUpComposer.
  const emptyChatUsage = usePlanUsageBar({ workers: selected ? [] : executionWorkers, harnesses, running: false, action, openSettings: () => openSettings('harness') });
  /**
   * An orglet's or crew's chat is its one live row. When that row starts somewhere other than this composer (the
   * `orglet` terminal command) while the empty chat is on screen, the view switches to it, so a question it asks,
   * such as an MCP approval (COD-241), is not left behind the empty screen. Only a row that appears while the empty
   * chat is shown is adopted; a chat that already existed when the view was entered, as at startup, is left alone.
   */
  const emptyChatBaseline = useRef<{ key: string; liveId?: string }>(undefined);
  /**
   * Switches to the live chat that appeared. Whatever the empty chat's message box held, typed, linked or sent from
   * Explorer, moves to that chat's message bar instead of being dropped (COD-246), text and files alike (COD-257).
   * A message being sent right now is not a draft.
   */
  const adoptLiveChat = (liveId: string) => {
    const carried = busy ? {} : carriedDraft({ text: brief, sources, skipped: skippedSources });
    if (emptyDraftKey) dropDraft(emptyDraftKey);
    openTask(liveId);
    if (!carried.text && !carried.intake) return;
    setBrief('');
    setSources([]);
    setSkippedSources([]);
    setFollowUpPrefill({ taskId: liveId, ...carried, at: Date.now() });
  };
  useEffect(() => {
    const key = team ? `team:${team.id}` : worker ? `worker:${worker.id}` : '';
    if (selected || !workspace || emptyChannel || !key) {
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
    // A chat this box is creating right now is opened by the send itself, with the words typed meanwhile (COD-284).
    if (adopted && !busy) adoptLiveChat(adopted);
  }, [workspace, selected, team?.id, worker?.id, emptyChannel?.channelId]);
  /**
   * The empty chat's message bar keeps what was typed and added, per orglet, crew or channel, across restarts
   * (COD-257, `drafts.ts`): leaving for another chat and coming back finds it there. Entering an empty chat puts its
   * draft back, in front of anything a link or Send to put there on the way in; every change after that is kept.
   */
  const emptyDraftKey = selected ? undefined : emptyChatDraftKey(team ? { teamId: team.id } : emptyChannel ? { channelId: emptyChannel.channelId } : { workerId: worker?.id });
  const shownDraftKey = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (shownDraftKey.current !== emptyDraftKey) {
      shownDraftKey.current = emptyDraftKey;
      const saved = emptyDraftKey ? readDraft(emptyDraftKey) : undefined;
      if (!saved) return;
      setBrief(current => current.trim() ? withPrefill(saved.text, current) : saved.text);
      setSources(current => attachIntake(saved.intake.sources, { sources: current, skipped: [] }).sources);
      setSkippedSources(current => [...saved.intake.skipped, ...current]);
      return;
    }
    if (emptyDraftKey) keepDraft(emptyDraftKey, { text: brief, intake: { sources, skipped: skippedSources } });
  }, [emptyDraftKey, brief, sources, skippedSources]);
  // An empty chat has no row yet, so its permissions wait under the worker, team or a channel's orglets until the
  // first message (COD-178, COD-215, COD-361), and so does its working folder (COD-186).
  const newChatTarget: NewChatTarget | undefined = team ? { teamId: team.id } : emptyChannel ? { workerIds: emptyChannel.workerIds } : worker ? { workerId: worker.id } : undefined;
  // An empty channel in a space with no choice of its own shows what its space sets, which is what its first message takes.
  const emptyChannelSpace = workspace?.spaces.find(space => space.id === workspace.emptyChannels.find(channel => channel.id === emptyChannelId)?.spaceId);
  const newChatCapabilities = newChatTarget ? workspace?.newChatCapabilities[newChatKey(newChatTarget)] ?? (emptyChannel ? spaceChatCapabilities(emptyChannelSpace) : undefined) : undefined;
  const newChatWorkspace = newChatTarget ? workspace?.newChatWorkspace[newChatKey(newChatTarget)] : undefined;
  const changeNewChatCapability = (capability: ToolCapability, enabled: boolean) => toolAction(() => {
    if (!newChatTarget) return Promise.resolve();
    const previous = newChatCapabilities ?? snapshotCapabilities(executionWorkers[0]?.provider ?? 'demo');
    const capabilities = toggledCapabilities(previous, capability, enabled);
    return orglet.call('setToolCapabilities', { ...newChatTarget, capabilities });
  });
  const changeNewChatWorkspace = (level: WorkspaceLevel, folder: FolderChoice) => toolAction(async () => {
    if (!newChatTarget) return;
    if (level === 'none') await orglet.call('revokeWorkspace', newChatTarget);
    else if (folder === 'keep') await orglet.call('setWorkspaceLevel', { ...newChatTarget, permissions: permissionsForLevel(level) });
    else await orglet.pickNewChatWorkspace(newChatTarget, permissionsForLevel(level));
  });
  const nativeProviders = [...new Set(executionWorkers.map(item => item.provider).filter(provider => provider !== 'demo'))];
  // Labels far from the workspace ask this module whether sample replies are on; only tests and smokes turn them on.
  setDemoReplies(workspace?.demoReplies);
  const isDemo = nativeProviders.length === 0;
  const ready = readiness(connections, harnesses, workspace?.customConnections);
  const missingConnections = nativeProviders.filter(provider => !ready[provider]);
  // Choosing a model and attaching sources is the user's consent to send them; no separate permission step.
  // A channel is budgeted like a chat with the orglet that owns its row, the first one that answers.
  const taskBudgetMicros = (team ?? channelWorkers[0] ?? worker)?.taskBudgetMicros ?? 500_000;
  const emptyChannelName = emptyChannel ? channelLabel(emptyChannel.name) : undefined;
  const unavailable = t('Chưa sẵn sàng');
  const recipientReady = (providers: Worker['provider'][]) => providers.every(provider => provider === 'demo' || ready[provider as keyof typeof ready]);
  const recipientValue = teamId ? `team:${teamId}` : emptyChannel ? channelRecipient(emptyChannel.channelId) : workerId;
  /**
   * The settings of the channel a crew stands for (COD-369), where its lead, workflow, budget and hours are edited
   * now: from a proposal card, a refused archive or anything else that names the crew.
   */
  const editCrewChannel = (crewId: string) => {
    const row = workspace?.tasks.find(task => task.channel?.crewId === crewId && !task.deletedAt);
    const channel = row?.channel ?? workspace?.emptyChannels.find(item => item.crewId === crewId);
    if (channel) setChannelDraft({ id: channel.id, name: channel.name, topic: channel.topic, members: channel.members, crewId, category: channel.category, spaceId: channel.spaceId, categoryId: channel.categoryId, access: channel.access });
  };
  const pickRecipient = (value: string) => {
    if (value.startsWith('team:')) { openTeam(value.slice(5)); return; }
    openWorker(value);
  };
  /** The row the first message of this empty chat creates: a team's lead, the channel's first orglet, or the worker. */
  const firstMessageInput = (message: Omit<TaskInput, 'workerId' | 'teamId' | 'assignees'>): TaskInput => {
    if (team) return { ...message, workerId: team.synthesizerId, teamId: team.id };
    if (emptyChannel) return channelTaskInput(emptyChannel, message);
    return { ...message, workerId };
  };
  // What the empty chat's box holds now, read once a send is through (COD-284).
  const briefNow = useRef(brief);
  briefNow.current = brief;
  /**
   * The box empties at once and stays enabled while the first message goes, so the next one can be typed straight
   * away (COD-284). Whatever was typed meanwhile, and the focus, move on to the chat's message bar.
   */
  const send = async () => {
    if (!brief.trim() || busy || (!team && !worker && !emptyChannel)) return;
    // An orglet with no model does not answer: the way to connect one opens, and the text stays in the box.
    const unconnected = demoReplies() ? undefined : demoWorkerToConnect(executionWorkers, team);
    if (unconnected) {
      connectModel(unconnected);
      return;
    }
    setBusy(true); setError('');
    const sentBrief = brief;
    setBrief('');
    try {
      // An empty channel has no live thread to continue: its first message always creates the row.
      const thread = team ? liveTeamTask(workspace!.tasks, team.id) : emptyChannel ? undefined : liveWorkerTask(workspace!.tasks, workerId);
      let chatId: string;
      if (thread) {
        await orglet.call('reviseTask', { taskId: thread.id, brief: sentBrief, sourceIds: sources.map(source => source.id), excludedSources: skippedSources, consent: true, providerScopes: nativeProviders, budgetMicros: thread.budgetMicros, ...planFirstInput(emptyDraftKey) });
        chatId = thread.id;
      } else {
        chatId = await orglet.call('createTask', { ...firstMessageInput({ brief: sentBrief, sourceIds: sources.map(source => source.id), excludedSources: skippedSources, consent: true, providerScopes: nativeProviders, budgetMicros: taskBudgetMicros }), ...planFirstInput(emptyDraftKey) });
      }
      // Plan first stays chosen on the chat the message went to, until the person picks another mode or follows the plan.
      movePlanFirst(emptyDraftKey, taskDraftKey(chatId));
      // The chat's bar exists only once its detail is on screen. Loading it before switching keeps this box, and the
      // keys typed into it, until the bar takes over. The switch is one synchronous commit, so no key lands between
      // reading what was typed and the bar that carries it on.
      const opened = await taskDetails.refresh(chatId).catch(() => undefined);
      const typedSince = briefNow.current;
      const typing = document.activeElement === composer.current;
      flushSync(() => {
        if (!thread) setEmptyChannelId(undefined);
        setSelected(chatId);
        if (opened) setDetail(opened);
        if (typedSince.trim() || typing) setFollowUpPrefill({ taskId: chatId, text: typedSince.trim() ? typedSince : undefined, at: Date.now() });
        // Sent, so this empty chat's bar holds nothing any more.
        if (emptyDraftKey) dropDraft(emptyDraftKey);
        setBrief(''); setSources([]);
      });
    } catch (err) {
      setBrief(current => restoreUnsent(sentBrief, current));
      errorAbout.current = t('Gửi tin cho {0}', [(team ? channelLabel(team.name) : undefined) ?? emptyChannelName ?? worker?.name ?? '']);
      setError((err as Error).message);
    } finally { setBusy(false); }
  };
  const close = () => {
    const continueConnecting = panel === 'settings' ? connectingWorker : undefined;
    setPanel(null);
    setWorkerDialogTab(undefined);
    setWorkerDialogField(undefined);
    setWorkerDialogConnect(false);
    setConnectingWorker(undefined);
    void refresh().then(() => { if (continueConnecting) setResumeConnect(continueConnecting); });
  };
  /** The orglet's settings on its Model field, starting on the first connection that can run (COD-293). */
  const openWorkerOnModel = (target: Worker) => {
    setEditingWorker(target);
    setWorkerDialogField('provider');
    setWorkerDialogConnect(true);
    setPanel('worker');
  };
  /** "Kết nối model" under a Demo chat's message box: see `connectModelStep` for where it leads. */
  const connectModel = (target: Worker) => {
    const options = workerProviderOptions(readiness(connections, harnesses, workspace?.customConnections), harnesses ?? [], workspace?.customConnections ?? []);
    if (connectModelStep(options) === 'orglet') {
      openWorkerOnModel(target);
      return;
    }
    setConnectingWorker(target.id);
    openSettings('connections');
  };
  /**
   * The ways to give an orglet with no model one, for its empty chat. A way with a connection that can run now opens
   * the orglet's Model field; any other opens Settings where that kind of connection is set up, and comes back to the
   * orglet once one can run.
   */
  const connectWays = (target: Worker): ConnectWay[] => {
    const ready = readiness(connections, harnesses, workspace?.customConnections);
    const readyNames = (providers: readonly Worker['provider'][]) => providers.filter(provider => ready[provider as keyof typeof ready]).map(providerName);
    // Until the harnesses have been looked for, none of them counts as ready.
    const plans = harnesses ? readyNames(['claude-code', 'codex', 'cursor', 'gemini']) : [];
    const keys = readyNames(['openai', 'anthropic', 'xai', 'openrouter', 'opencode-zen', 'opencode-go', ...(workspace?.customConnections ?? []).map(connection => customProviderId(connection.id))]);
    const local = readyNames(['ollama']);
    const pick = (names: readonly string[], tab: SettingsTab) => () => {
      if (names.length) {
        openWorkerOnModel(target);
        return;
      }
      setConnectingWorker(target.id);
      openSettings(tab);
    };
    return [
      { id: 'plan', ready: plans, onPick: pick(plans, 'harness') },
      { id: 'key', ready: keys, onPick: pick(keys, 'connections') },
      { id: 'local', ready: local, onPick: pick(local, 'connections') },
    ];
  };
  // Back from Settings opened by "Kết nối model": the orglet's settings follow when a connection can run now, the
  // way an editor opened from the Library goes back to it. Closed without adding one, nothing more opens.
  useEffect(() => {
    if (!resumeConnect || !workspace) return;
    setResumeConnect(undefined);
    const target = workspace.workers.find(item => item.id === resumeConnect);
    const options = workerProviderOptions(readiness(connections, harnesses, workspace.customConnections), harnesses ?? [], workspace.customConnections);
    if (target && panel === null && connectModelStep(options) === 'orglet') openWorkerOnModel(target);
  }, [resumeConnect]);
  /** The trace above an answer links to the worker's Memory tab (COD-220): the dialog opens on that tab this once. */
  const openWorkerMemories = (workerId: string) => {
    const found = workspace?.workers.find(item => item.id === workerId);
    if (!found) return;
    // In that orglet's own chat the memories are a view of the chat (COD-355); from a crew or another chat, its dialog.
    const ownChat = detail && detail.task.id === selected && !detail.task.teamId && !detail.task.assignees && detail.task.workerId === workerId;
    if (ownChat && workspace && memoriesOf(workspace.knowledge, { kind: 'worker', id: workerId }).length > 0) {
      showChatView('memory');
      return;
    }
    setWorkerDialogTab('memory');
    setEditingWorker(found);
    setPanel('worker');
  };
  const openRoutines = (view: RoutineView = { editing: false }) => { setRoutineDraft(undefined); setRoutineView(view); setPanel('routines'); };
  // Back and forward through what was opened (COD-202). The view is read off the state each render, so whatever
  // changed it is the step; a data refresh changes none of these fields and records nothing.
  const view = appView({ chat: selected, recipient: recipientValue, panel, settingsTab, libraryTab, fromLibrary, skillId: editingSkill?.id, knowledgeId: editingKnowledge?.id, workerId: editingWorker?.id, taskId: editingTask, routineEditing: routineView.editing, routineId: routineView.editing ? routineView.routine?.id : undefined, noticesOpen, runningOpen, sourceId: viewingSource?.id });
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
      const channelTarget = channelFromRecipient(target.recipient);
      const known = target.recipient.startsWith('team:') ? workspace.teams.some(item => `team:${item.id}` === target.recipient)
        : channelTarget ? workspace.emptyChannels.some(channel => channel.id === channelTarget)
        : workspace.workers.some(item => item.id === target.recipient);
      if (!known) return false;
    }
    if (!target.item) return true;
    switch (target.panel) {
      case 'skill': return workspace.skills.some(item => item.id === target.item);
      case 'knowledge': return workspace.knowledge.some(item => item.id === target.item);
      case 'worker': return [...workspace.workers, ...workspace.archivedWorkers].some(item => item.id === target.item);
      case 'task': return workspace.tasks.some(item => item.id === target.item);
      case 'routines': return workspace.routines.some(item => item.id === target.item);
      default: return true;
    }
  };
  const showView = (target: AppView) => {
    if (!workspace) return;
    if (target.chat) { if (target.chat !== selected) openTask(target.chat); }
    else if (selected || target.recipient !== recipientValue) {
      // The empty chat of that worker, team or channel; if a worker or team has a live thread by now, that thread
      // opens and the entry is rewritten. An empty channel comes back while it is still empty.
      const channelTarget = channelFromRecipient(target.recipient);
      if (target.recipient.startsWith('team:')) openTeam(target.recipient.slice('team:'.length));
      else if (channelTarget) showEmptyChannel(channelTarget);
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
  // A click on a system notification (COD-258): main brings the window forward, the window opens that chat.
  const openTaskFromNotification = useRef<(taskId: string) => void>(() => undefined);
  openTaskFromNotification.current = taskId => {
    if (!workspace?.tasks.some(task => task.id === taskId && !task.deletedAt)) return;
    setPanel(null);
    setNoticesOpen(false);
    setRunningOpen(false);
    openTask(taskId);
  };
  useEffect(() => window.orglet?.onOpenTask?.(taskId => openTaskFromNotification.current(taskId)), []);
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
    if (selected || emptyChannel) return false;
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
  const closeSendTo = () => {
    if (sentFiles) void orglet.dropSentFiles(sentFiles.id).catch(() => undefined);
    setSentFiles(undefined);
  };
  /**
   * The files go where the person picked, the way the file picker's files do: into the message box of that chat,
   * whether it is empty or already has a conversation (COD-257). Nothing is sent.
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
        setFollowUpPrefill({ taskId: thread, intake, at: Date.now() });
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
  /**
   * Sends the message the picker is open for to the places picked (COD-257). The core makes each one a turn there; the
   * toast says where it went and names every place it did not, and the picker stays open when nothing went.
   */
  const sendForward = async (choice: ForwardChoice) => {
    if (!forwarding) return;
    const request = forwarding;
    setForwardSending(true);
    errorAbout.current = t('Chuyển tiếp tin nhắn');
    setError('');
    try {
      const result = await orglet.call('forwardMessage', { taskId: request.taskId, messageId: request.messageId, targets: choice.targets.map(option => option.forwardTarget), ...(choice.note ? { note: choice.note } : {}), carrySourceIds: choice.carrySourceIds });
      if (result.sent.length) setForwarding(undefined);
      const only = result.sent.length === 1 ? result.sent[0].taskId : undefined;
      toast(forwardSummary(result.sent.length, result.failed), result.failed.length ? 'error' : 'success', t('Chuyển tiếp tin nhắn'),
        only ? { action: { label: t('Mở'), onSelect: () => openTask(only) } } : {});
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setForwardSending(false);
    }
  };
  const workerOrder = useReorder(workspace?.workers.map(item => item.id) ?? [], ids => action(() => orglet.call('reorder', { kind: 'workers', ids })));
  // Only orglets are picked together: crews are channels now (COD-369), and channels have no select mode.
  const sectionOrder = (_section: SidebarSelectionSection) => workerOrder.order;
  const sectionKind = (_section: SidebarSelectionSection) => 'worker' as const;
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
    // Archiving is the step back from deleting, so it can be taken back at once, like a single row's archive.
    const undo = verb === 'archive' ? { action: { label: t('Hoàn tác'), onSelect: () => restoreEntities(kind, ids) }, archive: true } : {};
    toast(bulkDoneMessage(verb, done), 'success', undefined, undo);
  };
  const restoreEntities = (kind: 'worker' | 'team', ids: readonly string[]) => rowAction(async () => {
    for (const id of ids) await orglet.call('archiveEntity', { kind, id, archived: false });
    toast(t('Đã khôi phục'), 'success');
  });
  /**
   * A command from a sidebar row's menu. Its failure is a toast where the person clicked, with the way out when there
   * is one, never a banner over whichever chat happens to be open (COD-286: an orglet refused because of its crews
   * reported it inside an unrelated side thread).
   */
  const rowAction = (perform: () => Promise<unknown>, about?: string, wayOut?: () => ToastAction | undefined) => {
    void perform().then(() => refresh()).catch(err => {
      const action = wayOut?.();
      toast((err as Error).message, 'error', about, action ? { action } : {});
      void refresh();
    });
  };
  /** What to open when an orglet cannot be archived or deleted yet: the channel whose lead gives it work, or the schedule that runs it. */
  const removalWayOut = (kind: 'worker' | 'team', entityId: string): ToastAction | undefined => {
    if (!workspace) return undefined;
    const blocker = removalBlocker(workspace, kind, entityId);
    if (blocker?.kind === 'crews') {
      const crew = blocker.crews[0];
      return { label: t('Mở kênh {0}', [channelLabel(crew.name)]), onSelect: () => editCrewChannel(crew.id) };
    }
    // Normally caught before the core is asked (`heldBySchedule`); this covers a schedule switched on since.
    if (blocker?.kind === 'schedule') return { label: t('Xem lịch chạy'), onSelect: () => openRoutines() };
    return undefined;
  };
  /** After the chat on screen was archived or deleted: a side thread goes back to its orglet's main chat. */
  const leaveClosedChat = (closed: Task | undefined) => {
    if (closed?.sideOf) { openWorker(closed.workerId); return; }
    leaveThread();
  };
  const deleteTask = (taskId: string) => rowAction(async () => {
    const name = taskName(taskId);
    const closed = workspace?.tasks.find(item => item.id === taskId);
    await orglet.call('deleteTask', { id: taskId });
    if (selectedRef.current === taskId) { hideTaskLocally(taskId, 'deletedAt'); leaveClosedChat(closed); }
    toast(t('Đã xóa cuộc trò chuyện'), 'success', name);
  }, taskName(taskId));
  /**
   * Archives or restores a chat. The archive toast offers Undo, which also reopens the chat when it was the one on
   * screen; the restore toast offers Open, since a restored chat may sit far from where its archived row was.
   */
  const archiveTask = (taskId: string, archived: boolean) => rowAction(async () => {
    const name = taskName(taskId);
    const closed = workspace?.tasks.find(item => item.id === taskId);
    const wasOpen = selectedRef.current === taskId;
    await orglet.call('archiveTask', { id: taskId, archived });
    if (archived && wasOpen) { hideTaskLocally(taskId, 'archivedAt'); leaveClosedChat(closed); }
    if (archived) {
      toast(t('Đã lưu trữ cuộc trò chuyện'), 'success', name, { action: { label: t('Hoàn tác'), onSelect: () => restoreTask(taskId, wasOpen) }, archive: true });
      return;
    }
    toast(t('Đã khôi phục cuộc trò chuyện'), 'success', name, { action: { label: t('Mở'), onSelect: () => openTask(taskId) } });
  }, taskName(taskId));
  /** Undo of an archive: the chat comes back, and back on screen if it was open when it was archived. */
  const restoreTask = (taskId: string, reopen: boolean) => rowAction(async () => {
    await orglet.call('archiveTask', { id: taskId, archived: false });
    if (reopen) openTask(taskId);
  }, taskName(taskId));
  const renameTask = (taskId: string, title: string) => action(() => orglet.call('renameTask', { id: taskId, title }), taskName(taskId));
  /** A channel nobody has written in yet has no row to rename, so its own record takes the new name (COD-361). */
  const renameEmptyChannel = (channelId: string, name: string) => {
    const channel = workspace?.emptyChannels.find(item => item.id === channelId);
    if (!channel) return;
    action(() => orglet.call('updateChannel', { id: channelId, name, topic: channel.topic ?? '', members: channel.members }), channelLabel(channel.name));
  };
  /** Deletes a channel nobody has written in; there is no history to keep, so no archive and no Undo. */
  const deleteEmptyChannel = (channelId: string, name: string) => rowAction(async () => {
    await orglet.call('deleteChannel', { id: channelId });
    if (emptyChannelId === channelId) leaveThread();
    toast(t('Đã xóa kênh'), 'success', channelLabel(name));
  }, channelLabel(name));
  setDisplayCurrency(workspace?.currency);
  // Phase 5 of the avatar animations: a row that was just created rises into the list once. This sits above the
  // loading return, because a hook must run on every render and the workspace arrives after the first one.
  const isArriving = useArrivals(workspace ? workspace.workers.map(item => `worker-${item.id}`) : [], Boolean(workspace));
  // The shell is drawn before the workspace arrives (COD-218): the same frame, the same sidebar width, the lists
  // and the chat filled in as skeletons, so the window never opens on a blank page or a centred wait.
  if (!workspace) return <Startup error={error} onRetry={window.orglet ? () => void refresh() : undefined} sidebar={sidebar} sidebarWidth={sidebarWidth} />;
  // A new install asks once, before the app, whether to sign in or stay local (COD-337); the answer is kept and the
  // workspace it comes back in drops this screen. Anyone who already has chats, or updated from an older build, never sees it.
  if (needsAccountChoice(workspace, account)) return <>
    <AccountChooser account={account} onChoose={async choice => {
      await orglet.call('accountChoice', { choice });
      leavingAccountChoice.current = true;
      await refresh();
    }} />
    <Toaster />
  </>;
  /** A worker row resting under the pointer fetches its live chat and its model list ahead of the click. */
  const dwellWorker = (item: Worker) => (resting: boolean) => {
    const live = liveWorkerTask(workspace.tasks, item.id);
    if (live) dwellChat(live.id, resting);
    dwellModels(item.provider, resting);
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
  ];
  const archiveState = ({ archivedAt }: { archivedAt?: string }): ArchiveState | undefined => {
    if (!archivedAt || !workspace) return undefined;
    const retention = workspace.archiveRetentionDays;
    if (!retention) return { daysLeft: null, tone: 'fresh' };
    const daysLeft = Math.max(0, Math.ceil(retention - (Date.now() - new Date(archivedAt).getTime()) / 86_400_000));
    const share = daysLeft / retention;
    return { daysLeft, tone: share > 0.5 ? 'fresh' : share > 0.2 ? 'aging' : 'expiring' };
  };
  /**
   * An orglet or crew with a schedule switched on cannot be archived or deleted; the core refuses. Instead of that dead
   * end, say which schedule holds it and open Schedules, where it can be turned off or deleted (COD-283). Crews come
   * first, as in the core's refusal, so an orglet in a crew hears about the crew (COD-286).
   */
  const heldBySchedule = (kind: 'worker' | 'team', entityId: string): boolean => {
    const blocker = removalBlocker(workspace, kind, entityId);
    if (blocker?.kind !== 'schedule') return false;
    const name = entityName(kind, entityId) ?? '';
    toast(t('Lịch {0} đang bật cho {1}. Tắt hoặc xóa lịch đó trước.', [blocker.schedule.name, name]), 'info', name, { action: { label: t('Xem lịch chạy'), onSelect: () => openRoutines() } });
    return true;
  };
  const archiveEntity = (kind: 'worker' | 'team', entityId: string, archived: boolean) => {
    if (archived && heldBySchedule(kind, entityId)) return;
    archiveOrRestoreEntity(kind, entityId, archived);
  };
  const archiveOrRestoreEntity = (kind: 'worker' | 'team', entityId: string, archived: boolean) => rowAction(async () => {
    const name = entityName(kind, entityId);
    await orglet.call('archiveEntity', { kind, id: entityId, archived });
    const undo = archived ? { action: { label: t('Hoàn tác'), onSelect: () => archiveEntity(kind, entityId, false) }, archive: true } : {};
    toast(archived ? t('Đã lưu trữ') : t('Đã khôi phục'), 'success', name, undo);
  }, entityName(kind, entityId), () => removalWayOut(kind, entityId));
  const deleteEntity = (kind: 'worker' | 'team', entityId: string) => {
    if (heldBySchedule(kind, entityId)) return;
    deleteEntityNow(kind, entityId);
  };
  const deleteEntityNow = (kind: 'worker' | 'team', entityId: string) => rowAction(async () => {
    const name = entityName(kind, entityId);
    await orglet.call('deleteEntity', { kind, id: entityId });
    toast(t('Đã xóa'), 'success', name);
  }, entityName(kind, entityId), () => removalWayOut(kind, entityId));
  const activeTasks = workspace.tasks.filter(task => !task.archivedAt);
  // Channels for their own sidebar section, written in or still empty, newest first (COD-268, COD-361).
  const channelEntries = sidebarChannels(workspace.tasks, workspace.emptyChannels);
  const channelChats = openChannelChats(workspace.tasks);
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
  /**
   * The rows under an orglet's or crew's row, newest first and a few at a time, each with its own mark: an orglet's
   * side threads (COD-247) and the newest run of each schedule it ran for (COD-258), named after the schedule.
   */
  const rowsUnder = (owner: ChatOwner, ownerName: string): { children?: ReactNode; childrenLabel?: string } => {
    const chats = chatsUnder(workspace.tasks, workspace.routines, owner);
    if (!chats.length) return {};
    const hasThreads = chats.some(chat => chat.kind === 'side');
    const hasSchedules = chats.some(chat => chat.kind === 'schedule');
    const childrenLabel = hasThreads && hasSchedules ? t('Chat phụ và lịch chạy của {0}', [ownerName])
      : hasSchedules ? t('Lịch chạy của {0}', [ownerName])
      : t('Chat phụ của {0}', [ownerName]);
    const children = <ShowMore items={chats} limit={3} empty="" isActive={chat => selected === chat.task.id} render={chat => {
      const task = chat.task;
      const status = taskStatusMark(task.status, taskSeen(task));
      const open = () => { clearSelection(); openTask(task.id); };
      const dwell = (resting: boolean) => dwellChat(task.id, resting);
      if (chat.kind === 'schedule') {
        const routine = chat.routine;
        return <ScheduleRunRow key={`schedule-${routine.id}`} name={routine.name} active={selected === task.id} status={status} onOpen={open} onDwell={dwell}
          onOpenSchedule={() => openRoutines({ editing: true, routine })} onArchive={() => archiveTask(task.id, true)} onDelete={() => deleteTask(task.id)} />;
      }
      return <SideThreadRow key={task.id} name={taskName(task.id) ?? task.brief} active={selected === task.id} status={status} onOpen={open} onDwell={dwell}
        onRename={title => renameTask(task.id, title)} onArchive={() => archiveTask(task.id, true)} onDelete={() => deleteTask(task.id)} />;
    }} />;
    return { children, childrenLabel };
  };
  /** A channel where the lead splits the work lists its schedules' newest runs under it, as its crew did (COD-369). */
  const channelRowsUnder = (crewId: string | undefined, channelName: string) => crewId ? rowsUnder({ teamId: crewId }, channelLabel(channelName)) : {};
  /**
   * What Settings → Lưu trữ lists (COD-375): the archived orglets, channels and chats that used to hang off the sidebar,
   * grouped by `archive.ts`. A chat shows the face of whose it was, a channel its `#`; Restore returns the item to the
   * sidebar section it came from, and Delete permanently asks that kind's own question first.
   */
  const archivedChannelMark = <span className="archived-channel-mark" aria-hidden="true"><Hash size={14} /></span>;
  const archivedChatRow = (task: Task, kind: ArchivedChatKind): ArchiveSection['rows'][number] => {
    const routine = kind === 'schedule' ? workspace.routines.find(item => item.id === task.routineId) : undefined;
    const name = routine?.name ?? taskName(task.id) ?? task.brief;
    const { ownerName, mark } = archivedChatOwner(task, name);
    const whose = kind === 'side' ? t('Chat phụ với {0}', [ownerName])
      : kind === 'schedule' ? t('Lần chạy lịch cho {0}', [ownerName])
      : kind === 'channel' ? t('Kênh {0}', [ownerName])
      : t('Chat với {0}', [ownerName]);
    const deleteQuestion = kind === 'side' ? t('Xóa chat phụ này? Không thể hoàn tác.')
      : kind === 'schedule' ? t('Xóa lần chạy này? Không thể hoàn tác.')
      : kind === 'channel' ? t('Xóa kênh này cùng lịch sử của nó? Không thể hoàn tác.')
      : t('Xóa cuộc trò chuyện này? Không thể hoàn tác.');
    return { key: `chat:${task.id}`, name, mark, whose, archive: archiveState(task)!, deleteQuestion, onRestore: () => archiveTask(task.id, false), onDelete: () => deleteTask(task.id) };
  };
  /** Whose an archived chat was, named and drawn the way that orglet or channel is in its own row. */
  const archivedChatOwner = (task: Task, chatName: string): { ownerName: string; mark: ReactNode } => {
    // A crew's chat from before crews became channels reads as that channel (COD-369).
    if (task.teamId && !task.channel) {
      const crew = [...workspace.teams, ...workspace.archivedTeams].find(item => item.id === task.teamId);
      const ownerName = channelLabel(crew?.name ?? task.teamSnapshot?.name ?? t('Kênh đã xóa'));
      return { ownerName, mark: archivedChannelMark };
    }
    if (task.assignees || task.channel) {
      const members = taskWorkers(task, workspace);
      const ownerName = channelLabel(channelNameOf(task, members.map(member => member.name)));
      return { ownerName, mark: archivedChannelMark };
    }
    const owner = [...workspace.workers, ...workspace.archivedWorkers].find(item => item.id === task.workerId);
    if (!owner) return { ownerName: t('Tí đã xóa'), mark: <Avatar name={chatName} seed={task.id} size="xs" /> };
    return { ownerName: owner.name, mark: <Avatar name={owner.name} seed={owner.id} mascot={owner.avatar?.mascot} defaultMascot hint={owner.description} color={owner.avatar?.color} size="xs" /> };
  };
  const archiveSections: ArchiveSection[] = archiveGroups({ workers: workspace.archivedWorkers, teams: workspace.archivedTeams, tasks: workspace.tasks }).map(group => ({
    id: group.id,
    rows: group.entries.map(entry => {
      if (entry.type === 'worker') {
        const { worker } = entry;
        return { key: `worker:${worker.id}`, name: worker.name, archive: archiveState(worker)!,
          mark: <Avatar name={worker.name} seed={worker.id} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="xs" />,
          onRestore: () => archiveEntity('worker', worker.id, false), onDelete: () => deleteEntity('worker', worker.id) };
      }
      if (entry.type === 'team') {
        const { team } = entry;
        return { key: `team:${team.id}`, name: channelLabel(team.name), archive: archiveState(team)!, mark: archivedChannelMark,
          onRestore: () => archiveEntity('team', team.id, false), onDelete: () => deleteEntity('team', team.id) };
      }
      return archivedChatRow(entry.task, entry.kind);
    }),
  }));

  const workerStatus = (id: string): StatusMarkState => {
    const live = liveWorkerTask(activeTasks, id);
    return live
      ? tasksStatusMark([{ status: live.status, seen: taskSeen(live) }])
      : tasksStatusMark(activeTasks.filter(task => taskWorkers(task, workspace).some(item => item.id === id)).map(task => ({ status: task.status, seen: taskSeen(task) })));
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
  const detailsWorker = detailsTeam || emptyChannel ? undefined : detail ? workspace.workers.find(item => item.id === detail.task.workerId) : worker;
  // Openers for the empty chat, read from this workspace rather than a fixed list (COD-48).
  const chatTasks = workspace.tasks.filter(task => team ? task.teamId === team.id : emptyChannel ? false : !task.teamId && task.workerId === workerId);
  const starters = suggestStarters({ worker: emptyChannel ? undefined : worker, team, members: emptyChannel ? channelWorkers : roster, skills: workspace.skills, tasks: chatTasks, hasSources: sources.length > 0 });
  const pickStarter = (prompt: string) => {
    setBrief(prompt);
    const textarea = composer.current;
    if (!textarea) return;
    // The caret belongs at the end: most openers stop at a colon for the person to keep typing.
    setTimeout(() => { textarea.focus(); textarea.setSelectionRange(prompt.length, prompt.length); }, 0);
  };
  // The right-hand control of the toolbar under the prompt bar. A one-to-one chat names its worker in the header already, so the spot
  // carries the model the worker will answer with instead of a list holding that one name (user, 2026-09-19).
  // A chat with nobody chosen yet keeps the recipient list, where it is how you choose. A channel, including one
  // where the lead splits the work (COD-369), is named in the header, so its prompt bar carries neither control.
  const composerTrailing = emptyChannel || team ? undefined
    : worker && !team && worker.provider !== 'demo'
      // An empty choice means whatever the provider defaults to, and a stored id may not be empty, so it is dropped.
      ? <ComposerModel worker={{ ...worker, provider: worker.provider }}
        onChange={modelId => action(() => orglet.call('saveWorker', { ...worker, modelId: modelId || undefined }))} />
      : recipientOptions.length > 0
        ? <Select className="composer-to-select" ariaLabel={t('Đang nhắn với {0}', [worker?.name ?? t('Tí')])} value={recipientValue} onChange={pickRecipient} showDetail={false} showIcon={false} menuMinWidth={320} options={recipientOptions} />
        : undefined;
  // One provider behind this chat, or none to name: a team split across providers says nothing in the header and
  // lets the details panel list them. It is who answers the next message, read from the orglets as saved, so a switch
  // from Demo shows at once instead of after the next turn (COD-293); each earlier answer names its own in its byline.
  const chatProviders = [...new Set((selected && detail ? openTaskWorkers : executionWorkers).map(item => item.provider))];
  const headerProvider = chatProviders.length === 1 ? chatProviders[0] : undefined;
  const chatName = team?.name ?? emptyChannelName ?? worker?.name ?? 'Orglet';
  // The name as a title: a channel's without its hash, which is its icon in a list (user, 2026-10-04).
  const chatTitle = team?.name ?? emptyChannel?.name ?? worker?.name ?? 'Orglet';
  // What the orglet does, or the channel's topic, under its name where the chat starts.
  const chatIntro = (team ? undefined : emptyChannel ? emptyChannel.topic : worker?.description)?.trim();
  const openSideThread = selected && detail?.task.sideOf ? detail.task : undefined;
  // The header's ⋯ leads with the settings of whoever this chat talks to (COD-293); the chat's own name, assignees
  // and limit follow as "Thiết lập chat". A chat not loaded yet offers neither rather than guess from the sidebar.
  const openRow = selected ? detail?.task ?? workspace.tasks.find(task => task.id === selected) : undefined;
  const headerSettings = selected
    ? openRow ? chatSettingsTarget({ task: openRow }, workspace) : undefined
    : chatSettingsTarget({ worker, team, group: Boolean(emptyChannel) }, workspace);
  const headerSettingsItems = headerSettings?.kind === 'worker'
    ? [{ label: t('Thiết lập Tí'), icon: UserRoundCog, onSelect: () => { setEditingWorker(headerSettings.worker); setPanel('worker'); } }]
    : [];
  // A schedule's run is named after its schedule, so it does not read as the orglet's main chat (COD-258).
  const openScheduleRun = selected && detail?.task.routineId ? detail.task : undefined;
  const openSchedule = openScheduleRun ? workspace.routines.find(item => item.id === openScheduleRun.routineId) : undefined;
  // The open chat takes no new message while it, or the orglet or crew it belongs to, is archived or deleted (COD-282).
  const openChatClosure = selected && detail ? chatClosure(detail, workspace) : undefined;
  const closedOwner = openChatClosure?.owner;
  const closedOwnerName = closedOwner ? closedOwner.name || (closedOwner.kind === 'team' ? t('Kênh này') : t('Tí này')) : undefined;
  const readOnlyChat: ReadOnlyChat | undefined = !selected || !openChatClosure ? undefined
    : openChatClosure.archived ? { note: t('Cuộc trò chuyện này đã được lưu trữ. Khôi phục để nhắn tiếp.'), action: { label: t('Khôi phục'), onSelect: () => archiveTask(selected, false) } }
    : closedOwner?.state === 'archived' ? { note: t('{0} đã được lưu trữ. Khôi phục để nhắn tiếp.', [closedOwnerName]), action: { label: t('Khôi phục'), onSelect: () => archiveEntity(closedOwner.kind, closedOwner.id, false) } }
    : { note: t('{0} đã bị xóa, nên cuộc trò chuyện này chỉ còn để đọc.', [closedOwnerName]) };
  // A deleted schedule's runs keep its name (COD-283), so they still do not read as the orglet's main chat.
  const openScheduleName = openSchedule?.name ?? openScheduleRun?.routineName;
  // The channel on screen, written in or still empty (COD-361): its header is `#name`, its topic and its members' faces.
  const openChannelRow = openRow && isChannelChat(openRow) ? openRow : undefined;
  const headerChannel = openChannelRow?.channel ? { id: openChannelRow.channel.id, name: openChannelRow.channel.name, topic: openChannelRow.channel.topic, members: openChannelRow.channel.members, crewId: openChannelRow.channel.crewId, category: openChannelRow.channel.category, spaceId: openChannelRow.channel.spaceId, categoryId: openChannelRow.channel.categoryId, access: openChannelRow.channel.access, workers: taskWorkers(openChannelRow, workspace), taskId: openChannelRow.id }
    : !selected && emptyChannel ? { id: emptyChannel.channelId, name: emptyChannel.name, topic: emptyChannel.topic, members: emptyChannel.members, crewId: undefined, category: undefined, workers: channelWorkers, taskId: undefined }
    : !selected && crewChannel ? { id: crewChannel.id, name: crewChannel.name, topic: crewChannel.topic, members: crewChannel.members, crewId: crewChannel.crewId, category: crewChannel.category, spaceId: crewChannel.spaceId, categoryId: crewChannel.categoryId, access: crewChannel.access, workers: executionWorkers, taskId: undefined }
    : undefined;
  const editChannel = (initialTab?: 'members') => {
    if (!headerChannel) return;
    setChannelDraft({ id: headerChannel.id, name: headerChannel.name, topic: headerChannel.topic, members: headerChannel.members, crewId: headerChannel.crewId, category: headerChannel.category, spaceId: headerChannel.spaceId, categoryId: headerChannel.categoryId, access: headerChannel.access, initialTab });
  };
  const headerName = headerChannel ? headerChannel.name
    : openSideThread ? taskName(openSideThread.id) ?? openSideThread.brief
    : openScheduleName ? openScheduleName
    : selected ? (detail && assigneeLabel(detail.task, workspace!, { all: t('Toàn bộ Tí'), many: count => memberNames(openTaskWorkers.map(item => item.name)) ?? t('{0} Tí', [count]) })) ?? team?.name ?? closedOwnerName ?? t('Công việc') : chatName;
  // Where the open chat begins, shown above its first message: the orglet's or the channel's name, what it is for
  // and its faces. A side thread and a schedule's run say what they are in their own line instead.
  const threadStart: ThreadStartInfo | undefined = !selected || openSideThread || openScheduleRun ? undefined : {
    // The hash is the channel's icon in a list, not part of its name (user, 2026-10-04).
    name: headerChannel ? headerChannel.name : headerName,
    about: (headerChannel ? headerChannel.topic : headerSettings?.kind === 'worker' ? headerSettings.worker.description : undefined)?.trim() || undefined,
    faces: openTaskWorkers.slice(0, 5).map(item => <Avatar key={item.id} name={item.name} seed={item.id} emoji={item.avatar?.emoji} mascot={item.avatar?.mascot} defaultMascot color={item.avatar?.color} size="xl" />),
  };
  /** The line at the top of a schedule's run: which schedule, who ran it, and the way to the schedule. */
  const scheduleRunOrigin = openScheduleRun && openScheduleName ? {
    name: openScheduleName,
    owner: assigneeLabel(openScheduleRun, workspace, { all: t('Toàn bộ Tí'), many: count => t('{0} Tí', [count]) }) ?? detail?.runs[0]?.snapshot.worker.name ?? 'Orglet',
    openSchedule: openSchedule ? () => openRoutines({ editing: true, routine: openSchedule }) : undefined,
  } : undefined;
  const headerRename = renameTargetOf();
  /**
   * The one orglet or crew this chat belongs to, whose name the header can rename in place (owner, 2026-09-25).
   * A chat for every orglet, or one whose detail has not loaded yet, has no single owner to rename. A channel's header
   * renames the channel (COD-361).
   */
  function renameTargetOf(): { kind: 'team'; team: Team } | { kind: 'worker'; worker: Worker } | { kind: 'thread'; taskId: string } | { kind: 'emptyChannel'; channelId: string } | undefined {
    if (!workspace) return undefined;
    if (selected) {
      const task = detail?.task;
      if (!task) return undefined;
      // A side thread's header is the thread, so it renames the thread, not the orglet (COD-247); a channel's chat
      // renames the channel, which the core does for a rename of its row.
      if (task.sideOf || task.channel) return { kind: 'thread', taskId: task.id };
      // A schedule's run shows the schedule's name, which only the schedule's editor changes: saving there is what
      // approves the schedule to run unattended (COD-258).
      if (task.routineId) return undefined;
      const taskTeam = task.teamId ? workspace.teams.find(item => item.id === task.teamId) : undefined;
      if (taskTeam) return { kind: 'team', team: taskTeam };
      if (task.assignees === 'all') return undefined;
      const owners = taskWorkers(task, workspace);
      return owners.length === 1 ? { kind: 'worker', worker: owners[0] } : undefined;
    }
    if (crewChannel) return { kind: 'emptyChannel', channelId: crewChannel.id };
    if (team) return { kind: 'team', team };
    if (emptyChannel) return { kind: 'emptyChannel', channelId: emptyChannel.channelId };
    if (!worker) return undefined;
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
      const renamedChannel = headerRename?.kind === 'emptyChannel' ? workspace?.emptyChannels.find(channel => channel.id === headerRename.channelId) : undefined;
      if (renamedChannel) await orglet.call('updateChannel', { id: renamedChannel.id, name, topic: renamedChannel.topic ?? '', members: renamedChannel.members });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  };
  /**
   * Carries out a mode chosen under the prompt bar (COD-367): the chat's permissions first, then the folder that mode
   * needs, at the level that lets the orglets edit it. `target` is the open chat or the empty chat's waiting entry.
   */
  const applyModeChange = (target: { taskId: string } | NewChatTarget, change: ModeChange) => toolAction(async () => {
    if (change.capabilities) await orglet.call('setToolCapabilities', { ...target, capabilities: change.capabilities });
    const editable = permissionsForLevel('write');
    if (change.folder === 'edit') await orglet.call('setWorkspaceLevel', { ...target, permissions: editable });
    if (change.folder !== 'pick') return;
    if ('taskId' in target) await orglet.pickWorkspace(target.taskId, editable);
    else await orglet.pickNewChatWorkspace(target, editable);
  });
  const emptyChatModePicker = newChatTarget ? <ChatModePicker planKey={emptyDraftKey}
    capabilities={newChatCapabilities ?? snapshotCapabilities(executionWorkers[0]?.provider ?? 'demo')}
    level={permissionState({ provider: executionWorkers[0]?.provider ?? 'demo', capabilities: newChatCapabilities, grant: null, pending: newChatWorkspace }).workspace} appliesAtOnce={Boolean(team || emptyChannel)} sideThread={false}
    disabled={toolPolicyBusy} onChange={change => applyModeChange(newChatTarget, change)} /> : undefined;
  /** The same picker on an open chat's bar; it reads the chat's permissions and folder the way Details does. */
  const chatModePicker = (taskDetail: TaskDetail) => {
    const grant = workspaceAccess?.taskId === taskDetail.task.id ? workspaceAccess.grant : undefined;
    const provider = taskWorkers(taskDetail.task, workspace!)[0]?.provider ?? 'demo';
    const level = permissionState({ provider, capabilities: taskDetail.task.toolCapabilities, grant, taskId: taskDetail.task.id }).workspace;
    return <ChatModePicker planKey={taskDraftKey(taskDetail.task.id)}
      capabilities={taskDetail.task.toolCapabilities ?? snapshotCapabilities(provider)} level={level}
      appliesAtOnce={Boolean(taskDetail.task.teamId || taskDetail.task.assignees)} sideThread={Boolean(taskDetail.task.sideOf)}
      disabled={toolPolicyBusy || grant === undefined || Boolean(readOnlyChat)} onChange={change => applyModeChange({ taskId: taskDetail.task.id }, change)} />;
  };
  const composerBar = <Composer textareaRef={composer} value={brief} onChange={setBrief} onSubmit={() => void send()} label={t('Tin nhắn')} placeholder={t('Nhắn với {0}…', [(team ? channelLabel(crewChannel?.name ?? team.name) : undefined) ?? emptyChannelName ?? worker?.name ?? t('Tí')])} sendLabel={t('Gửi tin nhắn')} sendDisabled={busy || (!isDemo && missingConnections.length > 0)} mentions={team ? { people: executionWorkers, allNames: [team.name] } : emptyChannel ? { people: channelWorkers } : undefined}
    leading={<SourcePicker onFiles={() => action(async () => { const picked = await orglet.pickSources(); setSources(previous => [...previous, ...picked].slice(0, 20)); })} onFolder={() => action(async () => { const intake = await orglet.pickFolder(); const available = 20 - sources.length; setSources(previous => [...previous, ...intake.sources].slice(0, 20)); setSkippedSources(previous => [...previous, ...intake.skipped, ...intake.sources.slice(available).map(source => ({ name: source.name, reason: t('Task đã có đủ 20 tệp.') }))]); })} />} mode={emptyChatModePicker}
    trailing={composerTrailing} usage={emptyChatUsage.ring}
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
  const deleteSelectionQuestion = t('Xóa {0} Tí đã chọn? Cuộc trò chuyện cũ vẫn giữ lịch sử.', [selectionCount]);
  const selectionBar = selection.section && <div className="selection-bar" role="toolbar" aria-label={t('Mục đã chọn')}>
    <span className="selection-count">{t('{0} đã chọn', [selectionCount])}</span>
    <Button size="icon" className="row-action" aria-label={t('Lưu trữ')} title={t('Lưu trữ')} onClick={() => void applyToSelection('archive')}><Archive size={16} /></Button>
    <RowMenu className="row-action danger" label={t('Xóa')} icon={Trash} asksOnOpen items={[{ label: t('Xóa'), icon: Trash, danger: true, onSelect: () => void applyToSelection('delete'), confirm: { question: deleteSelectionQuestion, label: t('Xóa') } }]} />
    <Button size="icon" className="row-action" aria-label={t('Bỏ chọn')} title={t('Bỏ chọn')} onClick={clearSelection}><SidebarX size={16} /></Button>
  </div>;
  const emptyChatDemoWorker = demoWorkerToConnect(executionWorkers, team);
  /**
   * The browser's level is the person's call (reading pages, or acting on them too), so its hint opens that control
   * in Details rather than choosing a level for them (COD-305).
   */
  const openBrowserControl = () => {
    setPanel('activity');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const control = document.querySelector<HTMLElement>(`.task-tools [aria-label="${t('Trình duyệt')}"]`);
      control?.scrollIntoView({ block: 'center' });
      control?.focus();
    }));
  };
  /** The permission hint under the empty chat's bar (COD-305): what its link does is what Details would do. */
  const emptyChatPermissions = permissionState({ provider: executionWorkers[0]?.provider ?? 'demo', capabilities: newChatCapabilities, grant: null, pending: newChatWorkspace });
  const emptyChatHint: PermissionHintControls | undefined = newChatTarget ? {
    chatKey: newChatKey(newChatTarget),
    permissions: emptyChatPermissions,
    enabled: !isDemo && missingConnections.length === 0 && !emptyChatDemoWorker,
    busy: toolPolicyBusy,
    onApply: need => {
      if (need === 'browser') openBrowserControl();
      else if (need === 'web') changeNewChatCapability('network.web', true);
      else changeNewChatWorkspace(need, emptyChatPermissions.folder ? 'keep' : 'pick');
    },
  } : undefined;
  /** The same hint under an open chat's bar. A side thread takes its permissions from its main chat, so it has none. */
  const chatHint = (taskDetail: TaskDetail): PermissionHintControls => {
    const grant = workspaceAccess?.taskId === taskDetail.task.id ? workspaceAccess.grant : undefined;
    const permissions = permissionState({ provider: taskWorkers(taskDetail.task, workspace!)[0]?.provider ?? 'demo', capabilities: taskDetail.task.toolCapabilities, grant, taskId: taskDetail.task.id });
    return {
      chatKey: taskDetail.task.id,
      permissions,
      enabled: grant !== undefined && !taskDetail.task.sideOf && !readOnlyChat,
      busy: toolPolicyBusy,
      onApply: need => {
        if (need === 'browser') openBrowserControl();
        else if (need === 'web') changeTaskCapability(taskDetail, 'network.web', true);
        else toolAction(async () => {
          if (permissions.workspace === 'none') await orglet.pickWorkspace(taskDetail.task.id, permissionsForLevel(need));
          else await orglet.call('setWorkspaceLevel', { taskId: taskDetail.task.id, permissions: permissionsForLevel(need) });
        });
      },
    };
  };
  const composerHint = missingConnections.length > 0
    ? <p className="composer-note">{t('Cần kết nối trước khi gửi.')}<button onClick={() => openSettings(settingsTabFor(missingConnections))}>{missingConnections.map(provider => setupHint(provider, harnesses)).join(t(' và '))}</button></p>
    : emptyChatDemoWorker
      ? <DemoNote someOnDemo={isDemo ? undefined : emptyChatDemoWorker.name} preflight={isDemo && Boolean(team?.preflight)} onConnect={() => connectModel(emptyChatDemoWorker)} />
      : emptyChatUsage.out ? emptyChatUsage.note
      : emptyChatHint ? <ComposerPermissionHint text={brief} controls={emptyChatHint} fallback={emptyChatUsage.note} /> : emptyChatUsage.note ?? null;
  /** An orglet's face at a given size, the same drawing the sidebar row uses. */
  const workerFace = (item: Worker, size: 'xs' | 'sm') => <Avatar name={item.name} seed={item.id} emoji={item.avatar?.emoji} mascot={item.avatar?.mascot} defaultMascot hint={item.description} color={item.avatar?.color} size={size} />;
  const orderedWorkers = workerOrder.order.map(id => workspace.workers.find(item => item.id === id)).filter((item): item is Worker => Boolean(item));
  /** An empty channel is the one on screen: its own empty chat, or, when the lead splits the work, its crew's (COD-369). */
  const emptyChannelActive = (channel: { id: string; crewId?: string }) => !selected && (channel.crewId ? teamId === channel.crewId : emptyChannel?.channelId === channel.id);
  const channelName = (chat: Task) => channelLabel(channelNameOf(chat, taskWorkers(chat, workspace).map(member => member.name)));
  const channelMark = <Hash size={16} aria-hidden="true" />;
  /** The chat a key stands for: an orglet's or crew's main chat (none before its first message), or the key's own row. */
  const chatOfKey = (key: string): Task | undefined => {
    const target = parseChatKey(key);
    if (!target) return undefined;
    if (target.kind === 'worker') return liveWorkerTask(activeTasks, target.id);
    if (target.kind === 'team') return liveTeamTask(activeTasks, target.id);
    return workspace.tasks.find(task => task.id === target.id);
  };
  /**
   * An open chat's one state. What waits for the person comes from the Running list, the held reviews and, for a
   * browser or desktop step or an app proposal, the chat's last loaded copy: those live only in a chat's detail.
   */
  const openStateOf = (task: Task | undefined): OpenChatState => {
    if (!task) return 'idle';
    const knownCopy = detail?.task.id === task.id ? detail : taskDetails.get(task.id);
    const pendingApproval = Boolean(knownCopy?.browser?.approval || knownCopy?.desktop?.approval || knownCopy?.appProposals.some(proposal => proposal.status === 'pending'));
    const runs = (workspace.running ?? []).filter(item => item.taskId === task.id);
    return openChatState({ status: task.status, seen: taskSeen(task), waitsForPerson: runs.some(waitsForPerson), heldForReview: workspace.heldForReview.includes(task.id), pendingApproval });
  };
  const openChatName = (task: Task) => {
    if (task.routineId) return workspace.routines.find(item => item.id === task.routineId)?.name ?? task.routineName ?? taskName(task.id) ?? task.brief;
    if (isChannelChat(task)) return channelName(task);
    if (task.teamId) return workspace.teams.find(item => item.id === task.teamId)?.name ?? task.teamSnapshot?.name ?? taskName(task.id) ?? task.brief;
    return taskName(task.id) ?? task.brief;
  };
  /** An Open row's face, the size of the roster rows' faces so every name in the column starts at the same place. */
  const openChatFace = (task: Task, size: 'xs' | 'sm') => {
    if (isChannelChat(task)) return channelMark;
    const crew = task.teamId ? workspace.teams.find(item => item.id === task.teamId) : undefined;
    if (crew) return <RosterAvatars workers={teamRoster(crew, workspace.workers)} size={size} max={2} countRest={false} />;
    const owner = [...workspace.workers, ...workspace.archivedWorkers].find(item => item.id === task.workerId);
    return owner ? workerFace(owner, size) : <Avatar name={task.brief} seed={task.id} size={size} />;
  };
  /** The orglet's or crew's name a chat row belongs to, for the Open row's "Side thread of …". */
  const ownerNameOf = (task: Task) => {
    if (task.teamId) return workspace.teams.find(item => item.id === task.teamId)?.name ?? task.teamSnapshot?.name ?? '';
    return [...workspace.workers, ...workspace.archivedWorkers].find(item => item.id === task.workerId)?.name ?? '';
  };
  const openChatItemOf = (key: string): OpenChatItem | undefined => {
    const task = chatOfKey(key);
    if (!task || isRosterChat(key)) return undefined;
    const kind = task.routineId ? 'schedule' : isChannelChat(task) ? 'channel' : task.sideOf ? 'side' : 'earlier';
    const owner = ownerNameOf(task);
    const description = kind === 'schedule' ? t('Lần chạy theo lịch của {0}', [owner])
      : kind === 'channel' ? t('Kênh')
        : kind === 'side' ? t('Chat phụ của {0}', [owner]) : t('Chat cũ của {0}', [owner]);
    return { key, kind, name: openChatName(task), description, face: openChatFace(task, 'sm'), state: openStateOf(task), active: key === activeChatKey,
      onOpen: () => openChatByKey(key), onDwell: resting => dwellChat(task.id, resting) };
  };
  const nestedChats = [
    ...workspace.workers.flatMap(item => chatsUnder(workspace.tasks, workspace.routines, { workerId: item.id })),
    ...workspace.teams.flatMap(item => chatsUnder(workspace.tasks, workspace.routines, { teamId: item.id })),
  ].map(chat => chat.task);
  chatsWithRow.current = new Set([...channelChats, ...nestedChats].map(task => chatKey({ kind: 'task', id: task.id })));
  const openChatItems = shownOpenChats(openChats.open, chatHasRow).map(openChatItemOf).filter((item): item is OpenChatItem => Boolean(item));
  shownOpenKeys.current = openChatItems.map(item => item.key);
  // The views of the chat on screen (COD-355): Chat, then each view with something in it. Files and Changes need the
  // open chat's detail; Schedules and Memory belong to its orglet or crew.
  const viewOwner: ViewOwner | undefined = detail && selected === detail.task.id ? viewOwnerOfTask(detail.task, workspace.routines)
    : !selected && team ? { kind: 'team', id: team.id } : !selected && !emptyChannel && worker ? { kind: 'worker', id: worker.id } : undefined;
  const viewDetail = detail && selected === detail.task.id ? detail : undefined;
  const ownerSchedules = schedulesOf(workspace.routines, viewOwner);
  const ownerMemories = memoriesOf(workspace.knowledge, viewOwner);
  const chatViewList = availableChatViews({
    files: viewDetail?.sources.length ?? 0,
    changes: changedRunCount(viewDetail, workspaceRecovery),
    schedules: ownerSchedules.length,
    memory: ownerMemories.length,
  });
  const chatView = chatViewToShow(chatViewKey ? chatViews[chatViewKey] : undefined, chatViewList);
  const openScheduleEditor = (view: RoutineView) => { setRoutineDraft(undefined); setRoutineView(view); setPanel('routines'); };
  const sourceDetail = viewingSource?.detail ?? detail;
  const chatViewContent = chatView === 'files' && viewDetail ? <SourcePanel detail={viewDetail} target={sourceTarget} refresh={() => void refresh()} openSource={id => setViewingSource({ id })} />
    : chatView === 'changes' && viewDetail ? <ChangesView detail={viewDetail} recovery={workspaceRecovery} action={action} />
      // A schedule opens in the Schedules dialog to be edited, so leaving an unsaved edit asks the one question it always has.
      : chatView === 'schedules' ? <RoutinesPanel workspace={workspace} routines={ownerSchedules} view={{ editing: false }} onView={openScheduleEditor} onDirty={markRoutineDirty} onBack={() => openRoutines()} openTask={openTask} />
        : chatView === 'memory' ? <MemoryList memories={ownerMemories} workspace={workspace} onOpenChat={openTask} />
          : null;
  const renderChannelEntry = (entry: (typeof channelEntries)[number]) => {
          if (entry.kind === 'empty') {
            const channel = entry.channel;
            return <ChannelRow key={channel.id} name={channel.name} locked={Boolean(channel.spaceId) && channel.access === 'listed'} dragId={channel.spaceId ? channel.id : undefined} active={emptyChannelActive(channel)} status={rollupStatusMarks([])}
              onOpen={() => { clearSelection(); showEmptyChannel(channel.id); }}
              onEdit={() => setChannelDraft({ id: channel.id, name: channel.name, topic: channel.topic, members: channel.members, crewId: channel.crewId, category: channel.category, spaceId: channel.spaceId, categoryId: channel.categoryId, access: channel.access })}
              onPublish={workspace.teams.some(team => team.id === channel.crewId) ? () => {
                const team = workspace.teams.find(team => team.id === channel.crewId);
                if (team) setPublishingSource({ kind: 'crew', entityId: team.id, name: team.name });
              } : undefined}
              onRename={name => renameEmptyChannel(channel.id, name)} onDelete={() => deleteEmptyChannel(channel.id, channel.name)}
              deleteQuestion={t('Xóa kênh này? Kênh chưa có tin nhắn nào.')} {...channelRowsUnder(channel.crewId, channel.name)} />;
          }
          const chat = entry.task;
          const name = channelNameOf(chat, taskWorkers(chat, workspace).map(member => member.name));
          return <ChannelRow key={chat.id} name={name} locked={Boolean(chat.channel?.spaceId) && chat.channel?.access === 'listed'} dragId={chat.channel?.spaceId ? chat.channel.id : undefined} active={selected === chat.id} status={taskStatusMark(chat.status, taskSeen(chat))}
            onOpen={() => { clearSelection(); openTask(chat.id); }} onDwell={resting => dwellChat(chat.id, resting)}
            onEdit={() => chat.channel && setChannelDraft({ id: chat.channel.id, name: chat.channel.name, topic: chat.channel.topic, members: chat.channel.members, crewId: chat.channel.crewId, category: chat.channel.category, spaceId: chat.channel.spaceId, categoryId: chat.channel.categoryId, access: chat.channel.access })}
            onPublish={workspace.teams.some(team => team.id === chat.channel?.crewId) ? () => {
              const team = workspace.teams.find(team => team.id === chat.channel?.crewId);
              if (team) setPublishingSource({ kind: 'crew', entityId: team.id, name: team.name });
            } : undefined}
            onRename={title => renameTask(chat.id, title)} onArchive={() => archiveTask(chat.id, true)} onDelete={() => deleteTask(chat.id)}
            deleteQuestion={t('Xóa kênh này cùng lịch sử của nó? Không thể hoàn tác.')} {...channelRowsUnder(chat.channel?.crewId, name)} />;
  };
  // A channel is in a space only while that space exists; one whose space is gone is listed with the loose channels.
  const channelOfEntry = (entry: (typeof channelEntries)[number]) => entry.kind === 'chat' ? entry.task.channel : entry.channel;
  const spaceOfEntry = (entry: (typeof channelEntries)[number]) => workspace.spaces.find(space => space.id === channelOfEntry(entry)?.spaceId);
  const looseChannelEntries = channelEntries.filter(entry => !spaceOfEntry(entry));
  const openSpace = workspace.spaces.find(space => space.id === openSpaceId);
  const channelGroupList = groupChannels(looseChannelEntries, entry => entry.kind === 'chat' ? entry.task.channel?.category : entry.channel.category);
  const activityCountsNow = activityCounts(workspace.running ?? [], savedMessages, pendingRoutines + knowledgeToReview);
  const workingIds = workingOrgletIds(workspace.running ?? []);
  const headerSpace = workspace.spaces.find(space => space.id === headerChannel?.spaceId);
  const crewLeadId = headerChannel?.crewId ? workspace.teams.find(item => item.id === headerChannel.crewId)?.synthesizerId : undefined;
  const pageShown = area === 'activity' || (area === 'home' && friendsOpen);
  const membersShown = Boolean(headerChannel) && membersOpen && !sidePaneOpen && !pageShown && windowWidth > 1100;
  const userStatus = runningNow > 0 || waitingForYou > 0 ? runningButtonLabel(runningNow, waitingForYou) : account?.status === 'signed_in' ? (account.email ? maskEmail(account.email) : t('Đã đăng nhập')) : t('Dùng trên máy này');
  const activityRailLabel = [t('Hoạt động'), activityCountsNow.needs > 0 ? t('{0} chờ bạn', [activityCountsNow.needs]) : '', unreadNotices > 0 ? t('{0} chưa đọc', [unreadNotices]) : ''].filter(Boolean).join(', ');
  const friendTemplates: FriendTemplate[] = [
    { id: 'research-review', name: 'Research Review', description: t('Đọc nguồn, kiểm tra bằng chứng và tổng hợp kết luận.'), orglets: 3 },
    { id: 'eris-review', name: 'Eris Review', description: t('Review challenge, dữ liệu và run logs; chỉ tạo báo cáo.'), orglets: 4 },
  ];
  const addTemplate = (templateId: FriendTemplate['id']) => action(async () => {
    setFriendsBusy(true);
    try {
      const crew = await orglet.call('createTemplate', { templateId, provider: 'demo' }) as Team;
      toast(t('Đã thêm {0}', [crew.name]), 'success');
    } finally {
      setFriendsBusy(false);
    }
  });
  const page = area === 'activity'
    ? <ActivityPage tab={activityTab} onTab={setActivityTab} running={workspace.running ?? []} tasks={workspace.tasks} teams={workspace.teams} saved={savedMessages}
      pendingSchedules={pendingRoutines} notesToReview={knowledgeToReview} onOpenChat={taskId => { setPanel(null); openTask(taskId); }} onOpenMessage={(taskId, messageId) => { setPanel(null); openChatAt(taskId, messageId); }}
      chatExists={taskId => workspace.tasks.some(task => task.id === taskId && !task.deletedAt)} onOpenSchedules={() => openRoutines()}
      onOpenArchive={() => openSettings('archive')} onOpenLibrary={() => { if (knowledgeToReview > 0) setLibraryTab('knowledge'); setPanel('library'); }} updateReady={updateMark?.kind === 'ready'} onRestartUpdate={restartToUpdate} />
    : area === 'home' && friendsOpen
      ? <FriendsPage view={homePage} archived={workspace.archivedWorkers} busy={friendsBusy}
        onCreate={name => { setNewOrgletName(name); setEditingWorker(undefined); setPanel('worker'); }} onRestore={member => archiveEntity('worker', member.id, false)}
        onMarketAdded={async result => {
          await refresh();
          clearSelection();
          if (result.kind === 'space') {
            setOpenSpace(result.entityId);
            setFriendsOpen(false);
            setArea('channels');
          } else if (result.kind === 'orglet') openWorker(result.entityId);
          else openTeam(result.entityId);
        }} templates={friendTemplates} onTemplate={addTemplate} onImport={() => action(async () => { if (await orglet.importTemplate()) setArea('home'); })} />
      : null;
  const goToActivity = () => {
    if (!leavingPage(goToActivity)) setArea('activity');
  };
  const areaEntries: (AreaRailEntry & { key: SidebarList })[] = [
    { key: 'home', icon: <MessagesSquare size={20} />, activeIcon: ChatFilled, label: t('Trò chuyện'), active: (area === 'home' || (area === 'channels' && !openSpace)) && !pagePanelOpen, onSelect: function goHome() {
      if (leavingPage(goHome)) return;
      clearSelection();
      // Home is always a chat (user, 2026-10-04): the DM that was open, else the last orglet written to, else the
      // first one. Only a workspace with no orglet lands on Add friend.
      const openTaskRow = selectedRef.current ? workspaceRef.current?.tasks.find(task => task.id === selectedRef.current) : undefined;
      const dmOpen = selectedRef.current ? areaOfTask(openTaskRow) === 'home' : !teamIdRef.current && !emptyChannelIdRef.current;
      const friend = orderedWorkers.find(worker => worker.id === workerId) ?? orderedWorkers[0];
      if (!dmOpen && friend) {
        openWorker(friend.id);
        // Opening a chat closes the sidebar laid over a narrow window; the Home tile was a way to its list, so it stays.
        if (matchMedia('(max-width: 780px)').matches) setSidebar(true);
        return;
      }
      setFriendsOpen(!friend);
      setArea('home');
    } },
    ...workspace.spaces.map(space => ({
      key: `space:${space.id}` as const,
      icon: <SpaceMark seed={space.id} color={space.color} />,
      label: space.name,
      active: area === 'channels' && openSpace?.id === space.id && !pagePanelOpen,
      onSelect: function goToSpace() {
        if (leavingPage(goToSpace)) return;
        setOpenSpace(space.id);
        setArea('channels');
      },
    })),
    { key: 'activity', icon: <Bell size={20} />, activeIcon: BellFilled, label: t('Hoạt động'), ariaLabel: activityRailLabel, active: area === 'activity' && !pagePanelOpen, count: unreadNotices + activityCountsNow.needs, countTone: activityCountsNow.needs > 0 ? 'accent' : 'quiet', onSelect: goToActivity },
    { key: 'library', icon: <BookOpen size={20} />, activeIcon: BookFilled, label: t('Thư viện'), ariaLabel: knowledgeToReview > 0 ? t('Thư viện, {0} cần duyệt', [knowledgeToReview]) : t('Thư viện'), active: panel === 'library' || panel === 'skill' || panel === 'knowledge', count: knowledgeToReview, onSelect: () => { const open = () => { if (knowledgeToReview > 0) setLibraryTab('knowledge'); setPanel('library'); }; if (panel === 'routines') void leaveRoutine(open); else open(); } },
    { key: 'schedules', icon: <CalendarClock size={20} />, activeIcon: CalendarClockFilled, label: t('Lịch chạy'), ariaLabel: pendingRoutines > 0 ? t('Lịch chạy, {0} cần xem', [pendingRoutines]) : t('Lịch chạy'), active: panel === 'routines', count: pendingRoutines, onSelect: () => openRoutines() },
  ];
  // What the sidebar lists: the open page's own rows, else the area's. A folded sidebar taking a look lists the tile
  // under the pointer instead.
  // A space that is gone leaves its area with nothing to list, so Home is listed.
  const shownList: SidebarList = !pagePanelOpen ? (area === 'channels' ? (openSpace ? `space:${openSpace.id}` : 'home') : area) : panel === 'routines' ? 'schedules' : 'library';
  const sidebarFor = !sidebar && peekList ? peekList : shownList;
  // The space the sidebar lists, which a folded sidebar's look can make another one than the space on screen.
  const sidebarSpace = workspace.spaces.find(space => `space:${space.id}` === sidebarFor);
  // In the order the person keeps them (`reorder`): a channel never placed stays after the placed ones, newest first.
  const channelOrder = workspace.channelOrder ?? [];
  const idOfEntry = (entry: (typeof channelEntries)[number]) => channelOfEntry(entry)?.id ?? '';
  const placeOfEntry = (entry: (typeof channelEntries)[number], index: number) => channelOrder.includes(idOfEntry(entry)) ? channelOrder.indexOf(idOfEntry(entry)) : channelOrder.length + index;
  const sidebarSpaceEntries = sidebarSpace
    ? channelEntries.filter(entry => spaceOfEntry(entry)?.id === sidebarSpace.id).map((entry, index) => ({ entry, place: placeOfEntry(entry, index) })).sort((first, second) => first.place - second.place).map(item => item.entry)
    : [];
  const categoryOfEntry = (entry: (typeof channelEntries)[number]) => sidebarSpace?.categories.find(category => category.id === channelOfEntry(entry)?.categoryId);
  /**
   * Puts a channel of the listed space somewhere else in it (user, 2026-10-05): on another channel's row it takes
   * that row's category and place, and on a category, or on the space's own list, it goes last there. Dropped on a
   * row below it in its own category it lands after that row, and otherwise before it.
   */
  const placeChannel = (channelId: string, target: { rowId?: string; categoryId: string | null }) => {
    const channel = sidebarSpaceEntries.map(channelOfEntry).find(item => item?.id === channelId);
    if (!channel || channelId === target.rowId) return;
    const ids = sidebarSpaceEntries.map(idOfEntry);
    const moved = (channel.categoryId ?? null) !== target.categoryId;
    const next = ids.filter(id => id !== channelId);
    const after = !moved && target.rowId !== undefined && ids.indexOf(channelId) < ids.indexOf(target.rowId);
    next.splice(target.rowId === undefined ? next.length : next.indexOf(target.rowId) + (after ? 1 : 0), 0, channelId);
    if (!moved && next.join() === ids.join()) return;
    const inSpace = new Set(ids);
    action(async () => {
      if (moved) await orglet.call('updateChannel', { id: channel.id, name: channel.name, topic: channel.topic ?? '', members: channel.members, categoryId: target.categoryId });
      await orglet.call('reorder', { kind: 'channels', ids: [...channelOrder.filter(id => !inSpace.has(id)), ...next] });
    }, channelLabel(channel.name));
  };
  /** Puts a category of the listed space at another one's place: after it when it was above, before it when below. */
  const placeCategory = (categoryId: string, targetId: string) => {
    if (!sidebarSpace || categoryId === targetId) return;
    const ids = sidebarSpace.categories.map(category => category.id);
    if (!ids.includes(categoryId)) return;
    const next = ids.filter(id => id !== categoryId);
    next.splice(next.indexOf(targetId) + (ids.indexOf(categoryId) < ids.indexOf(targetId) ? 1 : 0), 0, categoryId);
    const everySpace = workspace.spaces.flatMap(space => space.id === sidebarSpace.id ? next : space.categories.map(category => category.id));
    action(() => orglet.call('reorder', { kind: 'categories', ids: everySpace }), sidebarSpace.categories.find(category => category.id === categoryId)?.name);
  };
  const dropTarget = (key: string, dropped: (kind: 'channel' | 'category', id: string) => void, takesCategory = false) => {
    const kindOf = (event: DragEvent<HTMLElement>) => event.dataTransfer.types.includes(CHANNEL_DRAG_TYPE) ? 'channel' as const : takesCategory && event.dataTransfer.types.includes(CATEGORY_DRAG_TYPE) ? 'category' as const : undefined;
    return {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!kindOf(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setChannelDropAt(key);
      },
      onDragLeave: () => setChannelDropAt(current => current === key ? undefined : current),
      onDrop: (event: DragEvent<HTMLElement>) => {
        const kind = kindOf(event);
        if (!kind) return;
        event.preventDefault();
        event.stopPropagation();
        setChannelDropAt(undefined);
        dropped(kind, event.dataTransfer.getData(kind === 'channel' ? CHANNEL_DRAG_TYPE : CATEGORY_DRAG_TYPE));
      },
    };
  };
  /** A channel's row in a space, as a place another channel can be dropped. */
  const channelSlot = (entry: (typeof channelEntries)[number], categoryId: string | null) => <div key={idOfEntry(entry)} className={`channel-slot${channelDropAt === `row:${idOfEntry(entry)}` ? ' over' : ''}`}
    {...dropTarget(`row:${idOfEntry(entry)}`, (_kind, id) => placeChannel(id, { rowId: idOfEntry(entry), categoryId }))}>{renderChannelEntry(entry)}</div>;
  /** A category's heading starts a drag of the category; a drag that started on one of its channels is the channel's. */
  const startCategoryDrag = (categoryId: string) => (event: DragEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('.channel-row')) return;
    event.dataTransfer.setData(CATEGORY_DRAG_TYPE, categoryId);
    event.dataTransfer.effectAllowed = 'move';
  };
  const deleteSpace = (space: { id: string; name: string }) => action(async () => {
    await orglet.call('deleteSpace', { id: space.id });
    setOpenSpace('');
    setArea('home');
    toast(t('Đã xóa không gian'), 'success', space.name);
  }, space.name);
  const spaceFromCategory = (category: string) => action(async () => {
    const spaceId = await orglet.call('spaceFromCategory', { category });
    setOpenSpace(spaceId);
    setArea('channels');
    toast(t('Đã tạo không gian'), 'success', category);
  }, category);
  // While the sidebar is folded, a tile opens it for good. The tile of the area already on screen only opens it, so
  // Home there does not also jump to Friends.
  const folderNames = spaceFolderNames(workspace.spaces);
  /** Puts a space in a folder, or with no name takes it out. Everything else about the space stays. */
  const moveSpaceToFolder = (space: Space, folder: string | null) => action(async () => {
    await orglet.call('updateSpace', { id: space.id, name: space.name, ...(space.color ? { color: space.color } : {}), orgletIds: space.orgletIds, categories: space.categories, folder });
    if (folder) setClosedFolders(closedFolders.filter(name => name !== folderKey(folder)));
  }, space.name);
  const newFolderName = () => {
    for (let number = 1; ; number += 1) {
      const name = t('Thư mục {0}', [number]);
      if (!folderNames.some(existing => folderKey(existing) === folderKey(name))) return name;
    }
  };
  /** What a right click on a space's tile offers: its settings, and where its tile sits on the rail. */
  const spaceTileMenu = (space: Space): RowMenuItem[] => [
    { label: t('Thiết lập không gian'), icon: SlidersHorizontal, onSelect: () => setSpaceDraft({ space }) },
    ...folderNames.filter(name => !space.folder || folderKey(name) !== folderKey(space.folder)).map(name => ({ label: t('Chuyển vào thư mục {0}', [name]), icon: FolderInput, onSelect: () => moveSpaceToFolder(space, name) })),
    { label: t('Chuyển vào thư mục mới'), icon: FolderPlus, onSelect: () => moveSpaceToFolder(space, newFolderName()) },
    ...(space.folder ? [{ label: t('Đưa ra khỏi thư mục'), icon: FolderMinus, onSelect: () => moveSpaceToFolder(space, null) }] : []),
  ];
  const toggleFolder = (name: string) => {
    const key = folderKey(name);
    setClosedFolders(closedFolders.includes(key) ? closedFolders.filter(item => item !== key) : [...closedFolders, key]);
  };
  /** Takes every space out of a folder, which ends the folder: it exists only as the name they share. */
  const dissolveFolder = (name: string) => action(async () => {
    for (const space of workspace.spaces.filter(item => item.folder && folderKey(item.folder) === folderKey(name))) {
      await orglet.call('updateSpace', { id: space.id, name: space.name, ...(space.color ? { color: space.color } : {}), orgletIds: space.orgletIds, categories: space.categories, folder: null });
    }
  }, name);
  const railTiles = areaEntries.map(entry => ({
    ...entry,
    onSelect: () => {
      if (!sidebar) {
        openFullSidebar();
        if (entry.active) return;
      }
      entry.onSelect();
    },
    onDwell: sidebar ? undefined : (resting: boolean) => {
      if (resting) setPeekList(entry.key);
    },
  }));
  // The rail as it is drawn: a space with a folder sits inside that folder's group, at the place of its first space.
  const railEntries: AreaRailEntry[] = [];
  const railSpaces: (AreaRailEntry | AreaRailFolder)[] = [];
  const railFolders = new Map<string, AreaRailFolder>();
  for (const tile of railTiles) {
    const space = workspace.spaces.find(item => `space:${item.id}` === tile.key);
    if (!space) {
      railEntries.push(tile);
      continue;
    }
    const spaceTile = { ...tile, menuItems: spaceTileMenu(space) };
    if (!space.folder) {
      railSpaces.push(spaceTile);
      continue;
    }
    const key = folderKey(space.folder);
    let folder = railFolders.get(key);
    if (!folder) {
      const name = space.folder;
      folder = {
        kind: 'folder', key: `folder:${key}`, label: name, open: !closedFolders.includes(key), onToggle: () => toggleFolder(name), entries: [],
        menuItems: [
          { label: t('Đóng mọi thư mục'), icon: Folders, onSelect: () => setClosedFolders(folderNames.map(folderKey)) },
          { label: t('Bỏ thư mục'), icon: FolderMinus, onSelect: () => dissolveFolder(name) },
        ],
      };
      railFolders.set(key, folder);
      railSpaces.push(folder);
    }
    folder.entries.push(spaceTile);
  }
  return <div className={`app ${sidebar ? '' : 'sidebar-hidden'}${resizing ? ' resizing' : ''}${sidePaneOpen ? ' with-details' : ''}${membersShown ? ' with-members' : ''}${chatSwitching ? ' chat-switching' : ''}`} style={{ '--sidebar-width': `${sidebarWidth}px`, '--details-width': `${detailsWidth}px` } as CSSProperties}>
    <a className="skip-link" href="#main-content">{t('Đến nội dung chính')}</a>
    {sidebar && <button type="button" className="sidebar-resizer" aria-label={t('Kéo để đổi độ rộng thanh bên')} {...sidebarPane.handleProps} />}
    {sidePaneOpen && <button type="button" className="details-resizer" aria-label={t('Kéo để đổi độ rộng panel chi tiết')} {...detailsPane.handleProps} />}
    <aside className={`sidebar${sidebar ? '' : sidebarPeek ? ' peek' : ' collapsed'}`} aria-label={t('Điều hướng')} inert={(!sidebar && !sidebarPeek) || undefined}
      onPointerEnter={sidebar ? undefined : () => peekSidebar(true)} onPointerLeave={sidebar ? undefined : () => peekSidebar(false)}>
      <div className="sidebar-head">
        <strong className="sidebar-title">{sidebarSpace ? sidebarSpace.name : sidebarFor === 'home' ? t('Trò chuyện') : sidebarFor === 'activity' ? t('Hoạt động') : sidebarFor === 'library' ? t('Thư viện') : t('Lịch chạy')}</strong>
        {/* What a space holds is made from its + (user, 2026-10-05): a channel, or a category for channels to sit in. */}
        {sidebarSpace && <RowMenu label={t('Tạo trong không gian {0}', [sidebarSpace.name])} icon={Plus} className="org-button-icon" items={[
          { label: t('Tạo kênh'), icon: Hash, onSelect: () => setChannelDraft({ spaceId: sidebarSpace.id }) },
          { label: t('Tạo nhóm'), icon: FolderTree, onSelect: () => setCategoryDraft({ space: sidebarSpace }) },
        ]} />}
        {sidebarSpace && <RowMenu label={t('Tùy chọn không gian {0}', [sidebarSpace.name])} icon={EllipsisVertical} className="org-button-icon" items={[
          { label: t('Thiết lập không gian'), icon: SlidersHorizontal, onSelect: () => setSpaceDraft({ space: sidebarSpace }) },
          { label: t('Thành viên'), icon: Users, onSelect: () => setSpaceDraft({ space: sidebarSpace, initialTab: 'members' }) },
          { label: t('Xuất bản lên marketplace'), icon: Upload, onSelect: () => setPublishingSource({ kind: 'space', entityId: sidebarSpace.id, name: sidebarSpace.name }) },
          { label: t('Xóa không gian'), icon: Trash, danger: true, onSelect: () => deleteSpace(sidebarSpace), confirm: { question: t('Xóa không gian {0}? Các kênh của nó vẫn còn, nằm ngoài mọi không gian.', [sidebarSpace.name]), label: t('Xóa không gian') } },
        ]} />}
        {/* A space's head keeps room for its name: search stays on Ctrl+K there. */}
        {sidebarFor === 'activity' && <Button size="icon" aria-label={t('Tìm cuộc trò chuyện (Ctrl K)')} aria-haspopup="dialog" onClick={() => setSearchOpen(true)}><Search size={18} /></Button>}
        <Button size="icon" aria-label={t('Thu gọn sidebar')} onClick={closeSidebar}><PanelLeft size={18} /></Button>
      </div>
      {sidebarFor === 'home' && <button type="button" className="sidebar-search" aria-haspopup="dialog" onClick={() => setSearchOpen(true)}><Search size={16} aria-hidden="true" /><span>{t('Tìm hoặc bắt đầu trò chuyện')}</span></button>}
      <div className="sidebar-scroll">
      {sidebarFor === 'home' && <>
      <nav className="sidebar-nav" aria-label={t('Thêm Tí')}>
        {(['add', 'market'] as const).map(view => {
          const open = friendsOpen && homePage === view;
          return <button key={view} type="button" className={`sidebar-nav-item${open ? ' active' : ''}`} aria-current={open ? 'page' : undefined} onClick={() => { clearSelection(); setHomePage(view); setFriendsOpen(true); setArea('home'); if (matchMedia('(max-width: 780px)').matches) setSidebar(false); }}>
            {view === 'add' ? <UserRoundPlus size={18} aria-hidden="true" /> : <Store size={18} aria-hidden="true" />}<span className="sidebar-nav-name">{view === 'add' ? t('Thêm Tí') : 'Marketplace'}</span>
          </button>;
        })}
      </nav>
      {/* The chats kept at hand that have no row anywhere else in the sidebar (COD-355), so no chat is listed twice. */}
      {openChatItems.length > 0 && <SidebarSection id="open" title={t('Đang mở')}>
        {openChatItems.map(item => <OpenChatRow key={item.key} item={item} onClose={() => closeChat(item.key)} />)}
      </SidebarSection>}
      <SidebarSection id="workers" title={t('Tin riêng')} action={sectionActions('workers', t('Chọn nhiều Tí'), t('Tạo Tí'), () => { setEditingWorker(undefined); setPanel('worker'); })}>
        {selection.section === 'workers' && selectionBar}
        {workerOrder.order.map(id => workspace.workers.find(worker => worker.id === id)).filter((item): item is Worker => Boolean(item)).map(item => <SidebarTreeRow key={item.id} id={`worker-${item.id}`} arriving={isArriving(`worker-${item.id}`)} name={item.name} description={item.description} avatar={<Avatar name={item.name} seed={item.id} emoji={item.avatar?.emoji} mascot={item.avatar?.mascot} defaultMascot hint={item.description} color={item.avatar?.color} size="sm" badge={item.provider === 'demo' ? undefined : <ProviderMark provider={item.provider} size="small" decorative />} />} active={!teamId && !emptyChannel && workerId === item.id && (!selected || selected === liveWorkerTask(workspace.tasks, item.id)?.id)} status={workerStatus(item.id)} reorder={workerOrder.bind(item.id)} onSelect={() => { clearSelection(); openWorker(item.id); }} onDwell={dwellWorker(item)} selection={rowSelection('workers', item.id)}
          menu={<RowMenu label={t('Tùy chọn {0}', [item.name])} icon={EllipsisVertical} contextMenuOf=".tree-item" items={[{ label: t('Chỉnh sửa'), icon: Pencil, onSelect: () => { setEditingWorker(item); setPanel('worker'); } }, { label: t('Xuất bản lên marketplace'), icon: Upload, onSelect: () => setPublishingSource({ kind: 'orglet', entityId: item.id, name: item.name }) }, { label: t('Lưu trữ'), icon: Archive, onSelect: () => archiveEntity('worker', item.id, true) }, { label: t('Xóa'), icon: Trash, danger: true, onSelect: () => deleteEntity('worker', item.id), confirm: { question: t('Xóa {0}? Cuộc trò chuyện cũ vẫn giữ lịch sử.', [item.name]), label: t('Xóa') } }]} />}
          {...rowsUnder({ workerId: item.id }, item.name)} />)}{!workspace.workers.length && <p className="empty-history">{t('Chưa có Tí nào.')}</p>}
      </SidebarSection>
      {/* The channels outside every space, like group chats beside the DMs: the rail has a tile for each space and
          none for these (user, 2026-10-05). Ones with a category keep their own section under it. They are only
          listed here: a new channel is made in a space, so these sections have no way to add one. */}
      {channelGroupList.some(group => group.name === undefined) && <SidebarSection id="loose-channels" title={t('Kênh')}>
        {channelGroupList.filter(group => group.name === undefined).flatMap(group => group.entries).map(renderChannelEntry)}
      </SidebarSection>}
      {channelGroupList.filter(group => group.name !== undefined).map(group => <SidebarSection key={group.name!.toLowerCase()} id={`category-${group.name!.toLowerCase()}`} title={group.name!}
        action={<RowMenu label={t('Tùy chọn nhóm {0}', [group.name!])} icon={EllipsisVertical} items={[{ label: t('Tạo không gian từ nhóm này'), icon: Boxes, onSelect: () => spaceFromCategory(group.name!) }]} />}>
        {group.entries.map(renderChannelEntry)}
      </SidebarSection>)}
      </>}
      {sidebarSpace && <>
        {sidebarSpaceEntries.length === 0 && sidebarSpace.categories.length === 0 && <div className="sidebar-empty"><p className="empty-history">{t('Chưa có kênh nào.')}</p><Button variant="outline" onClick={() => setChannelDraft({ spaceId: sidebarSpace.id })}><LucidePlus size={16} />{t('Tạo kênh')}</Button></div>}
        {/* The channels directly in the space. With categories it is also where a dragged channel leaves its category. */}
        {(sidebarSpaceEntries.some(entry => !categoryOfEntry(entry)) || sidebarSpace.categories.length > 0) && <div className={`channel-uncategorized channel-drop${channelDropAt === 'root' ? ' over' : ''}`} {...dropTarget('root', (_kind, id) => placeChannel(id, { categoryId: null }))}>{sidebarSpaceEntries.filter(entry => !categoryOfEntry(entry)).map(entry => channelSlot(entry, null))}</div>}
        {sidebarSpace.categories.map(category => <div key={category.id} className={`channel-drop${channelDropAt === category.id ? ' over' : ''}`} draggable onDragStart={startCategoryDrag(category.id)} {...dropTarget(category.id, (kind, id) => kind === 'channel' ? placeChannel(id, { categoryId: category.id }) : placeCategory(id, category.id), true)}><SidebarSection id={`space-category-${category.id}`} title={category.name}
          action={<Button size="icon" className="row-action" aria-label={t('Tạo kênh trong {0}', [category.name])} title={t('Tạo kênh trong {0}', [category.name])} onClick={() => setChannelDraft({ spaceId: sidebarSpace.id, categoryId: category.id })}><Plus size={16} /></Button>}>
          {sidebarSpaceEntries.filter(entry => categoryOfEntry(entry)?.id === category.id).map(entry => channelSlot(entry, category.id))}
        </SidebarSection></div>)}
      </>}
      {/* A page's own list: the sidebar always belongs to what the main panel shows, never to the area left behind. */}
      {sidebarFor === 'library' && <nav className="sidebar-nav" aria-label={t('Thư viện')}>
        {(['skills', 'knowledge'] as const).map(tab => <button key={tab} type="button" className={`sidebar-nav-item${libraryTab === tab ? ' active' : ''}`} aria-current={libraryTab === tab ? 'page' : undefined} onClick={() => void leaveRoutine(() => { setLibraryTab(tab); setPanel('library'); })}>
          {tab === 'skills' ? <Sparkles size={18} aria-hidden="true" /> : <NotebookText size={18} aria-hidden="true" />}
          <span className="sidebar-nav-name">{tab === 'skills' ? 'Skills' : 'Knowledge'}</span>
          <span className="sidebar-nav-count" aria-hidden="true">{tab === 'skills' ? workspace.skills.length : workspace.knowledge.filter(item => item.status !== 'archived').length}</span>
        </button>)}
      </nav>}
      {sidebarFor === 'schedules' && <nav className="sidebar-nav" aria-label={t('Lịch chạy')}>
        <button type="button" className={`sidebar-nav-item${routineView.editing ? '' : ' active'}`} aria-current={routineView.editing ? undefined : 'page'} onClick={() => void leaveRoutine(() => openRoutines())}>
          <LucideCalendarClock size={18} aria-hidden="true" /><span className="sidebar-nav-name">{t('Tất cả lịch')}</span><span className="sidebar-nav-count" aria-hidden="true">{workspace.routines.length}</span>
        </button>
        {workspace.routines.map(routine => {
          const open = routineView.editing && routineView.routine?.id === routine.id;
          return <button key={routine.id} type="button" className={`sidebar-nav-item${open ? ' active' : ''}`} aria-current={open ? 'page' : undefined} onClick={() => void leaveRoutine(() => openRoutines({ editing: true, routine }))}>
            <Clock size={18} aria-hidden="true" /><span className="sidebar-nav-name">{routine.name}</span>
          </button>;
        })}
      </nav>}
      {sidebarFor === 'activity' && <nav className="sidebar-nav" aria-label={t('Hoạt động')}>
        {activityTabs.map(tab => <button key={tab} type="button" className={`sidebar-nav-item${activityTab === tab ? ' active' : ''}`} aria-current={activityTab === tab ? 'page' : undefined} onClick={() => { setActivityTab(tab); if (shownList !== 'activity') goToActivity(); }}>
          {tab === 'needs' ? <BellRing size={18} aria-hidden="true" /> : tab === 'running' ? <Activity size={18} aria-hidden="true" /> : tab === 'done' ? <CircleCheck size={18} aria-hidden="true" /> : <Bookmark size={18} aria-hidden="true" />}
          <span className="sidebar-nav-name">{activityTabLabel(tab)}</span>
          {tab !== 'done' && activityCountsNow[tab] > 0 && <span className="sidebar-nav-count" aria-hidden="true">{activityCountsNow[tab]}</span>}
        </button>)}
      </nav>}
      </div>
    </aside>
    {/* The area rail (COD-366): Home, the areas, Library and Schedules, and the one + Create. */}
    <AreaRail entries={railEntries} spaces={railSpaces} onCreateSpace={() => setSpaceDraft({})} onHover={sidebar ? undefined : peekSidebar} />
    <UserPanel name={account?.name?.trim() || t('Bạn')} status={userStatus} connected={hasConnection(connections, workspace.customConnections)}
      items={[
        { label: account?.status === 'signed_in' ? t('Tài khoản') : t('Đăng nhập'), icon: account?.status === 'signed_in' ? CircleUserRound : LogIn, onSelect: () => openSettings('account') },
        { label: t('Cài đặt'), icon: SlidersHorizontal, onSelect: () => openSettings() },
        { label: t('Kết nối API'), icon: Plug, onSelect: () => openSettings('connections') },
        { label: t('Chi phí & giới hạn'), icon: Wallet, onSelect: () => openSettings('usage') },
        { label: t('Dữ liệu'), icon: Database, onSelect: () => openSettings('data') },
        { label: t('Giới thiệu'), icon: Info, onSelect: () => openSettings('about') },
      ]}
      onDwell={dwellAbout}
      trailing={updateMark ? <UpdateButton compact indicator={updateMark} onRestart={restartToUpdate} onOpenAbout={() => openSettings('about')} /> : undefined} />
    <main className="main-pane" id="main-content" tabIndex={-1}>
      {pagePanelOpen ? <PanelPage pageKey={`${panel}:${libraryTab}:${routineView.editing}`} onClose={() => panel === 'routines' ? void leaveRoutine(close) : close()}
        icon={panel === 'routines' ? <CalendarClock size={16} aria-hidden="true" /> : <BookOpen size={16} aria-hidden="true" />}
        description={panel === 'routines' && !routineView.editing ? t('Chỉ chạy khi Orglet đang mở; lịch theo giờ bị lỡ thì chạy bù một lần.') : panel === 'library' ? (libraryTab === 'skills' ? t('Hướng dẫn dùng lại được; gói nhập từ thư mục cần review trước.') : t('Ghi chú dùng lại được; chỉ mục đã duyệt mới được nạp.')) : undefined}
        actions={panel === 'routines' && !routineView.editing ? <Button variant="outline" onClick={() => setRoutineView({ editing: true })}><LucideCalendarClock size={16} />{t('Tạo lịch')}</Button> : drawerBack}
        title={panel === 'routines' ? (routineView.editing ? <span className="breadcrumb"><button type="button" className="breadcrumb-link" onClick={() => void leaveRoutine(() => setRoutineView({ editing: false }))}>{t('Lịch chạy')}</button><ChevronRight size={15} aria-hidden="true" className="breadcrumb-separator" /><span aria-current="page">{routineView.routine ? routineView.routine.name : t('Lịch mới')}</span></span> : t('Lịch chạy')) : panel === 'skill' ? libraryTitle(editingSkill?.package ? 'Review skill' : t('Chỉnh skill')) : panel === 'knowledge' ? libraryTitle(editingKnowledge ? 'Knowledge' : t('Knowledge mới')) : t('Thư viện')}>
      {panel === 'routines' && <RoutinesPanel workspace={workspace} draft={routineDraft} view={routineView} onView={setRoutineView} onDirty={markRoutineDirty} onBack={() => void leaveRoutine(() => setRoutineView({ editing: false }))} openTask={id => { openTask(id); close(); }} />}
      
      {panel === 'skill' && <SkillEditor key={editingSkill?.id ?? 'new'} skill={editingSkill} done={fromLibrary ? backToLibrary : close} />}
      {panel === 'library' && <div className="form">
        <div className="tab-row"><div className="tabs" role="tablist" aria-label={t('Thư viện')} onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const next = libraryTab === 'skills' ? 'knowledge' : 'skills'; setLibraryTab(next); document.getElementById(`library-tab-${next}`)?.focus(); }}>{(['skills', 'knowledge'] as const).map(tab => <Button key={tab} id={`library-tab-${tab}`} role="tab" aria-selected={libraryTab === tab} aria-controls="library-panel" tabIndex={libraryTab === tab ? 0 : -1} onClick={() => setLibraryTab(tab)}><span className="tab-label">{tab === 'skills' ? 'Skills' : 'Knowledge'}<span className="tab-count" aria-hidden="true">{tab === 'skills' ? workspace.skills.length : workspace.knowledge.filter(item => item.status !== 'archived').length}</span></span></Button>)}</div>
          <div className="tab-row-actions">{libraryTab === 'skills' ? <SkillLibraryActions onOpen={openLibrarySkill} /> : <Button variant="outline" onClick={() => openLibraryKnowledge()}><LucidePlus size={16} />{t('Tạo knowledge')}</Button>}</div></div>
        <div id="library-panel" role="tabpanel" aria-labelledby={`library-tab-${libraryTab}`}>{libraryTab === 'skills' ? <SkillLibrary skills={workspace.skills} onOpen={openLibrarySkill} /> : <KnowledgeLibrary workspace={workspace} onOpen={openLibraryKnowledge} onOpenChat={taskId => { close(); openTask(taskId); }} />}</div>
      </div>}
      {panel === 'knowledge' && <KnowledgeEditor key={editingKnowledge ? `${editingKnowledge.id}:${editingKnowledge.revision}` : 'new'} item={editingKnowledge} workspace={workspace} done={fromLibrary ? backToLibrary : close} />}
      </PanelPage> : page ?? <>
      <ChatHeader contentKey={`${activeChatKey}:${chatViewList.map(view => `${view.name}${view.count ?? ''}`).join()}`}
        views={chatViewList.length > 1 ? <ChatViewTabs views={chatViewList} current={chatView} onSelect={showChatView} /> : null}
        lead={<>
          <span className="topbar-title">
          {headerChannel && <span className="topbar-hash" aria-hidden="true">#</span>}
          {openSchedule && <span className="topbar-schedule-mark" title={t('Lịch chạy')}><CalendarClock size={15} aria-hidden="true" /></span>}
          {headerRename
            ? <EditableText key={headerRename.kind === 'team' ? headerRename.team.id : headerRename.kind === 'worker' ? headerRename.worker.id : headerRename.kind === 'emptyChannel' ? headerRename.channelId : headerRename.taskId} className="topbar-name" value={headerName} maxLength={headerChannel ? CHANNEL_NAME_LIMIT : headerRename.kind === 'thread' ? 120 : 80}
              label={t('Đổi tên {0}', [headerName])} onCommit={renameFromHeader} />
            : <span className="topbar-name">{headerName}</span>}
          {headerChannel?.topic && <span className="topbar-topic" title={headerChannel.topic}>{headerChannel.topic}</span>}
          {/* Which model is answering, not only whether it is Demo (user, 2026-09-19). A team running on several
              providers says nothing here; the details panel lists them one by one. */}
          {headerProvider && <span className="topbar-provider" title={headerProvider !== 'demo' ? providerLabel(headerProvider) : demoReplies() ? t('Demo · không gọi API') : t('Tí này chưa kết nối model.')}>
            {headerProvider !== 'demo' && <ProviderMark provider={headerProvider} size="small" decorative />}
            {headerProvider === 'demo' && !demoReplies() ? t('chưa kết nối model') : providerName(headerProvider)}
          </span>}
          </span>
        </>}
        actions={<>
          {/* The member column's toggle. Changing who is in the channel is a setting, so it lives in the chat's menu. */}
          {headerChannel && !sidePaneOpen && windowWidth > 1100 && <Button size="icon" className="topbar-members-toggle" aria-label={membersOpen ? t('Ẩn danh sách thành viên') : t('Hiện danh sách thành viên')} title={membersOpen ? t('Ẩn danh sách thành viên') : t('Hiện danh sách thành viên')} aria-pressed={membersOpen} onClick={toggleMembers}><Users size={18} /></Button>}
          {selected && detail && openTaskPaid && <span className="task-cost" role="status" title={detail.usage.reservedMicros > 0 ? t('Đã dùng {0} / {1} · đang giữ chỗ {2}', [formatMoney(detail.usage.chargedMicros), formatMoney(detail.task.budgetMicros), formatMoney(detail.usage.reservedMicros)]) : t('Đã dùng {0} / {1}', [formatMoney(openTaskUsed), formatMoney(detail.task.budgetMicros)])}><Wallet size={14} aria-hidden="true" />{t('Đã dùng {0} / {1}', [formatMoney(openTaskUsed), formatMoney(detail.task.budgetMicros)])}</span>}

          {(selected || team || worker || emptyChannel) && <RowMenu className="thread-menu" label={t('Tùy chọn cuộc trò chuyện')} items={[...(headerChannel ? [{ label: t('Thiết lập kênh'), icon: Settings2, onSelect: () => editChannel() }, { label: t('Thành viên'), icon: Users, onSelect: () => editChannel('members') }] : []), ...headerSettingsItems, ...(selected && openSideThread ? [{ label: t('Thiết lập chat'), icon: MessageSquareText, onSelect: () => setPrivacyTaskId(selected) }] : []), ...(selected && !openSideThread ? [{ label: t('Thiết lập chat'), icon: MessageSquareText, onSelect: () => { setEditingTask(selected); setPanel('task'); } }] : []), { label: t('Chi tiết'), icon: SlidersHorizontal, onSelect: () => setPanel('activity') }, ...(!selected && headerChannel && !headerChannel.taskId ? [{ label: t('Xóa'), icon: Trash2, danger: true, onSelect: () => deleteEmptyChannel(headerChannel.id, headerChannel.name), confirm: { question: t('Xóa kênh này? Kênh chưa có tin nhắn nào.'), label: t('Xóa') } }] : []), ...(selected ? [detail?.task.archivedAt ? { label: t('Khôi phục'), icon: ArchiveRestore, onSelect: () => archiveTask(selected, false) } : { label: t('Lưu trữ'), icon: LucideArchive, onSelect: () => archiveTask(selected, true) }, { label: t('Xóa'), icon: Trash2, danger: true, onSelect: () => deleteTask(selected), confirm: { question: headerChannel ? t('Xóa kênh này cùng lịch sử của nó? Không thể hoàn tác.') : t('Xóa cuộc trò chuyện này? Không thể hoàn tác.'), label: t('Xóa') } }] : [])]} />}
        </>} />
      {error && <div className="error-banner" role="alert"><span>{error}</span><Button size="icon" aria-label={t('Đóng thông báo')} onClick={() => setError('')}><X size={16} /></Button></div>}
      {catchUpNotice && <div className="notice-banner" role="status"><LucideCalendarClock size={16} aria-hidden="true" /><div><p>{singleCatchUp ? t('{0} đã lỡ một lần chạy khi app tắt. Có thể chạy bù một lần.', [singleCatchUp.name]) : t('{0} lịch đã lỡ lần chạy khi app tắt. Mỗi lịch chạy bù được một lần.', [pendingCatchUp.length])}</p><div className="actions">{singleCatchUp?.enabled && <Button variant="primary" onClick={() => action(async () => openTask(await orglet.call('catchUpRoutine', { id: singleCatchUp.id })))}>{t('Chạy bù một lần')}</Button>}<Button onClick={() => openRoutines()}>{t('Xem lịch chạy')}</Button></div></div><Button size="icon" aria-label={t('Đóng thông báo lịch bị lỡ')} onClick={() => setDismissedCatchUpNotice(catchUpNoticeKey)}><X size={16} /></Button></div>}
      {chatView !== 'chat' ? <ChatViewPanel view={chatView}>{chatViewContent}</ChatViewPanel> : selected ? <>{detail ? <><FormatPreferences.Provider value={{ copy: workspace.copyFormat, download: workspace.downloadFormat }}><TaskThread key={selected} start={threadStart} detail={detail} workspace={workspace} recovery={workspaceRecovery} action={action} showSources={openSources} reviewRecovery={runId => { setRecoveryFocus({ runId, at: Date.now() }); setPanel('activity'); }} openMessage={messageId => {
        // Team messages live in Details, so that panel opens first and the message is found after it renders.
        if (detail.events.some(event => event.id === messageId && event.teamMessage)) setPanel('activity');
        requestAnimationFrame(() => focusMessage(messageId));
      }} proposals={workspace.knowledge.filter(item => item.status === 'proposed' && item.provenance.kind === 'run' && item.provenance.taskId === selected)} openKnowledge={openKnowledge} reviewKnowledge={() => { setLibraryTab('knowledge'); setPanel('library'); }} proposalActions={proposalActions} mentionPeople={openTaskWorkers} mentionAllNames={detail.task.teamId ? [workspace.teams.find(item => item.id === detail.task.teamId)?.name ?? ''].filter(Boolean) : undefined} openMemories={openWorkerMemories} openChat={openTask} openMainChat={openWorker} scheduleRun={scheduleRunOrigin} askToFix={text => setFollowUpPrefill({ taskId: selected, text, at: Date.now() })} forward={setForwarding} /></FormatPreferences.Provider><FollowUpComposer key={`follow:${selected}`} detail={detail} workspace={workspace} harnesses={harnesses} ready={ready} openSettings={tab => openSettings(tab ?? 'connections')} openChat={openTask} action={action} prefill={followUpPrefill?.taskId === selected ? followUpPrefill : undefined} onPrefilled={() => setFollowUpPrefill(undefined)} readOnly={readOnlyChat} onConnectModel={connectModel} permissionHint={chatHint(detail)} modePicker={chatModePicker(detail)} /></> : <ThreadSkeleton />}</> : (team || emptyChannel || worker) ? <div className="team-chat team-chat-fresh team-chat-start">
        {/* Nothing has been sent yet. The chat is still laid out like every other chat (user, 2026-10-04): the
            greeting and the starters end the thread's column on the left, and the prompt bar is at the bottom. */}
        <div className="fresh-chat team-chat-empty">
          {/* The faces you are about to talk to, big and in 3D (COD-156): a worker alone, or a team or channel side by
              side. They hop in when the chat opens, turn to follow the pointer, and a team glances at each other
              first. Keyed by the chat so switching to another worker greets again. */}
          <div className="fresh-faces" key={team ? `team-${team.id}` : emptyChannel ? emptyChannelKey(emptyChannel) : worker?.id}>
            {team
              ? roster.map(member => <Avatar key={member.id} name={member.name} seed={member.id} mascot={member.avatar?.mascot} defaultMascot hint={member.description} color={member.avatar?.color} size={freshFaceSize(roster.length)} motion={{ lead: true, greet: true, group: `team-${team.id}` }} />)
              : emptyChannel
                ? channelWorkers.slice(0, MAX_CREW_MEMBERS).map(member => <Avatar key={member.id} name={member.name} seed={member.id} mascot={member.avatar?.mascot} defaultMascot hint={member.description} color={member.avatar?.color} size={freshFaceSize(channelWorkers.length)} motion={{ lead: true, greet: true, group: emptyChannelKey(emptyChannel) }} />)
                : worker ? <Avatar name={worker.name} seed={worker.id} emoji={worker.avatar?.emoji} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="xxl" motion={{ lead: true, greet: true }} /> : null}
          </div>
          {/* The start of a chat, the way a messenger opens one: who it is in large type, what they do, then one line
              saying this is where the chat begins. Assistive technology still hears "Chatting with …". */}
          <h1 className="welcome" aria-label={t('Đang nhắn với {0}', [chatName])}>{chatTitle}</h1>
          {chatIntro && <p className="welcome-about">{chatIntro}</p>}
          <p className="welcome-start">{t('Đây là khởi đầu cuộc trò chuyện của bạn với {0}.', [chatTitle])}</p>
          {/* An orglet with no model: the ways to give it one take the place of the starters, which need a model. */}
          {!demoReplies() && emptyChatDemoWorker ? <ConnectWays orgletName={emptyChatDemoWorker.name} ways={connectWays(emptyChatDemoWorker)} /> : <Starters starters={starters} onPick={pickStarter}
            canSchedule={Boolean(brief.trim())}
            onSchedule={worker && !team && !emptyChannel ? () => { setRoutineDraft({ workerId, brief, sourceIds: sources.map(source => source.id), excludedSources: skippedSources, consent: false, providerScopes: [], budgetMicros: taskBudgetMicros }); setRoutineView({ editing: true }); setPanel('routines'); } : undefined} />}
        </div>
        <div className="thread-composer">
          {composerBar}
          <ComposerFoot>{composerHint}</ComposerFoot>
          <SkippedFiles items={skippedSources} />
        </div>
      </div> : workspace.workers.length === 0
        // The last orglet can be deleted; the pane then offers to make one instead of standing empty.
        ? <NoOrglets onCreate={() => { setEditingWorker(undefined); setPanel('worker'); }} />
        : null}
      </>}
    </main>
    {membersShown && headerChannel && <MemberColumn you={account?.name?.trim() || t('Bạn')} members={headerChannel.workers} working={workingIds} leadId={headerChannel.crewId ? crewLeadId : undefined}
      onMessage={member => { clearSelection(); openWorker(member.id); }} onEdit={member => { setEditingWorker(member); setPanel('worker'); }}
      others={headerSpace && headerChannel.access === 'listed' ? workspace.workers.filter(worker => scopeOrgletIds(headerSpace, headerChannel.categoryId).includes(worker.id) && !headerChannel.workers.some(member => member.id === worker.id)) : []}
      onAdd={member => action(async () => {
        const members = [...headerChannel.workers, member].map(item => ({ kind: 'orglet' as const, id: item.id }));
        await orglet.call('updateChannel', { id: headerChannel.id, name: headerChannel.name, topic: headerChannel.topic ?? '', members, access: 'listed' });
        toast(t('Đã thêm {0} vào kênh', [member.name]), 'success', channelLabel(headerChannel.name));
      }, channelLabel(headerChannel.name))}
      removable={member => member.id !== crewLeadId && headerChannel.workers.length > (headerChannel.crewId ? 2 : 1)}
      onRemove={member => action(async () => {
        // The channel may have been made from a crew as one member: the orglets left are listed one by one.
        const staying = headerChannel.workers.filter(item => item.id !== member.id).map(item => ({ kind: 'orglet' as const, id: item.id }));
        // In a space the channel keeps its own list from now on, or the space would put the orglet straight back.
        await orglet.call('updateChannel', { id: headerChannel.id, name: headerChannel.name, topic: headerChannel.topic ?? '', members: staying, ...(headerSpace ? { access: 'listed' as const } : {}) });
        toast(t('Đã xóa {0} khỏi kênh', [member.name]), 'success', channelLabel(headerChannel.name));
      }, channelLabel(headerChannel.name))} />}
    {threadOpen && sideThread && sideThreadRow && <SideThreadPanel key={sideThread.taskId} taskId={sideThread.taskId} focusMessageId={sideThread.messageId}
      title={taskName(sideThread.taskId) ?? sideThreadRow.brief}
      orgletName={workspace.workers.find(item => item.id === sideThreadRow.workerId)?.name ?? 'Orglet'}
      onSettings={() => setPrivacyTaskId(sideThread.taskId)} onClose={() => setPanel(null)} onSeen={() => void refresh()}>
      {(threadDetail, threadRecovery) => <FormatPreferences.Provider value={{ copy: workspace.copyFormat, download: workspace.downloadFormat }}>
        <TaskThread detail={threadDetail} workspace={workspace} recovery={threadRecovery} action={action} islandDock={threadDetail.task.id} embedded
          showSources={target => target?.type === 'source' ? setViewingSource({ id: target.id, lines: target.lines, detail: threadDetail }) : openSources(target)}
          openMessage={messageId => requestAnimationFrame(() => focusMessage(messageId))}
          proposals={[]} openKnowledge={openKnowledge} reviewKnowledge={() => { setLibraryTab('knowledge'); setPanel('library'); }} proposalActions={proposalActions}
          mentionPeople={taskWorkers(threadDetail.task, workspace)} openMemories={openWorkerMemories} openChat={openTask} openMainChat={openWorker}
          askToFix={text => setFollowUpPrefill({ taskId: threadDetail.task.id, text, at: Date.now() })} forward={setForwarding} />
        <FollowUpComposer key={`follow:${threadDetail.task.id}`} detail={threadDetail} workspace={workspace} harnesses={harnesses} ready={ready} islandDock={threadDetail.task.id}
          openSettings={tab => openSettings(tab ?? 'connections')} openChat={openTask} action={action}
          prefill={followUpPrefill?.taskId === threadDetail.task.id ? followUpPrefill : undefined} onPrefilled={() => setFollowUpPrefill(undefined)} onConnectModel={connectModel} modePicker={chatModePicker(threadDetail)} />
      </FormatPreferences.Provider>}
    </SideThreadPanel>}
    {detailsOpen && (detail || detailsTeam || detailsWorker || emptyChannel) && <DetailsPanel workspace={workspace} team={detailsTeam} worker={detailsWorker} group={!selected && emptyChannel ? channelWorkers : undefined} groupName={emptyChannelName} detail={detail}
      recovery={workspaceRecovery} recoveryFocus={recoveryFocus}
      readProcessOutput={detail ? (processId, stream, offset) => orglet.call('recoveryProcessOutput', { taskId: detail.task.id, processId, stream, offset }) : undefined}
      readPrivateFile={detail ? (runId, path, offset) => orglet.call('recoveryFile', { taskId: detail.task.id, runId, path, offset }) : undefined}
      onRetireWorkspace={detail ? (runId, reviewToken) => toolAction(async () => {
        const confirmed = await confirmAction({ title: t('Giữ file hiện tại và kết thúc bản làm việc này?'),
          description: t('File hiện tại không đổi và thay đổi chưa tích hợp không tự áp dụng. Lần cũ không chạy tiếp được; bấm Thử lại để chạy mới.'),
          confirmLabel: t('Giữ file hiện tại'), cancelLabel: t('Quay lại kiểm tra') });
        if (confirmed) await orglet.call('retireWorkspaceAttempt', { taskId: detail.task.id, runId, reviewToken, keepCurrentFiles: true });
      }) : undefined}
      onRestoreFile={detail ? (runId, path) => toolAction(() => orglet.call('restoreWorkspaceFile', { taskId: detail.task.id, runId, path })) : undefined}
      tools={detail ? {
        workers: taskWorkers(detail.task, workspace),
        connectedProviders: (Object.keys(ready) as Worker['provider'][]).filter(provider => ready[provider as keyof typeof ready]),
        onConfigure: provider => openSettings(settingsTabFor([provider])),
        grant: workspaceAccess?.taskId === detail.task.id ? workspaceAccess.grant : undefined,
        busy: toolPolicyBusy,
        locked: readOnlyChat?.note,
        onCapability: (capability, enabled) => changeTaskCapability(detail, capability, enabled),
        onWorkspace: (level, folder) => toolAction(async () => {
          if (level === 'none') await orglet.call('revokeWorkspace', { taskId: detail.task.id });
          else if (folder === 'keep') await orglet.call('setWorkspaceLevel', { taskId: detail.task.id, permissions: permissionsForLevel(level) });
          else await orglet.pickWorkspace(detail.task.id, permissionsForLevel(level));
        }),
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
    {viewingSource && sourceDetail && <SourceDialog key={viewingSource.id} detail={sourceDetail} sourceId={viewingSource.id} lines={viewingSource.lines} onClose={() => setViewingSource(undefined)} refresh={() => void refresh()}
      openSource={id => setViewingSource(current => ({ id, detail: current?.detail }))}
      onAsk={source => {
        // Ask about this (COD-280): the file goes on the chat's next message, and the viewer gives way to the composer.
        // A file opened from the side thread in the right panel goes on that thread's message.
        setFollowUpPrefill({ taskId: viewingSource.detail ? sourceDetail.task.id : selected ?? sourceDetail.task.id, intake: { sources: [source], skipped: [] }, at: Date.now() });
        setViewingSource(undefined);
        // From the Files view the message box is a tab away: go back to the chat, where the file waits on it.
        showChatView('chat');
      }} />}
    <WorkerDialog key={`worker:${panel === 'worker'}:${editingWorker?.id ?? 'new'}:${newOrgletName}`} open={panel === 'worker'} worker={editingWorker} initialName={newOrgletName} workspace={workspace} connections={connections} harnesses={harnesses ?? []} initialTab={workerDialogTab} initialField={workerDialogField} connectModel={workerDialogConnect} onClose={close} onOpenChat={taskId => { close(); openTask(taskId); }} onCreated={id => setJustCreated({ kind: 'worker', id })} />
    {publishingSource && <MarketPublishingDialog key={`${publishingSource.kind}:${publishingSource.entityId}`} source={publishingSource} sourceRevision={publishingSourceRevision(workspace, publishingSource)} requiresSuggestion={publishingRequiresSuggestion(workspace, publishingSource)} onClose={() => setPublishingSource(undefined)} />}
    {spaceDraft && <SpaceDialog key={`space:${spaceDraft.space?.id ?? 'new'}`} open draft={spaceDraft} workspace={workspace} onClose={() => setSpaceDraft(undefined)}
      onCreated={spaceId => { setOpenSpace(spaceId); setArea('channels'); }} />}
    {categoryDraft && <CategoryDialog key={`category:${categoryDraft.space.id}`} open draft={categoryDraft} workspace={workspace} onClose={() => setCategoryDraft(undefined)} />}
    {channelDraft && <ChannelDialog key={`channel:${channelDraft.id ?? 'new'}`} open draft={channelDraft} workspace={workspace} onClose={() => setChannelDraft(undefined)} onCreated={channelCreated} />}
    {privacyTaskId && workspace.tasks.find(task => task.id === privacyTaskId) && <LocalOnlyDialog key={`privacy:${privacyTaskId}`} task={workspace.tasks.find(task => task.id === privacyTaskId)!} workspace={workspace} onClose={() => setPrivacyTaskId(undefined)} />}
    <TaskDialog key={`task:${panel === 'task'}:${editingTask ?? ''}`} open={panel === 'task'} task={workspace.tasks.find(item => item.id === editingTask)} workspace={workspace} usedMicros={editingTask && detail?.task.id === editingTask ? detail.usage.chargedMicros + detail.usage.reservedMicros : 0} onClose={close} />
    <Toaster />
    <Confirmer />
    <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} workspace={workspace} onOpenChat={openChatAt} onOpenOrglet={openWorker} onOpenCrew={openTeam} onDwellTask={dwellChat} />
    <ForwardPicker request={forwarding} options={forwarding ? forwardOptions(workspace, forwarding.taskId, workers => recipientReady(workers.map(item => item.provider))) : []} sending={forwardSending} onSend={choice => void sendForward(choice)} onClose={() => setForwarding(undefined)} />
    <SendToPicker open={Boolean(sentFiles)} count={sentFiles?.count ?? 0} names={sentFiles?.names ?? []} options={sentFiles ? sendToOptions(workspace) : []} onChoose={option => void sendFilesTo(option)} onClose={closeSendTo} />
    <SettingsDialog open={panel === 'settings'} tab={settingsTab} onTab={setSettingsTab} onClose={close} workspace={workspace} connections={connections} onConnections={setConnections} harnesses={harnesses} onHarnesses={setHarnesses} account={account} archive={archiveSections} />
  </div>;
}
