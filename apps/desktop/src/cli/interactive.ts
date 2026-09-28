import { createInterface, type Interface } from 'node:readline';
import { TerminalComposer } from './composer';
import { agentDetails, terminalHeader } from './chat-layout';
import { Transcript } from './transcript';
import { renderMiniFaces } from './faces';
import { AppRefusal, type ChatClient } from './chat-client';
import { StoppedError, UnreachableError } from './client';
import { chosenEntry, createPicker, entriesFromList, findChat, moveSelection, renderPickerLines, setFilter, type ChatEntry, type PickerState } from './picker';
import { answerColor, chatHeader, renderAnswers, styledList } from './pretty';
import { EXIT_CODES, type CliAnswer, type SendValue } from './protocol';
import { completeSlash, isSlashCommand, parseSlash, SLASH_HELP, type SlashCommand } from './slash';
import { ERROR_COLOR, muted, MUTED_COLOR, padEnd, paint, truncate, wrapSegments, type ColorMode, type Style } from './terminal';

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
  directory?: string;
};

const DEFAULT_COLUMNS = 80;
const PICKER_MAX_ROWS = 8;
const WELCOME_FACE_LIMIT = 12;
const CHAT_HINT = 'Enter sends. Ctrl+J adds a line. Paste stays in the draft. /help lists commands. Ctrl+D leaves.';
/** These controls do not change the chat or submit a turn, so they need not wait behind one. */
const IMMEDIATE_COMMANDS = new Set<SlashCommand['kind']>(['open', 'clear', 'queue', 'undo', 'help', 'details', 'agents']);

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
  private confirmingExit = false;
  private waitingController: AbortController | undefined;
  private finish: (code: number) => void = () => undefined;
  private waitingStartedAt = 0;
  private waitingTimer: ReturnType<typeof setInterval> | undefined;
  private transcript = new Transcript();
  private readonly transcripts = new Map<string, Transcript>();
  private readonly drafts = new Map<string, string>();
  private agentsVisible = false;
  private panel: 'queue' | 'help' | undefined;
  private panelOffset = 0;

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
        frame: (height, width) => this.frame(height, width),
        detail: () => this.confirmingExit ? 'Runs already sent keep working in the app.' : this.chat && this.view === 'chat' ? `${this.chat.model ?? 'provider default'} · effort: provider default` : '',
        shortcut: action => this.shortcut(action),
        prompt: () => this.currentPrompt(),
        rows: () => renderPickerLines(this.picker, { width: this.textWidth(), mode: this.mode, maxRows: this.pickerRows(), showFaces: false }),
        status: () => this.composerStatus(),
        hint: () => {
          if (this.confirmingExit) return 'Y exits · N / Enter / Esc stays';
          if (this.panel || this.agentsVisible) return 'PgUp/PgDn scroll · Esc closes · Ctrl+P switch';
          return this.waitingController ? 'Ctrl+Q queue · Ctrl+Z undo · Ctrl+C exit' : 'Ctrl+J newline · Ctrl+O details · ← agents · /help';
        },
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
        escape: () => {
          this.agentsVisible = false;
          this.panel = undefined;
          this.leavePicker();
        },
        submit: text => this.enqueue(text),
        interrupt: () => this.interrupt(),
        confirmingExit: () => this.confirmingExit,
        confirmExit: leave => this.confirmExit(leave),
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
    if (this.confirmingExit) return 'Unsent draft and queue will be discarded.';
    if (!this.chat || this.view === 'picker') return '';
    const state = this.waitingController ? 'working' : 'ready';
    const queued = this.queue.length ? ` · ${this.queue.length} queued` : '';
    const elapsed = this.waitingController ? ` · ${Math.floor((Date.now() - this.waitingStartedAt) / 1000)}s` : '';
    return `${this.waitingController ? 'queue' : 'message'} · ${state}${queued}${elapsed} · Enter ${this.waitingController ? 'queues' : 'sends'}`;
  }

  private frame(height: number, width: number): string[] {
    const directory = this.options.directory ?? process.cwd();
    const chat = this.view === 'chat' ? this.chat : undefined;
    const header = terminalHeader(chat, this.options.version, directory, width, this.options.output.rows ?? 24, this.mode);
    const headerRows = Math.min(header.length, Math.max(1, height - 3));
    const room = Math.max(0, height - headerRows - (height > 6 ? 1 : 0));
    let panel: string[] | undefined;
    if (this.panel) panel = this.panelRows(width);
    else if (this.agentsVisible && this.chat) panel = agentDetails(this.chat, this.entries, directory, width, this.mode);
    this.panelOffset = Math.max(0, Math.min(this.panelOffset, Math.max(0, (panel?.length ?? 0) - room)));
    const content = panel ? panel.slice(this.panelOffset, this.panelOffset + room) : this.transcript.view(room, width, this.mode);
    return [...header.slice(0, headerRows), ...(height > 6 ? [''] : []), ...content];
  }

  private panelRows(width: number): string[] {
    if (this.panel === 'help') return SLASH_HELP.map(([usage, meaning]) => truncate(`${usage}  ${meaning}`, width));
    if (!this.queue.length) return ['Nothing is waiting in this terminal.'];
    return [`Waiting in this terminal (${this.queue.length})`, ...this.queue.map((item, index) => truncate(`${index + 1}. ${item.text.trim().replace(/\s+/gu, ' ')}`, width))];
  }

  private shortcut(action: 'agents' | 'details' | 'queue' | 'undo' | 'switch' | 'pageUp' | 'pageDown'): void {
    if (action === 'pageUp' || action === 'pageDown') {
      if (this.panel || this.agentsVisible) this.panelOffset += action === 'pageUp' ? -5 : 5;
      else this.transcript.offset += action === 'pageUp' ? 5 : -5;
      return;
    }
    if (this.view !== 'chat') return;
    if (action === 'agents') {
      this.panel = undefined;
      this.panelOffset = 0;
      this.agentsVisible = !this.agentsVisible;
    }
    if (action === 'details') {
      this.panel = undefined;
      this.agentsVisible = false;
      this.transcript.expanded = !this.transcript.expanded;
    }
    if (action === 'queue') this.showQueue();
    if (action === 'undo') this.undoQueued();
    if (action === 'switch') this.enqueue('/to');
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
    if (this.terminal) {
      this.transcript.append(text);
      return;
    }
    this.composer?.clear();
    this.write(`${text}${this.terminal ? '\r\n' : '\n'}`);
  }

  private printLines(lines: readonly string[]): void {
    for (const line of lines) this.print(line);
  }

  private printWrapped(text: string, style: Style): void {
    if (this.terminal) {
      this.transcript.append(text, style);
      return;
    }
    this.printLines(wrapSegments([{ text, style }], { width: this.textWidth(), mode: this.mode }));
  }

  private printMuted(text: string): void {
    this.printWrapped(text, { foreground: MUTED_COLOR });
  }

  private printError(text: string): void {
    this.printWrapped(text, { foreground: ERROR_COLOR });
  }

  private printWelcome(): void {
    if (this.terminal) return;
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
    this.saveDraft();
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
    this.saveDraft();
    this.view = 'chat';
    this.chat = entry;
    const key = `${entry.kind}:${entry.name}`;
    if (!this.transcripts.has(key)) this.transcripts.set(key, new Transcript());
    this.transcript = this.transcripts.get(key)!;
    this.agentsVisible = false;
    this.panel = undefined;
    this.pickerReturn = undefined;
    if (this.terminal) this.replaceLine(this.drafts.get(key) ?? '');
    if (!this.terminal) this.printLines(chatHeader(entry, this.mode));
    if (!this.terminal && !this.shownHint) this.printMuted(CHAT_HINT);
    if (this.terminal && this.usesDemo(entry)) this.printMuted('No real model selected. /open lets you connect this orglet in the desktop.');
    this.shownHint = true;
    this.print();
  }

  private leavePicker(): void {
    if (this.view === 'picker' && this.pickerReturn) {
      const back = this.pickerReturn;
      this.view = 'chat';
      this.chat = back;
      this.pickerReturn = undefined;
      this.replaceLine(this.drafts.get(`${back.kind}:${back.name}`) ?? '');
      this.showPrompt();
    }
  }

  private saveDraft(): void {
    if (this.view === 'chat' && this.chat && this.composer) {
      this.drafts.set(`${this.chat.kind}:${this.chat.name}`, this.composer.text);
    }
  }

  /** Raw terminals confirm before leaving; scripted sessions retain their signal handling. */
  private interrupt(): void {
    if (this.terminal) {
      this.confirmingExit = true;
      this.showPrompt();
      return;
    }
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

  private confirmExit(leave: boolean): void {
    this.confirmingExit = false;
    if (leave) {
      this.end(EXIT_CODES.ok);
      return;
    }
    this.showPrompt();
    void this.drain();
  }

  private enqueue(text: string): void {
    if (this.view === 'chat' && !text.trim()) return;
    // `/exit` must leave immediately, even when an earlier message is still waiting for its answer.
    if (this.terminal && isSlashCommand(text) && /^\/(exit|quit)\s*$/i.test(text)) {
      this.end(EXIT_CODES.ok);
      return;
    }
    if (this.terminal && this.view === 'chat' && isSlashCommand(text)) {
      const command = parseSlash(text);
      if (IMMEDIATE_COMMANDS.has(command.kind)) {
        void this.command(command).finally(() => this.showPrompt());
        return;
      }
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
    while (this.queue.length > 0 && !this.finished && !this.confirmingExit) {
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
    if (!this.terminal) {
      this.print(`${prompt}${line.text}`);
      return;
    }
    this.print();
    this.printWrapped(`${isSlashCommand(line.text) ? 'Command' : 'You'} › ${line.text}`, { bold: true });
  }

  private async handle(line: QueuedLine): Promise<void> {
    if (this.view === 'picker') {
      this.choose(line);
      return;
    }
    if (!this.terminal || !isSlashCommand(line.text)) this.echo(line, this.chatPrompt());
    const text = line.text.trim();
    if (text === '') return;
    if (isSlashCommand(line.text)) {
      await this.command(parseSlash(text));
      return;
    }
    await this.send(text);
  }

  private choose(line: QueuedLine): void {
    if (!this.terminal) this.echo(line, this.pickerPrompt());
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
      case 'queue': return this.showQueue();
      case 'undo': return this.undoQueued();
      case 'details': return this.shortcut('details');
      case 'agents': return this.shortcut('agents');
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
      const currentChat = this.chat;
      if (currentChat) {
        const updated = this.entries.find(entry => entry.kind === currentChat.kind && entry.name === currentChat.name);
        if (updated) this.chat = updated;
      }
      if (this.terminal) {
        this.showPicker('', this.chat);
        return;
      }
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
    if (this.terminal) {
      this.transcript.clear();
      this.panel = undefined;
      this.agentsVisible = false;
      return;
    }
    this.printLines(chatHeader(this.chat!, this.mode));
    this.print();
  }

  private help(): void {
    if (this.terminal) {
      this.panel = 'help';
      this.panelOffset = 0;
      return;
    }
    const width = Math.max(...SLASH_HELP.map(([usage]) => usage.length));
    for (const [usage, meaning] of SLASH_HELP) this.print(`  ${padEnd(usage, width)}  ${muted(meaning, this.mode)}`);
    this.printMuted('  Ctrl+J adds a line. Paste stays in the draft. / opens the command menu; Tab fills the choice.');
    this.print();
  }

  private showQueue(): void {
    if (this.terminal) {
      this.panel = this.panel === 'queue' ? undefined : 'queue';
      this.panelOffset = 0;
      return;
    }
    if (this.queue.length === 0) {
      this.printMuted('Nothing is waiting in this terminal.');
      return;
    }
    this.printMuted(`Waiting in this terminal (${this.queue.length})`);
    for (const [index, item] of this.queue.entries()) {
      const preview = item.text.trim().replace(/\s+/gu, ' ');
      this.print(truncate(`${index + 1}. ${preview}`, this.textWidth()));
    }
    this.printMuted('/undo takes the last item back into the draft. Sent work keeps running.');
    this.print();
  }

  private undoQueued(): void {
    this.panel = undefined;
    if (!this.composer) {
      this.printMuted('/undo needs an interactive terminal.');
      return;
    }
    if (this.composer.text) {
      this.printMuted('Clear the current draft before taking a queued item back.');
      return;
    }
    const item = this.queue.pop();
    if (!item) {
      this.printMuted('No queued items to edit.');
      return;
    }
    this.printMuted('Taken out of the queue. Edit the draft, then Enter sends or queues it again.');
    this.composer.replace(item.text);
  }

  private async send(text: string): Promise<void> {
    this.panel = undefined;
    const chat = this.chat!;
    if (this.terminal && this.usesDemo(chat)) {
      this.printError('Nothing was sent: this chat uses Demo. /open lets you choose a real connection.');
      return;
    }
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
    if (this.terminal) {
      this.transcript.answer(colored, firstNote);
      return;
    }
    this.printLines(renderAnswers(colored, { mode: this.mode, width: this.textWidth(), fallbackColor, firstNote }));
  }

  private colorOf(name: string): string | undefined {
    return this.entries.find(entry => entry.kind === 'worker' && entry.name === name)?.color;
  }

  private usesDemo(chat: ChatEntry): boolean {
    if (chat.kind === 'worker') return chat.providerId === 'demo';
    return (chat.members ?? []).some(name => this.entries.find(entry => entry.kind === 'worker' && entry.name === name)?.providerId === 'demo');
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
