import { describe, expect, it } from 'vitest';
import { claudeLimitWarning, claudeRejection, detectUsageLimit, formatResetTime, type ClaudeRateLimitInfo } from '../../apps/desktop/src/core/usageLimits';
import { HarnessError, HarnessLimitError, parseClaudeOutput, parseCodexOutput } from '../../apps/desktop/src/core/harness/exec';

/**
 * What the CLIs really print when they refuse or fail (COD-301). Only a used-up plan may read as "ran out": the island
 * then offers another account. Sources: Claude Code 2.1.280's own strings and its `rate_limit_info` schema (read from
 * its build), codex-cli 0.157.0's `UsageLimitReachedError` and exec JSONL (codex-rs/protocol/src/error.rs,
 * codex-rs/exec/src/event_processor_with_jsonl_output.rs, codex-rs/core/src/responses_retry.rs).
 */
const planLimits = {
  codexPro: 'You’ve hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 9:15 AM.',
  codexPlus: 'You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 4:02 PM.',
  codexEnterprise: 'You’ve hit your usage limit. Try again later.',
  codexWorkspaceCredits: 'Your workspace is out of credits. Add credits to continue.',
  codexSpendCap: 'You hit your spend cap set in your workspace. Increase your spend cap to continue.',
  codexQuota: 'Quota exceeded. Check your plan and billing details.',
  claudeSession: "You've hit your session limit · resets 3pm (Asia/Saigon)",
  claudeWeekly: "You've hit your weekly limit · resets Oct 2, 9am (Asia/Saigon)",
  claudeGeneric: "You've hit your usage limit",
  claudeCredits: "You're out of usage credits · resets Oct 1, 7am (Asia/Saigon)",
  claudeOlder: 'Claude AI usage limit reached|1789667400',
};

const modelLimits = {
  codexSpark: 'You’ve hit your usage limit for GPT-5.3-Codex-Spark. Switch to another model now, or try again at 5:04 PM.',
  claudeOpus: "You've hit your Opus limit · resets Oct 2, 9am (Asia/Saigon)",
  claudeFable: "You've hit your Fable limit · resets Oct 2, 9am (Asia/Saigon)",
};

const notPlanLimits = {
  claudeServerThrottle: 'Server is temporarily limiting requests (not your usage limit)',
  claudeOverloaded: 'API Error: Repeated 529 Overloaded errors',
  claudeHighLoad: 'Opus is experiencing high load, please use /model to switch to Sonnet',
  claudeTimeout: 'Request timed out',
  claudeNetwork: 'API Error: Connection error.',
  claudeContext: 'Context limit reached · /compact or /clear to continue',
  claudeNesting: 'Subagent nesting limit reached (depth 3 of 3). Complete this task directly using your tools instead of spawning another agent.',
  claudeResumeHint: 'Resuming the full session will consume a substantial portion of your usage limits. We recommend resuming from a summary.',
  claudeLogin: 'Not logged in · Please run /login',
  codexRetries: 'exceeded retry limit, last status: 429 Too Many Requests, request id: req_123',
  codexCapacity: 'Selected model is at capacity. Please try a different model.',
  codexDemand: 'We’re currently experiencing high demand, which may cause temporary errors.',
  codexStream: 'stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)',
  codexNotIncluded: 'To use Codex with your ChatGPT plan, upgrade to Plus: https://chatgpt.com/explore/plus.',
};

