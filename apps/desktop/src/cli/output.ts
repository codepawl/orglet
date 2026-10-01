import type { CliScheduleRow, SchedulesValue, ScheduleValue } from './protocol';
import type { ArchiveEntityValue, BringValue, ChatChangeValue, ChatsValue, CliAnswer, CliChat, CliQuestion, CliTurn, ControlValue, ForwardValue, ListValue, MembersValue, OpenValue, ReactValue, ReadValue, RunValue, SendValue, StatusValue, TemplateValue } from './protocol';
import { t } from './text';

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
  return `Started ${value.schedule.name}. Its run is in the app's sidebar, under the orglet or crew it runs for.`;
}

/** Past turns in plain text: each numbered message the person sent, then every numbered answer to it (COD-354). */
export function formatTurns(turns: readonly CliTurn[]): string {
  return turns.map(turn => {
    const context = turn.replyTo ? ` (${t('trả lời {0}', turn.replyTo)})` : turn.forwardedFrom ? ` (${t('chuyển tiếp từ {0}', turn.forwardedFrom)})` : '';
    const person = `#${turn.number} ${t('Bạn')}${context}:\n${turn.text}`;
    const answers = turn.answers.map(answer => `#${answer.ref} ${answer.name}:\n${answer.text}`);
    return [person, ...answers].join('\n\n');
  }).join('\n\n');
}

/** The question a turn stopped on, its numbered choices and how to answer it from here. */
export function formatQuestion(question: CliQuestion, chat: CliChat): string {
  const options = question.options.map((option, index) => `  ${index + 1}. ${option}`);
  return [question.question, ...options, t('Trả lời bằng: orglet answer <số hoặc câu trả lời> {0}', chatOption(chat))].join('\n');
}

/** The option that reaches a chat again: `--to` an orglet's or crew's main chat, `--chat` and its short id for any other. */
export function chatOption(chat: CliChat): string {
  return chat.taskId ? `--chat ${chat.taskId.slice(0, SHORT_CHAT_ID)}` : `--to "${chat.name}"`;
}

/** As many characters of a chat id as `orglet chats` prints. */
const SHORT_CHAT_ID = 8;

/** Chats one per line: the short id `--chat` takes, what kind of chat, its name, who answers and how it stands. */
export function formatChats(value: ChatsValue): string {
  if (value.chats.length === 0) return t('Chưa có chat nào.');
  return padded(value.chats.map(row => [row.short, row.kind, row.name, row.with.join(', '), row.status])).join('\n');
}

/** Where a new side thread or group chat is, so the next message can reach it. */
export function formatNewChat(value: SendValue): string {
  return t('Nhắn tiếp trong chat này: orglet send "<tin nhắn>" {0}', chatOption(value.chat));
}

export function formatBring(value: BringValue): string {
  return t('Đã đưa #{0} vào chat chính với {1}.', value.ref, value.chat.name);
}

export function formatMembers(value: MembersValue): string {
  return t('Từ tin nhắn sau, chat nhóm gửi tới: {0}.', value.names.join(', '));
}

export function formatChatChange(value: ChatChangeValue): string {
  if (value.change === 'rename') return t('Đã đổi tên chat thành {0}.', value.title ?? value.name);
  if (value.change === 'archive') return t('Đã lưu trữ chat {0}.', value.name);
  if (value.change === 'restore') return t('Đã khôi phục chat {0}.', value.name);
  return t('Đã xóa chat {0}.', value.name);
}

export function formatArchiveEntity(value: ArchiveEntityValue): string {
  const kind = value.kind === 'worker' ? 'orglet' : 'crew';
  return value.archived ? t('Đã lưu trữ {0} {1}.', kind, value.name) : t('Đã khôi phục {0} {1}.', kind, value.name);
}

const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Integer micros as dollars, the way the terminal writes limits: `$0.50`. */
export function formatUsd(micros: number): string {
  const dollars = micros / 1_000_000;
  return `$${dollars.toFixed(dollars < 0.01 ? 3 : 2)}`;
}

/** When a schedule runs, in the words its options take: `daily at 08:00`, `every 2h from 09:00`, `when called`. */
export function scheduleTiming(row: CliScheduleRow): string {
  if (row.trigger === 'called') return t('khi được gọi');
  if (row.trigger === 'folder') return t('khi có tệp mới');
  if (row.frequency === 'hours') return t('mỗi {0}h từ {1}', row.everyHours, row.time);
  if (row.frequency === 'weekly') return t('weekly vào {0} lúc {1}', WEEKDAY_NAMES[row.weekday], row.time);
  return t('{0} lúc {1}', row.frequency, row.time);
}

/** Schedules one per line: name, on or off, who runs it, when, and its limits. */
export function formatSchedules(value: SchedulesValue): string {
  if (value.schedules.length === 0) return t('Chưa có lịch nào.');
  return padded(value.schedules.map(row => [
    row.name,
    row.enabled ? 'on' : 'off',
    row.target,
    `${scheduleTiming(row)} (${row.timeZone})`,
    row.dailyCapMicros ? t('{0} mỗi lần, {1} mỗi ngày', formatUsd(row.budgetMicros), formatUsd(row.dailyCapMicros)) : t('{0} mỗi lần', formatUsd(row.budgetMicros)),
  ])).join('\n');
}

export function formatScheduleChange(kind: 'schedule-enable' | 'schedule-delete' | 'schedule-save', value: ScheduleValue): string {
  const row = value.schedule;
  if (kind === 'schedule-delete') return t('Đã xóa lịch {0}. Các lần chạy cũ vẫn là chat.', row.name);
  if (kind === 'schedule-enable') return row.enabled ? t('Đã bật lịch {0}.', row.name) : t('Đã tắt lịch {0}.', row.name);
  return t('Đã lưu lịch {0}: {1}, {2} chạy, {3} mỗi lần.', row.name, scheduleTiming(row), row.target, formatUsd(row.budgetMicros));
}

export function formatTemplate(value: TemplateValue): string {
  return t('Đã tạo hội {0} với {1}.', value.name, value.members.join(', '));
}

export function formatReact(value: ReactValue): string {
  return value.active ? t('Đã thả {0} vào #{1}.', value.emoji, value.ref) : t('Đã gỡ {0} khỏi #{1}.', value.emoji, value.ref);
}

export function formatForward(value: ForwardValue): string {
  const sent = value.sent.map(item => t('Đã chuyển tiếp tới {0}.', item.name));
  const failed = value.failed.map(item => t('Không chuyển tiếp được tới {0}: {1}', item.name, item.error));
  return [...sent, ...failed].join('\n');
}

/** What a stop or pause did; a control that waited prints its answers the way `send` does instead. */
export function formatControl(value: ControlValue): string {
  if (value.action === 'stop') return t('Đã dừng lượt đang chạy với {0}.', value.chat.name);
  if (value.action === 'pause') return t('{0} sẽ tạm dừng sau bước đang làm.', value.chat.name);
  if (!value.waited) return t('Đã gửi tới {0}. Đọc câu trả lời sau bằng orglet read.', value.chat.name);
  return formatAnswers(value.answers, value.chat.kind === 'team');
}
