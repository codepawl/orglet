import { z } from 'zod';

/** `en` is US English (kept as the stored value from before the split); `en-GB` is British English. */
export const Language = z.enum(['vi', 'en', 'en-GB']);
/** New installs speak US English; Vietnamese and UK English are a setting away. */
export const DEFAULT_LANGUAGE: z.infer<typeof Language> = 'en';
export type Language = z.infer<typeof Language>;
/** Vietnamese source text → translation. Vietnamese is the key language, so it needs no dictionary. */
export type Dictionary = Record<string, string>;

export const localeOf = (language: Language) => language === 'en' ? 'en-US' : language === 'en-GB' ? 'en-GB' : 'vi-VN';

/** Fills `{0}`, `{1}` placeholders. */
export const format = (template: string, params?: readonly unknown[]) =>
  params ? template.replace(/\{(\d+)\}/g, (_, index: string) => String(params[Number(index)] ?? '')) : template;

export const translate = (dictionary: Dictionary | null, key: string, params?: readonly unknown[]) => format(dictionary?.[key] ?? key, params);

const escape = (text: string) => text.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
const patternCache = new WeakMap<Dictionary, { pattern: RegExp; template: string }[]>();
const translateValue = (dictionary: Dictionary, value: string) => dictionary[value] ?? value;

/** How much fixed text a key has besides its placeholders. */
const literalLength = (key: string) => key.replace(/\{\d+\}/g, '').length;

/**
 * Translates a finished message, e.g. an error text built by the core with values filled in.
 * Exact keys win; otherwise keys with placeholders are matched as patterns (compiled once per dictionary), the most
 * specific first, so a general key such as "{0}: {1}" never answers for a message that has its own (COD-246).
 */
export function translateMessage(dictionary: Dictionary | null, message: string) {
  if (!dictionary) return message;
  if (dictionary[message]) return dictionary[message];
  let patterns = patternCache.get(dictionary);
  if (!patterns) {
    const keyed = Object.entries(dictionary).filter(([key]) => /\{\d+\}/.test(key));
    const mostSpecificFirst = keyed.sort(([first], [second]) => literalLength(second) - literalLength(first));
    patterns = mostSpecificFirst.map(([key, template]) => ({
      pattern: new RegExp(`^${escape(key).replace(/\\\{(\d+)\\\}/g, '(?<p$1>[\\s\\S]*?)')}$`), template,
    }));
    patternCache.set(dictionary, patterns);
  }
  for (const { pattern, template } of patterns) {
    const match = pattern.exec(message);
    // A filled-in value can itself be a known message, such as the reason inside "Search failed: {0}".
    if (match) return template.replace(/\{(\d+)\}/g, (_, index: string) => translateValue(dictionary, match.groups?.[`p${index}`] ?? ''));
  }
  return message;
}
