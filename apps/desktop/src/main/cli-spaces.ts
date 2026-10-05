import type { Workspace } from '../shared/contracts';
import type { Space } from '../shared/spaces';
import type { CliRequest, SpaceChangeValue } from '../cli/protocol';
import { chatsOf, CliFailure, matchChat, taskById } from './cli-chats';
import type { CliDependencies } from './cli-turns';

/**
 * Spaces from the terminal (docs/spaces-design.md): making one, changing its name and its orglets, adding a category,
 * deleting it, and moving a channel into or out of one. Each step is the core command the desktop uses, with its
 * guards. Nothing here sets a permission or a folder.
 */

type Request = Extract<CliRequest, { op: 'space-change' }>;

/** The space with this name, or the only one whose name starts with it. */
export function spaceNamed(workspace: Workspace, query: string): Space {
  const spaces = workspace.spaces ?? [];
  const wanted = query.trim().toLocaleLowerCase();
  const exact = spaces.filter(space => space.name.toLocaleLowerCase() === wanted);
  const found = exact.length ? exact : spaces.filter(space => space.name.toLocaleLowerCase().startsWith(wanted));
  if (found.length === 1) return found[0];
  const names = (found.length ? found : spaces).map(space => space.name).join(', ');
  if (found.length > 1) throw new CliFailure('ambiguous', `"${query}" khớp với nhiều không gian: ${names}. Gõ tên đầy đủ hơn.`);
  if (!names) throw new CliFailure('not_found', 'Chưa có không gian nào.');
  throw new CliFailure('not_found', `Không có không gian nào tên "${query}". Có: ${names}.`);
}

/** The category of a space with this name. */
export function categoryNamed(space: Space, query: string): Space['categories'][number] {
  const wanted = query.trim().toLocaleLowerCase();
  const category = space.categories.find(item => item.name.toLocaleLowerCase() === wanted);
  if (category) return category;
  const names = space.categories.map(item => item.name).join(', ');
  throw new CliFailure('not_found', names ? `Không gian "${space.name}" không có mục "${query}". Có: ${names}.` : `Không gian "${space.name}" chưa có mục nào.`);
}

/** A space, or one of its categories, as the place of a new channel, with the orglets a channel there inherits. */
export function placeNamed(workspace: Workspace, spaceName: string, categoryName: string | undefined): { spaceId: string; categoryId?: string; orgletIds: readonly string[] } {
  const space = spaceNamed(workspace, spaceName);
  if (categoryName === undefined) return { spaceId: space.id, orgletIds: space.orgletIds };
  const category = categoryNamed(space, categoryName);
  return { spaceId: space.id, categoryId: category.id, orgletIds: category.orgletIds ?? space.orgletIds };
}

/** The orglets these names mean, each once. A space holds orglets, so a channel's name here is a mistake. */
function orgletIdsNamed(workspace: Workspace, names: readonly string[]): string[] {
  const orglets = chatsOf({ workers: workspace.workers, teams: [] });
  const orgletIds: string[] = [];
  for (const name of names) {
    const found = matchChat(name, orglets);
    if (!orgletIds.includes(found.id)) orgletIds.push(found.id);
  }
  return orgletIds;
}

export class CliSpaces {
  constructor(private readonly dependencies: CliDependencies) {}

  private workspace(): Promise<Workspace> {
    return this.dependencies.request('workspace', {}) as Promise<Workspace>;
  }

  async change(request: Request): Promise<SpaceChangeValue> {
    const workspace = await this.workspace();
    switch (request.verb) {
      case 'add': return this.add(workspace, request);
      case 'edit': return this.edit(workspace, request);
      case 'delete': return this.remove(workspace, request);
      case 'category': return this.addCategory(workspace, request);
      case 'move': return this.moveChannel(workspace, request);
      case 'out': return this.takeOut(workspace, request);
    }
  }

  private async add(workspace: Workspace, request: Request): Promise<SpaceChangeValue> {
    const name = request.space!;
    const orgletIds = orgletIdsNamed(workspace, request.names);
    await this.dependencies.request('createSpace', { name, orgletIds, categories: [] });
    return { verb: 'add', space: name, orglets: this.namesOf(workspace, orgletIds) };
  }

  private async edit(workspace: Workspace, request: Request): Promise<SpaceChangeValue> {
    const space = spaceNamed(workspace, request.space!);
    const orgletIds = request.names.length ? orgletIdsNamed(workspace, request.names) : space.orgletIds;
    const name = request.rename ?? space.name;
    await this.dependencies.request('updateSpace', { id: space.id, name, ...(space.color ? { color: space.color } : {}), orgletIds, categories: space.categories });
    return { verb: 'edit', space: name, orglets: this.namesOf(workspace, orgletIds) };
  }

  private async remove(workspace: Workspace, request: Request): Promise<SpaceChangeValue> {
    const space = spaceNamed(workspace, request.space!);
    if (space.name !== request.confirmName) throw new CliFailure('failed', 'Gõ đúng tên đầy đủ để xác nhận xóa.');
    await this.dependencies.request('deleteSpace', { id: space.id });
    return { verb: 'delete', space: space.name };
  }

  private async addCategory(workspace: Workspace, request: Request): Promise<SpaceChangeValue> {
    const space = spaceNamed(workspace, request.space!);
    const category = request.category!;
    if (space.categories.some(item => item.name.toLocaleLowerCase() === category.toLocaleLowerCase())) throw new CliFailure('failed', `Không gian "${space.name}" đã có mục "${category}".`);
    await this.dependencies.request('updateSpace', { id: space.id, name: space.name, ...(space.color ? { color: space.color } : {}), orgletIds: space.orgletIds, categories: [...space.categories, { name: category }] });
    return { verb: 'category', space: space.name, category };
  }

  /** Puts a channel in a space, directly or in one of its categories. The core decides which orglets it then has. */
  private async moveChannel(workspace: Workspace, request: Request): Promise<SpaceChangeValue> {
    const space = spaceNamed(workspace, request.space!);
    const category = request.category === undefined ? undefined : categoryNamed(space, request.category);
    const channel = this.channelOf(workspace, request.chat!);
    await this.dependencies.request('updateChannel', { id: channel.id, name: channel.name, topic: channel.topic ?? '', members: channel.members, spaceId: space.id, categoryId: category?.id ?? null });
    return { verb: 'move', space: space.name, channel: channel.name, ...(category ? { category: category.name } : {}) };
  }

  private async takeOut(workspace: Workspace, request: Request): Promise<SpaceChangeValue> {
    const channel = this.channelOf(workspace, request.chat!);
    if (!channel.spaceId) throw new CliFailure('failed', 'Kênh này không nằm trong không gian nào.');
    await this.dependencies.request('updateChannel', { id: channel.id, name: channel.name, topic: channel.topic ?? '', members: channel.members, spaceId: null });
    return { verb: 'out', channel: channel.name };
  }

  private channelOf(workspace: Workspace, chat: string) {
    const task = taskById(workspace, chat);
    if (!task.channel) throw new CliFailure('failed', 'Chỉ chuyển được một kênh vào không gian.');
    return task.channel;
  }

  private namesOf(workspace: Workspace, orgletIds: readonly string[]): string[] {
    return orgletIds.flatMap(orgletId => workspace.workers.find(worker => worker.id === orgletId)?.name ?? []);
  }
}
