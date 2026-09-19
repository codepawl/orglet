/*
 * Matching a role lexicon against what someone wrote about a worker: its name, description, skill and instructions.
 * Shared by the mascot suggester and the chat starters so both read a role the same way.
 *
 * Text is lowercased and stripped of Vietnamese diacritics, then split into words. A keyword of several words must
 * appear as consecutive words. Words shorter than four letters must match exactly ("pr", "qa", "lich"); a longer
 * final word also matches as a prefix, so "analy" covers "analyst" and "analysis". Vietnamese single syllables are
 * ambiguous ("hop" is both meeting and contract), so a lexicon should use two-syllable phrases.
 */

/** Lowercase and without diacritics, so "Nghiên cứu" and "nghien cuu" are the same text. */
export const normalizeRoleText = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase();

/** The words of a name, description or instruction block, normalized for matching. */
export const roleWords = (text: string): string[] =>
  (text.match(/[\p{L}\p{N}]+/gu) ?? []).map(normalizeRoleText);

// Splitting a keyword is the same work every time it is matched, so each one is split once.
const keywordParts = new Map<string, string[]>();
const partsOf = (keyword: string) => {
  const cached = keywordParts.get(keyword);
  if (cached) return cached;
  const parts = keyword.split(' ');
  keywordParts.set(keyword, parts);
  return parts;
};

/** Whether `words` contains `keyword`, by the rules at the top of this file. */
export function containsKeyword(words: readonly string[], keyword: string): boolean {
  const parts = partsOf(keyword);
  for (let start = 0; start + parts.length <= words.length; start++) {
    const matches = parts.every((part, index) => {
      const word = words[start + index];
      const isFinalPart = index === parts.length - 1;
      return isFinalPart && part.length >= 4 ? word.startsWith(part) : word === part;
    });
    if (matches) return true;
  }
  return false;
}
