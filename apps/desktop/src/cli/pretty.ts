import { renderFace, renderMiniFace, renderMiniFaces } from './faces';
import { renderMarkdown } from './markdown';
import { columnWidths, entriesFromList, entryLine, type ChatEntry } from './picker';
import type { CliAnswer, CliTurn, ListValue, StatusValue } from './protocol';
import { isHexColor, muted, NEUTRAL_COLOR, paint, type ColorMode } from './terminal';
import { t } from './text';

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
  const counts = `${plural(value.orglets, 'orglet', 'orglets')}, ${plural(value.channels ?? value.crews, 'channel', 'channels')}`;
  const running = value.running > 0 ? `, ${plural(value.running, 'chat', 'chats')} working` : '';
  const title = `${paint(`Orglet ${value.version}`, { bold: true }, mode)} is running.`;
  return `${faces}  ${title}\n${muted(`${counts}${running}.`, mode)}`;
}

function listLines(entries: readonly ChatEntry[], layout: Layout): string[] {
  const { facesWidth, nameWidth } = columnWidths(entries, layout.width);
  return entries.map(entry => entryLine(entry, false, { ...layout, maxRows: entries.length }, facesWidth, nameWidth));
}

/** `orglet list` with orglet faces and a distinct group icon for channels, which sit under the space they are in. */
export function styledList(value: ListValue, layout: Layout): string {
  const entries = entriesFromList(value);
  const orglets = entries.filter(entry => entry.kind === 'worker');
  const channels = entries.filter(entry => entry.kind === 'team');
  const lines: string[] = [];
  lines.push(orglets.length ? paint('Orglets', { bold: true }, layout.mode) : 'No orglets yet.');
  lines.push(...listLines(orglets, layout));
  if (channels.length) {
    lines.push('', paint('Channels', { bold: true }, layout.mode));
    const anySpace = channels.some(entry => entry.space !== undefined);
    for (const group of groupedBySpace(channels)) {
      const heading = group.space ?? (anySpace ? t('Chưa ở trong không gian nào') : undefined);
      if (heading) lines.push(muted(heading, layout.mode));
      lines.push(...listLines(group.entries, layout));
    }
  }
  return lines.join('\n');
}

/** Entries in runs of one space, in the order given. */
function groupedBySpace(entries: readonly ChatEntry[]): { space?: string; entries: ChatEntry[] }[] {
  const groups: { space?: string; entries: ChatEntry[] }[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last && last.space === entry.space) last.entries.push(entry);
    else groups.push({ ...(entry.space ? { space: entry.space } : {}), entries: [entry] });
  }
  return groups;
}

/** The colour an answer is printed in: its own, else the chat's, else neutral for an app that sent none. */
export function answerColor(answer: CliAnswer, fallback: string | undefined): string {
  if (isHexColor(answer.color)) return answer.color;
  if (isHexColor(fallback)) return fallback;
  return NEUTRAL_COLOR;
}

/** The line over an answer: the happy face and the name in the orglet's colour, with an optional muted note. */
export function answerByline(name: string, color: string, mode: ColorMode, note?: string, showFace = true): string {
  const face = mode === 'none' || !showFace ? '' : `${renderMiniFace(color, mode, 'happy')} `;
  const title = paint(name, { bold: true, foreground: color }, mode);
  const suffix = note ? ` ${muted(`· ${note}`, mode)}` : '';
  return `${face}${title}${suffix}`;
}

export type AnswerLayout = Layout & { fallbackColor?: string; firstNote?: string; showFace?: boolean };

/** Answers the way the chat view prints them: each under its author's byline, the text as light Markdown. */
export function renderAnswers(answers: readonly CliAnswer[], layout: AnswerLayout): string[] {
  const lines: string[] = [];
  answers.forEach((answer, index) => {
    if (index > 0) lines.push('');
    const color = answerColor(answer, layout.fallbackColor);
    lines.push(answerByline(answer.name, color, layout.mode, answerNote(answer, index === 0 ? layout.firstNote : undefined), layout.showFace));
    lines.push(...renderMarkdown(answer.text, { width: layout.width, mode: layout.mode, accent: color, indent: '  ' }));
  });
  return lines;
}

/** The muted words after an answer's name: its number in the history, the person's reaction and the given note. */
function answerNote(answer: CliAnswer, note: string | undefined): string | undefined {
  const parts = [answer.ref ? `#${answer.ref}` : '', answer.reaction ?? '', note ?? ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

/** What the person wrote in one turn, numbered, with the line saying what it replied to or where it was forwarded from. */
export function personLines(turn: CliTurn, layout: Layout): string[] {
  const context = turn.replyTo ? t('trả lời {0}', turn.replyTo) : turn.forwardedFrom ? t('chuyển tiếp từ {0}', turn.forwardedFrom) : '';
  const notes = [context, turn.reaction ?? ''].filter(Boolean).join(' · ');
  const byline = `${paint(`#${turn.number} ${t('Bạn')}`, { bold: true }, layout.mode)}${notes ? ` ${muted(`· ${notes}`, layout.mode)}` : ''}`;
  return [byline, ...renderMarkdown(turn.text, { width: layout.width, mode: layout.mode, indent: '  ' })];
}

/** Past turns as the chat view prints them: each message the person sent, then every answer to it, numbered. */
export function renderTurns(turns: readonly CliTurn[], layout: AnswerLayout): string[] {
  return turns.flatMap((turn, index) => [
    ...(index > 0 ? [''] : []),
    ...personLines(turn, layout),
    ...(turn.answers.length ? ['', ...renderAnswers(turn.answers, { ...layout, firstNote: undefined })] : []),
  ]);
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
