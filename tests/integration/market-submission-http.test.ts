import { describe, expect, it } from 'vitest';
import { MARKET_BODY_LIMIT, MARKET_METADATA_LIMIT, MARKET_REQUEST_LIMIT, MarketOwnerPage, MarketMutationReceipt } from '../../apps/desktop/src/shared/market';
import { validateMarketSubmission } from '../../apps/desktop/src/shared/market-publishing';
import { MARKET_SEED_BODIES } from '../../apps/desktop/src/shared/market-seed';
import { readSubmissionBody } from '../../services/market/src/owner-routes';

function submission() {
  return {
    kind: 'orglet', name: 'Fixture', summary: 'Fixture description', tags: ['fixture'], language: 'en',
    license: 'CC-BY-4.0', changelog: '', template: JSON.parse(MARKET_SEED_BODIES['research-friend:1']),
  };
}

describe('submission envelope and HTTP input boundaries', () => {
  it('budgets worst-case metadata escaping separately from the normalized template body', async () => {
    const published = submission();
    published.name = '\u0000'.repeat(80);
    published.summary = '\u0000'.repeat(240);
    published.tags = Array.from({ length: 10 }, () => '\u0000'.repeat(32));
    published.changelog = '\u0000'.repeat(2000);
    const { template: _template, ...metadata } = published;
    expect(Buffer.byteLength(JSON.stringify(metadata))).toBeLessThanOrEqual(MARKET_METADATA_LIMIT);
    expect(MARKET_REQUEST_LIMIT).toBe(MARKET_BODY_LIMIT + MARKET_METADATA_LIMIT + 12);
    expect((await validateMarketSubmission(JSON.stringify(published))).ok).toBe(true);
  });

  it('preserves lower caller raw-body limits and supports an independent request limit', async () => {
    const text = JSON.stringify(submission());
    const length = Buffer.byteLength(text);
    expect((await validateMarketSubmission(text, { bodyBytes: length })).ok).toBe(true);
    expect(await validateMarketSubmission(text, { bodyBytes: length - 1 })).toMatchObject({ ok: false, diagnostics: [{ path: 'request', rule: 'body-size' }] });
    expect(await validateMarketSubmission(text, { requestBytes: length - 1 })).toMatchObject({ ok: false, diagnostics: [{ path: 'request', rule: 'body-size' }] });
    expect((await validateMarketSubmission(text, { requestBytes: length })).ok).toBe(true);
  });

  it('reads exact bounded bytes and refuses excess noncanonical whitespace without truncation', async () => {
    const text = '{}'.padEnd(MARKET_REQUEST_LIMIT, ' ');
    const request = new Request('https://fixture.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
    expect(await readSubmissionBody(request)).toBe(text);
    const excess = new Request('https://fixture.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text + ' ' });
    await expect(readSubmissionBody(excess)).rejects.toMatchObject({ status: 413, code: 'request_size' });
  });

  it('counts and cancels an oversized stream even with an understated Content-Length', async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MARKET_REQUEST_LIMIT));
        controller.enqueue(new Uint8Array([32]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request('https://fixture.test', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '1' },
      body: stream, duplex: 'half',
    } as RequestInit);
    await expect(readSubmissionBody(request)).rejects.toMatchObject({ status: 413, code: 'request_size' });
    expect(cancelled).toBe(true);
  });

  it('refuses malformed declared lengths, wrong MIME and invalid UTF-8 with fixed errors', async () => {
    for (const declared of ['-1', 'NaN', String(MARKET_REQUEST_LIMIT + 1)]) {
      const request = new Request('https://fixture.test', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': declared }, body: '{}' });
      await expect(readSubmissionBody(request)).rejects.toMatchObject({ status: 413, code: 'request_size' });
    }
    const wrongMime = new Request('https://fixture.test', { method: 'POST', body: '{}' });
    await expect(readSubmissionBody(wrongMime)).rejects.toMatchObject({ status: 415, code: 'content_type' });
    const invalidUtf8 = new Request('https://fixture.test', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: new Uint8Array([255]) });
    await expect(readSubmissionBody(invalidUtf8)).rejects.toMatchObject({ status: 400, code: 'invalid_submission' });
  });

  it('keeps server receipts pending and refuses invented owner capabilities or identity fields', () => {
    expect(MarketMutationReceipt.safeParse({ operation: 'create', listingId: 'fixture', version: 1, state: 'approved' }).success).toBe(false);
    const page = { versions: [], nextCursor: null, allowance: { listingLimit: 10, listingCount: 0, submissionsInHour: 0, submissionLimit: 5 } };
    expect(MarketOwnerPage.safeParse(page).success).toBe(true);
    expect(MarketOwnerPage.safeParse({ ...page, subject: 'private-fixture' }).success).toBe(false);
    expect(MarketOwnerPage.safeParse({ ...page, allowance: { ...page.allowance, listingLimit: 11 } }).success).toBe(false);
    expect(MarketOwnerPage.safeParse({ ...page, allowance: { ...page.allowance, canPublish: true } }).success).toBe(false);
  });
});
