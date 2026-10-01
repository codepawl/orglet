import { t } from './text';
import { DEFAULT_WAIT_SECONDS, MAX_FILES, MAX_READ_TURNS, MAX_WAIT_SECONDS, MessageRef, type ChatControl } from './protocol';
import { MAX_FORWARD_TARGETS } from '../shared/forward';
import { Reaction } from '../shared/message-interactions';

/** Turning `orglet …` arguments into one command, and the help text for each (COD-234). */

export type CommandName = 'chat' | 'status' | 'list' | 'send' | 'read' | 'open' | 'run' | 'config' | 'create' | 'edit' | 'delete'
  | 'react' | 'forward' | 'answer' | ChatControl;
export type ManagementCommand = { entity: 'worker' | 'team'; name?: string; config?: string; confirm?: string; json: boolean } & ({ kind: 'create' } | { kind: 'edit' } | { kind: 'delete' });

export type ParsedCommand =
  | { kind: 'help'; topic?: CommandName }
  | { kind: 'version' }
  | ManagementCommand
  | { kind: 'config'; json: boolean }
  | { kind: 'chat'; to?: string }
  | { kind: 'status'; json: boolean }
  | { kind: 'list'; json: boolean }
  | { kind: 'send'; message: string; to: string; files: string[]; wait: boolean; timeoutSeconds: number; json: boolean; replyTo?: string }
  | { kind: 'read'; to: string; json: boolean; turns?: number }
  | { kind: 'react'; to: string; emoji: Reaction; active: boolean; message?: string; json: boolean }
  | { kind: 'forward'; to: string; targets: string[]; message?: string; note?: string; json: boolean }
  | { kind: 'control'; action: ChatControl; to: string; wait: boolean; timeoutSeconds: number; json: boolean }
  | { kind: 'answer'; to: string; answer: string; wait: boolean; timeoutSeconds: number; json: boolean }
  | { kind: 'open'; to?: string; json: boolean }
  | { kind: 'run'; schedule: string; files: string[]; json: boolean };

/** A mistake in how the command was typed; exits with code 2. */
export class UsageError extends Error {}

const CONTROL_COMMANDS: readonly ChatControl[] = ['stop', 'pause', 'resume', 'retry', 'continue'];
const COMMAND_NAMES: readonly CommandName[] = ['chat', 'status', 'list', 'send', 'read', 'open', 'run', 'config', 'create', 'edit', 'delete',
  'react', 'forward', 'answer', ...CONTROL_COMMANDS];
/** Commands that name a chat with --to. */
const CHAT_COMMANDS: readonly CommandName[] = ['chat', 'send', 'read', 'open', 'react', 'forward', 'answer', ...CONTROL_COMMANDS];
/** Commands that start a turn and wait for it, so --no-wait and --timeout apply. */
const WAITING_COMMANDS: readonly CommandName[] = ['send', 'answer', 'resume', 'retry', 'continue'];

export const MAIN_HELP = `orglet: talk to the Orglet app from a terminal.

The app must be installed; it is started if it is not running. Keys, chats and
files stay in the app. This command only sends requests to it.

Usage:
  orglet                     Chat in this terminal: pick an orglet or crew
  orglet <command> [options]

Commands:
  chat      Talk to an orglet or crew in this terminal
  status    Whether the app is running, its version, how many orglets and crews
  list      Orglets and crews by name, with their provider and model
  send      Send a message to an orglet or crew and print the answer
  read      Print the latest answer in a chat, or its past turns with --turns
  react     React to a message in a chat
  forward   Forward a message to other orglets or crews
  answer    Answer the question an orglet is waiting on
  stop      Stop the turn that is running in a chat
  pause     Pause the running turn after its current step
  resume    Resume a paused or interrupted turn
  retry     Run the latest message again
  continue  Continue an answer that ran out of steps
  open      Bring the Orglet window forward, optionally on one chat
  run       Start a schedule now, optionally with files
  config    Show editable configurations, skill IDs and existing connections
  create    Create an orglet or crew from a JSON configuration
  edit      Apply a JSON patch to an orglet or crew
  delete    Remove an orglet or crew with an exact-name confirmation

Options:
  -h, --help       Show help. "orglet <command> --help" shows a command's options.
  -v, --version    Show the version of this command

Exit codes: 0 ok, 1 failure, 2 usage error, 3 app not reachable.`;

