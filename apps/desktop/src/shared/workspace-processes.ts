import { z } from 'zod';

export const StartWorkspaceProcess = z.object({
  program: z.enum(['node', 'shell']),
  arguments: z.array(z.string().max(12000)).max(64),
  timeoutMs: z.number().int().min(100).max(120000),
}).strict().refine(input => input.program !== 'shell' || input.arguments.length === 1,
  'Lệnh shell cần đúng một chuỗi lệnh.');
export const WorkspaceProcessId = z.object({ processId: z.uuid() }).strict();
export const WorkspaceProcessStatus = WorkspaceProcessId.extend({ waitMs: z.number().int().min(0).max(10000) });
export const WorkspaceProcessOutput = WorkspaceProcessId.extend({
  stream: z.enum(['stdout', 'stderr']), offset: z.number().int().min(0).max(262144),
});
export const WorkspaceProcess = z.object({
  id: z.uuid(), runId: z.uuid(), command: StartWorkspaceProcess,
  state: z.enum(['running', 'exited', 'cancelled', 'timeout', 'output_limit', 'uncertain']),
  exitCode: z.number().int().nullable(), stdout: z.string().max(262144), stderr: z.string().max(262144),
  error: z.string().max(4000).optional(),
}).strict();
export type WorkspaceProcess = z.infer<typeof WorkspaceProcess>;
