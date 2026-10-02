import { MARKET_SEED_BODIES, seedCatalog } from '../../../apps/desktop/src/shared/market-seed';

/** Curated phase one: immutable versions ship in Git; publishing has no route. */
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    const path = new URL(request.url).pathname;
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

function reply(request: Request, body: string, cache: string, hash?: string) {
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
