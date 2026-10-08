import type { Artifact, Routine, Task } from '../../shared/contracts';
import type { DecisionQuestions } from '../../shared/decisions';
import { triggerOf } from '../../shared/routine-triggers';
import { isQuietScheduleRun, NOTEWORTHY_THRESHOLD, type RunAttention } from '../../shared/quiet-runs';
import type { Store } from '../storage/database';
import type { Decisions } from '../decisions/service';

/**
 * A second look at quiet runs (COD-303). An hourly schedule's run that simply finished says nothing (COD-288), which
 * also silenced the run that found something. When the decision model is on, each such run is asked how much its
 * answer needs the person; a clear "high" records `attention` on the run's chat and the window then announces it. With no
 * decision model, a failed load or a middling answer announces nothing, which is today's behaviour.
 */

/**
 * Tuned on 28 English and Vietnamese hourly-run answers (docs/decisions.md). A three-level score separated them where
 * a yes/no "is this new?" did not: every routine answer scored below every noteworthy one.
 */
export const NOTEWORTHY_QUESTION: DecisionQuestions = {
  attention: {
    type: 'score',
    instructions: "How much does this answer need the person's attention?",
    criteria: ['none: nothing new, everything is as usual', 'some: worth a look later', 'high: something changed, failed or needs action'],
  },
};
const HIGHEST_LEVEL = 2;
/** The request and the answer, cut to this many tokens: about 0.6 s on a desktop CPU, where 1536 takes seconds. */
export const QUIET_RUN_MAX_LENGTH = 512;
/** How many times one run is put to the decision model before it is left quiet when it gives no answer: one try and one retry. */
export const MAX_REVIEW_ATTEMPTS = 2;
/** A run that finished longer ago than this is history by the time the decision model could look: it is left alone. */
export const QUIET_RUN_WINDOW_MS = 15 * 60_000;

/** The text the decision model reads: what the schedule asks each time, then what this run answered. */
export function quietRunState(task: Pick<Task, 'brief'>, answer: string): string {
  return `Scheduled request: ${task.brief}\n\nAnswer:\n${answer}`;
}

export class QuietRunReview {
  private reviewing = false;
  /** Runs already past their window, so a long history of hourly runs is not read again on every tick. */
  private tooOld = new Set<string>();
  private attempts = new Map<string, number>();

  constructor(private store: Store, private decisions: () => Decisions, private notify: () => void, private clock: () => Date = () => new Date()) {}

  /** The finished quiet runs of the last few minutes that the decision model has not looked at yet, with their answers. */
  private candidates(): { task: Task; answer: Artifact }[] {
    const routines = new Map(this.store.all<Routine>('routines').map(routine => [routine.id, routine]));
    const held = new Set(this.store.heldForReview());
    const now = this.clock().getTime();
    const found: { task: Task; answer: Artifact }[] = [];
    for (const task of this.store.all<Task>('tasks')) {
      if (task.attention || task.deletedAt || task.status !== 'completed' || !task.routineId || this.tooOld.has(task.id)) continue;
      const routine = routines.get(task.routineId);
      if (!routine || !isQuietScheduleRun(routine.schedule.frequency, triggerOf(routine).kind, held.has(task.id))) continue;
      const answer = this.store.detail(task.id).artifacts.at(-1);
      if (!answer) continue;
      if (now - new Date(answer.createdAt).getTime() > QUIET_RUN_WINDOW_MS) {
        this.tooOld.add(task.id);
        continue;
      }
      found.push({ task, answer });
    }
    return found;
  }

  /** Called on the core's tick; one pass at a time, and nothing at all while the decision model is off. */
  async review(): Promise<void> {
    if (this.reviewing || !this.decisions().isEnabled()) return;
    this.reviewing = true;
    try {
      for (const { task, answer } of this.candidates()) {
        // Each question is a paid request, so a run the decision model could not answer is retried once and then left quiet.
        const attempts = this.attempts.get(task.id) ?? 0;
        if (attempts >= MAX_REVIEW_ATTEMPTS) continue;
        this.attempts.set(task.id, attempts + 1);
        const attention = await this.ask(task, answer);
        if (!attention) continue;
        const latest = this.store.get<Task>('tasks', task.id);
        if (!latest || latest.attention) continue;
        this.store.update('tasks', { ...latest, attention });
        this.notify();
      }
    } finally {
      this.reviewing = false;
    }
  }

  /** The decision model's verdict on one run, or undefined when it could not give one; the run then stays quiet as before. */
  private async ask(task: Task, answer: Artifact): Promise<RunAttention | undefined> {
    try {
      const response = await this.decisions().decide(quietRunState(task, answer.report.summary), NOTEWORTHY_QUESTION, QUIET_RUN_MAX_LENGTH, { taskId: task.id, background: true });
      const verdict = response?.answers.attention;
      if (!verdict || verdict.type !== 'score') return undefined;
      // The expected level, 0 to 2, as a share of the highest.
      const score = Math.min(1, Math.max(0, verdict.score / HIGHEST_LEVEL));
      return { score, notified: score >= NOTEWORTHY_THRESHOLD, decidedAt: this.clock().toISOString(), ...(response.answeredBy ? { answeredBy: response.answeredBy } : {}) };
    } catch {
      return undefined;
    }
  }
}
