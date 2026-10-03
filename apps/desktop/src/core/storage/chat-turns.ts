import type { Store } from './database';
import type { Run, Task } from '../../shared/contracts';
import { SyncTurn } from '../../shared/sync-records';
import { turnMessageId } from '../../shared/message-interactions';
import { canonicalSyncData as canonicalJson } from '../../shared/sync-json';
import { DELETED_CHAT_TEXT } from './deleted-chat';

export type SavedChatTurn = SyncTurn & { localRevision: number };

/** User messages survive even when no run was started before the next message. Numeric aliases stay local. */
export class ChatTurns {
  constructor(private store: Store) {}
  list(taskId: string): SavedChatTurn[] {
    return this.store.db.prepare('SELECT local_revision,data FROM chat_turns WHERE task_id=? ORDER BY local_revision').all(taskId)
      .map(row => ({ ...SyncTurn.parse(JSON.parse(String(row.data))), localRevision: Number(row.local_revision) }));
  }
  /** Later authored messages always sort after their known predecessors, even within a millisecond or clock rollback. */
  nextCreatedAt(taskId: string, wallMs = Date.now()): string {
    const latest = this.list(taskId).reduce((maximum, turn) => Math.max(maximum, Date.parse(turn.createdAt)), -1);
    return new Date(Math.max(wallMs, latest + 1)).toISOString();
  }
  /** Retained cost records keep message identities without retaining the deleted conversation. */
  redact(taskId: string) {
    this.store.transaction(() => {
      for (const turn of this.list(taskId)) {
        const { localRevision: _alias, ...saved } = turn;
        this.store.db.prepare('UPDATE chat_turns SET data=? WHERE id=? AND task_id=?')
          .run(JSON.stringify({ ...saved, input: { brief: DELETED_CHAT_TEXT, sourceIds: [] } }), turn.id, taskId);
      }
    });
  }
  save(turn: SyncTurn, localRevision?: number): SavedChatTurn {
    const parsed = SyncTurn.parse(turn);
    const existing = this.store.db.prepare('SELECT local_revision,data FROM chat_turns WHERE id=?').get(parsed.id);
    if (existing) {
      if (canonicalJson(JSON.parse(String(existing.data))) !== canonicalJson(parsed)) throw new Error('Tin nhắn đã có nội dung khác.');
      return { ...parsed, localRevision: Number(existing.local_revision) };
    }
    const alias = localRevision ?? Number(this.store.db.prepare('SELECT COALESCE(MAX(local_revision),-1)+1 AS next FROM chat_turns WHERE task_id=?').get(parsed.taskId)!.next);
    this.store.db.prepare('INSERT INTO chat_turns VALUES(?,?,?,?)').run(parsed.id, parsed.taskId, alias, JSON.stringify(parsed));
    return { ...parsed, localRevision: alias };
  }
  backfill() {
    this.store.transaction(() => {
      for (const task of this.store.all<Task>('tasks')) {
        const runs = this.store.db.prepare('SELECT data FROM runs WHERE task_id=? ORDER BY rowid').all(task.id)
          .map(row => JSON.parse(String(row.data)) as Run);
        const existing = new Set(this.list(task.id).map(turn => turn.localRevision));
        const current = task.inputRevision ?? 0;
        const aliases = new Set([0, current, ...runs.map(run => run.snapshot.inputRevision ?? 0)]);
        for (const alias of [...aliases].sort((first, second) => first - second)) {
          if (existing.has(alias)) continue;
          const owner = runs.find(run => (run.snapshot.inputRevision ?? 0) === alias && run.snapshot.input);
          const input = alias === current && task.currentInput ? task.currentInput : owner?.snapshot.input ?? (alias === 0 && current === 0 ? task : undefined);
          if (!input) continue;
          this.save({ id: owner?.snapshot.turnId ?? turnMessageId(task.id, alias, task.turnIds), taskId: task.id, createdAt: owner?.startedAt ?? task.createdAt,
            input: SyncTurn.shape.input.strip().parse(input) }, alias);
        }
      }
    });
  }
}
