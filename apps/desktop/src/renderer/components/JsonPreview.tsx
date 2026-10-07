import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Tabs } from '@codepawlhq/orglet-ui';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { ChevronRight } from './icons';
import { currentLocale, t } from '../i18n';
import { CodePreview } from './CodePreview';
import { CopyButton, PreviewBar, PreviewIconButton } from './PreviewBar';

const ENTRY_CAP = 200;
const AUTO_OPEN_DEPTH = 2;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Parsed content: one document, or one value per line for JSON Lines. `failed` keeps the raw text for a code view. */
type Parsed = { values: JsonValue[]; lines: boolean; failed?: false } | { failed: true };

/** What "expand all" or "collapse all" last asked of every folded node; `revision` changes on each click. */
type Expansion = { revision: number; open: boolean | undefined };
const ExpansionContext = createContext<Expansion>({ revision: 0, open: undefined });

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
  if (Array.isArray(value)) return value.length === 1 ? t('1 phần tử') : t('{0} phần tử', [value.length.toLocaleString(currentLocale())]);
  const fieldCount = Object.keys(value).length;
  return fieldCount === 1 ? t('1 trường') : t('{0} trường', [fieldCount.toLocaleString(currentLocale())]);
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
  const expansion = useContext(ExpansionContext);
  const seenRevision = useRef(expansion.revision);
  useEffect(() => {
    if (expansion.revision === seenRevision.current) return;
    seenRevision.current = expansion.revision;
    if (expansion.open !== undefined) setOpen(expansion.open);
  }, [expansion]);
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
      {entries.length > shown.length && <p className="preview-note">{t('Đang hiện {0} trong {1} mục.', [shown.length.toLocaleString(currentLocale()), entries.length.toLocaleString(currentLocale())])}</p>}
    </div>}
  </div>;
}

type JsonView = 'tree' | 'raw';

/** What the bar says about the document: how many fields or items the top level holds, or how many lines a JSON Lines file has. */
function documentSummary(parsed: Exclude<Parsed, { failed: true }>): string {
  if (parsed.lines) return parsed.values.length === 1 ? t('1 dòng văn bản') : t('{0} dòng văn bản', [parsed.values.length.toLocaleString(currentLocale())]);
  const root = parsed.values[0];
  return isContainer(root) ? summary(root) : t('1 giá trị');
}

/**
 * A JSON document as a folding tree, or a JSON Lines file as one tree per line, with the raw text one tab away,
 * the way VS Code and browser dev tools offer both. A file that does not parse falls back to the numbered code view
 * rather than an error, because the person still wants to see what is in it.
 */
export function JsonPreview({ text, lines }: { text: string; lines: boolean }) {
  const parsed = useMemo(() => parse(text, lines), [text, lines]);
  const tabsId = useId();
  const [view, setView] = useState<JsonView>('tree');
  const [expansion, setExpansion] = useState<Expansion>({ revision: 0, open: undefined });
  if (parsed.failed) return <CodePreview text={text} language="json" toolbar />;
  const shown = parsed.values.slice(0, ENTRY_CAP);
  const tabs = [{ id: 'tree', label: t('Cây') }, { id: 'raw', label: t('Văn bản gốc') }];
  return <div className="json-preview">
    <PreviewBar summary={documentSummary(parsed)}>
      <Tabs id={tabsId} className="preview-tabs" label={t('Cách xem JSON')} tabs={tabs} value={view} onChange={next => setView(next as JsonView)} />
      {view === 'tree' && <>
        <PreviewIconButton label={t('Mở rộng tất cả')} icon={<ChevronsUpDown size={15} aria-hidden="true" />} onClick={() => setExpansion(current => ({ revision: current.revision + 1, open: true }))} />
        <PreviewIconButton label={t('Thu gọn tất cả')} icon={<ChevronsDownUp size={15} aria-hidden="true" />} onClick={() => setExpansion(current => ({ revision: current.revision + 1, open: false }))} />
      </>}
      <CopyButton text={text} label={t('Sao chép')} />
    </PreviewBar>
    {view === 'raw' ? <CodePreview text={text} language="json" /> : <ExpansionContext.Provider value={expansion}>
      <div className="source-preview json-tree">
        {parsed.lines
          ? shown.map((value, index) => <Node key={index} name={String(index + 1)} value={value} depth={1} />)
          : <Node value={parsed.values[0]} depth={0} />}
        {parsed.values.length > shown.length && <p className="preview-note">{t('Đang hiện {0} trong {1} dòng.', [shown.length.toLocaleString(currentLocale()), parsed.values.length.toLocaleString(currentLocale())])}</p>}
      </div>
    </ExpansionContext.Provider>}
  </div>;
}
