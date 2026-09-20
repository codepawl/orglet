import { z } from 'zod';
import { WorkspaceHash, WorkspacePath } from './workspace-tools';

/** Metadata only. Workspace bytes and absolute paths stay outside backups. */
export const WorkspaceReadEvidence = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  callId: z.string().min(1).max(200),
  path: WorkspacePath.refine(Boolean),
  hash: WorkspaceHash,
  grantId: z.uuid(),
  grantRevision: z.number().int().positive(),
}).strict();
export type WorkspaceReadEvidence = z.infer<typeof WorkspaceReadEvidence>;
