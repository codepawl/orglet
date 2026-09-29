import type { ColumnFacts, RowRepeats } from '../shared/profiles';

/** Runs one fixed query and returns its rows as JSON values. */
export type Query = (sql: string) => Promise<Record<string, unknown>[]>;

export const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

// A plain number as a person types it in a spreadsheet: no thousands separators, currency signs, inf or nan.
const numberPattern = String.raw`[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?`;
// Year first, as ISO 8601 writes it (2024-02-30, 2024/2/3, optionally with a time).
const yearFirstDatePattern = String.raw`\d{4}[-/]\d{1,2}[-/]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?)?`;
// Day or month first with a four-digit year (31/02/2024, 5.1.2024, 05-01-2024).
const dayFirstDatePattern = String.raw`\d{1,2}[/.-]\d{1,2}[/.-]\d{4}`;

const numericType = /^(U?TINYINT|U?SMALLINT|U?INTEGER|U?BIGINT|U?HUGEINT|FLOAT|DOUBLE|DECIMAL\(\d+,\d+\))$/;
const dateType = /^(DATE|TIMESTAMP.*|TIME.*)$/;
const textType = /^(VARCHAR|JSON)$/;

/** Most rows of each repeated group that are listed by number, and most groups listed. The counts stay complete. */
const listedRowsPerGroup = 10;
const listedGroups = 10;

/**
 * The column's values as trimmed text, blank cells left out. A JSON column holds mixed JSON values, so its strings are
 * unquoted first and every other value is read as the text JSON writes for it.
 */
function textValue(column: string, type: string) {
  const name = identifier(column);
  const text = type === 'JSON'
    ? `CASE json_type(${name}) WHEN 'VARCHAR' THEN ${name} ->> '$' WHEN 'NULL' THEN NULL ELSE CAST(${name} AS VARCHAR) END`
    : name;
  return `NULLIF(trim(${text}), '')`;
}

/**
 * The empty and distinct counts every column gets, plus what kind of values it holds. A text column (every CSV
 * column, and a JSONL column whose values have mixed types) is sorted value by value: plain numbers, dates, and
 * values that look like a date but name a day that does not exist. Whichever of number or date holds most values
 * decides the kind; the values that do not fit are counted. Numbers also get their lowest, highest and negatives.
 */
export async function columnFacts(query: Query, table: string, column: string, type: string): Promise<ColumnFacts> {
  const name = identifier(column);
  const counts = `count(*) FILTER (WHERE ${name} IS NULL) AS missing, count(DISTINCT ${name}) AS unique_values`;
  if (textType.test(type)) {
    const [row] = await query(`
      SELECT ${counts}, count(value) AS present,
        count(*) FILTER (WHERE is_number) AS numbers,
        min(number) FILTER (WHERE is_number) AS minimum,
        max(number) FILTER (WHERE is_number) AS maximum,
        count(*) FILTER (WHERE is_number AND number < 0) AS negatives,
        count(*) FILTER (WHERE looks_like_date) AS date_like,
        count(*) FILTER (WHERE looks_like_date AND is_date) AS dates
      FROM (
        SELECT ${name}, value,
          TRY_CAST(value AS DOUBLE) AS number,
          regexp_full_match(value, '${numberPattern}') AND isfinite(TRY_CAST(value AS DOUBLE)) AS is_number,
          regexp_full_match(value, '${yearFirstDatePattern}') OR regexp_full_match(value, '${dayFirstDatePattern}') AS looks_like_date,
          CASE
            WHEN regexp_full_match(value, '${yearFirstDatePattern}') THEN TRY_CAST(value AS TIMESTAMP) IS NOT NULL
            WHEN regexp_full_match(value, '${dayFirstDatePattern}') THEN try_strptime(regexp_replace(value, '[.-]', '/', 'g'), ['%d/%m/%Y', '%m/%d/%Y']) IS NOT NULL
            ELSE false
          END AS is_date
        FROM (SELECT ${name}, ${textValue(column, type)} AS value FROM ${table})
      )`);
    return textColumnFacts(column, type, row);
  }
  if (numericType.test(type)) {
    const number = `CAST(${name} AS DOUBLE)`;
    const [row] = await query(`
      SELECT ${counts},
        count(*) FILTER (WHERE isfinite(${number})) AS numbers,
        min(${number}) FILTER (WHERE isfinite(${number})) AS minimum,
        max(${number}) FILTER (WHERE isfinite(${number})) AS maximum,
        count(*) FILTER (WHERE ${number} < 0) AS negatives
      FROM ${table}`);
    const base = baseFacts(column, type, row);
    const range = Number(row.numbers) > 0 ? { minimum: Number(row.minimum), maximum: Number(row.maximum), negatives: Number(row.negatives) } : null;
    return { ...base, kind: range ? 'number' : 'empty', misfits: 0, invalidDates: 0, range };
  }
  const [row] = await query(`SELECT ${counts} FROM ${table}`);
  const base = baseFacts(column, type, row);
  const present = Number(row.unique_values) > 0;
  const kind = !present ? 'empty' : dateType.test(type) ? 'date' : 'other';
  return { ...base, kind, misfits: 0, invalidDates: 0, range: null };
}

