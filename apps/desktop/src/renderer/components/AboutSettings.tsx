import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Copy, ExternalLink, Globe, RefreshCw, RotateCw } from 'lucide-react';
import type { Workspace } from '../../shared/contracts';
import { aboutDetailsText, osName, type AboutInfo, type AboutLink, type Changelog, type InstallKind, type Release, type UnsupportedReason, type UpdateState } from '../../shared/updates';
import { Button } from './ui';
import { Switch } from './Switch';
import { Markdown } from './Markdown';
import { BrandMark, type BrandName } from './brandMarks';
import { clockLabel } from './TimeMark';
import { currentLocale, t, tMessage } from '../i18n';
import { orglet } from '../api';

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
  if (reason === 'portable') return t('Bản ZIP không tự cập nhật. Tải bản mới từ trang phát hành, hoặc cài bằng Setup để được tự cập nhật.');
  if (reason === 'linux') return t('Chưa có tự cập nhật trên Linux. Tải bản mới từ trang phát hành.');
  return t('Bản macOS này chưa được ký nên không tự cập nhật được. Tải bản mới từ trang phát hành.');
}

/** The places the About tab links to, each with its own mark. `releases` is not here: it belongs to the update row. */
const links: { link: Exclude<AboutLink, 'releases'>; label: string; brand?: BrandName }[] = [
  { link: 'website', label: 'Website' },
  { link: 'github', label: 'GitHub', brand: 'github' },
  { link: 'discord', label: 'Discord', brand: 'discord' },
  { link: 'x', label: 'X', brand: 'x' },
  { link: 'threads', label: 'Threads', brand: 'threads' },
];

function Row({ title, description, children, id }: { title: string; description?: ReactNode; children?: ReactNode; id?: string }) {
  return <div className="setting-row">
    <div className="setting-text"><span id={id} className="setting-title">{title}</span>{description && <span className="setting-description">{description}</span>}</div>
    {children && <div className="setting-control">{children}</div>}
  </div>;
}

/** What the update row says under its title. Every branch reads the state the main process pushed. */
function updateDescription(state: UpdateState | undefined): ReactNode {
  if (!state) return t('Đang đọc trạng thái…');
  if (state.status === 'unsupported') return unsupportedReason(state.reason);
  if (state.status === 'idle') return t('Chưa kiểm tra trong phiên này.');
  if (state.status === 'checking') return t('Đang kiểm tra…');
  if (state.status === 'downloading') return t('Có bản mới, đang tải ngầm…');
  if (state.status === 'up-to-date') return t('Đang dùng bản mới nhất. Kiểm tra lúc {0}.', [clockLabel(state.checkedAt)]);
  if (state.status === 'ready') {
    return state.version
      ? t('Bản {0} đã tải xong. Khởi động lại để dùng; nếu không, lần mở tiếp theo sẽ dùng bản mới.', [state.version])
      : t('Bản mới đã tải xong. Khởi động lại để dùng; nếu không, lần mở tiếp theo sẽ dùng bản mới.');
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
  const [about, setAbout] = useState<AboutInfo>();
  const [update, setUpdate] = useState<UpdateState>();
  const [changelog, setChangelog] = useState<Changelog>();
  const [changelogBusy, setChangelogBusy] = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  const section = t('Giới thiệu');

  const loadChangelog = useCallback(async (refresh: boolean) => {
    setChangelogBusy(true);
    try { setChangelog(await orglet.changelog(refresh)); }
    catch (error) { setChangelog({ releases: [], fetchedAt: null, stale: true, error: (error as Error).message }); }
    finally { setChangelogBusy(false); }
  }, []);

  useEffect(() => {
    let live = true;
    void orglet.about().then(info => { if (live) setAbout(info); }).catch(() => undefined);
    void orglet.updateState().then(state => { if (live) setUpdate(state); }).catch(() => undefined);
    const stop = orglet.onUpdate(state => { if (live) setUpdate(state); });
    void loadChangelog(false);
    return () => { live = false; stop(); };
  }, [loadChangelog]);

  const unsupported = update?.status === 'unsupported';
  const openLink = (link: AboutLink) => void act(async () => { await orglet.openLink(link); }, section);
  const copyDetails = () => void act(async () => {
    if (!about) return;
    await orglet.copyText(aboutDetailsText(about, workspace.sqliteVersion, installLabel(about.install)));
    return t('Đã sao chép chi tiết bản cài');
  }, section);
  const checkNow = () => void act(async () => { setUpdate(await orglet.checkForUpdates()); }, section);
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
        <span className="setting-description">{about ? t('Phiên bản {0}', [about.version]) : t('Đang đọc phiên bản…')}</span>
      </div>
    </div>

    <Row title={t('Kiểm tra cập nhật')} description={updateDescription(update)}>
      {unsupported
        ? <Button variant="outline" disabled={busy} onClick={() => openLink('releases')}><ExternalLink size={14} />{t('Mở trang phát hành')}</Button>
        : update?.status === 'ready'
          ? <Button variant="outline" disabled={busy} onClick={restart}><RotateCw size={14} />{t('Khởi động lại')}</Button>
          : <Button variant="outline" disabled={busy || !update || update.status === 'checking' || update.status === 'downloading'} onClick={checkNow}><RefreshCw size={14} />{t('Kiểm tra')}</Button>}
    </Row>
    <Row id="auto-update-label" title={t('Tự động cập nhật')} description={t('Kiểm tra sau khi mở app và vài giờ một lần, tải ngầm rồi báo để bạn khởi động lại. Tắt thì chỉ kiểm tra khi bạn bấm.')}>
      <Switch checked={workspace.autoUpdate} disabled={busy || unsupported} labelledBy="auto-update-label" onChange={onAutoUpdate} />
    </Row>
    <Row title={t('Chi tiết bản cài')} description={<span className="about-details">{detailsLine}</span>}>
      <Button variant="outline" disabled={busy || !about} onClick={copyDetails}><Copy size={14} />{t('Sao chép')}</Button>
    </Row>

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
        <span className="setting-title">{t('Có gì mới')}</span>
        {changelog?.error && <span className="setting-description">{fetchedAt
          ? t('Không tải được bản mới nhất; đang hiện danh sách lấy lúc {0}.', [fetchedAt])
          : t('Không tải được danh sách phát hành. Kiểm tra kết nối mạng rồi thử lại.')}</span>}
        {!changelog && <span className="setting-description">{t('Đang tải…')}</span>}
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
        <Button size="icon" aria-label={t('Tải lại danh sách phát hành')} title={t('Tải lại danh sách phát hành')} disabled={changelogBusy} onClick={() => void loadChangelog(true)}><RefreshCw size={14} /></Button>
      </div>
    </div>
  </>;
}
