import { z } from 'zod';
import type { HarnessAccountUsage, HarnessCatalogId } from '../../shared/harness';
import type { Store } from '../storage/database';

const SETTING = 'harnessUsageReadings';

const StoredWindow = z.object({
  kind: z.enum(['session', 'daily', 'weekly', 'monthly']),
  model: z.string().optional(),
  usedPercent: z.number().min(0).max(100),
  resetsAt: z.string().optional(),
}).strict();

const StoredResets = z.object({
  count: z.number().int().min(1).max(1000),
  expiresAt: z.string().optional(),
}).strict();

/** What the vendor last reported for one account: who, which plan, the windows, banked resets and when. Never a token. */
const StoredReading = z.object({
  email: z.string().optional(),
  plan: z.string().optional(),
  windows: z.array(StoredWindow).max(20),
  bankedResets: StoredResets.optional(),
  checkedAt: z.string(),
}).strict();
type StoredReading = z.infer<typeof StoredReading>;

/**
 * The last good plan-usage reading of each harness account, kept in the settings table (COD-301). Claude Code renews
 * its saved sign-in only when it runs, and Orglet never renews it (a rotated refresh token would sign the person out
 * of Claude Code), so between runs the stored token is often expired while the person is signed in and working. Such a
 * read then shows the last numbers the vendor gave, with when, instead of looking like a sign-in problem.
 */
export class UsageReadings {
  constructor(private store: Store) {}

  /**
   * One account's read, settled against the stored reading: a fresh read replaces it; an expired or failed one takes
   * its windows with `asOf`; signed out or a sign-in with no plan allowance forgets it, since whoever signs in next
   * may be someone else. A stored window whose reset has passed is dropped: its percentage no longer says anything, and
   * so are banked resets past their end. The stored count is shown, never spent: a claim reads Claude again first.
   */
  settle(harness: HarnessCatalogId, row: HarnessAccountUsage, now: Date): HarnessAccountUsage {
    if (!row.unavailable) {
      if (row.windows.length) this.remember(harness, row);
      return row;
    }
    if (row.unavailable === 'signed_out' || row.unavailable === 'unsupported') {
      this.forget(harness, row.accountId);
      return row;
    }
    const stored = this.all()[readingKey(harness, row.accountId)];
    if (!stored) return row;
    // The saved sign-in now names another address: the old numbers belong to someone else.
    if (row.email && stored.email && row.email !== stored.email) return row;
    const windows = stored.windows.filter(window => !window.resetsAt || Date.parse(window.resetsAt) > now.getTime());
    if (!windows.length) return row;
    const email = row.email ?? stored.email;
    const plan = row.plan ?? stored.plan;
    const resets = stored.bankedResets;
    const bankedResets = resets && (!resets.expiresAt || Date.parse(resets.expiresAt) > now.getTime()) ? resets : undefined;
    return { ...row, ...(email ? { email } : {}), ...(plan ? { plan } : {}), windows, ...(bankedResets ? { bankedResets } : {}), asOf: stored.checkedAt };
  }

  /** Drops an account's reading, for an account that was removed. */
  forget(harness: HarnessCatalogId, accountId: string) {
    const readings = this.all();
    const key = readingKey(harness, accountId);
    if (!(key in readings)) return;
    delete readings[key];
    this.store.setSetting(SETTING, readings);
  }

  private remember(harness: HarnessCatalogId, row: HarnessAccountUsage) {
    const reading: StoredReading = {
      ...(row.email ? { email: row.email } : {}),
      ...(row.plan ? { plan: row.plan } : {}),
      windows: row.windows.map(window => ({ ...window })),
      ...(row.bankedResets ? { bankedResets: { ...row.bankedResets } } : {}),
      checkedAt: row.checkedAt,
    };
    const parsed = StoredReading.safeParse(reading);
    if (!parsed.success) return;
    this.store.setSetting(SETTING, { ...this.all(), [readingKey(harness, row.accountId)]: parsed.data });
  }

  /** Every stored reading that still parses; one that does not is left out rather than trusted. */
  private all(): Record<string, StoredReading> {
    const stored = this.store.setting<Record<string, unknown>>(SETTING, {});
    const readings: Record<string, StoredReading> = {};
    for (const [key, value] of Object.entries(stored ?? {})) {
      const parsed = StoredReading.safeParse(value);
      if (parsed.success) readings[key] = parsed.data;
    }
    return readings;
  }
}

const readingKey = (harness: HarnessCatalogId, accountId: string) => `${harness}:${accountId}`;
