import type { Bridge, Command } from '../shared/contracts';
import type { ElevationScope } from '../shared/terminal-access';
import { HELD_ACTIONS, type HeldAction } from './held-protocol';

/**
 * What the `orglet` terminal command can do that the desktop window can, command by command and method by method.
 * Every key of the core `commands` in `shared/contracts.ts` and every method of the window's `Bridge` has exactly one
 * answer here, and `tests/integration/cli-parity.test.ts` fails when one is missing, one is left over, or a `reached`
 * answer names a command that no `main/cli-*.ts` file sends. Adding a command or a method without deciding what the
 * terminal does about it does not compile, which is the point.
 *
 * - `reached`: a terminal command sends it. `command` names the `orglet` command; `through` names the internal
 *   command it sends instead when that is a different one from the key.
 * - `window-only`: it needs the window itself (a picture, a native picker, window chrome, an event the window waits for).
 * - `elevated`: a terminal command sends it, but only with an elevation the person gave by typing a code the window
 *   showed (docs/cli-held-actions-design.md). `scope` is the least scope that allows it. The server's set of elevated
 *   operations is derived from these entries through `HELD_ACTIONS`, and a test fails when the two disagree.
 * - `held`: it is a grant, a secret, an approval, a deletion of data or a money limit. The pipe token sits in the data
 *   folder, which an orglet running through a harness CLI can read as the same user, so anything the pipe could approve
 *   an orglet could approve for itself (see `protocol.ts`). These stay in the window on purpose.
 *
 * Later phases of the plan in issue #554 move entries from `window-only` to `reached`; an entry changes in the same
 * commit as the code that makes it true.
 */
export type Parity =
  | { status: 'reached'; command: string; through?: string }
  | { status: 'elevated'; command: string; scope: ElevationScope }
  | { status: 'window-only'; reason: string }
  | { status: 'held'; reason: string };

function elevated(command: string, scope: ElevationScope): Parity {
  return { status: 'elevated', command, scope };
}

function reached(command: string, through?: string): Parity {
  return through ? { status: 'reached', command, through } : { status: 'reached', command };
}

function windowOnly(reason: string): Parity {
  return { status: 'window-only', reason };
}

function held(reason: string): Parity {
  return { status: 'held', reason };
}

const AN_APPROVAL = 'an approval or review decision the person makes in the window';
const A_GRANT = 'a grant of access, so the person gives it in the window';
const A_SECRET = 'a key, token or sign-in, which never goes through the pipe';
const A_DELETION = 'deletes data for good; the terminal deletes only with a typed name where it does at all';
const VISUAL = 'visual: a picture, a diff or a live view that needs the window';
const NOT_BUILT = 'no terminal command yet';

