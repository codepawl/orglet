import { useDeferredValue, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button, Input, Tooltip } from '@codepawlhq/orglet-ui';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { currentLocale, t } from '../i18n';
import { PreviewBar } from './PreviewBar';
import type { TableSample } from '../../shared/profiles';

/** How many rows are drawn at first, and how many more each "show more" adds, so a large dataset stays quick to open. */
const ROW_PAGE = 200;
/** The most rows one "show more" adds. */
const MAX_ROW_STEP = 2000;
/** A cell longer than this is cut by the column width, so its full value is offered on hover. */
const LONG_CELL_LENGTH = 40;
/** Share of a column's filled cells that must read as numbers for the column to be right-aligned. */
const NUMERIC_SHARE = 0.9;
/** How many rows are sampled to decide a column's kind, so a huge file is not scanned twice. */
const KIND_SAMPLE_ROWS = 500;
/** The narrowest a column can be dragged to, and the widest. */
const COLUMN_WIDTH = { least: 48, most: 900 } as const;

export type ColumnKind = 'number' | 'text';

/** "1,204 rows · 3 columns", with each count's own word for one (COD-292). */
function rowCountLabel(rowCount: number): string {
  return rowCount === 1 ? t('1 dòng') : t('{0} dòng', [rowCount.toLocaleString(currentLocale())]);
}

function columnCountLabel(columnCount: number): string {
  return columnCount === 1 ? t('1 cột') : t('{0} cột', [columnCount.toLocaleString(currentLocale())]);
}

export function tableSizeLabel(rowCount: number, columnCount: number): string {
  const rows = rowCountLabel(rowCount);
  const columns = columnCountLabel(columnCount);
  return `${rows} · ${columns}`;
}

/** Splits delimited text into rows, honouring quoted cells with embedded delimiters, quotes and line breaks. */
export function parseDelimited(text: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/\r\n?/g, '\n');
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index += 1; continue; }
      if (character === '"') { quoted = false; continue; }
      cell += character;
      continue;
    }
    if (character === '"' && cell === '') { quoted = true; continue; }
    if (character === delimiter) { row.push(cell); cell = ''; continue; }
    if (character === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += character;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const NUMBER_PATTERN = /^[-+−]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:e[-+]?\d+)?%?$/i;

/** Whether a cell reads as a number: an optional sign or currency mark, digits with optional thousands commas, a decimal part or a percent. */
export function looksNumeric(cell: string): boolean {
  const trimmed = cell.trim().replace(/^[$€£¥₫]\s?/, '');
  return /\d/.test(trimmed) && NUMBER_PATTERN.test(trimmed);
}

/** Each column's kind: numbers when nearly every filled cell of a sample of rows is one, text otherwise. */
export function columnKinds(columnCount: number, body: string[][]): ColumnKind[] {
  const sample = body.slice(0, KIND_SAMPLE_ROWS);
  return Array.from({ length: columnCount }, (_, column) => {
    const filled = sample.map(row => row[column] ?? '').filter(cell => cell.trim() !== '');
    if (filled.length === 0) return 'text';
    const numeric = filled.filter(looksNumeric).length;
    return numeric / filled.length >= NUMERIC_SHARE ? 'number' : 'text';
  });
}

/** The rows with any cell containing `query` (case-insensitive), each with its place in the file for the row-number gutter. */
export function filterRows(body: string[][], query: string): Array<{ row: string[]; position: number }> {
  const needle = query.trim().toLowerCase();
  const all = body.map((row, index) => ({ row, position: index + 1 }));
  if (!needle) return all;
  return all.filter(({ row }) => row.some(cell => cell.toLowerCase().includes(needle)));
}

/** A column the rows are sorted by, and which way; none keeps the file's order. */
export type TableSort = { column: number; direction: 'ascending' | 'descending' } | undefined;

