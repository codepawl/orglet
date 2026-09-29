import type { UpdateIndicator } from '../../shared/updates';
import { t } from '../i18n';
import { Download } from './icons';
import { Button } from './ui';

/** The words the ready button's tooltip, its notice and the About row use for the version waiting for a restart. */
export function readyUpdateLabel(version: string | null): string {
  return version
    ? t('Orglet {0} đã tải xong. Khởi động lại để dùng bản mới.', [version])
    : t('Bản Orglet mới đã tải xong. Khởi động lại để dùng bản mới.');
}

/**
 * The update mark beside Settings (COD-304). While a new version downloads it is a grey arrow that opens Settings →
 * Giới thiệu; once the version is ready it becomes a small accent button that restarts into it with one click. The
 * sidebar shows nothing about updates otherwise.
 */
export function UpdateButton({ indicator, onRestart, onOpenAbout, compact = false }: {
  indicator: UpdateIndicator;
  onRestart: () => void;
  onOpenAbout: () => void;
  /** In the rail of a collapsed sidebar: the ready button without its word, the tooltip saying it instead. */
  compact?: boolean;
}) {
  if (indicator.kind === 'downloading') {
    const label = t('Đang tải bản Orglet mới');
    return <Button size="icon" className="update-button" aria-label={label} title={label} onClick={onOpenAbout}>
      <Download size={18} />
    </Button>;
  }
  const label = readyUpdateLabel(indicator.version);
  if (compact) {
    return <Button size="icon" className="update-button ready compact" aria-label={label} title={label} onClick={onRestart}>
      <Download size={18} />
    </Button>;
  }
  return <Button className="update-button ready" title={label} onClick={onRestart}>
    <Download size={16} />{t('Cập nhật')}
  </Button>;
}
