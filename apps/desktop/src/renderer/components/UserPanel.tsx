import type { ReactNode } from 'react';
import { t } from '../i18n';
import { Avatar } from './Avatar';
import { RowMenu, type RowMenuItem } from './RowMenu';
import { dwellHandlers } from '../prefetch';

/**
 * The person, at the bottom of the area rail (COD-366; into the rail on the user's call, 2026-10-04): their face, the
 * size of a rail tile, which opens their menu (`items`): the account, Settings and the Settings pages people reach for
 * most. The tooltip says who they are and what the app is doing for them. The connection dot says whether any
 * connection can run a model, and `trailing` carries a waiting update above the face.
 */
export function UserPanel({ name, status, connected, items, onDwell, trailing }: {
  name: string;
  /** A few words for the tooltip: what is running, or what the account is. */
  status: string;
  connected: boolean;
  /** What the face opens: the account, Settings and its most used pages. */
  items: RowMenuItem[];
  onDwell?: (resting: boolean) => void;
  trailing?: ReactNode;
}) {
  return <div className="user-panel" title={`${name} · ${status}`} {...dwellHandlers(onDwell)}>
    {trailing}
    <RowMenu label={t('Tài khoản và cài đặt')} className="user-panel-who" align="start" items={items}>
      <span className="user-panel-face"><Avatar name={name} seed={name} size="sm" /><span className={`connection-dot ${connected ? 'connected' : ''}`} aria-hidden="true" /></span>
    </RowMenu>
  </div>;
}
