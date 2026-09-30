import type { Task, TaskStatus } from '../shared/contracts';
import { liveTeamTask, liveWorkerTask, type LiveThreadTask } from '../shared/live-task';

/**
 * The open chats as a strip of tabs across the top (COD-340): the roster stays on the left, and the chats being
 * worked with sit side by side with their state. Tabs are window chrome, kept in the renderer's own storage like the
 * read stamps; they never create or change a chat.
 *
 * A tab is keyed by what it opens. An orglet's or crew's main chat is keyed by the orglet or crew, so the tab stays
 * the same when the chat is archived and a fresh one starts; a side thread, a group chat and a schedule's run are
 * keyed by their own row.
 */
export type ChatTabKind = 'worker' | 'team' | 'task';
export type ChatTabTarget = { kind: ChatTabKind; id: string };

/** More tabs than this and the oldest one that is not open gives way. */
export const MAX_CHAT_TABS = 20;

const storageKey = 'orglet.chat-tabs';
const storageVersion = 1;

export function chatTabKey(target: ChatTabTarget): string {
  return `${target.kind}:${target.id}`;
}

export function parseChatTabKey(key: string): ChatTabTarget | undefined {
  const separator = key.indexOf(':');
  if (separator < 0) return undefined;
  const kind = key.slice(0, separator);
  const id = key.slice(separator + 1);
  if (!id) return undefined;
  if (kind !== 'worker' && kind !== 'team' && kind !== 'task') return undefined;
  return { kind, id };
}

type TabTask = LiveThreadTask;

/** The tab a chat row belongs to: its orglet's or crew's tab when it is their main chat, otherwise its own. */
export function tabKeyForTask(task: TabTask, tasks: readonly TabTask[]): string {
  if (task.teamId && liveTeamTask(tasks, task.teamId)?.id === task.id) return chatTabKey({ kind: 'team', id: task.teamId });
  if (!task.teamId && liveWorkerTask(tasks, task.workerId)?.id === task.id) return chatTabKey({ kind: 'worker', id: task.workerId });
  return chatTabKey({ kind: 'task', id: task.id });
}

/** What the main area shows: an open chat, or the empty chat of an orglet, a crew or a group not sent to yet. */
export type ChatView = {
  /** The open chat's id, or null for an empty chat. */
  selected: string | null;
  teamId: string;
  workerId: string;
  /** An empty group chat has no row yet, so it has no tab until its first message. */
  pendingGroup: boolean;
};

/**
 * The tab of what is on screen. Undefined when there is nothing to key yet: an open chat whose row has not arrived
 * (a first message still on its way), or an empty group chat.
 */
export function tabKeyForView(view: ChatView, tasks: readonly TabTask[]): string | undefined {
  if (view.selected) {
    const task = tasks.find(candidate => candidate.id === view.selected);
    return task ? tabKeyForTask(task, tasks) : undefined;
  }
  if (view.pendingGroup) return undefined;
  if (view.teamId) return chatTabKey({ kind: 'team', id: view.teamId });
  if (view.workerId) return chatTabKey({ kind: 'worker', id: view.workerId });
  return undefined;
}

/**
 * Adds a tab at the end, or leaves the strip as it is when the chat already has one (the same array comes back).
 * Past the limit the leftmost other tab gives way.
 */
export function openChatTab(keys: readonly string[], key: string, limit = MAX_CHAT_TABS): readonly string[] {
  if (keys.includes(key)) return keys;
  const next = [...keys, key];
  while (next.length > limit) {
    const oldest = next.findIndex(candidate => candidate !== key);
    next.splice(oldest, 1);
  }
  return next;
}

/**
 * The tab that takes over when `key` closes: the one to its right, or to its left when it was the last. Undefined
 * when it is the only tab.
 */
export function neighbourTab(keys: readonly string[], key: string): string | undefined {
  const index = keys.indexOf(key);
  if (index < 0) return undefined;
  return keys[index + 1] ?? keys[index - 1];
}

export type ClosedTab = { keys: readonly string[]; activate?: string };

/**
 * Takes a tab off the strip. Closing the open chat's tab hands over to its neighbour (`activate`); closing another
 * tab leaves the open chat as it is. The last tab never closes: something is always on screen, and it would come
 * straight back.
 */
export function closeChatTab(keys: readonly string[], key: string, activeKey: string | undefined): ClosedTab {
  if (!keys.includes(key) || keys.length <= 1) return { keys };
  const remaining = keys.filter(candidate => candidate !== key);
  if (key !== activeKey) return { keys: remaining };
  return { keys: remaining, activate: neighbourTab(keys, key) };
}

/** The tab one step to the right (`1`) or left (`-1`) of the open one, wrapping round like a browser's Ctrl+Tab. */
export function cycleChatTab(keys: readonly string[], activeKey: string | undefined, step: 1 | -1): string | undefined {
  if (keys.length < 2) return undefined;
  const index = activeKey ? keys.indexOf(activeKey) : -1;
  if (index < 0) return step === 1 ? keys[0] : keys[keys.length - 1];
  return keys[(index + step + keys.length) % keys.length];
}

/** What the workspace still lists, so a tab whose chat, orglet or crew left can leave the strip too. */
export type ChatTabLists = {
  workers: readonly { id: string }[];
  teams: readonly { id: string }[];
  tasks: readonly Pick<Task, 'id' | 'archivedAt' | 'deletedAt'>[];
};

