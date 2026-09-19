import { z } from 'zod';

const Uuid = z.string().uuid();
export const KnowledgeScope = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workspace') }).strict(),
  z.object({ type: z.literal('team'), id: Uuid }).strict(),
  z.object({ type: z.literal('worker'), id: Uuid }).strict(),
]);
export type KnowledgeScope = z.infer<typeof KnowledgeScope>;
const Tag = z.string().trim().toLowerCase().min(1).max(40);
const Tags = z.array(Tag).max(10).transform(tags => [...new Set(tags)]);
export const KnowledgeInput = z.object({
  id: Uuid.optional(),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(8000),
  tags: Tags,
  pinned: z.boolean(),
  scope: KnowledgeScope,
}).strict();
export type KnowledgeInput = z.infer<typeof KnowledgeInput>;
export const KnowledgeProvenance = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user') }).strict(),
  z.object({ kind: z.literal('run'), taskId: Uuid, runId: Uuid, artifactId: Uuid }).strict(),
  z.object({ kind: z.literal('template') }).strict(),
]);
export const Knowledge = KnowledgeInput.extend({
  id: Uuid,
  revision: z.number().int().positive(),
  status: z.enum(['proposed', 'approved', 'archived']),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  provenance: KnowledgeProvenance,
  createdAt: z.iso.datetime(),
}).strict();
export type Knowledge = z.infer<typeof Knowledge>;
// Model-facing shape: every property required so strict tool schemas accept it.
export const KnowledgeProposal = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(2000),
  tags: z.array(z.string().min(1).max(40)).max(5),
}).strict();

export const ContextManifest = z.object({
  bytes: z.number().int().nonnegative(),
  loaded: z.array(z.object({ kind: z.enum(['platform', 'identity', 'team', 'worker', 'skill', 'knowledge', 'summary', 'memory']), id: Uuid.optional(), revision: z.number().int().positive().optional(), hash: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative() }).strict()).max(40),
  omitted: z.array(z.object({ kind: z.enum(['team', 'worker', 'skill', 'knowledge', 'turn']), id: Uuid.optional(), revision: z.number().int().positive(), reason: z.enum(['duplicate', 'context_limit', 'not_relevant', 'summarized', 'truncated']) }).strict()).max(600),
  verbatimTurns: z.number().int().nonnegative().optional(),
  summaryChars: z.number().int().nonnegative().optional(),
  retrievedSnippets: z.number().int().nonnegative().optional(),
}).strict();
export type ContextManifest = z.infer<typeof ContextManifest>;
export const RunContext = z.object({
  knowledge: z.array(Knowledge.pick({ id: true, revision: true, title: true, content: true, tags: true, hash: true, scope: true, pinned: true })).max(40),
  manifest: ContextManifest,
}).strict();
export type RunContext = z.infer<typeof RunContext>;