describe('what counts as a used-up plan', () => {
  it('reads every plan and credit refusal the CLIs print as quota', () => {
    for (const [name, text] of Object.entries(planLimits)) {
      expect(detectUsageLimit(text), name).toEqual(expect.objectContaining({ kind: 'quota' }));
    }
  });

  it('reads a limit on one model as that model, not the plan', () => {
    expect(detectUsageLimit(modelLimits.codexSpark)).toEqual(expect.objectContaining({ kind: 'model', model: 'GPT-5.3-Codex-Spark' }));
    expect(detectUsageLimit(modelLimits.claudeOpus)).toEqual(expect.objectContaining({ kind: 'model', model: 'Opus' }));
    expect(detectUsageLimit(modelLimits.claudeFable)).toEqual(expect.objectContaining({ kind: 'model', model: 'Fable' }));
  });

  it('never reads throttling, overload, network, context, sign-in or retry errors as a used-up plan', () => {
    for (const [name, text] of Object.entries(notPlanLimits)) {
      expect(detectUsageLimit(text)?.kind, name).not.toBe('quota');
      expect(detectUsageLimit(text)?.kind, name).not.toBe('model');
    }
    // The throttling Claude Code says is not the plan, and Codex's spent retries, are short waits.
    expect(detectUsageLimit(notPlanLimits.claudeServerThrottle)).toEqual({ kind: 'rate', resetsAt: null });
    expect(detectUsageLimit(notPlanLimits.codexRetries)?.kind).toBe('rate');
  });

  it('takes the reset time the provider wrote, in each of its forms', () => {
    expect(detectUsageLimit('You’ve hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Oct 4th, 2026 9:15 AM.')?.resetsAt)
      .toEqual(new Date(2026, 9, 4, 9, 15));
    expect(detectUsageLimit(planLimits.codexEnterprise)?.resetsAt).toBeNull();
    expect(detectUsageLimit(planLimits.claudeOlder)?.resetsAt).toEqual(new Date(1789667400 * 1000));
    const clock = detectUsageLimit(planLimits.claudeSession)!.resetsAt!;
    expect([clock.getHours(), clock.getMinutes()]).toEqual([15, 0]);
  });
});

/** `rate_limit_info` objects use the fields Claude Code 2.1.280's schema allows. */
describe('Claude Code refusals from its own stream', () => {
  const failed = JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: "You've hit your session limit · resets 3pm (Asia/Saigon)", total_cost_usd: 0 });

  it('marks a refused plan window as the plan, with the reset time Claude Code reported', () => {
    const rejected: ClaudeRateLimitInfo = { status: 'rejected', resetsAt: 1790571600, rateLimitType: 'five_hour', overageStatus: 'rejected' };
    expect(claudeRejection(rejected)).toEqual({ kind: 'quota', resetsAt: new Date(1790571600 * 1000) });
    let thrown: unknown;
    try { parseClaudeOutput(failed, rejected); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(HarnessLimitError);
    expect((thrown as HarnessLimitError).limit).toEqual({ kind: 'quota', resetsAt: new Date(1790571600 * 1000) });
  });

  it('marks a refused model window as that model, so the plan is not reported as out', () => {
    expect(claudeRejection({ status: 'rejected', resetsAt: 1790830800, rateLimitType: 'seven_day_opus' })).toEqual({ kind: 'model', model: 'Opus', resetsAt: new Date(1790830800 * 1000) });
    expect(claudeRejection({ status: 'rejected', resetsAt: 1790830800, rateLimitType: 'seven_day_sonnet' })?.model).toBe('Sonnet');
    expect(claudeRejection({ status: 'rejected', resetsAt: 1790830800, rateLimitType: 'seven_day_overage_included' })).toEqual({ kind: 'model', resetsAt: new Date(1790830800 * 1000) });
    const failedOnOpus = JSON.stringify({ type: 'result', is_error: true, result: modelLimits.claudeOpus });
    expect(() => parseClaudeOutput(failedOnOpus, { status: 'rejected', resetsAt: 1790830800, rateLimitType: 'seven_day_opus' })).toThrow(/hết hạn mức riêng của model Opus/);
  });

  it('takes the credits reset time when the extra usage itself ran out', () => {
    expect(claudeRejection({ status: 'rejected', rateLimitType: 'overage', resetsAt: 1790000000, overageResetsAt: 1791000000, overageStatus: 'rejected' }))
      .toEqual({ kind: 'quota', resetsAt: new Date(1791000000 * 1000) });
  });

  it('does not count a window that extra usage carries past, nor one that was never refused', () => {
    expect(claudeRejection({ status: 'rejected', rateLimitType: 'five_hour', isUsingOverage: true, overageStatus: 'allowed' })).toBeNull();
    expect(claudeRejection({ status: 'rejected', rateLimitType: 'five_hour', overageStatus: 'allowed_warning' })).toBeNull();
    expect(claudeRejection({ status: 'allowed', resetsAt: 1790571600, rateLimitType: 'five_hour' })).toBeNull();
    const networkDrop = JSON.stringify({ type: 'result', is_error: true, result: 'API Error: Connection error.' });
    let thrown: unknown;
    try { parseClaudeOutput(networkDrop, { status: 'rejected', rateLimitType: 'five_hour', isUsingOverage: true }); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(HarnessError);
    expect(thrown).not.toBeInstanceOf(HarnessLimitError);
  });

  it('reads the server throttling as a short wait and a dropped connection as neither a limit nor a sign-in', () => {
    const throttled = JSON.stringify({ type: 'result', is_error: true, result: notPlanLimits.claudeServerThrottle });
    let thrown: unknown;
    try { parseClaudeOutput(throttled, { status: 'allowed', rateLimitType: 'five_hour' }); } catch (error) { thrown = error; }
    expect((thrown as HarnessLimitError).limit.kind).toBe('rate');
    const dropped = JSON.stringify({ type: 'result', is_error: true, result: 'Authentication error · This may be a temporary network issue, please try again' });
    expect(() => parseClaudeOutput(dropped)).toThrow(/Claude Code báo lỗi: Authentication error/);
  });

  it('treats a plan near its weekly limit as a notice on a run that worked, never as out', () => {
    // Recorded from Claude Code 2.1.281 on a Max 20x plan on 2026-09-27, a normal `-p --output-format stream-json` run.
    const nearLimit = JSON.parse('{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1790654400,"rateLimitType":"seven_day","utilization":0.98,"isUsingOverage":false,"surpassedThreshold":0.75,"unifiedWindows":{"five_hour":{"utilization":0,"resetsAt":1790492400},"seven_day":{"utilization":0.98,"resetsAt":1790654400}}}}').rate_limit_info as ClaudeRateLimitInfo;
    expect(claudeRejection(nearLimit)).toBeNull();
    const answered = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', structured_output: { message: 'ok' }, total_cost_usd: 0.0164 });
    const parsed = parseClaudeOutput(answered, nearLimit);
    expect(parsed.output).toEqual({ message: 'ok' });
    expect(parsed.notice).toBe(`Gói Claude Code đã dùng 98% hạn mức 7 ngày, làm mới lúc ${formatResetTime(new Date(1790654400 * 1000))}.`);
  });

  it('names the model in a near-limit notice for a weekly allowance of one model', () => {
    expect(claudeLimitWarning({ status: 'allowed_warning', utilization: 0.91, resetsAt: 1790830800, rateLimitType: 'seven_day_opus' }))
      .toBe(`Gói Claude Code đã dùng 91% hạn mức 7 ngày của Opus, làm mới lúc ${formatResetTime(new Date(1790830800 * 1000))}.`);
  });
});

