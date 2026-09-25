import { resolve } from 'node:path';
import packageJson from '../../../../package.json';
import { COMMAND_HELP, MAIN_HELP, parseArguments, UsageError, type ParsedCommand } from './arguments';
import { appChatClient } from './chat-client';
import { appExecutable, callStartingApp, resolveUserData, StoppedError, UnreachableError } from './client';
import { runInteractive, type InteractiveInput, type InteractiveOutput } from './interactive';
import { formatList, formatOpen, formatRead, formatRun, formatSend, formatStatus } from './output';
import { entriesFromList, findChat } from './picker';
import { renderAnswers, styledList, styledStatus, type Layout } from './pretty';
import { EXIT_CODES, type CliAnswer, type CliChat, type CliRequestBody, type CliResponse, type ListValue, type OpenValue, type ReadValue, type RunValue, type SendValue, type StatusValue } from './protocol';
import { NEUTRAL_COLOR, type ColorMode } from './terminal';
import { NO_WAITING, WaitingFace, type Waiting } from './waiting';

/**
 * `orglet`, the terminal companion of the running app (COD-234), like VS Code's `code`. It never reads the
 * database, keys or files itself: every command is one request to the app over its local pipe.
 */

/** Standard error as a terminal that can show the waiting face (COD-236). */
export type StatusTerminal = {
  write: (text: string) => void;
  mode: ColorMode;
  columns: () => number;
  /** Where Ctrl+C is not a signal, starts reading it as a key while the face is shown; returns what stops that. */
  catchInterrupt?: () => () => void;
};

export type Output = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** How standard output may be styled (COD-236); absent is plain text, as for pipes, files and the tests. */
  stdoutMode?: ColorMode;
  /** Columns of the terminal standard output shows in. */
  columns?: number;
  /** Present when standard error is a colour terminal: `send` shows the waiting face there. */
  statusTerminal?: StatusTerminal;
};

/** The terminal `orglet chat` runs in: only present when standard input and output both are one. */
export type InteractiveTerminal = { input: InteractiveInput; output: InteractiveOutput; mode: ColorMode };

export type RunExtras = {
  terminal?: InteractiveTerminal;
  /** Aborted on Ctrl+C: the request stops waiting and the command says what keeps running in the app. */
  signal?: AbortSignal;
};

const TERMINAL_FAILURES = new Set(['failed', 'cancelled', 'interrupted']);
const DEFAULT_COLUMNS = 80;

type RequestCommand = Exclude<ParsedCommand, { kind: 'help' } | { kind: 'version' } | { kind: 'chat' }>;

function toRequest(command: RequestCommand, workingDirectory: string): CliRequestBody {
  switch (command.kind) {
    case 'status': return { op: 'status' };
    case 'list': return { op: 'list' };
    case 'read': return { op: 'read', to: command.to };
    case 'open': return { op: 'open', ...(command.to ? { to: command.to } : {}) };
    case 'send': return {
      op: 'send',
      to: command.to,
      message: command.message,
      // The app runs in another folder, so a relative path would point somewhere else there.
      files: command.files.map(file => resolve(workingDirectory, file)),
      wait: command.wait,
      timeoutSeconds: command.timeoutSeconds,
    };
    case 'run': return {
      op: 'run',
      schedule: command.schedule,
      files: command.files.map(file => resolve(workingDirectory, file)),
    };
  }
}

function printJson(output: Output, value: unknown): void {
  output.stdout(JSON.stringify(value, null, 2));
}

function sendExitCode(value: SendValue, output: Output, json: boolean): number {
  if (!value.waited) return EXIT_CODES.ok;
  const readLater = `orglet read --to "${value.chat.name}"`;
  if (!value.finished) {
    if (!json) output.stderr(`${value.chat.name} is still working. Read the answer later with: ${readLater}`);
    return EXIT_CODES.failure;
  }
  if (!json) for (const error of value.errors) output.stderr(error);
  if (TERMINAL_FAILURES.has(value.status)) return EXIT_CODES.failure;
  if (value.answers.length === 0) {
    if (!json) output.stderr(`The chat stopped without an answer (${value.status}). Open it in the app: orglet open --to "${value.chat.name}"`);
    return EXIT_CODES.failure;
  }
  return EXIT_CODES.ok;
}

function readExitCode(value: ReadValue, output: Output, json: boolean): number {
  if (value.answers.length === 0) {
    if (!json) output.stderr(`No answer in the chat with ${value.chat.name} yet.`);
    return EXIT_CODES.failure;
  }
  const working = value.status === 'queued' || value.status === 'running' || value.status === 'pausing';
  if (!json && working) output.stderr(`${value.chat.name} is working on a newer message.`);
  return EXIT_CODES.ok;
}

/** Answers the way the chat view prints them, in the chat's colours. */
function styledAnswers(answers: readonly CliAnswer[], chat: CliChat, layout: Layout): string {
  return renderAnswers(answers, { ...layout, fallbackColor: chat.color }).join('\n');
}

