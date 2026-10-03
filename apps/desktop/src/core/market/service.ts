import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ProviderId, type Worker, type Skill, type Team } from '../../shared/contracts';
import { MARKET_BODY_LIMIT, MARKET_URL, MarketCatalog, MarketCatalogPageV2, MarketListing, MarketListingV2, MarketOrigin as Origin, MarketOrigins as Origins, type MarketCatalogView, type MarketAdded, type MarketCustomization, type MarketUpdate, type MarketInstallation, type MarketDisplayListing } from '../../shared/market';
import { MARKET_SEED_BODIES, seedCatalog } from '../../shared/market-seed';
import { Store, id } from '../storage/database';
import { KnowledgeBase } from '../context/knowledge';
import { packageForImport } from '../skill-package';
import { parseMarketTemplate } from './templates';

const Model = z.object({ provider: ProviderId, modelId: z.string().max(200).optional() }).strict();
type Model = z.infer<typeof Model>;

const DisplayCatalog = z.object({ listings: z.array(z.union([MarketListingV2, MarketListing])).max(200), nextCursor: z.string().max(256).nullable().optional() }).strict();
const CachedPage = z.object({ cursor: z.string().min(1).max(256), catalog: DisplayCatalog, fetchedAt: z.iso.datetime() }).strict();
const CachedCatalog = z.object({ catalog: DisplayCatalog, fetchedAt: z.iso.datetime(), pages: z.array(CachedPage).max(9).optional() }).strict()
  .refine(cache => cache.catalog.listings.length + (cache.pages ?? []).reduce((total, page) => total + page.catalog.listings.length, 0) <= 200);
class UnsupportedMarketRoute extends Error {}

export type MarketRuntime = {
  fetch?: typeof fetch;
  connected?: (provider: Worker['provider']) => Promise<boolean>;
  defaultModel?: () => Promise<Model>;
  followCrew?: (team: Team) => void;
};

export class Marketplace {
  constructor(private store: Store, private notify: () => void, private runtime: MarketRuntime = {}) {}

  async catalog(refresh = false, cursor?: string): Promise<MarketCatalogView> {
    const saved = CachedCatalog.safeParse(this.store.setting<unknown>('marketCatalog', null));
    if (!refresh) {
      if (saved.success) {
        const cachedPages = (saved.data.pages ?? []).map(page => ({ cursor: page.cursor, name: page.catalog.listings[0]?.name ?? '' }));
        const page = cursor ? saved.data.pages?.find(page => page.cursor === cursor) : saved.data;
        if (page) return { ...page.catalog, fetchedAt: page.fetchedAt, source: 'cache', cachedPages, ...(cursor ? { pageCursor: cursor } : {}) };
        return { ...saved.data.catalog, fetchedAt: saved.data.fetchedAt, source: 'cache', cachedPages, error: 'Trang này không còn trong bản lưu. Đang hiển thị trang đầu.' };
      }
      return { ...await seedCatalog(), fetchedAt: null, source: 'bundled' };
    }
    try {
      let catalog: z.infer<typeof DisplayCatalog>;
      try {
        // Twenty complete 16-KiB metadata records plus server fields fit the bounded 512-KiB page envelope.
        const query = cursor ? `?limit=20&cursor=${encodeURIComponent(cursor)}` : '?limit=20';
        catalog = MarketCatalogPageV2.parse(JSON.parse(await this.read(`/v2/catalog${query}`, 512 * 1024)));
      } catch (reason) {
        if (cursor || !(reason instanceof UnsupportedMarketRoute)) throw new Error('Không tải được trang danh mục.');
        catalog = MarketCatalog.parse(JSON.parse(await this.read('/v1/catalog', 512 * 1024)));
      }
      const current = CachedCatalog.safeParse(this.store.setting<unknown>('marketCatalog', null));
      if (current.success) {
        for (const listing of catalog.listings) {
          const previous = [current.data.catalog, ...(current.data.pages ?? []).map(page => page.catalog)].flatMap(page => page.listings).find(item => item.listingId === listing.listingId);
          if (previous && (listing.version < previous.version || (listing.version === previous.version && listing.sha256 !== previous.sha256))) throw new Error('Phiên bản danh mục không hợp lệ.');
        }
      }
      const fetchedAt = new Date().toISOString();
      if (cursor && current.success) {
        const pages = [...(current.data.pages ?? []).filter(page => page.cursor !== cursor), { cursor, catalog, fetchedAt }];
        while (pages.length > 9 || current.data.catalog.listings.length + pages.reduce((total, page) => total + page.catalog.listings.length, 0) > 200) pages.shift();
        this.store.setSetting('marketCatalog', { ...current.data, pages });
      } else this.store.setSetting('marketCatalog', { catalog, fetchedAt });
      return { ...catalog, fetchedAt, source: 'online', ...(cursor ? { pageCursor: cursor } : {}) };
    } catch {
      const cached = await this.catalog(false, cursor);
      return { ...cached, error: cached.error ?? 'Không tải được danh mục. Đang dùng bản lưu trên máy.' };
    }
  }

