import { AppWindow, Database, FileText, FolderOpen, Globe, Lightbulb, MonitorSmartphone } from 'lucide-react';
import type { ReactNode } from 'react';
import { permissionBlocker, permissionState, workspaceLevels, type PermissionBlocker, type WorkspaceLevel } from '../../shared/capability-status';
import type { ToolCapability } from '../../shared/tool-policy';
import type { NewChatWorkspaceView, WorkspaceGrantView } from '../../shared/workspace-access';
import type { Worker } from '../../shared/contracts';
import { WEB_SEARCH_PROVIDER_NAMES, type WebSearchProvider } from '../../shared/web-tools';
import { Button } from './ui';
import { Select } from './Select';
import { SwitchField } from './Switch';
import { Skeleton } from '@codepawl/orglet-ui';
import { t, translated } from '../i18n';
import { browserLevels, type BrowserLevel } from '../../shared/browser';
import { desktopLevels, type DesktopLevel } from '../../shared/desktop';

export type PermissionWorker = Pick<Worker, 'id' | 'name' | 'provider'> & { connected: boolean };

const levelNames: Record<WorkspaceLevel, string> = translated({
  none: 'Không dùng thư mục',
  read: 'Chỉ đọc file',
  write: 'Đọc và sửa file',
  execute: 'Đọc, sửa file và chạy lệnh',
});

/** Cumulative like the folder: "read and act" includes reading (COD-261). */
const browserLevelNames: Record<BrowserLevel, string> = translated({
  none: 'Không dùng trình duyệt',
  read: 'Đọc trang',
  act: 'Đọc và thao tác',
});

/**
 * The one capability switch that moves the browser from `current` to `level`; `withCapability` keeps the levels
 * cumulative, so acting brings reading and turning reading off takes acting with it.
 */
function browserLevelChange(current: BrowserLevel, level: BrowserLevel): { capability: ToolCapability; enabled: boolean } {
  if (level === 'none') return { capability: 'browser.read', enabled: false };
  if (level === 'act') return { capability: 'browser.act', enabled: true };
  if (current === 'act') return { capability: 'browser.act', enabled: false };
  return { capability: 'browser.read', enabled: true };
}

/** Desktop apps take the same cumulative levels (COD-261, phase 2a). */
const desktopLevelNames: Record<DesktopLevel, string> = translated({
  none: 'Không dùng ứng dụng',
  read: 'Đọc cửa sổ',
  act: 'Đọc và thao tác',
});

