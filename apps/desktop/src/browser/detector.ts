import { isCardField, isPasswordField } from '../core/tools/browser-risk';
import type { BrowserSuggestion } from '../shared/browser-live';

/**
 * When the live view is not enough (COD-261): something on the page that only the real Chrome window can show or
 * answer. The host feeds each sign it sees through `suggestionFor`; a suggestion is only ever shown, and Orglet never
 * switches to the window without the person's click.
 */

/** A field the page has focus in, as the host reads it from the frame that holds it. */
export type FocusedField = { inputType: string | null; autocomplete: string | null; fieldName: string | null };

/** One sign the host saw on a run's tab. */
export type DetectorSignal =
  /** The page called `navigator.credentials.get` or `create`; `publicKey` is set for a passkey. */
  | { kind: 'credentials'; publicKey: boolean }
  | { kind: 'fileChooser' }
  | { kind: 'dialog' }
  /** A response the tab got; only the page's own document counts. */
  | { kind: 'response'; status: number; authenticate: boolean; document: boolean; mainFrame: boolean }
  /** Where the page's focus is after the person clicked or pressed a key in the view; null when not in a field. */
  | { kind: 'focus'; field: FocusedField | null; held: boolean };

export function suggestionFor(signal: DetectorSignal): BrowserSuggestion | null {
  if (signal.kind === 'credentials') return signal.publicKey ? 'passkey' : null;
  if (signal.kind === 'fileChooser') return 'fileChooser';
  if (signal.kind === 'dialog') return 'dialog';
  if (signal.kind === 'response') {
    const asksForSignIn = (signal.status === 401 || signal.status === 407) && signal.authenticate;
    return asksForSignIn && signal.document && signal.mainFrame ? 'httpAuth' : null;
  }
  // A field only matters while the person holds the browser: the orglet never types into one of these.
  if (!signal.held || !signal.field) return null;
  return isPasswordField(signal.field) || isCardField(signal.field) ? 'sensitiveField' : null;
}

/** The same suggestion is not repeated within this long, so a page that keeps asking cannot flood the view. */
export const SUGGESTION_QUIET_MS = 10_000;

/** The latest suggestion per run, repeated no more than once in `SUGGESTION_QUIET_MS` per reason. */
export class SuggestionLog {
  private latest = new Map<string, { suggestion: BrowserSuggestion; at: number }>();
  private shown = new Map<string, number>();

  constructor(private clock: () => number = Date.now) {}

  /** Records a suggestion; true when it is new enough to be sent to the view. */
  offer(runId: string, suggestion: BrowserSuggestion): boolean {
    const key = `${runId} ${suggestion}`;
    const now = this.clock();
    const last = this.shown.get(key);
    this.latest.set(runId, { suggestion, at: now });
    if (last !== undefined && now - last < SUGGESTION_QUIET_MS) return false;
    this.shown.set(key, now);
    return true;
  }

  /** The suggestion a view opened now shows, if one came in the last minute. */
  current(runId: string): BrowserSuggestion | null {
    const latest = this.latest.get(runId);
    if (!latest || this.clock() - latest.at > 60_000) return null;
    return latest.suggestion;
  }

  /** Handing the browser back or ending the run clears what was suggested. */
  clear(runId: string) {
    this.latest.delete(runId);
    for (const key of [...this.shown.keys()]) if (key.startsWith(`${runId} `)) this.shown.delete(key);
  }
}

/**
 * The field the page has focus in, read inside one frame (a card form often sits in a payment provider's frame, and
 * then the page's own focus is on that frame, which is not a field). Runs through Playwright's `evaluate`, so it
 * stands alone. Null when the frame's focus is not in a field. The main frame is read first, so a field the person
 * left inside a frame does not count once they clicked a field of the page itself.
 */
export function readFocusedField(): { inputType: string | null; autocomplete: string | null; fieldName: string | null } | null {
  let element: Element | null = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  if (!element) return null;
  const tag = element.tagName.toLowerCase();
  if (tag !== 'input' && tag !== 'textarea') return null;
  const input = tag === 'input' ? element as HTMLInputElement : null;
  const fieldName = [element.getAttribute('name'), element.id].filter(Boolean).join(' ').slice(0, 300);
  return {
    inputType: input ? (input.type || 'text').toLowerCase() : null,
    autocomplete: element.getAttribute('autocomplete')?.slice(0, 200) ?? null,
    fieldName: fieldName || null,
  };
}

/**
 * Tells the host when a page asks for a passkey. It wraps `navigator.credentials.get` and `create` to call the
 * binding first and then does what the page asked, unchanged; it hides nothing about the browser being automated.
 * Added to the headless browser only, since the Chrome window answers passkeys itself.
 */
export const PASSKEY_BINDING = '__orgletPasskeyRequested';
export const PASSKEY_WATCH_SCRIPT = `(() => {
  const credentials = globalThis.navigator && navigator.credentials;
  const tell = globalThis[${JSON.stringify(PASSKEY_BINDING)}];
  if (!credentials || typeof tell !== 'function') return;
  for (const name of ['get', 'create']) {
    const original = credentials[name];
    if (typeof original !== 'function') continue;
    credentials[name] = function (options) {
      if (options && options.publicKey) { try { tell(name); } catch {} }
      return original.apply(this, arguments);
    };
  }
})();`;
