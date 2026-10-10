import type { Connections, Source, TaskDetail } from '../shared/contracts';
import type { Language } from '../shared/i18n';
import type { Changelog, UpdateState } from '../shared/updates';
import type { CliChat, SendValue } from '../cli/protocol';
import type { CliActivityFeed, CliObserver } from './cli-activity';
import type { CoreRequest } from './cli-chats';
import type { CliElevation } from './cli-elevation';
import type { CliJournal } from './cli-journal';
import { isTurnRunning, pendingQuestion, turnAnswers, turnErrors, waitsForDesktop } from './cli-chat-history';

/** What the CLI operations need from main, and waiting for a turn the way `send` does (COD-234, COD-354). */

export type CliAppState = {
  /** Which keys are saved, never the keys. */
  connections: () => Promise<Connections>;
  changelog: (refresh: boolean) => Promise<Changelog>;
  updateState: () => UpdateState;
  /** Starts a check the way the window's button does and returns the state right after. */
  checkForUpdates: () => UpdateState;
  /** Restarts into a downloaded update, as the window's button does; only an elevated terminal reaches it. */
  installUpdate?: () => void;
};

/**
 * What stages C and D need from main and cannot get from the core: the credential stores, the account, the browser
 * profiles and the switches. Each member is the function the window's handler of the same name calls, so a grant from
 * a terminal runs the window's own code.
 */
export type CliSetupApp = {
  /** The data folder and the home folder, for the folder refusals. */
  dataFolder: string;
  homeFolder: string;
  /** Saves an API key (none for Ollama's local token) the way Settings does; the key is dropped after. */
  connect: (provider: string, key: string | undefined) => Promise<void>;
  disconnect: (provider: string) => Promise<void>;
  /** Drops the key of a custom connection the core has just forgotten. */
  forgetKey: (provider: string) => Promise<void>;
  saveSearchKey: (provider: string, key: string) => Promise<void>;
  removeSearchKey: (provider: string) => Promise<void>;
  removeMcpServer: (serverId: string) => Promise<void>;
  signInMcpServer: (serverId: string) => Promise<void>;
  cancelMcpSignIn: (serverId: string) => void;
  setSwitch: (what: 'analytics' | 'cli-path' | 'send-to', enabled: boolean) => Promise<void>;
  writeText: (path: string, text: string) => Promise<void>;
  account: {
    /** The name the sync prompt types back: the account's name, else its email. Undefined when nobody is signed in. */
    label: () => string | undefined;
    signIn: () => Promise<void>;
    signOut: () => Promise<void>;
    cancelSignIn: () => void;
    reopenSignIn: () => Promise<void>;
  };
  startSync: (choice: 'merge' | 'replace' | undefined) => Promise<void>;
  browserProfiles: {
    list: () => Promise<{ id: string; name: string }[]>;
    clear: (profileId: string) => Promise<void>;
    remove: (profileId: string) => Promise<void>;
  };
};

export type CliDependencies = {
  request: CoreRequest;
  version: () => string;
  /** Brings the window forward and, with a chat, opens it. */
  open: (chat?: CliChat) => void | Promise<void>;
  /** Puts a run's Vietnamese error into the app's language. */
  translate: (message: string) => string;
  /** How often `send` reads the chat while it waits. */
  pollMilliseconds?: number;
  observe?: (observer: CliObserver) => () => void;
  /** What only main knows (the saved keys, the release notes, the updater), for the read-only `show` and `update`. */
  app?: CliAppState;
  /** Tells main the language or theme changed from a terminal, as a save in the window does (COD-354). */
  /** Pairing, elevation and the journal behind the held operations (docs/cli-held-actions-design.md). */
  terminalAccess?: { elevation: CliElevation; journal: CliJournal };
  /** Stages C and D (grants and secrets); without it every such operation is refused as unavailable. */
  setup?: CliSetupApp;
  settingsChanged?: (changes: { language?: Language; theme?: 'system' | 'light' | 'dark' }) => void;
};

const DEFAULT_POLL_MILLISECONDS = 750;

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export function readTask(request: CoreRequest, id: string): Promise<TaskDetail> {
  return request('task', { id }) as Promise<TaskDetail>;
}

/** Imports the files a command names, the way the file picker does, and returns their ids. No files means nothing attached. */
export async function importFiles(request: CoreRequest, files: readonly string[] | undefined): Promise<string[]> {
  if (!files?.length) return [];
  const sources = await request('importSources', files) as Source[];
  return sources.map(source => source.id);
}

/** Where a turn stands once the terminal stops waiting for it: its answers, errors and what it waits on. */
export function turnResult(chat: CliChat, detail: TaskDetail, revision: number, waited: boolean, translate: (message: string) => string): SendValue {
  const finished = waited && !isTurnRunning(detail.task);
  const errors = finished ? turnErrors(detail, revision).map(error => translate(error)) : [];
  const question = pendingQuestion(detail.task);
  return {
    chat,
    taskId: detail.task.id,
    turn: revision + 1,
    waited,
    finished,
    status: detail.task.status,
    answers: waited ? turnAnswers(detail, revision) : [],
    errors,
    ...(question ? { question } : {}),
    ...(waitsForDesktop(detail) ? { needsDesktop: true } : {}),
  };
}

/**
 * Reads the chat until its turn stops, the time runs out or the terminal goes away. A card only the desktop answers
 * also ends the wait: the terminal cannot answer it, so it says so instead of waiting out the timeout (COD-354).
 */
export async function waitForTurn(dependencies: CliDependencies, first: TaskDetail, timeoutSeconds: number, signal: AbortSignal, feed?: CliActivityFeed, revision = 0): Promise<TaskDetail> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  const interval = dependencies.pollMilliseconds ?? DEFAULT_POLL_MILLISECONDS;
  let detail = first;
  while (isTurnRunning(detail.task) && !waitsForDesktop(detail) && Date.now() < deadline && !signal.aborted) {
    await delay(interval);
    detail = await readTask(dependencies.request, first.task.id);
    feed?.update(detail, revision);
  }
  return detail;
}
