import { z } from 'zod';
import { KEY_PREFIXES, TELEMETRY_BEARER as BEARER, JWT } from './secrets';

/**
 * Usage analytics for a signed-in CodePawl account (COD-344). This file is the pure part: the whitelist of events and
 * their props, the error scrubber, the queue limits and how a queue is split into requests, and when analytics may run
 * at all. `main/analytics.ts` holds the queue and does the sending, because only main has the access token.
 *
 * Nothing here ever carries chat text, prompts, answers, file names or contents, folder paths, orglet or crew names
 * and instructions, keys, tokens or emails: every prop is an enum, a bucket, a version or a provider and model id.
 */

export const ANALYTICS_APP = 'orglet';
export const ANALYTICS_PATH = '/v1/analytics';

/** How much the queue keeps; the oldest go first once it is full. */
export const MAX_QUEUED_EVENTS = 500;
export const MAX_QUEUED_ERRORS = 50;
/** What the service takes in one request. */
export const MAX_EVENTS_PER_REQUEST = 100;
export const MAX_ERRORS_PER_REQUEST = 20;
export const MAX_REQUEST_BYTES = 64 * 1024;
/** The service's limits on one event's props. */
export const MAX_PROP_KEYS = 12;
export const MAX_PROP_STRING = 120;
export const MAX_ERROR_MESSAGE = 500;
export const MAX_ERROR_STACK = 4000;

export const FLUSH_INTERVAL_MS = 5 * 60 * 1000;

/** Features counted once per app session when first used. */
export const AnalyticsFeature = z.enum([
  // 'tacet' is the decision model's setting, kept under its first name on the wire.
  'tabs', 'rail', 'side_thread', 'schedule', 'browser', 'desktop', 'mcp', 'file_viewer', 'file_edit', 'forward', 'cli', 'send_to', 'tacet',
]);
export type AnalyticsFeature = z.infer<typeof AnalyticsFeature>;

export const ChatKind = z.enum(['solo', 'crew', 'group', 'side', 'schedule']);
export type ChatKind = z.infer<typeof ChatKind>;
export const ConnectionKind = z.enum(['demo', 'api', 'harness', 'custom']);
export type ConnectionKind = z.infer<typeof ConnectionKind>;
export const RunOutcome = z.enum(['completed', 'partial', 'failed', 'cancelled', 'interrupted']);
export type RunOutcome = z.infer<typeof RunOutcome>;
export const DurationBucket = z.enum(['<10s', '10-30s', '30s-2m', '2-10m', '10-30m', '>30m']);
export const StepCountBucket = z.enum(['0', '1-5', '6-20', '21-50', '>50']);

/** A version such as `0.9.0` or `0.10.0-beta.1`; anything else is refused rather than sent. */
const Version = z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,30})?$/).max(40);
/** A provider or model id; a custom connection's own id and model are never sent, only the word `custom`. */
const Identifier = z.string().regex(/^[A-Za-z0-9._:/@+-]{1,120}$/);

/** Settings whose value is sent along with the key: each is an enum or on/off. Other keys go without their value. */
export const ENUM_SETTING_KEYS = [
  'language', 'theme', 'copyFormat', 'downloadFormat', 'archiveRetentionDays', 'logoColor', 'webSearchProvider',
  'autoTitles', 'confirmOpenTask', 'autoUpdate', 'backgroundNotifications', 'showWork',
] as const;
export const SettingKey = z.enum([
  ...ENUM_SETTING_KEYS, 'accentColor', 'interfaceFont', 'codeFont', 'connectionLimitMicros', 'providerConcurrency', 'providerConsent', 'analytics',
]);
export type SettingKey = z.infer<typeof SettingKey>;
const SettingValue = z.union([z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), z.number().int(), z.boolean()]);

const at = z.iso.datetime();

