import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { MarketModerationJournal } from '../../apps/desktop/src/core/market/moderation-journal';
import { Backups } from '../../apps/desktop/src/core/storage/backup';
import { eraseEverything } from '../../apps/desktop/src/core/storage/erase';
import { commands } from '../../apps/desktop/src/shared/contracts';
import { MarketModerationTransport } from '../../apps/desktop/src/main/market-moderation';
import { MARKET_SEED_BODIES } from '../../apps/desktop/src/shared/market-seed';
import { MARKET_URL } from '../../apps/desktop/src/shared/market';
import { MarketReportInput, MarketDecisionInput, MarketModerationAction, MarketModerationReceipt } from '../../apps/desktop/src/shared/market-moderation';
import { validateMarketSubmission } from '../../apps/desktop/src/shared/market-publishing';
import { reviewerSubjects, canReview } from '../../services/market/src/moderation';
import { moderationRoute } from '../../services/market/src/moderation-routes';
import { readSubmissionBody } from '../../services/market/src/owner-routes';

const exact = { listingId: 'fixture-listing', version: 1, sha256: 'a'.repeat(64), reviewDigest: 'b'.repeat(64) };
const input = { ...exact, reason: 'other' as const, explanation: 'Please inspect the public instructions.' };
const request = { action: 'report' as const, input, key: '10000000-0000-4000-8000-000000000001' };
const receipt = { id: '10000000-0000-4000-8000-000000000002', operation: 'report', ...{ listingId: exact.listingId, version: 1 }, state: 'accepted', reportId: '10000000-0000-4000-8000-000000000003' };
const stores: Store[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.db.close(); });

function setup(respond: (url: string, init?: RequestInit) => Promise<Response>) {
  let context = { accountKey: 'fixture-account', generation: 1, status: 'available' as const };
  const token = vi.fn(async () => 'private-fixture-token');
  const fetcher = vi.fn(respond);
  const path = join(mkdtempSync(join(tmpdir(), 'orglet-moderation-unit-')), 'orglet.sqlite');
  const store = new Store(path); stores.push(store);
  const journal = new MarketModerationJournal(store);
  const account = { publishingContext: () => context, getAccessToken: token, refreshProfile: async () => ({ status: 'signed_in' as const }) };
  const transport = new MarketModerationTransport(account, fetcher as unknown as typeof fetch, { request: async action => journal.execute(action) });
  return { transport, account, journal, store, path, token, fetcher, change: () => { context = { ...context, generation: context.generation + 1 }; }, differentAccount: () => { context = { ...context, accountKey: 'another-account', generation: context.generation + 1 }; } };
}

it.each([undefined, '', '[]', '["fixture-reviewer",""]', 'true', '["fixture-reviewer","fixture-reviewer"]', '[" fixture-reviewer"]', '["fixture-reviewer",4]', '{"admin":true}'])('review configuration fails closed as a whole: %s', configuration => {
  expect(reviewerSubjects(configuration)).toBeUndefined();
  expect(canReview({ subject: 'fixture-reviewer', displayName: 'Staff', grantId: 'family', publishedListings: 10 }, configuration)).toBe(false);
});

it('matches only exact verified subject, never display name or publisher capacity', () => {
  const identity = { subject: 'fixture-reviewer', displayName: 'Ordinary publisher', grantId: 'family', publishedListings: 0 };
  expect(canReview(identity, '["fixture-reviewer"]')).toBe(true);
  expect(canReview({ ...identity, subject: 'another-subject', displayName: 'fixture-reviewer', publishedListings: 10 }, '["fixture-reviewer"]')).toBe(false);
});

it('strictly bounds multibyte evidence and rejects credentials, role claims, time and unknown fields', () => {
  expect(MarketReportInput.safeParse(input).success).toBe(true);
  expect(MarketReportInput.safeParse({ ...input, explanation: 'é'.repeat(1024) }).success).toBe(true);
  expect(MarketReportInput.safeParse({ ...input, explanation: 'é'.repeat(1025) }).success).toBe(false);
  for (const field of ['subject', 'role', 'admin', 'createdAt']) expect(MarketReportInput.safeParse({ ...input, [field]: 'forged' }).success).toBe(false);
  expect(MarketReportInput.safeParse({ ...input, explanation: 'sk-' + 'a'.repeat(45) }).success).toBe(false);
  expect(MarketModerationAction.safeParse({ ...request, url: 'https://untrusted.test' }).success).toBe(false);
  expect(MarketDecisionInput.safeParse({ expected: exact, decision: 'approve', reason: 'Inspected.' }).success).toBe(false);
});

it('correlates operation, state and report identity in receipts', () => {
  expect(MarketModerationReceipt.safeParse(receipt).success).toBe(true);
  expect(MarketModerationReceipt.safeParse({ ...receipt, state: 'approved' }).success).toBe(false);
  expect(MarketModerationReceipt.safeParse({ ...receipt, reportId: undefined }).success).toBe(false);
});

