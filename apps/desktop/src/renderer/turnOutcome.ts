import { UNASSIGNED_PLAN_ERROR, type Run } from '../shared/contracts';
import { t, tMessage } from './i18n';

/** The error the core gives a run that was stopped. */
const CANCELLED_ERROR = 'Đã hủy.';

/**
 * What became of a turn that ended without an answer, as one calm line kept in the history (COD-290). Before, every
 * such turn said "No reply to this message yet." once a newer message came, so a permission error or a failed write
 * read like a turn still waiting. `headline` is the run whose error the turn would show (the thread picks it the same
 * way for the latest turn's card); `text` is the whole line, `detail` the error part of it for a tooltip.
 */
export function unansweredTurnLine(runs: readonly Run[], headline: Run | undefined): { text: string; detail?: string } {
  const counted = runs.filter(run => run.error !== UNASSIGNED_PLAN_ERROR);
  const last = counted.at(-1);
  if (counted.some(run => run.status === 'interrupted')) return { text: t('Lượt này dừng giữa chừng vì app đã đóng.') };
  if (last?.status === 'cancelled' || headline?.error === CANCELLED_ERROR) return { text: t('Lượt này đã dừng trước khi trả lời.') };
  if (last?.status === 'waiting_input') return { text: t('Lượt này đã dừng khi đang chờ bạn.') };
  if (last?.status === 'waiting_budget') return { text: t('Lượt này dừng vì hết ngân sách.') };
  if (last?.status === 'paused') return { text: t('Lượt này đã tạm dừng trước khi trả lời.') };
  if (headline?.error) {
    const detail = tMessage(headline.error);
    return { text: t('Lượt này không xong: {0}', [detail]), detail };
  }
  if (last?.status === 'failed' || last?.status === 'partial') return { text: t('Lượt này không xong.') };
  return { text: t('Chưa có câu trả lời cho tin nhắn này.') };
}
