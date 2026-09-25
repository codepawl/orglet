import { renderFace, renderMiniFace, renderMiniFaces } from './faces';
import { renderMarkdown } from './markdown';
import { columnWidths, entriesFromList, entryLine, type ChatEntry } from './picker';
import type { CliAnswer, ListValue, StatusValue } from './protocol';
import { isHexColor, muted, NEUTRAL_COLOR, paint, type ColorMode } from './terminal';

/**
 * The one-shot commands and the chat view in colour (COD-236), for a person at a terminal. Only used when
 * `detectColorMode` allows colour; pipes, files and `--json` keep the plain text of output.ts.
 */

export type Layout = { mode: ColorMode; width: number };

/** How many faces a status line shows before it stops; more would wrap a narrow terminal. */
const STATUS_FACE_LIMIT = 12;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function styledStatus(value: StatusValue, mode: ColorMode): string {
  const colors = value.colors?.length ? value.colors.slice(0, STATUS_FACE_LIMIT) : [NEUTRAL_COLOR];
  const faces = renderMiniFaces(colors, mode);
  const counts = `${plural(value.orglets, 'orglet', 'orglets')}, ${plural(value.crews, 'crew', 'crews')}`;
  const running = value.running > 0 ? `, ${plural(value.running, 'chat', 'chats')} working` : '';
  const title = `${paint(`Orglet ${value.version}`, { bold: true }, mode)} is running.`;
  return `${faces}  ${title}\n${muted(`${counts}${running}.`, mode)}`;
}

function listLines(entries: readonly ChatEntry[], layout: Layout): string[] {
  const { facesWidth, nameWidth } = columnWidths(entries, layout.width);
  return entries.map(entry => entryLine(entry, false, { ...layout, maxRows: entries.length }, facesWidth, nameWidth));
}

/** `orglet list` with each orglet's face, and each crew's members side by side. */
export function styledList(value: ListValue, layout: Layout): string {
  const entries = entriesFromList(value);
  const orglets = entries.filter(entry => entry.kind === 'worker');
  // A crew line says who leads it and who is in it, as the plain list does.
  const crews = entries.filter(entry => entry.kind === 'team').map((entry, index) => {
    const crew = value.crews[index];
    return { ...entry, detail: `lead ${crew.lead}  ${crew.members.join(', ')}` };
  });
  const lines: string[] = [];
  lines.push(orglets.length ? paint('Orglets', { bold: true }, layout.mode) : 'No orglets yet.');
  lines.push(...listLines(orglets, layout));
  if (crews.length) {
    lines.push('', paint('Crews', { bold: true }, layout.mode));
    lines.push(...listLines(crews, layout));
  }
  return lines.join('\n');
}

/** The colour an answer is printed in: its own, else the chat's, else neutral for an app that sent none. */
export function answerColor(answer: CliAnswer, fallback: string | undefined): string {
  if (isHexColor(answer.color)) return answer.color;
  if (isHexColor(fallback)) return fallback;
  return NEUTRAL_COLOR;
}

/** The line over an answer: the happy face and the name in the orglet's colour, with an optional muted note. */
export function answerByline(name: string, color: string, mode: ColorMode, note?: string): string {
  const face = mode === 'none' ? '' : `${renderMiniFace(color, mode, 'happy')} `;
  const title = paint(name, { bold: true, foreground: color }, mode);
  const suffix = note ? ` ${muted(`· ${note}`, mode)}` : '';
  return `${face}${title}${suffix}`;
}

export type AnswerLayout = Layout & { fallbackColor?: string; firstNote?: string };

/** Answers the way the chat view prints them: each under its author's byline, the text as light Markdown. */
export function renderAnswers(answers: readonly CliAnswer[], layout: AnswerLayout): string[] {
  const lines: string[] = [];
  answers.forEach((answer, index) => {
    if (index > 0) lines.push('');
    const color = answerColor(answer, layout.fallbackColor);
    const note = index === 0 ? layout.firstNote : undefined;
    lines.push(answerByline(answer.name, color, layout.mode, note));
    lines.push(...renderMarkdown(answer.text, { width: layout.width, mode: layout.mode, accent: color, indent: '  ' }));
  });
  return lines;
}

/** The top of a chat: the big face with the name and the provider and model beside it; a crew adds its members. */
export function chatHeader(entry: ChatEntry, mode: ColorMode): string[] {
  const title = paint(entry.name, { bold: true, foreground: entry.color }, mode);
  const detail = muted(entry.detail, mode);
  if (mode === 'none') return [`${title}  ${detail}`];
  const members = entry.kind === 'team' ? renderMiniFaces(entry.colors, mode) : '';
  const beside = ['', title, detail, members, ''];
  return renderFace(entry.color, 'open', mode).map((row, index) => (beside[index] ? `${row}   ${beside[index]}` : row));
}
