import { expect, it } from 'vitest';
import { CursorStreamParser } from '../../apps/desktop/src/core/harness/cursorStream';
import { parseCursorOutput } from '../../apps/desktop/src/core/harness/exec';
import type { HarnessProgress } from '../../apps/desktop/src/shared/progress';

// The lines `agent -p --output-format stream-json --stream-partial-output` printed on Windows (2026-10-07), paths shortened.
const measured = [
  { type: 'system', subtype: 'init', apiKeySource: 'login', cwd: String.raw`C:\task`,session_id: 's' },
  { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Read notes.txt…' }] }, session_id: 's' },
  { type: 'thinking', subtype: 'delta', text: 'Reading notes.txt to', session_id: 's', timestamp_ms: 1 },
  { type: 'thinking', subtype: 'delta', text: ' determine Q1-to-Q2 growth.', session_id: 's', timestamp_ms: 2 },
  { type: 'thinking', subtype: 'completed', session_id: 's', timestamp_ms: 3 },
  { type: 'tool_call', subtype: 'started', call_id: 'call-1', tool_call: { readToolCall: { args: { path: String.raw`C:\task\notes.txt` } } } },
  { type: 'tool_call', subtype: 'completed', call_id: 'call-1', tool_call: { readToolCall: { args: { path: String.raw`C:\task\notes.txt` } } } },
  { type: 'thinking', subtype: 'delta', text: 'Growth is 15%.', session_id: 's', timestamp_ms: 4 },
  { type: 'thinking', subtype: 'completed', session_id: 's', timestamp_ms: 5 },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Checking the figures.{"call":{"name":"reply","arguments":{"message":"Revenue grew' }] }, session_id: 's', timestamp_ms: 6 },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: ' 15%."}}}' }] }, session_id: 's', timestamp_ms: 7 },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Checking the figures.{"call":{"name":"reply","arguments":{"message":"Revenue grew 15%."}}}' }] }, session_id: 's' },
  { type: 'result', subtype: 'success', is_error: false, result: 'Checking the figures.{"call":{"name":"reply","arguments":{"message":"Revenue grew 15%."}}}', session_id: 's' },
].map(line => JSON.stringify(line)).join('\n') + '\n';

it('shows Cursor Agent thinking, its steps and the answer as they stream, and keeps its result line', () => {
  const seen: HarnessProgress[] = [];
  const parser = new CursorStreamParser(progress => seen.push(progress));
  // Chunks split mid-line, as a pipe delivers them.
  for (let index = 0; index < measured.length; index += 97) parser.push(measured.slice(index, index + 97));
  const output = parser.finish();
  const last = seen.at(-1)!;
  expect(last.thinking).toBe('Reading notes.txt to determine Q1-to-Q2 growth.\n\nGrowth is 15%.');
  expect(last.activity).toEqual([{ id: 'call-1', kind: 'read', target: 'notes.txt', done: true }]);
  expect(seen.some(progress => progress.activity[0]?.done === false)).toBe(true);
  expect(seen.some(progress => progress.answer === 'Revenue grew')).toBe(true);
  expect(last.answer).toBe('Revenue grew 15%.');
  expect(last.writing).toBe(true);
  expect(parseCursorOutput(output).output).toEqual({ call: { name: 'reply', arguments: { message: 'Revenue grew 15%.' } } });
});

it('still hands back a plain sign-in error the CLI printed instead of a stream', () => {
  const parser = new CursorStreamParser();
  parser.push("Error: Authentication required. Please run 'agent login' first.\n");
  expect(() => parseCursorOutput(parser.finish())).toThrow(/đăng nhập/);
});

it('gives a long wait a clock on the island, as the same figures in every language', async () => {
  const { islandElapsedLabel, ELAPSED_AFTER_SECONDS } = await import('../../apps/desktop/src/renderer/components/LiveIsland');
  expect(ELAPSED_AFTER_SECONDS).toBe(15);
  expect(islandElapsedLabel(42)).toBe('42s');
  expect(islandElapsedLabel(65)).toBe('1:05');
  expect(islandElapsedLabel(600)).toBe('10:00');
});

it('tells a tool-loop step choosing a tool apart from the answer being written', async () => {
  const { structuredOutputShape } = await import('../../apps/desktop/src/shared/progress');
  const { applyOutputShape } = await import('../../apps/desktop/src/core/harness/claudeStream');
  const { emptyProgress } = await import('../../apps/desktop/src/shared/progress');
  expect(structuredOutputShape('{"')).toBeUndefined();
  expect(structuredOutputShape('{"call":{"name":"read_source","argu')).toEqual({ kind: 'call', name: 'read_source' });
  expect(structuredOutputShape('{"title":"Report')).toEqual({ kind: 'answer' });
  const progress = emptyProgress();
  expect(applyOutputShape(progress, '{"call":{"name":"web_search"')).toBe(true);
  expect(progress).toMatchObject({ writing: false, choosing: 'web_search' });
  expect(applyOutputShape(progress, '{"call":{"name":"reply","arguments":{"message":"Hi')).toBe(true);
  expect(progress.writing).toBe(true);
  expect(progress.choosing).toBeUndefined();
  // Cursor narrates first; once its object picks a tool, the island names the tool, not a reply being written.
  const seen: HarnessProgress[] = [];
  const parser = new CursorStreamParser(update => seen.push(update));
  parser.push(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Let me check.{"call":{"name":"read_source","arguments":{"sourceId":"a"}}}' }] }, timestamp_ms: 1 })}\n`);
  expect(seen.at(-1)).toMatchObject({ writing: false, choosing: 'read_source' });
});
