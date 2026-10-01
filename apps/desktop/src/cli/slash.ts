import { t } from './text';
import { MessageRef, type ChatControl } from './protocol';
import { Reaction } from '../shared/message-interactions';
/** The commands of `orglet chat` that start with a slash, and their Tab completion (COD-236, COD-354). */

export type SlashCommand =
  | { kind: 'to'; name?: string }
  | { kind: 'list' }
  | { kind: 'read' }
  | { kind: 'open' }
  | { kind: 'clear' }
  | { kind: 'queue' }
  | { kind: 'undo' }
  | { kind: 'details' }
  | { kind: 'agents' }
  | { kind: 'history'; count?: number }
  | { kind: 'reply'; ref: string; message: string }
  | { kind: 'react'; emoji: Reaction; active: boolean; ref?: string }
  | { kind: 'forward'; targets: string[]; ref?: string }
  | { kind: 'answer'; answer: string }
  | { kind: 'control'; action: ChatControl }
  | { kind: 'chats'; archived: boolean }
  | { kind: 'side'; message: string }
  | { kind: 'bring'; ref?: string }
  | { kind: 'channel'; names: string[]; message: string }
  | { kind: 'members'; names: string[] }
  | { kind: 'rename'; title: string }
  | { kind: 'archive' }
  | { kind: 'schedules' }
  | { kind: 'schedule'; action: 'on' | 'off' | 'run'; name: string }
  | { kind: 'search'; query: string }
  | { kind: 'running' }
  | { kind: 'memory' }
  | { kind: 'plan-usage' }
  | { kind: 'models' }
  | { kind: 'language'; language: 'vi' | 'en' | 'en-GB' }
  | { kind: 'theme'; theme: 'system' | 'light' | 'dark' }
  | { kind: 'new'; entity?: 'worker' | 'team' }
  | { kind: 'edit' | 'delete'; name?: string }
  | { kind: 'help' }
  | { kind: 'exit' }
  /** A known command typed without what it needs; `message` says what to type. */
  | { kind: 'usage'; message: string }
  | { kind: 'unknown'; command: string };

/** In the order `/help` lists them. */
export const SLASH_COMMANDS = ['/to', '/list', '/read', '/open', '/clear', '/queue', '/undo', '/details', '/agents',
  '/history', '/reply', '/react', '/unreact', '/forward', '/answer', '/stop', '/pause', '/resume', '/retry', '/continue',
  '/chats', '/side', '/bring', '/channel', '/group', '/members', '/rename', '/archive', '/schedules', '/schedule',
  '/search', '/running', '/memory', '/usage', '/models', '/language', '/theme',
  '/new', '/edit', '/delete', '/help', '/exit'] as const;

const CONTROLS: Record<string, ChatControl> = { '/stop': 'stop', '/pause': 'pause', '/resume': 'resume', '/retry': 'retry', '/continue': 'continue' };
/** How many earlier turns one `/history` or Page Up at the top loads. */
export const HISTORY_PAGE = 10;