export const COMMAND_HELP: Record<CommandName, string> = {
  config: t("Cách dùng: orglet config [--json]\n\nHiện cấu hình có thể sửa, ID, phiên bản, skill và tên kết nối.\nKhông bao gồm khóa hay quyền truy cập."),
  create: t("Cách dùng: orglet create <orglet|crew> --config <file.json> [--json]\n\nTạo Tí hoặc hội. Dùng \"orglet config --json\" để xem ID skill và thành viên.\nTrong TUI, /new mở form bằng bàn phím.\nTí cần name, instructions, provider và skillId.\nHội cần name, instructions, memberIds, synthesizerId, workflow và monthlyBudgetMicros.\nGiới hạn là số nguyên phần triệu USD."),
  edit: t("Cách dùng: orglet edit <orglet|crew> \"<tên>\" --config <patch.json> [--json]\n\nChỉ thay đổi trường được cung cấp; giữ nguyên trường bị bỏ qua.\nnull xóa giá trị tùy chọn. Từ chối cấu hình vừa bị thay đổi ở nơi khác.\nTrong TUI, /edit mở thiết lập của chat đang chọn."),
  delete: t("Cách dùng: orglet delete <orglet|crew> \"<tên>\" --confirm \"<tên đầy đủ>\" [--json]\n\nCần tên đầy đủ khớp hoàn toàn. Chat cũ vẫn đọc được.\nHội, lịch đang bật và việc đang chạy có thể ngăn xóa. Xóa Tí cuối cùng thì danh sách để trống.\nTrong TUI, /delete yêu cầu gõ tên."),
  chat: `Usage: orglet chat [--to <name>]

Opens a chat in this terminal. Pick an orglet or crew with the arrow keys or by
typing part of its name, then write messages; each answer prints as it lands.
Running orglet with no command in a terminal does the same.

In the chat, /to <name> switches chat, /list lists orglets and crews, /read
shows the latest answer again, /open brings the app to this chat, /clear
clears the screen, /queue shows pending messages and commands, /undo takes the
last queued item back into the draft, /help lists these and /exit leaves.
/new [orglet|crew], /edit [name] and /delete [name] manage configurations here.
/history, /reply, /react, /forward, /answer, /stop, /pause, /resume, /retry and
/continue act on this chat; /help describes each.
/open, /clear, /queue, /undo and /help work while waiting. Press Ctrl+C twice
to leave; typing or Esc dismisses the first hint. Sent work keeps running.

The header shows the connection and selected model. Chat requires a real
connection; /open configures it in the app, then /list refreshes the picker.
Ctrl+O expands answer details and Ctrl+G shows agents. Ctrl+Q shows the queue,
Ctrl+Z edits its last item; Ctrl+P or Left on an empty draft picks another chat.
Page Up/Down scrolls. Ctrl+J adds a line; Ctrl+D leaves.

Options:
  --to <name>    Open this chat straight away`,
  status: `Usage: orglet status [--json]

Shows whether the app is reachable, its version, and how many orglets and crews
it has.

Options:
  --json    Print machine-readable JSON`,
  list: `Usage: orglet list [--json]

Lists orglets and crews by name, with each orglet's provider and model and each
crew's lead and members.

Options:
  --json    Print machine-readable JSON`,
  send: `Usage: orglet send "<message>" --to <name> [options]

Sends a message into the chat with an orglet or crew, the same way the app's
message box does, and prints the answer. A crew prints each member's reply
with its name. The name matches case-insensitively; a unique start of a name
is enough.

Options:
  --to <name>          The orglet or crew (required)
  --file <path>        Attach a file; repeat for more (up to ${MAX_FILES})
  --reply-to <number>  Reply to a message, numbered as "orglet read --turns" prints it
  --no-wait            Return right after sending
  --timeout <seconds>  How long to wait for the answer (default ${DEFAULT_WAIT_SECONDS})
  --json               Print machine-readable JSON

Example:
  orglet send "Summarise this file" --to Researcher --file notes.txt`,
  read: t("Cách dùng: orglet read --to <tên> [--turns <số>] [--json]\n\nIn câu trả lời mới nhất trong chat với Tí hoặc hội.\nVới --turns, in các lượt gần nhất, mỗi tin nhắn có số: #3 là tin thứ ba\ncủa bạn, #3.1 là câu trả lời đầu tiên cho tin đó. Dùng số này với\nreact, forward và send --reply-to.\n\nTùy chọn:\n  --to <tên>       Tí hoặc hội (bắt buộc)\n  --turns <số>     In bấy nhiêu lượt gần nhất, từ 1 đến {0}\n  --json           In JSON cho máy đọc", MAX_READ_TURNS),
  react: t("Cách dùng: orglet react <cảm xúc> --to <tên> [--message <số>] [--off] [--json]\n\nThả cảm xúc lên một tin nhắn, như nút cảm xúc trong app. Mỗi tin có một cảm\nxúc của bạn; cảm xúc mới thay cái cũ. Tí đọc cảm xúc ở lượt sau.\nCảm xúc: {0}.\n\nTùy chọn:\n  --to <tên>         Tí hoặc hội (bắt buộc)\n  --message <số>     Tin nhắn theo số của read --turns, như 3 hoặc 3.1;\n                     mặc định là câu trả lời mới nhất\n  --off              Gỡ cảm xúc này\n  --json             In JSON cho máy đọc", Reaction.options.join(', ')),
  forward: t("Cách dùng: orglet forward --to <tên> --target <tên> [--target <tên>] [tùy chọn]\n\nChuyển tiếp một tin nhắn sang chat của Tí hoặc hội khác, như tin của chính\nbạn, tối đa {0} nơi. Mỗi nơi nhận nó như một lượt mới và trả lời. Tệp chỉ\nđi kèm tên; đính tệp thật trong app.\n\nTùy chọn:\n  --to <tên>         Chat có tin nhắn (bắt buộc)\n  --target <tên>     Nơi nhận; lặp lại để gửi nhiều nơi\n  --message <số>     Tin nhắn theo số của read --turns; mặc định là câu trả\n                     lời mới nhất\n  --note <chữ>       Lời nhắn kèm theo\n  --json             In JSON cho máy đọc", MAX_FORWARD_TARGETS),
  answer: t("Cách dùng: orglet answer \"<câu trả lời>\" --to <tên> [--no-wait] [--timeout <giây>] [--json]\n\nTrả lời câu hỏi Tí đang chờ, rồi đợi lượt chạy tiếp như send. Gõ số của một\nlựa chọn (1, 2, 3) hoặc câu của bạn. read và send in câu hỏi cùng các lựa\nchọn. Câu hỏi xin quyền dùng công cụ MCP chỉ trả lời được trong app.\n\nTùy chọn:\n  --to <tên>           Tí hoặc hội (bắt buộc)\n  --no-wait            Trả về ngay sau khi trả lời\n  --timeout <giây>     Thời gian chờ câu trả lời (mặc định {0})\n  --json               In JSON cho máy đọc", DEFAULT_WAIT_SECONDS),
  ...controlHelp(),
  open: `Usage: orglet open [--to <name>]

Brings the Orglet window forward. With --to, opens that chat.

Options:
  --to <name>    The orglet or crew to open
  --json         Print machine-readable JSON`,
  run: `Usage: orglet run "<schedule>" [--file <path>] [--json]

Starts a schedule from the app's Schedules now, with its brief, its orglet or
crew and its limit, and returns once the run has started. The name matches
case-insensitively; a unique start of a name is enough. Files given with
--file are attached to this run, next to the schedule's own sources.

The schedule must exist, be switched on and be saved as it is now. This
command cannot create or change one. Any schedule can be started this way,
and one set to "Only when called" runs only like this. Nothing runs while
the app is closed; the command starts the app first.

Options:
  --file <path>  Attach a file to this run; repeat for more (up to ${MAX_FILES})
  --json         Print machine-readable JSON

Example:
  orglet run "Invoice check" --file invoice.pdf`,
};

