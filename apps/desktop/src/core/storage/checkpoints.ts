import type { ModelReply, RunMessage } from '../adapters/openai';
import { Store, now } from './database';

export type Checkpoint = {
  id: string; step: number; phase: 'ready' | 'requesting' | 'replied' | 'done';
  /**
   * The conversation so far. A message's `images` slot holds only `{ hash, mime }` references, never bytes: the runner
   * reads each image again, through the source checks, right before every request (COD-260).
   */
  messages: RunMessage[]; readIds: string[]; reply?: ModelReply;
  reportCorrections?: number;
  /** Set once the run was told it is almost out of steps and must hand in now (COD-187). */
  wrappingUp?: boolean;
  /** CLI-reported estimates, separate from settled API charges. */
  harnessCostMicros?: number;
  /** CLI calls in this run that reported no estimate, so the run total above is a floor, not the whole spend. */
  harnessCallsWithoutCost?: number;
  /**
   * What the run has read that nobody vetted (web pages, files, other workers' messages), kept so a resume still
   * knows; an app change proposed by such a run is never applied without a click (COD-199).
   */
  untrustedInputs?: string[];
  /**
   * An MCP call waiting for the person's answer on the chat (COD-241). The messages end with the model's call and no
   * result; on resume the runner reads the answer, then runs the call or hands back the refusal.
   */
  pendingApproval?: { requestId: string; callId: string; name: string; arguments: string };
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
