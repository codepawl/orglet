import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ProviderId, type Worker, type Skill, type Team } from '../../shared/contracts';
import { MARKET_BODY_LIMIT, MARKET_URL, MarketCatalog, MarketListing, MarketOrigin as Origin, MarketOrigins as Origins, type MarketCatalogView, type MarketAdded, type MarketUpdate, type MarketInstallation } from '../../shared/market';
import { MARKET_SEED_BODIES, seedCatalog } from '../../shared/market-seed';
import { Store, id } from '../storage/database';
import { KnowledgeBase } from '../context/knowledge';
import { packageForImport } from '../skill-package';
import { parseMarketTemplate } from './templates';

const Model = z.object({ provider: ProviderId, modelId: z.string().max(200).optional() }).strict();
type Model = z.infer<typeof Model>;

const CachedCatalog = z.object({ catalog: MarketCatalog, fetchedAt: z.iso.datetime() }).strict();

export type MarketRuntime = {
  fetch?: typeof fetch;
  connected?: (provider: Worker['provider']) => Promise<boolean>;
  defaultModel?: () => Promise<Model>;
  followCrew?: (team: Team) => void;
};

export class Marketplace {
  constructor(private store: Store, private notify: () => void, private runtime: MarketRuntime = {}) {}

  async catalog(refresh = false): Promise<MarketCatalogView> {
    const saved = CachedCatalog.safeParse(this.store.setting<unknown>('marketCatalog', null));
    if (!refresh) return saved.success
      ? { ...saved.data.catalog, fetchedAt: saved.data.fetchedAt, source: 'cache' }
      : { ...await seedCatalog(), fetchedAt: null, source: 'bundled' };
    try {
      const text = await this.read('/v1/catalog', 512 * 1024);
      const catalog = MarketCatalog.parse(JSON.parse(text));
      const current = CachedCatalog.safeParse(this.store.setting<unknown>('marketCatalog', null));
      if (current.success) {
        for (const listing of catalog.listings) {
          const previous = current.data.catalog.listings.find(item => item.listingId === listing.listingId);
          if (previous && (listing.version < previous.version || (listing.version === previous.version && listing.sha256 !== previous.sha256))) throw new Error('Phiên bản danh mục không hợp lệ.');
        }
      }
      const fetchedAt = new Date().toISOString();
      this.store.setSetting('marketCatalog', { catalog, fetchedAt });
      return { ...catalog, fetchedAt, source: 'online' };
    } catch {
      return { ...await this.catalog(false), error: 'Không tải được danh mục. Đang dùng bản lưu trên máy.' };
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
      const latest = saved.success ? saved.data.catalog.listings.find(item => item.listingId === origin.listingId) : undefined;
      return { entityId: entity.id, kind: origin.kind, listingId: origin.listingId, version: origin.version, name: entity.name, updateAvailable: !!latest && latest.version > origin.version };
    });
  }

  async add(listingId: string, version: number): Promise<MarketAdded> {
    const listing = await this.listing(listingId, version);
    const template = parseMarketTemplate(await this.body(listing), listing.kind);
    const prepared = await this.prepare(template);
    const entityId = prepared.team?.id ?? prepared.workers[0].id;
    const origin: Origin = { entityId, listingId, version, kind: listing.kind, workerIds: prepared.workerIds, skillIds: prepared.skillIds, baseline: '' };
    this.store.transaction(() => {
      this.store.versionRows(prepared.rows);
      if (prepared.team) new KnowledgeBase(this.store).importProposed(entityId, template.knowledge ?? []);
      origin.baseline = this.fingerprint(origin);
      this.store.setSetting('marketOrigins', [...this.origins(), Origin.parse(origin)]);
    });
    this.notify();
    return { entityId, kind: listing.kind, workerIds: prepared.workers.map(worker => worker.id), fallbackNames: prepared.fallbackNames };
  }

  async previewUpdate(entityId: string): Promise<MarketUpdate> {
    const origin = this.origin(entityId);
    this.assertUpdateable(origin);
    const catalog = await this.catalog(false);
    const listing = catalog.listings.find(item => item.listingId === origin.listingId && item.version > origin.version);
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
    return { entityId, listing, installedVersion: origin.version, customized: fingerprint !== origin.baseline, token: hash(`${fingerprint}:${listing.sha256}:${origin.version}`), changes };
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
      const next = { ...origin, version: preview.listing.version, workerIds: prepared.workerIds, skillIds: prepared.skillIds };
      next.baseline = this.fingerprint(next);
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
      const { modelId: _suggestedModel, provider: _suggestedProvider, ...configuration } = fields;
      const worker: Worker = {
        ...configuration,
        ...model,
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
  private fingerprint(origin: Origin) {
    const workers = Object.values(origin.workerIds).map(workerId => this.store.get<Worker>('workers', workerId));
    const skills = [...new Set(workers.map(worker => worker.skillId))].map(skillId => this.store.get<Skill>('skills', skillId));
    const team = origin.kind === 'crew' ? this.store.get<Team>('teams', origin.entityId) : undefined;
    return hash(JSON.stringify({ workers, skills, team }));
  }
  private async listing(listingId: string, version: number): Promise<MarketListing> {
    const catalog = await this.catalog(false);
    const listing = catalog.listings.find(item => item.listingId === listingId && item.version === version);
    if (!listing) throw new Error('Không tìm thấy phiên bản này trong danh mục đã kiểm tra.');
    return MarketListing.parse(listing);
  }
  private async body(listing: MarketListing): Promise<string> {
    const key = `${listing.listingId}:${listing.version}:${listing.sha256}`;
    const cached = this.store.setting<unknown>(`marketBody:${key}`, null);
    let text: string;
    if (typeof cached === 'string' && Buffer.byteLength(cached) <= MARKET_BODY_LIMIT && hash(cached) === listing.sha256) text = cached;
    else {
      const bundled = await seedCatalog();
      const seed = bundled.listings.find(item => item.listingId === listing.listingId && item.version === listing.version && item.sha256 === listing.sha256);
      text = seed ? MARKET_SEED_BODIES[`${listing.listingId}:${listing.version}`] : await this.read(`/v1/listings/${listing.listingId}/versions/${listing.version}`, MARKET_BODY_LIMIT);
    }
    if (Buffer.byteLength(text) > MARKET_BODY_LIMIT || hash(text) !== listing.sha256) throw new Error('Nội dung mẫu không khớp SHA-256 của danh mục.');
    parseMarketTemplate(text, listing.kind);
    this.store.setSetting(`marketBody:${key}`, text);
    return text;
  }
  private async read(path: string, limit: number) {
    const response = await (this.runtime.fetch ?? fetch)(`${MARKET_URL}${path}`, { redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json' } });
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
