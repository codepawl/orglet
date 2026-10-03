import type { ReactNode } from 'react';
import { ChevronsUpDown } from 'lucide-react';
import { t } from '../i18n';
import { Avatar } from './Avatar';
import { RowMenu, type RowMenuItem } from './RowMenu';
import { dwellHandlers } from '../prefetch';

/**
 * The person's panel at the bottom left (COD-366), the way Discord's user panel sits under its rail and channel list:
 * who they are and what the app is doing for them in a few words. The whole panel is one button that opens the
 * person's menu (`items`): the account, Settings and the Settings pages people reach for most. Folded to the rail's
 * width it is the face alone, which opens the same menu. The connection dot says whether any connection can run a
 * model, and `trailing` carries a ready update.
 */
export function UserPanel({ name, status, connected, compact, items, onDwell, trailing }: {
  name: string;
  /** One quiet line under the name: what is running, or what the account is. */
  status: string;
  connected: boolean;
  compact: boolean;
  /** What the panel opens: the account, Settings and its most used pages. */
  items: RowMenuItem[];
  onDwell?: (resting: boolean) => void;
  trailing?: ReactNode;
}) {
  const face = <span className="user-panel-face"><Avatar name={name} seed={name} size="sm" /><span className={`connection-dot ${connected ? 'connected' : ''}`} aria-hidden="true" /></span>;
  const label = t('Tài khoản và cài đặt');
  if (compact) {
    return <div className="user-panel compact" {...dwellHandlers(onDwell)}>
      <RowMenu label={label} className="user-panel-who" align="start" items={items}>{face}</RowMenu>
    </div>;
  }
  return <div className="user-panel" {...dwellHandlers(onDwell)}>
    <RowMenu label={label} className="user-panel-who" align="start" items={items}>
      {face}
      <span className="user-panel-text"><span className="user-panel-name">{name}</span><span className="user-panel-status">{status}</span></span>
      <ChevronsUpDown className="user-panel-more" size={14} aria-hidden="true" />
    </RowMenu>
    {trailing}
  </div>;
}