/** The core commands: one answer for each key of `commands`. */
export const COMMAND_PARITY: Record<Command, Parity> = {
  marketCatalog: reached('orglet market'),
  marketAdd: reached('orglet market add'),
  marketInstallations: reached('orglet market installed'),
  marketPreviewUpdate: reached('orglet market update'),
  // Applies only the update a code names, and the code is printed by the preview of that same update.
  marketApplyUpdate: reached('orglet market update --confirm'),
  marketUpdateRecords: reached('orglet update'),
  workspace: reached('orglet list'),
  task: reached('orglet read'),
  createTask: reached('orglet send'),
  reviseTask: reached('orglet send'),
  startSideThread: reached('orglet side'),
  bringIntoMainChat: reached('orglet bring'),
  forwardMessage: reached('orglet forward'),
  setMessageReaction: reached('orglet react'),
  answerDecision: reached('orglet answer'),
  saveWorker: reached('orglet create orglet'),
  setSyncLocalOnly: windowOnly('a switch on the account page; ' + NOT_BUILT),
  syncConflicts: windowOnly('the side-by-side choice of two versions; ' + NOT_BUILT),
  resolveSyncConflict: held('chooses which version of a chat or orglet is kept, and the other is dropped'),
  saveTeam: windowOnly('the crew record behind a channel with a lead; the terminal changes it through createChannel and updateChannel'),
  createTemplate: reached('orglet template'),
  saveSkill: windowOnly('skills are edited as files in the editor; ' + NOT_BUILT),
  inspectSkill: windowOnly('shows a skill package for review; ' + NOT_BUILT),
  reviewSkill: held('trusts a skill package after the person has read it'),
  saveRoutine: reached('orglet schedule add'),
  dismissRoutine: reached('orglet schedule dismiss'),
  catchUpRoutine: reached('orglet schedule catch-up'),
  runRoutineNow: reached('orglet run', 'runRoutine'),
  deleteRoutine: reached('orglet schedule delete'),
  cancel: reached('orglet stop'),
  pause: reached('orglet pause'),
  resume: reached('orglet resume'),
  retry: reached('orglet retry'),
  reconcileBudget: elevated('orglet reconcile', 'decisions'),
  revoke: held('takes a file back from an orglet, which is a grant the person manages'),
  setToolCapabilities: held(A_GRANT),
  workspaceAccess: windowOnly('shows which folder a chat may use; ' + NOT_BUILT),
  // Listed without the review token that applies or discards a hand-in, which stays in the window.
  workspaceRecovery: reached('orglet show changes'),
  retireWorkspaceAttempt: windowOnly('closes a recovery view; ' + NOT_BUILT),
  recoveryProcessOutput: windowOnly(VISUAL),
  recoveryFile: windowOnly(VISUAL),
  restoreWorkspaceFile: held('writes a file into the granted folder'),
  workspaceDiff: windowOnly(VISUAL),
  applyBlockedHandIn: elevated('orglet approve', 'decisions'),
  applyWorkspaceReview: elevated('orglet approve', 'decisions'),
  discardWorkspaceReview: elevated('orglet approve', 'decisions'),
  revokeWorkspace: held(A_GRANT),
  setWorkspaceLevel: held(A_GRANT),
  previewSource: windowOnly(VISUAL),
  sourceBytes: windowOnly(VISUAL),
  tablePreview: windowOnly(VISUAL),
  sourceOrigins: windowOnly('shows where a file came from; ' + NOT_BUILT),
  saveSourceVersion: windowOnly('saves an edit made in the file editor'),
  sourceMetadata: reached('orglet show sources'),
  profileSources: windowOnly('the data checker and its charts need the window'),
  auditRunLog: windowOnly('the data checker and its charts need the window'),
  scoreExactMatch: windowOnly('the data checker and its charts need the window'),
  cancelCheckers: windowOnly('stops the data checker the window started'),
  accept: held(AN_APPROVAL),
  markTaskSeen: windowOnly('read marks follow what the window shows'),
  acknowledgeEvidence: held(AN_APPROVAL),
  saveKnowledge: held('saves a note as approved with no review, so any orglet that can read the pipe token could write guidance for the others'),
  applyAppProposal: elevated('orglet approve', 'decisions'),
  dismissAppProposal: elevated('orglet approve', 'decisions'),
  undoAppProposal: elevated('orglet approve', 'decisions'),
  reviewKnowledge: elevated('orglet approve', 'decisions'),
  searchKnowledge: reached('orglet library'),
  searchChats: reached('orglet search'),
  updateMemory: reached('orglet memory edit'),
  deleteMemory: reached('orglet memory delete'),
  harnesses: reached('orglet show connections'),
  harnessUsage: reached('orglet usage'),
  claimHarnessReset: windowOnly('a notice about a plan reset'),
  openCodeGoUsage: windowOnly('plan usage of one provider; ' + NOT_BUILT),
  saveHarnessAccount: held(A_SECRET),
  removeHarnessAccount: held(A_SECRET),
  selectHarnessAccount: held(A_SECRET),
  startHarnessSignIn: held(A_SECRET),
  cancelHarnessSignIn: held(A_SECRET),
  signOutHarness: held(A_SECRET),
  eraseData: held(A_DELETION),
  modelList: reached('orglet models'),
  saveCustomConnection: held(A_SECRET),
  deleteCustomConnection: held(A_SECRET),
  setCurrency: windowOnly('a display setting; ' + NOT_BUILT),
  renameTask: reached('orglet rename'),
  archiveTask: reached('orglet archive'),
  archiveEntity: reached('orglet archive orglet, orglet archive channel'),
  deleteEntity: reached('orglet delete orglet, orglet delete channel with messages'),
  deleteTask: reached('orglet delete --chat'),
  createChannel: reached('orglet channel, orglet create channel'),
  updateChannel: reached('orglet members, orglet edit channel'),
  deleteChannel: reached('orglet delete channel'),
  createSpace: reached('orglet space add'),
  updateSpace: reached('orglet space edit'),
  deleteSpace: reached('orglet space delete'),
  spaceFromCategory: windowOnly('turns a category of loose channels into a space; ' + NOT_BUILT),
  adoptLooseChannels: reached('orglet channel'),
  // Who answers and a lower cost limit; a higher limit and the sync switch stay in the window.
  updateTask: reached('orglet assign'),
  reorder: reached('orglet space order'),
  saveAvatarColors: windowOnly('a colour picker'),
  refreshCurrency: windowOnly('a display setting; ' + NOT_BUILT),
  testMcpServer: elevated('orglet test mcp', 'decisions'),
  testWebSearch: elevated('orglet test web-search', 'decisions'),
  setMcpServerEnabled: held(A_GRANT),
  setMcpGrant: held(A_GRANT),
  setBrowser: held(A_GRANT),
  browserActions: reached('orglet show browser'),
  browserScreenshot: windowOnly(VISUAL),
  answerBrowserApproval: elevated('orglet approve', 'decisions'),
  browserTakeOver: held(A_GRANT),
  setDesktop: held(A_GRANT),
  desktopWindows: windowOnly('the list of windows the person granted; ' + NOT_BUILT),
  desktopActions: reached('orglet show desktop'),
  desktopScreenshot: windowOnly(VISUAL),
  answerDesktopApproval: elevated('orglet approve', 'decisions'),
  decisionModelSetting: windowOnly('which connection answers the decision model; ' + NOT_BUILT),
  saveDecisionModelSetting: held('chooses which provider receives the text the decision model reads, so the person chooses it in the window'),
  testDecisionModel: elevated('orglet test decision-model', 'decisions'),
  suggestPermissions: windowOnly('a hint shown beside the message box'),
  accountChoice: held('the first-run choice about the CodePawl account'),
  settings: reached('orglet preferences'),
};

