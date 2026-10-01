import { callStartingApp } from './client';
import { DEFAULT_WAIT_SECONDS, type ChatControl, type CliErrorCode, type CliRequestBody, type ControlValue, type ForwardValue, type ListValue, type OpenValue, type ReactValue, type ReadValue, type SendValue } from './protocol';
import type { Reaction } from '../shared/message-interactions';
import type { CliProgressFrame } from './protocol';
import { ManagementCatalog, ManagementResult, type ManagementClient } from './management';

/**
 * What `orglet chat` asks the app (COD-236), as one object the interactive session takes, so a test can hand it a fake
 * app. Each call is one request over the pipe, the same requests the one-shot commands make.
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
 * What the terminal chat does to a chat's messages and its latest turn (COD-354). Optional so a test can hand the
 * session an app without them; each call is the request the matching one-shot command makes.
 */
export type ChatActionClient = {
  history: (to: string, turns: number, before?: number) => Promise<ReadValue>;
  reply: (to: string, message: string, replyTo: string, signal: AbortSignal, progress?: (frame: CliProgressFrame) => void) => Promise<SendValue>;
  react: (to: string, emoji: Reaction, active: boolean, message?: string) => Promise<ReactValue>;
  forward: (to: string, targets: string[], message?: string) => Promise<ForwardValue>;
  control: (to: string, action: ChatControl, signal: AbortSignal) => Promise<ControlValue>;
  answer: (to: string, answer: string, signal: AbortSignal) => Promise<ControlValue>;
};

/** The app answered but said no: an unknown name, a chat with no conversation yet, a refused request. */
export class AppRefusal extends Error {
  constructor(message: string, readonly code: CliErrorCode) {
    super(message);
  }
}

export function appChatClient(userData: string, executable: string | undefined): ChatClient {
  async function request<Value>(body: CliRequestBody, signal?: AbortSignal, progress?: (frame: CliProgressFrame) => void): Promise<Value> {
    const response = await callStartingApp(userData, body, executable, signal, progress);
    if (!response.ok) throw new AppRefusal(response.error, response.code);
    return response.value as Value;
  }
  return {
    list: () => request<ListValue>({ op: 'list' }),
    send: async (to, message, signal, progress) => {
      const body = { op: 'send' as const, to, message, files: [], wait: true, timeoutSeconds: DEFAULT_WAIT_SECONDS };
      try {
        return await request<SendValue>({ ...body, ...(progress ? { progress: true } : {}) }, signal, progress);
      } catch (error) {
        // An old strict schema refuses the flag before dispatch; retrying only that refusal cannot send twice.
        if (!progress || !(error instanceof AppRefusal) || error.code !== 'invalid') throw error;
        return request<SendValue>(body, signal);
      }
    },
    read: to => request<ReadValue>({ op: 'read', to }),
    open: to => request<OpenValue>({ op: 'open', to }),
    actions: {
      history: (to, turns, before) => request<ReadValue>({ op: 'read', to, turns, ...(before ? { before } : {}) }),
      reply: (to, message, replyTo, signal, progress) => {
        const body = { op: 'send' as const, to, message, files: [], wait: true, timeoutSeconds: DEFAULT_WAIT_SECONDS, replyTo };
        return request<SendValue>({ ...body, ...(progress ? { progress: true } : {}) }, signal, progress);
      },
      react: (to, emoji, active, message) => request<ReactValue>({ op: 'react', to, emoji, active, ...(message ? { message } : {}) }),
      forward: (to, targets, message) => request<ForwardValue>({ op: 'forward', to, targets, ...(message ? { message } : {}) }),
      control: (to, action, signal) => request<ControlValue>({ op: 'control', to, action, wait: true, timeoutSeconds: DEFAULT_WAIT_SECONDS }, signal),
      answer: (to, answer, signal) => request<ControlValue>({ op: 'answer', to, answer, wait: true, timeoutSeconds: DEFAULT_WAIT_SECONDS }, signal),
    },
    management: {
      catalog: async () => ManagementCatalog.parse(await request({ op: 'config' })),
      saveOrglet: async (config, target) => ManagementResult.parse(await request({ op: 'save-orglet', config, ...(target ? { target } : {}) })),
      saveCrew: async (config, target) => ManagementResult.parse(await request({ op: 'save-crew', config, ...(target ? { target } : {}) })),
      delete: async (kind, target, confirmName) => ManagementResult.parse(await request({ op: 'delete-entity', kind, target, confirmName })),
    },
  };
}
