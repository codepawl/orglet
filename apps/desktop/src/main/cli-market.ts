import type { Workspace } from '../shared/contracts';
import type { MarketAdded, MarketCatalogView, MarketDisplayListing, MarketInstallation, MarketUpdate } from '../shared/market';
import type { CliRequest, MarketAddValue, MarketInstalledValue, MarketListValue, MarketUpdateValue } from '../cli/protocol';
import { CliFailure } from './cli-chats';
import type { CliDependencies } from './cli-turns';

/**
 * The marketplace from the terminal (docs/marketplace-design.md): the catalog, what was added from it, and adding a
 * listing, and the update of one that was added. Each step is the core command the Marketplace page uses, with its checks
 * of the listing's bytes. An update is applied only with the code that its preview printed. Publishing and moderation
 * stay in the app.
 */

type Request = Extract<CliRequest, { op: 'market' }>;

/** How many catalog pages one command reads, so that a long catalog cannot hold the terminal. */
const MAX_CATALOG_PAGES = 5;
/** The characters of an update's token that `market update` prints and `--confirm` takes back. */
const UPDATE_CODE_LENGTH = 8;

function authorName(listing: MarketDisplayListing): string {
  return typeof listing.author === 'string' ? listing.author : listing.author.displayName;
}

export class CliMarket {
  constructor(private readonly dependencies: CliDependencies) {}

  async run(request: Request): Promise<MarketListValue | MarketInstalledValue | MarketAddValue | MarketUpdateValue> {
    if (request.verb === 'installed') return this.installed();
    if (request.verb === 'update') return this.update(request.installed!, request.confirmCode);
    if (request.verb === 'add') return this.add(request.listingId!);
    return this.list(request.refresh);
  }

  /** The catalog's pages, up to the limit, and whether more are left. */
  private async catalog(refresh: boolean): Promise<{ listings: MarketDisplayListing[]; view: MarketCatalogView; more: boolean }> {
    const listings: MarketDisplayListing[] = [];
    let view = await this.dependencies.request('marketCatalog', { refresh }) as MarketCatalogView;
    listings.push(...view.listings);
    for (let page = 1; page < MAX_CATALOG_PAGES && view.nextCursor; page += 1) {
      view = await this.dependencies.request('marketCatalog', { cursor: view.nextCursor }) as MarketCatalogView;
      listings.push(...view.listings);
    }
    return { listings, view, more: Boolean(view.nextCursor) };
  }

  private async list(refresh: boolean): Promise<MarketListValue> {
    const { listings, view, more } = await this.catalog(refresh);
    return {
      source: view.source,
      more,
      ...(view.error ? { error: view.error } : {}),
      listings: listings.map(listing => ({
        id: listing.listingId, version: listing.version, kind: listing.kind, name: listing.name, summary: listing.summary, author: authorName(listing), language: listing.language,
      })),
    };
  }

  private async installed(): Promise<MarketInstalledValue> {
    const installations = await this.dependencies.request('marketInstallations', {}) as MarketInstallation[];
    return { installed: installations.map(item => ({ id: item.listingId, version: item.version, kind: item.kind, name: item.name, updateAvailable: item.updateAvailable })) };
  }

  /**
   * What an update of an installed listing changes, with a code for exactly that update. With the code in `confirmCode`
   * the update is applied, but only when it is still the one the code names: the app compares it with a fresh preview.
   */
  private async update(name: string, confirmCode: string | undefined): Promise<MarketUpdateValue> {
    const installations = await this.dependencies.request('marketInstallations', {}) as MarketInstallation[];
    const wanted = name.trim().toLocaleLowerCase();
    const matches = installations.filter(item => item.name.toLocaleLowerCase() === wanted);
    if (matches.length > 1) throw new CliFailure('ambiguous', `"${name}" là tên của nhiều mục đã thêm. Đổi tên một mục trong app để phân biệt.`);
    if (matches.length === 0) throw new CliFailure('not_found', `Không có mục nào đã thêm tên "${name}". Lệnh orglet market installed liệt kê chúng.`);
    const installation = matches[0];
    if (!installation.updateAvailable) throw new CliFailure('failed', `"${installation.name}" đã là bản mới nhất.`);
    const preview = await this.dependencies.request('marketPreviewUpdate', { entityId: installation.entityId }) as MarketUpdate;
    const code = preview.token.slice(0, UPDATE_CODE_LENGTH);
    const value = { name: installation.name, installedVersion: preview.installedVersion, version: preview.listing.version, changes: preview.changes, code };
    if (confirmCode === undefined) return { ...value, applied: false };
    if (confirmCode !== code) throw new CliFailure('failed', 'Mã xác nhận không khớp bản cập nhật hiện tại. Chạy lại orglet market update để xem thay đổi mới.');
    await this.dependencies.request('marketApplyUpdate', { entityId: installation.entityId, token: preview.token });
    return { ...value, applied: true };
  }

  /** Adds the listing's current version: its orglets, and the channel or space it carries. */
  private async add(listingId: string): Promise<MarketAddValue> {
    const { listings, more } = await this.catalog(false);
    const listing = listings.find(item => item.listingId === listingId);
    if (!listing) {
      throw new CliFailure('not_found', more
        ? `Không thấy "${listingId}" trong các trang đầu của danh mục. Thêm nó trong app.`
        : `Danh mục không có mục nào mã "${listingId}". Lệnh orglet market liệt kê các mã.`);
    }
    const added = await this.dependencies.request('marketAdd', { listingId, version: listing.version }) as MarketAdded;
    const workspace = await this.dependencies.request('workspace', {}) as Workspace;
    const orglets = added.workerIds.flatMap(workerId => workspace.workers.find(worker => worker.id === workerId)?.name ?? []);
    return { id: listingId, version: listing.version, kind: added.kind, name: listing.name, orglets, withoutModel: added.fallbackNames };
  }
}
