import { AppWindow, FolderOpen, Globe, X } from 'lucide-react';
import type { WorkspaceLevel } from '../../shared/capability-status';
import type { PermissionNeed } from '../../shared/permission-needs';
import { t } from '../i18n';

/**
 * The one quiet line under a message box when the decision model reads the message as needing a permission the chat does not have
 * (COD-305). Its link does what the permission's own control in Details would do (turn the web on, pick a folder, let
 * the folder be edited or run commands) or opens that control (the browser, whose level is the person's call). It
 * never turns anything on by itself, never stops a message from being sent, and ✕ puts it away for this chat.
 */
export function PermissionHint({ need, folder, disabled, onApply, onDismiss }: {
  need: PermissionNeed;
  /** The chat's folder level now: with a folder, a level change needs no picker, so the words and the link say so. */
  folder: WorkspaceLevel;
  disabled?: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const { icon, sentence, action } = hintWords(need, folder);
  return <p className="composer-note permission-hint" role="status">
    {icon}
    <span>{sentence}</span>
    <button type="button" className="text-link" disabled={disabled} onClick={onApply}>{action}</button>
    <button type="button" className="permission-hint-dismiss" aria-label={t('Ẩn gợi ý quyền')} title={t('Ẩn gợi ý quyền')} onClick={onDismiss}>
      <X size={13} aria-hidden="true" />
    </button>
  </p>;
}

function hintWords(need: PermissionNeed, folder: WorkspaceLevel) {
  if (need === 'web') return {
    icon: <Globe size={13} aria-hidden="true" />,
    sentence: t('Tin nhắn này có vẻ cần web, mà chat chưa bật web.'),
    action: t('Bật web'),
  };
  if (need === 'browser') return {
    icon: <AppWindow size={13} aria-hidden="true" />,
    sentence: t('Tin nhắn này có vẻ cần trình duyệt của Orglet, mà chat chưa bật.'),
    action: t('Chọn quyền trình duyệt'),
  };
  const icon = <FolderOpen size={13} aria-hidden="true" />;
  if (folder === 'none') return {
    icon,
    sentence: need === 'read' ? t('Tin nhắn này có vẻ cần đọc file trong một thư mục.')
      : need === 'write' ? t('Tin nhắn này có vẻ cần sửa file trong một thư mục.')
      : t('Tin nhắn này có vẻ cần chạy lệnh trong một thư mục.'),
    action: t('Chọn thư mục'),
  };
  if (need === 'write') return { icon, sentence: t('Tin nhắn này có vẻ cần sửa file, mà thư mục chỉ cho đọc.'), action: t('Cho phép sửa file') };
  return { icon, sentence: t('Tin nhắn này có vẻ cần chạy lệnh, mà thư mục chưa cho chạy lệnh.'), action: t('Cho phép chạy lệnh') };
}
