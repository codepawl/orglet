import { DEFAULT_WAIT_SECONDS, MAX_FILES, MAX_WAIT_SECONDS } from './protocol';

/** Turning `orglet …` arguments into one command, and the help text for each (COD-234). */

export type CommandName = 'status' | 'list' | 'send' | 'read' | 'open';

export type ParsedCommand =
  | { kind: 'help'; topic?: CommandName }
  | { kind: 'version' }
  | { kind: 'status'; json: boolean }
  | { kind: 'list'; json: boolean }
  | { kind: 'send'; message: string; to: string; files: string[]; wait: boolean; timeoutSeconds: number; json: boolean }
  | { kind: 'read'; to: string; json: boolean }
  | { kind: 'open'; to?: string; json: boolean };

/** A mistake in how the command was typed; exits with code 2. */
export class UsageError extends Error {}

const COMMAND_NAMES: readonly CommandName[] = ['status', 'list', 'send', 'read', 'open'];

export const MAIN_HELP = `orglet: talk to the Orglet app from a terminal.

The app must be installed; it is started if it is not running. Keys, chats and
files stay in the app. This command only sends requests to it.

Usage:
  orglet <command> [options]

Commands:
  status    Whether the app is running, its version, how many orglets and crews
  list      Orglets and crews by name, with their provider and model
  send      Send a message to an orglet or crew and print the answer
  read      Print the latest answer in a chat
  open      Bring the Orglet window forward, optionally on one chat

Options:
  -h, --help       Show help. "orglet <command> --help" shows a command's options.
  -v, --version    Show the version of this command

Exit codes: 0 ok, 1 failure, 2 usage error, 3 app not reachable.`;

export const COMMAND_HELP: Record<CommandName, string> = {
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
};

type Options = {
  help: boolean;
  version: boolean;
  json: boolean;
  wait: boolean;
  to?: string;
  timeout?: string;
  files: string[];
  positionals: string[];
};

/** Options that take a value, written as `--to Researcher` or `--to=Researcher`. */
const VALUE_OPTIONS = new Set(['--to', '--file', '--timeout']);

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
  const sendOnly = options.files.length > 0 || !options.wait || options.timeout !== undefined;
  if (command !== 'send' && sendOnly) throw new UsageError('--file, --no-wait and --timeout belong to "orglet send".');
  const takesName = command === 'send' || command === 'read' || command === 'open';
  if (!takesName && options.to !== undefined) throw new UsageError(`"orglet ${command}" does not take --to.`);
  const takesMessage = command === 'send';
  const extra = takesMessage ? options.positionals.slice(2) : options.positionals.slice(1);
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
    case 'status': return { kind: 'status', json };
    case 'list': return { kind: 'list', json };
    case 'read': return { kind: 'read', to: requireName(command, options.to), json };
    case 'open': return { kind: 'open', ...(options.to?.trim() ? { to: options.to.trim() } : {}), json };
    case 'send': return parseSend(options);
  }
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
