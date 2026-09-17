import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck } from 'lucide-react';
// Shown text is re-translated on render, so a toast raised just before a language switch follows the new language.
import { tMessage } from '../i18n';

type Toast = { id: number; text: string; tone: 'success' | 'error' };
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };

/** Short-lived confirmation or failure message shown above everything, instead of text left inside a panel. */
export function toast(text: string, tone: Toast['tone'] = 'success') {
  const id = nextId++;
  // A repeated message replaces its older copy; at most three are visible.
  toasts = [...toasts.filter(item => item.text !== text), { id, text, tone }].slice(-3);
  emit();
  setTimeout(() => { toasts = toasts.filter(item => item.id !== id); emit(); }, tone === 'error' ? 6000 : 3000);
}

/**
 * Portaled to <body> so an open modal dialog, which hides the rest of the app from assistive technology,
 * does not also hide these announcements.
 */
export function Toaster() {
  const items = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => toasts);
  return createPortal(<div className="toaster" aria-live="polite">
    {items.map(item => <div key={item.id} className={`toast ${item.tone}`} role={item.tone === 'error' ? 'alert' : 'status'}>
      {item.tone === 'error' ? <CircleAlert size={16} aria-hidden="true" /> : <CircleCheck size={16} aria-hidden="true" />}<span>{tMessage(item.text)}</span>
    </div>)}
  </div>, document.body);
}
