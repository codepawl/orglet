import type { TaskDetail } from '../shared/contracts';
import type { CliChat, SendValue } from '../cli/protocol';
import type { CliActivityFeed, CliObserver } from './cli-activity';
import type { CoreRequest } from './cli-chats';
import { isTurnRunning, pendingQuestion, turnAnswers, turnErrors, waitsForDesktop } from './cli-chat-history';

/** What the CLI operations need from main, and waiting for a turn the way `send` does (COD-234, COD-354). */

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
};

const DEFAULT_POLL_MILLISECONDS = 750;

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export function readTask(request: CoreRequest, id: string): Promise<TaskDetail> {
  return request('task', { id }) as Promise<TaskDetail>;
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
