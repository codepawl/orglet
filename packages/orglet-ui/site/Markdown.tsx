import { Fragment, type ReactNode } from 'react';

// The pages are written in a small, fixed subset of Markdown (headings, paragraphs, lists, fenced code, tables,
// inline code, bold, links), so the site renders that subset itself instead of carrying a Markdown library.
type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; language: string; text: string }
  | { kind: 'table'; header: string[]; rows: string[][] };

const LIST_ITEM = /^(-|\d+\.) +/;

export function headingId(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function tableCells(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let index = 0; index < inner.length; index += 1) {
    if (inner[index] === '\\' && inner[index + 1] === '|') {
      current += '|';
      index += 1;
    } else if (inner[index] === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += inner[index];
    }
  }
  cells.push(current.trim());
  return cells;
}

function startsBlock(line: string): boolean {
  return line.startsWith('#') || line.startsWith('```') || line.startsWith('|') || LIST_ITEM.test(line);
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
    } else if (line.startsWith('```')) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ kind: 'code', language: line.slice(3).trim(), text: codeLines.join('\n') });
    } else if (/^#{1,4} /.test(line)) {
      const level = line.indexOf(' ');
      blocks.push({ kind: 'heading', level, text: line.slice(level + 1).trim() });
      index += 1;
    } else if (line.startsWith('|')) {
      const tableLines: string[] = [];
      while (index < lines.length && lines[index].startsWith('|')) {
        tableLines.push(lines[index]);
        index += 1;
      }
      blocks.push({ kind: 'table', header: tableCells(tableLines[0]), rows: tableLines.slice(2).map(tableCells) });
    } else if (LIST_ITEM.test(line)) {
      const items: string[] = [];
      const ordered = /^\d/.test(line);
      while (index < lines.length && (LIST_ITEM.test(lines[index]) || /^ {2,}\S/.test(lines[index]))) {
        if (LIST_ITEM.test(lines[index])) items.push(lines[index].replace(LIST_ITEM, ''));
        else items[items.length - 1] += ` ${lines[index].trim()}`;
        index += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
    } else {
      const paragraphLines: string[] = [];
      while (index < lines.length && lines[index].trim() && !startsBlock(lines[index])) {
        paragraphLines.push(lines[index].trim());
        index += 1;
      }
      blocks.push({ kind: 'paragraph', text: paragraphLines.join(' ') });
    }
  }
  return blocks;
}

function Inline({ text, link }: { text: string; link: (href: string, label: ReactNode) => ReactNode }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return <>{parts.map((part, index) => {
    if (part.startsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (linkMatch) return <Fragment key={index}>{link(linkMatch[2], linkMatch[1])}</Fragment>;
    return <Fragment key={index}>{part}</Fragment>;
  })}</>;
}

export function Markdown({ source, link, code }: {
  source: string;
  /** How a link is drawn: the site turns its own paths into in-page navigation. */
  link: (href: string, label: ReactNode) => ReactNode;
  /** How a fenced block is drawn, so the site can add its copy button. */
  code: (text: string, language: string) => ReactNode;
}) {
  return <>{parseMarkdown(source).map((block, index) => {
    if (block.kind === 'heading') {
      const Heading = `h${Math.min(block.level, 4)}` as 'h1' | 'h2' | 'h3' | 'h4';
      return <Heading key={index} id={headingId(block.text)}><Inline text={block.text} link={link} /></Heading>;
    }
    if (block.kind === 'paragraph') return <p key={index}><Inline text={block.text} link={link} /></p>;
    if (block.kind === 'code') return <Fragment key={index}>{code(block.text, block.language)}</Fragment>;
    if (block.kind === 'list') {
      const List = block.ordered ? 'ol' : 'ul';
      return <List key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}><Inline text={item} link={link} /></li>)}</List>;
    }
    return <div key={index} className="site-table-scroll" tabIndex={0} role="group" aria-label="Table">
      <table>
        <thead><tr>{block.header.map((cell, cellIndex) => <th key={cellIndex} scope="col"><Inline text={cell} link={link} /></th>)}</tr></thead>
        <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>
          {row.map((cell, cellIndex) => <td key={cellIndex}><Inline text={cell} link={link} /></td>)}
        </tr>)}</tbody>
      </table>
    </div>;
  })}</>;
}
