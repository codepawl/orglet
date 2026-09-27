import type { Task, Worker } from '../../shared/contracts';
import { ownWords } from '../../shared/forward';
import { parseMentions } from '../../shared/mentions';
import { MAX_TURN_ROUTES, routeOfTurn, type TurnRoute } from '../../shared/turn-routing';
import type { Store } from '../storage/database';
import type { Decisions } from '../decisions/service';
import { ROUTING_MAX_LENGTH, routableGroup, routedOrglet, routingQuestion } from '../decisions/group-routing';

/**
 * Who answers a group-chat message that tags nobody (COD-305). Without Tacet every orglet in the group answers in turn.
 * With Tacet on this computer, a message the person wrote themselves, that tags nobody and replies to no one, is read
 * against each orglet's name, description and instructions; a clear pick answers alone and the pick is kept on the chat
 * (`routedTurns`), which the thread shows under the message. Anything short of a clear pick, a failed load or a slow
 * answer keeps everyone. Crews are never asked: their lead plans the turn.
 */

/** Past this the turn starts with everyone; the first question also loads the model, which takes about two seconds. */
export const ROUTING_TIMEOUT_MS = 4000;

export class TurnRouting {
  constructor(private store: Store, private decisions: () => Decisions, private clock: () => Date = () => new Date(), private timeoutMs = ROUTING_TIMEOUT_MS) {}

  /** The orglets a kept pick names for this turn, when they are all still in the group. */
  recorded(task: Pick<Task, 'routedTurns' | 'inputRevision'>, group: readonly Worker[]): Worker[] | undefined {
    const route = routeOfTurn(task.routedTurns, task.inputRevision ?? 0);
    if (!route) return undefined;
    const picked = group.filter(worker => route.workerIds.includes(worker.id));
    return picked.length === route.workerIds.length ? picked : undefined;
  }

  /**
   * The step that picks this turn's answerers, run by the team runner once the turn is running (so Stop and Pause
   * reach it), or undefined when Tacet is not asked and everyone answers as before.
   */
  router(task: Task, group: Worker[]): (() => Promise<Worker[]>) | undefined {
    if (!this.shouldAsk(task, group)) return undefined;
    return () => this.route(task, group);
  }

  private shouldAsk(task: Task, group: readonly Worker[]): boolean {
    // A forward is someone else's words, and a reply already says who it is for (COD-257).
    if (task.currentInput?.forwarded || task.currentInput?.replyTo) return false;
    const words = ownWords(task.currentInput ?? task).trim();
    if (!words || parseMentions(words, group).length > 0) return false;
    if (routeOfTurn(task.routedTurns, task.inputRevision ?? 0)) return false;
    if (!routableGroup(group)) return false;
    return this.decisions().isInstalled();
  }

  private async route(task: Task, group: Worker[]): Promise<Worker[]> {
    const words = ownWords(task.currentInput ?? task);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), this.timeoutMs); });
    try {
      const asked = this.decisions().decide(words, routingQuestion(group), ROUTING_MAX_LENGTH).catch(() => undefined);
      const response = await Promise.race([asked, timeout]);
      const pick = routedOrglet(response, group);
      if (!pick) return group;
      this.keep(task, { inputRevision: task.inputRevision ?? 0, workerIds: [pick.orglet.id], probability: pick.probability, decidedAt: this.clock().toISOString() });
      return [pick.orglet];
    } finally {
      clearTimeout(timer);
    }
  }

  private keep(task: Task, route: TurnRoute) {
    const latest = this.store.get<Task>('tasks', task.id);
    const others = (latest.routedTurns ?? []).filter(item => item.inputRevision !== route.inputRevision);
    const routedTurns = [...others, route].slice(-MAX_TURN_ROUTES);
    this.store.patchTask(task.id, { routedTurns });
  }
}
