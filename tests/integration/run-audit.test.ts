import { expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { auditRuns } from '../../apps/desktop/src/profiler/run-audit';
import { analyze } from '../../apps/desktop/src/profiler/analyze';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { Worker, Skill, Task, Run } from '../../apps/desktop/src/shared/contracts';

const sourceId = id();
const row = (solution: string, run: string, split: string, score: unknown, status = 'completed') => ({ solution, run, split, score, status, metric: 'fixture' });
it('separates rerun dispersion from solution differences and excludes failed scores without replacing them with zero', () => {
  const result = auditRuns([row('A', '1', 'private', '0.45'), row('A', '2', 'private', 0.45), { ...row('A', '3', 'private', 0, 'failed'), error_code: 'timeout' }, row('B', '1', 'private', 0.9), row('B', '2', 'private', 0.9)], sourceId, 'higher');
  expect(result.status).toBe('needs_review'); expect(result.failed).toBe(1); expect(result.ignoredFailureScores).toBe(1);
  expect(result.groups[0]).toMatchObject({ completed: 2, mean: 0.45, sampleStdDev: 0, failed: 1 });
  expect(result.groups[1].sampleStdDev).toBe(0); expect(result.failures).toEqual([{ code: 'timeout', count: 1 }]);
  expect(result.ranks).toBeNull();
  const completedZero = auditRuns([row('A', '1', 'private', 0.45), row('A', '2', 'private', 0.45), row('A', '3', 'private', 0)], sourceId, 'higher');
  expect(completedZero.failed).toBe(0); expect(completedZero.groups[0].sampleStdDev).toBeCloseTo(0.2598076211);
});
it('marks too few completed reruns as insufficient and retains failure/cancellation counts', () => {
  const result = auditRuns([row('A', '1', 'private', 1), row('A', '2', 'private', null, 'cancelled'), row('B', '1', 'private', null, 'failed')], sourceId, 'lower');
  expect(result.status).toBe('insufficient_evidence'); expect(result.groups.map(group => group.sampleStdDev)).toEqual([null, null]);
  expect(result.groups[1].mean).toBeNull(); expect(result.completed).toBe(1); expect(result.cancelled).toBe(1);
});
it('computes public 15 to private 1 as a fourteen-place improvement without an automatic pass or failure claim', () => {
  const rows = Array.from({ length: 15 }, (_, i) => [row(`s${i}`, '1', 'public', 15 - i), row(`s${i}`, '1', 'private', i)]).flat();
  const result = auditRuns(rows, sourceId, 'higher');
  expect(result.ranks?.find(item => item.solution === 's14')).toEqual({ solution: 's14', publicRank: 15, privateRank: 1, improvement: 14 });
  expect(result.status).toBe('insufficient_evidence'); expect(result.notices.join(' ')).toContain('không tự chứng minh');
});
it('uses competition ranks for ties and explicit lower-is-better direction', () => {
  const rows = [row('A', '1', 'public', 1), row('B', '1', 'public', 1), row('C', '1', 'public', 2), row('A', '1', 'private', 3), row('B', '1', 'private', 2), row('C', '1', 'private', 1)];
  const result = auditRuns(rows, sourceId, 'lower');
  expect(result.ranks?.map(item => item.publicRank)).toEqual([1, 1, 3]);
  expect(result.ranks?.find(item => item.solution === 'C')?.improvement).toBe(2);
  expect(auditRuns(rows.slice(0, -1), sourceId, 'lower').ranks).toBeNull();
});
it('rejects ambiguous identities, mixed metrics, malformed scores, missing schema and row limits', () => {
  const first = row('A', '1', 'private', 1);
  expect(() => auditRuns([first, first], sourceId, 'higher')).toThrow('Trùng');
  expect(() => auditRuns([first, { ...row('A', '2', 'private', 1), metric: 'different' }], sourceId, 'higher')).toThrow('metric');
  for (const score of [null, 'NaN', 'Infinity', '0x10', true, {}, '1e200']) expect(() => auditRuns([{ ...first, score }], sourceId, 'higher')).toThrow();
  expect(() => auditRuns([{ score: 1 }], sourceId, 'higher')).toThrow('solution');
  expect(() => auditRuns([], sourceId, 'higher')).toThrow('10.000');
  expect(() => auditRuns(Array(10001).fill(first), sourceId, 'higher')).toThrow('10.000');
});
it('runs the actual DuckDB parser on structured CSV and JSONL and refuses wrong columns', async () => {
  const csv = 'solution,run,split,metric,status,score,error_code\nA,1,private,accuracy,completed,0.45,\nA,2,private,accuracy,completed,0.45,\nA,3,private,accuracy,failed,0,timeout\n';
  const result = await analyze({ files: [{ sourceId, format: 'csv', base64: Buffer.from(csv).toString('base64') }], idColumn: null, runAudit: { direction: 'higher' } });
  expect(result.runAudit?.groups[0]).toMatchObject({ mean: 0.45, sampleStdDev: 0 }); expect(result.runAudit?.failed).toBe(1);
  const jsonl = [row('A', '1', 'test', 1), row('A', '2', 'test', 3)].map(value => JSON.stringify(value)).join('\n');
  const jsonResult = await analyze({ files: [{ sourceId, format: 'jsonl', base64: Buffer.from(jsonl).toString('base64') }], idColumn: null, runAudit: { direction: 'lower' } });
  expect(jsonResult.runAudit?.groups[0].sampleStdDev).toBeCloseTo(Math.sqrt(2));
  await expect(analyze({ files: [{ sourceId, format: 'csv', base64: Buffer.from('id,score\n1,3\n').toString('base64') }], idColumn: null, runAudit: { direction: 'higher' } })).rejects.toThrow('solution');
});
it('persists source-hashed audit results through core and backup while enforcing source permissions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orglet-run-audit-')); const path = join(directory, 'runs.csv');
  await writeFile(path, 'solution,run,split,metric,status,score\nA,1,test,accuracy,completed,1\nA,2,test,accuracy,completed,1\n');
  const store = new Store(':memory:'); const restored = new Store(':memory:');
  const noProvider = async () => { throw new Error('No provider allowed'); };
  try {
    const core = new CoreService(store, () => {}, noProvider, input => analyze(input));
    const [source] = await core.sources.import([path]); const worker = store.all<Worker>('workers')[0];
    const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Audit fixture', sourceIds: [source.id], consent: false, budgetMicros: 1000 }) as string;
    await new Promise(resolve => setTimeout(resolve, 350));
    await core.command('auditRunLog', { taskId, sourceId: source.id, direction: 'higher' });
    expect(store.detail(taskId).profiles[0].sourceHashes[source.id]).toBe(source.hash);
    const receiver = new CoreService(restored, () => {}, noProvider, input => analyze(input)); const preview = receiver.backups.preview(core.backups.export()); receiver.backups.restore(preview.token);
    expect(restored.detail(taskId).profiles[0].result.runAudit?.groups[0].sampleStdDev).toBe(0);
    await expect(receiver.command('auditRunLog', { taskId, sourceId: source.id, direction: 'higher' })).rejects.toThrow('thu hồi');
    await core.command('revoke', { id: source.id });
    await expect(core.command('auditRunLog', { taskId, sourceId: source.id, direction: 'higher' })).rejects.toThrow('thu hồi');
  } finally { store.close(); restored.close(); }
});

