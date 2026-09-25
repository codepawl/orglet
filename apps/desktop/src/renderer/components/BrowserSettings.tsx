import { useEffect, useState } from 'react';
import { AppWindow, Ban, Camera, Check, ExternalLink, Image, LogIn, MoveVertical, Plus, ScanSearch, ShieldCheck, Trash2, UserRound, X, type LucideIcon } from 'lucide-react';
import { Input } from '@codepawl/orglet-ui';
import type { TaskDetail } from '../../shared/contracts';
import { CLEAN_BROWSER_PROFILE, defaultBrowserChoice, normalizeBrowserSite, type BrowserAction, type BrowserActionKind, type BrowserChoice, type BrowserSite, type BrowserSiteDecision, type BrowserState } from '../../shared/browser';
import { Button, Drawer, FieldLabel } from './ui';
import { Select } from './Select';
import { RowMenu } from './RowMenu';
import { StatusMark } from './StatusMark';
import { currentLocale, t, tMessage, translated } from '../i18n';
import { orglet } from '../api';
import { toast } from './toast';

/*
 * Orglet's browser in the window (COD-261): the profiles in Settings → Browser, and a chat's profile, site list and
 * browser steps in Details. The window only shows state; main keeps the profiles and the core decides every step.
 */

const decisionNames: Record<BrowserSiteDecision, string> = translated({ allowed: 'Cho phép', blocked: 'Chặn' });

