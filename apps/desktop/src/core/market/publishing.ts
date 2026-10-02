import { createHash, randomUUID } from 'node:crypto';
import { Store } from '../storage/database';
import { canonicalMarketContent, validateMarketSubmission } from '../../shared/market-publishing';
import {
  PublishingAction, PublishingContext, PublishingJournal, PublishingOutcome,
  type PublishingRelay, type PublishingResult, type PublishingOperation,
  type PublishingOperationView, type PublishingOwnView, type PublishingPreview,
} from '../../shared/market-desktop';
import { projectPublishingSource } from './projection';

type Preview = PublishingPreview & { fingerprint: string; accountKey: string | null; generation: number; targetFingerprint: string; expiresAt: number; suggestion?: Extract<PublishingAction, { action: 'preview' }>['suggestion'] };
export type PublishingRuntime = { request: (request: PublishingRelay) => Promise<unknown>; now?: () => number };
const STALE_PREVIEW = 'Nội dung, tài khoản hoặc mục xuất bản đã thay đổi. Xem trước lại trước khi gửi.';

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalMarketContent(value)).digest('hex');
}

function operationView(operation: PublishingOperation): PublishingOperationView {
  const { accountKey: _accountKey, key: _key, requestText: _requestText, digest: _digest, ...view } = operation;
  return view;
}

export class MarketPublishing {
  private previews = new Map<string, Preview>();
  private sending = new Map<string, Promise<PublishingOperationView>>();
  private now: () => number;

  constructor(private store: Store, private runtime: PublishingRuntime) {
    this.now = runtime.now ?? Date.now;
  }

  async execute(raw: unknown): Promise<PublishingResult> {
    const action = PublishingAction.parse(raw);
    if (action.action === 'preview') return this.preview(action);
    if (action.action === 'listOwn') return { kind: 'own', view: await this.listOwn() };
    if (action.action === 'submit') return { kind: 'operation', operation: await this.submit(action.previewId) };
    if (action.action === 'retry') return { kind: 'operation', operation: await this.retry(action.operationId) };
    if (action.action === 'inspect') {
      const context = await this.context();
      const operation = this.journal().find(item => item.id === action.operationId && item.accountKey === context.accountKey);
      if (!operation?.requestText) throw new Error('Không có nội dung đã lưu cho lần gửi này.');
      return { kind: 'saved', operation: operationView(operation), requestText: operation.requestText };
    }
    return { kind: 'operation', operation: await this.unpublish(action.listingId, action.confirmation) };
  }

  private journal(): PublishingOperation[] {
    return PublishingJournal.parse(this.store.setting('marketPublishingOperations', []));
  }

  private context(): Promise<PublishingContext> {
    return this.runtime.request({ action: 'context' }).then(value => PublishingContext.parse(value));
  }

  private targetFingerprint(context: PublishingContext, target: string | null): string {
    if (target === null) return digest({ allowance: context.summaries?.allowance ?? null });
    const listing = context.summaries?.listings.find(item => item.listingId === target);
    if (!listing) throw new Error(STALE_PREVIEW);
    return digest(listing);
  }

  private async preview(action: Extract<PublishingAction, { action: 'preview' }>): Promise<PublishingResult> {
    const projected = projectPublishingSource(this.store, action.source, action.suggestion);
    const authored = { ...action.metadata, tags: [...new Set(action.metadata.tags)].sort(), kind: action.source.kind, template: projected.template };
    const checked = await validateMarketSubmission(canonicalMarketContent(authored));
    if (!checked.ok) return { kind: 'blocked', diagnostics: checked.diagnostics };
    // Secrets/content are checked before requesting any account authority.
    const context = await this.context();
    if (action.target !== null && context.summaries?.listings.find(item => item.listingId === action.target)?.kind !== action.source.kind) throw new Error(STALE_PREVIEW);
    const preview: Preview = {
      previewId: randomUUID(), requestText: canonicalMarketContent(checked.submission), digest: checked.reviewDigest,
      source: action.source, target: action.target, capability: { status: context.status },
      fingerprint: projected.fingerprint, accountKey: context.accountKey, generation: context.generation,
      targetFingerprint: this.targetFingerprint(context, action.target), expiresAt: this.now() + 10 * 60_000,
      ...(action.suggestion ? { suggestion: action.suggestion } : {}),
    };
    for (const [previewId, saved] of this.previews) {
      if (saved.expiresAt <= this.now()) this.previews.delete(previewId);
    }
    if (this.previews.size >= 10) this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(preview.previewId, preview);
    const { fingerprint: _fingerprint, accountKey: _accountKey, generation: _generation, targetFingerprint: _targetFingerprint, expiresAt: _expiresAt, suggestion: _suggestion, ...view } = preview;
    return { kind: 'preview', preview: view };
  }

  private saveOperation(operation: PublishingOperation): void {
    const journal = this.journal();
    // Bound outstanding immutable requests; settled records contain no authored bytes.
    const unresolved = journal.filter(item => item.requestText !== undefined);
    if (unresolved.length >= 10) throw new Error('Kiểm tra hoặc thử lại các lần gửi chưa rõ kết quả trước khi gửi thêm.');
    this.store.setSetting('marketPublishingOperations', [...journal.filter(item => item.requestText !== undefined).slice(-10), ...journal.filter(item => item.requestText === undefined).slice(-9), operation]);
  }

