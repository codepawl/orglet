import { z } from 'zod';
import { ACCOUNT_MARKET_RESOURCE } from '../shared/account';
import { MARKET_URL, MARKET_BODY_LIMIT, MarketListingV2 } from '../shared/market';
import {
  MarketModerationAction, MarketModerationResult, MarketModerationCapability, MarketQueuePage, MarketReportsPage,
  MarketReviewDetail, MarketModerationReceipt, MarketAuditPage, MARKET_MODERATION_REQUEST_LIMIT,
  MarketModerationPending, MarketModerationJournalBegin, type MarketModerationJournalRequest,
  MarketModerationCode,
} from '../shared/market-moderation';
import { validateMarketSubmission } from '../shared/market-publishing';
import type { AccountService } from './account';
import { readBounded } from './market-publishing';

type Action = MarketModerationAction;
type Write = Extract<Action, { action: 'report' | 'decision' | 'resolve' }>;
const ErrorReply = z.object({ code: MarketModerationCode }).strict();

/** Dedicated human IPC transport; tokens, account binding and route selection remain in main. */
export class MarketModerationTransport {
  private active = new Set<string>();
  constructor(private account: Pick<AccountService, 'publishingContext' | 'getAccessToken' | 'refreshProfile'>, private fetcher: typeof fetch = fetch,
    private journal?: { request: (request: MarketModerationJournalRequest) => Promise<unknown> }) {}