export function chatTabExists(key: string, lists: ChatTabLists): boolean {
  const target = parseChatTabKey(key);
  if (!target) return false;
  if (target.kind === 'worker') return lists.workers.some(worker => worker.id === target.id);
  if (target.kind === 'team') return lists.teams.some(team => team.id === target.id);
  return lists.tasks.some(task => task.id === target.id && !task.archivedAt && !task.deletedAt);
}

/**
 * Drops tabs whose chat was archived or deleted, or whose orglet or crew was. `keep` is the open chat's tab, which
 * stays while it is on screen (an archived chat can still be read). The same array comes back when nothing changed.
 */
export function pruneChatTabs(keys: readonly string[], lists: ChatTabLists, keep?: string): readonly string[] {
  const kept = keys.filter(key => key === keep || chatTabExists(key, lists));
  return kept.length === keys.length ? keys : kept;
}

/**
 * The one state a tab shows. `needs-you` wins over everything, since a run that stopped to ask is still "running"
 * underneath; then a failure, then work under way, then an answer not read yet.
 */
export type ChatTabState = 'needs-you' | 'error' | 'running' | 'unread' | 'idle';

export type ChatTabFacts = {
  status?: TaskStatus;
  /** The newest answer was opened. */
  seen: boolean;
  /** A run stopped until the person acts: a checkpoint, a question, an MCP approval, the budget (`waitsForPerson`). */
  waitsForPerson?: boolean;
  /** A run's changes wait for the person's review before reaching the folder (`heldForReview`). */
  heldForReview?: boolean;
  /** A browser or desktop step, or an app proposal, waiting for an answer in the chat's last known copy. */
  pendingApproval?: boolean;
};

const ERROR_STATUSES: readonly TaskStatus[] = ['failed', 'interrupted'];
const RUNNING_STATUSES: readonly TaskStatus[] = ['queued', 'running', 'pausing'];
const NEEDS_YOU_STATUSES: readonly TaskStatus[] = ['waiting_input', 'waiting_budget', 'paused'];

export function chatTabState(facts: ChatTabFacts): ChatTabState {
  const { status } = facts;
  if (facts.waitsForPerson || facts.heldForReview || facts.pendingApproval) return 'needs-you';
  if (status && NEEDS_YOU_STATUSES.includes(status)) return 'needs-you';
  if (status && ERROR_STATUSES.includes(status)) return 'error';
  if (status && RUNNING_STATUSES.includes(status)) return 'running';
  if ((status === 'completed' || status === 'partial') && !facts.seen) return 'unread';
  return 'idle';
}

const STATE_ORDER: readonly ChatTabState[] = ['needs-you', 'error', 'running', 'unread', 'idle'];

/** The state that matters most among several chats, for a face on the rail that stands for more than one. */
export function strongestChatTabState(states: readonly ChatTabState[]): ChatTabState {
  return STATE_ORDER.find(state => states.includes(state)) ?? 'idle';
}

/** What is kept between starts: the tab keys in strip order, nothing about the chats themselves. */
export function parseStoredChatTabs(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const stored: unknown = JSON.parse(raw);
    if (!stored || typeof stored !== 'object') return [];
    const { version, keys } = stored as { version?: unknown; keys?: unknown };
    if (version !== storageVersion || !Array.isArray(keys)) return [];
    const valid = keys.filter((key): key is string => typeof key === 'string' && parseChatTabKey(key) !== undefined);
    return [...new Set(valid)].slice(0, MAX_CHAT_TABS);
  } catch {
    return [];
  }
}

export function serializeChatTabs(keys: readonly string[]): string {
  return JSON.stringify({ version: storageVersion, keys });
}

export function readChatTabs(): string[] {
  try {
    return parseStoredChatTabs(localStorage.getItem(storageKey));
  } catch {
    return [];
  }
}

export function writeChatTabs(keys: readonly string[]) {
  try {
    localStorage.setItem(storageKey, serializeChatTabs(keys));
  } catch {
    // No storage: the strip starts empty next time, as on a new install.
  }
}

/**
 * How the left column shows the roster: the narrow rail of faces, or the full sidebar with its sections. The rail is
 * the default; a profile from before the tabs keeps the full sidebar it has always had, until the person folds it.
 */
export type SidebarMode = 'rail' | 'full';

const sidebarModeKey = 'orglet.sidebar-mode';
/** Keys only a profile that has been used before holds: the last open chat and the dragged sidebar width. */
const earlierProfileKeys = ['orglet.last-open-chat', 'orglet.sidebar-width'];

export function initialSidebarMode(stored: string | null, hasEarlierProfile: boolean): SidebarMode {
  if (stored === 'rail' || stored === 'full') return stored;
  return hasEarlierProfile ? 'full' : 'rail';
}

/**
 * The mode to start in. The first answer is written down at once: a new install writes its last open chat within
 * seconds, and would otherwise read as an earlier profile on its next start.
 */
export function readSidebarMode(): SidebarMode {
  try {
    const stored = localStorage.getItem(sidebarModeKey);
    const hasEarlierProfile = earlierProfileKeys.some(key => localStorage.getItem(key) !== null);
    const mode = initialSidebarMode(stored, hasEarlierProfile);
    if (stored !== mode) localStorage.setItem(sidebarModeKey, mode);
    return mode;
  } catch {
    return 'rail';
  }
}

export function writeSidebarMode(mode: SidebarMode) {
  try {
    localStorage.setItem(sidebarModeKey, mode);
  } catch {
    // No storage: the next start falls back to the default.
  }
}
