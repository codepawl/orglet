import type { ReactNode } from 'react';
import { Brain } from 'lucide-react';
import { t } from '../i18n';

/** A memory the run was given, as the artifact froze it (COD-161) or as the run's snapshot carries it while streaming. */
export type NoticedMemory = { id: string; text: string };

/**
 * Everything that can be attached to one worker turn besides the answer itself. Each slot is optional; a missing
 * one takes no space. `activity`, `proposals` and `actions` arrive as elements because their components take the
 * turn's own props (steps, bridge callbacks, reactions); the ordering below is the one thing this module owns.
 */
export type TurnNoticeSlots = {
  /** The memories the answer was written with. */
  memories?: readonly NoticedMemory[];
  /** The folded step line: the saved steps of a finished run, or the live group with the timer and the notes. */
  activity?: ReactNode;
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
 * Before the answer, what was loaded or decided before writing: the memories used, then the steps the run took
 * (the folded "Đọc 2 tệp" line, which also names the sources it read). Then the answer. After it, what came out
 * of the answer: the files it changed, the app changes it proposed (self-improvements included), and last the
 * message actions row. A future notice goes into the slot matching when it happened, never straight into JSX.
 *
 * `before` and `after` are already wrapped in their groups, so a caller renders `{before}{answer}{after}`.
 */
export function turnNotices(slots: TurnNoticeSlots): { before: ReactNode; after: ReactNode } {
  const memories = slots.memories && slots.memories.length > 0 ? <UsedMemories key="memories" memories={slots.memories} /> : null;
  const before = [memories, slots.activity ?? null].filter(Boolean);
  const changes = slots.changes ?? [];
  const after = [...changes, slots.proposals ?? null, slots.actions ?? null].filter(Boolean);
  return {
    before: before.length > 0 ? <div className="turn-before">{before}</div> : null,
    after: after.length > 0 ? <div className="turn-after">{after}</div> : null,
  };
}

/** Which memories an answer was written with (COD-161): one small line that opens the list, the way sources are named. */
export function UsedMemories({ memories }: { memories: readonly NoticedMemory[] }) {
  if (!memories.length) return null;
  return <details className="used-memories">
    <summary><Brain size={13} aria-hidden="true" />{t('Đã dùng {0} ghi nhớ', [memories.length])}</summary>
    <ul>{memories.map(memory => <li key={memory.id}>{memory.text}</li>)}</ul>
  </details>;
}
