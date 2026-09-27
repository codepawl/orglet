import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { detectHarnesses, type Probe } from '../../apps/desktop/src/core/harness/detect';
import {
  claudePlanLabel, claudeUsageWindows, codexPlanLabel, codexUsageWindows, cursorAbout, readHarnessUsage,
  type AccountUsageRead, type UsageRuntime,
} from '../../apps/desktop/src/core/harness/usage';
import { UsageReadings } from '../../apps/desktop/src/core/harness/usage-readings';
import { missingHarness, SYSTEM_ACCOUNT_ID, tightestWindow, type HarnessAccountUsage, type HarnessCatalogId, type HarnessInfo, type HarnessUsage } from '../../apps/desktop/src/shared/harness';
import { accountSwitchFor } from '../../apps/desktop/src/shared/account-switch';
import type { Task, Worker } from '../../apps/desktop/src/shared/contracts';
import { usageReadingTime, usageResetLabel } from '../../apps/desktop/src/renderer/components/PlanUsage';
import { currentLocale } from '../../apps/desktop/src/renderer/i18n';

// Shapes copied from the real CLIs and endpoint on 2026-09-24 (Claude Code 2.1, codex-cli 0.155, Cursor Agent 2026.09).
const claudeAnswer = {
  five_hour: { utilization: 100, resets_at: '2026-09-24T18:50:00.107851+07:00' },
  seven_day: { utilization: 99, resets_at: '2026-09-29T11:00:00.10788+07:00' },
  seven_day_opus: null,
  limits: [
    { kind: 'session', group: 'session', percent: 100, resets_at: '2026-09-24T18:50:00.107851+07:00', scope: null },
    { kind: 'weekly_all', group: 'weekly', percent: 99, resets_at: '2026-09-29T11:00:00.10788+07:00', scope: null },
    { kind: 'weekly_scoped', group: 'weekly', percent: 89, resets_at: '2026-09-29T11:00:00.108098+07:00', scope: { model: { id: null, display_name: 'Fable' }, surface: null } },
  ],
};
const codexLimits = {
  rateLimits: {
    limitId: 'codex', primary: { usedPercent: 3, windowDurationMins: 10080, resetsAt: 1790797085 }, secondary: null,
    planType: 'prolite', rateLimitReachedType: null,
  },
};

