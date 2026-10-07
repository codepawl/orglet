import { PERMISSION_NEEDS_MAX_CHARS, PERMISSION_NEEDS_MIN_CHARS, type PermissionNeedsAnswer } from '../../shared/permission-needs';
import type { DecisionContext } from '../decisions/budget';
import type { Decisions } from '../decisions/service';
import { needsSecondPass, PERMISSION_NEEDS_MAX_LENGTH, permissionNeedsFrom, permissionNeedsState, TOOL_QUESTION, toolScores, WEB_AND_FOLDER_QUESTIONS } from '../decisions/permission-questions';

/**
 * Reads a message for the permissions it needs (COD-305). The composer asks when the person sends a message, never while
 * it is still being typed, so a draft is not sent to the provider. This answers `null` whenever it has nothing to say
 * (the decision model off, a message too short to read, a newer request already waiting, an answer too slow), and the
 * composer then shows nothing, as it did before the decision model.
 *
 * Only the latest request matters: while one check runs, a newer request waits for it and every older waiting one is
 * answered `null` at once, so messages sent in quick succession never queue a line of requests behind the one it needs.
 */

/**
 * An API answers in a second or so. A check slower than this answers `null`, and the hint is simply not shown.
 */
export const PERMISSION_SUGGESTION_TIMEOUT_MS = 3000;

export class PermissionSuggestions {
  private latest = 0;
  private running: Promise<unknown> = Promise.resolve();

  constructor(private decisions: () => Decisions, private timeoutMs = PERMISSION_SUGGESTION_TIMEOUT_MS) {}

  async suggest(text: string, taskId?: string): Promise<PermissionNeedsAnswer | null> {
    const message = text.trim().slice(0, PERMISSION_NEEDS_MAX_CHARS);
    if (message.length < PERMISSION_NEEDS_MIN_CHARS || !this.decisions().isEnabled()) return null;
    const ticket = ++this.latest;
    await this.running;
    if (ticket !== this.latest) return null;
    const check = this.read(message, { taskId });
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
  private async read(message: string, context: DecisionContext): Promise<PermissionNeedsAnswer | null> {
    const state = permissionNeedsState(message);
    const first = await this.decisions().decide(state, TOOL_QUESTION, PERMISSION_NEEDS_MAX_LENGTH, context);
    const scores = first && toolScores(first);
    if (!scores) return null;
    const second = needsSecondPass(scores) ? await this.decisions().decide(state, WEB_AND_FOLDER_QUESTIONS, PERMISSION_NEEDS_MAX_LENGTH, context) : undefined;
    return { needs: permissionNeedsFrom(scores, second) };
  }
}
