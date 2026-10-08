import type { ReactNode } from 'react';
import { Hash } from 'lucide-react';
import { ArchiveRestore, EllipsisVertical, Trash } from './icons';
import { Button } from './ui';
import { t, translated } from '../i18n';
import type { ArchiveGroupId } from '../archive';
import { RowMenu } from './RowMenu';

/** How long an archived item has before it deletes itself; `null` when auto-delete is off. */
export type ArchiveState = { daysLeft: number | null; tone: 'fresh' | 'aging' | 'expiring' };

/** One archived thing, drawn and worded by the caller; the row only lays it out and asks before deleting. */
export type ArchiveRowData = {
  key: string;
  name: string;
  /** The face, avatar or `#` of what it is or whose it was. */
  mark: ReactNode;
  /** A chat says whose it was ("Chat với Researcher"); an orglet or channel needs no second line. */
  whose?: string;
  archive: ArchiveState;
  /** That kind's own question; the default promises old chats keep their history, which only fits an orglet or channel. */
  deleteQuestion?: string;
  /** Set when deleting would be refused: the question says why, and the confirmation's button takes the way out instead. */
  deleteBlock?: { question: string; actionLabel: string; onAction: () => void };
  onRestore: () => void;
  onDelete: () => void;
};

export type ArchiveSection = { id: ArchiveGroupId; rows: ArchiveRowData[] };

const groupTitles: Record<ArchiveGroupId, string> = translated({ orglets: 'Tí', channels: 'Kênh', chats: 'Cuộc trò chuyện' });

/**
 * An archived orglet, channel or chat in Settings → Lưu trữ (COD-375, owner: what people rarely look at is hidden):
 * its mark, name and days left, **Khôi phục** as a button and **Xóa vĩnh viễn** in the row menu, which asks first.
 * Settings has the room the sidebar did not, so the pill and both actions stay in view instead of giving way on hover.
 */
export function ArchivedRow({ name, mark, whose, archive, deleteQuestion, deleteBlock, onRestore, onDelete }: Omit<ArchiveRowData, 'key'>) {
  const deletesIn = archive.daysLeft === null ? undefined : archive.daysLeft === 1 ? t('Tự xóa sau 1 ngày') : t('Tự xóa sau {0} ngày', [archive.daysLeft]);
  return <li className="archive-row" title={[name, whose, deletesIn].filter(Boolean).join('\n')}>
    <span className="archive-mark">{mark}</span>
    <span className="setting-text">
      <span className="archive-name">{name}</span>
      {whose && <span className="setting-description archive-whose">{whose}</span>}
    </span>
    {deletesIn && <span className={`archive-age ${archive.tone}`}>{t('{0} ngày', [archive.daysLeft])}</span>}
    <Button variant="outline" onClick={onRestore} aria-label={t('Khôi phục {0}', [name])}><ArchiveRestore size={14} />{t('Khôi phục')}</Button>
    <RowMenu label={t('Tùy chọn {0}', [name])} icon={EllipsisVertical}
      items={[{ label: t('Xóa vĩnh viễn'), icon: Trash, danger: true, onSelect: deleteBlock ? deleteBlock.onAction : onDelete,
        confirm: deleteBlock
          ? { question: deleteBlock.question, label: deleteBlock.actionLabel, icon: Hash, safe: true }
          : { question: deleteQuestion ?? t('Xóa {0}? Cuộc trò chuyện cũ vẫn giữ lịch sử.', [name]), label: t('Xóa') } }]} />
  </li>;
}

/**
 * Everything archived, in groups apart by spacing alone. A group with nothing in it is left out, and an empty
 * archive says so in one plain line.
 */
export function ArchiveGroups({ sections }: { sections: ArchiveSection[] }) {
  if (!sections.length) return <p className="archive-empty">{t('Chưa có gì được lưu trữ.')}</p>;
  return <>{sections.map(section => {
    const titleId = `archive-group-${section.id}`;
    return <section key={section.id} className="archive-group" aria-labelledby={titleId}>
      <h3 id={titleId} className="settings-subheading">{groupTitles[section.id]}<span className="archive-count">{section.rows.length}</span></h3>
      <ul className="archive-list">{section.rows.map(({ key, ...row }) => <ArchivedRow key={key} {...row} />)}</ul>
    </section>;
  })}</>;
}
