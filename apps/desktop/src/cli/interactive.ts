import { createInterface, type Interface } from 'node:readline';
import { TerminalComposer } from './composer';
import { AppRefusal, type ChatClient } from './chat-client';
import { StoppedError, UnreachableError } from './client';
import { renderMiniFaces } from './faces';
import { chosenEntry, createPicker, entriesFromList, findChat, moveSelection, renderPickerLines, setFilter, type ChatEntry, type PickerState } from './picker';
import { answerColor, chatHeader, renderAnswers, styledList } from './pretty';
import { EXIT_CODES, type CliAnswer, type SendValue } from './protocol';
import { completeSlash, isSlashCommand, parseSlash, SLASH_HELP, type SlashCommand } from './slash';
import { ANSI, ERROR_COLOR, muted, MUTED_COLOR, padEnd, paint, wrapSegments, type ColorMode, type Style } from './terminal';

/**
 * `orglet chat` (COD-236): pick an orglet or crew, then talk to it from the terminal. Everything outside this module
 * is injected (the input and output streams and the app client), so a test drives a whole session with a script of
 * lines and a fake app. A terminal composer owns raw keys, paste, history and redraws; this session owns the queue
 * and backend calls. Scripted sessions use readline without terminal control.
 */

export type InteractiveInput = NodeJS.ReadableStream & { isTTY?: boolean; isRaw?: boolean; setRawMode?: (raw: boolean) => unknown };
export type InteractiveOutput = NodeJS.WritableStream & { isTTY?: boolean; columns?: number; rows?: number };

export type InteractiveOptions = {
  input: InteractiveInput;
  output: InteractiveOutput;
  client: ChatClient;
  mode: ColorMode;
  version: string;
  /** Open this chat straight away (`orglet chat --to <name>`). */
  to?: string;
  /** Raw keys and redraws. Defaults to whether both streams are terminals. */
  terminal?: boolean;
};

const DEFAULT_COLUMNS = 80;
const PICKER_MAX_ROWS = 8;
/** The faces on the welcome line; more would wrap a narrow terminal. */
const WELCOME_FACE_LIMIT = 12;
const CHAT_HINT = 'Enter sends. Ctrl+J adds a line. Paste stays in the draft. /help lists commands. Ctrl+D leaves.';

type QueuedLine = { text: string };
type View = 'picker' | 'chat';