describe('reading what each vendor reports', () => {
  it('reads Claude allowances from the limits list, including a weekly allowance limited to one model', () => {
    expect(claudeUsageWindows(claudeAnswer)).toEqual([
      { kind: 'session', usedPercent: 100, resetsAt: '2026-09-24T11:50:00.107Z' },
      { kind: 'weekly', usedPercent: 99, resetsAt: '2026-09-29T04:00:00.107Z' },
      { kind: 'weekly', model: 'Fable', usedPercent: 89, resetsAt: '2026-09-29T04:00:00.108Z' },
    ]);
  });

  it('falls back to the named Claude windows when an older answer has no limits list', () => {
    const { limits: _limits, ...older } = claudeAnswer;
    expect(claudeUsageWindows({ ...older, seven_day_sonnet: { utilization: 140, resets_at: null } })).toEqual([
      { kind: 'session', usedPercent: 100, resetsAt: '2026-09-24T11:50:00.107Z' },
      { kind: 'weekly', usedPercent: 99, resetsAt: '2026-09-29T04:00:00.107Z' },
      { kind: 'weekly', model: 'Sonnet', usedPercent: 100 },
    ]);
    expect(claudeUsageWindows('not an answer')).toEqual([]);
  });

  it('names Claude and ChatGPT plans the way their vendors do', () => {
    expect(claudePlanLabel('max', 'default_claude_max_20x')).toBe('Max 20x');
    expect(claudePlanLabel('pro', 'default_claude_pro')).toBe('Pro');
    expect(claudePlanLabel(undefined)).toBeUndefined();
    expect(codexPlanLabel('prolite')).toBe('ChatGPT Pro 5x');
    expect(codexPlanLabel('self_serve_business_usage_based')).toBe('ChatGPT Business');
    expect(codexPlanLabel('new_plan')).toBe('new_plan');
  });

  it('reads Codex windows by their duration and ignores a model-specific limit', () => {
    expect(codexUsageWindows(codexLimits)).toEqual([{ kind: 'weekly', usedPercent: 3, resetsAt: new Date(1790797085 * 1000).toISOString() }]);
    expect(codexUsageWindows({ rateLimits: { limitId: 'codex', planType: 'plus', primary: { usedPercent: 40 }, secondary: { usedPercent: 12 } } }))
      .toEqual([{ kind: 'session', usedPercent: 40 }, { kind: 'weekly', usedPercent: 12 }]);
    expect(codexUsageWindows({ rateLimits: { limitId: 'codex', planType: 'free', primary: { usedPercent: 7 } } })).toEqual([{ kind: 'monthly', usedPercent: 7 }]);
    expect(codexUsageWindows({ rateLimits: { limitId: 'codex_spark', primary: { usedPercent: 90 } } })).toEqual([]);
  });

  it('reads the Codex session window when the service reports one, and only the weekly one when it does not (COD-301)', () => {
    // codex-cli 0.157.0 `account/rateLimits/read` for a ChatGPT Pro 5x account on 2026-09-27: the service sends one
    // window, a week long, in the first position. Codex passes the service's primary_window and secondary_window
    // through as they come (codex-rs/backend-client), so a plan without a five-hour window shows none.
    const proLite = {
      ordinaryUsageAllowed: true,
      rateLimits: {
        limitId: 'codex', limitName: null, normalModelSlug: null,
        primary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 1791078865 }, secondary: null,
        credits: { hasCredits: false, unlimited: false, balance: '0' }, individualLimit: null, spendControlReached: false,
        planType: 'prolite', rateLimitReachedType: null,
      },
      rateLimitResetCredits: { availableCount: 0, credits: [] },
      rateLimitUpsell: null,
    };
    expect(codexUsageWindows(proLite)).toEqual([{ kind: 'weekly', usedPercent: 0, resetsAt: new Date(1791078865 * 1000).toISOString() }]);
    const withSession = { rateLimits: { ...proLite.rateLimits, primary: { usedPercent: 35, windowDurationMins: 300, resetsAt: 1790560000 }, secondary: { usedPercent: 8, windowDurationMins: 10080, resetsAt: 1791078865 } } };
    expect(codexUsageWindows(withSession)).toEqual([
      { kind: 'session', usedPercent: 35, resetsAt: new Date(1790560000 * 1000).toISOString() },
      { kind: 'weekly', usedPercent: 8, resetsAt: new Date(1791078865 * 1000).toISOString() },
    ]);
  });

  it('reads the Cursor account without inventing an allowance', () => {
    expect(cursorAbout(JSON.stringify({ userEmail: 'dev@example.com', subscriptionTier: 'pro' }))).toEqual({ email: 'dev@example.com', plan: 'Pro', windows: [], unavailable: 'unsupported' });
    expect(cursorAbout(JSON.stringify({ userEmail: null, subscriptionTier: null }))).toEqual({ windows: [], unavailable: 'signed_out' });
    expect(cursorAbout('not json')).toEqual({ windows: [], unavailable: 'failed' });
  });

  it('picks the allowance closest to its limit', () => {
    expect(tightestWindow({ windows: claudeUsageWindows(claudeAnswer) })).toEqual(expect.objectContaining({ kind: 'session', usedPercent: 100 }));
    expect(tightestWindow({ windows: [] })).toBeUndefined();
  });
});

type FetchCall = { url: string; authorization: string | null };