function desktopLevelChange(current: DesktopLevel, level: DesktopLevel): { capability: ToolCapability; enabled: boolean } {
  if (level === 'none') return { capability: 'desktop.read', enabled: false };
  if (level === 'act') return { capability: 'desktop.act', enabled: true };
  if (current === 'act') return { capability: 'desktop.act', enabled: false };
  return { capability: 'desktop.read', enabled: true };
}

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
export function PermissionControls({ workers, capabilities, grant, pending, taskId, sourceCount, searchProvider, busy = false, locked, folderLocked, browserProfile, browserChoices = browserLevels, desktopShown = true, desktopAvailable = true, desktopApps, onCapability, onWorkspace, onConfigure, extra }: {
  workers: PermissionWorker[];
  capabilities?: ToolCapability[];
  /** `undefined` while the grant is still being read. */
  grant: WorkspaceGrantView | null | undefined;
  /** For a chat with no row yet: the folder waiting for its first message (COD-186). */
  pending?: NewChatWorkspaceView;
  taskId?: string;
  sourceCount: number;
  /** Where a search goes (Settings → Web search), named under the web switch so the person knows who sees the query (COD-266). */
  searchProvider: WebSearchProvider;
  busy?: boolean;
  /** Why nothing here can be changed yet; every control renders disabled with this one line above them. */
  locked?: string;
  /** Why only the folder cannot be kept yet (a worker not saved yet has nothing to keep it under); the switches stay live and the line sits under the dropdown. */
  folderLocked?: string;
  /** The name of the browser profile the chat reads pages with, shown under the browser level like a folder's name. */
  browserProfile?: string;
  /** The browser levels on offer: a schedule's run reads pages and never acts on them. */
  browserChoices?: readonly BrowserLevel[];
  /** Whether the desktop apps row is shown at all: a schedule never uses desktop apps (COD-261, phase 2a). */
  desktopShown?: boolean;
  /** Whether desktop apps work on this computer (Windows only); elsewhere the row is disabled with one line saying so. */
  desktopAvailable?: boolean;
  /** How many desktop apps the chat granted, shown under the level like a folder's name. */
  desktopApps?: number;
  /** Reports one capability turned on or off; the parent keeps the browser's levels cumulative with `withCapability`. */
  onCapability: (capability: ToolCapability, enabled: boolean) => void;
  onWorkspace: (level: WorkspaceLevel) => void;
  onConfigure?: (provider: Exclude<Worker['provider'], 'demo'>) => void;
  /** A setting that belongs with these switches but is saved elsewhere (the orglet's own auto-apply), listed before the footnote. */
  extra?: ReactNode;
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
        {t('Đọc các tệp đính kèm trong chat này.')}
        {taskId && sourceCount === 0 && <span className="permission-note">{t('Chat chưa có nguồn nào để đọc.')}</span>}
      </>}>
      <FileText size={15} aria-hidden="true" />{t('Đọc nguồn đính kèm')}
    </SwitchField>
    <SwitchField checked={state.dataset} disabled={disabled} onChange={enabled => onCapability('dataset.check', enabled)}
      description={t('Kiểm tra cấu trúc dữ liệu đã đính kèm.')}>
      <Database size={15} aria-hidden="true" />{t('Kiểm tra dữ liệu')}
    </SwitchField>
    <div className={`permission-folder${folderDisabled ? ' permission-folder-disabled' : ''}`}>
      <span className="permission-folder-text">
        <span className="permission-folder-title"><FolderOpen size={15} aria-hidden="true" />{t('Thư mục làm việc')}</span>
        <span className="permission-folder-description">{t('Làm trên bản sao riêng của thư mục.')}</span>
      </span>
      <span className="permission-folder-control">
        <Select ariaLabel={t('Thư mục làm việc')} size="sm" value={state.workspace} disabled={folderDisabled}
          onChange={value => onWorkspace(value as WorkspaceLevel)}
          options={workspaceLevels.map(level => ({ value: level, label: levelNames[level] }))} />
        {folderLocked !== undefined ? <span className="permission-folder-name permission-folder-pending">{folderLocked}</span>
          : loading ? <span className="permission-folder-name permission-folder-pending"><Skeleton width="12ch" /></span>
          : state.folder && <span className="permission-folder-name">
            <FolderOpen size={13} aria-hidden="true" />{state.folder}
            {/* Picking again at the same level swaps the folder in one step; cancelling the picker keeps the old one. */}
            {!folderDisabled && <> · <button type="button" className="text-link" aria-label={t('Đổi thư mục làm việc {0}', [state.folder])}
              onClick={() => onWorkspace(state.workspace)}>{t('Đổi')}</button></>}
          </span>}
      </span>
    </div>
    <SwitchField checked={state.web} disabled={disabled} onChange={enabled => onCapability('network.web', enabled)}
      description={t('Tìm qua {0}, đọc trang web công khai.', [WEB_SEARCH_PROVIDER_NAMES[searchProvider]])}>
      <Globe size={15} aria-hidden="true" />{t('Đọc và tìm kiếm web')}
    </SwitchField>
    {/* Orglet's own browser (COD-261): a level like the folder's, so reading and acting share one control. */}
    <div className={`permission-folder${disabled ? ' permission-folder-disabled' : ''}`}>
      <span className="permission-folder-text">
        <span className="permission-folder-title"><AppWindow size={15} aria-hidden="true" />{t('Trình duyệt')}</span>
        <span className="permission-folder-description">{state.browser === 'act'
          ? t('Bấm, gõ và chọn trên trang; hỏi bạn trước khi gửi, trả tiền hay xóa.')
          : t('Mở và đọc trang trong cửa sổ riêng của Orglet.')}</span>
      </span>
      <span className="permission-folder-control">
        <Select ariaLabel={t('Trình duyệt')} size="sm" value={state.browser} disabled={disabled}
          onChange={value => {
            const change = browserLevelChange(state.browser, value as BrowserLevel);
            onCapability(change.capability, change.enabled);
          }}
          options={browserChoices.map(level => ({ value: level, label: browserLevelNames[level] }))} />
        {state.browser !== 'none' && browserProfile && <span className="permission-folder-name"><AppWindow size={13} aria-hidden="true" />{t('Hồ sơ {0}', [browserProfile])}</span>}
      </span>
    </div>
    {/* Desktop apps (COD-261, phase 2a): a level like the browser's; the apps themselves are picked in Details. */}
    {desktopShown && <div className={`permission-folder${disabled || !desktopAvailable ? ' permission-folder-disabled' : ''}`}>
      <span className="permission-folder-text">
        <span className="permission-folder-title"><MonitorSmartphone size={15} aria-hidden="true" />{t('Ứng dụng trên máy')}</span>
        <span className="permission-folder-description">{!desktopAvailable ? t('Chỉ có trên Windows.')
          : state.desktop === 'act' ? t('Bấm, nhập và chọn trong ứng dụng bạn cấp; hỏi bạn trước khi gửi, lưu đè hay xóa.')
          : t('Đọc cửa sổ của ứng dụng bạn cấp, không dùng chuột thật.')}</span>
      </span>
      <span className="permission-folder-control">
        <Select ariaLabel={t('Ứng dụng trên máy')} size="sm" value={state.desktop} disabled={disabled || !desktopAvailable}
          onChange={value => {
            const change = desktopLevelChange(state.desktop, value as DesktopLevel);
            onCapability(change.capability, change.enabled);
          }}
          options={desktopLevels.map(level => ({ value: level, label: desktopLevelNames[level] }))} />
        {desktopAvailable && state.desktop !== 'none' && desktopApps !== undefined && <span className="permission-folder-name">
          <MonitorSmartphone size={13} aria-hidden="true" />{desktopApps === 0 ? t('Chưa cấp ứng dụng nào') : desktopApps === 1 ? t('1 ứng dụng') : t('{0} ứng dụng', [desktopApps])}
        </span>}
      </span>
    </div>}
    {/* Proposing is not doing: the switch lets the worker store a card, and the card still waits for Apply (COD-199). */}
    <SwitchField checked={state.propose} disabled={disabled} onChange={enabled => onCapability('app.propose', enabled)}
      description={t('Đề xuất Tí, hội, skill và cài đặt mới.')}>
      <Lightbulb size={15} aria-hidden="true" />{t('Đề xuất thay đổi trong app')}
    </SwitchField>
    {extra}
    <p className="muted permission-footnote">{t('Áp dụng từ lần chạy kế tiếp; tắt quyền sẽ dừng việc đang dùng nó.')}</p>
  </div>;
}
