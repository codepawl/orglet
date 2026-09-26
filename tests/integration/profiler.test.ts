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
  expect(result.datasets[0].id).toEqual({ column: 'id', nulls: 1, duplicateNonNull: 1, repeats: { repeatedRows: 1, groupCount: 1, groups: [{ rows: [3, 4], size: 2 }] } });
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
it('flags the founder metrics sheet: a repeated month, a negative count and a missing value (COD-297)', async () => {
  const csv = 'month,signups,active_users,revenue\nJan,120,80,1200\nFeb,150,95,1350\nMar,,110,\nApr,210,140,1500\nMay,260,-5,1720\nMay,260,175,1720\n';
  const result = await analyze({ files: [file(csv)], idColumn: null });
  const [dataset] = result.datasets;
  const column = (name: string) => dataset.columns.find(entry => entry.name === name)!;
  expect(column('month')).toMatchObject({ type: 'VARCHAR', kind: 'text', misfits: 0, range: null });
  expect(column('active_users')).toMatchObject({ kind: 'number', misfits: 0, range: { minimum: -5, maximum: 175, negatives: 1 } });
  expect(column('signups')).toMatchObject({ kind: 'number', nulls: 1, range: { minimum: 120, maximum: 260, negatives: 0 } });
  // The two May rows differ in one cell, so they are not identical rows; the first column still says they repeat.
  expect(dataset.duplicateRows).toEqual({ repeatedRows: 0, groupCount: 0, groups: [] });
  expect(dataset.firstColumn).toEqual({ column: 'month', repeatedRows: 1, groupCount: 1, groups: [{ rows: [6, 7], size: 2 }] });
  expect(result.checks).toEqual(expect.arrayContaining(['column_kinds', 'number_ranges', 'duplicate_rows', 'first_column_repeats']));
});
it('lists identical rows by the row number a spreadsheet shows, and counts every group', async () => {
  const lines = ['a,b', '1,x', '2,y', '1,x', '3,z', '2,y', '1,x'];
  for (let group = 0; group < 12; group += 1) lines.push(`g${group},same`, `g${group},same`);
  const result = await analyze({ files: [file(`${lines.join('\n')}\n`)], idColumn: null });
  const repeats = result.datasets[0].duplicateRows!;
  expect(repeats.repeatedRows).toBe(3 + 12);
  expect(repeats.groupCount).toBe(14);
  expect(repeats.groups).toHaveLength(10);
  expect(repeats.groups[0]).toEqual({ rows: [2, 4, 7], size: 3 });
  expect(repeats.groups[1]).toEqual({ rows: [3, 6], size: 2 });
  // Categories repeat by design, so the first column is not treated as a row name here.
  expect(result.datasets[0].firstColumn).toBeNull();
  const jsonl = await analyze({ files: [file('{"a":1}\n{"a":2}\n{"a":1}\n', 'jsonl')], idColumn: null });
  expect(jsonl.datasets[0].duplicateRows?.groups).toEqual([{ rows: [1, 3], size: 2 }]);
});
it('sorts values into numbers, dates, dates that do not exist and text that does not fit', async () => {
  const csv = [
    'amount,when,note,mixed',
    '10,2024-01-05,hello,1',
    'n/a,2024-02-30,ok,2',
    '-3.5,31/02/2024,fine,three',
    '1e3,5/1/2024,also,4',
    'inf,2024/03/01 10:30,x,',
    '7,soon,y,5',
  ].join('\n');
  const result = await analyze({ files: [file(`${csv}\n`)], idColumn: null });
  const column = (name: string) => result.datasets[0].columns.find(entry => entry.name === name)!;
  // inf and n/a are not plain numbers; they are the values that do not fit a number column.
  expect(column('amount')).toMatchObject({ kind: 'number', misfits: 2, range: { minimum: -3.5, maximum: 1000, negatives: 1 } });
  expect(column('when')).toMatchObject({ kind: 'date', invalidDates: 2, misfits: 3 });
  expect(column('note')).toMatchObject({ kind: 'text', misfits: 0, invalidDates: 0 });
  expect(column('mixed')).toMatchObject({ kind: 'number', misfits: 1, nulls: 1, range: { minimum: 1, maximum: 5 } });
  const typed = await analyze({ files: [file('{"x":1,"y":"a"}\n{"x":"b","y":"2024-02-30"}\n{"x":2.5}\n', 'jsonl')], idColumn: null });
  const x = typed.datasets[0].columns.find(entry => entry.name === 'x')!;
  expect(x).toMatchObject({ type: 'JSON', kind: 'number', misfits: 1, range: { minimum: 1, maximum: 2.5 } });
  expect(typed.datasets[0].columns.find(entry => entry.name === 'y')).toMatchObject({ kind: 'text', invalidDates: 1 });
});
it('lists repeated IDs by row number and leaves the first column alone when an ID column is chosen', async () => {
  const result = await analyze({ files: [file('id,label\n1,a\n2,b\n1,c\n,d\n')], idColumn: 'id' });
  expect(result.datasets[0].id).toEqual({ column: 'id', nulls: 1, duplicateNonNull: 1, repeats: { repeatedRows: 1, groupCount: 1, groups: [{ rows: [2, 4], size: 2 }] } });
  expect(result.datasets[0].firstColumn).toBeNull();
});
it('checks a file near the 32 MB limit within the time the checker has', async () => {
  const lines = ['id,day,amount,label,region,score'];
  for (let row = 0; row < 600_000; row += 1) lines.push(`${row},2024-${String(row % 12 + 1).padStart(2, '0')}-${String(row % 28 + 1).padStart(2, '0')},${(row % 997) - 20},label-${row % 5000},region-${row % 7},${row % 101}.5`);
  lines.push(lines[1]);
  const csv = `${lines.join('\n')}\n`;
  expect(Buffer.byteLength(csv)).toBeGreaterThan(25 * 1024 * 1024);
  const started = Date.now();
  const result = await analyze({ files: [file(csv)], idColumn: null });
  expect(Date.now() - started).toBeLessThan(18_000);
  const [dataset] = result.datasets;
  expect(dataset.rows).toBe(600_001);
  expect(dataset.duplicateRows).toMatchObject({ repeatedRows: 1, groups: [{ rows: [2, 600_002], size: 2 }] });
  expect(dataset.firstColumn).toMatchObject({ column: 'id', repeatedRows: 1 });
  expect(dataset.columns.find(column => column.name === 'amount')).toMatchObject({ kind: 'number', range: { minimum: -20, maximum: 976 } });
  expect(dataset.columns.find(column => column.name === 'day')).toMatchObject({ kind: 'date', misfits: 0 });
  await expect(analyze({ files: [file(Buffer.alloc(32 * 1024 * 1024 + 1, 'a'))], idColumn: null })).rejects.toThrow('32 MB');
}, 60_000);
it('checks a wide file once instead of parsing it again for every column', async () => {
  // 64 columns: reading the file again per column took past the 18-second limit before COD-297.
  const header = Array.from({ length: 64 }, (_, index) => `c${index}`).join(',');
  const lines = [header];
  for (let row = 0; row < 55_000; row += 1) lines.push(Array.from({ length: 64 }, (_, index) => (row * 7 + index) % 1000).join(','));
  const started = Date.now();
  const result = await analyze({ files: [file(`${lines.join('\n')}\n`)], idColumn: null });
  expect(Date.now() - started).toBeLessThan(18_000);
  expect(result.datasets[0].columns).toHaveLength(64);
  expect(result.datasets[0].columns[63]).toMatchObject({ kind: 'number', range: { minimum: 0, maximum: 999 } });
}, 60_000);
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
    await writeFile(join(root, 'bundle.zip'), Buffer.from([0x50, 0x4b]));
    await mkdir(join(root, 'node_modules')); await writeFile(join(root, 'node_modules', 'ignored.txt'), 'not selected');
    const sources = new Sources(store, input => analyze(input)); const intake = await sources.importFolder(root);
    // An image comes in as preview-only media; an archive is still not a kind Orglet takes.
    expect(intake.sources.map(source => source.name)).toEqual(['data.csv', 'image.png', 'readme.md']);
    expect(intake.sources.find(source => source.name === 'image.png')?.media).toBe('image');
    expect(intake.skipped.map(item => item.name)).toEqual(['bundle.zip', 'node_modules']);
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
