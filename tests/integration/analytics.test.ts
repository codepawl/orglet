import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnalyticsClient, retryAfterMs, type AnalyticsDependencies } from '../../apps/desktop/src/main/analytics';
import { runFinishedEvent, turnSentEvent } from '../../apps/desktop/src/core/analytics-events';
import { Store } from '../../apps/desktop/src/core/storage/database';
import {
  MAX_ERROR_MESSAGE,
  MAX_ERROR_STACK,
  MAX_EVENTS_PER_REQUEST,
  MAX_ERRORS_PER_REQUEST,
  MAX_QUEUED_ERRORS,
  MAX_QUEUED_EVENTS,
  MAX_REQUEST_BYTES,
  analyticsAllowedHere,
  chatKindOf,
  connectionOf,
  durationBucket,
  freshEnough,
  WireError,
  WireEvent,
  featureForCommand,
  parseEvent,
  scrubText,
  scrubbedError,
  settingChanges,
  settingsSnapshot,
  splitIntoBatches,
  stepCountBucket,
  type AnalyticsBatch,
  type AnalyticsError,
  type AnalyticsEvent,
} from '../../apps/desktop/src/shared/analytics';

const AT = '2026-09-30T10:00:00.000Z';
const SIGNED_IN = { status: 'signed_in', email: 'an@example.com' } as const;

function featureEvent(feature = 'tabs'): AnalyticsEvent {
  return { name: 'feature_used', at: AT, props: { feature } } as AnalyticsEvent;
}

describe('scrubbing errors', () => {
  const context = { homeDirectory: 'C:\\Users\\nxan2', userName: 'nxan2' };

  it('turns the home folder into ~ in every spelling', () => {
    const text = 'at open (C:\\Users\\nxan2\\Documents\\notes.md) file:///C:/Users/nxan2/AppData/x.js c:\\users\\NXAN2\\y';
    const scrubbed = scrubText(text, context);
    expect(scrubbed).not.toMatch(/nxan2/i);
    expect(scrubbed).toContain('~\\Documents\\notes.md');
    expect(scrubbed).toContain('~/AppData/x.js');
  });

  it('removes the user name where it appears on its own', () => {
    expect(scrubText('ENOENT for user nxan2 in D:\\nxan2\\work', context)).toBe('ENOENT for user ~ in D:\\~\\work');
  });

  it('removes emails and URL query strings', () => {
    const scrubbed = scrubText('failed for an.nguyen+x@codepawl.com at https://api.example.com/v1/chat?key=abc&user=me#frag', context);
    expect(scrubbed).toBe('failed for [email] at https://api.example.com/v1/chat');
  });

  it('masks anything shaped like a key or token', () => {
    const samples = [
      'sk-proj-abcdefghijklmnop1234',
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'Bearer abc.def.ghi-jkl_mno',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLXZhbHVl',
      '0123456789abcdef0123456789abcdef01234567',
      'dGhpcyBpcyBhIHNlY3JldCB0b2tlbiB2YWx1ZTEyMw',
    ];
    for (const sample of samples) {
      const scrubbed = scrubText(`value ${sample} end`, context);
      expect(scrubbed, sample).not.toContain(sample);
      expect(scrubbed, sample).toContain('[masked]');
    }
  });

  it('keeps ordinary stack frames readable', () => {
    const frame = 'at AnalyticsClient.flushOnce (resources/app.asar/.vite/build/main.js:120:15)';
    expect(scrubText(frame, context)).toBe(frame);
  });

  it('caps the message and the stack', () => {
    const error = scrubbedError('uncaught', 'x'.repeat(2000), 'y'.repeat(9000), context, new Date(AT));
    expect(error.message).toHaveLength(MAX_ERROR_MESSAGE);
    expect(error.stack).toHaveLength(MAX_ERROR_STACK);
  });
});

