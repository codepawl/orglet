import { useEffect, useRef, useState } from 'react';
import { Square } from 'lucide-react';
import { accentInk, accentText, DEFAULT_ACCENT_COLOR } from '../../shared/accent';
import type { OverlayBridge, OverlayView } from '../../shared/desktop-overlay';
import { Avatar, workerInk } from './Avatar';
import { OrgletCursor } from './OrgletCursor';
import { Button } from './ui';
import { setLanguage, t, useLanguage } from '../i18n';

/*
 * The desktop glow's page (COD-261), shown by main in its own click-through window over the window an orglet acts on,
 * or over the whole display while it borrows the real mouse: a soft band in the accent colour along the inner edges,
 * the orglet's face peeking over the top edge, a pill saying who is using what with Stop, and the orglet's cursor.
 * Only the pill takes the pointer; the window never takes the focus, so Stop does not move it from the person's app.
 */

declare global {
  interface Window { orgletOverlay?: OverlayBridge }
}

/** Keeps main told whether the pointer is over the pill, from the mouse moves it forwards while ignoring clicks. */
function usePillPointer(bridge: OverlayBridge | undefined, pill: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!bridge) return;
    let inside = false;
    const move = (event: MouseEvent) => {
      const box = pill.current?.getBoundingClientRect();
      const over = box !== undefined && event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      if (over === inside) return;
      inside = over;
      bridge.pointer(over);
    };
    const leave = () => {
      if (!inside) return;
      inside = false;
      bridge.pointer(false);
    };
    window.addEventListener('mousemove', move);
    document.addEventListener('mouseleave', leave);
    return () => {
      window.removeEventListener('mousemove', move);
      document.removeEventListener('mouseleave', leave);
    };
  }, [bridge, pill]);
}

export function DesktopOverlay() {
  const bridge = window.orgletOverlay;
  useLanguage();
  const [view, setView] = useState<OverlayView>({ visible: false });
  const [realCursor, setRealCursor] = useState<{ x: number; y: number }>();
  const [stopping, setStopping] = useState(false);
  const pill = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!bridge) return;
    const stopListening = bridge.onView(next => {
      setView(next);
      if (next.visible) setLanguage(next.language);
      else {
        setStopping(false);
        setRealCursor(undefined);
      }
    });
    // Main waits for this before it sends the first view, which would otherwise arrive before anyone listens.
    bridge.ready();
    return stopListening;
  }, [bridge]);
  useEffect(() => bridge?.onRealCursor(point => setRealCursor(point)), [bridge]);
  // The theme and the accent ride on the root, as in the app's window, so the kit's button takes them too.
  useEffect(() => {
    if (!view.visible) return;
    const root = document.documentElement;
    const accent = view.accent ?? DEFAULT_ACCENT_COLOR;
    root.dataset.theme = view.theme;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-ink', accentInk(accent));
    root.style.setProperty('--accent-text-light', accentText(accent, 'light'));
    root.style.setProperty('--accent-text-dark', accentText(accent, 'dark'));
  }, [view]);
  usePillPointer(bridge, pill);
  if (!view.visible) return null;
  const color = workerInk(view.worker);
  const borrowing = view.mode === 'borrow';
  const label = borrowing ? t('{0} đang dùng chuột của bạn · nhấn Esc để dừng', [view.worker.name]) : t('{0} đang dùng {1}', [view.worker.name, view.app]);
  const cursor = borrowing ? realCursor && { ...realCursor, action: 'move' as const, sequence: 0 } : view.cursor;
  return <div className="desktop-overlay" data-mode={view.mode}>
    <div className="desktop-overlay-glow orglet-glow" />
    <div className="desktop-overlay-peek" style={{ top: view.peekTop }}>
      {/* The pill is the anchor: the orglet's own face at its start, then who is using what, then Stop. */}
      <div ref={pill} className="desktop-overlay-pill" role="status">
        <span className="desktop-overlay-face" data-state="working">
          <Avatar name={view.worker.name} seed={view.worker.id} mascot={view.worker.avatar?.mascot} defaultMascot hint={view.worker.description} color={view.worker.avatar?.color} size="md" />
        </span>
        <span className="desktop-overlay-label">{label}</span>
        <Button variant="primary" className="desktop-overlay-stop" disabled={stopping} onClick={() => {
          setStopping(true);
          void bridge?.stop().catch(() => setStopping(false));
        }}><Square size={11} fill="currentColor" aria-hidden="true" />{t('Dừng')}</Button>
      </div>
    </div>
    {cursor && <OrgletCursor x={cursor.x} y={cursor.y} color={color} action={cursor.action === 'type' ? 'type' : 'move'}
      presses={cursor.action === 'press' ? cursor.sequence : 0} glide={!borrowing} />}
  </div>;
}
