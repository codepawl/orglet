import { z } from 'zod';

export const Reaction = z.enum(['agree', 'delighted', 'funny', 'unsure', 'watching', 'against']);
export type Reaction = z.infer<typeof Reaction>;

export const MessageReaction = z.object({
  messageId: z.uuid(), emoji: Reaction, actor: z.enum(['user', 'worker']),
  workerId: z.uuid().optional(), runId: z.uuid().optional(), callId: z.string().max(200).optional(),
  createdAt: z.iso.datetime(),
}).strict();
export type MessageReaction = z.infer<typeof MessageReaction>;

export const SetMessageReaction = z.object({ messageId: z.uuid(), emoji: Reaction, active: z.boolean() }).strict();
export const SetUserReaction = SetMessageReaction.extend({ taskId: z.uuid() }).strict();

/**
 * How a one-shot CLI answer reacts (COD-216): the react_to_message tool only exists in the core tool loop, so the
 * answer carries at most a few `{ messageId, emoji }` items, each recorded through the same check as the tool.
 */
export const MAX_ANSWER_REACTIONS = 3;
export const AnswerReaction = z.object({ messageId: z.uuid(), emoji: Reaction }).strict();
export const AnswerReactions = z.array(AnswerReaction).max(MAX_ANSWER_REACTIONS);

/** Stable ID for a saved user turn, including turns created before explicit reply support. */
export function turnMessageId(taskId: string, revision: number): string {
  const compact = taskId.replaceAll('-', '');
  if (!/^[a-f0-9]{32}$/i.test(compact) || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Tin nhắn không hợp lệ.');
  const tail = (BigInt(`0x${compact.slice(-12)}`) ^ BigInt(revision)).toString(16).padStart(12, '0');
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${tail}`;
}
