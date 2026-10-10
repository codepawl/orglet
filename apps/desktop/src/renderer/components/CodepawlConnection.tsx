import { Skeleton, SkeletonGroup } from '@codepawlhq/orglet-ui';
import { LogIn, Plug, Unplug } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { AccountState } from '../../shared/account';
import type { Connections } from '../../shared/contracts';
import { ROUTER_NOT_OPEN, type CodepawlState, type CodepawlUsage } from '../../shared/router';
import { orglet } from '../api';
import { t } from '../i18n';
import { formatMoney } from './money';
import { ProviderMark } from './ProviderMark';
import { StatusMark, type StatusMarkState } from './StatusMark';
import { toast } from './toast';
import { Button } from './ui';

type Act = (action: () => Promise<string | void>, about?: string) => Promise<void>;

const CONNECTED_MARK: StatusMarkState = { variant: 'filled', tone: 'success' };
const NOT_OPEN_MARK: StatusMarkState = { variant: 'paused', tone: 'muted' };
const NOT_CONNECTED_MARK: StatusMarkState = { variant: 'empty', tone: 'muted' };

function stateLine(state: CodepawlState): { mark: StatusMarkState; text: string } {
  if (state.status === 'connected') return { mark: CONNECTED_MARK, text: t('Đã kết nối · {0}', [state.deviceName ?? t('máy này')]) };
  if (state.status === 'not_open') return { mark: NOT_OPEN_MARK, text: t(ROUTER_NOT_OPEN) };
  if (state.status === 'signed_out') return { mark: NOT_CONNECTED_MARK, text: t('Đăng nhập tài khoản CodePawl để kết nối, không cần dán key.') };
  return { mark: NOT_CONNECTED_MARK, text: t('Kết nối bằng tài khoản CodePawl đang đăng nhập, không cần dán key.') };
}

/** Free tokens left today and included usage left this period; a number the router did not give is not shown. */
function usageLine(usage: CodepawlUsage): string {
  const parts: string[] = [];
  if (usage.freeTokensLeft !== undefined) parts.push(t('Còn {0} token miễn phí hôm nay', [usage.freeTokensLeft.toLocaleString()]));
  if (usage.includedLeftMicros !== undefined) parts.push(t('Còn {0} dùng trong kỳ này', [formatMoney(usage.includedLeftMicros)]));
  return parts.join(' · ');
}

function CodepawlUsageLine({ usage }: { usage: CodepawlUsage | undefined }) {
  if (!usage) return <SkeletonGroup label={t('Đang đọc hạn mức…')}><div className="plan-usage"><Skeleton width="55%" /></div></SkeletonGroup>;
  const line = usage.known ? usageLine(usage) : '';
  return <span className="setting-description">{line || t('Chưa đọc được hạn mức lúc này.')}</span>;
}

/**
 * The CodePawl router row of Settings → API connections. It draws nothing at all in a build that names no router, so a
 * normal install shows nothing new. The connection needs no key: Connect makes one with the signed-in account.
 */
export function CodepawlConnection({ account, busy, act, onConnections }: { account: AccountState | undefined; busy: boolean; act: Act; onConnections: (next: Connections) => void }) {
  const [state, setState] = useState<CodepawlState>();
  const [usage, setUsage] = useState<CodepawlUsage>();
  const accountStatus = account?.status;
  const connected = state?.status === 'connected';

  useEffect(() => {
    let current = true;
    void orglet.codepawlState().then(next => { if (current) setState(next); }, () => undefined);
    return () => { current = false; };
  }, [accountStatus]);

  const readUsage = useCallback(async () => {
    try {
      setUsage(await orglet.codepawlUsage());
    } catch {
      setUsage({ known: false });
    }
  }, []);
  useEffect(() => {
    if (!connected) {
      setUsage(undefined);
      return;
    }
    void readUsage();
  }, [connected, readUsage]);

  const makeKey = () => act(async () => {
    const next = await orglet.codepawlConnect();
    setState(next);
    onConnections(await orglet.connections());
    if (next.status === 'connected') return t('Đã kết nối CodePawl');
  }, 'CodePawl');
  // The browser may stay open for minutes, so the sign-in waits on its own instead of holding the other tabs busy.
  const connect = async () => {
    if (state?.status === 'signed_out') {
      try {
        const signedIn = await orglet.accountSignIn();
        if (signedIn.status !== 'signed_in') return;
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), 'error', 'CodePawl');
        return;
      }
    }
    await makeKey();
  };
  const disconnect = () => void act(async () => {
    setState(await orglet.codepawlDisconnect());
    onConnections(await orglet.connections());
    return t('Đã ngắt CodePawl');
  }, 'CodePawl');

  if (!state || state.status === 'off') return null;
  const line = stateLine(state);
  const titleId = 'codepawl-connection-title';
  return <div role="region" aria-label={t('Kết nối {0}', ['CodePawl'])} className={`setting-row setting-connection${connected ? '' : ' inactive'}`}>
    <ProviderMark provider="codepawl" />
    <div className="setting-text">
      <span id={titleId} className="setting-title">{t('CodePawl router')}</span>
      <span className="setting-description outcome-line" role="status"><StatusMark variant={line.mark.variant} tone={line.mark.tone} label={line.text} decorative />{line.text}</span>
    </div>
    <div className="setting-control">
      {connected
        ? <Button variant="outline" disabled={busy} onClick={disconnect}><Unplug size={14} />{t('Ngắt kết nối')}</Button>
        : state.status === 'signed_out'
          ? <Button variant="outline" disabled={busy} onClick={() => void connect()}><LogIn size={14} />{t('Đăng nhập để kết nối')}</Button>
          : <Button variant="outline" disabled={busy} onClick={() => void connect()}><Plug size={14} />{state.status === 'not_open' ? t('Thử lại') : t('Kết nối')}</Button>}
    </div>
    {connected && <div className="setting-connection-usage"><CodepawlUsageLine usage={usage} /></div>}
  </div>;
}
