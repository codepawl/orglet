import { SwitchField } from '@codepawl/orglet-ui';
import { t } from '../i18n';

export function LocalOnlyControl({ checked, onChange, inherited = false, permanent = false, worker = false }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  inherited?: boolean;
  permanent?: boolean;
  worker?: boolean;
}) {
  return <SwitchField className="local-only-control" checked={checked || inherited || permanent} disabled={inherited || permanent} onChange={onChange}
    description={permanent ? t('Bản khôi phục giữ riêng trên máy này vì bản đồng bộ đã bị xóa vĩnh viễn.')
      : inherited ? t('Tí hoặc chat chính đang giữ riêng. Đổi thiết lập ở đó để cho phép đồng bộ.')
      : worker ? t('Không đưa Tí, chat và ghi nhớ của Tí lên đồng bộ.') : t('Không đưa chat và các nhánh của chat lên đồng bộ.')}>
    {t('Chỉ trên máy này')}
  </SwitchField>;
}
