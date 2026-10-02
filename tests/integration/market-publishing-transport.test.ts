import { expect, it, vi } from 'vitest';
import { MarketPublishingTransport, publishingRelayAllowed } from '../../apps/desktop/src/main/market-publishing';
import { MARKET_URL } from '../../apps/desktop/src/shared/market';
import { PublishingRelay } from '../../apps/desktop/src/shared/market-desktop';

const binding = { accountKey: 'fixture-account', generation: 1, status: 'available' as const };
const operation = { action: 'send', ...binding, operation: 'version', target: 'fixture-listing', key: 'c6639dce-1304-4f39-9b7d-a9d3b9f5aa60', requestText: '{}' };
const { status: _status, ...request } = operation;

function setup(response: () => Promise<Response>) {
  let current = { ...binding };
  const getAccessToken = vi.fn(async () => 'private-fixture-token');
  const fetcher = vi.fn(response);
  const transport = new MarketPublishingTransport({
    publishingContext: () => current,
    getAccessToken,
    refreshProfile: async () => ({ status: 'signed_in' as const }),
  }, fetcher as unknown as typeof fetch);
  return { transport, fetcher, getAccessToken, switchAccount: () => { current = { ...binding, generation: 2 }; } };
}

it('dispatches only fixed route with exact immutable bytes/key and resource-specific main token', async () => {
  const fixture = setup(async () => Response.json({ operation: 'version', listingId: 'fixture-listing', version: 2, state: 'pending' }));
  expect(await fixture.transport.send(request, () => true)).toEqual({ state: 'accepted', receipt: { operation: 'version', listingId: 'fixture-listing', version: 2, state: 'pending' } });
  expect(fixture.getAccessToken).toHaveBeenCalledWith(MARKET_URL);
  expect(fixture.fetcher).toHaveBeenCalledWith(`${MARKET_URL}/v2/listings/fixture-listing/versions`, expect.objectContaining({ body: '{}', redirect: 'error', method: 'POST', headers: expect.objectContaining({ 'Idempotency-Key': request.key }) }));
});

it.each([
  { operation: 'create', listingId: 'fixture-listing', version: 2, state: 'pending' },
  { operation: 'version', listingId: 'wrong-listing', version: 2, state: 'pending' },
  { operation: 'unpublish', listingId: 'fixture-listing', publicationEpoch: 2 },
])('keeps mismatched independently valid success receipts unknown', async receipt => {
  const fixture = setup(async () => Response.json(receipt));
  expect(await fixture.transport.send(request, () => true)).toEqual({ state: 'unknown' });
});

it.each(['bad json', 'x'.repeat(65 * 1024)])('keeps malformed/oversize successful responses unknown', async body => {
  const fixture = setup(async () => new Response(body));
  expect(await fixture.transport.send(request, () => true)).toEqual({ state: 'unknown' });
});

it('labels predispatch account change notSent and postdispatch account change unknown', async () => {
  const before = setup(async () => Response.json({}));
  before.switchAccount();
  expect(await before.transport.send(request, () => true)).toEqual({ state: 'notSent', code: 'account_changed' });
  expect(before.fetcher).not.toHaveBeenCalled();
  let after: ReturnType<typeof setup>;
  after = setup(async () => {
    after.switchAccount();
    return Response.json({ operation: 'version', listingId: 'fixture-listing', version: 2, state: 'pending' });
  });
  expect(await after.transport.send(request, () => true)).toEqual({ state: 'unknown' });
});

it('uses only bounded structured client denial as rejection and never returns raw errors or credentials', async () => {
  const rejected = setup(async () => Response.json({ code: 'submission_limit' }, { status: 429 }));
  expect(await rejected.transport.send(request, () => true)).toEqual({ state: 'rejected', code: 'submission_limit' });
  const malformed = setup(async () => Response.json({ code: 'private-fixture-token', exception: 'private' }, { status: 400 }));
  expect(await malformed.transport.send(request, () => true)).toEqual({ state: 'unknown' });
  const failed = setup(async () => { throw new Error('private-fixture-token'); });
  expect(await failed.transport.send(request, () => true)).toEqual({ state: 'unknown' });
});

it('refuses forged sends under preview/listOwn/generic callers and binds unpublish target', () => {
  const relay = PublishingRelay.parse(request);
  expect(publishingRelayAllowed(undefined, relay)).toBe(false);
  expect(publishingRelayAllowed({ action: 'listOwn' }, relay)).toBe(false);
  expect(publishingRelayAllowed({ action: 'preview', source: { kind: 'orglet', entityId: request.key }, metadata: { name: 'Fixture', summary: 'Fixture', tags: [], language: 'en', license: 'CC-BY-4.0', changelog: '' }, target: null }, relay)).toBe(false);
  expect(publishingRelayAllowed({ action: 'unpublish', listingId: request.target, confirmation: 'a'.repeat(64) }, relay)).toBe(false);
  expect(publishingRelayAllowed({ action: 'submit', previewId: request.key }, relay)).toBe(true);
});

it('rechecks caller lifetime after delayed token acquisition and preserves unknown after dispatch', async () => {
  let callerActive = true;
  let resolveToken: (token: string) => void = () => {};
  const fixture = setup(async () => Response.json({ operation: 'version', listingId: 'fixture-listing', version: 2, state: 'pending' }));
  fixture.getAccessToken.mockImplementation(() => new Promise(resolve => { resolveToken = resolve; }));
  const sending = fixture.transport.send(request, () => callerActive);
  callerActive = false;
  resolveToken('private-fixture-token');
  expect(await sending).toEqual({ state: 'notSent', code: 'caller_expired' });
  expect(fixture.fetcher).not.toHaveBeenCalled();
  callerActive = true;
  const after = setup(async () => {
    callerActive = false;
    return Response.json({ operation: 'version', listingId: 'fixture-listing', version: 2, state: 'pending' });
  });
  expect(await after.transport.send(request, () => callerActive)).toEqual({ state: 'unknown' });
});

it('accepts worst escaped bounded ten-listing latest/current summary above128KiB', async () => {
  const listings = Array.from({ length: 10 }, (_, index) => {
    const listing = {
      listingId: `fixture-${index}`, kind: 'orglet', name: 'n'.repeat(80), summary: 's'.repeat(240),
      tags: Array(10).fill('t'.repeat(32)), language: 'en', license: 'CC-BY-4.0', changelog: '\u0001'.repeat(2000),
      author: { displayName: 'Fixture' }, sha256: 'a'.repeat(64), reviewDigest: 'b'.repeat(64),
    };
    return { listingId: listing.listingId, kind: listing.kind, latest: { listing: { ...listing, version: 2 }, state: 'pending' }, published: { ...listing, version: 1 }, publicationEpoch: 0 };
  });
  const summaries = { publishingEnabled: true, listings, allowance: { listingLimit: 10, listingCount: 10, submissionsInHour: 0, submissionLimit: 5 } };
  expect(Buffer.byteLength(JSON.stringify(summaries))).toBeGreaterThan(128 * 1024);
  const fixture = setup(async () => Response.json(summaries));
  expect(await fixture.transport.context()).toMatchObject({ status: 'available', summaries });
});

it('retains owner reads but refuses publishing readiness when the server write gate is closed', async () => {
  const summaries = { publishingEnabled: false, listings: [], allowance: { listingLimit: 10, listingCount: 0, submissionsInHour: 0, submissionLimit: 5 } };
  const fixture = setup(async () => Response.json(summaries));
  expect(await fixture.transport.context()).toMatchObject({ status: 'unavailable', summaries });
  expect(fixture.fetcher).toHaveBeenCalledTimes(1);
});
