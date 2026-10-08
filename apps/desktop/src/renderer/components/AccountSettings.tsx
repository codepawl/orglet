import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, ChartNoAxesColumn, Copy, ExternalLink, Gem, Gift, LogIn, LogOut, RefreshCw, RotateCw, Smartphone, UserRound, UserRoundCheck, UserRoundX } from 'lucide-react';
import { Skeleton, SkeletonGroup } from '@codepawlhq/orglet-ui';
import type { AccountState } from '../../shared/account';
import type { SyncPauseReason, SyncStatus } from '../../shared/sync-status';
import type { SyncConflict, SyncConflictVersion } from '../../shared/sync-conflicts';
import { useSync } from '../account';
import type { AnalyticsState } from '../../shared/analytics';
import type { AboutLink } from '../../shared/updates';
import { orglet } from '../api';
import { t } from '../i18n';
import { toast } from './toast';
import { Avatar } from './Avatar';
import { Button, Drawer } from './ui';
import { StatusMark, type StatusMarkState } from './StatusMark';
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

function Row({ title, description, children, id, icon }: { title: ReactNode; description?: ReactNode; children?: ReactNode; id?: string; icon?: ReactNode }) {
  return <div className="setting-row">
    {icon && <span className="account-row-icon" aria-hidden="true">{icon}</span>}
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
    ? t('Gửi thống kê và báo lỗi, không kèm chat hay tệp. Tắt được.')
    : t('Đăng nhập gửi thống kê và báo lỗi, không kèm chat hay tệp. Tắt được.');
  return <>
    {sentence}{' '}
    <span className="account-policy-links"><PolicyLink link="privacy" label={t('Quyền riêng tư')} /> · <PolicyLink link="terms" label={t('Điều khoản')} /></span>
  </>;
}

