import {
  useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent, type CompositionEvent, type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject,
} from 'react';
import { AppWindow, ExternalLink, Hand, Info, Maximize2, MonitorSmartphone, Undo2, X } from 'lucide-react';
import { Skeleton, Viewer } from '@codepawl/orglet-ui';
import type { TaskDetail } from '../../shared/contracts';
import {
  BROWSER_WATCH_RENEW_MS, pageToView, viewToPage, type BrowserCursor, type BrowserInputEvent, type BrowserLiveEvent, type BrowserSuggestion, type BrowserWatchState,
} from '../../shared/browser-live';
import { Button } from './ui';
import { BrowserApprovalCard } from './BrowserApproval';
import { browsingSiteOf } from './LiveRun';
import { t, tMessage, translated } from '../i18n';
import { orglet } from '../api';
import { toast } from './toast';

/*
 * Watching an orglet's browser, and taking it over, inside Orglet (COD-261). A run's browser has no window; the host
 * streams the tab the run last used while a view is open, and says where the orglet just pointed, so the view draws
 * the orglet's cursor over the picture. The cursor is Orglet's own element, never something put into the page, so a
 * page can neither see it nor fake it. While the person holds the browser, their clicks, wheel and keys in the view go
 * to the tab; the orglet's next step waits. Frames live only on the canvas.
 */

// ---- Which chat's large view is open: the island and Details both open it, the chat thread shows it. ----

let viewerTask: string | undefined;
const viewerListeners = new Set<() => void>();

export function openBrowserViewer(taskId: string | undefined) {
  if (viewerTask === taskId) return;
  viewerTask = taskId;
  for (const listener of viewerListeners) listener();
}

function useBrowserViewer() {
  return useSyncExternalStore(listener => { viewerListeners.add(listener); return () => { viewerListeners.delete(listener); }; }, () => viewerTask, () => undefined);
}

// ---- Watching: one watch per run however many views show it, renewed while any is open. ----

type Watcher = { width: number; onEvent: (event: BrowserLiveEvent) => void };
const watchers = new Map<string, Set<Watcher>>();
const renewals = new Map<string, number>();
let stopListening: (() => void) | undefined;

function widestOf(runId: string) {
  return Math.max(...[...watchers.get(runId) ?? []].map(watcher => watcher.width));
}

function renew(runId: string): Promise<BrowserWatchState | null> {
  return orglet.watchBrowser(runId, true, widestOf(runId)).catch(() => null);
}

/** Starts watching a run for one view; the returned function stops, and the last view to stop ends the watch. */
function watchRun(runId: string, watcher: Watcher): { initial: Promise<BrowserWatchState | null>; stop: () => void } {
  if (!stopListening) {
    stopListening = orglet.onBrowserLive(event => {
      for (const listening of watchers.get(event.runId) ?? []) listening.onEvent(event);
    });
  }
  let set = watchers.get(runId);
  if (!set) {
    set = new Set();
    watchers.set(runId, set);
    renewals.set(runId, window.setInterval(() => void renew(runId), BROWSER_WATCH_RENEW_MS));
  }
  set.add(watcher);
  const initial = renew(runId);
  return {
    initial,
    stop: () => {
      set.delete(watcher);
      if (set.size > 0) return;
      watchers.delete(runId);
      window.clearInterval(renewals.get(runId));
      renewals.delete(runId);
      void orglet.watchBrowser(runId, false, 320).catch(() => undefined);
    },
  };
}

/** Frames are asked for at the view's device width, in steps, so a small resize does not restart the stream. */
function frameWidthFor(cssWidth: number) {
  const pixels = cssWidth * (window.devicePixelRatio || 1);
  return Math.min(Math.max(Math.ceil(pixels / 160) * 160, 320), 1920);
}

type PageSize = { width: number; height: number };

/**
 * The live picture of a run's browser, drawn on `canvas`, with where the orglet last pointed and what Orglet
 * suggests. Frames are decoded off the main thread and drawn in the order they came; an older one that decodes late
 * is dropped.
 */
