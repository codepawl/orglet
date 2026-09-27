import { orglet } from './api';
import { confirmAction } from './components/confirm';
import { t } from './i18n';

/**
 * Restarts into the downloaded update (COD-304), from the sidebar, a notice or Settings → Giới thiệu. With runs still
 * working it asks first: quitting stops them, and they come back interrupted for the person to look at and resume.
 * Resolves false when the person kept the app open.
 */
export async function restartIntoUpdate(runningNow: number): Promise<boolean> {
  if (runningNow > 0) {
    const confirmed = await confirmAction({
      title: t('Khởi động lại để cập nhật?'),
      description: runningNow === 1
        ? t('1 lượt chạy đang làm việc sẽ bị ngắt. Mở lại chat đó để xem và chạy tiếp.')
        : t('{0} lượt chạy đang làm việc sẽ bị ngắt. Mở lại các chat đó để xem và chạy tiếp.', [runningNow]),
      confirmLabel: t('Khởi động lại'),
      cancelLabel: t('Để sau'),
    });
    if (!confirmed) return false;
  }
  await orglet.installUpdate();
  return true;
}
