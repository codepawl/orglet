import type { Artifact, Routine, RunInput, Task, TaskDetail, Team, Worker } from '../../shared/contracts';
import { turnMessageId } from '../../shared/message-interactions';
import { withoutSourceIds } from '../../shared/source-mentions';
import { chatHeadline, type ForwardedMessage, type ForwardTarget } from '../../shared/forward';
import type { Store } from '../storage/database';

/** A chat's name in "Forwarded from …" never runs past this. */
const CHAT_NAME_CHARS = 200;

/**
 * The message a forward carries, as the core read it from the chat's saved history (COD-257): who wrote it, its
 * text, and the files it had with the source ids they have in that chat. A turn that was itself a forward carries the
 * original: the place it first came from and its first writer, the way a messenger keeps one "Forwarded" label.
 */
export type ForwardSource = {
  /** The chat and message the forward names as its origin: this one, or the first one for a forward of a forward. */
  fromTaskId: string;
  messageId: string;
  from: string;
  authorKind: ForwardedMessage['authorKind'];
  author?: string;
  text: string;
  files: { name: string; sourceId?: string }[];
};

function clip(name: string): string {
  const single = name.replace(/\s+/g, ' ').trim();
  return single.length <= CHAT_NAME_CHARS ? single : `${single.slice(0, CHAT_NAME_CHARS - 1)}…`;
}

/**
 * Reads what a forward needs out of saved history. It never takes the text from the window: the window only names
 * the chat and the message, the same way a reply names its target (`MessageInteractions.target`).
 */
export class Forwards {
  constructor(private store: Store) {}

  /**
   * How a chat is named where a forward lands: an orglet's or crew's main chat by the orglet or crew, a schedule's
   * run by the schedule, and any other chat (a side thread, a group chat) by its title or its first line.
   */
  chatName(task: Task): string {
    const workers = this.store.all<Worker>('workers');
    const title = this.store.setting<Record<string, string>>('taskTitles', {})[task.id]?.trim();
    if (task.routineId) {
      const routine = this.store.all<Routine>('routines').find(item => item.id === task.routineId);
      if (routine) return clip(routine.name);
    }
    if (task.teamId && !task.sideOf) {
      const team = this.store.all<Team>('teams').find(item => item.id === task.teamId);
      if (team) return clip(team.name);
    }
    if (!task.teamId && !task.assignees && !task.sideOf && !task.routineId) {
      const worker = workers.find(item => item.id === task.workerId);
      if (worker) return clip(worker.name);
    }
    if (title) return clip(title);
    if (task.assignees) {
      const names = workers.filter(worker => task.assignees === 'all' || task.assignees!.includes(worker.id)).map(worker => worker.name);
      if (names.length) return clip(names.join(', '));
    }
    return clip(chatHeadline(task) || 'Orglet');
  }

  /** The name of a place a forward goes to, for a result that did not go there. */
  targetName(target: ForwardTarget): string {
    if (target.kind === 'worker') return this.store.all<Worker>('workers').find(item => item.id === target.id)?.name ?? 'Tí';
    if (target.kind === 'team') return this.store.all<Team>('teams').find(item => item.id === target.id)?.name ?? 'Hội';
    const task = this.store.all<Task>('tasks').find(item => item.id === target.id && !item.deletedAt);
    return task ? this.chatName(task) : 'Chat';
  }

  /** One saved message of this chat: a turn the person sent, or a finished answer. */
  message(task: Task, messageId: string): ForwardSource {
    const detail = this.store.detail(task.id);
    const current = task.inputRevision ?? 0;
    for (let revision = 0; revision <= current; revision++) {
      if (turnMessageId(task.id, revision) !== messageId) continue;
      const input = turnInput(detail, revision);
      if (!input) break;
      if (input.forwarded) return this.original(input.forwarded);
      const earlier = revision > 0 ? turnInput(detail, revision - 1) : undefined;
      const added = input.sourceIds.filter(sourceId => !earlier?.sourceIds.includes(sourceId));
      return { fromTaskId: task.id, messageId, from: this.chatName(task), authorKind: 'person', text: input.brief, files: added.map(sourceId => ({ name: detail.sources.find(source => source.id === sourceId)?.name ?? sourceId, sourceId })) };
    }
    const artifact = detail.artifacts.find(item => item.id === messageId);
    if (artifact) return this.answer(task, detail, artifact);
    throw new Error('Không tìm thấy tin nhắn trong cuộc trò chuyện này.');
  }

  private answer(task: Task, detail: TaskDetail, artifact: Artifact): ForwardSource {
    const owner = detail.runs.find(run => run.id === artifact.runId);
    if (!owner || owner.status !== 'completed') throw new Error('Tin nhắn chưa được lưu hoàn tất.');
    const report = artifact.report;
    const body = report.format === 'chat' ? report.summary : `${report.title}\n\n${report.summary}`;
    // A source id the model wrote into its answer means nothing in another chat; the file's name does.
    const text = withoutSourceIds(body, detail.sources);
    return { fromTaskId: task.id, messageId: artifact.id, from: this.chatName(task), authorKind: 'orglet', author: owner.snapshot.worker.name, text, files: [] };
  }

  /** A forward of a forward goes out as the original, without the note that came with it the first time. */
  private original(forwarded: ForwardedMessage): ForwardSource {
    return {
      fromTaskId: forwarded.fromTaskId, messageId: forwarded.messageId, from: forwarded.from, authorKind: forwarded.authorKind, text: forwarded.text,
      ...(forwarded.author ? { author: forwarded.author } : {}),
      files: forwarded.files.map(file => ({ name: file.name, ...(file.sourceId ? { sourceId: file.sourceId } : {}) })),
    };
  }
}

/** A turn's saved input: the chat's current one, or the one its runs froze. */
function turnInput(detail: TaskDetail, revision: number): RunInput | undefined {
  const { task } = detail;
  const firstTurn: RunInput = { brief: task.brief, sourceIds: task.sourceIds, excludedSources: task.excludedSources };
  if (revision === (task.inputRevision ?? 0)) return task.currentInput ?? (revision === 0 ? firstTurn : undefined);
  const frozen = detail.runs.find(run => (run.snapshot.inputRevision ?? 0) === revision && run.snapshot.input)?.snapshot.input;
  return frozen ?? (revision === 0 ? firstTurn : undefined);
}
