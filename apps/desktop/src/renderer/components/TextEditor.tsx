import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { EditorState, RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, runScopeHandlers, drawSelection, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, type DecorationSet, type Panel, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, highlightSelectionMatches, replaceAll, replaceNext, search, searchKeymap, searchPanelOpen, setSearchQuery } from '@codemirror/search';
import { CaseSensitive, ChevronDown, ChevronUp, Regex, WholeWord, X } from 'lucide-react';
import { Button, Input } from '@codepawl/orglet-ui';
import { t } from '../i18n';
import { tokenizeLines, type Language } from './highlight';

/** Past this size the editor stays plain text: colouring re-reads the file from the top on every change. */
const HIGHLIGHT_LIMIT = 512 * 1024;
/** Matches are counted up to this many; past it the bar says "1000+". */
const MATCH_COUNT_LIMIT = 1000;

/** What the viewer asks of an open editor: the text as it is now, and focus. */
export type TextEditorHandle = { text: () => string; focus: () => void };

/**
 * Colours the text with the same tokenizer and `tok-*` classes the read-only preview uses (COD-280), so a file looks
 * the same whether it is being read or edited, and no grammar package is loaded. The tokenizer carries comment and
 * string state from the top, so it reads from the start of the file to the end of what is on screen.
 */
function tokenColours(language: Language): Extension {
  if (language === 'text') return [];
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = colour(view, language); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = colour(update.view, language);
    }
  }, { decorations: plugin => plugin.decorations });
}

function colour(view: EditorView, language: Language): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const document = view.state.doc;
  if (document.length > HIGHLIGHT_LIMIT) return builder.finish();
  const lastVisible = view.visibleRanges.at(-1)?.to ?? 0;
  const lastLine = document.lineAt(lastVisible);
  const lines = tokenizeLines(document.sliceString(0, lastLine.to), language);
  for (const range of view.visibleRanges) {
    const first = document.lineAt(range.from).number;
    const last = document.lineAt(range.to).number;
    for (let lineNumber = first; lineNumber <= last; lineNumber += 1) {
      const tokens = lines[lineNumber - 1];
      if (!tokens) continue;
      let position = document.line(lineNumber).from;
      for (const token of tokens) {
        const end = position + token.text.length;
        if (token.kind !== 'plain') builder.add(position, end, Decoration.mark({ class: `tok-${token.kind}` }));
        position = end;
      }
    }
  }
  return builder.finish();
}

/** The theme reads the app's tokens, so the editor follows light and dark with the rest of the window. */
const orgletTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '12.5px', color: 'var(--text)', backgroundColor: 'var(--bg)', borderRadius: '10px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6', borderRadius: '10px' },
  '.cm-content': { padding: '12px 0', caretColor: 'var(--text)' },
  '.cm-line': { padding: '0 14px 0 6px' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--muted)', border: 'none', paddingLeft: '8px' },
  '.cm-lineNumbers .cm-gutterElement': { fontVariantNumeric: 'tabular-nums', minWidth: '3ch' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 24%, transparent)',
  },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--warning) 30%, transparent)', borderRadius: '2px' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--accent) 34%, transparent)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)' },
  '.cm-panels': { backgroundColor: 'var(--bg)', color: 'var(--text)' },
  '.cm-panels.cm-panels-top': { borderBottom: 'none' },
});

/** CodeMirror's own words, in the interface language. */
function editorPhrases() {
  return EditorState.phrases.of({
    'Find': t('Tìm trong tệp'),
    'Replace': t('Thay bằng'),
    'next': t('Tiếp'),
    'previous': t('Trước'),
    'all': t('Tất cả'),
    'match case': t('Phân biệt hoa thường'),
    'by word': t('Cả từ'),
    'regexp': t('Biểu thức chính quy'),
    'replace': t('Thay'),
    'replace all': t('Thay tất cả'),
    'close': t('Đóng'),
    'current match': t('Kết quả đang chọn'),
    'on line': t('ở dòng'),
    'replaced $ matches': t('Đã thay $ chỗ'),
    'replaced match on line $': t('Đã thay một chỗ ở dòng $'),
    'Go to line': t('Đến dòng'),
    'go': t('Đi'),
    'Control character': t('Ký tự điều khiển'),
    'Selection deleted': t('Đã xóa phần chọn'),
  });
}

