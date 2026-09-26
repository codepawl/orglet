// The question dialog moved into the kit (COD-274); the app gives it its default labels.
import { Confirmer as KitConfirmer } from '@codepawl/orglet-ui';
import { t } from '../i18n';

export { confirmAction } from '@codepawl/orglet-ui';

export function Confirmer() {
  return <KitConfirmer confirmLabel={t('Đồng ý')} cancelLabel={t('Hủy')} />;
}
