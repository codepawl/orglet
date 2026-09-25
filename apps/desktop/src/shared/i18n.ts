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
const patternCache = new WeakMap<Dictionary, { key: string; pattern: RegExp; template: string }[]>();
const translateValue = (dictionary: Dictionary, value: string) => dictionary[value] ?? value;
/**
 * Keys with a value that is itself a finished core message, mapped to that value's placeholder: the error that
 * stopped a crew role (COD-252). That value is translated like a whole message. Other values are names, numbers or
 * model text and only match an exact key, so a sentence that merely starts like a label ("Mở …") stays as written.
 */
const messageValues = new Map([['Role chưa hoàn tất: {0}: {1}', '1']]);

/** How much fixed text a key has besides its placeholders. */
const literalLength = (key: string) => key.replace(/\{\d+\}/g, '').length;

/**
 * Translates a finished message, e.g. an error text built by the core with values filled in.
 * Exact keys win; otherwise keys with placeholders are matched as patterns (compiled once per dictionary). Keys that
 * hold another message go first, since the message inside can have more fixed text than the key around it; then the
 * most specific first, so a general key such as "{0}: {1}" never answers for a message that has its own (COD-246).
 */
export function translateMessage(dictionary: Dictionary | null, message: string): string {
  if (!dictionary) return message;
  if (dictionary[message]) return dictionary[message];
  let patterns = patternCache.get(dictionary);
  if (!patterns) {
    const keyed = Object.entries(dictionary).filter(([key]) => /\{\d+\}/.test(key));
    const ordered = keyed.sort(([first], [second]) =>
      Number(messageValues.has(second)) - Number(messageValues.has(first)) || literalLength(second) - literalLength(first));
    patterns = ordered.map(([key, template]) => ({
      key, pattern: new RegExp(`^${escape(key).replace(/\\\{(\d+)\\\}/g, '(?<p$1>[\\s\\S]*?)')}$`), template,
    }));
    patternCache.set(dictionary, patterns);
  }
  for (const { key, pattern, template } of patterns) {
    const match = pattern.exec(message);
    if (!match) continue;
    return template.replace(/\{(\d+)\}/g, (_, index: string) => {
      const value = match.groups?.[`p${index}`] ?? '';
      if (messageValues.get(key) === index) return translateMessage(dictionary, value);
      // A filled-in value can itself be a known message, such as the reason inside "Search failed: {0}".
      return translateValue(dictionary, value);
    });
  }
  return message;
}
