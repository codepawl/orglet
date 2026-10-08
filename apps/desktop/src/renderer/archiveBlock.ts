import { channelLabel } from '../shared/channels';
import { removalBlocker } from '../shared/removal';
import type { Team } from '../shared/contracts';
import { t } from './i18n';

type CrewRow = Pick<Team, 'id' | 'name' | 'memberIds' | 'synthesizerId'>;

/** What stands between an orglet and "delete for good", said before the person confirms instead of after. */
export type DeleteBlock = {
  /** The question the confirmation shows in place of "Delete X?". */
  question: string;
  /** The way out the confirmation offers in place of its Delete button. */
  actionLabel: string;
  /** The channel to open: the first one the orglet is in. */
  crewId: string;
};

/**
 * An orglet that is still in a channel where a lead splits the work cannot be deleted: the core refuses with "Remove it
 * from the channel first". The archive row reads the same answer (`removalBlocker`) up front, so the confirmation names
 * the channel and offers to open it, and never offers a Delete that is bound to fail.
 */
export function deleteBlockedByChannels(teams: readonly CrewRow[], workerId: string, workerName: string): DeleteBlock | undefined {
  // Only the channels are asked about here; a schedule that runs the orglet has its own message before the core is asked.
  const blocker = removalBlocker({ teams, routines: [] }, 'worker', workerId);
  if (blocker?.kind !== 'crews') return undefined;
  const names = blocker.crews.map(crew => channelLabel(crew.name));
  const question = names.length === 1
    ? t('{0} đang ở trong {1}. Bỏ Tí này khỏi kênh trước khi xóa.', [workerName, names[0]])
    : t('{0} đang ở trong {1} kênh: {2}. Bỏ Tí này khỏi các kênh đó trước khi xóa.', [workerName, names.length, names.join(', ')]);
  return { question, actionLabel: t('Mở {0}', [names[0]]), crewId: blocker.crews[0].id };
}
