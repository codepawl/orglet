import { z } from 'zod';

/**
 * What the window knows about a terminal acting for the person (docs/cli-held-actions-design.md): the pairing code to
 * draw, the live mark, and the journal. The elevation key itself never appears here; main keeps only its hash.
 */

/** `decisions` answers what a chat is waiting on, `one` is bound to a single operation, `setup` is for grants and secrets. */
export const ElevationScope = z.enum(['decisions', 'one', 'setup']);
export type ElevationScope = z.infer<typeof ElevationScope>;

export type TerminalPairingView = {
  code: string;
  scope: ElevationScope;
  /** For a `one` scope: the operation in words, so the person reads it before typing anything. */
  operation?: string;
  expiresAt: string;
};

export type TerminalAccessState = {
  pairing?: TerminalPairingView;
  elevation?: { scope: ElevationScope; endsAt: string };
  /** Pairing is refused until then, after three pairings that ended without a match. */
  hold?: { until: string };
};

export const EMPTY_TERMINAL_ACCESS: TerminalAccessState = {};

export const TerminalJournalRow = z.object({
  id: z.string().min(1).max(64),
  at: z.iso.datetime(),
  scope: ElevationScope,
  /** The operation in words; never an argument that is a secret. */
  operation: z.string().min(1).max(300),
  subject: z.string().max(200).optional(),
  outcome: z.enum(['done', 'refused', 'failed']),
  detail: z.string().max(300).optional(),
  /** Whether Settings offers Undo for this row: a grant the core can take back, not yet undone. */
  undoable: z.boolean().optional(),
  undoneAt: z.iso.datetime().optional(),
}).strict();
export type TerminalJournalRow = z.infer<typeof TerminalJournalRow>;

/**
 * What Undo does for a grant the core can take back. A fixed list of shapes with ids only, checked again when Undo
 * runs, so a journal line cannot ask for any other command. Kept in the journal file, never sent to the window.
 */
export const TerminalUndo = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('revoke-folder'), taskId: z.uuid() }).strict(),
  z.object({ kind: z.literal('restore-tools'), taskId: z.uuid(), capabilities: z.array(z.string().min(1).max(40)).max(10) }).strict(),
  z.object({ kind: z.literal('restore-level'), taskId: z.uuid(), permissions: z.array(z.enum(['read', 'write', 'execute'])).min(1).max(3) }).strict(),
  z.object({ kind: z.literal('restore-mcp-enabled'), serverId: z.uuid(), enabled: z.boolean() }).strict(),
  z.object({ kind: z.literal('restore-mcp-grant'), taskId: z.uuid(), serverId: z.uuid(), tool: z.string().min(1).max(128).nullable(), allowed: z.boolean() }).strict(),
]);
export type TerminalUndo = z.infer<typeof TerminalUndo>;

/** What is kept in the file: the row plus how to undo it. The window only ever gets the row. */
export const StoredJournalRow = TerminalJournalRow.extend({ undo: TerminalUndo.optional() }).strict();
export type StoredJournalRow = z.infer<typeof StoredJournalRow>;

/** A grant or a secret that just happened, for the window's notification list. */
export type TerminalNotice = { id: string; operation: string; subject?: string };
