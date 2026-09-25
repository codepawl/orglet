import { MUTED_COLOR, paint, wrapSegments, type ColorMode, type Segment, type Style } from './terminal';

/**
 * Light Markdown for answers in a terminal (COD-236): headings, bold, inline code, fenced code blocks, lists, quotes
 * and links, wrapped to the width. Line breaks the orglet wrote are kept, because a chat answer often means them.
 * Fenced code and table rows are printed verbatim, never wrapped, so they can be copied.
 */

export type MarkdownOptions = {
  width: number;
  mode: ColorMode;
  /** The orglet's colour, for headings. */
  accent?: string;
  /** Put before every line, for example two spaces under a byline. */
  indent?: string;
};

/** Inline code: a warm tone that stands apart from body text on dark and light backgrounds. */
const CODE_COLOR = '#d9a05b';

const INLINE = /(`+)([\s\S]*?)\1|\*\*(.+?)\*\*|__(.+?)__|\[([^\]]+)\]\((\S+?)(?:\s+"[^"]*")?\)/g;

function merge(base: Style | undefined, extra: Style): Style {
  return { ...base, ...extra };
}

function linkSegments(text: string, url: string, base: Style | undefined): Segment[] {
  if (text === url) return [{ text: url, style: merge(base, { underline: true }) }];
  return [
    ...parseInline(text, base),
    { text: ' (', style: merge(base, { foreground: MUTED_COLOR }) },
    { text: url, style: merge(base, { foreground: MUTED_COLOR, underline: true }) },
    { text: ')', style: merge(base, { foreground: MUTED_COLOR }) },
  ];
}

/** Splits one line into styled runs: code spans are taken as written, bold may hold links and code. */
export function parseInline(text: string, base?: Style): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ text: text.slice(last, start), style: base });
    const [, ticks, code, starBold, underscoreBold, linkText, linkUrl] = match;
    if (ticks) segments.push({ text: code.trim() === '' ? code : code.replace(/^ (.*) $/, '$1'), style: merge(base, { foreground: CODE_COLOR }) });
    else if (starBold !== undefined || underscoreBold !== undefined) segments.push(...parseInline(starBold ?? underscoreBold, merge(base, { bold: true })));
    else segments.push(...linkSegments(linkText, linkUrl, base));
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), style: base });
  return segments;
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;

type Context = MarkdownOptions & { indent: string };

function heading(level: number, text: string, context: Context): string[] {
  const style: Style = level <= 2 ? { bold: true, foreground: context.accent } : { bold: true };
  return wrapSegments(parseInline(text, style), { width: context.width, mode: context.mode, firstPrefix: context.indent });
}

function listItem(match: RegExpMatchArray, context: Context): string[] {
  const [, leading, marker, text] = match;
  const depth = Math.floor(leading.replace(/\t/g, '  ').length / 2);
  const nesting = '  '.repeat(depth);
  const bullet = /\d/.test(marker) ? marker : '•';
  const bulletText = paint(bullet, { foreground: context.accent ?? MUTED_COLOR }, context.mode);
  const firstPrefix = `${context.indent}${nesting}${bulletText} `;
  const restPrefix = `${context.indent}${nesting}${' '.repeat(bullet.length + 1)}`;
  return wrapSegments(parseInline(text), { width: context.width, mode: context.mode, firstPrefix, restPrefix });
}

function quote(text: string, context: Context): string[] {
  const prefix = `${context.indent}${paint('│', { foreground: MUTED_COLOR }, context.mode)} `;
  return wrapSegments(parseInline(text, { foreground: MUTED_COLOR }), { width: context.width, mode: context.mode, firstPrefix: prefix });
}

function verbatim(line: string, context: Context, style?: Style): string {
  return `${context.indent}${style ? paint(line, style, context.mode) : line}`;
}

function renderLine(line: string, context: Context): string[] {
  const headingMatch = line.match(HEADING);
  if (headingMatch) return heading(headingMatch[1].length, headingMatch[2], context);
  if (RULE.test(line)) return [''];
  const listMatch = line.match(LIST_ITEM);
  if (listMatch) return listItem(listMatch, context);
  const quoteMatch = line.match(QUOTE);
  if (quoteMatch) return quote(quoteMatch[1], context);
  if (TABLE_ROW.test(line)) return [verbatim(line, context)];
  return wrapSegments(parseInline(line.trim()), { width: context.width, mode: context.mode, firstPrefix: context.indent });
}

/** An answer as terminal lines. Runs of blank lines become one, and leading and trailing ones are dropped. */
export function renderMarkdown(text: string, options: MarkdownOptions): string[] {
  const context: Context = { ...options, indent: options.indent ?? '' };
  const lines: string[] = [];
  let inFence = false;
  const pushBlank = () => {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
  };
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      lines.push(verbatim(`  ${line}`, context, { foreground: CODE_COLOR }));
      continue;
    }
    if (line.trim() === '') {
      pushBlank();
      continue;
    }
    lines.push(...renderLine(line, context));
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
