import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { AccountState } from '../shared/account';
import {
  ACCOUNT_ROUTER_RESOURCE,
  CodepawlUsage,
  RouterUsageAnswer,
  ROUTER_KEY_PATTERN,
  ROUTER_TOO_MANY_KEYS,
  ROUTER_UNREACHABLE,
  UNKNOWN_CODEPAWL_USAGE,
  isBillingPage,
  type CodepawlBillingOutcome,
  type CodepawlBillingRequest,
  type CodepawlState,
} from '../shared/router';
import { ResourceRefused, RouterSignInRequired } from './account';

/**
 * The CodePawl router connection (issue 532). The person never pastes a key: with the CodePawl account signed in, main
 * asks the accounts service for an access token for the router, asks the router for one key named after this computer,
 * and keeps that key encrypted like every other API key. The window hears `CodepawlState` and `CodepawlUsage`, never
 * the key. Nothing here imports Electron, so the tests drive it against a fake router and a fake token source.
 */

const REQUEST_TIMEOUT_MS = 15_000;
const KEY_NAME_LIMIT = 80;

/** The router key, encrypted on disk by the credential store (`codepawl.credential`). */
export type RouterKeyStore = {
  read(): Promise<string | null>;
  save(key: string): Promise<void>;
  remove(): Promise<void>;
};

/** The id the router gave the key, which is not a secret, so a later revoke can name it. */
export type RouterKeyIdStore = {
  read(): Promise<string | undefined>;
  save(id: string): Promise<void>;
  remove(): Promise<void>;
};

const KEY_ID_PATTERN = /^[A-Za-z0-9_\-]{1,200}$/;

/** One small plain file beside the credentials; it holds an identifier only and never the key. */
export class RouterKeyIdFile implements RouterKeyIdStore {
  private path: string;
  constructor(directory: string) {
    this.path = join(directory, 'codepawl-key-id.txt');
  }

  async read(): Promise<string | undefined> {
    try {
      const text = (await readFile(this.path, 'utf8')).trim();
      return KEY_ID_PATTERN.test(text) ? text : undefined;
    } catch {
      return undefined;
    }
  }

  async save(id: string): Promise<void> {
    await writeFile(this.path, id, { mode: 0o600 });
  }

