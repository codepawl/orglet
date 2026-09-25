import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Copy, ExternalLink, Globe, Plus, RefreshCw, RotateCw, X } from 'lucide-react';
import type { Workspace } from '../../shared/contracts';
import type { CliInstallState } from '../../shared/cli';
import { aboutDetailsText, osName, type AboutLink, type InstallKind, type Release, type UnsupportedReason, type UpdateState } from '../../shared/updates';
import { Button } from './ui';
import { Switch } from './Switch';
import { Markdown } from './Markdown';
import { BrandMark, type BrandName } from './brandMarks';
import { clockLabel } from './TimeMark';
import { currentLocale, t, tMessage } from '../i18n';
import { orglet } from '../api';
import { CommandBlock, Skeleton, SkeletonText } from '@codepawl/orglet-ui';
import { aboutInfo, APP_KEY, changelogs, updateStates } from '../caches';
import { useCached } from '../prefetch';

/** How the build got here, in the words the details line and the copied text use. */
function installLabel(kind: InstallKind): string {
  if (kind === 'dev') return t('Chạy từ mã nguồn');
  if (kind === 'squirrel') return t('Cài bằng Setup (Squirrel)');
  if (kind === 'portable') return t('Bản ZIP');
  if (kind === 'macos-app') return t('Ứng dụng macOS');
  return t('Bản ZIP Linux');
}

/** Why this build cannot replace itself, so the row says the reason rather than pretending to check. */
function unsupportedReason(reason: UnsupportedReason): string {
  if (reason === 'dev') return t('Bản chạy từ mã nguồn không tự cập nhật.');
  if (reason === 'portable') return t('Bản ZIP không tự cập nhật.');
  if (reason === 'linux') return t('Chưa có tự cập nhật trên Linux.');
  return t('Bản macOS này chưa được ký nên không tự cập nhật.');
}

/** The places the About tab links to, each with its own mark. `releases` is not here: it belongs to the update row. */
const links: { link: Exclude<AboutLink, 'releases'>; label: string; brand?: BrandName }[] = [
  { link: 'website', label: 'Website' },
  { link: 'github', label: 'GitHub', brand: 'github' },
  { link: 'discord', label: 'Discord', brand: 'discord' },
  { link: 'x', label: 'X', brand: 'x' },
  { link: 'threads', label: 'Threads', brand: 'threads' },
];

/** A name as a shell argument: quoted when it has a space or a quote in it. */
function shellWord(name: string): string {
  return /^[\p{L}\p{N}._-]+$/u.test(name) ? name : `"${name.replaceAll('"', '\\"')}"`;
}

/** What the command row says under its title, for each way this build can offer the command. */
function commandLineDescription(state: CliInstallState): string {
  if (state.mode === 'dev') return t('Lệnh orglet chạy từ bản cài. Trong mã nguồn, thử bằng pnpm orglet khi pnpm dev đang chạy.');
  if (state.mode === 'manual') return t('Thêm thư mục của lệnh vào PATH bằng dòng dưới đây, trong tệp khởi động của shell như ~/.zprofile.');
  if (state.installed) return t('Đã có trong PATH. Mở terminal mới rồi thử lệnh dưới đây.');
  return t('Gửi tin cho Tí và đọc câu trả lời từ terminal. Lệnh chỉ nói chuyện với app đang chạy trên máy này.');
}

function commandLineExample(state: CliInstallState, firstOrglet: string | undefined): string {
  if (state.mode === 'dev') return 'pnpm orglet status';
  if (state.mode === 'manual') return state.command;
  return `orglet send "${t('Chào')}" --to ${shellWord(firstOrglet ?? 'Researcher')}`;
}

/**
 * The `orglet` terminal command (COD-234). On a packaged Windows build the row adds it to the user's PATH and takes
 * it off again; main decides where the shim goes, so the window only says on or off.
 */
