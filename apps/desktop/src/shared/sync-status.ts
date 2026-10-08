import { z } from 'zod';

/**
 * What the window learns about account sync (COD-329 phase 3). Strict, like `AccountState`: no token, account id,
 * device id or server address has a field here.
 *
 * `off`: no account, an expired sign-in, or a build with no sync server configured. `link_required`: signed in, but
 * this computer holds data that was never joined to the account, so the person decides. `syncing`: catching up.
 * `synced`: nothing waiting. `offline`: the server could not be reached and a retry is scheduled. `paused`: sync
 * stopped for the reason given; local editing goes on.
 */
export const SyncPauseReason = z.enum([
  'update_required', 'storage_limit', 'device_limit', 'device_released', 'account_deleted', 'server_unavailable', 'rejected',
]);
export type SyncPauseReason = z.infer<typeof SyncPauseReason>;

export const SyncStatus = z.object({
  state: z.enum(['off', 'link_required', 'syncing', 'synced', 'offline', 'paused']),
  reason: SyncPauseReason.optional(),
  /** With `link_required`: this sign-in was made before sync existed, so the person is asked once whether to sync what is here. */
  askedBecauseNew: z.literal(true).optional(),
  lastSyncedAt: z.iso.datetime().optional(),
  /** Changes too large for the server; they stay on this computer. */
  skipped: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  /** Chats that stay on this computer because an orglet in them was deleted, which is permanent for the account. */
  withheld: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();
export type SyncStatus = z.infer<typeof SyncStatus>;

/** CodePawl's sync service, checked end to end with two computers on 2026-10-08. */
export const DEFAULT_SYNC_URL = 'https://sync.orglet.codepawl.com';

/**
 * The sync server's address. `ORGLET_SYNC_URL` names another one, or `off` for none. Without it, a build signed in to
 * CodePawl's own accounts service syncs with CodePawl's service; one pointed at another accounts service
 * (`ORGLET_ACCOUNTS_URL`, as tests and development do) has no sync unless it names a server too, so its tokens never
 * reach the real service. Only https is accepted, except a server on this computer.
 */
export function syncBaseUrl(override: string | undefined, accountsOverride?: string): string | undefined {
  if (override === 'off') return undefined;
  if (!override) return accountsOverride ? undefined : DEFAULT_SYNC_URL;
  try {
    const url = new URL(override);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) return url.origin;
  } catch {
    // Not an address: no sync.
  }
  return undefined;
}

/**
 * How a computer that already holds data joins the account (GH-484). `merge` sends what is here and brings what the
 * account has. `replace` erases this computer's workspace, after saving a copy beside the database, and brings only
 * what the account has; it never deletes anything from the account.
 */
export const SyncChoice = z.enum(['merge', 'replace']);
export type SyncChoice = z.infer<typeof SyncChoice>;

const Count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const SyncCounts = z.object({ orglets: Count, chats: Count }).strict();
/** What the person sees before choosing: how much is on each side. Counts only, never names or text. */
export const SyncPreview = z.object({
  local: SyncCounts,
  account: SyncCounts,
  /** Orglets and chats marked "Only on this computer": a merge leaves them here, a replace erases them too. */
  localOnly: Count,
}).strict();
export type SyncPreview = z.infer<typeof SyncPreview>;
