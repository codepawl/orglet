import type { ReactNode } from 'react';
import { LogIn, LogOut, X } from 'lucide-react';
import { Skeleton, SkeletonGroup } from '@codepawl/orglet-ui';
import type { AccountState } from '../../shared/account';
import { orglet } from '../api';
import { t } from '../i18n';
import { toast } from './toast';
import { Button } from './ui';

/*
 * Settings → Account (COD-337). Signed out: what an account is for and Sign in. Signed in: whose account and which plan,
 * with Sign out. Expired: whose it was and Sign in again. Nothing syncs yet, and the tab's description says so; the
 * rows never show a token or an id.
 */

type Act = (action: () => Promise<string | void>, about?: string) => Promise<void>;

function Row({ title, description, children, id }: { title: string; description?: ReactNode; children?: ReactNode; id?: string }) {
  return <div className="setting-row">
    <div className="setting-text"><span id={id} className="setting-title">{title}</span>{description && <span className="setting-description">{description}</span>}</div>
    {children && <div className="setting-control">{children}</div>}
  </div>;
}

/** The plan in plain words: the free plan by name, anything later as the service names it. */
function planName(plan: string | undefined): string {
  if (!plan || plan === 'free') return t('Miễn phí');
  return plan;
}

export function AccountSettings({ account, busy, act }: { account: AccountState | undefined; busy: boolean; act: Act }) {
  const about = t('Tài khoản CodePawl');
  // The browser may stay open for minutes, so this waits on its own instead of holding the other tabs busy.
  const signIn = async () => {
    try {
      const state = await orglet.accountSignIn();
      if (state.status === 'signed_in') toast(state.email ? t('Đã đăng nhập bằng {0}', [state.email]) : t('Đã đăng nhập'), 'success', about);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error', about);
    }
  };
  const cancel = () => void orglet.accountCancelSignIn().catch(() => undefined);
  const signOut = () => void act(async () => {
    await orglet.accountSignOut();
    return t('Đã đăng xuất');
  }, about);

  if (!account) return <SkeletonGroup label={t('Đang đọc tài khoản…')}>
    <div className="setting-row"><div className="setting-text"><Skeleton width="34%" /><Skeleton width="62%" delay={0.04} /></div></div>
  </SkeletonGroup>;

  if (account.status === 'signing_in') return <Row title={t('Đang đăng nhập')} description={t('Đăng nhập ở trang vừa mở trong trình duyệt, rồi quay lại đây.')}>
    <Button variant="outline" onClick={cancel}><X size={14} />{t('Hủy')}</Button>
  </Row>;

  if (account.status === 'local') return <Row title={t('Chưa đăng nhập tài khoản')} description={t('Sau này tài khoản đồng bộ Tí, hội và cuộc trò chuyện giữa các máy của bạn.')}>
    <Button variant="primary" disabled={busy} onClick={() => void signIn()}><LogIn size={14} />{t('Đăng nhập')}</Button>
  </Row>;

  if (account.status === 'expired') return <Row title={account.email ?? t('Đã đăng nhập')} description={t('Phiên đăng nhập đã hết. Dữ liệu trên máy này vẫn còn nguyên.')}>
    <Button variant="primary" disabled={busy} onClick={() => void signIn()}><LogIn size={14} />{t('Đăng nhập lại')}</Button>
  </Row>;

  return <>
    <Row title={account.email ?? t('Đã đăng nhập')} description={account.name}>
      <Button variant="outline" disabled={busy} onClick={signOut}><LogOut size={14} />{t('Đăng xuất')}</Button>
    </Row>
    <Row title={t('Gói')} description={!account.plan || account.plan === 'free' ? t('Tài khoản miễn phí. Orglet vẫn miễn phí và mã nguồn mở.') : undefined}>
      <span className="setting-value">{planName(account.plan)}</span>
    </Row>
    <Row title={t('Đồng bộ')} description={t('Sắp có. Hiện chưa có gì rời khỏi máy này.')} />
  </>;
}
