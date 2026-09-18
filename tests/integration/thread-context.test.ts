import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { compactThread, ContextRefuseError, fitThread, promptBytes, threadMessages } from '../../apps/desktop/src/core/context/thread';
import type { Artifact, Run, Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';
import type { ModelReply } from '../../apps/desktop/src/core/adapters/openai';

let directory: string; let store: Store; let core: CoreService;
let replies: ModelReply[]; let sent: { messages: unknown[] }[]; let dispatches: number;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orglet-thread-'));
  store = new Store(join(directory, 'test.sqlite')); replies = []; sent = []; dispatches = 0;
  core = new CoreService(store, () => {}, async () => ({
    async request(messages) {
      dispatches++;
      sent.push({ messages: structuredClone(messages) });
      const reply = replies.shift(); if (!reply) throw new Error('Fixture exhausted'); return reply;
    },
  }));
});
afterEach(async () => { await core.runner.shutdown(); store.close(); await rm(directory, { recursive: true, force: true }); });

const answer = (message: string): ModelReply => ({ calls: [{ id: id(), name: 'reply', arguments: JSON.stringify({ message, knowledgeProposals: [] }) }], usage: { input: 20, output: 10 } });
const until = async (check: () => boolean) => { for (let tries = 0; tries < 400 && !check(); tries++) await new Promise(resolve => setTimeout(resolve, 10)); expect(check()).toBe(true); };
const payload = (index: number) => (sent[index].messages as { content?: string }[]).map(message => String(message.content ?? '')).join('\n');

function seedTurns(briefs: string[], extra?: { otherBrief?: string }) {
  const worker = store.all<Worker>('workers')[0];
  const skill = store.all<Skill>('skills')[0];
  const task: Task = { id: id(), workerId: worker.id, brief: briefs[0] ?? 'Hi', status: 'completed', budgetMicros: 100_000, sourceIds: [], consent: true, accepted: false, createdAt: now(), inputRevision: briefs.length - 1 };
  store.put('tasks', task);
  for (const [revision, brief] of briefs.entries()) {
    const run: Run = { id: id(), taskId: task.id, status: 'completed', error: null, startedAt: now(), snapshot: { worker, skill, input: { brief, sourceIds: [] }, inputRevision: revision } };
    store.put('runs', run, { column: 'task_id', value: task.id });
    const artifact: Artifact = { id: id(), runId: run.id, report: { format: 'chat', title: 'Reply', summary: `Reply ${revision} ${brief}`, findings: [], limitations: [] }, hash: 'a'.repeat(64), createdAt: now() };
    store.put('artifacts', artifact, { column: 'run_id', value: run.id });
  }
  if (extra?.otherBrief) {
    const other: Task = { id: id(), workerId: worker.id, brief: extra.otherBrief, status: 'completed', budgetMicros: 100_000, sourceIds: [], consent: true, accepted: false, createdAt: now() };
    store.put('tasks', other);
    const run: Run = { id: id(), taskId: other.id, status: 'completed', error: null, startedAt: now(), snapshot: { worker, skill, input: { brief: extra.otherBrief, sourceIds: [] }, inputRevision: 0 } };
    store.put('runs', run, { column: 'task_id', value: other.id });
    store.put('artifacts', { id: id(), runId: run.id, report: { format: 'chat', title: 'Other', summary: extra.otherBrief, findings: [], limitations: [] }, hash: 'b'.repeat(64), createdAt: now() }, { column: 'run_id', value: run.id });
  }
  const current: Run = { id: id(), taskId: task.id, status: 'queued', error: null, startedAt: now(), snapshot: { worker, skill, input: { brief: 'Scoring follow-up', sourceIds: [] }, inputRevision: briefs.length } };
  store.put('runs', current, { column: 'task_id', value: task.id });
  return { task, current };
}

it('summarizes the 11th older turn instead of inlining it', () => {
  const briefs = ['ALPHAUNIQUE first scoring note', ...Array.from({ length: 10 }, (_, index) => `Later turn ${index + 1} padding`)];
  const { task, current } = seedTurns(briefs);
  const compacted = compactThread(store.detail(task.id), current, 'Scoring follow-up');
  expect(compacted.verbatim.some(turn => turn.text.includes('ALPHAUNIQUE'))).toBe(false);
  expect(compacted.summary).toContain('ALPHAUNIQUE');
  expect(compacted.omitted.some(item => item.reason === 'summarized')).toBe(true);
  expect(compacted.snippets.some(item => item.text.includes('ALPHAUNIQUE'))).toBe(true);
  const earlier = JSON.parse(threadMessages(compacted).find(message => message.content.includes('earlierConversation'))!.content).earlierConversation as { text: string }[];
  expect(earlier.some(turn => turn.text.includes('ALPHAUNIQUE'))).toBe(false);
});

