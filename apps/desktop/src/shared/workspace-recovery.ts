import { z } from 'zod';
import { WorkspacePath, WorkspaceRead, WorkspaceHash } from './workspace-tools';

const Change = z.object({ path: WorkspacePath, status: z.enum(['pending', 'applied', 'conflict', 'blocked']), reason: z.string().optional() });
export const WorkspaceRecoveryView = z.object({
  taskId: z.uuid(),
  attempts: z.array(z.object({ runId: z.uuid(), reviewToken: z.string().regex(/^[a-f0-9]{64}$/), retired: z.boolean() })),
  copies: z.array(z.object({ runId: z.uuid(), state: z.enum(['preparing', 'ready', 'integrating', 'integrated', 'conflict', 'uncertain']),
    kind: z.enum(['copy', 'git-worktree']), changes: z.array(Change), changeCount: z.number().int().nonnegative() })),
  processes: z.array(z.object({ id: z.uuid(), runId: z.uuid(), command: z.string().max(1000),
    state: z.enum(['running', 'exited', 'cancelled', 'timeout', 'output_limit', 'uncertain']), exitCode: z.number().int().nullable() })),
  uncertainCalls: z.array(z.object({ runId: z.uuid(), callId: z.string(), replay: z.enum(['read', 'idempotent', 'never']) })),
  truncated: z.boolean(),
}).strict();
export type WorkspaceRecoveryView = z.infer<typeof WorkspaceRecoveryView>;
export const RetireWorkspaceAttempt = z.object({ taskId: z.uuid(), runId: z.uuid(),
  reviewToken: z.string().regex(/^[a-f0-9]{64}$/), keepCurrentFiles: z.literal(true) }).strict();
export const ReadRecoveryOutput = z.object({ taskId: z.uuid(), processId: z.uuid(),
  stream: z.enum(['stdout', 'stderr']), offset: z.number().int().min(0).max(262144) }).strict();
export type RecoveryOutput = { content: string; nextOffset: number | null; state: string };
export const ReadRecoveryFile = WorkspaceRead.extend({ taskId: z.uuid(), runId: z.uuid() }).strict();
export const RecoveryFile = z.object({ content: z.string().max(32768), hash: WorkspaceHash,
  nextOffset: z.number().int().nonnegative().nullable() });
export type RecoveryFile = z.infer<typeof RecoveryFile>;
