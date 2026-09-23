import { z } from 'zod';

/**
 * A worker gets better at its job from the feedback it already receives (COD-162). The signals are rows the app
 * already stores: a reply asking for a revision of an answer, a thumbs-down on an answer, a report the citation,
 * checker or line-range gates refused, and the same failure twice. When one kind repeats, the worker's next chat run
 * sees the evidence and may propose one sentence for its own instructions. That proposal is an app-change card like
 * any other, except that it always waits for a click; nothing here changes a worker on its own.
 */
export const ImprovementSignalKind = z.enum(['revision', 'thumbs_down', 'report_rejected', 'run_failed']);
export type ImprovementSignalKind = z.infer<typeof ImprovementSignalKind>;
export const improvementSignalKinds = ImprovementSignalKind.options;

/** How many of the worker's latest runs are looked at, and how many signals of one kind it takes to say something. */
export const IMPROVEMENT_WINDOW_RUNS = 20;
export const IMPROVEMENT_THRESHOLD = 2;
const EXAMPLE_LIMIT = 5;
const NOTE_LIMIT = 240;

/** One chat the signal came from and how often, so the card can say "because of: <chat> ×2" and open it. */
export const ImprovementCause = z.object({ taskId: z.uuid(), title: z.string().max(120), count: z.number().int().positive() }).strict();
export type ImprovementCause = z.infer<typeof ImprovementCause>;
/** What the worker is shown for one signal: the chat and, in a few words, what went wrong there. */
export const ImprovementExample = z.object({ taskId: z.uuid(), note: z.string().max(NOTE_LIMIT) }).strict();
export type ImprovementExample = z.infer<typeof ImprovementExample>;
export const ImprovementSignal = z.object({
  kind: ImprovementSignalKind,
  count: z.number().int().positive(),
  because: z.array(ImprovementCause).max(IMPROVEMENT_WINDOW_RUNS),
  examples: z.array(ImprovementExample).max(EXAMPLE_LIMIT),
}).strict();
export type ImprovementSignal = z.infer<typeof ImprovementSignal>;
/** The signals a run froze when it started; kept on the run snapshot like its context, so a resume sees the same. */
export const ImprovementSignals = z.array(ImprovementSignal).max(improvementSignalKinds.length);

/**
 * The one tool: a single sentence for the worker's own instructions, and which signal it answers. `replaces` quotes
 * one existing sentence to change, or is null to add the new one at the end. There is no target and no other
 * field: another worker, a skill, a tool grant, the model, the provider or a budget cannot be reached from here.
 */
export const SENTENCE_LIMIT = 400;
export const ProposeSelfImprovement = z.object({
  signal: ImprovementSignalKind,
  replaces: z.string().trim().min(1).max(1000).nullable(),
  sentence: z.string().trim().min(1).max(SENTENCE_LIMIT),
}).strict();
export type ProposeSelfImprovement = z.infer<typeof ProposeSelfImprovement>;

/** What a stored proposal keeps of the signal it answers, so the card can show the evidence after the run is gone. */
export const ProposalImprovement = z.object({ signal: ImprovementSignalKind, because: z.array(ImprovementCause).max(IMPROVEMENT_WINDOW_RUNS) }).strict();
export type ProposalImprovement = z.infer<typeof ProposalImprovement>;

/** The kinds a worker's person declined, keyed by worker id; a declined kind is never proposed to that worker again. */
export const DeclinedImprovements = z.record(z.uuid(), z.array(ImprovementSignalKind).max(improvementSignalKinds.length));
export type DeclinedImprovements = z.infer<typeof DeclinedImprovements>;
export const DECLINED_IMPROVEMENTS_SETTING = 'selfImprovementDeclined';

/** One line of text for a note: whitespace folded and cut at the limit. */
export function improvementNote(text: string): string {
  const folded = text.replace(/\s+/g, ' ').trim();
  if (folded.length <= NOTE_LIMIT) return folded;
  return `${folded.slice(0, NOTE_LIMIT - 1)}…`;
}
