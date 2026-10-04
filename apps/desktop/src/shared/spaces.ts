import { z } from 'zod';
import type { ToolCapability } from './tool-policy';
import { CHANNEL_CATEGORY_LIMIT, MAX_CHANNEL_MEMBERS, type Channel, type ChannelAccess, type ChannelMember } from './channels';

/**
 * Spaces (docs/spaces-design.md). A space is a named group of orglets that holds categories and channels, the way a
 * Discord server does. Who is in a channel narrows from the top down: the space lists its orglets, a category takes
 * all of them or some, and a channel takes all of its category's (or its space's) or some. Nothing widens on the way
 * down, and an orglet taken out of a space leaves every channel in it.
 *
 * A channel outside every space keeps its own list, as before spaces. The orglets that answer stay the chat row's
 * `assignees`, resolved by core whenever a space or a channel is saved, so the runner reads a channel as it always did.
 */

export const SPACE_NAME_LIMIT = 80;
export const MAX_SPACES = 50;
export const MAX_SPACE_CATEGORIES = 50;

const OrgletIds = z.array(z.uuid()).max(MAX_CHANNEL_MEMBERS)
  .refine(ids => new Set(ids).size === ids.length, 'Tí bị trùng.');

export const SpaceCategory = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, 'Mục cần một tên.').max(CHANNEL_CATEGORY_LIMIT),
  /** Left out, the category takes every orglet of its space; listed, only these, each one an orglet of the space. */
  orgletIds: OrgletIds.optional(),
}).strict();
export type SpaceCategory = z.infer<typeof SpaceCategory>;

/**
 * The permissions a space can set for a new channel in it: the switches with nothing to pick for each chat. The
 * browser, desktop apps and the working folder stay each chat's own choice, since they name sites, programs and a
 * folder on this computer.
 */
export const SPACE_DEFAULT_CAPABILITIES = ['source.read', 'dataset.check', 'network.web'] as const;
export type SpaceDefaultCapability = (typeof SPACE_DEFAULT_CAPABILITIES)[number];

export const SpaceDefaults = z.object({
  capabilities: z.array(z.enum(SPACE_DEFAULT_CAPABILITIES)).max(SPACE_DEFAULT_CAPABILITIES.length)
    .refine(capabilities => new Set(capabilities).size === capabilities.length, 'Quyền công cụ bị trùng.'),
}).strict();
export type SpaceDefaults = z.infer<typeof SpaceDefaults>;

export const Space = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, 'Không gian cần một tên.').max(SPACE_NAME_LIMIT),
  /** The colour of the space's tile; none takes the app's default. */
  color: z.string().trim().max(32).optional(),
  orgletIds: OrgletIds.min(1, 'Không gian cần ít nhất một Tí.'),
  categories: z.array(SpaceCategory).max(MAX_SPACE_CATEGORIES)
    .refine(categories => new Set(categories.map(category => category.id)).size === categories.length, 'Mục bị trùng.'),
  /** What a new channel in the space starts with; none leaves a new channel the app's own defaults. */
  defaults: SpaceDefaults.optional(),
}).strict();
export type Space = z.infer<typeof Space>;

/**
 * The permissions a new channel of this space starts with, when the space sets any and the person chose none for
 * that channel: the two every chat has, then the space's switches.
 */
export function spaceChatCapabilities(space: Pick<Space, 'defaults'> | undefined): ToolCapability[] | undefined {
  if (!space?.defaults) return undefined;
  return ['skill.read', 'app.propose', ...space.defaults.capabilities];
}

/** What the create and edit commands take. A category without an id is a new one. */
export const SpaceFields = z.object({
  name: Space.shape.name,
  color: Space.shape.color,
  orgletIds: Space.shape.orgletIds,
  categories: z.array(SpaceCategory.extend({ id: z.uuid().optional() }).strict()).max(MAX_SPACE_CATEGORIES).default([]),
  /** Left out keeps what the space has; `null` goes back to the app's own defaults. */
  defaults: SpaceDefaults.nullable().optional(),
}).strict();
export type SpaceFields = z.infer<typeof SpaceFields>;

/** The orglets a category of this space has, in the space's order. An unknown category has none. */
export function categoryOrgletIds(space: Space, categoryId: string): string[] {
  const category = space.categories.find(item => item.id === categoryId);
  if (!category) return [];
  if (!category.orgletIds) return [...space.orgletIds];
  const listed = new Set(category.orgletIds);
  return space.orgletIds.filter(orgletId => listed.has(orgletId));
}

/** The orglets a channel placed here can have at most: its category's, or its space's when it has no category. */
export function scopeOrgletIds(space: Space, categoryId: string | undefined): string[] {
  return categoryId ? categoryOrgletIds(space, categoryId) : [...space.orgletIds];
}

type PlacedChannel = Pick<Channel, 'members'> & { categoryId?: string; access?: ChannelAccess };

/**
 * The members of a channel in this space once the space's rules are applied: every orglet of its scope when it
 * inherits, else the listed orglets its scope still has, in the order the channel listed them.
 */
export function membersInSpace(channel: PlacedChannel, space: Space): ChannelMember[] {
  const scope = scopeOrgletIds(space, channel.categoryId);
  if ((channel.access ?? 'inherit') === 'inherit') return scope.map(orgletId => ({ kind: 'orglet', id: orgletId }));
  const allowed = new Set(scope);
  return channel.members.filter(member => member.kind === 'orglet' && allowed.has(member.id));
}

/** The listed members a scope does not have, which a save must refuse so that nothing widens on the way down. */
export function membersOutsideScope(members: readonly ChannelMember[], scope: readonly string[]): ChannelMember[] {
  const allowed = new Set(scope);
  return members.filter(member => member.kind !== 'orglet' || !allowed.has(member.id));
}
