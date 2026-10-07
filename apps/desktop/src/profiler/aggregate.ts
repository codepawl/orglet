import type { AggregateRequest, DatasetProfile } from '../shared/profiles';
import { identifier, type Query } from './column-checks';
import { RunAuditInputError } from './run-audit';

type AggregateResult = NonNullable<DatasetProfile['aggregate']>;

const DATE_PATTERNS: Record<'day' | 'month' | 'year', string> = { day: '%Y-%m-%d', month: '%Y-%m', year: '%Y' };

/** The header of a computed column, e.g. `sum(Revenue)` or `count` for a count of rows. */
export function measureName(measure: AggregateRequest['measures'][number]): string {
  return measure.column === null ? 'count' : `${measure.fn}(${measure.column})`;
}

/** What a group is called: the column's text, or the day, month or year of a date column. */
function groupExpression(column: string, dateBucket: AggregateRequest['dateBucket']): string {
  const name = identifier(column);
  if (!dateBucket) return `CAST(${name} AS VARCHAR)`;
  return `strftime(date_trunc('${dateBucket}', TRY_CAST(${name} AS DATE)), '${DATE_PATTERNS[dateBucket]}')`;
}

function measureExpression(measure: AggregateRequest['measures'][number]): string {
  if (measure.column === null) return 'count(*)';
  const name = identifier(measure.column);
  if (measure.fn === 'count') return `count(${name})`;
  // A CSV is read as text, so a number is read out of it; a cell that is not a number counts as missing.
  return `round(${measure.fn}(TRY_CAST(${name} AS DOUBLE)), 6)`;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Totals by group over one loaded table, for a chart. Only this code builds the SQL: the request names columns that
 * must exist in the file and a fixed set of functions, so nothing the model or the file says is run as SQL.
 */
export async function aggregateTable(query: Query, table: string, sourceId: string, columnNames: readonly string[], request: AggregateRequest): Promise<AggregateResult> {
  const known = new Set(columnNames);
  const missing = [request.groupBy, ...request.measures.flatMap(measure => (measure.column === null ? [] : [measure.column]))].find(column => !known.has(column));
  if (missing !== undefined) throw new RunAuditInputError(`Cột "${missing}" không có trong tệp. Các cột có: ${columnNames.slice(0, 30).join(', ')}.`);
  if (request.measures.some(measure => measure.column === null && measure.fn !== 'count')) throw new RunAuditInputError('Chỉ phép count mới để trống cột.');
  const group = groupExpression(request.groupBy, request.dateBucket);
  const measures = request.measures.map(measureExpression);
  const order = request.sort === 'group' ? '1' : '2 DESC NULLS LAST, 1';
  const records = await query(`SELECT ${group} AS grp, ${measures.map((expression, index) => `${expression} AS m${index}`).join(', ')} FROM ${table} WHERE ${group} IS NOT NULL GROUP BY 1 ORDER BY ${order} LIMIT ${Math.trunc(request.limit)}`);
  const totals = (await query(`SELECT count(DISTINCT ${group}) AS groups, count(*) - count(${group}) AS ungrouped FROM ${table}`))[0];
  return {
    sourceId,
    columns: [request.groupBy, ...request.measures.map(measureName)],
    rows: records.map(record => [String(record.grp), ...request.measures.map((_, index) => numberOrNull(record[`m${index}`]))]),
    groups: Number(totals.groups),
    ungrouped: Number(totals.ungrouped),
  };
}
