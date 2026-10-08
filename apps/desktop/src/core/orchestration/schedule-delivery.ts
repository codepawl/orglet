import type { Routine, Task } from '../../shared/contracts';
import { liveTeamTask, liveWorkerTask } from '../../shared/live-task';
import { isQuietScheduleRun } from '../../shared/quiet-runs';
import { triggerOf } from '../../shared/routine-triggers';
import { ChatQuote, MAX_CHAT_QUOTES, quoteText } from '../../shared/side-threads';
import { id, now, type Store } from '../storage/database';

/** When this machine started posting schedule runs into chats; runs that started before keep their own rows. */
const DELIVERY_SINCE = 'scheduleDeliverySince';

/**
 * Schedules run inside the orglet's DM or the channel's chat (owner, 2026-10-07): a run still has its own record, which
 * keeps the schedule's permissions, folder, daily cap and history apart, but its answer is posted once into that chat as
 * a message labelled with the schedule, and the sidebar no longer lists the run as a chat of its own. The orglet reads
 * the post with the next message there, the way it reads an answer brought in from a side thread.
 *
 * An hourly run with nothing new is not posted, so the chat does not fill with "all as usual" (COD-288); it is marked
 * quiet and stays on the schedule's card. If the decision model later finds it noteworthy (COD-303), it is posted then. A run whose
 * orglet or channel has no chat yet keeps its own row in the sidebar, so nothing is lost.
 */
export class ScheduleDelivery {
  constructor(private store: Store, private notify: () => void) {}

  /** Called on the core's tick: posts every finished run not posted yet. */
  deliver(): void {
    // Runs from before this existed keep their own rows; posting a whole history into the DMs at once would bury them.
    let since = this.store.setting<string | undefined>(DELIVERY_SINCE, undefined);
    if (!since) {
      since = now();
      this.store.setSetting(DELIVERY_SINCE, since);
    }
    // The tick asks every five seconds; the database narrows the chats to the schedule runs not yet delivered, and the
    // whole list of chats is read only when one is to be posted.
    const waiting = this.store.scheduleRunsToDeliver(since).filter(task => task.routineId && !task.deletedAt && task.createdAt >= since && ['completed', 'partial'].includes(task.status)
      && (!task.deliveredTo || ('quiet' in task.deliveredTo && task.attention?.notified)));
    if (!waiting.length) return;
    const tasks = this.store.all<Task>('tasks');
    const routines = new Map(this.store.all<Routine>('routines').map(routine => [routine.id, routine]));
    const held = new Set(this.store.heldForReview());
    let changed = false;
    for (const run of waiting) {
      const routine = routines.get(run.routineId!);
      const quiet = routine !== undefined && isQuietScheduleRun(routine.schedule.frequency, triggerOf(routine).kind, held.has(run.id));
      if (quiet && !run.attention?.notified) {
        this.store.patchTask(run.id, { deliveredTo: { quiet: true } });
        changed = true;
        continue;
      }
      changed = this.post(run, routine?.name ?? run.routineName ?? 'Lịch', tasks) || changed;
    }
    if (changed) this.notify();
  }

  /** Copies the run's answer into its chat; false when there is no chat to post into or no answer yet. */
  private post(run: Task, scheduleName: string, tasks: readonly Task[]): boolean {
    const chat = run.teamId ? liveTeamTask(tasks, run.teamId) : run.assignees ? undefined : liveWorkerTask(tasks, run.workerId);
    if (!chat || chat.id === run.id) return false;
    const detail = this.store.detail(run.id);
    const answer = detail.artifacts.at(-1);
    if (!answer) return false;
    const quotes = chat.quotes ?? [];
    if (quotes.length >= MAX_CHAT_QUOTES) return false;
    const author = detail.runs.find(item => item.id === answer.runId)?.snapshot.worker;
    if (!author) return false;
    const report = answer.report;
    const body = report.format === 'chat' ? report.summary : `${report.title}\n\n${report.summary}`;
    const quote = ChatQuote.parse({
      id: id(), fromTaskId: run.id, artifactId: answer.id, author: author.name, authorId: author.id, text: quoteText(body),
      afterRevision: chat.inputRevision ?? 0, createdAt: now(), schedule: scheduleName,
    });
    this.store.transaction(() => {
      this.store.patchTask(chat.id, { quotes: [...quotes, quote] });
      this.store.patchTask(run.id, { deliveredTo: { taskId: chat.id, quoteId: quote.id } });
    });
    return true;
  }
}
