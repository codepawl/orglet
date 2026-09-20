import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { ModelReply } from '../adapters/openai';
import { Store, now } from './database';

export type Checkpoint = {
  id: string; step: number; phase: 'ready' | 'requesting' | 'replied' | 'done';
  messages: ChatCompletionMessageParam[]; readIds: string[]; reply?: ModelReply;
  reportCorrections?: number;
  /** CLI-reported estimates, separate from settled API charges. */
  harnessCostMicros?: number;
};
// Context may contain selected source text. It stays in core storage, outside renderer IPC and backups.
export class Checkpoints {
  constructor(private store: Store) {}
  get(runId: string): Checkpoint | undefined {
    const row = this.store.db.prepare('SELECT data FROM checkpoints WHERE id=?').get(runId);
    return row ? JSON.parse(String(row.data)) : undefined;
  }
  save(checkpoint: Checkpoint) { this.store.put('checkpoints', checkpoint); }
  claim(runId: string) {
    this.store.db.prepare('INSERT INTO leases VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET heartbeat=excluded.heartbeat').run(runId, now());
  }
  release(runId: string) { this.store.db.prepare('DELETE FROM leases WHERE run_id=?').run(runId); }
  requested(checkpoint: Checkpoint, reservationId: string) {
    // Called inside BudgetLedger.reserve's transaction; never separate the two writes.
    this.save({ ...checkpoint, phase: 'requesting' });
    this.store.db.prepare('INSERT INTO step_attempts VALUES(?,?,?,?,?)').run(checkpoint.id, checkpoint.step, reservationId, 'requesting', now());
  }
  received(checkpoint: Checkpoint, reply: ModelReply) {
    this.store.transaction(() => {
      this.save({ ...checkpoint, phase: 'replied', reply });
      this.store.db.prepare("UPDATE step_attempts SET state='received' WHERE run_id=? AND step=?").run(checkpoint.id, checkpoint.step);
    });
  }
  committed(checkpoint: Checkpoint, done = false, persist?: () => void) {
    this.store.transaction(() => {
      this.save({ ...checkpoint, phase: done ? 'done' : 'ready', reply: undefined });
      this.store.db.prepare("UPDATE step_attempts SET state='committed' WHERE run_id=? AND step=?").run(checkpoint.id, checkpoint.step - 1);
      persist?.();
    });
  }
}
