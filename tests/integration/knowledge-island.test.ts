import { expect, it } from 'vitest';
import { knowledgeSuggestionKey, showsKnowledgeIsland } from '../../apps/desktop/src/shared/knowledge-island';

it('keys a set of suggestions the same whichever order they arrive in', () => {
  expect(knowledgeSuggestionKey(['b', 'a'])).toBe(knowledgeSuggestionKey(['a', 'b']));
  expect(knowledgeSuggestionKey(['a'])).not.toBe(knowledgeSuggestionKey(['a', 'b']));
  expect(knowledgeSuggestionKey([])).toBe('');
});

it('offers the suggestions once no run is live', () => {
  expect(showsKnowledgeIsland({ runLive: false, suggestionIds: ['a', 'b'] })).toBe(true);
});

it('gives the island to a live run', () => {
  expect(showsKnowledgeIsland({ runLive: true, suggestionIds: ['a', 'b'] })).toBe(false);
});

it('stays hidden after the same set was dismissed', () => {
  const dismissedKey = knowledgeSuggestionKey(['b', 'a']);
  expect(showsKnowledgeIsland({ runLive: false, suggestionIds: ['a', 'b'], dismissedKey })).toBe(false);
});

it('comes back when a new suggestion joins a dismissed set', () => {
  const dismissedKey = knowledgeSuggestionKey(['a', 'b']);
  expect(showsKnowledgeIsland({ runLive: false, suggestionIds: ['a', 'b', 'c'], dismissedKey })).toBe(true);
});

it('shows nothing when no suggestion remains', () => {
  expect(showsKnowledgeIsland({ runLive: false, suggestionIds: [] })).toBe(false);
  expect(showsKnowledgeIsland({ runLive: false, suggestionIds: [], dismissedKey: knowledgeSuggestionKey(['a']) })).toBe(false);
});
