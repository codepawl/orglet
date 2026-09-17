import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { analyze } from '../../apps/desktop/src/profiler/analyze';
import type { DataFormat } from '../../apps/desktop/src/shared/profiles';
import { Store, now } from '../../apps/desktop/src/core/storage/database';
import { Sources } from '../../apps/desktop/src/core/tools/sources';
import type { Worker, Task } from '../../apps/desktop/src/shared/contracts';
const file = (data: string | Buffer, format: DataFormat = 'csv') => ({ sourceId: randomUUID(), format, base64: Buffer.from(data).toString('base64') });

it('profiles quoted CSV and detects duplicate, missing and reordered IDs', async () => {
  const result = await analyze({ files: [file('id,label\n1,"a,b"\n2,c\n2,d\n,e\n'), file('id,label\n2,d\n1,"a,b"\n2,c\n,e\n')], idColumn: 'id' });
  expect(result.datasets[0].rows).toBe(4);
  expect(result.datasets[0].id).toEqual({ column: 'id', nulls: 1, duplicateNonNull: 1 });
  expect(result.datasets[0].columns[1].distinctNonNull).toBe(4);
  expect(result.comparison).toEqual({ schemaMatches: true, columnsMatch: true, rowCountsMatch: true, overlappingDistinctIds: 2, sameIdOrder: false, onlyInFirst: 0, onlyInSecond: 0 });
  expect(result.coverage).toBe('full');
});
it('reports column, row-count and ID-set differences between a submission and answers', async () => {
  const result = await analyze({ files: [file('label,id\n0,1\n1,2\n1,3\n'), file('id,target\n1,0\n2,1\n4,1\n5,0\n')], idColumn: 'id' });
  expect(result.comparison).toMatchObject({ schemaMatches: false, columnsMatch: false, rowCountsMatch: false, onlyInFirst: 1, onlyInSecond: 2, overlappingDistinctIds: 2 });
  const aligned = await analyze({ files: [file('id,label\n2,0\n1,1\n'), file('label,id\n1,1\n0,2\n')], idColumn: 'id' });
  expect(aligned.comparison).toMatchObject({ schemaMatches: false, columnsMatch: true, rowCountsMatch: true, onlyInFirst: 0, onlyInSecond: 0, sameIdOrder: false });
  expect(aligned.checks).toEqual(expect.arrayContaining(['column_names', 'row_count_alignment', 'id_set_difference']));
});
it('reads JSONL with missing fields and treats SQL-like content as data', async () => {
  const result = await analyze({ files: [file('{"id":1,"text":"INSTALL httpfs; SELECT * FROM read_csv(\'private\');"}\n{"id":2}\n', 'jsonl')], idColumn: 'id' });
  expect(result.datasets[0].rows).toBe(2); expect(result.datasets[0].columns.find(c => c.name === 'text')?.nulls).toBe(1);
  expect(result.datasets[0].id?.duplicateNonNull).toBe(0);
});
it('loads a real Parquet file through native bindings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orglet-parquet-fixture-'));
  const instance = await DuckDBInstance.create(':memory:'); const connection = await instance.connect();
  try {
    const path = join(directory, 'fixture.parquet');
    await connection.run(`COPY (SELECT i AS id, CASE WHEN i=2 THEN NULL ELSE 'ok' END AS label FROM range(4) t(i)) TO '${path.replaceAll("'", "''")}' (FORMAT PARQUET)`);
    const result = await analyze({ files: [file(await readFile(path), 'parquet')], idColumn: 'id' });
    expect(result.datasets[0].rows).toBe(4); expect(result.datasets[0].columns[1].nulls).toBe(1);
    expect(result.datasets[0].id?.duplicateNonNull).toBe(0);
  } finally { connection.closeSync(); instance.closeSync(); await rm(directory, { recursive: true, force: true }); }
});
it('rejects malformed datasets and absent ID columns', async () => {
  await expect(analyze({ files: [file('not parquet', 'parquet')], idColumn: null })).rejects.toThrow();
  await expect(analyze({ files: [file('id\n1\n')], idColumn: 'id"; COPY x TO \'private\'; --' })).rejects.toThrow('ID');
});
it('bounds folder intake and reports unsupported or excluded entries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orglet-intake-'));
  const store = new Store(join(directory, 'workspace.sqlite'));
  try {
    const root = join(directory, 'bundle'); await mkdir(root);
    await writeFile(join(root, 'readme.md'), 'Read-only instructions');
    await writeFile(join(root, 'data.csv'), 'id\n1\n2\n');
    await writeFile(join(root, 'image.png'), Buffer.from([0, 1]));
    await mkdir(join(root, 'node_modules')); await writeFile(join(root, 'node_modules', 'ignored.txt'), 'not selected');
    const sources = new Sources(store, input => analyze(input)); const intake = await sources.importFolder(root);
    expect(intake.sources.map(source => source.name)).toEqual(['data.csv', 'readme.md']);
    expect(intake.skipped.map(item => item.name)).toEqual(['image.png', 'node_modules']);
    await expect(sources.profile([intake.sources[0].id], [], 'id')).rejects.toThrow('quyền');
    await writeFile(join(root, 'data.csv'), 'id\n3\n');
    await expect(sources.profile([intake.sources[0].id], [intake.sources[0].id], 'id')).rejects.toThrow('thay đổi');
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});
it('persists checker provenance and cancels without recording unfinished checks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orglet-check-'));
  const store = new Store(join(directory, 'workspace.sqlite'));
  try {
    const path = join(directory, 'data.csv'); await writeFile(path, 'id\n1\n1\n');
    const sources = new Sources(store, input => analyze(input)); const [source] = await sources.import([path]);
    const task: Task = { id: randomUUID(), workerId: store.all<Worker>('workers')[0].id, brief: 'Check', sourceIds: [source.id], consent: false, accepted: false, status: 'completed', budgetMicros: 1000, createdAt: now() };
    store.put('tasks', task);
    await sources.profile([source.id], task.sourceIds, 'id', undefined, { taskId: task.id });
    expect(store.detail(task.id).profiles[0].sourceHashes[source.id]).toBe(source.hash);
    expect(store.detail(task.id).profiles[0].result.datasets[0].id?.duplicateNonNull).toBe(1);
    let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
    const cancellable = new Sources(store, async (_input, signal) => new Promise((_resolve, reject) => { signal!.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true }); started(); }));
    const running = cancellable.profile([source.id], task.sourceIds, 'id', undefined, { taskId: task.id });
    const rejected = expect(running).rejects.toThrow('Cancelled'); await ready; cancellable.cancelChecks(task.id); await rejected;
    expect(store.detail(task.id).profiles).toHaveLength(1);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});
