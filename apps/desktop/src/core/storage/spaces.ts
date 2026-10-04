import { randomUUID } from 'node:crypto';
import { channelOrgletIds, MAX_CHANNEL_MEMBERS } from '../../shared/channels';
import { MAX_SPACES, Space, type SpaceFields } from '../../shared/spaces';
import type { Channels } from './channels';
import type { Store } from './database';

/** The settings row that holds the spaces (docs/spaces-design.md), beside the one for empty channels. */
const SPACES = 'spaces';

export const SPACE_NOT_FOUND = 'Không tìm thấy không gian này.';
const TOO_MANY_SPACES = 'Đã có quá nhiều không gian.';
const ORGLET_NOT_LISTED = 'Có Tí đã được lưu trữ hoặc xóa. Bỏ Tí đó khỏi không gian.';
const CATEGORY_WIDER_THAN_SPACE = 'Một mục chỉ có thể có những Tí mà không gian của nó có.';
const NO_CHANNEL_IN_CATEGORY = 'Không có kênh nào trong mục này.';

/** The spaces as saved, in the order they were made. A row an older or newer build wrote differently is left out. */
export function storedSpaces(store: Store): Space[] {
  return store.setting<unknown[]>(SPACES, []).flatMap(row => {
    const parsed = Space.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * The person's spaces. A space is saved whole, and every channel in it is resolved again in the same transaction, so
 * an orglet taken out of a space or a category leaves its channels at once and nothing is ever wider than its place.
 * A save is refused while one of the space's channels is working, the way a channel's own edit is.
 */
export class Spaces {
  constructor(private readonly store: Store, private readonly channels: Channels, private readonly assertChannelIdle: (channelId: string) => void) {}

  create(fields: SpaceFields): string {
    const spaces = storedSpaces(this.store);
    if (spaces.length >= MAX_SPACES) throw new Error(TOO_MANY_SPACES);
    const space = this.spaceOf(randomUUID(), fields, undefined);
    this.store.setSetting(SPACES, [...spaces, space]);
    return space.id;
  }

  update(spaceId: string, fields: SpaceFields) {
    const spaces = storedSpaces(this.store);
    const current = spaces.find(space => space.id === spaceId);
    if (!current) throw new Error(SPACE_NOT_FOUND);
    const space = this.spaceOf(spaceId, fields, current);
    const channelIds = this.channels.inSpace(spaceId);
    for (const channelId of channelIds) this.assertChannelIdle(channelId);
    this.store.transaction(() => {
      this.store.setSetting(SPACES, spaces.map(item => item.id === spaceId ? space : item));
      for (const channelId of channelIds) this.channels.followSpace(channelId);
    });
  }

  /** Removes the space. Its channels stay, outside every space, each with the orglets it had. */
  delete(spaceId: string) {
    const spaces = storedSpaces(this.store);
    if (!spaces.some(space => space.id === spaceId)) throw new Error(SPACE_NOT_FOUND);
    const channelIds = this.channels.inSpace(spaceId);
    for (const channelId of channelIds) this.assertChannelIdle(channelId);
    this.store.transaction(() => {
      for (const channelId of channelIds) this.channels.leaveSpace(channelId);
      this.store.setSetting(SPACES, spaces.filter(space => space.id !== spaceId));
    });
  }

  /**
   * Makes a space from a category of channels outside every space. The space takes the category's name and every
   * orglet of those channels; each channel keeps its own list, so no orglet gains a channel it did not have.
   */
  fromCategory(category: string): string {
    const name = category.trim();
    const loose = this.channels.looseInCategory(name);
    if (!loose.length) throw new Error(NO_CHANNEL_IN_CATEGORY);
    for (const channel of loose) this.assertChannelIdle(channel.id);
    const workspace = this.store.workspace();
    const inChannels = new Set(loose.flatMap(channel => channelOrgletIds(channel.members, workspace)));
    // In the order the person keeps their orglets, whichever channel named one first.
    const orgletIds = workspace.workers.map(worker => worker.id).filter(orgletId => inChannels.has(orgletId)).slice(0, MAX_CHANNEL_MEMBERS);
    let spaceId = '';
    this.store.transaction(() => {
      spaceId = this.create({ name, orgletIds, categories: [] });
      for (const channel of loose) this.channels.joinSpace(channel.id, spaceId);
    });
    return spaceId;
  }

  /** The space as it is saved: its orglets listed in the workspace, its categories no wider than the space. */
  private spaceOf(spaceId: string, fields: SpaceFields, current: Space | undefined): Space {
    const listed = new Set(this.store.workspace().workers.map(worker => worker.id));
    if (fields.orgletIds.some(orgletId => !listed.has(orgletId))) throw new Error(ORGLET_NOT_LISTED);
    const inSpace = new Set(fields.orgletIds);
    const known = new Set(current?.categories.map(category => category.id));
    const categories = fields.categories.map(category => {
      if (category.orgletIds?.some(orgletId => !inSpace.has(orgletId))) throw new Error(CATEGORY_WIDER_THAN_SPACE);
      // An id the space does not know is not trusted to name a category: the category is a new one.
      const id = category.id && known.has(category.id) ? category.id : randomUUID();
      return { id, name: category.name, ...(category.orgletIds ? { orgletIds: category.orgletIds } : {}) };
    });
    const color = fields.color?.trim();
    const defaults = fields.defaults === undefined ? current?.defaults : fields.defaults ?? undefined;
    return Space.parse({ id: spaceId, name: fields.name, ...(color ? { color } : {}), orgletIds: fields.orgletIds, categories, ...(defaults ? { defaults } : {}) });
  }
}
