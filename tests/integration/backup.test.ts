import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, id, now } from '../../apps/desktop/src/core/storage/database';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import { ChatSearch } from '../../apps/desktop/src/core/storage/chat-search';
import { BudgetLedger } from '../../apps/desktop/src/core/budgets/ledger';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Report, type Run, type Task, type Worker, type Skill, type Source } from '../../apps/desktop/src/shared/contracts';

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
  it('exports and restores a run whose hand-in a failed command blocked', () => {
    const original = create();
    const fixtureData = fixture(original);
    const blockedHandIn = {
      commands: [{ processId: crypto.randomUUID(), program: 'shell' as const, arguments: ['npm test'], state: 'exited' as const, exitCode: 1 }],
      copyFingerprint: 'c'.repeat(64),
    };
    original.update('runs', { ...fixtureData.run, status: 'failed', error: 'npm test exited with 1.', errorCode: 'hand_in_blocked', blockedHandIn });
    const text = backups(original).export();
    const restored = create();
    const manager = backups(restored);
    manager.restore(manager.preview(text).token);
    expect(restored.get<Run>('runs', fixtureData.run.id)).toMatchObject({ errorCode: 'hand_in_blocked', blockedHandIn });
  });

  it('keeps cited workspace read metadata without local paths or contents, and marks restored grants unavailable', () => {
    const original = create();
    const fixtureData = fixture(original);
    const grantId = id();
    const run = { ...fixtureData.run, status: 'completed' as const,
      snapshot: { ...fixtureData.run.snapshot, workspaceGrant: { id: grantId, taskId: fixtureData.task.id,
        revision: 1, permissions: ['read'] as const } } };
    original.update('runs', run);
    const evidence = { id: id(), runId: run.id, callId: id(), path: 'src/app.ts', hash: 'b'.repeat(64),
      grantId, grantRevision: 1 };
    original.db.prepare('INSERT INTO workspace_read_evidence(id,run_id,call_id,data) VALUES(?,?,?,?)')
      .run(evidence.id, evidence.runId, evidence.callId, JSON.stringify(evidence));
    const report = Report.parse({ title: 'Workspace review', summary: 'Observed file', limitations: [], findings: [{
      title: 'Mismatch', severity: 'warning', detail: 'One mismatch', coverage: 'src/app.ts', sourceIds: [],
      workspaceEvidenceIds: [evidence.id],
    }] });
    original.put('artifacts', { id: id(), runId: run.id, report,
      hash: createHash('sha256').update(JSON.stringify(report)).digest('hex'), createdAt: now() }, { column: 'run_id', value: run.id });
    const text = backups(original).export();
    expect(text).toContain('src/app.ts');
    expect(text).not.toContain('private\\never-export');
    const restored = create();
    const manager = backups(restored);
    manager.restore(manager.preview(text).token);
    expect(restored.detail(fixtureData.task.id).workspaceEvidence).toMatchObject([{ ...evidence, grantCurrent: false }]);
    expect(() => manager.preview(resign(text, payload => { payload.workspaceEvidence[0].grantRevision = 2; }))).toThrow('không khớp');
    expect(() => manager.preview(resign(text, payload => { payload.artifacts[0].report.findings[0].workspaceEvidenceIds = [id()];
      payload.artifacts[0].hash = createHash('sha256').update(JSON.stringify(payload.artifacts[0].report)).digest('hex'); }))).toThrow('ngoài lượt');
  });
  it('keeps scoped command evidence without exporting command text or output', () => {
    const original = create(); const f = fixture(original);
    const run = { ...f.run, stage: 'member' as const, status: 'completed' as const, snapshot: { ...f.run.snapshot,
      workspaceGrant: { id: id(), taskId: f.task.id, revision: 1, permissions: ['read', 'write', 'execute'] as const } } };
    original.update('runs', run);
    const processId = id();
    const report = { title: 'Syntax check', summary: 'Checked app.js', findings: [], limitations: [],
      review: { checks: [{ name: 'JavaScript syntax', status: 'pass', coverage: 'node --check app.js exited 0', sourceIds: [], checkerIds: [], processIds: [processId] }],
        recommendation: 'ready_for_human_review', draftFeedback: 'Syntax check passed.', upstreamFindingIds: [], conflicts: [] } };
    original.db.prepare('INSERT INTO process_evidence(id,run_id,exit_code) VALUES(?,?,?)').run(processId, run.id, 0);
    original.put('artifacts', { id: id(), runId: run.id, report,
      hash: createHash('sha256').update(JSON.stringify(report)).digest('hex'), createdAt: now() }, { column: 'run_id', value: run.id });
    const text = backups(original).export();
    expect(text).not.toContain('private\\never-export');
    expect(text).not.toContain('stdout');
    const restored = create(); const manager = backups(restored);
    manager.restore(manager.preview(text).token);
    expect(restored.detail(f.task.id).artifacts[0].report.review?.checks[0].processIds).toEqual([processId]);
    expect(() => manager.preview(resign(text, payload => { payload.processEvidence[0].exitCode = 1; }))).toThrow('không khớp');
  });
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
    expect(new ChatSearch(restored).search('Restore').chats.map(hit => hit.taskId)).toEqual([f.task.id]);
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

