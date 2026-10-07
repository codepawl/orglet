import { PERMISSION_NEEDS_MAX_CHARS, PERMISSION_NEEDS_MIN_CHARS, type PermissionNeedsAnswer } from '../../shared/permission-needs';
import type { Decisions } from '../decisions/service';
import { needsSecondPass, PERMISSION_NEEDS_MAX_LENGTH, permissionNeedsFrom, permissionNeedsState, TOOL_QUESTION, toolScores, WEB_AND_FOLDER_QUESTIONS } from '../decisions/permission-questions';

/**
 * Reads a message while it is typed for the permissions it needs (COD-305). The composer asks after a pause in typing;
 * this answers `null` whenever it has nothing to say (Tacet off, a message too short to read, a newer
 * request already waiting, an answer too slow), and the composer then shows nothing, as it did before Tacet.
 *
 * Only the latest request matters: while one check runs, a newer request waits for it and every older waiting one is
 * answered `null` at once, so fast typing never queues a line of requests behind the one it needs.
 */

/**
 * An API answers in a second or so. A check slower than this answers `null`, and the next pause in typing asks again.
 */
export const PERMISSION_SUGGESTION_TIMEOUT_MS = 3000;

export class PermissionSuggestions {
  private latest = 0;
  private running: Promise<unknown> = Promise.resolve();

  constructor(private decisions: () => Decisions, private timeoutMs = PERMISSION_SUGGESTION_TIMEOUT_MS) {}

  async suggest(text: string): Promise<PermissionNeedsAnswer | null> {
    const message = text.trim().slice(0, PERMISSION_NEEDS_MAX_CHARS);
    if (message.length < PERMISSION_NEEDS_MIN_CHARS || !this.decisions().isEnabled()) return null;
    const ticket = ++this.latest;
    await this.running;
    if (ticket !== this.latest) return null;
    const check = this.read(message);
    this.running = check.catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), this.timeoutMs); });
    try {
      return await Promise.race([check.catch(() => null), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Two passes, the second only when it can still change the answer (see `decisions/permission-questions.ts`). */
  private async read(message: string): Promise<PermissionNeedsAnswer | null> {
    const state = permissionNeedsState(message);
    const first = await this.decisions().decide(state, TOOL_QUESTION, PERMISSION_NEEDS_MAX_LENGTH);
    const scores = first && toolScores(first);
    if (!scores) return null;
    const second = needsSecondPass(scores) ? await this.decisions().decide(state, WEB_AND_FOLDER_QUESTIONS, PERMISSION_NEEDS_MAX_LENGTH) : undefined;
    return { needs: permissionNeedsFrom(scores, second) };
  }
}
