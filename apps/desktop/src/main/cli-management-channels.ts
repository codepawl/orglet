import { commands, type ChannelLeadSettings, type Team, type Workspace } from '../shared/contracts';
import { channelMode, type Channel, type ChannelFields, type ChannelMember } from '../shared/channels';
import type { CliRequest } from '../cli/protocol';
import type { ChannelConfig, ChannelPatch, ChannelTarget, ManagementResult } from '../cli/management';
import { channelsBySpace, type ListedChannel } from './cli-channels';
import { adoptLooseChannels } from './cli-spaces';
import type { CliDependencies } from './cli-turns';

/**
 * `create channel`, `edit channel` and `delete channel` from the terminal: the same core commands the window's channel
 * dialog uses (`createChannel`, `updateChannel`, `deleteChannel`), with the lead's settings as fields of the channel.
 * A channel that was a crew keeps the crew's id in the results and accepts it as its target for one release.
 */

type SaveRequest = Extract<CliRequest, { op: 'save-crew' }>;
type DeleteRequest = Extract<CliRequest, { op: 'delete-entity' }>;
type ChannelCommandFields = ChannelFields & { lead?: ChannelLeadSettings };

const CONFIGURATION_CHANGED = 'Cấu hình đã thay đổi. Tải lại rồi thử lại.';
const CONFIRM_FULL_NAME = 'Gõ đúng tên đầy đủ để xác nhận xóa.';
const CHANNEL_TAKES_TURNS = 'Kênh này lần lượt trả lời. Thêm "mode": "lead" để một Tí dẫn dắt chia việc.';
const CHANNEL_HAS_MESSAGES = 'Kênh này đã có tin nhắn. Xóa nó như một chat: orglet delete --chat <mã> --confirm "<tên>". Lấy mã bằng orglet chats.';

function crewOf(workspace: Workspace, channel: Channel): Team | undefined {
  return channel.crewId ? workspace.teams.find(team => team.id === channel.crewId) : undefined;
}

/** The channel a target names: by its own id, or by the id of the crew record behind it (what the results say). */
function channelOfTarget(workspace: Workspace, targetId: string): ListedChannel {
  const found = channelsBySpace(workspace).find(entry => entry.channel.id === targetId || entry.channel.crewId === targetId);
  if (!found) throw new Error(CONFIGURATION_CHANGED);
  return found;
}

/** Only a channel with a lead has a revision, and only that one can have changed under the terminal's feet. */
function assertCurrent(crew: Team | undefined, target: ChannelTarget): void {
  if (target.revision !== undefined && crew?.revision !== target.revision) throw new Error(CONFIGURATION_CHANGED);
}

function leadOf(crew: Team): NonNullable<ChannelConfig['lead']> {
  return {
    synthesizerId: crew.synthesizerId,
    instructions: crew.instructions,
    workflow: crew.workflow,
    monthlyBudgetMicros: crew.monthlyBudgetMicros,
    ...(crew.maxConcurrentTasks === undefined ? {} : { maxConcurrentTasks: crew.maxConcurrentTasks }),
    ...(crew.taskBudgetMicros === undefined ? {} : { taskBudgetMicros: crew.taskBudgetMicros }),
  };
}

/** Every channel as the terminal edits it, in the order `orglet list` shows them. */
export function channelCatalog(workspace: Workspace) {
  return channelsBySpace(workspace).map(entry => {
    const crew = crewOf(workspace, entry.channel);
    const config: ChannelConfig = {
      name: entry.channel.name,
      ...(entry.channel.topic ? { topic: entry.channel.topic } : {}),
      members: entry.channel.members,
      mode: channelMode(entry.channel),
      ...(crew ? { lead: leadOf(crew) } : {}),
    };
    return { id: entry.channel.id, ...(crew ? { revision: crew.revision } : {}), config };
  });
}

/** The lead's settings from `lead` and from the crew's older flat names, which a `null` leaves as the channel has them. */
function leadSettingsOf(patch: ChannelPatch): ChannelLeadSettings {
  const { synthesizerId, instructions, workflow, monthlyBudgetMicros, maxConcurrentTasks, taskBudgetMicros } = patch;
  const older = { synthesizerId, instructions, workflow, monthlyBudgetMicros, maxConcurrentTasks, taskBudgetMicros };
  const settings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries({ ...older, ...patch.lead })) {
    if (value !== undefined && value !== null) settings[key] = value;
  }
  return settings as ChannelLeadSettings;
}

