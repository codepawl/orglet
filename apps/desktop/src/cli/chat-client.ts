import { callStartingApp } from './client';
import { DEFAULT_WAIT_SECONDS, type BringValue, type ChatChangeValue, type ChatControl, type ChatsValue, type CliErrorCode, type CliRequestBody, type ControlValue, type ForwardValue, type ListValue, type MembersValue, type OpenValue, type ReactValue, type ReadValue, type SendValue } from './protocol';
import type { Reaction } from '../shared/message-interactions';
import type { LibraryValue, ModelsValue, PreferencesValue, RunningValue, RunValue, SchedulesValue, ScheduleValue, SearchValue, SpacesValue, UsageValue } from './protocol';
import type { CliProgressFrame } from './protocol';
import { ManagementCatalog, ManagementResult, type ManagementClient } from './management';

/**
 * What `orglet chat` asks the app (COD-236), as one object the interactive session takes, so a test can hand it a fake
 * app. Each call is one request over the pipe, the same requests the one-shot commands make. A `to` that starts with
 * `#` is a chat's id from `orglet chats` (COD-354); anything else is an orglet's or crew's name.
 */
export type ChatClient = {
  list: () => Promise<ListValue>;
  /** Waits for the turn; aborting `signal` stops waiting and leaves the turn running in the app. */
  send: (to: string, message: string, signal: AbortSignal, progress?: (frame: CliProgressFrame) => void) => Promise<SendValue>;
  read: (to: string) => Promise<ReadValue>;
  open: (to: string) => Promise<OpenValue>;
  management?: ManagementClient;
  actions?: ChatActionClient;
};

/**
 * What the terminal chat does to a chat's messages and its latest turn, and to the chats themselves (COD-354).
 * Optional so a test can hand the session an app without them; each call is the request the matching one-shot
 * command makes.
 */
export type ChatActionClient = {
  history: (to: string, turns: number, before?: number) => Promise<ReadValue>;
  reply: (to: string, message: string, replyTo: string, signal: AbortSignal, progress?: (frame: CliProgressFrame) => void) => Promise<SendValue>;
  react: (to: string, emoji: Reaction, active: boolean, message?: string) => Promise<ReactValue>;
  forward: (to: string, targets: string[], message?: string) => Promise<ForwardValue>;
  control: (to: string, action: ChatControl, signal: AbortSignal) => Promise<ControlValue>;
  revise?: (to: string, message: string, text: string, signal: AbortSignal) => Promise<ControlValue>;
  answer: (to: string, answer: string, signal: AbortSignal) => Promise<ControlValue>;
  chats: (archived: boolean) => Promise<ChatsValue>;
  side: (to: string, message: string, signal: AbortSignal) => Promise<SendValue>;
  bring: (chat: string, message?: string) => Promise<BringValue>;
  channel: (names: string[], message: string, signal: AbortSignal) => Promise<SendValue>;
  members: (chat: string, names: string[]) => Promise<MembersValue>;
  rename: (to: string, title: string) => Promise<ChatChangeValue>;
  archive: (to: string) => Promise<ChatChangeValue>;
  schedules: () => Promise<SchedulesValue>;
  spaces: () => Promise<SpacesValue>;
  enableSchedule: (schedule: string, enabled: boolean) => Promise<ScheduleValue>;
  runSchedule: (schedule: string) => Promise<RunValue>;
  search: (query: string) => Promise<SearchValue>;
  running: () => Promise<RunningValue>;
  memories: (owner: string) => Promise<LibraryValue>;
  usage: () => Promise<UsageValue>;
  models: (to: string) => Promise<ModelsValue>;
  preferences: (changes: { language?: 'vi' | 'en' | 'en-GB'; theme?: 'system' | 'light' | 'dark' }) => Promise<PreferencesValue>;
};

/** The app answered but said no: an unknown name, a chat with no conversation yet, a refused request. */
export class AppRefusal extends Error {
  constructor(message: string, readonly code: CliErrorCode) {
    super(message);
  }
}

/** The request fields for a chat: `#` and an id names a chat, anything else an orglet or crew. */
export function chatFields(to: string): { to: string } | { chat: string } {
  return to.startsWith('#') ? { chat: to.slice(1) } : { to };
}

const WAIT = { wait: true, timeoutSeconds: DEFAULT_WAIT_SECONDS };

