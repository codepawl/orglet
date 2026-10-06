import type { CliListedChannel, CliScheduleRow, LibraryValue, ModelsValue, PreferencesValue, RunningValue, SchedulesValue, ScheduleValue, ChannelCreatedValue, MarketAddValue, MarketInstalledValue, MarketListValue, SearchValue, SpaceChangeValue, SpacesValue, UsageValue } from './protocol';
import type { ArchiveEntityValue, BringValue, ChatChangeValue, ChatsValue, CliAnswer, CliChat, CliChatKind, CliQuestion, CliTurn, ControlValue, ForwardValue, ListValue, MembersValue, OpenValue, ReactValue, ReadValue, RunValue, SendValue, StatusValue, TemplateValue } from './protocol';
import { t } from './text';

/** Plain text for a person at a terminal; `--json` prints the values as they came instead (COD-234). */

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function formatStatus(value: StatusValue): string {
  const counts = `${plural(value.orglets, 'orglet', 'orglets')}, ${plural(value.channels ?? value.crews, 'channel', 'channels')}`;
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
  const channels = value.channels ?? channelsOfCrews(value.crews);
  if (channels.length) {
    lines.push('', 'Channels');
    const groups = channelsBySpace(channels);
    const anySpace = groups.some(group => group.space !== undefined);
    for (const group of groups) {
      const heading = group.space ?? (anySpace ? t('Chưa ở trong không gian nào') : undefined);
      if (heading) lines.push(`  ${heading}`);
      const rows = padded(group.channels.map(channel => [`#${channel.name}`, channel.lead ? t('Tí trưởng {0}', channel.lead) : t('lần lượt'), channel.members.join(', ')]));
      lines.push(...(heading ? rows.map(row => `  ${row}`) : rows));
    }
  }
  return lines.join('\n');
}

/** An app older than the channels listing sends only the channels with a lead, as crews. */
function channelsOfCrews(crews: ListValue['crews']): CliListedChannel[] {
  return crews.map(crew => ({ name: crew.name, mode: 'lead' as const, lead: crew.lead, members: crew.members }));
}

/** The channels in runs of one space, in the order given; `space` is undefined for a run outside every space or with none named. */
export function channelsBySpace(channels: readonly CliListedChannel[]): { space?: string; channels: CliListedChannel[] }[] {
  const groups: { space?: string; channels: CliListedChannel[] }[] = [];
  for (const channel of channels) {
    const last = groups.at(-1);
    if (last && last.space === channel.space) last.channels.push(channel);
    else groups.push({ ...(channel.space ? { space: channel.space } : {}), channels: [channel] });
  }
  return groups;
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
  return `Started ${value.schedule.name}. Its run is in the app's sidebar, under the orglet or channel it runs for.`;
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
  return padded(value.chats.map(row => [row.short, chatKindLabel(row.kind), row.name, row.with.join(', '), row.status])).join('\n');
}

/**
 * The word a person reads for a kind of chat. A crew is a channel where the lead splits the work, so it reads as a
 * channel; `--json` keeps `crew` for scripts that already match on it.
 */
export function chatKindLabel(kind: CliChatKind): string {
  return kind === 'crew' ? 'channel' : kind;
}

/** Where a new side thread or channel is, so the next message can reach it. */
export function formatNewChat(value: SendValue): string {
  return t('Nhắn tiếp trong chat này: orglet send "<tin nhắn>" {0}', chatOption(value.chat));
}

export function formatBring(value: BringValue): string {
  return t('Đã đưa #{0} vào chat chính với {1}.', value.ref, value.chat.name);
}

export function formatMembers(value: MembersValue): string {
  return t('Từ tin nhắn sau, kênh gồm: {0}.', value.names.join(', '));
}

export function formatChatChange(value: ChatChangeValue): string {
  if (value.change === 'rename') return t('Đã đổi tên chat thành {0}.', value.title ?? value.name);
  if (value.change === 'archive') return t('Đã lưu trữ chat {0}.', value.name);
  if (value.change === 'restore') return t('Đã khôi phục chat {0}.', value.name);
  return t('Đã xóa chat {0}.', value.name);
}