it('uses only a main-authenticated fixed route and returns no bearer/account identity', async () => {
  const fixture = setup(async () => Response.json(receipt));
  const result = await fixture.transport.perform(request, () => true);
  expect(result).toEqual({ kind: 'receipt', receipt });
  expect(fixture.token).toHaveBeenCalledWith(MARKET_URL);
  expect(fixture.fetcher).toHaveBeenCalledWith(`${MARKET_URL}/v2/listings/fixture-listing/versions/1/report`, expect.objectContaining({ method: 'POST', redirect: 'error', body: JSON.stringify(input), headers: expect.objectContaining({ 'Idempotency-Key': request.key }) }));
  expect(JSON.stringify(result)).not.toContain('private-fixture-token');
  expect(JSON.stringify(result)).not.toContain('fixture-account');
});

it('retries lost responses with identical bytes/key and never replaces unknown with a later refusal', async () => {
  let calls = 0;
  const fixture = setup(async () => { calls += 1; if (calls === 1) throw new Error('private-fixture-token'); return calls === 2 ? Response.json({ code: 'review_forbidden' }, { status: 403 }) : Response.json(receipt); });
  expect(await fixture.transport.perform(request, () => true)).toEqual({ kind: 'unknown' });
  expect(await fixture.transport.perform(request, () => true)).toEqual({ kind: 'unknown' });
  expect(await fixture.transport.perform(request, () => true)).toEqual({ kind: 'receipt', receipt });
  expect(fixture.fetcher.mock.calls.map(([, init]) => [init?.body, (init?.headers as Record<string, string>)['Idempotency-Key']])).toEqual(Array(3).fill([JSON.stringify(input), request.key]));
});

it('refuses changed retry payloads and reuse by a different account before dispatch', async () => {
  const fixture = setup(async () => { throw new Error('Lost response'); });
  await fixture.transport.perform(request, () => true);
  expect(await fixture.transport.perform({ ...request, input: { ...input, explanation: 'Changed evidence.' } }, () => true)).toEqual({ kind: 'error', code: 'idempotency_conflict' });
  fixture.differentAccount();
  expect(await fixture.transport.perform(request, () => true)).toEqual({ kind: 'error', code: 'idempotency_conflict' });
  expect(fixture.fetcher).toHaveBeenCalledTimes(1);
});

it('checks account and caller after token acquisition and keeps postdispatch changes unknown', async () => {
  const before = setup(async () => Response.json(receipt));
  before.token.mockImplementation(async () => { before.change(); return 'private-fixture-token'; });
  expect((await before.transport.perform(request, () => true)).kind).toBe('error');
  expect(before.fetcher).not.toHaveBeenCalled();
  let active = true;
  const after = setup(async () => { active = false; return Response.json(receipt); });
  expect(await after.transport.perform(request, () => active)).toEqual({ kind: 'unknown' });
});

it.each([Response.json({ ...receipt, listingId: 'wrong-listing' }), Response.json({ code: 'storage_failed' }, { status: 500 }), Response.json({ code: 'private_fixture_token' }, { status: 400 }), new Response('x'.repeat(8193)), new Response('not json')])('keeps wrong/oversized/malformed server success and failures unknown', async response => {
  const fixture = setup(async () => response);
  expect(await fixture.transport.perform(request, () => true)).toEqual({ kind: 'unknown' });
});

it('reconstructs and verifies complete literal review bytes against both immutable digests', async () => {
  const submission = { kind: 'orglet', name: 'Fixture', summary: 'Read supplied text.', tags: [], language: 'en', license: 'CC-BY-4.0', changelog: '', template: JSON.parse(MARKET_SEED_BODIES['research-friend:1']) };
  const content = await validateMarketSubmission(JSON.stringify(submission));
  expect(content.ok).toBe(true);
  if (!content.ok) throw new Error('Invalid fixture');
  const { template, ...metadata } = content.submission;
  const listing = { ...metadata, ...exact, sha256: content.sha256, reviewDigest: content.reviewDigest, author: { displayName: 'Fixture author' } };
  const detail = { listing, expected: { ...exact, sha256: content.sha256, reviewDigest: content.reviewDigest, publicationEpoch: 0, reviewRevision: 0, moderationRevision: 0, publishedVersion: null }, state: 'pending', reason: '', hidden: false, hiddenReason: '', selfReview: false, reportCount: 0 };
  let corrupt = false;
  const fixture = setup(async url => Response.json(url.endsWith('/body') ? (corrupt ? { ...template, worker: { ...('worker' in template ? template.worker : {}), instructions: 'Corrupted bytes.' } } : template) : detail));
  const action = { action: 'detail' as const, listingId: exact.listingId, version: 1 };
  const result = await fixture.transport.perform(action, () => true);
  expect(result.kind).toBe('detail');
  if (result.kind === 'detail') expect(JSON.parse(result.requestText)).toEqual(content.submission);
  corrupt = true;
  expect(await fixture.transport.perform(action, () => true)).toEqual({ kind: 'error', code: 'moderation_unavailable' });
});

