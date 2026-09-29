import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { CoreService } from '../../apps/desktop/src/core/service';
import { claimClaudeReset, claudeBankedResets, readHarnessUsage, type UsageRuntime } from '../../apps/desktop/src/core/harness/usage';
import { UsageReadings } from '../../apps/desktop/src/core/harness/usage-readings';
import { missingHarness, SYSTEM_ACCOUNT_ID, type HarnessAccountUsage, type HarnessResetClaim, type HarnessResetOutcome } from '../../apps/desktop/src/shared/harness';
import { bankedResetsLabel } from '../../apps/desktop/src/renderer/components/PlanUsage';

// COD-328. Nothing here reaches the network: every request goes to an injected fetch, and no claim is ever sent live,
// because a live claim spends a real reset of the account.
const NOW = new Date('2026-09-28T12:00:00Z');
const grant = (fields: Record<string, unknown>) => ({ id: 'grant_a', resets_left: 1, usable_now: true, ...fields });
const program = (fields: Record<string, unknown> = {}) => ({
  eligible: true,
  next_grant_id: 'grant_a',
  grants: [grant({ resets_left: 2, ends_at: '2026-10-22T00:00:00Z' })],
  ...fields,
});
const usageAnswer = (resets: unknown = program()) => ({
  limits: [{ kind: 'session', percent: 100, resets_at: '2026-09-28T14:00:00Z', scope: null }],
  cedar_ember: resets,
});

describe('the banked resets in Claude’s usage answer', () => {
  it('counts the usable grants and names the one Claude spends next', () => {
    const answer = usageAnswer(program({
      grants: [
        grant({ resets_left: 2, ends_at: '2026-10-22T00:00:00Z' }),
        grant({ id: 'later', resets_left: 1, ends_at: '2026-11-01T00:00:00Z' }),
        grant({ id: 'paused', paused: true }),
        grant({ id: 'past', ends_at: '2026-09-01T00:00:00Z' }),
        grant({ id: 'garbled', ends_at: 'not a date' }),
        grant({ id: 'not_yet', usable_now: false, resets_left: 5 }),
        grant({ id: 'Not Valid' }),
        grant({ id: 'negative', resets_left: -1 }),
      ],
    }));
    expect(claudeBankedResets(answer, NOW)).toEqual({ count: 3, grantId: 'grant_a', expiresAt: '2026-10-22T00:00:00.000Z' });
  });

  it('shows none when the account is not eligible, the next grant is missing or unusable, or the block is absent', () => {
    expect(claudeBankedResets(usageAnswer(program({ eligible: false })), NOW)).toBeUndefined();
    expect(claudeBankedResets(usageAnswer(program({ next_grant_id: null })), NOW)).toBeUndefined();
    expect(claudeBankedResets(usageAnswer(program({ grants: [grant({ usable_now: false })] })), NOW)).toBeUndefined();
    expect(claudeBankedResets(usageAnswer(program({ grants: [grant({ resets_left: 0 })] })), NOW)).toBeUndefined();
    expect(claudeBankedResets(usageAnswer(null), NOW)).toBeUndefined();
    expect(claudeBankedResets({ limits: [] }, NOW)).toBeUndefined();
    expect(claudeBankedResets('not an answer', NOW)).toBeUndefined();
  });

  it('words the count and the end of the next one', () => {
    expect(bankedResetsLabel({ count: 1 })).toBe('1 banked reset');
    expect(bankedResetsLabel({ count: 3, expiresAt: '2026-10-22T00:00:00.000Z' })).toMatch(/^3 banked resets · next one ends /);
  });
});

type Request = { url: string; method: string; authorization: string | null; body?: unknown };

/**
 * A Claude Code folder on a fake disk and a fake Claude. `claim` is Claude's answer to a reset claim: a status and a
 * body, or `throw` for a request that never got an answer.
 */
