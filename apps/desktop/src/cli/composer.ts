import { emitKeypressEvents, type Key } from 'node:readline';
import { PassThrough } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { ANSI, displayWidth, muted, paint, truncate, type ColorMode } from './terminal';

type Input = NodeJS.ReadableStream & { isRaw?: boolean; setRawMode?: (raw: boolean) => unknown };
type Output = NodeJS.WritableStream & { columns?: number; rows?: number };
export type Suggestion = { text: string; description: string };
type ComposerOptions = {
  input: Input;
  output: Output;
  mode: ColorMode;
  prompt: () => string;
  rows: () => string[];
  status: () => string;
  hint: () => string;
  picker: () => boolean;
  suggestions: (text: string) => Suggestion[];
  change: (text: string) => void;
  navigate: (direction: number) => void;
  escape: () => void;
  submit: (text: string) => void;
  interrupt: () => void;
  confirmingExit: () => boolean;
  confirmExit: (leave: boolean) => void;
  close: () => void;
  /** A fixed viewport above the draft; absent for callers using inline terminal output. */
  frame?: (height: number, width: number) => string[];
  detail?: () => string;
  shortcut?: (action: 'agents' | 'details' | 'queue' | 'undo' | 'switch' | 'pageUp' | 'pageDown') => void;
};

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
const INPUT_SETTLE_MS = 30;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** One owner for raw input and the transient area below the transcript. It never sends a backend request. */
export class TerminalComposer {
  text = '';
  private cursor = 0;
  private readonly keys = new PassThrough();
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';
  private pasting = false;
  private inputTimer: ReturnType<typeof setTimeout> | undefined;
  private selected = 0;
  private dismissed = false;
  private readonly history: string[] = [];
  private historyIndex = 0;
  private savedDraft = '';
  private drawn = false;
  private cursorRow = 0;
  private wasRaw = false;
  private closed = false;
  private readonly onData = (chunk: Buffer | string) => this.receive(typeof chunk === 'string' ? chunk : this.decoder.write(chunk));
  private readonly onEnd = () => this.options.close();
  private readonly onResize = () => this.draw();

  constructor(private readonly options: ComposerOptions) {
    emitKeypressEvents(this.keys);
    this.keys.on('keypress', (sequence: string, key: Key) => this.key(sequence, key));
  }

  start(): void {
    this.wasRaw = Boolean(this.options.input.isRaw);
    this.options.input.setRawMode?.(true);
    this.options.input.on('data', this.onData);
    this.options.input.on('end', this.onEnd);
    this.options.output.on('resize', this.onResize);
    this.options.input.resume();
    this.options.output.write(`\x1b[?2004h${ANSI.showCursor}`);
    if (this.options.frame) this.options.output.write('\x1b[?1049h\x1b[H');
  }

  stop(): void {
    this.closed = true;
    if (this.inputTimer) clearTimeout(this.inputTimer);
    this.clear();
    this.options.output.write(`\x1b[?2004l${ANSI.showCursor}`);
    if (this.options.frame) this.options.output.write('\x1b[?1049l');
    this.options.input.removeListener('data', this.onData);
    this.options.input.removeListener('end', this.onEnd);
    this.options.output.removeListener('resize', this.onResize);
    this.options.input.setRawMode?.(this.wasRaw);
    this.options.input.pause();
    this.keys.destroy();
  }

  replace(text: string): void {
    this.text = text;
    this.cursor = text.length;
    this.changed();
  }

  private receive(text: string): void {
    this.pending += text;
    if (this.inputTimer) clearTimeout(this.inputTimer);
    this.inputTimer = setTimeout(() => this.flush(), INPUT_SETTLE_MS);
  }