  private async submit(previewId: string): Promise<PublishingOperationView> {
    const preview = this.previews.get(previewId);
    if (!preview || preview.expiresAt <= this.now()) throw new Error(STALE_PREVIEW);
    const context = await this.context();
    if (context.status !== 'available' || !context.accountKey) throw new Error('Marketplace chưa sẵn sàng cho tài khoản này.');
    const operation: PublishingOperation = {
      id: randomUUID(), accountKey: context.accountKey, operation: preview.target === null ? 'create' : 'version',
      name: JSON.parse(preview.requestText).name,
      target: preview.target, key: randomUUID(), requestText: preview.requestText, digest: preview.digest, state: 'notSent',
    };
    this.store.transaction(() => {
      if (this.previews.get(previewId) !== preview || preview.expiresAt <= this.now() || preview.accountKey !== context.accountKey || preview.generation !== context.generation ||
        preview.targetFingerprint !== this.targetFingerprint(context, preview.target) ||
        projectPublishingSource(this.store, preview.source, preview.suggestion).fingerprint !== preview.fingerprint) throw new Error(STALE_PREVIEW);
      this.saveOperation(operation);
      this.previews.delete(previewId);
    });
    return this.send(operation, context);
  }

  private async retry(operationId: string): Promise<PublishingOperationView> {
    const operation = this.journal().find(item => item.id === operationId);
    if (!operation?.requestText || (operation.state !== 'unknown' && operation.state !== 'notSent')) throw new Error('Lần gửi này không thể thử lại.');
    const context = await this.context();
    if (context.accountKey !== operation.accountKey) throw new Error('Đăng nhập lại đúng tài khoản đã gửi mục này.');
    if (context.status !== 'available') throw new Error('Marketplace chưa sẵn sàng cho tài khoản này.');
    return this.send(operation, context);
  }

  private async unpublish(listingId: string, confirmation: string): Promise<PublishingOperationView> {
    const context = await this.context();
    if (context.status !== 'available') throw new Error('Marketplace chưa sẵn sàng cho tài khoản này.');
    if (!context.accountKey || confirmation !== digest({ context: [context.accountKey, context.generation], listing: this.targetFingerprint(context, listingId) })) throw new Error(STALE_PREVIEW);
    const operation: PublishingOperation = {
      id: randomUUID(), accountKey: context.accountKey, operation: 'unpublish', target: listingId,
      name: context.summaries!.listings.find(listing => listing.listingId === listingId)!.latest.listing.name,
      key: randomUUID(), requestText: '{}', digest: digest({ operation: 'unpublish', listingId }), state: 'notSent',
    };
    this.store.transaction(() => this.saveOperation(operation));
    return this.send(operation, context);
  }

  private send(operation: PublishingOperation, context: PublishingContext): Promise<PublishingOperationView> {
    const existing = this.sending.get(operation.id);
    if (existing) return existing;
    const sending = this.sendOnce(operation, context).finally(() => this.sending.delete(operation.id));
    this.sending.set(operation.id, sending);
    return sending;
  }

  private async sendOnce(operation: PublishingOperation, context: PublishingContext): Promise<PublishingOperationView> {
    // Record unknown before crossing the transport boundary; a process crash must not paint an attempted send as safe.
    this.update({ ...operation, state: 'unknown' });
    let outcome: ReturnType<typeof PublishingOutcome.parse>;
    try {
      outcome = PublishingOutcome.parse(await this.runtime.request({ action: 'send', accountKey: operation.accountKey, generation: context.generation, operation: operation.operation, target: operation.target, key: operation.key, requestText: operation.requestText! }));
    } catch {
      outcome = { state: 'unknown' };
    }
    if (outcome.state === 'accepted' && (outcome.receipt.operation !== operation.operation ||
      (operation.target !== null && outcome.receipt.listingId !== operation.target))) outcome = { state: 'unknown' };
    const retryCode = operation.state === 'unknown' && 'code' in outcome ? outcome.code : undefined;
    // A failed retry does not establish that the earlier attempt never committed.
    if (operation.state === 'unknown' && outcome.state !== 'accepted') outcome = { state: 'unknown' };
    const next: PublishingOperation = outcome.state === 'accepted'
      ? { ...operation, state: outcome.receipt.operation === 'unpublish' ? 'unpublished' : 'acceptedPending', receipt: outcome.receipt }
      : { ...operation, state: outcome.state, ...('code' in outcome ? { code: outcome.code } : retryCode ? { code: retryCode } : {}) };
    if (outcome.state === 'accepted' || outcome.state === 'rejected') delete next.requestText;
    this.update(next);
    return operationView(next);
  }

  private update(operation: PublishingOperation): void {
    this.store.setSetting('marketPublishingOperations', this.journal().map(item => item.id === operation.id ? operation : item));
  }

  private async listOwn(): Promise<PublishingOwnView> {
    const context = await this.context();
    const confirmations: Record<string, string> = {};
    for (const listing of context.summaries?.listings ?? []) {
      confirmations[listing.listingId] = digest({ context: [context.accountKey, context.generation], listing: this.targetFingerprint(context, listing.listingId) });
    }
    return {
      capability: { status: context.status }, ...(context.summaries ? { summaries: context.summaries } : {}),
      operations: this.journal().filter(item => item.accountKey === context.accountKey).map(operationView), confirmations,
    };
  }
}