function baseFacts(column: string, type: string, row: Record<string, unknown>) {
  return { name: column, type, nulls: Number(row.missing), distinctNonNull: Number(row.unique_values) };
}

function textColumnFacts(column: string, type: string, row: Record<string, unknown>): ColumnFacts {
  const base = baseFacts(column, type, row);
  const present = Number(row.present);
  const numbers = Number(row.numbers);
  const dateLike = Number(row.date_like);
  const dates = Number(row.dates);
  const invalidDates = dateLike - dates;
  const range = numbers > 0 ? { minimum: Number(row.minimum), maximum: Number(row.maximum), negatives: Number(row.negatives) } : null;
  if (present === 0) return { ...base, kind: 'empty', misfits: 0, invalidDates: 0, range: null };
  if (numbers >= dateLike && numbers * 2 > present) return { ...base, kind: 'number', misfits: present - numbers, invalidDates, range };
  if (dateLike * 2 > present) return { ...base, kind: 'date', misfits: present - dates, invalidDates, range: null };
  return { ...base, kind: 'text', misfits: 0, invalidDates, range: null };
}

/**
 * Rows that share a key, found in two passes so memory stays bounded: first the keys that occur more than once,
 * then, for rows with one of those keys only, the first few row numbers of each group. `rowOffset` turns a position
 * in the data into the row number a person sees (1 for a CSV, whose row 1 holds the column names). With
 * `onlyWhereRowsDiffer` (a whole-row key), a key whose rows are all identical is left out, because those rows are
 * already reported as identical rows.
 */
export async function repeatedRows(query: Query, table: string, key: string, rowOffset: number, onlyWhereRowsDiffer?: string): Promise<RowRepeats> {
  const rowVersion = onlyWhereRowsDiffer ?? 'NULL';
  const rowsDiffer = onlyWhereRowsDiffer ? 'AND count(DISTINCT row_version) > 1' : '';
  const rows = await query(`
    WITH numbered AS (SELECT row_number() OVER () AS position, ${key} AS row_key, ${rowVersion} AS row_version FROM ${table}),
    repeated AS MATERIALIZED (SELECT row_key FROM numbered WHERE row_key IS NOT NULL GROUP BY row_key HAVING count(*) > 1 ${rowsDiffer})
    SELECT min(position, ${listedRowsPerGroup}) AS positions, count(*) AS size,
      count(*) OVER () AS group_count, sum(count(*) - 1) OVER () AS repeated_rows
    FROM numbered
    WHERE row_key IN (SELECT row_key FROM repeated)
    GROUP BY row_key
    ORDER BY min(position)
    LIMIT ${listedGroups}`);
  if (!rows.length) return { repeatedRows: 0, groupCount: 0, groups: [] };
  const groups = rows.map(row => ({
    rows: (row.positions as unknown[]).map(position => Number(position) + rowOffset),
    size: Number(row.size),
  }));
  return { repeatedRows: Number(rows[0].repeated_rows), groupCount: Number(rows[0].group_count), groups };
}

/**
 * The key for whole-row repeats: a 64-bit hash of every column in order, so two rows match when every cell does. A
 * hash keeps the memory to eight bytes a row; the chance that two different rows share one is about one in a hundred
 * thousand even for the most rows a 32 MB file can hold, and far smaller for ordinary files.
 */
export function wholeRowKey(columns: string[]) {
  return `hash(${columns.map(identifier).join(', ')})`;
}

/**
 * The first column usually names each row (a month, a date, a customer). It is checked for repeats only when its
 * values are almost all different, so a column of categories, where repeats are the point, is left alone.
 */
export function firstColumnLooksLikeRowName(column: ColumnFacts, rows: number) {
  const present = rows - column.nulls;
  if (present < 2) return false;
  if (column.distinctNonNull === present) return false;
  return column.distinctNonNull >= present * 0.8;
}
