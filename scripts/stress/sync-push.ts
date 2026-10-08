import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Store } from '../../apps/desktop/src/core/storage/database';
import { SyncReplica } from '../../apps/desktop/src/core/storage/sync-replica';
import type { SyncRecordingContext } from '../../apps/desktop/src/shared/sync';
import type { SyncReplicaBatch } from '../../apps/desktop/src/shared/sync-replica';
import type { SeedSummary } from './seed-profile';

/**
 * Sends a seeded profile to a local sync service the way the app's transport does, batch by batch, until the service
 * stops taking records or the profile is sent. The service is the real Worker code with a test identity whose free
 * entitlement is 5 MB, started by sync-check.mjs; nothing here reaches the network beyond that local address.
 *
 * Usage: sync-push <seed summary.json> <work folder> <service url> [max batches]
 */
const round = (value: number) => Math.round(value * 10) / 10;

async function main() {
  const [summaryPath, workFolder, serviceUrl, maxBatchesArgument] = process.argv.slice(2);
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as SeedSummary;
  mkdirSync(workFolder, { recursive: true });
  const copy = join(workFolder, 'orglet.sqlite');
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${copy}${suffix}`, { force: true });
  copyFileSync(summary.databasePath, copy);
  const store = new Store(copy);
  const replica = new SyncReplica(store, () => undefined);
  const context: SyncRecordingContext = { accountKey: 'a'.repeat(64), generation: 1 };
  store.sync.setRecordingContext(context);

  const queueStarted = performance.now();
  store.sync.requeue(context, new Map());
  const queueMilliseconds = round(performance.now() - queueStarted);
  const queued = Number(store.db.prepare('SELECT COUNT(*) AS count FROM sync_outbox').get()!.count);
  const queuedBytes = Number(store.db.prepare('SELECT COALESCE(SUM(length(data)),0) AS bytes FROM sync_outbox').get()!.bytes);
  const deviceId = store.sync.deviceId();
  const owner = 'stress-owner';

  const outboxTimes: number[] = [];
  const pushTimes: number[] = [];
  let accepted = 0;
  let acceptedBytes = 0;
  let refusal: { status: number; body: string; afterRecords: number } | undefined;
  const maxBatches = Number(maxBatchesArgument ?? 400);
  let batches = 0;
  const sendStarted = performance.now();
  while (batches < maxBatches) {
    const outboxStarted = performance.now();
    const batch = replica.execute({ action: 'outbox', context }) as SyncReplicaBatch;
    outboxTimes.push(performance.now() - outboxStarted);
    if (!batch.records.length) break;
    const pushStarted = performance.now();
    const response = await fetch(`${serviceUrl}/fixture`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner, operation: 'push', device: deviceId, input: { deviceId, records: batch.records } }) });
    const text = await response.text();
    pushTimes.push(performance.now() - pushStarted);
    if (!response.ok) { refusal = { status: response.status, body: text.slice(0, 200), afterRecords: accepted }; break; }
    const result = JSON.parse(text) as { outcomes: { id: string; status: 'kept' | 'superseded' | 'blocked' }[] };
    accepted += batch.records.length;
    acceptedBytes += batch.records.reduce((total, record) => total + JSON.stringify(record).length, 0);
    replica.execute({ action: 'acknowledge', context, outcomes: result.outcomes });
    batches += 1;
  }
  const remaining = Number(store.db.prepare('SELECT COUNT(*) AS count FROM sync_outbox').get()!.count);
  // What one more round costs once the service has said no: the app repeats exactly this when its hold time passes.
  const retryStarted = performance.now();
  replica.execute({ action: 'outbox', context });
  const retryOutboxMilliseconds = round(performance.now() - retryStarted);
  store.close();
  const median = (values: number[]) => values.length ? round([...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]) : undefined;
  console.log(`SYNC_RESULT ${JSON.stringify({ tier: summary.config.name, queued, queuedMegabytes: round(queuedBytes / 1048576), queueMilliseconds, batches,
    recordsAccepted: accepted, acceptedMegabytes: round(acceptedBytes / 1048576), seconds: round((performance.now() - sendStarted) / 1000),
    medianOutboxMilliseconds: median(outboxTimes), medianPushMilliseconds: median(pushTimes), refusal, remaining, retryOutboxMilliseconds })}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