  private flush(): void {
    this.inputTimer = undefined;
    if (this.closed) return;
    while (this.pending) {
      if (this.pasting) {
        const end = this.pending.indexOf(PASTE_END);
        if (end === -1) return; // Keep split delimiters intact until the next chunk arrives.
        const pasted = this.pending.slice(0, end);
        this.pending = this.pending.slice(end + PASTE_END.length);
        this.insert(this.cleanPaste(pasted));
        this.pasting = false;
        continue;
      }
      const start = this.pending.indexOf(PASTE_START);
      if (start !== -1) {
        this.consume(this.pending.slice(0, start));
        this.pending = this.pending.slice(start + PASTE_START.length);
        this.pasting = true;
        continue;
      }
      // A delimiter can arrive one byte at a time. Plain Esc still reaches the key decoder.
      const partial = this.pending.lastIndexOf('\x1b');
      if (partial !== -1 && this.pending.length - partial > 1 && PASTE_START.startsWith(this.pending.slice(partial))) {
        this.consume(this.pending.slice(0, partial));
        this.pending = this.pending.slice(partial);
        return;
      }
      const value = this.pending;
      this.pending = '';
      this.consume(value);
    }
  }

  private cleanPaste(text: string): string {
    // Pasted control keys are text, never shortcuts or terminal escape sequences.
    return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  }

