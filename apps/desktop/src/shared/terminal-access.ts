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
}).strict();
export type TerminalJournalRow = z.infer<typeof TerminalJournalRow>;
