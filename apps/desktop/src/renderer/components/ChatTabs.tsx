import { useEffect, useRef, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { X } from './icons';
import { t } from '../i18n';
import { StatusMark, chatTabMark } from './StatusMark';
import { statusMarkLabel } from './SidebarTree';
import { overflowAttributes, useStripOverflow } from '../stripOverflow';
import type { ChatTabState } from '../chatTabs';

/** One open chat in the strip: who it is with, its name and its one state. */
export type ChatTabItem = { key: string; name: string; face: ReactNode; state: ChatTabState };

const MIDDLE_BUTTON = 1;

/**
 * The open chats across the top of the main area (COD-340): the working set, beside the roster on the left. Each tab
 * is a face, a name that truncates and one status mark; the mark gives way to a close button while the pointer is on
 * the tab or a keyboard focus is inside it, so nothing shifts. A middle click closes a tab too. The strip scrolls
 * sideways instead of wrapping, keeps the open tab in view, and fades an end that has tabs scrolled past it.
 */
export function ChatTabs({ tabs, activeKey, onSelect, onClose }: {
  tabs: readonly ChatTabItem[];
  activeKey?: string;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
}) {
  const strip = useRef<HTMLUListElement>(null);
  const more = useStripOverflow(strip, tabs.map(tab => tab.key).join());
  useActiveTabInView(strip, activeKey);
  useSidewaysWheel(strip);
  return <nav className="chat-tabs" aria-label={t('Chat đang mở')}>
    <ul ref={strip} className="chat-tabs-strip" {...overflowAttributes(more)}>
      {tabs.map(tab => <ChatTab key={tab.key} tab={tab} active={tab.key === activeKey} onSelect={onSelect} onClose={onClose} />)}
    </ul>
  </nav>;
}

function ChatTab({ tab, active, onSelect, onClose }: { tab: ChatTabItem; active: boolean; onSelect: (key: string) => void; onClose: (key: string) => void }) {
  const mark = chatTabMark(tab.state);
  const stateLabel = statusMarkLabel(mark);
  const hasNews = tab.state !== 'idle';
  // Stops the middle button's autoscroll before its click arrives as `auxclick`.
  const onMouseDown = (event: MouseEvent) => {
    if (event.button === MIDDLE_BUTTON) event.preventDefault();
  };
  const onAuxClick = (event: MouseEvent) => {
    if (event.button !== MIDDLE_BUTTON) return;
    event.preventDefault();
    onClose(tab.key);
  };
  return <li className={`chat-tab${active ? ' active' : ''}`} data-tab-key={tab.key} onMouseDown={onMouseDown} onAuxClick={onAuxClick}>
    <button type="button" className="chat-tab-open" aria-current={active ? 'page' : undefined}
      aria-description={hasNews ? stateLabel : undefined} title={hasNews ? `${tab.name}\n${stateLabel}` : tab.name} onClick={() => onSelect(tab.key)}>
      <span className="chat-tab-face" aria-hidden="true">{tab.face}</span>
      <span className="chat-tab-name">{tab.name}</span>
    </button>
    <span className="chat-tab-end">
      {/* Idle keeps the quiet dotted ring, as a sidebar row does, so every tab ends the same way and the gaps stay even. */}
      <StatusMark variant={mark.variant} tone={mark.tone} label={stateLabel} decorative className="chat-tab-mark" />
      <button type="button" className="chat-tab-close" aria-label={t('Đóng tab {0}', [tab.name])} title={t('Đóng tab (Ctrl W)')} onClick={() => onClose(tab.key)}>
        <X size={14} aria-hidden="true" />
      </button>
    </span>
  </li>;
}

/** Scrolls the strip, and only the strip, so the open tab is fully in view. */
function useActiveTabInView(strip: RefObject<HTMLUListElement | null>, activeKey: string | undefined) {
  useEffect(() => {
    const element = strip.current;
    if (!element || !activeKey) return;
    const tab = [...element.querySelectorAll<HTMLElement>('[data-tab-key]')].find(item => item.dataset.tabKey === activeKey);
    if (!tab) return;
    const start = tab.offsetLeft;
    const end = start + tab.offsetWidth;
    if (start < element.scrollLeft) element.scrollLeft = start;
    else if (end > element.scrollLeft + element.clientWidth) element.scrollLeft = end - element.clientWidth;
  }, [strip, activeKey]);
}

/**
 * A plain mouse wheel over the strip scrolls it sideways, since its scrollbar is hidden, but only while it has
 * somewhere to go. The listener cannot be passive: it stops the gesture it consumed from scrolling anything else.
 */
function useSidewaysWheel(strip: RefObject<HTMLUListElement | null>) {
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const furthest = element.scrollWidth - element.clientWidth;
      if (furthest < 1) return;
      const next = Math.min(Math.max(element.scrollLeft + event.deltaY, 0), furthest);
      if (next === element.scrollLeft) return;
      event.preventDefault();
      element.scrollLeft = next;
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [strip]);
}