/** Every event the app may record, strict so an unknown prop is refused instead of sent. */
export const AnalyticsEvent = z.discriminatedUnion('name', [
  z.object({ name: z.literal('app_started'), at, props: z.object({ version: Version, platform: z.enum(['win32', 'darwin', 'linux']), arch: z.enum(['x64', 'arm64', 'ia32']), locale: z.enum(['vi', 'en', 'en-GB']), installKind: z.enum(['squirrel', 'portable', 'macos-app', 'linux', 'dev']) }).strict() }).strict(),
  z.object({ name: z.literal('chat_turn_sent'), at, props: z.object({ chatKind: ChatKind, connectionKind: ConnectionKind, provider: Identifier, model: Identifier }).strict() }).strict(),
  z.object({ name: z.literal('run_finished'), at, props: z.object({ outcome: RunOutcome, durationBucket: DurationBucket, stepCountBucket: StepCountBucket, chatKind: ChatKind }).strict() }).strict(),
  z.object({ name: z.literal('feature_used'), at, props: z.object({ feature: AnalyticsFeature }).strict() }).strict(),
  z.object({ name: z.literal('setting_changed'), at, props: z.object({ setting: SettingKey, value: SettingValue.optional() }).strict() }).strict(),
  z.object({ name: z.literal('update_installed'), at, props: z.object({ from: Version, to: Version }).strict() }).strict(),
]);
export type AnalyticsEvent = z.infer<typeof AnalyticsEvent>;
export type AnalyticsEventName = AnalyticsEvent['name'];

export const ErrorKind = z.enum(['uncaught', 'unhandled_rejection', 'renderer', 'core', 'run_failed']);
export type ErrorKind = z.infer<typeof ErrorKind>;
export const AnalyticsError = z.object({
  at,
  kind: ErrorKind,
  message: z.string().max(MAX_ERROR_MESSAGE),
  stack: z.string().max(MAX_ERROR_STACK).optional(),
}).strict();
export type AnalyticsError = z.infer<typeof AnalyticsError>;

/** What the window may report about an error of its own; main scrubs it again before it is queued. */
export const RendererErrorReport = z.object({
  message: z.string().max(10_000),
  stack: z.string().max(40_000).optional(),
}).strict();
export type RendererErrorReport = z.infer<typeof RendererErrorReport>;

/** One request body, exactly as the service expects it. */
export type AnalyticsBatch = {
  app: typeof ANALYTICS_APP;
  appVersion: string;
  platform: string;
  installId: string;
  events: AnalyticsEvent[];
  errors: AnalyticsError[];
};

/** What the window hears: whether analytics is on. Signed out, the switch is not shown at all. */
export const AnalyticsState = z.object({ enabled: z.boolean() }).strict();
export type AnalyticsState = z.infer<typeof AnalyticsState>;

/** The per-install file main keeps in the data folder, outside the database, so no backup carries it. */
export const AnalyticsSettings = z.object({
  installId: z.uuid(),
  enabled: z.boolean().default(true),
  /** The version that last started, so an update can be counted once. */
  lastVersion: Version.optional(),
}).strict();
export type AnalyticsSettings = z.infer<typeof AnalyticsSettings>;

export const AnalyticsQueue = z.object({
  events: z.array(z.unknown()).max(MAX_QUEUED_EVENTS * 2).catch([]),
  errors: z.array(z.unknown()).max(MAX_QUEUED_ERRORS * 2).catch([]),
}).strict();

/** Validates an event against the whitelist, or returns undefined so the caller drops it. */
export function parseEvent(raw: unknown): AnalyticsEvent | undefined {
  const parsed = AnalyticsEvent.safeParse(raw);
  if (!parsed.success) return undefined;
  if (!propsWithinLimits(parsed.data.props)) return undefined;
  return parsed.data;
}

function propsWithinLimits(props: Record<string, unknown>): boolean {
  const entries = Object.entries(props);
  if (entries.length > MAX_PROP_KEYS) return false;
  return entries.every(([, value]) => typeof value !== 'string' || value.length <= MAX_PROP_STRING);
}

