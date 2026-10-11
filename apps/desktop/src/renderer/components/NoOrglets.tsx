import { UserRoundPlus } from 'lucide-react';
import { t } from '../i18n';
import { EmptyPanel } from './EmptyPanel';

/*
 * The main pane once every orglet is gone (COD-350, COD-356): the app's empty panel, with the way to make an orglet.
 * The pane then offers to make one instead of standing empty.
 */
export function NoOrglets({ onCreate }: { onCreate: () => void }) {
  return <div className="team-chat team-chat-fresh">
    <EmptyPanel className="no-orglets" title={t('Chưa có Tí nào.')} hint={t('Tạo một Tí để bắt đầu. Bạn nhắn, Tí làm.')}
      action={{ label: t('Tạo Tí'), icon: <UserRoundPlus size={16} />, onSelect: onCreate }} />
  </div>;
}
