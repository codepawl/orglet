import { expect, it } from 'vitest';
import { replyCountLabel } from '../../apps/desktop/src/renderer/components/DetailsPanel';
import { OPEN_POPUP_SELECTOR } from '../../apps/desktop/src/renderer/components/ui';

it('counts one reply in the singular', () => {
  expect(replyCountLabel(1)).toBe('1 reply');
  expect(replyCountLabel(3)).toBe('3 replies');
  expect(replyCountLabel(0)).toBe('0 replies');
});

it('lets Escape close a dialog from a disclosure, and only holds it for a real popup', () => {
  const parts = OPEN_POPUP_SELECTOR.split(',').map(part => part.trim());
  // A bare aria-expanded matched the avatar's Customize disclosure, and Escape then did nothing at all.
  expect(parts).not.toContain('[aria-expanded="true"]');
  expect(parts).toEqual(['[aria-haspopup][aria-expanded="true"]', '[role="combobox"][aria-expanded="true"]', '[data-popup-open]']);
});
