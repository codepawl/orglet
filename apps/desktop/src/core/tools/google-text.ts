import { GoogleToolError } from '../../shared/google-tools';

/** Characters one tool answer carries; more is cut and the answer says so. */
export const GOOGLE_TEXT_CHARACTERS = 20_000;
export const GOOGLE_ROW_LIMIT = 500;

/** The text cut to `limit` characters, with a closing line that says how much was left out. */
export function capText(text: string, limit = GOOGLE_TEXT_CHARACTERS): string {
  const characters = Array.from(text);
  if (characters.length <= limit) return text;
  return `${characters.slice(0, limit).join('')}\n\n[Truncated: showing ${limit} of ${characters.length} characters.]`;
}

/** Rows as tab-separated lines, cut to the row limit with a note that says how many were left out. */
export function rowsText(rows: readonly (readonly unknown[])[]): string {
  const shown = rows.slice(0, GOOGLE_ROW_LIMIT).map(row => row.map(cell => String(cell ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t'));
  const note = rows.length > GOOGLE_ROW_LIMIT ? `\n[Truncated: showing ${GOOGLE_ROW_LIMIT} of ${rows.length} rows.]` : '';
  return capText(shown.join('\n') + note);
}

type TextRun = { textRun?: { content?: string } };
type DocsParagraph = { elements?: TextRun[]; paragraphStyle?: { namedStyleType?: string } };
type DocsElement = { paragraph?: DocsParagraph; table?: { tableRows?: { tableCells?: { content?: DocsElement[] }[] }[] } };

function headingPrefix(style: string | undefined): string {
  if (style === 'TITLE') return '# ';
  const level = /^HEADING_([1-6])$/.exec(style ?? '')?.[1];
  return level ? `${'#'.repeat(Number(level))} ` : '';
}

function paragraphText(paragraph: DocsParagraph): string {
  const text = (paragraph.elements ?? []).map(element => element.textRun?.content ?? '').join('').replace(/\n+$/, '');
  return text ? headingPrefix(paragraph.paragraphStyle?.namedStyleType) + text : '';
}

/** A Google Doc body as plain text: headings keep a # prefix, a table row is its cells joined with a bar. */
export function docsText(content: readonly DocsElement[] | undefined): string {
  const lines: string[] = [];
  for (const element of content ?? []) {
    if (element.paragraph) {
      lines.push(paragraphText(element.paragraph));
      continue;
    }
    for (const row of element.table?.tableRows ?? []) {
      lines.push((row.tableCells ?? []).map(cell => docsText(cell.content).replace(/\n+/g, ' ')).join(' | '));
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

type SlideText = { text?: { textElements?: TextRun[] } };
type SlideElement = { shape?: SlideText; table?: { tableRows?: { tableCells?: SlideText[] }[] } };

function slideTextOf(text: SlideText | undefined): string {
  return (text?.text?.textElements ?? []).map(element => element.textRun?.content ?? '').join('').trim();
}

/** The texts on one slide, one per shape and one line per table row. */
export function slideLines(elements: readonly SlideElement[] | undefined): string[] {
  const lines: string[] = [];
  for (const element of elements ?? []) {
    const shapeText = slideTextOf(element.shape);
    if (shapeText) lines.push(shapeText);
    for (const row of element.table?.tableRows ?? []) {
      lines.push((row.tableCells ?? []).map(slideTextOf).join(' | '));
    }
  }
  return lines;
}

export function decodeBase64Url(data: string | undefined): string {
  return data ? Buffer.from(data, 'base64url').toString('utf8') : '';
}

type MailPart = { mimeType?: string; filename?: string; body?: { data?: string }; parts?: MailPart[] };

function findPart(part: MailPart, mimeType: string): MailPart | undefined {
  if (part.mimeType === mimeType && part.body?.data && !part.filename) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return undefined;
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** A message body as plain text: the text/plain part, else the HTML part with its tags removed. */
export function mailBodyText(payload: MailPart): string {
  const plain = findPart(payload, 'text/plain');
  if (plain) return decodeBase64Url(plain.body?.data).trim();
  const html = findPart(payload, 'text/html');
  return html ? stripHtml(decodeBase64Url(html.body?.data)) : '';
}

export function mailAttachmentNames(payload: MailPart): string[] {
  const names = payload.filename ? [payload.filename] : [];
  for (const child of payload.parts ?? []) names.push(...mailAttachmentNames(child));
  return names;
}

/** A header value must stay on one line, or a pasted newline could add headers of its own. */
function headerValue(name: string, value: string): string {
  if (/[\r\n]/.test(value)) throw new GoogleToolError(`The "${name}" value must not contain a line break.`);
  return value.trim();
}

function encodedSubject(subject: string): string {
  return /^[\x20-\x7e]*$/.test(subject) ? subject : `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

/** An RFC 822 draft message as the Gmail API wants it: base64url of a plain-text message. It is never sent. */
export function draftMessage(draft: { to: string; cc?: string; subject: string; body: string }): string {
  const lines = [`To: ${headerValue('to', draft.to)}`];
  if (draft.cc) lines.push(`Cc: ${headerValue('cc', draft.cc)}`);
  lines.push(
    `Subject: ${encodedSubject(headerValue('subject', draft.subject))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    (Buffer.from(draft.body, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n'),
  );
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}
