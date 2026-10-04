import type { SyncData, SyncRecord, SyncRoot } from '../../../apps/desktop/src/shared/sync-records';
import { syncRecordKey } from '../../../apps/desktop/src/shared/sync-records';
import { compareSyncClock } from '../../../apps/desktop/src/shared/sync';

export type DeletionEntity = { kind: string; id: string };
export const immutable = (kind: SyncData['kind']) => ['revision', 'turn', 'run', 'artifact', 'event'].includes(kind);
export function deletionEntities(data: SyncData, records: readonly SyncRecord[] = [], scopes: readonly SyncRoot[] = []): DeletionEntity[] {
  const visiting = new Set<string>();
  const taskEntities = (id: string): DeletionEntity[] => {
    const identity = { kind: 'task', id };
    if (visiting.has(`task:${id}`)) return [identity];
    visiting.add(`task:${id}`);
    const headers = records.filter(row => row.data.kind === 'chat' && row.data.value.id === id);
    const header = headers.reduce<SyncRecord | undefined>((winner, row) => !winner || compareSyncClock(row.clock, winner.clock) > 0 ? row : winner, undefined);
    if (header?.data.kind !== 'chat') return [identity];
    const fields = records.filter(row => row.data.kind === 'chatField' && row.data.taskId === id && row.data.change.field === 'channel');
    const channel = fields.reduce<SyncRecord | undefined>((winner, row) => !winner || compareSyncClock(row.clock, winner.clock) > 0 ? row : winner, undefined);
    return [identity, ...(header.data.value.teamId ? [{ kind: 'team', id: header.data.value.teamId }] : []),
      ...(channel?.data.kind === 'chatField' && channel.data.change.field === 'channel' && channel.data.change.value ? channelEntities(channel.data.change.value) : []),
      ...(header.data.value.sideOf ? taskEntities(header.data.value.sideOf.taskId) : [])];
  };
  const channelEntities = (value: { crewId?: string; members: { kind: string; id: string }[] }): DeletionEntity[] => [
    ...(value.crewId ? [{ kind: 'team', id: value.crewId }] : []),
    ...value.members.filter(member => member.kind === 'crew').map(member => ({ kind: 'team', id: member.id }))];
  const runEntities = (id: string): DeletionEntity[] => {
    const found = records.find(row => row.data.kind === 'run' && row.data.value.id === id);
    if (found?.data.kind !== 'run') return [];
    return [...taskEntities(found.data.value.taskId), ...[found.data.value.worker, found.data.value.skill,
      ...(found.data.value.team ? [found.data.value.team] : [])].map(item => ({ kind: item.entity, id: item.value.id }))];
  };
  switch (data.kind) {
    case 'revision': {
      const item = data.revision;
      return [{ kind: item.entity, id: item.value.id }, ...(item.entity === 'knowledge' ? [
        ...(item.value.scope.type === 'team' || item.value.scope.type === 'worker' ? [{ kind: item.value.scope.type, id: item.value.scope.id }] : []),
        ...(item.value.provenance.kind === 'turn' || item.value.provenance.kind === 'run' ? taskEntities(item.value.provenance.taskId) : [])] : [])];
    }
    case 'entityState': return [{ kind: data.entity, id: data.id }];
    case 'chat': return [...taskEntities(data.value.id), ...(data.value.teamId ? [{ kind: 'team', id: data.value.teamId }] : []),
      ...(data.value.sideOf ? taskEntities(data.value.sideOf.taskId) : [])];
    case 'turn': return taskEntities(data.value.taskId);
    case 'chatField': return [...taskEntities(data.taskId), ...(data.change.field === 'channel' && data.change.value ? channelEntities(data.change.value) : [])];
    case 'reaction': case 'quote': return taskEntities(data.taskId);
    case 'source': return [{ kind: 'source', id: data.value.id },
      ...scopes.filter(scope => scope.kind === 'task').flatMap(scope => taskEntities(scope.id))];
    case 'routine': return [{ kind: 'routine', id: data.value.id }, ...(data.value.task.teamId ? [{ kind: 'team', id: data.value.task.teamId }] : [])];
    case 'channel': return channelEntities(data.value);
    case 'origin': return [{ kind: data.value.kind === 'orglet' ? 'worker' : 'team', id: data.value.entityId },
      ...Object.values(data.value.skillIds).map(id => ({ kind: 'skill', id }))];
    case 'delete': return [{ kind: data.entity, id: data.id }];
    case 'withdraw': return [data.root];
    case 'run': return [...taskEntities(data.value.taskId), ...[data.value.worker, data.value.skill, ...(data.value.team ? [data.value.team] : [])]
      .map(revision => ({ kind: revision.entity, id: revision.value.id }))];
    case 'artifact': return [...(data.value.usedMemories ?? []).map(memory => ({ kind: 'knowledge', id: memory.id })), ...runEntities(data.value.runId)];
    case 'event': return runEntities(data.value.runId);
    default: return [];
  }
}

