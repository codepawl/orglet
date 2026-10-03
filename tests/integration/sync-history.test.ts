import { afterEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { Report, Routine, type Activity, type Artifact, type Run, type Skill, type Source, type Task, type Team, type Worker } from '../../apps/desktop/src/shared/contracts';
import { MarketOrigin } from '../../apps/desktop/src/shared/market';
import { SyncRecordingContext } from '../../apps/desktop/src/shared/sync';
import { SyncRecord } from '../../apps/desktop/src/shared/sync-records';
import { ChatSearch } from '../../apps/desktop/src/core/storage/chat-search';
import { KnowledgeBase } from '../../apps/desktop/src/core/context/knowledge';

const stores: Store[] = [];
const directories: string[] = [];
const context = SyncRecordingContext.parse({ accountKey: 'c'.repeat(64), generation: 1 });
const createdAt = '2026-01-01T00:00:00.000Z';

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('orglet-sync-history-')) {
      throw new Error('Refusing to remove a directory outside this test fixture.');
    }
    rmSync(target, { recursive: true, force: true });
  }
});

function device(time: number) {
  const directory = mkdtempSync(join(tmpdir(), 'orglet-sync-history-'));
  directories.push(directory);
  const store = new Store(join(directory, 'workspace.sqlite'), { syncNow: () => time });
  stores.push(store);
  store.sync.setRecordingContext(context);
  return store;
}

function receive(store: Store, records: SyncRecord[]) {
  const reversed = records.slice().reverse();
  for (let offset = 0; offset < reversed.length; offset += 100) {
    store.sync.receive(context, reversed.slice(offset, offset + 100));
  }
}

function chat(store: Store, sourceIds: string[] = []): Task {
  const worker = store.all<Worker>('workers')[0];
  const task: Task = {
    id: randomUUID(), workerId: worker.id, brief: 'Saved original question', sourceIds,
    status: 'completed', createdAt, budgetMicros: 1000, consent: true,
    providerScopes: ['openai'], accepted: true, pendingStart: true,
    desktop: { apps: [{ program: 'authority-sentinel.exe', name: 'Private authority sentinel', addedAt: createdAt }] },
  };
  store.put('tasks', task);
  return store.get<Task>('tasks', task.id);
}