function claudeAccount(options: {
  expiresAt?: number;
  organization?: string | null;
  usage?: { status: number; body?: unknown };
  claim?: { status: number; body?: unknown } | 'throw';
  home?: string;
}) {
  const requests: Request[] = [];
  const reads: string[] = [];
  const files: Record<string, unknown> = {};
  const runtime: UsageRuntime = {
    run: async (_executable, args) => args.join(' ') === 'auth status'
      ? { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'an@example.com', subscriptionType: 'max' }), stderr: '' }
      : { code: 1, stdout: '', stderr: '' },
    appServer: async () => [],
    fetch: async (input, init) => {
      const method = init?.method ?? 'GET';
      requests.push({
        url: String(input),
        method,
        authorization: new Headers(init?.headers).get('authorization'),
        ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) } : {}),
      });
      if (method === 'GET') {
        const answer = options.usage ?? { status: 200, body: usageAnswer() };
        return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status });
      }
      if (options.claim === 'throw') throw new Error('connection reset');
      const answer = options.claim ?? { status: 200, body: { result: 'reset' } };
      return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status });
    },
    readText: async path => {
      reads.push(path);
      if (!(path in files)) throw new Error('ENOENT');
      return JSON.stringify(files[path]);
    },
    home: options.home ?? join('home', 'person'),
    now: () => NOW,
  };
  const place = (folder: string, accountFile: string) => {
    files[join(folder, '.credentials.json')] = { claudeAiOauth: { accessToken: 'token-value', expiresAt: options.expiresAt ?? Date.parse('2026-09-28T18:00:00Z') } };
    if (options.organization !== null) files[accountFile] = { oauthAccount: { organizationUuid: options.organization ?? 'org-1234', emailAddress: 'an@example.com' } };
  };
  return { runtime, requests, reads, place };
}

describe('reading and spending banked resets', () => {
  const folder = join('accounts', 'claude-code', 'work');

  it('reads the count with the usage and never hands the grant id to the window', async () => {
    const fake = claudeAccount({});
    fake.place(folder, join(folder, '.claude.json'));
    const read = await readHarnessUsage('claude-code', 'claude.exe', folder, fake.runtime);
    expect(read.bankedResets).toEqual({ count: 2, expiresAt: '2026-10-22T00:00:00.000Z' });
    expect(JSON.stringify(read)).not.toContain('grant_a');
    const none = claudeAccount({ usage: { status: 200, body: usageAnswer(null) } });
    none.place(folder, join(folder, '.claude.json'));
    expect((await readHarnessUsage('claude-code', 'claude.exe', folder, none.runtime)).bankedResets).toBeUndefined();
  });

  it('reads the next grant again, then claims it for the account’s organization with the account’s own token', async () => {
    const fake = claudeAccount({});
    fake.place(folder, join(folder, '.claude.json'));
    expect(await claimClaudeReset(folder, 'request-1', fake.runtime)).toBe('reset');
    expect(fake.requests).toEqual([
      { url: 'https://api.anthropic.com/api/oauth/usage?cedar_ember=1', method: 'GET', authorization: 'Bearer token-value' },
      {
        url: 'https://api.anthropic.com/api/organizations/org-1234/reset_rate_limits',
        method: 'POST',
        authorization: 'Bearer token-value',
        body: { program: 'cedar_ember', grant_id: 'grant_a', request_id: 'request-1' },
      },
    ]);
    expect(fake.reads).toEqual([join(folder, '.credentials.json'), join(folder, '.claude.json')]);
  });

  it('finds the system account’s organization in the home folder', async () => {
    const fake = claudeAccount({});
    fake.place(join('home', 'person', '.claude'), join('home', 'person', '.claude.json'));
    expect(await claimClaudeReset(undefined, 'request-1', fake.runtime)).toBe('reset');
    expect(fake.requests[1].url).toBe('https://api.anthropic.com/api/organizations/org-1234/reset_rate_limits');
  });

  it('sends nothing with an expired token, without an organization, or when no grant is left', async () => {
    const expired = claudeAccount({ expiresAt: Date.parse('2026-09-28T11:00:00Z') });
    expired.place(folder, join(folder, '.claude.json'));
    expect(await claimClaudeReset(folder, 'request-1', expired.runtime)).toBe('expired');
    expect(expired.requests).toEqual([]);

    const noOrganization = claudeAccount({ organization: null });
    noOrganization.place(folder, join(folder, '.claude.json'));
    expect(await claimClaudeReset(folder, 'request-1', noOrganization.runtime)).toBe('unreadable');
    const strangeOrganization = claudeAccount({ organization: '../../elsewhere' });
    strangeOrganization.place(folder, join(folder, '.claude.json'));
    expect(await claimClaudeReset(folder, 'request-1', strangeOrganization.runtime)).toBe('unreadable');
    expect([...noOrganization.requests, ...strangeOrganization.requests]).toEqual([]);

    const noneLeft = claudeAccount({ usage: { status: 200, body: usageAnswer(program({ grants: [] })) } });
    noneLeft.place(folder, join(folder, '.claude.json'));
    expect(await claimClaudeReset(folder, 'request-1', noneLeft.runtime)).toBe('none_left');
    const refused = claudeAccount({ usage: { status: 401 } });
    refused.place(folder, join(folder, '.claude.json'));
    expect(await claimClaudeReset(folder, 'request-1', refused.runtime)).toBe('expired');
    expect([...noneLeft.requests, ...refused.requests].every(request => request.method === 'GET')).toBe(true);
  });

  it('maps each answer Claude gives, and treats an unanswered or unconfirmed claim as not known', async () => {
    const cases: [{ status: number; body?: unknown } | 'throw', HarnessResetOutcome][] = [
      [{ status: 200, body: { result: 'not_limited' } }, 'not_limited'],
      [{ status: 200, body: { result: 'already_used' } }, 'already_used'],
      [{ status: 200, body: { result: 'ineligible' } }, 'none_left'],
      [{ status: 200, body: { result: 'cooldown' } }, 'cooling_down'],
      [{ status: 200, body: { result: 'unavailable' } }, 'unconfirmed'],
      [{ status: 200, body: { result: 'something new' } }, 'no_answer'],
      [{ status: 401 }, 'expired'],
      [{ status: 403 }, 'expired'],
      [{ status: 429 }, 'rate_limited'],
      [{ status: 400 }, 'failed'],
      [{ status: 502 }, 'no_answer'],
      ['throw', 'no_answer'],
    ];
    for (const [claim, outcome] of cases) {
      const fake = claudeAccount({ claim });
      fake.place(folder, join(folder, '.claude.json'));
      expect(await claimClaudeReset(folder, 'request-1', fake.runtime)).toBe(outcome);
    }
  });
});

