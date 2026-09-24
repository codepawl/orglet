import { SYSTEM_ACCOUNT_ID, tightestWindow, type HarnessAccountUsage, type HarnessInfo } from './harness';

/**
 * What the island offers when a harness account ran out of plan usage (COD-225): the account with the most room to
 * switch to, or, when no other account has any, when the one in use resets. Pure, so the choice is tested without a DOM.
 */
export type AccountSwitch =
  | { kind: 'switch'; accountId: string; usedPercent: number }
  | { kind: 'wait'; resetsAt?: string };

/**
 * An account is a candidate when the vendor read it this time and its tightest allowance is under its limit. One
 * that is signed out, expired, unread or reports no usage at all is not offered: room it may not have is no offer.
 */
export function accountSwitchFor(harness: Pick<HarnessInfo, 'accountId' | 'accounts'>, usage: readonly HarnessAccountUsage[] | undefined): AccountSwitch {
  const rows = usage ?? [];
  const known = new Set([SYSTEM_ACCOUNT_ID, ...harness.accounts.map(account => account.id)]);
  let best: { accountId: string; usedPercent: number } | undefined;
  for (const row of rows) {
    if (row.accountId === harness.accountId || !known.has(row.accountId) || row.unavailable) continue;
    const tightest = tightestWindow(row);
    if (!tightest || tightest.usedPercent >= 100) continue;
    if (!best || tightest.usedPercent < best.usedPercent) best = { accountId: row.accountId, usedPercent: tightest.usedPercent };
  }
  if (best) return { kind: 'switch', ...best };
  const current = rows.find(row => row.accountId === harness.accountId);
  const resetsAt = current ? tightestWindow(current)?.resetsAt : undefined;
  return resetsAt ? { kind: 'wait', resetsAt } : { kind: 'wait' };
}