export function appChatClient(userData: string, executable: string | undefined): ChatClient {
  async function request<Value>(body: CliRequestBody, signal?: AbortSignal, progress?: (frame: CliProgressFrame) => void): Promise<Value> {
    const response = await callStartingApp(userData, body, executable, signal, progress);
    if (!response.ok) throw new AppRefusal(response.error, response.code);
    return response.value as Value;
  }
  return {
    list: () => request<ListValue>({ op: 'list' }),
    send: async (to, message, signal, progress) => {
      const body = { op: 'send' as const, ...chatFields(to), message, files: [], ...WAIT };
      try {
        return await request<SendValue>({ ...body, ...(progress ? { progress: true } : {}) }, signal, progress);
      } catch (error) {
        // An old strict schema refuses the flag before dispatch; retrying only that refusal cannot send twice.
        if (!progress || !(error instanceof AppRefusal) || error.code !== 'invalid') throw error;
        return request<SendValue>(body, signal);
      }
    },
    read: to => request<ReadValue>({ op: 'read', ...chatFields(to) }),
    // A chat by id has no orglet or crew to open on; the window comes forward as it is.
    open: to => request<OpenValue>(to.startsWith('#') ? { op: 'open' } : { op: 'open', to }),
    actions: {
      history: (to, turns, before) => request<ReadValue>({ op: 'read', ...chatFields(to), turns, ...(before ? { before } : {}) }),
      reply: (to, message, replyTo, signal, progress) => {
        const body = { op: 'send' as const, ...chatFields(to), message, files: [], ...WAIT, replyTo };
        return request<SendValue>({ ...body, ...(progress ? { progress: true } : {}) }, signal, progress);
      },
      react: (to, emoji, active, message) => request<ReactValue>({ op: 'react', ...chatFields(to), emoji, active, ...(message ? { message } : {}) }),
      forward: (to, targets, message) => request<ForwardValue>({ op: 'forward', ...chatFields(to), targets, ...(message ? { message } : {}) }),
      control: (to, action, signal) => request<ControlValue>({ op: 'control', ...chatFields(to), action, ...WAIT }, signal),
      revise: (to, message, text, signal) => request<ControlValue>({ op: 'revise', ...chatFields(to), message, text, ...WAIT }, signal),
      answer: (to, answer, signal) => request<ControlValue>({ op: 'answer', ...chatFields(to), answer, ...WAIT }, signal),
      chats: archived => request<ChatsValue>({ op: 'chats', archived }),
      side: (to, message, signal) => request<SendValue>({ op: 'side-thread', ...chatFields(to), message, ...WAIT }, signal),
      bring: (chat, message) => request<BringValue>({ op: 'bring', chat, ...(message ? { message } : {}) }),
      channel: (names, message, signal) => request<SendValue>({ op: 'channel', names, message, ...WAIT }, signal),
      members: (chat, names) => request<MembersValue>({ op: 'members', chat, names }),
      rename: (to, title) => request<ChatChangeValue>({ op: 'chat-change', ...chatFields(to), change: 'rename', title }),
      archive: to => request<ChatChangeValue>({ op: 'chat-change', ...chatFields(to), change: 'archive' }),
      schedules: () => request<SchedulesValue>({ op: 'schedules' }),
      spaces: () => request<SpacesValue>({ op: 'spaces' }),
      enableSchedule: (schedule, enabled) => request<ScheduleValue>({ op: 'schedule-enable', schedule, enabled }),
      runSchedule: schedule => request<RunValue>({ op: 'run', schedule, files: [] }),
      search: query => request<SearchValue>({ op: 'search', query }),
      running: () => request<RunningValue>({ op: 'running' }),
      memories: owner => request<LibraryValue>({ op: 'library', kind: 'memory', owner }),
      usage: () => request<UsageValue>({ op: 'usage', refresh: false }),
      models: to => request<ModelsValue>({ op: 'models', to, refresh: false }),
      preferences: changes => request<PreferencesValue>({ op: 'preferences', ...changes }),
    },
    management: {
      catalog: async () => ManagementCatalog.parse(await request({ op: 'config' })),
      saveOrglet: async (config, target) => ManagementResult.parse(await request({ op: 'save-orglet', config, ...(target ? { target } : {}) })),
      saveCrew: async (config, target) => ManagementResult.parse(await request({ op: 'save-crew', config, ...(target ? { target } : {}) })),
      delete: async (kind, target, confirmName) => ManagementResult.parse(await request({ op: 'delete-entity', kind, target, confirmName })),
    },
  };
}