export function parseError(raw: unknown): AnalyticsError | undefined {
  const parsed = AnalyticsError.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Scrubbing

export type ScrubContext = {
  /** The user's home folder, such as `C:\Users\an`; every spelling of it becomes `~`. */
  homeDirectory?: string;
  /** The user's account name, replaced wherever it still appears on its own. */
  userName?: string;
};

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** A query string or fragment after a URL's path; the address stays, what follows `?` or `#` goes. */
const URL_QUERY = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>]*)[?#][^\s"'<>)]*/gi;
const LONG_HEX = /\b[0-9a-f]{32,}\b/gi;
/**
 * A long unbroken run of base64 or base64url characters holding a digit, an upper and a lower case letter, so words and
 * identifiers survive. `/` is left out on purpose: with it every path in a stack would read as base64.
 */
const LONG_BASE64 = /(?<![A-Za-z0-9+_-])(?=[A-Za-z0-9+_-]*\d)(?=[A-Za-z0-9+_-]*[a-z])(?=[A-Za-z0-9+_-]*[A-Z])[A-Za-z0-9+_-]{32,}={0,2}/g;
const MASK = '[masked]';

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every way a home folder shows up in a message or stack: both slash directions, any letter case, file URLs. */
function homePattern(homeDirectory: string): RegExp {
  const parts = homeDirectory.replace(/[\\/]+$/, '').split(/[\\/]+/).map(escapeForRegExp);
  return new RegExp(`(?:file:\\/{2,3})?${parts.join('[\\\\/]+')}`, 'gi');
}

/**
 * Takes out what could name the person or unlock something of theirs: the home folder and user name become `~`,
 * emails and URL query strings are removed, and anything shaped like a key or token is masked.
 */
export function scrubText(text: string, context: ScrubContext): string {
  // The service refuses control characters; tab and line breaks stay, since a stack is made of lines.
  let scrubbed = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (context.homeDirectory && context.homeDirectory.length > 3) scrubbed = scrubbed.replace(homePattern(context.homeDirectory), '~');
  scrubbed = scrubbed.replace(URL_QUERY, '$1');
  scrubbed = scrubbed.replace(EMAIL, '[email]');
  scrubbed = scrubbed.replace(BEARER, `$1 ${MASK}`);
  scrubbed = scrubbed.replace(JWT, MASK);
  scrubbed = scrubbed.replace(KEY_PREFIXES, MASK);
  scrubbed = scrubbed.replace(LONG_HEX, MASK);
  scrubbed = scrubbed.replace(LONG_BASE64, MASK);
  if (context.userName && context.userName.length > 2) {
    scrubbed = scrubbed.replace(new RegExp(`(?<![A-Za-z0-9])${escapeForRegExp(context.userName)}(?![A-Za-z0-9])`, 'gi'), '~');
  }
  return scrubbed;
}

/** An error ready for the queue: scrubbed first, then cut to the service's lengths. */
export function scrubbedError(kind: ErrorKind, message: string, stack: string | undefined, context: ScrubContext, now: Date): AnalyticsError {
  const cleanMessage = scrubText(message, context).slice(0, MAX_ERROR_MESSAGE);
  const cleanStack = stack ? scrubText(stack, context).slice(0, MAX_ERROR_STACK) : undefined;
  return { at: now.toISOString(), kind, message: cleanMessage, ...(cleanStack ? { stack: cleanStack } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------
// Buckets and kinds

export function durationBucket(milliseconds: number): z.infer<typeof DurationBucket> {
  const seconds = milliseconds / 1000;
  if (seconds < 10) return '<10s';
  if (seconds < 30) return '10-30s';
  if (seconds < 120) return '30s-2m';
  if (seconds < 600) return '2-10m';
  if (seconds < 1800) return '10-30m';
  return '>30m';
}

export function stepCountBucket(steps: number): z.infer<typeof StepCountBucket> {
  if (steps <= 0) return '0';
  if (steps <= 5) return '1-5';
  if (steps <= 20) return '6-20';
  if (steps <= 50) return '21-50';
  return '>50';
}

type ChatShape = { teamId?: string; assignees?: 'all' | string[]; sideOf?: unknown; routineId?: string };

export function chatKindOf(task: ChatShape): ChatKind {
  if (task.sideOf) return 'side';
  if (task.routineId) return 'schedule';
  if (task.teamId) return 'crew';
  if (task.assignees) return 'group';
  return 'solo';
}

const HARNESS_PROVIDERS = new Set(['claude-code', 'codex', 'cursor', 'gemini']);

/** The connection a turn went through. A custom connection is named only as `custom`, never by its id or model. */
export function connectionOf(provider: string, modelId: string | undefined): { connectionKind: ConnectionKind; provider: string; model: string } {
  if (provider === 'demo') return { connectionKind: 'demo', provider: 'demo', model: 'demo' };
  if (provider.startsWith('custom:')) return { connectionKind: 'custom', provider: 'custom', model: 'custom' };
  const connectionKind = HARNESS_PROVIDERS.has(provider) ? 'harness' : 'api';
  const model = modelId && Identifier.safeParse(modelId).success ? modelId : 'default';
  return { connectionKind, provider, model };
}

export function isFinishedOutcome(status: string): status is RunOutcome {
  return RunOutcome.safeParse(status).success;
}

/** The feature a command the window sent stands for, if any. */
export function featureForCommand(command: string, args: unknown): AnalyticsFeature | undefined {
  if (command === 'startSideThread') return 'side_thread';
  if (command === 'saveRoutine') return 'schedule';
  if (command === 'setBrowser' || command === 'browserTakeOver') return 'browser';
  if (command === 'setDesktop') return 'desktop';
  if (command === 'setMcpGrant') return (args as { allowed?: boolean }).allowed ? 'mcp' : undefined;
  if (command === 'saveSourceVersion') return 'file_edit';
  if (command === 'forwardMessage') return 'forward';
  if (command === 'saveDecisionModelSetting') return Array.isArray(args) && args.length === 0 ? undefined : 'tacet';
  return undefined;
}

/** Only the settings analytics compares, out of a whole workspace; a key the workspace lacks is left out. */
export function settingsSnapshot(workspace: object): Record<string, unknown> {
  const source = workspace as Record<string, unknown>;
  const present = SettingKey.options.filter(key => source[key] !== undefined);
  return Object.fromEntries(present.map(key => [key, source[key]]));
}

/** One `setting_changed` per key whose value differs; the value goes along only for an enum or on/off setting. */
export function settingChanges(previous: Record<string, unknown>, next: Record<string, unknown>, now: Date): AnalyticsEvent[] {
  const events: AnalyticsEvent[] = [];
  for (const [key, value] of Object.entries(next)) {
    if (JSON.stringify(previous[key]) === JSON.stringify(value)) continue;
    const setting = SettingKey.safeParse(key);
    if (!setting.success) continue;
    const withValue = (ENUM_SETTING_KEYS as readonly string[]).includes(key) && SettingValue.safeParse(value).success;
    const props = withValue ? { setting: setting.data, value: value as string | number | boolean } : { setting: setting.data };
    events.push({ name: 'setting_changed', at: now.toISOString(), props });
  }
  return events;
}

// ---------------------------------------------------------------------------------------------------------------
// The service's own rules

/**
 * What the service checks on every item (COD-344, the ingest endpoint). It refuses a whole request with 400 when one
 * item breaks a rule, so each item is checked here first and a bad one is dropped on its own.
 */
export const MAX_ITEM_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_ITEM_AHEAD_MS = 5 * 60 * 1000;
/** Control characters other than tab, line feed and carriage return. */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const WireString = z.string().max(MAX_PROP_STRING).refine(value => !CONTROL_CHARACTERS.test(value));
export const WireEvent = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  at: z.iso.datetime(),
  props: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/), z.union([WireString, z.number().finite(), z.boolean()]))
    .refine(props => Object.keys(props).length <= MAX_PROP_KEYS),
});
export const WireError = z.object({
  at: z.iso.datetime(),
  kind: z.string().min(1).max(100),
  message: z.string().max(MAX_ERROR_MESSAGE),
  stack: z.string().max(MAX_ERROR_STACK).optional(),
});
export const WireAppVersion = Version;

