/**
 * Search across every chat (COD-267): what the person wrote on each turn, every answer and report, the names of chats,
 * and the names of orglets and crews. The core keeps the index (`core/storage/chat-search.ts`); these pure pieces are
 * shared so that matching, snippets and the marked words follow one rule on both sides.
 *
 * Matching ignores case and accents, so "hop dong" finds "hợp đồng". SQLite's tokenizer keeps đ apart from d, so text
 * is folded here before it reaches the index, and the query is folded the same way. Every word typed has to start a
 * word of the text, in any order; typed together, in order, they also count as the exact phrase, which ranks first.
 */

/** A piece of a snippet or a name; `match` marks the words the search found. */
export type SnippetPart = { text: string; match?: true };

/** Who wrote the message a chat result shows: the person, or the orglet whose answer it is, as its byline names it. */
export type ChatSearchSender = { kind: 'you' } | { kind: 'orglet'; name: string };

export type ChatSearchHit = {
  taskId: string;
  /** The message to scroll to: a turn's message id or an answer's artifact id. Absent when only the chat's name matched. */
  messageId?: string;
  sender?: ChatSearchSender;
  /** A short piece of the message around the match, with the matched words marked; empty for a name match. */
  snippet: SnippetPart[];
  /** When the matched message was written, or when the chat started for a name match. */
  at: string;
};

export type ChatSearchResult = {
  /** The words searched for, folded, so the window can mark them in names the same way the core matched them. */
  terms: string[];
  /** Live orglets and crews whose name matches, in the order they should be listed. */
  orgletIds: string[];
  crewIds: string[];
  /** One result per chat, its best-matching message; the order is explained on `ChatSearch.search` in the core. */
  chats: ChatSearchHit[];
  /** Chats from before this version are still being added to the index, so a few may be missing for now. */
  indexing: boolean;
};

/** At most this many words of a query are used; a pasted paragraph searches by its first words. */
export const MAX_SEARCH_TERMS = 8;
/** Characters of context a snippet keeps before the first match, and its whole length. */
const SNIPPET_LEAD = 36;
const SNIPPET_LENGTH = 180;
/** How much of a long message is read word by word around the likely match; comfortably more than a snippet. */
const SCAN_WINDOW = 600;

const wordCharacter = /^[\p{L}\p{N}]+$/u;
const combiningMark = /^\p{M}$/u;

/** Lower case, without accents, with đ as d: the form the index stores and the query is compared in. */
export function foldForSearch(text: string): string {
  const withoutMarks = text.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  return withoutMarks.replace(/[đĐ]/g, 'd').toLowerCase();
}

/** The folded words of a query, in the order typed, at most `MAX_SEARCH_TERMS`. */
export function searchTerms(query: string): string[] {
  const words = foldForSearch(query).match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.slice(0, MAX_SEARCH_TERMS);
}

/**
 * The FTS5 expression for "every word starts a word of the text". Each term is quoted, so operators typed by the
 * person (`OR`, `NEAR`, quotes) are searched as text; terms only ever hold letters and digits.
 */
export function everyWordQuery(terms: readonly string[]): string {
  return [...new Set(terms)].map(term => `"${term}"*`).join(' ');
}

/** The FTS5 expression for the words typed together, in order, the last one still being typed. */
export function phraseQuery(terms: readonly string[]): string {
  return `"${terms.join(' ')}" *`;
}

type Word = { start: number; end: number; folded: string };

/**
 * The words of a text with where each sits in it, folded one character at a time, so a word found in the folded form
 * points back at the characters as written. A combining mark stays with the word it decorates.
 */
function wordsOf(text: string): Word[] {
  const words: Word[] = [];
  let current: Word | undefined;
  let index = 0;
  while (index < text.length) {
    const character = String.fromCodePoint(text.codePointAt(index)!);
    const next = index + character.length;
    const folded = foldForSearch(character);
    if (folded && wordCharacter.test(folded)) {
      if (current) {
        current.end = next;
        current.folded += folded;
      } else {
        current = { start: index, end: next, folded };
        words.push(current);
      }
    } else if (current && combiningMark.test(character)) {
      current.end = next;
    } else {
      current = undefined;
    }
    index = next;
  }
  return words;
}

const startsWithAny = (word: Word, terms: readonly string[]) => terms.some(term => word.folded.startsWith(term));

/** Where the words typed start together and in order, or -1. Like the FTS5 phrase: only the last word may be a prefix. */
function phraseStart(words: readonly Word[], terms: readonly string[]): number {
  if (!terms.length) return -1;
  const last = terms.length - 1;
  for (let start = 0; start + last < words.length; start += 1) {
    const together = terms.every((term, offset) => offset === last
      ? words[start + offset].folded.startsWith(term)
      : words[start + offset].folded === term);
    if (together) return start;
  }
  return -1;
}

/** Whether every word typed starts some word of this text: the rule the index applies, for names matched in memory. */
export function matchesEveryWord(text: string, terms: readonly string[]): boolean {
  if (!terms.length) return false;
  const words = wordsOf(text);
  return terms.every(term => words.some(word => word.folded.startsWith(term)));
}

