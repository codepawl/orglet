import { z } from 'zod';

/**
 * Forwarding a message to other chats (COD-257), the way Messenger, WhatsApp or Discord forward one: pick up to five
 * places, add a note if you like, send. In each place the forward arrives as the person's own message, so it is a
 * turn like any other: it goes through `reviseTask` or `createTask` with the same budget, permission and queue checks,
 * and the orglet there answers. The core resolves the message itself from saved history; the window only names it.
 */

/** Places one forward may go to at once. WhatsApp and Discord stop at five as well. */
export const MAX_FORWARD_TARGETS = 5;
/** Longest forwarded text; a longer message is cut and says so. Leaves room in the 16 000-character brief. */
export const FORWARD_TEXT_CHARS = 10_000;
/** Longest note added to a forward. */
export const FORWARD_NOTE_CHARS = 2_000;
/** A file's name as the forwarded message spells it for the model; the full name stays on the record. */
const FILE_NAME_IN_BRIEF_CHARS = 120;

/**
 * Where a forward goes: an orglet's or a crew's main chat (found or started the way a click on it would), or one
 * existing chat by id (a recent chat, a side thread, a group chat).
 */
export const ForwardTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('worker'), id: z.uuid() }).strict(),
  z.object({ kind: z.literal('team'), id: z.uuid() }).strict(),
  z.object({ kind: z.literal('task'), id: z.uuid() }).strict(),
]);
export type ForwardTarget = z.infer<typeof ForwardTarget>;

/**
 * A file the forwarded message had. `sourceId` is set only when the person chose to carry it: it is then the target
 * chat's own copy, attached to this message the way picking the file would attach it. Without it, only the name went.
 */
export const ForwardedFile = z.object({
  name: z.string().min(1).max(4096),
  sourceId: z.uuid().optional(),
}).strict();
export type ForwardedFile = z.infer<typeof ForwardedFile>;

/**
 * The forward as the target chat keeps it on the turn's input: where it came from, who wrote it, the text, the files
 * it named, and the person's note. The turn's brief is `forwardBrief` of this, so every reader of a brief (the model,
 * the history, search) sees the forward; the chat draws this record instead of the brief.
 */
export const ForwardedMessage = z.object({
  fromTaskId: z.uuid(),
  messageId: z.uuid(),
  /** The chat's name when it was forwarded: the orglet's or crew's name, or the chat's title. */
  from: z.string().min(1).max(200),
  /** `person` is the one using Orglet; an orglet's answer carries its name. */
  authorKind: z.enum(['person', 'orglet']),
  author: z.string().min(1).max(200).optional(),
  text: z.string().min(1).max(FORWARD_TEXT_CHARS + 1),
  files: z.array(ForwardedFile).max(20),
  note: z.string().min(1).max(FORWARD_NOTE_CHARS).optional(),
}).strict();
export type ForwardedMessage = z.infer<typeof ForwardedMessage>;

export const ForwardMessageArgs = z.object({
  /** The chat the message is in, and the message: a turn's id (`turnMessageId`) or an answer's id. */
  taskId: z.uuid(),
  messageId: z.uuid(),
  targets: z.array(ForwardTarget).min(1).max(MAX_FORWARD_TARGETS),
  note: z.string().trim().max(FORWARD_NOTE_CHARS).optional(),
  /** Files of the message the person ticked to send along; every other file goes by name only. */
  carrySourceIds: z.array(z.uuid()).max(20).default([]),
}).strict();
export type ForwardMessageArgs = z.input<typeof ForwardMessageArgs>;

/** What became of each place: the chat it landed in, or why it did not go. */
export type ForwardResult = {
  sent: { target: ForwardTarget; taskId: string }[];
  failed: { target: ForwardTarget; name: string; error: string }[];
};

/** Forwarded text cut to `FORWARD_TEXT_CHARS`, with a visible mark when it was longer. */
export function forwardText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= FORWARD_TEXT_CHARS) return trimmed;
  return `${trimmed.slice(0, FORWARD_TEXT_CHARS)}…`;
}

function nameInBrief(name: string): string {
  if (name.length <= FILE_NAME_IN_BRIEF_CHARS) return name;
  return `${name.slice(0, FILE_NAME_IN_BRIEF_CHARS)}…`;
}

/**
 * The brief a forward's turn carries: the note first, as the person's own words, then the forwarded message as a
 * quote that says where it came from and who wrote it, then the files it named and which of them came along. It is
 * written for the model, like the other prompt text, and stays under the brief's 16 000 characters.
 */
export function forwardBrief(forwarded: ForwardedMessage): string {
  const writer = forwarded.authorKind === 'person' ? 'the person' : forwarded.author ?? 'an orglet';
  // Fenced rather than prefixed line by line, so a message of many short lines does not double in length.
  const parts = [
    forwarded.note ?? '',
    `Forwarded from the chat "${forwarded.from}", written by ${writer}:\n"""\n${forwarded.text}\n"""`,
  ];
  if (forwarded.files.length) {
    const names = forwarded.files.map(file => `${nameInBrief(file.name)} (${file.sourceId ? 'attached to this message' : 'not shared with this chat'})`);
    parts.push(`Files it named: ${names.join(', ')}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

/**
 * The words of a turn the person wrote themselves: a forward's note, or the whole brief. `@` tags are read from these
 * only, so a name tagged inside a forwarded message never changes who answers.
 */
export function ownWords(input: { brief: string; forwarded?: ForwardedMessage }): string {
  if (input.forwarded) return input.forwarded.note ?? '';
  return input.brief;
}
