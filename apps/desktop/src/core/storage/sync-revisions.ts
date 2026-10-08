import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from './database';
import { Id, WorkerInput, SkillInput, TeamInput } from '../../shared/contracts';
import { Knowledge } from '../../shared/knowledge';
import { SkillPackage } from '../../shared/skill-package';
import { SyncClock, SyncRevisionId, compareSyncClock } from '../../shared/sync';
import { SyncRevision, SyncWorker, SyncSkill, SyncTeam, SyncKnowledge, SyncRevisionIdentity } from '../../shared/sync-revisions';
import { canonicalSyncData as canonicalJson } from '../../shared/sync-json';
import { SyncClockStore } from './sync-clock';
import { inspectPackage } from '../skill-package';
import { KnowledgeBase } from '../context/knowledge';

type Entity = SyncRevision['entity'];
const tables = { worker: 'workers', skill: 'skills', team: 'teams', knowledge: 'knowledge' } as const;
const ObjectData = z.record(z.string(), z.unknown());
const Identity = z.object({ revision_id: SyncRevisionId, kind: z.enum(['worker', 'skill', 'team', 'knowledge']),
  entity_id: Id, local_revision: z.number().int().positive(), generation: z.number().int().positive(),
  clock_json: z.string(), data_hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Identity = z.infer<typeof Identity>;
// Legacy records have no observed author time. A reserved tie key plus revision UUID orders them without inventing one.
const legacyClock = SyncClock.parse({ wallMs: 0, counter: 0, deviceId: '00000000-0000-4000-8000-000000000000' });

function projection(entity: Entity, raw: unknown) {
  if (entity === 'worker') return SyncWorker.strip().parse(raw);
  if (entity === 'team') return SyncTeam.strip().parse(raw);
  if (entity === 'knowledge') return SyncKnowledge.strip().parse(raw);
  const row = ObjectData.parse(raw);
  const package_ = row.package === undefined ? undefined : SkillPackage.omit({ reviewedHash: true }).strip().parse(row.package);
  return SyncSkill.strip().parse({ ...row, package: package_ });
}
function dataHash(revision: SyncRevision): string {
  return createHash('sha256').update(canonicalJson({ entity: revision.entity, generation: revision.generation, value: revision.value })).digest('hex');
}
function legacyId(entity: Entity, alias: number, value: unknown) {
  const bytes = createHash('sha256').update(canonicalJson({ entity, alias, value })).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 128;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return SyncRevisionId.parse(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
}
function compare(first: SyncRevision, second: SyncRevision): number {
  return first.generation - second.generation || compareSyncClock(first.clock, second.clock) ||
    (first.revisionId < second.revisionId ? -1 : first.revisionId > second.revisionId ? 1 : 0);
}

/** Maps stable wire identities to immutable local aliases; existing run and memory references never get renumbered. */
export class SyncRevisions {
  readonly clock: SyncClockStore;
  /** `backfill` is false at a start that the capture stamp says needs no pass (see `LocalSync.refreshFromCanonical`). */
  constructor(private store: Store, nowMs: () => number = Date.now, backfill = true) {
    this.clock = new SyncClockStore(store, nowMs);
    if (backfill) this.backfill();
  }
  private atomic<T>(work: () => T): T {
    return this.store.transaction(work);
  }
  private metadata(entity: Entity, entityId: string, alias: number): Identity | undefined {
    const row = this.store.db.prepare('SELECT * FROM sync_revision_ids WHERE kind=? AND entity_id=? AND local_revision=?').get(entity, entityId, alias);
    return row ? Identity.parse(row) : undefined;
  }
  private save(revision: SyncRevision, alias: number) {
    this.store.db.prepare('INSERT INTO sync_revision_ids VALUES(?,?,?,?,?,?,?)').run(revision.revisionId, revision.entity,
      revision.value.id, alias, revision.generation, JSON.stringify(revision.clock), dataHash(revision));
  }
  private raw(entity: Entity, entityId: string, alias: number): unknown {
    const row = entity === 'knowledge'
      ? this.store.db.prepare('SELECT data FROM knowledge_revisions WHERE id=? AND revision=?').get(entityId, alias)
      : this.store.db.prepare('SELECT data FROM revisions WHERE entity_id=? AND revision=?').get(entityId, alias);
    if (!row) throw new Error('Thiếu nội dung revision đồng bộ.');
    return JSON.parse(String(row.data));
  }
  /** Revisions read and checked during one pass over many rows; a revision never changes, so it is read once per pass. */
  private remembered?: Map<string, SyncRevision>;
  rememberReads(on: boolean) {
    this.remembered = on ? new Map() : undefined;
  }
  read(entity: Entity, entityId: string, alias: number): SyncRevision {
    const key = `${entity}:${entityId}:${alias}`;
    const known = this.remembered?.get(key);
    if (known) return known;
    const metadata = this.metadata(entity, entityId, alias);
    if (!metadata) throw new Error('Thiếu định danh revision đồng bộ.');
    const result = SyncRevision.parse({ entity, revisionId: metadata.revision_id, generation: metadata.generation,
      clock: JSON.parse(metadata.clock_json), value: projection(entity, this.raw(entity, entityId, alias)) });
    if (dataHash(result) !== metadata.data_hash) throw new Error('Nội dung revision đồng bộ đã đổi.');
    this.remembered?.set(key, result);
    return result;
  }
  /** Old backups may hold an exact frozen snapshot after its live entity or history was removed. */
  frozen(entity: Entity, raw: unknown): SyncRevision {
    const value = projection(entity, raw);
    const alias = z.object({ revision: z.number().int().positive() }).parse(raw).revision;
    const metadata = this.metadata(entity, value.id, alias);
    if (metadata) {
      const stored = this.read(entity, value.id, alias);
      if (canonicalJson(stored.value) === canonicalJson(value)) return stored;
    }
    return SyncRevision.parse({ entity, value, revisionId: legacyId(entity, alias, value), generation: alias, clock: legacyClock });
  }
  identities(): SyncRevisionIdentity[] {
    return this.store.db.prepare(`SELECT * FROM sync_revision_ids identity
      WHERE (kind='knowledge' AND EXISTS (SELECT 1 FROM knowledge_revisions WHERE id=identity.entity_id AND revision=identity.local_revision))
      OR (kind!='knowledge' AND EXISTS (SELECT 1 FROM revisions WHERE entity_id=identity.entity_id AND revision=identity.local_revision))`).all()
      .map(row => {
        const metadata = Identity.parse(row);
        return SyncRevisionIdentity.parse({ entity: metadata.kind, entityId: metadata.entity_id, localRevision: metadata.local_revision,
          revisionId: metadata.revision_id, generation: metadata.generation, clock: JSON.parse(metadata.clock_json) });
      });
  }
  restoreIdentities(identities: SyncRevisionIdentity[]) {
    this.atomic(() => {
      for (const raw of identities) {
        const identity = SyncRevisionIdentity.parse(raw);
        const revision = SyncRevision.parse({ entity: identity.entity, revisionId: identity.revisionId, generation: identity.generation,
          clock: identity.clock, value: projection(identity.entity, this.raw(identity.entity, identity.entityId, identity.localRevision)) });
        if (revision.value.id !== identity.entityId) throw new Error('Định danh revision của bản sao lưu không khớp.');
        const existing = this.metadata(identity.entity, identity.entityId, identity.localRevision);
        if (existing) {
          if (canonicalJson(this.read(identity.entity, identity.entityId, identity.localRevision)) !== canonicalJson(revision)) {
            throw new Error('Định danh revision của bản sao lưu đã có nội dung khác.');
          }
          continue;
        }
        this.save(revision, identity.localRevision);
      }
    });
  }
  refresh() {
    this.backfill();
  }
  private backfill() {
    this.atomic(() => {
      for (const row of this.store.db.prepare(`SELECT entity_id,revision,data FROM revisions history
        WHERE NOT EXISTS (SELECT 1 FROM sync_revision_ids WHERE entity_id=history.entity_id AND local_revision=history.revision)
        ORDER BY entity_id,revision`).all()) {
        const data = ObjectData.parse(JSON.parse(String(row.data)));
        const entity = 'memberIds' in data ? 'team' : 'skillId' in data ? 'worker' : 'skill';
        const alias = Number(row.revision);
        if (this.metadata(entity, String(row.entity_id), alias)) continue;
        const value = projection(entity, data);
        this.save(SyncRevision.parse({ entity, value, revisionId: legacyId(entity, alias, value), generation: alias, clock: legacyClock }), alias);
      }
      for (const row of this.store.db.prepare(`SELECT id,revision,data FROM knowledge_revisions history
        WHERE NOT EXISTS (SELECT 1 FROM sync_revision_ids WHERE kind='knowledge' AND entity_id=history.id AND local_revision=history.revision)
        ORDER BY id,revision`).all()) {
        const alias = Number(row.revision);
        if (this.metadata('knowledge', String(row.id), alias)) continue;
        const value = projection('knowledge', JSON.parse(String(row.data)));
        this.save(SyncRevision.parse({ entity: 'knowledge', value, revisionId: legacyId('knowledge', alias, value), generation: alias, clock: legacyClock }), alias);
      }
      for (const entity of ['worker', 'skill', 'team', 'knowledge'] as const) {
        for (const row of this.store.db.prepare(`SELECT id,data FROM ${tables[entity]}`).all()) {
          const current = ObjectData.parse(JSON.parse(String(row.data)));
          const alias = z.number().int().positive().parse(current.revision);
          const value = projection(entity, current);
          const metadata = this.metadata(entity, String(row.id), alias);
          if (metadata && canonicalJson(this.read(entity, String(row.id), alias).value) === canonicalJson(value)) continue;
          // Older migrations occasionally changed a live row in place. Preserve the old alias for frozen snapshots.
          const nextAlias = metadata ? entity === 'knowledge'
            ? Number(this.store.db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS next FROM knowledge_revisions WHERE id=?').get(String(row.id))!.next)
            : this.store.nextRevision(String(row.id)) : alias;
          const repaired = { ...current, revision: nextAlias };
          if (entity === 'knowledge') this.store.db.prepare('INSERT INTO knowledge_revisions VALUES(?,?,?)').run(String(row.id), nextAlias, JSON.stringify(repaired));
          else this.store.db.prepare('INSERT INTO revisions VALUES(?,?,?)').run(String(row.id), nextAlias, JSON.stringify(repaired));
          this.store.put(tables[entity], { ...repaired, id: Id.parse(row.id) });
          this.save(SyncRevision.parse({ entity, value, revisionId: legacyId(entity, nextAlias, value), generation: nextAlias, clock: legacyClock }), nextAlias);
        }
      }
    });
  }
  /** Caller already saved the immutable domain revision in this same transaction. */
  capture(entity: Entity, raw: unknown, alias: number): SyncRevision {
    if (!this.store.db.isTransaction) throw new Error('Revision và clock phải cùng transaction.');
    const value = projection(entity, raw);
    const existing = this.metadata(entity, value.id, alias);
    if (existing) {
      const previous = this.read(entity, value.id, alias);
      if (canonicalJson(previous.value) !== canonicalJson(value)) throw new Error('Revision đã có nội dung khác.');
      return previous;
    }
    if (canonicalJson(projection(entity, this.raw(entity, value.id, alias))) !== canonicalJson(value)) {
      throw new Error('Nội dung revision không khớp lịch sử đã lưu.');
    }
    const generation = Number(this.store.db.prepare('SELECT COALESCE(MAX(generation),0)+1 AS next FROM sync_revision_ids WHERE kind=? AND entity_id=?').get(entity, value.id)!.next);
    const result = SyncRevision.parse({ entity, value, revisionId: randomUUID(), generation, clock: this.clock.tick() });
    this.save(result, alias);
    return result;
  }
  private current(entity: Entity, entityId: string) {
    const row = this.store.db.prepare(`SELECT data FROM ${tables[entity]} WHERE id=?`).get(entityId);
    return row ? ObjectData.parse(JSON.parse(String(row.data))) : undefined;
  }
  private hydrate(revision: SyncRevision, alias: number, current: Record<string, unknown> | undefined) {
    const value = { ...revision.value, revision: alias };
    if (revision.entity === 'worker') return WorkerInput.extend({ id: Id, revision: z.number().int().positive() }).parse({ ...value,
      autoApplyProposals: current?.autoApplyProposals, mcpServerIds: current?.mcpServerIds });
    if (revision.entity === 'team') return TeamInput.extend({ id: Id, revision: z.number().int().positive() }).parse({ ...value,
      preflight: current?.preflight, reviewPolicy: current?.reviewPolicy, workHours: current?.workHours });
    if (revision.entity === 'knowledge') return Knowledge.parse(value);
    const localPackage = current?.package === undefined ? undefined : SkillPackage.parse(current.package);
    const package_ = revision.value.package ? { ...revision.value.package,
      reviewedHash: revision.value.package.hash === localPackage?.hash ? localPackage?.reviewedHash : undefined } : undefined;
    return SkillInput.extend({ id: Id, revision: z.number().int().positive(), package: SkillPackage.optional() }).parse({ ...value, package: package_ });
  }
  /** Trusted core entry only; account fencing, dependency staging and visibility barriers belong to the replica. */
  receive(raw: unknown): { kind: 'applied'; localRevision: number; selected: boolean } | { kind: 'duplicate'; localRevision: number } {
    const revision = SyncRevision.parse(raw);
    if (revision.entity === 'skill' && revision.value.package) {
      const inspected = inspectPackage(revision.value.package);
      if (inspected.hash !== revision.value.package.hash || inspected.metadata.name !== revision.value.name || inspected.content !== revision.value.content) {
        throw new Error('Gói skill đồng bộ không khớp nội dung.');
      }
    }
    return this.atomic(() => {
      const known = this.store.db.prepare('SELECT * FROM sync_revision_ids WHERE revision_id=?').get(revision.revisionId);
      if (known) {
        const existing = Identity.parse(known);
        if (existing.data_hash !== dataHash(revision) || canonicalJson(JSON.parse(existing.clock_json)) !== canonicalJson(revision.clock)) {
          throw new Error('Định danh revision đã có nội dung khác.');
        }
        return { kind: 'duplicate', localRevision: existing.local_revision };
      }
      const current = this.current(revision.entity, revision.value.id);
      const previous = current ? this.read(revision.entity, revision.value.id, z.number().int().positive().parse(current.revision)) : undefined;
      const alias = revision.entity === 'knowledge'
        ? Number(this.store.db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS next FROM knowledge_revisions WHERE id=?').get(revision.value.id)!.next)
        : this.store.nextRevision(revision.value.id);
      const value = this.hydrate(revision, alias, current);
      if (revision.entity === 'knowledge') this.store.db.prepare('INSERT INTO knowledge_revisions VALUES(?,?,?)').run(value.id, alias, JSON.stringify(value));
      else this.store.db.prepare('INSERT INTO revisions VALUES(?,?,?)').run(value.id, alias, JSON.stringify(value));
      this.save(revision, alias);
      this.clock.tick(revision.clock);
      const selected = !previous || compare(revision, previous) > 0;
      if (selected) {
        this.store.put(tables[revision.entity], value);
        if (revision.entity === 'knowledge') new KnowledgeBase(this.store).index(Knowledge.parse(value));
      }
      return { kind: 'applied', localRevision: alias, selected };
    });
  }
}