describe('the whitelist', () => {
  it('accepts every known event with its props', () => {
    expect(parseEvent({ name: 'app_started', at: AT, props: { version: '0.9.0', platform: 'win32', arch: 'x64', locale: 'en', installKind: 'squirrel' } })).toBeDefined();
    expect(parseEvent({ name: 'chat_turn_sent', at: AT, props: { chatKind: 'crew', connectionKind: 'harness', provider: 'claude-code', model: 'claude-opus-5-5' } })).toBeDefined();
    expect(parseEvent({ name: 'run_finished', at: AT, props: { outcome: 'completed', durationBucket: '10-30s', stepCountBucket: '1-5', chatKind: 'solo' } })).toBeDefined();
    expect(parseEvent(featureEvent())).toBeDefined();
    expect(parseEvent({ name: 'setting_changed', at: AT, props: { setting: 'theme', value: 'dark' } })).toBeDefined();
    expect(parseEvent({ name: 'update_installed', at: AT, props: { from: '0.8.0', to: '0.9.0' } })).toBeDefined();
  });

  it('refuses unknown events, unknown props and free text', () => {
    expect(parseEvent({ name: 'chat_text', at: AT, props: {} })).toBeUndefined();
    expect(parseEvent({ name: 'feature_used', at: AT, props: { feature: 'tabs', chat: 'hello' } })).toBeUndefined();
    expect(parseEvent({ name: 'feature_used', at: AT, props: { feature: 'my secret plan' } })).toBeUndefined();
    expect(parseEvent({ name: 'setting_changed', at: AT, props: { setting: 'workerName', value: 'Researcher' } })).toBeUndefined();
    expect(parseEvent({ name: 'chat_turn_sent', at: AT, props: { chatKind: 'solo', connectionKind: 'api', provider: 'openai', model: 'a model with spaces' } })).toBeUndefined();
    expect(parseEvent({ name: 'feature_used', at: 'yesterday', props: { feature: 'tabs' } })).toBeUndefined();
  });

  it('never names a custom connection or an unreadable model', () => {
    expect(connectionOf('custom:0c7b3e0a-8d5f-4a4e-9f0e-5d1b6c2a9e11', 'my-private-model')).toEqual({ connectionKind: 'custom', provider: 'custom', model: 'custom' });
    expect(connectionOf('codex', undefined)).toEqual({ connectionKind: 'harness', provider: 'codex', model: 'default' });
    expect(connectionOf('openai', 'gpt 5 with spaces')).toEqual({ connectionKind: 'api', provider: 'openai', model: 'default' });
    expect(connectionOf('demo', 'anything').connectionKind).toBe('demo');
  });

  it('describes chats, durations and steps as buckets', () => {
    expect(chatKindOf({ sideOf: { taskId: 'x' } })).toBe('side');
    expect(chatKindOf({ teamId: 'crew' })).toBe('crew');
    expect(chatKindOf({ assignees: 'all' })).toBe('group');
    expect(chatKindOf({ routineId: 'r' })).toBe('schedule');
    expect(chatKindOf({})).toBe('solo');
    expect(durationBucket(5_000)).toBe('<10s');
    expect(durationBucket(45 * 60_000)).toBe('>30m');
    expect(stepCountBucket(0)).toBe('0');
    expect(stepCountBucket(21)).toBe('21-50');
  });

  it('sends a setting value only for enum and on/off settings', () => {
    const events = settingChanges({ theme: 'light', accentColor: '#111111', autoTitles: true }, { theme: 'dark', accentColor: '#222222', autoTitles: true }, new Date(AT));
    expect(events.map(event => event.props)).toEqual([{ setting: 'theme', value: 'dark' }, { setting: 'accentColor' }]);
  });

  it('compares only settings, and only those the workspace has', () => {
    expect(settingsSnapshot({ theme: 'dark', tasks: [{ brief: 'secret' }], workers: [] })).toEqual({ theme: 'dark' });
  });

  it('describes a turn and a run from the store without names or text', () => {
    const store = new Store(':memory:');
    const workerId = '4f0b7a52-3c1e-4d7a-9c55-1f2e3d4c5b6a';
    const taskId = '7a1c2e3f-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
    const runId = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
    store.put('workers', { id: workerId, name: 'Secret Agent Name', revision: 1, provider: 'claude-code', modelId: 'claude-opus-5-5', skillId: workerId, instructions: 'private instructions' });
    store.put('tasks', { id: taskId, brief: 'my private brief', workerId, status: 'running', createdAt: AT, budgetMicros: 1000, sourceIds: [], consent: true, accepted: false });
    store.put('runs', { id: runId, taskId, status: 'running', snapshot: {}, startedAt: AT, error: null }, { column: 'task_id', value: taskId });
    const turn = turnSentEvent(store, taskId, new Date(AT));
    expect(turn).toEqual({ name: 'chat_turn_sent', at: AT, props: { chatKind: 'solo', connectionKind: 'harness', provider: 'claude-code', model: 'claude-opus-5-5' } });
    expect(parseEvent(turn)).toBeDefined();
    expect(runFinishedEvent(store, taskId, runId, 'running', new Date(AT))).toBeUndefined();
    const finished = runFinishedEvent(store, taskId, runId, 'completed', new Date(Date.parse(AT) + 40_000));
    expect(finished?.props).toEqual({ outcome: 'completed', durationBucket: '30s-2m', stepCountBucket: '0', chatKind: 'solo' });
    expect(JSON.stringify([turn, finished])).not.toMatch(/Secret|private/);
  });

  it('maps commands to features', () => {
    expect(featureForCommand('startSideThread', {})).toBe('side_thread');
    expect(featureForCommand('setMcpGrant', { allowed: false })).toBeUndefined();
    expect(featureForCommand('setMcpGrant', { allowed: true })).toBe('mcp');
    expect(featureForCommand('createTask', {})).toBeUndefined();
  });
});

