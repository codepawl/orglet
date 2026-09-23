/**
 * Whether the island on the prompt bar offers the chat's knowledge suggestions (COD-208). After a turn, the notes a
 * worker proposed wait in Thư viện → Knowledge; the island says how many and offers to open them, the way it says
 * what a run is doing. A live run always takes the island, and the offer comes back once the run is over. Dismissing
 * the offer hides it for that set of suggestions only: a new suggestion is a new set and brings it back, and
 * approving or archiving every suggestion leaves nothing to offer. Pure, so the choice is tested without a DOM.
 */

/** The set of suggestions as one key: the same ids give the same key whichever order they arrive in. */
export function knowledgeSuggestionKey(suggestionIds: readonly string[]): string {
  return [...suggestionIds].sort().join(',');
}

export function showsKnowledgeIsland({ runLive, suggestionIds, dismissedKey }: {
  /** A run of this chat is working: its island wins, whatever waits for review. */
  runLive: boolean;
  /** The suggestions of this chat still waiting for review. */
  suggestionIds: readonly string[];
  /** The set the user dismissed last, as `knowledgeSuggestionKey` gives it. */
  dismissedKey?: string;
}): boolean {
  if (runLive) return false;
  if (suggestionIds.length === 0) return false;
  return knowledgeSuggestionKey(suggestionIds) !== dismissedKey;
}
