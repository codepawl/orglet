import { createInterface, type Interface, type Key } from 'node:readline';
import { Writable } from 'node:stream';
import { AppRefusal, type ChatClient } from './chat-client';
import { StoppedError, UnreachableError } from './client';
import { renderMiniFaces } from './faces';
import { chosenEntry, createPicker, entriesFromList, findChat, moveSelection, renderPickerLines, setFilter, type ChatEntry, type PickerState } from './picker';
import { answerColor, chatHeader, renderAnswers, styledList } from './pretty';
import { EXIT_CODES, type CliAnswer, type SendValue } from './protocol';
import { completeSlash, isSlashCommand, parseSlash, SLASH_HELP, type SlashCommand } from './slash';
import { ANSI, ERROR_COLOR, muted, MUTED_COLOR, padEnd, paint, wrapSegments, type ColorMode, type Style } from './terminal';
import { NO_WAITING, WaitingFace, WaitingLine, type Waiting } from './waiting';

/**
 * `orglet chat` (COD-236): pick an orglet or crew, then talk to it from the terminal. Everything outside this module
 * is injected (the input and output streams and the app client), so a test drives a whole session with a script of
 * lines and a fake app. On a real terminal the input is in raw mode through `readline`: arrow keys move the picker
 * and walk the history, Tab completes commands and names, and the waiting face animates in place.
 */

export type InteractiveInput = NodeJS.ReadableStream & { isTTY?: boolean };
export type InteractiveOutput = NodeJS.WritableStream & { isTTY?: boolean; columns?: number; rows?: number };

export type InteractiveOptions = {
  input: InteractiveInput;
  output: InteractiveOutput;
  client: ChatClient;
  mode: ColorMode;
  version: string;
  /** Open this chat straight away (`orglet chat --to <name>`). */
  to?: string;
  /** Raw keys, redraws and the animated face. Defaults to whether both streams are terminals. */
  terminal?: boolean;
  frameMilliseconds?: number;
};

const DEFAULT_COLUMNS = 80;
const PICKER_MAX_ROWS = 8;
/** The faces on the welcome line; more would wrap a narrow terminal. */
const WELCOME_FACE_LIMIT = 12;
const CHAT_HINT = 'Type a message and press Enter. /help lists commands. Ctrl+D or /exit leaves.';

/**
 * Readline draws the prompt and echoes what is typed. While an answer is on its way that output is held back, so
 * keys pressed then do not scribble over the waiting face; what was typed stays in the line and shows at the next
 * prompt.
 */
class HeldOutput extends Writable {
  held = false;

  constructor(private readonly target: InteractiveOutput) {
    super();
    target.on('resize', () => this.emit('resize'));
  }

  get columns(): number | undefined {
    return this.target.columns;
  }

  get rows(): number | undefined {
    return this.target.rows;
  }

  get isTTY(): boolean {
    return Boolean(this.target.isTTY);
  }

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (!this.held) this.target.write(chunk);
    callback();
  }
}

type QueuedLine = { text: string; echoed: boolean };
type View = 'picker' | 'chat';

class Session {
  private readonly terminal: boolean;
  private readonly mode: ColorMode;
  private readonly held: HeldOutput;
  private readline!: Interface;
  private entries: ChatEntry[] = [];
  private view: View = 'picker';
  private picker: PickerState = createPicker([]);
  /** The chat `/to` came from, so Esc in the picker goes back to it. */
  private pickerReturn: ChatEntry | undefined;
  private chat: ChatEntry | undefined;
  private shownHint = false;
  private readonly history: string[] = [];
  private historyIndex = 0;
  private draft = '';
  private readonly queue: QueuedLine[] = [];
  private processing = false;
  private inputClosed = false;
  private finished = false;
  private waitingController: AbortController | undefined;
  private finish: (code: number) => void = () => undefined;
  private readonly onKeypress = (_sequence: string | undefined, key: Key | undefined) => this.keypress(key);

