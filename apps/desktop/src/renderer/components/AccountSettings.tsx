import { useEffect, useState, type ReactNode } from 'react';
import { ChartNoAxesColumn, ExternalLink, LogIn, LogOut, RefreshCw, Smartphone, UserRound, X } from 'lucide-react';
import { Skeleton, SkeletonGroup } from '@codepawl/orglet-ui';
import type { AccountState } from '../../shared/account';
import type { AnalyticsState } from '../../shared/analytics';
import type { AboutLink } from '../../shared/updates';
import { orglet } from '../api';
import { t } from '../i18n';
import { toast } from './toast';
import { Avatar } from './Avatar';
import { Button } from './ui';
import { InfoTip } from './InfoTip';
import { Switch } from './Switch';
import { maskEmail } from '../../shared/pii';

/*
 * Settings → Account (COD-337, COD-344). Signed out: Sign in, what an account gives today and what comes later, and
 * one sentence saying that signing in sends usage statistics and error reports. Signed in: whose account and which
 * plan with Sign out, sync as coming, and the analytics switch. Expired: whose it was and Sign in again. The rows
 * never show a token or an id.
 */

type Act = (action: () => Promise<string | void>, about?: string) => Promise<void>;

function Row({ title, description, children, id }: { title: ReactNode; description?: ReactNode; children?: ReactNode; id?: string }) {
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

/** Opens CodePawl's privacy policy or terms in the system browser. */
function PolicyLink({ link, label }: { link: Extract<AboutLink, 'privacy' | 'terms'>; label: string }) {
  return <button type="button" className="text-link" onClick={() => void orglet.openLink(link).catch(() => undefined)}>{label}<ExternalLink size={12} aria-hidden="true" /></button>;
}

/** What analytics sends and never sends, behind the "i". */
function WhatIsSent() {
  return <InfoTip label={t('Những gì được gửi')} rows={[
    { label: t('Được gửi'), value: t('Phiên bản, hệ điều hành, tính năng đã dùng, loại cuộc trò chuyện, nhà cung cấp và model, kết quả lượt chạy, và lỗi đã bỏ thông tin cá nhân.') },
    { label: t('Không bao giờ gửi'), value: t('Nội dung chat, prompt, câu trả lời, tên và nội dung tệp, đường dẫn thư mục, tên và hướng dẫn của Tí hay kênh, key, token và email.') },
    { label: t('Lưu giữ'), value: t('180 ngày, và bị xóa cùng tài khoản.') },
  ]} />;
}

/** The sentence and links shown wherever the person signs in or sees the switch. */
export function AnalyticsDisclosure({ signedIn }: { signedIn: boolean }) {
  const sentence = signedIn
    ? t('Gửi thống kê sử dụng và báo lỗi, không kèm nội dung chat hay tệp. Tắt được bất cứ lúc nào.')
    : t('Khi đăng nhập, Orglet gửi thống kê sử dụng và báo lỗi, không kèm nội dung chat hay tệp. Tắt được bất cứ lúc nào.');
  return <>
    {sentence}{' '}
    <span className="account-policy-links"><PolicyLink link="privacy" label={t('Quyền riêng tư')} /> · <PolicyLink link="terms" label={t('Điều khoản')} /></span>
  </>;
}

/** What an account gives: free and shared today, sync and a phone later, each said as it stands. */
function Benefits() {
  const items: { icon: ReactNode; text: string }[] = [
    { icon: <UserRound size={16} />, text: t('Miễn phí, một tài khoản CodePawl cho mọi sản phẩm CodePawl.') },
    { icon: <RefreshCw size={16} />, text: t('Sắp có: đồng bộ Tí, kênh, cuộc trò chuyện và cài đặt giữa các máy.') },
    { icon: <Smartphone size={16} />, text: t('Sau này: dùng Orglet trên điện thoại.') },
    { icon: <ChartNoAxesColumn size={16} />, text: t('Thống kê sử dụng giúp Orglet tốt hơn cho cách bạn dùng.') },
  ];
  return <ul className="account-benefits" aria-label={t('Tài khoản mang lại gì')}>
    {items.map(item => <li key={item.text}><span className="account-benefit-icon" aria-hidden="true">{item.icon}</span><span>{item.text}</span></li>)}
  </ul>;
}

/** The analytics switch; the state lives in main, which does the sending. */
function AnalyticsRow({ busy }: { busy: boolean }) {
  const [state, setState] = useState<AnalyticsState>();
  useEffect(() => {
    let current = true;
    void orglet.analyticsState().then(value => { if (current) setState(value); }).catch(() => undefined);
    return () => { current = false; };
  }, []);
  const change = async (enabled: boolean) => {
    setState({ enabled });
    try {
      setState(await orglet.setAnalytics(enabled));
    } catch (error) {
      setState({ enabled: !enabled });
      toast(error instanceof Error ? error.message : String(error), 'error', t('Thống kê sử dụng'));
    }
  };
  // The switch is named by the words alone, not by the "i" beside them.
  const title = <span className="account-title-info"><span id="account-analytics-label">{t('Thống kê sử dụng và báo lỗi')}</span><WhatIsSent /></span>;
  return <Row title={title} description={<AnalyticsDisclosure signedIn />}>
    {state ? <Switch checked={state.enabled} disabled={busy} labelledBy="account-analytics-label" onChange={value => void change(value)} />
      : <Skeleton width="36px" height="22px" />}
  </Row>;
}

export function AccountSettings({ account, busy, act }: { account: AccountState | undefined; busy: boolean; act: Act }) {
  const about = t('Tài khoản CodePawl');
  // The browser may stay open for minutes, so this waits on its own instead of holding the other tabs busy.
  const signIn = async () => {
    try {
      const state = await orglet.accountSignIn();
      if (state.status === 'signed_in') toast(state.email ? t('Đã đăng nhập bằng {0}', [maskEmail(state.email)]) : t('Đã đăng nhập'), 'success', about);
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

  // The wait shows as the orglet thinking (the same face and state as a reply being thought about), never a spinner.
  // Only this passing state has a face before its text, so its text starts later than the tab's other rows on purpose.
  if (account.status === 'signing_in') return <div className="setting-row account-waiting" data-align-ignore="family-lead">
    <Avatar name="Orglet" mascot="classic" color="var(--text)" size="sm" />
    <div className="setting-text">
      <span className="setting-title">{t('Đang đăng nhập')}</span>
      <span className="setting-description" role="status">{t('Đăng nhập ở trang vừa mở trong trình duyệt, rồi quay lại đây.')}</span>
    </div>
    <div className="setting-control"><Button variant="outline" onClick={cancel}><X size={14} />{t('Hủy')}</Button></div>
  </div>;

  if (account.status === 'local') return <>
    <Row title={t('Chưa đăng nhập tài khoản')}>
      <Button variant="primary" disabled={busy} onClick={() => void signIn()}><LogIn size={14} />{t('Đăng nhập')}</Button>
    </Row>
    <Benefits />
    <p className="account-disclosure"><AnalyticsDisclosure signedIn={false} /><WhatIsSent /></p>
  </>;

  if (account.status === 'expired') return <Row title={account.email ? maskEmail(account.email) : t('Đã đăng nhập')} description={t('Phiên đăng nhập đã hết. Dữ liệu trên máy này vẫn còn nguyên.')}>
    <Button variant="primary" disabled={busy} onClick={() => void signIn()}><LogIn size={14} />{t('Đăng nhập lại')}</Button>
  </Row>;

  return <>
    <Row title={account.email ? maskEmail(account.email) : t('Đã đăng nhập')} description={account.name}>
      <Button variant="outline" disabled={busy} onClick={signOut}><LogOut size={14} />{t('Đăng xuất')}</Button>
    </Row>
    <Row title={t('Gói')} description={!account.plan || account.plan === 'free' ? t('Tài khoản miễn phí. Orglet vẫn miễn phí và mã nguồn mở.') : undefined}>
      <span className="setting-value">{planName(account.plan)}</span>
    </Row>
    <Row title={t('Đồng bộ')} description={t('Sắp có. Hiện chưa có chat hay tệp nào rời khỏi máy này.')} />
    <AnalyticsRow busy={busy} />
  </>;
}
