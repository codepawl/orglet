import { useEffect, useState } from 'react';
import { ArrowDownToLine, RefreshCw, UserRoundPlus, X } from 'lucide-react';
import type { MarketCatalogView, MarketInstallation, MarketUpdate, MarketAdded } from '../../shared/market';
import { orglet } from '../api';
import { t, tMessage } from '../i18n';
import { Button, Drawer, PanelHeading } from './ui';
import { toast } from './toast';

function addedNotice(result: MarketAdded) {
  if (result.fallbackNames.length) toast(t('Đã dùng kết nối mặc định cho {0}; kết nối gợi ý chưa sẵn sàng.', [result.fallbackNames.join(', ')]));
}

export function Marketplace({ onAdded }: { onAdded: (result: MarketAdded) => void }) {
  const [catalog, setCatalog] = useState<MarketCatalogView>();
  const [installed, setInstalled] = useState<MarketInstallation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [update, setUpdate] = useState<MarketUpdate>();
  const load = async (refresh: boolean) => {
    const next = await orglet.call('marketCatalog', { refresh });
    setCatalog(next);
    setInstalled(await orglet.call('marketInstallations', {}));
  };
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const cached = await orglet.call('marketCatalog', {});
      if (!mounted) return;
      setCatalog(cached);
      setInstalled(await orglet.call('marketInstallations', {}));
      const fresh = await orglet.call('marketCatalog', { refresh: true });
      if (!mounted) return;
      setCatalog(fresh);
      setInstalled(await orglet.call('marketInstallations', {}));
    })().catch(reason => { if (mounted) setError(tMessage(String(reason.message ?? reason))); });
    return () => { mounted = false; };
  }, []);
  const action = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await operation(); }
    catch (reason) { setError(tMessage(reason instanceof Error ? reason.message : String(reason))); }
    finally { setBusy(false); }
  };
  return <section className="page-section marketplace" aria-labelledby="marketplace-title">
    <PanelHeading title={<span id="marketplace-title">{t('Khám phá')}</span>} description={t('Bạn làm sẵn từ CodePawl. Thêm bản sao của riêng bạn, không cần tài khoản.')}>
      <Button variant="ghost" disabled={busy} onClick={() => void action(() => load(true))}><RefreshCw size={16} />{t('Làm mới')}</Button>
    </PanelHeading>
    {catalog && <p className="muted marketplace-source" role="status">{catalog.source === 'online' ? t('Danh mục trực tuyến') : catalog.source === 'cache' ? t('Danh mục đã lưu trên máy') : t('Danh mục CodePawl đi kèm app')}{catalog.fetchedAt && ` · ${new Date(catalog.fetchedAt).toLocaleString()}`}</p>}
    {catalog?.error && <p className="muted" role="status">{tMessage(catalog.error)}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {!catalog ? <div className="marketplace-loading" aria-label={t('Đang tải danh mục')}><div /><div /></div> : <ul className="friends-sources">
      {catalog.listings.map(listing => <li key={listing.listingId} className="friend-source marketplace-listing">
        <span className="friend-source-text"><span className="friend-name">{listing.name}</span><span className="friend-status">{listing.summary}</span><span className="friend-status">{listing.kind === 'crew' ? t('Nhóm Tí') : t('Tí')} · {listing.author} · {listing.license} · {listing.language.toUpperCase()} · v{listing.version}</span></span>
        <Button variant="outline" disabled={busy} onClick={() => void action(async () => {
          const result = await orglet.call('marketAdd', { listingId: listing.listingId, version: listing.version });
          addedNotice(result);
          onAdded(result);
          setInstalled(await orglet.call('marketInstallations', {}));
        })}><UserRoundPlus size={16} />{t('Thêm bạn')}</Button>
      </li>)}
    </ul>}
    {installed.filter(item => item.updateAvailable).map(item => <div className="friend-source" key={item.entityId}>
      <span className="friend-source-text"><span className="friend-name">{item.name}</span><span className="friend-status">{t('Có bản cập nhật')} · v{item.version}</span></span>
      <Button variant="outline" disabled={busy} onClick={() => void action(async () => setUpdate(await orglet.call('marketPreviewUpdate', { entityId: item.entityId })))}><ArrowDownToLine size={16} />{t('Xem bản cập nhật')}</Button>
    </div>)}
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
    <p className="muted">{t('Từ danh mục CodePawl')} · {installation.listingId} · v{installation.version}</p>
    {installation.updateAvailable && <Button variant="outline" disabled={busy} onClick={() => {
      setBusy(true);
      setError('');
      void orglet.call('marketPreviewUpdate', { entityId }).then(setUpdate).catch(reason => setError(tMessage(reason.message))).finally(() => setBusy(false));
    }}><ArrowDownToLine size={16} />{t('Có bản cập nhật')}</Button>}
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
      <p className="muted">{update.customized ? t('Bạn đã chỉnh sửa bản này. Áp dụng sẽ thay nội dung mẫu bằng bản bên phải; kết nối và quyền trên máy vẫn giữ nguyên.') : t('Áp dụng tạo bản sửa đổi mới. Lần chạy đang làm việc vẫn dùng bản đã bắt đầu.')}</p>
      {update.changes.map((change, index) => <section key={index} className="marketplace-comparison" aria-label={change.name}>
        <h3>{change.name}</h3>
        <div className="marketplace-comparison-columns"><div><p className="muted">{t('Bản của bạn')}</p><pre>{change.before || t('Chưa có')}</pre></div><div><p className="muted">{t('Bản mới')}</p><pre>{change.after}</pre></div></div>
      </section>)}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions"><Button variant="outline" disabled={busy} onClick={onClose}><X size={16} />{t('Hủy')}</Button><Button variant="primary" disabled={busy} onClick={() => {
        setBusy(true);
        void orglet.call('marketApplyUpdate', { entityId: update.entityId, token: update.token }).then(onApplied).catch(reason => setError(tMessage(reason.message))).finally(() => setBusy(false));
      }}><ArrowDownToLine size={16} />{t('Áp dụng bản cập nhật')}</Button></div>
    </div>
  </Drawer>;
}
