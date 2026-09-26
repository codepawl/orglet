import { z } from 'zod';
import { WorkspacePath } from './workspace-tools';

/*
 * A run's changes held for the person to review before they reach the folder (COD-279). With the chat's
 * `workspace.apply` permission off, which is the default, a solo run's hand-in stops once the plan is made: the answer
 * is saved as usual, the private copy stays `ready`, and this record says what became of the changes. Only the
 * person's Apply or Discard settles it; no tool offers either to a model.
 */

export const WorkspaceReviewState = z.enum([
  /** Waiting for the person. */
  'pending',
  /** Applied through the same hash-checked broker as any hand-in, all of it or the files the person picked. */
  'applied',
  /** Dropped: nothing reached the folder. */
  'discarded',
  /** A later run in the same chat went on working in this copy, so its own review covers these changes too. */
  'carried',
]);
export type WorkspaceReviewState = z.infer<typeof WorkspaceReviewState>;

export const WorkspaceReview = z.object({
  state: WorkspaceReviewState,
  heldAt: z.iso.datetime(),
  /** The copy's files when the run held them; applying refuses a copy that no longer matches what the person saw. */
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  decidedAt: z.iso.datetime().optional(),
  /** For `applied`: hand-in steps applied, and steps the person left out by unticking their files. */
  applied: z.number().int().nonnegative().optional(),
  skipped: z.number().int().nonnegative().optional(),
}).strict();
export type WorkspaceReview = z.infer<typeof WorkspaceReview>;

/** A limit well above the diff's own file cap, so a list the viewer drew always fits. */
const MAX_REVIEW_PATHS = 10_000;

/**
 * The person applies a held copy. `paths` names the files and folders they left ticked in the diff viewer (a moved
 * file by either of its paths); without it every change is applied.
 */
export const ApplyWorkspaceReview = z.object({
  taskId: z.uuid(),
  runId: z.uuid(),
  paths: z.array(WorkspacePath.refine(Boolean)).min(1).max(MAX_REVIEW_PATHS).optional(),
}).strict();
export type ApplyWorkspaceReview = z.infer<typeof ApplyWorkspaceReview>;

export const DiscardWorkspaceReview = z.object({ taskId: z.uuid(), runId: z.uuid() }).strict();
export type DiscardWorkspaceReview = z.infer<typeof DiscardWorkspaceReview>;
