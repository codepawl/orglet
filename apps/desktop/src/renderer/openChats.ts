import type { Task, TaskStatus } from '../shared/contracts';
import { liveTeamTask, liveWorkerTask, type LiveThreadTask } from '../shared/live-task';

/**
 * Which chat is on screen, and which ones are kept at hand (COD-355). The left column picks the chat, Slack-style: the
 * roster rows open an orglet's or a crew's main chat, and the **Open** list holds the other chats being worked in (side
 * threads, group chats, schedule runs) until they are closed. Ctrl+Tab walks every chat in the order it was last used.
 * Both lists are window chrome, kept in the renderer's own storage like the read stamps; they never create or change a
 * chat.
 *
 * A chat is keyed by what it opens. An orglet's or crew's main chat is keyed by the orglet or crew, so the key stays the
 * same when the chat is archived and a fresh one starts; a side thread, a group chat and a schedule's run are keyed by
 * their own row.
 */
export type ChatKeyKind = 'worker' | 'team' | 'task';
export type ChatKeyTarget = { kind: ChatKeyKind; id: string };

/** More open chats than this and the one opened longest ago gives way. */
export const MAX_OPEN_CHATS = 20;
/** How many chats Ctrl+Tab remembers. */
export const MAX_RECENT_CHATS = 20;

const storageKey = 'orglet.chat-tabs';
const storageVersion = 2;

export function chatKey(target: ChatKeyTarget): string {
  return `${target.kind}:${target.id}`;
}

export function parseChatKey(key: string): ChatKeyTarget | undefined {
  const separator = key.indexOf(':');
  if (separator < 0) return undefined;
  const kind = key.slice(0, separator);
  const id = key.slice(separator + 1);
  if (!id) return undefined;
  if (kind !== 'worker' && kind !== 'team' && kind !== 'task') return undefined;
  return { kind, id };
}

/** A roster chat (an orglet's or crew's main chat) has its own row; only the other chats go on the Open list. */
export function isRosterChat(key: string): boolean {
  const target = parseChatKey(key);
  return target !== undefined && target.kind !== 'task';
}

type KeyedTask = LiveThreadTask;

/** The key of a chat row: its orglet's or crew's when it is their main chat, otherwise its own. */
export function chatKeyForTask(task: KeyedTask, tasks: readonly KeyedTask[]): string {
  if (task.teamId && liveTeamTask(tasks, task.teamId)?.id === task.id) return chatKey({ kind: 'team', id: task.teamId });
  if (!task.teamId && liveWorkerTask(tasks, task.workerId)?.id === task.id) return chatKey({ kind: 'worker', id: task.workerId });
  return chatKey({ kind: 'task', id: task.id });
}

/** What the main area shows: an open chat, or the empty chat of an orglet, a crew or a group not sent to yet. */
export type ChatView = {
  /** The open chat's id, or null for an empty chat. */
  selected: string | null;
  teamId: string;
  workerId: string;
  /** An empty group chat has no row yet, so it has no key until its first message. */
  pendingGroup: boolean;
};

/**
 * The key of what is on screen. Undefined when there is nothing to key yet: an open chat whose row has not arrived
 * (a first message still on its way), or an empty group chat.
 */
export function chatKeyForView(view: ChatView, tasks: readonly KeyedTask[]): string | undefined {
  if (view.selected) {
    const task = tasks.find(candidate => candidate.id === view.selected);
    return task ? chatKeyForTask(task, tasks) : undefined;
  }
  if (view.pendingGroup) return undefined;
  if (view.teamId) return chatKey({ kind: 'team', id: view.teamId });
  if (view.workerId) return chatKey({ kind: 'worker', id: view.workerId });
  return undefined;
}

/**
 * `open`: the Open list in the order its chats were opened, so a row never jumps when another is clicked.
 * `recent`: every chat visited, most recent first, for Ctrl+Tab.
 */
export type OpenChats = { open: readonly string[]; recent: readonly string[] };

export const NO_OPEN_CHATS: OpenChats = { open: [], recent: [] };

function withFirst(keys: readonly string[], key: string, limit: number): readonly string[] {
  if (keys[0] === key) return keys;
  return [key, ...keys.filter(candidate => candidate !== key)].slice(0, limit);
}

function withLast(keys: readonly string[], key: string, limit: number): readonly string[] {
  if (keys.includes(key)) return keys;
  const next = [...keys, key];
  while (next.length > limit) next.shift();
  return next;
}

/**
 * The chat on screen moves to the front of the recent list, and a chat that is not a roster row joins the end of the
 * Open list. The same object comes back when nothing changed.
 */
export function visitChat(state: OpenChats, key: string): OpenChats {
  const recent = withFirst(state.recent, key, MAX_RECENT_CHATS);
  const open = isRosterChat(key) ? state.open : withLast(state.open, key, MAX_OPEN_CHATS);
  if (recent === state.recent && open === state.open) return state;
  return { open, recent };
}

export type ClosedChat = { state: OpenChats; activate?: string };

/**
 * Takes a chat off the Open list, and out of the recent list so Ctrl+Tab does not bring it back. Closing the chat on
 * screen hands over to the chat used before it (`activate`); closing another one leaves the screen as it is. A roster
 * chat has its row and cannot be closed.
 */
export function closeOpenChat(state: OpenChats, key: string, activeKey: string | undefined): ClosedChat {
  if (!state.open.includes(key)) return { state };
  const next = { open: state.open.filter(candidate => candidate !== key), recent: state.recent.filter(candidate => candidate !== key) };
  if (key !== activeKey) return { state: next };
  return { state: next, activate: next.recent[0] };
}

