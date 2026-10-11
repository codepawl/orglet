import { SYSTEM_ACCOUNT_ID, type HarnessInfo } from '../shared/harness';

export type ComposerAccountChoice = {
  id: string;
  /** The name the person gave the account; none for the CLI's own sign-in, which the window names itself. */
  label?: string;
};

/**
 * The accounts the prompt bar offers for the harness behind a chat: the CLI's own sign-in first, then the added ones,
 * oldest first as Settings lists them. Nothing when no account was added, because there is then nothing to switch to.
 */
export function composerAccountChoices(harness: Pick<HarnessInfo, 'accounts'> | undefined): ComposerAccountChoice[] {
  if (!harness || harness.accounts.length === 0) return [];
  return [{ id: SYSTEM_ACCOUNT_ID }, ...harness.accounts.map(account => ({ id: account.id, label: account.label }))];
}
