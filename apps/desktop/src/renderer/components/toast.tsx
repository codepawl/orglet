import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck, Info } from 'lucide-react';
// Shown text is re-translated on render, so a toast raised just before a language switch follows the new language.
import { tMessage } from '../i18n';
import { recordNotice } from './notifications';

/** `info` is a calm note that is neither a success nor a fault, such as a link naming an orglet that is not there. */
type Toast = { id: number; text: string; tone: 'success' | 'error' | 'info' };
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };

/**
 * Short-lived confirmation or failure message shown above everything, instead of text left inside a panel.
 * `about` is what the message concerns (the setting, the worker, the chat): the toast itself stays short, because
 * the control it answers is under the cursor, and the notice centre shows it later, when that context is gone.
 */
export function toast(text: string, tone: Toast['tone'] = 'success', about?: string) {
  const id = nextId++;
  // Every toast is also kept, so a message missed while looking elsewhere can still be found (user, 2026-09-20).
  recordNotice(text, tone === 'error' ? 'error' : 'done', about);
  // A repeated message replaces its older copy; at most three are visible.
  toasts = [...toasts.filter(item => item.text !== text), { id, text, tone }].slice(-3);
  emit();
  // Only a confirmation is short: a fault or a note takes longer to read.
  const visibleMilliseconds = tone === 'success' ? 3000 : 6000;
  setTimeout(() => { toasts = toasts.filter(item => item.id !== id); emit(); }, visibleMilliseconds);
}

function ToneIcon({ tone }: { tone: Toast['tone'] }) {
  if (tone === 'error') return <CircleAlert size={16} aria-hidden="true" />;
  if (tone === 'info') return <Info size={16} aria-hidden="true" />;
  return <CircleCheck size={16} aria-hidden="true" />;
}

/**
 * Portaled to <body> so an open modal dialog, which hides the rest of the app from assistive technology,
 * does not also hide these announcements.
 */
export function Toaster() {
  const items = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => toasts);
  return createPortal(<div className="toaster" aria-live="polite">
    {items.map(item => <div key={item.id} className={`toast ${item.tone}`} role={item.tone === 'error' ? 'alert' : 'status'}>
      <ToneIcon tone={item.tone} /><span>{tMessage(item.text)}</span>
    </div>)}
  </div>, document.body);
}