/** Prints a successful response and decides the exit code. */
function report(command: RequestCommand, value: unknown, output: Output, layout: Layout): number {
  if (command.json) printJson(output, value);
  const styled = layout.mode !== 'none';
  switch (command.kind) {
    case 'status': {
      const statusValue = value as StatusValue;
      if (!command.json) output.stdout(styled ? styledStatus(statusValue, layout.mode) : formatStatus(statusValue));
      return EXIT_CODES.ok;
    }
    case 'list': {
      const listValue = value as ListValue;
      if (!command.json) output.stdout(styled ? styledList(listValue, layout) : formatList(listValue));
      return EXIT_CODES.ok;
    }
    case 'open':
      if (!command.json) output.stdout(formatOpen(value as OpenValue));
      return EXIT_CODES.ok;
    case 'run':
      if (!command.json) output.stdout(formatRun(value as RunValue));
      return EXIT_CODES.ok;
    case 'read': {
      const readValue = value as ReadValue;
      if (!command.json && readValue.answers.length) output.stdout(styled ? styledAnswers(readValue.answers, readValue.chat, layout) : formatRead(readValue));
      return readExitCode(readValue, output, command.json);
    }
    case 'send': {
      const sendValue = value as SendValue;
      const printable = !sendValue.waited || sendValue.answers.length > 0;
      const answered = sendValue.waited && sendValue.answers.length > 0;
      if (!command.json && printable) output.stdout(styled && answered ? styledAnswers(sendValue.answers, sendValue.chat, layout) : formatSend(sendValue));
      return sendExitCode(sendValue, output, command.json);
    }
  }
}

function reportFailure(response: Extract<CliResponse, { ok: false }>, json: boolean, output: Output): number {
  if (json) printJson(output, response);
  else output.stderr(response.error);
  return EXIT_CODES.failure;
}

/**
 * The waiting face for `send` on a colour terminal. The chat's colour comes from one `list` first; if that fails the
 * face is neutral and the send itself reports what went wrong.
 */
async function sendWaiting(to: string, terminal: StatusTerminal, userData: string, executable: string | undefined, signal?: AbortSignal): Promise<Waiting> {
  let name = to;
  let color = NEUTRAL_COLOR;
  try {
    const response = await callStartingApp(userData, { op: 'list' }, executable, signal);
    const match = response.ok ? findChat(entriesFromList(response.value as ListValue), to) : undefined;
    if (match && 'entry' in match) {
      name = match.entry.name;
      color = match.entry.color;
    }
  } catch (error) {
    if (error instanceof StoppedError) throw error;
  }
  return new WaitingFace({ write: terminal.write, color, mode: terminal.mode, label: `${name} is working`, hint: 'Ctrl+C stops waiting', columns: terminal.columns });
}

async function requestWithWaiting(command: RequestCommand, request: CliRequestBody, output: Output, userData: string, executable: string | undefined, signal?: AbortSignal): Promise<CliResponse> {
  const showsFace = command.kind === 'send' && command.wait && !command.json && output.statusTerminal !== undefined;
  const releaseInterrupt = showsFace ? output.statusTerminal!.catchInterrupt?.() : undefined;
  let waiting: Waiting = NO_WAITING;
  try {
    if (showsFace) waiting = await sendWaiting(command.to, output.statusTerminal!, userData, executable, signal);
    waiting.start();
    return await callStartingApp(userData, request, executable, signal);
  } finally {
    waiting.stop();
    releaseInterrupt?.();
  }
}

function reportStopped(command: RequestCommand, output: Output): number {
  if (command.kind === 'send') {
    output.stderr(`Stopped waiting. ${command.to} keeps working in the app. Read the answer later with: orglet read --to "${command.to}"`);
  } else {
    output.stderr('Stopped.');
  }
  return EXIT_CODES.failure;
}

function runChat(to: string | undefined, environment: NodeJS.ProcessEnv, terminal: InteractiveTerminal): Promise<number> {
  const client = appChatClient(resolveUserData(environment), appExecutable(environment));
  return runInteractive({ input: terminal.input, output: terminal.output, client, mode: terminal.mode, version: packageJson.version, ...(to ? { to } : {}) });
}

export async function runCli(argumentList: readonly string[], output: Output, environment: NodeJS.ProcessEnv = process.env, workingDirectory = process.cwd(), extras: RunExtras = {}): Promise<number> {
  // Plain `orglet` in a terminal opens the chat; anywhere else it is the usage error it always was.
  if (argumentList.length === 0 && extras.terminal) return runChat(undefined, environment, extras.terminal);
  let command: ParsedCommand;
  try {
    command = parseArguments(argumentList);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    output.stderr(`${error.message}\nRun "orglet --help" for usage.`);
    return EXIT_CODES.usage;
  }
  if (command.kind === 'help') {
    output.stdout(command.topic ? COMMAND_HELP[command.topic] : MAIN_HELP);
    return EXIT_CODES.ok;
  }
  if (command.kind === 'version') {
    output.stdout(`orglet ${packageJson.version}`);
    return EXIT_CODES.ok;
  }
  if (command.kind === 'chat') {
    if (extras.terminal) return runChat(command.to, environment, extras.terminal);
    output.stderr('"orglet chat" needs a terminal. In a script, use "orglet send".');
    return EXIT_CODES.usage;
  }
  const userData = resolveUserData(environment);
  const executable = appExecutable(environment);
  let response: CliResponse;
  try {
    response = await requestWithWaiting(command, toRequest(command, workingDirectory), output, userData, executable, extras.signal);
  } catch (error) {
    if (error instanceof StoppedError) return reportStopped(command, output);
    if (!(error instanceof UnreachableError)) throw error;
    const hint = executable ? '' : ' Start the app (pnpm dev in a checkout) and try again.';
    output.stderr(`Orglet is not reachable: ${error.message}${hint}\nData folder: ${userData}`);
    return EXIT_CODES.unreachable;
  }
  if (!response.ok) return reportFailure(response, command.json, output);
  const mode = command.json ? 'none' : output.stdoutMode ?? 'none';
  const layout: Layout = { mode, width: Math.max(20, (output.columns ?? DEFAULT_COLUMNS) - 1) };
  return report(command, response.value, output, layout);
}
