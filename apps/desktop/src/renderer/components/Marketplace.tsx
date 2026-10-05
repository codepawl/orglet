import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ChevronLeft, ChevronRight, Flag, RefreshCw, ShieldCheck, UserRoundPlus, X } from 'lucide-react';
import type { MarketCatalogView, MarketInstallation, MarketUpdate, MarketAdded } from '../../shared/market';
import { orglet } from '../api';
import { t, tMessage } from '../i18n';
import { Button, Drawer, PanelHeading } from './ui';
import { toast } from './toast';
import { MarketOwnListings } from './MarketPublishing';
import { Select } from './Select';
import { useMarketModeration } from './MarketModeration';
import { MARKET_SEED_BODIES } from '../../shared/market-seed';
import { PageTabs } from './PageTabs';
import { RowMenu } from './RowMenu';

function addedNotice(result: MarketAdded) {
  if (result.fallbackNames.length) toast(t('Đã dùng kết nối mặc định cho {0}; kết nối gợi ý chưa sẵn sàng.', [result.fallbackNames.join(', ')]));
}

export function Marketplace({ onAdded }: { onAdded: (result: MarketAdded) => void | Promise<void> }) {
  const moderation = useMarketModeration();
  const [catalog, setCatalog] = useState<MarketCatalogView>();
  const [installed, setInstalled] = useState<MarketInstallation[]>([]);
  const [tab, setTab] = useState<'discover' | 'own'>('discover');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const viewGeneration = useRef(0);
  const [error, setError] = useState('');
  const [update, setUpdate] = useState<MarketUpdate>();
  const [previousPages, setPreviousPages] = useState<(string | undefined)[]>([]);
  const load = async (refresh: boolean) => {
    const next = await orglet.call('marketCatalog', { refresh });
    setCatalog(next);
    setPreviousPages([]);
    setInstalled(await orglet.call('marketInstallations', {}));
    if (refresh) await moderation.refresh();
  };
  useEffect(() => {
    let mounted = true;
    const generation = viewGeneration.current;
    void (async () => {
      const cached = await orglet.call('marketCatalog', {});
      if (!mounted) return;
      const saved = await orglet.call('marketInstallations', {});
      if (!mounted || generation !== viewGeneration.current) return;
      setCatalog(cached);
      setInstalled(saved);
      const fresh = await orglet.call('marketCatalog', { refresh: true });
      if (!mounted || generation !== viewGeneration.current) return;
      const installations = await orglet.call('marketInstallations', {});
      if (mounted && generation === viewGeneration.current) { setCatalog(fresh); setInstalled(installations); }
    })().catch(reason => { if (mounted && generation === viewGeneration.current) setError(tMessage(String(reason.message ?? reason))); })
      .finally(() => { if (mounted) setRefreshing(false); });
    return () => { mounted = false; };
  }, []);
  const action = async (operation: () => Promise<void>) => {
    viewGeneration.current += 1;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (reason) {
      setError(tMessage(reason instanceof Error ? reason.message : String(reason)));
    } finally {
      setBusy(false);
    }
  };
  return <section className="page-section marketplace" aria-labelledby="marketplace-title">
    <PanelHeading title={<span id="marketplace-title">{t('Marketplace')}</span>} description={tab === 'discover' ? t('Mẫu công khai đã được duyệt. Thêm bản sao của riêng bạn, không cần tài khoản.') : undefined}>
      {moderation.entry}
      {tab === 'discover' && <Button type="button" variant="outline" disabled={busy || refreshing} onClick={() => void action(() => load(true))}><RefreshCw size={16} />{refreshing ? t('Đang làm mới') : t('Làm mới')}</Button>}
    </PanelHeading>
    <PageTabs tabs={[{ id: 'discover', label: t('Khám phá') }, { id: 'own', label: t('Mục của tôi') }]} current={tab} onSelect={setTab} label={t('Các phần của marketplace')} />
    {tab === 'discover' ? <div className="marketplace-discover">
    {catalog && <p className="muted marketplace-source" role="status">{catalog.source === 'online' ? t('Danh mục trực tuyến') : catalog.source === 'cache' ? t('Danh mục đã lưu trên máy') : t('Danh mục CodePawl đi kèm app')}{catalog.fetchedAt && ` · ${new Date(catalog.fetchedAt).toLocaleString()}`}</p>}
    {catalog?.error && <p className="muted" role="status">{tMessage(catalog.error)}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {catalog?.source === 'cache' && !!catalog.cachedPages?.length && <Select label={t('Mở trang đã lưu')} value={catalog.pageCursor ?? ''} disabled={busy} options={[
      { value: '', label: t('Trang đầu đã lưu') },
      ...catalog.cachedPages.map((page, index) => ({ value: page.cursor, label: t('Bản lưu {0}: {1}', [index + 1, page.name || t('Trang trống')]) })),
    ]} onChange={cursor => void action(async () => {
      setCatalog(await orglet.call('marketCatalog', { cursor: cursor || undefined }));
      setPreviousPages([]);
    })} />}
    {!catalog ? <div className="marketplace-loading" aria-label={t('Đang tải danh mục')}><div /><div /></div> : <ul className="friends-sources">
      {catalog.listings.length === 0 && <li className="marketplace-empty muted">{t('Chưa có mẫu trên trang này. Bạn có thể làm mới hoặc mở một trang đã lưu.')}</li>}
      {catalog.listings.map(listing => {
        const copies = installed.filter(item => item.listingId === listing.listingId);
        const publicListing = 'reviewDigest' in listing && !MARKET_SEED_BODIES[`${listing.listingId}:${listing.version}`] ? listing : undefined;
        return <li key={listing.listingId} className="friend-source marketplace-listing">
        <div className="friend-source-text">
          <h3 className="friend-name">{listing.name}</h3><p className="market-listing-summary">{listing.summary}</p>
          <div className="market-listing-meta"><span>{listing.kind === 'space' ? t('Không gian') : listing.kind === 'crew' ? t('Nhóm Tí') : t('Tí')}</span><span className="market-listing-author">{typeof listing.author === 'string' ? listing.author : listing.author.displayName}</span><span>{listing.language.toUpperCase()} · v{listing.version}</span><span>{listing.license}</span></div>
          {copies.length > 0 && <p className="market-listing-installed">{copies.length === 1 ? t('Đã thêm') : t('Đã thêm {0} bản trên máy', [copies.length])}{copies.some(item => item.updateAvailable) && ` · ${t('Có bản cập nhật')}`}</p>}
        </div>
        <div className="market-listing-actions">
        <Button type="button" variant="primary" disabled={busy} onClick={() => void action(async () => {
          const result = await orglet.call('marketAdd', { listingId: listing.listingId, version: listing.version });
          addedNotice(result);
          await onAdded(result);
          setInstalled(await orglet.call('marketInstallations', {}));
        })}><UserRoundPlus size={16} />{copies.length ? t('Thêm bản nữa') : t('Thêm bạn')}</Button>
        {publicListing && <RowMenu label={t('Tùy chọn {0}', [listing.name])} disabled={busy} items={[
          { label: t('Report'), icon: Flag, onSelect: () => moderation.setReport(publicListing) },
          ...(moderation.capability?.canReview ? [{ label: t('Xem để duyệt'), icon: ShieldCheck, onSelect: () => moderation.setReview(publicListing) }] : []),
        ]} />}
        </div>
      </li>; })}
    </ul>}
    {(previousPages.length > 0 || catalog?.nextCursor) && <div className="marketplace-pagination">
      <Button type="button" variant="outline" disabled={busy || previousPages.length === 0} onClick={() => void action(async () => {
        const cursor = previousPages.at(-1);
        const next = await orglet.call('marketCatalog', { cursor });
        setCatalog(next);
        setPreviousPages(cursor === next.pageCursor ? previousPages.slice(0, -1) : []);
      })}><ChevronLeft size={16} />{t('Trang trước')}</Button>
      <Button type="button" variant="outline" disabled={busy || !catalog?.nextCursor} onClick={() => void action(async () => {
        const cursor = catalog!.nextCursor!;
        const next = await orglet.call('marketCatalog', { refresh: true, cursor });
        setCatalog(next);
        if (next.pageCursor === cursor) setPreviousPages(pages => {
          const history = [...pages, catalog!.pageCursor];
          return history.length <= 9 ? history : [history[0], ...history.slice(-8)];
        });
        else setPreviousPages([]);
      })}><ChevronRight size={16} />{t('Trang tiếp theo')}</Button>
    </div>}
    {installed.some(item => item.updateAvailable) && <section className="marketplace-updates" aria-label={t('Có bản cập nhật')}><h3>{t('Có bản cập nhật')}</h3>
    {installed.filter(item => item.updateAvailable).map(item => <div className="friend-source" key={item.entityId}>
      <span className="friend-source-text"><span className="friend-name">{item.name}</span><span className="friend-status">{t('Có bản cập nhật')} · v{item.version}</span></span>
      <Button type="button" variant="outline" aria-disabled={busy} onClick={() => {
        if (busy) return;
        void action(async () => setUpdate(await orglet.call('marketPreviewUpdate', { entityId: item.entityId })));
      }}><ArrowDownToLine size={16} />{t('Xem bản cập nhật')}</Button>
    </div>)}</section>}
    </div> : <MarketOwnListings />}
    {moderation.recovery}
    {moderation.dialogs}
    {update && <MarketUpdateCard update={update} onClose={() => setUpdate(undefined)} onApplied={async result => { addedNotice(result); setUpdate(undefined); await load(false); }} />}
  </section>;
}

/** Profiles fetch origin metadata independently; ordinary friends have no marketplace link. */
export function MarketProfileUpdate({ entityId, onUpdated }: { entityId: string; onUpdated: () => void }) {
  const [installation, setInstallation] = useState<MarketInstallation>();
  const [update, setUpdate] = useState<MarketUpdate>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const saved = await orglet.call('marketInstallations', {});
      if (!mounted) return;
      const current = saved.find(item => item.entityId === entityId);
      setInstallation(current);
      if (!current) return;
      await orglet.call('marketCatalog', { refresh: true });
      const fresh = await orglet.call('marketInstallations', {});
      if (mounted) setInstallation(fresh.find(item => item.entityId === entityId));
    })().catch(() => undefined);
    return () => { mounted = false; };
  }, [entityId]);
  if (!installation) return null;
  return <div className="marketplace-profile">
    <p className="muted">{t('Từ marketplace')} · {installation.listingId} · v{installation.version}</p>
    <Button type="button" variant="outline" aria-disabled={busy} onClick={() => {
      if (busy) return;
      setBusy(true);
      setError('');
      void orglet.call('marketPreviewUpdate', { entityId }).then(setUpdate).catch(reason => setError(tMessage(reason.message))).finally(() => setBusy(false));
    }}><ArrowDownToLine size={16} />{installation.updateAvailable ? t('Có bản cập nhật') : t('Kiểm tra bản cập nhật')}</Button>
    {error && <p className="error" role="alert">{error}</p>}
    {update && <MarketUpdateCard update={update} onClose={() => setUpdate(undefined)} onApplied={result => { addedNotice(result); setUpdate(undefined); onUpdated(); }} />}
  </div>;
}

