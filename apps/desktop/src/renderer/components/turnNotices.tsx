import type { ReactNode } from 'react';

/**
 * Everything that can be attached to one worker turn besides the answer itself. Each slot is optional; a missing
 * one takes no space. The slots arrive as elements because their components take the turn's own props (trace
 * entries, bridge callbacks, reactions); the ordering below is the one thing this module owns.
 */
export type TurnNoticeSlots = {
  /** The one folded trace above the answer (COD-220, `TurnTrace`): memories used, notes loaded, then the steps. */
  trace?: ReactNode;
  /** One line per run that changed files in its working copy (COD-163). */
  changes?: ReactNode[];
  /** The app-change and self-improvement cards (COD-199, COD-162). */
  proposals?: ReactNode;
  /** Copy, download, reply and react (COD-160): always the last thing under a message. */
  actions?: ReactNode;
};

/**
 * The rule (COD-217, user: "notices should be sequential; memories used belongs before the answer, because memory
 * is loaded first and the response comes after"): a turn's notices read in the order they happened.
 *
 * Before the answer, what was loaded or decided before writing, as one trace control (COD-220) whose rows are in
 * that order themselves: the memories used, the notes loaded, then the steps the run took. Then the answer. After
 * it, what came out of the answer: the files it changed, the app changes it proposed (self-improvements included),
 * and last the message actions row. A future notice goes into the slot matching when it happened, never straight
 * into JSX.
 *
 * `before` and `after` are already wrapped in their groups, so a caller renders `{before}{answer}{after}`.
 */
export function turnNotices(slots: TurnNoticeSlots): { before: ReactNode; after: ReactNode } {
  const before = [slots.trace ?? null].filter(Boolean);
  const changes = slots.changes ?? [];
  const after = [...changes, slots.proposals ?? null, slots.actions ?? null].filter(Boolean);
  return {
    before: before.length > 0 ? <div className="turn-before">{before}</div> : null,
    after: after.length > 0 ? <div className="turn-after">{after}</div> : null,
  };
}