describe('batching', () => {
  const header = { app: 'orglet', appVersion: '0.9.0', platform: 'win32', installId: '0c7b3e0a-8d5f-4a4e-9f0e-5d1b6c2a9e11' } as const;

  it('splits by the per-request counts', () => {
    const events = Array.from({ length: 250 }, () => featureEvent());
    const errors: AnalyticsError[] = Array.from({ length: 45 }, () => ({ at: AT, kind: 'uncaught', message: 'boom' }));
    const batches = splitIntoBatches(header, events, errors);
    for (const batch of batches) {
      expect(batch.events.length).toBeLessThanOrEqual(MAX_EVENTS_PER_REQUEST);
      expect(batch.errors.length).toBeLessThanOrEqual(MAX_ERRORS_PER_REQUEST);
    }
    expect(batches.flatMap(batch => batch.events)).toHaveLength(250);
    expect(batches.flatMap(batch => batch.errors)).toHaveLength(45);
  });

  it('keeps every body under 64 KB', () => {
    const errors: AnalyticsError[] = Array.from({ length: 60 }, () => ({ at: AT, kind: 'uncaught', message: 'm'.repeat(500), stack: 's'.repeat(4000) }));
    const batches = splitIntoBatches(header, [], errors);
    expect(batches.length).toBeGreaterThan(3);
    for (const batch of batches) expect(new TextEncoder().encode(JSON.stringify(batch)).length).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
    expect(batches.flatMap(batch => batch.errors)).toHaveLength(60);
  });
});

describe('gating', () => {
  it('never runs in tests, smokes, or with ORGLET_ANALYTICS=off', () => {
    expect(analyticsAllowedHere({ env: {}, packaged: true })).toBe(true);
    expect(analyticsAllowedHere({ env: { ORGLET_ANALYTICS: 'off' }, packaged: true })).toBe(false);
    expect(analyticsAllowedHere({ env: { VITEST: 'true' }, packaged: true })).toBe(false);
    expect(analyticsAllowedHere({ env: { ORGLET_SKIP_ACCOUNT_CHOICE: '1' }, packaged: true })).toBe(false);
    expect(analyticsAllowedHere({ env: { ORGLET_SKIP_ACCOUNT_CHOICE: '1', ORGLET_ANALYTICS: 'on' }, packaged: true })).toBe(false);
    expect(analyticsAllowedHere({ env: {}, packaged: true, updateTestBuild: true })).toBe(false);
  });

  it('sends from a development run only with ORGLET_ANALYTICS=on', () => {
    expect(analyticsAllowedHere({ env: {}, packaged: false })).toBe(false);
    expect(analyticsAllowedHere({ env: { ORGLET_ANALYTICS: 'on' }, packaged: false })).toBe(true);
  });
});

type Call = { url: string; headers: Record<string, string>; body: AnalyticsBatch };

