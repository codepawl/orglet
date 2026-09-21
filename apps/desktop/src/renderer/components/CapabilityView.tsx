import { Check, CircleHelp, LockKeyhole } from 'lucide-react';
import { abilityStatuses, type AbilityState, type WorkAbility } from '../../shared/capability-status';
import type { ToolCapability } from '../../shared/tool-policy';
import type { WorkspaceGrantView } from '../../shared/workspace-access';
import type { Worker } from '../../shared/contracts';
import { t } from '../i18n';

const abilityNames: Record<WorkAbility, string> = {
  sources: 'Đọc nguồn đính kèm',
  dataset: 'Kiểm tra dữ liệu',
  'workspace-read': 'Đọc file trong thư mục làm việc',
  'workspace-write': 'Sửa file trong thư mục làm việc',
  'workspace-execute': 'Chạy lệnh kiểm tra',
  web: 'Đọc và tìm kiếm web',
};

const stateNames: Record<AbilityState, string> = {
  available: 'Dùng được',
  connection: 'Cần kết nối model',
  permission: 'Cần cấp quyền',
  source: 'Cần đính kèm nguồn',
  unsupported: 'Demo chưa hỗ trợ',
  loading: 'Đang tải quyền…',
};

/** One product-language view of the same task capabilities and workspace grant checked by core. */
export function CapabilityView({ provider, connected, capabilities, grant, taskId, grantLoaded = true, sourceCount, setup = false, onConfigure }: {
  provider: Worker['provider'];
  connected: boolean;
  capabilities?: ToolCapability[];
  grant?: WorkspaceGrantView | null;
  taskId?: string;
  grantLoaded?: boolean;
  sourceCount: number;
  setup?: boolean;
  onConfigure?: (provider: Exclude<Worker['provider'], 'demo'>) => void;
}) {
  const rows = abilityStatuses({ provider, connected, capabilities, grant, taskId, grantLoaded, sourceCount });
  return <section className="capability-view" aria-label={t('Tí này làm được gì?')}>
    <h3><CircleHelp size={15} aria-hidden="true" />{t('Tí này làm được gì?')}</h3>
    <p className="muted">{setup ? t('Đính kèm nguồn và chọn quyền trong Chi tiết của cuộc trò chuyện.')
      : t('Trạng thái cho lượt tiếp theo. Đính kèm nguồn trong chat; bật quyền hoặc chọn thư mục bên dưới. Thu hồi quyền chặn thao tác ngay.')}</p>
    <ul className="capability-list">
      {rows.map(({ ability, state }) => <li key={ability}>
        {state === 'available' ? <Check size={14} aria-hidden="true" /> : <LockKeyhole size={14} aria-hidden="true" />}
        <span>{t(abilityNames[ability])}</span><small>{t(stateNames[state])}</small>
      </li>)}
    </ul>
    {onConfigure && provider !== 'demo' && rows.some(row => row.state === 'connection') &&
      <button type="button" className="button button-outline capability-configure" onClick={() => onConfigure(provider)}>{t('Mở cài đặt kết nối')}</button>}
    <details className="capability-explain">
      <summary>{t('Khả năng, kỹ năng và kết nối khác nhau thế nào?')}</summary>
      <p className="muted">{t('Khả năng là việc Tí có thể làm khi được cấp quyền. Kỹ năng và ghi nhớ chỉ hướng dẫn cách làm; chúng không mở thêm quyền. Kết nối chọn nơi model chạy. Hội và lịch chạy quyết định ai làm, khi nào làm.')}</p>
    </details>
  </section>;
}
