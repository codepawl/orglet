import { useRef, useState, type CSSProperties } from 'react';
import { MessageCircle, Pencil, UserRound, UserRoundMinus, UserRoundPlus } from 'lucide-react';
import type { Worker } from '../../shared/contracts';
import { t } from '../i18n';
import { arrivedWithChat } from '../chatSwitch';
import { AnchoredPopover } from './AnchoredPopover';
import { Avatar, workerInk } from './Avatar';
import { ProviderMark } from './ProviderMark';
import { RowMenu } from './RowMenu';
import { Button } from './ui';

/**
 * The members of the channel on screen (COD-366), the column Discord keeps at the right of a server channel: the
 * person first (user, 2026-10-04: they write there too), then every orglet that answers there with its face, whether
 * it is at work, and the lead marked when the lead splits the work. An orglet's row opens its profile card, and a
 * right-click on it opens its menu. The person's row opens nothing. It takes the right panel's place while Details is closed, so the two never sit side by
 * side. It has no close button: the toggle in the channel's header shows and hides it (user, 2026-10-04).
 */
export function MemberColumn({ you, onYou, members, others, working, leadId, onMessage, onEdit, removable, onRemove, onAdd }: {
  /** The person's name, as their face in the rail has it. */
  you: string;
  /** The person's own row was clicked. */
  onYou: () => void;
  members: readonly Worker[];
  /** In a space, the orglets the channel's place has that are not in the channel: listed dimmed, with a way in. */
  others: readonly Worker[];
  working: ReadonlySet<string>;
  leadId?: string;
  /** Opens that orglet's DM. */
  onMessage: (worker: Worker) => void;
  /** Opens that orglet's settings, where its role, model and memory are. */
  onEdit: (worker: Worker) => void;
  /** Whether this orglet can be taken out of the channel: not the lead, and not the last one in it. */
  removable: (worker: Worker) => boolean;
  /** Takes the orglet out of the channel. Its messages stay, and it stays an orglet. */
  onRemove: (worker: Worker) => void;
  /** Puts one of `others` into the channel. */
  onAdd: (worker: Worker) => void;
}) {
  const youWord = t('Bạn');
  // A column that came with the chat is in place at once; one the person asked for folds in.
  const [cameWithChat] = useState(() => arrivedWithChat());
  return <aside className={`members-pane${cameWithChat ? ' with-chat' : ''}`} aria-label={t('Thành viên')}>
    <div className="members-head">
      <h2>{t('Thành viên — {0}', [members.length + 1])}</h2>
    </div>
    <ul className="members-list">
      <li>
        {/* The person's own row opens their account, the way an orglet's row opens its profile (user, 2026-10-05). */}
        <button type="button" className="member-row member-you" aria-label={t('Tài khoản và cài đặt')} onClick={onYou}>
          <Avatar name={you} seed={you} size="sm" />
          <span className="member-text">
            <span className="member-name">{you}{you !== youWord && <span className="member-lead">{youWord}</span>}</span>
          </span>
        </button>
      </li>
      {members.map(worker => <li key={worker.id}>
        <MemberRow worker={worker} working={working.has(worker.id)} lead={worker.id === leadId} onMessage={() => onMessage(worker)} onEdit={() => onEdit(worker)}
          onRemove={removable(worker) ? () => onRemove(worker) : undefined} />
      </li>)}
    </ul>
    {others.length > 0 && <>
      <div className="members-head members-head-others">
        <h2>{t('Trong không gian — {0}', [others.length])}</h2>
      </div>
      <ul className="members-list members-others">
        {others.map(worker => <li key={worker.id}>
          <div className="member-item">
            <div className="member-row member-outside">
              <Avatar name={worker.name} seed={worker.id} emoji={worker.avatar?.emoji} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size="sm" />
              <span className="member-text"><span className="member-name">{worker.name}</span></span>
            </div>
            <RowMenu label={t('Tùy chọn {0}', [worker.name])} contextMenuOf=".member-item" items={[
              { label: t('Thêm vào kênh này'), icon: UserRoundPlus, onSelect: () => onAdd(worker) },
              { label: t('Nhắn tin'), icon: MessageCircle, onSelect: () => onMessage(worker) },
            ]} />
          </div>
        </li>)}
      </ul>
    </>}
  </aside>;
}

/**
 * One orglet in the column and the profile card its row opens (user, 2026-10-04, from Discord's member card): a strip
 * in the orglet's own colour, its face, its name, what it runs on, what it does, and the two things to do with it.
 */
function MemberRow({ worker, working, lead, onMessage, onEdit, onRemove }: { worker: Worker; working: boolean; lead: boolean; onMessage: () => void; onEdit: () => void; onRemove?: () => void }) {
  const row = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const face = (size: 'sm' | 'xl') => <Avatar name={worker.name} seed={worker.id} emoji={worker.avatar?.emoji} mascot={worker.avatar?.mascot} defaultMascot hint={worker.description} color={worker.avatar?.color} size={size} />;
  const leadTag = lead && <span className="member-lead">{t('Trưởng')}</span>;
  return <div className="member-item">
    <button ref={row} type="button" className="member-row" aria-haspopup="dialog" aria-expanded={open} aria-label={t('Hồ sơ của {0}', [worker.name])} onClick={() => setOpen(current => !current)}>
      {face('sm')}
      <span className="member-text">
        <span className="member-name">{worker.name}{leadTag}</span>
        <span className="member-status">{working ? t('Đang làm việc') : worker.description || t('Sẵn sàng')}</span>
      </span>
    </button>
    {/* A right-click anywhere on the row opens the same menu as the dots, the way a member's does in Discord. */}
    <RowMenu label={t('Tùy chọn {0}', [worker.name])} contextMenuOf=".member-item" items={[
      { label: t('Hồ sơ'), icon: UserRound, onSelect: () => setOpen(true) },
      { label: t('Nhắn tin'), icon: MessageCircle, onSelect: onMessage },
      { label: t('Chỉnh sửa'), icon: Pencil, onSelect: onEdit },
      ...(onRemove ? [{ label: t('Xóa khỏi kênh'), icon: UserRoundMinus, danger: true, onSelect: onRemove, confirm: { question: t('Xóa {0} khỏi kênh này?', [worker.name]), label: t('Xóa khỏi kênh') } }] : []),
    ]} />
    <AnchoredPopover anchor={row} open={open} onClose={close} label={t('Hồ sơ của {0}', [worker.name])} className="member-card">
      <div className="member-card-strip" style={{ '--member-ink': workerInk(worker) } as CSSProperties} />
      <div className="member-card-body">
        <span className="member-card-face">{face('xl')}</span>
        <h3 className="member-card-name">{worker.name}{leadTag}</h3>
        <p className="member-card-runs-on"><ProviderMark provider={worker.provider} size="small" decorative /><span>{worker.modelId ?? worker.provider}</span></p>
        {worker.description && <p className="member-card-about">{worker.description}</p>}
        <div className="member-card-actions">
          <Button variant="primary" onClick={() => { close(); onMessage(); }}><MessageCircle size={16} />{t('Nhắn tin')}</Button>
          <Button variant="outline" onClick={() => { close(); onEdit(); }}><Pencil size={16} />{t('Chỉnh sửa')}</Button>
        </div>
      </div>
    </AnchoredPopover>
  </div>;
}
