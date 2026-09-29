import { callStartingApp } from './client';
import { DEFAULT_WAIT_SECONDS, type CliErrorCode, type CliRequestBody, type ListValue, type OpenValue, type ReadValue, type SendValue } from './protocol';
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
    management: {
      catalog: async () => ManagementCatalog.parse(await request({ op: 'config' })),
      saveOrglet: async (config, target) => ManagementResult.parse(await request({ op: 'save-orglet', config, ...(target ? { target } : {}) })),
      saveCrew: async (config, target) => ManagementResult.parse(await request({ op: 'save-crew', config, ...(target ? { target } : {}) })),
      delete: async (kind, target, confirmName) => ManagementResult.parse(await request({ op: 'delete-entity', kind, target, confirmName })),
    },
  };
}
