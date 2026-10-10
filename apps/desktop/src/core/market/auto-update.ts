import { automaticUpdateBlock, MARKET_UPDATE_RECORD_LIMIT, MarketUpdateRecords, type MarketInstallation, type MarketUpdate, type MarketUpdateRecord } from '../../shared/market';
import type { Store } from '../storage/database';
import type { Marketplace } from './service';

/** How often the core looks at the catalog by itself, when the person turned automatic marketplace updates on. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** How long "Updated to v3" stays in the update place. */
const APPLIED_VISIBLE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_CHANGED_NAMES = 20;

/**
 * Marketplace updates the app applies by itself (docs/marketplace-design.md, "Updates beside the app's own"). It is off
 * unless the person turned it on, because an update changes what an orglet is told to do. Each update goes through the
 * same preview and the same token and byte checks as a click, and one that would replace the person's edits or widen
 * what the copy may do is left for them. A failure is recorded once and not tried again until a newer version appears.
 */
export class MarketAutoUpdates {
  private checkedAt = 0;
  private running: Promise<void> | undefined;

  constructor(private readonly store: Store, private readonly market: Marketplace, private readonly notify: () => void, private readonly clock: () => Date) {}

  enabled(): boolean {
    return this.store.setting<boolean>('marketAutoUpdate', false) === true;
  }

  /** The newest record of each installed item that is still worth showing, newest first. */
  records(): MarketUpdateRecord[] {
    const installed = new Set(this.market.installations().map(installation => installation.entityId));
    const now = this.clock().getTime();
    return this.stored().filter(record => installed.has(record.entityId) && (record.status !== 'applied' || now - new Date(record.at).getTime() < APPLIED_VISIBLE_MS));
  }

  /** A click on Update replaced whatever the automatic path last said about this item. */
  forget(entityId: string): void {
    const kept = this.stored().filter(record => record.entityId !== entityId);
    if (kept.length !== this.stored().length) this.store.setSetting('marketUpdateRecords', kept);
  }

  /**
   * Called on every core tick: looks at the catalog when the last look is old, and only while automatic updates are on.
   * Turning the preference on looks at once (`force`), so what is already waiting does not wait for the next few hours.
   */
  async checkWhenDue(force = false): Promise<void> {
    if (!this.enabled()) return;
    if (!force && this.clock().getTime() - this.checkedAt < CHECK_INTERVAL_MS) return;
    if (this.market.installations().length === 0) return;
    this.checkedAt = this.clock().getTime();
    const catalog = await this.market.catalog(true);
    if (catalog.source === 'online') await this.run();
  }

  /** Applies what the catalog says is newer. Call it only after a catalog fetch that reached the service. */
  run(): Promise<void> {
    if (!this.enabled()) return Promise.resolve();
    this.running ??= this.applyAvailable().finally(() => { this.running = undefined; });
    return this.running;
  }

  private async applyAvailable(): Promise<void> {
    for (const installation of this.market.installations()) {
      if (!installation.updateAvailable) continue;
      if (!this.enabled()) return;
      if (this.alreadyAnswered(installation)) continue;
      await this.updateOne(installation);
    }
  }

  /** A failure or a hold for this version, or a newer one, is not tried again by itself. */
  private alreadyAnswered(installation: MarketInstallation): boolean {
    const record = this.stored().find(item => item.entityId === installation.entityId);
    return !!record && record.status !== 'applied' && record.toVersion >= (installation.latestVersion ?? installation.version + 1);
  }

  private async updateOne(installation: MarketInstallation): Promise<void> {
    let preview: MarketUpdate;
    try {
      preview = await this.market.previewUpdate(installation.entityId);
    } catch (error) {
      this.save({ ...this.baseRecord(installation, installation.latestVersion ?? installation.version + 1), status: 'failed', reason: reasonOf(error) });
      return;
    }
    const base = this.baseRecord(installation, preview.listing.version, preview);
    const block = automaticUpdateBlock(preview);
    if (block) {
      this.save({ ...base, status: 'needs-review', block, ...(preview.widening.length ? { widening: preview.widening.slice(0, MAX_CHANGED_NAMES) } : {}) });
      return;
    }
    try {
      await this.market.applyUpdate(installation.entityId, preview.token, { automatic: true });
      this.save({ ...base, status: 'applied' });
    } catch (error) {
      this.save({ ...base, status: 'failed', reason: reasonOf(error) });
    }
  }

  private baseRecord(installation: MarketInstallation, toVersion: number, preview?: MarketUpdate) {
    const changed = (preview?.changes ?? []).filter(change => change.before !== change.after).map(change => change.name).slice(0, MAX_CHANGED_NAMES);
    const changelog = preview?.listing.changelog;
    return {
      entityId: installation.entityId,
      kind: installation.kind,
      listingId: installation.listingId,
      name: installation.name,
      fromVersion: installation.version,
      toVersion,
      at: this.clock().toISOString(),
      changed,
      ...(changelog ? { changelog } : {}),
    };
  }

  private stored(): MarketUpdateRecord[] {
    const parsed = MarketUpdateRecords.safeParse(this.store.setting<unknown>('marketUpdateRecords', []));
    return parsed.success ? parsed.data : [];
  }

  private save(record: MarketUpdateRecord): void {
    const others = this.stored().filter(item => item.entityId !== record.entityId);
    const next = [record, ...others].sort((first, second) => second.at.localeCompare(first.at)).slice(0, MARKET_UPDATE_RECORD_LIMIT);
    this.store.setSetting('marketUpdateRecords', MarketUpdateRecords.parse(next));
    this.notify();
  }
}

function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Không cập nhật được.';
  return message.slice(0, 600);
}