/** How many matches the query has, and which one the selection is on. */
function matchCount(view: EditorView, query: SearchQuery): { total: number; current: number } {
  if (!query.search || !query.valid) return { total: 0, current: 0 };
  const cursor = query.getCursor(view.state);
  const selection = view.state.selection.main;
  let total = 0;
  let current = 0;
  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    total += 1;
    if (step.value.from === selection.from && step.value.to === selection.to) current = total;
    if (total >= MATCH_COUNT_LIMIT) break;
  }
  return { total, current };
}

/**
 * Find and replace, drawn with Orglet's own field and buttons instead of CodeMirror's form: the search field, three
 * toggles (case, whole word, regular expression), previous and next with the count, then the replacement. Enter finds
 * the next match, Shift+Enter the previous, Escape closes the bar and returns to the text.
 */
function FindReplaceBar({ view, query }: { view: EditorView; query: SearchQuery }) {
  const count = matchCount(view, query);
  const change = (patch: Partial<ConstructorParameters<typeof SearchQuery>[0]>) => {
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query.search, caseSensitive: query.caseSensitive, wholeWord: query.wholeWord, regexp: query.regexp, replace: query.replace, ...patch })) });
  };
  const onFindKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (event.shiftKey) findPrevious(view);
    else findNext(view);
  };
  const onReplaceKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) replaceAll(view);
    else replaceNext(view);
  };
  const countLabel = !query.search ? '' : count.total === 0 ? t('Không thấy') : count.total >= MATCH_COUNT_LIMIT ? `${count.current || '–'}/${MATCH_COUNT_LIMIT}+` : `${count.current || '–'}/${count.total}`;
  const toggles: { key: 'caseSensitive' | 'wholeWord' | 'regexp'; label: string; icon: typeof CaseSensitive }[] = [
    { key: 'caseSensitive', label: t('Phân biệt hoa thường'), icon: CaseSensitive },
    { key: 'wholeWord', label: t('Cả từ'), icon: WholeWord },
    { key: 'regexp', label: t('Biểu thức chính quy'), icon: Regex },
  ];
  // Escape, Ctrl+G and F3 reach the same commands as in the text, through CodeMirror's panel scope.
  const onBarKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (runScopeHandlers(view, event.nativeEvent, 'search-panel')) event.preventDefault();
  };
  return <div className="find-bar" role="search" aria-label={t('Tìm và thay')} onKeyDown={onBarKey}>
    <div className="find-bar-row">
      <Input main-field="true" className="find-bar-field" aria-label={t('Tìm trong tệp')} placeholder={t('Tìm trong tệp')} value={query.search} aria-invalid={query.search && !query.valid ? true : undefined}
        onChange={event => change({ search: event.target.value })} onKeyDown={onFindKey} />
      <span className="find-bar-toggles">
        {toggles.map(toggle => <Button key={toggle.key} type="button" size="icon" className="find-bar-toggle" aria-label={toggle.label} title={toggle.label}
          aria-pressed={query[toggle.key]} onClick={() => change({ [toggle.key]: !query[toggle.key] })}><toggle.icon size={16} /></Button>)}
      </span>
      <span className="find-bar-count" aria-live="polite">{countLabel}</span>
      <Button type="button" size="icon" aria-label={t('Kết quả trước')} title={t('Kết quả trước (Shift+Enter)')} onClick={() => findPrevious(view)}><ChevronUp size={16} /></Button>
      <Button type="button" size="icon" aria-label={t('Kết quả tiếp')} title={t('Kết quả tiếp (Enter)')} onClick={() => findNext(view)}><ChevronDown size={16} /></Button>
      <Button type="button" size="icon" className="find-bar-close" aria-label={t('Đóng tìm kiếm')} title={t('Đóng tìm kiếm (Esc)')} onClick={() => { closeSearchPanel(view); view.focus(); }}><X size={16} /></Button>
    </div>
    <div className="find-bar-row">
      <Input className="find-bar-field" aria-label={t('Thay bằng')} placeholder={t('Thay bằng')} value={query.replace}
        onChange={event => change({ replace: event.target.value })} onKeyDown={onReplaceKey} />
      <Button type="button" variant="outline" className="find-bar-action" onClick={() => replaceNext(view)}>{t('Thay')}</Button>
      <Button type="button" variant="outline" className="find-bar-action" onClick={() => replaceAll(view)}>{t('Thay tất cả')}</Button>
    </div>
  </div>;
}

