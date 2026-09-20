import { z } from 'zod';

export const DecisionQuestion = z.object({
  question: z.string().trim().min(1).max(1000),
  options: z.array(z.string().trim().min(1).max(160)).min(2).max(3),
}).strict();

export const DecisionRequest = DecisionQuestion.extend({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  inputRevision: z.number().int().nonnegative(),
  requestedAt: z.iso.datetime(),
  answer: z.string().trim().min(1).max(2000).optional(),
  answeredAt: z.iso.datetime().optional(),
  interruptedAt: z.iso.datetime().optional(),
}).strict();

export type DecisionRequest = z.infer<typeof DecisionRequest>;
