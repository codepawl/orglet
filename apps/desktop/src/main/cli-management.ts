import { routerBaseUrl } from '../shared/router';
import { API_PROVIDER_NAMES, BuiltInProviderId, WorkerInput, type Worker, type Workspace } from '../shared/contracts';
import { harnessNames, isHarness } from '../shared/harness';
import { CrewConfig, ManagementCatalog, OrgletConfig, type ManagementResult } from '../cli/management';
import type { CliRequest } from '../cli/protocol';
import { channelCatalog, deleteChannelEntity, saveChannelEntity } from './cli-management-channels';
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
    const providers = BuiltInProviderId.options.filter(provider => provider !== 'demo' && (provider !== 'codepawl' || routerBaseUrl(process.env.ORGLET_ROUTER_URL))).map(provider => ({
      id: provider,
      name: isHarness(provider) ? harnessNames[provider] : API_PROVIDER_NAMES[provider as keyof typeof API_PROVIDER_NAMES],
    }));
    return ManagementCatalog.parse({
      orglets: workspace.workers.map(worker => ({ id: worker.id, revision: worker.revision, config: OrgletConfig.strip().parse(worker) })),
      crews: workspace.teams.map(team => ({ id: team.id, revision: team.revision, config: CrewConfig.strip().parse(team) })),
      channels: channelCatalog(workspace),
      skills: workspace.skills.map(skill => ({ id: skill.id, name: skill.name })),
      providers: [...providers, ...(workspace.customConnections ?? []).map(connection => ({ id: `custom:${connection.id}`, name: connection.name }))],
    });
  }
  // A channel, with or without a lead, is edited and deleted through the channel commands.
  if (request.op === 'save-crew') return saveChannelEntity(request, dependencies);
  if (request.op === 'delete-entity' && request.kind === 'team') return deleteChannelEntity(request, dependencies);
  const current = request.target ? workspace.workers.find(worker => worker.id === request.target!.id) : undefined;
  if (request.target && (!current || current.revision !== request.target.revision)) {
    throw new Error('Cấu hình đã thay đổi. Tải lại rồi thử lại.');
  }
  if (request.op === 'delete-entity') {
    if (!current || current.name !== request.confirmName) throw new Error('Gõ đúng tên đầy đủ để xác nhận xóa.');
    await core('deleteEntity', { kind: 'worker', id: current.id, expectedRevision: request.target.revision, expectedName: request.confirmName });
    return { kind: 'worker', id: current.id, name: current.name, revision: current.revision, deleted: true };
  }
  const merged = applyPatch(current ?? {}, request.config);
  delete merged.revision;
  if (request.config.avatar) {
    const avatar = current?.avatar ?? {};
    merged.avatar = applyPatch(avatar, request.config.avatar);
  }
  if (merged.provider === 'demo') throw new Error('Chọn kết nối thật trước khi lưu Tí trong CLI.');
  if (current && request.config.provider !== undefined && request.config.provider !== current.provider && request.config.modelId === undefined) delete merged.modelId;
  const parsed = WorkerInput.safeParse(merged);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map(issue => issue.path.join('.')))].join(', ');
    throw new Error(`Kiểm tra các trường: ${fields}.`);
  }
  const saved = await core('saveWorker', {
    ...parsed.data,
    ...(request.target ? { expectedRevision: request.target.revision } : {}),
  }) as Worker;
  return { kind: 'worker', id: saved.id, name: saved.name, revision: saved.revision };
}