it.each(['completed', 'partial', 'failed', 'cancelled', 'interrupted'] as const)(
  'retains %s frozen run, report and latest team event through reversed duplicate delivery without authority or echo',
  status => {
    const first = device(1000);
    const second = device(2000);
    const worker = first.all<Worker>('workers')[0];
    const skill = first.get<Skill>('skills', worker.skillId);
    const team: Team = {
      id: randomUUID(), revision: 1, name: 'History channel', instructions: 'Compare the evidence.',
      memberIds: [worker.id], synthesizerId: worker.id, workflow: 'sequential', monthlyBudgetMicros: 1000,
    };
    first.version('teams', team);
    const task = chat(first);
    first.update('tasks', { ...task, teamId: team.id });
    const run: Run = {
      id: randomUUID(), taskId: task.id, stage: 'synthesis', status: 'running', startedAt: createdAt, error: null,
      snapshot: {
        worker: { ...worker, autoApplyProposals: true, mcpServerIds: [randomUUID()] }, skill, team,
        inputRevision: 0, input: { brief: task.brief, sourceIds: [] },
        model: 'private-model-sentinel', pricingVersion: 'private-pricing-sentinel',
        desktop: { programs: ['C:\\private\\run-authority-sentinel.exe'] },
      },
    };
    first.put('runs', run, { column: 'task_id', value: task.id });
    const event: Activity = {
      id: randomUUID(), runId: run.id, sequence: 1, message: 'Private execution journal sentinel', createdAt,
      teamMessage: {
        teamId: team.id, inputRevision: 0, senderId: worker.id, recipientId: worker.id,
        kind: 'handoff', body: 'Evidence handed to the lead', replyTo: null, state: 'pending',
        callId: 'private-call-sentinel', requestHash: 'a'.repeat(64),
      },
    };
    first.put('events', event, { column: 'run_id', value: run.id });
    const report = Report.parse({ title: 'Saved result', summary: 'Historical answer searchable on either device', findings: [], limitations: ['Incomplete coverage remains visible'] });
    const artifact: Artifact = {
      id: randomUUID(), runId: run.id, report,
      hash: createHash('sha256').update(JSON.stringify(report)).digest('hex'), createdAt,
    };
    first.put('artifacts', artifact, { column: 'run_id', value: run.id });
    first.update('runs', { ...first.get<Run>('runs', run.id), status });
    const earlier = first.sync.snapshot(context);
    first.update('events', { ...event, teamMessage: { ...event.teamMessage!, state: 'acknowledged' } });
    first.version('workers', { ...worker, revision: 2, name: 'Edited after the historical run' });
    const records = first.sync.snapshot(context);
    const serialized = JSON.stringify(records);
    for (const sentinel of ['authority-sentinel', 'private-model-sentinel', 'private-pricing-sentinel', 'private-call-sentinel', 'Private execution journal sentinel']) {
      expect(serialized).not.toContain(sentinel);
    }
    const firstOutbox = first.sync.outbox(context);
    const secondOutbox = second.sync.outbox(context);
    receive(second, records.filter(record => record.data.kind === 'artifact' || record.data.kind === 'event'));
    expect(second.all('runs')).toEqual([]);
    receive(second, records);
    receive(second, earlier);
    receive(second, records);
    receive(first, second.sync.snapshot(context));
    expect(first.sync.outbox(context)).toEqual(firstOutbox);
    expect(second.sync.outbox(context)).toEqual(secondOutbox);
    const detail = second.detail(task.id);
    expect(detail.runs).toHaveLength(1);
    expect(detail.artifacts).toHaveLength(1);
    expect(detail.events).toHaveLength(1);
    expect(detail.runs[0]).toMatchObject({ id: run.id, stage: 'synthesis', status, originDeviceId: first.sync.revisions.clock.read().deviceId });
    expect(detail.runs[0].snapshot.worker.name).toBe(worker.name);
    expect(second.get<Worker>('workers', worker.id).name).toBe('Edited after the historical run');
    expect(detail.runs[0].snapshot.team?.name).toBe('History channel');
    expect(detail.runs[0].snapshot.worker.autoApplyProposals).toBeUndefined();
    expect(detail.runs[0].snapshot.worker.mcpServerIds).toBeUndefined();
    expect(detail.runs[0].snapshot.desktop).toBeUndefined();
    expect(detail.runs[0].snapshot.model).toBeUndefined();
    expect(detail.artifacts[0]).toMatchObject({ id: artifact.id, hash: artifact.hash, report });
    expect(detail.events[0].teamMessage).toMatchObject({ state: 'acknowledged', body: event.teamMessage!.body });
    expect(detail.task).toMatchObject({ consent: false, accepted: false, status: 'completed' });
    expect(detail.task.pendingStart).toBeUndefined();
    expect(detail.task.desktop).toBeUndefined();
    expect(second.db.prepare('SELECT COUNT(*) AS count FROM reservations').get()?.count).toBe(0);
    expect(second.db.prepare('SELECT COUNT(*) AS count FROM leases').get()?.count).toBe(0);
    expect(second.all('checkpoints')).toEqual([]);
    new ChatSearch(second).rebuild();
    expect(new ChatSearch(second).search('Historical answer searchable').chats[0]?.taskId).toBe(task.id);
  },
);

it('imports attached source metadata as an unavailable other-device placeholder without its local path', () => {
  const first = device(1000);
  const second = device(2000);
  const source: Source = { id: randomUUID(), name: 'evidence.txt', bytes: 17, hash: 'b'.repeat(64), revoked: false };
  first.put('sources', source, { column: 'path', value: 'C:\\private\\source-path-sentinel.txt' });
  const task = chat(first, [source.id]);
  const records = first.sync.snapshot(context);
  expect(JSON.stringify(records)).not.toContain('source-path-sentinel');
  receive(second, records.filter(record => record.data.kind === 'turn' || record.data.kind === 'chat'));
  expect(second.sync.turns.list(task.id)).toEqual([]);
  receive(second, records);
  receive(second, records);
  expect(second.get<Source>('sources', source.id)).toEqual({ ...source, availability: 'other-device' });
  expect(second.db.prepare('SELECT path FROM sources WHERE id=?').get(source.id)?.path).toBe('');
  expect(second.sync.turns.list(task.id)[0].input.sourceIds).toEqual([source.id]);
  expect(second.sync.outbox(context)).toEqual([]);
});