/** The browser Orglet found and the named profiles, read from main; `refresh` reads them again. */
export function useBrowserState(): { state: BrowserState | undefined; refresh: () => Promise<void> } {
  const [state, setState] = useState<BrowserState>();
  const refresh = async () => setState(await orglet.browserState());
  useEffect(() => {
    let live = true;
    void orglet.browserState().then(next => { if (live) setState(next); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  return { state, refresh };
}

/** The profile a chat uses, by name: Clean or one the person made. */
export function browserProfileName(profileId: string, state: BrowserState | undefined): string {
  if (profileId === CLEAN_BROWSER_PROFILE) return t('Sạch');
  return state?.profiles.find(profile => profile.id === profileId)?.name ?? t('Hồ sơ đã xóa');
}

export function profileOptions(state: BrowserState | undefined, current: string) {
  const named = state?.profiles ?? [];
  const options = [{ value: CLEAN_BROWSER_PROFILE, label: t('Sạch'), note: t('không lưu gì') }, ...named.map(profile => ({ value: profile.id, label: profile.name }))];
  if (!options.some(option => option.value === current)) options.push({ value: current, label: t('Hồ sơ đã xóa') });
  return options;
}

/**
 * A site list: each site with whether it is allowed or blocked and a remove button, and one row to add a site. It
 * only reports the new list; the caller saves it.
 */
export function BrowserSitesEditor({ sites, disabled, onChange }: { sites: readonly BrowserSite[]; disabled?: boolean; onChange: (next: BrowserSite[]) => void }) {
  const [text, setText] = useState('');
  const [decision, setDecision] = useState<BrowserSiteDecision>('allowed');
  const [error, setError] = useState('');
  // Not a form of its own: the list also sits inside the schedule editor, which is one.
  const add = () => {
    const site = normalizeBrowserSite(text);
    if (!site) { setError(t('Nhập một địa chỉ như example.com hoặc localhost:3000.')); return; }
    setError('');
    const others = sites.filter(entry => entry.site !== site);
    onChange([...others, { site, decision, addedAt: new Date().toISOString() }]);
    setText('');
  };
  return <div className="browser-sites">
    {sites.length > 0 && <ul className="browser-site-list" aria-label={t('Danh sách trang')}>
      {sites.map(entry => <li key={entry.site} className="browser-site">
        {entry.decision === 'allowed' ? <Check size={14} aria-hidden="true" /> : <Ban size={14} aria-hidden="true" />}
        <span className="browser-site-name" title={entry.site}>{entry.site}</span>
        <span className={`browser-site-decision ${entry.decision}`}>{decisionNames[entry.decision]}</span>
        <Button type="button" size="icon" disabled={disabled} aria-label={t('Bỏ {0} khỏi danh sách', [entry.site])} title={t('Bỏ {0} khỏi danh sách', [entry.site])}
          onClick={() => onChange(sites.filter(item => item.site !== entry.site))}><X size={14} /></Button>
      </li>)}
    </ul>}
    <div className="browser-site-add">
      <Input value={text} disabled={disabled} onChange={event => { setText(event.target.value); if (error) setError(''); }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} placeholder="localhost:3000" aria-label={t('Địa chỉ trang')} aria-invalid={error ? true : undefined} maxLength={260} />
      <Select ariaLabel={t('Cho phép hay chặn')} size="sm" value={decision} disabled={disabled} onChange={value => setDecision(value as BrowserSiteDecision)}
        options={[{ value: 'allowed', label: decisionNames.allowed }, { value: 'blocked', label: decisionNames.blocked }]} />
      <Button type="button" variant="outline" disabled={disabled || !text.trim()} onClick={add}><Plus size={14} />{t('Thêm')}</Button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}

/**
 * A chat's browser in Details, beside its MCP permissions: which profile it opens pages with and its site list. Shown
 * only while the chat may read pages. A side thread shows its main chat's rules and cannot change them (COD-247).
 */
export function BrowserChatSettings({ detail }: { detail: TaskDetail }) {
  const { state } = useBrowserState();
  const [busy, setBusy] = useState(false);
  if (!detail.task.toolCapabilities?.includes('browser.read')) return null;
  const choice = detail.task.browser ?? defaultBrowserChoice();
  const side = Boolean(detail.task.sideOf);
  const save = (next: BrowserChoice) => {
    setBusy(true);
    void orglet.call('setBrowser', { taskId: detail.task.id, browser: next })
      .catch(error => toast(tMessage(String(error)), 'error', t('Trình duyệt')))
      .finally(() => setBusy(false));
  };
  const signedIn = choice.profileId !== CLEAN_BROWSER_PROFILE;
  return <div className="permissions browser-chat">
    <div className="permission-folder">
      <span className="permission-folder-text">
        <span className="permission-folder-title"><UserRound size={15} aria-hidden="true" />{t('Hồ sơ trình duyệt')}</span>
        <span className="permission-folder-description">{signedIn ? t('Hồ sơ bạn đã đăng nhập; chỉ mở trang được phép.') : t('Không đăng nhập đâu, không lưu gì sau lượt chạy.')}</span>
      </span>
      <span className="permission-folder-control">
        <Select ariaLabel={t('Hồ sơ trình duyệt')} size="sm" value={choice.profileId} disabled={busy || side}
          onChange={value => save({ ...choice, profileId: value as BrowserChoice['profileId'] })} options={profileOptions(state, choice.profileId)} />
      </span>
    </div>
    <div className="browser-chat-sites">
      <p className="permission-folder-title"><ShieldCheck size={15} aria-hidden="true" />{t('Trang')}</p>
      <p className="permission-folder-description">{signedIn
        ? t('Hồ sơ đã đăng nhập chỉ mở trang được phép. Trang bị chặn không bao giờ mở.')
        : t('Trang công khai mở được, trừ trang bị chặn. Trang trên máy này hoặc mạng nội bộ chỉ mở khi bạn cho phép đúng địa chỉ, ví dụ localhost:3000.')}</p>
      <BrowserSitesEditor sites={choice.sites} disabled={busy || side} onChange={sites => save({ ...choice, sites })} />
    </div>
    {side && <p className="muted permission-footnote">{t('Chat phụ dùng trình duyệt của chat chính. Đổi ở chat chính.')}</p>}
  </div>;
}

const stepIcons: Record<BrowserActionKind, LucideIcon> = {
  open: AppWindow, snapshot: AppWindow, find: ScanSearch, screenshot: Camera, scroll: MoveVertical, tabs: AppWindow, close: X,
};

/** One journaled step in words: what the worker did, never which tool it called. */
function stepLabel(action: BrowserAction): string {
  const site = action.origin ? new URL(action.origin).host : '';
  const verb = action.kind === 'open' ? t('Mở trang') : action.kind === 'snapshot' ? t('Đọc nội dung trang') : action.kind === 'find' ? t('Tìm trên trang')
    : action.kind === 'screenshot' ? t('Chụp màn hình') : action.kind === 'scroll' ? t('Cuộn trang') : action.kind === 'tabs' ? t('Xem các tab') : t('Đóng tab');
  return site ? `${verb} ${site}` : verb;
}

const outcomeNames: Record<Exclude<BrowserAction['outcome'], 'done'>, string> = translated({ refused: 'bị chặn', failed: 'không thành', unknown: 'chưa rõ kết quả' });

/**
 * The browser steps of this chat in Details, newest first: each with its site and what came of it, and a screenshot
 * where one was kept. The window the orglet uses is real; "Show browser window" brings it forward.
 */
export function BrowserSteps({ detail }: { detail: TaskDetail }) {
  const [actions, setActions] = useState<BrowserAction[]>();
  const [shown, setShown] = useState<{ url: string; label: string }>();
  const eventCount = detail.events.length;
  useEffect(() => {
    let live = true;
    void orglet.call('browserActions', { taskId: detail.task.id }).then(next => { if (live) setActions(next); }).catch(() => undefined);
    return () => { live = false; };
  }, [detail.task.id, eventCount]);
  useEffect(() => () => { if (shown) URL.revokeObjectURL(shown.url); }, [shown]);
  if (!actions?.length) return null;
  const latestRun = actions.at(-1)!.runId;
  const running = detail.runs.some(run => run.id === latestRun && run.status === 'running');
  const showWindow = () => void orglet.showBrowser(running ? latestRun : null).then(opened => {
    if (!opened) toast(t('Không có cửa sổ trình duyệt nào đang mở.'), 'info', t('Trình duyệt'));
  }).catch(error => toast(tMessage(String(error)), 'error', t('Trình duyệt')));
  const openShot = (action: BrowserAction) => void orglet.call('browserScreenshot', { taskId: detail.task.id, id: action.screenshotId! }).then(shot => {
    const url = URL.createObjectURL(new Blob([shot.bytes as BlobPart], { type: shot.mimeType }));
    setShown({ url, label: stepLabel(action) });
  }).catch(error => toast(tMessage(String(error)), 'error', t('Ảnh màn hình')));
  const recent = [...actions].reverse().filter(action => action.kind !== 'tabs').slice(0, 12);
  return <section className="details-section browser-steps" aria-labelledby="browser-steps-heading">
    <h3 id="browser-steps-heading"><AppWindow size={15} aria-hidden="true" />{t('Trình duyệt')}</h3>
    <ol className="browser-step-list">
      {recent.map(action => {
        const Icon = stepIcons[action.kind];
        const outcome = action.outcome === 'done' ? undefined : outcomeNames[action.outcome];
        return <li key={action.id} className={action.outcome === 'done' ? 'browser-step' : 'browser-step browser-step-muted'}>
          <Icon size={14} aria-hidden="true" />
          <span className="browser-step-text">{stepLabel(action)}{outcome && <span className="muted"> · {outcome}</span>}</span>
          <time dateTime={action.at}>{new Date(action.at).toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' })}</time>
          {action.screenshotId && <Button size="icon" aria-label={t('Xem ảnh màn hình')} title={t('Xem ảnh màn hình')} onClick={() => openShot(action)}><Image size={14} /></Button>}
        </li>;
      })}
    </ol>
    <Button variant="outline" onClick={showWindow}><ExternalLink size={15} />{t('Hiện cửa sổ trình duyệt')}</Button>
    {shown && <Drawer open onClose={() => setShown(undefined)} title={shown.label}>
      <img className="browser-screenshot" src={shown.url} alt={t('Ảnh màn hình: {0}', [shown.label])} />
    </Drawer>}
  </section>;
}

type Act = (action: () => Promise<string | void>, about?: string) => Promise<void>;

/** The heading action of Settings → Browser: make a named profile. */
export function BrowserHeadingActions({ busy, onCreate }: { busy: boolean; onCreate: () => void }) {
  return <Button variant="primary" disabled={busy} onClick={onCreate}><Plus size={15} />{t('Thêm hồ sơ')}</Button>;
}

/**
 * Settings → Browser (COD-261): the browser Orglet found, the Clean profile, and the profiles the person made, each
 * with Open to sign in, Clear data and Delete. A profile is a folder main keeps; the window sees its name only.
 */
export function BrowserProfilesSettings({ busy, act, creating, onCreating }: { busy: boolean; act: Act; creating: boolean; onCreating: (open: boolean) => void }) {
  const { state, refresh } = useBrowserState();
  const run = (action: () => Promise<BrowserState>, message: string, about: string) => void act(async () => {
    await action();
    await refresh();
    return message;
  }, about);
  const browser = state?.browser;
  return <>
    <div role="region" aria-label={t('Trình duyệt')}>
      <div className="setting-row harness-row mcp-row">
        <span className="mcp-mark" aria-hidden="true"><AppWindow size={18} /></span>
        <div className="setting-text">
          <span className="harness-head">
            <span className="setting-title">{browser ? browser.name : t('Chưa có trình duyệt')}</span>
            {state && <span className={`status-pill ${browser ? 'logged_in' : 'logged_out'}`}>
              <StatusMark variant={browser ? 'filled' : 'dashed'} tone={browser ? 'success' : 'error'} label={browser ? t('Đã tìm thấy') : t('Không tìm thấy')} decorative />
              {browser ? t('Đã tìm thấy') : t('Không tìm thấy')}
            </span>}
          </span>
          <span className="setting-description">{browser
            ? t('Tí mở trang trong cửa sổ riêng của Orglet, với hồ sơ riêng, không bao giờ dùng hồ sơ hằng ngày của bạn.')
            : t('Cài Chrome hoặc Edge để Tí đọc được trang.')}{browser?.version ? ` ${t('Phiên bản {0}.', [browser.version])}` : ''}</span>
          {browser?.kind === 'edge' && <span className="setting-description">{t('Edge tự đăng nhập các trang Microsoft bằng tài khoản Windows trong hồ sơ có tên. Hồ sơ Sạch thì không. Có Chrome thì Orglet dùng Chrome.')}</span>}
        </div>
      </div>
      <div className="setting-row harness-row mcp-row">
        <span className="mcp-mark" aria-hidden="true"><ShieldCheck size={18} /></span>
        <div className="setting-text">
          <span className="setting-title">{t('Sạch')}</span>
          <span className="setting-description">{t('Mặc định. Mỗi lượt chạy mở một cửa sổ riêng tư, không đăng nhập đâu, và xóa sạch khi xong.')}</span>
        </div>
      </div>
      {state?.profiles.map(profile => <div key={profile.id} className="setting-row harness-row mcp-row">
        <span className="mcp-mark" aria-hidden="true"><UserRound size={18} /></span>
        <div className="setting-text">
          <span className="harness-head">
            <span className="setting-title">{profile.name}</span>
            {profile.open && <span className="status-pill logged_in"><StatusMark variant="filled" tone="success" label={t('Đang mở')} decorative />{t('Đang mở')}</span>}
          </span>
          <span className="setting-description">{profile.lastUsedAt
            ? t('Tạo {0} · dùng lần cuối {1}', [new Date(profile.createdAt).toLocaleDateString(currentLocale()), new Date(profile.lastUsedAt).toLocaleString(currentLocale(), { dateStyle: 'short', timeStyle: 'short' })])
            : t('Tạo {0} · chưa dùng', [new Date(profile.createdAt).toLocaleDateString(currentLocale())])}</span>
        </div>
        <div className="setting-control">
          <Button variant="outline" disabled={busy || !browser} onClick={() => run(() => orglet.openBrowserProfile(profile.id), t('Đã mở {0}. Đăng nhập trong cửa sổ đó.', [profile.name]), profile.name)}><LogIn size={14} />{t('Mở để đăng nhập')}</Button>
          <RowMenu label={t('Tùy chọn {0}', [profile.name])} items={[
            ...(profile.open ? [{ label: t('Đóng cửa sổ'), icon: X, onSelect: () => run(() => orglet.closeBrowserProfile(profile.id), t('Đã đóng {0}', [profile.name]), profile.name) }] : []),
            { label: t('Xóa dữ liệu'), icon: Trash2, confirm: { question: t('Xóa mọi đăng nhập, cookie và dữ liệu trang trong {0}? Hồ sơ vẫn còn.', [profile.name]), label: t('Xóa dữ liệu') },
              onSelect: () => run(() => orglet.clearBrowserProfile(profile.id), t('Đã xóa dữ liệu của {0}', [profile.name]), profile.name) },
            { label: t('Xóa hồ sơ'), icon: Trash2, danger: true, confirm: { question: t('Xóa {0} và mọi thứ trong đó? Chat đang dùng hồ sơ này sẽ không mở được trang cho tới khi bạn chọn hồ sơ khác.', [profile.name]), label: t('Xóa hồ sơ') },
              onSelect: () => run(() => orglet.deleteBrowserProfile(profile.id), t('Đã xóa {0}', [profile.name]), profile.name) },
          ]} />
        </div>
      </div>)}
    </div>
    {creating && <NewProfileDialog busy={busy} onClose={() => onCreating(false)} onCreate={name => run(async () => {
      const next = await orglet.createBrowserProfile(name);
      onCreating(false);
      return next;
    }, t('Đã tạo {0}', [name]), name)} />}
  </>;
}

function NewProfileDialog({ busy, onClose, onCreate }: { busy: boolean; onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState('');
  return <Drawer open onClose={onClose} title={t('Hồ sơ mới')} description={t('Mở hồ sơ để đăng nhập các trang bạn muốn Tí đọc. Chat dùng hồ sơ này chỉ mở trang bạn cho phép.')}>
    <form className="form" onSubmit={event => { event.preventDefault(); if (name.trim()) onCreate(name.trim()); }}>
      <label><FieldLabel icon={UserRound} required>{t('Tên hồ sơ')}</FieldLabel><Input value={name} onChange={event => setName(event.target.value)} maxLength={40} required placeholder={t('Ví dụ: Công việc')} autoFocus /></label>
      <div className="actions"><Button type="button" variant="outline" onClick={onClose}>{t('Hủy')}</Button><Button type="submit" variant="primary" disabled={busy || !name.trim()}>{t('Tạo hồ sơ')}</Button></div>
    </form>
  </Drawer>;
}
