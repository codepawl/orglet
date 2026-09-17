import { basename } from 'node:path';
import { emptyProgress, type ActivityKind, type HarnessProgress } from '../../shared/progress';
import type { ClaudeRateLimitInfo } from '../usageLimits';

/** The tool Claude Code uses to return output that matches --json-schema. */
const STRUCTURED_OUTPUT_TOOL = 'StructuredOutput';

type OpenBlock =
  | { type: 'thinking' }
  | { type: 'text' }
  | { type: 'answer'; json: string }
  | { type: 'tool'; stepId: string; name: string; json: string }
  | { type: 'ignored' };

type StreamLine = {
  type?: string;
  rate_limit_info?: ClaudeRateLimitInfo;
  event?: {
    type?: string;
    index?: number;
    content_block?: { type?: string; id?: string; name?: string };
    delta?: { type?: string; thinking?: string; text?: string; partial_json?: string };
  };
  message?: { content?: unknown };
};

/**
 * Reads the output of `claude -p --output-format stream-json --verbose --include-partial-messages` line by line.
 * It turns stream events into a HarnessProgress for the window and keeps the final `result` line, which has the same
 * shape as `--output-format json`.
 */
export class ClaudeStreamParser {
  private buffer = '';
  private blocks = new Map<number, OpenBlock>();
  private progress = emptyProgress();
  private resultLine: string | null = null;
  private lastJsonLine: string | null = null;
  private latestRateLimit: ClaudeRateLimitInfo | null = null;

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

  /**
   * Reads whatever is left and returns the final result as JSON text. A CLI that prints a single JSON object instead
   * of a stream (older builds and test doubles) is returned as it is.
   */
  finish(): string {
    if (this.buffer.trim()) this.readLine(this.buffer);
    this.buffer = '';
    return this.resultLine ?? this.lastJsonLine ?? '';
  }

  /** The plan usage Claude Code last reported, if it reported any. */
  get rateLimit(): ClaudeRateLimitInfo | null {
    return this.latestRateLimit;
  }

  private readLine(rawLine: string) {
    const line = rawLine.trim();
    if (!line) return;

    let parsed: StreamLine;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    this.lastJsonLine = line;

    if (parsed.type === 'result') {
      this.resultLine = line;
      return;
    }
    if (parsed.type === 'rate_limit_event' && parsed.rate_limit_info) {
      this.latestRateLimit = parsed.rate_limit_info;
      return;
    }
    if (parsed.type === 'stream_event' && parsed.event) {
      this.readStreamEvent(parsed.event);
      return;
    }
    if (parsed.type === 'user') this.markFinishedTools(parsed.message?.content);
  }

  private readStreamEvent(event: NonNullable<StreamLine['event']>) {
    const index = event.index ?? 0;

    if (event.type === 'message_start') {
      this.blocks.clear();
      return;
    }

    if (event.type === 'content_block_start') {
      this.openBlock(index, event.content_block ?? {});
      return;
    }

    const block = this.blocks.get(index);
    if (!block) return;

    if (event.type === 'content_block_delta' && event.delta) {
      this.readDelta(block, event.delta);
      return;
    }

    if (event.type === 'content_block_stop') {
      if (block.type === 'tool') this.updateStepTarget(block, true);
      this.blocks.delete(index);
    }
  }

  private openBlock(index: number, contentBlock: NonNullable<NonNullable<StreamLine['event']>['content_block']>) {
    if (contentBlock.type === 'thinking') {
      if (this.progress.thinking) this.progress.thinking += '\n\n';
      this.blocks.set(index, { type: 'thinking' });
      return;
    }

    if (contentBlock.type === 'text') {
      if (this.progress.preamble) this.progress.preamble += '\n\n';
      this.blocks.set(index, { type: 'text' });
      return;
    }

    if (contentBlock.type === 'tool_use' && contentBlock.name === STRUCTURED_OUTPUT_TOOL) {
      this.blocks.set(index, { type: 'answer', json: '' });
      this.progress.writing = true;
      this.emit();
      return;
    }

    if (contentBlock.type === 'tool_use') {
      const name = contentBlock.name ?? 'tool';
      const stepId = contentBlock.id ?? `${name}-${this.progress.activity.length}`;
      this.blocks.set(index, { type: 'tool', stepId, name, json: '' });
      this.progress.activity.push({ id: stepId, kind: activityKind(name), target: '', done: false });
      this.emit();
      return;
    }

    this.blocks.set(index, { type: 'ignored' });
  }

