import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { harnessPrompt } from '../../apps/desktop/src/core/orchestration/runner';
import { withoutSourceIds } from '../../apps/desktop/src/shared/source-mentions';
import type { Artifact, Run, Skill, Task, Worker } from '../../apps/desktop/src/shared/contracts';

const metrics = { id: '49843085-f660-488f-b573-68cbc32126e9', name: 'metrics.csv' };
const notes = { id: '0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0', name: 'notes $1.md' };

/**
 * COD-257: a Codex reply to a chat with metrics.csv attached ended with "Source: metrics.csv (49843085-…)". The
 * prompt told the model to cite sources by sourceId, and it did so in the message the person reads.
 */
describe('source ids in an answer', () => {
  it('drops the id in brackets after the file\'s own name, however it was written', () => {
    expect(withoutSourceIds(`Source: metrics.csv (${metrics.id})`, [metrics])).toBe('Source: metrics.csv');
    expect(withoutSourceIds(`From \`metrics.csv\` (\`${metrics.id}\`), the mean is 4.`, [metrics])).toBe('From `metrics.csv`, the mean is 4.');
    expect(withoutSourceIds(`**metrics.csv** (sourceId: ${metrics.id.toUpperCase()})`, [metrics])).toBe('**metrics.csv**');
    expect(withoutSourceIds(`metrics.csv [id=${metrics.id}]`, [metrics])).toBe('metrics.csv');
  });

  it('names the file where the id stands on its own, and keeps a "$" in the name as written', () => {
    expect(withoutSourceIds(`According to ${metrics.id}, rows went up.`, [metrics])).toBe('According to metrics.csv, rows went up.');
    expect(withoutSourceIds(`See (${notes.id}).`, [metrics, notes])).toBe('See (notes $1.md).');
  });

  it('leaves every other id and any answer without sources alone', () => {
    const other = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    expect(withoutSourceIds(`Run ${other} finished; metrics.csv (${other})`, [metrics])).toBe(`Run ${other} finished; metrics.csv (${other})`);
    expect(withoutSourceIds(`Source: metrics.csv (${metrics.id})`, [])).toBe(`Source: metrics.csv (${metrics.id})`);
  });

  it('tells a harness to cite by sourceId only in a report, and to name files by name in the message', () => {
    const prompt = harnessPrompt([], [{ sourceId: metrics.id, name: metrics.name, file: 'sources/01-metrics.csv', format: 'csv' }], undefined, false, true);
    expect(prompt).not.toContain('Cite sources only by the sourceId values');
    expect(prompt).toContain('In a report, cite sources only by the sourceId values');
    expect(prompt).toContain('name a file by its name and never write its sourceId');
  });
});

describe('an exported answer', () => {
  let directory: string;
  let store: Store;
  let core: CoreService;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-source-mentions-'));
    store = new Store(join(directory, 'test.sqlite'));
    core = new CoreService(store, () => {}, async () => ({ async request() { throw new Error('No model in this test.'); } }));
  });
  afterEach(async () => {
    await core.runner.shutdown();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('reads the way the chat shows it: the file by its name, not its id', async () => {
    const file = join(directory, 'metrics.csv');
    await writeFile(file, 'day,rows\n1,4\n');
    const [source] = await core.sources.import([file]);
    const worker = store.all<Worker>('workers')[0];
    const skill = store.get<Skill>('skills', worker.skillId);
    const task: Task = { id: id(), workerId: worker.id, brief: 'Summarise', sourceIds: [source.id], consent: true,
      budgetMicros: 100_000, accepted: false, status: 'completed', createdAt: now() };
    const run: Run = { id: id(), taskId: task.id, status: 'completed', snapshot: { worker, skill, inputRevision: 0,
      input: { brief: task.brief, sourceIds: [source.id] } }, startedAt: now(), error: null };
    const report = { format: 'chat' as const, title: 'Summary', summary: `Rows went up.\n\nSource: metrics.csv (${source.id})`, findings: [], limitations: [] };
    const artifact: Artifact = { id: id(), runId: run.id, report,
      hash: createHash('sha256').update(JSON.stringify(report)).digest('hex'), createdAt: now() };
    store.put('tasks', task);
    store.put('runs', run, { column: 'task_id', value: task.id });
    store.put('artifacts', artifact, { column: 'run_id', value: run.id });
    expect(core.exportMarkdown(artifact.id)).toBe('Rows went up.\n\nSource: metrics.csv');
  });
});
