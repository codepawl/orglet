import { createHash } from 'node:crypto';
import { BuiltInProviderId, type Worker, type Skill, type Team } from '../../shared/contracts';
import { isMemory, type Knowledge } from '../../shared/knowledge';
import { PublicWorker, PublicSkill, PublicTeamTemplate, PublicWorkerTemplate } from '../../shared/market-publishing';
import { Store } from '../storage/database';
import type { z } from 'zod';
import type { PublicModelSuggestion } from '../../shared/market-desktop';

export type PublishingSource = { kind: 'orglet' | 'crew'; entityId: string };

function publicWorker(worker: Worker, suggestion?: z.infer<typeof PublicModelSuggestion>) {
  const model = suggestion ?? { provider: worker.provider, ...(worker.modelId !== undefined ? { modelId: worker.modelId } : {}) };
  if (!BuiltInProviderId.safeParse(model.provider).success) throw new Error('Kết nối riêng không được chia sẻ. Chọn một kết nối gợi ý trong mục phiên bản và model trước khi xem trước.');
  return PublicWorker.parse({
    name: worker.name,
    instructions: worker.instructions,
    provider: model.provider,
    ...(model.modelId !== undefined ? { modelId: model.modelId } : {}),
    ...(worker.effort !== undefined ? { effort: worker.effort } : {}),
    ...(worker.avatar !== undefined ? { avatar: worker.avatar } : {}),
    ...(worker.description !== undefined ? { description: worker.description } : {}),
  });
}

function publicSkill(skill: Skill) {
  return PublicSkill.parse({
    name: skill.name,
    content: skill.content,
    ...(skill.package ? {
      package: {
        directoryName: skill.package.directoryName,
        hash: skill.package.hash,
        files: [...skill.package.files].sort((first, second) => first.path < second.path ? -1 : first.path > second.path ? 1 : 0)
          .map(file => ({ path: file.path, base64: file.base64 })),
      },
    } : {}),
  });
}

/** Public fields are selected directly; local template exports are never publication authority. */
export function projectPublishingSource(store: Store, source: PublishingSource, suggestion?: z.infer<typeof PublicModelSuggestion>) {
  const lifecycle = store.entityState();
  const assertActive = (table: 'workers' | 'teams', entityId: string) => {
    const state = lifecycle[table][entityId];
    if (state?.deletedAt || state?.archivedAt) throw new Error('Không xuất bản mục đã lưu trữ hoặc xóa.');
  };
  assertActive(source.kind === 'orglet' ? 'workers' : 'teams', source.entityId);
  const team = source.kind === 'crew' ? store.get<Team>('teams', source.entityId) : undefined;
  const workerIds = team ? [...new Set([...team.memberIds, team.synthesizerId])] : [source.entityId];
  const workers = workerIds.map(workerId => {
    assertActive('workers', workerId);
    return store.get<Worker>('workers', workerId);
  });
  const skills = [...new Set(workers.map(worker => worker.skillId))].map(skillId => store.get<Skill>('skills', skillId));
  const notes = team ? store.all<Knowledge>('knowledge').filter(note =>
    note.status === 'approved' && !isMemory(note) && note.scope.type === 'team' && note.scope.id === team.id,
  ).sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0) : [];
  const workerKeys = new Map(workers.map((worker, index) => [worker.id, `worker-${index + 1}`]));
  const skillKeys = new Map(skills.map((skill, index) => [skill.id, `skill-${index + 1}`]));
  const template = team ? PublicTeamTemplate.parse({
    format: 'orglet-team-template',
    version: 1,
    team: {
      name: team.name,
      instructions: team.instructions,
      workflow: team.workflow,
      monthlyBudgetMicros: team.monthlyBudgetMicros,
      ...(team.preflight !== undefined ? { preflight: team.preflight } : {}),
      ...(team.reviewPolicy !== undefined ? { reviewPolicy: team.reviewPolicy } : {}),
      ...(team.workHours !== undefined ? { workHours: team.workHours } : {}),
      ...(team.maxConcurrentTasks !== undefined ? { maxConcurrentTasks: team.maxConcurrentTasks } : {}),
      ...(team.taskBudgetMicros !== undefined ? { taskBudgetMicros: team.taskBudgetMicros } : {}),
      memberKeys: team.memberIds.map(workerId => workerKeys.get(workerId)),
      synthesizerKey: workerKeys.get(team.synthesizerId),
    },
    workers: workers.map(worker => ({ ...publicWorker(worker, suggestion), key: workerKeys.get(worker.id), skillKey: skillKeys.get(worker.skillId) })),
    skills: skills.map(skill => ({ ...publicSkill(skill), key: skillKeys.get(skill.id) })),
    knowledge: notes.map(note => ({ title: note.title, content: note.content, tags: [...note.tags].sort(), pinned: note.pinned })),
  }) : PublicWorkerTemplate.parse({
    format: 'orglet-worker-template', version: 1, worker: publicWorker(workers[0], suggestion), skill: publicSkill(skills[0]),
  });
  // Include every persisted row/revision, even fields excluded from the public projection.
  const fingerprint = createHash('sha256').update(JSON.stringify({ source, team: team ?? null, workers, skills, notes })).digest('hex');
  return { template, fingerprint };
}
