import { Database, FileText, FolderOpen, Globe } from 'lucide-react';
import type { ReactNode } from 'react';
import { permissionBlocker, permissionState, workspaceLevels, type PermissionBlocker, type WorkspaceLevel } from '../../shared/capability-status';
import type { ToolCapability } from '../../shared/tool-policy';
import type { NewChatWorkspaceView, WorkspaceGrantView } from '../../shared/workspace-access';
import type { Worker } from '../../shared/contracts';
import { Button } from './ui';
import { Select } from './Select';
import { SwitchField } from './Switch';
import { t, translated } from '../i18n';

export type PermissionWorker = Pick<Worker, 'id' | 'name' | 'provider'> & { connected: boolean };

const levelNames: Record<WorkspaceLevel, string> = translated({
  none: 'Không dùng thư mục',
  read: 'Chỉ đọc file',
  write: 'Đọc và sửa file',
  execute: 'Đọc, sửa file và chạy lệnh',
});

/** One reason for the whole group when no worker in the chat can use any permission. */
const blockedReasons: Record<PermissionBlocker, string> = translated({
  unsupported: 'Tí Demo không dùng công cụ, nên chưa bật được quyền.',
  connection: 'Model chưa kết nối, nên chưa bật được quyền.',
});

/** A team where only some members are blocked keeps its controls; the note names who they will not reach. */
const partlyBlockedNotes: Record<PermissionBlocker, string> = {
  unsupported: 'Không áp dụng cho {0}: Demo không dùng công cụ.',
  connection: 'Không áp dụng cho {0}: model chưa kết nối.',
};

/**
 * The permissions of one chat as controls: three switches for the on/off capabilities and one dropdown for the
 * working folder, whose four levels are the only grants the core can hold (see `WorkspaceLevel`). The parent owns
 * the persisted state and the bridge; this component only shows the current policy and reports what was chosen.
 *
 * A blocker (Demo, a model with no connection, a grant still loading) is never a third position on a control:
 * the control is disabled and one short line says why (user, COD-168).
 */
export function PermissionControls({ workers, capabilities, grant, pending, taskId, sourceCount, busy = false, locked, folderLocked, onCapability, onWorkspace, onConfigure }: {
  workers: PermissionWorker[];
  capabilities?: ToolCapability[];
  /** `undefined` while the grant is still being read. */
  grant: WorkspaceGrantView | null | undefined;
  /** For a chat with no row yet: the folder waiting for its first message (COD-186). */
  pending?: NewChatWorkspaceView;
  taskId?: string;
  sourceCount: number;
  busy?: boolean;
  /** Why nothing here can be changed yet; every control renders disabled with this one line above them. */
  locked?: string;
  /** Why only the folder cannot be kept yet (a worker not saved yet has nothing to keep it under); the switches stay live and the line sits under the dropdown. */
  folderLocked?: string;
  onCapability: (capability: ToolCapability, enabled: boolean) => void;
  onWorkspace: (level: WorkspaceLevel) => void;
  onConfigure?: (provider: Exclude<Worker['provider'], 'demo'>) => void;
}) {
  const state = permissionState({ provider: workers[0]?.provider ?? 'demo', capabilities, grant, pending, taskId });
  const blocked = workers.map(worker => ({ worker, blocker: permissionBlocker(worker.provider, worker.connected) }))
    .filter((item): item is { worker: PermissionWorker; blocker: PermissionBlocker } => item.blocker !== undefined);
  const everyoneBlocked = workers.length > 0 && blocked.length === workers.length;
  // A connection can be opened; Demo cannot, so that reason wins only when nobody is merely disconnected.
  const groupBlocker = everyoneBlocked ? (blocked.find(item => item.blocker === 'connection')?.blocker ?? 'unsupported') : undefined;
  const disconnected = blocked.find(item => item.blocker === 'connection')?.worker.provider;
  const loading = grant === undefined;
  const disabled = busy || locked !== undefined || everyoneBlocked;
  const folderDisabled = disabled || loading || folderLocked !== undefined;

  let reason: ReactNode = null;
  if (locked !== undefined) reason = locked;
  else if (groupBlocker) reason = blockedReasons[groupBlocker];
  else if (blocked.length > 0) {
    const byBlocker = (blocker: PermissionBlocker) => blocked.filter(item => item.blocker === blocker).map(item => item.worker.name);
    reason = (['unsupported', 'connection'] as const).filter(blocker => byBlocker(blocker).length > 0)
      .map(blocker => t(partlyBlockedNotes[blocker], [byBlocker(blocker).join(', ')])).join(' ');
  }

  return <div className="permissions" aria-busy={busy || undefined}>
    {reason && <p className="permissions-reason">
      <span>{reason}</span>
      {onConfigure && disconnected && disconnected !== 'demo' && <Button variant="outline" onClick={() => onConfigure(disconnected)}>{t('Mở cài đặt kết nối')}</Button>}
    </p>}
    <SwitchField checked={state.sources} disabled={disabled} onChange={enabled => onCapability('source.read', enabled)}
      description={<>
        {t('Chỉ đọc nguồn được đính kèm trong chat; không cho phép sửa file gốc.')}
        {taskId && sourceCount === 0 && <span className="permission-note">{t('Chat chưa có nguồn nào để đọc.')}</span>}
      </>}>
      <FileText size={15} aria-hidden="true" />{t('Đọc nguồn đính kèm')}
    </SwitchField>
    <SwitchField checked={state.dataset} disabled={disabled} onChange={enabled => onCapability('dataset.check', enabled)}
      description={t('Cho phép kiểm tra cấu trúc và chất lượng nguồn dữ liệu đã đính kèm. Không cho phép chạy script.')}>
      <Database size={15} aria-hidden="true" />{t('Kiểm tra dữ liệu')}
    </SwitchField>
    <div className={`permission-folder${folderDisabled ? ' permission-folder-disabled' : ''}`}>
      <span className="permission-folder-text">
        <span className="permission-folder-title"><FolderOpen size={15} aria-hidden="true" />{t('Thư mục làm việc')}</span>
        <span className="permission-folder-description">{t('Tí làm trên bản sao riêng của thư mục; file gốc chỉ đổi sau khi Tí trả lời xong. Đổi mức sẽ chọn lại thư mục.')}</span>
      </span>
      <span className="permission-folder-control">
        <Select ariaLabel={t('Thư mục làm việc')} size="sm" value={state.workspace} disabled={folderDisabled}
          onChange={value => onWorkspace(value as WorkspaceLevel)}
          options={workspaceLevels.map(level => ({ value: level, label: levelNames[level] }))} />
        {folderLocked !== undefined ? <span className="permission-folder-name permission-folder-pending">{folderLocked}</span>
          : loading ? <span className="permission-folder-name permission-folder-pending">{t('Đang tải quyền…')}</span>
          : state.folder && <span className="permission-folder-name"><FolderOpen size={13} aria-hidden="true" />{state.folder}</span>}
      </span>
    </div>
    <SwitchField checked={state.web} disabled={disabled} onChange={enabled => onCapability('network.web', enabled)}
      description={t('Cho phép đọc URL công khai và gửi truy vấn tìm kiếm. Không mở mạng cho lệnh trong thư mục.')}>
      <Globe size={15} aria-hidden="true" />{t('Đọc và tìm kiếm web')}
    </SwitchField>
    <p className="muted permission-footnote">{t('Quyền mới áp dụng cho lần chạy chưa bắt đầu, kể cả phần việc còn chờ trong lượt này. Thu hồi quyền sẽ dừng công việc đang chạy.')}</p>
  </div>;
}
