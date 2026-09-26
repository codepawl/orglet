import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../cn';
import './Toaster.css';

/** A toast can offer one thing to do about it, such as opening what it announces. */
export type ToastAction = { label: string; onSelect: () => void };
/** `info` is a calm note that is neither a success nor a fault. */
export type ToastTone = 'success' | 'error' | 'info';

type Toast = { id: number; text: string; tone: ToastTone; action?: ToastAction };

const MOST_VISIBLE = 3;
const SHORT_MS = 3000;
const LONG_MS = 6000;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function dismiss(id: number) {
  toasts = toasts.filter(item => item.id !== id);
  emit();
}

/**
 * Shows a short message above everything, instead of text left inside a panel. A repeated message replaces its older
 * copy, and at most three are visible. A plain confirmation is short; a fault, a note, or one with something to do
 * stays long enough to read and reach. Render one `Toaster` in the application for them to show.
 */
export function showToast(text: string, tone: ToastTone = 'success', action?: ToastAction) {
  const id = nextId++;
  toasts = [...toasts.filter(item => item.text !== text), { id, text, tone, ...(action ? { action } : {}) }].slice(-MOST_VISIBLE);
  emit();
  const visibleFor = tone === 'success' && !action ? SHORT_MS : LONG_MS;
  setTimeout(() => dismiss(id), visibleFor);
}

/**
 * Where the toasts appear, portaled to the page so an open modal dialog, which hides the rest of the app from
 * assistive technology, does not also hide these announcements. `icons` are drawn per tone; `renderText` lets the
 * application translate a message at the moment it is shown.
 */
export function Toaster({ icons, renderText = text => text }: {
  icons: Record<ToastTone, ReactNode>;
  renderText?: (text: string) => ReactNode;
}) {
  const items = useSyncExternalStore(subscribe, () => toasts);
  return createPortal(<div className="org-toaster" aria-live="polite">
    {items.map(item => <div key={item.id} className={cn('org-toast', `org-toast-${item.tone}`, item.action && 'org-toast-has-action')}
      role={item.tone === 'error' ? 'alert' : 'status'}>
      {icons[item.tone]}
      <span>{renderText(item.text)}</span>
      {item.action && <button type="button" className="org-toast-action" onClick={() => { dismiss(item.id); item.action!.onSelect(); }}>{item.action.label}</button>}
    </div>)}
  </div>, document.body);
}
