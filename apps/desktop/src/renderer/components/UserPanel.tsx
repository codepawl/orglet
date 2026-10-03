import type { ReactNode } from 'react';
import { ChevronsUpDown } from 'lucide-react';
import { Settings } from './icons';
import { RowMenu, type RowMenuItem } from './RowMenu';
import { t } from '../i18n';
import { Avatar } from './Avatar';
import { Button } from './ui';
import { dwellHandlers } from '../prefetch';

/**
 * The person's panel at the bottom left (COD-366), the way Discord's user panel sits under its rail and channel list:
 * who they are, what the app is doing for them in a few words, and Settings. The name is a button: it opens the
 * account's own menu (`accountItems`), so the account is reached from the person and not only through Settings.
 * Folded to the rail's width it is the face alone, which opens Settings. The connection dot says whether any connection can run a model, as it did beside
 * Settings in the sidebar footer, and `trailing` carries a ready update.
 */
export function UserPanel({ name, status, connected, compact, accountItems, onSettings, onDwell, trailing }: {
  name: string;
  /** One quiet line under the name: what is running, or what the account is. */
  status: string;
  connected: boolean;
  compact: boolean;
  /** What the name opens: the account, its usage, its connections. */
  accountItems: RowMenuItem[];
  onSettings: () => void;
  onDwell?: (resting: boolean) => void;
  trailing?: ReactNode;
}) {
  const face = <Avatar name={name} seed={name} size="sm" />;
  const dwell = dwellHandlers(onDwell);
  if (compact) {
    return <div className="user-panel compact">
      <button type="button" className="user-panel-face" aria-label={t('Cài đặt')} title={t('Cài đặt')} onClick={onSettings} {...dwell}>
        {face}<span className={`connection-dot ${connected ? 'connected' : ''}`} aria-hidden="true" />
      </button>
    </div>;
  }
  return <div className="user-panel">
    <RowMenu label={t('Tài khoản của {0}', [name])} className="user-panel-who" align="start" items={accountItems}>
      <span className="user-panel-face">{face}<span className={`connection-dot ${connected ? 'connected' : ''}`} aria-hidden="true" /></span>
      <span className="user-panel-text"><span className="user-panel-name">{name}</span><span className="user-panel-status">{status}</span></span>
      <ChevronsUpDown className="user-panel-more" size={14} aria-hidden="true" />
    </RowMenu>
    {trailing}
    <Button size="icon" aria-label={t('Cài đặt')} title={t('Cài đặt')} onClick={onSettings} {...dwell}><Settings size={18} /></Button>
  </div>;
}