/** One help text for the five controls of a chat's latest turn; they take the same options. */
function controlHelp(): Record<ChatControl, string> {
  const text = t("Cách dùng: orglet <stop|pause|resume|retry|continue> --to <tên> [--no-wait] [--timeout <giây>] [--json]\n\nCác nút dưới lượt mới nhất của chat, như trong app:\n  stop       Dừng lượt đang chạy\n  pause      Tạm dừng sau bước đang làm\n  resume     Tiếp tục lượt đã tạm dừng hoặc bị ngắt từ checkpoint\n  retry      Chạy lại tin nhắn mới nhất với thiết lập hiện tại\n  continue   Tiếp tục câu trả lời bị dừng vì hết bước\n\nresume, retry và continue đợi câu trả lời như send.\n\nTùy chọn:\n  --to <tên>           Tí hoặc hội (bắt buộc)\n  --no-wait            Trả về ngay, không đợi câu trả lời\n  --timeout <giây>     Thời gian chờ (mặc định {0})\n  --json               In JSON cho máy đọc", DEFAULT_WAIT_SECONDS);
  return { stop: text, pause: text, resume: text, retry: text, continue: text };
}

type Options = {
  help: boolean;
  version: boolean;
  json: boolean;
  wait: boolean;
  off: boolean;
  to?: string;
  timeout?: string;
  config?: string;
  confirm?: string;
  turns?: string;
  message?: string;
  replyTo?: string;
  note?: string;
  files: string[];
  targets: string[];
  positionals: string[];
};