/**
 * One step of a Ctrl+Tab walk. While Ctrl is held the recent list stays as it was when the walk began (`snapshot`), so
 * each press goes one chat further back, and Shift goes forward again; the walk wraps round. Undefined with fewer than
 * two chats.
 */
export function walkRecent(snapshot: readonly string[], position: number, step: 1 | -1): number | undefined {
  if (snapshot.length < 2) return undefined;
  return (position + step + snapshot.length) % snapshot.length;
}

/** The recent list a walk starts from: the chat on screen first, even when an empty chat has not been keyed yet. */
export function walkSnapshot(recent: readonly string[], activeKey: string | undefined): readonly string[] {
  return activeKey ? withFirst(recent, activeKey, MAX_RECENT_CHATS + 1) : recent;
}

/** What the workspace still lists, so a chat whose row, orglet or crew left can leave the lists too. */
export type OpenChatLists = {
  workers: readonly { id: string }[];
  teams: readonly { id: string }[];
  tasks: readonly Pick<Task, 'id' | 'archivedAt' | 'deletedAt'>[];
};

export function chatExists(key: string, lists: OpenChatLists): boolean {
  const target = parseChatKey(key);
  if (!target) return false;
  if (target.kind === 'worker') return lists.workers.some(worker => worker.id === target.id);
  if (target.kind === 'team') return lists.teams.some(team => team.id === target.id);
  return lists.tasks.some(task => task.id === target.id && !task.archivedAt && !task.deletedAt);
}

/**
 * Drops chats that were archived or deleted, or whose orglet or crew was. `keep` is the chat on screen, which stays
 * while it is read (an archived chat can still be opened). The same object comes back when nothing changed.
 */
export function pruneOpenChats(state: OpenChats, lists: OpenChatLists, keep?: string): OpenChats {
  const stays = (key: string) => key === keep || chatExists(key, lists);
  const open = state.open.filter(stays);
  const recent = state.recent.filter(stays);
  if (open.length === state.open.length && recent.length === state.recent.length) return state;
  return { open, recent };
}

/**
 * The one state an open chat shows. `needs-you` wins over everything, since a run that stopped to ask is still
 * "running" underneath; then a failure, then work under way, then an answer not read yet.
 */
export type OpenChatState = 'needs-you' | 'error' | 'running' | 'unread' | 'idle';

export type OpenChatFacts = {
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

export function openChatState(facts: OpenChatFacts): OpenChatState {
  const { status } = facts;
  if (facts.waitsForPerson || facts.heldForReview || facts.pendingApproval) return 'needs-you';
  if (status && NEEDS_YOU_STATUSES.includes(status)) return 'needs-you';
  if (status && ERROR_STATUSES.includes(status)) return 'error';
  if (status && RUNNING_STATUSES.includes(status)) return 'running';
  if ((status === 'completed' || status === 'partial') && !facts.seen) return 'unread';
  return 'idle';
}

const STATE_ORDER: readonly OpenChatState[] = ['needs-you', 'error', 'running', 'unread', 'idle'];

/** The state that matters most among several chats, for a face on the rail that stands for more than one. */
export function strongestOpenChatState(states: readonly OpenChatState[]): OpenChatState {
  return STATE_ORDER.find(state => states.includes(state)) ?? 'idle';
}

function validKeys(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const valid = value.filter((key): key is string => typeof key === 'string' && parseChatKey(key) !== undefined);
  return [...new Set(valid)].slice(0, limit);
}

/**
 * What is kept between starts: the two lists of keys, nothing about the chats themselves. Version 1 was the tab strip
 * of COD-340, one list in strip order with the newest tab last: its other chats become the Open list in the same order,
 * and the strip read backwards becomes the recent list.
 */
export function parseStoredOpenChats(raw: string | null | undefined): OpenChats {
  if (!raw) return NO_OPEN_CHATS;
  try {
    const stored: unknown = JSON.parse(raw);
    if (!stored || typeof stored !== 'object') return NO_OPEN_CHATS;
    const { version, keys, open, recent } = stored as { version?: unknown; keys?: unknown; open?: unknown; recent?: unknown };
    if (version === 1) {
      const strip = validKeys(keys, MAX_OPEN_CHATS);
      return { open: strip.filter(key => !isRosterChat(key)), recent: [...strip].reverse().slice(0, MAX_RECENT_CHATS) };
    }
    if (version !== storageVersion) return NO_OPEN_CHATS;
    return { open: validKeys(open, MAX_OPEN_CHATS).filter(key => !isRosterChat(key)), recent: validKeys(recent, MAX_RECENT_CHATS) };
  } catch {
    return NO_OPEN_CHATS;
  }
}

export function serializeOpenChats(state: OpenChats): string {
  return JSON.stringify({ version: storageVersion, open: state.open, recent: state.recent });
}

export function readOpenChats(): OpenChats {
  try {
    return parseStoredOpenChats(localStorage.getItem(storageKey));
  } catch {
    return NO_OPEN_CHATS;
  }
}

export function writeOpenChats(state: OpenChats) {
  try {
    localStorage.setItem(storageKey, serializeOpenChats(state));
  } catch {
    // No storage: the lists start empty next time, as on a new install.
  }
}

/**
 * How the left column shows the roster: the narrow rail of faces, or the full sidebar with its sections. The rail is
 * the default; a profile from before the rail keeps the full sidebar it has always had, until the person folds it.
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
