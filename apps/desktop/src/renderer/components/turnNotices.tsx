import type { ReactNode } from 'react';

/**
 * Everything that can be attached to one worker turn besides the answer itself. Each slot is optional; a missing
 * one takes no space. The slots arrive as elements because their components take the turn's own props (trace
 * entries, bridge callbacks, reactions); the ordering below is the one thing this module owns.
 */
export type TurnNoticeSlots = {
  /** The one folded trace above the answer (COD-220, `WorkLog`): memories used and notes loaded as one folded row, then the steps. */
  trace?: ReactNode;
  /** The answer is what the orglet had when its steps ran out, with Continue on the latest turn (COD-257). */
  outOfSteps?: ReactNode;
  /** The answer is a Plan first plan, with Follow the plan on the latest turn (COD-367). */
  plan?: ReactNode;
  /** Why the changes did not reach the folder: one line per command that failed after the last edit (COD-270). */
  handIn?: ReactNode[];
  /** One line per run that changed files in its working copy (COD-163). */
  changes?: ReactNode[];
  /** The app-change and self-improvement cards (COD-199, COD-162). */
  proposals?: ReactNode;
};

/**
 * The rule (COD-217, user: "notices should be sequential; memories used belongs before the answer, because memory
 * is loaded first and the response comes after"): a turn's notices read in the order they happened.
 *
 * Before the answer, what was loaded or decided before writing, as one trace control (COD-220) whose rows are in
 * that order themselves: the memories used, the notes loaded, then the steps the run took. Then the answer. After
 * it, what came out of the answer: that it was cut short by the step limit (COD-257), that it is a Plan first plan (COD-367), why its changes were held back (COD-270), the files it changed, and the app changes it
 * proposed (self-improvements included). The message's toolbar is not a notice: it floats on the message (COD-365). A future notice goes into the slot
 * matching when it happened, never straight into JSX.
 *
 * `before` and `after` are already wrapped in their groups, so a caller renders `{before}{answer}{after}`.
 */
export function turnNotices(slots: TurnNoticeSlots): { before: ReactNode; after: ReactNode } {
  const before = [slots.trace ?? null].filter(Boolean);
  const handIn = slots.handIn ?? [];
  const changes = slots.changes ?? [];
  const after = [slots.outOfSteps ?? null, slots.plan ?? null, ...handIn, ...changes, slots.proposals ?? null].filter(Boolean);
  return {
    before: before.length > 0 ? <div className="turn-before">{before}</div> : null,
    after: after.length > 0 ? <div className="turn-after">{after}</div> : null,
  };
}
