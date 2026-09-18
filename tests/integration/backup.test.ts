import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import { BudgetLedger } from '../../apps/desktop/src/core/budgets/ledger';
import { CoreService } from '../../apps/desktop/src/core/service';
import type { Run, Task, Worker, Skill, Source } from '../../apps/desktop/src/shared/contracts';

const stores: Store[] = [];
const create = () => { const store = new Store(':memory:'); stores.push(store); return store; };
const backups = (store: Store, busy = () => false) => new Backups(store, busy, () => {});
afterEach(() => { for (const store of stores.splice(0)) store.close(); });
function fixture(store: Store) {
  const worker = store.all<Worker>('workers')[0]; const skill = store.all<Skill>('skills')[0];
  const source: Source = { id: id(), name: 'evidence.txt', bytes: 10, hash: 'a'.repeat(64), revoked: false };
  store.put('sources', source, { column: 'path', value: 'C:\\private\\never-export.txt' });
  const task: Task = { id: id(), workerId: worker.id, brief: 'Restore history', status: 'running', sourceIds: [source.id], consent: true, providerScopes: ['openai'], accepted: false, budgetMicros: 100_000, createdAt: now() };
  const run: Run = { id: id(), taskId: task.id, status: 'running', snapshot: { worker, skill }, startedAt: now(), error: null };
  store.put('tasks', task); store.put('runs', run, { column: 'task_id', value: task.id });
  store.event(run.id, 'Fixture event');
  const ledger = new BudgetLedger(store);
  const reservation = ledger.reserve(run.id, task.id, 'openai', 1000, 100_000, 5_000_000);
  return { task, run, source, ledger, reservation };
}
const resign = (text: string, mutate: (payload: any) => void) => {
  const envelope = JSON.parse(text); mutate(envelope.payload);
  envelope.checksum = createHash('sha256').update(JSON.stringify(envelope.payload)).digest('hex');
  return JSON.stringify(envelope);
};