  installations(): MarketInstallation[] {
    const saved = CachedCatalog.safeParse(this.store.setting<unknown>('marketCatalog', null));
    const state = this.store.entityState();
    return this.origins().filter(origin => {
      const table = origin.kind === 'orglet' ? 'workers' : 'teams';
      return !state[table][origin.entityId]?.deletedAt && !state[table][origin.entityId]?.archivedAt;
    }).map(origin => {
      const entity = this.store.get<Worker | Team>(origin.kind === 'orglet' ? 'workers' : 'teams', origin.entityId);
      const latest = saved.success ? [saved.data.catalog, ...(saved.data.pages ?? []).map(page => page.catalog)].flatMap(page => page.listings).find(item => item.listingId === origin.listingId) : undefined;
      return { entityId: entity.id, kind: origin.kind, listingId: origin.listingId, version: origin.version, name: entity.name, updateAvailable: !!latest && latest.version > origin.version };
    });
  }

  async add(listingId: string, version: number): Promise<MarketAdded> {
    const listing = await this.listing(listingId, version);
    const template = parseMarketTemplate(await this.body(listing), listing.kind);
    const prepared = await this.prepare(template);
    const entityId = prepared.team?.id ?? prepared.workers[0].id;
    const origin: Origin = { entityId, listingId, version, kind: listing.kind, workerIds: prepared.workerIds, skillIds: prepared.skillIds, baseline: '', baselineKind: 'authoring-v1' };
    this.store.transaction(() => {
      this.store.versionRows(prepared.rows);
      if (prepared.team) new KnowledgeBase(this.store).importProposed(entityId, template.knowledge ?? []);
      origin.baseline = this.authoring(origin);
      this.store.setSetting('marketOrigins', [...this.origins(), Origin.parse(origin)]);
    });
    this.notify();
    return { entityId, kind: listing.kind, workerIds: prepared.workers.map(worker => worker.id), fallbackNames: prepared.fallbackNames };
  }

