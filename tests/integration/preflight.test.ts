import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Preflight } from '../../apps/desktop/src/core/orchestration/preflight';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { analyze } from '../../apps/desktop/src/profiler/analyze';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import type { Team, Task } from '../../apps/desktop/src/shared/contracts';
import type { ProfileExecutor } from '../../apps/desktop/src/shared/profiles';

let directory: string; let store: Store; let core: CoreService; let calls: number; let contexts: string[];
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'orglet-preflight-')); store = new Store(join(directory, 'state.sqlite')); calls = 0; contexts = []; });
afterEach(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
function service(executor: ProfileExecutor) {
  return new CoreService(store, () => {}, async () => ({ async request(messages) {
    calls++; contexts.push(JSON.stringify(messages));
    expect(store.all<{ status: string }>('preflights')[0].status).not.toBe('running');
    return { calls: [{ id: 'report', name: 'submit_report', arguments: JSON.stringify({ title: 'Review', summary: 'Fixture review', findings: [], limitations: Array.from({ length: 30 }, (_, i) => `Model limitation ${i}`) }) }], usage: { input: 100, output: 100 } };
  } }), executor);
}
async function idle(taskId: string) {
  for (let i = 0; i < 300 && core.teams.isActive(taskId); i++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(core.teams.isActive(taskId)).toBe(false);
}
async function setup(files: { name: string; content: string }[], idColumn: string | null = 'id', excludedSources: { name: string; reason: string }[] = []) {
  const paths = [];
  for (const file of files) { const path = join(directory, file.name); await writeFile(path, file.content); paths.push(path); }
  const sources = await core.sources.import(paths);
  const template = await core.command('createTemplate', { templateId: 'eris-review', provider: 'openai' }) as Team;
  expect(template.preflight).toEqual({ idColumn: null, compareTwo: true });
  const team = await core.command('saveTeam', { ...template, name: 'Generic configured review', preflight: { idColumn, compareTwo: true } }) as Team;
  const taskId = await core.command('createTask', { workerId: team.synthesizerId, teamId: team.id, sourceIds: sources.map(source => source.id), excludedSources, brief: 'Review selected evidence', consent: true, budgetMicros: 2_000_000 }) as string;
  return { taskId, sources, paths };
}
const pair = [{ name: 'left.csv', content: 'id,label\n1,a\n2,b\n2,c\n' }, { name: 'right.csv', content: 'id,label\n2,z\n1,y\n3,x\n' }];
it('runs configured checks before all roles and exports/restores checker provenance with a valid final report', async () => {
  let checks = 0; core = service(input => { checks++; expect(calls).toBe(0); return analyze(input); });
  const { taskId, sources } = await setup(pair, 'id', [{ name: 'private-excluded.env', reason: 'Hidden source omitted' }]); await idle(taskId);
  const detail = store.detail(taskId); expect(detail.task.status).toBe('waiting_input'); expect(calls).toBe(4); expect(checks).toBe(3);
  expect(detail.preflights[0].status).toBe('complete'); expect(detail.preflights[0].profileIds).toHaveLength(3);
  const comparison = detail.profiles.find(profile => profile.result.datasets.length === 2)!;
  expect(comparison.result.comparison).toMatchObject({ overlappingDistinctIds: 2, sameIdOrder: false });
  expect(comparison.result.datasets[0].id?.duplicateNonNull).toBe(1);
  expect(contexts.every(context => context.includes('preflightId') && context.includes(sources[0].hash))).toBe(true);
  expect(contexts.join(' ')).not.toContain('private-excluded.env');
  expect(detail.task.excludedSources).toHaveLength(1);
  const final = detail.artifacts.at(-1)!; expect(final.report.limitations.length).toBeGreaterThan(30);
  expect(final.report.limitations.join(' ')).toContain('1 mục đã bị loại');
  expect(core.exportMarkdown(final.id)).toContain('Trusted checker results'); expect(core.exportMarkdown(final.id)).toContain(sources[0].hash);
  const exported = core.backups.export(); const restored = new Store(':memory:');
  try { const backup = new Backups(restored, () => false, () => {}); backup.restore(backup.preview(exported).token); expect(restored.detail(taskId).preflights[0].profileIds).toHaveLength(3); expect(restored.detail(taskId).artifacts).toHaveLength(4); expect(restored.detail(taskId).task.status).toBe('waiting_input'); expect(restored.detail(taskId).task.evidenceRequests).toEqual(detail.task.evidenceRequests); }
  finally { restored.close(); }
});
it('records insufficient evidence for text-only intake without claiming dataset checks', async () => {
  core = service(async () => { throw new Error('No checker should run'); });
  const { taskId } = await setup([{ name: 'review.py', content: 'print("this must never execute")' }], null); await idle(taskId);
  expect(calls).toBe(4); const detail = store.detail(taskId);
  expect(detail.preflights[0].status).toBe('insufficient_evidence'); expect(detail.profiles).toHaveLength(0);
  expect(detail.artifacts.at(-1)!.report.limitations.join(' ')).toContain('Không chạy code');
});
it('retains explicit partial coverage when a checker cannot complete', async () => {
  core = service(async input => { if (input.files.length === 2 || Buffer.from(input.files[0].base64, 'base64').toString().includes('bad')) throw new Error('Fixture checker failed'); return analyze(input); });
  const { taskId } = await setup([pair[0], { name: 'bad.csv', content: 'id,label\n1,bad\n' }]); await idle(taskId);
  expect(calls).toBe(4); const detail = store.detail(taskId);
  expect(detail.preflights[0].status).toBe('partial'); expect(detail.profiles).toHaveLength(1);
  expect(detail.artifacts.at(-1)!.report.limitations.join(' ')).toContain('Không hoàn tất checker');
});
it('cancels preflight before any model dispatch', async () => {
  let started!: () => void; const entering = new Promise<void>(resolve => { started = resolve; });
  core = service(async (_input, signal) => { started(); await new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true })); throw new Error('unreachable'); });
  const { taskId } = await setup(pair); await entering; await core.command('cancel', { id: taskId }); await idle(taskId);
  expect(calls).toBe(0); expect(store.detail(taskId).task.status).toBe('cancelled'); expect(store.detail(taskId).preflights[0].status).toBe('cancelled');
});
it('resumes a paused preflight after restart without repeating committed checker results', async () => {
  let checks = 0;
  const executor: ProfileExecutor = async input => { checks++; if (checks === 1) await core.command('pause', { id: store.all<Task>('tasks')[0].id }); return analyze(input); };
  core = service(executor); const { taskId } = await setup(pair); await idle(taskId);
  expect(calls).toBe(0); expect(store.detail(taskId).preflights[0].status).toBe('paused'); expect(store.detail(taskId).profiles).toHaveLength(1);
  const retained = store.detail(taskId).profiles[0].id;
  store.close(); store = new Store(join(directory, 'state.sqlite')); core = service(executor);
  await core.command('resume', { id: taskId }); await idle(taskId);
  expect(checks).toBe(3); expect(calls).toBe(4); expect(store.detail(taskId).profiles.filter(profile => profile.id === retained)).toHaveLength(1);
});
it('blocks model dispatch if source bytes change while the checker is running', async () => {
  core = service(async input => { const result = await analyze(input); await writeFile(join(directory, 'left.csv'), 'id,label\n9,changed\n'); return result; });
  const { taskId } = await setup([pair[0]]); await idle(taskId);
  expect(calls).toBe(0); expect(store.detail(taskId).task.status).toBe('failed'); expect(store.detail(taskId).preflights[0].status).toBe('failed');
});
it('clears transient failure notices when an unfinished preflight succeeds on resume', async () => {
  let checks = 0;
  core = service(async input => {
    if (++checks === 1) { await core.command('pause', { id: store.all<Task>('tasks')[0].id }); throw new Error('Transient checker failure'); }
    return analyze(input);
  });
  const { taskId } = await setup(pair); await idle(taskId);
  expect(store.detail(taskId).preflights[0].notices.some(notice => notice.message.includes('Không hoàn tất checker'))).toBe(true);
  await core.command('resume', { id: taskId }); await idle(taskId);
  expect(store.detail(taskId).preflights[0].status).toBe('complete');
  expect(store.detail(taskId).preflights[0].notices.some(notice => notice.message.includes('Không hoàn tất checker'))).toBe(false);
});