it('counts actual report stream bytes independently of declared length', async () => {
  const request = new Request('https://fixture.test', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '2' }, body: '{}'.padEnd(8193) });
  await expect(readSubmissionBody(request, 8192)).rejects.toMatchObject({ status: 413, code: 'request_size' });
});

it('recovers exact pending actions after SQLite and transport restart, excludes other accounts and does not auto-send', async () => {
  const fixture = setup(async () => { throw new Error('Lost committed response'); });
  expect(await fixture.transport.perform(request, () => true)).toEqual({ kind: 'unknown' });
  fixture.store.db.close(); stores.splice(stores.indexOf(fixture.store), 1);
  const reopened = new Store(fixture.path); stores.push(reopened);
  const journal = new MarketModerationJournal(reopened);
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(receipt));
  const transport = new MarketModerationTransport(fixture.account, fetcher as unknown as typeof fetch, { request: async action => journal.execute(action) });
  expect(fetcher).not.toHaveBeenCalled();
  expect(await transport.perform({ action: 'journal' }, () => true)).toEqual({ kind: 'journal', operations: [request] });
  expect(fetcher).not.toHaveBeenCalled();
  expect(journal.execute({ action: 'read', accountKey: 'different-account' })).toEqual([]);
  expect(await transport.perform({ action: 'retry', operationId: request.key }, () => true)).toEqual({ kind: 'receipt', receipt });
  expect(fetcher.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(input));
  expect(await transport.perform({ action: 'journal' }, () => true)).toEqual({ kind: 'journal', operations: [] });
});

it('keeps ten unresolved journal entries intact and refuses an eleventh without evicting one', () => {
  const fixture = setup(async () => Response.json(receipt));
  const actions = Array.from({ length: 10 }, () => ({ ...request, key: crypto.randomUUID() }));
  for (const action of actions) expect(fixture.journal.execute({ action: 'begin', accountKey: 'fixture-account', request: action })).toEqual({ ok: true, wasUnknown: false });
  expect(fixture.journal.execute({ action: 'begin', accountKey: 'fixture-account', request: { ...request, key: crypto.randomUUID() } })).toEqual({ ok: false, code: 'pending_limit' });
  expect(fixture.journal.execute({ action: 'read', accountKey: 'other-account' })).toEqual([]);
  expect(fixture.journal.execute({ action: 'begin', accountKey: 'other-account', request: { ...request, key: crypto.randomUUID() } })).toEqual({ ok: false, code: 'pending_limit' });
  expect(fixture.journal.execute({ action: 'read', accountKey: 'fixture-account' })).toEqual(actions);
  expect(fixture.journal.execute({ action: 'begin', accountKey: 'fixture-account', request: actions[0] })).toEqual({ ok: true, wasUnknown: true });
  fixture.journal.execute({ action: 'finish', accountKey: 'fixture-account', key: actions[0].key, result: 'error' });
  expect((fixture.journal.execute({ action: 'read', accountKey: 'fixture-account' }) as unknown[])).toHaveLength(10);
});

it('keeps moderation journal authority outside generic commands and backup exports, and full erase removes it', () => {
  const fixture = setup(async () => Response.json(receipt));
  fixture.journal.execute({ action: 'begin', accountKey: 'fixture-account', request });
  expect('marketModerationJournal' in commands).toBe(false);
  expect('marketModeration' in commands).toBe(false);
  const backup = new Backups(fixture.store, () => false, () => {}).export();
  expect(backup).not.toContain('marketModerationOperations');
  expect(backup).not.toContain(request.key);
  eraseEverything(fixture.store);
  expect(fixture.journal.execute({ action: 'read', accountKey: 'fixture-account' })).toEqual([]);
});

it.each(['/v2/me/moderation', '/v2/review/queue', '/v2/review/listings/fixture-listing/versions/1', '/v2/review/listings/fixture-listing/versions/1/body', '/v2/review/listings/fixture-listing/versions/1/reports'])('refuses unauthenticated privileged reads/HEAD before touching storage: %s', async path => {
  for (const method of ['GET', 'HEAD']) {
    const response = await moderationRoute(new Request(`https://fixture.test${path}`, { method }), {});
    expect(response?.status).toBe(401);
    expect(response?.headers.get('cache-control')).toBe('no-store');
    if (method === 'HEAD') expect(await response?.text()).toBe('');
  }
});
