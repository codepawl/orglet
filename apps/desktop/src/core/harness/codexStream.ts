import { partialStringField } from './claudeStream';
import { emptyProgress, type HarnessProgress } from '../../shared/progress';

type CodexItem = {
  id?: string;
  type?: string;
  text?: string;
  summary?: ({ text?: string } | string)[];
};

type CodexEvent = {
  type?: string;
  item?: CodexItem;
};

/**
 * Reads `codex exec --json` output. Codex reports whole items rather than text as it is typed, so progress moves in
 * steps: its reasoning summaries while it thinks, then the answer once the message is complete. Those summaries only
 * arrive because the run asks for them; see the Codex arguments in exec.ts. The full output is kept, because
 * errors and the final message are read from it after Codex exits.
 */
export class CodexStreamParser {
  private output = '';
  private buffer = '';
  private progress = emptyProgress();

  constructor(private readonly onProgress: (progress: HarnessProgress) => void = () => {}) {}

  push(chunk: string) {
    this.output += chunk;
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      this.readLine(this.buffer.slice(0, newline));
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf('\n');
    }
  }

  /** Reads what is left and returns all output for the final parse. */
  finish(): string {
    if (this.buffer.trim()) this.readLine(this.buffer);
    this.buffer = '';
    return this.output;
  }

  private readLine(rawLine: string) {
    let event: CodexEvent;
    try {
      event = JSON.parse(rawLine);
    } catch {
      return;
    }
    if (event.type !== 'item.started' && event.type !== 'item.completed') return;
    if (!event.item) return;

    if (event.item.type === 'reasoning') {
      const text = reasoningText(event.item);
      if (!text) return;
      this.progress.thinking = this.progress.thinking ? `${this.progress.thinking}\n\n${text}` : text;
      this.emit();
      return;
    }

    if (event.item.type === 'agent_message') {
      this.progress.writing = true;
      this.progress.answer = partialStringField(event.item.text ?? '', 'message') ?? '';
      this.emit();
    }
  }

  private emit() {
    this.onProgress({ ...this.progress, activity: [] });
  }
}

function reasoningText(item: CodexItem): string {
  if (typeof item.text === 'string') return item.text.trim();
  if (!Array.isArray(item.summary)) return '';
  return item.summary
    .map(part => typeof part === 'string' ? part : part.text ?? '')
    .filter(Boolean)
    .join('\n\n')
    .trim();
}