it.each(['run', 'artifact'] as const)('rejects altered immutable %s content from another envelope and rolls back the whole receive batch', kind => {
  const first = device(1000);
  const second = device(2000);
  const task = chat(first);
  const worker = first.get<Worker>('workers', task.workerId);
  const skill = first.get<Skill>('skills', worker.skillId);
  const run: Run = { id: randomUUID(), taskId: task.id, status: 'completed', startedAt: createdAt, error: null,
    snapshot: { worker, skill, inputRevision: 0, input: { brief: task.brief, sourceIds: [] } } };
  first.put('runs', run, { column: 'task_id', value: task.id });
  const report = Report.parse({ title: 'Immutable report', summary: 'Original answer', findings: [], limitations: [] });
  const artifact: Artifact = { id: randomUUID(), runId: run.id, report, createdAt,
    hash: createHash('sha256').update(JSON.stringify(report)).digest('hex') };
  first.put('artifacts', artifact, { column: 'run_id', value: run.id });
  const records = first.sync.snapshot(context);
  receive(second, records);
  const original = records.find(record => record.data.kind === kind)!;
  const otherOrigin = randomUUID();
  const duplicate = SyncRecord.parse({ ...original, id: randomUUID(), origin: otherOrigin,
    clock: { wallMs: 9000, counter: 0, deviceId: otherOrigin } });
  second.sync.receive(context, [duplicate]);
  expect(second.detail(task.id).runs).toHaveLength(1);
  expect(second.detail(task.id).artifacts).toHaveLength(1);
  expect(second.sync.outbox(context)).toEqual([]);

  const altered = structuredClone(duplicate);
  altered.id = randomUUID();
  altered.clock.counter = 1;
  if (altered.data.kind === 'run') altered.data.value.status = 'failed';
  if (altered.data.kind === 'artifact') {
    altered.data.value.report.summary = 'Altered answer with a valid replacement checksum';
    altered.data.value.hash = createHash('sha256').update(JSON.stringify(altered.data.value.report)).digest('hex');
  }
  first.setSetting('theme', 'dark');
  const setting = first.sync.snapshot(context).find(record => record.data.kind === 'setting' && record.data.change.key === 'theme')!;
  const beforeDetail = second.detail(task.id);
  const beforeSnapshot = second.sync.snapshot(context);
  const beforeClock = second.sync.revisions.clock.read();
  const beforeInbox = second.db.prepare('SELECT COUNT(*) AS count FROM sync_inbox').get()?.count;
  expect(() => second.sync.receive(context, [setting, altered])).toThrow();
  expect(second.setting('theme', 'system')).toBe('system');
  expect(second.detail(task.id)).toEqual(beforeDetail);
  expect(second.sync.snapshot(context)).toEqual(beforeSnapshot);
  expect(second.sync.revisions.clock.read()).toEqual(beforeClock);
  expect(second.db.prepare('SELECT COUNT(*) AS count FROM sync_inbox').get()?.count).toBe(beforeInbox);
  expect(second.sync.outbox(context)).toEqual([]);
});