describe('the client', () => {
  let directory: string;
  let calls: Call[];
  let answer: (call: Call) => Response;
  let clock: number;

  const fakeFetch = (async (url: string, init: RequestInit) => {
    const call = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as AnalyticsBatch };
    calls.push(call);
    return answer(call);
  }) as unknown as typeof fetch;

  function client(overrides: Partial<AnalyticsDependencies> = {}) {
    return new AnalyticsClient({
      directory,
      baseUrl: 'http://localhost:8787/',
      appVersion: '0.9.0',
      platform: 'win32',
      allowed: true,
      getAccessToken: async () => 'access-token',
      scrub: { homeDirectory: 'C:\\Users\\nxan2', userName: 'nxan2' },
      fetch: fakeFetch,
      now: () => clock,
      ...overrides,
    });
  }

  async function signedInClient(overrides: Partial<AnalyticsDependencies> = {}) {
    const analytics = client(overrides);
    await analytics.load();
    await analytics.accountChanged(SIGNED_IN);
    return analytics;
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'orglet-analytics-'));
    calls = [];
    answer = () => new Response(JSON.stringify({ accepted: 1 }), { status: 202 });
    clock = Date.parse(AT);
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('records nothing without an account', async () => {
    const analytics = client();
    await analytics.load();
    await analytics.accountChanged({ status: 'local' });
    analytics.record(featureEvent());
    analytics.recordError('uncaught', 'boom');
    await analytics.flush();
    expect(analytics.queued().events).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('records nothing where it is not allowed', async () => {
    const analytics = await signedInClient({ allowed: false });
    analytics.record(featureEvent());
    expect(analytics.queued().events).toHaveLength(0);
  });

  it('keeps a random install id and the switch in the data folder, on by default', async () => {
    const analytics = client();
    await analytics.load();
    const saved = JSON.parse(readFileSync(join(directory, 'analytics.json'), 'utf8'));
    expect(saved.installId).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved.enabled).toBe(true);
    expect(analytics.state()).toEqual({ enabled: true });
  });

  it('sends the contract body with the bearer token', async () => {
    const analytics = await signedInClient();
    analytics.recordFeature('tabs');
    analytics.recordFeature('tabs');
    analytics.recordError('renderer', 'failed at C:\\Users\\nxan2\\x.js', 'stack');
    await analytics.flush();
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe('http://localhost:8787/v1/analytics');
    expect(call.headers.authorization).toBe('Bearer access-token');
    expect(call.body).toMatchObject({ app: 'orglet', appVersion: '0.9.0', platform: 'win32' });
    expect(call.body.events).toEqual([featureEvent('tabs')]);
    expect(call.body.errors[0]).toMatchObject({ kind: 'renderer', message: 'failed at ~\\x.js' });
    expect(analytics.queued().events).toHaveLength(0);
  });

  it('counts an update once, across starts', async () => {
    const first = await signedInClient();
    await first.appStarted({ version: '0.8.0', platform: 'win32', arch: 'x64', locale: 'en', installKind: 'squirrel' });
    const second = await signedInClient();
    await second.appStarted({ version: '0.9.0', platform: 'win32', arch: 'x64', locale: 'en', installKind: 'squirrel' });
    expect(second.queued().events.map(event => event.name)).toEqual(['app_started', 'update_installed']);
    expect(second.queued().events[1].props).toEqual({ from: '0.8.0', to: '0.9.0' });
  });

  it('drops the oldest past the queue limits', async () => {
    const analytics = await signedInClient();
    for (let index = 0; index < MAX_QUEUED_EVENTS + 20; index++) analytics.record({ name: 'setting_changed', at: AT, props: { setting: 'theme', value: `v${index}` } });
    for (let index = 0; index < MAX_QUEUED_ERRORS + 5; index++) analytics.recordError('uncaught', `error ${index}`);
    expect(analytics.queued().events).toHaveLength(MAX_QUEUED_EVENTS);
    expect(analytics.queued().events[0].props).toEqual({ setting: 'theme', value: 'v20' });
    expect(analytics.queued().errors).toHaveLength(MAX_QUEUED_ERRORS);
    expect(analytics.queued().errors[0].message).toBe('error 5');
  });

  it('splits a large queue into several requests', async () => {
    const analytics = await signedInClient();
    for (let index = 0; index < 250; index++) analytics.record({ name: 'setting_changed', at: AT, props: { setting: 'theme', value: 'dark' } });
    await analytics.flush();
    expect(calls.map(call => call.body.events.length)).toEqual([100, 100, 50]);
    expect(analytics.queued().events).toHaveLength(0);
  });

  it('turning the switch off empties the queue and stops recording', async () => {
    const analytics = await signedInClient();
    analytics.record(featureEvent());
    await analytics.shutdown();
    expect(existsSync(join(directory, 'analytics-queue.json'))).toBe(false);
    const again = await signedInClient();
    again.record(featureEvent());
    await again.setEnabled(false);
    expect(again.queued().events).toHaveLength(0);
    again.record(featureEvent());
    expect(again.queued().events).toHaveLength(0);
    expect(JSON.parse(readFileSync(join(directory, 'analytics.json'), 'utf8')).enabled).toBe(false);
  });

  it('signing out empties the queue', async () => {
    const analytics = await signedInClient();
    analytics.record(featureEvent());
    await analytics.accountChanged({ status: 'local' });
    expect(analytics.queued().events).toHaveLength(0);
  });

  it('keeps the queue in a file between runs', async () => {
    answer = () => new Response('', { status: 503 });
    const analytics = await signedInClient();
    analytics.record(featureEvent());
    await analytics.shutdown();
    const next = await signedInClient();
    expect(next.queued().events).toEqual([featureEvent()]);
  });

  it('stops on 401 until the next sign-in', async () => {
    answer = () => new Response('', { status: 401 });
    const analytics = await signedInClient();
    analytics.record(featureEvent());
    await analytics.flush();
    await analytics.flush();
    expect(calls).toHaveLength(1);
    expect(analytics.queued().events).toHaveLength(1);
    await analytics.accountChanged({ status: 'expired' });
    await analytics.accountChanged(SIGNED_IN);
    answer = () => new Response('{}', { status: 202 });
    await analytics.flush();
    expect(calls).toHaveLength(2);
    expect(analytics.queued().events).toHaveLength(0);
  });

  it('drops the batch on 400 and 413', async () => {
    for (const status of [400, 413]) {
      calls = [];
      answer = () => new Response('', { status });
      const analytics = await signedInClient();
      analytics.record(featureEvent());
      await analytics.flush();
      expect(calls).toHaveLength(1);
      expect(analytics.queued().events).toHaveLength(0);
    }
  });

  it('waits for Retry-After on 429', async () => {
    answer = () => new Response('', { status: 429, headers: { 'retry-after': '120' } });
    const analytics = await signedInClient();
    analytics.record(featureEvent());
    await analytics.flush();
    clock += 60_000;
    await analytics.flush();
    expect(calls).toHaveLength(1);
    clock += 61_000;
    answer = () => new Response('{}', { status: 202 });
    await analytics.flush();
    expect(calls).toHaveLength(2);
    expect(analytics.queued().events).toHaveLength(0);
  });

  it('backs off after a network failure', async () => {
    const failing = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    let attempts = 0;
    const analytics = await signedInClient({ fetch: (async (...args: Parameters<typeof fetch>) => { attempts++; return failing(...args); }) as typeof fetch });
    analytics.record(featureEvent());
    await analytics.flush();
    await analytics.flush();
    expect(attempts).toBe(1);
    clock += 31_000;
    await analytics.flush();
    expect(attempts).toBe(2);
    expect(analytics.queued().events).toHaveLength(1);
  });

  it('drops what the service would refuse, one item at a time, and sends the rest', async () => {
    const analytics = await signedInClient();
    const old = { name: 'feature_used', at: new Date(clock - 31 * 24 * 60 * 60 * 1000).toISOString(), props: { feature: 'rail' } };
    const ahead = { name: 'feature_used', at: new Date(clock + 10 * 60 * 1000).toISOString(), props: { feature: 'cli' } };
    analytics.record(old);
    analytics.record(ahead);
    analytics.record(featureEvent('tabs'));
    analytics.recordError('uncaught', 'bad\u0007bell');
    await analytics.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].body.events).toEqual([featureEvent('tabs')]);
    expect(calls[0].body.errors[0].message).toBe('badbell');
    expect(analytics.queued().events).toHaveLength(0);
  });

  it('checks every item against the service rules', () => {
    expect(WireEvent.safeParse({ name: 'Feature', at: AT, props: {} }).success).toBe(false);
    expect(WireEvent.safeParse({ name: 'feature_used', at: AT, props: { '1key': 'x' } }).success).toBe(false);
    expect(WireEvent.safeParse({ name: 'feature_used', at: AT, props: { key: 'tab\u0001' } }).success).toBe(false);
    expect(WireEvent.safeParse({ name: 'feature_used', at: AT, props: Object.fromEntries(Array.from({ length: 13 }, (_, index) => [`k${index}`, 1])) }).success).toBe(false);
    expect(WireEvent.safeParse({ name: 'feature_used', at: AT, props: { feature: 'tabs' } }).success).toBe(true);
    expect(WireError.safeParse({ at: AT, kind: '', message: 'x' }).success).toBe(false);
    expect(freshEnough(AT, Date.parse(AT) + 29 * 24 * 60 * 60 * 1000)).toBe(true);
    expect(freshEnough(AT, Date.parse(AT) - 6 * 60 * 1000)).toBe(false);
  });

  it('reads Retry-After as seconds or a date', () => {
    expect(retryAfterMs('30')).toBe(30_000);
    expect(retryAfterMs(new Date(Date.parse(AT) + 5_000).toUTCString(), Date.parse(AT))).toBe(5_000);
    expect(retryAfterMs('soon')).toBe(60_000);
  });
});
