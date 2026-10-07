import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { analyze } from '../../apps/desktop/src/profiler/analyze';

// The viewer cannot read Parquet itself, so the checker's DuckDB reads its first rows (file viewer, 2026-10-07).
it('reads the first rows of a Parquet file as text, nulls empty and lists as JSON, with the full row count', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orglet-table-sample-'));
  try {
    const path = join(directory, 'orders.parquet').replaceAll('\\', '/');
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    await connection.run(`COPY (SELECT range AS id, 'item ' || range AS name, CASE WHEN range = 2 THEN NULL ELSE range * 1.5 END AS price, [range, range + 1] AS tags FROM range(300)) TO '${path}' (FORMAT parquet)`);
    connection.closeSync();
    const base64 = (await readFile(path)).toString('base64');
    const result = await analyze({ files: [{ sourceId: randomUUID(), format: 'parquet', base64 }], idColumn: null, sampleRows: 200 });
    const dataset = result.datasets[0];
    expect(dataset.rows).toBe(300);
    expect(dataset.sample?.columns).toEqual(['id', 'name', 'price', 'tags']);
    expect(dataset.sample?.rows).toHaveLength(200);
    // DuckDB writes big integers inside a list as strings in JSON, so they keep every digit.
    expect(dataset.sample?.rows[1]).toEqual(['1', 'item 1', '1.5', '["1","2"]']);
    expect(dataset.sample?.rows[2][2]).toBe('');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('leaves the sample out of an ordinary check', async () => {
  const result = await analyze({ files: [{ sourceId: randomUUID(), format: 'csv', base64: Buffer.from('a,b\n1,2\n').toString('base64') }], idColumn: null });
  expect(result.datasets[0].sample).toBeUndefined();
});
