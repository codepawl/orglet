import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { analyze } from '../../apps/desktop/src/profiler/analyze';
import { columnKindLabel, columnRangeLabel, datasetHasNotesCheck, datasetNotes } from '../../apps/desktop/src/renderer/components/checkNotes';

/** The sentences a data check shows under its table (COD-297), from real checker results. */
const check = async (csv: string, idColumn: string | null = null) => {
  const result = await analyze({ files: [{ sourceId: randomUUID(), format: 'csv', base64: Buffer.from(csv).toString('base64') }], idColumn });
  return result.datasets[0];
};

describe('data check notes', () => {
  it('names the founder sheet repeated month and negative count in plain words', async () => {
    const dataset = await check('month,signups,active_users,revenue\nJan,120,80,1200\nFeb,150,95,1350\nMar,,110,\nApr,210,140,1500\nMay,260,-5,1720\nMay,260,175,1720\n');
    expect(datasetNotes(dataset)).toEqual([
      'The first column, month, usually names each row, but rows 6 and 7 have the same value.',
      'active_users: 1 negative value.',
    ]);
    const activeUsers = dataset.columns.find(column => column.name === 'active_users')!;
    expect(columnKindLabel(activeUsers)).toBe('Number');
    expect(columnRangeLabel(activeUsers)).toBe('-5 – 175');
    expect(columnKindLabel(dataset.columns[0])).toBe('Text');
    expect(columnRangeLabel(dataset.columns[0])).toBe('');
  });
  it('lists identical rows, cells of the wrong kind and dates that do not exist', async () => {
    const lines = ['day,amount'];
    for (let row = 0; row < 12; row += 1) lines.push('2024-01-01,5');
    lines.push('2024-02-30,n/a', 'soon,7');
    const notes = datasetNotes(await check(`${lines.join('\n')}\n`));
    expect(notes).toEqual([
      'Rows 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, and 2 more are identical.',
      'day: 1 cell is not a date.',
      'day: 1 cell is written like a date that does not exist.',
      'amount: 1 cell is not a number.',
    ]);
  });
  it('lists repeated IDs by row and says when nothing stands out', async () => {
    expect(datasetNotes(await check('id,label\n1,a\n2,b\n1,c\n', 'id'))).toEqual(['Rows 2 and 4 have the same ID.']);
    const clean = await check('id,label\n1,a\n2,b\n');
    expect(datasetNotes(clean)).toEqual([]);
    expect(datasetHasNotesCheck(clean)).toBe(true);
  });
  it('keeps a check saved before COD-297 readable without new sentences', () => {
    const saved = { sourceId: randomUUID(), rows: 2, columns: [{ name: 'id', type: 'VARCHAR', nulls: 0, distinctNonNull: 2 }], id: null };
    expect(datasetNotes(saved)).toEqual([]);
    expect(datasetHasNotesCheck(saved)).toBe(false);
    expect(columnKindLabel(saved.columns[0])).toBe('VARCHAR');
  });
});
