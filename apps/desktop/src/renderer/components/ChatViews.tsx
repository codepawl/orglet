import type { ReactNode } from 'react';
import { t } from '../i18n';
import type { ChatViewName } from '../chatViews';

export function chatViewLabel(name: ChatViewName): string {
  if (name === 'files') return t('Tệp');
  if (name === 'changes') return t('Thay đổi');
  if (name === 'schedules') return t('Lịch chạy');
  if (name === 'memory') return t('Ghi nhớ');
  return t('Trò chuyện');
}

export const CHAT_VIEW_PANEL_ID = 'chat-view-panel';

/**
 * The chat's header: its name and model on the left, its actions on the right. The chat's other views (files,
 * changes, schedules, memory) open from its menu among the actions rather than as tabs here (user, 2026-10-07).
 */
export function ChatHeader({ lead, actions }: { lead: ReactNode; actions: ReactNode }) {
  return <header className="topbar">
    <div className="topbar-main">
      <div className="topbar-lead">{lead}</div>
    </div>
    <div className="topbar-actions">{actions}</div>
  </header>;
}

/** A view other than the chat: the area under the header, scrolling on its own, at the chat's reading width. */
export function ChatViewPanel({ view, children }: { view: ChatViewName; children: ReactNode }) {
  return <div className="chat-view-panel" id={CHAT_VIEW_PANEL_ID} role="region" aria-label={chatViewLabel(view)} tabIndex={-1}>
    <div className="chat-view-content">{children}</div>
  </div>;
}
