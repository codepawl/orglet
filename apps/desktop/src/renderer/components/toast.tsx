import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { Toaster as KitToaster, showToast, type ToastAction, type ToastTone } from '@codepawl/orglet-ui';
// Shown text is re-translated on render, so a toast raised just before a language switch follows the new language.
import { tMessage } from '../i18n';
import { recordNotice } from './notifications';

export type { ToastAction };
export type ToastOptions = {
  action?: ToastAction;
  /**
   * Counts in Notifications until the centre is opened. A problem or a note always does. A success does only when it
   * is news that arrived on its own (a side thread answering, an update, a change an orglet applied by itself): a
   * confirmation of what the person just did, such as "Đã lưu Tí", was read under the cursor (COD-255).
   */
  unread?: boolean;
  /** The chat the toast is about: its notice in Notifications opens that chat when clicked (COD-258). */
  chat?: string;
  /** Its notice takes the place of the group's unread one, standing for `size` pieces of news (COD-287). */
  group?: { key: string; size: number };
};

/**
 * Short-lived confirmation or failure message shown above everything, instead of text left inside a panel.
 * `about` is what the message concerns (the setting, the worker, the chat): the toast itself stays short, because
 * the control it answers is under the cursor, and the notice centre shows it later, when that context is gone.
 */
export function toast(text: string, tone: ToastTone = 'success', about?: string, options: ToastOptions = {}) {
  const confirmation = tone === 'success' && !options.unread;
  // Every toast is also kept, so a message missed while looking elsewhere can still be found (user, 2026-09-20).
  recordNotice(text, tone === 'error' ? 'error' : 'done', about, { confirmation, taskId: options.chat, group: options.group?.key, groupSize: options.group?.size });
  showToast(text, tone, options.action);
}

const toneIcons = {
  success: <CircleCheck size={16} aria-hidden="true" />,
  error: <CircleAlert size={16} aria-hidden="true" />,
  info: <Info size={16} aria-hidden="true" />,
};

/** The kit's toasts with the app's icons and translation (COD-274). */
export function Toaster() {
  return <KitToaster icons={toneIcons} renderText={tMessage} />;
}