type SingleOption = 'to' | 'timeout' | 'config' | 'confirm' | 'turns' | 'message' | 'replyTo' | 'note';

/** Options that take a value, written as `--to Researcher` or `--to=Researcher`. */
const VALUE_OPTIONS = new Set(['--to', '--file', '--timeout', '--config', '--confirm', '--turns', '--message', '--reply-to', '--note', '--target']);
/** Options given at most once, and the field each one fills. */
const SINGLE_OPTIONS: Record<string, SingleOption> = {
  '--to': 'to',
  '--timeout': 'timeout',
  '--config': 'config',
  '--confirm': 'confirm',
  '--turns': 'turns',
  '--message': 'message',
  '--reply-to': 'replyTo',
  '--note': 'note',
};
/** The chat options added for COD-354 and the only commands that take each. */
const CHAT_OPTION_OWNERS: readonly { option: string; given: (options: Options) => boolean; commands: readonly CommandName[] }[] = [
  { option: '--turns', given: options => options.turns !== undefined, commands: ['read'] },
  { option: '--message', given: options => options.message !== undefined, commands: ['react', 'forward'] },
  { option: '--reply-to', given: options => options.replyTo !== undefined, commands: ['send'] },
  { option: '--note', given: options => options.note !== undefined, commands: ['forward'] },
  { option: '--target', given: options => options.targets.length > 0, commands: ['forward'] },
  { option: '--off', given: options => options.off, commands: ['react'] },
];
/** Commands that take one positional value after their name: a message, a schedule, an emoji or an answer. */
const VALUE_COMMANDS: readonly CommandName[] = ['send', 'run', 'react', 'answer'];

function readOptions(argumentList: readonly string[]): Options {
  const options: Options = { help: false, version: false, json: false, wait: true, off: false, files: [], targets: [], positionals: [] };
  let index = 0;
  while (index < argumentList.length) {
    const argument = argumentList[index];
    index += 1;
    if (argument === '--') {
      options.positionals.push(...argumentList.slice(index));
      break;
    }
    if (!argument.startsWith('-') || argument === '-') {
      options.positionals.push(argument);
      continue;
    }
    const equals = argument.indexOf('=');
    const name = equals === -1 ? argument : argument.slice(0, equals);
    if (VALUE_OPTIONS.has(name)) {
      let value: string | undefined;
      if (equals !== -1) {
        value = argument.slice(equals + 1);
      } else {
        value = argumentList[index];
        index += 1;
      }
      if (value === undefined || value === '') throw new UsageError(`${name} needs a value.`);
      assignValue(options, name, value);
      continue;
    }
    if (equals !== -1) throw new UsageError(`${name} does not take a value.`);
    assignFlag(options, name);
  }
  return options;
}

function assignValue(options: Options, name: string, value: string): void {
  if (name === '--file') {
    options.files.push(value);
    return;
  }
  if (name === '--target') {
    options.targets.push(value);
    return;
  }
  const key = SINGLE_OPTIONS[name];
  if (options[key] !== undefined) throw new UsageError(`${name} can be given once.`);
  options[key] = value;
}

