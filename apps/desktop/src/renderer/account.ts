import { useEffect, useState } from 'react';
import type { AccountState } from '../shared/account';
import type { SyncStatus } from '../shared/sync-status';
import { orglet } from './api';

/**
 * The CodePawl account as main reports it (COD-337): read once, then kept current by main's pushes. Undefined until
 * the first answer, and always undefined in the renderer-only web build, which has no main process.
 */
export function useAccount(): AccountState | undefined {
  const [account, setAccount] = useState<AccountState>();
  useEffect(() => {
    if (!window.orglet) return;
    let current = true;
    const stop = orglet.onAccount(state => { if (current) setAccount(state); });
    void orglet.accountState().then(state => { if (current) setAccount(state); }).catch(() => undefined);
    return () => {
      current = false;
      stop();
    };
  }, []);
  return account;
}

/** Account sync as main reports it (COD-329): read once, then kept current by main's pushes. */
export function useSync(): SyncStatus | undefined {
  const [status, setStatus] = useState<SyncStatus>();
  useEffect(() => {
    if (!window.orglet) return;
    let current = true;
    const stop = orglet.onSync(next => { if (current) setStatus(next); });
    void orglet.syncState().then(next => { if (current) setStatus(next); }).catch(() => undefined);
    return () => {
      current = false;
      stop();
    };
  }, []);
  return status;
}
