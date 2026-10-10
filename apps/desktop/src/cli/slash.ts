import { t } from './text';
import { MessageRef, UserMessageRef, type ChatControl } from './protocol';
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
  | { kind: 'revise'; ref: string; text: string }
  | { kind: 'reply'; ref: string; message: string }
  | { kind: 'react'; emoji: Reaction; active: boolean; ref?: string }
  | { kind: 'forward'; targets: string[]; ref?: string }
  | { kind: 'answer'; answer: string }
  | { kind: 'control'; action: ChatControl }
  | { kind: 'chats'; archived: boolean; space?: string }
  | { kind: 'side'; message: string }
  | { kind: 'bring'; ref?: string }
  | { kind: 'channel'; names: string[]; message: string; space?: string; category?: string }
  /** A command that is the same as the one-shot `orglet <argv>`; `withChat` adds the chat this one is open on. */
  | { kind: 'cli'; argv: string[]; withChat?: boolean }
  | { kind: 'members'; names: string[] }
  | { kind: 'rename'; title: string }
  | { kind: 'archive' }
  | { kind: 'schedules' }
  | { kind: 'spaces' }
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
  /** Pair with the app so this chat can answer what a chat waits on; `setup` is reserved for grants and secrets. */
  | { kind: 'unlock'; scope: 'decisions' | 'setup' }
  | { kind: 'lock' }
  | { kind: 'approve'; choice?: string; card?: string }
  | { kind: 'help' }
  | { kind: 'exit' }
  /** A known command typed without what it needs; `message` says what to type. */
  | { kind: 'usage'; message: string }
  | { kind: 'unknown'; command: string };