/** Whether an item's time is one the service takes: not older than 30 days, not more than 5 minutes ahead. */
export function freshEnough(at: string, now: number): boolean {
  const time = Date.parse(at);
  return Number.isFinite(time) && time >= now - MAX_ITEM_AGE_MS && time <= now + MAX_ITEM_AHEAD_MS;
}

/** The items the service would take right now; anything else would fail the whole request, so it stays behind. */
export function sendable<T extends { at: string }>(items: readonly T[], schema: z.ZodType, now: number): T[] {
  return items.filter(item => freshEnough(item.at, now) && schema.safeParse(item).success);
}

// ---------------------------------------------------------------------------------------------------------------
// Queue and requests

/** Adds items and drops the oldest past the limit. */
export function appendBounded<T>(items: readonly T[], added: readonly T[], limit: number): T[] {
  const combined = [...items, ...added];
  return combined.length > limit ? combined.slice(combined.length - limit) : combined;
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * Splits a queue into request bodies within the service's limits: at most 100 events and 20 errors, and at most
 * 64 KB each. An item that alone would not fit is dropped rather than sent.
 */
export function splitIntoBatches(header: Omit<AnalyticsBatch, 'events' | 'errors'>, events: readonly AnalyticsEvent[], errors: readonly AnalyticsError[]): AnalyticsBatch[] {
  const batches: AnalyticsBatch[] = [];
  let current: AnalyticsBatch = { ...header, events: [], errors: [] };
  const flushCurrent = () => {
    if (current.events.length || current.errors.length) batches.push(current);
    current = { ...header, events: [], errors: [] };
  };
  const place = (kind: 'events' | 'errors', item: AnalyticsEvent | AnalyticsError, perRequest: number) => {
    const list = current[kind] as unknown[];
    if (list.length >= perRequest) flushCurrent();
    (current[kind] as unknown[]).push(item);
    if (byteLength(current) <= MAX_REQUEST_BYTES) return;
    (current[kind] as unknown[]).pop();
    flushCurrent();
    (current[kind] as unknown[]).push(item);
    if (byteLength(current) > MAX_REQUEST_BYTES) (current[kind] as unknown[]).pop();
  };
  for (const event of events) place('events', event, MAX_EVENTS_PER_REQUEST);
  for (const error of errors) place('errors', error, MAX_ERRORS_PER_REQUEST);
  flushCurrent();
  return batches;
}

// ---------------------------------------------------------------------------------------------------------------
// Gating

export type AnalyticsEnvironment = {
  env: Record<string, string | undefined>;
  /** False for `pnpm dev` and any unpackaged run. */
  packaged: boolean;
  /** A maintainer's updater test build (COD-304). */
  updateTestBuild?: boolean;
};

/** Variables the tests, smokes and screenshot scripts set; analytics never runs under any of them. */
const TEST_MARKERS = ['VITEST', 'ORGLET_SKIP_ACCOUNT_CHOICE', 'ORGLET_DESKTOP_TEST', 'ORGLET_SMOKE_DATA', 'ORGLET_TEST_SANDBOX'];

/**
 * Whether this build may send analytics at all, before the account and the switch are asked. `ORGLET_ANALYTICS=off`
 * always wins, tests and smokes never send, and a development run sends only with `ORGLET_ANALYTICS=on`.
 */
export function analyticsAllowedHere({ env, packaged, updateTestBuild }: AnalyticsEnvironment): boolean {
  const setting = env.ORGLET_ANALYTICS?.toLowerCase();
  if (setting === 'off' || setting === '0' || setting === 'false') return false;
  if (env.NODE_ENV === 'test') return false;
  if (TEST_MARKERS.some(name => env[name] !== undefined && env[name] !== '')) return false;
  if (updateTestBuild) return false;
  if (!packaged) return setting === 'on';
  return true;
}
