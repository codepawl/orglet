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
import { WorkspaceRecovery } from '../../apps/desktop/src/core/storage/workspace-recovery';
import { changeOutcomeOf } from '../../apps/desktop/src/shared/workspace-recovery';
import { eraseSources } from '../../apps/desktop/src/core/storage/erase';
import { Sources } from '../../apps/desktop/src/core/tools/sources';
import { SyncRecord } from '../../apps/desktop/src/shared/sync-records';

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
const legacyBackup = (text: string) => {
  const envelope = JSON.parse(resign(text, payload => {
    delete payload.savedTurns;
    delete payload.syncIdentities;
    delete payload.localOnly;
    delete payload.permanentDeletions;
    for (const task of payload.tasks) {
      delete task.currentTurnId;
      delete task.turnIds;
    }
    for (const run of payload.runs) {
      delete run.snapshot.turnId;
      delete run.originDeviceId;
    }
  }));
  envelope.version = 1;
  return JSON.stringify(envelope);
};

describe('workspace backup and additive restore', () => {
  it('keeps public deletion barriers through clean restore, delayed replay, repeated restore and restart', async () => {
    const original = create();
    const saved = fixture(original);
    const context = { accountKey: 'a'.repeat(64), generation: 1 };
    original.sync.setRecordingContext(context);
    const delayed = original.sync.snapshot(context);
    const sourceRecord = delayed.find(record => record.data.kind === 'source')!;
    const absentId = id();
    const absentSource = { ...saved.source, id: absentId, name: 'ERASED_ABSENT_SOURCE_SENTINEL', hash: 'b'.repeat(64) };
    original.put('sources', absentSource, { column: 'path', value: '' });
    const delayedAbsent = SyncRecord.parse({ ...sourceRecord, id: id(), data: { kind: 'source', value: {
      id: absentId, name: absentSource.name, bytes: absentSource.bytes, hash: absentSource.hash,
    } } });
    const older = backups(original).export();
    eraseSources(original);
    original.db.prepare("INSERT OR IGNORE INTO sync_deletions VALUES('record',?)").run(`turn:${id()}`);
    const text = backups(original).export();
    const payload = JSON.parse(text).payload;
    expect(payload.permanentDeletions).toEqual(expect.arrayContaining([
      { kind: 'source', id: saved.source.id }, { kind: 'source', id: absentId },
    ]));
    expect(payload.permanentDeletions.some((deletion: { kind: string }) => deletion.kind === 'record')).toBe(false);
    expect(payload.sources).toEqual([{ id: saved.source.id, name: 'Nguồn đã xóa', bytes: 0,
      hash: '0'.repeat(64), revoked: true, availability: 'other-device' }]);
    expect(text).not.toContain(absentSource.name);
    const directory = await mkdtemp(join(tmpdir(), 'orglet-backup-deletions-'));
    let restored = new Store(join(directory, 'state.sqlite'));
    stores.push(restored);
    try {
      let manager = backups(restored);
      manager.restore(manager.preview(text).token);
      restored.sync.setRecordingContext(context);
      const clock = restored.sync.revisions.clock.read();
      manager.restore(manager.preview(text).token);
      expect(restored.sync.revisions.clock.read()).toEqual(clock);
      restored.sync.receive(context, [...delayed, delayedAbsent]);
      expect(restored.get<Source>('sources', saved.source.id)).toEqual(payload.sources[0]);
      expect(() => restored.get('sources', absentId)).toThrow();
      await expect(new Sources(restored).relink(saved.source.id, [saved.source.id], join(directory, 'not-needed.txt'))).rejects.toThrow('thu hồi');
      expect(() => manager.restore(manager.preview(older).token)).toThrow('xung đột');
      expect(restored.get<Source>('sources', saved.source.id)).toEqual(payload.sources[0]);
      restored.close();
      restored = new Store(join(directory, 'state.sqlite'));
      stores.push(restored);
      restored.sync.setRecordingContext(context);
      restored.sync.receive(context, [...delayed, delayedAbsent]);
      expect(restored.sync.permanentDeletions()).toEqual(expect.arrayContaining(payload.permanentDeletions));
      expect(() => restored.get('sources', absentId)).toThrow();
      expect(JSON.stringify(restored.sync.snapshot(context))).not.toContain(absentSource.name);
      manager = backups(restored);
      expect(() => manager.preview(manager.export())).not.toThrow();
    } finally {
      restored.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects duplicate or private deletion markers while accepting key-only public barriers', () => {
    const store = create();
    const manager = backups(store);
    const text = manager.export();
    const deletion = { kind: 'knowledge', id: id() };
    expect(() => manager.preview(resign(text, payload => { payload.permanentDeletions = [deletion]; }))).not.toThrow();
    expect(() => manager.preview(resign(text, payload => { payload.permanentDeletions = [deletion, deletion]; }))).toThrow('bị trùng');
    expect(() => manager.preview(resign(text, payload => { payload.permanentDeletions = [{ kind: 'record', id: id() }]; }))).toThrow();
    expect(() => manager.preview(resign(text, payload => { payload.permanentDeletions = [{ ...deletion, epoch: id() }]; }))).toThrow();
  });

  it('restores V2 unstarted messages, stable revisions and local-only choices without private sync state', () => {
    const original = create();
    const saved = fixture(original);
    const messageId = id();
    original.update('tasks', { ...original.get<Task>('tasks', saved.task.id), inputRevision: 1, currentTurnId: messageId,
      currentInput: { brief: 'Saved without starting a run', sourceIds: [] } });
    original.sync.setLocalOnly({ kind: 'worker', id: saved.task.workerId, localOnly: true });
    original.sync.setLocalOnly({ kind: 'task', id: saved.task.id, localOnly: true });
    const identities = original.sync.revisions.identities();
    original.setSetting('marketMutationJournal', [{ secret: 'PRIVATE_SYNC_JOURNAL_SENTINEL' }]);
    const text = backups(original).export();
    expect(JSON.parse(text).version).toBe(2);
    expect(text).not.toContain('PRIVATE_SYNC_JOURNAL_SENTINEL');
    expect(JSON.parse(text).payload).not.toHaveProperty('sync_clock');
    expect(JSON.parse(text).payload).not.toHaveProperty('sync_outbox');
    const restored = create();
    const manager = backups(restored);
    manager.restore(manager.preview(text).token);
    expect(restored.sync.turns.list(saved.task.id).map(turn => [turn.id, turn.input.brief])).toEqual([
      [saved.task.id, 'Restore history'], [messageId, 'Saved without starting a run'],
    ]);
    expect(restored.sync.revisions.identities()).toEqual(identities);
    expect(restored.sync.localOnlyState()).toMatchObject({ workers: [saved.task.workerId], tasks: [saved.task.id] });
    manager.restore(manager.preview(text).token);
    expect(restored.sync.turns.list(saved.task.id)).toHaveLength(2);
    expect(restored.sync.revisions.identities()).toEqual(identities);
  });

  it('rejects malformed V2 turn and revision references before writing, and preserves immutable messages', () => {
    const original = create();
    const saved = fixture(original);
    const text = backups(original).export();
    const target = create();
    const manager = backups(target);
    for (const mutate of [
      (payload: any) => { payload.savedTurns[0].taskId = id(); },
      (payload: any) => { payload.savedTurns.push({ ...payload.savedTurns[0], id: id() }); },
      (payload: any) => { payload.tasks[0].currentTurnId = id(); },
      (payload: any) => { payload.syncIdentities[0].localRevision = 999; },
      (payload: any) => { payload.syncIdentities.push(payload.syncIdentities[0]); },
      (payload: any) => { payload.localOnly.tasks = [id()]; },
    ]) expect(() => manager.preview(resign(text, mutate))).toThrow();
    expect(target.all('tasks')).toHaveLength(0);
    manager.restore(manager.preview(text).token);
    const conflicting = resign(text, payload => { payload.savedTurns[0].input.brief = 'Forged replacement'; });
    expect(() => manager.restore(manager.preview(conflicting).token)).toThrow('xung đột');
    expect(target.sync.turns.list(saved.task.id)[0].input.brief).toBe('Restore history');
  });

  it('carries spaces, and keeps a space the restoring computer already has', () => {
    const original = create();
    const saved = fixture(original);
    const space = { id: id(), name: 'Launch', orgletIds: [saved.task.workerId], categories: [{ id: id(), name: 'Copy' }] };
    original.setSetting('spaces', [space]);
    const text = backups(original).export();
    const restored = create();
    const manager = backups(restored);
    manager.restore(manager.preview(text).token);
    expect(restored.workspace().spaces).toEqual([space]);
    // A second restore of a backup that names the same space differently leaves the space on this computer alone.
    original.setSetting('spaces', [{ ...space, name: 'Renamed elsewhere' }]);
    const later = backups(original).export();
    manager.restore(manager.preview(later).token);
    expect(restored.workspace().spaces).toEqual([space]);
  });

  it('keeps an answer attached to its durable message ID after a second user message', () => {
    const original = create();
    const saved = fixture(original);
    const messageId = id();
    const input = { brief: 'A second message', sourceIds: [] };
    original.update('tasks', { ...original.get<Task>('tasks', saved.task.id), inputRevision: 1,
      currentTurnId: messageId, currentInput: input });
    original.version('workers', { ...saved.run.snapshot.worker, revision: 2, name: 'Authored worker revision' });
    original.version('skills', { ...saved.run.snapshot.skill, revision: 2, name: 'Authored skill revision' });
    const run: Run = { ...saved.run, id: id(), status: 'completed', snapshot: { ...saved.run.snapshot,
      worker: original.get<Worker>('workers', saved.task.workerId), skill: original.get<Skill>('skills', saved.run.snapshot.skill.id),
      inputRevision: 1, input } };
    original.put('runs', run, { column: 'task_id', value: run.taskId });
    const originalWorkerIdentity = original.sync.revisions.frozen('worker', run.snapshot.worker);
    const originalSkillIdentity = original.sync.revisions.frozen('skill', run.snapshot.skill);
    const report = Report.parse({ title: 'Second answer', summary: 'Saved answer', findings: [], limitations: [] });
    const artifactId = id();
    original.put('artifacts', { id: artifactId, runId: run.id, report,
      hash: createHash('sha256').update(JSON.stringify(report)).digest('hex'), createdAt: now(), replyTo: messageId },
    { column: 'run_id', value: run.id });
    const text = backups(original).export();
    const restored = create();
    const manager = backups(restored);
    manager.restore(manager.preview(text).token);
    expect(restored.detail(saved.task.id).artifacts.find(artifact => artifact.id === artifactId)?.replyTo).toBe(messageId);
    expect(restored.get<Run>('runs', run.id).snapshot.turnId).toBe(messageId);
    const restoredRun = restored.get<Run>('runs', run.id);
    expect(restored.sync.revisions.frozen('worker', restoredRun.snapshot.worker)).toEqual(originalWorkerIdentity);
    expect(restored.sync.revisions.frozen('skill', restoredRun.snapshot.skill)).toEqual(originalSkillIdentity);
    // Older retained runs can have authored revision IDs without an origin-device field.
    const compatible = create();
    const compatibleManager = backups(compatible);
    const withoutRunOrigin = resign(text, payload => { for (const row of payload.runs) delete row.originDeviceId; });
    compatibleManager.restore(compatibleManager.preview(withoutRunOrigin).token);
    const context = { accountKey: 'a'.repeat(64), generation: 1 };
    compatible.sync.setRecordingContext(context);
    const captured = compatible.sync.snapshot(context).find(record => record.data.kind === 'run' && record.data.value.id === run.id)?.data;
    expect(captured?.kind).toBe('run');
    if (captured?.kind === 'run') {
      expect(captured.value.worker.revisionId).toBe(originalWorkerIdentity.revisionId);
      expect(captured.value.skill.revisionId).toBe(originalSkillIdentity.revisionId);
    }
    expect(() => manager.preview(resign(text, payload => { payload.artifacts[0].replyTo = saved.task.id; }))).toThrow('sai tin người dùng');
  });

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
    const legacy = legacyBackup(manager.export());
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
    const store = create(); const f = fixture(store); const manager = backups(store); const legacy = legacyBackup(manager.export());
    const input = { brief: f.task.brief, sourceIds: f.task.sourceIds };
    const backfilled = { ...f.run, snapshot: { ...f.run.snapshot, input, inputRevision: 0 } };
    store.update('runs', backfilled);
    const added = { ...f.source, id: id(), name: 'supplement.txt' };
    store.put('sources', added, { column: 'path', value: '' });
    store.update('tasks', { ...f.task, inputRevision: 1, currentInput: { brief: 'New request', sourceIds: [added.id] }, sourceIds: [...f.task.sourceIds, added.id] });
    manager.restore(manager.preview(legacy).token);
    expect(store.get<Run>('runs', f.run.id).snapshot).toEqual({ ...backfilled.snapshot, turnId: f.task.id });
    expect(store.get<Task>('tasks', f.task.id).currentInput?.sourceIds).toEqual([added.id]);
    for (const mutate of [
      (payload: any) => { payload.tasks[0].brief = 'Changed original request'; },
      (payload: any) => { payload.tasks[0].sourceIds = []; },
      (payload: any) => { payload.runs[0].snapshot.worker.name = 'Changed worker'; },
      (payload: any) => { payload.runs[0].snapshot.inputRevision = 1; },
    ]) expect(() => manager.restore(manager.preview(resign(legacy, mutate)).token)).toThrow('xung đột');
    expect(store.get<Run>('runs', f.run.id).snapshot).toEqual({ ...backfilled.snapshot, turnId: f.task.id });
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
      const otherTask = { ...payload.tasks[0], id: id(), currentTurnId: undefined, turnIds: undefined }; payload.tasks.push(otherTask);
      payload.runs[1].taskId = otherTask.id;
      delete payload.runs[1].snapshot.turnId;
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
    expect(restored.usage()).toEqual({ reservedMicros: 1000, chargedMicros: 0, uncertainCount: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
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
    expect(() => manager.preview(text.replace('"version":2', '"version":99'))).toThrow();
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

  it('exports a deleted charged multi-turn chat with redacted durable IDs and restores only the saved turns', async () => {
    const store = create();
    const core = coreFor(store);
    const { paid } = paidAndFreeChats(store);
    const context = { accountKey: 'a'.repeat(64), generation: 1 };
    store.sync.setRecordingContext(context);
    const appendChargedTurn = (revision: number, brief: string) => {
      const input = { brief, sourceIds: [paid.source.id] };
      const messageId = id();
      store.update('tasks', { ...store.get<Task>('tasks', paid.task.id), inputRevision: revision,
        currentTurnId: messageId, currentInput: input });
      const run: Run = { ...paid.run, id: id(), status: 'completed', snapshot: { ...paid.run.snapshot,
        inputRevision: revision, input } };
      store.put('runs', run, { column: 'task_id', value: run.taskId });
      const reservation = paid.ledger.reserve(run.id, paid.task.id, 'openai', 1000, 100_000, 5_000_000);
      paid.ledger.settle(reservation, 50, 50);
      return messageId;
    };
    const secondId = appendChargedTurn(1, 'Saved second private question');
    const text = backups(store).export();
    const laterId = appendChargedTurn(2, 'Later private question outside the backup');
    const unstartedId = id();
    store.update('tasks', { ...store.get<Task>('tasks', paid.task.id), inputRevision: 3, currentTurnId: unstartedId,
      currentInput: { brief: 'Unstarted private question outside the backup', sourceIds: [paid.source.id] } });
    const usage = store.usage();
    await core.command('eraseData', { scope: 'chats' });
    const redactedTurns = store.sync.turns.list(paid.task.id);
    expect(redactedTurns.map(turn => turn.id)).toEqual([paid.task.id, secondId, laterId, unstartedId]);
    expect(redactedTurns.map(turn => turn.input)).toEqual(Array.from({ length: 4 }, () => ({ brief: '(đã xóa)', sourceIds: [] })));
    const deletedBackup = backups(store).export();
    expect(() => backups(store).preview(deletedBackup)).not.toThrow();
    expect(deletedBackup).not.toContain('Saved second private question');
    expect(deletedBackup).not.toContain('Later private question outside the backup');
    expect(deletedBackup).not.toContain('Unstarted private question outside the backup');
    const queued = JSON.stringify(store.sync.outbox(context));
    expect(queued).not.toContain('Saved second private question');
    expect(queued).not.toContain('Later private question outside the backup');
    expect(queued).not.toContain('Unstarted private question outside the backup');
    expect(queued).not.toContain(paid.source.id);
    restoreInto(store, text);
    const restoredTurns = store.sync.turns.list(paid.task.id);
    expect(restoredTurns.map(turn => [turn.id, turn.input.brief])).toEqual([
      [paid.task.id, 'Restore history'], [secondId, 'Saved second private question'], [laterId, '(đã xóa)'], [unstartedId, '(đã xóa)'],
    ]);
    expect(restoredTurns[2].input.sourceIds).toEqual([]);
    expect(restoredTurns[3].input.sourceIds).toEqual([]);
    expect(store.detail(paid.task.id).task.currentTurnId).toBe(unstartedId);
    expect(store.detail(paid.task.id).task.currentInput).toEqual({ brief: '(đã xóa)', sourceIds: [] });
    expect(store.sync.localOnlyState().permanentTasks).toContain(paid.task.id);
    expect(JSON.stringify(store.sync.snapshot(context))).not.toContain('Saved second private question');
    expect(store.sync.snapshot(context).some(record => record.data.kind === 'chat' && record.data.value.id === paid.task.id)).toBe(false);
    expect(() => store.sync.setLocalOnly({ kind: 'task', id: paid.task.id, localOnly: true })).not.toThrow();
    expect(() => store.sync.setLocalOnly({ kind: 'task', id: paid.task.id, localOnly: false })).toThrow('Mục đã xóa');
    expect(store.usage()).toEqual(usage);
    expect(() => backups(store).preview(backups(store).export())).not.toThrow();
    restoreInto(store, text);
    expect(store.sync.turns.list(paid.task.id)).toEqual(restoredTurns);
    expect(store.usage()).toEqual(usage);
  });

  /** A working copy as the runtime stores it, with a private folder, a path and a hash the backup must not carry. */
  function storeCopy(store: Store, runId: string, fields: Record<string, unknown>) {
    const data = { runId, directory: 'C:\\private\\copies\\never-export', kind: 'git-worktree', edits: 1, baseline: { files: [] },
      changes: [{ path: 'src/secret-name.ts', status: 'applied', hash: 'd'.repeat(64) }], ...fields };
    store.db.prepare('INSERT INTO workspace_copies(run_id,data) VALUES(?,?)').run(runId, JSON.stringify(data));
  }

  it('brings a turn’s files line back after Delete chat history, with its counts and outcome but no files (COD-299)', async () => {
    const store = create(); const core = coreFor(store);
    const { paid } = paidAndFreeChats(store);
    const diff = { files: 3, additions: 42, deletions: 7, moved: 1 };
    storeCopy(store, paid.run.id, { state: 'integrated', diff, review: { state: 'applied', heldAt: now(), decidedAt: now(), skipped: 1 } });
    const lineBefore = new WorkspaceRecovery(store).view(paid.task.id).copies[0];
    expect(changeOutcomeOf(lineBefore)).toEqual({ state: 'applied', skipped: 1 });

    const text = backups(store).export();
    const saved = JSON.parse(text).payload.changedFiles;
    expect(saved).toEqual([{ runId: paid.run.id, diff, outcome: { state: 'applied', skipped: 1 } }]);
    expect(text).not.toContain('never-export');
    expect(text).not.toContain('secret-name');
    expect(text).not.toContain('d'.repeat(64));

    await core.command('eraseData', { scope: 'chats' });
    expect(countOf(store, 'workspace_copies')).toBe(0);
    restoreInto(store, text);
    const view = new WorkspaceRecovery(store).view(paid.task.id);
    expect(view.copies).toEqual([]);
    expect(view.restored).toEqual([{ runId: paid.run.id, diff, outcome: { state: 'applied', skipped: 1 } }]);

    // A backup of the restored chat keeps the line, and deleting the chat again takes it away.
    expect(JSON.parse(backups(store).export()).payload.changedFiles).toEqual(saved);
    await core.command('eraseData', { scope: 'chats' });
    expect(store.db.prepare(`SELECT COUNT(*) AS count FROM settings WHERE id LIKE 'workspace-restored:%'`).get()!.count).toBe(0);
  });

  it('keeps the working copy here over a restored line, and skips runs that changed nothing (COD-299)', () => {
    const store = create();
    const { paid, free } = paidAndFreeChats(store);
    const emptyRun: Run = { id: id(), taskId: free.id, status: 'completed', snapshot: paid.run.snapshot, startedAt: now(), error: null };
    store.put('runs', emptyRun, { column: 'task_id', value: free.id });
    storeCopy(store, paid.run.id, { state: 'ready', diff: { files: 1, additions: 2, deletions: 0 }, review: { state: 'pending', heldAt: now() } });
    storeCopy(store, emptyRun.id, { state: 'integrated', diff: { files: 0, additions: 0, deletions: 0 } });
    const text = backups(store).export();
    expect(JSON.parse(text).payload.changedFiles).toEqual([{ runId: paid.run.id, diff: { files: 1, additions: 2, deletions: 0 }, outcome: { state: 'pending' } }]);
    restoreInto(store, text);
    const view = new WorkspaceRecovery(store).view(paid.task.id);
    expect(view.restored).toBeUndefined();
    expect(view.copies[0].review?.state).toBe('pending');
  });

  it('refuses a files line for a run the backup does not have (COD-299)', () => {
    const store = create();
    paidAndFreeChats(store);
    const text = resign(backups(store).export(), payload => {
      payload.changedFiles = [{ runId: id(), diff: { files: 1, additions: 1, deletions: 0 } }];
    });
    expect(() => backups(store).preview(text)).toThrow('Dòng tệp đã sửa');
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