it('retains separate checker scopes and only reuses matching sources and policy', async () => {
  core = service(input => analyze(input));
  const { taskId, sources } = await setup(pair); await idle(taskId);
  const task = store.get<Task>('tasks', taskId); const first = store.detail(taskId).preflights[0];
  const checker = new Preflight(store, core.sources, () => {}); const signal = new AbortController().signal;
  const reordered = await checker.run({ ...task, sourceIds: [...task.sourceIds].reverse() }, first.policy, signal, () => false);
  expect(reordered.id).toBe(first.id);
  const smaller = await checker.run({ ...task, sourceIds: [sources[0].id] }, { idColumn: null, compareTwo: false }, signal, () => false);
  expect(smaller.id).not.toBe(first.id); expect(smaller.profileIds).toHaveLength(1);
  const excluded = await checker.run({ ...task, sourceIds: [sources[0].id], excludedSources: [{ name: 'omitted', reason: 'Not selected' }] }, smaller.policy, signal, () => false);
  expect(excluded.id).not.toBe(smaller.id);
  expect(store.detail(taskId).preflights).toHaveLength(3);
  expect(store.detail(taskId).preflights[0]).toEqual(first);
  expect(() => core.backups.preview(core.backups.export())).not.toThrow();
});
it('migrates the v4 unique-task preflight table without altering retained records', async () => {
  core = service(input => analyze(input)); const { taskId } = await setup(pair); await idle(taskId);
  const retained = store.detail(taskId).preflights[0]; store.close();
  const legacy = new DatabaseSync(join(directory, 'state.sqlite'));
  legacy.exec('BEGIN; CREATE TABLE old_preflights (id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id), data TEXT NOT NULL); INSERT INTO old_preflights SELECT id,task_id,data FROM preflights; DROP TABLE preflights; ALTER TABLE old_preflights RENAME TO preflights; DELETE FROM migrations WHERE version=5; COMMIT;');
  legacy.close(); store = new Store(join(directory, 'state.sqlite'));
  expect(store.detail(taskId).preflights[0]).toEqual(retained);
  expect(store.db.prepare('SELECT MAX(version) AS version FROM migrations').get()!.version).toBe(6);
  store.put('preflights', { ...retained, id: crypto.randomUUID() }, { column: 'task_id', value: taskId });
  expect(store.detail(taskId).preflights).toHaveLength(2);
});