it('imports an enabled folder routine disabled without approvals, folder grants or pending execution', () => {
  const first = device(1000);
  const second = device(2000);
  const worker = first.all<Worker>('workers')[0];
  const routine = Routine.parse({
    id: randomUUID(), revision: 1, name: 'Review incoming evidence', enabled: true,
    schedule: { timeZone: 'Asia/Ho_Chi_Minh', time: '09:00', frequency: 'daily', weekday: 1 },
    trigger: { kind: 'folder', folderId: randomUUID(), folderName: 'private-folder-sentinel' }, approvedConfig: 'private-approval-sentinel', nextDueAt: createdAt,
    pending: { dueAt: createdAt, reason: 'Waiting to run' },
    task: { workerId: worker.id, brief: 'Review evidence', sourceIds: [], budgetMicros: 1000, consent: true, providerScopes: ['openai'] },
  });
  first.put('routines', routine);
  const records = first.sync.snapshot(context);
  expect(JSON.stringify(records)).not.toContain('private-approval-sentinel');
  expect(JSON.stringify(records)).not.toContain('private-folder-sentinel');
  receive(second, records);
  receive(second, records);
  const imported = second.get<Routine>('routines', routine.id);
  expect(imported).toMatchObject({ enabled: false, approvedConfig: '', pending: null, trigger: { kind: 'called' }, task: { consent: false } });
  expect(imported.task.providerScopes ?? []).toEqual([]);
  expect(imported.nextDueAt).toBe('9999-01-01T00:00:00.000Z');
  expect(imported.notice?.reason).toContain('máy khác');
  expect(second.all('routine_folders')).toEqual([]);
  expect(second.sync.outbox(context)).toEqual([]);
});

it('retains received wire identities across restart without echoing the disabled routine or source placeholder', () => {
  const first = device(1000);
  let second = device(2000);
  const source: Source = { id: randomUUID(), name: 'restart-evidence.txt', bytes: 12, hash: 'f'.repeat(64), revoked: false };
  first.put('sources', source, { column: 'path', value: 'C:\\private\\restart-evidence.txt' });
  const task = chat(first, [source.id]);
  const routine = Routine.parse({
    id: randomUUID(), revision: 1, name: 'Originally enabled', enabled: true,
    schedule: { timeZone: 'Asia/Ho_Chi_Minh', time: '09:00', frequency: 'daily', weekday: 1 },
    approvedConfig: 'local-approval', nextDueAt: createdAt, pending: null,
    task: { workerId: task.workerId, brief: 'Scheduled question', sourceIds: [], budgetMicros: 1000, consent: true },
  });
  first.put('routines', routine);
  const records = first.sync.snapshot(context);
  receive(second, records);
  const snapshot = second.sync.snapshot(context);
  const turns = second.detail(task.id).savedTurns;
  const clock = second.sync.revisions.clock.read();
  const path = second.databasePath;
  second.close();
  stores.pop();
  second = new Store(path, { syncNow: () => 1900 });
  stores.push(second);
  second.sync.setRecordingContext(context);
  expect(second.sync.snapshot(context)).toEqual(snapshot);
  expect(second.sync.revisions.clock.read()).toEqual(clock);
  expect(second.sync.outbox(context)).toEqual([]);
  expect(second.get<Routine>('routines', routine.id)).toMatchObject({ enabled: false, task: { consent: false } });
  expect(second.get<Source>('sources', source.id).availability).toBe('other-device');
  expect(second.detail(task.id).savedTurns).toEqual(turns);
  const outbox = first.sync.outbox(context);
  receive(first, second.sync.snapshot(context));
  expect(first.get<Routine>('routines', routine.id).enabled).toBe(true);
  expect(first.sync.outbox(context)).toEqual(outbox);
});

it('merges concurrent Marketplace origins per entity instead of replacing the whole installation list', () => {
  const first = device(1000);
  const second = device(2000);
  receive(second, first.sync.snapshot(context));
  const firstWorker = first.all<Worker>('workers')[0];
  const secondWorker = second.all<Worker>('workers')[0];
  receive(first, second.sync.snapshot(context));
  function origin(worker: Worker, listingId: string) {
    return MarketOrigin.parse({ entityId: worker.id, kind: 'orglet', listingId, version: 1,
      workerIds: { friend: worker.id }, skillIds: { skill: worker.skillId }, baseline: 'd'.repeat(64) });
  }
  const firstOrigin = origin(firstWorker, 'first-friend');
  const secondOrigin = origin(secondWorker, 'second-friend');
  first.setSetting('marketOrigins', [firstOrigin]);
  second.setSetting('marketOrigins', [secondOrigin]);
  const firstRecords = first.sync.snapshot(context);
  const secondRecords = second.sync.snapshot(context);
  receive(second, firstRecords);
  receive(first, secondRecords);
  receive(first, secondRecords);
  for (const store of [first, second]) {
    expect(store.setting<MarketOrigin[]>('marketOrigins', []).sort((left, right) => left.listingId.localeCompare(right.listingId))).toEqual([firstOrigin, secondOrigin]);
  }
  first.setSetting('marketOrigins', [secondOrigin]);
  receive(second, first.sync.snapshot(context));
  expect(second.setting('marketOrigins', [])).toEqual([secondOrigin]);
});

