import { Fragment, type ReactNode } from 'react';

/**
 * Renders the Markdown that workers write in chat replies: paragraphs, headings, lists, quotes, code and inline
 * emphasis. It builds React elements rather than HTML, so nothing in a reply can inject markup or scripts.
 * Links show their text and address but do not navigate, because a click would replace the app window.
 * A thematic break (---) becomes extra space, not a drawn line.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return <div className={className ? `markdown ${className}` : 'markdown'}>
    {blocks.map((block, index) => <BlockView key={index} block={block} />)}
  </div>;
}

type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: string[][] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'code'; code: string }
  | { kind: 'break' };

const fencePattern = /^\s*```/;
const headingPattern = /^(#{1,6})\s+(.*)$/;
const breakPattern = /^\s*([-*_])(\s*\1){2,}\s*$/;
const unorderedItemPattern = /^\s{0,3}[-*+]\s+(.*)$/;
const orderedItemPattern = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/;
const quotePattern = /^\s*>\s?(.*)$/;
const continuationPattern = /^\s{2,}\S/;

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    if (fencePattern.test(line)) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !fencePattern.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ kind: 'code', code: codeLines.join('\n') });
      continue;
    }

    const heading = headingPattern.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].replace(/\s+#+\s*$/, '') });
      index += 1;
      continue;
    }

    if (breakPattern.test(line)) {
      blocks.push({ kind: 'break' });
      index += 1;
      continue;
    }

    if (quotePattern.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && quotePattern.test(lines[index])) {
        quoteLines.push(quotePattern.exec(lines[index])![1]);
        index += 1;
      }
      blocks.push({ kind: 'quote', lines: quoteLines });
      continue;
    }

    const ordered = orderedItemPattern.exec(line);
    if (ordered || unorderedItemPattern.test(line)) {
      const isOrdered = Boolean(ordered);
      const itemPattern = isOrdered ? orderedItemPattern : unorderedItemPattern;
      const items: string[][] = [];
      while (index < lines.length) {
        const current = lines[index];
        const item = itemPattern.exec(current);
        if (item) {
          items.push([isOrdered ? item[2] : item[1]]);
          index += 1;
          continue;
        }
        const nextIsItem = index + 1 < lines.length && itemPattern.test(lines[index + 1]);
        if (current.trim() === '' && nextIsItem) {
          index += 1;
          continue;
        }
        if (continuationPattern.test(current) && items.length > 0) {
          items[items.length - 1].push(current.trim());
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ kind: 'list', ordered: isOrdered, start: ordered ? Number(ordered[1]) : 1, items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim() !== '' && !startsNewBlock(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ kind: 'paragraph', lines: paragraphLines });
  }

  return blocks;
}

function startsNewBlock(line: string) {
  return fencePattern.test(line)
    || headingPattern.test(line)
    || breakPattern.test(line)
    || quotePattern.test(line)
    || unorderedItemPattern.test(line)
    || orderedItemPattern.test(line);
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'paragraph':
      return <p><Lines lines={block.lines} /></p>;
    case 'heading':
      return block.level <= 2 ? <h3>{renderInline(block.text)}</h3> : <h4>{renderInline(block.text)}</h4>;
    case 'list': {
      const items = block.items.map((lines, index) => <li key={index}><Lines lines={lines} /></li>);
      return block.ordered ? <ol start={block.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case 'quote':
      return <blockquote><Lines lines={block.lines} /></blockquote>;
    case 'code':
      return <pre><code>{block.code}</code></pre>;
    case 'break':
      return <div className="markdown-break" aria-hidden="true" />;
  }
}

function Lines({ lines }: { lines: string[] }) {
  return <>
    {lines.map((line, index) => <Fragment key={index}>
      {index > 0 && <br />}
      {renderInline(line)}
    </Fragment>)}
  </>;
}

// Order matters: code first so its contents stay literal, then links, then bold before italic. Italic may contain bold.
const inlinePattern = /(`[^`\n]+`)|(\[[^\]\n]+\]\([^)\s]+\))|(\*\*[^*\n]+?\*\*|__[^_\n]+?__)|(~~[^~\n]+?~~)|((?<![\w*])\*(?:[^*\n]|\*\*[^*\n]+?\*\*)+?\*(?![\w*])|(?<![\w_])_[^_\n]+?_(?![\w_]))/g;

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let position = 0;

  for (const match of text.matchAll(inlinePattern)) {
    const matchStart = match.index ?? 0;
    if (matchStart > position) nodes.push(text.slice(position, matchStart));
    nodes.push(renderToken(match, nodes.length));
    position = matchStart + match[0].length;
  }

  if (position < text.length) nodes.push(text.slice(position));
  return nodes;
}

function renderToken(match: RegExpMatchArray, key: number): ReactNode {
  const [token, code, link, bold, strike] = match;
  if (code) return <code key={key}>{code.slice(1, -1)}</code>;
  if (link) {
    const [, label, address] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(link)!;
    return <span key={key} className="markdown-link" title={address}>
      {renderInline(label)}
      {label !== address && <span className="markdown-link-address"> ({address})</span>}
    </span>;
  }
  if (bold) return <strong key={key}>{renderInline(bold.slice(2, -2))}</strong>;
  if (strike) return <s key={key}>{renderInline(strike.slice(2, -2))}</s>;
  return <em key={key}>{renderInline(token.slice(1, -1))}</em>;
}
