import { expect, it } from 'vitest';
import { claudeLimitWarning, claudeRejection, detectUsageLimit, formatResetTime, usageLimitMessage } from '../../apps/desktop/src/core/usageLimits';
import { HarnessError, parseClaudeOutput, parseCodexOutput } from '../../apps/desktop/src/core/harness/exec';
import { CodexStreamParser } from '../../apps/desktop/src/core/harness/codexStream';
import { translateMessage } from '../../apps/desktop/src/shared/i18n';
import { en } from '../../apps/desktop/src/shared/locales/en';
import type { HarnessProgress } from '../../apps/desktop/src/shared/progress';

it('recognizes plan, credit and rate limit errors from each provider', () => {
  expect(detectUsageLimit("You've hit your usage limit. Upgrade to Pro or try again at 5:04 PM.")).toMatchObject({ kind: 'quota' });
  expect(detectUsageLimit('Claude AI usage limit reached|1789667400')).toEqual({ kind: 'quota', resetsAt: new Date(1789667400 * 1000) });
  expect(detectUsageLimit('429 You exceeded your current quota, please check your plan and billing details.')).toMatchObject({ kind: 'quota' });
  expect(detectUsageLimit('Your credit balance is too low to access the Anthropic API.')).toMatchObject({ kind: 'quota' });
  expect(detectUsageLimit('429 {"type":"error","error":{"type":"rate_limit_error"}}')).toMatchObject({ kind: 'rate' });
  expect(detectUsageLimit('Invalid schema for response_format')).toBeNull();
});

it('reads a clock reset time from the message', () => {
  const limit = detectUsageLimit("You've hit your usage limit. Try again at 5:04 PM.")!;
  expect(limit.resetsAt!.getHours()).toBe(17);
  expect(limit.resetsAt!.getMinutes()).toBe(4);
  expect(limit.resetsAt!.getTime()).toBeGreaterThan(Date.now());
});

it('tells the user when Claude Code refuses a run because the plan is used up', () => {
  const rejected = { status: 'rejected', resetsAt: 1789667400, rateLimitType: 'five_hour' };
  const result = JSON.stringify({ type: 'result', is_error: true, result: 'API Error: request rejected' });
  expect(() => parseClaudeOutput(result, rejected)).toThrow(HarnessError);
  expect(() => parseClaudeOutput(result, rejected)).toThrow(`Claude Code đã hết lượt dùng của gói, làm mới lúc ${formatResetTime(new Date(1789667400 * 1000))}.`);
  expect(claudeRejection({ status: 'allowed' })).toBeNull();
});

it('warns when Claude Code says the plan is almost used up, without failing the run', () => {
  const warning = { status: 'allowed_warning', resetsAt: 1789783200, rateLimitType: 'seven_day', utilization: 0.99 };
  const result = JSON.stringify({ type: 'result', is_error: false, structured_output: { message: 'Hi', title: null }, total_cost_usd: 0.01 });
  const parsed = parseClaudeOutput(result, warning);
  expect(parsed.output).toEqual({ message: 'Hi', title: null });
  expect(parsed.notice).toBe(`Gói Claude Code đã dùng 99% hạn mức 7 ngày, làm mới lúc ${formatResetTime(new Date(1789783200 * 1000))}.`);
  expect(claudeLimitWarning({ status: 'allowed', utilization: 0.2 })).toBeNull();
});

it('tells the user when Codex is out of usage', () => {
  const jsonl = [
    JSON.stringify({ type: 'thread.started' }),
    JSON.stringify({ type: 'error', message: "You've hit your usage limit. Visit chatgpt.com/codex/settings/usage to purchase more credits or try again at 9:15 AM." }),
    JSON.stringify({ type: 'turn.failed', error: { message: 'usage limit' } }),
  ].join('\n');
  expect(() => parseCodexOutput(jsonl, null)).toThrow(/^Codex đã hết lượt dùng của gói, làm mới lúc /);
});

it('translates the limit messages into English', () => {
  const english = translateMessage(en, usageLimitMessage('Codex', { kind: 'quota', resetsAt: null }));
  expect(english).toBe('Codex has run out of plan usage or credits. Wait for the plan to reset or add credits, or pick another model for this orglet from its Edit menu.');
  expect(translateMessage(en, usageLimitMessage('OpenAI', { kind: 'rate', resetsAt: null }))).toBe('OpenAI is limiting requests because too many were sent. Try again in a few minutes.');
});

it('shows Codex reasoning while it works and its answer once the message is complete', () => {
  const updates: HarnessProgress[] = [];
  const parser = new CodexStreamParser(progress => updates.push(progress));
  parser.push(JSON.stringify({ type: 'turn.started' }) + '\n');
  parser.push(JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', summary: [{ text: 'Checking the payment terms.' }] } }) + '\n');
  parser.push(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{"message":"Payment is due in 45 days.","title":null,"report":null}' } }) + '\n');
  const output = parser.finish();

  expect(updates[0]).toMatchObject({ thinking: 'Checking the payment terms.', writing: false });
  expect(updates.at(-1)).toMatchObject({ writing: true, answer: 'Payment is due in 45 days.' });
  expect(output.split('\n').filter(Boolean)).toHaveLength(3);
});