it('keeps worker and chat permanent deletion above newer stale offline edits and denies re-enabling them', () => {
  const first = device(1000);
  const second = device(9000);
  const task = chat(first);
  const worker = first.get<Worker>('workers', task.workerId);
  receive(second, first.sync.snapshot(context));
  second.version('workers', { ...worker, revision: 2, name: 'Stale offline worker rename' });
  second.update('tasks', { ...second.get<Task>('tasks', task.id), title: 'Stale offline chat rename' });
  const stale = second.sync.snapshot(context);
  first.setSetting('entityState', { workers: { [worker.id]: { deletedAt: createdAt } }, teams: {} });
  first.sync.deleteChat(task.id);
  first.update('tasks', { ...first.get<Task>('tasks', task.id), deletedAt: createdAt });
  const deletion = first.sync.snapshot(context);
  receive(second, deletion);
  receive(first, stale);
  receive(second, stale);
  receive(second, deletion);
  for (const store of [first, second]) {
    expect(store.workspace().workers.some(item => item.id === worker.id)).toBe(false);
    expect(store.workspace().tasks.some(item => item.id === task.id)).toBe(false);
    expect(() => store.sync.setLocalOnly({ kind: 'worker', id: worker.id, localOnly: true })).toThrow();
    expect(() => store.sync.setLocalOnly({ kind: 'task', id: task.id, localOnly: true })).toThrow();
    expect(store.sync.snapshot(context).filter(record => record.data.kind !== 'withdraw'
      && record.scopes.some(scope => scope.id === worker.id || scope.id === task.id))).toEqual([]);
  }
  expect(first.get<Worker>('workers', worker.id).name).toBe(worker.name);
  expect(first.get<Task>('tasks', task.id).title).toBeUndefined();
});

