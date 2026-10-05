import { createHash } from 'node:crypto';
import { BuiltInProviderId, type Worker, type Skill, type Team } from '../../shared/contracts';
import { isMemory, type Knowledge } from '../../shared/knowledge';
import { PublicWorker, PublicSkill, PublicSpaceTemplate, PublicTeamTemplate, PublicWorkerTemplate } from '../../shared/market-publishing';
import type { Task } from '../../shared/contracts';
import type { Channel } from '../../shared/channels';
import { emptyChannels } from '../storage/channels';
import { storedSpaces } from '../storage/spaces';
import { Store } from '../storage/database';
import type { z } from 'zod';
import type { PublicModelSuggestion } from '../../shared/market-desktop';

export type PublishingSource = { kind: 'orglet' | 'crew' | 'space'; entityId: string };

const SPACE_NOT_PUBLISHABLE = 'Không gian này đã bị xóa.';
const CHANNEL_NAMES_REPEAT = 'Hai kênh trong không gian trùng tên. Đổi tên một kênh rồi xem trước lại.';
const SPACE_HAS_NO_CHANNEL = 'Không gian chưa có kênh nào để chia sẻ.';

/** The channels of a space as they are now, written in or empty, oldest first so that the listing keeps their order. */
function spaceChannels(store: Store, spaceId: string): Channel[] {
  const written = store.all<Task>('tasks').filter(task => !task.deletedAt && !task.archivedAt && task.channel?.spaceId === spaceId)
    .map(task => ({ channel: task.channel!, createdAt: task.createdAt }));
  const waiting = emptyChannels(store).filter(channel => channel.spaceId === spaceId).map(({ createdAt, ...channel }) => ({ channel, createdAt }));
  return [...written, ...waiting].sort((first, second) => first.createdAt.localeCompare(second.createdAt)).map(entry => entry.channel);
}

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
  const space = source.kind === 'space' ? storedSpaces(store).find(item => item.id === source.entityId) : undefined;
  if (source.kind === 'space' && !space) throw new Error(SPACE_NOT_PUBLISHABLE);
  if (source.kind !== 'space') assertActive(source.kind === 'orglet' ? 'workers' : 'teams', source.entityId);
  const team = source.kind === 'crew' ? store.get<Team>('teams', source.entityId) : undefined;
  const workerIds = space ? [...space.orgletIds] : team ? [...new Set([...team.memberIds, team.synthesizerId])] : [source.entityId];
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
  const channels = space ? spaceChannels(store, space.id) : [];
  if (space) {
    if (!channels.length) throw new Error(SPACE_HAS_NO_CHANNEL);
    if (new Set(channels.map(channel => channel.name.toLowerCase())).size !== channels.length) throw new Error(CHANNEL_NAMES_REPEAT);
  }
  const categoryKeys = new Map((space?.categories ?? []).map((category, index) => [category.id, `category-${index + 1}`]));
  // A space shares who is where, never a permission, a schedule or a folder: none of those is read here.
  const spaceTemplate = space ? PublicSpaceTemplate.parse({
    format: 'orglet-space-template',
    version: 1,
    space: {
      name: space.name,
      categories: space.categories.map(category => ({ key: categoryKeys.get(category.id), name: category.name })),
      channels: channels.map(channel => ({
        name: channel.name,
        ...(channel.topic ? { topic: channel.topic } : {}),
        ...(channel.categoryId && categoryKeys.has(channel.categoryId) ? { categoryKey: categoryKeys.get(channel.categoryId) } : {}),
        ...(channel.access === 'listed' ? { memberKeys: channel.members.flatMap(member => workerKeys.get(member.id) ?? []) } : {}),
      })),
    },
    workers: workers.map(worker => ({ ...publicWorker(worker, suggestion), key: workerKeys.get(worker.id), skillKey: skillKeys.get(worker.skillId) })),
    skills: skills.map(skill => ({ ...publicSkill(skill), key: skillKeys.get(skill.id) })),
  }) : undefined;
  const template = spaceTemplate ?? (team ? PublicTeamTemplate.parse({
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
  }));
  // Include every persisted row/revision, even fields excluded from the public projection.
  const fingerprint = createHash('sha256').update(JSON.stringify({ source, team: team ?? null, workers, skills, notes, ...(space ? { space, channels } : {}) })).digest('hex');
  return { template, fingerprint };
}
