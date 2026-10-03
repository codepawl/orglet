import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from './database';
import { SyncRevisions } from './sync-revisions';
import { ChatTurns } from './chat-turns';
import { SyncRecordingContext, compareSyncClock, SetSyncLocalOnly, syncUuidFromDigest, syncScopeNamespace } from '../../shared/sync';
import { SyncRecord, SyncData, SyncChat, SyncTurn, SyncRoot, SyncScope, SyncSource, SyncRoutine, SyncRun, SyncArtifact, syncRecordKey } from '../../shared/sync-records';
import { SyncRevision } from '../../shared/sync-revisions';
import { canonicalSyncData as canonicalJson } from '../../shared/sync-json';
import { SYNC_RECORD_BYTES } from '../../shared/sync-protocol';
import { Id, RunInput, Routine, TeamInput, type Task, type Worker, type Skill, type Team, type Run, type Artifact, type Activity } from '../../shared/contracts';
import { MarketOrigins } from '../../shared/market';
import { Channel, EmptyChannel } from '../../shared/channels';
import { MessageReaction } from '../../shared/message-interactions';
import { ChatQuote, SideOf } from '../../shared/side-threads';
import { ChatSearch } from './chat-search';
import { CustomConnection } from '../../shared/custom-connections';
import { TeamMessage } from '../../shared/team-messages';
import { turnMessageId } from '../../shared/message-interactions';

const LocalChat = SyncChat.omit({ participants: true }).extend({ sideOf: SideOf.optional() });
const PermanentDeletion = z.object({ kind: z.enum(['worker', 'task', 'knowledge', 'team', 'skill', 'source', 'routine']), id: Id }).strict();
const TaskInput = LocalChat.extend({ brief: z.string(), sourceIds: z.array(Id), inputRevision: z.number().int().nonnegative().optional(),
  teamSnapshot: TeamInput.extend({ id: Id, revision: z.number().int().positive(), memberIds: z.array(Id) }).strip().optional(),
  currentInput: RunInput.optional(), currentTurnId: Id.optional(), currentTurnCreatedAt: z.iso.datetime().optional(), title: z.string().optional(), archivedAt: z.string().optional(),
  channel: Channel.optional(), messageReactions: z.array(MessageReaction).optional(), quotes: z.array(ChatQuote).optional() });
const Visibility = z.object({ kind: z.enum(['worker', 'task']), entity_id: Id, epoch: Id,
  local_only: z.union([z.literal(0), z.literal(1)]), deleted: z.union([z.literal(0), z.literal(1)]), clock_json: z.string() }).strict();

function stableUuid(namespace: string): string {
  return syncUuidFromDigest(createHash('sha256').update(namespace).digest());
}
function initialEpoch(root: SyncRoot): string {
  return stableUuid(syncScopeNamespace(root));
}

