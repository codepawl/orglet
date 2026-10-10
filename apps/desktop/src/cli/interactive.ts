import { t } from './text';
import { createInterface, type Interface } from 'node:readline';
import { TerminalComposer, type ComposerShortcut, type Suggestion } from './composer';
import { agentDetails, terminalHeader } from './chat-layout';
import { Transcript } from './transcript';
import { renderMiniFace, renderMiniFaces } from './faces';
import { AppRefusal, type ChatClient } from './chat-client';
import { StoppedError, UnreachableError } from './client';
import { chosenEntry, createPicker, entriesFromList, findChat, moveSelection, renderPickerLines, setFilter, visibleEntries, type ChatEntry, type PickerState } from './picker';
import { answerColor, chatHeader, renderAnswers, styledList } from './pretty';
import { EXIT_CODES, type CliAnswer, type SendValue } from './protocol';
import { completeSlash, HISTORY_PAGE, isSlashCommand, parseSlash, SLASH_HELP, type SlashCommand } from './slash';
import { renderTurns } from './pretty';
import type { ChatActionClient } from './chat-client';
import { formatCard, pairWithTerminal, shortCardId } from './held-command';
import { parseSetupArguments } from './held-setup';
import { UsageError } from './arguments';
import type { WaitingCard } from './held-protocol';
import type { ChatControl, CliChatRow, CliProgressFrame, CliQuestion } from './protocol';
import type { Reaction } from '../shared/message-interactions';
import { chatKindLabel, formatChats, formatLibrary, formatManagementResult, formatModels, formatPreferences, formatRun, formatRunning, formatScheduleChange, formatSchedules, formatSearch, formatSpaces, formatUsage } from './output';
import { ERROR_COLOR, muted, MUTED_COLOR, NEUTRAL_COLOR, padEnd, paint, truncate, wrapSegments, type ColorMode, type Style } from './terminal';
import { ManagementEditor, type EditorResult, type ManagementAction } from './management-editor';
import type { ManagementResult } from './management';

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
  reducedMotion?: boolean;
};

const DEFAULT_COLUMNS = 80;
const PICKER_MAX_ROWS = 8;
const WELCOME_FACE_LIMIT = 12;
const CHAT_HINT = 'Enter sends. Ctrl+J adds a line. Paste stays in the draft. /help lists commands. Ctrl+D leaves.';
/** These controls do not change the chat or submit a turn, so they need not wait behind one. */
const IMMEDIATE_COMMANDS = new Set<SlashCommand['kind']>(['open', 'clear', 'queue', 'undo', 'help', 'details', 'agents', 'history', 'react', 'forward', 'usage', 'chats', 'schedules', 'spaces', 'search', 'running', 'memory', 'plan-usage', 'models']);

/** What requests name a chat by: its id for a chat opened with `/to #id`, else the orglet's or crew's name. */
function targetOf(entry: ChatEntry): string {
  return entry.target ?? entry.name;
}

/** The key a chat's transcript and draft are kept under. */
function entryKey(entry: ChatEntry): string {
  return entry.target ?? `${entry.kind}:${entry.name}`;
}

/** A chat from `orglet chats` as the terminal opens it: named, coloured, and reached by its id. */
function chatEntry(row: CliChatRow): ChatEntry {
  const color = row.color ?? NEUTRAL_COLOR;
  return { kind: row.kind === 'crew' ? 'team' : 'worker', name: row.name, detail: `${chatKindLabel(row.kind)} · ${row.with.join(', ')}`, color, colors: [color], target: `#${row.short}` };
}

/** Stop and pause act on the turn this terminal is waiting for, so they cannot wait behind it. */
function isImmediate(command: SlashCommand): boolean {
  if (command.kind === 'control') return command.action === 'stop' || command.action === 'pause';
  return IMMEDIATE_COMMANDS.has(command.kind);
}

