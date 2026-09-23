import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Store, now } from './database';
import { WorkspaceRecovery } from './workspace-recovery';
import { describeToolCallArguments } from '../../shared/workspace-recovery';
import type { RunErrorCode } from '../../shared/contracts';

/**
 * An earlier attempt in this chat holds an effect whose outcome is unknown: a write, a command or a working copy
 * that was interrupted. The chat cannot write again until that attempt is reviewed and retired, so the run that
 * hits this fails with a code the chat can point at (COD-191) instead of only a sentence.
 */
export class UnresolvedAttemptError extends Error {
  readonly code: RunErrorCode = 'unresolved_attempt';
}

const RecordedCall = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['started', 'completed', 'uncertain']),
  output: z.string().nullable(),
}).strict();

/** Keeps tool results outside exported backups, like model checkpoints that contain source text. */
export class ToolCalls {
  constructor(private store: Store) {}

  assertEffectsResolved(runId: string) {
    new WorkspaceRecovery(this.store).assertAvailable(runId);
    // A retry creates a new run and call id. Neither makes a previous unknown effect safe.
    const unresolved = this.store.db.prepare(`
      SELECT previous.call_id FROM tool_calls previous
      JOIN runs previous_run ON previous_run.id=previous.run_id
      JOIN runs current_run ON current_run.task_id=previous_run.task_id
      WHERE current_run.id=? AND previous.replay='never' AND previous.state='uncertain'
      AND NOT EXISTS (SELECT 1 FROM settings WHERE id='workspace-retired:' || previous.run_id)
      LIMIT 1
    `).get(runId);
    if (unresolved) throw new UnresolvedAttemptError('Thao tác trước chưa rõ kết quả. Không tự chạy lại; cần kiểm tra đầu ra trước.');
  }

  async execute<Result>(options: {
    runId: string;
    callId: string;
    name: string;
    arguments: unknown;
    replay: 'read' | 'idempotent' | 'never';
    authorize: () => void;
    perform: () => Promise<Result> | Result;
  }): Promise<Result> {
    new WorkspaceRecovery(this.store).assertAvailable(options.runId);
    options.authorize();
    const fingerprint = createHash('sha256').update(JSON.stringify([options.name, options.replay, options.arguments])).digest('hex');
    const retained = this.store.transaction(() => {
      const raw = this.store.db.prepare('SELECT fingerprint,state,output FROM tool_calls WHERE run_id=? AND call_id=?').get(options.runId, options.callId);
      if (raw) {
        const previous = RecordedCall.parse(raw);
        if (previous.fingerprint !== fingerprint) throw new Error('Tool call đã lưu có nội dung khác.');
        if (previous.state === 'completed') return { output: previous.output! };
        if (previous.state === 'started' || options.replay === 'never') {
          throw new UnresolvedAttemptError('Thao tác trước chưa rõ kết quả. Không tự chạy lại; cần kiểm tra đầu ra trước.');
        }
        this.store.db.prepare("UPDATE tool_calls SET state='started' WHERE run_id=? AND call_id=?").run(options.runId, options.callId);
      } else {
        if (options.replay === 'never') this.assertEffectsResolved(options.runId);
        this.store.db.prepare(`INSERT INTO tool_calls(run_id,call_id,fingerprint,state,output,replay,name,summary,started_at)
          VALUES(?,?,?,'started',NULL,?,?,?,?)`)
          .run(options.runId, options.callId, fingerprint, options.replay, options.name,
            describeToolCallArguments(options.name, options.arguments), now());
      }
      return undefined;
    });
    if (retained) return JSON.parse(retained.output) as Result;
    try {
      // Authorize again after claiming; a stored result never authorizes another operation.
      options.authorize();
      const result = await options.perform();
      const output = JSON.stringify(result);
      if (output === undefined || Buffer.byteLength(output, 'utf8') > 512 * 1024) {
        throw new Error('Đầu ra công cụ vượt giới hạn lưu trữ.');
      }
      this.store.db.prepare("UPDATE tool_calls SET state='completed',output=? WHERE run_id=? AND call_id=? AND state='started'")
        .run(output, options.runId, options.callId);
      options.authorize();
      return result;
    } catch (error) {
      this.store.db.prepare("UPDATE tool_calls SET state='uncertain' WHERE run_id=? AND call_id=? AND state='started'")
        .run(options.runId, options.callId);
      throw error;
    }
  }
}
