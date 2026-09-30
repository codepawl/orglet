import { describe, expect, it } from 'vitest';
import { chatContextFor, composerUsageFor, composerUsageTone, contextPercent, usageRingFor, type ContextWorker } from '../../apps/desktop/src/shared/composer-usage';
import { withReportedContextWindows } from '../../apps/desktop/src/core/models/cache';
import type { ModelEntry } from '../../apps/desktop/src/shared/models';
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

const run = (id: string, worker: { id: string; name?: string; provider?: string }, contextUse?: Run['contextUse'], options: { model?: string; manifest?: Partial<ContextManifest> } = {}) => ({
  id,
  taskId: 'task',
  status: 'completed',
  startedAt: checkedAt,
  error: null,
  ...(contextUse ? { contextUse } : {}),
  snapshot: {
    worker: { id: worker.id, name: worker.name ?? worker.id, provider: worker.provider ?? 'claude-code' },
    ...(options.model ? { model: options.model } : {}),
    ...(options.manifest ? { context: { knowledge: [], manifest: { bytes: 0, loaded: [], omitted: [], ...options.manifest } } } : {}),
  },
}) as unknown as Run;

const writer: ContextWorker = { id: 'writer', name: 'Writer', provider: 'claude-code' };
const opus: ModelEntry = { provider: 'claude-code', id: 'opus', displayName: 'Opus 5.5', resolvedId: 'claude-opus-5-5', isDefault: true, source: 'alias' };
const sonnet: ModelEntry = { provider: 'claude-code', id: 'sonnet', displayName: 'Sonnet 5', source: 'alias' };