describe('Codex exec output', () => {
  const answer = '{"title":"z"}';

  it('finishes a turn that retried after a dropped stream: the retry notice is not a failure', () => {
    const jsonl = [
      JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'error', message: 'Reconnecting... 2/5 (stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses))' }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: answer } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } }),
    ].join('\n');
    expect(parseCodexOutput(jsonl, answer).output).toEqual({ title: 'z' });
  });

  it('marks a turn that failed on the plan as quota, and one limited to a model as that model', () => {
    const outOfPlan = [
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'error', message: planLimits.codexPro }),
      JSON.stringify({ type: 'turn.failed', error: { message: planLimits.codexPro } }),
    ].join('\n');
    let thrown: unknown;
    try { parseCodexOutput(outOfPlan, null); } catch (error) { thrown = error; }
    expect((thrown as HarnessLimitError).limit.kind).toBe('quota');

    const outOnSpark = [JSON.stringify({ type: 'turn.failed', error: { message: modelLimits.codexSpark } })].join('\n');
    try { parseCodexOutput(outOnSpark, null); } catch (error) { thrown = error; }
    expect((thrown as HarnessLimitError).limit).toEqual(expect.objectContaining({ kind: 'model', model: 'GPT-5.3-Codex-Spark' }));
  });

  it('reads a failed turn with no message from the last error before it', () => {
    const jsonl = [
      JSON.stringify({ type: 'error', message: planLimits.codexEnterprise }),
      JSON.stringify({ type: 'turn.failed', error: { message: '' } }),
    ].join('\n');
    expect(() => parseCodexOutput(jsonl, null)).toThrow(HarnessLimitError);
  });

  it('does not mistake the model writing about authentication for a sign-in problem', () => {
    const jsonl = [
      JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'The authentication module needs a review.' } }),
      JSON.stringify({ type: 'turn.failed', error: { message: notPlanLimits.codexCapacity } }),
    ].join('\n');
    expect(() => parseCodexOutput(jsonl, null)).toThrow('Codex báo lỗi: Selected model is at capacity');
  });
});
