import type { ApprovalMode, ChangesMode, FolderNeed } from '../shared/approval-mode';
import type { DecisionModelSettingView } from '../shared/decisions';
import type { ApprovedBy } from '../shared/tool-policy';
import { t, translated } from './i18n';

/** One row's state: why it cannot be chosen here, or what choosing it asks for first. */
export type ModeRowState = { locked?: string; folderNeed?: FolderNeed; decisionModelMissing?: boolean };

export const modeNames: Record<ApprovalMode, string> = translated({
  auto: 'Tự duyệt',
  manual: 'Thủ công',
  acceptEdits: 'Nhận thay đổi tệp',
  plan: 'Lên kế hoạch',
  bypass: 'Bỏ qua quyền',
});

const modeNotes: Record<ApprovalMode, string> = translated({
  auto: 'Model nhẹ tự duyệt',
  manual: 'Hỏi trước khi thay đổi',
  acceptEdits: 'Tự nhận thay đổi tệp',
  plan: 'Chỉ đọc và lên kế hoạch',
  bypass: 'Không hỏi gì',
});

const folderNeedNotes: Record<Exclude<FolderNeed, undefined>, string> = translated({
  pick: 'Cần thư mục',
  edit: 'Cần quyền sửa',
});

/** The one short line under a mode's name: why it is locked, what it needs first, or what it does. */
export function modeRowNote(mode: ApprovalMode, state: ModeRowState): string {
  if (state.locked !== undefined) return state.locked;
  if (state.folderNeed) return folderNeedNotes[state.folderNeed];
  if (mode === 'auto' && state.decisionModelMissing) return t('Chưa có model quyết định');
  return modeNotes[mode];
}

/** Whether no decision model is connected. A window that has not heard from the core yet says nothing. */
export function decisionModelMissing(setting: DecisionModelSettingView | undefined): boolean {
  return setting !== undefined && setting.entries.length === 0;
}

/** Bypass asks once before it is turned on; a chat already in Bypass (with Plan on top, say) is not asked again. */
export function needsBypassConfirmation(chosen: ApprovalMode, currentChanges: ChangesMode): boolean {
  return chosen === 'bypass' && currentChanges !== 'bypass';
}

/** The muted label after a browser or desktop step that Auto or Bypass allowed; a person's answer or no question adds none. */
export function approvedByLabel(approvedBy: ApprovedBy | null | undefined): string | undefined {
  if (approvedBy === 'auto') return modeNames.auto;
  if (approvedBy === 'bypass') return modeNames.bypass;
  return undefined;
}
