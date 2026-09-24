import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  HarnessAccountState,
  SYSTEM_ACCOUNT_ID,
  harnessCatalog,
  type HarnessAccount,
  type HarnessAccountSelection,
  type HarnessCatalogId,
} from '../../shared/harness';
import type { Store } from '../storage/database';

const SETTING = 'harnessAccounts';
const MAX_ACCOUNTS = 20;

export type HarnessAccountMap = Record<HarnessCatalogId, HarnessAccountSelection>;

/**
 * Accounts of a local CLI, kept as folders. Each CLI reads its credentials from the folder its config-dir variable
 * points at, so an account is a folder Orglet owns and a label the user typed; signing in is still the CLI's own
 * job. The system account sets no variable at all, which is exactly what Orglet did before accounts existed.
 *
 * `root` is where those folders live. Without one — a core built for tests — only the system account exists.
 */
export class HarnessAccounts {
  constructor(private store: Store, private root?: string) {}

  /** Every harness with its accounts and the folder the active one runs in. */
  map(): HarnessAccountMap {
    return Object.fromEntries(harnessCatalog.map(id => [id, this.selection(id)])) as HarnessAccountMap;
  }

  selection(harness: HarnessCatalogId): HarnessAccountSelection {
    const state = this.state(harness);
    const active = this.root ? state.accounts.find(account => account.id === state.activeId) : undefined;
    if (!active) return { accountId: SYSTEM_ACCOUNT_ID, accounts: state.accounts };
    return { accountId: active.id, accounts: state.accounts, configDir: this.directory(harness, active.id) };
  }

  /** Adds an account and makes it the active one, so the login command shown next belongs to it. */
  async add(harness: HarnessCatalogId, label: string): Promise<HarnessAccount> {
    if (!this.root) throw new Error('Orglet chưa có thư mục dữ liệu để tạo tài khoản harness.');
    const state = this.state(harness);
    if (state.accounts.length >= MAX_ACCOUNTS) throw new Error(`Mỗi harness giữ tối đa ${MAX_ACCOUNTS} tài khoản.`);
    const account: HarnessAccount = { id: randomUUID(), label };
    await mkdir(this.directory(harness, account.id), { recursive: true });
    this.write(harness, { accounts: [...state.accounts, account], activeId: account.id });
    return account;
  }

  rename(harness: HarnessCatalogId, id: string, label: string) {
    const state = this.state(harness);
    if (!state.accounts.some(account => account.id === id)) throw new Error('Không còn tài khoản này.');
    this.write(harness, { ...state, accounts: state.accounts.map(account => account.id === id ? { ...account, label } : account) });
  }

  /** Removes the account and the folder holding its sign-in; the system account falls back in when it was active. */
  async remove(harness: HarnessCatalogId, id: string) {
    const state = this.state(harness);
    if (!state.accounts.some(account => account.id === id)) throw new Error('Không còn tài khoản này.');
    if (this.root) await rm(this.directory(harness, id), { recursive: true, force: true });
    this.write(harness, {
      accounts: state.accounts.filter(account => account.id !== id),
      activeId: state.activeId === id ? SYSTEM_ACCOUNT_ID : state.activeId,
    });
  }

  select(harness: HarnessCatalogId, id: string) {
    const state = this.state(harness);
    if (id !== SYSTEM_ACCOUNT_ID && !state.accounts.some(account => account.id === id)) throw new Error('Không còn tài khoản này.');
    this.write(harness, { ...state, activeId: id });
  }

  /** The folder a CLI signs in to for one account; undefined for the system account, which sets no variable. */
  configDir(harness: HarnessCatalogId, id: string): string | undefined {
    if (id === SYSTEM_ACCOUNT_ID || !this.root) return undefined;
    return this.directory(harness, id);
  }

  /** One folder per account. The id is a UUID, so it is a safe path segment and the label stays free text. */
  private directory(harness: HarnessCatalogId, id: string) {
    if (!this.root) throw new Error('Orglet chưa có thư mục dữ liệu để giữ tài khoản harness.');
    return join(this.root, harness, id);
  }

  private state(harness: HarnessCatalogId): HarnessAccountState {
    const stored = this.store.setting<Record<string, unknown>>(SETTING, {});
    const parsed = HarnessAccountState.safeParse(stored[harness]);
    return parsed.success ? parsed.data : { accounts: [], activeId: SYSTEM_ACCOUNT_ID };
  }

  private write(harness: HarnessCatalogId, state: HarnessAccountState) {
    const stored = this.store.setting<Record<string, unknown>>(SETTING, {});
    this.store.setSetting(SETTING, { ...stored, [harness]: state });
  }
}