class Session {
  private readonly terminal: boolean;
  private readonly mode: ColorMode;
  private readline: Interface | undefined;
  private composer: TerminalComposer | undefined;
  private entries: ChatEntry[] = [];
  private view: View = 'picker';
  private picker: PickerState = createPicker([]);
  /** The chat `/to` came from, so Esc in the picker goes back to it. */
  private pickerReturn: ChatEntry | undefined;
  private chat: ChatEntry | undefined;
  private shownHint = false;
  private readonly queue: QueuedLine[] = [];
  private processing = false;
  private inputClosed = false;
  private finished = false;
  private waitingController: AbortController | undefined;
  private finish: (code: number) => void = () => undefined;
  private waitingStartedAt = 0;
  private waitingTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: InteractiveOptions) {
    this.terminal = options.terminal ?? Boolean(options.input.isTTY && options.output.isTTY);
    this.mode = options.mode;
  }

  async run(): Promise<number> {
    try {
      this.entries = entriesFromList(await this.options.client.list());
    } catch (error) {
      return this.startFailure(error);
    }
    if (this.entries.length === 0) {
      this.print('No orglets yet. Add one in the Orglet app, then run orglet chat again.');
      return EXIT_CODES.failure;
    }
    const done = new Promise<number>(resolve => {
      this.finish = resolve;
    });
    this.openReadline();
    this.printWelcome();
    this.openFirstView();
    this.showPrompt();
    return done;
  }

  private startFailure(error: unknown): number {
    if (error instanceof UnreachableError) {
      this.print(`Orglet is not reachable: ${error.message}`);
      return EXIT_CODES.unreachable;
    }
    this.print(error instanceof Error ? error.message : String(error));
    return EXIT_CODES.failure;
  }

  private openReadline(): void {
    if (this.terminal) {
      this.composer = new TerminalComposer({
        input: this.options.input,
        output: this.options.output,
        mode: this.mode,
        prompt: () => this.currentPrompt(),
        rows: () => renderPickerLines(this.picker, { width: this.textWidth(), mode: this.mode, maxRows: this.pickerRows() }),
        status: () => this.composerStatus(),
        hint: () => this.waitingController ? 'Enter queues · Ctrl+J newline · Ctrl+C stops waiting' : 'Enter send · Ctrl+J newline · / commands',
        picker: () => this.view === 'picker',
        suggestions: text => completeSlash(text, this.entries.map(entry => entry.name))[0].map(candidate => ({
          text: candidate,
          description: SLASH_HELP.find(([usage]) => usage.split(' ')[0] === candidate.trim())?.[1] ?? 'Open this chat',
        })),
        change: text => {
          if (this.view === 'picker') this.picker = setFilter(this.picker, text);
        },
        navigate: direction => {
          if (direction === 0) this.composer?.replace(chosenEntry(this.picker)?.name ?? '');
          else this.picker = moveSelection(this.picker, direction);
        },
        escape: () => this.leavePicker(),
        submit: text => this.enqueue(text),
        interrupt: () => this.interrupt(),
        close: () => this.end(EXIT_CODES.ok),
      });
      this.composer.start();
      return;
    }
    this.readline = createInterface({
      input: this.options.input,
      terminal: false,
      historySize: 0,
    });
    this.readline.on('line', line => this.enqueue(line));
    this.readline.on('SIGINT', () => this.interrupt());
    this.readline.on('close', () => {
      this.inputClosed = true;
      void this.drain();
    });
  }

  private composerStatus(): string {
    if (!this.chat || this.view === 'picker') return '';
    const state = this.waitingController ? 'working' : 'ready';
    const queued = this.queue.length ? ` · ${this.queue.length} queued` : '';
    const elapsed = this.waitingController ? ` · ${Math.floor((Date.now() - this.waitingStartedAt) / 1000)}s` : '';
    return `${state}${queued}${elapsed} · ${renderMiniFaces([this.chat.color], this.mode)} ${this.chat.name} · ${this.chat.detail}`;
  }

  private openFirstView(): void {
    if (!this.options.to) {
      this.showPicker('');
      return;
    }
    const match = findChat(this.entries, this.options.to);
    if ('entry' in match) {
      this.enterChat(match.entry);
      return;
    }
    this.showPicker(this.options.to);
  }

  private columns(): number {
    return this.options.output.columns ?? DEFAULT_COLUMNS;
  }

  /** Text width for answers: one column short of the edge, so a full line never wraps on its own. */
  private textWidth(): number {
    return Math.max(4, this.columns() - 1);
  }

  private write(text: string): void {
    this.options.output.write(text);
  }

  private print(text = ''): void {
    if (this.finished) return;
    this.composer?.clear();
    this.write(`${text}${this.terminal ? '\r\n' : '\n'}`);
  }

  private printLines(lines: readonly string[]): void {
    for (const line of lines) this.print(line);
  }

  private printWrapped(text: string, style: Style): void {
    this.printLines(wrapSegments([{ text, style }], { width: this.textWidth(), mode: this.mode }));
  }

  private printMuted(text: string): void {
    this.printWrapped(text, { foreground: MUTED_COLOR });
  }

  private printError(text: string): void {
    this.printWrapped(text, { foreground: ERROR_COLOR });
  }

  private printWelcome(): void {
    const title = `${paint('Orglet', { bold: true }, this.mode)} ${muted(this.options.version, this.mode)}`;
    if (this.mode === 'none') {
      this.print(title);
      return;
    }
    const colors = this.entries.filter(entry => entry.kind === 'worker').map(entry => entry.color).slice(0, WELCOME_FACE_LIMIT);
    this.print(`${renderMiniFaces(colors, this.mode)}  ${title}`);
  }

  private chatPrompt(): string {
    const color = this.chat?.color;
    return `${paint('›', { foreground: color, bold: true }, this.mode)} `;
  }

  private pickerPrompt(): string {
    return `${paint('Open', { bold: true }, this.mode)} › `;
  }

  private currentPrompt(): string {
    return this.view === 'picker' ? this.pickerPrompt() : this.chatPrompt();
  }

  /** On a terminal, draws the prompt (and the picker's list); a script of lines gets no prompts, only echoes. */
  private showPrompt(): void {
    if (!this.terminal || this.finished) return;
    this.composer?.draw();
  }

  /** Replaces the draft when a picker fills or clears its filter. */
  private replaceLine(text: string): void {
    this.composer?.replace(text);
  }

  private pickerRows(): number {
    const rows = this.options.output.rows ?? 24;
    return Math.max(1, Math.min(PICKER_MAX_ROWS, this.entries.length, rows - 4));
  }

  private showPicker(filter: string, returnTo?: ChatEntry): void {
    this.view = 'picker';
    this.picker = createPicker(this.entries, filter);
    this.pickerReturn = returnTo;
    if (this.terminal) {
      this.replaceLine(filter);
      return;
    }
    const lines = renderPickerLines(this.picker, { width: this.textWidth(), mode: this.mode, maxRows: this.entries.length });
    this.printLines(lines.slice(0, -1));
  }

  private enterChat(entry: ChatEntry): void {
    this.view = 'chat';
    this.chat = entry;
    this.pickerReturn = undefined;
    this.printLines(chatHeader(entry, this.mode));
    if (!this.shownHint) this.printMuted(CHAT_HINT);
    this.shownHint = true;
    this.print();
  }

  private leavePicker(): void {
    if (this.view === 'picker' && this.pickerReturn) {
      const back = this.pickerReturn;
      this.view = 'chat';
      this.chat = back;
      this.pickerReturn = undefined;
      this.replaceLine('');
      this.showPrompt();
    }
  }

  /** Ctrl+C: stop waiting if an answer is on its way, clear a typed line, or leave from an empty prompt. */
  private interrupt(): void {
    if (this.waitingController) {
      this.waitingController.abort();
      return;
    }
    if (this.composer?.text) {
      this.replaceLine('');
      return;
    }
    this.end(EXIT_CODES.ok);
  }

  private enqueue(text: string): void {
    if (this.view === 'chat' && !text.trim()) return;
    // `/exit` must leave immediately, even when an earlier message is still waiting for its answer.
    if (this.terminal && isSlashCommand(text) && /^\/(exit|quit)\s*$/i.test(text)) {
      this.end(EXIT_CODES.ok);
      return;
    }
    if (this.view === 'chat' && text.trim() && !isSlashCommand(text)) this.composer?.remember(text.trim());
    this.queue.push({ text });
    void this.drain();
    this.showPrompt();
  }

  /** Lines are handled one at a time: a line typed while an answer is on its way waits its turn. */
  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length > 0 && !this.finished) {
      const line = this.queue.shift()!;
      await this.handle(line);
    }
    this.processing = false;
    if (this.finished) return;
    if (this.inputClosed) {
      this.end(EXIT_CODES.ok);
      return;
    }
    this.showPrompt();
  }

  /** Shows a line that was not echoed as it was typed: from a script, or typed while an answer was on its way. */
  private echo(line: QueuedLine, prompt: string): void {
    this.print(`${prompt}${line.text}`);
  }

  private async handle(line: QueuedLine): Promise<void> {
    if (this.view === 'picker') {
      this.choose(line);
      return;
    }
    this.echo(line, this.chatPrompt());
    const text = line.text.trim();
    if (text === '') return;
    if (isSlashCommand(line.text)) {
      await this.command(parseSlash(text));
      return;
    }
    await this.send(text);
  }

  private choose(line: QueuedLine): void {
    this.echo(line, this.pickerPrompt());
    const entry = chosenEntry(setFilter(this.picker, line.text));
    if (entry) {
      this.enterChat(entry);
      return;
    }
    this.printMuted(`Nothing matches "${line.text.trim()}".`);
    this.showPicker('', this.pickerReturn);
  }

  private async command(command: SlashCommand): Promise<void> {
    switch (command.kind) {
      case 'to': return this.switchChat(command.name);
      case 'list': return this.list();
      case 'read': return this.read();
      case 'open': return this.openInApp();
      case 'clear': return this.clear();
      case 'help': return this.help();
      case 'exit': return this.end(EXIT_CODES.ok);
      case 'unknown': return this.printMuted(`Unknown command ${command.command}. /help lists the commands.`);
    }
  }

  private switchChat(name: string | undefined): void {
    if (!name) {
      this.showPicker('', this.chat);
      return;
    }
    const match = findChat(this.entries, name);
    if ('entry' in match) {
      this.enterChat(match.entry);
      return;
    }
    if (match.candidates.length === 0) this.printMuted(`No orglet or crew is called "${name}".`);
    this.showPicker(match.candidates.length ? name : '', this.chat);
  }

  private async list(): Promise<void> {
    try {
      const value = await this.options.client.list();
      this.entries = entriesFromList(value);
      this.printLines(styledList(value, { mode: this.mode, width: this.textWidth() }).split('\n'));
      this.print();
    } catch (error) {
      this.printFailure(error);
    }
  }

  private async read(): Promise<void> {
    const chat = this.chat!;
    try {
      const value = await this.options.client.read(chat.name);
      if (value.answers.length === 0) this.printMuted(`No answer in the chat with ${chat.name} yet.`);
      else this.printAnswers(value.answers);
      if (['queued', 'running', 'pausing'].includes(value.status)) this.printMuted(`${chat.name} is working on a newer message.`);
    } catch (error) {
      this.printFailure(error);
    }
    this.print();
  }

  private async openInApp(): Promise<void> {
    const chat = this.chat!;
    try {
      await this.options.client.open(chat.name);
      this.printMuted(`Opened the chat with ${chat.name} in the app.`);
    } catch (error) {
      this.printFailure(error);
    }
  }

  private clear(): void {
    if (this.terminal) this.write(ANSI.clearScreen);
    this.printLines(chatHeader(this.chat!, this.mode));
    this.print();
  }

  private help(): void {
    const width = Math.max(...SLASH_HELP.map(([usage]) => usage.length));
    for (const [usage, meaning] of SLASH_HELP) this.print(`  ${padEnd(usage, width)}  ${muted(meaning, this.mode)}`);
    this.printMuted('  Ctrl+J adds a line. Paste stays in the draft. / opens the command menu; Tab fills the choice.');
    this.print();
  }

  private async send(text: string): Promise<void> {
    const chat = this.chat!;
    const controller = new AbortController();
    const startedAt = Date.now();
    this.waitingController = controller;
    this.waitingStartedAt = startedAt;
    this.showPrompt();
    if (this.terminal) this.waitingTimer = setInterval(() => this.showPrompt(), 1000);
    try {
      const value = await this.options.client.send(chat.name, text, controller.signal);
      if (this.finished) return;
      this.printTurn(value, Math.round((Date.now() - startedAt) / 1000));
    } catch (error) {
      if (this.finished) return;
      if (error instanceof StoppedError) this.printMuted(`Stopped waiting. ${chat.name} keeps working in the app; /read shows the answer when it is ready.`);
      else this.printFailure(error);
    } finally {
      this.waitingController = undefined;
      if (this.waitingTimer) clearInterval(this.waitingTimer);
      this.waitingTimer = undefined;
    }
    this.print();
  }

  private printAnswers(answers: readonly CliAnswer[], firstNote?: string): void {
    const fallbackColor = this.chat?.color;
    const colored = answers.map(answer => ({ ...answer, color: answerColor(answer, this.colorOf(answer.name) ?? fallbackColor) }));
    this.printLines(renderAnswers(colored, { mode: this.mode, width: this.textWidth(), fallbackColor, firstNote }));
  }

  private colorOf(name: string): string | undefined {
    return this.entries.find(entry => entry.kind === 'worker' && entry.name === name)?.color;
  }

  private printTurn(value: SendValue, seconds: number): void {
    const chat = this.chat!;
    if (value.answers.length > 0) this.printAnswers(value.answers, `${seconds}s`);
    if (!value.finished) {
      this.printMuted(`${chat.name} is still working. /read shows the answer later.`);
      return;
    }
    for (const error of value.errors) this.printError(error);
    if (value.answers.length === 0) this.printMuted(`The chat stopped without an answer (${value.status}). /open shows it in the app.`);
  }

  private printFailure(error: unknown): void {
    if (error instanceof AppRefusal || error instanceof UnreachableError) {
      this.printError(error.message);
      return;
    }
    this.printError(error instanceof Error ? error.message : String(error));
  }

  /** Leaving drops this terminal's queue; it never cancels work already sent to the app. */
  private end(code: number): void {
    if (this.finished) return;
    this.finished = true;
    this.waitingController?.abort();
    if (this.waitingTimer) clearInterval(this.waitingTimer);
    this.composer?.stop();
    this.readline?.close();
    this.finish(code);
  }
}

/** Runs one interactive session until the person leaves; resolves to the exit code. */
export function runInteractive(options: InteractiveOptions): Promise<number> {
  return new Session(options).run();
}
