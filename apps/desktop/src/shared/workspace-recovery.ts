import { z } from 'zod';
import { WorkspacePath, WorkspaceRead, WorkspaceHash, WorkspaceChangeKind } from './workspace-tools';
import { WorkspaceDiffSummary } from './workspace-diff';

export const TOOL_CALL_SUMMARY_LENGTH = 300;
/** Why a hand-in step stopped (COD-254): the person changed, removed or created something at that path meanwhile. */
export const WorkspaceConflictReason = z.enum(['changed', 'missing', 'exists', 'not_empty']);
export type WorkspaceConflictReason = z.infer<typeof WorkspaceConflictReason>;
/**
 * One hand-in step. No `kind` means a file write, the only step before COD-254. `from` is where a moved file was;
 * `restored` marks a deleted file put back from its backup.
 */
const Change = z.object({
  kind: WorkspaceChangeKind.optional(), path: WorkspacePath, from: WorkspacePath.optional(),
  status: z.enum(['pending', 'applied', 'conflict', 'blocked']), reason: z.string().optional(),
  conflict: WorkspaceConflictReason.optional(), restored: z.boolean().optional(),
});
export const WorkspaceRecoveryView = z.object({
  taskId: z.uuid(),
  attempts: z.array(z.object({ runId: z.uuid(), reviewToken: z.string().regex(/^[a-f0-9]{64}$/), retired: z.boolean() })),
  copies: z.array(z.object({ runId: z.uuid(), state: z.enum(['preparing', 'ready', 'integrating', 'integrated', 'conflict', 'uncertain']),
    kind: z.enum(['copy', 'git-worktree']), changes: z.array(Change), changeCount: z.number().int().nonnegative(),
    /** Counts of what the copy changed since its snapshot, once the run finished; the `workspaceDiff` command has the hunks (COD-163). */
    diff: WorkspaceDiffSummary.optional() })),
  processes: z.array(z.object({ id: z.uuid(), runId: z.uuid(), command: z.string().max(1000),
    state: z.enum(['running', 'exited', 'cancelled', 'timeout', 'output_limit', 'uncertain']), exitCode: z.number().int().nullable() })),
  // `tool`, `summary` and `at` are null for calls journaled before they were recorded (COD-191).
  uncertainCalls: z.array(z.object({ runId: z.uuid(), callId: z.string(), replay: z.enum(['read', 'idempotent', 'never']),
    tool: z.string().max(100).nullable(), summary: z.string().max(TOOL_CALL_SUMMARY_LENGTH).nullable(), at: z.string().nullable() })),
  truncated: z.boolean(),
}).strict();
export type WorkspaceRecoveryView = z.infer<typeof WorkspaceRecoveryView>;
export type UncertainCall = WorkspaceRecoveryView['uncertainCalls'][number];

/**
 * The one argument worth showing for a journaled call: the path a write or an integration touched, both paths of a
 * move, or the command a process ran. Never the file's content, a hash or the root, so the journal stays safe to show
 * and to keep.
 */
export function describeToolCallArguments(name: string, argumentsValue: unknown): string | null {
  if (!argumentsValue || typeof argumentsValue !== 'object') return null;
  const fields = argumentsValue as Record<string, unknown>;
  if (name === 'workspace_start_process') {
    const program = typeof fields.program === 'string' ? fields.program : '';
    const programArguments = Array.isArray(fields.arguments) ? fields.arguments.filter(item => typeof item === 'string') : [];
    return truncateSummary([program, ...programArguments].join(' '));
  }
  // A model move names `from` and `to`; an integrated move names `from` and the `path` it ends at.
  const destination = typeof fields.to === 'string' ? fields.to : fields.path;
  if (typeof fields.from === 'string' && typeof destination === 'string') return truncateSummary(`${fields.from} → ${destination}`);
  if (typeof fields.path === 'string') return truncateSummary(fields.path);
  return null;
}

function truncateSummary(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const characters = [...trimmed];
  return characters.length > TOOL_CALL_SUMMARY_LENGTH ? `${characters.slice(0, TOOL_CALL_SUMMARY_LENGTH - 1).join('')}…` : trimmed;
}
export const RetireWorkspaceAttempt = z.object({ taskId: z.uuid(), runId: z.uuid(),
  reviewToken: z.string().regex(/^[a-f0-9]{64}$/), keepCurrentFiles: z.literal(true) }).strict();
export const ReadRecoveryOutput = z.object({ taskId: z.uuid(), processId: z.uuid(),
  stream: z.enum(['stdout', 'stderr']), offset: z.number().int().min(0).max(262144) }).strict();
export type RecoveryOutput = { content: string; nextOffset: number | null; state: string };
export const ReadRecoveryFile = WorkspaceRead.extend({ taskId: z.uuid(), runId: z.uuid() }).strict();
/** Puts a file a hand-in deleted back from its private backup, only where nothing stands now (COD-254). */
export const RestoreWorkspaceFile = z.object({ taskId: z.uuid(), runId: z.uuid(), path: WorkspacePath.refine(Boolean) }).strict();
export const RecoveryFile = z.object({ content: z.string().max(32768), hash: WorkspaceHash,
  nextOffset: z.number().int().nonnegative().nullable() });
export type RecoveryFile = z.infer<typeof RecoveryFile>;