/** In the order `/help` lists them. */
export const SLASH_COMMANDS = ['/to', '/list', '/read', '/open', '/clear', '/queue', '/undo', '/details', '/agents',
  '/history', '/revise', '/reply', '/react', '/unreact', '/forward', '/answer', '/stop', '/pause', '/resume', '/retry', '/continue',
  '/chats', '/side', '/bring', '/channel', '/group', '/members', '/rename', '/archive', '/restore', '/schedules', '/schedule', '/spaces', '/space', '/market',
  '/search', '/running', '/memory', '/usage', '/models', '/language', '/theme', '/preferences', '/show', '/update',
  '/new', '/edit', '/delete', '/unlock', '/lock', '/approve', '/help', '/exit'] as const;

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
  ['/revise <#n> <text>', t('Sửa tin nhắn của bạn và chạy lượt mới; giữ nguyên lịch sử')],
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
  ['/chats [archived] [--space <name>]', t("Liệt kê chat cùng mã; /to #mã mở một chat")],
  ['/side <message>', t("Gửi tin trong một chat phụ mới của Tí này")],
  ['/bring [#n]', t("Đưa câu trả lời của chat phụ này vào chat chính")],
  ['/channel [--space <name> [--category <name>]] <name, …> -- <message>', t("Tạo kênh với các Tí này (/group là tên cũ)")],
  ['/members <name, …>', t("Đổi thành viên của kênh này")],
  ['/rename <title>', t("Đổi tên chat này")],
  ['/archive', t("Lưu trữ chat này")],
  ['/restore #<id> | orglet|channel "<name>"', 'Restore an archived chat, orglet or channel (same as orglet restore)'],
  ['/schedules', t("Liệt kê lịch")],
  ['/schedule on|off|run <name>', t("Bật, tắt hoặc chạy ngay một lịch")],
  ['/schedule dismiss|catch-up|delete …', 'Close a missed-run notice, run the missed time, or delete a schedule (--confirm "<name>"); add and edit are orglet schedule'],
  ['/spaces', t("Liệt kê không gian với Tí và kênh của chúng")],
  ['/space <verb> …', 'Create or change a space, its categories, folder, colour and order (same as orglet space)'],
  ['/market [installed|add <id>|update "<name>" [--confirm <code>]]', 'The marketplace (same as orglet market)'],
  ['/search <words>', t("Tìm trong mọi chat")],
  ['/running', t("Mọi lượt đang chạy hoặc đang chờ")],
  ['/memory [edit|delete <id> …]', t("Ghi nhớ của Tí hoặc kênh này")],
  ['/usage', t("Mức dùng gói của các tài khoản CLI")],
  ['/models', t("Các model của kết nối mà Tí này dùng")],
  ['/language vi|en|en-GB', t("Đổi ngôn ngữ của app")],
  ['/theme system|light|dark', t("Đổi giao diện của app")],
  ['/preferences [--titles on|off …]', 'Show or change the looks and behaviour settings (same as orglet preferences)'],
  ['/show <topic>', 'connections, spend, changelog, update, or for this chat: browser, desktop, sources, changes'],
  ['/update', 'Check for a new version of Orglet'],
  ['/new [orglet|channel]', t("Tạo Tí hoặc kênh trong terminal này")],
  ['/edit [name]', t("Sửa cấu hình; bỏ tên để chọn trong danh sách")],
  ['/delete [name]', t("Xóa Tí hoặc kênh sau khi gõ tên đầy đủ")],
  ['/unlock [setup]', t('Mở khóa bằng mã hiện trong cửa sổ Orglet để trả lời thẻ đang chờ ngay trong terminal')],
  ['/lock', t('Khóa lại: quên quyền đã mở khóa')],
  ['/approve [<lựa chọn>] [<mã thẻ>]', t('Xem thẻ đang chờ của chat này, hoặc trả lời nó bằng một lựa chọn')],
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
    case '/revise': return parseRevise(rest);
    case '/reply': return parseReply(rest);
    case '/react':
    case '/unreact': return parseReact(rest, command === '/react');
    case '/forward': return parseForward(rest);
    case '/answer': return rest ? { kind: 'answer', answer: rest } : { kind: 'usage', message: t("Gõ /answer rồi số của lựa chọn hoặc câu trả lời của bạn.") };
    case '/chats': return parseChats(rest, trimmed);
    case '/side': return rest ? { kind: 'side', message: rest } : { kind: 'usage', message: t("Gõ /side rồi tin nhắn cho chat phụ.") };
    case '/bring': return !rest ? { kind: 'bring' } : isMessageRef(rest) ? { kind: 'bring', ref: rest } : { kind: 'usage', message: t("Gõ /bring hoặc /bring #2.1.") };
    case '/channel':
    case '/group': return parseChannel(command, rest);
    case '/members': return parseMembers(rest);
    case '/rename': return rest ? { kind: 'rename', title: rest } : { kind: 'usage', message: t("Gõ /rename rồi tên mới.") };
    case '/archive': return rest ? { kind: 'unknown', command: trimmed } : { kind: 'archive' };
    case '/schedules': return rest ? { kind: 'unknown', command: trimmed } : { kind: 'schedules' };
    case '/spaces': return rest ? { kind: 'unknown', command: trimmed } : { kind: 'spaces' };
    case '/schedule': return parseSchedule(rest);
    case '/search': return rest ? { kind: 'search', query: rest } : { kind: 'usage', message: t("Gõ /search rồi từ cần tìm.") };
    case '/running': return rest ? { kind: 'unknown', command: trimmed } : { kind: 'running' };
    case '/memory': return rest ? passThrough('memory', rest, ['edit', 'delete'], trimmed) : { kind: 'memory' };
    case '/space': return rest ? passThrough('space', rest, undefined, trimmed) : { kind: 'usage', message: t("Gõ /space rồi một lệnh như orglet space: add, edit, category, move, folder, color, order, delete.") };
    case '/market': return passThrough('market', rest, undefined, trimmed);
    case '/restore': return parseRestore(rest);
    case '/preferences': return passThrough('preferences', rest, undefined, trimmed);
    case '/show': return parseShow(rest, trimmed);
    case '/unlock': return rest === '' ? { kind: 'unlock', scope: 'decisions' } : rest === 'setup' ? { kind: 'unlock', scope: 'setup' } : { kind: 'unknown', command: trimmed };
    case '/lock': return rest ? { kind: 'unknown', command: trimmed } : { kind: 'lock' };
    case '/approve': {
      const [choice, card] = rest.split(/\s+/).filter(Boolean);
      return { kind: 'approve', ...(choice ? { choice } : {}), ...(card ? { card } : {}) };
    }
    case '/update': return rest ? { kind: 'unknown', command: trimmed } : { kind: 'cli', argv: ['update'] };
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

function parseRevise(rest: string): SlashCommand {
  const space = rest.search(/\s/);
  const ref = space === -1 ? rest : rest.slice(0, space);
  const text = space === -1 ? '' : rest.slice(space).trim();
  if (!UserMessageRef.safeParse(ref).success || !text) return { kind: 'usage', message: t('Gõ /revise #3 rồi chữ đã sửa. /history cho xem số của tin nhắn của bạn.') };
  return { kind: 'revise', ref, text };
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
  const place = leadingPlace(rest);
  const separator = place.rest.indexOf(' -- ');
  const names = separator === -1 ? [] : nameList(place.rest.slice(0, separator));
  const message = separator === -1 ? '' : place.rest.slice(separator + 4).trim();
  if (!names.length || !message) return { kind: 'usage', message: t("Gõ {0} Tí một, Tí hai -- tin nhắn đầu tiên.", command) };
  return { kind: 'channel', names, message, ...(place.space ? { space: place.space } : {}), ...(place.category ? { category: place.category } : {}) };
}