function assignFlag(options: Options, name: string): void {
  if (name === '-h' || name === '--help') options.help = true;
  else if (name === '-v' || name === '--version') options.version = true;
  else if (name === '--json') options.json = true;
  else if (name === '--no-wait') options.wait = false;
  else if (name === '--off') options.off = true;
  else throw new UsageError(`Unknown option ${name}.`);
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined) return DEFAULT_WAIT_SECONDS;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_WAIT_SECONDS) {
    throw new UsageError(`--timeout must be a whole number of seconds from 1 to ${MAX_WAIT_SECONDS}.`);
  }
  return seconds;
}

/** Options that only one command understands, so `orglet list --file x` is a mistake rather than ignored. */
function rejectForeignOptions(command: CommandName, options: Options): void {
  if (!['create', 'edit'].includes(command) && options.config !== undefined) throw new UsageError('--config belongs to "orglet create" and "orglet edit".');
  if (command !== 'delete' && options.confirm !== undefined) throw new UsageError('--confirm belongs to "orglet delete".');
  const waitOptions = !options.wait || options.timeout !== undefined;
  if (!WAITING_COMMANDS.includes(command) && waitOptions) throw new UsageError('--no-wait and --timeout belong to "orglet send", "answer", "resume", "retry" and "continue".');
  const takesFiles = command === 'send' || command === 'run';
  if (!takesFiles && options.files.length > 0) throw new UsageError('--file belongs to "orglet send" and "orglet run".');
  if (!CHAT_COMMANDS.includes(command) && options.to !== undefined) throw new UsageError(`"orglet ${command}" does not take --to.`);
  for (const owner of CHAT_OPTION_OWNERS) {
    if (owner.given(options) && !owner.commands.includes(command)) throw new UsageError(`"orglet ${command}" does not take ${owner.option}.`);
  }
  if (command === 'chat' && options.json) throw new UsageError('"orglet chat" does not take --json. Use "orglet send --json" in scripts.');
  const extra = ['create', 'edit', 'delete'].includes(command) ? options.positionals.slice(command === 'create' ? 2 : 3) : VALUE_COMMANDS.includes(command) ? options.positionals.slice(2) : options.positionals.slice(1);
  if (extra.length > 0) throw new UsageError(`Unexpected argument "${extra[0]}". Put a message with spaces in quotes.`);
}

function requireName(command: CommandName, to: string | undefined): string {
  const name = to?.trim();
  if (!name) throw new UsageError(`"orglet ${command}" needs --to <name>.`);
  return name;
}

export function parseArguments(argumentList: readonly string[]): ParsedCommand {
  const options = readOptions(argumentList);
  const [first] = options.positionals;
  if (first === undefined) {
    if (options.version) return { kind: 'version' };
    if (options.help) return { kind: 'help' };
    throw new UsageError('No command given.');
  }
  if (first === 'help') {
    const topic = options.positionals[1];
    return COMMAND_NAMES.includes(topic as CommandName) ? { kind: 'help', topic: topic as CommandName } : { kind: 'help' };
  }
  if (!COMMAND_NAMES.includes(first as CommandName)) throw new UsageError(`Unknown command "${first}".`);
  const command = first as CommandName;
  if (options.help) return { kind: 'help', topic: command };
  rejectForeignOptions(command, options);
  const json = options.json;
  switch (command) {
    case 'create':
    case 'edit':
    case 'delete': return parseManagement(command, options);
    case 'config': return { kind: 'config', json };
    case 'chat': return { kind: 'chat', ...(options.to?.trim() ? { to: options.to.trim() } : {}) };
    case 'status': return { kind: 'status', json };
    case 'list': return { kind: 'list', json };
    case 'read': return parseRead(options);
    case 'open': return { kind: 'open', ...(options.to?.trim() ? { to: options.to.trim() } : {}), json };
    case 'send': return parseSend(options);
    case 'run': return parseRun(options);
    case 'react': return parseReact(options);
    case 'forward': return parseForward(options);
    case 'answer': return parseAnswer(options);
    case 'stop':
    case 'pause':
    case 'resume':
    case 'retry':
    case 'continue': return parseControl(command, options);
  }
}

