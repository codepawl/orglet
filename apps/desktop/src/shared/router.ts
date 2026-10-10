import { z } from 'zod';

/**
 * The CodePawl AI router connection (issue 532, docs/ai-router-design.md). The router is its own product; Orglet
 * reaches it with a key that main asks the router for after the person signs in to their CodePawl account. This file
 * holds what main, the core and the window share: where the router is, what the window may learn about the
 * connection, and the shape of its usage. The key has no field here.
 */

/** The audience and scope an access token needs for the router's key routes (the router's `ROUTER_AUDIENCE`). */
export const ACCOUNT_ROUTER_RESOURCE = 'https://router.codepawl.com';
export const ACCOUNT_ROUTER_SCOPE = 'router:manage';

/** The router's chat and model routes live under this path of its address. */
const ROUTER_API_PATH = '/v1';

/**
 * The router's address. `ORGLET_ROUTER_URL` names it, or `off` for none. There is no default: the router is not
 * deployed, so a build that names no address has no router connection anywhere. Only https is accepted, except a
 * router on this computer during development.
 */
export function routerBaseUrl(override: string | undefined): string | undefined {
  if (!override || override === 'off') return undefined;
  try {
    const url = new URL(override);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) return url.origin;
  } catch {
    // Not an address: no router.
  }
  return undefined;
}

/** The address the chat adapter and the model list talk to, or nothing while the router is not configured. */
export function routerApiUrl(override: string | undefined): string | undefined {
  const base = routerBaseUrl(override);
  return base ? `${base}${ROUTER_API_PATH}` : undefined;
}

/** A router key: `cpr_`, the account reference, a separator and the secret (docs of the router, "Authentication"). */
export const ROUTER_KEY_PATTERN = /^cpr_[A-Za-z0-9_\-]{16,500}$/;

/**
 * `off`: this build names no router, so nothing about it is shown. `signed_out`: there is a router, but no account to
 * ask it for a key. `ready`: signed in, no key yet. `connected`: a key is saved. `not_open`: the account service does
 * not know the router yet, so no key can be made. `sign_in_again`: the saved sign-in did not ask for the router (it was
 * made by a build without one), and only a new sign-in can.
 */
export const CodepawlStatus = z.enum(['off', 'signed_out', 'ready', 'connected', 'not_open', 'sign_in_again']);
export type CodepawlStatus = z.infer<typeof CodepawlStatus>;

/** Everything the window learns about the connection. Strict, so a key can never ride along. */
export const CodepawlState = z.object({
  status: CodepawlStatus,
  /** The name the key was made under, so the person knows which computer it is. */
  deviceName: z.string().max(80).optional(),
}).strict();
export type CodepawlState = z.infer<typeof CodepawlState>;

const Count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** What `GET /v1/usage` says, as the router sends it. Fields the connection does not use are ignored. */
export const RouterUsageAnswer = z.object({
  free: z.object({ tokensLeft: Count, tokensLimit: Count, resetsAt: z.string().max(40) }),
  starter: z.object({ leftMicros: Count, periodEnd: z.string().max(40) }).nullable().optional(),
});

/**
 * Usage as the window sees it. `known: false` means the router could not be asked, and then no number is present: an
 * unknown amount is never shown as zero. `includedLeftMicros` is absent for an account without a plan.
 */
export const CodepawlUsage = z.object({
  known: z.boolean(),
  freeTokensLeft: Count.optional(),
  freeTokensLimit: Count.optional(),
  freeResetsAt: z.string().max(40).optional(),
  includedLeftMicros: Count.optional(),
  includedPeriodEnd: z.string().max(40).optional(),
}).strict();
export type CodepawlUsage = z.infer<typeof CodepawlUsage>;

export const UNKNOWN_CODEPAWL_USAGE: CodepawlUsage = { known: false };

export const ROUTER_NOT_OPEN = 'CodePawl router chưa mở. Thử lại sau.';
export const ROUTER_SIGN_IN_AGAIN = 'Đăng nhập lại tài khoản CodePawl để dùng CodePawl router.';
export const ROUTER_UNREACHABLE = 'Không kết nối được CodePawl router. Kiểm tra mạng rồi thử lại.';
export const ROUTER_TOO_MANY_KEYS = 'Tài khoản đã có đủ số key của CodePawl router. Thu hồi bớt một key rồi thử lại.';