function useLiveBrowser(runId: string | undefined, cssWidth: number, canvas: RefObject<HTMLCanvasElement | null>) {
  const [page, setPage] = useState<PageSize>();
  const [tabId, setTabId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<BrowserCursor | null>(null);
  const [cursorMoves, setCursorMoves] = useState(0);
  const [suggestion, setSuggestion] = useState<BrowserSuggestion | null>(null);
  const width = frameWidthFor(cssWidth);
  const watcherRef = useRef<Watcher>(null);
  useEffect(() => {
    if (!runId || cssWidth <= 0) return;
    let live = true;
    let drawn = 0;
    let received = 0;
    const watcher: Watcher = {
      width,
      onEvent: event => {
        if (event.kind === 'cursor') {
          setCursor(event.cursor);
          setCursorMoves(count => count + 1);
          return;
        }
        if (event.kind === 'suggest') {
          setSuggestion(event.suggestion);
          return;
        }
        received += 1;
        const number = received;
        void createImageBitmap(new Blob([event.bytes as BlobPart], { type: 'image/jpeg' })).then(bitmap => {
          const target = canvas.current;
          if (!live || number < drawn || !target) return bitmap.close();
          drawn = number;
          if (target.width !== bitmap.width) target.width = bitmap.width;
          if (target.height !== bitmap.height) target.height = bitmap.height;
          target.getContext('2d')?.drawImage(bitmap, 0, 0);
          bitmap.close();
          setPage(current => current?.width === event.width && current.height === event.height ? current : { width: event.width, height: event.height });
          setTabId(event.tabId);
        }, () => undefined);
      },
    };
    watcherRef.current = watcher;
    const watch = watchRun(runId, watcher);
    void watch.initial.then(state => {
      if (!live || !state) return;
      setCursor(state.cursor);
      setSuggestion(state.suggestion);
      if (state.tabId) setTabId(state.tabId);
    });
    return () => {
      live = false;
      watcherRef.current = null;
      watch.stop();
    };
  }, [runId, cssWidth > 0]);
  // A view that changes size keeps its watch and only asks for frames of the new width.
  useEffect(() => {
    const watcher = watcherRef.current;
    if (!runId || !watcher || watcher.width === width) return;
    watcher.width = width;
    void renew(runId);
  }, [runId, width]);
  return { page, tabId, cursor: cursor && cursor.tabId === tabId ? cursor : null, cursorMoves, suggestion, dismissSuggestion: () => setSuggestion(null) };
}

/** The width an element is drawn at, followed as it changes; `mounted` changes when the element comes and goes. */
function useWidth(element: RefObject<HTMLElement | null>, mounted: boolean) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const target = element.current;
    if (!target) return;
    setWidth(target.clientWidth);
    const observer = new ResizeObserver(() => setWidth(target.clientWidth));
    observer.observe(target);
    return () => observer.disconnect();
  }, [element, mounted]);
  return width;
}

// ---- The person's input, while they hold the browser. ----

/** Keys that do something besides typing a character; they go to the page as keys, never as text. */
const NAMED_KEYS = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
  'Shift', 'Control', 'Alt', 'Meta', 'Insert', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12']);
const MODIFIER_KEYS = ['Shift', 'Control', 'Alt', 'Meta'];
const BUTTONS: Record<number, 'left' | 'middle' | 'right'> = { 0: 'left', 1: 'middle', 2: 'right' };

function sendInput(runId: string, event: BrowserInputEvent) {
  void orglet.browserInput(runId, event).catch(() => undefined);
}

/**
 * Sends the person's pointer, wheel and keys from the view to the tab. Points are turned into the page's CSS pixels
 * from the size the view is drawn at and the page size the frames report. Characters come from a hidden text field,
 * so an input method (Vietnamese Telex included) composes as it does anywhere; named keys and shortcuts go as keys.
 * Pasting sends the pasted text. Keys held when the view loses focus are let go.
 */
