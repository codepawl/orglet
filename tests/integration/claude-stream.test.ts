import { afterEach, expect, it, vi } from 'vitest';
import { ClaudeStreamParser, partialStringField } from '../../apps/desktop/src/core/harness/claudeStream';
import { parseClaudeOutput } from '../../apps/desktop/src/core/harness/exec';
import { ProgressSender } from '../../apps/desktop/src/core/orchestration/progress';
import type { HarnessProgress, RunProgressUpdate } from '../../apps/desktop/src/shared/progress';

afterEach(() => {
  vi.useRealTimers();
});

function streamEvent(event: object) {
  return JSON.stringify({ type: 'stream_event', event }) + '\n';
}

/** A shortened Claude Code 2.1 stream: thinking, a preamble, one Read, then the StructuredOutput answer. */
function recordedStream() {
  const lines = [
    JSON.stringify({ type: 'system', subtype: 'init' }) + '\n',
    streamEvent({ type: 'message_start' }),
    streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
    streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'The user wants ' } }),
    streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'a summary.' } }),
    streamEvent({ type: 'content_block_stop', index: 0 }),
    streamEvent({ type: 'content_block_start', index: 1, content_block: { type: 'text' } }),
    streamEvent({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: "I'll read the contract first." } }),
    streamEvent({ type: 'content_block_stop', index: 1 }),
    streamEvent({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_read', name: 'Read' } }),
    streamEvent({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"file_path": "C:\\\\Temp\\\\orglet-harness-x\\\\sources\\\\01-con' } }),
    streamEvent({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: 'tract.md"}' } }),
    streamEvent({ type: 'content_block_stop', index: 2 }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_read', content: '...' }] } }) + '\n',
    streamEvent({ type: 'message_start' }),
    streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_answer', name: 'StructuredOutput' } }),
    streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"message": "Payment is due' } }),
    streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ' in **30 days**.\\nLate fees' } }),
    streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ' apply.", "title": "Contract terms"}' } }),
    streamEvent({ type: 'content_block_stop', index: 0 }),
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: { message: 'Payment is due in **30 days**.\nLate fees apply.', title: 'Contract terms' }, total_cost_usd: 0.03 }) + '\n',
  ];
  return lines.join('');
}

it('turns a Claude Code stream into live progress and keeps the final result', () => {
  const updates: HarnessProgress[] = [];
  const parser = new ClaudeStreamParser(progress => updates.push(progress));

  // Chunks split in the middle of lines, the way a pipe delivers them.
  const stream = recordedStream();
  for (let position = 0; position < stream.length; position += 37) parser.push(stream.slice(position, position + 37));
  const result = parseClaudeOutput(parser.finish());

  expect(result).toEqual({ output: { message: 'Payment is due in **30 days**.\nLate fees apply.', title: 'Contract terms' }, costUsd: 0.03 });

  const readStarted = updates.find(update => update.activity.length === 1 && !update.activity[0].done && update.activity[0].target === 'contract.md');
  expect(readStarted).toBeDefined();

  const last = updates.at(-1)!;
  expect(last.thinking).toBe('The user wants a summary.');
  expect(last.preamble).toBe("I'll read the contract first.");
  expect(last.activity).toEqual([{ id: 'toolu_read', kind: 'read', target: 'contract.md', done: true }]);
  expect(last.writing).toBe(true);
  expect(last.answer).toBe('Payment is due in **30 days**.\nLate fees apply.');

  // The answer grows piece by piece rather than arriving at the end.
  const answers = [...new Set(updates.map(update => update.answer).filter(Boolean))];
  expect(answers).toEqual(['Payment is due', 'Payment is due in **30 days**.\nLate fees', 'Payment is due in **30 days**.\nLate fees apply.']);
});

it('still accepts a CLI that prints one JSON object instead of a stream', () => {
  const parser = new ClaudeStreamParser();
  parser.push(JSON.stringify({ is_error: false, structured_output: { title: 'x' }, total_cost_usd: 0.01 }));
  expect(parseClaudeOutput(parser.finish())).toEqual({ output: { title: 'x' }, costUsd: 0.01 });
});

it('decodes a string field from JSON that is still arriving', () => {
  expect(partialStringField('{"title": "x", "mess', 'message')).toBeNull();
  expect(partialStringField('{"message": "', 'message')).toBe('');
  expect(partialStringField('{"message": "Line one\\nQuote \\"two\\" caf\\u00e9', 'message')).toBe('Line one\nQuote "two" café');
  // An escape cut in half is left out until the rest arrives.
  expect(partialStringField('{"message": "Tab\\', 'message')).toBe('Tab');
  expect(partialStringField('{"message": "caf\\u00', 'message')).toBe('caf');
});

it('sends the first update at once, the newest one later, and a final null on close', () => {
  vi.useFakeTimers();
  const sent: RunProgressUpdate[] = [];
  const sender = new ProgressSender('task', 'run', update => sent.push(update));
  const progress = (answer: string): HarnessProgress => ({ thinking: '', preamble: '', activity: [], answer, writing: true });

  sender.update(progress('a'));
  sender.update(progress('ab'));
  sender.update(progress('abc'));
  expect(sent.map(update => update.progress?.answer)).toEqual(['a']);

  vi.advanceTimersByTime(200);
  expect(sent.map(update => update.progress?.answer)).toEqual(['a', 'abc']);

  sender.close();
  sender.update(progress('ignored'));
  vi.advanceTimersByTime(200);
  expect(sent.map(update => update.progress?.answer ?? null)).toEqual(['a', 'abc', null]);
});
