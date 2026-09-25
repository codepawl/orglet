import { z } from 'zod';
import { McpApproval, McpApprovalChoice } from './mcp';

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
  // Room for the four approval choices below; a question the worker asks still has two or three (see the refine).
  options: z.array(z.string().trim().min(1).max(160)).min(2).max(4),
  /**
   * Set when the core itself paused the run to ask whether an MCP tool may run (COD-241). Its options are the four
   * `McpApprovalChoice` keys and its answer is one of them; the window draws its own card from these fields.
   */
  approval: McpApproval.optional(),
}).strict().refine(request => request.approval
  ? request.options.length === McpApprovalChoice.options.length && (!request.answer || McpApprovalChoice.safeParse(request.answer).success)
  : request.options.length <= 3, 'Câu hỏi quyết định không hợp lệ.');

export type DecisionRequest = z.infer<typeof DecisionRequest>;
