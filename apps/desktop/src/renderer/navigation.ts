import { useEffect, useRef } from 'react';

/**
 * Back and forward through what the user opened (COD-202), the way a browser walks its history: chats, panels
 * and their tabs or items are views; the mouse's side buttons and Alt+arrows step between them.
 */
export type NavigationDirection = 'back' | 'forward';

/** The smallest description of what is on screen. Data that refreshes underneath (a chat's messages) is not in it. */
export type AppView = {
  /** The open chat, or null for the empty chat with `recipient`. */
  chat: string | null;
  /** Who the empty chat talks to: a worker id, `team:<id>`, `group:<worker ids>` (COD-215), or '' before anyone is chosen. Empty while a chat is open. */
  recipient: string;
  panel: string | null;
  /** The settings or library tab. */
  tab?: string;
  /** The skill, knowledge, worker, team, chat or routine the panel is editing. */
  item?: string;
  fromLibrary?: boolean;
  /** The routines panel shows its editor. */
  editing?: boolean;
  notices?: boolean;
  /** The Running view (COD-244). */
  running?: boolean;
  /** The source viewer dialog. */
  source?: string;
};

export type AppViewState = {
  chat: string | null;
  recipient: string;
  panel: string | null;
  settingsTab: string;
  libraryTab: string;
  fromLibrary: boolean;
  skillId?: string;
  knowledgeId?: string;
  workerId?: string;
  teamId?: string;
  taskId?: string;
  routineEditing: boolean;
  routineId?: string;
  noticesOpen: boolean;
  runningOpen?: boolean;
  sourceId?: string;
};

/** Reads the view off the app's state, keeping only what the open panel shows so a tab of a closed panel records nothing. */
export function appView(state: AppViewState): AppView {
  const view: AppView = { chat: state.chat, recipient: state.chat ? '' : state.recipient, panel: state.panel };
  switch (state.panel) {
    case 'settings': view.tab = state.settingsTab; break;
    case 'library': view.tab = state.libraryTab; break;
    case 'skill': view.item = state.skillId; view.fromLibrary = state.fromLibrary; break;
    case 'knowledge': view.item = state.knowledgeId; view.fromLibrary = state.fromLibrary; break;
    case 'worker': view.item = state.workerId; break;
    case 'team': view.item = state.teamId; break;
    case 'task': view.item = state.taskId; break;
    case 'routines': view.editing = state.routineEditing; view.item = state.routineId; break;
    default: break;
  }
  if (state.noticesOpen) view.notices = true;
  if (state.runningOpen) view.running = true;
  if (state.sourceId) view.source = state.sourceId;
  return view;
}

/** Two views with the same key are the same step. Fields are written in a fixed order, so the key is stable. */
export function viewKey(view: AppView): string {
  return JSON.stringify([view.chat, view.recipient, view.panel, view.tab ?? null, view.item ?? null, view.fromLibrary ?? false, view.editing ?? false, view.notices ?? false, view.source ?? null, view.running ?? false]);
}

export const HISTORY_LIMIT = 50;

export type NavigationHistory<View> = {
  readonly entries: readonly View[];
  readonly index: number;
  readonly limit: number;
  readonly key: (view: View) => string;
};

export function createHistory<View>(initial: View, key: (view: View) => string, limit = HISTORY_LIMIT): NavigationHistory<View> {
  return { entries: [initial], index: 0, limit, key };
}

export function currentView<View>(history: NavigationHistory<View>): View {
  return history.entries[history.index];
}

/** Adds a step after the current one, dropping any forward steps, like a browser. The same view again is not a step. */
export function recordView<View>(history: NavigationHistory<View>, view: View): NavigationHistory<View> {
  if (history.key(currentView(history)) === history.key(view)) return history;
  const entries = [...history.entries.slice(0, history.index + 1), view];
  const overflow = Math.max(0, entries.length - history.limit);
  return { ...history, entries: entries.slice(overflow), index: entries.length - 1 - overflow };
}

/** Rewrites the current step: what a restore actually showed, or an opening the app did on its own. */
export function replaceView<View>(history: NavigationHistory<View>, view: View): NavigationHistory<View> {
  const entries = [...history.entries];
  entries[history.index] = view;
  return { ...history, entries };
}

/**
 * The next step in a direction whose view still exists. Steps to things that are gone (a deleted chat or skill)
 * are dropped on the way past. Undefined when there is nowhere to go.
 */
export function stepHistory<View>(history: NavigationHistory<View>, direction: NavigationDirection, exists: (view: View) => boolean): { history: NavigationHistory<View>; view: View } | undefined {
  const entries = [...history.entries];
  let index = direction === 'back' ? history.index - 1 : history.index + 1;
  while (index >= 0 && index < entries.length) {
    const view = entries[index];
    if (exists(view)) return { history: { ...history, entries, index }, view };
    entries.splice(index, 1);
    if (direction === 'back') index -= 1;
  }
  return undefined;
}

export type StepSource = 'mouse' | 'keyboard' | 'window';
export type StepEvent = { source: StepSource; direction: NavigationDirection; at: number };

/**
 * One press, one step. A side button over the page reaches the renderer as a mouse event and nothing else, and one
 * over the window frame reaches the main process as an app command and nothing else; a driver that sends both is
 * the case this guards against, so the same direction from another source right after the first is the same press.
 */
export const DUPLICATE_STEP_WINDOW_MS = 300;
export function acceptStep(previous: StepEvent | undefined, next: StepEvent, windowMs = DUPLICATE_STEP_WINDOW_MS): boolean {
  if (!previous) return true;
  if (previous.source === next.source || previous.direction !== next.direction) return true;
  return next.at - previous.at >= windowMs;
}

const BACK_MOUSE_BUTTON = 3;
const FORWARD_MOUSE_BUTTON = 4;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Listens for the mouse's side buttons, Alt+Left / Alt+Right, and the main process's app commands. Preventing the
 * mouse-up default is what keeps Chromium from treating the button as its own history navigation.
 */
export function useNavigationInput(step: (direction: NavigationDirection) => void, subscribe?: (callback: (direction: NavigationDirection) => void) => () => void) {
  const stepRef = useRef(step);
  stepRef.current = step;
  const lastStep = useRef<StepEvent | undefined>(undefined);
  useEffect(() => {
    const take = (source: StepSource, direction: NavigationDirection) => {
      const event: StepEvent = { source, direction, at: Date.now() };
      if (!acceptStep(lastStep.current, event)) return;
      lastStep.current = event;
      stepRef.current(direction);
    };
    const mouseup = (event: MouseEvent) => {
      if (event.button !== BACK_MOUSE_BUTTON && event.button !== FORWARD_MOUSE_BUTTON) return;
      event.preventDefault();
      take('mouse', event.button === BACK_MOUSE_BUTTON ? 'back' : 'forward');
    };
    const keydown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (isTyping(event.target)) return;
      event.preventDefault();
      take('keyboard', event.key === 'ArrowLeft' ? 'back' : 'forward');
    };
    window.addEventListener('mouseup', mouseup, { capture: true });
    window.addEventListener('keydown', keydown);
    const unsubscribe = subscribe?.(direction => take('window', direction));
    return () => {
      window.removeEventListener('mouseup', mouseup, { capture: true });
      window.removeEventListener('keydown', keydown);
      unsubscribe?.();
    };
  }, [subscribe]);
}
