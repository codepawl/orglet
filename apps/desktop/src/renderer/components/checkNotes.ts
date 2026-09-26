import { currentLocale, t, translated } from '../i18n';
import type { ColumnFacts, DatasetProfile, RowRepeats } from '../../shared/profiles';

type Dataset = DatasetProfile['datasets'][number];

/** What a column holds, in plain words. `other` shows the file's own type instead (a Parquet boolean, a list). */
const kindLabels: Record<Exclude<NonNullable<ColumnFacts['kind']>, 'other'>, string> = translated({ number: 'Số', date: 'Ngày', text: 'Chữ', empty: 'Trống' });

export function formatNumber(value: number) {
  return value.toLocaleString(currentLocale(), { maximumFractionDigits: 6 });
}

/** The column's kind for the table, or its stored type for a check saved before kinds existed (COD-297). */
export function columnKindLabel(column: ColumnFacts) {
  if (!column.kind || column.kind === 'other') return column.type;
  return kindLabels[column.kind];
}

/** "-5 – 175" for a number column, empty for anything else. */
export function columnRangeLabel(column: ColumnFacts) {
  if (!column.range) return '';
  if (column.range.minimum === column.range.maximum) return formatNumber(column.range.minimum);
  return `${formatNumber(column.range.minimum)} – ${formatNumber(column.range.maximum)}`;
}

/** "6 and 7", or "2, 4, 7 and 12 more" when the group has more rows than were listed. */
function rowList(group: RowRepeats['groups'][number]) {
  const parts = group.rows.map(formatNumber);
  const unlisted = group.size - group.rows.length;
  if (unlisted > 0) parts.push(t('{0} dòng khác', [formatNumber(unlisted)]));
  return new Intl.ListFormat(currentLocale(), { type: 'conjunction' }).format(parts);
}

function columnNotes(column: ColumnFacts) {
  const notes: string[] = [];
  const negatives = column.range?.negatives ?? 0;
  if (negatives === 1) notes.push(t('{0}: 1 giá trị âm.', [column.name]));
  if (negatives > 1) notes.push(t('{0}: {1} giá trị âm.', [column.name, formatNumber(negatives)]));
  const misfits = column.misfits ?? 0;
  const invalidDates = column.invalidDates ?? 0;
  if (column.kind === 'number' && misfits === 1) notes.push(t('{0}: 1 ô không phải số.', [column.name]));
  if (column.kind === 'number' && misfits > 1) notes.push(t('{0}: {1} ô không phải số.', [column.name, formatNumber(misfits)]));
  // In a date column the misfits include the dates that do not exist; those get their own sentence below.
  const notDates = column.kind === 'date' ? misfits - invalidDates : 0;
  if (notDates === 1) notes.push(t('{0}: 1 ô không phải ngày.', [column.name]));
  if (notDates > 1) notes.push(t('{0}: {1} ô không phải ngày.', [column.name, formatNumber(notDates)]));
  if (invalidDates === 1) notes.push(t('{0}: 1 ô ghi như ngày nhưng không có ngày đó.', [column.name]));
  if (invalidDates > 1) notes.push(t('{0}: {1} ô ghi như ngày nhưng không có ngày đó.', [column.name, formatNumber(invalidDates)]));
  return notes;
}

function unlistedGroups(repeats: RowRepeats) {
  return repeats.groupCount - repeats.groups.length;
}

/**
 * The things in one checked file worth a second look, one plain sentence each: identical rows, a first column that
 * names rows but repeats, repeated IDs, negative numbers, and cells that do not fit their column. Empty when there is
 * nothing to say or the check was saved before these facts existed.
 */
export function datasetNotes(dataset: Dataset) {
  const notes: string[] = [];
  const duplicates = dataset.duplicateRows;
  if (duplicates) {
    for (const group of duplicates.groups) notes.push(t('Dòng {0} giống hệt nhau.', [rowList(group)]));
    const more = unlistedGroups(duplicates);
    if (more === 1) notes.push(t('Còn 1 nhóm dòng giống hệt nhau khác.'));
    if (more > 1) notes.push(t('Còn {0} nhóm dòng giống hệt nhau khác.', [formatNumber(more)]));
  }
  const first = dataset.firstColumn;
  if (first) {
    for (const group of first.groups) notes.push(t('Cột đầu {0} thường gọi tên từng dòng, nhưng dòng {1} có cùng giá trị.', [first.column, rowList(group)]));
    const more = unlistedGroups(first);
    if (more === 1) notes.push(t('Cột {0} còn 1 giá trị lặp khác.', [first.column]));
    if (more > 1) notes.push(t('Cột {0} còn {1} giá trị lặp khác.', [first.column, formatNumber(more)]));
  }
  const idRepeats = dataset.id?.repeats;
  if (idRepeats) {
    for (const group of idRepeats.groups) notes.push(t('Dòng {0} có cùng mã.', [rowList(group)]));
    const more = unlistedGroups(idRepeats);
    if (more === 1) notes.push(t('Còn 1 mã lặp khác.'));
    if (more > 1) notes.push(t('Còn {0} mã lặp khác.', [formatNumber(more)]));
  }
  for (const column of dataset.columns) notes.push(...columnNotes(column));
  return notes;
}

/** True for a check that looked for repeats and wrong kinds, so an empty notes list can say it found none. */
export function datasetHasNotesCheck(dataset: Dataset) {
  return dataset.duplicateRows !== undefined;
}