  private readDelta(block: OpenBlock, delta: NonNullable<NonNullable<StreamLine['event']>['delta']>) {
    if (block.type === 'thinking' && delta.type === 'thinking_delta' && delta.thinking) {
      this.progress.thinking += delta.thinking;
      this.emit();
      return;
    }

    if (block.type === 'text' && delta.type === 'text_delta' && delta.text) {
      this.progress.preamble += delta.text;
      this.emit();
      return;
    }

    if (delta.type !== 'input_json_delta' || !delta.partial_json) return;

    if (block.type === 'answer') {
      block.json += delta.partial_json;
      const message = partialStringField(block.json, 'message');
      if (message !== null && message !== this.progress.answer) {
        this.progress.answer = message;
        this.emit();
      }
      return;
    }

    if (block.type === 'tool') {
      block.json += delta.partial_json;
      this.updateStepTarget(block, false);
    }
  }

  private updateStepTarget(block: Extract<OpenBlock, { type: 'tool' }>, complete: boolean) {
    const step = this.progress.activity.find(item => item.id === block.stepId);
    if (!step) return;
    const target = stepTarget(block.name, block.json, complete);
    if (target && target !== step.target) {
      step.target = target;
      this.emit();
    }
  }

  private markFinishedTools(content: unknown) {
    if (!Array.isArray(content)) return;
    let changed = false;
    for (const item of content as { type?: string; tool_use_id?: string }[]) {
      if (item.type !== 'tool_result' || !item.tool_use_id) continue;
      const step = this.progress.activity.find(entry => entry.id === item.tool_use_id);
      if (step && !step.done) {
        step.done = true;
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  private emit() {
    this.onProgress({
      ...this.progress,
      activity: this.progress.activity.map(step => ({ ...step })),
    });
  }
}

function activityKind(toolName: string): ActivityKind {
  if (toolName === 'Read') return 'read';
  if (toolName === 'Grep') return 'search';
  if (toolName === 'Glob') return 'list';
  return 'other';
}

/** A short label for a tool step: the source name for reads, the pattern for searches. */
function stepTarget(toolName: string, json: string, complete: boolean): string {
  const field = toolName === 'Read' ? 'file_path' : toolName === 'Grep' || toolName === 'Glob' ? 'pattern' : null;
  if (!field) return toolName;

  // A partial value would flicker through half-typed paths, so wait for the whole string.
  const value = complete ? completeStringField(json, field) : partialCompleteStringField(json, field);
  if (!value) return '';
  if (toolName !== 'Read') return value;
  // Sources are copied as "sources/01-name.ext"; show the original name.
  return basename(value.replace(/\\/g, '/')).replace(/^\d{2}-/, '');
}

function completeStringField(json: string, field: string): string | null {
  try {
    const value = (JSON.parse(json) as Record<string, unknown>)[field];
    return typeof value === 'string' ? value : null;
  } catch {
    return partialCompleteStringField(json, field);
  }
}

/** The field's value only once its closing quote has arrived. */
function partialCompleteStringField(json: string, field: string): string | null {
  const opening = fieldOpening(json, field);
  if (!opening) return null;
  const decoded = decodeJsonString(json, opening.valueStart);
  return decoded.closed ? decoded.value : null;
}

/**
 * Decodes a string field from JSON that may still be arriving, for example `{"message": "Hello wor`. Returns the text
 * so far, or null when the field has not started yet.
 */
export function partialStringField(json: string, field: string): string | null {
  const opening = fieldOpening(json, field);
  if (!opening) return null;
  return decodeJsonString(json, opening.valueStart).value;
}

function fieldOpening(json: string, field: string) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`"${escapedField}"\\s*:\\s*"`).exec(json);
  if (!match) return null;
  return { valueStart: match.index + match[0].length };
}

const simpleEscapes: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

function decodeJsonString(json: string, start: number): { value: string; closed: boolean } {
  let value = '';
  let position = start;

  while (position < json.length) {
    const character = json[position];

    if (character === '"') return { value, closed: true };

    if (character !== '\\') {
      value += character;
      position += 1;
      continue;
    }

    const escaped = json[position + 1];
    if (escaped === undefined) break;

    if (escaped === 'u') {
      const hex = json.slice(position + 2, position + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      value += String.fromCharCode(parseInt(hex, 16));
      position += 6;
      continue;
    }

    value += simpleEscapes[escaped] ?? escaped;
    position += 2;
  }

  return { value, closed: false };
}

