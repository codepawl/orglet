import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { eraseEverything } from '../../apps/desktop/src/core/storage/erase';
import { SyncReplica } from '../../apps/desktop/src/core/storage/sync-replica';
import { SyncTransport } from '../../apps/desktop/src/main/sync-transport';
import type { Task, Worker } from '../../apps/desktop/src/shared/contracts';

/*
 * A sign-in saved before sync existed (0.11, 0.12) was made while the app said nothing leaves this computer. On the
 * update to a build that syncs, such an install holding data must wait for the person instead of uploading it. The
 * account side of the marker (saved, kept across restarts, forgotten on sign-out) is in account.test.ts.
 */

const context = { accountKey: 'b'.repeat(64), generation: 1 };
const cursor = { generation: '11111111-1111-4111-8111-111111111111', sequence: 0, privacy: 0 };
const stores: Store[] = [];
const transports: SyncTransport[] = [];
afterEach(async () => {
  for (const transport of transports.splice(0)) await transport.stop();
  for (const store of stores.splice(0)) store.db.close();
});

function setup(options: { agreed: boolean; withData: boolean }) {
  const store = new Store(':memory:');
  stores.push(store);
  if (options.withData) addChat(store);
  const replica = new SyncReplica(store, () => undefined);
  const requests: string[] = [];
  const account = {
    agreed: options.agreed,
    agreements: 0,
    syncContext: () => context,
    getAccessToken: async () => 'token',
    syncAgreed() { return account.agreed; },
    async agreeToSync() {
      account.agreed = true;
      account.agreements += 1;
    },
  };
  const transport = new SyncTransport({
    baseUrl: 'https://sync.test',
    account,
    core: async action => replica.execute(JSON.parse(JSON.stringify(action))),
    joinsOnItsOwn: true,
    connect: () => ({ close: () => undefined }),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      requests.push(path);
      const body = JSON.parse(String(init?.body)) as { records?: { id: string }[] };
      const reply = path === '/v1/snapshot' ? { cursor, records: [], next: null }
        : path === '/v1/pull' ? { cursor, records: [], more: false }
        : { cursor: { ...cursor, sequence: 1 }, outcomes: (body.records ?? []).map(record => ({ id: record.id, status: 'kept' })) };
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch,
  });
  transports.push(transport);
  return { store, transport, requests, account };
}

function addChat(store: Store): Task {
  const task: Task = { id: randomUUID(), workerId: store.all<Worker>('workers')[0].id, brief: 'Written before sync existed', sourceIds: [], status: 'completed',
    createdAt: new Date().toISOString(), budgetMicros: 1000, consent: false, accepted: false };
  store.put('tasks', task);
  return task;
}

it('waits for a choice when a sign-in from before sync holds data, and sends nothing', async () => {
  const { transport, requests } = setup({ agreed: false, withData: true });
  await transport.refresh();
  await transport.settled();
  expect(transport.state()).toEqual({ state: 'link_required', askedBecauseNew: true });
  expect(requests).toEqual([]);
  transport.localChanged();
  await transport.settled();
  expect(requests).toEqual([]);
});

it('joins a sign-in from before sync when it holds nothing of its own', async () => {
  const { transport, requests } = setup({ agreed: false, withData: false });
  await transport.refresh();
  await transport.settled();
  expect(transport.state().state).toBe('synced');
  expect(requests.length).toBeGreaterThan(0);
});

it('joins without being asked when this install agreed by signing in on a build that syncs', async () => {
  const { transport, requests } = setup({ agreed: true, withData: true });
  await transport.refresh();
  await transport.settled();
  expect(transport.state().state).toBe('synced');
  expect(requests).toContain('/v1/push');
});

it('remembers the agreement when the person starts sync, and joins', async () => {
  const { transport, requests, account } = setup({ agreed: false, withData: true });
  await transport.refresh();
  expect(transport.state().state).toBe('link_required');
  await transport.start();
  await transport.settled();
  expect(account.agreements).toBe(1);
  expect(account.agreed).toBe(true);
  expect(transport.state().state).toBe('synced');
  expect(requests).toContain('/v1/push');
  // Another start of the app reads the remembered agreement and no longer waits.
  await transport.stop();
  await transport.refresh();
  await transport.settled();
  expect(transport.state().state).toBe('synced');
});

it('still waits after an erase, with the older wording, even when the install agreed', async () => {
  const { store, transport } = setup({ agreed: true, withData: true });
  await transport.refresh();
  await transport.settled();
  expect(transport.state().state).toBe('synced');
  eraseEverything(store);
  await transport.stop();
  await transport.refresh();
  await transport.settled();
  expect(transport.state()).toEqual({ state: 'link_required' });
});