  async previewUpdate(entityId: string): Promise<MarketUpdate> {
    const origin = this.origin(entityId);
    this.assertUpdateable(origin);
    const catalog = await this.catalog(false);
    let listing = catalog.listings.find(item => item.listingId === origin.listingId && item.version > origin.version);
    const curated = origin.listingId === 'research-friend' || origin.listingId === 'research-review';
    if (!curated) {
      try {
        const current = MarketListingV2.parse(JSON.parse(await this.read(`/v2/listings/${origin.listingId}`, 32 * 1024)));
        listing = current.version > origin.version ? current : undefined;
      } catch {
        throw new Error('Không kiểm tra được bản cập nhật hiện tại. Bản trên máy vẫn giữ nguyên.');
      }
    }
    if (!listing) throw new Error('Chưa có bản cập nhật cho bạn này.');
    const template = parseMarketTemplate(await this.body(listing), listing.kind);
    if (listing.kind !== origin.kind) throw new Error('Loại mẫu đã thay đổi. Thêm mẫu mới để giữ bản hiện tại.');
    const fingerprint = this.fingerprint(origin);
    const changes = template.workers.map(worker => {
      const previousId = origin.workerIds[worker.key];
      const previous = previousId ? this.store.get<Worker>('workers', previousId) : undefined;
      return { name: worker.name, before: previous ? workerContent(previous) : '', after: workerContent(worker) };
    });
    for (const skill of template.skills) {
      const previousWorkerKey = template.workers.find(worker => worker.skillKey === skill.key)?.key;
      const previousWorkerId = previousWorkerKey ? origin.workerIds[previousWorkerKey] : undefined;
      const previousId = previousWorkerId ? this.store.get<Worker>('workers', previousWorkerId).skillId : origin.skillIds[skill.key];
      const previous = previousId ? this.store.get<Skill>('skills', previousId) : undefined;
      changes.push({ name: skill.name, before: previous ? skillContent(previous) : '', after: skillContent(skill) });
    }
    if (template.team) {
      const previous = this.store.get<Team>('teams', entityId);
      const { id: _entityId, revision: _revision, memberIds, synthesizerId, ...previousSettings } = previous;
      const { memberKeys, synthesizerKey, ...nextSettings } = template.team;
      changes.unshift({ name: template.team.name, before: JSON.stringify({ ...previousSettings, members: memberIds.map(workerId => this.store.get<Worker>('workers', workerId).name), lead: this.store.get<Worker>('workers', synthesizerId).name }, null, 2), after: JSON.stringify({ ...nextSettings, members: memberKeys.map(key => template.workers.find(worker => worker.key === key)!.name), lead: template.workers.find(worker => worker.key === synthesizerKey)!.name }, null, 2) });
    }
    return { entityId, listing, installedVersion: origin.version, customization: this.customization(origin, fingerprint), token: hash(`${fingerprint}:${listing.sha256}:${origin.version}`), changes };
  }

  async applyUpdate(entityId: string, token: string): Promise<MarketAdded> {
    const preview = await this.previewUpdate(entityId);
    if (token !== preview.token) throw new Error('Bạn đã thay đổi sau khi mở thẻ cập nhật. Xem lại bản so sánh.');
    const origin = this.origin(entityId);
    const template = parseMarketTemplate(await this.body(preview.listing), origin.kind);
    const prepared = await this.prepare(template, origin);
    // No await inside the transaction: concurrent edits invalidate the reviewed card before any row changes.
    this.store.transaction(() => {
      this.assertUpdateable(origin);
      if (hash(`${this.fingerprint(origin)}:${preview.listing.sha256}:${origin.version}`) !== token) throw new Error('Bạn đã thay đổi sau khi mở thẻ cập nhật. Xem lại bản so sánh.');
      this.store.versionRows(prepared.rows);
      if (prepared.team) this.runtime.followCrew?.(prepared.team);
      if (prepared.team) new KnowledgeBase(this.store).importProposed(entityId, template.knowledge ?? []);
      const next: Origin = { ...origin, version: preview.listing.version, workerIds: prepared.workerIds, skillIds: prepared.skillIds, baselineKind: 'authoring-v1' };
      next.baseline = this.authoring(next);
      this.store.setSetting('marketOrigins', this.origins().map(item => item.entityId === entityId ? next : item));
    });
    this.notify();
    return { entityId, kind: origin.kind, workerIds: prepared.workers.map(worker => worker.id), fallbackNames: prepared.fallbackNames };
  }

