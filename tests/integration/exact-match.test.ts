import { afterEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { analyze } from '../../apps/desktop/src/profiler/analyze';
import { Store, now } from '../../apps/desktop/src/core/storage/database';
import { Sources } from '../../apps/desktop/src/core/tools/sources';
import { CoreService } from '../../apps/desktop/src/core/service';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import type { DataFormat, ExactMatchRequest } from '../../apps/desktop/src/shared/profiles';
import { Report, type Run, type Skill, type Task, type Worker } from '../../apps/desktop/src/shared/contracts';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

function pair(predictions: string | Buffer, answers: string | Buffer, format: DataFormat = 'csv') {
  const request: ExactMatchRequest = {
    predictionSourceId: randomUUID(), answerSourceId: randomUUID(),
    idColumn: 'id', predictionColumn: 'prediction', answerColumn: 'answer',
  };
  const files = [
    { sourceId: request.predictionSourceId, format, base64: Buffer.from(predictions).toString('base64') },
    { sourceId: request.answerSourceId, format, base64: Buffer.from(answers).toString('base64') },
  ];
  return { files, idColumn: request.idColumn, exactMatch: request };
}

it('computes exact-match accuracy by unique ID, independent of row order', async () => {
  const result = await analyze(pair('id,prediction\n2,yes\n1,no\n3,yes\n', 'id,answer\n1,no\n2,no\n3,yes\n'));
  expect(result.comparison?.sameIdOrder).toBe(false);
  expect(result.exactMatch).toMatchObject({ version: 'orglet-exact-match-v1', status: 'complete', matched: 2, total: 3, accuracy: 2 / 3, reason: null });
  expect(result.checks).toContain('exact_match_accuracy');
});

it('reads JSONL and Parquet pairs without running challenge code', async () => {
  const jsonl = await analyze(pair('{"id":2,"prediction":"a"}\n{"id":1,"prediction":"b"}\n', '{"id":1,"answer":"b"}\n{"id":2,"answer":"a"}\n', 'jsonl'));
  expect(jsonl.exactMatch).toMatchObject({ status: 'complete', matched: 2, total: 2, accuracy: 1 });

  const directory = await mkdtemp(join(tmpdir(), 'orglet-exact-parquet-'));
  directories.push(directory);
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  try {
    const predictions = join(directory, 'predictions.parquet');
    const answers = join(directory, 'answers.parquet');
    await connection.run(`COPY (SELECT 2 AS id, 'yes' AS prediction UNION ALL SELECT 1, 'no') TO '${predictions.replaceAll("'", "''")}' (FORMAT PARQUET)`);
    await connection.run(`COPY (SELECT 1 AS id, 'no' AS answer UNION ALL SELECT 2, 'yes') TO '${answers.replaceAll("'", "''")}' (FORMAT PARQUET)`);
    const result = await analyze(pair(await readFile(predictions), await readFile(answers), 'parquet'));
    expect(result.exactMatch).toMatchObject({ status: 'complete', matched: 2, total: 2, accuracy: 1 });
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
});

it('withholds a score for duplicate, null or mismatched IDs', async () => {
  const duplicates = await analyze(pair('id,prediction\n1,a\n1,b\n', 'id,answer\n1,a\n2,b\n'));
  expect(duplicates.exactMatch).toMatchObject({ status: 'incomplete', reason: 'duplicate_id', accuracy: null, matched: null });
  const nullId = await analyze(pair('id,prediction\n,a\n2,b\n', 'id,answer\n1,a\n2,b\n'));
  expect(nullId.exactMatch).toMatchObject({ status: 'incomplete', reason: 'null_id', accuracy: null });
  const mismatch = await analyze(pair('id,prediction\n1,a\n3,b\n', 'id,answer\n1,a\n2,b\n'));
  expect(mismatch.exactMatch).toMatchObject({ status: 'incomplete', reason: 'id_mismatch', accuracy: null });
});

it('withholds a score for missing columns, null labels and incompatible types', async () => {
  const absent = await analyze(pair('id,guess\n1,a\n', 'id,answer\n1,a\n'));
  expect(absent.exactMatch).toMatchObject({ status: 'unsupported', reason: 'missing_column', accuracy: null });
  const nullValue = await analyze(pair('id,prediction\n1,\n', 'id,answer\n1,a\n'));
  expect(nullValue.exactMatch).toMatchObject({ status: 'incomplete', reason: 'null_value', accuracy: null });
  const wrongType = await analyze(pair('{"id":1,"prediction":1}\n', '{"id":1,"answer":"1"}\n', 'jsonl'));
  expect(wrongType.exactMatch).toMatchObject({ status: 'unsupported', reason: 'type_mismatch', accuracy: null });
  const nested = await analyze(pair('{"id":1,"prediction":{"label":"a"}}\n', '{"id":1,"answer":{"label":"a"}}\n', 'jsonl'));
  expect(nested.exactMatch).toMatchObject({ status: 'unsupported', reason: 'unsupported_type', accuracy: null });
});

it('keeps source hashes and result through backup, rejects a forged accuracy, and cancels without committing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orglet-exact-persist-'));
  directories.push(directory);
  const store = new Store(join(directory, 'workspace.sqlite'));
  const restored = new Store(':memory:');
  try {
    const predictionPath = join(directory, 'predictions.csv');
    const answerPath = join(directory, 'answers.csv');
    await writeFile(predictionPath, 'id,prediction\n1,a\n2,b\n');
    await writeFile(answerPath, 'id,answer\n2,b\n1,a\n');
    const sources = new Sources(store, input => analyze(input));
    const core = new CoreService(store, () => {}, async () => { throw new Error('No provider allowed'); }, input => analyze(input));
    const imported = await sources.import([predictionPath, answerPath]);
    const task: Task = { id: randomUUID(), workerId: store.all<Worker>('workers')[0].id, brief: 'Exact match', sourceIds: imported.map(source => source.id), consent: false, accepted: false, status: 'completed', budgetMicros: 1000, createdAt: now() };
    store.put('tasks', task);
    const request: ExactMatchRequest = { predictionSourceId: imported[0].id, answerSourceId: imported[1].id, idColumn: 'id', predictionColumn: 'prediction', answerColumn: 'answer' };
    await core.command('scoreExactMatch', { taskId: task.id, ...request });
    const saved = store.detail(task.id).profiles[0];
    expect(saved.result.exactMatch).toMatchObject({ status: 'complete', accuracy: 1 });
    expect(saved.sourceHashes).toEqual(Object.fromEntries(imported.map(source => [source.id, source.hash])));
    const report = Report.parse({ title: 'Accuracy review', summary: 'Exact match checked.', findings: [], limitations: [],
      review: { checks: [{ name: 'Exact match', status: 'pass', coverage: '2 / 2 matched', sourceIds: task.sourceIds, checkerIds: [saved.id] }],
        recommendation: 'ready_for_human_review', draftFeedback: 'Review this bounded score.', upstreamFindingIds: [], conflicts: [] } });
    const run: Run = { id: randomUUID(), taskId: task.id, stage: 'synthesis', status: 'completed',
      snapshot: { worker: store.all<Worker>('workers')[0], skill: store.all<Skill>('skills')[0],
        input: { brief: task.brief, sourceIds: task.sourceIds }, scoreProfileIds: [saved.id] },
      startedAt: new Date(Date.parse(saved.createdAt) + 1000).toISOString(), error: null };
    store.put('runs', run, { column: 'task_id', value: task.id });
    store.put('artifacts', { id: randomUUID(), runId: run.id, report,
      hash: createHash('sha256').update(JSON.stringify(report)).digest('hex'),
      createdAt: new Date(Date.parse(run.startedAt) + 1000).toISOString() }, { column: 'run_id', value: run.id });
    const backupText = new Backups(store, () => false, () => {}).export();
    const manager = new Backups(restored, () => false, () => {});
    manager.restore(manager.preview(backupText).token);
    expect(restored.detail(task.id).profiles[0].result.exactMatch).toEqual(saved.result.exactMatch);
    const unpinned = JSON.parse(backupText);
    delete unpinned.payload.runs[0].snapshot.scoreProfileIds;
    unpinned.checksum = createHash('sha256').update(JSON.stringify(unpinned.payload)).digest('hex');
    expect(() => manager.preview(JSON.stringify(unpinned))).toThrow();
    const envelope = JSON.parse(backupText);
    envelope.payload.profiles[0].result.exactMatch.accuracy = 0;
    envelope.checksum = createHash('sha256').update(JSON.stringify(envelope.payload)).digest('hex');
    expect(() => manager.preview(JSON.stringify(envelope))).toThrow();

    let notifyStarted!: () => void;
    const started = new Promise<void>(resolve => { notifyStarted = resolve; });
    const cancellable = new Sources(store, async (_input, signal) => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
      notifyStarted();
    }));
    const pending = cancellable.profile(task.sourceIds, task.sourceIds, request.idColumn, undefined, { taskId: task.id }, undefined, request);
    const rejection = expect(pending).rejects.toThrow('Cancelled');
    await started;
    cancellable.cancelChecks(task.id);
    await rejection;
    expect(store.detail(task.id).profiles).toHaveLength(1);
    await writeFile(predictionPath, 'id,prediction\n1,b\n2,b\n');
    await expect(core.command('scoreExactMatch', { taskId: task.id, ...request })).rejects.toThrow('thay đổi');
    await core.command('revoke', { id: imported[0].id });
    await expect(core.command('scoreExactMatch', { taskId: task.id, ...request })).rejects.toThrow('thu hồi');
  } finally {
    restored.close();
    store.close();
  }
});