  async remove(): Promise<void> {
    await unlink(this.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

const BillingPage = z.object({ url: z.string().max(2_000) });
const RouterRefusal = z.object({ error: z.object({ code: z.string().max(80) }) });

const CreatedKey = z.object({
  id: z.string().regex(KEY_ID_PATTERN),
  secret: z.string().regex(ROUTER_KEY_PATTERN),
});

type RouterAccount = {
  state(): AccountState;
  /** Whether the saved sign-in asked for the router; if not, a token for it cannot be had until the person signs in again. */
  signInCoversRouter(): boolean;
  getAccessToken(resource: typeof ACCOUNT_ROUTER_RESOURCE): Promise<string>;
};

export type RouterConnectionDependencies = {
  /** The router's address (an origin), or nothing when this build names none. */
  baseUrl: string | undefined;
  account: RouterAccount;
  keys: RouterKeyStore;
  keyIds: RouterKeyIdStore;
  /** The name the key is made under, so the person can tell this computer's key from another's on the router. */
  deviceName: string;
  fetch?: typeof fetch;
  /** The saved connection changed: the model list the core holds for it is no longer right. */
  onChange?: () => void;
  /** Opens a billing page in the person's browser. Without it no page is asked for. */
  openExternal?: (address: string) => Promise<void>;
};

export class RouterConnection {
  private fetcher: typeof fetch;
  private connecting: Promise<CodepawlState> | undefined;
  /** The account service refused to issue a router token on the last try; it is tried again on the next Connect. */
  private notOpen = false;

  constructor(private dependencies: RouterConnectionDependencies) {
    this.fetcher = dependencies.fetch ?? fetch;
  }

  /** Whether this build has a router at all. Everything else answers `off` or does nothing without one. */
  get configured(): boolean {
    return this.dependencies.baseUrl !== undefined;
  }

  async state(): Promise<CodepawlState> {
    if (!this.configured) return { status: 'off' };
    const deviceName = this.dependencies.deviceName;
    if (await this.dependencies.keys.read()) return { status: 'connected', deviceName };
    if (this.dependencies.account.state().status !== 'signed_in') return { status: 'signed_out' };
    if (!this.dependencies.account.signInCoversRouter()) return { status: 'sign_in_again' };
    return { status: this.notOpen ? 'not_open' : 'ready' };
  }

  /** Makes the key once. A second call while a key is saved, or while the first is still running, makes none. */
  connect(): Promise<CodepawlState> {
    if (!this.connecting) {
      this.connecting = this.makeKey().finally(() => {
        this.connecting = undefined;
      });
    }
    return this.connecting;
  }

  private async makeKey(): Promise<CodepawlState> {
    if (!this.configured) return { status: 'off' };
    if (await this.dependencies.keys.read()) return this.state();
    if (this.dependencies.account.state().status !== 'signed_in') return { status: 'signed_out' };
    const token = await this.routerToken();
    if (token === 'sign_in_again') return { status: 'sign_in_again' };
    if (token === 'not_open') {
      this.notOpen = true;
      return { status: 'not_open' };
    }
    this.notOpen = false;
    const created = await this.requestKey(token);
    await this.keepKey(created);
    this.dependencies.onChange?.();
    return this.state();
  }

  /** Asks for the key's name and reads back its secret, which is in this one answer only. */
  private async requestKey(token: string): Promise<z.infer<typeof CreatedKey>> {
    const response = await this.send('/v1/keys', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ name: this.dependencies.deviceName }),
    });
    if (response.status === 409) throw new Error(ROUTER_TOO_MANY_KEYS);
    if (!response.ok) throw new Error(ROUTER_UNREACHABLE);
    const parsed = CreatedKey.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new Error(ROUTER_UNREACHABLE);
    return parsed.data;
  }

  /** The id is saved first; if the key cannot be saved the router is asked to drop it again, so none is left behind. */
  private async keepKey(created: z.infer<typeof CreatedKey>): Promise<void> {
    try {
      await this.dependencies.keyIds.save(created.id);
      await this.dependencies.keys.save(created.secret);
    } catch (failure) {
      await this.dependencies.keys.remove().catch(() => undefined);
      await this.dependencies.keyIds.remove().catch(() => undefined);
      await this.revokeAtRouter(created.id);
      throw failure;
    }
  }

  /** Forgets the key on this computer, then asks the router to revoke it. The router being unreachable changes nothing here. */
  async disconnect(): Promise<CodepawlState> {
    // Forgetting works without a router too, so a key an earlier build left can still be removed.
    const keyId = await this.dependencies.keyIds.read();
    await this.dependencies.keys.remove();
    await this.dependencies.keyIds.remove();
    this.notOpen = false;
    this.dependencies.onChange?.();
    if (keyId && this.configured) await this.revokeAtRouter(keyId);
    return this.state();
  }

  /**
   * Called before the account signs out, while the sign-in can still ask for a token: the key is revoked and forgotten.
   * It never throws, so a router that is down cannot keep the person signed in.
   */
  async revokeBeforeSignOut(): Promise<void> {
    try {
      await this.disconnect();
    } catch {
      // The sign-out goes on; the key was forgotten first or is still only on this computer.
    }
  }