describe('workspace backup and additive restore', () => {
  it('freezes newly restored legacy runs before merging an expanded task source history', () => {
    const store = create(); const f = fixture(store); const manager = backups(store);
    const missingRun = { ...f.run, id: id() };
    store.put('runs', missingRun, { column: 'task_id', value: f.task.id });
    const legacy = manager.export();
    store.db.prepare('DELETE FROM runs WHERE id=?').run(missingRun.id);
    const input = { brief: f.task.brief, sourceIds: f.task.sourceIds };
    store.update('runs', { ...f.run, snapshot: { ...f.run.snapshot, input } });
    const added = { ...f.source, id: id(), name: 'later.txt' };
    store.put('sources', added, { column: 'path', value: '' });
    store.update('tasks', { ...f.task, sourceIds: [...f.task.sourceIds, added.id], inputRevision: 1, currentInput: { brief: 'Later', sourceIds: [added.id] } });
    manager.restore(manager.preview(legacy).token);
    expect(store.get<Run>('runs', missingRun.id).snapshot.input).toEqual(input);
    expect(store.get<Run>('runs', missingRun.id).snapshot.inputRevision).toBe(0);
    expect(store.get<Task>('tasks', f.task.id).sourceIds).toHaveLength(2);
  });
  it('merges legacy backups after input backfill without weakening snapshot conflicts', () => {
    const store = create(); const f = fixture(store); const manager = backups(store); const legacy = manager.export();
    const input = { brief: f.task.brief, sourceIds: f.task.sourceIds };
    const backfilled = { ...f.run, snapshot: { ...f.run.snapshot, input, inputRevision: 0 } };
    store.update('runs', backfilled);
    const added = { ...f.source, id: id(), name: 'supplement.txt' };
    store.put('sources', added, { column: 'path', value: '' });
    store.update('tasks', { ...f.task, inputRevision: 1, currentInput: { brief: 'New request', sourceIds: [added.id] }, sourceIds: [...f.task.sourceIds, added.id] });
    manager.restore(manager.preview(legacy).token);
    expect(store.get<Run>('runs', f.run.id).snapshot).toEqual(backfilled.snapshot);
    expect(store.get<Task>('tasks', f.task.id).currentInput?.sourceIds).toEqual([added.id]);
    for (const mutate of [
      (payload: any) => { payload.tasks[0].brief = 'Changed original request'; },
      (payload: any) => { payload.tasks[0].sourceIds = []; },
      (payload: any) => { payload.runs[0].snapshot.worker.name = 'Changed worker'; },
      (payload: any) => { payload.runs[0].snapshot.inputRevision = 1; },
    ]) expect(() => manager.restore(manager.preview(resign(legacy, mutate)).token)).toThrow('xung đột');
    expect(store.get<Run>('runs', f.run.id).snapshot).toEqual(backfilled.snapshot);
  });
  it('rejects cyclic, duplicate and cross-task joins even with valid checksums', () => {
    const store = create(); const f = fixture(store);
    const report = { title: 'Saved report', summary: 'Fixture', findings: [], limitations: [] };
    const hash = createHash('sha256').update(JSON.stringify(report)).digest('hex');
    const first = { id: id(), runId: f.run.id, report, hash, createdAt: now() };
    const secondRun = { ...f.run, id: id(), snapshot: { ...f.run.snapshot, upstreamArtifactIds: [first.id] } };
    const second = { ...first, id: id(), runId: secondRun.id };
    store.put('artifacts', first, { column: 'run_id', value: first.runId });
    store.put('runs', secondRun, { column: 'task_id', value: f.task.id });
    store.put('artifacts', second, { column: 'run_id', value: second.runId });
    const manager = backups(store); const text = manager.export();
    expect(() => manager.preview(text)).not.toThrow();
    expect(() => manager.preview(resign(text, payload => { payload.runs[0].snapshot.upstreamArtifactIds = [second.id]; }))).toThrow('vòng lặp');
    expect(() => manager.preview(resign(text, payload => { payload.runs[1].snapshot.upstreamArtifactIds = [first.id, first.id]; }))).toThrow('trùng');
    expect(() => manager.preview(resign(text, payload => {
      const otherTask = { ...payload.tasks[0], id: id() }; payload.tasks.push(otherTask);
      payload.runs[1].taskId = otherTask.id;
    }))).toThrow('ngoài task');
    expect(store.all('tasks')).toHaveLength(1);
  });
  it('restores history without source paths, consent, or automatic replay', () => {
    const original = create(); const f = fixture(original); const text = backups(original).export();
    expect(text).not.toContain('never-export');
    const restored = create(); restored.setSetting('theme', 'dark'); const manager = backups(restored);
    manager.restore(manager.preview(text).token);
    expect(restored.detail(f.task.id).task).toMatchObject({ status: 'interrupted', consent: false, providerScopes: [] });
    expect(restored.detail(f.task.id).runs[0].status).toBe('interrupted');
    expect(restored.get<Source>('sources', f.source.id).revoked).toBe(true);
    expect(restored.db.prepare('SELECT path FROM sources WHERE id=?').get(f.source.id)?.path).toBe('');
    expect(restored.usage()).toEqual({ reservedMicros: 1000, chargedMicros: 0, uncertainCount: 1, inputTokens: 0, outputTokens: 0 });
    expect(restored.setting('theme', '')).toBe('dark');
    expect(restored.db.prepare('SELECT id FROM task_search WHERE task_search MATCH ?').all('Restore')).toHaveLength(1);
    manager.restore(manager.preview(text).token);
    expect(restored.all('tasks')).toHaveLength(1); expect(restored.all('events')).toHaveLength(1);
  });
  it('keeps newer settled costs, current tasks and source permissions when importing an older backup', () => {
    const store = create(); const f = fixture(store); const manager = backups(store); const older = manager.export();
    f.ledger.settle(f.reservation, 100, 100); const usage = store.usage();
    store.update('tasks', { ...f.task, status: 'completed', accepted: true });
    manager.restore(manager.preview(older).token);
    expect(store.usage()).toEqual(usage); expect(store.detail(f.task.id).task.accepted).toBe(true);
    expect(store.get<Source>('sources', f.source.id).revoked).toBe(false);
  });
  it('rejects checksum errors, unsupported versions and dangling references before writing', () => {
    const store = create(); fixture(store); const manager = backups(store); const text = manager.export();
    expect(() => manager.preview(text.replace('Restore history', 'Changed history'))).toThrow('Checksum');
    expect(() => manager.preview(text.replace('"version":1', '"version":99'))).toThrow();
    expect(() => manager.preview(resign(text, payload => { payload.tasks[0].sourceIds = [id()]; }))).toThrow('nguồn');
    expect(store.all('tasks')).toHaveLength(1);
  });
  it('rejects an immutable event conflict atomically, including otherwise new records', () => {
    const store = create(); fixture(store); const manager = backups(store); const text = manager.export();
    const edited = resign(text, payload => { payload.events[0].message = 'Overwritten'; payload.sources.push({ ...payload.sources[0], id: id() }); });
    const preview = manager.preview(edited);
    expect(() => manager.restore(preview.token)).toThrow('xung đột');
    expect(store.all('sources')).toHaveLength(1);
    expect(store.all<{ message: string }>('events')[0].message).toBe('Fixture event');
  });
  it('prevents restore during active work and consumes successful preview tokens', () => {
    const store = create(); fixture(store); let busy = true; const manager = backups(store, () => busy);
    const preview = manager.preview(manager.export());
    expect(() => manager.restore(preview.token)).toThrow('đang chạy');
    busy = false; manager.restore(preview.token);
    expect(() => manager.restore(preview.token)).toThrow('hết hạn');
  });
  it('allows editing after importing a newer revision while keeping current worker content', async () => {
    const original = create(); const worker = original.all<Worker>('workers')[0];
    const originalBackup = backups(original).export();
    original.version('workers', { ...worker, revision: 2, name: 'Newer imported revision' });
    const target = create(); const manager = backups(target);
    manager.restore(manager.preview(originalBackup).token);
    manager.restore(manager.preview(backups(original).export()).token);
    expect(target.get<Worker>('workers', worker.id).name).toBe(worker.name);
    const core = new CoreService(target, () => {}, async () => { throw new Error('No paid requests'); });
    const saved = await core.command('saveWorker', { ...worker, name: 'Local edit after restore' }) as Worker;
    expect(saved.revision).toBe(3);
  });
});