/** A number cell's value for sorting: signs, thousands commas, a currency mark and a percent are read; anything else is not a number. */
function numericValue(cell: string): number | undefined {
  if (!looksNumeric(cell)) return undefined;
  const plain = cell.trim().replace(/^[$€£¥₫]\s?/, '').replace(/,/g, '').replace(/%$/, '').replace('−', '-');
  const value = Number(plain);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The rows in the order of one column: numbers by value in a number column, text in the language's order with numbers
 * inside words read as numbers ("item 2" before "item 10"). Empty cells always go last, whichever way.
 */
export function sortRows<Row extends { row: string[] }>(rows: Row[], sort: TableSort, kinds: readonly ColumnKind[]): Row[] {
  if (!sort) return rows;
  const collator = new Intl.Collator(currentLocale(), { numeric: true, sensitivity: 'base' });
  const sign = sort.direction === 'ascending' ? 1 : -1;
  const kind = kinds[sort.column];
  return [...rows].sort((first, second) => {
    const left = first.row[sort.column] ?? '';
    const right = second.row[sort.column] ?? '';
    if (left.trim() === '' || right.trim() === '') return (left.trim() === '' ? 1 : 0) - (right.trim() === '' ? 1 : 0);
    if (kind === 'number') {
      const leftNumber = numericValue(left);
      const rightNumber = numericValue(right);
      if (leftNumber !== undefined && rightNumber !== undefined) return (leftNumber - rightNumber) * sign;
    }
    return collator.compare(left, right) * sign;
  });
}

/** The next sort after clicking a column's header: ascending, then descending, then the file's order again. */
export function nextSort(current: TableSort, column: number): TableSort {
  if (current?.column !== column) return { column, direction: 'ascending' };
  if (current.direction === 'ascending') return { column, direction: 'descending' };
  return undefined;
}

function Cell({ value, kind, width }: { value: string; kind: ColumnKind; width?: number }) {
  const className = kind === 'number' ? 'cell-number' : undefined;
  const style = width ? { maxWidth: width } : undefined;
  if (value === '') return <td className={className} style={style}><span className="cell-empty" role="img" aria-label={t('Ô này trống')}>–</span></td>;
  if (value.length <= LONG_CELL_LENGTH && !width) return <td className={className}>{value}</td>;
  return <td className={className} style={style}><Tooltip label={value}><span className="cell-long">{value}</span></Tooltip></td>;
}

/** What the bar says: how big the file is, how much of it is drawn, or how many rows match the filter. */
function summaryLabel(total: number, columnCount: number, matched: number, drawn: number, filtering: boolean): string {
  if (filtering) return t('Khớp {0} trong {1} dòng', [matched.toLocaleString(currentLocale()), total.toLocaleString(currentLocale())]);
  if (drawn < total) return `${t('Đang hiện {0} trong {1} dòng', [drawn.toLocaleString(currentLocale()), total.toLocaleString(currentLocale())])} · ${columnCountLabel(columnCount)}`;
  return tableSizeLabel(total, columnCount);
}

/**
 * A CSV or TSV file as the table it is, in the way GitHub and Quick Look show one: the first row as a sticky header,
 * a row-number gutter, numbers right-aligned in tabular figures, empty cells marked quietly and long values cut with
 * the whole value on hover. A filter box narrows the rows as you type. Only the first rows are drawn; the bar says
 * how many of the total, and more come on request.
 */
export function TablePreview({ text, delimiter, sample }: { text?: string; delimiter?: ',' | '\t'; sample?: TableSample }) {
  // A Parquet file comes as rows the checker read; a CSV or TSV as its text.
  const rows = useMemo(() => sample ? [sample.columns, ...sample.rows] : parseDelimited(text ?? '', delimiter ?? ','), [sample, text, delimiter]);
  const [header, ...body] = rows;
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(ROW_PAGE);
  const [sort, setSort] = useState<TableSort>();
  // Widths the person dragged a column to; a column not dragged fits its content as before.
  const [widths, setWidths] = useState<Record<number, number>>({});
  const filterInput = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);
  const kinds = useMemo(() => columnKinds(header?.length ?? 0, body), [header, body]);
  const filtered = useMemo(() => filterRows(body, deferredQuery), [body, deferredQuery]);
  const matches = useMemo(() => sortRows(filtered, sort, kinds), [filtered, sort, kinds]);
  // Ctrl+F (Cmd+F on a Mac) goes to the filter while a table is open, the way a find bar would.
  useEffect(() => {
    const findInTable = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'f' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      filterInput.current?.focus();
      filterInput.current?.select();
    };
    window.addEventListener('keydown', findInTable);
    return () => window.removeEventListener('keydown', findInTable);
  }, []);
  const resizeColumn = (column: number, event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const headerCell = event.currentTarget.parentElement;
    if (!headerCell) return;
    const startX = event.clientX;
    const startWidth = headerCell.getBoundingClientRect().width;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const width = Math.round(Math.min(COLUMN_WIDTH.most, Math.max(COLUMN_WIDTH.least, startWidth + moveEvent.clientX - startX)));
      setWidths(current => ({ ...current, [column]: width }));
    };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  };
  if (!header) return <p className="preview-state">{t('Tệp trống.')}</p>;
  const filtering = deferredQuery.trim() !== '';
  const drawn = matches.slice(0, limit);
  const remaining = matches.length - drawn.length;
  // Each request doubles what is drawn, up to a bounded step, so a very long file is reachable without a thousand clicks.
  const step = Math.min(MAX_ROW_STEP, Math.max(ROW_PAGE, drawn.length));
  return <div className="table-preview">
    <PreviewBar summary={sample && sample.total > body.length && !filtering
      ? t('Đang hiện {0} dòng đầu trong {1} dòng', [body.length.toLocaleString(currentLocale()), sample.total.toLocaleString(currentLocale())])
      : summaryLabel(body.length, header.length, matches.length, drawn.length, filtering)}>
      <div className="preview-search">
        <Search size={14} aria-hidden="true" />
        <Input ref={filterInput} type="search" aria-label={t('Lọc dòng')} placeholder={t('Lọc dòng…')} value={query}
          onChange={event => { setQuery(event.target.value); setLimit(ROW_PAGE); }}
          onKeyDown={event => { if (event.key === 'Escape' && query) { event.stopPropagation(); setQuery(''); } }} />
      </div>
    </PreviewBar>
    {/* A wide table scrolls sideways inside its frame on purpose, with the row numbers held in place. */}
    <div className="preview-table-scroll" data-align-ignore="overflow" tabIndex={0} role="region" aria-label={t('Bảng dữ liệu')}>
      <table>
        <thead>
          <tr>
            <th scope="col" className="row-number" aria-label={t('Số dòng')} />
            {header.map((cell, index) => {
              const sorted = sort?.column === index ? sort.direction : undefined;
              const width = widths[index];
              return <th key={index} scope="col" aria-sort={sorted ?? 'none'} className={kinds[index] === 'number' ? 'cell-number' : undefined}
                style={width ? { width, minWidth: width, maxWidth: width } : undefined}>
                {/* The header sorts its column: ascending, descending, then the file's order. */}
                <Button variant="ghost" className="column-sort" onClick={() => setSort(current => nextSort(current, index))}
                  aria-label={t('Sắp xếp theo {0}', [cell || t('cột {0}', [index + 1])])}>
                  <span className="column-name">{cell}</span>
                  {sorted === 'ascending' && <ArrowUp size={12} aria-hidden="true" />}
                  {sorted === 'descending' && <ArrowDown size={12} aria-hidden="true" />}
                </Button>
                <span className="column-resize" role="separator" aria-orientation="vertical" aria-label={t('Kéo để đổi độ rộng cột')} onPointerDown={event => resizeColumn(index, event)} />
              </th>;
            })}
          </tr>
        </thead>
        <tbody>
          {drawn.map(({ row, position }) => <tr key={position}>
            <th scope="row" className="row-number">{position.toLocaleString(currentLocale())}</th>
            {header.map((_, column) => <Cell key={column} value={row[column] ?? ''} kind={kinds[column]} width={widths[column]} />)}
          </tr>)}
        </tbody>
      </table>
      {matches.length === 0 && filtering && <p className="preview-state table-empty"><Search size={14} aria-hidden="true" />{t('Không có dòng nào khớp “{0}”.', [deferredQuery.trim()])}</p>}
    </div>
    {remaining > 0 && <p className="preview-note">
      <Button variant="outline" onClick={() => setLimit(current => current + step)}>{t('Hiện thêm {0} dòng', [Math.min(step, remaining).toLocaleString(currentLocale())])}</Button>
    </p>}
  </div>;
}