/** What an account gives: free, shared and syncing today, a phone later, each said as it stands. */
function Benefits() {
  const items: { icon: ReactNode; text: string }[] = [
    { icon: <Gift size={16} />, text: t('Miễn phí, một tài khoản cho mọi sản phẩm CodePawl') },
    { icon: <RefreshCw size={16} />, text: t('Đồng bộ giữa các máy của bạn') },
    { icon: <Smartphone size={16} />, text: t('Sau này: Orglet trên điện thoại') },
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
  return <Row icon={<ChartNoAxesColumn size={16} />} title={title} description={<AnalyticsDisclosure signedIn />}>
    {state ? <Switch checked={state.enabled} disabled={busy} labelledBy="account-analytics-label" onChange={value => void change(value)} />
      : <Skeleton width="36px" height="22px" />}
  </Row>;
}

/** Something that failed, led by the error mark so it is seen before it is read. */
function ErrorLine({ text }: { text: string }) {
  return <p role="alert" className="error outcome-line"><StatusMark variant="filled" tone="error" label={t('Không thành công')} decorative />{text}</p>;
}

/** The mark beside "Sync": a tick once synced, a turning ring while it works, an exclamation when it cannot go on. */
function syncMark(status: SyncStatus): StatusMarkState & { label: string } {
  if (status.state === 'synced') return { variant: 'filled', tone: 'success', label: t('Đã đồng bộ xong') };
  if (status.state === 'syncing') return { variant: 'busy', tone: 'working', label: t('Đang đồng bộ…') };
  if (status.state === 'offline') return { variant: 'dashed', tone: 'error', label: t('Không kết nối được') };
  if (status.state === 'paused') return { variant: 'filled', tone: 'error', label: t('Đồng bộ đang dừng') };
  return { variant: 'empty', tone: 'muted', label: t('Đồng bộ đang tắt') };
}

/** Why sync stopped, in the person's words. Local editing goes on in every case. */
function pauseText(reason: SyncPauseReason | undefined): string {
  if (reason === 'update_required') return t('Tài khoản có dữ liệu từ bản Orglet mới hơn. Cập nhật app để gửi tiếp thay đổi từ máy này.');
  if (reason === 'storage_limit') return t('Tài khoản đã đầy. Thay đổi mới vẫn lưu trên máy này và chưa được gửi đi.');
  if (reason === 'device_limit') return t('Tài khoản đã đủ số máy được đồng bộ.');
  if (reason === 'device_released') return t('Máy này đã được gỡ khỏi tài khoản. Đăng xuất rồi đăng nhập lại để đồng bộ tiếp.');
  if (reason === 'account_deleted') return t('Tài khoản này đã bị xóa trên máy chủ. Dữ liệu trên máy này vẫn còn.');
  if (reason === 'server_unavailable') return t('Máy chủ đồng bộ đang tắt. Orglet sẽ tự thử lại.');
  return t('Máy chủ từ chối một số thay đổi. Chúng vẫn nằm trên máy này.');
}

function syncText(status: SyncStatus): string {
  if (status.state === 'link_required') return t('Dữ liệu trên máy này đã xóa. Bấm Đồng bộ ngay để lấy lại từ tài khoản.');
  if (status.state === 'syncing') return t('Đang đồng bộ…');
  if (status.state === 'synced') return t('Đã đồng bộ. Mục "Chỉ trên máy này" ở lại máy.');
  if (status.state === 'offline') return t('Không kết nối được. Orglet sẽ tự thử lại.');
  if (status.state === 'paused') return pauseText(status.reason);
  // Off while signed in means this install names no sync server (ORGLET_SYNC_URL=off or a development accounts service).
  return t('Đồng bộ đang tắt trên bản cài này. Dữ liệu ở lại máy này.');
}

const conflictKind = (conflict: SyncConflict) => conflict.entity === 'worker' ? t('Tí') : conflict.entity === 'skill' ? t('Kỹ năng') : conflict.entity === 'team' ? t('Kênh') : t('Ghi chú');
const versionLabel = (version: SyncConflictVersion) => version.current
  ? version.thisComputer ? t('Đang dùng · sửa trên máy này') : t('Đang dùng · sửa trên máy khác')
  : version.thisComputer ? t('Bản kia · sửa trên máy này') : t('Bản kia · sửa trên máy khác');

/**
 * Things two computers changed while apart (GH-484). The row shows only while there are some. The dialog puts the two
 * versions side by side; choosing one writes it as a new revision everywhere, and the other stays in the history.
 */
function ConflictsRow({ busy }: { busy: boolean }) {
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    const load = () => void orglet.call('syncConflicts', {}).then(value => { if (current) setConflicts(value); }).catch(() => undefined);
    load();
    const stop = orglet.onChange(load);
    return () => { current = false; stop(); };
  }, []);
  if (!conflicts.length) return null;
  const choose = async (conflict: SyncConflict, version: SyncConflictVersion) => {
    setError('');
    try {
      await orglet.call('resolveSyncConflict', { entity: conflict.entity, id: conflict.id, revisionId: version.revisionId, generation: conflict.generation });
      toast(t('Đã chọn bản dùng cho {0}', [conflict.name]), 'success', t('Đồng bộ'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  return <>
    <Row title={t('Sửa trên hai máy')} description={t('{0} mục được sửa trên hai máy khi chưa đồng bộ. Orglet đang dùng bản sửa sau; bản kia vẫn còn.', [conflicts.length])}>
      <Button variant="outline" disabled={busy} onClick={() => setOpen(true)}>{t('Xem lại')}</Button>
    </Row>
    {open && <Drawer open onClose={() => setOpen(false)} title={t('Sửa trên hai máy')} description={t('Chọn bản muốn dùng. Bản còn lại vẫn nằm trong lịch sử.')}>
      <div className="sync-conflicts">
        {error && <ErrorLine text={error} />}
        {conflicts.map(conflict => <section key={`${conflict.entity}:${conflict.id}`} className="marketplace-comparison" aria-label={conflict.name}>
          <h3>{conflict.name} <span className="muted">· {conflictKind(conflict)}</span></h3>
          <div className="marketplace-comparison-columns">
            {conflict.versions.slice(0, 2).map(version => <div key={version.revisionId} className="sync-conflict-version">
              <p className="muted">{versionLabel(version)}</p>
              <pre>{version.text}</pre>
              <Button variant={version.current ? 'outline' : 'primary'} disabled={busy} onClick={() => void choose(conflict, version)}>{version.current ? t('Giữ bản này') : t('Dùng bản này')}</Button>
            </div>)}
          </div>
        </section>)}
      </div>
    </Drawer>}
  </>;
}

/** How long the Sync button rests after a press, so a run of clicks is one request. */
const SYNC_COOLDOWN_MS = 3000;

/**
 * Sync in one row: what it is doing, and Sync to run it now. Sync turns itself on when the person signs in; the
 * button is for a sync right now, and rests for three seconds after each press.
 */
function SyncRow({ busy }: { busy: boolean }) {
  const status = useSync() ?? { state: 'off' as const };
  const [resting, setResting] = useState(false);
  useEffect(() => {
    if (!resting) return;
    const timer = setTimeout(() => setResting(false), SYNC_COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [resting]);
  const syncNow = () => {
    setResting(true);
    void orglet.syncStart().catch(error => toast(error instanceof Error ? error.message : String(error), 'error', t('Đồng bộ')));
  };
  const stuck = status.reason === 'update_required' || status.reason === 'device_released' || status.reason === 'account_deleted';
  const canSync = status.state !== 'off' && !(status.state === 'paused' && stuck);
  const description = <span role="status">
    {syncText(status)}
    {status.skipped ? <>{' '}{t('{0} thay đổi quá lớn nên chỉ ở trên máy này.', [status.skipped])}</> : null}
  </span>;
  return <>
    <Row icon={<StatusMark {...syncMark(status)} decorative />} title={t('Đồng bộ')} description={description}>
      {canSync ? <Button variant="outline" disabled={busy || resting || status.state === 'syncing'} onClick={syncNow}><RefreshCw size={14} />{t('Đồng bộ ngay')}</Button> : null}
    </Row>
    <ConflictsRow busy={busy} />
  </>;
}

/**
 * The two quiet ways out of a browser that did not come forward while a sign-in waits: open the sign-in page again, or
 * copy its address for another browser. The address holds only the sign-in's state and PKCE challenge, no secret.
 */
export function SignInWaitActions() {
  const about = t('Tài khoản CodePawl');
  const reopen = () => void orglet.accountReopenSignIn().catch(error => toast(error instanceof Error ? error.message : String(error), 'error', about));
  const copyLink = async () => {
    try {
      const link = await orglet.accountSignInLink();
      if (!link) return;
      await orglet.copyText(link);
      toast(t('Đã sao chép liên kết đăng nhập'), 'success', about);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error', about);
    }
  };
  return <>
    <Button variant="ghost" onClick={reopen}><RotateCw size={14} />{t('Mở lại trình duyệt')}</Button>
    <Button variant="ghost" onClick={() => void copyLink()}><Copy size={14} />{t('Sao chép liên kết')}</Button>
  </>;
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
      <span className="setting-description" role="status">{t('Đăng nhập trong trình duyệt, rồi quay lại.')}</span>
    </div>
    <div className="setting-control account-waiting-actions"><SignInWaitActions /><Button variant="outline" onClick={cancel}><ArrowLeft size={14} />{t('Hủy')}</Button></div>
  </div>;

  if (account.status === 'local') return <>
    <Row icon={<UserRound size={16} />} title={t('Chưa đăng nhập')}>
      <Button variant="primary" disabled={busy} onClick={() => void signIn()}><LogIn size={14} />{t('Đăng nhập')}</Button>
    </Row>
    <Benefits />
    <p className="account-disclosure"><AnalyticsDisclosure signedIn={false} /><WhatIsSent /></p>
  </>;

  if (account.status === 'expired') return <Row icon={<UserRoundX size={16} />} title={account.email ? maskEmail(account.email) : t('Đã đăng nhập')} description={t('Phiên đã hết. Dữ liệu trên máy này còn nguyên.')}>
    <Button variant="primary" disabled={busy} onClick={() => void signIn()}><LogIn size={14} />{t('Đăng nhập lại')}</Button>
  </Row>;

  return <>
    <Row icon={<UserRoundCheck size={16} />} title={account.email ? maskEmail(account.email) : t('Đã đăng nhập')} description={account.name}>
      <Button variant="outline" disabled={busy} onClick={signOut}><LogOut size={14} />{t('Đăng xuất')}</Button>
    </Row>
    <Row icon={<Gem size={16} />} title={t('Gói')}>
      <span className="setting-value">{planName(account.plan)}</span>
    </Row>
    <SyncRow busy={busy} />
    <AnalyticsRow busy={busy} />
  </>;
}