  constructor(private readonly options: InteractiveOptions) {
    this.terminal = options.terminal ?? Boolean(options.input.isTTY && options.output.isTTY);
    this.mode = options.mode;
    this.held = new HeldOutput(options.output);
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
    this.readline = createInterface({
      input: this.options.input,
      output: this.held,
      terminal: this.terminal,
      historySize: 0,
      tabSize: 2,
      completer: (line: string) => this.complete(line),
    });
    this.readline.on('line', line => this.enqueue(line));
    this.readline.on('SIGINT', () => this.interrupt());
    this.readline.on('close', () => {
      this.inputClosed = true;
      void this.drain();
    });
    if (this.terminal) this.options.input.on('keypress', this.onKeypress);
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
    return Math.max(20, this.columns() - 1);
  }

  private write(text: string): void {
    this.options.output.write(text);
  }

  private print(text = ''): void {
    this.write(`${text}\n`);
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
    this.readline.setPrompt(this.currentPrompt());
    this.readline.prompt(true);
    if (this.view === 'picker') {
      if (this.readline.line !== this.picker.filter) this.replaceLine(this.picker.filter);
      this.drawPickerList();
    }
  }

  /** Swaps what is typed on the prompt line, as if the person had cleared it and typed `text`. */
  private replaceLine(text: string): void {
    this.readline.write(null, { ctrl: true, name: 'e' });
    this.readline.write(null, { ctrl: true, name: 'u' });
    if (text) this.readline.write(text);
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
      // Room for the list under the prompt, made now so drawing it later never scrolls the prompt away.
      const room = this.pickerRows() + 1;
      this.write(`${'\n'.repeat(room)}${ANSI.up(room)}`);
      return;
    }
    const lines = renderPickerLines(this.picker, { width: this.textWidth(), mode: this.mode, maxRows: this.entries.length });
    this.printLines(lines.slice(0, -1));
  }

  /** The list under the picker's prompt, redrawn in place; the cursor goes back to where the person types. */
  private drawPickerList(): void {
    const lines = renderPickerLines(this.picker, { width: this.textWidth(), mode: this.mode, maxRows: this.pickerRows() });
    const body = lines.map(line => `\r\n${ANSI.clearLine}${line}`).join('');
    const cursor = this.readline.getCursorPos();
    this.write(`${body}${ANSI.clearBelow}${ANSI.up(lines.length)}\r${ANSI.right(cursor.cols)}`);
  }

  /** Takes the list and the prompt line away once a chat is chosen. After Enter the cursor is on the list's first line. */
  private clearPicker(): void {
    if (!this.terminal) return;
    this.write(`${ANSI.clearBelow}${ANSI.up(1)}\r${ANSI.clearBelow}`);
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

  private complete(line: string): [string[], string] {
    const names = this.entries.map(entry => entry.name);
    if (this.view === 'picker') {
      // Tab takes the highlighted name, so the list under the prompt is never pushed around by a list of candidates.
      const highlighted = chosenEntry(setFilter(this.picker, line));
      return highlighted ? [[highlighted.name], line] : [[], line];
    }
    return completeSlash(line, names);
  }

  private keypress(key: Key | undefined): void {
    if (!key || this.finished || this.waitingController) return;
    if (key.name === 'return' || key.name === 'enter') return;
    if (this.view === 'picker') {
      this.pickerKey(key);
      return;
    }
    if (key.name === 'up') this.historyBack();
    if (key.name === 'down') this.historyForward();
  }

  private pickerKey(key: Key): void {
    if (key.name === 'escape' && this.pickerReturn) {
      const back = this.pickerReturn;
      this.replaceLine('');
      this.write(`\r${ANSI.clearBelow}`);
      this.view = 'chat';
      this.chat = back;
      this.pickerReturn = undefined;
      this.showPrompt();
      return;
    }
    if (key.name === 'up') this.picker = moveSelection(this.picker, -1);
    else if (key.name === 'down') this.picker = moveSelection(this.picker, 1);
    else this.picker = setFilter(this.picker, this.readline.line);
    this.drawPickerList();
  }

  private historyBack(): void {
    if (this.history.length === 0 || this.historyIndex === 0) return;
    if (this.historyIndex === this.history.length) this.draft = this.readline.line;
    this.historyIndex -= 1;
    this.replaceLine(this.history[this.historyIndex]);
  }

  private historyForward(): void {
    if (this.historyIndex >= this.history.length) return;
    this.historyIndex += 1;
    this.replaceLine(this.historyIndex === this.history.length ? this.draft : this.history[this.historyIndex]);
  }

  private remember(text: string): void {
    if (this.history[this.history.length - 1] !== text) this.history.push(text);
    this.historyIndex = this.history.length;
    this.draft = '';
  }

  /** Ctrl+C: stop waiting if an answer is on its way, clear a typed line, or leave from an empty prompt. */
  private interrupt(): void {
    if (this.waitingController) {
      this.waitingController.abort();
      return;
    }
    if (this.readline.line !== '') {
      this.replaceLine('');
      if (this.view === 'picker') {
        this.picker = setFilter(this.picker, '');
        this.drawPickerList();
      }
      return;
    }
    this.end(EXIT_CODES.ok);
  }

  private enqueue(text: string): void {
    const echoed = this.terminal && !this.held.held;
    this.queue.push({ text, echoed });
    void this.drain();
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
    if (line.echoed) return;
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
    if (isSlashCommand(text)) {
      await this.command(parseSlash(text));
      return;
    }
    this.remember(text);
    await this.send(text);
  }

  private choose(line: QueuedLine): void {
    if (line.echoed) this.clearPicker();
    else this.echo(line, this.pickerPrompt());
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
      case 'exit': return this.end(EXIT_CODES.ok, true);
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
    this.printMuted('  Tab completes commands and names. Up and Down go through what you sent.');
    this.print();
  }

  private waitingFor(chat: ChatEntry): Waiting {
    if (!this.terminal) return NO_WAITING;
    const label = `${chat.name} is working`;
    const hint = 'Ctrl+C stops waiting';
    if (this.mode === 'none') return new WaitingLine(text => this.write(text), `${label}… (${hint})`);
    return new WaitingFace({
      write: text => this.write(text),
      color: chat.color,
      mode: this.mode,
      label,
      hint,
      columns: () => this.columns(),
      frameMilliseconds: this.options.frameMilliseconds,
    });
  }

  private async send(text: string): Promise<void> {
    const chat = this.chat!;
    const controller = new AbortController();
    const waiting = this.waitingFor(chat);
    const startedAt = Date.now();
    this.waitingController = controller;
    this.held.held = this.terminal;
    waiting.start();
    try {
      const value = await this.options.client.send(chat.name, text, controller.signal);
      waiting.stop();
      this.printTurn(value, Math.round((Date.now() - startedAt) / 1000));
    } catch (error) {
      waiting.stop();
      if (error instanceof StoppedError) this.printMuted(`Stopped waiting. ${chat.name} keeps working in the app; /read shows the answer when it is ready.`);
      else this.printFailure(error);
    } finally {
      this.waitingController = undefined;
      this.held.held = false;
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

  /** Leaves the session. `atLineStart` is true after a typed command, when the cursor already sits on a fresh line. */
  private end(code: number, atLineStart = false): void {
    if (this.finished) return;
    this.finished = true;
    this.waitingController?.abort();
    if (this.terminal) {
      if (!atLineStart) this.write('\r\n');
      this.write(`${ANSI.clearBelow}${ANSI.showCursor}`);
      this.options.input.removeListener('keypress', this.onKeypress);
    }
    this.readline.close();
    this.finish(code);
  }
}

/** Runs one interactive session until the person leaves; resolves to the exit code. */
export function runInteractive(options: InteractiveOptions): Promise<number> {
  return new Session(options).run();
}
