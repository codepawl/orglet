import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, Eye } from 'lucide-react';
import type { Workspace } from '../../shared/contracts';
import { automaticUpdateBlock, type MarketInstallation, type MarketUpdate, type MarketUpdateBlock, type MarketUpdateRecord } from '../../shared/market';
import { orglet } from '../api';
import { t, tMessage } from '../i18n';
import { blockText, wideningText } from '../marketUpdateText';
import { Button } from './ui';
import { StatusMark } from './StatusMark';
import { MarketUpdateCard, addedNotice } from './Marketplace';
import { Skeleton } from '@codepawlhq/orglet-ui';

/** How long after the last change the lists are read again, so a busy chat behind the dialog does not make a call per event. */
const RELOAD_DELAY_MS = 600;

type Act = (action: () => Promise<string | void>, about?: string) => Promise<void>;

/**
 * The Marketplace part of the app's update place (Settings → About, beside the app's own update). It lists the things
 * added from the Marketplace that have a newer version, each with the same comparison the Marketplace page shows, and
 * says what the automatic path applied, failed or left for the person. Nothing here is a second way to update: both
 * buttons go through the preview and the token the Marketplace page uses.
 */
export function MarketUpdatesBlock({ workspace, busy, act }: { workspace: Workspace; busy: boolean; act: Act }) {
  const [installations, setInstallations] = useState<MarketInstallation[]>();
  const [records, setRecords] = useState<MarketUpdateRecord[]>([]);
  const [card, setCard] = useState<MarketUpdate>();
  const [held, setHeld] = useState<Record<string, MarketUpdateBlock>>({});
  const section = t('Cập nhật từ Marketplace');

  const reload = useCallback(async () => {
    setInstallations(await orglet.call('marketInstallations', {}));
    setRecords(await orglet.call('marketUpdateRecords', {}));
  }, []);

  // Opening the tab looks at the catalog once when something was added from it; with nothing added, nothing is fetched.
  useEffect(() => {
    let live = true;
    void (async () => {
      const saved = await orglet.call('marketInstallations', {});
      if (!live) return;
      setInstallations(saved);
      setRecords(await orglet.call('marketUpdateRecords', {}));
      if (saved.length === 0) return;
      await orglet.call('marketCatalog', { refresh: true });
      if (live) await reload();
    })().catch(() => { if (live) setInstallations(current => current ?? []); });
    return () => { live = false; };
  }, [reload]);

  // The app changed something (an automatic update finished, a copy was edited): read the two lists again, once things settle.
  useEffect(() => {
    const timer = window.setTimeout(() => void reload().catch(() => undefined), RELOAD_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [workspace, reload]);

  const available = (installations ?? []).filter(item => item.updateAvailable);
  const recordOf = (entityId: string) => records.find(record => record.entityId === entityId && record.status !== 'applied');
  const applied = records.filter(record => record.status === 'applied');

  /** Applies at once only what the automatic path would apply; anything else opens the comparison. Answers whether it applied. */
  const updateOne = async (item: MarketInstallation): Promise<boolean> => {
    const preview = await orglet.call('marketPreviewUpdate', { entityId: item.entityId });
    const block = automaticUpdateBlock(preview);
    if (block) {
      setHeld(current => ({ ...current, [item.entityId]: block }));
      setCard(preview);
      return false;
    }
    addedNotice(await orglet.call('marketApplyUpdate', { entityId: item.entityId, token: preview.token }));
    return true;
  };

  const updateSingle = (item: MarketInstallation) => void act(async () => {
    const done = await updateOne(item);
    await reload();
    return done ? t('Đã cập nhật {0}.', [item.name]) : undefined;
  }, section);

  const updateAll = () => void act(async () => {
    let updated = 0;
    let waiting = 0;
    let failed = 0;
    for (const item of available) {
      try {
        if (await updateOne(item)) updated += 1; else waiting += 1;
      } catch {
        failed += 1;
      }
    }
    setCard(undefined);
    await reload();
    const parts = [t('Đã cập nhật {0} mục.', [updated])];
    if (waiting > 0) parts.push(t('{0} mục cần bạn xem trước.', [waiting]));
    if (failed > 0) parts.push(t('{0} mục chưa cập nhật được.', [failed]));
    return parts.join(' ');
  }, section);

  const preview = (item: MarketInstallation) => void act(async () => {
    setCard(await orglet.call('marketPreviewUpdate', { entityId: item.entityId }));
  }, section);

  return <>
    <div className="settings-subheading-row">
      <h3 className="settings-subheading">{section}</h3>
      {available.length > 1 && <Button variant="outline" disabled={busy} onClick={updateAll}><ArrowDownToLine size={14} />{t('Cập nhật tất cả')}</Button>}
    </div>
    {!installations && <div className="setting-row"><div className="setting-text"><Skeleton width="50%" /></div></div>}
    {installations && available.length === 0 && applied.length === 0 && <div className="setting-row">
      <div className="setting-text"><span className="setting-description">{t('Không có mục nào từ Marketplace cần cập nhật.')}</span></div>
    </div>}
    {applied.map(record => <AppliedRow key={record.entityId} record={record} />)}
    {available.map(item => <AvailableRow key={item.entityId} item={item} record={recordOf(item.entityId)} blocked={held[item.entityId]} busy={busy} onPreview={() => preview(item)} onUpdate={() => updateSingle(item)} />)}
    {card && <MarketUpdateCard update={card} onClose={() => setCard(undefined)} onApplied={async result => { addedNotice(result); setCard(undefined); await reload(); }} />}
  </>;
}

function AppliedRow({ record }: { record: MarketUpdateRecord }) {
  const details = [record.changed.length ? t('Đã đổi: {0}', [record.changed.join(', ')]) : '', record.changelog ?? ''].filter(Boolean);
  return <div className="setting-row">
    <div className="setting-text">
      <span className="setting-title market-update-title"><StatusMark variant="filled" tone="success" label={t('Đã cập nhật')} decorative />{t('Đã cập nhật {0} lên v{1}', [record.name, record.toVersion])}</span>
      {details.map(line => <span key={line} className="setting-description">{line}</span>)}
    </div>
  </div>;
}

function AvailableRow({ item, record, blocked, busy, onPreview, onUpdate }: {
  item: MarketInstallation; record: MarketUpdateRecord | undefined; blocked: MarketUpdateBlock | undefined; busy: boolean; onPreview: () => void; onUpdate: () => void;
}) {
  const version = item.latestVersion ? `v${item.version} → v${item.latestVersion}` : `v${item.version}`;
  const block = record?.block ?? blocked;
  return <div className="setting-row">
    <div className="setting-text">
      <span className="setting-title">{item.name}</span>
      <span className="setting-description">{version}</span>
      {record?.status === 'failed' && <span className="setting-description error outcome-line"><StatusMark variant="filled" tone="error" label={t('Không thành công')} decorative />{t('Tự cập nhật không thành công: {0}', [tMessage(record.reason ?? '')])}</span>}
      {block && <span className="setting-description outcome-line"><StatusMark variant="asking" tone="accent" label={t('Cần bạn xem')} decorative />{blockText(block)}</span>}
      {record?.widening?.map((entry, index) => <span key={index} className="setting-description">{wideningText(entry)}</span>)}
    </div>
    <div className="setting-control">
      <Button variant="outline" disabled={busy} onClick={onPreview}><Eye size={14} />{t('Xem thay đổi')}</Button>
      <Button variant="outline" disabled={busy} onClick={onUpdate}><ArrowDownToLine size={14} />{t('Cập nhật')}</Button>
    </div>
  </div>;
}
