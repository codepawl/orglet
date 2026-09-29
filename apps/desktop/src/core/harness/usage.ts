import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { HarnessAccountUsage, HarnessBankedResets, HarnessCatalogId, HarnessResetOutcome, HarnessUsageGap, HarnessUsageWindow } from '../../shared/harness';
import { cleanEnv, commandLine, harnessAccountEnv, probe, type Probe } from './detect';
import { GEMINI_GOOGLE_SIGN_IN, geminiHome, readGeminiSignIn } from './gemini';

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
  /** Where the CLIs keep their sign-in depends on it; this machine's when left out. */
  platform?: NodeJS.Platform;
  /** One macOS Keychain password by its service name, or undefined when there is none; no Keychain when left out. */
  readKeychain?: (service: string) => Promise<string | undefined>;
};

const SESSION_MINUTES = 5 * 60;
const WEEK_MINUTES = 7 * 24 * 60;
const MONTH_MINUTES = 30 * 24 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
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
const KEYCHAIN_TIMEOUT_MS = 10_000;
// Each token goes only to the service that issued it, and never leaves the core.
/** The call Cursor Agent's own `/usage` makes (Connect protocol, JSON). */
const CURSOR_USAGE_URL = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
/** Gemini CLI's Code Assist API: `loadCodeAssist` names the account's project and tier, `retrieveUserQuota` its quota. */
const CODE_ASSIST_URL = 'https://cloudcode-pa.googleapis.com/v1internal';
/** Claude Code's Keychain item on macOS; an account folder's item carries a suffix made from the folder. */
const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials';
/** Cursor Agent's access token on macOS, kept by its credential store for the "cursor" domain. */
const CURSOR_KEYCHAIN_SERVICE = 'cursor-access-token';

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

type VendorAnswer = { answer: unknown } | { gap: HarnessUsageGap };