/** CodeMirror's panel slot holding the React bar, re-rendered when the query or the text changes. */
function findReplacePanel(view: EditorView): Panel {
  const dom = document.createElement('div');
  const root: Root = createRoot(dom);
  const render = () => root.render(<FindReplaceBar view={view} query={getSearchQuery(view.state)} />);
  // Drawn at once, so CodeMirror finds the `main-field` input to focus when the panel opens.
  flushSync(render);
  return {
    dom,
    top: true,
    update(update) {
      const queryChanged = update.transactions.some(transaction => transaction.effects.some(effect => effect.is(setSearchQuery)));
      if (queryChanged || update.docChanged || update.selectionSet) render();
    },
    destroy() { queueMicrotask(() => root.unmount()); },
  };
}

/**
 * While the find bar is open, Escape closes it instead of the viewer: the open bar marks the editor as holding a popup,
 * which the viewer's Escape guard honours (`keepOpenForPopup`).
 */
const escapeClosesFindBarFirst = EditorView.updateListener.of(update => {
  const open = searchPanelOpen(update.state);
  if (open) update.view.dom.setAttribute('data-popup-open', '');
  else update.view.dom.removeAttribute('data-popup-open');
});

/**
 * Text and code editing inside the viewer (COD-280): CodeMirror 6 with line numbers, the app's syntax colours, undo
 * and redo, and find and replace (Ctrl+F). Ctrl+S calls `onSave`. The editor never saves on its own; the viewer turns
 * the text into a new version of the source.
 */
export function TextEditor({ initialText, language, label, onDirtyChange, onSave, handle }: {
  initialText: string; language: Language; label: string;
  onDirtyChange: (dirty: boolean) => void; onSave: () => void;
  handle: React.RefObject<TextEditorHandle | null>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const saveRef = useRef(onSave);
  const dirtyRef = useRef(onDirtyChange);
  saveRef.current = onSave;
  dirtyRef.current = onDirtyChange;
  const [view, setView] = useState<EditorView>();
  useEffect(() => {
    if (!host.current) return;
    const original = EditorState.create({ doc: initialText }).doc;
    let dirty = false;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: original,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          highlightSelectionMatches(),
          EditorView.lineWrapping,
          search({ top: true, createPanel: findReplacePanel }),
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => { saveRef.current(); return true; } },
            ...searchKeymap,
            ...historyKeymap,
            ...defaultKeymap,
            indentWithTab,
          ]),
          tokenColours(language),
          orgletTheme,
          editorPhrases(),
          escapeClosesFindBarFirst,
          EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
          EditorView.updateListener.of(update => {
            if (!update.docChanged) return;
            const now = !update.state.doc.eq(original);
            if (now === dirty) return;
            dirty = now;
            dirtyRef.current(now);
          }),
        ],
      }),
    });
    setView(editor);
    editor.focus();
    return () => { editor.destroy(); setView(undefined); };
  }, [initialText, language, label]);
  useEffect(() => {
    if (!view) return;
    handle.current = { text: () => view.state.doc.toString(), focus: () => view.focus() };
    return () => { handle.current = null; };
  }, [view, handle]);
  return <div ref={host} className="text-editor" />;
}
