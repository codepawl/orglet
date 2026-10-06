import { API_PROVIDER_NAMES, BuiltInProviderId, TeamInput, WorkerInput, type Team, type Worker, type Workspace } from '../shared/contracts';
import { harnessNames, isHarness } from '../shared/harness';
import { CrewConfig, ManagementCatalog, OrgletConfig, type ManagementResult } from '../cli/management';
import type { CliRequest } from '../cli/protocol';
import { adoptLooseChannels } from './cli-spaces';
import type { CliDependencies } from './cli-turns';

type ManagementRequest = Extract<CliRequest, { op: 'config' | 'save-orglet' | 'save-crew' | 'delete-entity' }>;

function applyPatch(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else if (value !== undefined) merged[key] = value;
  }
  return merged;
}

export async function manageCli(request: ManagementRequest, dependencies: CliDependencies): Promise<ManagementCatalog | ManagementResult> {
  const core = dependencies.request;
  const workspace = await core('workspace', {}) as Workspace;
  if (request.op === 'config') {
    const providers = BuiltInProviderId.options.filter(provider => provider !== 'demo').map(provider => ({
      id: provider,
      name: isHarness(provider) ? harnessNames[provider] : API_PROVIDER_NAMES[provider as keyof typeof API_PROVIDER_NAMES],
    }));
    return ManagementCatalog.parse({
      orglets: workspace.workers.map(worker => ({ id: worker.id, revision: worker.revision, config: OrgletConfig.strip().parse(worker) })),
      crews: workspace.teams.map(team => ({ id: team.id, revision: team.revision, config: CrewConfig.strip().parse(team) })),
      skills: workspace.skills.map(skill => ({ id: skill.id, name: skill.name })),
      providers: [...providers, ...(workspace.customConnections ?? []).map(connection => ({ id: `custom:${connection.id}`, name: connection.name }))],
    });
  }
  const kind = request.op === 'save-orglet' ? 'worker' : request.op === 'save-crew' ? 'team' : request.kind;
  const entities = kind === 'worker' ? workspace.workers : workspace.teams;
  const current = request.target ? entities.find(entity => entity.id === request.target!.id) : undefined;
  if (request.target && (!current || current.revision !== request.target.revision)) {
    throw new Error('Cấu hình đã thay đổi. Tải lại rồi thử lại.');
  }
  if (request.op === 'delete-entity') {
    if (!current || current.name !== request.confirmName) throw new Error('Gõ đúng tên đầy đủ để xác nhận xóa.');
    await core('deleteEntity', { kind, id: current.id, expectedRevision: request.target.revision, expectedName: request.confirmName });
    return { kind, id: current.id, name: current.name, revision: current.revision, deleted: true };
  }
  const merged = applyPatch(current ?? {}, request.config);
  delete merged.revision;
  if (request.op === 'save-orglet') {
    if (request.config.avatar) {
      const avatar = current && 'avatar' in current ? current.avatar ?? {} : {};
      merged.avatar = applyPatch(avatar, request.config.avatar);
    }
    if (merged.provider === 'demo') throw new Error('Chọn kết nối thật trước khi lưu Tí trong CLI.');
    if (current && 'provider' in current && request.config.provider !== undefined && request.config.provider !== current.provider && request.config.modelId === undefined) delete merged.modelId;
  }
  const parsed = (request.op === 'save-orglet' ? WorkerInput : TeamInput).safeParse(merged);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map(issue => issue.path.join('.')))].join(', ');
    throw new Error(`Kiểm tra các trường: ${fields}.`);
  }
  const input = parsed.data;
  const saved = await core(request.op === 'save-orglet' ? 'saveWorker' : 'saveTeam', {
    ...input,
    ...(request.target ? { expectedRevision: request.target.revision } : {}),
  }) as Worker | Team;
  const result = { kind, id: saved.id, name: saved.name, revision: saved.revision };
  // A new channel is made outside every space; it goes to the space kept for channels, as the window would put it.
  const space = request.op === 'save-crew' && !request.target ? await adoptLooseChannels(dependencies) : undefined;
  if (!space) return result;
  // Moving a channel with a lead into a space saves its crew record again, so the revision to edit it with is the new one.
  const moved = (await core('workspace', {}) as Workspace).teams.find(team => team.id === saved.id);
  return { ...result, revision: moved?.revision ?? result.revision, space };
}
