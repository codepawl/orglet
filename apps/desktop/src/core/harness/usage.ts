import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { HarnessAccountUsage, HarnessCatalogId, HarnessUsageGap, HarnessUsageWindow } from '../../shared/harness';
import { cleanEnv, commandLine, harnessAccountEnv, probe, type Probe } from './detect';
import { geminiHome, readGeminiSignIn } from './gemini';

/** What one account's read found, before the service stamps it with the account and the time. */
export type AccountUsageRead = Omit<HarnessAccountUsage, 'accountId' | 'checkedAt'>;

/** A `codex app-server` session: sends JSON-RPC requests in order and returns each result, or undefined on error. */
export type CodexAppServer = (executable: string, env: NodeJS.ProcessEnv, requests: { method: string; params?: unknown }[]) => Promise<unknown[]>;

export type UsageRuntime = {
  run: Probe;
  appServer: CodexAppServer;
  fetch: typeof fetch;
  readText: (path: string) => Promise<string>;
  home: string;
  now: () => Date;
  /** Variables a CLI reads its sign-in from (Gemini CLI's GEMINI_CLI_HOME and API key); none when left out. */
  env?: NodeJS.ProcessEnv;
};

const SESSION_MINUTES = 5 * 60;
const WEEK_MINUTES = 7 * 24 * 60;
const MONTH_MINUTES = 30 * 24 * 60;
const APP_SERVER_TIMEOUT_MS = 30_000;
const USAGE_REQUEST_TIMEOUT_MS = 10_000;
/** The endpoint Claude Code's own `/usage` reads. The token only ever goes here, and never leaves the core. */
const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const clampPercent = (value: number) => Math.min(100, Math.max(0, value));
const gap = (unavailable: HarnessUsageGap, account: Pick<AccountUsageRead, 'email' | 'plan'> = {}): AccountUsageRead => ({ ...account, windows: [], unavailable });

