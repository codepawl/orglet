import { callStartingApp } from './client';
import { DEFAULT_WAIT_SECONDS, type CliErrorCode, type CliRequestBody, type ListValue, type OpenValue, type ReadValue, type SendValue } from './protocol';

/**
 * What `orglet chat` asks the app (COD-236), as one object the interactive session takes, so a test can hand it a fake
 * app. Each call is one request over the pipe, the same requests the one-shot commands make.
 */
export type ChatClient = {
  list: () => Promise<ListValue>;
  /** Waits for the turn; aborting `signal` stops waiting and leaves the turn running in the app. */
  send: (to: string, message: string, signal: AbortSignal) => Promise<SendValue>;
  read: (to: string) => Promise<ReadValue>;
  open: (to: string) => Promise<OpenValue>;
};

/** The app answered but said no: an unknown name, a chat with no conversation yet, a refused request. */
export class AppRefusal extends Error {
  constructor(message: string, readonly code: CliErrorCode) {
    super(message);
  }
}

export function appChatClient(userData: string, executable: string | undefined): ChatClient {
  async function request<Value>(body: CliRequestBody, signal?: AbortSignal): Promise<Value> {
    const response = await callStartingApp(userData, body, executable, signal);
    if (!response.ok) throw new AppRefusal(response.error, response.code);
    return response.value as Value;
  }
  return {
    list: () => request<ListValue>({ op: 'list' }),
    send: (to, message, signal) => request<SendValue>({ op: 'send', to, message, files: [], wait: true, timeoutSeconds: DEFAULT_WAIT_SECONDS }, signal),
    read: to => request<ReadValue>({ op: 'read', to }),
    open: to => request<OpenValue>({ op: 'open', to }),
  };
}
