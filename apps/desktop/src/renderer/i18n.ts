import { Fragment, createElement, useSyncExternalStore, type ReactNode } from 'react';
import { DEFAULT_LANGUAGE, localeOf, translate, translateMessage, type Dictionary, type Language } from '../shared/i18n';
import { en, enGB } from '../shared/locales/en';

// Module-level language, like the display currency: App sets it and every component re-renders under App.
// Source strings are Vietnamese; English is the default, so its dictionary ships with the renderer.
let language: Language = DEFAULT_LANGUAGE;
const dictionaries: { en: Dictionary; enGB: Dictionary } = { en, enGB };
let version = 0;
const listeners = new Set<() => void>();
const emit = () => { version++; for (const listener of listeners) listener(); };

export function setLanguage(next: Language | undefined) {
  const value = next ?? DEFAULT_LANGUAGE;
  if (value === language) return;
  language = value;
  document.documentElement.lang = value;
  emit();
}

const active = () => language === 'vi' ? null : language === 'en-GB' ? dictionaries.enGB : dictionaries.en;
const warned = new Set<string>();
/** Translates Vietnamese source text; `{0}` placeholders take `params` in order. */
export const t = (key: string, params?: readonly unknown[]) => {
  const dictionary = active();
  if (import.meta.env.DEV && dictionary && key.trim() && !(key in dictionary) && !warned.has(key)) {
    warned.add(key); console.warn(`[i18n] Missing English text for "${key}". Add it to shared/locales/en.ts.`);
  }
  return translate(dictionary, key, params);
};
/** Translates a message produced elsewhere (core errors), including ones with values filled in. */
export const tMessage = (message: string) => translateMessage(active(), message);
export const currentLanguage = () => language;
export const currentLocale = () => localeOf(language);
/**
 * Wraps a module-level map or list of Vietnamese labels so each string is translated when read, not when the
 * module loads (which happens before the language is known).
 */
export const translated = <T extends object>(value: T): T => new Proxy(value, {
  get(target, key, receiver) { const item = Reflect.get(target, key, receiver) as unknown; return typeof item === 'string' ? t(item) : item; },
});
/** Re-renders the caller when the language or its dictionary changes. */
export const useLanguage = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => version);

/** Stand-ins passed to `t` for the parts `withNodes` fills with elements; invisible separators nothing else uses. */
export const NODE_MARKERS = ['⁣' + '0' + '⁣', '⁣' + '1' + '⁣', '⁣' + '2' + '⁣', '⁣' + '3' + '⁣'];

/**
 * A translated sentence with some of its values drawn as elements (a coloured count, say), keeping the language's own
 * word order: translate with `NODE_MARKERS` as the params, then hand the result and the elements here.
 */
export function withNodes(translatedText: string, nodes: readonly ReactNode[]): ReactNode[] {
  return translatedText.split(/⁣(\d)⁣/).map((part, index) => {
    const content = index % 2 === 1 ? nodes[Number(part)] : part;
    return createElement(Fragment, { key: index }, content);
  });
}
