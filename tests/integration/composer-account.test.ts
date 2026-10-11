import { describe, expect, it } from 'vitest';
import { composerAccountChoices } from '../../apps/desktop/src/renderer/composerAccount';
import { SYSTEM_ACCOUNT_ID } from '../../apps/desktop/src/shared/harness';

// The account chip on the prompt bar: the same accounts Settings lists for the chat's harness.
describe('the accounts the prompt bar offers', () => {
  const account = (id: string, label: string) => ({ id, label, configDir: `/accounts/${id}`, createdAt: '2026-10-11T00:00:00.000Z' });

  it('offers nothing when no account was added, or the chat has no harness', () => {
    expect(composerAccountChoices(undefined)).toEqual([]);
    expect(composerAccountChoices({ accounts: [] })).toEqual([]);
  });

  it('lists the CLI\'s own sign-in first, then the added accounts in the order Settings has them', () => {
    const choices = composerAccountChoices({ accounts: [account('work', 'Work'), account('home', 'Home')] as never });
    expect(choices).toEqual([{ id: SYSTEM_ACCOUNT_ID }, { id: 'work', label: 'Work' }, { id: 'home', label: 'Home' }]);
  });
});