describe('the context window of the model the chat will use next (COD-326)', () => {
  it('before the chat has run, shows the capacity the model list gives for the CLI default, with nothing used', () => {
    const context = chatContextFor([writer], { 'claude-code': [{ ...opus, contextTokens: 1_000_000 }, sonnet] }, []);
    expect(context?.lines).toEqual([{ workerId: 'writer', workerName: 'Writer', modelLabel: 'Opus 5.5', usedTokens: 0, measured: false, windowTokens: 1_000_000 }]);
    expect(usageRingFor(undefined, context)).toEqual({ percent: 0, tone: 'normal' });
  });

  it('reads the capacity of the model the orglet chose, from an API list too', () => {
    const openrouterWorker: ContextWorker = { id: 'reader', name: 'Reader', provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5' };
    const models: ModelEntry[] = [{ provider: 'openrouter', id: 'anthropic/claude-sonnet-5', displayName: 'Claude Sonnet 5', contextTokens: 200_000, source: 'native' }];
    const [line] = chatContextFor([openrouterWorker], { openrouter: models }, [])!.lines;
    expect(line).toMatchObject({ modelLabel: 'Claude Sonnet 5', usedTokens: 0, windowTokens: 200_000 });
  });

  it('takes the latest run\'s use and the window that run reported for the same model, over the list', () => {
    const runs = [
      run('a', writer, { usedTokens: 20_000, windowTokens: 1_000_000 }),
      run('b', { id: 'someone-else' }, { usedTokens: 90_000, windowTokens: 200_000 }),
      run('c', writer, { usedTokens: 304_300 }, { manifest: { omitted: [{ kind: 'turn', revision: 1, reason: 'summarized' }, { kind: 'turn', revision: 2, reason: 'summarized' }], verbatimTurns: 10 } }),
    ];
    const context = chatContextFor([writer], { 'claude-code': [{ ...opus, contextTokens: 500_000 }] }, runs);
    expect(context?.lines[0]).toMatchObject({ usedTokens: 304_300, measured: true, windowTokens: 1_000_000 });
    expect(context).toMatchObject({ summarizedTurns: 2, verbatimTurns: 10 });
    expect(usageRingFor(undefined, context)?.percent).toBeCloseTo(30.43);
  });

  it('counts a run on the default under any of its names, and not a run on another model', () => {
    const onDefault = [run('a', writer, { usedTokens: 10_000, windowTokens: 1_000_000 }, { model: 'claude-opus-5-5' })];
    expect(chatContextFor([writer], { 'claude-code': [opus] }, onDefault)?.lines[0].windowTokens).toBe(1_000_000);
    const switched = { ...writer, modelId: 'sonnet' };
    const line = chatContextFor([switched], { 'claude-code': [opus, { ...sonnet, contextTokens: 200_000 }] }, onDefault)!.lines[0];
    expect(line).toMatchObject({ modelLabel: 'Sonnet 5', usedTokens: 10_000, windowTokens: 200_000 });
  });

  it('says the capacity is unknown when neither a run nor the list gave one, and the ring leaves it out', () => {
    const codex: ContextWorker = { id: 'coder', name: 'Coder', provider: 'codex' };
    const context = chatContextFor([codex], { codex: [{ provider: 'codex', id: 'gpt-6', displayName: 'GPT-6', isDefault: true, source: 'native' }] }, [run('a', codex, { usedTokens: 1_200 })]);
    expect(context?.lines[0]).toEqual({ workerId: 'coder', workerName: 'Coder', modelLabel: 'GPT-6', usedTokens: 1_200, measured: true });
    expect(usageRingFor(undefined, context)).toBeUndefined();
    const withPlan = composerUsageFor(['codex'], [harness('codex')], { codex: [row(SYSTEM_ACCOUNT_ID, 12, 30)] });
    expect(usageRingFor(withPlan, context)).toEqual({ percent: 30, tone: 'normal' });
    expect(chatContextFor([codex], {}, [])?.lines[0]).toEqual({ workerId: 'coder', workerName: 'Coder', usedTokens: 0, measured: false });
  });

  it('in a crew, gives each orglet its own line in roster order, skips Demo, and the ring follows the fullest known one', () => {
    const lead: ContextWorker = { id: 'lead', name: 'Lead', provider: 'claude-code', modelId: 'sonnet' };
    const helper: ContextWorker = { id: 'helper', name: 'Helper', provider: 'demo' };
    const coder: ContextWorker = { id: 'coder', name: 'Coder', provider: 'codex' };
    const lists = { 'claude-code': [{ ...opus, contextTokens: 1_000_000 }, { ...sonnet, contextTokens: 200_000 }] };
    const runs = [run('a', lead, { usedTokens: 170_000, windowTokens: 200_000 }, { model: 'sonnet' }), run('b', writer, { usedTokens: 50_000, windowTokens: 1_000_000 })];
    const context = chatContextFor([lead, helper, writer, coder, writer], lists, runs);
    expect(context?.lines.map(line => [line.workerName, line.modelLabel, line.usedTokens, line.windowTokens])).toEqual([
      ['Lead', 'Sonnet 5', 170_000, 200_000],
      ['Writer', 'Opus 5.5', 50_000, 1_000_000],
      ['Coder', undefined, 0, undefined],
    ]);
    expect(usageRingFor(undefined, context)).toEqual({ percent: 85, tone: 'warning' });
  });

  it('gives nothing for a chat with only Demo', () => {
    expect(chatContextFor([{ id: 'demo', name: 'Researcher', provider: 'demo' }], {}, [])).toBeUndefined();
  });
});

describe('the ring under the message box (COD-326)', () => {
  const plans = (session: number) => composerUsageFor(['codex'], [harness('codex')], { codex: [row(SYSTEM_ACCOUNT_ID, session, 10)] });
  const context = (usedTokens: number) => chatContextFor([writer], { 'claude-code': [{ ...opus, contextTokens: 1_000_000 }] }, [run('a', writer, { usedTokens })]);

  it('shows nothing when neither a plan nor a context window is known', () => {
    expect(usageRingFor(undefined, undefined)).toBeUndefined();
  });

  it('follows whichever is closer to its limit', () => {
    expect(usageRingFor(plans(30), context(850_000))).toEqual({ percent: 85, tone: 'warning' });
    expect(usageRingFor(plans(100), context(100_000))).toEqual({ percent: 100, tone: 'out' });
    expect(usageRingFor(undefined, context(304_300))).toEqual({ percent: 30.43, tone: 'normal' });
    expect(contextPercent({ usedTokens: 1_200_000, windowTokens: 1_000_000 })).toBe(100);
  });
});

describe('windows a harness reported, merged into its model list (COD-326)', () => {
  it('fills only models the list gives no window for, by id, resolved id or alias', () => {
    const models: ModelEntry[] = [opus, { ...sonnet, aliases: ['sonnet-latest'] }, { provider: 'claude-code', id: 'haiku', contextTokens: 200_000, source: 'alias' }];
    const merged = withReportedContextWindows(models, { 'claude-opus-5-5': 1_000_000, 'sonnet-latest': 400_000, haiku: 1 });
    expect(merged.map(model => model.contextTokens)).toEqual([1_000_000, 400_000, 200_000]);
    expect(withReportedContextWindows(models, undefined)).toBe(models);
  });
});
