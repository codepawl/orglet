import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import marketWorker from '../../services/market/src/index';
import { MarketCatalog, MarketCatalogPageV2 } from '../../apps/desktop/src/shared/market';
import { MARKET_SEED_BODIES } from '../../apps/desktop/src/shared/market-seed';

const origin = 'https://market.orglet.codepawl.com';

it('pages the real v2 handler with bounded display-only authors and deterministic next cursors', async () => {
  const firstResponse = await marketWorker.fetch(new Request(`${origin}/v2/catalog?limit=1`));
  expect(firstResponse.status).toBe(200);
  const first = MarketCatalogPageV2.parse(await firstResponse.json());
  expect(first.listings).toHaveLength(1);
  expect(first.listings[0].author).toEqual({ displayName: 'CodePawl' });
  expect(first.nextCursor).not.toBeNull();
  const nextResponse = await marketWorker.fetch(new Request(`${origin}/v2/catalog?limit=1&cursor=${first.nextCursor}`));
  const next = MarketCatalogPageV2.parse(await nextResponse.json());
  expect(next.listings).toHaveLength(1);
  expect(next.listings[0].listingId).not.toBe(first.listings[0].listingId);
  expect(next.nextCursor).toBeNull();
  const repeated = await marketWorker.fetch(new Request(`${origin}/v2/catalog?limit=1`));
  expect(await repeated.json()).toEqual(first);
  const head = await marketWorker.fetch(new Request(`${origin}/v2/catalog?limit=1`, { method: 'HEAD' }));
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
  expect(head.headers.get('cache-control')).toBe(firstResponse.headers.get('cache-control'));
});

it.each(['limit=0', 'limit=101', 'limit=01', 'limit=-1', 'limit=1&limit=2', 'cursor=', 'cursor=invalid', `cursor=${btoa('0'.repeat(64) + ':1').replace(/=+$/, '')}`, 'unknown=private'])('refuses invalid or stale pagination %s without echoing input', async query => {
  for (const method of ['GET', 'HEAD']) {
    const response = await marketWorker.fetch(new Request(`${origin}/v2/catalog?${query}`, { method }));
    expect(response.status).toBe(400);
    expect(await response.text()).toBe(method === 'HEAD' ? '' : 'Tham số danh mục không hợp lệ.');
  }
});

it('keeps exact v1 catalog/immutable bytes and HEAD/weak conditional behavior', async () => {
  const response = await marketWorker.fetch(new Request(`${origin}/v1/catalog`));
  const catalog = MarketCatalog.parse(await response.json());
  const expectedHashes = [
    '724595ad545757cedb0f08c43252688b57d5c73f8992b20e393d50dad00ccd4c',
    '041c25534aa8f52efa6aaf5bf3b4b2069ca87b445c2180657398c9a8bddbe45f',
  ];
  expect(catalog.listings.map(listing => listing.sha256)).toEqual(expectedHashes);
  expect(catalog.listings.every(listing => listing.author === 'CodePawl')).toBe(true);
  for (const listing of catalog.listings) {
    const url = `${origin}/v1/listings/${listing.listingId}/versions/${listing.version}`;
    const bodyResponse = await marketWorker.fetch(new Request(url));
    const body = await bodyResponse.text();
    expect(body).toBe(MARKET_SEED_BODIES[`${listing.listingId}:${listing.version}`]);
    expect(createHash('sha256').update(body).digest('hex')).toBe(listing.sha256);
    const head = await marketWorker.fetch(new Request(url, { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    for (const validator of [`W/"${listing.sha256}"`, `"other", W/"${listing.sha256}"`, '*']) {
      const revalidated = await marketWorker.fetch(new Request(url, { headers: { 'if-none-match': validator } }));
      expect(revalidated.status).toBe(304);
      expect(await revalidated.text()).toBe('');
    }
  }
});

it('keeps public routes read-only and logs only a fixed operation, allowed method and status', async () => {
  const logging = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const secretQuery = 'sk-fixturesecret12345';
    const response = await marketWorker.fetch(new Request(`${origin}/v2/catalog?cursor=${secretQuery}`, { headers: { Authorization: 'Bearer fixture-only-token' } }));
    expect(response.status).toBe(400);
    expect(logging).toHaveBeenCalledWith(JSON.stringify({ operation: 'catalog-v2', method: 'GET', status: 400 }));
    expect(JSON.stringify(logging.mock.calls)).not.toContain(secretQuery);
    expect(JSON.stringify(logging.mock.calls)).not.toContain('fixture-only-token');
    for (const method of ['POST', 'PUT', 'DELETE']) {
      expect((await marketWorker.fetch(new Request(`${origin}/v2/catalog`, { method }))).status).toBe(405);
    }
    expect((await marketWorker.fetch(new Request(`${origin}/v2/listings/new/versions/1`))).status).toBe(404);
  } finally {
    logging.mockRestore();
  }
});

it.each([400, 500])('keeps v2 GET/HEAD error headers identical for status %s and redacts failures', async status => {
  const privateValue = 'fixture-private-failure';
  const logging = vi.spyOn(console, 'log').mockImplementation(() => {});
  const digest = status === 500 ? vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error(privateValue)) : undefined;
  try {
    const url = `${origin}/v2/catalog${status === 400 ? `?cursor=${privateValue}` : ''}`;
    const get = await marketWorker.fetch(new Request(url));
    const head = await marketWorker.fetch(new Request(url, { method: 'HEAD' }));
    expect(get.status).toBe(status);
    expect(head.status).toBe(status);
    expect(Object.fromEntries(head.headers)).toEqual(Object.fromEntries(get.headers));
    expect(get.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(get.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await get.text()).toBe(status === 400 ? 'Tham số danh mục không hợp lệ.' : 'Không thể đọc danh mục.');
    expect(await head.text()).toBe('');
    expect(logging.mock.calls).toEqual([
      [JSON.stringify({ operation: 'catalog-v2', method: 'GET', status })],
      [JSON.stringify({ operation: 'catalog-v2', method: 'HEAD', status })],
    ]);
    expect(JSON.stringify(logging.mock.calls)).not.toContain(privateValue);
  } finally {
    digest?.mockRestore();
    logging.mockRestore();
  }
});
