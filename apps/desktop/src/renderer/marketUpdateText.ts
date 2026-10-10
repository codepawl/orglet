import type { MarketUpdateBlock, MarketWidening } from '../shared/market';
import { t } from './i18n';

/** One thing an update would let an installed copy do or spend beyond what it may now. */
export function wideningText(widening: MarketWidening): string {
  if (widening.kind === 'new-orglet') return t('Có thêm Tí mới: {0}', [widening.name]);
  if (widening.kind === 'task-budget') return t('Nâng hoặc bỏ giới hạn chi mỗi lần của {0}', [widening.name]);
  if (widening.kind === 'monthly-budget') return t('Nâng ngân sách tháng của {0}', [widening.name]);
  if (widening.kind === 'concurrency') return t('Cho {0} chạy nhiều việc cùng lúc hơn', [widening.name]);
  if (widening.kind === 'skill-files') return t('Kỹ năng {0} có tệp đi kèm mới', [widening.name]);
  return t('Đổi quy tắc chạy của {0}', [widening.name]);
}

/** Why an update is left for the person even when marketplace updates are automatic. */
export function blockText(block: MarketUpdateBlock): string {
  if (block === 'widening') return t('Bản mới mở rộng những gì mục này được làm hoặc được chi, nên cần bạn xem trước.');
  if (block === 'customized') return t('Bạn đã chỉnh sửa bản này, nên cần bạn xem bản so sánh trước.');
  return t('Orglet không biết bản này đã được chỉnh sửa chưa, nên cần bạn xem bản so sánh trước.');
}
