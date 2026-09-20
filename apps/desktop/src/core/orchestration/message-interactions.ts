import type { Run, Task } from '../../shared/contracts';
import { MessageReaction, SetMessageReaction, SetUserReaction, turnMessageId } from '../../shared/message-interactions';
import { Store, now } from '../storage/database';

export type MessageTarget = { id: string; kind: 'user' | 'answer' | 'team'; author: string; excerpt: string };
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
        excerpt: excerpt(artifact.report.summary) };
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
      return { id: messageId, kind: 'team', author: sender, excerpt: excerpt(message.body) };
    }
    throw new Error('Không tìm thấy tin nhắn trong cuộc trò chuyện này.');
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
      this.target(task.id, input.messageId, current);
      this.set(task, input.messageId, input.emoji, input.active, 'worker', current, callId);
    });
  }

  private set(task: Task, messageId: string, emoji: MessageReaction['emoji'], active: boolean,
    actor: MessageReaction['actor'], run?: Run, callId?: string) {
    const existing = task.messageReactions ?? [];
    const same = (item: MessageReaction) => item.messageId === messageId && item.emoji === emoji && item.actor === actor
      && (actor === 'user' || item.workerId === run?.snapshot.worker.id);
    const kept = existing.filter(item => !same(item));
    if (active && !existing.some(same)) {
      if (existing.length >= 1000) throw new Error('Cuộc trò chuyện đã đủ tương tác.');
      kept.push(MessageReaction.parse({ messageId, emoji, actor, ...(run ? { workerId: run.snapshot.worker.id, runId: run.id, callId } : {}), createdAt: now() }));
    } else if (active) return;
    else if (kept.length === existing.length) return;
    this.store.update('tasks', { ...task, messageReactions: kept });
  }
}
