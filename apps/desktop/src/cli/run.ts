import { resolve } from 'node:path';
import packageJson from '../../../../package.json';
import { COMMAND_HELP, MAIN_HELP, parseArguments, UsageError, type ParsedCommand } from './arguments';
import { appExecutable, callStartingApp, resolveUserData, UnreachableError } from './client';
import { formatList, formatOpen, formatRead, formatSend, formatStatus } from './output';
import { EXIT_CODES, type CliRequestBody, type CliResponse, type ListValue, type OpenValue, type ReadValue, type SendValue, type StatusValue } from './protocol';

/**
 * `orglet`, the terminal companion of the running app (COD-234), like VS Code's `code`. It never reads the
 * database, keys or files itself: every command is one request to the app over its local pipe.
 */

export type Output = { stdout: (text: string) => void; stderr: (text: string) => void };

const TERMINAL_FAILURES = new Set(['failed', 'cancelled', 'interrupted']);

type RequestCommand = Exclude<ParsedCommand, { kind: 'help' } | { kind: 'version' }>;

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

/** Prints a successful response and decides the exit code. */
function report(command: RequestCommand, value: unknown, output: Output): number {
  if (command.json) printJson(output, value);
  switch (command.kind) {
    case 'status':
      if (!command.json) output.stdout(formatStatus(value as StatusValue));
      return EXIT_CODES.ok;
    case 'list':
      if (!command.json) output.stdout(formatList(value as ListValue));
      return EXIT_CODES.ok;
    case 'open':
      if (!command.json) output.stdout(formatOpen(value as OpenValue));
      return EXIT_CODES.ok;
    case 'read': {
      const readValue = value as ReadValue;
      if (!command.json && readValue.answers.length) output.stdout(formatRead(readValue));
      return readExitCode(readValue, output, command.json);
    }
    case 'send': {
      const sendValue = value as SendValue;
      const printable = !sendValue.waited || sendValue.answers.length > 0;
      if (!command.json && printable) output.stdout(formatSend(sendValue));
      return sendExitCode(sendValue, output, command.json);
    }
  }
}

function reportFailure(response: Extract<CliResponse, { ok: false }>, json: boolean, output: Output): number {
  if (json) printJson(output, response);
  else output.stderr(response.error);
  return EXIT_CODES.failure;
}

export async function runCli(argumentList: readonly string[], output: Output, environment: NodeJS.ProcessEnv = process.env, workingDirectory = process.cwd()): Promise<number> {
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
  const userData = resolveUserData(environment);
  const executable = appExecutable(environment);
  let response: CliResponse;
  try {
    response = await callStartingApp(userData, toRequest(command, workingDirectory), executable);
  } catch (error) {
    if (!(error instanceof UnreachableError)) throw error;
    const hint = executable ? '' : ' Start the app (pnpm dev in a checkout) and try again.';
    output.stderr(`Orglet is not reachable: ${error.message}${hint}\nData folder: ${userData}`);
    return EXIT_CODES.unreachable;
  }
  if (!response.ok) return reportFailure(response, command.json, output);
  return report(command, response.value, output);
}