  /** Free tokens left today and included usage left this period. An answer that cannot be had is unknown, never zero. */
  async usage(): Promise<CodepawlUsage> {
    if (!this.configured || this.dependencies.account.state().status !== 'signed_in') return UNKNOWN_CODEPAWL_USAGE;
    try {
      const token = await this.routerToken();
      if (token === 'not_open' || token === 'sign_in_again') return UNKNOWN_CODEPAWL_USAGE;
      const response = await this.send('/v1/usage', { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
      if (!response.ok) return UNKNOWN_CODEPAWL_USAGE;
      const parsed = RouterUsageAnswer.safeParse(await response.json().catch(() => undefined));
      if (!parsed.success) return UNKNOWN_CODEPAWL_USAGE;
      const { free, starter, payByUse } = parsed.data;
      return {
        known: true,
        freeTokensLeft: free.tokensLeft,
        freeTokensLimit: free.tokensLimit,
        freeResetsAt: free.resetsAt,
        ...(starter ? { includedLeftMicros: starter.leftMicros, includedPeriodEnd: starter.periodEnd } : {}),
        ...(payByUse ? { payByUseActive: payByUse.active, payByUseCostMicros: payByUse.costThisMonthMicros } : {}),
      };
    } catch {
      return UNKNOWN_CODEPAWL_USAGE;
    }
  }

  /**
   * Asks the router for a checkout page or the page where a plan is managed, and opens it in the browser. The page is
   * the payment provider's: Orglet never sees a card, and an address anywhere else is not opened.
   */
  async billing(request: CodepawlBillingRequest): Promise<CodepawlBillingOutcome> {
    const openExternal = this.dependencies.openExternal;
    if (!this.configured || !openExternal || this.dependencies.account.state().status !== 'signed_in') return 'unavailable';
    const token = await this.routerToken();
    if (token === 'not_open' || token === 'sign_in_again') return 'unavailable';
    const checkout = request.kind === 'checkout';
    const response = await this.send(checkout ? '/v1/billing/checkout' : '/v1/billing/portal', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(checkout ? { plan: request.plan } : {}),
    });
    const answer: unknown = await response.json().catch(() => undefined);
    if (!response.ok) return billingRefusal(answer);
    const page = BillingPage.safeParse(answer);
    if (!page.success || !isBillingPage(page.data.url)) return 'unavailable';
    await openExternal(page.data.url);
    return 'opened';
  }

  private async revokeAtRouter(keyId: string): Promise<void> {
    try {
      const token = await this.routerToken();
      if (token === 'not_open' || token === 'sign_in_again') return;
      await this.send(`/v1/keys/${encodeURIComponent(keyId)}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    } catch {
      // Best effort: the key is already gone from this computer, and the person can revoke it on the router.
    }
  }

  /**
   * An access token for the router; `not_open` when the accounts service does not know the router yet, and
   * `sign_in_again` when the saved sign-in never asked for it.
   */
  private async routerToken(): Promise<string | 'not_open' | 'sign_in_again'> {
    try {
      return await this.dependencies.account.getAccessToken(ACCOUNT_ROUTER_RESOURCE);
    } catch (failure) {
      if (failure instanceof RouterSignInRequired) return 'sign_in_again';
      if (failure instanceof ResourceRefused) return 'not_open';
      throw failure;
    }
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(`${this.dependencies.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw new Error(ROUTER_UNREACHABLE);
    }
  }
}

/** Reads the router's refusal of a billing request by its code. A refusal it does not know is "not this time". */
function billingRefusal(answer: unknown): CodepawlBillingOutcome {
  const refusal = RouterRefusal.safeParse(answer);
  const code = refusal.success ? refusal.data.error.code : '';
  if (code === 'billing_not_open') return 'not_open';
  if (code === 'no_billing_customer') return 'no_billing_account';
  return 'unavailable';
}

/** The key's name: the computer's own name, short enough for the router's limit. */
export function routerKeyName(hostname: string): string {
  const cleaned = hostname.replace(/[^\p{L}\p{N} ._-]/gu, '').trim();
  return `Orglet on ${cleaned || 'this computer'}`.slice(0, KEY_NAME_LIMIT);
}
