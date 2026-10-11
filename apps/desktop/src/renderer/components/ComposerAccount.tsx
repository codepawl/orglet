import { Laptop, Settings2, UserRound } from 'lucide-react';
import { SYSTEM_ACCOUNT_ID, type HarnessInfo } from '../../shared/harness';
import { composerAccountChoices } from '../composerAccount';
import { t } from '../i18n';
import { Select, type SelectOption } from './Select';

/** The value of the Manage accounts row; never an account, since that row is an action. */
const MANAGE_ROW = '\u0000manage';

/**
 * Which account of the chat's harness answers, on the prompt bar beside the model. Settings → Local harnesses holds
 * the same choice, but a person with a work and a personal account switches often, and Settings was too far for that
 * (owner, 2026-10-11). It shows only when an account was added. The choice is the harness's, so it applies to every
 * orglet on that harness, as it does in Settings.
 */
export function ComposerAccount({ harness, busy, onSelect, onManage }: {
  harness: HarnessInfo;
  busy?: boolean;
  onSelect: (accountId: string) => void;
  onManage: () => void;
}) {
  const choices = composerAccountChoices(harness);
  if (choices.length === 0) return null;
  const options: SelectOption[] = [
    ...choices.map(choice => choice.id === SYSTEM_ACCOUNT_ID
      ? { value: choice.id, label: t('Tài khoản mặc định'), icon: <Laptop size={16} /> }
      : { value: choice.id, label: choice.label ?? choice.id, icon: <UserRound size={16} /> }),
    { value: MANAGE_ROW, label: t('Quản lý tài khoản'), icon: <Settings2 size={16} />, spaced: true, onSelect: onManage },
  ];
  return <Select
    className="composer-model-select composer-account-select"
    size="sm"
    ariaLabel={t('Tài khoản {0}', [harness.name])}
    value={harness.accountId}
    disabled={busy}
    onChange={accountId => {
      if (accountId !== MANAGE_ROW && accountId !== harness.accountId) onSelect(accountId);
    }}
    options={options}
    showIcon={false}
    showDetail={false}
    menuMinWidth={240}
  />;
}