function useControl(runId: string | undefined, enabled: boolean, page: PageSize | undefined, surface: RefObject<HTMLDivElement | null>, typing: RefObject<HTMLTextAreaElement | null>) {
  const held = useRef(new Set<string>());
  const pendingMove = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef(0);
  const pageRef = useRef(page);
  pageRef.current = page;
  const pointOf = (clientX: number, clientY: number) => {
    const box = surface.current!.getBoundingClientRect();
    return viewToPage({ x: clientX - box.left, y: clientY - box.top }, { width: box.width, height: box.height }, pageRef.current ?? { width: box.width, height: box.height });
  };
  // The wheel needs a listener that may cancel scrolling the dialog, which React's own is not.
  useEffect(() => {
    const target = surface.current;
    if (!target || !enabled || !runId) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = pointOf(event.clientX, event.clientY);
      const scale = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1;
      sendInput(runId, { type: 'wheel', ...point, deltaX: clampDelta(event.deltaX * scale), deltaY: clampDelta(event.deltaY * scale) });
    };
    target.addEventListener('wheel', onWheel, { passive: false });
    return () => target.removeEventListener('wheel', onWheel);
  }, [enabled, runId]);
  const releaseKeys = () => {
    if (!runId) return;
    for (const key of held.current) sendInput(runId, { type: 'key', action: 'up', key });
    held.current.clear();
  };
  useEffect(() => () => { cancelAnimationFrame(frame.current); releaseKeys(); }, [runId, enabled]);
  // Typed characters arrive as the text field's native 'beforeinput'; React's onBeforeInput is a different, older event.
  useEffect(() => {
    const field = typing.current;
    if (!field || !enabled || !runId) return;
    const onBeforeInput = (event: InputEvent) => {
      if (event.isComposing) return;
      const typed = event.inputType === 'insertText' || event.inputType === 'insertFromPaste' || event.inputType === 'insertReplacementText';
      if (!typed || !event.data) return;
      event.preventDefault();
      sendInput(runId, { type: 'text', text: event.data.slice(0, 500) });
    };
    field.addEventListener('beforeinput', onBeforeInput);
    return () => field.removeEventListener('beforeinput', onBeforeInput);
  }, [enabled, runId]);
  if (!enabled || !runId) return {};
  const pointer = (action: 'down' | 'up') => (event: ReactPointerEvent) => {
    const button = BUTTONS[event.button];
    if (!button) return;
    event.preventDefault();
    if (action === 'down') {
      typing.current?.focus({ preventScroll: true });
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }
    sendInput(runId, { type: 'mouse', action, ...pointOf(event.clientX, event.clientY), button, clickCount: Math.min(Math.max(event.detail, 1), 3) });
  };
  return {
    onPointerDown: pointer('down'),
    onPointerUp: pointer('up'),
    onPointerMove: (event: ReactPointerEvent) => {
      pendingMove.current = pointOf(event.clientX, event.clientY);
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const point = pendingMove.current;
        pendingMove.current = null;
        if (point) sendInput(runId, { type: 'mouse', action: 'move', ...point, button: 'left', clickCount: 1 });
      });
    },
    onContextMenu: (event: ReactMouseEvent) => event.preventDefault(),
    typing: {
      onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (event.nativeEvent.isComposing || event.key === 'Process' || event.key === 'Dead' || event.key === 'Unidentified') return;
        const shortcut = event.ctrlKey || event.metaKey || (event.altKey && !event.getModifierState('AltGraph'));
        const pasting = shortcut && event.key.toLowerCase() === 'v';
        if (pasting) return;
        if (!NAMED_KEYS.has(event.key) && !(shortcut && event.key.length === 1)) return;
        event.preventDefault();
        if (event.repeat && MODIFIER_KEYS.includes(event.key)) return;
        held.current.add(event.key);
        sendInput(runId, { type: 'key', action: 'down', key: event.key });
      },
      onKeyUp: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (!held.current.has(event.key)) return;
        event.preventDefault();
        held.current.delete(event.key);
        sendInput(runId, { type: 'key', action: 'up', key: event.key });
      },
      onCompositionEnd: (event: CompositionEvent<HTMLTextAreaElement>) => {
        if (event.data) sendInput(runId, { type: 'text', text: event.data.slice(0, 500) });
        event.currentTarget.value = '';
      },
      onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => {
        event.preventDefault();
        const text = event.clipboardData.getData('text/plain');
        for (let start = 0; start < text.length && start < 5_000; start += 500) sendInput(runId, { type: 'text', text: text.slice(start, start + 500) });
      },
      onBlur: releaseKeys,
    },
  };
}

