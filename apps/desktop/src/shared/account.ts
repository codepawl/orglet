import { z } from 'zod';

/**
 * The optional CodePawl account (COD-337, phase 1 of COD-329). Main signs in through the system browser with OAuth 2.1
 * and PKCE, keeps the refresh token encrypted and the access token in memory, and tells the window only what this file
 * describes: whether someone is signed in, who, and on which plan. No token ever has a field here.
 */

/** The address of the identity service when `ORGLET_ACCOUNTS_URL` does not name another one. */
export const DEFAULT_ACCOUNTS_URL = 'https://accounts.codepawl.com';

/**
 * The browser comes back to the app through this private-use scheme, the reverse of Orglet's bundle id, as RFC 8252
 * asks of a native app. It is registered next to `orglet://` links and carries only a sign-in's code and state.
 */
export const ACCOUNT_SCHEME = 'com.codepawl.orglet';
export const ACCOUNT_REDIRECT_URI = `${ACCOUNT_SCHEME}:/auth/callback`;
export const ACCOUNT_CLIENT_ID = 'orglet-desktop';
export const ACCOUNT_SCOPES = 'openid profile email offline_access';
/** The API the access token is for: the sync server, which comes in a later phase. */
export const ACCOUNT_RESOURCE = 'https://sync.orglet.codepawl.com';
export const ACCOUNT_MARKET_RESOURCE = 'https://market.orglet.codepawl.com';
export const AccountResource = z.enum([ACCOUNT_RESOURCE, ACCOUNT_MARKET_RESOURCE]);
export type AccountResource = z.infer<typeof AccountResource>;

/** Where each OAuth step lives under a base address such as `https://accounts.codepawl.com`. */
export function accountEndpoints(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, '');
  const issuer = `${base}/api/auth`;
  return {
    issuer,
    authorize: `${issuer}/oauth2/authorize`,
    token: `${issuer}/oauth2/token`,
    revoke: `${issuer}/oauth2/revoke`,
    jwks: `${issuer}/jwks`,
    me: `${base}/me`,
  };
}

/**
 * The base address to sign in at. Only https is accepted, except for a service on this computer during development
 * (`http://localhost:8787`); anything else falls back to the real service.
 */
export function accountsBaseUrl(override: string | undefined): string {
  if (!override) return DEFAULT_ACCOUNTS_URL;
  try {
    const url = new URL(override);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) return url.origin;
  } catch {
    // Not an address: use the real service.
  }
  return DEFAULT_ACCOUNTS_URL;
}

/** Limits and extras the account's plan allows; always read from here and never from the plan's name. */
const EntitlementValue = z.union([z.number(), z.boolean(), z.string().max(200), z.null()]);
export const AccountEntitlements = z.record(z.string().max(64), EntitlementValue);
export type AccountEntitlements = z.infer<typeof AccountEntitlements>;

/**
 * `local`: no account on this computer. `signing_in`: the browser is open. `signed_in`: an account is on this
 * computer. `expired`: it was, but the service no longer accepts its sign-in, so the person signs in again; nothing
 * local is lost either way.
 */
export const AccountStatus = z.enum(['local', 'signing_in', 'signed_in', 'expired']);
export type AccountStatus = z.infer<typeof AccountStatus>;

/** Everything the window learns about the account. Strict, so a token can never ride along. */
export const AccountState = z.object({
  status: AccountStatus,
  email: z.string().max(320).optional(),
  name: z.string().max(200).optional(),
  plan: z.string().max(64).optional(),
  entitlements: AccountEntitlements.optional(),
}).strict();
export type AccountState = z.infer<typeof AccountState>;

/** What `GET /me` answers. Unknown fields are ignored; entitlements keep only plain values. */
export const AccountProfile = z.object({
  id: z.string().min(1).max(200),
  email: z.string().max(320),
  name: z.string().max(200).nullish().transform(value => value ?? undefined),
  emailVerified: z.boolean().optional(),
  plan: z.string().min(1).max(64).catch('free').default('free'),
  entitlements: z.record(z.string(), z.unknown()).catch({}).default({}).transform(plainEntitlements),
});
export type AccountProfile = z.infer<typeof AccountProfile>;

function plainEntitlements(raw: Record<string, unknown>): AccountEntitlements {
  const plain: AccountEntitlements = {};
  for (const [key, value] of Object.entries(raw).slice(0, 64)) {
    const parsed = EntitlementValue.safeParse(value);
    if (parsed.success && key.length <= 64) plain[key] = parsed.data;
  }
  return plain;
}

/** How someone started using Orglet: with an account, or without one. */
export const AccountChoice = z.enum(['account', 'local']);
export type AccountChoice = z.infer<typeof AccountChoice>;

/** The first-run choice as the settings keep it; `choice` is null only on a new install that has not answered yet. */
export const AccountChoiceRecord = z.object({ choice: AccountChoice.nullable(), asked: z.boolean() }).strict();
export type AccountChoiceRecord = z.infer<typeof AccountChoiceRecord>;

/** A new database starts undecided, so the first-run screen asks. */
export const NEW_INSTALL_CHOICE: AccountChoiceRecord = { choice: null, asked: false };
/** An install from before the account has no record: it stays local and is never asked after an update. */
export const EXISTING_INSTALL_CHOICE: AccountChoiceRecord = { choice: 'local', asked: false };

/** What the first-run question looks at: only whether anything beyond the seeded Researcher exists yet. */
export type FirstRunWorkspace = {
  accountChoice: AccountChoiceRecord;
  workers: readonly unknown[];
  teams: readonly unknown[];
  tasks: readonly unknown[];
  routines: readonly unknown[];
  knowledge: readonly unknown[];
  archivedWorkers: readonly unknown[];
  archivedTeams: readonly unknown[];
};

/**
 * Whether to show the first-run screen: only on a new install that has not answered, and only while it holds nothing
 * but the Researcher it starts with. Someone updating from an older build, or who already has chats, is never asked.
 */
export function needsAccountChoice(workspace: FirstRunWorkspace, account: AccountState | undefined): boolean {
  const record = workspace.accountChoice;
  if (record.asked || record.choice !== null) return false;
  if (account?.status === 'signed_in' || account?.status === 'expired') return false;
  const onlySeed = workspace.workers.length <= 1 && !workspace.teams.length && !workspace.tasks.length && !workspace.routines.length
    && !workspace.knowledge.length && !workspace.archivedWorkers.length && !workspace.archivedTeams.length;
  return onlySeed;
}
