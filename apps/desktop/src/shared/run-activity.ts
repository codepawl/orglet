import { z } from 'zod';

/** Observed request lifecycle, in memory only. No arguments, tool output or private model notes. */
export const RunActivity = z.object({
  id: z.string().min(1).max(200),
  runId: z.string().min(1).max(100),
  taskId: z.string().min(1).max(100),
  kind: z.enum(['model', 'tool', 'note']),
  state: z.enum(['running', 'completed', 'failed', 'stopped', 'waiting', 'unknown']),
  label: z.string().min(1).max(300),
  detail: z.string().max(4000).optional(),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type RunActivity = z.infer<typeof RunActivity>;
