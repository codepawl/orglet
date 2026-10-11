import { useState, type FormEvent } from 'react';
import { ArchiveRestore, FileUp, Store, UserPlus, UserRoundPlus } from 'lucide-react';
import { Input } from '@codepawlhq/orglet-ui';
import type { Worker } from '../../shared/contracts';
import { t } from '../i18n';
import { Avatar } from './Avatar';
import { Button, Drawer } from './ui';
import { ChatHeader } from './ChatViews';
import { Marketplace } from './Marketplace';
import type { MarketAdded } from '../../shared/market';

/** The pages Home can show in the main panel. Add orglet used to be one; it is a dialog now. */
export type HomePageView = 'market';

/**
 * Home's own page (COD-366): the marketplace, with a row in the sidebar (user, 2026-10-05). It used to sit inside a
 * page called Add friend, where nobody looked for it.
 */
export function MarketplacePage({ onMarketAdded }: { onMarketAdded: (result: MarketAdded) => void | Promise<void> }) {
  return <>
    <ChatHeader
      lead={<span className="topbar-title"><Store size={16} aria-hidden="true" /><span className="topbar-name">Marketplace</span></span>}
      actions={null} />
    <div className="page-scroll"><div className="page-body friends-add"><Marketplace onAdded={onMarketAdded} /></div></div>
  </>;
}

/**
 * Add orglet, in a dialog over the chat (user, 2026-10-06): it is one small form and a short list, which as a page
 * left the main panel mostly empty and took the chat away. It makes an orglet from a name or from a template file,
 * both on the first row, and lists the orglets to befriend again or bring back from the archive. Ready-made orglets
 * and spaces are the Marketplace page's, not this dialog's (owner, 2026-10-11). Each action closes the dialog.
 */
export function AddOrgletDialog({ open, onClose, archived, unfriended, onBefriend, onCreate, onRestore, onImport }: {
  open: boolean;
  onClose: () => void;
  archived: readonly Worker[];
  /** Orglets that are no longer friends but still answer in some places, with the names of those places. */
  unfriended: readonly { worker: Worker; stillIn: string }[];
  onBefriend: (worker: Worker) => void;
  /** Opens the new-orglet dialog with this name already typed. */
  onCreate: (name: string) => void;
  onRestore: (worker: Worker) => void;
  onImport: () => void;
}) {
  const [name, setName] = useState('');
  const create = (event: FormEvent) => {
    event.preventDefault();
    const typed = name.trim();
    if (!typed) return;
    setName('');
    onCreate(typed);
  };
  return <Drawer open={open} onClose={onClose} title={t('Thêm Tí')}>
    <div className="add-orglet">
      <section className="page-section" aria-label={t('Tạo Tí')}>
        <p className="muted">{t('Tạo một Tí mới bằng tên, rồi chọn việc Tí làm và model Tí dùng.')}</p>
        <form className="friends-add-form" onSubmit={create}>
          <Input aria-label={t('Tên Tí')} placeholder={t('Nhập tên Tí')} value={name} maxLength={80} onChange={event => setName(event.target.value)} />
          <Button type="submit" disabled={!name.trim()}><UserRoundPlus size={16} />{t('Tạo Tí')}</Button>
          <Button type="button" variant="outline" onClick={onImport}><FileUp size={16} />{t('Nhập mẫu')}</Button>
        </form>
      </section>
      {unfriended.length > 0 && <section className="page-section" aria-labelledby="friends-unfriended-title">
        <h2 id="friends-unfriended-title">{t('Không còn là bạn')}</h2>
        <ul className="friends-sources">
          {unfriended.map(({ worker, stillIn }) => <li key={worker.id} className="friend-source">
            <Avatar name={worker.name} seed={worker.id} emoji={worker.avatar?.emoji} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="md" />
            <span className="friend-source-text"><span className="friend-name">{worker.name}</span><span className="friend-status">{t('Vẫn ở {0}', [stillIn])}</span></span>
            <Button variant="outline" onClick={() => onBefriend(worker)}><UserPlus size={16} />{t('Kết bạn lại')}</Button>
          </li>)}
        </ul>
      </section>}
      {archived.length > 0 && <section className="page-section" aria-labelledby="friends-archived-title">
        <h2 id="friends-archived-title">{t('Đã lưu trữ')}</h2>
        <ul className="friends-sources">
          {archived.map(worker => <li key={worker.id} className="friend-source">
            <Avatar name={worker.name} seed={worker.id} emoji={worker.avatar?.emoji} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="md" />
            <span className="friend-source-text"><span className="friend-name">{worker.name}</span>{worker.description && <span className="friend-status">{worker.description}</span>}</span>
            <Button variant="outline" onClick={() => onRestore(worker)}><ArchiveRestore size={16} />{t('Khôi phục')}</Button>
          </li>)}
        </ul>
      </section>}
    </div>
  </Drawer>;
}
