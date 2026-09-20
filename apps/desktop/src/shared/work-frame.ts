import { z } from 'zod';

/** A worker's interpretation of one turn, not a grant or a verified result. */
export const WorkFrame = z.object({
  goal: z.string().trim().min(1).max(500),
  statedConstraints: z.array(z.string().trim().min(1).max(300)).max(6),
  assumptions: z.array(z.string().trim().min(1).max(300)).max(6),
  plannedChecks: z.array(z.string().trim().min(1).max(300)).max(8),
}).strict();

export type WorkFrame = z.infer<typeof WorkFrame>;
