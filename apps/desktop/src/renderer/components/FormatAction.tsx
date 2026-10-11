import { createContext, useContext } from 'react';
import { Download, FileCode, FileText, Copy, type LucideIcon } from 'lucide-react';
import type { FormatPreference, TextFormat } from '../../shared/contracts';
import { Button } from './ui';
import { RowMenu, type RowMenuItem } from './RowMenu';
import { t } from '../i18n';
import { Tooltip } from '@codepawlhq/orglet-ui';

const formatLabels: Record<'copy' | 'download', Record<TextFormat, string>> = {
  copy: { text: 'Sao chép văn bản thuần', markdown: 'Sao chép Markdown' },
  download: { text: 'Tải văn bản (.txt)', markdown: 'Tải Markdown (.md)' },
};
const formatIcons: Record<TextFormat, LucideIcon> = { text: FileText, markdown: FileCode };
/** Saved copy and download preferences; App provides them from the workspace settings. */
export const FormatPreferences = createContext<Record<'copy' | 'download', FormatPreference>>({ copy: 'ask', download: 'ask' });

/**
 * Copy or download in a chosen format. With a saved preference one click uses it; with 'ask' the button opens a small
 * menu of formats. Preferences live in Cài đặt → Cuộc trò chuyện.
 */
/**
 * The same choice as menu items, for a menu that already exists (a message's): one item for the saved format, or one per
 * format when the preference is 'ask'.
 */
export function formatMenuItems(kind: 'copy' | 'download', preference: FormatPreference, onPick: (format: TextFormat) => void): RowMenuItem[] {
  const icon = kind === 'copy' ? Copy : Download;
  const formats: TextFormat[] = preference === 'ask' ? ['text', 'markdown'] : [preference];
  return formats.map(format => ({ label: t(formatLabels[kind][format]), icon, onSelect: () => onPick(format) }));
}

export function FormatAction({ kind, onPick }: { kind: 'copy' | 'download'; onPick: (format: TextFormat) => void }) {
  const preference = useContext(FormatPreferences)[kind];
  const Icon = kind === 'copy' ? Copy : Download;
  const label = kind === 'copy' ? t('Sao chép') : t('Tải xuống');
  if (preference !== 'ask') return <Tooltip label={t(formatLabels[kind][preference])}><Button size="icon" aria-label={t(formatLabels[kind][preference])} onClick={() => onPick(preference)}><Icon size={15} /></Button></Tooltip>;
  return <RowMenu label={label} icon={Icon} className="format-action" align="start" items={(['text', 'markdown'] as const).map(format => ({ label: t(formatLabels[kind][format]), icon: formatIcons[format], onSelect: () => onPick(format) }))} />;
}