it('retrieves older notes from this thread only', () => {
  const briefs = ['SCORINGLEAKAGEWORD in this thread only', ...Array.from({ length: 10 }, (_, index) => `Later turn ${index + 1}`)];
  const { task, current } = seedTurns(briefs, { otherBrief: 'OTHERTHREADSECRET scoring leakage from a different chat' });
  const compacted = compactThread(store.detail(task.id), current, 'Need the scoring leakage word');
  const blob = JSON.stringify(compacted);
  expect(blob).toContain('SCORINGLEAKAGEWORD');
  expect(blob).not.toContain('OTHERTHREADSECRET');
});

it('folds extra verbatim turns then refuses when the prompt still cannot fit, without a model call', () => {
  const briefs = ['ALPHAUNIQUE first scoring note', ...Array.from({ length: 10 }, (_, index) => `Later turn ${index + 1} ${'padding '.repeat(40)}`)];
  const { task, current } = seedTurns(briefs);
  const assemble = (compacted: ReturnType<typeof compactThread>) => threadMessages(compacted);
  const detail = store.detail(task.id);
  const unfolded = compactThread(detail, current, 'Scoring follow-up');
  const foldedAway = compactThread(detail, current, 'Scoring follow-up', unfolded.foldable.length);
  const high = promptBytes(assemble(unfolded), []);
  const low = promptBytes(assemble(foldedAway), []);
  expect(high).toBeGreaterThan(low);
  const fitted = fitThread(detail, current, 'Scoring follow-up', assemble, [], Math.floor((high + low) / 2));
  expect(fitted.foldable.length).toBeLessThan(unfolded.foldable.length);
  expect(() => fitThread(detail, current, 'Scoring follow-up', assemble, [], Math.max(1, low - 1))).toThrow(ContextRefuseError);
  expect(promptBytes([{ content: 'x'.repeat(300_000) }], [])).toBeGreaterThan(200_000);
});

it('sends compacted layers on a live follow-up and keeps other threads out of the prompt', async () => {
  const worker = store.all<Worker>('workers')[0];
  await core.command('saveWorker', { ...worker, provider: 'openai' });
  const scope = { sourceIds: [], consent: true, providerScopes: ['openai' as const], budgetMicros: 100_000 };
  replies.push(answer('First ALPHAUNIQUE scoring note.'));
  const taskId = await core.command('createTask', { workerId: worker.id, brief: 'ALPHAUNIQUE first scoring note', ...scope }) as string;
  await until(() => store.detail(taskId).task.status === 'completed');
  for (let turn = 1; turn <= 10; turn++) {
    replies.push(answer(`Later ${turn}`));
    await core.command('reviseTask', { taskId, brief: `Later turn ${turn} padding`, ...scope });
    await until(() => store.detail(taskId).runs.filter(run => !run.stage).length === turn + 1 && store.detail(taskId).task.status === 'completed');
  }
  replies.push(answer('Follow-up.'));
  await core.command('reviseTask', { taskId, brief: 'Scoring follow-up about the first note', ...scope });
  await until(() => store.detail(taskId).runs.length === 12 && store.detail(taskId).task.status === 'completed');
  const last = payload(sent.length - 1);
  expect(last).toContain('threadSummary');
  expect(last).toContain('ALPHAUNIQUE');
  const earlier = JSON.parse((sent.at(-1)!.messages as { content?: string }[]).map(message => String(message.content ?? '')).find(content => content.includes('earlierConversation'))!).earlierConversation as { text: string }[];
  expect(earlier.some(turn => turn.text.includes('ALPHAUNIQUE'))).toBe(false);
  const run = store.detail(taskId).runs.at(-1)!;
  expect(run.snapshot.context?.manifest.verbatimTurns).toBeGreaterThan(0);
  expect(run.snapshot.context?.manifest.summaryChars).toBeGreaterThan(0);
  expect(run.snapshot.context?.manifest.loaded.some(item => item.kind === 'summary')).toBe(true);
  expect(store.db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE run_id=?').get(run.id)!.n).toBeGreaterThan(0);

  const other = await core.command('createTask', { workerId: worker.id, brief: 'OTHERTHREADSECRET unrelated', ...scope }) as string;
  replies.push(answer('Other.'));
  await until(() => store.detail(other).task.status === 'completed');
  expect(payload(sent.length - 1)).not.toContain('ALPHAUNIQUE');
});