function fakeRuntime(options: {
  status?: unknown;
  credentials?: unknown;
  usage?: { status: number; body?: unknown };
  appServer?: unknown[];
  about?: unknown;
  now?: Date;
}) {
  const fetches: FetchCall[] = [];
  const probes: { args: string[]; env?: NodeJS.ProcessEnv }[] = [];
  const reads: string[] = [];
  const appServers: NodeJS.ProcessEnv[] = [];
  const runtime: UsageRuntime = {
    run: async (_executable, args, env) => {
      probes.push({ args, env });
      if (args.join(' ') === 'auth status') return { code: 0, stdout: JSON.stringify(options.status), stderr: '' };
      if (args[0] === 'about') return { code: 0, stdout: JSON.stringify(options.about), stderr: '' };
      return { code: 1, stdout: '', stderr: '' };
    },
    appServer: async (_executable, env) => {
      appServers.push(env);
      return options.appServer ?? [];
    },
    fetch: async (input, init) => {
      fetches.push({ url: String(input), authorization: new Headers(init?.headers).get('authorization') });
      const answer = options.usage ?? { status: 200, body: claudeAnswer };
      return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status });
    },
    readText: async path => {
      reads.push(path);
      if (options.credentials === undefined) throw new Error('ENOENT');
      return JSON.stringify(options.credentials);
    },
    home: join('home', 'person'),
    now: () => options.now ?? new Date('2026-09-24T11:30:00Z'),
  };
  return { runtime, fetches, probes, reads, appServers };
}

const signedInClaude = { loggedIn: true, authMethod: 'claude.ai', email: 'an@example.com', subscriptionType: 'max' };
const claudeCredentials = (expiresAt: number) => ({ claudeAiOauth: { accessToken: 'token-value', expiresAt, rateLimitTier: 'default_claude_max_20x', subscriptionType: 'max' } });

