import { useMemo } from 'react';
import { t } from '../i18n';

const ROW_CAP = 200;

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

/**
 * A CSV or TSV file as the table it is: the first row as the header, the rest as rows, capped so a large dataset
 * stays quick to open, with a note saying how much of it is on screen.
 */
export function TablePreview({ text, delimiter }: { text: string; delimiter: ',' | '\t' }) {
  const rows = useMemo(() => parseDelimited(text, delimiter), [text, delimiter]);
  const [header, ...body] = rows;
  if (!header) return <p className="preview-state">{t('Tệp trống.')}</p>;
  const shown = body.slice(0, ROW_CAP);
  return <div className="table-preview">
    <div className="preview-table-scroll">
      <table>
        <thead><tr>{header.map((cell, index) => <th key={index} scope="col">{cell}</th>)}</tr></thead>
        <tbody>
          {shown.map((row, rowIndex) => <tr key={rowIndex}>{header.map((_, column) => <td key={column}>{row[column] ?? ''}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
    <p className="preview-note">{body.length > shown.length
      ? t('Đang hiện {0} trong {1} dòng.', [shown.length.toLocaleString(), body.length.toLocaleString()])
      : t('{0} dòng · {1} cột', [body.length.toLocaleString(), header.length])}</p>
  </div>;
}
