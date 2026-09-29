import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { HarnessAccountUsage, HarnessBankedResets, HarnessCatalogId, HarnessResetOutcome, HarnessUsageGap, HarnessUsageWindow } from '../../shared/harness';
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
const CLAUDE_API_ORIGIN = 'https://api.anthropic.com';
/**
 * The endpoint Claude Code's own `/usage` reads, asking for the plan's banked resets too (COD-328). The token only
 * ever goes to this origin, and never leaves the core.
 */
const CLAUDE_USAGE_URL = `${CLAUDE_API_ORIGIN}/api/oauth/usage?cedar_ember=1`;
const CLAUDE_OAUTH_HEADERS = { 'anthropic-beta': 'oauth-2025-04-20' };
/** Claude's name for the banked-reset program, sent with every claim. */
const RESET_PROGRAM = 'cedar_ember';
const RESET_CLAIM_TIMEOUT_MS = 25_000;
/** Checked before a grant or organization id goes into a request, so a strange answer is never echoed into a URL. */
const GRANT_ID_PATTERN = /^[a-z0-9_-]{1,40}$/;
const ORGANIZATION_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

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

/** One grant of the banked-reset block, when it is well formed. */
type ResetGrant = { id: string; resetsLeft: number; expiresAt?: string; usable: boolean };

function readResetGrant(value: unknown, now: Date): ResetGrant | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !GRANT_ID_PATTERN.test(value.id)) return undefined;
  if (typeof value.resets_left !== 'number' || !Number.isInteger(value.resets_left) || value.resets_left < 0) return undefined;
  // A grant without an end date keeps; one whose date does not parse is not trusted to be usable.
  const hasEnd = value.ends_at !== undefined && value.ends_at !== null;
  const expiresAt = hasEnd ? isoDate(value.ends_at) : undefined;
  const current = !hasEnd || (expiresAt !== undefined && Date.parse(expiresAt) > now.getTime());
  const usable = value.paused !== true && value.usable_now === true && current;
  return { id: value.id, resetsLeft: value.resets_left, ...(expiresAt ? { expiresAt } : {}), usable };
}

/** The resets a claim can spend now: how many there are together, the grant Claude says goes next, and when it ends. */
export type ClaudeBankedResets = HarnessBankedResets & { grantId: string };

/**
 * The banked resets in Claude's usage answer (its `cedar_ember` block, COD-328). Paused grants, grants not usable yet
 * and grants past their end do not count, and without a usable next grant nothing can be claimed, so none is shown.
 */