it('repairs a late memory UUID to its exact local alias without treating an unrelated numeric revision as available or echoing', () => {
  const first = device(1000);
  const second = device(2000);
  const task = chat(first);
  const memory = new KnowledgeBase(first).save({ title: 'Writing preference', content: 'Initial preference', tags: [],
    pinned: false, scope: { type: 'workspace' }, kind: 'memory' });
  receive(second, first.sync.snapshot(context));
  new KnowledgeBase(second).save({ id: memory.id, title: memory.title, content: 'Independent local revision',
    tags: [], pinned: false, scope: memory.scope });
  const exact = new KnowledgeBase(first).save({ id: memory.id, title: memory.title, content: 'Exact remote memory used by the answer',
    tags: [], pinned: false, scope: memory.scope });
  const worker = first.get<Worker>('workers', task.workerId);
  const run: Run = { id: randomUUID(), taskId: task.id, status: 'completed', startedAt: createdAt, error: null,
    snapshot: { worker, skill: first.get<Skill>('skills', worker.skillId), inputRevision: 0 } };
  first.put('runs', run, { column: 'task_id', value: task.id });
  const report = Report.parse({ title: 'Historical answer', summary: 'Memory-backed answer', findings: [], limitations: [] });
  const artifact: Artifact = { id: randomUUID(), runId: run.id, report, createdAt,
    hash: createHash('sha256').update(JSON.stringify(report)).digest('hex'),
    usedMemories: [{ id: exact.id, revision: exact.revision, text: exact.content }] };
  first.put('artifacts', artifact, { column: 'run_id', value: run.id });
  const revision = first.sync.revisions.read('knowledge', exact.id, exact.revision);
  const records = first.sync.snapshot(context);
  const late = records.find(record => record.data.kind === 'revision' && record.data.revision.revisionId === revision.revisionId)!;
  receive(second, records.filter(record => record.id !== late.id));
  expect(second.get<Artifact>('artifacts', artifact.id).usedMemories).toEqual([
    { id: exact.id, revision: 2, text: exact.content, syncRevisionId: revision.revisionId, unavailable: true },
  ]);
  const beforeOutbox = second.sync.outbox(context);
  const wireArtifact = second.sync.snapshot(context).find(record => record.data.kind === 'artifact' && record.data.value.id === artifact.id);
  second.sync.receive(context, [late]);
  second.sync.receive(context, [late]);
  const identity = second.db.prepare('SELECT local_revision FROM sync_revision_ids WHERE revision_id=?').get(revision.revisionId);
  expect(identity?.local_revision).toBe(3);
  expect(second.get<Artifact>('artifacts', artifact.id).usedMemories).toEqual([
    { id: exact.id, revision: 3, text: exact.content, syncRevisionId: revision.revisionId },
  ]);
  expect(second.sync.outbox(context)).toEqual(beforeOutbox);
  expect(second.sync.snapshot(context).find(record => record.data.kind === 'artifact' && record.data.value.id === artifact.id)).toEqual(wireArtifact);
  expect(second.all('runs')).toHaveLength(1);
  expect(second.db.prepare('SELECT COUNT(*) AS count FROM reservations').get()?.count).toBe(0);
});


it('purges deleted memory wire copies and delayed revisions while retaining the canonical cited answer', () => {
  const first = device(1000);
  const second = device(2000);
  const task = chat(first);
  const memory = new KnowledgeBase(first).save({ title: 'Private memory', content: 'Deleted memory payload sentinel', tags: [],
    pinned: false, scope: { type: 'workspace' }, kind: 'memory' });
  const worker = first.get<Worker>('workers', task.workerId);
  const run: Run = { id: randomUUID(), taskId: task.id, status: 'completed', startedAt: createdAt, error: null,
    snapshot: { worker, skill: first.get<Skill>('skills', worker.skillId), inputRevision: 0 } };
  first.put('runs', run, { column: 'task_id', value: task.id });
  const report = Report.parse({ title: 'Retained answer', summary: 'Historical report', findings: [], limitations: [] });
  const artifact: Artifact = { id: randomUUID(), runId: run.id, report, createdAt,
    hash: createHash('sha256').update(JSON.stringify(report)).digest('hex'),
    usedMemories: [{ id: memory.id, revision: memory.revision, text: memory.content }] };
  first.put('artifacts', artifact, { column: 'run_id', value: run.id });
  const delayed = first.sync.snapshot(context);
  receive(second, delayed);
  new KnowledgeBase(first).deleteMemory(memory.id);
  receive(second, first.sync.snapshot(context));
  for (const store of [first, second]) {
    for (const table of ['sync_records', 'sync_inbox', 'sync_outbox']) {
      expect(store.db.prepare(`SELECT data FROM ${table}`).all().some(row => String(row.data).includes(memory.content))).toBe(false);
    }
    expect(store.get<Artifact>('artifacts', artifact.id).report).toEqual(report);
    expect(store.get<Artifact>('artifacts', artifact.id).usedMemories?.[0].text).toBe(memory.content);
    expect(store.db.prepare('SELECT id FROM knowledge WHERE id=?').get(memory.id)).toBeUndefined();
    expect(store.sync.snapshot(context).some(record => record.data.kind === 'delete' && record.data.id === memory.id)).toBe(true);
  }
  receive(second, delayed);
  expect(second.db.prepare('SELECT id FROM knowledge WHERE id=?').get(memory.id)).toBeUndefined();
  expect(second.db.prepare('SELECT data FROM sync_inbox').all().some(row => String(row.data).includes(memory.content))).toBe(false);
  expect(second.sync.outbox(context)).toEqual([]);
});
