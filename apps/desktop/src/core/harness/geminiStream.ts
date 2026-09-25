import { partialStringField } from './claudeStream';
import { emptyProgress, type HarnessProgress } from '../../shared/progress';

/** Token counts from the `stats` of Gemini CLI's closing `result` event. */
export type GeminiTokens = { input: number; output: number };

/** The closing `result` event: `status` says whether the run worked, `error` why not. */
export type GeminiResultEvent = {
  status?: string;
  error?: { type?: string; message?: string };
  stats?: { input_tokens?: unknown; output_tokens?: unknown };
};

/** What one run printed: the answer text, the closing result when there was one, and the errors it reported. */
export type GeminiStreamOutcome = {
  text: string;
  result: GeminiResultEvent | null;
  errors: string[];
};

type StreamEvent = {
  type?: string;
  role?: string;
  content?: unknown;
  delta?: boolean;
  tool_name?: unknown;
  message?: unknown;
  severity?: unknown;
} & GeminiResultEvent;

/**
 * Reads `gemini --output-format stream-json` line by line. Its events are init, message (user and assistant, the
 * assistant's in delta chunks), tool_use, tool_result, error and one closing result carrying the token counts. The
 * CLI does not stream its thinking, so progress shows the answer's message field as it is written.
 *
 * A tool_use event means the CLI offered the model a tool of its own, which the lockdown is there to prevent. The
 * parser reports it through `onNativeTool` so the run can be stopped before the CLI acts on it.
 */
export class GeminiStreamParser {
  private buffer = '';
  private answerText = '';
  private result: GeminiResultEvent | null = null;
  private errors: string[] = [];
  private progress = emptyProgress();

  constructor(
    private readonly onProgress: (progress: HarnessProgress) => void = () => {},
    private readonly onNativeTool: (toolName: string) => void = () => {},
  ) {}

  push(chunk: string) {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      this.readLine(this.buffer.slice(0, newline));
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf('\n');
    }
  }

  /** Reads what is left and returns everything the final parse needs. */
  finish(): GeminiStreamOutcome {
    if (this.buffer.trim()) this.readLine(this.buffer);
    this.buffer = '';
    return { text: this.answerText, result: this.result, errors: [...this.errors] };
  }

  private readLine(rawLine: string) {
    const line = rawLine.trim();
    if (!line) return;
    let event: StreamEvent;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.type === 'message') this.readMessage(event);
    else if (event.type === 'tool_use') this.onNativeTool(typeof event.tool_name === 'string' ? event.tool_name : 'unknown');
    else if (event.type === 'error' && typeof event.message === 'string') this.errors.push(event.message);
    else if (event.type === 'result') this.result = event;
  }

  private readMessage(event: StreamEvent) {
    if (event.role !== 'assistant' || typeof event.content !== 'string') return;
    // Chunks carry `delta: true`; a whole message replaces what came before.
    this.answerText = event.delta ? this.answerText + event.content : event.content;
    this.progress.writing = true;
    this.progress.answer = partialStringField(this.answerText, 'message') ?? '';
    this.onProgress({ ...this.progress, activity: [] });
  }
}

/** The token counts of a finished run, or undefined when the CLI reported none. */
export function geminiTokens(result: GeminiResultEvent | null): GeminiTokens | undefined {
  const input = result?.stats?.input_tokens;
  const output = result?.stats?.output_tokens;
  if (typeof input !== 'number' || typeof output !== 'number') return undefined;
  return { input, output };
}
