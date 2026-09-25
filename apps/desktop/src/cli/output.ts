import type { CliAnswer, ListValue, OpenValue, ReadValue, RunValue, SendValue, StatusValue } from './protocol';

/** Plain text for a person at a terminal; `--json` prints the values as they came instead (COD-234). */

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function formatStatus(value: StatusValue): string {
  const counts = `${plural(value.orglets, 'orglet', 'orglets')}, ${plural(value.crews, 'crew', 'crews')}`;
  const running = value.running > 0 ? `, ${plural(value.running, 'chat', 'chats')} working` : '';
  return `Orglet ${value.version} is running.\n${counts}${running}.`;
}

function padded(rows: string[][]): string[] {
  const width = Math.max(0, ...rows.map(row => row[0].length));
  return rows.map(row => `  ${row[0].padEnd(width)}  ${row.slice(1).join('  ')}`.trimEnd());
}

export function formatList(value: ListValue): string {
  const lines: string[] = [];
  lines.push(value.orglets.length ? 'Orglets' : 'No orglets yet.');
  lines.push(...padded(value.orglets.map(orglet => [orglet.name, orglet.model ? `${orglet.provider}/${orglet.model}` : orglet.provider])));
  if (value.crews.length) {
    lines.push('', 'Crews');
    lines.push(...padded(value.crews.map(crew => [crew.name, `lead ${crew.lead}`, crew.members.join(', ')])));
  }
  return lines.join('\n');
}

/** One answer prints as its text; several (a crew) each print under the name of the orglet that wrote it. */
export function formatAnswers(answers: readonly CliAnswer[], alwaysNamed: boolean): string {
  if (answers.length === 1 && !alwaysNamed) return answers[0].text;
  return answers.map(answer => `${answer.name}:\n${answer.text}`).join('\n\n');
}

export function formatSend(value: SendValue): string {
  if (!value.waited) return `Sent to ${value.chat.name}.`;
  return formatAnswers(value.answers, value.chat.kind === 'team');
}

export function formatRead(value: ReadValue): string {
  return formatAnswers(value.answers, value.chat.kind === 'team');
}

export function formatOpen(value: OpenValue): string {
  return value.chat ? `Opened the chat with ${value.chat.name}.` : 'Orglet is in front.';
}

export function formatRun(value: RunValue): string {
  return `Started ${value.schedule.name}. Its run is in the app under Schedules.`;
}