describe('restoring after deleting chats, and onto a new computer (COD-281)', () => {
  const cores: CoreService[] = [];
  const directories: string[] = [];
  afterEach(async () => {
    for (const core of cores.splice(0)) await core.runner.shutdown();
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
  });
  const coreFor = (store: Store) => {
    const core = new CoreService(store, () => {}, async () => { throw new Error('No paid requests'); });
    cores.push(core);
    return core;
  };
  const restoreInto = (store: Store, text: string) => {
    const manager = backups(store);
    manager.restore(manager.preview(text).token);
  };
  const reportOf = (title: string) => {
    const report = { title, summary: 'Answer', findings: [], limitations: [] };
    return { report, hash: createHash('sha256').update(JSON.stringify(report)).digest('hex') };
  };
  /** A finished chat whose one turn cost money and answered, and a free chat that never made a request. */
  function paidAndFreeChats(store: Store) {
    const paid = fixture(store);
    const input = { brief: paid.task.brief, sourceIds: paid.task.sourceIds };
    store.update('tasks', { ...paid.task, status: 'completed' });
    store.update('runs', { ...paid.run, status: 'completed', snapshot: { ...paid.run.snapshot, input, inputRevision: 0 } });
    paid.ledger.settle(paid.reservation, 100, 100);
    const answer = reportOf('Paid answer');
    store.put('artifacts', { id: id(), runId: paid.run.id, ...answer, createdAt: now() }, { column: 'run_id', value: paid.run.id });
    const worker = store.all<Worker>('workers')[0];
    const free: Task = { id: id(), workerId: worker.id, brief: 'Free chat', status: 'completed', sourceIds: [], consent: false, accepted: false, budgetMicros: 100_000, createdAt: now() };
    store.put('tasks', free);
    return { paid, free };
  }
  const liveBriefs = (store: Store) => store.workspace().tasks.map(task => task.brief).sort();
  const countOf = (store: Store, table: string) => Number(store.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count);

  it('brings the chats back after Delete chat history, with their answers, and counts their cost once', async () => {
    const store = create(); const core = coreFor(store);
    const { paid, free } = paidAndFreeChats(store);
    const text = backups(store).export();
    const usage = store.usage();
    const reservationCount = countOf(store, 'reservations');
    await core.command('eraseData', { scope: 'chats' });
    expect(liveBriefs(store)).toEqual([]);
    expect(store.get<Task>('tasks', paid.task.id).deletedAt).toBeDefined();

    restoreInto(store, text);
    expect(liveBriefs(store)).toEqual(['Free chat', 'Restore history']);
    const detail = store.detail(paid.task.id);
    expect(detail.task.deletedAt).toBeUndefined();
    expect(detail.runs[0].snapshot.input?.brief).toBe('Restore history');
    expect(detail.artifacts.map(artifact => artifact.report.title)).toEqual(['Paid answer']);
    expect(detail.events.map(event => event.message)).toEqual(['Fixture event']);
    expect(store.detail(free.id).task.brief).toBe('Free chat');
    expect(store.usage()).toEqual(usage);
    expect(countOf(store, 'reservations')).toBe(reservationCount);
    expect(new ChatSearch(store).search('Restore').chats.map(hit => hit.taskId)).toEqual([paid.task.id]);

    restoreInto(store, text);
    expect(liveBriefs(store)).toEqual(['Free chat', 'Restore history']);
    expect(store.usage()).toEqual(usage);
  });

  it('keeps the turns written after the backup as deleted when it brings a chat back', async () => {
    const store = create(); const core = coreFor(store);
    const { paid } = paidAndFreeChats(store);
    const text = backups(store).export();
    const laterInput = { brief: 'A later question', sourceIds: paid.task.sourceIds };
    store.update('tasks', { ...store.get<Task>('tasks', paid.task.id), inputRevision: 1, currentInput: laterInput });
    const laterRun: Run = { ...paid.run, id: id(), status: 'completed', snapshot: { ...paid.run.snapshot, input: laterInput, inputRevision: 1 } };
    store.put('runs', laterRun, { column: 'task_id', value: paid.task.id });
    const laterReservation = paid.ledger.reserve(laterRun.id, paid.task.id, 'openai', 1000, 100_000, 5_000_000);
    paid.ledger.settle(laterReservation, 50, 50);
    const usage = store.usage();
    await core.command('eraseData', { scope: 'chats' });

    restoreInto(store, text);
    const detail = store.detail(paid.task.id);
    expect(detail.task).toMatchObject({ brief: 'Restore history', inputRevision: 1, currentInput: { brief: '(đã xóa)' } });
    expect(detail.task.deletedAt).toBeUndefined();
    expect(detail.runs.map(run => run.snapshot.input?.brief)).toEqual(['Restore history', '(đã xóa)']);
    expect(store.usage()).toEqual(usage);
    expect(() => backups(store).preview(backups(store).export())).not.toThrow();
  });

  it('refuses a backup whose run differs from the deleted one, even for a deleted chat', async () => {
    const store = create(); const core = coreFor(store);
    const { paid } = paidAndFreeChats(store);
    const text = backups(store).export();
    await core.command('eraseData', { scope: 'chats' });
    const changed = resign(text, payload => { payload.runs[0].snapshot.worker.name = 'Someone else'; });
    const manager = backups(store);
    expect(() => manager.restore(manager.preview(changed).token)).toThrow('xung đột');
    expect(store.get<Task>('tasks', paid.task.id).deletedAt).toBeDefined();
  });

  it('replaces the untouched Researcher of a new computer instead of adding a second one', () => {
    const original = create(); paidAndFreeChats(original);
    const originalWorker = original.all<Worker>('workers')[0];
    const text = backups(original).export();
    const fresh = create();
    restoreInto(fresh, text);
    expect(fresh.workspace().workers.map(worker => worker.id)).toEqual([originalWorker.id]);
    expect(fresh.all<Skill>('skills').map(skill => skill.id)).toEqual([originalWorker.skillId]);
    expect(countOf(fresh, 'revisions')).toBe(countOf(original, 'revisions'));
  });

  it('keeps a Researcher the person already used on the new computer', () => {
    const original = create(); paidAndFreeChats(original);
    const text = backups(original).export();
    const used = create(); const localWorker = used.all<Worker>('workers')[0];
    used.put('tasks', { id: id(), workerId: localWorker.id, brief: 'Local chat', status: 'completed', sourceIds: [], consent: false, accepted: false, budgetMicros: 100_000, createdAt: now() } satisfies Task);
    restoreInto(used, text);
    expect(used.workspace().workers).toHaveLength(2);
  });

  it('keeps orglets deleted or archived when the backup was saved that way', async () => {
    const original = create(); const core = coreFor(original);
    paidAndFreeChats(original);
    const skillId = original.all<Skill>('skills')[0].id;
    const helper = await core.command('saveWorker', { name: 'Temp helper', instructions: 'Help.', provider: 'demo', skillId }) as Worker;
    const resting = await core.command('saveWorker', { name: 'Resting', instructions: 'Rest.', provider: 'demo', skillId }) as Worker;
    await core.command('deleteEntity', { kind: 'worker', id: helper.id });
    await core.command('archiveEntity', { kind: 'worker', id: resting.id, archived: true });
    const text = backups(original).export();

    const fresh = create();
    restoreInto(fresh, text);
    const workspace = fresh.workspace();
    expect(workspace.workers.map(worker => worker.name)).toEqual(['Researcher']);
    expect(workspace.archivedWorkers.map(worker => worker.name)).toEqual(['Resting']);
    expect(fresh.entityState().workers[helper.id]?.deletedAt).toBeDefined();
  });

  it('lets the person point a restored attachment at the same file, and only the same file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orglet-restore-'));
    directories.push(directory);
    const original = create(); const originalCore = coreFor(original);
    const path = join(directory, 'budget.csv');
    await writeFile(path, 'item,amount\nads,120\n');
    const [source] = await originalCore.sources.import([path]);
    const worker = original.all<Worker>('workers')[0];
    const task: Task = { id: id(), workerId: worker.id, brief: 'Read the budget', status: 'completed', sourceIds: [source.id], consent: false, accepted: false, budgetMicros: 100_000, createdAt: now() };
    original.put('tasks', task);
    const text = backups(original).export();

    const fresh = create(); const core = coreFor(fresh);
    restoreInto(fresh, text);
    await expect(core.sources.read(source.id, [source.id])).rejects.toThrow('thu hồi');
    const other = join(directory, 'other.csv');
    await writeFile(other, 'item,amount\nads,999\n');
    await expect(core.relinkSource({ taskId: task.id, sourceId: source.id, path: other })).rejects.toThrow('không khớp');
    await expect(core.relinkSource({ taskId: id(), sourceId: source.id, path })).rejects.toThrow();
    const relinked = await core.relinkSource({ taskId: task.id, sourceId: source.id, path });
    expect(relinked.revoked).toBe(false);
    expect(await core.sources.read(source.id, [source.id])).toBe('item,amount\nads,120\n');

    await core.command('revoke', { id: source.id });
    await expect(core.relinkSource({ taskId: task.id, sourceId: source.id, path })).rejects.toThrow();
  });
});