export const SLASH_HELP: readonly [string, string][] = [
  ['/to <name>', 'Switch to another orglet or channel; without a name, pick from the list'],
  ['/list', 'List orglets and channels'],
  ['/read', 'Show the latest answer in this chat again'],
  ['/open', 'Bring the app forward on this chat'],
  ['/clear', 'Clear the screen'],
  ['/queue', 'Show this terminal\'s pending messages and commands'],
  ['/undo', 'Take the last queued item back into the draft'],
  ['/details', 'Expand or collapse steps and answers (Ctrl+O)'],
  ['/agents', 'Show or hide agent context (Ctrl+G)'],
  ['/history [n]', t("Tải các lượt cũ hơn của chat này (PgUp ở đầu cũng vậy)")],
  ['/reply <#n> <message>', t("Trả lời một tin nhắn theo số của nó, như #3 hoặc #3.1")],
  ['/react <emoji> [#n]', t("Thả cảm xúc lên câu trả lời mới nhất hoặc tin #n")],
  ['/unreact <emoji> [#n]', t("Gỡ cảm xúc đó")],
  ['/forward <name, …> [#n]', t("Chuyển tiếp câu trả lời mới nhất hoặc tin #n")],
  ['/answer <n|text>', t("Trả lời câu hỏi Tí đang chờ")],
  ['/stop', t("Dừng lượt đang chạy")],
  ['/pause', t("Tạm dừng sau bước đang làm")],
  ['/resume', t("Tiếp tục lượt đã tạm dừng")],
  ['/retry', t("Chạy lại tin nhắn mới nhất")],
  ['/continue', t("Tiếp tục câu trả lời bị dừng vì hết bước")],
  ['/chats [archived]', t("Liệt kê chat cùng mã; /to #mã mở một chat")],
  ['/side <message>', t("Gửi tin trong một chat phụ mới của Tí này")],
  ['/bring [#n]', t("Đưa câu trả lời của chat phụ này vào chat chính")],
  ['/channel <name, …> -- <message>', t("Tạo kênh với các Tí và kênh này (/group là tên cũ)")],
  ['/members <name, …>', t("Đổi thành viên của kênh này")],
  ['/rename <title>', t("Đổi tên chat này")],
  ['/archive', t("Lưu trữ chat này")],
  ['/schedules', t("Liệt kê lịch")],
  ['/schedule on|off|run <name>', t("Bật, tắt hoặc chạy ngay một lịch")],
  ['/search <words>', t("Tìm trong mọi chat")],
  ['/running', t("Mọi lượt đang chạy hoặc đang chờ")],
  ['/memory', t("Ghi nhớ của Tí hoặc kênh này")],
  ['/usage', t("Mức dùng gói của các tài khoản CLI")],
  ['/models', t("Các model của kết nối mà Tí này dùng")],
  ['/language vi|en|en-GB', t("Đổi ngôn ngữ của app")],
  ['/theme system|light|dark', t("Đổi giao diện của app")],
  ['/new [orglet|channel]', t("Tạo Tí hoặc kênh trong terminal này")],
  ['/edit [name]', t("Sửa cấu hình; bỏ tên để chọn trong danh sách")],
  ['/delete [name]', t("Xóa Tí hoặc kênh sau khi gõ tên đầy đủ")],
  ['/help', 'Show these commands'],
  ['/exit', 'Leave (Ctrl+D does the same)'],
];

export function isSlashCommand(line: string): boolean {
  return !/[\r\n]/.test(line) && line.trimStart().startsWith('/');
}