/** Who is in the channel after the patch: `members`, or the older `memberIds` with the lead among them. Left out keeps them. */
function membersOf(patch: ChannelPatch, current: ListedChannel | undefined): ChannelMember[] | undefined {
  if (patch.members) return patch.members;
  if (!patch.memberIds && !patch.synthesizerId) return undefined;
  const kept = current?.channel.members.filter(member => member.kind === 'orglet').map(member => member.id) ?? [];
  const orgletIds = [...new Set([...(patch.memberIds ?? kept), ...(patch.synthesizerId ? [patch.synthesizerId] : [])])];
  return orgletIds.map(id => ({ kind: 'orglet' as const, id }));
}

/** How the channel answers: said in the patch, or a lead's settings on a new channel; never switched by settings alone. */
function modeOf(patch: ChannelPatch, current: ListedChannel | undefined, hasLeadSettings: boolean): ChannelFields['mode'] {
  if (patch.mode) return patch.mode;
  if (!hasLeadSettings) return undefined;
  if (!current) return 'lead';
  if (channelMode(current.channel) === 'lead') return undefined;
  throw new Error(CHANNEL_TAKES_TURNS);
}

function channelFields(patch: ChannelPatch, current: ListedChannel | undefined): ChannelCommandFields {
  const lead = leadSettingsOf(patch);
  const hasLeadSettings = Object.keys(lead).length > 0;
  const members = membersOf(patch, current);
  const mode = modeOf(patch, current, hasLeadSettings);
  const channel = current?.channel;
  return {
    name: patch.name ?? channel?.name ?? '',
    topic: patch.topic ?? channel?.topic ?? '',
    members: members ?? channel?.members ?? [],
    ...(mode ? { mode } : {}),
    ...(hasLeadSettings ? { lead } : {}),
    // The window lists the members of a channel in a space itself once it changes them, as the channel's own list.
    ...(members && channel?.spaceId ? { access: 'listed' as const } : {}),
  };
}

function invalidFields(issues: readonly { path: readonly PropertyKey[] }[]): Error {
  const fields = [...new Set(issues.map(issue => issue.path.map(String).join('.')))].join(', ');
  return new Error(`Kiểm tra các trường: ${fields}.`);
}

function resultOf(workspace: Workspace, channelId: string, extra: Partial<ManagementResult>): ManagementResult {
  const entry = channelsBySpace(workspace).find(item => item.channel.id === channelId);
  const crew = entry ? crewOf(workspace, entry.channel) : undefined;
  return {
    kind: 'team',
    id: crew?.id ?? channelId,
    channelId,
    name: entry?.channel.name ?? '',
    ...(crew ? { revision: crew.revision } : {}),
    ...extra,
  };
}

/** Makes a channel, or changes the one the target names, the way the channel dialog does. */
export async function saveChannelEntity(request: SaveRequest, dependencies: CliDependencies): Promise<ManagementResult> {
  const core = dependencies.request;
  const workspace = await core('workspace', {}) as Workspace;
  const current = request.target ? channelOfTarget(workspace, request.target.id) : undefined;
  if (request.target) assertCurrent(crewOf(workspace, current!.channel), request.target);
  const fields = channelFields(request.config, current);
  if (current) {
    const parsed = commands.updateChannel.safeParse({ id: current.channel.id, ...fields });
    if (!parsed.success) throw invalidFields(parsed.error.issues);
    await core('updateChannel', parsed.data);
    return resultOf(await core('workspace', {}) as Workspace, current.channel.id, {});
  }
  const parsed = commands.createChannel.safeParse(fields);
  if (!parsed.success) throw invalidFields(parsed.error.issues);
  const channelId = String(await core('createChannel', parsed.data));
  // A new channel is made outside every space; it goes to the space kept for channels, as the window would put it.
  const space = await adoptLooseChannels(dependencies);
  // Moving a channel with a lead into a space saves its crew record again, so the revision is read after the move.
  return resultOf(await core('workspace', {}) as Workspace, channelId, space ? { space } : {});
}

/**
 * Deletes a channel nobody has written in. One with messages keeps the way it was deleted: a channel with a lead leaves
 * the list with its chat history kept; one that takes turns is deleted as a chat, which the core does not undo.
 */
export async function deleteChannelEntity(request: DeleteRequest, dependencies: CliDependencies): Promise<ManagementResult> {
  const core = dependencies.request;
  const workspace = await core('workspace', {}) as Workspace;
  const { channel, task } = channelOfTarget(workspace, request.target.id);
  const crew = crewOf(workspace, channel);
  assertCurrent(crew, request.target);
  if (request.confirmName.replace(/^#+\s*/, '') !== channel.name) throw new Error(CONFIRM_FULL_NAME);
  const result = resultOf(workspace, channel.id, { deleted: true });
  if (!task) {
    await core('deleteChannel', { id: channel.id });
  } else if (crew) {
    await core('deleteEntity', { kind: 'team', id: crew.id, expectedRevision: crew.revision, expectedName: crew.name });
  } else {
    throw new Error(CHANNEL_HAS_MESSAGES);
  }
  return result;
}
