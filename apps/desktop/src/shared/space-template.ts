import { z } from 'zod';
import { ChannelName, CHANNEL_TOPIC_LIMIT } from './channels';
import { MAX_CREW_TEMPLATE_WORKERS } from './crew-limits';
import { MAX_SPACE_CATEGORIES, Space, SpaceCategory } from './spaces';
import { TeamTemplate } from './templates';

/**
 * A space as a marketplace listing carries it (docs/marketplace-design.md): its name, its orglets with their skills,
 * its categories, and its channels, each with its name, its category and who is in it. Orglets and categories are
 * named by keys, as a crew template names its members. It carries no schedule, no permission and no folder: those are
 * the choices of the person who adds it.
 */

const Key = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const MAX_SPACE_TEMPLATE_CHANNELS = 20;

export const SpaceTemplateChannel = z.object({
  name: ChannelName,
  topic: z.string().trim().max(CHANNEL_TOPIC_LIMIT).optional(),
  /** None puts the channel directly in the space. */
  categoryKey: Key.optional(),
  /** None gives the channel every orglet of its place; listed, the channel keeps this list of its own. */
  memberKeys: z.array(Key).min(1).max(MAX_CREW_TEMPLATE_WORKERS).optional(),
}).strict();

export const SpaceTemplate = z.object({
  format: z.literal('orglet-space-template'), version: z.literal(1),
  space: z.object({
    name: Space.shape.name,
    categories: z.array(z.object({ key: Key, name: SpaceCategory.shape.name }).strict()).max(MAX_SPACE_CATEGORIES),
    channels: z.array(SpaceTemplateChannel).min(1).max(MAX_SPACE_TEMPLATE_CHANNELS),
  }).strict(),
  workers: TeamTemplate.shape.workers,
  skills: TeamTemplate.shape.skills,
}).strict();
export type SpaceTemplate = z.infer<typeof SpaceTemplate>;

/** Every key names something the template has, nothing is listed twice, and every orglet and skill is used. */
export function validateSpaceTemplate(template: SpaceTemplate): void {
  const workerKeys = new Set(template.workers.map(worker => worker.key));
  const skillKeys = new Set(template.skills.map(skill => skill.key));
  const categoryKeys = new Set(template.space.categories.map(category => category.key));
  const usedSkills = new Set(template.workers.map(worker => worker.skillKey));
  const channelNames = new Set(template.space.channels.map(channel => channel.name.toLowerCase()));
  const badChannel = template.space.channels.some(channel =>
    (channel.categoryKey !== undefined && !categoryKeys.has(channel.categoryKey))
    || (channel.memberKeys !== undefined && (new Set(channel.memberKeys).size !== channel.memberKeys.length || channel.memberKeys.some(key => !workerKeys.has(key)))));
  if (
    workerKeys.size !== template.workers.length || skillKeys.size !== template.skills.length
    || categoryKeys.size !== template.space.categories.length || channelNames.size !== template.space.channels.length
    || usedSkills.size !== template.skills.length || [...usedSkills].some(key => !skillKeys.has(key))
    || badChannel
  ) {
    throw new Error('Template có key trùng, thiếu hoặc không được sử dụng.');
  }
}
