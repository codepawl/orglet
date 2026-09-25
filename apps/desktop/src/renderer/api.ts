import type { Bridge } from '../shared/contracts';
import { tMessage } from './i18n';

/**
 * The preload bridge with errors translated into the current language. Components call this instead of
 * `window.orglet`, so messages from the main process and core show in the chosen language.
 */
export const orglet = new Proxy({} as Bridge, {
  get(_target, key: keyof Bridge) {
    const value = window.orglet[key] as unknown;
    // Subscriptions return an unsubscribe function right away, so they are passed through unwrapped.
    if (typeof value !== 'function' || key === 'onChange' || key === 'onProgress' || key === 'onUpdate' || key === 'onNavigate' || key === 'onOpenChat' || key === 'onIncoming') return value;
    return async (...args: unknown[]) => {
      try { return await (value as (...input: unknown[]) => Promise<unknown>)(...args); }
      catch (error) { throw new Error(tMessage(error instanceof Error ? error.message : String(error))); }
    };
  },
});