export function claudeBankedResets(answer: unknown, now: Date): ClaudeBankedResets | undefined {
  if (!isRecord(answer) || !isRecord(answer.cedar_ember)) return undefined;
  const program = answer.cedar_ember;
  if (program.eligible !== true || !Array.isArray(program.grants)) return undefined;
  const usable: ResetGrant[] = [];
  for (const value of program.grants) {
    const grant = readResetGrant(value, now);
    if (grant?.usable) usable.push(grant);
  }
  const next = usable.find(grant => grant.id === program.next_grant_id);
  if (!next || next.resetsLeft < 1) return undefined;
  const count = usable.reduce((total, grant) => total + grant.resetsLeft, 0);
  return { count, grantId: next.id, ...(next.expiresAt ? { expiresAt: next.expiresAt } : {}) };
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

/** The saved sign-in in one Claude Code folder: the token and whether it has expired. Never written to. */
async function readClaudeToken(folder: string, runtime: UsageRuntime) {
  const credentials = parseJson(await runtime.readText(join(folder, '.credentials.json')).catch(() => ''));
  const oauth = isRecord(credentials) && isRecord(credentials.claudeAiOauth) ? credentials.claudeAiOauth : undefined;
  const token = text(oauth?.accessToken);
  const expired = typeof oauth?.expiresAt === 'number' && oauth.expiresAt <= runtime.now().getTime();
  return { oauth, token, expired };
}

const claudeFolder = (configDir: string | undefined, runtime: UsageRuntime) => configDir ?? join(runtime.home, '.claude');

async function readClaude(executable: string, configDir: string | undefined, runtime: UsageRuntime): Promise<AccountUsageRead> {
  const status = parseJson((await runtime.run(executable, ['auth', 'status'], harnessAccountEnv('claude-code', configDir))).stdout);
  if (!isRecord(status)) return gap('failed');
  if (status.loggedIn !== true) return gap('signed_out');
  const email = text(status.email);
  const account = { ...(email ? { email } : {}) };
  // A key or a cloud provider has no plan allowance to report.
  if (status.authMethod !== 'claude.ai') return gap('unsupported', account);

  const { oauth, token, expired } = await readClaudeToken(claudeFolder(configDir, runtime), runtime);
  const plan = claudePlanLabel(status.subscriptionType ?? oauth?.subscriptionType, oauth?.rateLimitTier);
  const signedIn = { ...account, ...(plan ? { plan } : {}) };
  // macOS keeps the sign-in in the Keychain rather than this file; the account is still named.
  if (!token) return gap('unsupported', signedIn);
  // Claude Code renews the token when it runs; Orglet never writes to its credentials.
  if (expired) return gap('expired', signedIn);

  try {
    const response = await fetchClaudeUsage(token, runtime);
    if (response.status === 401) return gap('expired', signedIn);
    if (!response.ok) return gap('failed', signedIn);
    const answer: unknown = await response.json();
    const bankedResets = shownResets(claudeBankedResets(answer, runtime.now()));
    return { ...signedIn, windows: claudeUsageWindows(answer), ...(bankedResets ? { bankedResets } : {}) };
  } catch {
    return gap('failed', signedIn);
  }
}

/** What the window may see of the banked resets: the count and the end date, never the grant id. */
function shownResets(resets: ClaudeBankedResets | undefined): HarnessBankedResets | undefined {
  if (!resets) return undefined;
  return { count: resets.count, ...(resets.expiresAt ? { expiresAt: resets.expiresAt } : {}) };
}

const fetchClaudeUsage = (token: string, runtime: UsageRuntime) => runtime.fetch(CLAUDE_USAGE_URL, {
  headers: { Authorization: `Bearer ${token}`, ...CLAUDE_OAUTH_HEADERS },
  signal: AbortSignal.timeout(USAGE_REQUEST_TIMEOUT_MS),
});

/**
 * The organization a Claude Code sign-in belongs to, which a claim names. Claude Code keeps it in `.claude.json`: in
 * the account folder when one is set, in the home folder for the system account.
 */
async function readClaudeOrganization(configDir: string | undefined, runtime: UsageRuntime): Promise<string | undefined> {
  const file = configDir ? join(configDir, '.claude.json') : join(runtime.home, '.claude.json');
  const account = parseJson(await runtime.readText(file).catch(() => ''));
  const organization = isRecord(account) && isRecord(account.oauthAccount) ? text(account.oauthAccount.organizationUuid) : undefined;
  return organization && ORGANIZATION_ID_PATTERN.test(organization) ? organization : undefined;
}

/** How Claude answered a claim it received, in Orglet's words. `unavailable` means it could not say whether it landed. */
const CLAIM_ANSWERS: Record<string, HarnessResetOutcome> = {
  reset: 'reset',
  not_limited: 'not_limited',
  already_used: 'already_used',
  ineligible: 'none_left',
  cooldown: 'cooling_down',
  unavailable: 'unconfirmed',
};

/** Reads the grant a claim should spend now; an outcome instead when there is none or the read did not work. */
async function nextResetGrant(token: string, runtime: UsageRuntime): Promise<{ grantId: string } | { outcome: HarnessResetOutcome }> {
  try {
    const usage = await fetchClaudeUsage(token, runtime);
    if (usage.status === 401) return { outcome: 'expired' };
    if (!usage.ok) return { outcome: 'failed' };
    const resets = claudeBankedResets(await usage.json(), runtime.now());
    return resets ? { grantId: resets.grantId } : { outcome: 'none_left' };
  } catch {
    return { outcome: 'failed' };
  }
}

/** What Claude said about a claim it was sent. Anything that may have come after the claim landed is `no_answer`. */
async function claimAnswer(response: Response): Promise<HarnessResetOutcome> {
  if (response.status === 401 || response.status === 403) return 'expired';
  if (response.status === 429) return 'rate_limited';
  if (response.status >= 500) return 'no_answer';
  // A refusal of the request itself spent nothing.
  if (!response.ok) return 'failed';
  try {
    const answer: unknown = await response.json();
    const result = isRecord(answer) && typeof answer.result === 'string' ? CLAIM_ANSWERS[answer.result] : undefined;
    return result ?? 'no_answer';
  } catch {
    return 'no_answer';
  }
}

/**
 * Spends one banked reset of the Claude account in one folder (COD-328), only ever because the person confirmed it.
 * The usage answer is read first, so the claim names the grant Claude says goes next, not one from an older reading.
 * `requestId` makes the claim safe to send again: a retry with the same id is the same claim. An expired token is
 * never sent, and nothing here renews it.
 */
export async function claimClaudeReset(configDir: string | undefined, requestId: string, runtime: UsageRuntime = localUsageRuntime()): Promise<HarnessResetOutcome> {
  const { token, expired } = await readClaudeToken(claudeFolder(configDir, runtime), runtime);
  if (!token) return 'unreadable';
  if (expired) return 'expired';
  const organization = await readClaudeOrganization(configDir, runtime);
  if (!organization) return 'unreadable';
  const next = await nextResetGrant(token, runtime);
  if ('outcome' in next) return next.outcome;
  try {
    const response = await runtime.fetch(`${CLAUDE_API_ORIGIN}/api/organizations/${organization}/reset_rate_limits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...CLAUDE_OAUTH_HEADERS },
      body: JSON.stringify({ program: RESET_PROGRAM, grant_id: next.grantId, request_id: requestId }),
      signal: AbortSignal.timeout(RESET_CLAIM_TIMEOUT_MS),
    });
    return await claimAnswer(response);
  } catch {
    return 'no_answer';
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
