import { MARKET_SEED_BODIES, seedCatalog } from '../../../apps/desktop/src/shared/market-seed';
import { catalogPageV2 } from './catalog-v2';
import { ownerRoute, privateReply, type MarketEnvironment } from './owner-routes';
import { listingBody, publicListingSummary } from './listings';
import { seedCatalogV2 } from './catalog-v2';
import { sha256 } from './content';

export default {
  async fetch(request: Request, environment: MarketEnvironment = {}): Promise<Response> {
    const owned = await ownerRoute(request, environment);
    if (owned) return owned;
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/v2/catalog') {
      const errorHeaders = { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
      try {
        const page = await catalogPageV2(url.searchParams, environment.MARKET_DB);
        const status = page === undefined ? 400 : 200;
        console.log(JSON.stringify({ operation: 'catalog-v2', method: request.method, status }));
        if (page === undefined) return new Response(request.method === 'HEAD' ? null : 'Tham số danh mục không hợp lệ.', { status, headers: errorHeaders });
        return reply(request, page, environment.MARKET_DB ? 'no-store' : 'public, max-age=300');
      } catch {
        console.log(JSON.stringify({ operation: 'catalog-v2', method: request.method, status: 500 }));
        return new Response(request.method === 'HEAD' ? null : 'Không thể đọc danh mục.', { status: 500, headers: errorHeaders });
      }
    }
    const publicSummary = /^\/v2\/listings\/([a-z0-9][a-z0-9-]{0,79})$/.exec(path);
    if (publicSummary) {
      if (url.search) return privateReply(request, { code: 'invalid_request' }, 400);
      try {
        const seeds = await seedCatalogV2();
        const listing = seeds.listings.find(item => item.listingId === publicSummary[1]) ??
          (environment.MARKET_DB ? await publicListingSummary(environment.MARKET_DB, publicSummary[1]) : undefined);
        return listing ? privateReply(request, listing) : privateReply(request, { code: 'not_found' }, 404);
      } catch {
        return privateReply(request, { code: 'storage_failed' }, 500);
      }
    }
    const publicVersion = /^\/v2\/listings\/([a-z0-9][a-z0-9-]{0,79})\/versions\/([1-9][0-9]*)$/.exec(path);
    if (publicVersion) {
      const version = Number(publicVersion[2]);
      if (url.search || !Number.isSafeInteger(version)) return privateReply(request, { code: 'not_found' }, 404);
      const curatedBody = MARKET_SEED_BODIES[`${publicVersion[1]}:${version}`];
      if (curatedBody) return reply(request, curatedBody, 'public, max-age=31536000, immutable', await sha256(new TextEncoder().encode(curatedBody)));
      if (!environment.MARKET_DB) return privateReply(request, { code: 'not_found' }, 404);
      try {
        const body = await listingBody(environment.MARKET_DB, publicVersion[1], version);
        if (!body) return privateReply(request, { code: 'not_found' }, 404);
        return reply(request, body.bytes, 'no-store', body.hash);
      } catch {
        return privateReply(request, { code: 'storage_failed' }, 500);
      }
    }
    const catalog = await seedCatalog();
    if (path === '/v1/catalog') return reply(request, JSON.stringify(catalog), 'public, max-age=300');
    const match = /^\/v1\/listings\/([a-z0-9-]+)\/versions\/([1-9][0-9]*)$/.exec(path);
    const body = match ? MARKET_SEED_BODIES[`${match[1]}:${match[2]}`] : undefined;
    if (!body) return new Response('Not found', { status: 404 });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return reply(request, body, 'public, max-age=31536000, immutable', hash);
  },
};

function reply(request: Request, body: string | Uint8Array<ArrayBuffer>, cache: string, hash?: string) {
  const entityTag = hash ? `"${hash}"` : undefined;
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
    ...(entityTag ? { ETag: entityTag } : {}),
  };
  const validators = request.headers.get('if-none-match');
  // GET/HEAD use weak comparison; Cloudflare can weaken ETags when compressing responses.
  const unchanged = entityTag && validators && (
    validators.trim() === '*' ||
    validators.split(',').some(validator => validator.trim().replace(/^W\//, '') === entityTag)
  );
  if (unchanged) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : body, { headers });
}
