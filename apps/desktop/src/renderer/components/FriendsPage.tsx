import { useState, type FormEvent } from 'react';
import { Archive, ArchiveRestore, FileUp, MessageCircle, Pencil, Search, Trash, UserRoundPlus, Users } from 'lucide-react';
import { Input } from '@codepawl/orglet-ui';
import type { Worker } from '../../shared/contracts';
import { t } from '../i18n';
import { friendsMatching, type FriendsTab } from '../areas';
import { Avatar } from './Avatar';
import { Button } from './ui';
import { RowMenu } from './RowMenu';
import { ChatHeader } from './ChatViews';
import { PageTabs } from './PageTabs';
import { Marketplace } from './Marketplace';
import type { MarketAdded } from '../../shared/market';

/** A ready-made group of orglets with its channel, offered under Add friend (COD-366). */
export type FriendTemplate = { id: 'research-review' | 'eris-review'; name: string; description: string; orglets: number };

/**
 * The Home area's main page (COD-366), the way Discord's Home lists your friends: the orglets are your friends. Tabs
 * All and Working (the ones with a run going right now), and Add friend, which makes an orglet from a name or finds
 * one elsewhere: an archived orglet to bring back, a ready-made group, a template file. A row opens the orglet's DM.
 */
export function FriendsPage({ orglets, archived, working, tab, onTab, onMessage, onEdit, onArchive, onDelete, onCreate, onRestore, templates, onTemplate, onImport, onMarketAdded, busy }: {
  orglets: readonly Worker[];
  archived: readonly Worker[];
  working: ReadonlySet<string>;
  tab: FriendsTab;
  onTab: (tab: FriendsTab) => void;
  onMessage: (worker: Worker) => void;
  onEdit: (worker: Worker) => void;
  onArchive: (worker: Worker) => void;
  onDelete: (worker: Worker) => void;
  /** Opens the new-orglet dialog with this name already typed. */
  onCreate: (name: string) => void;
  onRestore: (worker: Worker) => void;
  templates: readonly FriendTemplate[];
  onTemplate: (id: FriendTemplate['id']) => void;
  onImport: () => void;
  onMarketAdded: (result: MarketAdded) => void | Promise<void>;
  busy: boolean;
}) {
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const workingCount = orglets.filter(worker => working.has(worker.id)).length;
  const tabs = [
    { id: 'all' as const, label: t('Tất cả'), count: orglets.length },
    { id: 'working' as const, label: t('Đang làm việc'), count: workingCount },
    { id: 'add' as const, label: t('Thêm bạn'), icon: <UserRoundPlus size={14} aria-hidden="true" /> },
  ];
  const create = (event: FormEvent) => {
    event.preventDefault();
    const typed = name.trim();
    if (!typed) return;
    setName('');
    onCreate(typed);
  };
  return <>
    <ChatHeader contentKey={`friends:${tab}:${orglets.length}:${workingCount}`}
      lead={<span className="topbar-title"><Users size={16} aria-hidden="true" /><span className="topbar-name">{t('Bạn bè')}</span></span>}
      views={<PageTabs tabs={tabs} current={tab} onSelect={onTab} label={t('Các phần của Bạn bè')} />} actions={null} />
    {tab === 'add' ? <div className="page-scroll"><div className="page-body friends-add">
      <section className="page-section" aria-labelledby="friends-add-title">
        <h2 id="friends-add-title">{t('Thêm bạn')}</h2>
        <p className="muted">{t('Tạo một Tí mới bằng tên, rồi chọn việc Tí làm và model Tí dùng.')}</p>
        <form className="friends-add-form" onSubmit={create}>
          <Input aria-label={t('Tên Tí')} placeholder={t('Nhập tên Tí')} value={name} maxLength={80} onChange={event => setName(event.target.value)} />
          <Button type="submit" disabled={!name.trim()}><UserRoundPlus size={16} />{t('Tạo Tí')}</Button>
        </form>
      </section>
      <Marketplace onAdded={onMarketAdded} />
      <section className="page-section" aria-labelledby="friends-other-title">
        <h2 id="friends-other-title">{t('Những nơi khác để tìm bạn')}</h2>
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
    </div></div> : <FriendsList orglets={orglets} working={working} tab={tab} query={query} onQuery={setQuery} onMessage={onMessage} onEdit={onEdit} onArchive={onArchive} onDelete={onDelete} onAdd={() => onTab('add')} />}
  </>;
}

function FriendsList({ orglets, working, tab, query, onQuery, onMessage, onEdit, onArchive, onDelete, onAdd }: {
  orglets: readonly Worker[]; working: ReadonlySet<string>; tab: Exclude<FriendsTab, 'add'>; query: string; onQuery: (query: string) => void;
  onMessage: (worker: Worker) => void; onEdit: (worker: Worker) => void; onArchive: (worker: Worker) => void; onDelete: (worker: Worker) => void; onAdd: () => void;
}) {
  const shown = friendsMatching(orglets, tab, query, working);
  return <div className="page-scroll"><div className="page-body">
    <label className="friends-search">
      <Search size={16} aria-hidden="true" />
      <Input aria-label={t('Tìm bạn')} placeholder={t('Tìm bạn')} value={query} onChange={event => onQuery(event.target.value)} />
    </label>
    <h2 className="friends-count">{tab === 'working' ? t('Đang làm — {0}', [shown.length]) : t('Tất cả Tí — {0}', [shown.length])}</h2>
    {shown.length === 0
      ? <p className="muted friends-empty">{query.trim() ? t('Không có Tí nào khớp.') : tab === 'working' ? t('Chưa có Tí nào đang làm việc.') : t('Chưa có Tí nào.')}{!query.trim() && tab === 'all' && <Button variant="outline" onClick={onAdd}><UserRoundPlus size={16} />{t('Thêm bạn')}</Button>}</p>
      : <ul className="friends-list">
        {shown.map(worker => <li key={worker.id} className="friend-row">
          <Avatar name={worker.name} seed={worker.id} emoji={worker.avatar?.emoji} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="md" />
          <span className="friend-text">
            <span className="friend-name">{worker.name}</span>
            <span className="friend-status">{working.has(worker.id) ? t('Đang làm việc') : worker.description || t('Sẵn sàng')}</span>
          </span>
          <span className="friend-actions">
            <Button size="icon" aria-label={t('Nhắn tin cho {0}', [worker.name])} title={t('Nhắn tin')} onClick={() => onMessage(worker)}><MessageCircle size={16} /></Button>
            <RowMenu label={t('Tùy chọn {0}', [worker.name])} items={[
              { label: t('Chỉnh sửa'), icon: Pencil, onSelect: () => onEdit(worker) },
              { label: t('Lưu trữ'), icon: Archive, onSelect: () => onArchive(worker) },
              { label: t('Xóa'), icon: Trash, danger: true, onSelect: () => onDelete(worker), confirm: { question: t('Xóa {0}? Cuộc trò chuyện cũ vẫn giữ lịch sử.', [worker.name]), label: t('Xóa') } },
            ]} />
          </span>
        </li>)}
      </ul>}
  </div></div>;
}
