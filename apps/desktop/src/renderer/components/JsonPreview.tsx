import { useMemo, useState } from 'react';
import { ChevronRight } from './icons';
import { t } from '../i18n';
import { CodePreview } from './CodePreview';

const ENTRY_CAP = 200;
const AUTO_OPEN_DEPTH = 2;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Parsed content: one document, or one value per line for JSON Lines. `failed` keeps the raw text for a code view. */
type Parsed = { values: JsonValue[]; lines: boolean; failed?: false } | { failed: true };

function parse(text: string, lines: boolean): Parsed {
  try {
    if (!lines) return { values: [JSON.parse(text) as JsonValue], lines: false };
    const values = text.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line) as JsonValue);
    return { values, lines: true };
  } catch {
    return { failed: true };
  }
}

function isContainer(value: JsonValue): value is JsonValue[] | { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null;
}

function summary(value: JsonValue[] | { [key: string]: JsonValue }) {
  if (Array.isArray(value)) return t('{0} phần tử', [value.length.toLocaleString()]);
  return t('{0} trường', [Object.keys(value).length.toLocaleString()]);
}

function Scalar({ value }: { value: null | boolean | number | string }) {
  if (value === null) return <span className="tok-keyword">null</span>;
  if (typeof value === 'boolean') return <span className="tok-keyword">{String(value)}</span>;
  if (typeof value === 'number') return <span className="tok-number">{String(value)}</span>;
  return <span className="tok-string">"{value}"</span>;
}

/** One key or index and its value; a container folds, opened by default near the top of the document. */
function Node({ name, value, depth }: { name?: string; value: JsonValue; depth: number }) {
  const [open, setOpen] = useState(depth < AUTO_OPEN_DEPTH);
  const label = name === undefined ? null : <span className="json-key">{name}</span>;
  if (!isContainer(value)) return <div className="json-node"><span className="json-leaf">{label}{label && <span className="json-colon">: </span>}<Scalar value={value} /></span></div>;
  const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value);
  const shown = entries.slice(0, ENTRY_CAP);
  return <div className="json-node">
    <button type="button" className="json-toggle" aria-expanded={open} onClick={() => setOpen(current => !current)}>
      <ChevronRight size={14} className={open ? 'open' : undefined} />
      {label}{label && <span className="json-colon">: </span>}
      <span className="json-summary">{Array.isArray(value) ? '[' : '{'} {summary(value)} {Array.isArray(value) ? ']' : '}'}</span>
    </button>
    {open && <div className="json-children">
      {shown.map(([key, item]) => <Node key={key} name={key} value={item} depth={depth + 1} />)}
      {entries.length > shown.length && <p className="preview-note">{t('Đang hiện {0} trong {1} mục.', [shown.length.toLocaleString(), entries.length.toLocaleString()])}</p>}
    </div>}
  </div>;
}

/**
 * A JSON document as a folding tree, or a JSON Lines file as one tree per line. A file that does not parse falls
 * back to the numbered code view rather than an error, because the person still wants to see what is in it.
 */
export function JsonPreview({ text, lines }: { text: string; lines: boolean }) {
  const parsed = useMemo(() => parse(text, lines), [text, lines]);
  if (parsed.failed) return <CodePreview text={text} language="json" />;
  const shown = parsed.values.slice(0, ENTRY_CAP);
  return <div className="json-preview source-preview">
    {parsed.lines
      ? shown.map((value, index) => <Node key={index} name={String(index + 1)} value={value} depth={1} />)
      : <Node value={parsed.values[0]} depth={0} />}
    {parsed.values.length > shown.length && <p className="preview-note">{t('Đang hiện {0} trong {1} dòng.', [shown.length.toLocaleString(), parsed.values.length.toLocaleString()])}</p>}
  </div>;
}