/** records are confirmed rows plus the candidate batch; barriers survive erased payloads. */
export function assessScope(record: SyncRecord, records: readonly SyncRecord[], barriers: readonly DeletionEntity[],
  confirmedRecords: readonly SyncRecord[] = []):
  { roots: SyncRoot[]; entity?: DeletionEntity } {
  const fail = (code: string): never => { throw new Error(code); };
  const key = (root: DeletionEntity) => `${root.kind}:${root.id}`;
  const deleted = new Set(barriers.map(key));
  const control = record.data.kind === 'delete' || record.data.kind === 'withdraw' ||
    record.data.kind === 'entityState' && Boolean(record.data.value?.deletedAt);
  const all = records.filter(candidate => candidate !== record);
  const latest = (values: readonly SyncRecord[]) => values.reduce<SyncRecord | undefined>((winner, next) =>
    !winner || compareSyncClock(next.clock, winner.clock) > 0 ? next : winner, undefined);
  const withdrawals = new Map<string, Extract<SyncData, { kind: 'withdraw' }>>();
  const withdrawalClocks = new Map<string, SyncRecord['clock']>();
  for (const candidate of all) {
    if (candidate.data.kind !== 'withdraw') continue;
    const rootKey = key(candidate.data.root);
    const previous = withdrawals.get(rootKey);
    if (!previous || candidate.data.deleted || !previous.deleted && compareSyncClock(candidate.clock, withdrawalClocks.get(rootKey)!) > 0) {
      withdrawals.set(rootKey, candidate.data);
      withdrawalClocks.set(rootKey, candidate.clock);
    }
  }
  const blocked = (root: SyncRoot) => deleted.has(key(root)) || Boolean(withdrawals.get(key(root))?.deleted || withdrawals.get(key(root))?.localOnly);
  const unique = (roots: SyncRoot[]) => [...new Map(roots.map(root => [key(root), root])).values()];
  const revision = (entity: 'worker' | 'team', id: string) => {
    const candidates = [...all, record].filter(row => row.data.kind === 'revision' && row.data.revision.entity === entity && row.data.revision.value.id === id);
    return candidates.sort((a, b) => {
      if (a.data.kind !== 'revision' || b.data.kind !== 'revision') return 0;
      return b.data.revision.generation - a.data.revision.generation || compareSyncClock(b.data.revision.clock, a.data.revision.clock) ||
        b.data.revision.revisionId.localeCompare(a.data.revision.revisionId);
    })[0]?.data;
  };
  const teamRoots = (id: string): SyncRoot[] => {
    if (deleted.has(`team:${id}`)) return fail('permanently_deleted');
    const found = revision('team', id);
    if (found?.kind !== 'revision' || found.revision.entity !== 'team') return fail('dependency_missing');
    return [...found.revision.value.memberIds, found.revision.value.synthesizerId].map(id => ({ kind: 'worker', id }));
  };
  const members = (value: { members: { kind: 'orglet' | 'crew'; id: string }[] }): SyncRoot[] => value.members.flatMap(member =>
    member.kind === 'orglet' ? [{ kind: 'worker' as const, id: member.id }] : teamRoots(member.id));
  const taskRoots = (id: string, visited = new Set<string>()): SyncRoot[] => {
    if (visited.has(id)) return fail('dependency_missing');
    visited.add(id);
    const found = latest([...all, record].filter(row => row.data.kind === 'chat' && row.data.value.id === id));
    if (found?.data.kind !== 'chat') return fail('dependency_missing');
    const chat = found.data.value;
    if (chat.assignees === 'all') return fail('dependency_missing'); // Wire must carry its frozen roster.
    if (chat.teamId && !chat.participants) return fail('dependency_missing');
    const channel = latest([...all, record].filter(row => row.data.kind === 'chatField' && row.data.taskId === id && row.data.change.field === 'channel'));
    return unique([{ kind: 'task', id }, { kind: 'worker', id: chat.workerId },
      ...(chat.assignees ?? []).map(id => ({ kind: 'worker' as const, id })),
      ...(chat.participants ?? []).map(id => ({ kind: 'worker' as const, id })),
      ...(chat.teamId ? teamRoots(chat.teamId) : []),
      ...(chat.sideOf ? taskRoots(chat.sideOf.taskId, visited) : []),
      ...(channel?.data.kind === 'chatField' && channel.data.change.field === 'channel' && channel.data.change.value ? members(channel.data.change.value) : [])]);
  };
  const runRoots = (value: Extract<SyncData, { kind: 'run' }>['value']): SyncRoot[] => unique([...taskRoots(value.taskId),
    { kind: 'worker', id: value.worker.value.id }, ...(value.team ? [...value.team.value.memberIds, value.team.value.synthesizerId]
      .map(id => ({ kind: 'worker' as const, id })) : [])]);
  const choose = (owners: SyncRoot[][]): SyncRoot[] => {
    const publicOwners = owners.filter(roots => roots.every(root => !blocked(root)));
    const chosen = publicOwners.find(roots => roots.every(root => record.scopes.some(scope => key(scope) === key(root))));
    if (chosen) return chosen;
    if (!owners.length) return fail('dependency_missing');
    if (!publicOwners.length) return fail('scope_withdrawn');
    return fail('scope_missing');
  };
  const data = record.data;
  let roots: SyncRoot[] = [];
  if (data.kind === 'revision') {
    const item = data.revision;
    if (item.entity === 'worker') roots = [{ kind: 'worker', id: item.value.id }];
    if (item.entity === 'team') roots = [...item.value.memberIds, item.value.synthesizerId].map(id => ({ kind: 'worker', id }));
    if (item.entity === 'knowledge') {
      if (item.value.scope.type === 'worker') roots.push({ kind: 'worker', id: item.value.scope.id });
      if (item.value.scope.type === 'team') roots.push(...teamRoots(item.value.scope.id));
      if (item.value.provenance.kind === 'turn' || item.value.provenance.kind === 'run') roots.push(...taskRoots(item.value.provenance.taskId));
    }
    if (item.entity === 'skill') {
      const ids = new Set(all.flatMap(row => row.data.kind === 'revision' && row.data.revision.entity === 'worker' ? [row.data.revision.value.id] : []));
      roots = choose([...ids].flatMap(id => {
        const owner = revision('worker', id);
        return owner?.kind === 'revision' && owner.revision.entity === 'worker' && owner.revision.value.skillId === item.value.id ? [[{ kind: 'worker' as const, id }]] : [];
      }));
    }
  } else if (data.kind === 'chat') roots = taskRoots(data.value.id);
  else if (data.kind === 'turn') roots = taskRoots(data.value.taskId);
  else if (data.kind === 'chatField' || data.kind === 'reaction' || data.kind === 'quote') {
    roots = taskRoots(data.taskId);
    if (data.kind === 'chatField' && data.change.field === 'channel' && data.change.value) roots.push(...members(data.change.value));
  } else if (data.kind === 'entityState') roots = data.entity === 'worker' ? [{ kind: 'worker', id: data.id }] : control ? [] : teamRoots(data.id);
  else if (data.kind === 'origin') roots = Object.values(data.value.workerIds).map(id => ({ kind: 'worker', id }));
  else if (data.kind === 'channel') roots = members(data.value);
  // A space names its orglets, so it is accepted only in the scope of every one of them.
  else if (data.kind === 'space') roots = data.value.orgletIds.map(id => ({ kind: 'worker' as const, id }));
  else if (data.kind === 'routine') roots = [{ kind: 'worker', id: data.value.task.workerId }, ...(data.value.task.teamId ? teamRoots(data.value.task.teamId) : [])];
  else if (data.kind === 'source') {
    const owners = new Set(all.flatMap(row => row.data.kind === 'turn' && row.data.value.input.sourceIds.includes(data.value.id) ? [row.data.value.taskId] : []));
    // A prior accepted source envelope confirms ownership after its turn was compacted.
    for (const row of confirmedRecords) if (row.data.kind === 'source' && row.data.value.id === data.value.id) {
      for (const scope of row.scopes) if (scope.kind === 'task') owners.add(scope.id);
    }
    roots = choose([...owners].flatMap(id => {
      // Erased old owners need not prevent a genuinely shared attachment's surviving owner.
      if (![...all, record].some(row => row.data.kind === 'chat' && row.data.value.id === id)) return [];
      return [taskRoots(id)];
    }));
  } else if (data.kind === 'run') roots = runRoots(data.value);
  else if (data.kind === 'artifact' || data.kind === 'event') {
    const run = all.find(row => row.data.kind === 'run' && row.data.value.id === data.value.runId);
    if (run?.data.kind !== 'run') return fail('dependency_missing');
    roots = runRoots(run.data.value);
  }
  roots = unique(roots);
  if (!control) {
    if (deleted.has(`record:${syncRecordKey(data)}`) || deletionEntities(data, all).some(entity => deleted.has(key(entity)))) return fail('permanently_deleted');
    if (roots.some(root => deleted.has(key(root)) || withdrawals.get(key(root))?.deleted)) return fail('permanently_deleted');
    for (const root of roots) {
      const scope = record.scopes.find(scope => key(scope) === key(root));
      if (!scope) return fail('scope_missing');
      const withdrawal = withdrawals.get(key(root));
      if (withdrawal && (withdrawal.localOnly || withdrawal.epoch !== scope.epoch)) return fail('scope_withdrawn');
    }
    // Extra declared scopes cannot hide a forbidden dependency either.
    if (record.scopes.some(scope => blocked(scope))) return fail('scope_withdrawn');
  } else if (data.kind === 'withdraw' && !data.deleted && (deleted.has(key(data.root)) || withdrawals.get(key(data.root))?.deleted)) return fail('permanently_deleted');
  const entity = ['revision', 'entityState', 'chat', 'source', 'routine', 'origin', 'delete', 'withdraw'].includes(data.kind) ? deletionEntities(data)[0] : undefined;
  return { roots, ...(entity ? { entity } : {}) };
}
