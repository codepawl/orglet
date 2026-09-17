import { z } from 'zod';

export const PreflightPolicy = z.object({ idColumn: z.string().trim().min(1).max(256).nullable(), compareTwo: z.boolean() }).strict();
export type PreflightPolicy = z.infer<typeof PreflightPolicy>;
export const PreflightRecord = z.object({
  id: z.string().uuid(), taskId: z.string().uuid(), createdAt: z.iso.datetime(),
  policy: PreflightPolicy,
  excludedSourceCount: z.number().int().min(0).max(20020).optional(),
  status: z.enum(['running', 'paused', 'cancelled', 'failed', 'complete', 'partial', 'insufficient_evidence']),
  sourceHashes: z.record(z.string().uuid(), z.string().regex(/^[a-f0-9]{64}$/)),
  profileIds: z.array(z.string().uuid()).max(21),
  notices: z.array(z.object({ sourceId: z.string().uuid().optional(), message: z.string() }).strict()),
}).strict();
export type PreflightRecord = z.infer<typeof PreflightRecord>;