/** Local replication only. Account transport, token ownership and orchestration are intentionally outside this store. */
export class LocalSync {
  readonly revisions: SyncRevisions;
  readonly turns: ChatTurns;
  private context?: SyncRecordingContext;
  private importing = false;
  private backfilling = false;
  constructor(private store: Store, nowMs: () => number = Date.now) {
    this.revisions = new SyncRevisions(store, nowMs);
    this.turns = new ChatTurns(store);
    this.refreshFromCanonical();
  }
  refreshFromCanonical() {
    this.revisions.refresh();
    this.turns.backfill();
    this.backfilling = true;
    try {
      this.store.transaction(() => {
        for (const row of this.store.db.prepare(`SELECT kind,entity_id,local_revision FROM sync_revision_ids identity
          WHERE (kind='knowledge' AND EXISTS (SELECT 1 FROM knowledge_revisions WHERE id=identity.entity_id AND revision=identity.local_revision))
          OR (kind!='knowledge' AND EXISTS (SELECT 1 FROM revisions WHERE entity_id=identity.entity_id AND revision=identity.local_revision))`).all()) {
          const entity = z.enum(['worker', 'skill', 'team', 'knowledge']).parse(row.kind);
          this.record({ kind: 'revision', revision: this.revisions.read(entity, String(row.entity_id), Number(row.local_revision)) });
        }
        for (const task of this.store.all<Task>('tasks')) {
          this.captureWrite('tasks', task);
          for (const turn of this.turns.list(task.id)) this.record({ kind: 'turn', value: SyncTurn.strip().parse(turn) });
        }
        for (const table of ['sources', 'routines', 'runs', 'events', 'artifacts']) {
          for (const value of this.store.all(table)) this.captureWrite(table, value);
        }
        for (const key of ['theme', 'language', 'sidebarOrder', 'taskTitles', 'marketOrigins', 'emptyChannels', 'entityState', 'customConnections']) {
          const row = this.store.db.prepare('SELECT data FROM settings WHERE id=?').get(key);
          if (row) this.captureSetting(key, JSON.parse(String(row.data)), undefined);
        }
        this.purgePermanentPayloads();
        this.purgeBlockedOutbox(true);
      });
    } finally {
      this.backfilling = false;
    }
  }
  setRecordingContext(raw?: SyncRecordingContext) {
    this.context = raw === undefined ? undefined : SyncRecordingContext.parse(raw);
  }
  resetDevice() {
    this.context = undefined;
  }
  private assertContext(raw: SyncRecordingContext) {
    const context = SyncRecordingContext.parse(raw);
    if (!this.context || context.accountKey !== this.context.accountKey || context.generation !== this.context.generation) {
      throw new Error('Phiên đồng bộ đã đổi.');
    }
    return context;
  }
  private visibility(root: SyncRoot) {
    const row = this.store.db.prepare('SELECT * FROM sync_visibility WHERE kind=? AND entity_id=?').get(root.kind, root.id);
    return row ? Visibility.parse(row) : { kind: root.kind, entity_id: root.id, epoch: initialEpoch(root), local_only: 0, deleted: 0,
      clock_json: JSON.stringify({ ...this.revisions.clock.read(), wallMs: 0, counter: 0 }) };
  }
  isLocalOnly(kind: SyncRoot['kind'], id: string): boolean {
    return this.roots(kind, id).some(root => {
      const policy = this.visibility(root);
      return Boolean(policy.local_only || policy.deleted);
    });
  }
  localOnlyState() {
    const rows = this.store.db.prepare('SELECT kind,entity_id,deleted FROM sync_visibility WHERE local_only=1 OR deleted=1').all();
    const tasks = this.store.all<Task>('tasks');
    const workerIds = new Set(this.store.db.prepare('SELECT id FROM workers').all().map(row => String(row.id)));
    const taskIds = new Set(tasks.map(task => task.id));
    return { workers: rows.filter(row => row.kind === 'worker' && workerIds.has(String(row.entity_id))).map(row => String(row.entity_id)),
      tasks: rows.filter(row => row.kind === 'task' && taskIds.has(String(row.entity_id))).map(row => String(row.entity_id)),
      permanentWorkers: rows.filter(row => row.kind === 'worker' && row.deleted && workerIds.has(String(row.entity_id))).map(row => String(row.entity_id)),
      permanentTasks: tasks.filter(task => this.roots('task', task.id).some(root => this.visibility(root).deleted)).map(task => task.id),
      inheritedTasks: tasks.filter(task => this.roots('task', task.id).some(root => {
        if (root.kind === 'task' && root.id === task.id) return false;
        const policy = this.visibility(root);
        return Boolean(policy.local_only || policy.deleted);
      })).map(task => task.id) };
  }
  private roots(kind: SyncRoot['kind'], id: string): SyncRoot[] {
    if (kind === 'worker') return [{ kind, id }];
    const row = this.store.db.prepare('SELECT data FROM tasks WHERE id=?').get(id);
    if (!row) return [{ kind, id }];
    return this.chatRoots(JSON.parse(String(row.data)) as Task);
  }
  private teamWorkers(teamId?: string): string[] {
    const row = teamId && this.store.db.prepare('SELECT data FROM teams WHERE id=?').get(teamId);
    if (!row) return [];
    const team = JSON.parse(String(row.data)) as Team;
    return [...team.memberIds, team.synthesizerId];
  }
  private participantIds(task: Pick<Task, 'workerId' | 'assignees' | 'teamId' | 'teamSnapshot' | 'channel'>): string[] {
    const state = task.assignees === 'all' ? this.store.entityState().workers : {};
    const assigned = task.assignees === 'all'
      ? this.store.db.prepare('SELECT id FROM workers').all().map(row => String(row.id)).filter(id => !state[id]?.archivedAt && !state[id]?.deletedAt)
      : task.assignees ?? [];
    const members = task.channel?.members.flatMap(member => member.kind === 'orglet' ? [member.id] : this.teamWorkers(member.id)) ?? [];
    const frozen = task.teamSnapshot ? [...task.teamSnapshot.memberIds, task.teamSnapshot.synthesizerId] : [];
    return [...new Set([task.workerId, ...assigned, ...members, ...frozen, ...this.teamWorkers(task.teamId)])];
  }
  private chatRoots(task: Pick<Task, 'id' | 'workerId' | 'assignees' | 'teamId' | 'teamSnapshot' | 'channel' | 'sideOf'>): SyncRoot[] {
    return [...this.participantIds(task).map(id => ({ kind: 'worker' as const, id })),
      ...(task.sideOf ? [{ kind: 'task' as const, id: task.sideOf.taskId }] : []), { kind: 'task', id: task.id }];
  }
  private runRoots(run: Pick<Run, 'taskId' | 'snapshot'>): SyncRoot[] {
    const frozen = run.snapshot.team ? [...run.snapshot.team.memberIds, run.snapshot.team.synthesizerId] : [];
    const workerIds = run.snapshot.worker ? [run.snapshot.worker.id] : [];
    return [...this.roots('task', run.taskId), ...[...workerIds, ...frozen].map(id => ({ kind: 'worker' as const, id }))];
  }
  private skillOwners(skillId: string, supplied?: SyncScope[]): Worker[] {
    const owners = this.store.db.prepare("SELECT data FROM workers WHERE json_extract(data,'$.skillId')=?").all(skillId)
      .map(row => JSON.parse(String(row.data)) as Worker);
    if (supplied && !owners.some(owner => supplied.some(scope => scope.kind === 'worker' && scope.id === owner.id))) {
      // A skill precedes its new owner's revision. Validate that relationship from the staged account batch.
      for (const row of this.store.db.prepare(`SELECT data FROM sync_inbox WHERE account_key=? AND status='pending'
        AND json_extract(data,'$.schemaVersion')=1 AND json_extract(data,'$.data.kind')='revision'
        AND json_extract(data,'$.data.revision.entity')='worker' AND json_extract(data,'$.data.revision.value.skillId')=?`)
        .all(this.context?.accountKey ?? '', skillId)) {
        const candidate = SyncRecord.parse(JSON.parse(String(row.data)));
        if (candidate.data.kind === 'revision' && candidate.data.revision.entity === 'worker') owners.push({ ...candidate.data.revision.value, revision: 1 });
      }
    }
    return owners;
  }
  private scopes(data: SyncData, supplied?: SyncScope[]) {
    let roots: SyncRoot[] = [];
    if (data.kind === 'revision') {
      const revision = data.revision;
      if (revision.entity === 'worker') roots = this.roots('worker', revision.value.id);
      if (revision.entity === 'team') roots = [...revision.value.memberIds, revision.value.synthesizerId].map(id => ({ kind: 'worker', id }));
      if (revision.entity === 'knowledge') {
        if (revision.value.scope.type === 'worker') roots = this.roots('worker', revision.value.scope.id);
        if (revision.value.scope.type === 'team') roots = this.teamWorkers(revision.value.scope.id).map(id => ({ kind: 'worker', id }));
        if (revision.value.provenance.kind === 'run' || revision.value.provenance.kind === 'turn') {
          roots.push(...this.roots('task', revision.value.provenance.taskId));
        }
      }
      if (revision.entity === 'skill') {
        const owners = this.skillOwners(revision.value.id, supplied);
        const publicOwners = owners.filter(worker => !this.isLocalOnly('worker', worker.id));
        const owner = (supplied ? publicOwners.find(worker => supplied.some(scope => scope.kind === 'worker' && scope.id === worker.id)) : publicOwners[0])
          ?? publicOwners[0] ?? owners[0];
        if (owner) roots = this.roots('worker', owner.id);
        else {
          const saved = this.store.db.prepare('SELECT data FROM sync_records WHERE record_key=?').get(`revision:${revision.revisionId}`);
          const prior = saved ? SyncRecord.parse(JSON.parse(String(saved.data))).scopes : supplied ?? [];
          roots = prior.filter(scope => scope.kind === 'worker').map(({ kind, id }) => ({ kind, id }));
        }
      }
    } else if (data.kind === 'chat') roots = [...this.chatRoots({ ...data.value,
      sideOf: data.value.sideOf && { taskId: data.value.sideOf.taskId, throughRevision: 0 } }),
      ...(data.value.participants ?? []).map(id => ({ kind: 'worker' as const, id })), ...this.roots('task', data.value.id)];
    else if (data.kind === 'turn') roots = this.roots('task', data.value.taskId);
    else if (data.kind === 'chatField' || data.kind === 'reaction' || data.kind === 'quote') {
      roots = this.roots('task', data.taskId);
      if (data.kind === 'chatField' && data.change.field === 'channel' && data.change.value) {
        roots.push(...data.change.value.members.flatMap(member => member.kind === 'orglet' ? [member.id] : this.teamWorkers(member.id))
          .map(id => ({ kind: 'worker' as const, id })));
      }
    }
    else if (data.kind === 'entityState' && data.entity === 'worker') roots = this.roots('worker', data.id);
    else if (data.kind === 'entityState' && data.entity === 'team' && !data.value?.deletedAt) {
      roots = this.teamWorkers(data.id).map(id => ({ kind: 'worker', id }));
    }
    else if (data.kind === 'origin') roots = Object.values(data.value.workerIds).map(id => ({ kind: 'worker', id }));
    else if (data.kind === 'channel') roots = data.value.members.flatMap(member => member.kind === 'orglet' ? [member.id] : this.teamWorkers(member.id))
      .map(id => ({ kind: 'worker', id }));
    else if (data.kind === 'routine') roots = [data.value.task.workerId, ...this.teamWorkers(data.value.task.teamId)].map(id => ({ kind: 'worker', id }));
    else if (data.kind === 'source') {
      const owners = this.store.db.prepare("SELECT data FROM tasks WHERE EXISTS (SELECT 1 FROM json_each(json_extract(tasks.data,'$.sourceIds')) WHERE value=?)")
        .all(data.value.id).map(row => JSON.parse(String(row.data)) as Task);
      const surviving = owners.filter(task => !task.deletedAt && !this.roots('task', task.id).some(root => this.visibility(root).deleted));
      const publicOwners = surviving.filter(task => !this.isLocalOnly('task', task.id));
      const suppliedOwner = supplied && publicOwners.find(task => supplied.some(scope => scope.kind === 'task' && scope.id === task.id));
      const owner = suppliedOwner ?? publicOwners[0] ?? surviving[0] ?? owners[0];
      if (owner) roots = this.roots('task', owner.id);
    } else if (data.kind === 'run') roots = this.runRoots({ taskId: data.value.taskId, snapshot: {
      worker: { ...data.value.worker.value, revision: 1 }, skill: { ...data.value.skill.value, revision: 1 },
      team: data.value.team && { ...data.value.team.value, revision: 1 } } });
    else if (data.kind === 'artifact' || data.kind === 'event') {
      const row = this.store.db.prepare('SELECT data FROM runs WHERE id=?').get(data.value.runId);
      if (row) roots = this.runRoots(JSON.parse(String(row.data)) as Run);
    }
    return [...new Map(roots.map(root => [`${root.kind}:${root.id}`, root])).values()]
      .map(root => ({ ...root, epoch: this.visibility(root).epoch }));
  }
  private permanentlyBlocked(data: SyncData, scopes: readonly SyncRoot[] = []): boolean {
    if (data.kind === 'delete' || data.kind === 'withdraw' || data.kind === 'entityState' && data.value?.deletedAt) return false;
    if (this.store.db.prepare("SELECT entity_id FROM sync_deletions WHERE kind='record' AND entity_id=?").get(syncRecordKey(data))) return true;
    const entity = data.kind === 'revision' ? { kind: data.revision.entity, id: data.revision.value.id }
      : data.kind === 'source' || data.kind === 'routine' ? { kind: data.kind, id: data.value.id }
      : data.kind === 'entityState' ? { kind: data.entity, id: data.id } : undefined;
    if (entity && this.store.db.prepare('SELECT entity_id FROM sync_deletions WHERE kind=? AND entity_id=?').get(entity.kind, entity.id)) return true;
    if (data.kind === 'artifact' && data.value.usedMemories?.some(memory =>
      this.store.db.prepare("SELECT entity_id FROM sync_deletions WHERE kind='knowledge' AND entity_id=?").get(memory.id))) return true;
    if (data.kind === 'run' && [data.value.worker, data.value.skill, data.value.team].some(revision => revision &&
      this.store.db.prepare('SELECT entity_id FROM sync_deletions WHERE kind=? AND entity_id=?').get(revision.entity, revision.value.id))) return true;
    return [...scopes, ...this.scopes(data)].some(root => Boolean(this.visibility(root).deleted));
  }
  /** Erase replicated copies; canonical paid/cited history keeps its own retention policy. */
  private purgePermanentPayloads() {
    for (const table of ['sync_records', 'sync_outbox', 'sync_inbox']) {
      for (const row of this.store.db.prepare(`SELECT rowid,data FROM ${table}`).all()) {
        const raw: unknown = JSON.parse(String(row.data));
        const parsed = SyncRecord.safeParse(raw);
        const futureScopes = z.object({ scopes: z.array(SyncRoot.strip()).optional() }).safeParse(raw);
        const blocked = parsed.success ? this.permanentlyBlocked(parsed.data.data, parsed.data.scopes)
          : futureScopes.success && futureScopes.data.scopes?.some(root => Boolean(this.visibility(root).deleted));
        if (!blocked) continue;
        if (parsed.success && ['chat', 'turn', 'chatField', 'reaction', 'quote', 'run', 'artifact', 'event'].includes(parsed.data.data.kind)) {
          // An identity fence prevents missing dependencies or stripped scopes from reviving erased history.
          this.store.db.prepare("INSERT OR IGNORE INTO sync_deletions VALUES('record',?)").run(syncRecordKey(parsed.data.data));
        }
        this.store.db.prepare(`DELETE FROM ${table} WHERE rowid=?`).run(Number(row.rowid));
      }
    }
  }
  private eligible(record: SyncRecord): boolean {
    if (record.data.kind === 'withdraw') {
      return !this.visibility(record.data.root).deleted || record.data.deleted;
    }
    if (this.permanentlyBlocked(record.data, record.scopes)) return false;
    const data = record.data;
    const deletedEntity = data.kind === 'revision' && data.revision.entity !== 'worker' ? { entity: data.revision.entity, id: data.revision.value.id }
      : data.kind === 'source' || data.kind === 'routine' ? { entity: data.kind, id: data.value.id } : undefined;
    if (deletedEntity && this.store.db.prepare('SELECT entity_id FROM sync_deletions WHERE kind=? AND entity_id=?').get(deletedEntity.entity, deletedEntity.id)) return false;
    if (this.scopes(record.data, record.scopes).some(required => !record.scopes.some(scope => scope.kind === required.kind && scope.id === required.id))) return false;
    return record.scopes.every(scope => {
      const policy = this.visibility(scope);
      return !policy.local_only && !policy.deleted && policy.epoch === scope.epoch;
    });
  }
  private enqueue(record: SyncRecord) {
    if (!this.context || !this.eligible(record)) return;
    this.store.db.prepare('INSERT OR IGNORE INTO sync_outbox(account_key,record_id,data) VALUES(?,?,?)')
      .run(this.context.accountKey, record.id, JSON.stringify(record));
  }
  private record(raw: SyncData) {
    const data = SyncData.parse(raw);
    if (this.permanentlyBlocked(data)) return;
    const key = syncRecordKey(data);
    const previous = this.store.db.prepare('SELECT data FROM sync_records WHERE record_key=?').get(key);
    const prior = previous && SyncRecord.parse(JSON.parse(String(previous.data)));
    const teamScope = data.kind === 'revision' && data.revision.entity === 'knowledge' && data.revision.value.scope.type === 'team'
      || data.kind === 'entityState' && data.entity === 'team';
    const scopes = this.scopes(data);
    const scopeUpgrade = prior && teamScope && canonicalJson(prior.scopes) !== canonicalJson(scopes);
    const rosterUpgrade = prior?.data.kind === 'chat' && data.kind === 'chat' && prior.data.value.participants === undefined;
    if (this.backfilling && prior && !scopeUpgrade && !rosterUpgrade) return;
    if (prior && canonicalJson(prior.data) === canonicalJson(data) && !scopeUpgrade) return;
    const clock = this.revisions.clock.tick();
    const record = SyncRecord.parse({ schemaVersion: 1, id: randomUUID(), origin: clock.deviceId, clock, scopes, data });
    this.store.db.prepare('INSERT INTO sync_records VALUES(?,?) ON CONFLICT(record_key) DO UPDATE SET data=excluded.data').run(key, JSON.stringify(record));
    this.enqueue(record);
  }
  /** Canonical writers call within their owning transaction; incoming writes never echo. */
  captureRevision(entity: SyncRevision['entity'], value: unknown, alias: number) {
    if (this.importing) return;
    this.record({ kind: 'revision', revision: this.revisions.capture(entity, value, alias) });
    if (entity === 'team' && !this.backfilling) {
      this.refreshScopes();
      this.purgeBlockedOutbox();
    }
  }
  prepareWrite<T extends { id: string }>(table: string, value: T): T {
    if (table === 'runs' && !this.importing) {
      const run = z.object({ id: Id, taskId: Id, startedAt: z.iso.datetime(), snapshot: z.object({ inputRevision: z.number().int().nonnegative().optional(),
        turnId: Id.optional(), input: RunInput.optional() }).passthrough(), originDeviceId: Id.optional() }).parse(value);
      const alias = run.snapshot.inputRevision ?? 0;
      let saved = this.turns.list(run.taskId).find(turn => turn.localRevision === alias);
      if (!saved && run.snapshot.input) saved = this.turns.save({ id: run.snapshot.turnId ?? turnMessageId(run.taskId, alias), taskId: run.taskId,
        createdAt: this.turns.nextCreatedAt(run.taskId, Date.parse(run.startedAt)), input: SyncTurn.shape.input.strip().parse(run.snapshot.input) }, alias);
      if (saved) this.record({ kind: 'turn', value: SyncTurn.strip().parse(saved) });
      return { ...value, originDeviceId: run.originDeviceId ?? this.revisions.clock.read().deviceId, snapshot: { ...run.snapshot, turnId: saved?.id ?? run.snapshot.turnId } };
    }
    if (table !== 'tasks' || this.importing) return value;
    const task = TaskInput.strip().parse(value);
    const alias = task.inputRevision ?? 0;
    const savedTurns = this.turns.list(task.id);
    const existing = savedTurns.find(turn => turn.localRevision === alias);
    const input = existing?.input ?? task.currentInput ?? (alias === 0 ? task : undefined);
    if (!input) return value;
    const requestedOwner = task.currentTurnId && this.store.db.prepare('SELECT task_id FROM chat_turns WHERE id=?').get(task.currentTurnId);
    const requestedId = task.currentTurnId && (!requestedOwner || requestedOwner.task_id === task.id)
      && !savedTurns.some(turn => turn.id === task.currentTurnId && turn.localRevision !== alias)
      ? task.currentTurnId : undefined;
    const turn = this.turns.save({ id: existing?.id ?? requestedId ?? (alias === 0 ? task.id : randomUUID()), taskId: task.id,
      createdAt: existing?.createdAt ?? task.currentTurnCreatedAt ?? (alias === 0 ? task.createdAt : this.turns.nextCreatedAt(task.id)),
      input: SyncTurn.shape.input.strip().parse(input) }, alias);
    const turnIds = Object.fromEntries(this.turns.list(task.id).map(saved => [saved.localRevision, saved.id]));
    return { ...value, currentTurnId: turn.id, turnIds };
  }
  captureWrite(table: string, value: unknown, previous?: unknown) {
    if (this.importing) return;
    if (table === 'workers') {
      const worker = value as Worker;
      const before = previous as Worker | undefined;
      if (!this.backfilling && worker.skillId !== before?.skillId) this.refreshSkillScopes(new Set([worker.skillId, ...(before ? [before.skillId] : [])]));
      if (!this.backfilling && !before) {
        for (const task of this.store.all<Task>('tasks').filter(task => task.assignees === 'all' && !task.deletedAt)) {
          this.captureWrite('tasks', task);
          this.refreshScopes(task.id);
        }
        this.purgeBlockedOutbox();
      }
      return;
    }
    if (table === 'sources') {
      const source = SyncSource.strip().safeParse(value);
      if (source.success && this.store.db.prepare("SELECT id FROM tasks WHERE EXISTS (SELECT 1 FROM json_each(json_extract(tasks.data,'$.sourceIds')) WHERE value=?) LIMIT 1").get(source.data.id)) {
        this.record({ kind: 'source', value: source.data });
      }
      return;
    }
    if (table === 'routines') {
      const routine = Routine.parse(value);
      this.record({ kind: 'routine', value: SyncRoutine.parse({ id: routine.id, name: routine.name, schedule: routine.schedule, enabled: routine.enabled,
        trigger: routine.trigger?.kind ?? 'schedule', task: SyncRoutine.shape.task.strip().parse(routine.task) }) });
      return;
    }
    if (table === 'runs') {
      const run = z.object({ id: Id }).parse(value);
      this.captureRun(this.store.get<Run>('runs', run.id));
      return;
    }
    if (table === 'artifacts') {
      const artifact = z.object({ id: Id }).parse(value);
      const stored = this.store.get<Artifact>('artifacts', artifact.id);
      const run = this.store.get<Run>('runs', stored.runId);
      if (run.originDeviceId && run.originDeviceId !== this.revisions.clock.read().deviceId) return;
      this.captureRun(run);
      if (!SyncRun.shape.status.safeParse(run.status).success) return;
      this.record({ kind: 'artifact', value: SyncArtifact.parse({ ...stored, usedMemories: stored.usedMemories?.map(memory => ({ id: memory.id,
        revisionId: memory.syncRevisionId ?? (!memory.unavailable ? this.store.db.prepare("SELECT revision_id FROM sync_revision_ids WHERE kind='knowledge' AND entity_id=? AND local_revision=?").get(memory.id, memory.revision)?.revision_id : undefined),
        legacyRevision: memory.revision, text: memory.text })) }) });
      return;
    }
    if (table === 'events') {
      const event = z.object({ id: Id }).parse(value);
      this.captureEvent(this.store.get<Activity>('events', event.id));
      return;
    }
    if (table !== 'tasks') return;
    const task = TaskInput.strip().parse(value);
    const before = previous ? TaskInput.strip().parse(previous) : undefined;
    const chat = LocalChat.strip().parse(task);
    const priorChat = before ? LocalChat.strip().parse(before) : undefined;
    if (before && canonicalJson(chat) !== canonicalJson(priorChat)
      && [...this.participantIds(task), ...this.participantIds(before)].some(id => this.isLocalOnly('worker', id))) {
      // Changing who owns a private chat cannot silently reopen its earlier server copy.
      if (!this.visibility({ kind: 'task', id: task.id }).local_only) this.withdraw({ kind: 'task', id: task.id }, true, false);
    }
    if (!before || canonicalJson(chat) !== canonicalJson(priorChat)) {
      const anchor = task.sideOf && this.turns.list(task.sideOf.taskId).find(turn => turn.localRevision === task.sideOf!.throughRevision);
      // Missing legacy context stays local instead of attaching the thread to another device's numeric alias.
      if (!task.sideOf || anchor) this.record({ kind: 'chat', value: SyncChat.parse({ ...chat,
        assignees: task.assignees === 'all' ? this.participantIds(task) : task.assignees, participants: this.participantIds(task),
        sideOf: task.sideOf && anchor ? { taskId: task.sideOf.taskId, throughTurnId: anchor.id } : undefined }) });
    }
    if (!this.backfilling && before
      && canonicalJson(this.participantIds(task).sort()) !== canonicalJson(this.participantIds(before).sort())) this.refreshScopes(task.id);
    for (const sourceId of task.sourceIds) {
      const row = this.store.db.prepare('SELECT data FROM sources WHERE id=?').get(sourceId);
      if (row) this.captureWrite('sources', JSON.parse(String(row.data)));
    }
    this.purgeBlockedOutbox();
    const turn = this.turns.list(task.id).find(saved => saved.localRevision === (task.inputRevision ?? 0));
    if (turn) this.record({ kind: 'turn', value: SyncTurn.strip().parse(turn) });
    for (const field of ['title', 'archivedAt', 'channel'] as const) {
      if (canonicalJson(task[field] ?? null) !== canonicalJson(before?.[field] ?? null)) {
        this.record(SyncData.parse({ kind: 'chatField', taskId: task.id, change: { field, value: task[field] ?? null } }));
      }
    }
    const reactionKey = (reaction: MessageReaction) => `${reaction.messageId}:${reaction.actor}:${reaction.workerId ?? ''}:${reaction.emoji}`;
    for (const reaction of task.messageReactions ?? []) {
      if (!(before?.messageReactions ?? []).some(old => canonicalJson(old) === canonicalJson(reaction))) {
        this.record({ kind: 'reaction', taskId: task.id, value: MessageReaction.omit({ callId: true }).strip().parse(reaction), deleted: false });
      }
    }
    for (const reaction of before?.messageReactions ?? []) {
      if (!(task.messageReactions ?? []).some(current => reactionKey(current) === reactionKey(reaction))) {
        this.record({ kind: 'reaction', taskId: task.id, value: MessageReaction.omit({ callId: true }).strip().parse(reaction), deleted: true });
      }
    }
    for (const quote of task.quotes ?? []) {
      if (!(before?.quotes ?? []).some(old => old.id === quote.id)) this.captureQuote(task.id, quote, false);
    }
    for (const quote of before?.quotes ?? []) {
      if (!(task.quotes ?? []).some(current => current.id === quote.id)) this.captureQuote(task.id, quote, true);
    }
  }
  private captureQuote(taskId: string, quote: ChatQuote, deleted: boolean) {
    const anchor = this.turns.list(taskId).find(turn => turn.localRevision === quote.afterRevision);
    if (!anchor) return;
    const { afterRevision: _alias, ...value } = quote;
    this.record({ kind: 'quote', taskId, value: { ...value, afterTurnId: anchor.id }, deleted });
  }
  captureSetting(key: string, value: unknown, previous: unknown) {
    if (this.importing) return;
    if (['theme', 'language', 'sidebarOrder'].includes(key)) {
      this.record(SyncData.parse({ kind: 'setting', change: { key, value: value ?? null } }));
    } else if (key === 'customConnections') {
      for (const connection of z.array(CustomConnection).parse(value ?? [])) this.record({ kind: 'connectionName', id: connection.id, name: connection.name });
    } else if (key === 'taskTitles') {
      const titles = z.record(Id, z.string().max(200)).parse(value ?? {});
      const before = z.record(Id, z.string().max(200)).parse(previous ?? {});
      for (const taskId of new Set([...Object.keys(titles), ...Object.keys(before)])) {
        if (titles[taskId] !== before[taskId]) this.record({ kind: 'chatField', taskId, change: { field: 'title', value: titles[taskId] ?? null } });
      }
    } else if (key === 'marketOrigins') {
      const origins = MarketOrigins.parse(value ?? []);
      const before = MarketOrigins.parse(previous ?? []);
      for (const origin of origins) this.record({ kind: 'origin', value: origin, deleted: false });
      for (const origin of before) {
        if (!origins.some(current => current.entityId === origin.entityId)) this.record({ kind: 'origin', value: origin, deleted: true });
      }
    } else if (key === 'emptyChannels') {
      const channels = z.array(EmptyChannel).parse(value ?? []);
      const before = z.array(EmptyChannel).parse(previous ?? []);
      for (const channel of channels) this.record({ kind: 'channel', value: channel, deleted: false });
      for (const channel of before) {
        if (!channels.some(current => current.id === channel.id)) this.record({ kind: 'channel', value: channel, deleted: true });
      }
    } else if (key === 'entityState') {
      const State = z.object({ workers: z.record(Id, z.object({ archivedAt: z.string().optional(), deletedAt: z.string().optional() })),
        teams: z.record(Id, z.object({ archivedAt: z.string().optional(), deletedAt: z.string().optional() })) });
      const current = State.parse(value);
      const before = State.parse(previous ?? { workers: {}, teams: {} });
      for (const [entity, group] of [['worker', 'workers'], ['team', 'teams']] as const) {
        for (const id of new Set([...Object.keys(current[group]), ...Object.keys(before[group])])) {
          if (canonicalJson(current[group][id] ?? null) === canonicalJson(before[group][id] ?? null)) continue;
          this.record(SyncData.parse({ kind: 'entityState', entity, id, value: current[group][id] ?? null }));
          if (entity === 'worker' && current[group][id]?.deletedAt) this.withdraw({ kind: 'worker', id }, false, true);
          if (entity === 'team' && current[group][id]?.deletedAt) this.deleteEntity('team', id);
        }
      }
    }
  }
  private withdraw(root: SyncRoot, localOnly: boolean, deleted: boolean, deferPurges = false) {
    const previous = this.visibility(root);
    if (previous.deleted && !deleted) throw new Error('Mục đã xóa không thể bật đồng bộ lại.');
    const epoch = randomUUID();
    const clock = this.revisions.clock.tick();
    this.store.db.prepare('INSERT INTO sync_visibility VALUES(?,?,?,?,?,?) ON CONFLICT(kind,entity_id) DO UPDATE SET epoch=excluded.epoch,local_only=excluded.local_only,deleted=excluded.deleted,clock_json=excluded.clock_json')
      .run(root.kind, root.id, epoch, Number(localOnly), Number(deleted), JSON.stringify(clock));
    const record = SyncRecord.parse({ schemaVersion: 1, id: randomUUID(), origin: clock.deviceId, clock, scopes: [],
      data: { kind: 'withdraw', root, epoch, localOnly, deleted } });
    this.store.db.prepare('INSERT INTO sync_records VALUES(?,?) ON CONFLICT(record_key) DO UPDATE SET data=excluded.data').run(syncRecordKey(record.data), JSON.stringify(record));
    if (!deferPurges) {
      if (deleted) this.refreshScopes(undefined, true);
      if (deleted && root.kind === 'worker') this.refreshSkillScopes(new Set(this.store.all<Skill>('skills').map(skill => skill.id)));
      if (deleted) this.purgePermanentPayloads();
      this.purgeBlockedOutbox();
    }
    this.enqueue(record);
  }
  setLocalOnly(raw: z.infer<typeof SetSyncLocalOnly>) {
    const input = SetSyncLocalOnly.parse(raw);
    this.store.get(input.kind === 'worker' ? 'workers' : 'tasks', input.id);
    this.store.transaction(() => {
      const visibility = this.visibility(input);
      if (visibility.deleted) {
        const recovered = input.kind === 'task' ? !this.store.get<Task>('tasks', input.id).deletedAt
          : !this.store.entityState().workers[input.id]?.deletedAt;
        if (input.localOnly && recovered) return;
        throw new Error('Mục đã xóa không thể bật đồng bộ lại.');
      }
      if (Boolean(visibility.local_only) === input.localOnly) return;
      this.withdraw({ kind: input.kind, id: input.id }, input.localOnly, false);
      this.refreshScopes();
    });
  }
  deleteChat(taskId: string) {
    if (!this.importing) this.store.transaction(() => this.withdraw({ kind: 'task', id: Id.parse(taskId) }, false, true));
  }
  /** Public deletion identities survive backup; private receipt fences and scope epochs stay on this device. */
  permanentDeletions(): z.infer<typeof PermanentDeletion>[] {
    return this.store.db.prepare(`SELECT kind,entity_id AS id FROM sync_deletions
      WHERE kind IN ('knowledge','team','skill','source','routine')
      UNION SELECT kind,entity_id AS id FROM sync_visibility WHERE deleted=1
      ORDER BY kind,id`).all().map(row => PermanentDeletion.parse(row));
  }
  restorePermanentDeletions(raw: z.infer<typeof PermanentDeletion>[]) {
    const deletions = z.array(PermanentDeletion).max(100_000).parse(raw);
    this.store.transaction(() => {
      for (const deletion of deletions) {
        if (deletion.kind === 'worker' || deletion.kind === 'task') {
          const root = { kind: deletion.kind, id: deletion.id };
          const policy = this.visibility(root);
          if (!policy.deleted) this.withdraw(root, Boolean(policy.local_only), true, true);
        } else {
          const existing = this.store.db.prepare('SELECT entity_id FROM sync_deletions WHERE kind=? AND entity_id=?').get(deletion.kind, deletion.id);
          if (!existing) this.deleteEntity(deletion.kind, deletion.id, true);
          if (deletion.kind === 'source' && this.exists('sources', deletion.id)) this.deletedSourcePlaceholder(deletion.id);
        }
      }
      this.refreshScopes(undefined, true);
      this.refreshSkillScopes(new Set(this.store.all<Skill>('skills').map(skill => skill.id)));
      this.purgePermanentPayloads();
      this.purgeBlockedOutbox();
    });
  }
  discardFactorySeed(workerId: string, skillId: string) {
    this.store.transaction(() => {
      this.withdraw({ kind: 'worker', id: Id.parse(workerId) }, false, true);
      this.deleteEntity('skill', skillId);
    });
  }
  deleteEntity(entity: 'knowledge' | 'team' | 'skill' | 'source' | 'routine', id: string, deferPurges = false) {
    if (this.importing) return;
    this.store.transaction(() => {
      this.store.db.prepare('INSERT OR IGNORE INTO sync_deletions VALUES(?,?)').run(entity, Id.parse(id));
      this.record({ kind: 'delete', entity, id });
      if (!deferPurges) {
        this.purgePermanentPayloads();
        this.purgeBlockedOutbox();
      }
    });
  }
  private captureRun(run: Run) {
    if (run.originDeviceId && run.originDeviceId !== this.revisions.clock.read().deviceId) return;
    if (!SyncRun.shape.status.safeParse(run.status).success) return;
    // Incomplete legacy rows remain visible locally; they cannot establish a frozen public history.
    if (!run.snapshot.worker || !run.snapshot.skill) return;
    if (this.runRoots(run).some(root => this.visibility(root).deleted || this.visibility(root).local_only)) return;
    const turn = this.turns.list(run.taskId).find(turn => turn.localRevision === (run.snapshot.inputRevision ?? 0));
    if (!turn) return;
    const key = `run:${run.id}`;
    if (this.store.db.prepare('SELECT record_key FROM sync_records WHERE record_key=?').get(key)) return;
    const value = SyncRun.parse({ id: run.id, taskId: run.taskId, turnId: turn.id, stage: run.stage, status: run.status, startedAt: run.startedAt,
      worker: this.revisions.frozen('worker', run.snapshot.worker),
      skill: this.revisions.frozen('skill', run.snapshot.skill),
      team: run.snapshot.team ? this.revisions.frozen('team', run.snapshot.team) : undefined,
      errorCode: run.errorCode, outOfSteps: run.outOfSteps });
    this.record({ kind: 'revision', revision: value.worker });
    this.record({ kind: 'revision', revision: value.skill });
    if (value.team) this.record({ kind: 'revision', revision: value.team });
    this.record({ kind: 'run', value });
    for (const row of this.store.db.prepare('SELECT data FROM events WHERE run_id=? ORDER BY rowid').all(run.id)) this.captureEvent(JSON.parse(String(row.data)) as Activity);
    for (const row of this.store.db.prepare('SELECT data FROM artifacts WHERE run_id=? ORDER BY rowid').all(run.id)) this.captureWrite('artifacts', JSON.parse(String(row.data)));
  }
  private captureEvent(event: Activity) {
    if (!event.teamMessage) return;
    const run = this.store.get<Run>('runs', event.runId);
    if (run.originDeviceId && run.originDeviceId !== this.revisions.clock.read().deviceId) return;
    if (!SyncRun.shape.status.safeParse(run.status).success) return;
    const value = { id: event.id, runId: event.runId, sequence: event.sequence, createdAt: event.createdAt,
      teamMessage: TeamMessage.omit({ callId: true, requestHash: true }).strip().parse(event.teamMessage) };
    this.record({ kind: 'event', versionId: stableUuid(`orglet-sync-event:${canonicalJson(value)}`), value });
  }
  private purgeBlockedOutbox(force = false) {
    if (this.backfilling && !force) return;
    for (const row of this.store.db.prepare('SELECT sequence,data FROM sync_outbox').all()) {
      if (!this.eligible(SyncRecord.parse(JSON.parse(String(row.data))))) this.store.db.prepare('DELETE FROM sync_outbox WHERE sequence=?').run(Number(row.sequence));
    }
  }
  private refreshScopes(taskId?: string, sourcesOnly = false) {
    for (const row of this.store.db.prepare('SELECT record_key,data FROM sync_records').all()) {
      const previous = SyncRecord.parse(JSON.parse(String(row.data)));
      if (previous.data.kind === 'withdraw' || previous.data.kind === 'delete') continue;
      if (sourcesOnly && previous.data.kind !== 'source') continue;
      if (taskId && !previous.scopes.some(scope => scope.kind === 'task' && scope.id === taskId)) continue;
      const scopes = this.scopes(previous.data);
      if (canonicalJson(previous.scopes) === canonicalJson(scopes)) continue;
      const clock = this.revisions.clock.tick();
      const current = SyncRecord.parse({ ...previous, id: randomUUID(), origin: clock.deviceId, clock, scopes });
      this.store.db.prepare('UPDATE sync_records SET data=? WHERE record_key=?').run(JSON.stringify(current), String(row.record_key));
      this.enqueue(current);
    }
  }
  private refreshSkillScopes(skillIds: Set<string>) {
    let changed = false;
    for (const row of this.store.db.prepare(`SELECT record_key,data FROM sync_records
      WHERE json_extract(data,'$.data.kind')='revision' AND json_extract(data,'$.data.revision.entity')='skill'`).all()) {
      const previous = SyncRecord.parse(JSON.parse(String(row.data)));
      if (previous.data.kind !== 'revision' || !skillIds.has(previous.data.revision.value.id)
        || !this.skillOwners(previous.data.revision.value.id).length) continue;
      const scopes = this.scopes(previous.data);
      if (canonicalJson(previous.scopes) === canonicalJson(scopes)) continue;
      const clock = this.revisions.clock.tick();
      const current = SyncRecord.parse({ ...previous, id: randomUUID(), origin: clock.deviceId, clock, scopes });
      this.store.db.prepare('UPDATE sync_records SET data=? WHERE record_key=?').run(JSON.stringify(current), String(row.record_key));
      this.enqueue(current);
      changed = true;
    }
    if (changed) this.purgeBlockedOutbox();
  }
  /** Explicit bootstrap only; signing in alone must not silently merge an unrelated local profile. */
  snapshot(context: SyncRecordingContext): SyncRecord[] {
    this.assertContext(context);
    this.assertCompatible(context);
    return this.store.db.prepare('SELECT data FROM sync_records ORDER BY record_key').all()
      .map(row => SyncRecord.parse(JSON.parse(String(row.data)))).filter(record => this.eligible(record));
  }
  outbox(context: SyncRecordingContext, limit = 100): { sequence: number; record: SyncRecord }[] {
    const checked = this.assertContext(context);
    this.assertCompatible(context);
    z.number().int().min(1).max(100).parse(limit);
    this.store.transaction(() => this.purgeBlockedOutbox());
    // The server checks each record against what it already holds plus the rest of the batch, so whatever a record
    // depends on goes first: an orglet before its skill, a chat before its turns, a run before its answer.
    return this.store.db.prepare(`SELECT sequence,data FROM sync_outbox WHERE account_key=? AND length(CAST(data AS BLOB))<=?
      ORDER BY CASE json_extract(data,'$.data.kind')
        WHEN 'withdraw' THEN 0 WHEN 'delete' THEN 0
        WHEN 'revision' THEN CASE json_extract(data,'$.data.revision.entity') WHEN 'worker' THEN 1 WHEN 'skill' THEN 2 WHEN 'team' THEN 3 ELSE 9 END
        WHEN 'entityState' THEN 4 WHEN 'chat' THEN 5 WHEN 'turn' THEN 6 WHEN 'source' THEN 7
        WHEN 'run' THEN 10 WHEN 'artifact' THEN 11 WHEN 'event' THEN 11 ELSE 8 END,
        CASE json_extract(data,'$.data.kind') WHEN 'chat' THEN json_extract(data,'$.data.value.createdAt') ELSE '' END,
        sequence LIMIT ?`).all(checked.accountKey, SYNC_RECORD_BYTES, limit)
      .map(row => ({ sequence: Number(row.sequence), record: SyncRecord.parse(JSON.parse(String(row.data))) }));
  }
  /** Queued changes the server would refuse for their size; they stay on this computer. */
  oversized(context: SyncRecordingContext): number {
    const checked = this.assertContext(context);
    return Number(this.store.db.prepare('SELECT COUNT(*) AS count FROM sync_outbox WHERE account_key=? AND length(CAST(data AS BLOB))>?')
      .get(checked.accountKey, SYNC_RECORD_BYTES)!.count);
  }
  /** Whether a newer Orglet left data here that this build cannot read; sending waits for an update. */
  hasFutureRecords(context: SyncRecordingContext): boolean {
    const checked = this.assertContext(context);
    return Boolean(this.store.db.prepare("SELECT record_id FROM sync_inbox WHERE account_key=? AND status='future' LIMIT 1").get(checked.accountKey));
  }
  /** After the account was downloaded: queue every public record whose current envelope the server does not hold. */
  requeue(context: SyncRecordingContext, confirmed: ReadonlyMap<string, string>) {
    this.assertContext(context);
    this.store.transaction(() => {
      for (const row of this.store.db.prepare('SELECT record_key,data FROM sync_records').all()) {
        const record = SyncRecord.parse(JSON.parse(String(row.data)));
        if (confirmed.get(String(row.record_key)) !== record.id) this.enqueue(record);
      }
    });
  }
  deviceId(): string {
    return this.revisions.clock.read().deviceId;
  }
  acknowledge(context: SyncRecordingContext, ids: readonly string[]) {
    const checked = this.assertContext(context);
    const parsed = z.array(Id).max(100).parse(ids);
    this.store.transaction(() => {
      for (const id of parsed) this.store.db.prepare('DELETE FROM sync_outbox WHERE account_key=? AND record_id=?').run(checked.accountKey, id);
    });
  }
  private exists(table: string, id: string): boolean {
    return Boolean(this.store.db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id));
  }
  private assertCompatible(context: SyncRecordingContext) {
    if (this.store.db.prepare("SELECT record_id FROM sync_inbox WHERE account_key=? AND status='future' LIMIT 1").get(context.accountKey)) {
      throw new Error('Có dữ liệu từ phiên bản Orglet mới hơn. Cập nhật app để tiếp tục đồng bộ.');
    }
  }
  private dependencies(data: SyncData): boolean {
    if (data.kind === 'revision') {
      const revision = data.revision;
      if (revision.entity === 'worker') return this.exists('skills', revision.value.skillId);
      if (revision.entity === 'team') return [...revision.value.memberIds, revision.value.synthesizerId].every(id => this.exists('workers', id));
      if (revision.entity === 'knowledge') return revision.value.scope.type === 'workspace' || this.exists(revision.value.scope.type === 'worker' ? 'workers' : 'teams', revision.value.scope.id);
    }
    if (data.kind === 'chat') {
      const row = this.store.db.prepare('SELECT data FROM tasks WHERE id=?').get(data.value.id);
      const task = row ? JSON.parse(String(row.data)) as Task : undefined;
      if (task && ['queued', 'running', 'pausing', 'paused', 'waiting_budget', 'waiting_input'].includes(task.status)) return false;
      return this.exists('workers', data.value.workerId) && (!data.value.teamId || this.exists('teams', data.value.teamId))
        && (!data.value.sideOf || this.turns.list(data.value.sideOf.taskId).some(turn => turn.id === data.value.sideOf!.throughTurnId));
    }
    if (data.kind === 'turn') return this.exists('tasks', data.value.taskId) && data.value.input.sourceIds.every(id => this.exists('sources', id)
      || Boolean(this.store.db.prepare("SELECT entity_id FROM sync_deletions WHERE kind='source' AND entity_id=?").get(id)));
    if (data.kind === 'quote') return this.turns.list(data.taskId).some(turn => turn.id === data.value.afterTurnId);
    if (data.kind === 'chatField' || data.kind === 'reaction') return this.exists('tasks', data.taskId);
    if (data.kind === 'origin') return this.exists(data.value.kind === 'orglet' ? 'workers' : 'teams', data.value.entityId);
    if (data.kind === 'routine') return this.exists('workers', data.value.task.workerId) && (!data.value.task.teamId || this.exists('teams', data.value.task.teamId));
    if (data.kind === 'source' && data.value.editedFrom) return this.exists('sources', data.value.editedFrom);
    if (data.kind === 'run') return this.exists('tasks', data.value.taskId) && this.exists('chat_turns', data.value.turnId)
      && this.exists('skills', data.value.worker.value.skillId);
    if (data.kind === 'artifact' || data.kind === 'event') return this.exists('runs', data.value.runId);
    return true;
  }
  private apply(record: SyncRecord) {
    const data = record.data;
    if (data.kind === 'revision') {
      this.revisions.receive(data.revision);
      if (data.revision.entity === 'knowledge') this.resolveMemoryReferences(data.revision.revisionId, data.revision.value.id);
    }
    else if (data.kind === 'chat') {
      const sideOf = data.value.sideOf ? { taskId: data.value.sideOf.taskId,
        throughRevision: this.turns.list(data.value.sideOf.taskId).find(turn => turn.id === data.value.sideOf!.throughTurnId)!.localRevision } : undefined;
      const { participants: _participants, ...publicChat } = data.value;
      const chat = { ...publicChat, sideOf };
      if (!this.exists('tasks', chat.id)) this.store.put('tasks', { ...chat, brief: '', sourceIds: [], status: 'completed', budgetMicros: 0, consent: false, accepted: false } satisfies Task);
      else {
        const task = this.store.get<Task>('tasks', data.value.id);
        if (task.createdAt !== data.value.createdAt) throw new Error('Định danh chat đã có thời điểm tạo khác.');
        const { teamId: _teamId, assignees: _assignees, teamSnapshot: _snapshot, ...kept } = task;
        this.store.update('tasks', { ...kept, ...chat,
          ...(task.teamId === chat.teamId && task.teamSnapshot ? { teamSnapshot: task.teamSnapshot } : {}),
          consent: false, providerScopes: [], toolCapabilities: [] });
      }
    } else if (data.kind === 'turn') {
      for (const id of data.value.input.sourceIds) {
        if (!this.exists('sources', id)) this.deletedSourcePlaceholder(id);
      }
      const turn = this.turns.save(data.value);
      const task = this.store.get<Task>('tasks', data.value.taskId);
      const saved = this.turns.list(task.id);
      const first = saved.slice().sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0];
      const turnIds = Object.fromEntries(saved.map(saved => [saved.localRevision, saved.id]));
      this.store.update('tasks', { ...task, brief: first.input.forwarded?.text ?? first.input.brief,
        turnIds, sourceIds: [...new Set([...task.sourceIds, ...turn.input.sourceIds])] });
      new ChatSearch(this.store).indexTurn(task.id, turn.localRevision, turn.input, turn.createdAt);
    } else if (data.kind === 'chatField') {
      const task = this.store.get<Task>('tasks', data.taskId);
      if (data.change.field === 'title') {
        const titles = this.store.setting<Record<string, string>>('taskTitles', {});
        if (data.change.value === null) delete titles[data.taskId];
        else titles[data.taskId] = data.change.value;
        this.store.setSetting('taskTitles', titles);
      }
      this.store.update('tasks', { ...task, [data.change.field]: data.change.value ?? undefined });
    } else if (data.kind === 'reaction') {
      const task = this.store.get<Task>('tasks', data.taskId);
      const key = syncRecordKey(data);
      const reactions = (task.messageReactions ?? []).filter(value => syncRecordKey({ ...data, value }) !== key);
      this.store.update('tasks', { ...task, messageReactions: data.deleted ? reactions : [...reactions, data.value] });
    } else if (data.kind === 'quote') {
      const task = this.store.get<Task>('tasks', data.taskId);
      const quotes = (task.quotes ?? []).filter(value => value.id !== data.value.id);
      const { afterTurnId, ...value } = data.value;
      const afterRevision = this.turns.list(task.id).find(turn => turn.id === afterTurnId)!.localRevision;
      this.store.update('tasks', { ...task, quotes: data.deleted ? quotes : [...quotes, { ...value, afterRevision }] });
    } else if (data.kind === 'setting') {
      if (data.change.value === null) this.store.clearSetting(data.change.key);
      else this.store.setSetting(data.change.key, data.change.value);
    } else if (data.kind === 'origin') {
      const origins = MarketOrigins.parse(this.store.setting('marketOrigins', [])).filter(origin => origin.entityId !== data.value.entityId);
      this.store.setSetting('marketOrigins', data.deleted ? origins : [...origins, data.value]);
    } else if (data.kind === 'channel') {
      const channels = z.array(EmptyChannel).parse(this.store.setting('emptyChannels', [])).filter(channel => channel.id !== data.value.id);
      this.store.setSetting('emptyChannels', data.deleted ? channels : [...channels, data.value]);
    } else if (data.kind === 'entityState') {
      const state = this.store.entityState();
      const group = data.entity === 'worker' ? state.workers : state.teams;
      if (data.value === null) delete group[data.id];
      else group[data.id] = data.value;
      this.store.setSetting('entityState', state);
    } else if (data.kind === 'source') {
      const row = this.store.db.prepare('SELECT data,path FROM sources WHERE id=?').get(data.value.id);
      if (!row) this.store.put('sources', { ...data.value, revoked: false, availability: 'other-device' }, { column: 'path', value: '' });
      else {
        const current = z.object({ hash: z.string().optional() }).passthrough().parse(JSON.parse(String(row.data)));
        if (current.hash !== data.value.hash) throw new Error('Nguồn đồng bộ đã có checksum khác.');
        this.store.update('sources', { ...current, ...data.value });
      }
    } else if (data.kind === 'routine') {
      const row = this.store.db.prepare('SELECT data FROM routines WHERE id=?').get(data.value.id);
      const current = row ? Routine.parse(JSON.parse(String(row.data))) : undefined;
      this.store.put('routines', Routine.parse({ id: data.value.id, name: data.value.name, schedule: data.value.schedule, enabled: false,
        trigger: data.value.trigger === 'folder' ? { kind: 'called' } : { kind: data.value.trigger },
        task: { ...data.value.task, consent: false }, revision: (current?.revision ?? 0) + 1, approvedConfig: '',
        nextDueAt: current?.nextDueAt ?? '9999-01-01T00:00:00.000Z', pending: null,
        notice: { at: new Date(Math.min(record.clock.wallMs, 253402300799000)).toISOString(), reason: 'Lịch nhận từ máy khác. Kiểm tra và bật lại trên máy này trước khi chạy.' } }));
    } else if (data.kind === 'connectionName') {
      const connections = z.array(CustomConnection).parse(this.store.setting('customConnections', []));
      this.store.setSetting('customConnections', connections.map(connection => connection.id === data.id ? { ...connection, name: data.name } : connection));
    } else if (data.kind === 'run') {
      if (this.exists('runs', data.value.id)) throw new Error('Lần chạy đã có dữ liệu trên máy này.');
      const workerAlias = this.revisions.receive(data.value.worker).localRevision;
      const skillAlias = this.revisions.receive(data.value.skill).localRevision;
      const teamAlias = data.value.team ? this.revisions.receive(data.value.team).localRevision : undefined;
      const turn = this.turns.list(data.value.taskId).find(turn => turn.id === data.value.turnId)!;
      const run: Run = { id: data.value.id, taskId: data.value.taskId, stage: data.value.stage, status: data.value.status, startedAt: data.value.startedAt,
        error: data.value.status === 'failed' || data.value.status === 'interrupted' ? 'Lần chạy trên máy khác cần xem lại.' : null,
        errorCode: data.value.errorCode, outOfSteps: data.value.outOfSteps, originDeviceId: record.origin,
        snapshot: { worker: { ...data.value.worker.value, revision: workerAlias }, skill: { ...data.value.skill.value, revision: skillAlias },
          team: data.value.team && teamAlias ? { ...data.value.team.value, revision: teamAlias } : undefined,
          turnId: turn.id, inputRevision: turn.localRevision, input: turn.input } };
      this.store.put('runs', run, { column: 'task_id', value: run.taskId });
      const task = this.store.get<Task>('tasks', run.taskId);
      if (run.snapshot.team && !task.teamSnapshot) this.store.update('tasks', { ...task, teamSnapshot: run.snapshot.team });
    } else if (data.kind === 'artifact') {
      const expectedHash = createHash('sha256').update(JSON.stringify(data.value.report)).digest('hex');
      if (expectedHash !== data.value.hash) throw new Error('Checksum của kết quả đồng bộ không khớp.');
      if (this.exists('artifacts', data.value.id)) throw new Error('Kết quả đã có dữ liệu trên máy này.');
      const artifact: Artifact = { ...data.value, usedMemories: data.value.usedMemories?.map(memory => {
        const alias = memory.revisionId ? this.store.db.prepare("SELECT local_revision FROM sync_revision_ids WHERE revision_id=? AND kind='knowledge' AND entity_id=?").get(memory.revisionId, memory.id) : undefined;
        return { id: memory.id, revision: alias ? Number(alias.local_revision) : memory.legacyRevision, text: memory.text,
          syncRevisionId: memory.revisionId, unavailable: !alias || undefined };
      }) };
      this.store.put('artifacts', artifact, { column: 'run_id', value: artifact.runId });
      const run = this.store.get<Run>('runs', artifact.runId);
      new ChatSearch(this.store).indexAnswer(artifact, run);
    } else if (data.kind === 'event') {
      const previous = this.store.db.prepare('SELECT data FROM events WHERE id=?').get(data.value.id);
      const run = this.store.get<Run>('runs', data.value.runId);
      if (previous && this.store.db.prepare('SELECT data FROM sync_records WHERE record_key LIKE ?').all('event:%')
        .some(row => { const candidate = SyncRecord.parse(JSON.parse(String(row.data))); return candidate.data.kind === 'event'
          && candidate.data.value.id === data.value.id && compareSyncClock(candidate.clock, record.clock) >= 0; })) return;
      const message = { ...data.value.teamMessage, inputRevision: run.snapshot.inputRevision ?? 0,
        callId: `sync:${data.value.id}`, requestHash: createHash('sha256').update(canonicalJson(data.value.teamMessage)).digest('hex') };
      this.store.put('events', { ...data.value, message: 'Tin nhắn giữa các orglet.', teamMessage: message }, { column: 'run_id', value: data.value.runId });
    } else if (data.kind === 'delete') {
      this.store.db.prepare('INSERT OR IGNORE INTO sync_deletions VALUES(?,?)').run(data.entity, data.id);
      if (data.entity === 'knowledge') {
        for (const table of ['knowledge_search', 'knowledge_revisions', 'knowledge']) this.store.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(data.id);
      }
      if (data.entity === 'routine') this.store.db.prepare('DELETE FROM routines WHERE id=?').run(data.id);
      if (data.entity === 'source') this.deletedSourcePlaceholder(data.id);
      this.purgePermanentPayloads();
      this.purgeBlockedOutbox();
    } else if (data.kind === 'withdraw') {
      this.store.db.prepare('INSERT INTO sync_visibility VALUES(?,?,?,?,?,?) ON CONFLICT(kind,entity_id) DO UPDATE SET epoch=excluded.epoch,local_only=excluded.local_only,deleted=excluded.deleted,clock_json=excluded.clock_json')
        .run(data.root.kind, data.root.id, data.epoch, Number(data.localOnly), Number(data.deleted), JSON.stringify(record.clock));
      if (data.deleted && data.root.kind === 'task' && this.exists('tasks', data.root.id)) {
        const task = this.store.get<Task>('tasks', data.root.id);
        this.store.update('tasks', { ...task, deletedAt: new Date(Math.min(record.clock.wallMs, 253402300799000)).toISOString() });
        new ChatSearch(this.store).removeChat(task.id);
      }
      if (data.deleted && data.root.kind === 'worker') {
        const state = this.store.entityState();
        state.workers[data.root.id] = { ...state.workers[data.root.id],
          deletedAt: new Date(Math.min(record.clock.wallMs, 253402300799000)).toISOString() };
        this.store.setSetting('entityState', state);
      }
      if (data.deleted) this.purgePermanentPayloads();
      this.purgeBlockedOutbox();
    }
  }
  private deletedSourcePlaceholder(id: string) {
    this.store.put('sources', { id, name: 'Nguồn đã xóa', bytes: 0, hash: '0'.repeat(64), revoked: true, availability: 'other-device' },
      { column: 'path', value: '' });
    // put preserves an existing row's extra columns; deletion always clears the old local path too.
    this.store.db.prepare('UPDATE sources SET path=? WHERE id=?').run('', id);
  }
  private resolveMemoryReferences(revisionId: string, entityId: string) {
    const identity = this.store.db.prepare("SELECT local_revision FROM sync_revision_ids WHERE revision_id=? AND kind='knowledge' AND entity_id=?").get(revisionId, entityId);
    if (!identity) return;
    for (const row of this.store.db.prepare(`SELECT id,data FROM artifacts WHERE EXISTS
      (SELECT 1 FROM json_each(json_extract(artifacts.data,'$.usedMemories'))
        WHERE json_extract(value,'$.syncRevisionId')=? AND json_extract(value,'$.id')=?)`).all(revisionId, entityId)) {
      const artifact = JSON.parse(String(row.data)) as Artifact;
      const usedMemories = artifact.usedMemories?.map(memory => memory.syncRevisionId === revisionId && memory.id === entityId
        ? { ...memory, revision: Number(identity.local_revision), unavailable: undefined } : memory);
      // This is a derived local alias repair, not a new public artifact or permission grant.
      this.store.db.prepare('UPDATE artifacts SET data=? WHERE id=?').run(JSON.stringify({ ...artifact, usedMemories }), String(row.id));
    }
  }
  /** Receives only a trusted account batch. Unknown schemas remain staged without affecting canonical data. */
  receive(context: SyncRecordingContext, raw: unknown[]) {
    const checked = this.assertContext(context);
    z.array(z.unknown()).max(100).parse(raw);
    if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > 8_388_608) throw new Error('Thay đổi đồng bộ quá lớn.');
    this.store.transaction(() => {
      for (const input of raw) {
        if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 2_097_152) throw new Error('Thay đổi đồng bộ quá lớn.');
        const header = z.object({ id: Id, schemaVersion: z.number().int().positive() }).parse(input);
        const existing = this.store.db.prepare('SELECT data FROM sync_inbox WHERE account_key=? AND record_id=?').get(checked.accountKey, header.id);
        if (existing) {
          if (canonicalJson(JSON.parse(String(existing.data))) !== canonicalJson(input)) throw new Error('Thay đổi đồng bộ đã có nội dung khác.');
          continue;
        }
        if (header.schemaVersion === 1) {
          const record = SyncRecord.parse(input);
          if (this.permanentlyBlocked(record.data, record.scopes)) continue;
        }
        else if (header.schemaVersion < 1) throw new Error('Phiên bản đồng bộ không hợp lệ.');
        else {
          const scopes = z.object({ scopes: z.array(SyncRoot.strip()).optional() }).safeParse(input);
          if (scopes.success && scopes.data.scopes?.some(root => Boolean(this.visibility(root).deleted))) continue;
        }
        this.store.db.prepare('INSERT INTO sync_inbox VALUES(?,?,?,?)').run(checked.accountKey, header.id, JSON.stringify(input), header.schemaVersion === 1 ? 'pending' : 'future');
      }
      this.importing = true;
      try {
        let progressed = true;
        while (progressed) {
          progressed = false;
          const pending = this.store.db.prepare("SELECT record_id,data FROM sync_inbox WHERE account_key=? AND status='pending'").all(checked.accountKey);
          for (const row of pending) {
            const record = SyncRecord.parse(JSON.parse(String(row.data)));
            if (this.permanentlyBlocked(record.data, record.scopes)) {
              this.store.db.prepare('DELETE FROM sync_inbox WHERE account_key=? AND record_id=?').run(checked.accountKey, String(row.record_id));
              progressed = true;
              continue;
            }
            if (!this.eligible(record)) {
              // A missing future epoch may be waiting for its explicit re-enable. Never resurrect a withdrawn scope.
              continue;
            }
            if (!this.dependencies(record.data)) continue;
            const key = syncRecordKey(record.data);
            const previous = this.store.db.prepare('SELECT data FROM sync_records WHERE record_key=?').get(key);
            const old = previous ? SyncRecord.parse(JSON.parse(String(previous.data))) : undefined;
            const immutable = ['turn', 'revision', 'run', 'artifact', 'event'].includes(record.data.kind);
            if (immutable && old && canonicalJson(record.data) !== canonicalJson(old.data)) throw new Error('Nội dung lịch sử đồng bộ đã đổi.');
            const permanentWithdrawal = record.data.kind === 'withdraw' && record.data.deleted
              && !(old?.data.kind === 'withdraw' && old.data.deleted);
            if (!old || compareSyncClock(record.clock, old.clock) > 0 || permanentWithdrawal) {
              if (!immutable || !old) this.apply(record);
              this.store.db.prepare('INSERT INTO sync_records VALUES(?,?) ON CONFLICT(record_key) DO UPDATE SET data=excluded.data').run(key, JSON.stringify(record));
              this.revisions.clock.tick(record.clock);
            }
            this.store.db.prepare("UPDATE sync_inbox SET status='applied' WHERE account_key=? AND record_id=?").run(checked.accountKey, String(row.record_id));
            progressed = true;
          }
        }
      } finally {
        this.importing = false;
      }
    });
  }
}
