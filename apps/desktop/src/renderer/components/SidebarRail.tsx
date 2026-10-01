import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { MessagesSquare } from 'lucide-react';
import { PanelLeft, Plus, Search, X } from './icons';
import { t } from '../i18n';
import { Button } from './ui';
import { RowMenu, type RowMenuItem } from './RowMenu';
import { AnchoredPopover } from './AnchoredPopover';
import { StatusMark, type StatusMarkState } from './StatusMark';
import { statusMarkLabel } from './SidebarTree';
import { dwellHandlers } from '../prefetch';
import { middleClickCloses } from './OpenChats';

/** A crew or an orglet on the rail: its face opens its main chat. */
export type RailEntry = {
  key: string;
  name: string;
  face: ReactNode;
  status: StatusMarkState;
  active: boolean;
  onOpen: () => void;
  onDwell?: (resting: boolean) => void;
  /** Only for an open chat (COD-355): what kind of chat it is and whose, and a × that takes it off the list. */
  description?: string;
  onClose?: () => void;
};

/**
 * A button at the rail's foot: an icon, what it opens (`label`, the tooltip; `ariaLabel`, the name with its count), and
 * a count of what waits there. An `accent` count waits for the person, a `quiet` one is only news.
 */
export type RailAction = { key: string; icon: ReactNode; label: string; ariaLabel?: string; count?: number; countTone?: 'accent' | 'quiet'; onClick: () => void; onDwell?: (resting: boolean) => void };

/**
 * The left column folded to a narrow rail (COD-340): the roster as faces. Top: the way to the full sidebar, search and
 * the create menu. Then one face per crew and per orglet, in the sidebar's order, each with the sidebar row's mark
 * when it has news; the group chats behind one button that opens their list; then the chats on the Open list
 * (COD-355), each with a × that shows on hover. The foot keeps the sidebar's footer as icons with their counts. Names
 * live in tooltips and accessible names, since there is no room for them.
 */
export function SidebarRail({ onExpand, onSearch, createItems, crews, orglets, groupChats, groupChatsMark, openChats, actions, trailing, covered = false }: {
  onExpand: () => void;
  onSearch: () => void;
  createItems: RowMenuItem[];
  crews: readonly RailEntry[];
  orglets: readonly RailEntry[];
  groupChats: readonly RailEntry[];
  /** The strongest mark among the group chats, for their one button. */
  groupChatsMark: StatusMarkState;
  /** The Open list: side threads, group chats and schedule runs kept at hand. */
  openChats: readonly RailEntry[];
  actions: readonly RailAction[];
  /** Anything after the foot's buttons, such as a ready update. */
  trailing?: ReactNode;
  /** The full sidebar lies over the rail (a narrow window), so the rail is out of reach until it closes. */
  covered?: boolean;
}) {
  const roster = useRef<HTMLDivElement>(null);
  const scrollEnds = useScrollEnds(roster, `${crews.length}:${orglets.length}:${groupChats.length}:${openChats.length}`);
  return <nav className="rail" aria-label={t('Điều hướng')} inert={covered || undefined} aria-hidden={covered || undefined}>
    <div className="rail-top">
      <Button size="icon" aria-label={t('Mở sidebar')} title={t('Mở sidebar')} onClick={onExpand}><PanelLeft size={18} /></Button>
      <Button size="icon" aria-label={t('Tìm cuộc trò chuyện (Ctrl K)')} aria-keyshortcuts="Control+K" aria-haspopup="dialog" title={t('Tìm cuộc trò chuyện (Ctrl K)')} onClick={onSearch}><Search size={18} /></Button>
      <RowMenu label={t('Tạo mới')} icon={Plus} className="rail-create" align="start" items={createItems} />
    </div>
    <div ref={roster} className="rail-roster" {...scrollEnds}>
      {crews.length > 0 && <ul className="rail-group" aria-label={t('Hội')}>{crews.map(entry => <RailFace key={entry.key} entry={entry} />)}</ul>}
      {orglets.length > 0 && <ul className="rail-group" aria-label={t('Tí')}>{orglets.map(entry => <RailFace key={entry.key} entry={entry} />)}</ul>}
      {groupChats.length > 0 && <RailGroupChats chats={groupChats} mark={groupChatsMark} />}
      {openChats.length > 0 && <ul className="rail-group rail-open" aria-label={t('Đang mở')}>{openChats.map(entry => <RailFace key={entry.key} entry={entry} />)}</ul>}
    </div>
    <div className="rail-foot">
      {actions.map(action => <RailFootButton key={action.key} action={action} />)}
      {trailing}
    </div>
  </nav>;
}

