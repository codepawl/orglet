import { z } from 'zod';
import { ACCOUNT_MARKET_RESOURCE } from '../shared/account';
import { MARKET_URL, MARKET_REQUEST_LIMIT, MarketMutationReceipt } from '../shared/market';
import { OwnerSummaries, PublishingRelay, type PublishingAction, type PublishingContext, type PublishingOutcome } from '../shared/market-desktop';
import type { AccountService } from './account';

const ErrorReply = z.object({ code: z.enum([
  'idempotency_conflict', 'listing_kind', 'listing_limit', 'not_found', 'reserved_listing', 'storage_failed',
  'submission_limit', 'content_type', 'invalid_idempotency_key', 'invalid_pagination', 'invalid_request',
  'invalid_submission', 'publishing_unavailable', 'request_size', 'invalid_token', 'email_unverified',
]), diagnostics: z.array(z.unknown()).max(100).optional() }).strict();

/** The outer, main-frame IPC action bounds what its correlated core request may do. */
export function publishingRelayAllowed(action: PublishingAction | undefined, relay: PublishingRelay): boolean {
  if (!action) return false;
  if (relay.action === 'context') return true;
  if (action.action === 'submit') return relay.operation === 'create' || relay.operation === 'version';
  if (action.action === 'retry') return true;
  return action.action === 'unpublish' && relay.operation === 'unpublish' && relay.target === action.listingId;
}

async function readBounded(response: Response, limit: number): Promise<unknown> {
  if (!response.body) throw new Error('Invalid response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > limit) throw new Error('Invalid response');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

export class MarketPublishingTransport {
  constructor(private account: Pick<AccountService, 'publishingContext' | 'getAccessToken' | 'refreshProfile'>, private fetcher: typeof fetch = fetch) {}

  async context(): Promise<PublishingContext> {
    await this.account.refreshProfile().catch(() => undefined);
    const context = this.account.publishingContext();
    if (context.status !== 'available') return context;
    try {
      const token = await this.account.getAccessToken(ACCOUNT_MARKET_RESOURCE);
      if (!this.matches(context)) return { ...this.account.publishingContext(), status: 'unavailable' };
      const response = await this.fetcher(`${MARKET_URL}/v2/me/summary`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
      // Ten identities may each include two 16-KiB metadata records, plus bounded server fields.
      const summaries = response.ok ? OwnerSummaries.parse(await readBounded(response, 512 * 1024)) : undefined;
      if (!summaries || !this.matches(context)) return { ...this.account.publishingContext(), status: 'unavailable' };
      return { ...context, status: summaries.publishingEnabled ? 'available' : 'unavailable', summaries };
    } catch {
      return { ...this.account.publishingContext(), status: 'unavailable' };
    }
  }

  async send(raw: unknown, callerCurrent: () => boolean): Promise<PublishingOutcome> {
    const request = PublishingRelay.parse(raw);
    if (request.action !== 'send') return { state: 'notSent', code: 'invalid_request' };
    if (!callerCurrent()) return { state: 'notSent', code: 'caller_expired' };
    if (Buffer.byteLength(request.requestText) > MARKET_REQUEST_LIMIT || !this.matches(request)) return { state: 'notSent', code: 'account_changed' };
    let token: string;
    try {
      token = await this.account.getAccessToken(ACCOUNT_MARKET_RESOURCE);
    } catch {
      return { state: 'notSent', code: 'account_unavailable' };
    }
    if (!this.matches(request)) return { state: 'notSent', code: 'account_changed' };
    if (!callerCurrent()) return { state: 'notSent', code: 'caller_expired' };
    if ((request.operation === 'create') !== (request.target === null)) return { state: 'notSent', code: 'invalid_request' };
    const path = request.operation === 'create' ? '/v2/listings' : `/v2/listings/${request.target}/${request.operation === 'version' ? 'versions' : 'unpublish'}`;
    try {
      const response = await this.fetcher(`${MARKET_URL}${path}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8', 'Idempotency-Key': request.key, Accept: 'application/json' },
        body: request.requestText, redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
      const body = await readBounded(response, 64 * 1024);
      if (!this.matches(request) || !callerCurrent()) return { state: 'unknown' };
      if (response.ok) {
        const receipt = MarketMutationReceipt.parse(body);
        if (receipt.operation !== request.operation || (request.target !== null && receipt.listingId !== request.target)) return { state: 'unknown' };
        return { state: 'accepted', receipt };
      }
      const refusal = ErrorReply.safeParse(body);
      if (response.status >= 400 && response.status < 500 && refusal.success) return { state: 'rejected', code: refusal.data.code };
      return { state: 'unknown' };
    } catch {
      return { state: 'unknown' };
    }
  }

  private matches(context: { accountKey: string | null; generation: number }): boolean {
    const current = this.account.publishingContext();
    return current.accountKey === context.accountKey && current.generation === context.generation && current.status === 'available';
  }
}
