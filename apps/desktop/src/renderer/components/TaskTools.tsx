import { useState } from 'react';
import { Database, FileText, FolderOpen, Globe, ShieldCheck, ShieldOff } from 'lucide-react';
import type { WorkspaceGrantView, WorkspacePermission } from '../../shared/workspace-access';
import { t } from '../i18n';
import { Button } from './ui';
import { Select } from './Select';
import { SwitchField } from './Switch';

/** Task permission controls; the parent supplies persisted state and handles the bridge. */
export function TaskTools({ grant, sourceEnabled, networkEnabled, datasetEnabled, supported, busy, onGrant, onRevoke, onSourceChange, onNetworkChange, onDatasetChange }: {
  grant: WorkspaceGrantView | null | undefined;
  sourceEnabled: boolean;
  networkEnabled: boolean;
  datasetEnabled: boolean;
  supported: boolean;
  busy: boolean;
  onGrant: (permissions: WorkspacePermission[]) => void;
  onRevoke: () => void;
  onSourceChange: (enabled: boolean) => void;
  onNetworkChange: (enabled: boolean) => void;
  onDatasetChange: (enabled: boolean) => void;
}) {
  const [mode, setMode] = useState('read');
  const active = grant && !grant.revoked;
  const loaded = grant !== undefined;
  const modes = [
    { value: 'read', label: t('Chỉ đọc file'), icon: <FolderOpen size={15} /> },
    { value: 'write', label: t('Đọc và sửa file'), icon: <FolderOpen size={15} /> },
    { value: 'execute', label: t('Đọc, sửa file và chạy lệnh'), icon: <FolderOpen size={15} /> },
  ];
  const grantLabel = active ? modes.find(option => option.value === (grant.permissions.includes('execute') ? 'execute'
    : grant.permissions.includes('write') ? 'write' : 'read'))!.label : undefined;
  return <section className="details-section task-tools" aria-labelledby="task-tools-heading" aria-busy={busy}>
    <h3 id="task-tools-heading"><ShieldCheck size={15} aria-hidden="true" />{t('Quyền công cụ')}</h3>
    {!supported && <p className="muted">{t('Nhân viên Demo chưa dùng được tools workspace và web. Chọn kết nối API hoặc harness đã đăng nhập.')}</p>}
    <div className="task-tool-group">
      <SwitchField checked={sourceEnabled} onChange={onSourceChange} disabled={busy || (!supported && !sourceEnabled)}
        description={t('Chỉ đọc nguồn được đính kèm trong chat; không cho phép sửa file gốc.')}>
        <FileText size={15} aria-hidden="true" />{t('Đọc nguồn đính kèm')}
      </SwitchField>
    </div>
    <div className="task-tool-group">
      <p className="task-tool-folder"><FolderOpen size={15} aria-hidden="true" />
        {active ? grant.name : loaded ? t('Chưa cấp thư mục làm việc') : t('Đang tải quyền…')}
      </p>
      {grantLabel && <p className="muted">{grantLabel}</p>}
      <Select ariaLabel={t('Quyền cho thư mục được chọn')} size="sm" value={mode} onChange={setMode} options={modes}
        disabled={busy || !loaded || !supported} />
      <div className="task-tool-actions">
        <Button variant="outline" disabled={busy || !loaded || !supported} onClick={() =>
          onGrant(mode === 'execute' ? ['read', 'write', 'execute'] : mode === 'write' ? ['read', 'write'] : ['read'])}>
          <FolderOpen size={15} />{active ? t('Đổi thư mục hoặc quyền') : t('Chọn thư mục làm việc')}
        </Button>
        {active && <Button disabled={busy} onClick={onRevoke}><ShieldOff size={15} />{t('Thu hồi quyền thư mục')}</Button>}
      </div>
      <p className="muted">{t('Nhân viên tự thao tác trong phạm vi đã cấp. Tệp đính kèm chỉ là nguồn đọc.')}</p>
    </div>
    <div className="task-tool-group">
      <SwitchField checked={datasetEnabled} onChange={onDatasetChange} disabled={busy || (!supported && !datasetEnabled)}
        description={t('Cho phép kiểm tra cấu trúc và chất lượng nguồn dữ liệu đã đính kèm. Không cho phép chạy script.')}>
        <Database size={15} aria-hidden="true" />{t('Kiểm tra dữ liệu')}
      </SwitchField>
    </div>
    <div className="task-tool-group">
      <SwitchField checked={networkEnabled} onChange={onNetworkChange} disabled={busy || (!supported && !networkEnabled)}
        description={t('Cho phép đọc URL công khai và gửi truy vấn tìm kiếm. Không mở mạng cho lệnh trong thư mục.')}>
        <Globe size={15} aria-hidden="true" />{t('Đọc và tìm kiếm web')}
      </SwitchField>
    </div>
    <p className="muted">{t('Quyền mới áp dụng cho lượt chạy mới. Thu hồi quyền sẽ dừng công việc đang chạy.')}</p>
  </section>;
}
