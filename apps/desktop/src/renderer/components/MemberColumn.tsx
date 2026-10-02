import { X } from 'lucide-react';
import type { Worker } from '../../shared/contracts';
import { t } from '../i18n';
import { Avatar } from './Avatar';
import { Button } from './ui';

/**
 * The members of the channel on screen (COD-366), the column Discord keeps at the right of a server channel: every
 * orglet that answers there with its face, whether it is at work, and the lead marked when the lead splits the work.
 * A row opens that orglet's DM. It takes the right panel's place while Details is closed, so the two never sit side by
 * side.
 */
export function MemberColumn({ members, working, leadId, onOpen, onClose }: {
  members: readonly Worker[];
  working: ReadonlySet<string>;
  leadId?: string;
  onOpen: (worker: Worker) => void;
  onClose: () => void;
}) {
  return <aside className="members-pane" aria-label={t('Thành viên')}>
    <div className="members-head">
      <h2>{t('Thành viên — {0}', [members.length])}</h2>
      <Button size="icon" aria-label={t('Ẩn danh sách thành viên')} title={t('Ẩn danh sách thành viên')} onClick={onClose}><X size={16} /></Button>
    </div>
    <ul className="members-list">
      {members.map(worker => <li key={worker.id}>
        <button type="button" className="member-row" onClick={() => onOpen(worker)} aria-label={t('Nhắn tin cho {0}', [worker.name])}>
          <Avatar name={worker.name} seed={worker.id} emoji={worker.avatar?.emoji} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="sm" />
          <span className="member-text">
            <span className="member-name">{worker.name}{worker.id === leadId && <span className="member-lead">{t('Trưởng')}</span>}</span>
            <span className="member-status">{working.has(worker.id) ? t('Đang làm việc') : worker.description || t('Sẵn sàng')}</span>
          </span>
        </button>
      </li>)}
    </ul>
  </aside>;
}