/** Whether the words typed appear together and in order in this text. */
export function matchesPhrase(text: string, terms: readonly string[]): boolean {
  return phraseStart(wordsOf(text), terms) >= 0;
}

/** A text cut into plain and marked pieces, every word the search found marked. */
function markedParts(text: string, words: readonly Word[], terms: readonly string[], from: number, to: number): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let position = from;
  for (const word of words) {
    if (word.end <= from || word.start >= to || !startsWithAny(word, terms)) continue;
    if (word.start > position) parts.push({ text: text.slice(position, word.start) });
    parts.push({ text: text.slice(Math.max(word.start, from), Math.min(word.end, to)), match: true });
    position = Math.min(word.end, to);
  }
  if (position < to) parts.push({ text: text.slice(position, to) });
  return parts;
}

/** A name or title with the words the search found marked, for the window to draw. */
export function markMatches(text: string, terms: readonly string[]): SnippetPart[] {
  return markedParts(text, wordsOf(text), terms, 0, text.length);
}

/** Where a word of the folded text starts with the term, or -1. */
function wordStartOf(folded: string, term: string): number {
  let position = folded.indexOf(term);
  while (position > 0 && /[\p{L}\p{N}]/u.test(folded[position - 1])) position = folded.indexOf(term, position + 1);
  return position;
}

/**
 * The part of a long message worth reading word by word: around the first place the words appear together, or the
 * first word found. Folding a whole string at once is cheap, but word by word is not, and a search draws up to fifty
 * snippets per keystroke. A precomposed text folds to one character per character, so a place in the folded text is
 * the same place in the text; when it does not, or nothing is found, the whole text is read.
 */
function likelyRegion(text: string, terms: readonly string[]): { start: number; end: number } {
  const whole = { start: 0, end: text.length };
  if (text.length <= SCAN_WINDOW * 2) return whole;
  const folded = foldForSearch(text);
  if (folded.length !== text.length) return whole;
  const phrase = folded.indexOf(terms.join(' '));
  const starts = terms.map(term => wordStartOf(folded, term)).filter(position => position >= 0);
  const first = phrase >= 0 ? phrase : starts.length ? Math.min(...starts) : -1;
  if (first < 0) return whole;
  // Start after a space, so the first word read is a whole word and not the tail of one.
  const before = Math.max(0, first - SCAN_WINDOW / 2);
  const space = text.indexOf(' ', before);
  const start = before === 0 ? 0 : space >= 0 && space < first ? space + 1 : first;
  return { start, end: Math.min(text.length, first + SCAN_WINDOW) };
}

/** The words of part of a text, placed in the whole text. */
function wordsBetween(text: string, region: { start: number; end: number }): Word[] {
  return wordsOf(text.slice(region.start, region.end)).map(word => ({ ...word, start: word.start + region.start, end: word.end + region.start }));
}

/**
 * A short piece of a message around what the search found: from a little before the first place the words appear
 * together (or, failing that, the first word found), cut at spaces, with an ellipsis where text was left out.
 */
export function snippetOf(text: string, terms: readonly string[]): SnippetPart[] {
  const region = likelyRegion(text, terms);
  const findAnchor = (words: readonly Word[]) => {
    const together = phraseStart(words, terms);
    return together >= 0 ? words[together] : words.find(word => startsWithAny(word, terms));
  };
  let words = wordsBetween(text, region);
  let anchor = findAnchor(words);
  if (!anchor && (region.start > 0 || region.end < text.length)) {
    words = wordsOf(text);
    anchor = findAnchor(words);
  }
  if (!anchor) return text.length > SNIPPET_LENGTH ? [{ text: `${text.slice(0, SNIPPET_LENGTH).trimEnd()}…` }] : [{ text }];
  let from = Math.max(0, anchor.start - SNIPPET_LEAD);
  if (from > 0) {
    const space = text.indexOf(' ', from);
    from = space >= 0 && space < anchor.start ? space + 1 : anchor.start;
  }
  let to = Math.min(text.length, from + SNIPPET_LENGTH);
  if (to < text.length) {
    const space = text.lastIndexOf(' ', to);
    to = space > anchor.end ? space : Math.max(to, anchor.end);
  }
  // The shown piece starts after a space or at the anchor, so its words are read whole, wherever the region was cut.
  const parts = markedParts(text, wordsBetween(text, { start: from, end: to }), terms, from, to);
  if (from > 0) parts.unshift({ text: '…' });
  if (to < text.length) parts.push({ text: '…' });
  return parts;
}

/**
 * Markdown as the reader sees it, on one line: no fences, heading hashes, quote or list markers, table pipes, emphasis
 * or link syntax. Single `*` and `_` go only around a whole word, so names like `snake_case` stay searchable.
 */
export function plainSearchText(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
    .filter(line => !/^\s*(```|~~~)/.test(line))
    .map(line => line
      .replace(/^\s*(#{1,6}|>+|[-*+]|\d+[.)])\s+/, '')
      .replace(/\|/g, ' '));
  return lines.join(' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|[^\p{L}\p{N}])[*_]([^*_\s](?:[^*_]*[^*_\s])?)[*_](?=[^\p{L}\p{N}]|$)/gu, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}
