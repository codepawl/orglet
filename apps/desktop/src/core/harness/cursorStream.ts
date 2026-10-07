import { emptyProgress, type ActivityKind, type HarnessProgress } from '../../shared/progress';
import { partialStringField } from './claudeStream';

type CursorToolCall = Record<string, { args?: { path?: string; pattern?: string; query?: string; globPattern?: string } } | undefined>;

type StreamLine = {
  type?: string;
  subtype?: string;
  text?: string;
  call_id?: string;
  tool_call?: CursorToolCall;
  timestamp_ms?: number;
  message?: { content?: { type?: string; text?: string }[] };
};

/** A path's last part whichever separator it uses: Cursor reports Windows paths, and CI may read them on Linux. */
const fileName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** Which of the chat's step words a Cursor tool call reads as; its own names end in `ToolCall`. */
function stepOf(toolCall: CursorToolCall | undefined): { kind: ActivityKind; target: string } {
  const [name, call] = Object.entries(toolCall ?? {}).find(([key]) => key.endsWith('ToolCall')) ?? ['', undefined];
  const args = call?.args ?? {};
  if (/^read/i.test(name)) return { kind: 'read', target: args.path ? fileName(args.path) : '' };
  if (/^(grep|glob|search|semSearch|codebaseSearch)/i.test(name)) return { kind: 'search', target: args.pattern ?? args.query ?? args.globPattern ?? '' };
  if (/^(ls|list)/i.test(name)) return { kind: 'list', target: args.path ? fileName(args.path) : '' };
  return { kind: 'other', target: name.replace(/ToolCall$/, '') };
}

/**
 * Reads `agent -p --output-format stream-json --stream-partial-output` line by line (Cursor Agent, measured
 * 2026-10-07): `thinking` deltas become the worker's notes, `tool_call` started and completed become steps, and the
 * answer is read out of the streamed text as it is written. The final `result` line has the shape of
 * `--output-format json`, so the existing parser reads it. Assistant lines with a `timestamp_ms` are deltas; the last
 * one without it repeats the whole message and replaces what was gathered.
 */
export class CursorStreamParser {
  private buffer = '';
  private progress = emptyProgress();
  private assistantText = '';
  private thinkingOpen = false;
  private resultLine: string | null = null;
  private lastJsonLine: string | null = null;
  /** Lines that are not JSON, such as a sign-in error, so the caller still reads why the run stopped. */
  private plainText = '';

  constructor(private readonly onProgress: (progress: HarnessProgress) => void = () => {}) {}

  push(chunk: string) {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      this.readLine(this.buffer.slice(0, newline));
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf('\n');
    }
  }

  /** Reads whatever is left and returns the `result` line, or the last JSON line a CLI without a stream printed. */
  finish(): string {
    if (this.buffer.trim()) this.readLine(this.buffer);
    this.buffer = '';
    return this.resultLine ?? this.lastJsonLine ?? this.plainText;
  }

  private readLine(rawLine: string) {
    const line = rawLine.trim();
    if (!line) return;
    let parsed: StreamLine;
    try {
      parsed = JSON.parse(line);
    } catch {
      if (this.plainText.length < 4000) this.plainText += `${line}\n`;
      return;
    }
    this.lastJsonLine = line;
    if (parsed.type === 'result') {
      this.resultLine = line;
      return;
    }
    if (parsed.type === 'thinking') {
      this.readThinking(parsed);
      return;
    }
    if (parsed.type === 'tool_call') {
      this.readToolCall(parsed);
      return;
    }
    if (parsed.type === 'assistant') this.readAssistant(parsed);
  }

  private readThinking(parsed: StreamLine) {
    if (parsed.subtype === 'completed') {
      this.thinkingOpen = false;
      return;
    }
    if (parsed.subtype !== 'delta' || !parsed.text) return;
    if (!this.thinkingOpen && this.progress.thinking) this.progress.thinking += '\n\n';
    this.thinkingOpen = true;
    this.progress.thinking += parsed.text;
    this.emit();
  }

  private readToolCall(parsed: StreamLine) {
    const id = parsed.call_id ?? `tool-${this.progress.activity.length}`;
    const existing = this.progress.activity.find(step => step.id === id);
    if (parsed.subtype === 'started' && !existing) {
      this.progress.activity.push({ id, ...stepOf(parsed.tool_call), done: false });
      this.emit();
      return;
    }
    if (parsed.subtype === 'completed' && existing && !existing.done) {
      existing.done = true;
      this.emit();
    }
  }

  private readAssistant(parsed: StreamLine) {
    const text = (parsed.message?.content ?? []).map(part => part.type === 'text' ? part.text ?? '' : '').join('');
    if (!text) return;
    this.assistantText = parsed.timestamp_ms === undefined ? text : this.assistantText + text;
    // The answer is a JSON object (a reply call, or a report); its `message` streams in as the person's text.
    const start = this.assistantText.indexOf('{');
    if (start === -1) return;
    if (!this.progress.writing) {
      this.progress.writing = true;
      this.emit();
    }
    const message = partialStringField(this.assistantText.slice(start), 'message');
    if (message !== null && message !== this.progress.answer) {
      this.progress.answer = message;
      this.emit();
    }
  }

  private emit() {
    this.onProgress({ ...this.progress, activity: this.progress.activity.map(step => ({ ...step })) });
  }
}
