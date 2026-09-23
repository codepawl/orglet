import { z } from 'zod';

const Uuid = z.string().uuid();
export const KnowledgeScope = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workspace') }).strict(),
  z.object({ type: z.literal('team'), id: Uuid }).strict(),
  z.object({ type: z.literal('worker'), id: Uuid }).strict(),
]);
export type KnowledgeScope = z.infer<typeof KnowledgeScope>;
/**
 * Two kinds of row share the knowledge store (COD-161). A `note` is reusable guidance the person wrote or reviewed.
 * A `memory` is something a worker remembered from a chat: how this person writes, which files they mean, what was
 * decided, what not to do again. Rows saved before the distinction existed have no kind and are notes.
 */
export const KnowledgeKind = z.enum(['note', 'memory']);
export type KnowledgeKind = z.infer<typeof KnowledgeKind>;
export const isMemory = (item: { kind?: KnowledgeKind }) => item.kind === 'memory';
const Tag = z.string().trim().toLowerCase().min(1).max(40);
const Tags = z.array(Tag).max(10).transform(tags => [...new Set(tags)]);
export const KnowledgeInput = z.object({
  id: Uuid.optional(),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(8000),
  tags: Tags,
  pinned: z.boolean(),
  scope: KnowledgeScope,
  kind: KnowledgeKind.optional(),
}).strict();
export type KnowledgeInput = z.infer<typeof KnowledgeInput>;
export const KnowledgeProvenance = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user') }).strict(),
  // workerId names who suggested it; items saved before it existed fall back to the chat's worker or crew lead.
  z.object({ kind: z.literal('run'), taskId: Uuid, runId: Uuid, artifactId: Uuid, workerId: Uuid.optional() }).strict(),
  z.object({ kind: z.literal('template') }).strict(),
  // A memory: the chat and the user message the worker was answering when it remembered this (COD-161).
  z.object({ kind: z.literal('turn'), taskId: Uuid, runId: Uuid, messageId: z.string().min(1).max(120), workerId: Uuid }).strict(),
]);
export type KnowledgeProvenance = z.infer<typeof KnowledgeProvenance>;
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

/** One memory is a short line, the way a colleague jots one down; longer text belongs in a note. */
export const MEMORY_TEXT_LIMIT = 500;
/** Active memories kept per scope; past this the oldest unpinned one is archived, never deleted. */
export const MEMORY_CAP = 60;
/** How much remembered text one run receives, in characters, newest and pinned first. */
export const MEMORY_CHAR_BUDGET = 6_000;
export const MEMORY_ITEM_LIMIT = 30;
/** Memories one harness answer may carry (the tool loop remembers one per call instead). */
export const MAX_ANSWER_MEMORIES = 5;
export const MemoryScopeName = z.enum(['worker', 'team', 'workspace']);
export type MemoryScopeName = z.infer<typeof MemoryScopeName>;
/** The `remember` tool as the model sees it: every field required so strict function schemas accept it. */
export const RememberModelArgs = z.object({ text: z.string().min(1).max(MEMORY_TEXT_LIMIT), scope: MemoryScopeName }).strict();
/** The lenient read of a remember call: the scope may be left out and means this worker. */
export const RememberArgs = z.object({ text: z.string().trim().min(1).max(MEMORY_TEXT_LIMIT), scope: MemoryScopeName.optional() }).strict();
export type RememberArgs = z.infer<typeof RememberArgs>;
export const AnswerMemories = z.array(RememberModelArgs).max(MAX_ANSWER_MEMORIES);

export const ContextManifest = z.object({
  bytes: z.number().int().nonnegative(),
  // `memory` is a snippet retrieved from this chat's older turns; `remembered` is a memory row from the knowledge store.
  loaded: z.array(z.object({ kind: z.enum(['platform', 'identity', 'team', 'worker', 'skill', 'knowledge', 'summary', 'memory', 'remembered']), id: Uuid.optional(), revision: z.number().int().positive().optional(), hash: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative() }).strict()).max(80),
  omitted: z.array(z.object({ kind: z.enum(['team', 'worker', 'skill', 'knowledge', 'turn', 'remembered']), id: Uuid.optional(), revision: z.number().int().positive(), reason: z.enum(['duplicate', 'context_limit', 'not_relevant', 'summarized', 'truncated']) }).strict()).max(600),
  verbatimTurns: z.number().int().nonnegative().optional(),
  summaryChars: z.number().int().nonnegative().optional(),
  retrievedSnippets: z.number().int().nonnegative().optional(),
}).strict();
export type ContextManifest = z.infer<typeof ContextManifest>;
/** A memory as one run received it, frozen with the run so a later edit never changes what a finished answer knew. */
export const RunMemory = z.object({ id: Uuid, revision: z.number().int().positive(), text: z.string().min(1).max(MEMORY_TEXT_LIMIT), scope: KnowledgeScope, pinned: z.boolean(), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type RunMemory = z.infer<typeof RunMemory>;
export const RunContext = z.object({
  knowledge: z.array(Knowledge.pick({ id: true, revision: true, title: true, content: true, tags: true, hash: true, scope: true, pinned: true })).max(40),
  // Runs frozen before COD-161 have no memories at all, which is different from an empty list.
  memories: z.array(RunMemory).max(MEMORY_ITEM_LIMIT).optional(),
  manifest: ContextManifest,
}).strict();
export type RunContext = z.infer<typeof RunContext>;