it('binds a source revision to fresh roles and preflight without changing historical source scope', async () => {
  core = service(input => analyze(input)); const { taskId, sources } = await setup(pair); await idle(taskId);
  const before = store.detail(taskId); const previousArtifacts = structuredClone(before.artifacts);
  const path = join(directory, 'revision.csv'); await writeFile(path, 'id,label\n9,new\n');
  const [added] = await core.sources.import([path]);
  await core.command('reviseTask', { taskId, brief: 'Review only the replacement evidence', sourceIds: [added.id], consent: true, providerScopes: ['openai'], budgetMicros: 2_000_000 });
  await idle(taskId); const after = store.detail(taskId);
  expect(after.task.sourceIds).toEqual([...sources.map(source => source.id), added.id]);
  expect(after.preflights).toHaveLength(2); expect(after.artifacts).toHaveLength(8);
  expect(after.artifacts.slice(0, 4)).toEqual(previousArtifacts);
  expect(after.runs.slice(4).every(run => run.snapshot.input?.sourceIds.length === 1 && run.snapshot.input.sourceIds[0] === added.id && run.snapshot.preflightId === after.preflights[1].id)).toBe(true);
  expect(core.exportMarkdown(previousArtifacts[0].id)).not.toContain(added.id);
  expect(() => core.backups.preview(core.backups.export())).not.toThrow();
});

