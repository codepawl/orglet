import { resolve } from 'node:path';
import { completionScript } from './completion';
import { COMMAND_NAMES, VALUE_OPTIONS } from './arguments';
import packageJson from '../../../../package.json';
import { COMMAND_HELP, MAIN_HELP, parseArguments, UsageError, type ChatTarget, type ManagementCommand, type ParsedCommand } from './arguments';
import { AppRefusal, appChatClient } from './chat-client';
import { runManagementCommand } from './management-command';
import { t } from './text';
import { appExecutable, callStartingApp, resolveUserData, StoppedError, UnreachableError } from './client';
import { runInteractive, type InteractiveInput, type InteractiveOutput } from './interactive';
import { formatChatSettings, formatScheduleNotice, formatShow, formatUpdateCheck } from './output';
import type { ChatSettingsValue, MarketUpdateValue, ScheduleNoticeValue, ShowValue, UpdateCheckValue } from './protocol';
import { chatOption, formatManagementResult, formatArchiveEntity, formatBring, formatChatChange, formatChats, formatControl, formatForward, formatList, formatMembers, formatNewChat, formatOpen, formatQuestion, formatReact, formatRead, formatRun, formatSend, formatStatus, formatTemplate, formatTurns, formatSchedules, formatSpaces, formatSpaceChange, formatMarket, formatChannelCreated, formatScheduleChange, formatSearch, formatRunning, formatLibrary, formatMemoryChange, formatUsage, formatModels, formatPreferences } from './output';
import { entriesFromList, findChat } from './picker';
import { renderAnswers, renderTurns, styledList, styledStatus, type Layout } from './pretty';
import { EXIT_CODES, type ArchiveEntityValue, type BringValue, type ChatChangeValue, type ChatsValue, type CliAnswer, type CliChat, type CliRequestBody, type CliResponse, type ControlValue, type ForwardValue, type ListValue, type MembersValue, type OpenValue, type ReactValue, type ReadValue, type RunValue, type SendValue, type StatusValue, type TemplateValue, type SchedulesValue, type SpacesValue, type SpaceChangeValue, type ChannelCreatedValue, type MarketListValue, type MarketInstalledValue, type MarketAddValue, type ScheduleValue, type SearchValue, type RunningValue, type LibraryValue, type UsageValue, type ModelsValue, type PreferencesValue } from './protocol';
import { NEUTRAL_COLOR, type ColorMode } from './terminal';
import { NO_WAITING, WaitingFace, type Waiting } from './waiting';

/**
 * `orglet`, the terminal companion of the running app (COD-234), like VS Code's `code`. It never reads the
 * database or keys itself. JSON configuration files are local inputs; mutations go through the app's local pipe.
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

type RequestCommand = Exclude<ParsedCommand, { kind: 'help' } | { kind: 'version' } | { kind: 'chat' } | { kind: 'completion' } | ManagementCommand>;

/** The request fields that name a chat: an orglet or crew by name, or a chat by its id (COD-354). */
function targetFields(target: ChatTarget): ChatTarget {
  return 'chat' in target ? { chat: target.chat } : { to: target.to };
}

/** How messages name a chat the command waited on: its orglet or crew, or `#` and its id. */
function targetLabel(target: ChatTarget): string {
  return 'chat' in target ? `#${target.chat}` : target.to;
}

/** The files of a message as absolute paths: the app runs in another folder, so a relative path would point somewhere else there. */
function filesField(files: readonly string[] | undefined, workingDirectory: string): { files?: string[] } {
  return files?.length ? { files: files.map(file => resolve(workingDirectory, file)) } : {};
}

