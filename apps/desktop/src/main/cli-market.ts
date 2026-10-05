import type { Workspace } from '../shared/contracts';
import type { MarketAdded, MarketCatalogView, MarketDisplayListing, MarketInstallation } from '../shared/market';
import type { CliRequest, MarketAddValue, MarketInstalledValue, MarketListValue } from '../cli/protocol';
import { CliFailure } from './cli-chats';
import type { CliDependencies } from './cli-turns';

/**
 * The marketplace from the terminal (docs/marketplace-design.md): the catalog, what was added from it, and adding a
 * listing. Each step is the core command the Marketplace page uses, with its checks of the listing's bytes. Publishing,
 * reviewing and applying an update stay in the app, where the person sees the content first.
 */

type Request = Extract<CliRequest, { op: 'market' }>;

/** How many catalog pages one command reads, so that a long catalog cannot hold the terminal. */
const MAX_CATALOG_PAGES = 5;

function authorName(listing: MarketDisplayListing): string {
  return typeof listing.author === 'string' ? listing.author : listing.author.displayName;
}

export class CliMarket {
  constructor(private readonly dependencies: CliDependencies) {}

  async run(request: Request): Promise<MarketListValue | MarketInstalledValue | MarketAddValue> {
    if (request.verb === 'installed') return this.installed();
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