function RailFace({ entry }: { entry: RailEntry }) {
  const hasNews = entry.status.variant !== 'empty';
  const stateLabel = statusMarkLabel(entry.status);
  const dwell = dwellHandlers(entry.onDwell);
  const tooltip = [entry.name, entry.description, hasNews ? stateLabel : ''].filter(Boolean).join('\n');
  const spoken = [entry.description, hasNews ? stateLabel : ''].filter(Boolean).join(', ');
  const closing = entry.onClose ? middleClickCloses(entry.onClose) : {};
  return <li className={entry.onClose ? 'rail-closable' : undefined} {...closing}>
    <button type="button" className={`rail-face${entry.active ? ' active' : ''}`} aria-label={entry.name} aria-current={entry.active || undefined}
      aria-description={spoken || undefined} title={tooltip} onClick={entry.onOpen} {...dwell}>
      <span className="rail-face-picture" aria-hidden="true">{entry.face}</span>
      {hasNews && <StatusMark variant={entry.status.variant} tone={entry.status.tone} label={stateLabel} decorative className="rail-face-mark" />}
    </button>
    {entry.onClose && <button type="button" className="rail-face-close" aria-label={t('Đóng {0}', [entry.name])} title={t('Đóng (Ctrl W)')} onClick={entry.onClose}><X size={12} aria-hidden="true" /></button>}
  </li>;
}

/** The group chats, behind one button with the strongest mark among them, listed in a small popover beside it. */
function RailGroupChats({ chats, mark }: { chats: readonly RailEntry[]; mark: StatusMarkState }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const active = chats.some(chat => chat.active);
  const label = t('Nhóm chat');
  const choose = (chat: RailEntry) => {
    setOpen(false);
    chat.onOpen();
  };
  return <div className="rail-group">
    <button ref={anchor} type="button" className={`rail-face rail-groups${active ? ' active' : ''}`} aria-label={label} title={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(current => !current)}>
      <MessagesSquare size={18} aria-hidden="true" />
      {mark.variant !== 'empty' && <StatusMark variant={mark.variant} tone={mark.tone} label={statusMarkLabel(mark)} decorative className="rail-face-mark" />}
    </button>
    <AnchoredPopover anchor={anchor} open={open} onClose={() => setOpen(false)} label={label}>
      <ul className="rail-group-list">
        {chats.map(chat => <li key={chat.key}>
          <button type="button" className={`rail-group-chat${chat.active ? ' active' : ''}`} aria-current={chat.active || undefined} title={chat.name} onClick={() => choose(chat)} {...dwellHandlers(chat.onDwell)}>
            <span className="rail-group-faces" aria-hidden="true">{chat.face}</span>
            <span className="rail-group-name">{chat.name}</span>
            {chat.status.variant !== 'empty' && <StatusMark variant={chat.status.variant} tone={chat.status.tone} label={statusMarkLabel(chat.status)} decorative />}
          </button>
        </li>)}
      </ul>
    </AnchoredPopover>
  </div>;
}

/**
 * Whether faces are scrolled past the roster's top or bottom, as the data attributes its CSS reads to fade that end:
 * the vertical twin of the file strip's overflow, so a face cut at the edge reads as more to scroll to.
 */
function useScrollEnds(list: RefObject<HTMLDivElement | null>, contentKey: string) {
  const [ends, setEnds] = useState({ start: false, end: false });
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () => {
      const start = element.scrollTop > 1;
      const end = element.scrollTop + element.clientHeight < element.scrollHeight - 1;
      setEnds(current => current.start === start && current.end === end ? current : { start, end });
    };
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [list, contentKey]);
  return { 'data-more-start': ends.start ? '' : undefined, 'data-more-end': ends.end ? '' : undefined };
}

function RailFootButton({ action }: { action: RailAction }) {
  const count = action.count ?? 0;
  const dwell = dwellHandlers(action.onDwell);
  const tone = action.countTone ?? 'accent';
  return <Button size="icon" className="rail-foot-button" aria-label={action.ariaLabel ?? action.label} title={action.label} onClick={action.onClick} {...dwell}>
    <span className="notice-bell">{action.icon}{count > 0 && <span className={`rail-count ${tone}`} aria-hidden="true">{count > 99 ? '99+' : count}</span>}</span>
  </Button>;
}
