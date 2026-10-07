import { expect, it } from 'vitest';
import { columnKinds, filterRows, looksNumeric, nextSort, parseDelimited, sortRows } from '../../apps/desktop/src/renderer/components/TablePreview';

// The table view decides a column's alignment from its cells and filters rows by any cell (file viewer revamp).
it('reads numbers with signs, thousands commas, decimals, percents and currency marks', () => {
  for (const cell of ['42', '-8.3', '+7', '1,204', '1,204.50', '12%', '$9.99', '1e6', '.5']) expect(looksNumeric(cell), cell).toBe(true);
  for (const cell of ['', 'abc', '2026-02-02', '12 apples', '1,20', '-', '.', 'v1.2.3']) expect(looksNumeric(cell), cell).toBe(false);
});

it('right-aligns a column only when nearly every filled cell is a number', () => {
  const rows = parseDelimited('id,name,growth,note\n1,Ann,2.5,\n2,Bo,,ok\n3,Cy,-1.0,3\n4,Di,4,x', ',');
  const [header, ...body] = rows;
  expect(columnKinds(header.length, body)).toEqual(['number', 'text', 'number', 'text']);
});

it('keeps an empty column as text', () => {
  expect(columnKinds(2, [['1', ''], ['2', '']])).toEqual(['number', 'text']);
});

it('filters rows by any cell, ignoring case, and keeps each row\'s place in the file', () => {
  const body = [['1', 'North', 'Alpha'], ['2', 'South', 'beta'], ['3', 'North', 'Gamma']];
  expect(filterRows(body, '')).toHaveLength(3);
  expect(filterRows(body, ' north ').map(match => match.position)).toEqual([1, 3]);
  expect(filterRows(body, 'BETA').map(match => match.row[0])).toEqual(['2']);
  expect(filterRows(body, 'zzz')).toEqual([]);
});

it('sorts a number column by value and a text column with numbers inside words, empty cells last', () => {
  const rows = filterRows([['b', '1,204'], ['a', ''], ['item 10', '-8.3'], ['item 2', '12%']], '');
  const kinds = ['text', 'number'] as const;
  expect(sortRows(rows, { column: 1, direction: 'ascending' }, kinds).map(item => item.row[1])).toEqual(['-8.3', '12%', '1,204', '']);
  expect(sortRows(rows, { column: 1, direction: 'descending' }, kinds).map(item => item.row[1])).toEqual(['1,204', '12%', '-8.3', '']);
  expect(sortRows(rows, { column: 0, direction: 'ascending' }, kinds).map(item => item.row[0])).toEqual(['a', 'b', 'item 2', 'item 10']);
  // The rows keep their place in the file for the row-number gutter.
  expect(sortRows(rows, { column: 1, direction: 'ascending' }, kinds).map(item => item.position)).toEqual([3, 4, 1, 2]);
  expect(sortRows(rows, undefined, kinds)).toBe(rows);
});

it('cycles a column header through ascending, descending and the file order', () => {
  expect(nextSort(undefined, 2)).toEqual({ column: 2, direction: 'ascending' });
  expect(nextSort({ column: 2, direction: 'ascending' }, 2)).toEqual({ column: 2, direction: 'descending' });
  expect(nextSort({ column: 2, direction: 'descending' }, 2)).toBeUndefined();
  expect(nextSort({ column: 2, direction: 'descending' }, 0)).toEqual({ column: 0, direction: 'ascending' });
});
