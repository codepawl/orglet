import { z } from 'zod';

export const ScoreDirection = z.enum(['higher', 'lower']);
export const RunAuditArgs = z.object({ sourceId: z.string().uuid(), direction: ScoreDirection }).strict();
const Count = z.number().int().nonnegative().max(10000);
const Numeric = z.number().finite();
export const RunAudit = z.object({
  version: z.literal('orglet-run-audit-v1'), sourceId: z.string().uuid(), metric: z.string().min(1).max(128), direction: ScoreDirection,
  status: z.enum(['observations', 'insufficient_evidence', 'needs_review']),
  rows: Count, completed: Count, failed: Count, cancelled: Count, ignoredFailureScores: Count,
  groups: z.array(z.object({
    solution: z.string(), split: z.string(), total: Count, completed: Count, failed: Count, cancelled: Count,
    mean: Numeric.nullable(), minimum: Numeric.nullable(), maximum: Numeric.nullable(), sampleStdDev: Numeric.nullable(),
  }).strict()).max(200),
  failures: z.array(z.object({ code: z.string(), count: Count }).strict()).max(200),
  ranks: z.array(z.object({ solution: z.string(), publicRank: Count, privateRank: Count, improvement: z.number().int() }).strict()).max(100).nullable(),
  notices: z.array(z.string()).max(20),
}).strict();
export type RunAudit = z.infer<typeof RunAudit>;
