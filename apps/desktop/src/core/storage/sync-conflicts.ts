import type { Store } from './database';
import { KnowledgeBase } from '../context/knowledge';
import type { Skill, Team, Worker } from '../../shared/contracts';
import type { Knowledge } from '../../shared/knowledge';
import { ResolveSyncConflict, SyncConflictEntity, type SyncConflict } from '../../shared/sync-conflicts';

const TABLES = { worker: 'workers', skill: 'skills', team: 'teams', knowledge: 'knowledge' } as const;
export const CONFLICT_CHANGED = 'Mục này vừa thay đổi. Xem lại hai bản rồi chọn.';

type Row = { revisionId: string; alias: number; deviceId: string };

/**
 * Versions two computers wrote at the same step of one entity's history (GH-484). Sync already picked the later one
 * and kept the other in the history. A conflict stays listed until someone chooses, which writes the next revision.
 */
export class SyncConflicts {
  constructor(private store: Store) {}

  private groups(): { entity: SyncConflictEntity; id: string; generation: number }[] {
    return this.store.db.prepare(`SELECT kind,entity_id,generation FROM sync_revision_ids identity
      WHERE generation=(SELECT MAX(generation) FROM sync_revision_ids WHERE kind=identity.kind AND entity_id=identity.entity_id)
      GROUP BY kind,entity_id,generation HAVING COUNT(DISTINCT data_hash)>1 ORDER BY kind,entity_id LIMIT 100`).all()
      .map(row => ({ entity: SyncConflictEntity.parse(row.kind), id: String(row.entity_id), generation: Number(row.generation) }));
  }

  private rows(entity: SyncConflictEntity, id: string, generation: number): Row[] {
    return this.store.db.prepare('SELECT revision_id,local_revision,clock_json FROM sync_revision_ids WHERE kind=? AND entity_id=? AND generation=? ORDER BY local_revision')
      .all(entity, id, generation).map(row => ({ revisionId: String(row.revision_id), alias: Number(row.local_revision),
        deviceId: String((JSON.parse(String(row.clock_json)) as { deviceId: string }).deviceId) }));
  }

  private saved(entity: SyncConflictEntity, id: string, alias: number): Worker | Skill | Team | Knowledge | undefined {
    const row = entity === 'knowledge'
      ? this.store.db.prepare('SELECT data FROM knowledge_revisions WHERE id=? AND revision=?').get(id, alias)
      : this.store.db.prepare('SELECT data FROM revisions WHERE entity_id=? AND revision=?').get(id, alias);
    return row ? JSON.parse(String(row.data)) as Worker | Skill | Team | Knowledge : undefined;
  }

  private live(entity: SyncConflictEntity, id: string): { revision: number } | undefined {
    const row = this.store.db.prepare(`SELECT data FROM ${TABLES[entity]} WHERE id=?`).get(id);
    if (!row) return undefined;
    const state = this.store.entityState();
    if (entity === 'worker' && state.workers[id]?.deletedAt) return undefined;
    if (entity === 'team' && state.teams[id]?.deletedAt) return undefined;
    return JSON.parse(String(row.data)) as { revision: number };
  }

  list(): SyncConflict[] {
    const thisDevice = this.store.sync.deviceId();
    const conflicts: SyncConflict[] = [];
    for (const group of this.groups()) {
      const live = this.live(group.entity, group.id);
      if (!live) continue;
      const versions = this.rows(group.entity, group.id, group.generation).flatMap(row => {
        const value = this.saved(group.entity, group.id, row.alias);
        return value ? [{ revisionId: row.revisionId, current: row.alias === live.revision, thisComputer: row.deviceId === thisDevice, text: describe(group.entity, value) }] : [];
      });
      if (versions.length < 2) continue;
      const shown = this.saved(group.entity, group.id, live.revision);
      conflicts.push({ ...group, name: shown ? nameOf(group.entity, shown) : '', versions });
    }
    return conflicts;
  }

  /** Writes the chosen version as the next revision. The other stays in the history; a run keeps what it started with. */
  resolve(raw: unknown) {
    const input = ResolveSyncConflict.parse(raw);
    this.store.transaction(() => {
      const group = this.groups().find(item => item.entity === input.entity && item.id === input.id);
      const chosen = group && this.rows(input.entity, input.id, group.generation).find(row => row.revisionId === input.revisionId);
      if (!group || group.generation !== input.generation || !chosen || !this.live(input.entity, input.id)) throw new Error(CONFLICT_CHANGED);
      const value = this.saved(input.entity, input.id, chosen.alias);
      if (!value) throw new Error(CONFLICT_CHANGED);
      if (input.entity === 'knowledge') {
        const next = Number(this.store.db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS next FROM knowledge_revisions WHERE id=?').get(input.id)!.next);
        new KnowledgeBase(this.store).write({ ...(value as Knowledge), revision: next });
        return;
      }
      this.store.versionRows([{ table: TABLES[input.entity], value: { ...(value as Worker | Skill | Team), revision: this.store.nextRevision(input.id) } }]);
    });
  }
}

function nameOf(entity: SyncConflictEntity, value: Worker | Skill | Team | Knowledge): string {
  return entity === 'knowledge' ? (value as Knowledge).title : (value as Worker | Skill | Team).name;
}
function describe(entity: SyncConflictEntity, value: Worker | Skill | Team | Knowledge): string {
  const body = entity === 'knowledge' ? (value as Knowledge).content : entity === 'skill' ? (value as Skill).content : (value as Worker | Team).instructions;
  return `${nameOf(entity, value)}\n\n${body ?? ''}`;
}