/** The `--space <name>` and `--category <name>` a `/channel` line may start with; a name with spaces is quoted. */
function leadingPlace(rest: string): { space?: string; category?: string; rest: string } {
  const place: { space?: string; category?: string } = {};
  const optionPattern = /^--(space|category)\s+("[^"]*"|'[^']*'|\S+)\s*/;
  let remaining = rest.trimStart();
  let option = remaining.match(optionPattern);
  while (option) {
    place[option[1] as 'space' | 'category'] = splitWords(option[2])[0];
    remaining = remaining.slice(option[0].length);
    option = remaining.match(optionPattern);
  }
  return { ...place, rest: remaining };
}

function parseMembers(rest: string): SlashCommand {
  const names = nameList(rest);
  if (!names.length) return { kind: 'usage', message: t("Gõ /members rồi tên các Tí, cách nhau bằng dấu phẩy.") };
  return { kind: 'members', names };
}

/**
 * Splits a line into words the way a shell does for the cases that matter here: spaces separate words, and a pair of
 * double or single quotes keeps its spaces inside one word.
 */
export function splitWords(text: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: string | undefined;
  let started = false;
  for (const character of text) {
    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started || current) words.push(current);
      current = '';
      started = false;
    } else {
      current += character;
    }
  }
  if (started || current) words.push(current);
  return words;
}

/**
 * A slash command that is `orglet <command> <the rest>` typed in the chat. With `verbs`, the first word must be one
 * of them; the one-shot command's own parser then checks everything else when it runs.
 */
function passThrough(command: string, rest: string, verbs: readonly string[] | undefined, typed: string): SlashCommand {
  const words = splitWords(rest);
  if (verbs && !verbs.includes(words[0] ?? '')) return { kind: 'unknown', command: typed };
  return { kind: 'cli', argv: [command, ...words] };
}

/** `/chats`, `/chats archived`, `/chats --space Launch`, or both. */
function parseChats(rest: string, typed: string): SlashCommand {
  const words = splitWords(rest);
  const archived = words[0] === 'archived';
  const options = archived ? words.slice(1) : words;
  if (options.length === 0) return { kind: 'chats', archived };
  if (options[0] !== '--space' || options.length !== 2) return { kind: 'unknown', command: typed };
  return { kind: 'chats', archived, space: options[1] };
}

/** `/restore #3f2a` brings an archived chat back; `/restore orglet "Name"` or `/restore channel "Name"` an archived orglet or channel. */
function parseRestore(rest: string): SlashCommand {
  const words = splitWords(rest);
  if (words.length === 1 && words[0].startsWith('#')) return { kind: 'cli', argv: ['restore', '--chat', words[0].slice(1)] };
  if (words.length >= 2 && ['orglet', 'channel', 'crew', 'team'].includes(words[0])) return { kind: 'cli', argv: ['restore', ...words] };
  return { kind: 'usage', message: t("Gõ /restore #mã để khôi phục một chat (/chats archived liệt kê chúng), hoặc /restore orglet \"tên\" hay /restore channel \"tên\".") };
}

const SHOW_NEEDING_A_CHAT = ['browser', 'desktop', 'sources', 'changes'];

/** `/show spend`, or `/show changes` for the chat this one is open on. */
function parseShow(rest: string, typed: string): SlashCommand {
  const words = splitWords(rest);
  if (words.length === 0) return { kind: 'usage', message: t("Gõ /show rồi một mục: connections, spend, changelog, update, browser, desktop, sources hoặc changes.") };
  if (words.length > 1) return { kind: 'unknown', command: typed };
  return { kind: 'cli', argv: ['show', words[0]], withChat: SHOW_NEEDING_A_CHAT.includes(words[0]) };
}

/** `/schedule on Morning review`: on, off or run, then the schedule's name; every other verb is `orglet schedule` as it is. */
function parseSchedule(rest: string): SlashCommand {
  const space = rest.search(/\s/);
  const action = (space === -1 ? rest : rest.slice(0, space)).toLowerCase();
  const name = space === -1 ? '' : rest.slice(space).trim();
  if (['delete', 'dismiss', 'catch-up'].includes(action)) return { kind: 'cli', argv: ['schedule', action, ...splitWords(name)] };
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
