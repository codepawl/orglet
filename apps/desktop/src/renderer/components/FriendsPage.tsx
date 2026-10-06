import { useState, type FormEvent } from 'react';
import { ArchiveRestore, FileUp, Store, UserRoundPlus } from 'lucide-react';
import { Input } from '@codepawlhq/orglet-ui';
import type { Worker } from '../../shared/contracts';
import { t } from '../i18n';
import { Avatar } from './Avatar';
import { Button, Drawer } from './ui';
import { ChatHeader } from './ChatViews';
import { Marketplace } from './Marketplace';
import type { MarketAdded } from '../../shared/market';

/** A ready-made group of orglets with its channel, offered under Add orglet (COD-366). */
export type FriendTemplate = { id: 'research-review' | 'eris-review'; name: string; description: string; orglets: number };

/** The pages Home can show in the main panel. Add orglet used to be one; it is a dialog now. */
export type HomePageView = 'market';

/**
 * Home's own page (COD-366): the marketplace, with a row in the sidebar (user, 2026-10-05). It used to sit inside a
 * page called Add friend, where nobody looked for it.
 */
export function MarketplacePage({ onMarketAdded }: { onMarketAdded: (result: MarketAdded) => void | Promise<void> }) {
  return <>
    <ChatHeader contentKey="home:market"
      lead={<span className="topbar-title"><Store size={16} aria-hidden="true" /><span className="topbar-name">Marketplace</span></span>}
      views={null} actions={null} />
    <div className="page-scroll"><div className="page-body friends-add"><Marketplace onAdded={onMarketAdded} /></div></div>
  </>;
}

/**
 * Add orglet, in a dialog over the chat (user, 2026-10-06): it is one small form and a short list, which as a page
 * left the main panel mostly empty and took the chat away. It makes an orglet from a name, and lists the other ways
 * to add one: a ready-made group, a template file, an archived orglet to bring back. Each of them closes the dialog.
 */
export function AddOrgletDialog({ open, onClose, archived, onCreate, onRestore, templates, onTemplate, onImport, busy }: {
  open: boolean;
  onClose: () => void;
  archived: readonly Worker[];
  /** Opens the new-orglet dialog with this name already typed. */
  onCreate: (name: string) => void;
  onRestore: (worker: Worker) => void;
  templates: readonly FriendTemplate[];
  onTemplate: (id: FriendTemplate['id']) => void;
  onImport: () => void;
  busy: boolean;
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
        </form>
      </section>
      <section className="page-section" aria-labelledby="friends-other-title">
        <h2 id="friends-other-title">{t('Cách khác để thêm Tí')}</h2>
        <p className="muted">{t('Không muốn tự tạo? Đưa về một Tí đã lưu trữ, chọn một nhóm làm sẵn hoặc nhập mẫu từ tệp.')}</p>
        <ul className="friends-sources">
          {templates.map(template => <li key={template.id} className="friend-source">
            <span className="friend-source-text"><span className="friend-name">{template.name}</span><span className="friend-status">{template.description}</span></span>
            <Button variant="outline" disabled={busy} onClick={() => onTemplate(template.id)}><UserRoundPlus size={16} />{t('Thêm {0} Tí', [template.orglets])}</Button>
          </li>)}
          <li className="friend-source">
            <span className="friend-source-text"><span className="friend-name">{t('Nhập mẫu từ tệp')}</span><span className="friend-status">{t('Một tệp mẫu đã xuất từ Orglet.')}</span></span>
            <Button variant="outline" disabled={busy} onClick={onImport}><FileUp size={16} />{t('Nhập mẫu')}</Button>
          </li>
          {archived.map(worker => <li key={worker.id} className="friend-source">
            <Avatar name={worker.name} seed={worker.id} emoji={worker.avatar?.emoji} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="md" />
            <span className="friend-source-text"><span className="friend-name">{worker.name}</span><span className="friend-status">{t('Đã lưu trữ')}</span></span>
            <Button variant="outline" disabled={busy} onClick={() => onRestore(worker)}><ArchiveRestore size={16} />{t('Khôi phục')}</Button>
          </li>)}
        </ul>
      </section>
    </div>
  </Drawer>;
}
