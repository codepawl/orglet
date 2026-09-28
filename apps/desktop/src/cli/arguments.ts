import { t } from './text';
import { DEFAULT_WAIT_SECONDS, MAX_FILES, MAX_WAIT_SECONDS } from './protocol';

/** Turning `orglet …` arguments into one command, and the help text for each (COD-234). */

export type CommandName = 'chat' | 'status' | 'list' | 'send' | 'read' | 'open' | 'run' | 'config' | 'create' | 'edit' | 'delete';
export type ManagementCommand = { entity: 'worker' | 'team'; name?: string; config?: string; confirm?: string; json: boolean } & ({ kind: 'create' } | { kind: 'edit' } | { kind: 'delete' });

export type ParsedCommand =
  | { kind: 'help'; topic?: CommandName }
  | { kind: 'version' }
  | ManagementCommand
  | { kind: 'config'; json: boolean }
  | { kind: 'chat'; to?: string }
  | { kind: 'status'; json: boolean }
  | { kind: 'list'; json: boolean }
  | { kind: 'send'; message: string; to: string; files: string[]; wait: boolean; timeoutSeconds: number; json: boolean }
  | { kind: 'read'; to: string; json: boolean }
  | { kind: 'open'; to?: string; json: boolean }
  | { kind: 'run'; schedule: string; files: string[]; json: boolean };

/** A mistake in how the command was typed; exits with code 2. */
export class UsageError extends Error {}

const COMMAND_NAMES: readonly CommandName[] = ['chat', 'status', 'list', 'send', 'read', 'open', 'run', 'config', 'create', 'edit', 'delete'];

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
  read      Print the latest answer in a chat
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
  delete: t("Cách dùng: orglet delete <orglet|crew> \"<tên>\" --confirm \"<tên đầy đủ>\" [--json]\n\nCần tên đầy đủ khớp hoàn toàn. Chat cũ vẫn đọc được.\nHội, lịch đang bật và việc đang chạy có thể ngăn xóa. Không xóa Tí cuối cùng.\nTrong TUI, /delete yêu cầu gõ tên."),
  chat: `Usage: orglet chat [--to <name>]

Opens a chat in this terminal. Pick an orglet or crew with the arrow keys or by
typing part of its name, then write messages; each answer prints as it lands.
Running orglet with no command in a terminal does the same.

In the chat, /to <name> switches chat, /list lists orglets and crews, /read
shows the latest answer again, /open brings the app to this chat, /clear
clears the screen, /queue shows pending messages and commands, /undo takes the
last queued item back into the draft, /help lists these and /exit leaves.
/new [orglet|crew], /edit [name] and /delete [name] manage configurations here.
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
  --no-wait            Return right after sending
  --timeout <seconds>  How long to wait for the answer (default ${DEFAULT_WAIT_SECONDS})
  --json               Print machine-readable JSON

Example:
  orglet send "Summarise this file" --to Researcher --file notes.txt`,
  read: `Usage: orglet read --to <name> [--json]

Prints the latest answer in the chat with an orglet or crew.

Options:
  --to <name>    The orglet or crew (required)
  --json         Print machine-readable JSON`,
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

type Options = {
  help: boolean;
  version: boolean;
  json: boolean;
  wait: boolean;
  to?: string;
  timeout?: string;
  config?: string;
  confirm?: string;
  files: string[];
  positionals: string[];
};

/** Options that take a value, written as `--to Researcher` or `--to=Researcher`. */
const VALUE_OPTIONS = new Set(['--to', '--file', '--timeout', '--config', '--confirm']);

function readOptions(argumentList: readonly string[]): Options {
  const options: Options = { help: false, version: false, json: false, wait: true, files: [], positionals: [] };
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
  if (name === '--config' || name === '--confirm') {
    const key = name === '--config' ? 'config' : 'confirm';
    if (options[key] !== undefined) throw new UsageError(`${name} can be given once.`);
    options[key] = value;
    return;
  }
  if (name === '--file') {
    options.files.push(value);
    return;
  }
  if (name === '--to') {
    if (options.to !== undefined) throw new UsageError('--to can be given once.');
    options.to = value;
    return;
  }
  options.timeout = value;
}

function assignFlag(options: Options, name: string): void {
  if (name === '-h' || name === '--help') options.help = true;
  else if (name === '-v' || name === '--version') options.version = true;
  else if (name === '--json') options.json = true;
  else if (name === '--no-wait') options.wait = false;
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
  const sendOnly = !options.wait || options.timeout !== undefined;
  if (command !== 'send' && sendOnly) throw new UsageError('--no-wait and --timeout belong to "orglet send".');
  const takesFiles = command === 'send' || command === 'run';
  if (!takesFiles && options.files.length > 0) throw new UsageError('--file belongs to "orglet send" and "orglet run".');
  const takesName = command === 'chat' || command === 'send' || command === 'read' || command === 'open';
  if (!takesName && options.to !== undefined) throw new UsageError(`"orglet ${command}" does not take --to.`);
  if (command === 'chat' && options.json) throw new UsageError('"orglet chat" does not take --json. Use "orglet send --json" in scripts.');
  const takesMessage = command === 'send' || command === 'run';
  const extra = ['create', 'edit', 'delete'].includes(command) ? options.positionals.slice(command === 'create' ? 2 : 3) : takesMessage ? options.positionals.slice(2) : options.positionals.slice(1);
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
    case 'read': return { kind: 'read', to: requireName(command, options.to), json };
    case 'open': return { kind: 'open', ...(options.to?.trim() ? { to: options.to.trim() } : {}), json };
    case 'send': return parseSend(options);
    case 'run': return parseRun(options);
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
  return {
    kind: 'send',
    message,
    to: requireName('send', options.to),
    files: options.files,
    wait: options.wait,
    timeoutSeconds: parseTimeout(options.timeout),
    json: options.json,
  };
}