/** Reads one typed line that starts with a slash. Command names ignore case; `/quit` is `/exit`. */
export function parseSlash(line: string): SlashCommand {
  const trimmed = line.trim();
  const space = trimmed.search(/\s/);
  const command = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase();
  const rest = space === -1 ? '' : trimmed.slice(space).trim();
  if (CONTROLS[command]) return rest ? { kind: 'unknown', command: trimmed } : { kind: 'control', action: CONTROLS[command] };
  switch (command) {
    case '/to': return rest ? { kind: 'to', name: rest } : { kind: 'to' };
    case '/list': return { kind: 'list' };
    case '/read': return { kind: 'read' };
    case '/open': return { kind: 'open' };
    case '/clear': return { kind: 'clear' };
    case '/queue': return { kind: 'queue' };
    case '/undo': return { kind: 'undo' };
    case '/details': return { kind: 'details' };
    case '/agents': return { kind: 'agents' };
    case '/history': return parseHistory(rest);
    case '/reply': return parseReply(rest);
    case '/react':
    case '/unreact': return parseReact(rest, command === '/react');
    case '/forward': return parseForward(rest);
    case '/answer': return rest ? { kind: 'answer', answer: rest } : { kind: 'usage', message: t("Gõ /answer rồi số của lựa chọn hoặc câu trả lời của bạn.") };
    case '/chats': return rest === '' || rest === 'archived' ? { kind: 'chats', archived: rest === 'archived' } : { kind: 'unknown', command: trimmed };
    case '/side': return rest ? { kind: 'side', message: rest } : { kind: 'usage', message: t("Gõ /side rồi tin nhắn cho chat phụ.") };
    case '/bring': return !rest ? { kind: 'bring' } : isMessageRef(rest) ? { kind: 'bring', ref: rest } : { kind: 'usage', message: t("Gõ /bring hoặc /bring #2.1.") };
    case '/channel':
    case '/group': return parseChannel(command, rest);
    case '/members': return parseMembers(rest);
    case '/rename': return rest ? { kind: 'rename', title: rest } : { kind: 'usage', message: t("Gõ /rename rồi tên mới.") };
    case '/archive': return rest ? { kind: 'unknown', command: trimmed } : { kind: 'archive' };
    case '/schedules': return rest ? { kind: 'unknown', command: trimmed } : { kind: 'schedules' };
    case '/schedule': return parseSchedule(rest);
    case '/search': return rest ? { kind: 'search', query: rest } : { kind: 'usage', message: t("Gõ /search rồi từ cần tìm.") };
    case '/running': return rest ? { kind: 'unknown', command: trimmed } : { kind: 'running' };
    case '/memory': return rest ? { kind: 'unknown', command: trimmed } : { kind: 'memory' };
    case '/usage': return rest ? { kind: 'unknown', command: trimmed } : { kind: 'plan-usage' };
    case '/models': return rest ? { kind: 'unknown', command: trimmed } : { kind: 'models' };
    case '/language': return parseLanguage(rest);
    case '/theme': return parseTheme(rest);
    case '/new': return rest === 'orglet' ? { kind: 'new', entity: 'worker' } : rest === 'channel' || rest === 'crew' || rest === 'team' ? { kind: 'new', entity: 'team' } : rest ? { kind: 'unknown', command: trimmed } : { kind: 'new' };
    case '/edit': return { kind: 'edit', ...(rest ? { name: rest } : {}) };
    case '/delete': return { kind: 'delete', ...(rest ? { name: rest } : {}) };
    case '/help': return { kind: 'help' };
    case '/exit':
    case '/quit': return { kind: 'exit' };
    default: return { kind: 'unknown', command };
  }
}

function isMessageRef(text: string): boolean {
  return MessageRef.safeParse(text).success;
}

function parseHistory(rest: string): SlashCommand {
  if (!rest) return { kind: 'history' };
  const count = Number(rest);
  if (!Number.isInteger(count) || count < 1 || count > 50) return { kind: 'usage', message: t("Gõ /history hoặc /history <số từ 1 đến 50>.") };
  return { kind: 'history', count };
}

function parseReply(rest: string): SlashCommand {
  const space = rest.search(/\s/);
  const ref = space === -1 ? rest : rest.slice(0, space);
  const message = space === -1 ? '' : rest.slice(space).trim();
  if (!isMessageRef(ref) || !message) return { kind: 'usage', message: t("Gõ /reply #3.1 rồi tin nhắn. /history cho xem số của từng tin.") };
  return { kind: 'reply', ref, message };
}

function parseReact(rest: string, active: boolean): SlashCommand {
  const [emojiText, ref, ...extra] = rest.split(/\s+/).filter(Boolean);
  const emoji = Reaction.safeParse(emojiText?.toLowerCase());
  const refValid = ref === undefined || isMessageRef(ref);
  if (!emoji.success || !refValid || extra.length) return { kind: 'usage', message: t("Gõ /react rồi một cảm xúc: {0}.", Reaction.options.join(', ')) };
  return { kind: 'react', emoji: emoji.data, active, ...(ref ? { ref } : {}) };
}

/** `/forward Writer, Review crew #3.1`: names separated by commas, then an optional message number starting with #. */
function parseForward(rest: string): SlashCommand {
  const last = rest.split(/\s+/).at(-1) ?? '';
  const hasRef = last.startsWith('#') && isMessageRef(last);
  const names = (hasRef ? rest.slice(0, rest.length - last.length) : rest).split(',').map(name => name.trim()).filter(Boolean);
  if (names.length === 0) return { kind: 'usage', message: t("Gõ /forward rồi tên Tí hoặc kênh, cách nhau bằng dấu phẩy.") };
  return { kind: 'forward', targets: names, ...(hasRef ? { ref: last } : {}) };
}