function CommandLineRow({ workspace, busy, act }: { workspace: Workspace; busy: boolean; act: (action: () => Promise<string | void>, about?: string) => Promise<void> }) {
  const [state, setState] = useState<CliInstallState>();
  const title = t('Lệnh orglet trong terminal');
  useEffect(() => {
    let live = true;
    orglet.cliState().then(next => { if (live) setState(next); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const toggle = (enabled: boolean) => void act(async () => {
    setState(await orglet.setCliOnPath(enabled));
    return enabled ? t('Đã thêm orglet vào PATH. Mở terminal mới để dùng.') : t('Đã gỡ orglet khỏi PATH.');
  }, title);
  const copy = (command: string) => void act(async () => {
    await orglet.copyText(command);
    return t('Đã sao chép lệnh');
  }, title);
  // The button centres on the title and description; the command card runs under both, in the text column.
  return <div className="about-command-line">
    <Row title={title} description={state ? commandLineDescription(state) : <Skeleton width="60%" />}>
      {state?.mode === 'windows' && (state.installed
        ? <Button variant="outline" disabled={busy} onClick={() => toggle(false)}><X size={14} />{t('Gỡ khỏi PATH')}</Button>
        : <Button variant="outline" disabled={busy} onClick={() => toggle(true)}><Plus size={14} />{t('Thêm vào PATH')}</Button>)}
    </Row>
    {state && <CommandBlock command={commandLineExample(state, workspace.workers[0]?.name)} copyLabel={t('Sao chép lệnh')} copyIcon={<Copy size={14} />} onCopy={copy} />}
  </div>;
}

function Row({ title, description, children, id }: { title: string; description?: ReactNode; children?: ReactNode; id?: string }) {
  return <div className="setting-row">
    <div className="setting-text"><span id={id} className="setting-title">{title}</span>{description && <span className="setting-description">{description}</span>}</div>
    {children && <div className="setting-control">{children}</div>}
  </div>;
}

/** What the update row says under its title. Every branch reads the state the main process pushed. */
function updateDescription(state: UpdateState | undefined): ReactNode {
  if (!state) return <Skeleton width="60%" />;
  if (state.status === 'unsupported') return unsupportedReason(state.reason);
  if (state.status === 'idle') return t('Chưa kiểm tra trong phiên này.');
  if (state.status === 'checking') return t('Đang kiểm tra…');
  if (state.status === 'downloading') return t('Có bản mới, đang tải ngầm…');
  if (state.status === 'up-to-date') return t('Đang dùng bản mới nhất. Kiểm tra lúc {0}.', [clockLabel(state.checkedAt)]);
  if (state.status === 'ready') {
    return state.version
      ? t('Bản {0} đã tải xong. Khởi động lại để dùng, hoặc đợi lần mở sau.', [state.version])
      : t('Bản mới đã tải xong. Khởi động lại để dùng, hoặc đợi lần mở sau.');
  }
  return <span className="error">{t('Không kiểm tra được: {0}', [tMessage(state.message)])}</span>;
}

function releaseDate(release: Release): string | undefined {
  if (!release.publishedAt) return undefined;
  return new Date(release.publishedAt).toLocaleDateString(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Settings → Giới thiệu (COD-176): the running build, its updater, where to find the project, and what changed.
 * Everything technical comes from the main process; this component only asks and shows.
 */
export function AboutSettings({ workspace, busy, onAutoUpdate, act }: {
  workspace: Workspace; busy: boolean;
  onAutoUpdate: (value: boolean) => void;
  act: (action: () => Promise<string | void>, about?: string) => Promise<void>;
}) {
  // The build, the updater's state and the release list are kept for the session (COD-218): resting on the way
  // here fetches them, and the tab draws what it has at once. The updater keeps pushing its state; the newest
  // push wins over the kept copy.
  const about = useCached(aboutInfo, APP_KEY);
  const keptUpdate = useCached(updateStates, APP_KEY);
  const [pushedUpdate, setPushedUpdate] = useState<UpdateState>();
  const update = pushedUpdate ?? keptUpdate;
  const changelog = useCached(changelogs, APP_KEY);
  const [changelogBusy, setChangelogBusy] = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  const section = t('Giới thiệu');

  const reloadChangelog = useCallback(async () => {
    setChangelogBusy(true);
    try { changelogs.set(APP_KEY, await orglet.changelog(true)); }
    catch (error) { changelogs.set(APP_KEY, { releases: [], fetchedAt: null, stale: true, error: (error as Error).message }); }
    finally { setChangelogBusy(false); }
  }, []);
  const takeUpdate = (state: UpdateState) => { updateStates.set(APP_KEY, state); setPushedUpdate(state); };

  useEffect(() => {
    let live = true;
    const stop = orglet.onUpdate(state => { if (live) takeUpdate(state); });
    return () => { live = false; stop(); };
  }, []);

  const unsupported = update?.status === 'unsupported';
  const openLink = (link: AboutLink) => void act(async () => { await orglet.openLink(link); }, section);
  const copyDetails = () => void act(async () => {
    if (!about) return;
    await orglet.copyText(aboutDetailsText(about, workspace.sqliteVersion, installLabel(about.install)));
    return t('Đã sao chép chi tiết bản cài');
  }, section);
  const checkNow = () => void act(async () => { takeUpdate(await orglet.checkForUpdates()); }, section);
  const restart = () => void act(async () => { await orglet.installUpdate(); }, section);

  const detailsLine = about
    ? [`Electron ${about.electron}`, `Chromium ${about.chromium}`, `Node ${about.node}`, `SQLite ${workspace.sqliteVersion}`, `${osName(about.platform)} ${about.osRelease} ${about.arch}`, installLabel(about.install)].join(' · ')
    : `SQLite ${workspace.sqliteVersion}`;

  const releases = changelog?.releases ?? [];
  const [newest, ...older] = releases;
  const shown = showOlder ? releases : newest ? [newest] : [];
  const fetchedAt = changelog?.fetchedAt ? clockLabel(changelog.fetchedAt) : undefined;

  return <>
    <div className="about-head">
      <span className="orglet-mark large" aria-hidden="true">o</span>
      <div className="about-name">
        <span className="about-title">Orglet</span>
        <span className="setting-description">{about ? t('Phiên bản {0}', [about.version]) : <Skeleton width="9ch" />}</span>
      </div>
    </div>

    <Row title={t('Kiểm tra cập nhật')} description={updateDescription(update)}>
      {unsupported
        ? <Button variant="outline" disabled={busy} onClick={() => openLink('releases')}><ExternalLink size={14} />{t('Mở trang phát hành')}</Button>
        : update?.status === 'ready'
          ? <Button variant="outline" disabled={busy} onClick={restart}><RotateCw size={14} />{t('Khởi động lại')}</Button>
          : <Button variant="outline" disabled={busy || !update || update.status === 'checking' || update.status === 'downloading'} onClick={checkNow}><RefreshCw size={14} />{t('Kiểm tra')}</Button>}
    </Row>
    <Row id="auto-update-label" title={t('Tự động cập nhật')} description={t('Tải ngầm bản mới rồi báo để bạn khởi động lại.')}>
      <Switch checked={workspace.autoUpdate} disabled={busy || unsupported} labelledBy="auto-update-label" onChange={onAutoUpdate} />
    </Row>
    <Row title={t('Chi tiết bản cài')} description={<span className="about-details">{detailsLine}</span>}>
      <Button variant="outline" disabled={busy || !about} onClick={copyDetails}><Copy size={14} />{t('Sao chép')}</Button>
    </Row>
    <CommandLineRow workspace={workspace} busy={busy} act={act} />

    <div className="setting-row about-links-row">
      <div className="setting-text">
        <span className="setting-title">{t('Cộng đồng và mã nguồn')}</span>
        <div className="about-links">
          {links.map(item => <Button key={item.link} variant="outline" disabled={busy} onClick={() => openLink(item.link)}>
            {item.brand ? <BrandMark brand={item.brand} /> : <Globe size={15} aria-hidden="true" />}{item.label}
          </Button>)}
        </div>
      </div>
    </div>

    <div className="setting-row about-changelog">
      <div className="setting-text">
        <span className="setting-title">{t('Có gì mới')}{changelogBusy && <span className="setting-description setting-checking" role="status">{t('Đang tải lại…')}</span>}</span>
        {changelog?.error && <span className="setting-description">{fetchedAt
          ? t('Không tải được bản mới nhất; đang hiện danh sách lấy lúc {0}.', [fetchedAt])
          : t('Không tải được danh sách phát hành. Kiểm tra kết nối mạng rồi thử lại.')}</span>}
        {!changelog && <SkeletonText lines={3} className="release-shape" />}
        {shown.map(release => <article key={release.version} className="release">
          <div className="release-head">
            <span className="release-name">{release.name}</span>
            {about && release.version === about.version && <span className="badge">{t('Đang dùng')}</span>}
            {releaseDate(release) && <span className="setting-description">{releaseDate(release)}</span>}
          </div>
          {release.notes.trim() ? <Markdown text={release.notes} className="release-notes" /> : <span className="setting-description">{t('Bản này không có ghi chú.')}</span>}
        </article>)}
        {older.length > 0 && <Button className="about-older" disabled={changelogBusy} onClick={() => setShowOlder(value => !value)}>
          {showOlder ? t('Ẩn bản cũ hơn') : t('Hiện {0} bản cũ hơn', [older.length])}
        </Button>}
      </div>
      <div className="setting-control">
        <Button size="icon" aria-label={t('Tải lại danh sách phát hành')} title={t('Tải lại danh sách phát hành')} disabled={changelogBusy} onClick={() => void reloadChangelog()}><RefreshCw size={14} /></Button>
      </div>
    </div>
  </>;
}