export function formatArchiveEntity(value: ArchiveEntityValue): string {
  const kind = value.kind === 'worker' ? 'orglet' : 'channel';
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

/** Spaces one after another: the space and its orglets, then each channel with its category and who is in it. */
export function formatSpaces(value: SpacesValue): string {
  if (value.spaces.length === 0) return t('Chưa có không gian nào.');
  return value.spaces.map(space => {
    const channels = padded(space.channels.map(channel => [
      `  #${channel.name}`,
      channel.category ?? '',
      channel.lead ? t('Tí trưởng {0}', channel.lead) : '',
      channel.access === 'inherit' ? t('mọi Tí của nơi nó nằm') : channel.orglets.join(', '),
    ]));
    return [`${space.name}: ${space.orglets.join(', ')}`, ...channels].join('\n');
  }).join('\n\n');
}

const MARKET_KIND_NAMES = { orglet: 'orglet', crew: 'channel', space: 'space' } as const;

/** The catalog, what was added from it, or what one `add` made. */
export function formatMarket(value: MarketListValue | MarketInstalledValue | MarketAddValue): string {
  if ('installed' in value) {
    if (value.installed.length === 0) return t('Chưa thêm gì từ marketplace.');
    return padded(value.installed.map(item => [item.id, MARKET_KIND_NAMES[item.kind], item.name, `v${item.version}`, item.updateAvailable ? t('có bản cập nhật') : ''])).join('\n');
  }
  if ('listings' in value) {
    const rows = padded(value.listings.map(listing => [listing.id, MARKET_KIND_NAMES[listing.kind], listing.name, listing.author, listing.summary]));
    const notes = [
      ...(value.source === 'online' ? [] : [value.source === 'cache' ? t('Đây là danh mục đã lưu; chưa tải được bản mới.') : t('Đây là danh mục đi kèm app; chưa tải được danh mục trực tuyến.')]),
      ...(value.more ? [t('Còn mục khác; xem tất cả trong app.')] : []),
    ];
    return [...rows, ...notes].join('\n');
  }
  const made = t('Đã thêm {0} ({1}) với {2}.', value.name, MARKET_KIND_NAMES[value.kind], value.orglets.join(', '));
  return value.withoutModel.length ? `${made}\n${t('Chưa có kết nối gợi ý cho: {0}. Chọn model cho các Tí này trong app.', value.withoutModel.join(', '))}` : made;
}

export function formatChannelCreated(value: ChannelCreatedValue): string {
  return value.space ? t('Đã tạo kênh #{0} trong không gian {1}.', value.channel, value.space) : t('Đã tạo kênh #{0}.', value.channel);
}

export function formatSpaceChange(value: SpaceChangeValue): string {
  const orglets = (value.orglets ?? []).join(', ');
  if (value.verb === 'add') return t('Đã tạo không gian {0} với {1}.', value.space ?? '', orglets);
  if (value.verb === 'edit') return t('Đã lưu không gian {0}: {1}.', value.space ?? '', orglets);
  if (value.verb === 'category' && value.existing) return t('Đã lưu mục {0} của không gian {1}.', value.category ?? '', value.space ?? '');
  if (value.verb === 'category') return t('Đã thêm mục {0} vào không gian {1}.', value.category ?? '', value.space ?? '');
  if (value.verb === 'uncategory') return t('Đã xóa mục {0} khỏi không gian {1}. Các kênh của nó vẫn ở trong không gian.', value.category ?? '', value.space ?? '');
  if (value.verb === 'delete') return t('Đã xóa không gian {0}. Các kênh của nó vẫn còn.', value.space ?? '');
  if (value.verb === 'out') return t('Đã đưa kênh #{0} ra ngoài không gian.', value.channel ?? '');
  return value.category
    ? t('Đã chuyển kênh #{0} vào mục {1} của không gian {2}.', value.channel ?? '', value.category, value.space ?? '')
    : t('Đã chuyển kênh #{0} vào không gian {1}.', value.channel ?? '', value.space ?? '');
}

export function formatScheduleChange(kind: 'schedule-enable' | 'schedule-delete' | 'schedule-save', value: ScheduleValue): string {
  const row = value.schedule;
  if (kind === 'schedule-delete') return t('Đã xóa lịch {0}. Các lần chạy cũ vẫn là chat.', row.name);
  if (kind === 'schedule-enable') return row.enabled ? t('Đã bật lịch {0}.', row.name) : t('Đã tắt lịch {0}.', row.name);
  return t('Đã lưu lịch {0}: {1}, {2} chạy, {3} mỗi lần.', row.name, scheduleTiming(row), row.target, formatUsd(row.budgetMicros));
}

/** Matching names, then one line per chat: its id, its name, who wrote the message and the words around the match. */
export function formatSearch(value: SearchValue): string {
  const lines: string[] = [];
  if (value.orglets.length) lines.push(t('Tí: {0}', value.orglets.join(', ')));
  if (value.crews.length) lines.push(t('Kênh: {0}', value.crews.join(', ')));
  lines.push(...padded(value.chats.map(hit => [hit.chat, hit.name, hit.sender ? `${hit.sender}:` : '', hit.snippet])));
  if (lines.length === 0) lines.push(t('Không tìm thấy gì.'));
  if (value.indexing) lines.push(t('Vẫn đang thêm các chat cũ vào chỉ mục, nên có thể thiếu vài kết quả.'));
  return lines.join('\n');
}

/** One line per run: the chat's id and name, the orglet, its state, and what it waits for. */
export function formatRunning(value: RunningValue): string {
  if (value.items.length === 0) return t('Không có gì đang chạy.');
  return padded(value.items.map(item => [item.chat, item.name, item.orglet, item.state, item.waitsFor ? t('chờ {0}', item.waitsFor) : '', item.provider])).join('\n');
}

/** One block per note or memory: its id, status, owner and text. */
export function formatLibrary(value: LibraryValue): string {
  if (value.items.length === 0) return t('Thư viện trống.');
  return value.items.map(item => {
    const marks = [item.status === 'approved' ? '' : item.status, item.pinned ? t('đã ghim') : '', item.owner ?? ''].filter(Boolean).join(' · ');
    const heading = item.kind === 'memory' ? item.short : `${item.short}  ${item.title}`;
    return `${heading}${marks ? `  (${marks})` : ''}\n  ${item.content.replace(/\n/g, '\n  ')}`;
  }).join('\n\n');
}

export function formatMemoryChange(kind: 'memory-edit' | 'memory-delete', value: LibraryValue): string {
  const item = value.items[0];
  return kind === 'memory-delete' ? t('Đã xóa ghi nhớ {0}.', item.short) : t('Đã lưu ghi nhớ {0}.', item.short);
}

/** Each account with its plan and how much of each allowance is used. */
export function formatUsage(value: UsageValue): string {
  if (value.accounts.length === 0) return t('Chưa có tài khoản CLI nào đăng nhập.');
  return value.accounts.map(account => {
    const heading = [account.harness, account.email, account.plan].filter(Boolean).join('  ');
    if (account.unavailable) return `${heading}\n  ${t('không đọc được mức dùng: {0}', account.unavailable)}`;
    const windows = account.windows.map(window => `  ${window.kind}${window.model ? ` ${window.model}` : ''}  ${window.usedPercent}%${window.resetsAt ? `  ${t('làm mới {0}', window.resetsAt)}` : ''}`);
    return [heading, ...windows].join('\n');
  }).join('\n\n');
}

export function formatModels(value: ModelsValue): string {
  if (value.models.length === 0) return t('{0} chưa có model nào.', value.provider);
  const rows = value.models.map(model => [model.id, model.name && model.name !== model.id ? model.name : '', model.deprecated ? t('ngừng hỗ trợ') : '']);
  return [...padded(rows), ...(value.stale ? [t('Danh sách cũ; --refresh tải lại.')] : [])].join('\n');
}

export function formatPreferences(value: PreferencesValue): string {
  return t('Ngôn ngữ: {0}. Giao diện: {1}.', value.language, value.theme);
}

export function formatTemplate(value: TemplateValue): string {
  return t('Đã tạo kênh {0} với {1}.', value.name, value.members.join(', '));
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
  if (value.action === 'revise' && !value.waited) return t('Đã sửa tin nhắn và gửi lượt mới tới {0}. Đọc câu trả lời sau bằng orglet read.', value.chat.name);
  if (!value.waited) return t('Đã gửi tới {0}. Đọc câu trả lời sau bằng orglet read.', value.chat.name);
  return formatAnswers(value.answers, value.chat.kind === 'team');
}