  private async prepare(template: ReturnType<typeof parseMarketTemplate>, origin?: Origin) {
    const fallback = Model.parse(await this.runtime.defaultModel?.() ?? { provider: 'demo' });
    const skillIds: Record<string, string> = {};
    const skills: Skill[] = [];
    for (const { key, ...fields } of template.skills) {
      const previous = origin?.skillIds[key] ? this.store.get<Skill>('skills', origin.skillIds[key]) : undefined;
      if (previous && previous.name === fields.name && previous.content === fields.content && previous.package?.hash === fields.package?.hash) {
        skillIds[key] = previous.id;
        continue;
      }
      const skill: Skill = { ...fields, ...(fields.package ? packageForImport(fields.package) : {}), id: id(), revision: 1 };
      skillIds[key] = skill.id;
      skills.push(skill);
    }
    const workerIds = Object.fromEntries(template.workers.map(worker => [worker.key, origin?.workerIds[worker.key] ?? id()]));
    const fallbackNames: string[] = [];
    const workers: Worker[] = [];
    for (const { key, skillKey, ...fields } of template.workers) {
      const previous = origin?.workerIds[key] ? this.store.get<Worker>('workers', workerIds[key]) : undefined;
      const connected = fields.provider === 'demo' || await this.runtime.connected?.(fields.provider) === true;
      const model = previous ? { provider: previous.provider, ...(previous.modelId ? { modelId: previous.modelId } : {}) } : connected ? { provider: fields.provider, ...(fields.modelId ? { modelId: fields.modelId } : {}) } : fallback;
      if (!previous && !connected) fallbackNames.push(fields.name);
      const { modelId: _suggestedModel, provider: _suggestedProvider, effort: suggestedEffort, ...configuration } = fields;
      const worker: Worker = {
        ...configuration,
        ...model,
        ...((previous ? previous.effort : suggestedEffort) ? { effort: previous ? previous.effort : suggestedEffort } : {}),
        ...(previous?.autoApplyProposals !== undefined ? { autoApplyProposals: previous.autoApplyProposals } : {}),
        ...(previous?.mcpServerIds !== undefined ? { mcpServerIds: previous.mcpServerIds } : {}),
        id: workerIds[key],
        skillId: skillIds[skillKey],
        revision: previous ? this.store.nextRevision(previous.id) : 1,
      };
      // A deleted model suggestion must not linger when falling back; existing connection choices stay local.
      if (!model.modelId) delete worker.modelId;
      workers.push(worker);
    }
    let team: Team | undefined;
    if (template.team) {
      const { memberKeys, synthesizerKey, ...fields } = template.team;
      const previous = origin ? this.store.get<Team>('teams', origin.entityId) : undefined;
      team = { ...fields, id: previous?.id ?? id(), revision: previous ? this.store.nextRevision(previous.id) : 1, memberIds: memberKeys.map(key => workerIds[key]), synthesizerId: workerIds[synthesizerKey] };
    }
    const rows: Parameters<Store['versionRows']>[0] = [...skills.map(value => ({ table: 'skills' as const, value })), ...workers.map(value => ({ table: 'workers' as const, value })), ...(team ? [{ table: 'teams' as const, value: team }] : [])];
    return { rows, team, workers, workerIds, skillIds, fallbackNames };
  }

