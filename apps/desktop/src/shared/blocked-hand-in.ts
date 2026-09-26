import { z } from 'zod';
import { Report } from './contracts';
import { KnowledgeProposal } from './knowledge';
import { WorkspaceProcess } from './workspace-processes';

/*
 * A hand-in the failed-command rule refused (COD-189), kept so the person can decide (COD-270). The run fails as
 * before and its private copy stays `ready`; this record says which commands blocked it and, for a solo chat, what
 * the orglet answered, so the chat can show both and the person can apply the copy anyway, retry or ask for a fix.
 */

/** A command that started after the copy's last file change and did not exit 0; its process id reads its output. */
export const BlockingCommand = z.object({
  processId: z.uuid(),
  program: z.enum(['node', 'shell']),
  arguments: z.array(z.string().max(12000)).max(64),
  state: WorkspaceProcess.shape.state,
  exitCode: z.number().int().nullable(),
}).strict();
export type BlockingCommand = z.infer<typeof BlockingCommand>;

/** The answer exactly as it would have been saved, so applying it later adds only the lines saying what was accepted. */
export const HeldAnswer = z.object({
  report: Report,
  knowledgeProposals: z.array(KnowledgeProposal).max(3),
  title: z.string().max(120).nullable(),
  untrustedInputs: z.array(z.string().max(100)).max(20),
}).strict();
export type HeldAnswer = z.infer<typeof HeldAnswer>;

export const BlockedHandIn = z.object({
  commands: z.array(BlockingCommand).min(1).max(100),
  /** The copy's files when hand-in was refused; applying anyway refuses a copy that no longer matches what was shown. */
  copyFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  /** Only a solo chat's run keeps its answer to apply; a crew member or a group reply keeps the reason alone. */
  answer: HeldAnswer.optional(),
  /** When the person applied the copy anyway. */
  acceptedAt: z.iso.datetime().optional(),
}).strict();
export type BlockedHandIn = z.infer<typeof BlockedHandIn>;

/** The command as a person would type it: a shell line as written, a Node call with its arguments. */
export function commandLine(command: Pick<BlockingCommand, 'program' | 'arguments'>, maxLength = 300): string {
  const words = command.program === 'shell' ? command.arguments : [command.program, ...command.arguments];
  const line = words.join(' ').trim();
  const characters = [...line];
  if (characters.length <= maxLength) return line;
  return `${characters.slice(0, maxLength - 1).join('')}…`;
}