function nameList(text: string): string[] {
  return text.split(',').map(name => name.trim()).filter(Boolean);
}

/** `/channel Writer, Launch crew -- Compare these`: orglet or crew names, then the first message after ` -- `. */
function parseChannel(command: string, rest: string): SlashCommand {
  const separator = rest.indexOf(' -- ');
  const names = separator === -1 ? [] : nameList(rest.slice(0, separator));
  const message = separator === -1 ? '' : rest.slice(separator + 4).trim();
  if (!names.length || !message) return { kind: 'usage', message: t("Gõ {0} Tí một, Kênh hai -- tin nhắn đầu tiên.", command) };
  return { kind: 'channel', names, message };
}

function parseMembers(rest: string): SlashCommand {
  const names = nameList(rest);
  if (!names.length) return { kind: 'usage', message: t("Gõ /members rồi tên các Tí hoặc kênh, cách nhau bằng dấu phẩy.") };
  return { kind: 'members', names };
}

/** `/schedule on Morning review`: on, off or run, then the schedule's name. */
function parseSchedule(rest: string): SlashCommand {
  const space = rest.search(/\s/);
  const action = (space === -1 ? rest : rest.slice(0, space)).toLowerCase();
  const name = space === -1 ? '' : rest.slice(space).trim();
  if ((action !== 'on' && action !== 'off' && action !== 'run') || !name) return { kind: 'usage', message: t("Gõ /schedule on, off hoặc run rồi tên lịch. Tạo và sửa lịch bằng orglet schedule.") };
  return { kind: 'schedule', action, name };
}

function parseLanguage(rest: string): SlashCommand {
  const language = (['vi', 'en', 'en-GB'] as const).find(item => item.toLowerCase() === rest.toLowerCase());
  return language ? { kind: 'language', language } : { kind: 'usage', message: t("Gõ /language vi, en hoặc en-GB.") };
}

function parseTheme(rest: string): SlashCommand {
  const theme = (['system', 'light', 'dark'] as const).find(item => item === rest.toLowerCase());
  return theme ? { kind: 'theme', theme } : { kind: 'usage', message: t("Gõ /theme system, light hoặc dark.") };
}

function startsWithIgnoringCase(text: string, start: string): boolean {
  return text.toLocaleLowerCase().startsWith(start.toLocaleLowerCase());
}

/**
 * Tab completion in the shape `readline` expects: the candidate lines and the part of the line they replace. A
 * command completes from its start, and `/to `, `/edit `, `/delete ` and `/forward ` complete the chat names.
 */
export function completeSlash(line: string, names: readonly string[]): [string[], string] {
  if (!isSlashCommand(line)) return [[], line];
  const newMatch = line.match(/^\s*\/new\s+(.*)$/i);
  if (newMatch) return [['orglet', 'channel'].filter(kind => startsWithIgnoringCase(kind, newMatch[1])).map(kind => `/new ${kind}`), line];
  const reactMatch = line.match(/^\s*\/(react|unreact)\s+(\S*)$/i);
  if (reactMatch) return [Reaction.options.filter(emoji => startsWithIgnoringCase(emoji, reactMatch[2])).map(emoji => `/${reactMatch[1].toLowerCase()} ${emoji}`), line];
  const toMatch = line.match(/^\s*\/(to|edit|delete|forward)\s+(.*)$/i);
  if (toMatch) {
    const partial = toMatch[2];
    const matches = names.filter(name => startsWithIgnoringCase(name, partial));
    return [matches.map(name => `/${toMatch[1].toLowerCase()} ${name}`), line];
  }
  if (/\s/.test(line.trim())) return [[], line];
  const typed = line.trim();
  const matches = SLASH_COMMANDS.filter(command => startsWithIgnoringCase(command, typed));
  // `/to` needs a name after it, so its completion ends with the space.
  return [matches.map(command => (command === '/to' ? '/to ' : command)), line];
}