  private consume(text: string): void {
    if (!text) return;
    // Raw terminals send Enter as CR; Ctrl+J is LF. Readline otherwise names both "enter".
    if (text === '\n') {
      if (this.options.confirmingExit()) this.options.confirmExit(false);
      else this.insert('\n');
      return;
    }
    if (text === '\x1b') return this.key(text, { name: 'escape' });
    if (/^\x1b\[(13;2u|27;2;13~)$/.test(text)) return this.insert('\n');
    // Terminals without paste framing deliver a burst. Its newlines must not submit separate turns.
    if (text.length > 1 && /[\r\n]/.test(text)) this.insert(this.cleanPaste(text));
    else if (text.length > 1 && !/[\x00-\x1f\x7f]/.test(text)) this.insert(text);
    else this.keys.write(text);
  }

  private insert(text: string): void {
    if (this.options.confirmingExit()) this.options.confirmExit(false);
    if (this.options.picker()) text = text.replace(/\n/g, ' ');
    this.text = this.text.slice(0, this.cursor) + text + this.text.slice(this.cursor);
    this.cursor += text.length;
    this.changed();
  }

  private changed(): void {
    this.selected = 0;
    this.dismissed = false;
    this.options.change(this.text);
    this.draw();
  }

  private suggestions(): Suggestion[] {
    return this.options.confirmingExit() || this.dismissed || this.options.picker() || this.text.includes('\n') ? [] : this.options.suggestions(this.text);
  }

  private boundary(direction: number): number {
    const positions = [...graphemes.segment(this.text)].map(segment => segment.index);
    positions.push(this.text.length);
    if (direction < 0) return positions.filter(position => position < this.cursor).at(-1) ?? 0;
    return positions.find(position => position > this.cursor) ?? this.text.length;
  }

  private key(sequence: string, key: Key): void {
    if (this.closed) return;
    if (this.options.confirmingExit()) {
      if (key.ctrl && key.name === 'c') {
        this.options.confirmExit(true);
        return;
      }
      this.options.confirmExit(false);
      if (['escape', 'return', 'enter'].includes(key.name ?? '')) return;
    }
    if (key.ctrl && key.name === 'c') return this.options.interrupt();
    if (key.ctrl && key.name === 'd') return this.options.close();
    const shortcuts = { g: 'agents', o: 'details', q: 'queue', z: 'undo', p: 'switch' } as const;
    if (key.ctrl && key.name && key.name in shortcuts && this.options.shortcut) {
      this.options.shortcut(shortcuts[key.name as keyof typeof shortcuts]);
      this.draw();
      return;
    }
    if ((key.name === 'pageup' || key.name === 'pagedown') && this.options.shortcut) {
      this.options.shortcut(key.name === 'pageup' ? 'pageUp' : 'pageDown');
      this.draw();
      return;
    }
    if (key.name === 'left' && !this.text && !this.options.picker() && this.options.shortcut) {
      this.options.shortcut('switch');
      this.draw();
      return;
    }
    if ((key.ctrl && key.name === 'j') || ((key.name === 'return' || key.name === 'enter') && (key.shift || key.meta))) return this.insert('\n');
    const choices = this.suggestions();
    if (key.name === 'escape') {
      if (choices.length) this.dismissed = true;
      else this.options.escape();
    } else if (key.name === 'tab') {
      if (choices.length) this.accept(choices[this.selected]);
      else if (this.options.picker()) this.options.navigate(0);
    } else if (key.name === 'return' || key.name === 'enter') {
      if (choices.length && this.text !== choices[this.selected].text.trimEnd()) {
        this.accept(choices[this.selected]);
        return;
      }
      const value = this.text;
      this.clear();
      this.text = '';
      this.cursor = 0;
      this.dismissed = false;
      this.options.submit(value);
    } else if (key.name === 'up' || key.name === 'down') {
      const direction = key.name === 'up' ? -1 : 1;
      if (this.options.picker()) this.options.navigate(direction);
      else if (choices.length) this.selected = (this.selected + direction + choices.length) % choices.length;
      else this.moveVertical(direction);
    } else if (key.name === 'left') this.cursor = this.boundary(-1);
    else if (key.name === 'right') this.cursor = this.boundary(1);
    else if (key.name === 'home' || (key.ctrl && key.name === 'a')) this.cursor = this.cursor === 0 ? 0 : this.text.lastIndexOf('\n', this.cursor - 1) + 1;
    else if (key.name === 'end' || (key.ctrl && key.name === 'e')) {
      const end = this.text.indexOf('\n', this.cursor);
      this.cursor = end === -1 ? this.text.length : end;
    } else if (key.name === 'backspace') {
      const before = this.boundary(-1);
      this.text = this.text.slice(0, before) + this.text.slice(this.cursor);
      this.cursor = before;
      this.changed();
    } else if (key.name === 'delete') {
      this.text = this.text.slice(0, this.cursor) + this.text.slice(this.boundary(1));
      this.changed();
    } else if (key.ctrl && key.name === 'u') this.replace('');
    else if (!key.ctrl && !key.meta && sequence && !sequence.startsWith('\x1b')) this.insert(sequence);
    this.draw();
  }

  private accept(choice: Suggestion): void {
    this.replace(choice.text);
    this.dismissed = true;
    this.draw();
  }

  remember(text: string): void {
    if (this.history.at(-1) !== text) this.history.push(text);
    this.historyIndex = this.history.length;
  }

  private moveVertical(direction: number): void {
    const start = this.cursor === 0 ? 0 : this.text.lastIndexOf('\n', this.cursor - 1) + 1;
    const end = this.text.indexOf('\n', this.cursor);
    if (!this.text.includes('\n') || (direction < 0 && start === 0) || (direction > 0 && end === -1)) {
      if (direction < 0 && this.historyIndex === this.history.length) this.savedDraft = this.text;
      const next = Math.max(0, Math.min(this.history.length, this.historyIndex + direction));
      if (next !== this.historyIndex) {
        this.historyIndex = next;
        this.replace(next === this.history.length ? this.savedDraft : this.history[next]);
      }
      return;
    }
    const column = this.cursor - start;
    if (direction < 0 && start > 0) {
      const previousStart = start <= 1 ? 0 : this.text.lastIndexOf('\n', start - 2) + 1;
      this.cursor = Math.min(start - 1, previousStart + column);
    } else if (direction > 0) {
      if (end !== -1) {
        const nextEnd = this.text.indexOf('\n', end + 1);
        this.cursor = Math.min(nextEnd === -1 ? this.text.length : nextEnd, end + 1 + column);
      }
    }
    // Vertical movement must not leave the cursor inside a surrogate pair or combining sequence.
    const boundaries = [...graphemes.segment(this.text)].map(segment => segment.index);
    boundaries.push(this.text.length);
    this.cursor = boundaries.filter(position => position <= this.cursor).at(-1) ?? 0;
  }

  clear(): void {
    if (!this.drawn) return;
    if (this.options.frame) this.options.output.write('\x1b[H');
    else this.options.output.write(`\r${ANSI.up(this.cursorRow)}${ANSI.clearBelow}`);
    this.drawn = false;
  }

  draw(): void {
    if (this.closed) return;
    this.clear();
    const width = Math.max(4, (this.options.output.columns ?? 80) - 1);
    const confirmingExit = this.options.confirmingExit();
    const draft = confirmingExit ? '' : this.text;
    const prompt = truncate(confirmingExit ? 'Ctrl+C again to exit' : this.options.prompt(), width - 2);
    const prefixWidth = displayWidth(prompt);
    const contentWidth = Math.max(1, width - prefixWidth);
    const lines = [prompt];
    let row = 0;
    let column = 0;
    let cursorRow = 0;
    let cursorColumn = prefixWidth;
    for (const segment of graphemes.segment(draft)) {
      const character = segment.segment;
      const columns = displayWidth(character === '\t' ? '  ' : character);
      if (character !== '\n' && column + columns > contentWidth) {
        lines.push(' '.repeat(prefixWidth));
        row += 1;
        column = 0;
      }
      if (segment.index === this.cursor) {
        cursorRow = row;
        cursorColumn = prefixWidth + column;
      }
      if (character === '\n') {
        lines.push(' '.repeat(prefixWidth));
        row += 1;
        column = 0;
      } else {
        lines[row] += character === '\t' ? '  ' : character;
        column += columns;
      }
    }
    if (confirmingExit || this.cursor === this.text.length) {
      cursorRow = row;
      cursorColumn = prefixWidth + column;
    }
    const choices = this.suggestions();
    const menuStart = Math.max(0, this.selected - 3);
    const extras = confirmingExit ? [] : this.options.picker() ? this.options.rows() : choices.slice(menuStart, menuStart + 4).map((choice, index) => {
      const active = menuStart + index === this.selected;
      return paint(truncate(`${active ? '›' : ' '} ${choice.text.trim()}  ${choice.description}`, width), { bold: active }, this.options.mode);
    });
    const status = this.options.status();
    const hint = confirmingExit ? this.options.hint() : choices.length ? '↑↓ choose · Tab/Enter fill · Esc dismiss' : this.options.picker() ? '' : this.options.hint();
    const height = Math.max(1, (this.options.output.rows ?? 24) - 1);
    const footer = status && height > 3 ? [muted(truncate(status, width), this.options.mode)] : [];
    if (hint && height > 4) footer.push(muted(truncate(hint, width), this.options.mode));
    const rules = this.options.frame && height >= 3 ? 2 : 0;
    const detail = height >= 14 ? this.options.detail?.() : undefined;
    const detailRows = detail ? 1 : 0;
    const extraRows = extras.slice(0, Math.max(0, height - footer.length - 1 - rules - detailRows - (this.options.frame ? 2 : 0))).map(line => truncate(line, width));
    const maxDraftRows = Math.max(1, Math.min(Math.floor(height / 3), height - extraRows.length - footer.length - rules - detailRows));
    const startRow = Math.max(0, cursorRow - maxDraftRows + 1);
    const visible = lines.slice(startRow, startRow + maxDraftRows);
    cursorRow -= startRow;
    const hiddenBefore = startRow > 0;
    const hiddenAfter = startRow + visible.length < lines.length;
    if (hiddenBefore || hiddenAfter) {
      const indicator = hiddenBefore && hiddenAfter ? '↕' : hiddenBefore ? '↑' : '↓';
      const content = visible[0].slice(startRow === 0 ? prompt.length : prefixWidth);
      visible[0] = muted(indicator, this.options.mode) + ' '.repeat(Math.max(0, prefixWidth - 1)) + content;
    }
    if (this.options.frame) {
      const rule = muted('─'.repeat(width), this.options.mode);
      if (rules) {
        visible.unshift(rule);
        cursorRow += 1;
      }
      if (detail) {
        const metadata = truncate(detail, width);
        visible.unshift(muted(`${' '.repeat(Math.max(0, width - displayWidth(metadata)))}${metadata}`, this.options.mode));
        cursorRow += 1;
      }
      if (rules) visible.push(rule);
      const remaining = Math.max(0, height - visible.length - extraRows.length - footer.length);
      const frame = this.options.frame(remaining, width).slice(0, remaining).map(line => truncate(line, width));
      while (frame.length < remaining) frame.push('');
      visible.unshift(...frame);
      cursorRow += frame.length;
    }
    visible.push(...extraRows, ...footer);
    const body = visible.map(line => `${ANSI.clearLine}${line}`).join('\r\n');
    this.options.output.write(`${body}${ANSI.clearBelow}${ANSI.up(visible.length - 1 - cursorRow)}\r${ANSI.right(cursorColumn)}${ANSI.showCursor}`);
    this.cursorRow = cursorRow;
    this.drawn = true;
  }
}