it('executes the trusted model tool and retains its checker provenance in the exported report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orglet-run-tool-')); const path = join(directory, 'runs.csv');
  await writeFile(path, 'solution,run,split,metric,status,score\nA,1,test,accuracy,completed,1\nA,2,test,accuracy,completed,1\n');
  const store = new Store(':memory:'); let calls = 0; let selectedId = '';
  try {
    const core = new CoreService(store, () => {}, async () => ({ async request(messages) {
      calls++;
      if (calls === 2) expect(JSON.stringify(messages)).toContain('orglet-run-audit-v1');
      const args = calls === 1 ? { sourceId: selectedId, direction: 'higher' } : { title: 'Run observations', summary: 'Two supplied scores match.', findings: [{ title: 'Observed scores', severity: 'info', detail: 'Two completed observations.', sourceIds: [selectedId], coverage: 'Supplied run log only' }], limitations: ['No code rerun'] };
      return { usage: { input: 100, output: 100 }, calls: [{ id: id(), name: calls === 1 ? 'audit_run_log' : 'submit_report', arguments: JSON.stringify(args) }] };
    } }), input => analyze(input));
    const [source] = await core.sources.import([path]); selectedId = source.id;
    const worker = { ...store.all<Worker>('workers')[0], provider: 'openai' as const }; const skill = store.get<Skill>('skills', worker.skillId);
    const task: Task = { id: id(), workerId: worker.id, brief: 'Audit supplied runs, higher scores are better', sourceIds: [source.id], consent: true, status: 'queued', budgetMicros: 100000, accepted: false, createdAt: now() };
    const run: Run = { id: id(), taskId: task.id, snapshot: { worker, skill }, status: 'queued', startedAt: now(), error: null };
    store.put('tasks', task); store.put('runs', run, { column: 'task_id', value: task.id });
    await core.runner.run(task, run);
    const detail = store.detail(task.id); expect(detail.task.status).toBe('completed'); expect(calls).toBe(2);
    expect(detail.profiles[0].runId).toBe(run.id); expect(core.exportMarkdown(detail.artifacts[0].id)).toContain('orglet-run-audit-v1');
  } finally { store.close(); }
});