function parseManagement(kind: 'create' | 'edit' | 'delete', options: Options): ManagementCommand {
  const entityName = options.positionals[1];
  if (entityName !== 'orglet' && entityName !== 'crew' && entityName !== 'team') throw new UsageError(t("Gõ orglet hoặc crew sau lệnh."));
  const name = options.positionals[2]?.trim();
  if (kind !== 'create' && !name) throw new UsageError(t("Gõ tên đầy đủ của Tí hoặc hội."));
  if (kind === 'delete' && !options.confirm) throw new UsageError(t("Xóa cần --confirm \"<tên đầy đủ>\"."));
  if (kind !== 'delete' && !options.config) throw new UsageError(t("Gõ --config <file.json>, hoặc dùng /new và /edit trong TUI."));
  return { kind, entity: entityName === 'orglet' ? 'worker' : 'team', ...(name ? { name } : {}), ...(options.config ? { config: options.config } : {}), ...(options.confirm ? { confirm: options.confirm } : {}), json: options.json };
}

function parseRun(options: Options): ParsedCommand {
  const schedule = options.positionals[1]?.trim();
  if (!schedule) throw new UsageError('"orglet run" needs a schedule name, for example: orglet run "Invoice check"');
  if (options.files.length > MAX_FILES) throw new UsageError(`Attach at most ${MAX_FILES} files.`);
  return { kind: 'run', schedule, files: options.files, json: options.json };
}

function parseSend(options: Options): ParsedCommand {
  const message = options.positionals[1]?.trim();
  if (!message) throw new UsageError('"orglet send" needs a message, for example: orglet send "Hello" --to Researcher');
  if (options.files.length > MAX_FILES) throw new UsageError(`Attach at most ${MAX_FILES} files.`);
  const replyTo = options.replyTo === undefined ? {} : { replyTo: parseMessageRef('--reply-to', options.replyTo) };
  return {
    kind: 'send',
    message,
    to: requireName('send', options.to),
    files: options.files,
    wait: options.wait,
    timeoutSeconds: parseTimeout(options.timeout),
    json: options.json,
    ...replyTo,
  };
}

function parseRead(options: Options): ParsedCommand {
  const to = requireName('read', options.to);
  if (options.turns === undefined) return { kind: 'read', to, json: options.json };
  const turns = Number(options.turns);
  if (!Number.isInteger(turns) || turns < 1 || turns > MAX_READ_TURNS) throw new UsageError(t("--turns cần là số nguyên từ 1 đến {0}.", MAX_READ_TURNS));
  return { kind: 'read', to, turns, json: options.json };
}

/** A message number as `read --turns` prints it: `3`, `3.1`, `#3.1` or `last`. */
function parseMessageRef(option: string, value: string): string {
  if (!MessageRef.safeParse(value).success) throw new UsageError(t("{0} cần số tin nhắn như 3, 3.1 hoặc last.", option));
  return value.trim();
}

function parseReact(options: Options): ParsedCommand {
  const emoji = Reaction.safeParse(options.positionals[1]?.trim().toLowerCase());
  if (!emoji.success) throw new UsageError(t("Gõ một cảm xúc: {0}.", Reaction.options.join(', ')));
  const message = options.message === undefined ? {} : { message: parseMessageRef('--message', options.message) };
  return { kind: 'react', to: requireName('react', options.to), emoji: emoji.data, active: !options.off, ...message, json: options.json };
}

function parseForward(options: Options): ParsedCommand {
  const targets = options.targets.map(target => target.trim()).filter(Boolean);
  if (targets.length === 0) throw new UsageError(t("Chuyển tiếp cần ít nhất một --target <tên>."));
  if (targets.length > MAX_FORWARD_TARGETS) throw new UsageError(t("Chuyển tiếp tối đa {0} nơi.", MAX_FORWARD_TARGETS));
  const message = options.message === undefined ? {} : { message: parseMessageRef('--message', options.message) };
  const note = options.note?.trim() ? { note: options.note.trim() } : {};
  return { kind: 'forward', to: requireName('forward', options.to), targets, ...message, ...note, json: options.json };
}

function parseAnswer(options: Options): ParsedCommand {
  const answer = options.positionals[1]?.trim();
  if (!answer) throw new UsageError(t("Gõ câu trả lời, ví dụ: orglet answer 1 --to Researcher"));
  return { kind: 'answer', to: requireName('answer', options.to), answer, wait: options.wait, timeoutSeconds: parseTimeout(options.timeout), json: options.json };
}

function parseControl(action: ChatControl, options: Options): ParsedCommand {
  return { kind: 'control', action, to: requireName(action, options.to), wait: options.wait, timeoutSeconds: parseTimeout(options.timeout), json: options.json };
}