describe('reading one account', () => {
  it('reads Claude usage with the token from that account folder and sends it only to the usage endpoint', async () => {
    const fake = fakeRuntime({ status: signedInClaude, credentials: claudeCredentials(Date.parse('2026-09-24T16:00:00Z')) });
    const folder = join('accounts', 'claude-code', 'work');
    const read = await readHarnessUsage('claude-code', 'claude.exe', folder, fake.runtime);
    expect(read).toEqual({ email: 'an@example.com', plan: 'Max 20x', windows: claudeUsageWindows(claudeAnswer) });
    expect(fake.probes[0].env).toEqual({ CLAUDE_CONFIG_DIR: folder });
    expect(fake.reads).toEqual([join(folder, '.credentials.json')]);
    expect(fake.fetches).toEqual([{ url: 'https://api.anthropic.com/api/oauth/usage', authorization: 'Bearer token-value' }]);
    expect(JSON.stringify(read)).not.toContain('token-value');
  });

  it('reads the system Claude account from the home folder', async () => {
    const fake = fakeRuntime({ status: signedInClaude, credentials: claudeCredentials(Date.parse('2026-09-24T16:00:00Z')) });
    await readHarnessUsage('claude-code', 'claude.exe', undefined, fake.runtime);
    expect(fake.probes[0].env).toEqual({});
    expect(fake.reads).toEqual([join('home', 'person', '.claude', '.credentials.json')]);
  });

  it('never calls the endpoint with an expired token, and never writes to the credentials', async () => {
    const fake = fakeRuntime({ status: signedInClaude, credentials: claudeCredentials(Date.parse('2026-09-24T10:00:00Z')) });
    expect(await readHarnessUsage('claude-code', 'claude.exe', undefined, fake.runtime)).toEqual({ email: 'an@example.com', plan: 'Max 20x', windows: [], unavailable: 'expired' });
    expect(fake.fetches).toEqual([]);
  });

  it('says why a Claude account has no allowance: signed out, an API key, no saved token, a refused token, a failed request', async () => {
    const signedOut = fakeRuntime({ status: { loggedIn: false } });
    expect(await readHarnessUsage('claude-code', 'claude.exe', undefined, signedOut.runtime)).toEqual({ windows: [], unavailable: 'signed_out' });
    const apiKey = fakeRuntime({ status: { loggedIn: true, authMethod: 'api_key' } });
    expect(await readHarnessUsage('claude-code', 'claude.exe', undefined, apiKey.runtime)).toEqual({ windows: [], unavailable: 'unsupported' });
    const keychain = fakeRuntime({ status: signedInClaude });
    expect(await readHarnessUsage('claude-code', 'claude.exe', undefined, keychain.runtime)).toEqual({ email: 'an@example.com', plan: 'Max', windows: [], unavailable: 'unsupported' });
    const refused = fakeRuntime({ status: signedInClaude, credentials: claudeCredentials(Date.parse('2026-09-24T16:00:00Z')), usage: { status: 401 } });
    expect(await readHarnessUsage('claude-code', 'claude.exe', undefined, refused.runtime)).toEqual(expect.objectContaining({ unavailable: 'expired' }));
    const broken = fakeRuntime({ status: signedInClaude, credentials: claudeCredentials(Date.parse('2026-09-24T16:00:00Z')), usage: { status: 500 } });
    expect(await readHarnessUsage('claude-code', 'claude.exe', undefined, broken.runtime)).toEqual(expect.objectContaining({ unavailable: 'failed', email: 'an@example.com' }));
  });

  it('reads the Codex account and its limits through the app server in that account folder', async () => {
    const answer = [{ account: { type: 'chatgpt', email: 'an@example.com', planType: 'prolite' }, requiresOpenaiAuth: true }, codexLimits];
    const fake = fakeRuntime({ appServer: answer });
    const folder = join('accounts', 'codex', 'second');
    expect(await readHarnessUsage('codex', 'codex.exe', folder, fake.runtime)).toEqual({ email: 'an@example.com', plan: 'ChatGPT Pro 5x', windows: codexUsageWindows(codexLimits) });
    expect(fake.appServers).toEqual([{ CODEX_HOME: folder }]);

    const signedOut = fakeRuntime({ appServer: [{ account: null, requiresOpenaiAuth: true }, undefined] });
    expect(await readHarnessUsage('codex', 'codex.exe', undefined, signedOut.runtime)).toEqual({ windows: [], unavailable: 'signed_out' });
    const apiKey = fakeRuntime({ appServer: [{ account: { type: 'apiKey' } }, undefined] });
    expect(await readHarnessUsage('codex', 'codex.exe', undefined, apiKey.runtime)).toEqual({ windows: [], unavailable: 'unsupported' });
    const noServer = fakeRuntime({ appServer: [] });
    expect(await readHarnessUsage('codex', 'codex.exe', undefined, noServer.runtime)).toEqual({ windows: [], unavailable: 'failed' });
  });

  it('reads the Cursor account from about in that account folder', async () => {
    const fake = fakeRuntime({ about: { userEmail: 'an@example.com', subscriptionTier: 'pro' } });
    const folder = join('accounts', 'cursor', 'one');
    expect(await readHarnessUsage('cursor', 'agent.exe', folder, fake.runtime)).toEqual({ email: 'an@example.com', plan: 'Pro', windows: [], unavailable: 'unsupported' });
    expect(fake.probes[0]).toEqual({ args: ['about', '--format', 'json'], env: { CURSOR_CONFIG_DIR: folder } });
  });
});