function isoDate(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return new Date(value * 1000).toISOString();
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/**
 * Claude's usage answer. The newer `limits` list names every allowance, including the weekly one a single model
 * has; older answers only carry `five_hour` and `seven_day` (and a weekly Opus or Sonnet one), so those are read
 * when the list is missing.
 */
export function claudeUsageWindows(answer: unknown): HarnessUsageWindow[] {
  if (!isRecord(answer)) return [];
  if (Array.isArray(answer.limits)) {
    const windows: HarnessUsageWindow[] = [];
    for (const limit of answer.limits) {
      if (!isRecord(limit) || typeof limit.percent !== 'number') continue;
      const resetsAt = isoDate(limit.resets_at);
      const base = { usedPercent: clampPercent(limit.percent), ...(resetsAt ? { resetsAt } : {}) };
      if (limit.kind === 'session') windows.push({ kind: 'session', ...base });
      else if (limit.kind === 'weekly_all') windows.push({ kind: 'weekly', ...base });
      else if (limit.kind === 'weekly_scoped') {
        const scope = isRecord(limit.scope) && isRecord(limit.scope.model) ? limit.scope.model : undefined;
        const model = text(scope?.display_name);
        if (model) windows.push({ kind: 'weekly', model, ...base });
      }
    }
    return windows;
  }
  const named: [string, HarnessUsageWindow['kind'], string | undefined][] = [
    ['five_hour', 'session', undefined],
    ['seven_day', 'weekly', undefined],
    ['seven_day_opus', 'weekly', 'Opus'],
    ['seven_day_sonnet', 'weekly', 'Sonnet'],
  ];
  const windows: HarnessUsageWindow[] = [];
  for (const [field, kind, model] of named) {
    const window = answer[field];
    if (!isRecord(window) || typeof window.utilization !== 'number') continue;
    const resetsAt = isoDate(window.resets_at);
    windows.push({ kind, ...(model ? { model } : {}), usedPercent: clampPercent(window.utilization), ...(resetsAt ? { resetsAt } : {}) });
  }
  return windows;
}

/** "max" with the tier "default_claude_max_20x" is Max 20x; a tier without a multiplier leaves the plan name alone. */
export function claudePlanLabel(subscriptionType: unknown, rateLimitTier?: unknown): string | undefined {
  const plan = text(subscriptionType);
  if (!plan) return undefined;
  const name = plan.charAt(0).toUpperCase() + plan.slice(1);
  const multiplier = typeof rateLimitTier === 'string' ? /_(\d+x)$/i.exec(rateLimitTier)?.[1] : undefined;
  return multiplier ? `${name} ${multiplier.toLowerCase()}` : name;
}

/**
 * Codex's `primary` and `secondary` are positions, not durations. The duration comes with them; without it a paid
 * plan's pair is the five-hour and the weekly allowance, and Free or Go has one monthly allowance. Only the plan's
 * own `codex` limit counts: a model-specific one must not stand in for it.
 */
export function codexUsageWindows(rateLimits: unknown): HarnessUsageWindow[] {
  if (!isRecord(rateLimits)) return [];
  const snapshot = isRecord(rateLimits.rateLimits) ? rateLimits.rateLimits : rateLimits;
  if (typeof snapshot.limitId === 'string' && snapshot.limitId !== 'codex') return [];
  const monthlyPlan = snapshot.planType === 'free' || snapshot.planType === 'go';
  const positions: [unknown, number][] = [
    [snapshot.primary, monthlyPlan ? MONTH_MINUTES : SESSION_MINUTES],
    [snapshot.secondary, WEEK_MINUTES],
  ];
  const windows: HarnessUsageWindow[] = [];
  for (const [window, fallbackMinutes] of positions) {
    if (!isRecord(window) || typeof window.usedPercent !== 'number') continue;
    const minutes = typeof window.windowDurationMins === 'number' ? window.windowDurationMins : fallbackMinutes;
    const kind = minutes >= MONTH_MINUTES ? 'monthly' : minutes >= WEEK_MINUTES ? 'weekly' : 'session';
    const resetsAt = isoDate(window.resetsAt);
    windows.push({ kind, usedPercent: clampPercent(window.usedPercent), ...(resetsAt ? { resetsAt } : {}) });
  }
  return windows;
}

/** The plan slugs Codex reports, named the way ChatGPT names them. An unknown slug is shown as it came. */
export function codexPlanLabel(planType: unknown): string | undefined {
  const slug = text(planType);
  if (!slug) return undefined;
  const planNames: Record<string, string> = {
    free: 'ChatGPT Free',
    go: 'ChatGPT Go',
    plus: 'ChatGPT Plus',
    pro: 'ChatGPT Pro 20x',
    prolite: 'ChatGPT Pro 5x',
    team: 'ChatGPT Team',
    business: 'ChatGPT Business',
    enterprise: 'ChatGPT Enterprise',
    edu: 'ChatGPT Edu',
  };
  if (planNames[slug]) return planNames[slug];
  if (slug.includes('business')) return planNames.business;
  if (slug.startsWith('ent')) return planNames.enterprise;
  if (slug.startsWith('edu')) return planNames.edu;
  return slug === 'unknown' ? 'ChatGPT' : slug;
}

/** `agent about --format json`: the signed-in address and plan tier. A null address means signed out. */
export function cursorAbout(output: string): AccountUsageRead {
  const about = parseJson(output);
  if (!isRecord(about)) return gap('failed');
  const email = text(about.userEmail);
  if (!email) return about.userEmail === null ? gap('signed_out') : gap('failed');
  const tier = text(about.subscriptionTier);
  const plan = tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : undefined;
  return gap('unsupported', { email, ...(plan ? { plan } : {}) });
}

async function readClaude(executable: string, configDir: string | undefined, runtime: UsageRuntime): Promise<AccountUsageRead> {
  const status = parseJson((await runtime.run(executable, ['auth', 'status'], harnessAccountEnv('claude-code', configDir))).stdout);
  if (!isRecord(status)) return gap('failed');
  if (status.loggedIn !== true) return gap('signed_out');
  const email = text(status.email);
  const account = { ...(email ? { email } : {}) };
  // A key or a cloud provider has no plan allowance to report.
  if (status.authMethod !== 'claude.ai') return gap('unsupported', account);

  const folder = configDir ?? join(runtime.home, '.claude');
  const credentials = parseJson(await runtime.readText(join(folder, '.credentials.json')).catch(() => ''));
  const oauth = isRecord(credentials) && isRecord(credentials.claudeAiOauth) ? credentials.claudeAiOauth : undefined;
  const plan = claudePlanLabel(status.subscriptionType ?? oauth?.subscriptionType, oauth?.rateLimitTier);
  const signedIn = { ...account, ...(plan ? { plan } : {}) };
  const token = text(oauth?.accessToken);
  // macOS keeps the sign-in in the Keychain rather than this file; the account is still named.
  if (!token) return gap('unsupported', signedIn);
  // Claude Code renews the token when it runs; Orglet never writes to its credentials.
  if (typeof oauth?.expiresAt === 'number' && oauth.expiresAt <= runtime.now().getTime()) return gap('expired', signedIn);

  try {
    const response = await runtime.fetch(CLAUDE_USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(USAGE_REQUEST_TIMEOUT_MS),
    });
    if (response.status === 401) return gap('expired', signedIn);
    if (!response.ok) return gap('failed', signedIn);
    return { ...signedIn, windows: claudeUsageWindows(await response.json()) };
  } catch {
    return gap('failed', signedIn);
  }
}

