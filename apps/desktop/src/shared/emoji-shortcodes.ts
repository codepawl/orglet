import { gemoji } from 'gemoji';

/**
 * Emoji shortcodes in the message box (COD-233): `:skull:` becomes 💀, and `:sk` offers the emoji whose names fit.
 * The names are GitHub's (gemoji), the same ones Slack and Discord mostly accept, and the table ships with the app,
 * so nothing is looked up online.
 *
 * The owner's condition (2026-09-25): the menu must not pop up over ordinary writing. So a shortcode only starts at
 * the beginning of the text or after a space or an opening bracket (never in `10:30` or `https://`), needs two
 * characters after the colon, and the menu opens only when something actually matches.
 */

export type EmojiChoice = { emoji: string; name: string };
export type ShortcodeQuery = { start: number; query: string };

const MINIMUM_QUERY_LENGTH = 2;
const MAXIMUM_CHOICES = 6;
const SHORTCODE_NAME = /^[a-z0-9_+-]+$/;

/**
 * The emoji people reach for most, in that order. Among names that fit a query equally well these come first, so
 * `:fi` offers 🔥 before ✊. The rest follow the table's own order, which is roughly Unicode's.
 */
const FAVOURITES = [
  'joy', 'heart', 'fire', 'skull', 'sob', '+1', 'pray', 'rofl', 'smile', 'thinking', 'eyes', 'tada', 'rocket',
  'sparkles', 'heart_eyes', 'clap', 'ok_hand', 'wave', 'muscle', '100', 'pleading_face', 'cry', 'laughing',
  'sweat_smile', 'wink', 'smirk', 'grin', 'blush', 'star_struck', 'white_check_mark', 'x', 'warning', 'bug',
];

type Entry = { emoji: string; names: string[]; tags: string[]; order: number };

let emojiByName: Map<string, string> | undefined;
let entries: Entry[] | undefined;

/** Built on first use rather than at start-up: about 1,900 emoji, most chats never type a colon. */
function emojiTable(): { byName: Map<string, string>; list: Entry[] } {
  if (!emojiByName || !entries) {
    emojiByName = new Map();
    entries = gemoji.map((item, index) => {
      const favourite = FAVOURITES.findIndex(name => item.names.includes(name));
      const order = favourite >= 0 ? favourite - FAVOURITES.length : index;
      return { emoji: item.emoji, names: item.names, tags: item.tags, order };
    });
    for (const entry of entries) {
      for (const name of entry.names) {
        if (!emojiByName.has(name)) emojiByName.set(name, entry.emoji);
      }
    }
  }
  return { byName: emojiByName, list: entries };
}

/** The emoji for a shortcode name without its colons, such as `skull`. */
export function emojiForShortcode(name: string): string | undefined {
  return emojiTable().byName.get(name.toLowerCase());
}

function startsShortcode(text: string, colon: number): boolean {
  if (colon === 0) return true;
  return /[\s([{"'>]/.test(text[colon - 1]!);
}

/** The shortcode being typed just before `cursor`, such as `:sk`, or undefined when the text is not one. */
export function shortcodeQueryAt(text: string, cursor: number): ShortcodeQuery | undefined {
  if (cursor < 1 || cursor > text.length) return undefined;
  const colon = text.lastIndexOf(':', cursor - 1);
  if (colon < 0 || !startsShortcode(text, colon)) return undefined;
  const query = text.slice(colon + 1, cursor).toLowerCase();
  if (query.length < MINIMUM_QUERY_LENGTH || !SHORTCODE_NAME.test(query)) return undefined;
  return { start: colon, query };
}

/**
 * How well one name fits what was typed, lower is better, or undefined when it does not fit at all. A name that
 * starts with the query comes first, then one where a later word does (`ice_skate` for `sk`), then one that merely
 * contains it (`mask`).
 */
function nameRank(name: string, query: string): number | undefined {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.split(/[_-]/).some(word => word.startsWith(query))) return 2;
  if (name.includes(query)) return 3;
  return undefined;
}

/** The emoji to offer for a query, best first, each emoji once under its best-fitting name. */
export function emojiChoices(query: string): EmojiChoice[] {
  const needle = query.toLowerCase();
  if (needle.length < MINIMUM_QUERY_LENGTH) return [];
  const ranked: { choice: EmojiChoice; rank: number; order: number }[] = [];
  for (const entry of emojiTable().list) {
    let best: { name: string; rank: number } | undefined;
    for (const name of entry.names) {
      const rank = nameRank(name, needle);
      if (rank !== undefined && (!best || rank < best.rank)) best = { name, rank };
    }
    // A tag that starts with the query is the loosest fit (`haha` finds 😆), shown under the emoji's own name.
    if (!best && entry.tags.some(tag => tag.startsWith(needle))) best = { name: entry.names[0]!, rank: 4 };
    if (best) ranked.push({ choice: { emoji: entry.emoji, name: best.name }, rank: best.rank, order: entry.order });
  }
  ranked.sort((left, right) => left.rank - right.rank || left.order - right.order);
  return ranked.slice(0, MAXIMUM_CHOICES).map(item => item.choice);
}

/** `text` with the shortcode query at `query.start`..`cursor` replaced by `emoji`, and where the cursor goes. */
export function insertEmoji(text: string, cursor: number, query: ShortcodeQuery, emoji: string): { text: string; cursor: number } {
  const next = text.slice(0, query.start) + emoji + text.slice(cursor);
  return { text: next, cursor: query.start + emoji.length };
}

/**
 * When the colon just typed closes a known shortcode (`:skull:`), the text with that shortcode turned into its
 * emoji. Undefined otherwise, so an unknown `:word:` stays as it was written.
 */
export function completeShortcodeAt(text: string, cursor: number): { text: string; cursor: number } | undefined {
  if (cursor < 2 || text[cursor - 1] !== ':') return undefined;
  const query = shortcodeQueryAt(text, cursor - 1);
  if (!query) return undefined;
  const emoji = emojiForShortcode(query.query);
  if (!emoji) return undefined;
  return insertEmoji(text, cursor, query, emoji);
}
