import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { detectHarnesses, type Probe } from '../../apps/desktop/src/core/harness/detect';
import {
  claudeKeychainService, claudePlanLabel, claudeUsageWindows, codexPlanLabel, codexUsageWindows, cursorAbout, cursorUsageWindows,
  geminiTier, geminiUsageWindows, readHarnessUsage, tokenExpiry, type AccountUsageRead, type UsageRuntime,
} from '../../apps/desktop/src/core/harness/usage';
import { UsageReadings } from '../../apps/desktop/src/core/harness/usage-readings';
import { openCodeGoUsageWindows, readOpenCodeGoUsage } from '../../apps/desktop/src/core/adapters/opencode';
import { missingHarness, SYSTEM_ACCOUNT_ID, tightestWindow, type HarnessAccountUsage, type HarnessCatalogId, type HarnessInfo, type HarnessUsage } from '../../apps/desktop/src/shared/harness';
import type { OpenCodeGoUsage } from '../../apps/desktop/src/shared/opencode';
import { accountSwitchFor } from '../../apps/desktop/src/shared/account-switch';
import type { Task, Worker } from '../../apps/desktop/src/shared/contracts';
import { usageReadingTime, usageResetLabel, usageWindowLabel } from '../../apps/desktop/src/renderer/components/PlanUsage';
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
// GetCurrentPeriodUsageResponse as Connect JSON, from the message definitions in Cursor Agent 2026.09.18: the cycle
// bounds are 64-bit milliseconds (sent as strings), spend is in cents, the percentages are doubles.
const CURSOR_URL = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
const cursorAnswer = {
  billingCycleStart: '1790000000000',
  billingCycleEnd: '1792592000000',
  planUsage: { totalSpend: 1450, includedSpend: 1200, bonusSpend: 0, remaining: 800, limit: 2000, autoPercentUsed: 12.5, apiPercentUsed: 71, totalPercentUsed: 60 },
  spendLimitUsage: { totalSpend: 250, individualUsed: 250, individualRemaining: 0, limitType: 'user' },
  enabled: true,
  displayMessage: '',
};
/** A token shaped like Cursor's (a JWT); only its `exp` claim is read. */
const cursorToken = (expiresAt: number) => {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: 'user', exp: Math.floor(expiresAt / 1000) })}.signature`;
};

describe('reading what each vendor reports', () => {
  it('reads Cursor’s included usage and its Auto and API pools for the billing cycle, the way Cursor Agent’s /usage does', () => {
    const resetsAt = new Date(1792592000000).toISOString();
    expect(cursorUsageWindows(cursorAnswer)).toEqual([
      { kind: 'monthly', usedPercent: 60, resetsAt },
      { kind: 'monthly', model: 'Auto', usedPercent: 12.5, resetsAt },
      { kind: 'monthly', model: 'API', usedPercent: 71, resetsAt },
    ]);
    // Without Cursor's own percentage, the included spend against the included limit; without bounds, no reset.
    expect(cursorUsageWindows({ planUsage: { includedSpend: 500, limit: 2000 } })).toEqual([{ kind: 'monthly', usedPercent: 25 }]);
    expect(cursorUsageWindows({ billingCycleEnd: '1792592000000', enabled: true })).toEqual([]);
    expect(tokenExpiry(cursorToken(Date.parse('2026-10-24T00:00:00Z')))).toBe(Date.parse('2026-10-24T00:00:00Z'));
    expect(tokenExpiry('not-a-jwt')).toBeUndefined();
  });

  it('names the day, week and month allowances with the model or pool they are limited to', () => {
    expect(usageWindowLabel({ kind: 'daily', model: 'gemini-2.5-pro', usedPercent: 1 })).toBe('Day · gemini-2.5-pro');
    expect(usageWindowLabel({ kind: 'monthly', model: 'Auto', usedPercent: 1 })).toBe('Month · Auto');
    expect(usageWindowLabel({ kind: 'monthly', usedPercent: 1 })).toBe('Month');
    expect(usageWindowLabel({ kind: 'weekly', model: 'Opus', usedPercent: 1 })).toBe('Week · Opus');
  });

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

type FetchCall = { url: string; authorization: string | null; method?: string; body?: unknown };
type FakeAnswer = { status: number; body?: unknown };

function fakeRuntime(options: {
  status?: unknown;
  /** Returned for every file read, when `files` is not given. */
  credentials?: unknown;
  /** Files by path; a path not listed does not exist. */
  files?: Record<string, unknown>;
  usage?: FakeAnswer;
  /** Answers by URL, for a read that makes more than one request. */
  answers?: Record<string, FakeAnswer>;
  appServer?: unknown[];
  about?: unknown;
  now?: Date;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  keychain?: Record<string, string>;
}) {
  const fetches: FetchCall[] = [];
  const probes: { args: string[]; env?: NodeJS.ProcessEnv }[] = [];
  const reads: string[] = [];
  const keychainReads: string[] = [];
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
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      fetches.push({ url: String(input), authorization: new Headers(init?.headers).get('authorization'), ...(init?.method ? { method: init.method } : {}), ...(body !== undefined ? { body } : {}) });
      const answer = options.answers?.[String(input)] ?? options.usage ?? { status: 200, body: claudeAnswer };
      return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status });
    },
    readText: async path => {
      reads.push(path);
      const content = options.files ? options.files[path] : options.credentials;
      if (content === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return typeof content === 'string' ? content : JSON.stringify(content);
    },
    home: join('home', 'person'),
    now: () => options.now ?? new Date('2026-09-24T11:30:00Z'),
    platform: options.platform ?? 'win32',
    env: options.env ?? {},
    readKeychain: async service => {
      keychainReads.push(service);
      return options.keychain?.[service];
    },
  };
  return { runtime, fetches, probes, reads, keychainReads, appServers };
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
    expect(fake.fetches).toEqual([{ url: 'https://api.anthropic.com/api/oauth/usage?cedar_ember=1', authorization: 'Bearer token-value' }]);
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

  it('reads the Cursor account from about in that account folder, and its usage with the token Cursor Agent saved there', async () => {
    const roaming = join('home', 'person', 'AppData', 'Roaming');
    const folder = join('accounts', 'cursor', 'one');
    const token = cursorToken(Date.parse('2026-10-24T00:00:00Z'));
    const systemToken = cursorToken(Date.parse('2026-10-25T00:00:00Z'));
    const fake = fakeRuntime({
      about: { userEmail: 'an@example.com', subscriptionTier: 'pro' },
      env: { APPDATA: roaming },
      files: {
        [join(folder, 'Cursor', 'auth.json')]: { accessToken: token, refreshToken: 'refresh-value' },
        [join(roaming, 'Cursor', 'auth.json')]: { accessToken: systemToken },
      },
      answers: { [CURSOR_URL]: { status: 200, body: cursorAnswer } },
    });
    const read = await readHarnessUsage('cursor', 'agent.exe', folder, fake.runtime);
    expect(read).toEqual({ email: 'an@example.com', plan: 'Pro', windows: cursorUsageWindows(cursorAnswer) });
    // COD-330: CURSOR_CONFIG_DIR alone does not move Cursor Agent's sign-in; APPDATA does, so the account keeps its own.
    expect(fake.probes[0]).toEqual({ args: ['about', '--format', 'json'], env: { CURSOR_CONFIG_DIR: folder, APPDATA: folder } });
    expect(fake.reads).toEqual([join(folder, 'Cursor', 'auth.json')]);
    expect(fake.fetches).toEqual([{ url: CURSOR_URL, authorization: `Bearer ${token}`, method: 'POST', body: {} }]);
    expect(JSON.stringify(read)).not.toContain(token);
    expect(JSON.stringify(read)).not.toContain('refresh-value');

    // The default account still reads the sign-in Cursor Agent keeps for the computer.
    await readHarnessUsage('cursor', 'agent.exe', undefined, fake.runtime);
    expect(fake.reads.at(-1)).toBe(join(roaming, 'Cursor', 'auth.json'));
    expect(fake.fetches.at(-1)?.authorization).toBe(`Bearer ${systemToken}`);
  });

  it("reads an added Linux account's Cursor sign-in under its own XDG_CONFIG_HOME", async () => {
    const folder = join('accounts', 'cursor', 'linux');
    const token = cursorToken(Date.parse('2026-10-24T00:00:00Z'));
    const fake = fakeRuntime({
      about: { userEmail: 'an@example.com', subscriptionTier: 'pro' },
      platform: 'linux',
      env: { XDG_CONFIG_HOME: join('home', 'person', '.config') },
      files: { [join(folder, 'cursor', 'auth.json')]: { accessToken: token } },
      answers: { [CURSOR_URL]: { status: 200, body: cursorAnswer } },
    });
    expect((await readHarnessUsage('cursor', 'agent', folder, fake.runtime)).windows).toHaveLength(3);
    expect(fake.probes[0].env).toEqual({ CURSOR_CONFIG_DIR: folder, XDG_CONFIG_HOME: folder });
    expect(fake.reads).toEqual([join(folder, 'cursor', 'auth.json')]);
  });

  it('never sends an expired Cursor token, and says why a Cursor account has no usage', async () => {
    const about = { userEmail: 'an@example.com', subscriptionTier: 'pro' };
    const roaming = join('home', 'person', 'AppData', 'Roaming');
    const authFile = join(roaming, 'Cursor', 'auth.json');
    const withAuth = (saved: unknown, answer: FakeAnswer = { status: 200, body: cursorAnswer }) =>
      fakeRuntime({ about, env: { APPDATA: roaming }, files: { [authFile]: saved }, answers: { [CURSOR_URL]: answer } });

    const expired = withAuth({ accessToken: cursorToken(Date.parse('2026-09-24T11:00:00Z')) });
    expect(await readHarnessUsage('cursor', 'agent.exe', undefined, expired.runtime)).toEqual({ email: 'an@example.com', plan: 'Pro', windows: [], unavailable: 'expired' });
    expect(expired.fetches).toEqual([]);

    const apiKey = withAuth({ apiKey: 'key-value' });
    expect(await readHarnessUsage('cursor', 'agent.exe', undefined, apiKey.runtime)).toEqual(expect.objectContaining({ unavailable: 'unsupported' }));
    const refused = withAuth({ accessToken: cursorToken(Date.parse('2026-10-24T00:00:00Z')) }, { status: 401 });
    expect(await readHarnessUsage('cursor', 'agent.exe', undefined, refused.runtime)).toEqual(expect.objectContaining({ unavailable: 'expired' }));
    // A team plan answers with spend and no included usage; Cursor Agent's own /usage has nothing to show either.
    const teamPlan = withAuth({ accessToken: cursorToken(Date.parse('2026-10-24T00:00:00Z')) }, { status: 200, body: { billingCycleEnd: '1792540800000', enabled: true } });
    expect(await readHarnessUsage('cursor', 'agent.exe', undefined, teamPlan.runtime)).toEqual(expect.objectContaining({ unavailable: 'unsupported', email: 'an@example.com' }));
    const missing = fakeRuntime({ about, env: { APPDATA: roaming }, files: {} });
    expect(await readHarnessUsage('cursor', 'agent.exe', undefined, missing.runtime)).toEqual(expect.objectContaining({ unavailable: 'failed' }));

    const signedOut = fakeRuntime({ about: { userEmail: null, subscriptionTier: null } });
    expect(await readHarnessUsage('cursor', 'agent.exe', undefined, signedOut.runtime)).toEqual({ windows: [], unavailable: 'signed_out' });
    expect(signedOut.reads).toEqual([]);
  });

  it('reads Cursor Agent’s token from the macOS Keychain, from CURSOR_AUTH_TOKEN, or from auth.json on Linux', async () => {
    const about = { userEmail: 'an@example.com', subscriptionTier: 'pro' };
    const token = cursorToken(Date.parse('2026-10-24T00:00:00Z'));
    const answers = { [CURSOR_URL]: { status: 200, body: cursorAnswer } };

    const mac = fakeRuntime({ about, platform: 'darwin', keychain: { 'cursor-access-token': token }, answers });
    expect((await readHarnessUsage('cursor', 'agent', undefined, mac.runtime)).windows).toHaveLength(3);
    expect(mac.keychainReads).toEqual(['cursor-access-token']);
    expect(mac.reads).toEqual([]);

    const macFile = fakeRuntime({ about, platform: 'darwin', env: { AGENT_CLI_CREDENTIAL_STORE: 'file' }, files: { [join('home', 'person', '.cursor', 'auth.json')]: { accessToken: token } }, answers });
    expect((await readHarnessUsage('cursor', 'agent', undefined, macFile.runtime)).windows).toHaveLength(3);
    expect(macFile.keychainReads).toEqual([]);

    const linux = fakeRuntime({ about, platform: 'linux', env: { XDG_CONFIG_HOME: join('home', 'person', 'config') }, files: { [join('home', 'person', 'config', 'cursor', 'auth.json')]: { accessToken: token } }, answers });
    expect((await readHarnessUsage('cursor', 'agent', undefined, linux.runtime)).windows).toHaveLength(3);

    const given = fakeRuntime({ about, env: { CURSOR_AUTH_TOKEN: token }, files: {}, answers });
    expect((await readHarnessUsage('cursor', 'agent.exe', undefined, given.runtime)).windows).toHaveLength(3);
    expect(given.reads).toEqual([]);

    const apiKey = fakeRuntime({ about, env: { CURSOR_API_KEY: 'key-value' }, files: {}, answers });
    expect(await readHarnessUsage('cursor', 'agent.exe', undefined, apiKey.runtime)).toEqual(expect.objectContaining({ unavailable: 'unsupported' }));
    expect(apiKey.fetches).toEqual([]);
  });

  it('reads Claude Code’s sign-in from the macOS Keychain when the file holds no token, per account folder', async () => {
    const keychainCredentials = JSON.stringify(claudeCredentials(Date.parse('2026-09-24T16:00:00Z')));
    const folder = '/Users/an/Library/Application Support/Orglet/harness-accounts/claude-code/work';
    const mac = fakeRuntime({
      status: signedInClaude,
      platform: 'darwin',
      keychain: { 'Claude Code-credentials': keychainCredentials, 'Claude Code-credentials-59058fe9': keychainCredentials },
    });
    expect(await readHarnessUsage('claude-code', 'claude', undefined, mac.runtime)).toEqual({ email: 'an@example.com', plan: 'Max 20x', windows: claudeUsageWindows(claudeAnswer) });
    await readHarnessUsage('claude-code', 'claude', folder, mac.runtime);
    expect(mac.keychainReads).toEqual(['Claude Code-credentials', 'Claude Code-credentials-59058fe9']);
    expect(mac.fetches.map(call => call.authorization)).toEqual(['Bearer token-value', 'Bearer token-value']);
    expect(claudeKeychainService(folder)).toBe('Claude Code-credentials-59058fe9');

    // Windows and Linux keep the sign-in in the file only.
    const windows = fakeRuntime({ status: signedInClaude, keychain: { 'Claude Code-credentials': keychainCredentials } });
    expect(await readHarnessUsage('claude-code', 'claude.exe', undefined, windows.runtime)).toEqual(expect.objectContaining({ unavailable: 'unsupported' }));
    expect(windows.keychainReads).toEqual([]);
  });
});

describe('Gemini CLI quota', () => {
  const geminiFolder = join('home', 'person', '.gemini');
  const signedInFiles = (credentials: unknown) => ({
    [join(geminiFolder, 'settings.json')]: { security: { auth: { selectedType: 'oauth-personal' } } },
    [join(geminiFolder, 'google_accounts.json')]: { active: 'an@example.com' },
    [join(geminiFolder, 'oauth_creds.json')]: credentials,
  });
  const loadUrl = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';
  const quotaUrl = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota';
  // Field names from gemini-cli's code_assist/types.ts (LoadCodeAssistResponse, RetrieveUserQuotaResponse).
  const loaded = { currentTier: { id: 'free-tier', name: 'Gemini Code Assist for individuals' }, cloudaicompanionProject: 'project-123' };
  const quota = {
    buckets: [
      { modelId: 'gemini-2.5-pro', remainingFraction: 0.75, resetTime: '2026-09-25T07:00:00Z', tokenType: 'REQUESTS' },
      { modelId: 'gemini-2.5-flash', remainingFraction: 1, resetTime: '2026-09-25T07:00:00Z', tokenType: 'REQUESTS' },
      { modelId: 'gemini-2.5-flash', remainingFraction: 0.9, tokenType: 'TOKENS' },
      { remainingFraction: 0.1 },
    ],
  };

  it('reads each model’s daily allowance with the saved token, and sends it only to Code Assist', async () => {
    const fake = fakeRuntime({
      files: signedInFiles({ access_token: 'google-token', refresh_token: 'google-refresh', expiry_date: Date.parse('2026-09-24T12:00:00Z') }),
      answers: { [loadUrl]: { status: 200, body: loaded }, [quotaUrl]: { status: 200, body: quota } },
    });
    const read = await readHarnessUsage('gemini', 'gemini.cmd', undefined, fake.runtime);
    expect(read).toEqual({
      email: 'an@example.com',
      plan: 'Gemini Code Assist for individuals',
      windows: [
        { kind: 'daily', model: 'gemini-2.5-pro', usedPercent: 25, resetsAt: '2026-09-25T07:00:00.000Z' },
        { kind: 'daily', model: 'gemini-2.5-flash', usedPercent: expect.closeTo(10, 5) },
      ],
    });
    expect(fake.fetches.map(call => [call.url, call.authorization])).toEqual([[loadUrl, 'Bearer google-token'], [quotaUrl, 'Bearer google-token']]);
    expect(fake.fetches[1].body).toEqual({ project: 'project-123' });
    expect(JSON.stringify(read)).not.toMatch(/google-token|google-refresh/);
  });

  it('leaves an expired token to Gemini CLI, and an account it has not set up yet alone', async () => {
    const expired = fakeRuntime({ files: signedInFiles({ access_token: 'google-token', expiry_date: Date.parse('2026-09-24T11:00:00Z') }) });
    expect(await readHarnessUsage('gemini', 'gemini.cmd', undefined, expired.runtime)).toEqual({ email: 'an@example.com', windows: [], unavailable: 'expired' });
    expect(expired.fetches).toEqual([]);

    const refreshOnly = fakeRuntime({ files: signedInFiles({ refresh_token: 'google-refresh' }) });
    expect(await readHarnessUsage('gemini', 'gemini.cmd', undefined, refreshOnly.runtime)).toEqual(expect.objectContaining({ unavailable: 'expired' }));

    const notSetUp = fakeRuntime({
      files: signedInFiles({ access_token: 'google-token', expiry_date: Date.parse('2026-09-24T12:00:00Z') }),
      answers: { [loadUrl]: { status: 200, body: { allowedTiers: [{ id: 'free-tier', isDefault: true }] } } },
    });
    expect(await readHarnessUsage('gemini', 'gemini.cmd', undefined, notSetUp.runtime)).toEqual({ email: 'an@example.com', windows: [], unavailable: 'unsupported' });
    expect(notSetUp.fetches.map(call => call.url)).toEqual([loadUrl]);

    const apiKey = fakeRuntime({ files: { [join(geminiFolder, 'settings.json')]: { security: { auth: { selectedType: 'gemini-api-key' } } } } });
    expect(await readHarnessUsage('gemini', 'gemini.cmd', undefined, apiKey.runtime)).toEqual({ windows: [], unavailable: 'unsupported' });
    expect(apiKey.fetches).toEqual([]);
  });

  it('names the plan from the paid tier and keeps the project Gemini CLI was told to use', () => {
    expect(geminiTier({ currentTier: { name: 'Standard' }, paidTier: { name: 'Google AI Pro' } }, 'my-project')).toEqual({ project: 'my-project', plan: 'Google AI Pro' });
    expect(geminiTier({ allowedTiers: [] }, 'my-project')).toEqual({});
    expect(geminiUsageWindows({ buckets: 'nope' })).toEqual([]);
  });
});

describe('OpenCode Go usage', () => {
  // The body `GET /zen/go/v1/usage` sends (packages/console/app/src/routes/zen/go/v1/usage.ts in the opencode repo).
  const goAnswer = {
    usage: {
      rolling: { status: 'ok', percent: 12, resetsAt: '2026-09-24T15:00:00.000Z' },
      weekly: { status: 'ok', percent: 40, resetsAt: '2026-09-28T00:00:00.000Z' },
      monthly: { status: 'rate-limited', percent: 100, resetsAt: '2026-10-10T00:00:00.000Z' },
    },
  };

  it('names the five-hour, weekly and monthly allowances by their length', () => {
    expect(openCodeGoUsageWindows(goAnswer)).toEqual([
      { kind: 'session', usedPercent: 12, resetsAt: '2026-09-24T15:00:00.000Z' },
      { kind: 'weekly', usedPercent: 40, resetsAt: '2026-09-28T00:00:00.000Z' },
      { kind: 'monthly', usedPercent: 100, resetsAt: '2026-10-10T00:00:00.000Z' },
    ]);
    expect(openCodeGoUsageWindows({ type: 'error' })).toEqual([]);
  });

  it('reads with the saved Go key, sends it only to OpenCode Go, and says when the key has no Go plan', async () => {
    const store = new Store(':memory:');
    try {
      const calls: { url: string; authorization: string | null }[] = [];
      let status = 200;
      const request: typeof fetch = async (input, init) => {
        calls.push({ url: String(input), authorization: new Headers(init?.headers).get('authorization') });
        return new Response(JSON.stringify(status === 200 ? goAnswer : { type: 'error' }), { status });
      };
      let key: string | null = 'go-key-value';
      const core = new CoreService(store, () => {}, async () => { throw new Error('unused'); }, undefined, () => new Date('2026-09-24T12:00:00Z'), {
        detect: async () => [], execute: async () => { throw new Error('unused'); },
      }, undefined, { readKey: async provider => provider === 'opencode-go' ? key : null, fetch: request });

      const found = await core.command('openCodeGoUsage', { refresh: true }) as OpenCodeGoUsage;
      expect(found).toEqual({ windows: openCodeGoUsageWindows(goAnswer), checkedAt: '2026-09-24T12:00:00.000Z' });
      expect(calls).toEqual([{ url: 'https://opencode.ai/zen/go/v1/usage', authorization: 'Bearer go-key-value' }]);
      expect(JSON.stringify(found)).not.toContain('go-key-value');
      await core.command('openCodeGoUsage', { refresh: false });
      expect(calls).toHaveLength(1);

      status = 403;
      expect(await core.command('openCodeGoUsage', { refresh: true })).toEqual(expect.objectContaining({ windows: [], unavailable: 'unsupported' }));
      status = 500;
      expect(await core.command('openCodeGoUsage', { refresh: true })).toEqual(expect.objectContaining({ unavailable: 'failed' }));
      key = null;
      expect(await core.command('openCodeGoUsage', { refresh: true })).toEqual(expect.objectContaining({ unavailable: 'signed_out' }));
      expect(calls).toHaveLength(3);
    } finally {
      store.close();
    }
  });

  it('reads as failed when OpenCode Go cannot be reached', async () => {
    expect(await readOpenCodeGoUsage('go-key-value', async () => { throw new Error('offline'); })).toEqual({ windows: [], unavailable: 'failed' });
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

  it('keeps a Gemini CLI daily reading for when its token has expired', () => {
    const readings = new UsageReadings(store);
    const daily: HarnessAccountUsage = { ...fresh, plan: undefined, windows: [{ kind: 'daily', model: 'gemini-2.5-pro', usedPercent: 25, resetsAt: '2026-09-28T07:00:00.000Z' }] };
    readings.settle('gemini', daily, new Date('2026-09-27T00:05:00Z'));
    const later = readings.settle('gemini', { ...expired('2026-09-27T02:00:00.000Z'), plan: undefined }, new Date('2026-09-27T02:00:00Z'));
    expect(later).toEqual(expect.objectContaining({ unavailable: 'expired', windows: daily.windows, asOf: fresh.checkedAt }));
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
