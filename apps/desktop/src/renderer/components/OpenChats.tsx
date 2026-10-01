import type { MouseEvent, ReactNode } from 'react';
import { CalendarClock } from 'lucide-react';
import { X } from './icons';
import { t } from '../i18n';
import { Button } from './ui';
import { StatusMark, openChatMark } from './StatusMark';
import { statusMarkLabel, useScrolledIntoViewWhenActive } from './SidebarTree';
import { dwellHandlers } from '../prefetch';
import type { OpenChatState } from '../openChats';

/** What kind of chat sits on the Open list: one with no row of its own, such as an earlier chat or an older schedule run. */
export type OpenChatKind = 'side' | 'group' | 'schedule' | 'earlier';

/** One chat on the Open list (COD-355): who it is with, its name, its one state, and how to open and close it. */
export type OpenChatItem = {
  key: string;
  kind: OpenChatKind;
  name: string;
  /** What kind of chat it is and whose, such as "Side thread of Researcher": spoken after the name and in the tooltip. */
  description: string;
  face: ReactNode;
  state: OpenChatState;
  active: boolean;
  onOpen: () => void;
  onDwell?: (resting: boolean) => void;
};

const MIDDLE_BUTTON = 1;

/** A middle click closes, like a browser tab; the handlers stop the middle button's autoscroll first. */
export function middleClickCloses(onClose: () => void) {
  return {
    onMouseDown: (event: MouseEvent) => {
      if (event.button === MIDDLE_BUTTON) event.preventDefault();
    },
    onAuxClick: (event: MouseEvent) => {
      if (event.button !== MIDDLE_BUTTON) return;
      event.preventDefault();
      onClose();
    },
  };
}

/**
 * A row of the sidebar's Open section, shaped like a group chat's row so the column reads as one list: the state mark,
 * the face, the name. A schedule's run carries the calendar before its name. The × floats over the row's end on hover
 * or keyboard focus, where a roster row keeps its menu; closing only takes the chat off the list.
 */
export function OpenChatRow({ item, onClose }: { item: OpenChatItem; onClose: () => void }) {
  const mark = openChatMark(item.state);
  const stateLabel = statusMarkLabel(mark);
  const row = useScrolledIntoViewWhenActive<HTMLDivElement>(item.active);
  return <div ref={row} className="tree-item open-chat-row" data-chat-key={item.key} {...dwellHandlers(item.onDwell)} {...middleClickCloses(onClose)}>
    <div className="worker-row">
      <StatusMark variant={mark.variant} tone={mark.tone} label={stateLabel} />
      <span className="row-disclosure" aria-hidden="true">{item.face}</span>
      <button type="button" className={item.active ? 'worker active' : 'worker'} aria-current={item.active || undefined}
        aria-description={item.description} title={`${item.name}\n${item.description}\n${stateLabel}`} onClick={item.onOpen}>
        {item.kind === 'schedule' && <CalendarClock size={14} className="open-chat-kind" aria-hidden="true" />}
        <span>{item.name}</span>
      </button>
      <span className="open-chat-close">
        <Button size="icon" className="row-action" aria-label={t('Đóng {0}', [item.name])} title={t('Đóng (Ctrl W)')} onClick={onClose}><X size={14} /></Button>
      </span>
    </div>
  </div>;
}