type QueuedLine = { text: string };
/** Starts the request a wait is for: a message, a reply, an answer or a control that starts a turn. */
type TurnStarter = (signal: AbortSignal, progress?: (frame: CliProgressFrame) => void) => Promise<SendValue>;
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
  private editor: ManagementEditor | undefined;
  private editorDraft = '';
  private managementOpening: { action: ManagementAction } | undefined;
  private historyLoading = false;
  /** Set while a pairing waits for the code: the next submitted line goes here instead of into the chat, and is never echoed. */
  private codeReader: ((typed: string | undefined) => void) | undefined;
  /** True while a key is being typed: the composer draws dots, and the line goes nowhere but the reader. */
  private hidingInput = false;

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
    if (this.entries.length === 0 && !this.options.client.management) {
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
        detail: () => this.confirmingExit ? 'Runs already sent keep working in the app.' : !this.editor && this.chat && this.view === 'chat' ? `${this.chat.model ?? 'provider default'} · effort: provider default` : '',
        shortcut: action => this.shortcut(action),
        prompt: () => this.currentPrompt(),
        placeholder: () => this.editor?.placeholder ?? (this.view === 'picker' ? 'Search orglets or channels…' : ''),
        rows: maxLines => this.editor ? this.editor.rows(this.textWidth(), maxLines, this.mode) : renderPickerLines(this.picker, { width: this.textWidth(), mode: this.mode, maxRows: PICKER_MAX_ROWS, maxLines, grouped: true, showFaces: true }),
        status: () => this.composerStatus(),
        hint: () => {
          if (this.confirmingExit) return 'Esc stays · typing continues';
          if (this.editor) return t('Esc quay lại/hủy · PgUp/PgDn chi tiết');
          if (this.view === 'picker') return t('Ctrl+N tạo · ← quản lý mục đang chọn');
          if (this.panel || this.agentsVisible) return 'PgUp/PgDn scroll · Esc closes · Ctrl+P switch';
          return this.waitingController ? `Ctrl+Q queue · Ctrl+Z undo · ${t('Ctrl+N tạo')} · Ctrl+C exit` : `Ctrl+J newline · Ctrl+O details · ← chats · ${t('Ctrl+N tạo')}`;
        },
        picker: () => this.editor ? this.editor.isPicker : this.view === 'picker' && !this.composer?.text.startsWith('/'),
        suggestions: text => this.editor || this.managementOpening ? [] : this.suggestions(text),
        change: text => {
          if (this.editor) return this.editor.change(text);
          if (this.view === 'picker') this.picker = setFilter(this.picker, text);
        },
        navigate: direction => {
          if (this.editor) {
            if (direction !== 0) this.editor.navigate(direction);
            return;
          }
          if (direction === 0) this.composer?.replace(chosenEntry(this.picker)?.name ?? '');
          else this.picker = moveSelection(this.picker, direction);
        },
        escape: () => {
          if (this.managementOpening) {
            this.managementOpening = undefined;
            void this.drain();
            return;
          }
          if (this.editor) {
            if (this.editor.escape()) {
              this.closeEditor();
              void this.drain();
            }
            else this.replaceLine(this.editor.draft());
            return;
          }
          this.agentsVisible = false;
          this.panel = undefined;
          this.leavePicker();
        },
        submit: text => this.enqueue(text),
        interrupt: () => this.interrupt(),
        confirmingExit: () => this.confirmingExit,
        masked: () => this.hidingInput,
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
    if (this.managementOpening) return t('Đang mở cấu hình…');
    if (this.editor) return this.editor.state === 'saving' ? t("Đang áp dụng cấu hình…") : this.editor.state === 'confirm' ? this.editor.error || t("Xóa cần tên khớp hoàn toàn · Esc hủy") : t("Cấu hình · không gửi tin nhắn chat");
    if (!this.chat || this.view === 'picker') return t('Ctrl+N tạo · ← quản lý mục đang chọn');
    const state = this.waitingController ? 'working' : 'ready';
    const queued = this.queue.length ? ` · ${this.queue.length} queued` : '';
    const elapsed = this.waitingController ? ` · ${Math.floor((Date.now() - this.waitingStartedAt) / 1000)}s` : '';
    return `${this.waitingController ? 'queue' : 'message'} · ${state}${queued}${elapsed} · Enter ${this.waitingController ? 'queues' : 'sends'}`;
  }

  private frame(height: number, width: number): string[] {
    const directory = this.options.directory ?? process.cwd();
    if (this.editor) {
      const header = this.editor.state === 'confirm' ? [] : [muted(truncate(`Orglet ${this.options.version} · ${directory}`, width), this.mode)];
      const context = this.editor.context(width, this.mode);
      const room = Math.max(0, height - header.length);
      this.editor.contextOffset = Math.max(0, Math.min(this.editor.contextOffset, Math.max(0, context.length - room)));
      return [...header, ...context.slice(this.editor.contextOffset, this.editor.contextOffset + room)];
    }
    const chat = this.view === 'chat' ? this.chat : undefined;
    const header = terminalHeader(chat, this.options.version, directory, width, this.options.output.rows ?? 24, this.mode);
    const headerRows = Math.min(header.length, Math.max(1, height - 3));
    const room = Math.max(0, height - headerRows - (height > 6 ? 1 : 0));
    let panel: string[] | undefined;
    if (this.panel) panel = this.panelRows(width);
    else if (this.agentsVisible && this.chat) panel = agentDetails(this.chat, this.entries, directory, width, this.mode);
    this.panelOffset = Math.max(0, Math.min(this.panelOffset, Math.max(0, (panel?.length ?? 0) - room)));
    const content = this.view === 'picker' ? [] : panel ? panel.slice(this.panelOffset, this.panelOffset + room)
      : this.transcript.view(room, width, this.mode, Date.now() - this.waitingStartedAt, this.options.reducedMotion ?? false);
    return [...header.slice(0, headerRows), ...(height > 6 ? [''] : []), ...content];
  }

  private panelRows(width: number): string[] {
    if (this.panel === 'help') return SLASH_HELP.map(([usage, meaning]) => truncate(`${usage}  ${meaning}`, width));
    if (!this.queue.length) return ['Nothing is waiting in this terminal.'];
    return [`Waiting in this terminal (${this.queue.length})`, ...this.queue.map((item, index) => truncate(`${index + 1}. ${item.text.trim().replace(/\s+/gu, ' ')}`, width))];
  }

  private suggestions(text: string): Suggestion[] {
    const [candidates] = completeSlash(text, this.entries.map(entry => entry.name));
    const entityCommand = text.match(/^\s*\/(to|edit|delete|forward)\s+/i)?.[1].toLowerCase();
    if (entityCommand) {
      const matching = new Set(candidates);
      return this.entries.filter(entry => matching.has(`/${entityCommand} ${entry.name}`)).map(entry => ({
        text: `/${entityCommand} ${entry.name}`,
        label: `${entry.kind === 'team' ? paint('▦', { foreground: entry.color }, this.mode) : renderMiniFace(entry.color, this.mode)} ${entry.name}`,
        description: entry.detail,
      }));
    }
    return candidates.map(candidate => ({ text: candidate, description: SLASH_HELP.find(([usage]) => usage.split(' ')[0] === candidate.trim().split(' ')[0])?.[1] ?? 'Open this chat' }));
  }

  private shortcut(action: ComposerShortcut): boolean | void {
    if (this.managementOpening) return;
    if (this.editor) {
      if (action === 'pageUp') this.editor.contextOffset -= 3;
      if (action === 'pageDown') this.editor.contextOffset += 3;
      return;
    }
    if (action === 'new') {
      void this.manage('new');
      return;
    }
    if (action === 'menu') {
      if (this.view !== 'picker' || this.composer?.text.trimStart().startsWith('/')) return false;
      const entry = chosenEntry(this.picker);
      if (!entry) return false;
      void this.manage('menu', entry.kind, entry.name);
      return true;
    }
    if (action === 'pageUp' || action === 'pageDown') {
      if (this.panel || this.agentsVisible) this.panelOffset += action === 'pageUp' ? -5 : 5;
      else this.scrollTranscript(action === 'pageUp' ? 5 : -5);
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
    return this.terminal ? '› ' : `${paint('Open', { bold: true }, this.mode)} › `;
  }

  private currentPrompt(): string {
    if (this.codeReader) return `${paint(this.hidingInput ? t('Khóa') : t('Mã'), { bold: true }, this.mode)} › `;
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

  private showPicker(filter: string, returnTo?: ChatEntry): void {
    this.saveDraft();
    this.agentsVisible = false;
    this.panel = undefined;
    this.view = 'picker';
    this.picker = createPicker(this.entries, filter);
    if (!filter && returnTo) {
      this.picker.selected = Math.max(0, this.entries.findIndex(entry => entry.kind === returnTo.kind && entry.name === returnTo.name));
    }
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
    const key = entryKey(entry);
    if (!this.transcripts.has(key)) this.transcripts.set(key, new Transcript());
    this.transcript = this.transcripts.get(key)!;
    this.agentsVisible = false;
    this.panel = undefined;
    this.pickerReturn = undefined;
    if (this.terminal) this.replaceLine(this.drafts.get(key) ?? '');
    if (!this.terminal) this.printLines(chatHeader(entry, this.mode));
    if (!this.terminal && !this.shownHint) this.printMuted(CHAT_HINT);
    if (this.terminal && this.usesDemo(entry)) this.printMuted('No model is connected for this chat yet. /open brings the app forward so you can connect one.');
    this.shownHint = true;
    this.print();
  }

  private leavePicker(): void {
    if (this.view === 'picker' && this.pickerReturn) {
      const back = this.pickerReturn;
      this.view = 'chat';
      this.chat = back;
      this.pickerReturn = undefined;
      this.replaceLine(this.drafts.get(entryKey(back)) ?? '');
      this.showPrompt();
    }
  }

  private saveDraft(): void {
    if (this.view === 'chat' && this.chat && this.composer) {
      this.drafts.set(entryKey(this.chat), this.composer.text);
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
    if (this.codeReader) {
      const reader = this.codeReader;
      this.codeReader = undefined;
      reader(text);
      this.showPrompt();
      return;
    }
    if (this.managementOpening) {
      this.replaceLine(text);
      return;
    }
    if (this.editor) {
      const result = this.editor.submit(text);
      if (result) void this.applyEditorResult(result);
      else this.replaceLine(this.editor.draft());
      return;
    }
    if (this.view === 'chat' && !text.trim()) return;
    // `/exit` must leave immediately, even when an earlier message is still waiting for its answer.
    if (this.terminal && isSlashCommand(text) && /^\/(exit|quit)\s*$/i.test(text)) {
      this.end(EXIT_CODES.ok);
      return;
    }
    if (this.terminal && this.view === 'chat' && isSlashCommand(text)) {
      const command = parseSlash(text);
      if (isImmediate(command)) {
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
    while (this.queue.length > 0 && !this.finished && !this.confirmingExit && (!this.terminal || (!this.editor && !this.managementOpening))) {
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
    if (this.editor) {
      const result = this.editor.submit(line.text);
      if (result) await this.applyEditorResult(result);
      return;
    }
    if (isSlashCommand(line.text)) {
      if (!this.terminal && this.view === 'chat') this.echo(line, this.chatPrompt());
      await this.command(parseSlash(line.text));
      return;
    }
    if (this.view === 'picker') {
      this.choose(line);
      return;
    }
    this.echo(line, this.chatPrompt());
    const text = line.text.trim();
    if (text === '') return;
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
      case 'details':
        this.shortcut('details');
        return;
      case 'agents':
        this.shortcut('agents');
        return;
      case 'history': return this.loadHistory(command.count ?? HISTORY_PAGE);
      case 'reply': return this.send(command.message, command.ref);
      case 'react': return this.react(command.emoji, command.active, command.ref);
      case 'forward': return this.forward(command.targets, command.ref);
      case 'revise': return this.awaitAction(actions => signal => {
        if (!actions.revise) throw new Error(t('App này chưa hỗ trợ sửa tin nhắn từ terminal. Cập nhật app rồi thử lại.'));
        return actions.revise(targetOf(this.chat!), command.ref, command.text, signal);
      });
      case 'answer': return this.awaitAction(actions => signal => actions.answer(targetOf(this.chat!), command.answer, signal));
      case 'control': return this.control(command.action);
      case 'usage': return this.printMuted(command.message);
      case 'chats': return this.listChats(command.archived, command.space);
      case 'side': return this.awaitNewChat(actions => signal => actions.side(targetOf(this.chat!), command.message, signal));
      case 'channel': return this.awaitNewChat(actions => signal => actions.channel(command.names, command.message, signal, command.space || command.category ? { space: command.space, category: command.category } : undefined));
      case 'cli': return this.runCommandLine(command.argv, command.withChat === true);
      case 'bring': return this.chatChange(actions => actions.bring(this.chatId(), command.ref), value => t('Đã đưa #{0} vào chat chính với {1}.', value.ref, value.chat.name));
      case 'members': return this.chatChange(actions => actions.members(this.chatId(), command.names), value => t('Từ tin nhắn sau, kênh gồm: {0}.', value.names.join(', ')));
      case 'rename': return this.chatChange(actions => actions.rename(targetOf(this.chat!), command.title), value => t('Đã đổi tên chat thành {0}.', value.title ?? value.name));
      case 'archive': return this.chatChange(actions => actions.archive(targetOf(this.chat!)), value => t('Đã lưu trữ chat {0}.', value.name));
      case 'schedules': return this.listSchedules();
      case 'spaces': return this.listing(actions => actions.spaces(), formatSpaces);
      case 'schedule': return this.scheduleAction(command.action, command.name);
      case 'search': return this.listing(actions => actions.search(command.query), formatSearch);
      case 'running': return this.listing(actions => actions.running(), formatRunning);
      case 'memory': return this.listing(actions => actions.memories(this.chat!.name), formatLibrary);
      case 'plan-usage': return this.listing(actions => actions.usage(), formatUsage);
      case 'models': return this.listing(actions => actions.models(this.chat!.name), formatModels);
      case 'language': return this.chatChange(actions => actions.preferences({ language: command.language }), formatPreferences);
      case 'theme': return this.chatChange(actions => actions.preferences({ theme: command.theme }), formatPreferences);
      case 'new': return this.manage('new', command.entity);
      case 'edit': return this.manage('edit', undefined, command.name ?? (this.view === 'chat' ? this.chat?.name : undefined));
      case 'delete': return this.manage('delete', undefined, command.name ?? (this.view === 'chat' ? this.chat?.name : undefined));
      case 'unlock': return this.unlock(command.scope);
      case 'lock': return this.lock();
      case 'setup': return this.setup(command.argv);
      case 'approve': return this.approve(command.choice, command.card);
      case 'help': return this.help();
      case 'exit': return this.end(EXIT_CODES.ok);
      case 'unknown': return this.printMuted(`Unknown command ${command.command}. /help lists the commands.`);
    }
  }

  private async manage(action: ManagementAction, kind?: 'worker' | 'team', name?: string): Promise<void> {
    if (this.editor || this.managementOpening) return;
    const management = this.options.client.management;
    if (!management) {
      this.printError(t("Cập nhật Orglet và CLI để quản lý Tí và kênh ở đây."));
      return;
    }
    const opening = { action };
    this.managementOpening = opening;
    this.showPrompt();
    try {
      const catalog = await management.catalog();
      if (this.managementOpening !== opening || this.finished) return;
      this.editorDraft = this.composer?.text ?? '';
      this.editor = new ManagementEditor(action, catalog, kind, name);
      this.replaceLine('');
      if (!this.terminal) this.printLines(this.editor.context(this.textWidth(), this.mode));
    } catch (error) {
      if (this.managementOpening !== opening || this.finished) return;
      if (error instanceof AppRefusal && error.code === 'invalid') this.printError(t("Cập nhật Orglet và CLI để quản lý Tí và kênh ở đây."));
      else this.printFailure(error);
    } finally {
      if (this.managementOpening === opening) {
        this.managementOpening = undefined;
        this.showPrompt();
        if (!this.editor) void this.drain();
      }
    }
  }

  private closeEditor(): void {
    this.editor = undefined;
    this.replaceLine(this.editorDraft);
    this.editorDraft = '';
    this.showPrompt();
  }

  private async applyEditorResult(result: EditorResult): Promise<void> {
    if (result.action === 'cancel') {
      this.closeEditor();
      void this.drain();
      return;
    }
    const editor = this.editor!;
    const previousState = editor.state;
    editor.state = 'saving';
    let saved: ManagementResult | undefined;
    this.showPrompt();
    try {
      const management = this.options.client.management!;
      if (result.action === 'delete' && this.chat?.kind === result.kind && this.chat.name === editor.originalName && this.queue.length) {
        throw new Error(t('Hàng đợi terminal còn tin nhắn. Nhấn Esc, dùng /queue và /undo trước khi xóa chat này.'));
      }
      saved = result.action === 'delete'
        ? await management.delete(result.kind, result.target, result.confirmName)
        : result.kind === 'worker'
          ? await management.saveOrglet(result.config, result.target)
          : await management.saveCrew(result.config, result.target);
      const value = await this.options.client.list();
      this.entries = entriesFromList(value);
      this.closeEditor();
      this.restoreManagedChat(saved, editor.originalName, editor.action);
      this.printMuted(formatManagementResult(saved));
    } catch (error) {
      if (saved) {
        this.closeEditor();
        this.entries = this.entries.flatMap(entry => entry.kind === saved!.kind && entry.name === editor.originalName
          ? saved!.deleted ? [] : [{ ...entry, name: saved!.name }]
          : [entry]);
        this.restoreManagedChat(saved, editor.originalName, editor.action);
        this.printError(t("Đã áp dụng cấu hình nhưng chưa tải lại được danh sách. Dùng /list để tải lại."));
      } else {
        editor.state = previousState;
        editor.error = error instanceof Error ? error.message : String(error);
        this.replaceLine(editor.draft());
        if (!this.terminal) this.printError(editor.error);
      }
    }
    this.showPrompt();
    if (!this.editor) void this.drain();
  }

  private restoreManagedChat(saved: ManagementResult, originalName: string, action: ManagementAction): void {
    const isCurrent = this.chat?.kind === saved.kind && this.chat.name === originalName;
    const oldKey = `${saved.kind}:${originalName}`;
    const newKey = `${saved.kind}:${saved.name}`;
    if (!saved.deleted && oldKey !== newKey) {
      const transcript = this.transcripts.get(oldKey);
      const draft = this.drafts.get(oldKey);
      if (transcript) this.transcripts.set(newKey, transcript);
      if (draft !== undefined) this.drafts.set(newKey, draft);
      this.transcripts.delete(oldKey);
      this.drafts.delete(oldKey);
    }
    if (saved.deleted) {
      this.transcripts.delete(oldKey);
      this.drafts.delete(oldKey);
      if (isCurrent) {
        this.chat = undefined;
        this.pickerReturn = undefined;
        this.showPicker('');
      } else if (this.view === 'picker') this.refreshManagedPicker();
      return;
    }
    const entry = this.entries.find(candidate => candidate.kind === saved.kind && candidate.name === saved.name);
    if (isCurrent && entry) {
      this.chat = entry;
      this.pickerReturn = this.pickerReturn ? entry : undefined;
    }
    if (entry && action === 'new' && !this.queue.length) this.enterChat(entry);
    else if (this.view === 'picker') this.refreshManagedPicker(entry);
  }

  private refreshManagedPicker(preferred?: ChatEntry): void {
    const previous = preferred ?? chosenEntry(this.picker);
    this.picker = { ...this.picker, entries: this.entries };
    const visible = visibleEntries(this.picker);
    const selected = visible.findIndex(entry => entry.kind === previous?.kind && entry.name === previous.name);
    this.picker.selected = selected >= 0 ? selected : Math.max(0, Math.min(this.picker.selected, visible.length - 1));
    this.replaceLine(this.picker.filter);
  }

  /** Opens a side thread, channel or any other chat by the start of its id, as `/chats` printed it (COD-354). */
  private async openChatById(prefix: string): Promise<void> {
    const actions = this.actions();
    if (!actions) return;
    try {
      const wanted = prefix.toLowerCase();
      const rows = (await actions.chats(false)).chats.filter(row => row.id.toLowerCase().startsWith(wanted));
      if (rows.length === 1) this.enterChat(chatEntry(rows[0]));
      else this.printMuted(rows.length ? t('Mã #{0} khớp với nhiều chat. Gõ thêm vài ký tự.', prefix) : t('Không có chat đang mở nào có mã #{0}. /chats liệt kê các chat.', prefix));
    } catch (error) {
      this.printFailure(error);
    }
  }

  private switchChat(name: string | undefined): void | Promise<void> {
    if (name?.startsWith('#')) return this.openChatById(name.slice(1));
    if (!name) {
      this.showPicker('', this.chat);
      return;
    }
    const match = findChat(this.entries, name);
    if ('entry' in match) {
      this.enterChat(match.entry);
      return;
    }
    if (match.candidates.length === 0) this.printMuted(`No orglet or channel is called "${name}".`);
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
      const value = await this.options.client.read(targetOf(chat));
      if (value.answers.length === 0) this.printMuted(`No answer in the chat with ${chat.name} yet.`);
      else this.printAnswers(value.answers);
      if (['queued', 'running', 'pausing'].includes(value.status)) this.printMuted(`${chat.name} is working on a newer message.`);
      if (value.question) this.printQuestion(value.question);
      if (value.needsDesktop) this.printMuted(t('{0} đang chờ bạn duyệt một bước. /open mở chat này trong app.', chat.name));
    } catch (error) {
      this.printFailure(error);
    }
    this.print();
  }

  private async openInApp(): Promise<void> {
    const chat = this.chat!;
    try {
      await this.options.client.open(targetOf(chat));
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

  private async send(text: string, replyTo?: string): Promise<void> {
    const chat = this.chat!;
    if (this.terminal && this.usesDemo(chat)) {
      this.printError('Nothing was sent: no model is connected for this chat. /open brings the app forward so you can connect one.');
      return;
    }
    if (replyTo) return this.awaitAction(actions => (signal, progress) => actions.reply(targetOf(chat), text, replyTo, signal, progress));
    return this.awaitTurn((signal, progress) => this.options.client.send(targetOf(chat), text, signal, progress));
  }

  /** The chat actions of an app new enough to have them (COD-354); an older one gets a hint instead. */
  private actions(): ChatActionClient | undefined {
    const actions = this.options.client.actions;
    if (!actions) this.printError(t('Cập nhật Orglet và CLI để dùng lệnh này.'));
    return actions;
  }

  private async awaitAction(start: (actions: ChatActionClient) => TurnStarter): Promise<void> {
    const actions = this.actions();
    if (!actions) return;
    return this.awaitTurn(start(actions));
  }

  /** Stop and pause act at once; resume, retry and continue wait for the turn they start, like a message. */
  private async control(action: ChatControl): Promise<void> {
    const chat = this.chat!;
    if (action !== 'stop' && action !== 'pause') return this.awaitAction(actions => signal => actions.control(targetOf(chat), action, signal));
    const actions = this.actions();
    if (!actions) return;
    try {
      await actions.control(targetOf(chat), action, new AbortController().signal);
      this.printMuted(action === 'stop' ? t('Đã dừng lượt đang chạy với {0}.', chat.name) : t('{0} sẽ tạm dừng sau bước đang làm.', chat.name));
    } catch (error) {
      this.printFailure(error);
    }
  }

  private async react(emoji: Reaction, active: boolean, ref?: string): Promise<void> {
    const actions = this.actions();
    if (!actions) return;
    try {
      const value = await actions.react(targetOf(this.chat!), emoji, active, ref);
      this.printMuted(value.active ? t('Đã thả {0} vào #{1}.', value.emoji, value.ref) : t('Đã gỡ {0} khỏi #{1}.', value.emoji, value.ref));
    } catch (error) {
      this.printFailure(error);
    }
  }

  private async forward(targets: string[], ref?: string): Promise<void> {
    const actions = this.actions();
    if (!actions) return;
    try {
      const value = await actions.forward(targetOf(this.chat!), targets, ref);
      for (const item of value.sent) this.printMuted(t('Đã chuyển tiếp tới {0}.', item.name));
      for (const item of value.failed) this.printError(t('Không chuyển tiếp được tới {0}: {1}', item.name, item.error));
    } catch (error) {
      this.printFailure(error);
    }
  }

  /** The id of a chat opened with `/to #id`; side threads and channels are reached this way. */
  private chatId(): string {
    const target = this.chat?.target;
    if (!target) throw new AppRefusal(t('Mở chat bằng /to #mã trước; /chats liệt kê mã của từng chat.'), 'invalid');
    return target.slice(1);
  }

  /** Lists chats with their short ids, the way `orglet chats` does; `/to #id` opens one. */
  /**
   * A slash command that is the one-shot command typed in the chat: it runs exactly that command, so the checks and the
   * confirmation a delete needs are the one-shot command's. With `withChat` the chat this one is open on is added.
   */
  private async runCommandLine(argv: readonly string[], withChat: boolean): Promise<void> {
    const actions = this.actions();
    if (!actions) return;
    if (!actions.commandLine) {
      this.printError(t('Cập nhật Orglet và CLI để dùng lệnh này.'));
      return;
    }
    if (withChat && !this.chat) {
      this.printError(t('Mở một chat trước, rồi gõ lại lệnh này.'));
      return;
    }
    const target = withChat ? targetOf(this.chat!) : undefined;
    const chatOption = target === undefined ? [] : target.startsWith('#') ? ['--chat', target.slice(1)] : ['--to', target];
    try {
      const result = await actions.commandLine([...argv, ...chatOption]);
      if (result.stdout) this.printLines(result.stdout.split('\n'));
      if (result.stderr) this.printError(result.stderr);
    } catch (error) {
      this.printFailure(error);
    }
  }

  private async listChats(archived: boolean, space?: string): Promise<void> {
    const actions = this.actions();
    if (!actions) return;
    try {
      const value = await actions.chats(archived, space);
      this.printLines(formatChats(value).split('\n'));
      if (value.chats.length) this.printMuted(t('/to #mã mở một chat.'));
    } catch (error) {
      this.printFailure(error);
    }
  }

  /** A change to the chat itself, such as a rename; prints what it did. */
  private async chatChange<Value>(change: (actions: ChatActionClient) => Promise<Value>, describe: (value: Value) => string): Promise<void> {
    const actions = this.actions();
    if (!actions) return;
    try {
      const description = describe(await change(actions));
      for (const line of description.split('\n')) this.printMuted(line);
    } catch (error) {
      this.printFailure(error);
    }
  }

  /** Lists schedules as `orglet schedules` does, one aligned row each. */
  private listSchedules(): Promise<void> {
    return this.listing(actions => actions.schedules(), formatSchedules);
  }

  /** Prints what a one-shot listing prints, line by line so its columns stay aligned. */
  private async listing<Value>(load: (actions: ChatActionClient) => Promise<Value>, format: (value: Value) => string): Promise<void> {
    const actions = this.actions();
    if (!actions) return;
    try {
      this.printLines(format(await load(actions)).split('\n'));
    } catch (error) {
      this.printFailure(error);
    }
  }

  /** Switches a schedule on or off, or starts it now the way `orglet run` does. */
  private scheduleAction(action: 'on' | 'off' | 'run', name: string): Promise<void> {
    if (action === 'run') return this.chatChange(actions => actions.runSchedule(name), value => formatRun(value));
    return this.chatChange(actions => actions.enableSchedule(name, action === 'on'), value => formatScheduleChange('schedule-enable', value));
  }

  /** Waits for a side thread or channel's first answer, then says how to open that chat here. */
  private async awaitNewChat(start: (actions: ChatActionClient) => (signal: AbortSignal) => Promise<SendValue>): Promise<void> {
    let opened: SendValue | undefined;
    await this.awaitAction(actions => async signal => {
      opened = await start(actions)(signal);
      return opened;
    });
    const taskId = opened?.chat.taskId;
    if (taskId) this.printMuted(t('/to #{0} mở chat này.', taskId.slice(0, 8)));
  }

  private scrollTranscript(lines: number): void {
    const wasAtTop = this.transcript.atTop;
    this.transcript.offset += lines;
    const loadsMore = lines > 0 && wasAtTop && this.view === 'chat' && !this.transcript.historyComplete && this.options.client.actions !== undefined;
    if (loadsMore) void this.loadHistory(HISTORY_PAGE, true);
  }

  /**
   * Puts earlier turns of this chat above the conversation (COD-354), before the first one this terminal sent, so
   * nothing shows twice. Page Up at the top does the same quietly.
   */
  private async loadHistory(count: number, fromScrolling = false): Promise<void> {
    const chat = this.chat;
    const transcript = this.transcript;
    if (!chat || this.historyLoading) return;
    if (transcript.historyComplete) {
      if (!fromScrolling) this.printMuted(t('Đã hiện đến đầu cuộc trò chuyện.'));
      return;
    }
    const actions = this.actions();
    if (!actions) return;
    this.historyLoading = true;
    try {
      const value = await actions.history(targetOf(chat), count, transcript.earliestTurn ?? transcript.firstSentTurn);
      const turns = value.turns ?? [];
      transcript.historyComplete = !value.earlier;
      if (turns.length) transcript.earliestTurn = turns[0].number;
      const notice = value.earlier ? t('… còn {0} lượt trước đó · PgUp hoặc /history tải thêm', value.earlier) : t('Đầu cuộc trò chuyện');
      if (this.terminal) transcript.prependTurns(turns, { text: notice, style: { foreground: MUTED_COLOR } });
      else {
        this.printMuted(notice);
        this.printLines(renderTurns(turns, { mode: this.mode, width: this.textWidth(), fallbackColor: chat.color }));
        this.print();
      }
    } catch (error) {
      if (error instanceof AppRefusal && error.code === 'not_found' && fromScrolling) transcript.historyComplete = true;
      else this.printFailure(error);
    } finally {
      this.historyLoading = false;
      this.showPrompt();
    }
  }

  private heldClient() {
    const held = this.options.client.held;
    if (!held) this.printError(t('Cập nhật Orglet và CLI để mở khóa từ terminal.'));
    return held;
  }

  /** The line the person types for the code is read here and goes nowhere else: not the queue, not the transcript. */
  private readCode(prompt: string): Promise<string | undefined> {
    this.printMuted(prompt.trim());
    return new Promise(resolve => {
      this.codeReader = resolve;
      this.showPrompt();
    });
  }

  private async unlock(scope: 'decisions' | 'setup'): Promise<void> {
    const held = this.heldClient();
    if (!held) return;
    if (!this.terminal) {
      this.printError(t('Mở khóa cần một terminal thật; script không gõ được mã.'));
      return;
    }
    const print = { stdout: (text: string) => this.printMuted(text), stderr: (text: string) => this.printError(text) };
    if (!await pairWithTerminal(held, scope, undefined, prompt => this.readCode(prompt), print)) return;
    this.printMuted(scope === 'setup'
      ? t('Đã mở khóa để cấp quyền và lưu khóa. /grant, /connect và /disconnect làm việc đó; /lock khóa lại.')
      : t('Đã mở khóa. /approve trả lời thẻ đang chờ; /lock khóa lại.'));
  }

  /** A key typed in the chat: the prompt masks it and the line goes to the reader only, not the queue, the history or the transcript. */
  private async readSecret(prompt: string): Promise<string | undefined> {
    this.hidingInput = true;
    try {
      return (await this.readCode(prompt))?.trim();
    } finally {
      this.hidingInput = false;
      this.showPrompt();
    }
  }

  /** `/grant`, `/connect` and `/disconnect`: the same bodies as the commands, sent with the key `/unlock setup` gave. */
  private async setup(argv: string[]): Promise<void> {
    const held = this.heldClient();
    if (!held) return;
    let request;
    try {
      request = parseSetupArguments(argv);
    } catch (error) {
      if (error instanceof UsageError) this.printError(error.message);
      else this.printFailure(error);
      return;
    }
    if (!held.canSetup()) {
      this.printMuted(t('Gõ /unlock setup để cấp quyền và lưu khóa ở đây.'));
      return;
    }
    let body = request.body;
    if (request.secretPrompt) {
      if (!this.terminal) {
        this.printError(t('Nhập khóa cần một terminal thật.'));
        return;
      }
      const secret = await this.readSecret(request.secretPrompt.replace(/:\s*$/, ''));
      if (!secret) {
        this.printMuted(t('Đã hủy, không lưu khóa.'));
        return;
      }
      body = { ...body, secret } as typeof body;
    }
    try {
      const done = await held.act(body);
      this.printMuted(t('Xong: {0}', done.summary));
    } catch (error) {
      if (error instanceof AppRefusal && error.code === 'locked') this.printMuted(t('Gõ /unlock setup để cấp quyền và lưu khóa ở đây.'));
      else this.printFailure(error);
    }
  }

  private async lock(): Promise<void> {
    const held = this.heldClient();
    if (!held) return;
    await held.lock().catch(() => undefined);
    this.printMuted(t('Đã khóa lại.'));
  }

  /** Prints the cards the chat waits on with what the window's card shows, and how to answer them from here. */
  private async offerCards(chat: ChatEntry): Promise<void> {
    const held = this.options.client.held;
    if (!held) return;
    try {
      const cards = await held.waiting(chat.target?.startsWith('#') ? { chat: chat.target.slice(1) } : { to: chat.name });
      for (const card of cards) this.printCard(card, held.unlocked());
    } catch {
      // The plain hint above already said where to answer.
    }
    this.showPrompt();
  }

  private printCard(card: WaitingCard, unlocked: boolean): void {
    for (const line of formatCard({ ...card, choices: [] }, '').split('\n')) this.printWrapped(line, {});
    this.printMuted(card.choices.map(choice => `${choice.key}: ${choice.label}`).join(' · '));
    this.printMuted(unlocked ? t('/approve <lựa chọn> {0} trả lời thẻ này.', shortCardId(card.cardId)) : t('Gõ /unlock để trả lời ở đây, hoặc /open để trả lời trong app.'));
  }

  private async approve(choiceKey: string | undefined, cardPrefix: string | undefined): Promise<void> {
    const held = this.heldClient();
    if (!held || !this.chat) return;
    const chat = this.chat;
    const target = chat.target?.startsWith('#') ? { chat: chat.target.slice(1) } : { to: chat.name };
    let cards: WaitingCard[];
    try {
      cards = (await held.waiting(target)).filter(card => !cardPrefix || card.cardId.startsWith(cardPrefix));
    } catch (error) {
      this.printFailure(error);
      return;
    }
    if (cards.length === 0) {
      this.printMuted(t('Không có thẻ nào đang chờ ở chat này.'));
      return;
    }
    if (!choiceKey || cards.length > 1) {
      for (const card of cards) this.printCard(card, held.unlocked());
      return;
    }
    const chosen = cards[0].choices.find(choice => choice.key === choiceKey);
    if (!chosen) {
      this.printError(t('Thẻ này không có lựa chọn "{0}".', choiceKey));
      return;
    }
    if (!held.unlocked()) {
      this.printMuted(t('Gõ /unlock để trả lời ở đây, hoặc /open để trả lời trong app.'));
      return;
    }
    try {
      const done = await held.act(chosen.request);
      this.printMuted(t('Xong: {0}', done.summary));
    } catch (error) {
      // A refused key is already forgotten; the next step is /unlock.
      if (error instanceof AppRefusal && error.code === 'locked') this.printMuted(t('Gõ /unlock để trả lời ở đây, hoặc /open để trả lời trong app.'));
      else this.printFailure(error);
    }
  }

  private printQuestion(question: CliQuestion): void {
    this.printWrapped(question.question, { bold: true });
    question.options.forEach((option, index) => this.print(`  ${index + 1}. ${option}`));
    this.printMuted(t('Gõ /answer <số> hoặc /answer <câu trả lời của bạn>.'));
  }

  /** Waits for a turn a message, an answer or a control started, showing its steps, then prints what it ended with. */
  private async awaitTurn(start: TurnStarter): Promise<void> {
    this.panel = undefined;
    const chat = this.chat!;
    const controller = new AbortController();
    const startedAt = Date.now();
    this.waitingController = controller;
    this.waitingStartedAt = startedAt;
    const activity = this.terminal ? this.transcript.beginActivity() : undefined;
    this.showPrompt();
    if (this.terminal) this.waitingTimer = setInterval(() => this.showPrompt(), this.options.reducedMotion || this.mode === 'none' ? 1000 : 120);
    try {
      const progress = activity ? (frame: CliProgressFrame) => {
        if (this.finished || controller.signal.aborted) return;
        activity.frame = frame;
        this.showPrompt();
      } : undefined;
      const value = await start(controller.signal, progress);
      if (this.finished) return;
      this.printTurn(value, Math.round((Date.now() - startedAt) / 1000));
    } catch (error) {
      if (this.finished) return;
      if (error instanceof StoppedError) this.printMuted(`Stopped waiting. ${chat.name} keeps working in the app; /read shows the answer when it is ready.`);
      else this.printFailure(error);
    } finally {
      if (activity) activity.following = false;
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
    if (value.turn !== undefined && this.transcript.firstSentTurn === undefined) this.transcript.firstSentTurn = value.turn;
    if (value.answers.length > 0) this.printAnswers(value.answers, `${seconds}s`);
    if (value.needsDesktop) {
      this.printMuted(t('{0} đang chờ bạn duyệt một bước. /open mở chat này trong app.', chat.name));
      void this.offerCards(chat);
      return;
    }
    if (value.question) {
      this.printQuestion(value.question);
      return;
    }
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
    this.codeReader?.(undefined);
    this.options.client.held?.forget();
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
