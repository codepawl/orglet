import type { Store } from './database';
import type { Run, Task } from '../../shared/contracts';
import { SyncTurn } from '../../shared/sync-records';
import { turnMessageId } from '../../shared/message-interactions';
import { canonicalSyncData as canonicalJson } from '../../shared/sync-json';
import { DELETED_CHAT_TEXT } from './deleted-chat';

export type SavedChatTurn = SyncTurn & { localRevision: number };

/**
 * Rows already checked by `SyncTurn`, by their stored text. A turn is written once and never changes, but a chat of 2,000
 * turns was read, parsed and checked again whole on every write to it (a 40 ms event, a 21 ms task save); a row seen
 * before is now a lookup. The parsed value is shared, so callers treat a turn as read-only, as they already do.
 */
const CHECKED_TURN_LIMIT = 50_000;
const checkedTurns = new Map<string, SyncTurn>();
function checkedTurn(text: string): SyncTurn {
  const known = checkedTurns.get(text);
  if (known) return known;
  const parsed = SyncTurn.parse(JSON.parse(text));
  if (checkedTurns.size >= CHECKED_TURN_LIMIT) checkedTurns.delete(checkedTurns.keys().next().value!);
  checkedTurns.set(text, parsed);
  return parsed;
}

/** User messages survive even when no run was started before the next message. Numeric aliases stay local. */
export class ChatTurns {
  constructor(private store: Store) {}
  list(taskId: string): SavedChatTurn[] {
    return this.store.db.prepare('SELECT local_revision,data FROM chat_turns WHERE task_id=? ORDER BY local_revision').all(taskId)
      .map(row => ({ ...checkedTurn(String(row.data)), localRevision: Number(row.local_revision) }));
  }
  /** The turns from `fromRevision` on, for a window onto the end of a long chat. */
  listFrom(taskId: string, fromRevision: number): SavedChatTurn[] {
    return this.store.db.prepare('SELECT local_revision,data FROM chat_turns WHERE task_id=? AND local_revision>=? ORDER BY local_revision').all(taskId, fromRevision)
      .map(row => ({ ...checkedTurn(String(row.data)), localRevision: Number(row.local_revision) }));
  }
  /** One turn by its number, without reading the rest of the chat. */
  get(taskId: string, revision: number): SavedChatTurn | undefined {
    const row = this.store.db.prepare('SELECT local_revision,data FROM chat_turns WHERE task_id=? AND local_revision=?').get(taskId, revision);
    return row ? { ...checkedTurn(String(row.data)), localRevision: Number(row.local_revision) } : undefined;
  }
  /** The ids of all turns by number: what a chat's `turnIds` holds, without reading any message. */
  ids(taskId: string): Record<number, string> {
    return Object.fromEntries(this.store.db.prepare('SELECT local_revision,id FROM chat_turns WHERE task_id=? ORDER BY local_revision').all(taskId)
      .map(row => [Number(row.local_revision), String(row.id)]));
  }
  /** How many turns a chat has and the number of its oldest one among its newest `count`, or undefined when it has no more than that. */
  windowStart(taskId: string, count: number): number | undefined {
    const row = this.store.db.prepare('SELECT local_revision FROM chat_turns WHERE task_id=? ORDER BY local_revision DESC LIMIT 1 OFFSET ?').get(taskId, count - 1);
    return row ? Number(row.local_revision) : undefined;
  }
  /** Later authored messages always sort after their known predecessors, even within a millisecond or clock rollback. */
  nextCreatedAt(taskId: string, wallMs = Date.now()): string {
    let latest = -1;
    for (const row of this.store.db.prepare("SELECT json_extract(data,'$.createdAt') AS created_at FROM chat_turns WHERE task_id=?").all(taskId)) {
      latest = Math.max(latest, Date.parse(String(row.created_at)));
    }
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
