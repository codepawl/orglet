import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { t, currentLocale } from '../i18n';
import type { ChatViewEntry, ChatViewName } from '../chatViews';

/**
 * Where the view tabs sit (COD-355). `header`: on the chat's header row after its name, dropping to a row of their own
 * only when the header has no room. `row`: always on a slim row under the header, at the chat column's left edge.
 * The owner picked between the two from screenshots; the other stays one constant away.
 */
export const CHAT_VIEWS_PLACEMENT: 'header' | 'row' = 'header';

export function chatViewLabel(name: ChatViewName): string {
  if (name === 'files') return t('Tệp');
  if (name === 'changes') return t('Thay đổi');
  if (name === 'schedules') return t('Lịch chạy');
  if (name === 'memory') return t('Ghi nhớ');
  return t('Trò chuyện');
}

export function chatViewId(name: ChatViewName): string {
  return `chat-view-${name}`;
}

export const CHAT_VIEW_PANEL_ID = 'chat-view-panel';

/**
 * The views of the chat on screen (COD-355), the way a Slack channel has Messages and Files: Chat first, then each
 * view that has something in it, with its count. Quiet text buttons, the chosen one on the sidebar's active tint. A
 * tab list with one Tab stop; the arrow keys, Home and End move between views. Nothing is drawn while the chat is the
 * only view.
 */
export function ChatViewTabs({ views, current, onSelect }: { views: readonly ChatViewEntry[]; current: ChatViewName; onSelect: (name: ChatViewName) => void }) {
  const list = useRef<HTMLDivElement>(null);
  if (views.length < 2) return null;
  const move = (event: KeyboardEvent) => {
    const index = views.findIndex(view => view.name === current);
    const target = keyTarget(event.key, index, views.length);
    if (target === undefined) return;
    event.preventDefault();
    const name = views[target].name;
    onSelect(name);
    list.current?.querySelector<HTMLElement>(`#${chatViewId(name)}`)?.focus();
  };
  return <div ref={list} className="chat-views" role="tablist" aria-label={t('Các phần của chat')} onKeyDown={move}>
    {views.map(view => <ChatViewTab key={view.name} view={view} selected={view.name === current} onSelect={onSelect} />)}
  </div>;
}

function keyTarget(key: string, index: number, count: number): number | undefined {
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return undefined;
}

function ChatViewTab({ view, selected, onSelect }: { view: ChatViewEntry; selected: boolean; onSelect: (name: ChatViewName) => void }) {
  const label = chatViewLabel(view.name);
  const counted = view.count !== undefined;
  return <button type="button" role="tab" id={chatViewId(view.name)} className="chat-view-tab" aria-selected={selected} aria-controls={selected && view.name !== 'chat' ? CHAT_VIEW_PANEL_ID : undefined}
    tabIndex={selected ? 0 : -1} aria-label={counted ? `${label} (${view.count})` : label} onClick={() => onSelect(view.name)}>
    <span>{label}</span>
    {counted && <span className="chat-view-count" aria-hidden="true">{view.count!.toLocaleString(currentLocale())}</span>}
  </button>;
}

/**
 * Whether the view tabs fit on the header row beside the chat's name and its actions. They give way to a row of their
 * own as soon as the name would be cut short, and come back once the name, the tabs and the actions all fit again.
 * `contentKey` changes whenever what the header holds changes.
 */
export function useViewsFitHeader(header: RefObject<HTMLElement | null>, contentKey: string): boolean {
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const element = header.current;
    if (!element) return;
    const measure = () => setFits(current => headerFits(element, current));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [header, contentKey]);
  return fits;
}

const HEADER_GAP = 10;
/** The air between the name and the first tab, wider than the header's own gap so the two read as separate groups. */
const VIEWS_LEAD = 14;

function headerFits(header: HTMLElement, fitsNow: boolean): boolean {
  const lead = header.querySelector<HTMLElement>('.topbar-lead');
  const name = header.querySelector<HTMLElement>('.topbar-name');
  const views = header.querySelector<HTMLElement>('.chat-views');
  const actions = header.querySelector<HTMLElement>('.topbar-actions');
  if (!lead || !views) return true;
  if (fitsNow) return !name || name.scrollWidth <= name.clientWidth + 1;
  const style = getComputedStyle(header);
  const room = header.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const needed = lead.offsetWidth + VIEWS_LEAD + views.scrollWidth + HEADER_GAP + (actions?.offsetWidth ?? 0);
  return needed <= room;
}

/**
 * The chat's header: its name and model on the left, its actions on the right, and the view tabs where
 * `CHAT_VIEWS_PLACEMENT` puts them. On the header row they follow the name after a clear gap, on its baseline, and
 * move to a compact row under it only while the row has no room for all three.
 */
export function ChatHeader({ lead, views, actions, contentKey }: { lead: ReactNode; views: ReactNode; actions: ReactNode; contentKey: string }) {
  const header = useRef<HTMLElement>(null);
  const onHeader = CHAT_VIEWS_PLACEMENT === 'header' && Boolean(views);
  const fits = useViewsFitHeader(header, `${contentKey}:${onHeader}`);
  return <>
    <header ref={header} className={`topbar${onHeader && !fits ? ' views-below' : ''}`}>
      {/* The name, the model and the tabs share one baseline; the group as a whole is centred like the actions. */}
      <div className="topbar-main">
        <div className="topbar-lead">{lead}</div>
        {onHeader && fits && views}
      </div>
      <div className="topbar-actions">{actions}</div>
      {onHeader && !fits && views}
    </header>
    {!onHeader && views && <div className="chat-views-row">{views}</div>}
  </>;
}

/** A view other than the chat: the area under the header, scrolling on its own, at the chat's reading width. */
export function ChatViewPanel({ view, children }: { view: ChatViewName; children: ReactNode }) {
  return <div className="chat-view-panel" id={CHAT_VIEW_PANEL_ID} role="tabpanel" aria-labelledby={chatViewId(view)} tabIndex={-1}>
    <div className="chat-view-content">{children}</div>
  </div>;
}
