import { useMemo, useState } from 'react';
import { Button } from './ui';
import { t } from '../i18n';
import { tokenizeLines, type Language } from './highlight';

const INITIAL_LINES = 2000;

/**
 * Text or code with a number on every line. `citedLines` marks the lines a finding pointed at, kept as the
 * `.line-highlight` / `data-line` shape the citation navigation scrolls to. Colour comes from the in-house
 * tokenizer; the text itself is never changed, so a cited line reads as written. Very long files render their
 * first two thousand lines and offer the rest on demand, unless a citation lies past that point.
 */
export function CodePreview({ text, language, citedLines }: { text: string; language: Language; citedLines?: [number, number] }) {
  const [showAll, setShowAll] = useState(false);
  // A file that ends with a newline has no extra empty line after it, the way an editor shows it.
  const lines = useMemo(() => tokenizeLines(text.replace(/\r?\n$/, ''), language), [text, language]);
  const total = lines.length;
  const citedEnd = citedLines ? citedLines[1] : 0;
  const visible = showAll || citedEnd > INITIAL_LINES ? total : Math.min(total, INITIAL_LINES);
  const numberWidth = `${String(total).length + 1}ch`;
  return <div className="code-preview">
    <pre className={`source-preview language-${language}`} style={{ '--line-number-width': numberWidth } as React.CSSProperties}>
      {lines.slice(0, visible).map((tokens, index) => {
        const lineNumber = index + 1;
        const cited = citedLines !== undefined && lineNumber >= citedLines[0] && lineNumber <= citedLines[1];
        return <span key={index} className={cited ? 'line-highlight' : undefined} data-line={lineNumber}>
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