function clampDelta(value: number) {
  return Math.max(-5_000, Math.min(5_000, Math.round(value)));
}

// ---- What the person sees. ----

/** Why Orglet suggests the Chrome window, in words for the person. */
const suggestionText: Record<BrowserSuggestion, string> = translated({
  passkey: 'Trang này muốn dùng passkey. Passkey chỉ dùng được trong cửa sổ Chrome.',
  fileChooser: 'Trang này muốn bạn chọn một tệp. Chọn tệp trong cửa sổ Chrome.',
  dialog: 'Trang vừa hỏi trong một hộp thoại và Orglet đã đóng nó. Mở trong Chrome để tự trả lời.',
  sensitiveField: 'Đây là ô mật khẩu hoặc thẻ. Gõ trong cửa sổ Chrome để trình duyệt tự điền.',
  httpAuth: 'Trang này cần đăng nhập bằng hộp thoại của trình duyệt. Mở trong Chrome để đăng nhập.',
});

/**
 * The run's browser as a picture, with the orglet's cursor, or the person's own input while they hold it. The
 * `controlling` view takes focus when clicked and keeps it until the person clicks elsewhere; its keys, Escape
 * included, go to the page.
 */
export function BrowserLiveSurface({ runId, workerName, site, controlling, inChrome, onOpenInChrome, onBackToOrglet, large }: {
  runId: string; workerName: string; site?: string; controlling: boolean; inChrome: boolean; onOpenInChrome: () => void; onBackToOrglet: () => void; large?: boolean;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const typing = useRef<HTMLTextAreaElement>(null);
  const cssWidth = useWidth(surface, !inChrome);
  const live = useLiveBrowser(inChrome ? undefined : runId, cssWidth, canvas);
  const control = useControl(runId, controlling && !inChrome, live.page, surface, typing);
  const { typing: typingHandlers, ...pointerHandlers } = control;
  const page = live.page ?? { width: 1280, height: 800 };
  const ratio = `${page.width} / ${page.height}`;
  const cursorAt = live.cursor && live.page && cssWidth > 0
    ? pageToView(live.cursor, { width: cssWidth, height: cssWidth * live.page.height / live.page.width }, live.page)
    : undefined;
  const label = controlling
    ? t('Trang {0}. Bạn đang điều khiển: bấm và gõ ở đây.', [site ?? ''])
    : t('Trang {0}, {1} đang dùng.', [site ?? '', workerName]);
  if (inChrome) {
    return <div className="browser-live browser-live-away" data-large={large ? '' : undefined} style={{ aspectRatio: ratio, '--browser-live-ratio': page.width / page.height } as CSSProperties}>
      <p><MonitorSmartphone size={18} aria-hidden="true" />{t('Trang đang mở trong cửa sổ Chrome.')}</p>
      <div className="browser-live-away-actions">
        <Button variant="outline" onClick={onOpenInChrome}><ExternalLink size={15} />{t('Hiện cửa sổ Chrome')}</Button>
        <Button variant="ghost" onClick={onBackToOrglet}><AppWindow size={15} />{t('Xem trong Orglet')}</Button>
      </div>
    </div>;
  }
  return <div className="browser-live-stack" data-large={large ? '' : undefined} style={{ '--browser-live-ratio': page.width / page.height } as CSSProperties}>
    <div ref={surface} className={controlling ? 'browser-live browser-live-controlling' : 'browser-live'}
      style={{ aspectRatio: ratio }} role={controlling ? 'application' : 'img'} aria-label={label} aria-roledescription={controlling ? t('trang điều khiển được') : undefined} {...pointerHandlers}>
      <canvas ref={canvas} className="browser-live-canvas" aria-hidden="true" />
      {!live.page && <Skeleton shape="block" className="browser-live-waiting" />}
      {cursorAt && !controlling && <AgentCursor key={live.cursor!.tabId} x={cursorAt.x} y={cursorAt.y} name={workerName} clicks={live.cursor!.action === 'click' ? live.cursorMoves : 0} />}
      {controlling && <textarea ref={typing} className="browser-live-typing" aria-label={t('Gõ vào trang')} data-popup-open="" autoComplete="off" autoCorrect="off" spellCheck={false} {...typingHandlers} />}
    </div>
    {live.suggestion && <div className="browser-live-suggestion" role="status">
      <Info size={15} aria-hidden="true" />
      <span>{suggestionText[live.suggestion]}</span>
      <Button variant="outline" onClick={onOpenInChrome}><ExternalLink size={14} />{t('Mở trong Chrome')}</Button>
      <Button size="icon" variant="ghost" aria-label={t('Bỏ qua gợi ý')} title={t('Bỏ qua gợi ý')} onClick={live.dismissSuggestion}><X size={14} /></Button>
    </div>}
  </div>;
}

/**
 * The orglet's cursor: an arrow with its name, drawn by Orglet where the orglet last pointed and moved there on a
 * transition, so the person follows it from step to step. A click leaves a ring where it landed.
 */
function AgentCursor({ x, y, name, clicks }: { x: number; y: number; name: string; clicks: number }) {
  const style = { transform: `translate(${Math.round(x)}px, ${Math.round(y)}px)` } as CSSProperties;
  return <div className="browser-agent-cursor" style={style} aria-hidden="true">
    {clicks > 0 && <span key={clicks} className="browser-agent-click" />}
    <svg width="18" height="20" viewBox="0 0 18 20"><path d="M1.5 1.5 L1.5 16.2 L5.6 12.6 L8.4 18.6 L11 17.4 L8.3 11.6 L14 11.2 Z" /></svg>
    <span className="browser-agent-name">{name}</span>
  </div>;
}

/** Takes the chat's browser over, into the live view or a Chrome window, or hands it back. */
export function takeOverBrowser(taskId: string, taken: boolean, inChrome = false) {
  if (taken && !inChrome) openBrowserViewer(taskId);
  void orglet.call('browserTakeOver', { taskId, taken, inChrome }).then(opened => {
    if (inChrome && !opened) toast(t('Chưa mở được cửa sổ Chrome. Bạn vẫn điều khiển được trang ngay trong Orglet.'), 'info', t('Trình duyệt'));
  }).catch(error => toast(tMessage(String(error)), 'error', t('Trình duyệt')));
}

/** The run the chat's live view shows: its worker and the site its browser is on. */
function watchedRun(detail: TaskDetail) {
  const runId = detail.browser?.runId;
  const run = runId ? detail.runs.find(candidate => candidate.id === runId) : undefined;
  const site = runId ? browsingSiteOf(detail.events.filter(event => event.runId === runId).map(event => event.message)) : undefined;
  return run ? { runId: run.id, workerName: run.snapshot.worker.name, site } : undefined;
}

/** Take over or hand back, and Open in Chrome, for the chat's browser; shared by Details and the large view. */
function LiveActions({ detail }: { detail: TaskDetail }) {
  const live = detail.browser;
  const taskId = detail.task.id;
  if (!live) return null;
  // In a narrow window the large view's toolbar keeps the icons and drops the words, which stay as the names.
  const labelled = (label: string) => ({ 'aria-label': label, title: label });
  return <>
    {live.takenOver
      ? <Button variant="primary" {...labelled(t('Trả lại trình duyệt'))} onClick={() => takeOverBrowser(taskId, false)}><Undo2 size={15} /><span className="browser-live-action-label">{t('Trả lại trình duyệt')}</span></Button>
      : <Button variant="outline" {...labelled(t('Tiếp quản'))} onClick={() => takeOverBrowser(taskId, true)}><Hand size={15} /><span className="browser-live-action-label">{t('Tiếp quản')}</span></Button>}
    {!live.inChrome && <Button variant="outline" {...labelled(t('Mở trong Chrome'))} onClick={() => takeOverBrowser(taskId, true, true)}><ExternalLink size={15} /><span className="browser-live-action-label">{t('Mở trong Chrome')}</span></Button>}
  </>;
}

/** Whether Details shows the live view: a run is using the chat's browser, or the person holds it. */
function showsLivePanel(detail: TaskDetail) {
  const live = detail.browser;
  return watchedRun(detail) !== undefined && live !== undefined && (live.using || live.takenOver);
}

/** View larger, beside the Browser heading in Details while the live view shows there. */
export function BrowserLiveExpand({ detail }: { detail: TaskDetail }) {
  const viewerOpen = useBrowserViewer() === detail.task.id;
  if (!showsLivePanel(detail) || viewerOpen) return null;
  return <Button size="icon" variant="ghost" aria-label={t('Xem lớn')} title={t('Xem lớn')} onClick={() => openBrowserViewer(detail.task.id)}><Maximize2 size={15} /></Button>;
}

/** The live view as Details shows it: the picture, then the controls. Only while a run uses the browser. */
export function BrowserLivePanel({ detail }: { detail: TaskDetail }) {
  const watched = watchedRun(detail);
  const live = detail.browser;
  const viewerOpen = useBrowserViewer() === detail.task.id;
  if (!showsLivePanel(detail) || !watched || !live) return null;
  return <div className="browser-live-panel">
    {/* The large view shows the same picture; this one steps aside so one run streams once. */}
    {!viewerOpen && <BrowserLiveSurface runId={watched.runId} workerName={watched.workerName} site={watched.site} controlling={live.takenOver && !live.inChrome}
      inChrome={live.inChrome} onOpenInChrome={() => takeOverBrowser(detail.task.id, true, true)} onBackToOrglet={() => takeOverBrowser(detail.task.id, true)} />}
    <div className="actions browser-step-actions"><LiveActions detail={detail} /></div>
  </div>;
}

/** The large live view, opened from the island or Details, over the chat. It closes itself when the run is done. */
export function BrowserLiveViewer({ detail }: { detail: TaskDetail }) {
  const openFor = useBrowserViewer();
  const watched = watchedRun(detail);
  const live = detail.browser;
  const available = watched !== undefined && live !== undefined && (live.using || live.takenOver);
  const open = openFor === detail.task.id && available;
  useEffect(() => {
    if (openFor === detail.task.id && !available) openBrowserViewer(undefined);
  }, [openFor, detail.task.id, available]);
  useEffect(() => () => { if (viewerTask === detail.task.id) openBrowserViewer(undefined); }, [detail.task.id]);
  const [answering, setAnswering] = useState(false);
  if (!open || !watched) return null;
  const meta = live!.takenOver ? t('Bạn đang điều khiển') : watched.site ?? t('Đang xem');
  const approval = live!.approval;
  // The card that asks about a step shows here too, under the page with the orglet's cursor on the element.
  const answer = (choice: 'allow' | 'decline') => {
    if (!approval || answering) return;
    setAnswering(true);
    void orglet.call('answerBrowserApproval', { taskId: detail.task.id, requestId: approval.id, answer: choice })
      .catch(error => toast(tMessage(String(error)), 'error', t('Trình duyệt')))
      .finally(() => setAnswering(false));
  };
  return <Viewer open onClose={() => openBrowserViewer(undefined)} title={t('Trình duyệt của {0}', [watched.workerName])} icon={<AppWindow size={15} aria-hidden="true" />}
    meta={meta} actions={<LiveActions detail={detail} />} closeLabel={t('Đóng')} closeIcon={<X size={16} />} className="browser-live-viewer">
    <div className="browser-live-viewer-body">
      <BrowserLiveSurface runId={watched.runId} workerName={watched.workerName} site={watched.site} controlling={live!.takenOver && !live!.inChrome} inChrome={live!.inChrome}
        onOpenInChrome={() => takeOverBrowser(detail.task.id, true, true)} onBackToOrglet={() => takeOverBrowser(detail.task.id, true)} large />
      {approval && <BrowserApprovalCard taskId={detail.task.id} approval={approval} busy={answering} onAnswer={answer} />}
    </div>
  </Viewer>;
}