function toRequest(command: RequestCommand, workingDirectory: string): CliRequestBody {
  switch (command.kind) {
    case 'status': return { op: 'status' };
    case 'list': return { op: 'list' };
    case 'config': return { op: 'config' };
    case 'read': return { op: 'read', ...targetFields(command), ...(command.turns ? { turns: command.turns } : {}) };
    case 'open': return { op: 'open', ...(command.to ? { to: command.to } : {}) };
    case 'send': return {
      op: 'send',
      ...targetFields(command),
      message: command.message,
      // The app runs in another folder, so a relative path would point somewhere else there.
      files: command.files.map(file => resolve(workingDirectory, file)),
      wait: command.wait,
      timeoutSeconds: command.timeoutSeconds,
      ...(command.replyTo ? { replyTo: command.replyTo } : {}),
    };
    case 'react': return { op: 'react', ...targetFields(command), emoji: command.emoji, active: command.active, ...(command.message ? { message: command.message } : {}) };
    case 'forward': return {
      op: 'forward',
      ...targetFields(command),
      targets: command.targets,
      ...(command.message ? { message: command.message } : {}),
      ...(command.note ? { note: command.note } : {}),
    };
    case 'control': return { op: 'control', ...targetFields(command), action: command.action, wait: command.wait, timeoutSeconds: command.timeoutSeconds };
    case 'revise': return { op: 'revise', ...targetFields(command), text: command.text, message: command.message, ...filesField(command.files, workingDirectory), wait: command.wait, timeoutSeconds: command.timeoutSeconds };
    case 'answer': return { op: 'answer', ...targetFields(command), answer: command.answer, wait: command.wait, timeoutSeconds: command.timeoutSeconds };
    case 'chats': return { op: 'chats', archived: command.archived, ...(command.space ? { space: command.space } : {}) };
    case 'side': return { op: 'side-thread', ...targetFields(command), message: command.message, ...filesField(command.files, workingDirectory), wait: command.wait, timeoutSeconds: command.timeoutSeconds };
    case 'bring': return { op: 'bring', chat: command.chat, ...(command.message ? { message: command.message } : {}) };
    case 'channel': return { op: 'channel', names: command.names, ...(command.message ? { message: command.message } : {}), ...filesField(command.files, workingDirectory), ...(command.name ? { name: command.name } : {}), ...(command.topic ? { topic: command.topic } : {}), ...(command.space ? { space: command.space } : {}), ...(command.category ? { category: command.category } : {}), wait: command.wait, timeoutSeconds: command.timeoutSeconds };
    case 'members': return { op: 'members', chat: command.chat, names: command.names };
    case 'chat-change': return {
      op: 'chat-change',
      ...targetFields(command),
      change: command.change,
      ...(command.title ? { title: command.title } : {}),
      ...(command.confirmName ? { confirmName: command.confirmName } : {}),
    };
    case 'archive-entity': return { op: 'archive-entity', kind: command.entity, name: command.name, archived: command.archived };
    case 'template': return { op: 'template', templateId: command.templateId, provider: command.provider };
    case 'schedules': return { op: 'schedules' };
    case 'spaces': return { op: 'spaces' };
    case 'market': return {
      op: 'market', verb: command.verb, refresh: command.refresh,
      ...(command.listingId ? { listingId: command.listingId } : {}),
      ...(command.installed ? { installed: command.installed } : {}),
      ...(command.confirmCode ? { confirmCode: command.confirmCode } : {}),
    };
    case 'schedule-notice': return { op: 'schedule-notice', schedule: command.schedule, action: command.action };
    case 'chat-settings': return { op: 'chat-settings', ...targetFields(command), ...(command.names ? { names: command.names } : {}), ...(command.budgetMicros === undefined ? {} : { budgetMicros: command.budgetMicros }) };
    case 'show': return { op: 'show', what: command.what, refresh: command.refresh, ...(command.chat ? { chat: command.chat } : command.to ? { to: command.to } : {}) };
    case 'update-check': return { op: 'update-check' };
    case 'space': return {
      op: 'space-change', verb: command.verb, names: command.names,
      ...(command.value ? { value: command.value } : {}), ...(command.position ? { position: command.position } : {}),
      ...(command.space ? { space: command.space } : {}), ...(command.rename ? { rename: command.rename } : {}),
      ...(command.category ? { category: command.category } : {}), ...(command.chat ? { chat: command.chat } : {}),
      ...(command.channelName ? { channelName: command.channelName } : {}),
      ...(command.confirmName ? { confirmName: command.confirmName } : {}),
    };
    case 'schedule-enable': return { op: 'schedule-enable', schedule: command.schedule, enabled: command.enabled };
    case 'schedule-delete': return { op: 'schedule-delete', schedule: command.schedule, confirmName: command.confirmName };
    case 'schedule-save': return { op: 'schedule-save', ...(command.schedule ? { schedule: command.schedule } : {}), ...command.fields };
    case 'search': return { op: 'search', query: command.query, ...(command.space ? { space: command.space } : {}) };
    case 'running': return { op: 'running', ...(command.space ? { space: command.space } : {}) };
    case 'library': return { op: 'library', kind: command.library, ...(command.query ? { query: command.query } : {}), ...(command.owner ? { owner: command.owner } : {}) };
    case 'memory-edit': return { op: 'memory-edit', id: command.id, ...(command.text ? { text: command.text } : {}), ...(command.pinned !== undefined ? { pinned: command.pinned } : {}) };
    case 'memory-delete': return { op: 'memory-delete', id: command.id, ...(command.confirm ? { confirm: command.confirm } : { confirmed: true as const }) };
    case 'usage': return { op: 'usage', refresh: command.refresh };
    case 'models': return { op: 'models', ...(command.provider ? { provider: command.provider } : {}), ...(command.to ? { to: command.to } : {}), refresh: command.refresh };
    case 'preferences': {
      const { kind: _kind, json: _json, ...settings } = command;
      return { op: 'preferences', ...settings };
    }
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

/**
 * Whether a turn the command waited for ended with an answer. A question or a desktop-only approval it stopped on is
 * said on standard error, with what to run next (COD-354).
 */
function sendExitCode(value: SendValue, output: Output, json: boolean): number {
  if (!value.waited) return EXIT_CODES.ok;
  if (value.needsDesktop) {
    if (!json) output.stderr(t('{0} đang chờ bạn duyệt một bước trong app. Mở bằng: orglet open --to "{1}"', value.chat.name, value.chat.name));
    return EXIT_CODES.failure;
  }
  if (value.question) {
    if (!json) output.stderr(formatQuestion(value.question, value.chat));
    return EXIT_CODES.failure;
  }
  const readLater = `orglet read ${chatOption(value.chat)}`;
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
  if (!json && value.question) output.stderr(formatQuestion(value.question, value.chat));
  if (!json && value.needsDesktop) output.stderr(t('{0} đang chờ bạn duyệt một bước trong app. Mở bằng: orglet open --to "{1}"', value.chat.name, value.chat.name));
  if (value.turns) return EXIT_CODES.ok;
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
    case 'config':
      if (!command.json) printJson(output, value);
      return EXIT_CODES.ok;
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
      if (!command.json) printRead(readValue, output, layout);
      return readExitCode(readValue, output, command.json);
    }
    case 'send': {
      const sendValue = value as SendValue;
      const printable = !sendValue.waited || sendValue.answers.length > 0;
      const answered = sendValue.waited && sendValue.answers.length > 0;
      if (!command.json && printable) output.stdout(styled && answered ? styledAnswers(sendValue.answers, sendValue.chat, layout) : formatSend(sendValue));
      return sendExitCode(sendValue, output, command.json);
    }
    case 'react':
      if (!command.json) output.stdout(formatReact(value as ReactValue));
      return EXIT_CODES.ok;
    case 'forward': {
      const forwardValue = value as ForwardValue;
      if (!command.json) output.stdout(formatForward(forwardValue));
      return forwardValue.failed.length ? EXIT_CODES.failure : EXIT_CODES.ok;
    }
    case 'control':
    case 'revise':
    case 'answer': return reportControl(command.json, value as ControlValue, output, layout);
    case 'side':
    case 'channel':
      if (command.message) return reportNewChat(command.json, value as SendValue, output, layout);
      if (!command.json) output.stdout(formatChannelCreated(value as ChannelCreatedValue));
      return EXIT_CODES.ok;
    case 'chats':
      if (!command.json) output.stdout(formatChats(value as ChatsValue));
      return EXIT_CODES.ok;
    case 'bring':
      if (!command.json) output.stdout(formatBring(value as BringValue));
      return EXIT_CODES.ok;
    case 'members':
      if (!command.json) output.stdout(formatMembers(value as MembersValue));
      return EXIT_CODES.ok;
    case 'chat-change':
      if (!command.json) output.stdout(formatChatChange(value as ChatChangeValue));
      return EXIT_CODES.ok;
    case 'archive-entity':
      if (!command.json) output.stdout(formatArchiveEntity(value as ArchiveEntityValue));
      return EXIT_CODES.ok;
    case 'template':
      if (!command.json) output.stdout(formatTemplate(value as TemplateValue));
      return EXIT_CODES.ok;
    case 'schedules':
      if (!command.json) output.stdout(formatSchedules(value as SchedulesValue));
      return EXIT_CODES.ok;
    case 'spaces':
      if (!command.json) output.stdout(formatSpaces(value as SpacesValue));
      return EXIT_CODES.ok;
    case 'space':
      if (!command.json) output.stdout(formatSpaceChange(value as SpaceChangeValue));
      return EXIT_CODES.ok;
    case 'market':
      if (!command.json) output.stdout(formatMarket(value as MarketListValue | MarketInstalledValue | MarketAddValue | MarketUpdateValue));
      return EXIT_CODES.ok;
    case 'schedule-enable':
    case 'schedule-delete':
    case 'schedule-save':
      if (!command.json) output.stdout(formatScheduleChange(command.kind, value as ScheduleValue));
      return EXIT_CODES.ok;
    case 'search':
      if (!command.json) output.stdout(formatSearch(value as SearchValue));
      return EXIT_CODES.ok;
    case 'running':
      if (!command.json) output.stdout(formatRunning(value as RunningValue));
      return EXIT_CODES.ok;
    case 'library':
      if (!command.json) output.stdout(formatLibrary(value as LibraryValue));
      return EXIT_CODES.ok;
    case 'memory-edit':
    case 'memory-delete':
      if (!command.json) output.stdout(formatMemoryChange(command.kind, value as LibraryValue));
      return EXIT_CODES.ok;
    case 'usage':
      if (!command.json) output.stdout(formatUsage(value as UsageValue));
      return EXIT_CODES.ok;
    case 'models': {
      const modelsValue = value as ModelsValue;
      if (!command.json) output.stdout(formatModels(modelsValue));
      if (!command.json && modelsValue.error) output.stderr(modelsValue.error);
      return EXIT_CODES.ok;
    }
    case 'preferences':
      if (!command.json) output.stdout(formatPreferences(value as PreferencesValue));
      return EXIT_CODES.ok;
    case 'show':
      if (!command.json) output.stdout(formatShow(value as ShowValue));
      return EXIT_CODES.ok;
    case 'chat-settings':
      if (!command.json) output.stdout(formatChatSettings(value as ChatSettingsValue));
      return EXIT_CODES.ok;
    case 'schedule-notice':
      if (!command.json) output.stdout(formatScheduleNotice(value as ScheduleNoticeValue));
      return EXIT_CODES.ok;
    case 'update-check':
      if (!command.json) output.stdout(formatUpdateCheck(value as UpdateCheckValue));
      return EXIT_CODES.ok;
  }
}

