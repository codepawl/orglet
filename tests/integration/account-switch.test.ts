import { describe, expect, it } from 'vitest';
import { accountSwitchFor } from '../../apps/desktop/src/shared/account-switch';
import { SYSTEM_ACCOUNT_ID, type HarnessAccountUsage } from '../../apps/desktop/src/shared/harness';

const checkedAt = '2026-09-24T12:00:00.000Z';
const row = (accountId: string, usedPercent: number, extra: Partial<HarnessAccountUsage> = {}): HarnessAccountUsage =>
  ({ accountId, checkedAt, windows: [{ kind: 'session', usedPercent, resetsAt: '2026-09-24T14:00:00.000Z' }, { kind: 'weekly', usedPercent: usedPercent / 2 }], ...extra });
const harness = { accountId: SYSTEM_ACCOUNT_ID, accounts: [{ id: 'work', label: 'Work' }, { id: 'spare', label: 'Spare' }] };

describe('the account the island offers when one ran out (COD-225)', () => {
  it('offers the other account with the most room', () => {
    expect(accountSwitchFor(harness, [row(SYSTEM_ACCOUNT_ID, 100), row('work', 60), row('spare', 12)])).toEqual({ kind: 'switch', accountId: 'spare', usedPercent: 12 });
  });

  it('never offers the account in use, a full one, or one it could not read', () => {
    const rows = [
      row(SYSTEM_ACCOUNT_ID, 100),
      row('work', 100),
      { accountId: 'spare', checkedAt, windows: [], unavailable: 'expired' as const },
    ];
    expect(accountSwitchFor(harness, rows)).toEqual({ kind: 'wait', resetsAt: '2026-09-24T14:00:00.000Z' });
    expect(accountSwitchFor({ ...harness, accountId: 'work' }, [row(SYSTEM_ACCOUNT_ID, 5), row('work', 100)])).toEqual({ kind: 'switch', accountId: SYSTEM_ACCOUNT_ID, usedPercent: 5 });
  });

  it('ignores a row for an account that was removed, and waits without a time when nothing was read', () => {
    expect(accountSwitchFor(harness, [row(SYSTEM_ACCOUNT_ID, 100), row('removed', 1)])).toEqual({ kind: 'wait', resetsAt: '2026-09-24T14:00:00.000Z' });
    expect(accountSwitchFor(harness, undefined)).toEqual({ kind: 'wait' });
  });
});
