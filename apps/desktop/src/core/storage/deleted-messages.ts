import { createHash } from 'node:crypto';
import type { Artifact, Run, Task } from '../../shared/contracts';
import type { Store } from './database';
import { now } from './database';
import { ChatSearch } from './chat-search';
import { DELETED_CHAT_TEXT } from './deleted-chat';

/** What a deleted message reads as wherever a row has to keep some text. */
export const DELETED_MESSAGE_TEXT = DELETED_CHAT_TEXT;

const WORKING_STATUSES: readonly Task['status'][] = ['queued', 'running', 'pausing'];

/** The ids a chat's person deleted, for the chat's detail; absent when there are none, so most details stay as they were. */
export function deletedMessageIds(store: Store, taskId: string): { deletedMessageIds?: string[] } {
  const ids = store.db.prepare('SELECT id FROM deleted_messages WHERE task_id=? ORDER BY deleted_at, id').all(taskId).map(row => String(row.id));
  return ids.length ? { deletedMessageIds: ids } : {};
}

/**
 * Deleting one message of a chat on this computer: the person's own message or an orglet's answer.
 *
 * The text goes where it lives (the saved turn, the run's copy of the input, the chat's current input, the answer's
 * row) and the message is marked in `deleted_messages`, a table only this computer has: sync does not read or send it.
 * Runs, usage, checkpoints and file changes are not touched. Every write here is raw SQL on purpose: going through
 * `Store.update` would record the blanked row as a changed message for sync to send, and another computer holds the
 * original (`ChatTurns.save` refuses a turn with the same id and different words). The sync side is fenced instead:
 * the message's record key joins `sync_deletions`, which `LocalSync` already treats as "never send, never take back".
 */
export class DeletedMessages {
  constructor(private store: Store) {}

  has(messageId: string): boolean {
    return Boolean(this.store.db.prepare('SELECT 1 FROM deleted_messages WHERE id=?').get(messageId));
  }

  /** Returns false when the message was already deleted: a second delete changes nothing. */
  delete(taskId: string, messageId: string): boolean {
    if (this.has(messageId)) return false;
    return this.store.transaction(() => {
      const task = this.store.get<Task>('tasks', taskId);
      if (WORKING_STATUSES.includes(task.status)) throw new Error('Cuộc trò chuyện đang chạy. Chờ xong hoặc dừng lại rồi hãy xóa tin nhắn.');
      const syncKey = this.blankTurn(task, messageId) ?? this.blankAnswer(task, messageId);
      if (!syncKey) throw new Error('Không tìm thấy tin nhắn trong cuộc trò chuyện này.');
      this.dropReactions(taskId, messageId);
      new ChatSearch(this.store).removeMessage(messageId);
      this.store.db.prepare('INSERT INTO deleted_messages VALUES(?,?,?)').run(messageId, taskId, now());
      this.fenceFromSync(syncKey);
      return true;
    });
  }

  /** The person's message: its saved turn, the runs' copies of it and the chat's current input. Returns the sync key, or undefined if this is no turn. */
  private blankTurn(task: Task, messageId: string): string | undefined {
    const row = this.store.db.prepare('SELECT local_revision,data FROM chat_turns WHERE id=? AND task_id=?').get(messageId, task.id);
    if (!row) return undefined;
    const revision = Number(row.local_revision);
    const turn = JSON.parse(String(row.data)) as { input: object };
    this.store.db.prepare('UPDATE chat_turns SET data=? WHERE id=?')
      .run(JSON.stringify({ ...turn, input: { brief: DELETED_MESSAGE_TEXT, sourceIds: [] } }), messageId);
    for (const runRow of this.store.db.prepare('SELECT id,data FROM runs WHERE task_id=?').all(task.id)) {
      const run = JSON.parse(String(runRow.data)) as Run;
      const ownsTurn = run.snapshot.turnId ? run.snapshot.turnId === messageId : (run.snapshot.inputRevision ?? 0) === revision;
      if (!ownsTurn || !run.snapshot.input) continue;
      const input = { ...run.snapshot.input, brief: DELETED_MESSAGE_TEXT, sourceIds: [], replyTo: undefined, forwarded: undefined };
      this.store.db.prepare('UPDATE runs SET data=? WHERE id=?').run(JSON.stringify({ ...run, snapshot: { ...run.snapshot, input } }), String(runRow.id));
    }
    const isCurrent = task.currentTurnId === messageId || revision === (task.inputRevision ?? 0);
    const blanked: Task = { ...task };
    if (revision === 0 || isCurrent) blanked.brief = DELETED_MESSAGE_TEXT;
    if (isCurrent && task.currentInput) {
      blanked.currentInput = { ...task.currentInput, brief: DELETED_MESSAGE_TEXT, sourceIds: [], replyTo: undefined, forwarded: undefined };
    }
    this.store.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(blanked), task.id);
    return `turn:${messageId}`;
  }

  /** An orglet's answer to the chat. A crew member's report or a plan is not a message of the chat. */
  private blankAnswer(task: Task, messageId: string): string | undefined {
    const row = this.store.db.prepare('SELECT a.data AS artifact,r.data AS run FROM artifacts a JOIN runs r ON r.id=a.run_id WHERE a.id=? AND r.task_id=?').get(messageId, task.id);
    if (!row) return undefined;
    const run = JSON.parse(String(row.run)) as Run;
    if (run.stage === 'member' || run.stage === 'plan') return undefined;
    const artifact = JSON.parse(String(row.artifact)) as Artifact;
    const report = { format: 'chat' as const, title: DELETED_MESSAGE_TEXT, summary: DELETED_MESSAGE_TEXT, findings: [], limitations: [] };
    const hash = createHash('sha256').update(JSON.stringify(report)).digest('hex');
    this.store.db.prepare('UPDATE artifacts SET data=? WHERE id=?').run(JSON.stringify({ ...artifact, report, hash }), messageId);
    return `artifact:${messageId}`;
  }

  private dropReactions(taskId: string, messageId: string) {
    const task = this.store.get<Task>('tasks', taskId);
    if (!task.messageReactions?.some(reaction => reaction.messageId === messageId)) return;
    const messageReactions = task.messageReactions.filter(reaction => reaction.messageId !== messageId);
    this.store.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify({ ...task, messageReactions }), taskId);
  }

  /** Erases this message's copies in the sync replica and fences its record so it is never sent and never taken back. */
  private fenceFromSync(syncKey: string) {
    const [kind, id] = syncKey.split(':');
    this.store.db.prepare("INSERT OR IGNORE INTO sync_deletions VALUES('record',?)").run(syncKey);
    this.store.db.prepare('DELETE FROM sync_records WHERE record_key=?').run(syncKey);
    for (const table of ['sync_outbox', 'sync_inbox']) {
      this.store.db.prepare(`DELETE FROM ${table} WHERE json_extract(data,'$.data.kind')=? AND json_extract(data,'$.data.value.id')=?`).run(kind, id);
    }
  }
}
