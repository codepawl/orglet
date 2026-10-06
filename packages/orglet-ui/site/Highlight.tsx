import type { ReactNode } from 'react';

// Enough colouring to read a TSX, CSS or shell example at a glance: comments, strings, keywords, tags and numbers.
// It is a single pass over one pattern, not a parser, and anything it does not recognise is left as plain text.
const KEYWORDS = 'import|from|export|const|let|function|return|type|interface|async|await|new|if|else|for|of|in|default|true|false|null|undefined';

const TOKEN_PATTERN = new RegExp([
  '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/|^#[^\\n]*)',
  '(`(?:\\\\.|[^`\\\\])*`|"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\')',
  `\\b(${KEYWORDS})\\b`,
  '(<\\/?[A-Za-z][A-Za-z0-9.]*|\\/?>)',
  '\\b(\\d+(?:\\.\\d+)?(?:px|ms|s|%|rem|em)?)\\b',
  '(--[a-z][a-z0-9-]*)',
].join('|'), 'gm');

const TOKEN_KINDS = ['comment', 'string', 'keyword', 'tag', 'number', 'token'];

export function highlight(source: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  for (const match of source.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push(source.slice(lastIndex, index));
    const kindIndex = match.slice(1).findIndex(group => group !== undefined);
    parts.push(<span key={index} className={`site-code-${TOKEN_KINDS[kindIndex]}`}>{match[0]}</span>);
    lastIndex = index + match[0].length;
  }
  if (lastIndex < source.length) parts.push(source.slice(lastIndex));
  return parts;
}
