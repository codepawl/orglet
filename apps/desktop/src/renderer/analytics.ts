import type { AnalyticsFeature } from '../shared/analytics';
import { orglet } from './api';

/**
 * What the window tells main for analytics (COD-344). Its uncaught errors and unhandled rejections go to main for analytics (COD-344). Main drops them unless the
 * person is signed in with analytics on, and scrubs what it keeps; the window sends only the message and the stack.
 */
export function reportErrorsToMain() {
  window.addEventListener('error', event => {
    const error = event.error instanceof Error ? event.error : undefined;
    send(error?.message ?? event.message, error?.stack);
  });
  window.addEventListener('unhandledrejection', event => {
    const reason: unknown = event.reason;
    if (reason instanceof Error) send(reason.message, reason.stack);
    else send(String(reason));
  });
}

function send(message: string, stack?: string) {
  // The renderer-only preview (`pnpm dev:web`) has no bridge.
  if (!message || !window.orglet) return;
  void orglet.reportError({ message: message.slice(0, 10_000), ...(stack ? { stack: stack.slice(0, 40_000) } : {}) }).catch(() => undefined);
}

/** Tells main a feature from the fixed list was used; main counts it once per session, only with analytics on. */
export function reportFeature(feature: AnalyticsFeature) {
  if (!window.orglet) return;
  void orglet.reportFeature(feature).catch(() => undefined);
}