  async perform(raw: unknown, callerCurrent: () => boolean): Promise<MarketModerationResult> {
    let action = MarketModerationAction.parse(raw);
    if (action.action === 'capability') await this.account.refreshProfile().catch(() => undefined);
    const context = this.account.publishingContext();
    const matches = () => {
      const current = this.account.publishingContext();
      return callerCurrent() && current.status === 'available' && current.accountKey === context.accountKey && current.generation === context.generation;
    };
    let previousUnknown = false;
    const unavailable = (): MarketModerationResult => {
      if (action.action === 'capability') return { kind: 'capability', capability: { canReview: false, canReport: false, canWrite: false }, status: 'accountRequired' };
      return previousUnknown ? { kind: 'unknown' } : { kind: 'error', code: 'account_unavailable' };
    };
    if (context.status !== 'available' || !context.accountKey || !matches()) return unavailable();
    if (action.action === 'journal' || action.action === 'retry' || 'key' in action) {
      if (!this.journal) return { kind: 'error', code: 'moderation_unavailable' };
      try {
        const saved = MarketModerationPending.parse(await this.journal.request({ action: 'read', accountKey: context.accountKey }));
        if (!matches()) return unavailable();
        if (action.action === 'journal') return { kind: 'journal', operations: saved };
        if (action.action === 'retry') {
          const id = action.operationId;
          const original = saved.find(item => item.key === id);
          if (!original) return { kind: 'error', code: 'not_found' };
          action = original;
        }
        const key = 'key' in action ? action.key : undefined;
        previousUnknown = key !== undefined && saved.some(item => item.key === key);
      } catch { return { kind: 'error', code: 'moderation_unavailable' }; }
    }
    let token: string;
    try { token = await this.account.getAccessToken(ACCOUNT_MARKET_RESOURCE); } catch { return unavailable(); }
    if (!matches()) return unavailable();
    const get = async (path: string, limit: number) => {
      if (!matches()) throw new Error('account_changed');
      const response = await this.fetcher(`${MARKET_URL}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
      const body = await readBounded(response, limit);
      if (!matches()) throw new Error('account_changed');
      if (!response.ok) return { ok: false as const, code: ErrorReply.parse(body).code };
      return { ok: true as const, body };
    };
    try {
      if (action.action === 'report' || action.action === 'decision' || action.action === 'resolve') {
        return await this.write(action, context.accountKey, matches, token);
      }
      if (action.action === 'capability') {
        const result = await get('/v2/me/moderation', 4096);
        if (!result.ok) return { kind: 'error', code: result.code };
        const capability = MarketModerationCapability.parse(result.body);
        return { kind: 'capability', capability, status: capability.canReport ? 'available' : 'unavailable' };
      }
      const cursor = 'cursor' in action && action.cursor ? `?cursor=${encodeURIComponent(action.cursor)}` : '';
      if (action.action === 'queue') {
        const result = await get(`/v2/review/queue${cursor}`, 512 * 1024);
        return result.ok ? { kind: 'queue', page: MarketQueuePage.parse(result.body) } : { kind: 'error', code: result.code };
      }
      const path = `/v2/review/listings/${action.listingId}/versions/${action.version}`;
      if (action.action === 'audit') {
        const result = await get(`${path}/audit${cursor}`, 256 * 1024);
        return result.ok ? { kind: 'audit', page: MarketAuditPage.parse(result.body) } : { kind: 'error', code: result.code };
      }
      if (action.action === 'reports') {
        const result = await get(`${path}/reports${cursor}`, 256 * 1024);
        return result.ok ? { kind: 'reports', page: MarketReportsPage.parse(result.body) } : { kind: 'error', code: result.code };
      }
      const result = await get(path, 32 * 1024);
      if (!result.ok) return { kind: 'error', code: result.code };
      const detail = MarketReviewDetail.parse(result.body);
      if (detail.listing.listingId !== action.listingId || detail.listing.version !== action.version) throw new Error('Invalid response');
      const content = async (listing: z.infer<typeof MarketListingV2>) => {
        const body = await get(`/v2/review/listings/${listing.listingId}/versions/${listing.version}/body`, MARKET_BODY_LIMIT);
        if (!body.ok) throw new Error('Invalid response');
        const { listingId: _id, version: _version, author: _author, sha256: _sha, reviewDigest: _digest, ...metadata } = listing;
        const requestText = JSON.stringify({ ...metadata, template: body.body });
        const validated = await validateMarketSubmission(requestText);
        if (!validated.ok || validated.sha256 !== listing.sha256 || validated.reviewDigest !== listing.reviewDigest || !matches()) throw new Error('Invalid response');
        return requestText;
      };
      const requestText = await content(detail.listing);
      let previousText: string | undefined;
      if (detail.expected.publishedVersion !== null && detail.expected.publishedVersion !== action.version) {
        const previous = await get(`/v2/review/listings/${action.listingId}/versions/${detail.expected.publishedVersion}`, 32 * 1024);
        if (!previous.ok) throw new Error('Invalid response');
        const previousDetail = MarketReviewDetail.parse(previous.body);
        if (previousDetail.listing.listingId !== action.listingId || previousDetail.listing.version !== detail.expected.publishedVersion || previousDetail.state !== 'approved') throw new Error('Invalid response');
        previousText = await content(previousDetail.listing);
      }
      return MarketModerationResult.parse({ kind: 'detail', detail, requestText, ...(previousText !== undefined ? { previousText } : {}) });
    } catch { return { kind: 'error', code: matches() ? 'moderation_unavailable' : 'account_changed' }; }
  }

  private async write(action: Write, accountKey: string, matches: () => boolean, token: string): Promise<MarketModerationResult> {
    const text = JSON.stringify(action.input);
    if (Buffer.byteLength(text) > MARKET_MODERATION_REQUEST_LIMIT) return { kind: 'error', code: 'request_size' };
    if (!this.journal) return { kind: 'error', code: 'moderation_unavailable' };
    if (this.active.has(action.key)) return { kind: 'unknown' };
    if (!matches()) return { kind: 'error', code: 'account_changed' };
    this.active.add(action.key);
    const path = action.action === 'report' ? `/v2/listings/${action.input.listingId}/versions/${action.input.version}/report` :
      action.action === 'decision' ? `/v2/review/listings/${action.input.expected.listingId}/versions/${action.input.expected.version}/decision` : `/v2/review/reports/${action.input.reportId}/resolve`;
    try {
      const begin = MarketModerationJournalBegin.parse(await this.journal.request({ action: 'begin', accountKey, request: action }));
      if (!begin.ok) return { kind: 'error', code: begin.code };
      if (!matches()) return { kind: 'unknown' };
      const response = await this.fetcher(`${MARKET_URL}${path}`, { method: 'POST', headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8', 'Idempotency-Key': action.key, Accept: 'application/json',
      }, body: text, redirect: 'error', signal: AbortSignal.timeout(15_000) });
      const body = await readBounded(response, 8192);
      if (!matches()) return { kind: 'unknown' };
      if (response.ok) {
        const receipt = MarketModerationReceipt.parse(body);
        const operation = action.action === 'decision' ? action.input.decision : action.action;
        const exact = action.action === 'decision' ? action.input.expected : action.action === 'report' ? action.input : undefined;
        if (receipt.operation !== operation || (exact && (receipt.listingId !== exact.listingId || receipt.version !== exact.version)) ||
          (action.action === 'resolve' && (receipt.reportId !== action.input.reportId || receipt.state !== action.input.resolution))) return { kind: 'unknown' };
        await this.journal.request({ action: 'finish', accountKey, key: action.key, result: 'receipt' }).catch(() => undefined);
        return { kind: 'receipt', receipt };
      }
      const refusal = ErrorReply.safeParse(body);
      if (!begin.wasUnknown && response.status >= 400 && response.status < 500 && refusal.success) {
        await this.journal.request({ action: 'finish', accountKey, key: action.key, result: 'error' }).catch(() => undefined);
        return { kind: 'error', code: refusal.data.code };
      }
      return { kind: 'unknown' };
    } catch { return { kind: 'unknown' }; }
    finally { this.active.delete(action.key); }
  }
}
