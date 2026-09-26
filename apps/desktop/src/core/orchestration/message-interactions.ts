import type { Run, Task } from '../../shared/contracts';
import { MessageReaction, SetMessageReaction, SetUserReaction, turnMessageId, type Reaction } from '../../shared/message-interactions';
import { Store, now } from '../storage/database';

/** `workerId` names the worker who wrote an answer or team message, so a worker can be kept off its own messages. */
export type MessageTarget = { id: string; kind: 'user' | 'answer' | 'team'; author: string; excerpt: string; workerId?: string };
const excerpt = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 180);

/** Resolves message IDs from committed task history; renderer quotes and model text carry no authority. */
export class MessageInteractions {
  constructor(private store: Store) {}

  target(taskId: string, messageId: string, actorRun?: Run): MessageTarget {
    const detail = this.store.detail(taskId);
    const { task } = detail;
    const currentRevision = task.inputRevision ?? 0;
    for (let revision = 0; revision <= currentRevision; revision++) {
      if (turnMessageId(taskId, revision) !== messageId) continue;
      const input = revision === currentRevision ? task.currentInput : detail.runs.find(run =>
        (run.snapshot.inputRevision ?? 0) === revision && run.snapshot.input)?.snapshot.input;
      const brief = input?.brief ?? (revision === 0 ? task.brief : undefined);
      if (!brief) break;
      return { id: messageId, kind: 'user', author: 'Người dùng', excerpt: excerpt(brief) };
    }
    const artifact = detail.artifacts.find(item => item.id === messageId);
    if (artifact) {
      const owner = detail.runs.find(run => run.id === artifact.runId)!;
      if (owner.status !== 'completed') throw new Error('Tin nhắn chưa được lưu hoàn tất.');
      if (actorRun && owner.stage === 'member' && actorRun.stage !== 'synthesis'
        && owner.snapshot.worker.id !== actorRun.snapshot.worker.id
        && !actorRun.snapshot.upstreamArtifactIds?.includes(artifact.id)) throw new Error('Tin nhắn ngoài phạm vi được xem.');
      return { id: messageId, kind: 'answer', author: owner.snapshot.worker.name,
        excerpt: excerpt(artifact.report.summary), workerId: owner.snapshot.worker.id };
    }
    const event = detail.events.find(item => item.id === messageId && item.teamMessage);
    if (event?.teamMessage && event.teamMessage.teamId === task.teamId) {
      const message = event.teamMessage;
      if (actorRun && (actorRun.snapshot.team?.id !== message.teamId
        || (actorRun.snapshot.inputRevision ?? 0) !== message.inputRevision
        || (actorRun.snapshot.worker.id !== message.senderId && actorRun.snapshot.worker.id !== message.recipientId
          && !(actorRun.stage === 'synthesis' && actorRun.snapshot.worker.id === actorRun.snapshot.team.synthesizerId)))) {
        throw new Error('Tin nhắn ngoài phạm vi được xem.');
      }
      const sender = detail.runs.find(run => run.id === event.runId)?.snapshot.worker.name ?? message.senderId;
      return { id: messageId, kind: 'team', author: sender, excerpt: excerpt(message.body), workerId: message.senderId };
    }
    throw new Error('Không tìm thấy tin nhắn trong cuộc trò chuyện này.');
  }

  /**
   * The person's reaction on the newest answer before turn `revision`, which that turn's run is told about. Only the
   * newest answer counts: an older thumb is history, not an instruction. The window used to write this into the
   * person's message, so it showed in their bubble as words they never typed (dogfood, 2026-09-26).
   */
  previousAnswerReaction(taskId: string, revision: number): { messageId: string; reaction: Reaction } | undefined {
    const detail = this.store.detail(taskId);
    const earlierAnswers = detail.artifacts.filter(artifact => {
      const owner = detail.runs.find(run => run.id === artifact.runId);
      return owner !== undefined && (owner.snapshot.inputRevision ?? 0) < revision;
    });
    const newest = earlierAnswers.at(-1);
    if (!newest) return undefined;
    const reaction = detail.task.messageReactions?.findLast(item => item.messageId === newest.id && item.actor === 'user');
    if (!reaction) return undefined;
    return { messageId: newest.id, reaction: reaction.emoji };
  }

  /** Explicit desired state makes duplicate IPC requests harmless. */
  userReaction(raw: unknown): void {
    const input = SetUserReaction.parse(raw);
    this.store.transaction(() => {
      const task = this.store.get<Task>('tasks', input.taskId);
      if (task.deletedAt) throw new Error('Cuộc trò chuyện đã bị xóa.');
      this.target(task.id, input.messageId);
      this.set(task, input.messageId, input.emoji, input.active, 'user');
    });
  }

  workerReaction(run: Run, callId: string, raw: unknown): void {
    const input = SetMessageReaction.parse(raw);
    this.store.transaction(() => {
      const current = this.store.get<Run>('runs', run.id);
      const task = this.store.get<Task>('tasks', run.taskId);
      if (current.status !== 'running' || current.snapshot.worker.provider === 'demo' || task.deletedAt
        || (current.snapshot.inputRevision ?? 0) !== (task.inputRevision ?? 0)
        || current.snapshot.worker.id !== run.snapshot.worker.id) throw new Error('Lượt chạy không còn quyền tương tác.');
      const resolved = this.target(task.id, input.messageId, current);
      // A reaction is for someone else's message; a worker liking its own answer would only be noise (COD-216).
      if (resolved.workerId === current.snapshot.worker.id) throw new Error('Không thể thả cảm xúc cho tin của chính mình.');
      this.set(task, input.messageId, input.emoji, input.active, 'worker', current, callId);
    });
  }

  /**
   * One reaction per person per message (COD-219, the way a messenger works): adding a second emoji replaces the
   * first, so a switch is one call from the renderer rather than a remove and an add that could half-land.
   */
  private set(task: Task, messageId: string, emoji: MessageReaction['emoji'], active: boolean,
    actor: MessageReaction['actor'], run?: Run, callId?: string) {
    const existing = task.messageReactions ?? [];
    const ownMark = (item: MessageReaction) => item.messageId === messageId && item.actor === actor
      && (actor === 'user' || item.workerId === run?.snapshot.worker.id);
    const same = (item: MessageReaction) => ownMark(item) && item.emoji === emoji;
    if (active) {
      if (existing.some(same)) return;
      if (existing.length >= 1000) throw new Error('Cuộc trò chuyện đã đủ tương tác.');
      const kept = existing.filter(item => !ownMark(item));
      kept.push(MessageReaction.parse({ messageId, emoji, actor, ...(run ? { workerId: run.snapshot.worker.id, runId: run.id, callId } : {}), createdAt: now() }));
      this.store.update('tasks', { ...task, messageReactions: kept });
      return;
    }
    const kept = existing.filter(item => !same(item));
    if (kept.length === existing.length) return;
    this.store.update('tasks', { ...task, messageReactions: kept });
  }
}