function MarketUpdateCard({ update, onClose, onApplied }: { update: MarketUpdate; onClose: () => void; onApplied: (result: MarketAdded) => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <Drawer open title={t('Cập nhật {0}', [update.listing.name])} description={`v${update.installedVersion} → v${update.listing.version}`} onClose={onClose}>
    <div className="marketplace-update">
      <p>{update.listing.changelog}</p>
      <p className="muted">{update.customization === 'customized' ? t('Bạn đã chỉnh sửa bản này. Áp dụng sẽ thay nội dung mẫu bằng bản bên phải; kết nối và quyền trên máy vẫn giữ nguyên.')
        : update.customization === 'unknown' ? t('Orglet không biết bản này đã được chỉnh sửa hay chưa. So sánh hai bên trước khi áp dụng; kết nối và quyền trên máy vẫn giữ nguyên.')
        : t('Áp dụng tạo bản sửa đổi mới. Lần chạy đang làm việc vẫn dùng bản đã bắt đầu.')}</p>
      {update.changes.map((change, index) => <section key={index} className="marketplace-comparison" aria-label={change.name}>
        <h3>{change.name}</h3>
        <div className="marketplace-comparison-columns"><div><p className="muted">{t('Bản của bạn')}</p><pre>{change.before || t('Chưa có')}</pre></div><div><p className="muted">{t('Bản mới')}</p><pre>{change.after}</pre></div></div>
      </section>)}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions"><Button type="button" variant="outline" disabled={busy} onClick={onClose}><X size={16} />{t('Hủy')}</Button><Button type="button" variant="primary" disabled={busy} onClick={() => {
        setBusy(true);
        void orglet.call('marketApplyUpdate', { entityId: update.entityId, token: update.token }).then(onApplied).catch(reason => setError(tMessage(reason.message))).finally(() => setBusy(false));
      }}><ArrowDownToLine size={16} />{t('Áp dụng bản cập nhật')}</Button></div>
    </div>
  </Drawer>;
}
