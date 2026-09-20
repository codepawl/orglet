import { z } from 'zod';

const ReferenceIds = z.array(z.string().uuid()).max(200);
export const ReviewPolicy = z.object({
  requiredChecks: z.array(z.object({ name: z.string().trim().min(1).max(200), checker: z.enum(['none', 'run_audit', 'pair_alignment', 'exact_match_accuracy']) }).strict()).min(1).max(20).refine(checks => new Set(checks.map(check => check.name.toLowerCase())).size === checks.length, 'Required checks must be unique'),
}).strict();
export type ReviewPolicy = z.infer<typeof ReviewPolicy>;
export const EvidenceRequest = z.object({
  id: z.string().uuid(), artifactId: z.string().uuid(),
  checks: z.array(z.string().min(1).max(200)).min(1).max(50),
  state: z.enum(['pending', 'acknowledged']),
  createdAt: z.iso.datetime(),
}).strict();
export type EvidenceRequest = z.infer<typeof EvidenceRequest>;
export const Review = z.object({
  checks: z.array(z.object({
    name: z.string().min(1).max(200),
    status: z.enum(['pass', 'fail', 'not_assessed']),
    coverage: z.string().min(1).max(2000),
    sourceIds: z.array(z.string().uuid()).max(20),
    checkerIds: z.array(z.string().uuid()).max(20),
    processIds: z.array(z.string().uuid()).max(20).optional(),
  }).strict()).max(50),
  recommendation: z.enum(['ready_for_human_review', 'revision_required', 'rerun_required', 'insufficient_evidence']),
  draftFeedback: z.string().min(1).max(8000),
  upstreamFindingIds: ReferenceIds,
  conflicts: z.array(z.object({ findingIds: ReferenceIds.min(2), reason: z.string().min(1).max(2000) }).strict()).max(50),
}).strict();
export type Review = z.infer<typeof Review>;
