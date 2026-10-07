import { useMemo, useState } from 'react';
import { WrapText } from 'lucide-react';
import { Button } from './ui';
import { CopyButton, PreviewBar, PreviewIconButton } from './PreviewBar';
import { currentLocale, t } from '../i18n';
import { tokenizeLines, type Language } from './highlight';

const INITIAL_LINES = 2000;

const LANGUAGE_NAMES: Record<Language, string> = {
  javascript: 'JavaScript / TypeScript', python: 'Python', shell: 'Shell', powershell: 'PowerShell', sql: 'SQL', css: 'CSS', markup: 'HTML / XML', yaml: 'YAML',
  json: 'JSON', toml: 'TOML', 'c-family': 'C / C++ / Java', go: 'Go', rust: 'Rust', ruby: 'Ruby', text: '',
};

/** The language as the bar names it; plain text has no language, so it is called what it is. */
function languageName(language: Language): string {
  return LANGUAGE_NAMES[language] || t('Văn bản');
}

/** What a diff did to a line: it went, or it came. Drawn as `.line-removed` / `.line-added`. */
export type LineMark = 'removed' | 'added';

/**
 * Text or code with a number on every line. `citedLines` marks the lines a finding pointed at, kept as the
 * `.line-highlight` / `data-line` shape the citation navigation scrolls to; `lineMarks` tints single lines as a
 * diff would. Colour comes from the in-house tokenizer; the text itself is never changed, so a cited line reads
 * as written. Very long files render their first two thousand lines and offer the rest on demand, unless a
 * citation lies past that point.
 */
export function CodePreview({ text, language, citedLines, lineMarks, toolbar = false }: {
  text: string; language: Language; citedLines?: [number, number]; lineMarks?: Partial<Record<number, LineMark>>;
  /** Adds the bar above the lines: the language, the line count, a wrap switch and a copy button. */
  toolbar?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const [wrap, setWrap] = useState(true);
  // A file that ends with a newline has no extra empty line after it, the way an editor shows it.
  const lines = useMemo(() => tokenizeLines(text.replace(/\r?\n$/, ''), language), [text, language]);
  const total = lines.length;
  const citedEnd = citedLines ? citedLines[1] : 0;
  const visible = showAll || citedEnd > INITIAL_LINES ? total : Math.min(total, INITIAL_LINES);
  const numberWidth = `${String(total).length + 1}ch`;
  const lineCount = total === 1 ? t('1 dòng văn bản') : t('{0} dòng văn bản', [total.toLocaleString(currentLocale())]);
  return <div className="code-preview">
    {toolbar && <PreviewBar summary={`${languageName(language)} · ${lineCount}`}>
      <PreviewIconButton label={t('Xuống dòng tự động')} icon={<WrapText size={15} aria-hidden="true" />} pressed={wrap} onClick={() => setWrap(current => !current)} />
      <CopyButton text={text} label={t('Sao chép')} />
    </PreviewBar>}
    <pre className={`source-preview language-${language}${wrap ? '' : ' no-wrap'}`} data-align-ignore={wrap ? undefined : 'overflow'} style={{ '--line-number-width': numberWidth } as React.CSSProperties}>
      {lines.slice(0, visible).map((tokens, index) => {
        const lineNumber = index + 1;
        const cited = citedLines !== undefined && lineNumber >= citedLines[0] && lineNumber <= citedLines[1];
        const mark = lineMarks?.[lineNumber];
        const classNames = [cited ? 'line-highlight' : '', mark ? `line-${mark}` : ''].filter(Boolean);
        return <span key={index} className={classNames.length > 0 ? classNames.join(' ') : undefined} data-line={lineNumber}>
          <span className="line-number">{lineNumber}</span>
          {tokens.map((token, tokenIndex) => token.kind === 'plain' ? token.text : <span key={tokenIndex} className={`tok-${token.kind}`}>{token.text}</span>)}
          {'\n'}
        </span>;
      })}
    </pre>
    {visible < total && <p className="preview-note">
      {t('Đang hiện {0} trong {1} dòng.', [visible.toLocaleString(), total.toLocaleString()])}
      <Button variant="outline" onClick={() => setShowAll(true)}>{t('Hiện toàn bộ')}</Button>
    </p>}
  </div>;
}
