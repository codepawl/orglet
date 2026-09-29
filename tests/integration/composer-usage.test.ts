import { describe, expect, it } from 'vitest';
import { composerUsageFor, composerUsageTone, contextPercent, latestContextUse, usageRingFor } from '../../apps/desktop/src/shared/composer-usage';
import type { Run } from '../../apps/desktop/src/shared/contracts';
import type { ContextManifest } from '../../apps/desktop/src/shared/knowledge';
import { SYSTEM_ACCOUNT_ID, type HarnessAccountUsage, type HarnessInfo, type HarnessUsage, type HarnessUsageWindow } from '../../apps/desktop/src/shared/harness';

const checkedAt = '2026-09-29T08:00:00.000Z';
const sessionReset = '2026-09-29T10:00:00.000Z';
const weekReset = '2026-10-02T09:00:00.000Z';

const harness = (id: HarnessInfo['id'], accountId = SYSTEM_ACCOUNT_ID, accounts: HarnessInfo['accounts'] = []) =>
  ({ id, name: id === 'codex' ? 'Codex' : id === 'claude-code' ? 'Claude Code' : 'Cursor Agent', accountId, accounts }) as HarnessInfo;

const row = (accountId: string, session: number, weekly: number, extra: Partial<HarnessAccountUsage> = {}): HarnessAccountUsage => ({
  accountId,
  checkedAt,
  windows: [{ kind: 'session', usedPercent: session, resetsAt: sessionReset }, { kind: 'weekly', usedPercent: weekly, resetsAt: weekReset }],
  ...extra,
});

describe('the tone of the bar by the message box (COD-326)', () => {
  it('stays quiet under 80%, warns from 80%, and is out at 100%', () => {
    expect(composerUsageTone(0)).toBe('normal');
    expect(composerUsageTone(79.9)).toBe('normal');
    expect(composerUsageTone(80)).toBe('warning');
    expect(composerUsageTone(99.6)).toBe('warning');
    expect(composerUsageTone(100)).toBe('out');
  });
});

describe('what the bar by the message box shows (COD-326)', () => {
  it('shows nothing for Demo, an API connection, or before the numbers arrive', () => {
    const usage: HarnessUsage = { codex: [row(SYSTEM_ACCOUNT_ID, 10, 20)] };
    expect(composerUsageFor(['demo'], [harness('codex')], usage)).toBeUndefined();
    expect(composerUsageFor(['openai', 'anthropic'], [harness('codex')], usage)).toBeUndefined();
    expect(composerUsageFor(['codex'], undefined, usage)).toBeUndefined();
    expect(composerUsageFor(['codex'], [harness('codex')], undefined)).toBeUndefined();
  });

  it('shows nothing for a harness that reports no allowance or an account that is signed out', () => {
    const usage: HarnessUsage = {
      cursor: [{ accountId: SYSTEM_ACCOUNT_ID, checkedAt, windows: [], unavailable: 'unsupported', email: 'an@example.com' }],
      codex: [{ accountId: SYSTEM_ACCOUNT_ID, checkedAt, windows: [], unavailable: 'signed_out' }],
    };
    expect(composerUsageFor(['cursor', 'codex'], [harness('cursor'), harness('codex')], usage)).toBeUndefined();
  });

  it('reads the account in use, not another account of the same harness', () => {
    const accounts = [{ id: 'work', label: 'Work' }];
    const usage: HarnessUsage = { codex: [row(SYSTEM_ACCOUNT_ID, 95, 40), row('work', 12, 30)] };
    const view = composerUsageFor(['codex'], [harness('codex', 'work', accounts)], usage);
    expect(view?.shown.usage.accountId).toBe('work');
    expect(view?.shown.tightest.usedPercent).toBe(30);
    expect(view?.shown.tone).toBe('normal');
    expect(view?.offer).toBeUndefined();
  });

  it('warns with the reset of the allowance closest to its limit', () => {
    const view = composerUsageFor(['codex'], [harness('codex')], { codex: [row(SYSTEM_ACCOUNT_ID, 40, 85)] });
    expect(view?.shown.tone).toBe('warning');
    expect(view?.shown.resetsAt).toBe(weekReset);
    expect(view?.offer).toBeUndefined();
  });

  it('once out, offers the other account with room, as the island would', () => {
    const accounts = [{ id: 'work', label: 'Work' }];
    const usage: HarnessUsage = { codex: [row(SYSTEM_ACCOUNT_ID, 100, 60), row('work', 20, 30)] };
    const view = composerUsageFor(['codex'], [harness('codex', SYSTEM_ACCOUNT_ID, accounts)], usage);
    expect(view?.shown.tone).toBe('out');
    expect(view?.shown.resetsAt).toBe(sessionReset);
    expect(view?.offer).toEqual({ kind: 'switch', accountId: 'work', usedPercent: 30 });
  });

  it('once out with nowhere to switch, waits for the latest reset among the full allowances', () => {
    const usage: HarnessUsage = { codex: [row(SYSTEM_ACCOUNT_ID, 100, 100)] };
    const view = composerUsageFor(['codex'], [harness('codex')], usage);
    expect(view?.shown.resetsAt).toBe(weekReset);
    expect(view?.offer?.kind).toBe('wait');
  });

  it('in a crew or group chat, shows the harness closest to its limit and lists the others after it', () => {
    const usage: HarnessUsage = { 'claude-code': [row(SYSTEM_ACCOUNT_ID, 30, 50)], codex: [row(SYSTEM_ACCOUNT_ID, 10, 88)] };
    const view = composerUsageFor(['claude-code', 'codex', 'claude-code'], [harness('claude-code'), harness('codex')], usage);
    expect(view?.shown.harness.id).toBe('codex');
    expect(view?.others.map(plan => plan.harness.id)).toEqual(['claude-code']);
  });

  it('keeps roster order when two harnesses are equally close', () => {
    const usage: HarnessUsage = { 'claude-code': [row(SYSTEM_ACCOUNT_ID, 50, 50)], codex: [row(SYSTEM_ACCOUNT_ID, 50, 50)] };
    expect(composerUsageFor(['codex', 'claude-code'], [harness('claude-code'), harness('codex')], usage)?.shown.harness.id).toBe('codex');
  });

  it('shows an earlier reading from an expired Claude Code sign-in with its time', () => {
    const windows: HarnessUsageWindow[] = [{ kind: 'session', usedPercent: 42, resetsAt: sessionReset }];
    const usage: HarnessUsage = { 'claude-code': [{ accountId: SYSTEM_ACCOUNT_ID, checkedAt, windows, unavailable: 'expired', asOf: '2026-09-29T07:05:00.000Z' }] };
    const view = composerUsageFor(['claude-code'], [harness('claude-code')], usage);
    expect(view?.shown.usage.asOf).toBe('2026-09-29T07:05:00.000Z');
    expect(view?.shown.tightest.usedPercent).toBe(42);
  });
});

