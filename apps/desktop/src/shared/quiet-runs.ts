import { z } from 'zod';
import { DecisionModelConnection } from './decisions';
import type { ScheduleFrequency } from './schedule';
import type { RoutineTriggerKind } from './routine-triggers';

/**
 * The decision model's look at a quiet run (COD-303): how much the answer needs the person, from 0 (nothing new) to 1 (something
 * changed, failed or needs action), whether that cleared `NOTEWORTHY_THRESHOLD` so the run was announced, and when.
 * Kept on the run's chat.
 */
export const RunAttention = z.object({
  score: z.number().min(0).max(1),
  notified: z.boolean(),
  decidedAt: z.iso.datetime(),
  /** The backend of the person's list that gave the score. */
  answeredBy: DecisionModelConnection.optional(),
}).strict();
export type RunAttention = z.infer<typeof RunAttention>;

/**
 * A run is announced only above this. On 28 English and Vietnamese hourly-run answers the routine ones scored at most
 * 0.41 and the noteworthy ones at least 0.50, on the cases it was tuned on and on the held-out ones alike; this is the
 * middle of that gap (docs/decisions.md). Below it the run stays quiet, as it was before the decision model.
 */
export const NOTEWORTHY_THRESHOLD = 0.45;

/**
 * An hourly schedule's run that simply finished (COD-288): no toast, no notification. A run that holds changes for
 * review is announced anyway, so it is never quiet.
 */
export function isQuietScheduleRun(frequency: ScheduleFrequency | undefined, trigger: RoutineTriggerKind, heldForReview: boolean): boolean {
  if (heldForReview) return false;
  return frequency === 'hours' && trigger === 'schedule';
}