/** One request with the account's token. A refused token reads as expired: the CLI renews it when it next runs. */
async function askVendor(runtime: UsageRuntime, url: string, token: string, request: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<VendorAnswer> {
  try {
    const response = await runtime.fetch(url, {
      ...request,
      headers: { ...request.headers, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(USAGE_REQUEST_TIMEOUT_MS),
    });
    if (response.status === 401) return { gap: 'expired' };
    if (!response.ok) return { gap: 'failed' };
    return { answer: await response.json() };
  } catch {
    return { gap: 'failed' };
  }
}

const jsonPost = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** When a JWT stops being accepted, from its `exp` claim. The signature is not checked: this only decides whether to send it. */
export function tokenExpiry(token: string): number | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  const claims = parseJson(Buffer.from(payload, 'base64url').toString('utf8'));
  return isRecord(claims) && typeof claims.exp === 'number' ? claims.exp * 1000 : undefined;
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

/** The saved sign-in of one Claude Code account (file, or Keychain on macOS): the token and whether it has expired. Never written to. */
async function readClaudeToken(configDir: string | undefined, runtime: UsageRuntime) {
  const oauth = await claudeSignIn(configDir, runtime);
  const token = text(oauth?.accessToken);
  const expired = typeof oauth?.expiresAt === 'number' && oauth.expiresAt <= runtime.now().getTime();
  return { oauth, token, expired };
}

/**
 * The account's Claude Code access token while it is still valid, for a read-only call to api.anthropic.com (the model
 * list, COD-332); undefined for a key or cloud sign-in, a missing file or an expired token. Orglet never renews it.
 */
export async function claudeAccessToken(configDir: string | undefined, runtime: UsageRuntime = localUsageRuntime()): Promise<string | undefined> {
  const { token, expired } = await readClaudeToken(configDir, runtime);
  return expired ? undefined : token;
}

async function readClaude(executable: string, configDir: string | undefined, runtime: UsageRuntime): Promise<AccountUsageRead> {
  const status = parseJson((await runtime.run(executable, ['auth', 'status'], harnessAccountEnv('claude-code', configDir))).stdout);
  if (!isRecord(status)) return gap('failed');
  if (status.loggedIn !== true) return gap('signed_out');
  const email = text(status.email);
  const account = { ...(email ? { email } : {}) };
  // A key or a cloud provider has no plan allowance to report.
  if (status.authMethod !== 'claude.ai') return gap('unsupported', account);

  const { oauth, token, expired } = await readClaudeToken(configDir, runtime);
  const plan = claudePlanLabel(status.subscriptionType ?? oauth?.subscriptionType, oauth?.rateLimitTier);
  const signedIn = { ...account, ...(plan ? { plan } : {}) };
  // Neither the file nor the Keychain holds a token Orglet can read; the account is still named.
  if (!token) return gap('unsupported', signedIn);
  // Claude Code renews the token when it runs; Orglet never writes to its credentials.
  if (expired) return gap('expired', signedIn);

  const found = await askVendor(runtime, CLAUDE_USAGE_URL, token, { headers: CLAUDE_OAUTH_HEADERS });
  if ('gap' in found) return gap(found.gap, signedIn);
  const bankedResets = shownResets(claudeBankedResets(found.answer, runtime.now()));
  return { ...signedIn, windows: claudeUsageWindows(found.answer), ...(bankedResets ? { bankedResets } : {}) };
}

/**
 * Claude Code's saved sign-in (`claudeAiOauth`): the account folder's `.credentials.json`, or on macOS, where that file
 * holds no token, its Keychain item.
 */
async function claudeSignIn(configDir: string | undefined, runtime: UsageRuntime): Promise<Record<string, unknown> | undefined> {
  const folder = configDir ?? join(runtime.home, '.claude');
  const saved = claudeOauth(await runtime.readText(join(folder, '.credentials.json')).catch(() => ''));
  if (text(saved?.accessToken) || (runtime.platform ?? process.platform) !== 'darwin' || !runtime.readKeychain) return saved;
  const kept = claudeOauth(await runtime.readKeychain(claudeKeychainService(configDir)).catch(() => undefined) ?? '');
  return kept ?? saved;
}

const claudeOauth = (credentials: string) => {
  const parsed = parseJson(credentials);
  return isRecord(parsed) && isRecord(parsed.claudeAiOauth) ? parsed.claudeAiOauth : undefined;
};

/**
 * The Keychain service Claude Code saves its sign-in under. With CLAUDE_CONFIG_DIR set it appends the first eight hex
 * digits of the SHA-256 of that folder (NFC-normalized), so each account folder has its own item (read from Claude
 * Code 2.1.283).
 */
export function claudeKeychainService(configDir: string | undefined): string {
  const folder = configDir?.trim();
  if (!folder) return CLAUDE_KEYCHAIN_SERVICE;
  const digest = createHash('sha256').update(folder.normalize('NFC')).digest('hex');
  return `${CLAUDE_KEYCHAIN_SERVICE}-${digest.slice(0, 8)}`;
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
  const { token, expired } = await readClaudeToken(configDir, runtime);
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

/**
 * `agent about` names the account and its plan; the included usage comes from the call Cursor Agent's own `/usage`
 * makes, with the access token Cursor Agent saved.
 */
async function readCursor(executable: string, configDir: string | undefined, runtime: UsageRuntime): Promise<AccountUsageRead> {
  const result = await runtime.run(executable, ['about', '--format', 'json'], harnessAccountEnv('cursor', configDir));
  const about = cursorAbout(result.stdout);
  // Anything but a named account (signed out, unreadable) is already the answer.
  if (about.unavailable !== 'unsupported') return about;
  const signedIn = { ...(about.email ? { email: about.email } : {}), ...(about.plan ? { plan: about.plan } : {}) };
  const found = await cursorAccessToken(runtime);
  if ('gap' in found) return gap(found.gap, signedIn);
  // Cursor Agent renews its token when it runs; Orglet never writes its credentials.
  const expiry = tokenExpiry(found.token);
  if (expiry !== undefined && expiry <= runtime.now().getTime()) return gap('expired', signedIn);

  const answer = await askVendor(runtime, CURSOR_USAGE_URL, found.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' },
    body: '{}',
  });
  if ('gap' in answer) return gap(answer.gap, signedIn);
  const windows = cursorUsageWindows(answer.answer);
  // A team or enterprise plan answers with spend instead of included usage; Cursor Agent says the same.
  if (!windows.length) return gap('unsupported', signedIn);
  return { ...signedIn, windows };
}

type CursorToken = { token: string } | { gap: HarnessUsageGap };

/**
 * The access token Cursor Agent signs in with, from the same places it reads (Cursor Agent 2026.09.18): the
 * CURSOR_AUTH_TOKEN variable, else its credential store. On macOS that is the Keychain unless
 * AGENT_CLI_CREDENTIAL_STORE=file; elsewhere, and with that setting, it is `auth.json` (`cursorAuthFile`).
 */
async function cursorAccessToken(runtime: UsageRuntime): Promise<CursorToken> {
  const environment = runtime.env ?? {};
  const given = text(environment.CURSOR_AUTH_TOKEN);
  if (given) return { token: given };
  // An API key signs in without a plan allowance; a sign-in kept only in memory is nowhere Orglet can read.
  if (text(environment.CURSOR_API_KEY)) return { gap: 'unsupported' };
  const store = environment.AGENT_CLI_CREDENTIAL_STORE;
  if (store === 'memory') return { gap: 'unsupported' };
  const platform = runtime.platform ?? process.platform;
  if (platform === 'darwin' && store !== 'file') {
    const kept = text(await runtime.readKeychain?.(CURSOR_KEYCHAIN_SERVICE).catch(() => undefined));
    return kept ? { token: kept } : { gap: 'failed' };
  }
  const saved = parseJson(await runtime.readText(cursorAuthFile(platform, environment, runtime.home)).catch(() => ''));
  if (!isRecord(saved)) return { gap: 'failed' };
  const token = text(saved.accessToken);
  if (token) return { token };
  return { gap: text(saved.apiKey) ? 'unsupported' : 'failed' };
}

/**
 * Where Cursor Agent keeps its sign-in outside the Keychain. CURSOR_CONFIG_DIR does not move it, so every account
 * folder reads the same file, as Cursor Agent itself does.
 */
export function cursorAuthFile(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv, home: string): string {
  if (platform === 'win32') return join(environment.APPDATA || join(home, 'AppData', 'Roaming'), 'Cursor', 'auth.json');
  if (platform === 'darwin') return join(home, '.cursor', 'auth.json');
  return join(environment.XDG_CONFIG_HOME || join(home, '.config'), 'cursor', 'auth.json');
}

/**
 * Cursor's usage answer, named the way Cursor Agent's `/usage` names it: the included usage of the billing cycle, then
 * its Auto and API pools. The cycle's end is the reset; its length says whether it is a month.
 */
export function cursorUsageWindows(answer: unknown): HarnessUsageWindow[] {
  if (!isRecord(answer) || !isRecord(answer.planUsage)) return [];
  const usage = answer.planUsage;
  const resetsAt = epochMillisDate(answer.billingCycleEnd);
  const base = { kind: cursorCycleKind(answer.billingCycleStart, answer.billingCycleEnd), ...(resetsAt ? { resetsAt } : {}) };
  const windows: HarnessUsageWindow[] = [];
  const included = cursorIncludedPercent(usage);
  if (included !== undefined) windows.push({ ...base, usedPercent: clampPercent(included) });
  const pools: [string, string][] = [['autoPercentUsed', 'Auto'], ['apiPercentUsed', 'API']];
  for (const [field, pool] of pools) {
    const percent = usage[field];
    if (typeof percent === 'number' && Number.isFinite(percent)) windows.push({ ...base, model: pool, usedPercent: clampPercent(percent) });
  }
  return windows;
}

/** Cursor's own percentage, else the included spend against the included limit, as Cursor Agent works it out. */
function cursorIncludedPercent(usage: Record<string, unknown>): number | undefined {
  if (typeof usage.totalPercentUsed === 'number' && Number.isFinite(usage.totalPercentUsed)) return usage.totalPercentUsed;
  if (typeof usage.includedSpend !== 'number' || typeof usage.limit !== 'number' || usage.limit <= 0) return undefined;
  return usage.includedSpend / usage.limit * 100;
}

/** A billing cycle of a few weeks or more is a month; a cycle Cursor gives no bounds for is its monthly one. */
function cursorCycleKind(start: unknown, end: unknown): HarnessUsageWindow['kind'] {
  const from = epochMillis(start);
  const to = epochMillis(end);
  if (from === undefined || to === undefined || to <= from) return 'monthly';
  return (to - from) / DAY_MS >= 20 ? 'monthly' : 'weekly';
}

/** Connect sends a 64-bit number as a string; Cursor's cycle bounds are milliseconds since 1970. */
function epochMillis(value: unknown): number | undefined {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : undefined;
}

function epochMillisDate(value: unknown): string | undefined {
  const millis = epochMillis(value);
  return millis === undefined ? undefined : new Date(millis).toISOString();
}

/**
 * Gemini CLI's quota for a Google sign-in, read the way its `/stats` and `/model` views read it: `loadCodeAssist` for the
 * project and tier, then `retrieveUserQuota` for that project. Only a token that is still valid is sent; Gemini CLI
 * renews it when it runs, and Orglet never writes its credentials. An account the CLI has not set up yet is left
 * alone: setting it up (`onboardUser`) is the CLI's job.
 */
async function readGemini(configDir: string | undefined, runtime: UsageRuntime): Promise<AccountUsageRead> {
  const environment = runtime.env ?? {};
  const home = geminiHome(configDir, environment, runtime.home);
  const signIn = await readGeminiSignIn(home, environment, runtime.readText);
  if (signIn.state === 'unreadable') return gap('failed');
  if (signIn.state === 'signed_out') return gap('signed_out');
  const account = signIn.email ? { email: signIn.email } : {};
  // An API key or Vertex AI has no plan allowance; a sign-in kept in the system keychain is not read.
  if (signIn.method !== GEMINI_GOOGLE_SIGN_IN || environment.GEMINI_FORCE_ENCRYPTED_FILE_STORAGE === 'true') return gap('unsupported', account);
  const credentials = parseJson(await runtime.readText(join(home, '.gemini', 'oauth_creds.json')).catch(() => ''));
  if (!isRecord(credentials)) return gap('unsupported', account);
  const token = text(credentials.access_token);
  const expiresAt = credentials.expiry_date;
  if (!token || (typeof expiresAt === 'number' && expiresAt <= runtime.now().getTime())) return gap('expired', account);
  return readGeminiQuota(token, account, environment, runtime);
}

async function readGeminiQuota(token: string, account: { email?: string }, environment: NodeJS.ProcessEnv, runtime: UsageRuntime): Promise<AccountUsageRead> {
  const chosenProject = text(environment.GOOGLE_CLOUD_PROJECT) ?? text(environment.GOOGLE_CLOUD_PROJECT_ID);
  const metadata = { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI', duetProject: chosenProject };
  const setup = await askVendor(runtime, `${CODE_ASSIST_URL}:loadCodeAssist`, token, jsonPost({ cloudaicompanionProject: chosenProject, metadata }));
  if ('gap' in setup) return gap(setup.gap, account);
  const tier = geminiTier(setup.answer, chosenProject);
  const signedIn = { ...account, ...(tier.plan ? { plan: tier.plan } : {}) };
  if (!tier.project) return gap('unsupported', signedIn);
  const quota = await askVendor(runtime, `${CODE_ASSIST_URL}:retrieveUserQuota`, token, jsonPost({ project: tier.project }));
  if ('gap' in quota) return gap(quota.gap, signedIn);
  return { ...signedIn, windows: geminiUsageWindows(quota.answer) };
}

/** The project and plan `loadCodeAssist` reports; no project while the account has no current tier (not set up yet). */
export function geminiTier(answer: unknown, chosenProject?: string): { project?: string; plan?: string } {
  if (!isRecord(answer) || !isRecord(answer.currentTier)) return {};
  const paid = isRecord(answer.paidTier) ? answer.paidTier : undefined;
  const plan = text(paid?.name) ?? text(answer.currentTier.name);
  const project = text(answer.cloudaicompanionProject) ?? chosenProject;
  return { ...(project ? { project } : {}), ...(plan ? { plan } : {}) };
}

/**
 * One daily allowance per model: Gemini CLI's quota is requests per user per day (its quota-and-pricing docs), and each
 * bucket gives the share left and when it resets. A model with several buckets shows the one closest to its limit.
 */
export function geminiUsageWindows(answer: unknown): HarnessUsageWindow[] {
  if (!isRecord(answer) || !Array.isArray(answer.buckets)) return [];
  const byModel = new Map<string, HarnessUsageWindow>();
  for (const bucket of answer.buckets) {
    if (!isRecord(bucket) || typeof bucket.remainingFraction !== 'number' || !Number.isFinite(bucket.remainingFraction)) continue;
    const model = text(bucket.modelId);
    if (!model) continue;
    const resetsAt = isoDate(bucket.resetTime);
    const window: HarnessUsageWindow = { kind: 'daily', model, usedPercent: clampPercent((1 - bucket.remainingFraction) * 100), ...(resetsAt ? { resetsAt } : {}) };
    const known = byModel.get(model);
    if (!known || window.usedPercent > known.usedPercent) byModel.set(model, window);
  }
  return [...byModel.values()];
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

/**
 * A password from the login Keychain through macOS's own `security` tool. The password is the tool's only output and
 * stays in memory; a missing item, a denied prompt or a timeout all read as none.
 */
const readMacKeychain = (service: string) => new Promise<string | undefined>(resolve => {
  execFile('/usr/bin/security', ['find-generic-password', '-s', service, '-w'], { timeout: KEYCHAIN_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
    resolve(error ? undefined : text(String(stdout)));
  });
});

export const localUsageRuntime = (): UsageRuntime => ({
  run: probe,
  appServer: codexAppServer,
  fetch: (input, init) => fetch(input, init),
  readText: path => readFile(path, 'utf8'),
  home: homedir(),
  now: () => new Date(),
  env: process.env,
  platform: process.platform,
  ...(process.platform === 'darwin' ? { readKeychain: readMacKeychain } : {}),
});
