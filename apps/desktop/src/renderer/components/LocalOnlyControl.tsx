import { SwitchField } from '@codepawlhq/orglet-ui';
import { t } from '../i18n';

export function LocalOnlyControl({ checked, onChange, inherited = false, permanent = false, orgletDeleted = false, worker = false }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  inherited?: boolean;
  permanent?: boolean;
  /** An orglet in this chat was deleted; deleting is permanent for the account, so the chat stays on this computer. */
  orgletDeleted?: boolean;
  worker?: boolean;
}) {
  return <SwitchField className="local-only-control" checked={checked || inherited || permanent || orgletDeleted} disabled={inherited || permanent || orgletDeleted} onChange={onChange}
    description={orgletDeleted ? t('Một Tí trong chat này đã bị xóa vĩnh viễn, nên chat chỉ ở lại máy này và không đồng bộ.')
      : permanent ? t('Bản khôi phục giữ riêng trên máy này vì bản đồng bộ đã bị xóa vĩnh viễn.')
      : inherited ? t('Tí hoặc chat chính đang giữ riêng. Đổi thiết lập ở đó để cho phép đồng bộ.')
      : worker ? t('Không đưa Tí, chat và ghi nhớ của Tí lên đồng bộ.') : t('Không đưa chat và các nhánh của chat lên đồng bộ.')}>
    {t('Chỉ trên máy này')}
  </SwitchField>;
}