const run = (id: string, workerName: string, contextUse?: Run['contextUse'], manifest?: Partial<ContextManifest>) => ({
  id,
  taskId: 'task',
  status: 'completed',
  startedAt: checkedAt,
  error: null,
  ...(contextUse ? { contextUse } : {}),
  snapshot: { worker: { id: workerName, name: workerName }, ...(manifest ? { context: { knowledge: [], manifest: { bytes: 0, loaded: [], omitted: [], ...manifest } } } : {}) },
}) as unknown as Run;

describe('the context window under the message box (COD-326)', () => {
  it('reads the latest run that reported a window, and skips one that did not', () => {
    const runs = [run('a', 'Writer', { usedTokens: 20_000, windowTokens: 200_000 }), run('b', 'Researcher', { usedTokens: 50_000 })];
    expect(latestContextUse(runs)).toMatchObject({ usedTokens: 20_000, windowTokens: 200_000, workerName: 'Writer', summarizedTurns: 0 });
    expect(latestContextUse([run('c', 'Researcher')])).toBeUndefined();
  });

  it('counts the older turns Orglet folded into a summary on that run', () => {
    const omitted: ContextManifest['omitted'] = [
      { kind: 'turn', revision: 1, reason: 'summarized' },
      { kind: 'turn', revision: 1, reason: 'summarized' },
      { kind: 'turn', revision: 2, reason: 'summarized' },
      { kind: 'turn', revision: 12, reason: 'truncated' },
    ];
    const context = latestContextUse([run('a', 'Writer', { usedTokens: 304_300, windowTokens: 1_000_000 }, { omitted, verbatimTurns: 10 })]);
    expect(context).toMatchObject({ summarizedTurns: 2, verbatimTurns: 10 });
    expect(contextPercent(context!)).toBeCloseTo(30.43);
  });
});

describe('the ring under the message box (COD-326)', () => {
  const plans = (session: number) => composerUsageFor(['codex'], [harness('codex')], { codex: [row(SYSTEM_ACCOUNT_ID, session, 10)] });
  const context = (usedTokens: number) => ({ usedTokens, windowTokens: 1_000_000, workerName: 'Writer', summarizedTurns: 0 });

  it('shows nothing when neither a plan nor a context window is known', () => {
    expect(usageRingFor(undefined, undefined)).toBeUndefined();
  });

  it('follows whichever is closer to its limit', () => {
    expect(usageRingFor(plans(30), context(850_000))).toEqual({ percent: 85, tone: 'warning' });
    expect(usageRingFor(plans(100), context(100_000))).toEqual({ percent: 100, tone: 'out' });
    expect(usageRingFor(undefined, context(304_300))).toEqual({ percent: 30.43, tone: 'normal' });
  });
});