async function readCodex(executable: string, configDir: string | undefined, runtime: UsageRuntime): Promise<AccountUsageRead> {
  const [accountAnswer, limitsAnswer] = await runtime.appServer(executable, harnessAccountEnv('codex', configDir), [
    { method: 'account/read', params: { refreshToken: false } },
    { method: 'account/rateLimits/read' },
  ]);
  if (!isRecord(accountAnswer)) return gap('failed');
  const account = accountAnswer.account;
  if (!isRecord(account)) return gap('signed_out');
  if (account.type !== 'chatgpt') return gap('unsupported');
  const email = text(account.email);
  const plan = codexPlanLabel(account.planType);
  const signedIn = { ...(email ? { email } : {}), ...(plan ? { plan } : {}) };
  if (!isRecord(limitsAnswer)) return gap('failed', signedIn);
  return { ...signedIn, windows: codexUsageWindows(limitsAnswer) };
}

async function readCursor(executable: string, configDir: string | undefined, runtime: UsageRuntime): Promise<AccountUsageRead> {
  const result = await runtime.run(executable, ['about', '--format', 'json'], harnessAccountEnv('cursor', configDir));
  return cursorAbout(result.stdout);
}

/** Gemini CLI names the signed-in Google account in its own folder, but reports no plan allowance outside its window. */
async function readGemini(configDir: string | undefined, runtime: UsageRuntime): Promise<AccountUsageRead> {
  const environment = runtime.env ?? {};
  const signIn = await readGeminiSignIn(geminiHome(configDir, environment, runtime.home), environment, runtime.readText);
  if (signIn.state === 'unreadable') return gap('failed');
  if (signIn.state === 'signed_out') return gap('signed_out');
  return gap('unsupported', signIn.email ? { email: signIn.email } : {});
}

/** Who is signed in to one account folder of one harness, on which plan, and how much of that plan is used. */
export async function readHarnessUsage(harness: HarnessCatalogId, executable: string, configDir: string | undefined, runtime: UsageRuntime = localUsageRuntime()): Promise<AccountUsageRead> {
  try {
    if (harness === 'claude-code') return await readClaude(executable, configDir, runtime);
    if (harness === 'codex') return await readCodex(executable, configDir, runtime);
    if (harness === 'gemini') return await readGemini(configDir, runtime);
    return await readCursor(executable, configDir, runtime);
  } catch {
    return gap('failed');
  }
}

/**
 * Starts `codex app-server`, initializes it, sends the requests and collects their results. Closing stdin ends the
 * server; the kill after the timeout is only for one that hangs.
 */
export const codexAppServer: CodexAppServer = (executable, env, requests) => new Promise(resolve => {
  const command = commandLine(executable, ['app-server']);
  const child = spawn(command.file, command.args, {
    windowsHide: true,
    windowsVerbatimArguments: command.verbatim,
    env: { ...cleanEnv(process.env), ...env },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const results: unknown[] = new Array(requests.length).fill(undefined);
  let pending = requests.length;
  let buffered = '';
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    child.stdin.end();
    setTimeout(() => { if (child.exitCode === null) child.kill(); }, 2_000).unref();
    resolve(results);
  };
  const timer = setTimeout(finish, APP_SERVER_TIMEOUT_MS);
  const send = (message: unknown) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message as object })}\n`);
  child.on('error', finish);
  child.on('exit', finish);
  child.stdin.on('error', finish);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffered += chunk;
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf('\n');
      const message = parseJson(line);
      if (!isRecord(message) || typeof message.id !== 'number') continue;
      if (message.id === 0) {
        send({ method: 'initialized' });
        requests.forEach((request, index) => send({ id: index + 1, ...request }));
        continue;
      }
      const index = message.id - 1;
      if (index < 0 || index >= requests.length) continue;
      results[index] = message.result;
      pending -= 1;
      if (pending === 0) finish();
    }
  });
  send({ id: 0, method: 'initialize', params: { clientInfo: { name: 'orglet', title: 'Orglet', version: '0' } } });
});

export const localUsageRuntime = (): UsageRuntime => ({
  run: probe,
  appServer: codexAppServer,
  fetch: (input, init) => fetch(input, init),
  readText: path => readFile(path, 'utf8'),
  home: homedir(),
  now: () => new Date(),
  env: process.env,
});