/** A side thread or channel prints its answers like `send`, then the id that reaches it again. */
function reportNewChat(json: boolean, value: SendValue, output: Output, layout: Layout): number {
  const answered = value.waited && value.answers.length > 0;
  if (!json && answered) output.stdout(layout.mode !== 'none' ? styledAnswers(value.answers, value.chat, layout) : formatSend(value));
  if (!json) output.stderr(formatNewChat(value));
  return sendExitCode(value, output, json);
}

function printRead(value: ReadValue, output: Output, layout: Layout): void {
  const styled = layout.mode !== 'none';
  if (value.turns) {
    if (value.earlier) output.stdout(t('… {0} lượt trước đó. Tăng --turns để xem thêm.', value.earlier));
    if (value.turns.length) output.stdout(styled ? renderTurns(value.turns, { ...layout, fallbackColor: value.chat.color }).join('\n') : formatTurns(value.turns));
    return;
  }
  if (value.answers.length) output.stdout(styled ? styledAnswers(value.answers, value.chat, layout) : formatRead(value));
}

/** A stop or pause says what it did; resume, retry, continue and answer print the turn they waited for, like `send`. */
function reportControl(json: boolean, value: ControlValue, output: Output, layout: Layout): number {
  const stopping = value.action === 'stop' || value.action === 'pause';
  const answered = value.waited && value.answers.length > 0;
  if (!json && (stopping || !value.waited || answered)) output.stdout(layout.mode !== 'none' && answered ? styledAnswers(value.answers, value.chat, layout) : formatControl(value));
  if (stopping) return EXIT_CODES.ok;
  return sendExitCode(value, output, json);
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

/** The chat a command waits on for an answer, if it does: `send`, `answer`, `side`, `channel`, and resume, retry and continue. */
function waitedChat(command: RequestCommand): string | undefined {
  if (command.kind === 'send' || command.kind === 'revise' || command.kind === 'answer' || command.kind === 'side') return command.wait ? targetLabel(command) : undefined;
  if (command.kind === 'channel') return command.wait && command.message ? command.name ?? command.names[0] : undefined;
  if (command.kind !== 'control') return undefined;
  const startsTurn = command.action === 'resume' || command.action === 'retry' || command.action === 'continue';
  return startsTurn && command.wait ? targetLabel(command) : undefined;
}

async function requestWithWaiting(command: RequestCommand, request: CliRequestBody, output: Output, userData: string, executable: string | undefined, signal?: AbortSignal): Promise<CliResponse> {
  const chatName = waitedChat(command);
  const showsFace = chatName !== undefined && !command.json && output.statusTerminal !== undefined;
  const releaseInterrupt = showsFace ? output.statusTerminal!.catchInterrupt?.() : undefined;
  let waiting: Waiting = NO_WAITING;
  try {
    if (showsFace) waiting = await sendWaiting(chatName, output.statusTerminal!, userData, executable, signal);
    waiting.start();
    return await callStartingApp(userData, request, executable, signal);
  } finally {
    waiting.stop();
    releaseInterrupt?.();
  }
}

function reportStopped(command: RequestCommand, output: Output): number {
  const chatName = waitedChat(command);
  if (chatName !== undefined) {
    output.stderr(`Stopped waiting. ${chatName} keeps working in the app. Read the answer later with: orglet read --to "${chatName}"`);
  } else {
    output.stderr('Stopped.');
  }
  return EXIT_CODES.failure;
}

function runChat(to: string | undefined, environment: NodeJS.ProcessEnv, terminal: InteractiveTerminal): Promise<number> {
  const client = appChatClient(resolveUserData(environment), appExecutable(environment));
  return runInteractive({ input: terminal.input, output: terminal.output, client, mode: terminal.mode, version: packageJson.version,
    reducedMotion: environment.ORGLET_REDUCED_MOTION === '1', ...(to ? { to } : {}),
  });
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
  if (command.kind === 'completion') {
    const flags = ['--json', '--no-wait', '--off', '--archived', '--called', '--pin', '--unpin', '--yes', '--refresh', '--help', '--version'];
    output.stdout(completionScript(command.shell, COMMAND_NAMES, [...VALUE_OPTIONS, ...flags]));
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
  if (command.kind === 'create' || command.kind === 'edit' || command.kind === 'delete') {
    try {
      const client = appChatClient(resolveUserData(environment), appExecutable(environment)).management!;
      const result = await runManagementCommand(command, client, workingDirectory);
      if (command.json) printJson(output, result);
      else output.stdout(formatManagementResult(result));
      return EXIT_CODES.ok;
    } catch (error) {
      if (error instanceof AppRefusal) return reportFailure({ ok: false, code: error.code, error: error.message }, command.json, output);
      const code = error instanceof UsageError ? EXIT_CODES.usage : error instanceof UnreachableError ? EXIT_CODES.unreachable : EXIT_CODES.failure;
      const message = error instanceof Error ? error.message : String(error);
      if (command.json) printJson(output, { ok: false, error: message });
      else output.stderr(message);
      return code;
    }
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
