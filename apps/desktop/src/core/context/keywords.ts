import { STOP_WORDS } from './stop-words';

/** The words of three letters or more in `text`, lower case and NFC, so decomposed Vietnamese matches too. */
export function keywordsOf(text: string): Set<string> {
  return new Set(text.normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
}

/** `keywordsOf` without stop words such as "the" or "của", which say nothing about what a text is about (COD-307). */
export function meaningfulKeywordsOf(text: string): Set<string> {
  return new Set([...keywordsOf(text)].filter(word => !STOP_WORDS.has(word)));
}

/**
 * How well each document matches `query`: every shared word adds more the fewer documents contain it, so a rare word
 * points at its document and a word most of them use barely tells them apart (COD-307). A document that shares no
 * word scores 0.
 */
export function rarityScores(query: ReadonlySet<string>, documents: readonly ReadonlySet<string>[]): number[] {
  const documentsWithWord = new Map<string, number>();
  for (const document of documents) {
    for (const word of document) documentsWithWord.set(word, (documentsWithWord.get(word) ?? 0) + 1);
  }
  return documents.map(document => {
    let score = 0;
    for (const word of document) {
      if (query.has(word)) score += Math.log(1 + documents.length / documentsWithWord.get(word)!);
    }
    return score;
  });
}