it('pins a manual score to the next run and exposes its bounded evidence to the worker', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orglet-exact-run-'));
  directories.push(directory);
  const store = new Store(join(directory, 'workspace.sqlite'));
  const seen: string[] = [];
  const core = new CoreService(store, () => {}, async () => ({ async request(messages) {
    seen.push(messages.map(message => String(message.content ?? '')).join('\n'));
    return { calls: [{ id: randomUUID(), name: 'reply', arguments: JSON.stringify({ message: 'Checked the selected score.', knowledgeProposals: [] }) }], usage: { input: 50, output: 20 } };
  } }), input => analyze(input));
  try {
    const predictionPath = join(directory, 'predictions.csv');
    const answerPath = join(directory, 'answers.csv');
    await writeFile(predictionPath, 'id,prediction\n1,a\n');
    await writeFile(answerPath, 'id,answer\n1,a\n');
    const imported = await core.sources.import([predictionPath, answerPath]);
    const worker = store.all<Worker>('workers')[0];
    const taskId = await core.command('createTask', { workerId: worker.id, brief: 'Initial Demo turn',
      sourceIds: imported.map(source => source.id), consent: false, providerScopes: [], budgetMicros: 100_000 }) as string;
    for (let attempt = 0; attempt < 200 && core.runner.isActive(taskId); attempt += 1) await new Promise(resolve => setTimeout(resolve, 10));
    expect(core.runner.isActive(taskId)).toBe(false);
    const request: ExactMatchRequest = { predictionSourceId: imported[0].id, answerSourceId: imported[1].id,
      idColumn: 'id', predictionColumn: 'prediction', answerColumn: 'answer' };
    await core.command('scoreExactMatch', { taskId, ...request });
    const profileId = store.detail(taskId).profiles[0].id;
    await core.command('saveWorker', { ...worker, provider: 'openai' });
    await core.command('reviseTask', { taskId, brief: 'Review the exact-match result', sourceIds: imported.map(source => source.id),
      consent: true, providerScopes: ['openai'], budgetMicros: 100_000 });
    for (let attempt = 0; attempt < 200 && core.runner.isActive(taskId); attempt += 1) await new Promise(resolve => setTimeout(resolve, 10));
    expect(core.runner.isActive(taskId)).toBe(false);
    expect(seen.join('\n')).toContain(profileId);
    expect(seen.join('\n')).toContain('"accuracy":1');
    const latestRun = store.detail(taskId).runs.at(-1)!;
    expect(latestRun.snapshot.scoreProfileIds).toContain(profileId);
  } finally {
    await core.runner.shutdown();
    store.close();
  }
});