describe('Cursor sign-in status', () => {
  it('reads isAuthenticated, which is what Cursor Agent answers today', async () => {
    const answers: Record<string, unknown> = {
      signedOut: { status: 'unauthenticated', isAuthenticated: false, hasAccessToken: false, message: 'Not logged in' },
      signedIn: { status: 'authenticated', isAuthenticated: true, hasAccessToken: true },
    };
    for (const [name, answer] of Object.entries(answers)) {
      const probe: Probe = async (executable, args) => {
        if (args[0] === '--version') return executable.includes('agent') ? { code: 0, stdout: '2026.09.18\n', stderr: '' } : { code: 1, stdout: '', stderr: '' };
        return { code: 0, stdout: JSON.stringify(answer), stderr: '' };
      };
      const directory = await mkdtemp(join(tmpdir(), 'orglet-cursor-status-'));
      try {
        await writeFile(join(directory, 'agent'), '');
        const [cursor] = (await detectHarnesses({ HOME: directory, PATH: directory }, 'linux', probe)).filter(item => item.id === 'cursor');
        expect(cursor.auth).toBe(name === 'signedIn' ? 'logged_in' : 'logged_out');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });
});

describe('usage in Settings', () => {
  let directory: string;
  let store: Store;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-harness-usage-'));
    store = new Store(':memory:');
  });
  afterEach(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('reads every account of every installed harness, system first, each in its own folder, and caches the answer', async () => {
    const reads: { harness: HarnessCatalogId; configDir?: string }[] = [];
    const accountRoot = join(directory, 'harness-accounts');
    let core: CoreService | undefined;
    const detect = async (): Promise<HarnessInfo[]> => {
      const selection = core?.harnessAccounts.selection('codex');
      return [
        { ...missingHarness('claude-code', 'win32'), executable: 'claude.exe', auth: 'logged_in', status: 'signed_in' },
        { ...missingHarness('codex', 'win32', selection), executable: 'codex.exe', auth: 'logged_in', status: 'signed_in' },
        missingHarness('cursor', 'win32'),
      ];
    };
    const usage = async (harness: HarnessCatalogId, _executable: string, configDir?: string): Promise<AccountUsageRead> => {
      reads.push({ harness, ...(configDir ? { configDir } : {}) });
      return { email: `${harness}@example.com`, windows: [{ kind: 'weekly', usedPercent: 10 }] };
    };
    core = new CoreService(store, () => {}, async () => { throw new Error('Native adapter must not be used'); }, undefined, () => new Date('2026-09-24T12:00:00Z'), {
      detect, usage, accountRoot, execute: async () => { throw new Error('Nothing runs here'); },
    });
    await core.command('saveHarnessAccount', { harness: 'codex', label: 'Work' });
    const [work] = core.harnessAccounts.selection('codex').accounts;

    const found = await core.command('harnessUsage', { refresh: false }) as HarnessUsage;
    expect(Object.keys(found).sort()).toEqual(['claude-code', 'codex']);
    expect(found.codex?.map(row => row.accountId)).toEqual([SYSTEM_ACCOUNT_ID, work.id]);
    expect(found.codex?.[1]).toEqual({ accountId: work.id, email: 'codex@example.com', windows: [{ kind: 'weekly', usedPercent: 10 }], checkedAt: '2026-09-24T12:00:00.000Z' });
    expect(reads).toEqual([
      { harness: 'claude-code' },
      { harness: 'codex' },
      { harness: 'codex', configDir: join(accountRoot, 'codex', work.id) },
    ]);

    await core.command('harnessUsage', { refresh: false });
    expect(reads).toHaveLength(3);
    await core.command('harnessUsage', { refresh: true });
    expect(reads).toHaveLength(6);
  });

  it('runs no CLI for a rename, and detects only the harness whose sign-in changed (COD-229)', async () => {
    const calls: (readonly HarnessCatalogId[] | 'all')[] = [];
    let core: CoreService | undefined;
    const rows = (): HarnessInfo[] => (['claude-code', 'codex', 'cursor'] as const).map(id =>
      ({ ...missingHarness(id, 'win32', core?.harnessAccounts.selection(id)), executable: `${id}.exe`, auth: 'logged_in' as const, status: 'signed_in' as const }));
    core = new CoreService(store, () => {}, async () => { throw new Error('unused'); }, undefined, undefined, {
      detect: async (_accounts, only) => { calls.push(only ?? 'all'); return rows(); },
      accountRoot: join(directory, 'harness-accounts'),
      execute: async () => { throw new Error('unused'); },
    });
    await core.command('harnesses', { refresh: true });
    expect(calls).toEqual(['all']);

    // Adding selects the new account, so only Codex is asked again.
    const added = await core.command('saveHarnessAccount', { harness: 'codex', label: 'Work' }) as HarnessInfo[];
    const [work] = core.harnessAccounts.selection('codex').accounts;
    expect(calls).toEqual(['all', ['codex']]);
    expect(added.find(row => row.id === 'codex')?.accountId).toBe(work.id);

    // A new name runs nothing, and the rows carry it at once.
    const renamed = await core.command('saveHarnessAccount', { harness: 'codex', id: work.id, label: 'Company' }) as HarnessInfo[];
    expect(calls).toHaveLength(2);
    expect(renamed.find(row => row.id === 'codex')?.accounts).toEqual([{ id: work.id, label: 'Company' }]);
    expect(renamed.map(row => row.id)).toEqual(['claude-code', 'codex', 'cursor']);

    // Switching back asks Codex again; removing an account nobody signs in from runs nothing.
    await core.command('selectHarnessAccount', { harness: 'codex', id: SYSTEM_ACCOUNT_ID });
    expect(calls).toEqual(['all', ['codex'], ['codex']]);
    const removed = await core.command('removeHarnessAccount', { harness: 'codex', id: work.id }) as HarnessInfo[];
    expect(calls).toHaveLength(3);
    expect(removed.find(row => row.id === 'codex')?.accounts).toEqual([]);
  });

  it('shows no usage when the runtime cannot read any', async () => {
    const core = new CoreService(store, () => {}, async () => { throw new Error('unused'); }, undefined, undefined, {
      detect: async () => [], execute: async () => { throw new Error('unused'); },
    });
    expect(await core.command('harnessUsage', { refresh: true })).toEqual({});
  });
});

describe('the last good reading (COD-301)', () => {
  let directory: string;
  let store: Store;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orglet-usage-readings-'));
    store = new Store(':memory:');
  });
  afterEach(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const fresh: HarnessAccountUsage = {
    accountId: SYSTEM_ACCOUNT_ID, email: 'an@example.com', plan: 'Max 20x', checkedAt: '2026-09-27T00:05:00.000Z',
    windows: [
      { kind: 'session', usedPercent: 12, resetsAt: '2026-09-27T02:00:00.000Z' },
      { kind: 'weekly', usedPercent: 40, resetsAt: '2026-10-01T04:00:00.000Z' },
    ],
  };
  const expired = (checkedAt: string, email = 'an@example.com'): HarnessAccountUsage =>
    ({ accountId: SYSTEM_ACCOUNT_ID, email, plan: 'Max 20x', windows: [], unavailable: 'expired', checkedAt });

  it('shows the last good numbers with their time when the saved sign-in has expired, and never keeps a token', () => {
    const readings = new UsageReadings(store);
    expect(readings.settle('claude-code', fresh, new Date('2026-09-27T00:05:00Z'))).toEqual(fresh);
    const later = readings.settle('claude-code', expired('2026-09-27T01:30:00.000Z'), new Date('2026-09-27T01:30:00Z'));
    expect(later).toEqual({ ...expired('2026-09-27T01:30:00.000Z'), windows: fresh.windows, asOf: '2026-09-27T00:05:00.000Z' });
    // A failed request shows them the same way; the reason stays on the row.
    expect(readings.settle('claude-code', { ...expired('2026-09-27T01:31:00.000Z'), unavailable: 'failed' }, new Date('2026-09-27T01:31:00Z')))
      .toEqual(expect.objectContaining({ unavailable: 'failed', asOf: '2026-09-27T00:05:00.000Z' }));
    expect(JSON.stringify(store.setting('harnessUsageReadings', {}))).not.toMatch(/token|Bearer/i);
  });

  it('drops a window whose reset has passed, and the whole reading once none is left', () => {
    const readings = new UsageReadings(store);
    readings.settle('claude-code', fresh, new Date('2026-09-27T00:05:00Z'));
    const afterSession = readings.settle('claude-code', expired('2026-09-27T03:00:00.000Z'), new Date('2026-09-27T03:00:00Z'));
    expect(afterSession.windows).toEqual([fresh.windows[1]]);
    const afterWeek = readings.settle('claude-code', expired('2026-10-02T00:00:00.000Z'), new Date('2026-10-02T00:00:00Z'));
    expect(afterWeek).toEqual(expired('2026-10-02T00:00:00.000Z'));
  });

  it('keeps one account’s numbers off another: a new address, a sign-out or a removed account clears them', () => {
    const readings = new UsageReadings(store);
    readings.settle('claude-code', fresh, new Date('2026-09-27T00:05:00Z'));
    const now = new Date('2026-09-27T01:00:00Z');
    expect(readings.settle('claude-code', expired(now.toISOString(), 'someone@example.com'), now).asOf).toBeUndefined();
    expect(readings.settle('codex', expired(now.toISOString()), now).asOf).toBeUndefined();
    readings.settle('claude-code', { ...expired(now.toISOString()), unavailable: 'signed_out' }, now);
    expect(readings.settle('claude-code', expired(now.toISOString()), now).asOf).toBeUndefined();
    readings.settle('claude-code', fresh, now);
    readings.forget('claude-code', SYSTEM_ACCOUNT_ID);
    expect(readings.settle('claude-code', expired(now.toISOString()), now).asOf).toBeUndefined();
  });

  it('is never offered as an account with room: its numbers are not fresh', () => {
    const readings = new UsageReadings(store);
    readings.settle('claude-code', { ...fresh, accountId: 'work' }, new Date('2026-09-27T00:05:00Z'));
    const stale = readings.settle('claude-code', { ...expired('2026-09-27T01:00:00.000Z'), accountId: 'work' }, new Date('2026-09-27T01:00:00Z'));
    expect(stale.asOf).toBeDefined();
    const offer = accountSwitchFor({ accountId: SYSTEM_ACCOUNT_ID, accounts: [{ id: 'work', label: 'Work' }] }, [stale]);
    expect(offer).toEqual({ kind: 'wait' });
  });

  it('reads Claude Code usage again after an Orglet run renewed an expired sign-in, and not after other runs', async () => {
    let clock = new Date('2026-09-27T00:05:00Z');
    let answer: AccountUsageRead = { email: 'an@example.com', plan: 'Max 20x', windows: [{ kind: 'weekly', usedPercent: 40 }] };
    const reads: HarnessCatalogId[] = [];
    let notified = 0;
    const core = new CoreService(store, () => { notified += 1; }, async () => { throw new Error('Native adapter must not be used'); }, undefined, () => clock, {
      detect: async () => [
        { ...missingHarness('claude-code', 'win32'), executable: 'claude.exe', auth: 'logged_in', status: 'signed_in' },
        { ...missingHarness('codex', 'win32'), executable: 'codex.exe', auth: 'logged_in', status: 'signed_in' },
      ],
      usage: async harness => {
        reads.push(harness);
        return harness === 'claude-code' ? answer : { windows: [{ kind: 'weekly', usedPercent: 0 }] };
      },
      execute: async () => { throw new Error('The run itself does not matter here'); },
    });
    const note = join(directory, 'note.txt');
    await writeFile(note, 'the answer is 42');
    const sources = await core.sources.import([note]);
    const runWith = async (provider: 'claude-code' | 'codex') => {
      const worker = await core.command('saveWorker', { ...store.all<Worker>('workers')[0], provider }) as Worker;
      await core.command('createTask', { workerId: worker.id, brief: 'Find the answer', sourceIds: sources.map(source => source.id), consent: true, providerScopes: [provider], budgetMicros: 500_000 });
      for (let tries = 0; tries < 300 && store.all<Task>('tasks').some(task => core.runner.isActive(task.id)); tries += 1) await new Promise(resolve => setTimeout(resolve, 10));
    };

    // The first read is good and is kept; the next finds the saved sign-in expired and shows it with its time.
    await core.command('harnessUsage', { refresh: true });
    clock = new Date('2026-09-27T01:30:00Z');
    answer = { email: 'an@example.com', plan: 'Max 20x', windows: [], unavailable: 'expired' };
    const stale = await core.command('harnessUsage', { refresh: true }) as HarnessUsage;
    expect(stale['claude-code']?.[0]).toEqual(expect.objectContaining({ unavailable: 'expired', asOf: '2026-09-27T00:05:00.000Z', windows: [{ kind: 'weekly', usedPercent: 40 }] }));

    // A Codex run renews nothing of Claude Code's.
    const before = reads.length;
    await runWith('codex');
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(reads.length).toBe(before);

    // A Claude Code run renews its sign-in, so the numbers are read again and the window is told.
    answer = { email: 'an@example.com', plan: 'Max 20x', windows: [{ kind: 'weekly', usedPercent: 41 }] };
    const notifiedBefore = notified;
    await runWith('claude-code');
    for (let tries = 0; tries < 100 && reads.length === before; tries += 1) await new Promise(resolve => setTimeout(resolve, 10));
    expect(reads.length).toBeGreaterThan(before);
    for (let tries = 0; tries < 100 && notified === notifiedBefore; tries += 1) await new Promise(resolve => setTimeout(resolve, 10));
    const renewed = await core.command('harnessUsage', { refresh: false }) as HarnessUsage;
    expect(renewed['claude-code']?.[0]).toEqual(expect.objectContaining({ windows: [{ kind: 'weekly', usedPercent: 41 }] }));
    expect(renewed['claude-code']?.[0].asOf).toBeUndefined();
  });

  it('words reset and reading times without a sixty-minute remainder', () => {
    const now = new Date('2026-09-27T02:08:35Z');
    expect(usageResetLabel(new Date(now.getTime() + 119.7 * 60_000).toISOString(), now)).toBe('Resets in 2 h');
    expect(usageResetLabel(new Date(now.getTime() + 90 * 60_000).toISOString(), now)).toBe('Resets in 1 h 30 min');
    const earlierToday = new Date(now.getTime() - 95 * 60_000);
    expect(usageReadingTime(earlierToday.toISOString(), now)).toBe(earlierToday.toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' }));
  });

  it('forgets a removed account’s reading', async () => {
    const accountRoot = join(directory, 'harness-accounts');
    let core: CoreService | undefined;
    core = new CoreService(store, () => {}, async () => { throw new Error('unused'); }, undefined, () => new Date('2026-09-27T00:05:00Z'), {
      detect: async () => [{ ...missingHarness('claude-code', 'win32', core?.harnessAccounts.selection('claude-code')), executable: 'claude.exe', auth: 'logged_in', status: 'signed_in' }],
      usage: async () => ({ email: 'an@example.com', windows: [{ kind: 'weekly', usedPercent: 5 }] }),
      accountRoot,
      execute: async () => { throw new Error('unused'); },
    });
    await core.command('saveHarnessAccount', { harness: 'claude-code', label: 'Work' });
    const [work] = core.harnessAccounts.selection('claude-code').accounts;
    await core.command('harnessUsage', { refresh: true });
    expect(Object.keys(store.setting('harnessUsageReadings', {}))).toContain(`claude-code:${work.id}`);
    await core.command('removeHarnessAccount', { harness: 'claude-code', id: work.id });
    expect(Object.keys(store.setting('harnessUsageReadings', {}))).not.toContain(`claude-code:${work.id}`);
  });
});