  private origins(): Origin[] {
    return Origins.parse(this.store.setting('marketOrigins', []));
  }
  private origin(entityId: string) {
    const origin = this.origins().find(item => item.entityId === entityId);
    if (!origin) throw new Error('Bạn này không đến từ danh mục.');
    return origin;
  }
  private assertUpdateable(origin: Origin) {
    const lifecycle = this.store.entityState();
    const state = lifecycle[origin.kind === 'orglet' ? 'workers' : 'teams'][origin.entityId];
    if (state?.deletedAt || state?.archivedAt) throw new Error('Không cập nhật bạn đã lưu trữ hoặc xóa.');
    for (const workerId of Object.values(origin.workerIds)) {
      const member = lifecycle.workers[workerId];
      if (member?.deletedAt || member?.archivedAt) throw new Error('Không cập nhật bạn đã lưu trữ hoặc xóa.');
    }
  }
  /**
   * A digest of the content an update replaces, the same on every computer of an account: no ids, no local revision
   * numbers, no connection or permission choices. Each orglet goes with the skill it uses now, so switching skills
   * counts as a change, and crew members are named by their template keys.
   */
  private authoring(origin: Origin) {
    const keyOf = new Map(Object.entries(origin.workerIds).map(([key, workerId]) => [workerId, key]));
    const workers = Object.entries(origin.workerIds).sort(([first], [second]) => first.localeCompare(second)).map(([key, workerId]) => {
      const worker = this.store.get<Worker>('workers', workerId);
      return { key, content: workerContent(worker), skill: skillContent(this.store.get<Skill>('skills', worker.skillId)) };
    });
    let team: unknown;
    if (origin.kind === 'crew') {
      const { id: _id, revision: _revision, memberIds, synthesizerId, ...settings } = this.store.get<Team>('teams', origin.entityId);
      team = { ...settings, members: memberIds.map(workerId => keyOf.get(workerId) ?? workerId), lead: keyOf.get(synthesizerId) ?? synthesizerId };
    }
    return hash(JSON.stringify({ algorithm: 'authoring-v1', workers, team }));
  }
  private customization(origin: Origin, fingerprint: string): MarketCustomization {
    if (origin.baselineKind === 'authoring-v1') return this.authoring(origin) === origin.baseline ? 'unchanged' : 'customized';
    // An older origin hashed this computer's whole rows. A match still proves nothing changed; a mismatch may only
    // mean the copy arrived from another computer, so it is not called an edit.
    return fingerprint === origin.baseline ? 'unchanged' : 'unknown';
  }
  /** Exact local rows, revision numbers included: what the update card's token is checked against, never a baseline. */
  private fingerprint(origin: Origin) {
    const workers = Object.values(origin.workerIds).map(workerId => this.store.get<Worker>('workers', workerId));
    const skills = [...new Set(workers.map(worker => worker.skillId))].map(skillId => this.store.get<Skill>('skills', skillId));
    const team = origin.kind === 'crew' ? this.store.get<Team>('teams', origin.entityId) : undefined;
    return hash(JSON.stringify({ workers, skills, team }));
  }
  private async listing(listingId: string, version: number): Promise<MarketDisplayListing> {
    const catalog = await this.catalog(false);
    const saved = CachedCatalog.safeParse(this.store.setting('marketCatalog', null));
    const listings = [...catalog.listings, ...(saved.success ? saved.data.pages?.flatMap(page => page.catalog.listings) ?? [] : [])];
    const listing = listings.find(item => item.listingId === listingId && item.version === version);
    if (!listing) throw new Error('Không tìm thấy phiên bản này trong danh mục đã kiểm tra.');
    return z.union([MarketListingV2, MarketListing]).parse(listing);
  }
  private async body(listing: MarketDisplayListing): Promise<string> {
    const key = `${listing.listingId}:${listing.version}:${listing.sha256}`;
    const cached = this.store.setting<unknown>(`marketBody:${key}`, null);
    const curated = listing.listingId === 'research-friend' || listing.listingId === 'research-review';
    let text: string;
    if (!curated) text = await this.read(`/v2/listings/${listing.listingId}/versions/${listing.version}`, MARKET_BODY_LIMIT);
    else if (typeof cached === 'string' && Buffer.byteLength(cached) <= MARKET_BODY_LIMIT && hash(cached) === listing.sha256) text = cached;
    else {
      const bundled = await seedCatalog();
      const seed = bundled.listings.find(item => item.listingId === listing.listingId && item.version === listing.version && item.sha256 === listing.sha256);
      text = seed ? MARKET_SEED_BODIES[`${listing.listingId}:${listing.version}`] : await this.read(`/${curated ? 'v1' : 'v2'}/listings/${listing.listingId}/versions/${listing.version}`, MARKET_BODY_LIMIT);
    }
    if (Buffer.byteLength(text) > MARKET_BODY_LIMIT || hash(text) !== listing.sha256) throw new Error('Nội dung mẫu không khớp SHA-256 của danh mục.');
    parseMarketTemplate(text, listing.kind);
    if (curated) this.store.setSetting(`marketBody:${key}`, text);
    return text;
  }
  private async read(path: string, limit: number) {
    const response = await (this.runtime.fetch ?? fetch)(`${MARKET_URL}${path}`, { redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json' } });
    if (response.status === 404 || response.status === 501) throw new UnsupportedMarketRoute('Không tải được danh mục.');
    if (!response.ok || !response.body) throw new Error('Không tải được danh mục.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > limit) throw new Error('Template vượt giới hạn 2 MB.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return Buffer.concat(chunks).toString('utf8');
  }
}

function hash(text: string) {
  return createHash('sha256').update(text).digest('hex');
}

function workerContent(worker: { name: string; instructions: string; description?: string; avatar?: Worker['avatar']; taskBudgetMicros?: number }) {
  return `${worker.instructions}\n\n${JSON.stringify({ name: worker.name, description: worker.description, avatar: worker.avatar, taskBudgetMicros: worker.taskBudgetMicros }, null, 2)}`;
}

function skillContent(skill: Pick<Skill, 'name' | 'content' | 'package'>) {
  return `${skill.content}\n\n${JSON.stringify({ name: skill.name, ...(skill.package ? { package: { hash: skill.package.hash, files: skill.package.files.map(file => file.path) } } : {}) }, null, 2)}`;
}