/** The window's own methods, one answer for each method of `Bridge`. */
export const BRIDGE_PARITY: Record<keyof Bridge, Parity> = {
  call: windowOnly('the transport for the commands above, which are classified one by one'),
  pickSources: windowOnly('a native file picker; the terminal takes --file instead'),
  pickFolder: windowOnly('a native folder picker'),
  openSource: windowOnly('opens a file in the system app'),
  relinkSource: windowOnly('a native file picker'),
  pickWorkspace: held('picks the folder an orglet may work in, which is a grant'),
  pickNewChatWorkspace: held('picks the folder an orglet may work in, which is a grant'),
  pickWatchFolder: held('picks the folder a schedule watches, which is a grant'),
  pickRoutineWorkspace: held('picks the folder a schedule works in, which is a grant'),
  connect: held(A_SECRET),
  disconnect: held(A_SECRET),
  connections: windowOnly('a method of the window; the terminal shows the same yes-or-no list with orglet show connections'),
  exportArtifact: windowOnly('a native save dialog'),
  copyArtifact: windowOnly('the window\'s clipboard'),
  copyFeedback: windowOnly('the window\'s clipboard'),
  copyText: windowOnly('the window\'s clipboard'),
  exportTemplate: windowOnly('a native save dialog'),
  importTemplate: windowOnly('a native open dialog'),
  importSkill: windowOnly('a native open dialog'),
  exportSkill: windowOnly('a native save dialog'),
  openPricing: windowOnly('opens a link in the browser'),
  backup: held('writes everything, keys excluded, to a file the person picks'),
  restore: held('replaces the data on this computer'),
  about: windowOnly('the About page'),
  marketPublishing: held('publishing is the person\'s own act and never a terminal one'),
  marketModeration: held('moderation is the person\'s own act and never a terminal one'),
  accountState: windowOnly('Settings, Account; ' + NOT_BUILT),
  accountSignIn: held(A_SECRET),
  accountCancelSignIn: held(A_SECRET),
  accountReopenSignIn: held(A_SECRET),
  accountSignInLink: held(A_SECRET),
  accountSignOut: held(A_SECRET),
  onAccount: windowOnly('an event the window subscribes to'),
  syncState: windowOnly('Settings, Account; ' + NOT_BUILT),
  syncStart: held('joins this computer to the account and merges or replaces data'),
  syncPreview: windowOnly('counts shown before a computer joins the account'),
  syncDownloadSource: windowOnly('fetches a file from another computer; ' + NOT_BUILT),
  onSync: windowOnly('an event the window subscribes to'),
  analyticsState: windowOnly('Settings, Account; ' + NOT_BUILT),
  setAnalytics: held('a consent switch'),
  reportFeature: windowOnly('counts what the window itself did'),
  reportError: windowOnly('reports an error the window caught'),
  openLink: windowOnly('opens a link in the browser'),
  openUrl: windowOnly('opens a link from a chat in the browser'),
  saveChart: windowOnly('saves a chart drawn in the window'),
  changelog: windowOnly('a method of the window; the terminal shows the releases with orglet show changelog'),
  updateState: windowOnly('a method of the window; the terminal shows the state with orglet show update'),
  checkForUpdates: windowOnly('a method of the window; the terminal starts a check with orglet update'),
  quit: windowOnly('window chrome'),
  installUpdate: elevated('orglet install-update', 'decisions'),
  onChange: windowOnly('an event the window subscribes to'),
  onUpdate: windowOnly('an event the window subscribes to'),
  onProgress: windowOnly('an event the window subscribes to; the terminal polls with orglet read'),
  onNavigate: windowOnly('an event the window subscribes to'),
  cliState: windowOnly('the Settings row for this very command'),
  setCliOnPath: held('changes the PATH of the person\'s account'),
  saveMcpServer: held(A_SECRET),
  removeMcpServer: held(A_GRANT),
  signInMcpServer: held(A_SECRET),
  cancelMcpSignIn: held(A_SECRET),
  importMcpServers: held(A_GRANT),
  saveWebSearchKey: held(A_SECRET),
  removeWebSearchKey: held(A_SECRET),
  onOpenChat: windowOnly('an event the window subscribes to'),
  notifyInBackground: windowOnly('a system notification the window raises'),
  onOpenTask: windowOnly('an event the window subscribes to'),
  takeIncoming: windowOnly('what Explorer\'s Send to handed to the window'),
  onIncoming: windowOnly('an event the window subscribes to'),
  takeSentFiles: windowOnly('files from Explorer\'s Send to; the terminal takes --file instead'),
  dropSentFiles: windowOnly('files from Explorer\'s Send to; the terminal takes --file instead'),
  sendToState: windowOnly('Explorer\'s Send to menu'),
  setSendTo: held('changes the person\'s Explorer menu'),
  browserState: windowOnly('the browser profiles page; ' + NOT_BUILT),
  createBrowserProfile: held('a browser profile holds sign-ins'),
  openBrowserProfile: held('a browser profile holds sign-ins'),
  closeBrowserProfile: windowOnly('closes a profile window'),
  clearBrowserProfile: held(A_DELETION),
  deleteBrowserProfile: held(A_DELETION),
  watchBrowser: windowOnly(VISUAL),
  browserInput: held('drives the real browser with the person\'s hands'),
  onBrowserLive: windowOnly('an event the window subscribes to'),
  onTerminalAccess: windowOnly('an event the window subscribes to'),
  terminalAccessState: windowOnly('the pairing dialog and the live mark; the terminal pairs with orglet unlock'),
  cancelTerminalPairing: windowOnly('the Cancel button of the pairing dialog'),
  endTerminalAccess: windowOnly('End now, in the window; the terminal ends its own with /lock'),
  terminalJournal: windowOnly('Settings, What the terminal did; the terminal reads it with orglet show terminal'),
};

/** Every core command and Bridge method that has the `elevated` answer. */
export function elevatedKeys(): string[] {
  const entries = [...Object.entries(COMMAND_PARITY), ...Object.entries(BRIDGE_PARITY)] as [string, Parity][];
  return entries.filter(([, entry]) => entry.status === 'elevated').map(([key]) => key);
}

const SCOPE_RANK: Record<ElevationScope, number> = { decisions: 0, one: 0, setup: 1 };

/**
 * The least scope that allows a held action, read from the answers the table gives the keys the action stands for.
 * An action with no key of its own (the MCP approval branch of `answerDecision`) is a decision.
 */
export function heldActionScope(action: HeldAction): ElevationScope {
  const table: Record<string, Parity> = { ...COMMAND_PARITY, ...BRIDGE_PARITY };
  let scope: ElevationScope = 'decisions';
  for (const key of HELD_ACTIONS[action].keys) {
    const entry = table[key];
    if (entry?.status === 'elevated' && SCOPE_RANK[entry.scope] > SCOPE_RANK[scope]) scope = entry.scope;
  }
  return scope;
}