describe('spending a reset from Settings', () => {
  let store: Store;
  beforeEach(() => { store = new Store(':memory:'); });
  afterEach(() => store.close());

  function core(answers: HarnessResetOutcome[]) {
    const claims: { configDir?: string; requestId: string }[] = [];
    let usageReads = 0;
    let release: () => void = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    let hold = false;
    const service = new CoreService(store, () => {}, async () => { throw new Error('unused'); }, undefined, () => NOW, {
      detect: async () => [{ ...missingHarness('claude-code', 'win32'), executable: 'claude.exe', auth: 'logged_in', status: 'signed_in' }],
      usage: async () => {
        usageReads += 1;
        return { email: 'an@example.com', windows: [{ kind: 'session', usedPercent: 0 }] };
      },
      claimReset: async (configDir, requestId) => {
        claims.push({ ...(configDir ? { configDir } : {}), requestId });
        if (hold) await held;
        return answers.shift() ?? 'reset';
      },
      execute: async () => { throw new Error('unused'); },
    });
    return { service, claims, usageReads: () => usageReads, holdNext: () => { hold = true; }, release: () => release() };
  }

  it('reads usage again after an answer and hands it back with the outcome', async () => {
    const fake = core(['reset']);
    const claim = await fake.service.command('claimHarnessReset', { accountId: SYSTEM_ACCOUNT_ID }) as HarnessResetClaim;
    expect(claim.outcome).toBe('reset');
    expect(claim.usage['claude-code']?.[0].windows).toEqual([{ kind: 'session', usedPercent: 0 }]);
    expect(fake.claims).toHaveLength(1);
    expect(fake.usageReads()).toBe(1);
  });

  it('joins a second click to the claim already running instead of spending another reset', async () => {
    const fake = core(['reset']);
    fake.holdNext();
    const first = fake.service.command('claimHarnessReset', { accountId: SYSTEM_ACCOUNT_ID });
    const second = fake.service.command('claimHarnessReset', { accountId: SYSTEM_ACCOUNT_ID });
    fake.release();
    expect(await second).toEqual(await first);
    expect(fake.claims).toHaveLength(1);
  });

  it('sends a claim Claude did not confirm again as the same claim, and a new one after an answer', async () => {
    const fake = core(['unconfirmed', 'no_answer', 'reset', 'reset']);
    await expect(fake.service.command('claimHarnessReset', { accountId: SYSTEM_ACCOUNT_ID })).rejects.toThrow('Claude chưa xác nhận lượt reset.');
    await expect(fake.service.command('claimHarnessReset', { accountId: SYSTEM_ACCOUNT_ID })).rejects.toThrow('Claude không trả lời yêu cầu reset.');
    await fake.service.command('claimHarnessReset', { accountId: SYSTEM_ACCOUNT_ID });
    await fake.service.command('claimHarnessReset', { accountId: SYSTEM_ACCOUNT_ID });
    const [first, second, third, fourth] = fake.claims.map(claim => claim.requestId);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(fourth).not.toBe(first);
    // Usage was read again after every attempt, failures included, so nothing on screen stays stale.
    expect(fake.usageReads()).toBe(4);
  });

  it('keeps a failure visible and never reports it as a reset', async () => {
    const fake = core(['expired', 'rate_limited']);
    await expect(fake.service.command('claimHarnessReset', { accountId: SYSTEM_ACCOUNT_ID })).rejects.toThrow('Phiên đăng nhập Claude Code đã hết hạn');
    await expect(fake.service.command('claimHarnessReset', { accountId: SYSTEM_ACCOUNT_ID })).rejects.toThrow('Claude đang giới hạn số lần reset');
  });

  it('refuses an account it does not know, and a core with no way to claim', async () => {
    const fake = core([]);
    await expect(fake.service.command('claimHarnessReset', { accountId: 'someone-else' })).rejects.toThrow('Không còn tài khoản này.');
    expect(fake.claims).toEqual([]);
    const bare = new CoreService(store, () => {}, async () => { throw new Error('unused'); }, undefined, undefined, {
      detect: async () => [], execute: async () => { throw new Error('unused'); },
    });
    await expect(bare.command('claimHarnessReset', { accountId: SYSTEM_ACCOUNT_ID })).rejects.toThrow('Orglet không dùng được lượt reset ở đây.');
  });
});

