import type { ReactNode } from 'react';
import { Settings } from './icons';
import { t } from '../i18n';
import { Avatar } from './Avatar';
import { Button } from './ui';
import { dwellHandlers } from '../prefetch';

/**
 * The person's panel at the bottom left (COD-366), the way Discord's user panel sits under its rail and channel list:
 * who they are, what the app is doing for them in a few words, and Settings. Folded to the rail's width it is the face
 * alone, which opens Settings. The connection dot says whether any connection can run a model, as it did beside
 * Settings in the sidebar footer, and `trailing` carries a ready update.
 */
export function UserPanel({ name, status, connected, compact, onSettings, onDwell, trailing }: {
  name: string;
  /** One quiet line under the name: what is running, or what the account is. */
  status: string;
  connected: boolean;
  compact: boolean;
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
    <div className="user-panel-who">
      <span className="user-panel-face">{face}<span className={`connection-dot ${connected ? 'connected' : ''}`} aria-hidden="true" /></span>
      <span className="user-panel-text"><span className="user-panel-name">{name}</span><span className="user-panel-status">{status}</span></span>
    </div>
    {trailing}
    <Button size="icon" aria-label={t('Cài đặt')} title={t('Cài đặt')} onClick={onSettings} {...dwell}><Settings size={18} /></Button>
  </div>;
}
