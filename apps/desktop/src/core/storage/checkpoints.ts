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
/** A message the runner added to steer the run (the wrap-up, a report correction), not part of the work itself. */
function isRunnerInstruction(message: RunMessage) {
  return message.role === 'user' && typeof message.content === 'string'
    && (message.content.startsWith('{"stepsLeft":') || message.content.startsWith('{"reportValidation":'));
}
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
  /**
   * Keeps a finished run's conversation instead of dropping it, so the next turn can carry on from it when the person
   * presses Continue (COD-257). Called inside the transaction that saves the run's answer.
   */
  keepFinished(runId: string) {
    const checkpoint = this.get(runId);
    if (checkpoint) this.save({ ...checkpoint, phase: 'done', reply: undefined, pendingApproval: undefined });
  }
  /**
   * The tool calls and results a kept run made, in order, with what it had read: what a Continue turn starts from
   * (COD-257). The wrap-up instruction is left out, and so is a call that never got its result.
   */
  carried(runId: string): { messages: RunMessage[]; readIds: string[]; untrustedInputs: string[] } | undefined {
    const checkpoint = this.get(runId);
    if (!checkpoint || checkpoint.phase !== 'done') return undefined;
    const start = checkpoint.messages.findIndex(message => message.role === 'assistant' && Boolean(message.tool_calls?.length));
    if (start < 0) return undefined;
    const exchange = checkpoint.messages.slice(start).filter(message => !isRunnerInstruction(message));
    const answered = new Set(exchange.flatMap(message => message.role === 'tool' ? [message.tool_call_id] : []));
    const messages = exchange.filter(message => message.role !== 'assistant' || !message.tool_calls?.length
      || message.tool_calls.every(call => answered.has(call.id)));
    return { messages, readIds: checkpoint.readIds, untrustedInputs: checkpoint.untrustedInputs ?? [] };
  }
  /** Drops what a chat's finished runs kept for Continue, except `keepRunId`'s, once a newer turn starts (COD-257). */
  dropFinished(taskId: string, keepRunId?: string) {
    this.store.db.prepare("DELETE FROM checkpoints WHERE id IN (SELECT id FROM runs WHERE task_id=?) AND id<>? AND json_extract(data,'$.phase')='done'")
      .run(taskId, keepRunId ?? '');
  }
  committed(checkpoint: Checkpoint, done = false, persist?: () => void) {
    this.store.transaction(() => {
      this.save({ ...checkpoint, phase: done ? 'done' : 'ready', reply: undefined });
      this.store.db.prepare("UPDATE step_attempts SET state='committed' WHERE run_id=? AND step=?").run(checkpoint.id, checkpoint.step - 1);
      persist?.();
    });
  }
}