describe('banked resets in the last good reading', () => {
  let store: Store;
  beforeEach(() => { store = new Store(':memory:'); });
  afterEach(() => store.close());

  const fresh: HarnessAccountUsage = {
    accountId: SYSTEM_ACCOUNT_ID, email: 'an@example.com', checkedAt: '2026-09-28T10:00:00.000Z',
    windows: [{ kind: 'weekly', usedPercent: 40, resetsAt: '2026-10-30T00:00:00.000Z' }],
    bankedResets: { count: 2, expiresAt: '2026-10-22T00:00:00.000Z' },
  };
  const expired = (checkedAt: string): HarnessAccountUsage => ({ accountId: SYSTEM_ACCOUNT_ID, email: 'an@example.com', windows: [], unavailable: 'expired', checkedAt });

  it('keeps the count while the sign-in is expired, and drops it once the reset has run out', () => {
    const readings = new UsageReadings(store);
    readings.settle('claude-code', fresh, new Date('2026-09-28T10:00:00Z'));
    const stale = readings.settle('claude-code', expired('2026-09-28T12:00:00.000Z'), new Date('2026-09-28T12:00:00Z'));
    expect(stale).toEqual(expect.objectContaining({ unavailable: 'expired', bankedResets: fresh.bankedResets, asOf: fresh.checkedAt }));
    const later = readings.settle('claude-code', expired('2026-10-23T00:00:00.000Z'), new Date('2026-10-23T00:00:00Z'));
    expect(later.bankedResets).toBeUndefined();
    expect(later.asOf).toBe(fresh.checkedAt);
  });
});
