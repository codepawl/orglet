import { expect, it } from 'vitest';
import { columnKinds, filterRows, looksNumeric, parseDelimited } from '../../apps/desktop/src/renderer/components/TablePreview';

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
