import { z } from 'zod';

export const SendTeamMessage = z.object({
  recipientId: z.string().uuid(),
  kind: z.enum(['question', 'response', 'blocker', 'handoff']),
  body: z.string().trim().min(1).max(4000),
  replyTo: z.string().uuid().nullable(),
}).strict();

export const ReadTeamMessages = z.object({}).strict();
export const AcknowledgeTeamMessages = z.object({ messageIds: z.array(z.string().uuid()).min(1).max(20) }).strict();
export const ResolveTeamMessages = z.object({
  messageIds: z.array(z.string().uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length),
  resolution: z.string().trim().min(1).max(2000),
}).strict();
export const ReassignTeamWork = z.object({
  assignmentWorkerId: z.string().uuid(),
  newWorkerId: z.string().uuid(),
  reason: z.string().trim().min(1).max(2000),
}).strict();
export const TeamReassignment = ReassignTeamWork.extend({
  sourceRunId: z.string().uuid(), decisionRunId: z.string().uuid(), callId: z.string().min(1).max(200),
}).strict();
export type TeamReassignment = z.infer<typeof TeamReassignment>;
export const TeamMessage = SendTeamMessage.extend({
  body: z.string().min(1).max(4200),
  teamId: z.string().uuid(),
  inputRevision: z.number().int().nonnegative(),
  senderId: z.string().uuid(),
  callId: z.string().min(1).max(200),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  assignmentWorkerId: z.string().uuid().optional(),
  state: z.enum(['pending', 'acknowledged', 'answered', 'resolved']),
  resolution: z.object({ runId: z.string().uuid(), body: z.string().min(1).max(2000), createdAt: z.iso.datetime() }).strict().optional(),
}).strict();
export type TeamMessage = z.infer<typeof TeamMessage>;
