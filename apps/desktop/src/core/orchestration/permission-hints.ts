import type { Language } from '../../shared/i18n';
import { translate } from '../../shared/i18n';
import { en, enGB } from '../../shared/locales/en';
import type { ToolCapability } from '../../shared/tool-policy';
import type { WorkspacePermission } from '../../shared/workspace-access';

/**
 * The permissions a chat has turned off, named the way the person sees them in the chat's Details (COD-257). Asked
 * to open a link with the web and the browser both off, an orglet used to answer "paste the page text", leaving the
 * person to do the work by hand when one switch would have let the orglet do it.
 */
export const PERMISSIONS_OFF_INSTRUCTION = 'These permissions are off in this chat, named as the person sees them. If the request needs one of them, say in one sentence which one to turn on and where, then do what you can without it.';

type HintInput = {
  capabilities: readonly ToolCapability[];
  workspacePermissions: readonly WorkspacePermission[] | undefined;
  language: Language;
  sideThread: boolean;
  /** A schedule's run: its browser can never act, so acting is not a switch to point at. */
  schedule?: boolean;
};

/** Vietnamese labels as the controls show them; the dictionary gives the English ones. */
const SWITCH_LABELS: Partial<Record<ToolCapability, string>> = {
  'source.read': 'Đọc nguồn đính kèm',
  'dataset.check': 'Kiểm tra dữ liệu',
  'network.web': 'Đọc và tìm kiếm web',
};

function dictionaryFor(language: Language) {
  if (language === 'vi') return null;
  return language === 'en-GB' ? enGB : en;
}

/** One line per permission that is off, or none when everything the controls offer is on. */
export function permissionsOff(input: HintInput): { permissions: string[]; where: string } | null {
  const dictionary = dictionaryFor(input.language);
  const label = (key: string) => translate(dictionary, key);
  const permissions: string[] = [];
  for (const [capability, key] of Object.entries(SWITCH_LABELS) as [ToolCapability, string][]) {
    if (!input.capabilities.includes(capability)) permissions.push(label(key));
  }
  if (!input.capabilities.includes('browser.read')) permissions.push(`${label('Trình duyệt')}: ${label('Đọc trang')}`);
  else if (!input.capabilities.includes('browser.act') && !input.schedule) permissions.push(`${label('Trình duyệt')}: ${label('Đọc và thao tác')}`);
  if (!input.workspacePermissions?.length) permissions.push(label('Thư mục làm việc'));
  else if (!input.workspacePermissions.includes('execute')) permissions.push(`${label('Thư mục làm việc')}: ${label('Đọc, sửa file và chạy lệnh')}`);
  if (!permissions.length) return null;
  // A side thread can never be wider than its main chat, so the switch that matters is the main chat's. Built from the
  // labels on screen, so it reads the same as the path the person clicks.
  const details = `${label('Chi tiết')} → ${label('Quyền công cụ')}`;
  const where = input.sideThread ? `${label('Chat chính')}: ${details}` : details;
  return { permissions, where };
}
