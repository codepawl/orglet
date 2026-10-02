import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const serviceDirectory = resolve(import.meta.dirname, '..');
let runtime;
let database;
let persistence;
let bundle;
const template = {
  format: 'orglet-worker-template', version: 1,
  worker: { name: 'Fixture worker', instructions: 'Read the supplied text.', provider: 'demo', avatar: { emoji: '🔎' } },
  skill: { name: 'Fixture skill', content: 'Explain the supplied text.' },
};
const submission = {
  kind: 'orglet', name: 'Fixture listing', summary: 'Fixture summary', tags: ['fixture'],
  language: 'en', license: 'CC-BY-4.0', changelog: '', template,
};

function crewSubmission() {
  return { ...submission, kind: 'crew', template: {
    format: 'orglet-team-template', version: 1,
    team: { name: 'Fixture crew', instructions: 'Read.', workflow: 'sequential', monthlyBudgetMicros: 1000, memberKeys: ['worker-0'], synthesizerKey: 'worker-0' },
    workers: [{ ...template.worker, key: 'worker-0', skillKey: 'skill-0' }],
    skills: [{ ...template.skill, key: 'skill-0' }],
  } };
}

function wrangler(arguments_) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...arguments_], {
    cwd: serviceDirectory, encoding: 'utf8', env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

async function startRuntime() {
  const options = convertV4MiniflareOptions({
    workers: [{
      name: 'orglet-market-local-test', modules: true, script: await readFile(bundle, 'utf8'),
      compatibilityDate: '2026-10-02', d1Databases: { MARKET_DB: '00000000-0000-0000-0000-000000000476' },
      bindings: { MARKET_WRITES_ENABLED: 'false' },
    }],
  });
  options.resourcePersistencePath = join(persistence, 'v3');
  options.telemetry = { enabled: false };
  runtime = new Miniflare(options);
  database = await runtime.getD1Database('MARKET_DB');
}

before(async () => {
  persistence = await mkdtemp(join(tmpdir(), 'orglet-market-test-'));
  const output = await mkdtemp(join(tmpdir(), 'orglet-market-bundle-'));
  console.log(wrangler(['d1', 'migrations', 'apply', 'MARKET_DB', '--env', 'local_test', '--local', '--persist-to', persistence]));
  console.log(wrangler(['d1', 'migrations', 'apply', 'MARKET_DB', '--env', 'local_test', '--local', '--persist-to', persistence]));
  wrangler(['deploy', 'test/runtime-worker.ts', '--env', 'local_test', '--dry-run', '--outdir', output]);
  bundle = join(output, (await readdir(output)).find(name => name.endsWith('.js')));
  await startRuntime();
}, { timeout: 60000 });

after(async () => { await runtime?.dispose(); });

async function repository(fields) {
  return runtime.dispatchFetch('https://fixture.test/repository-fixture', {
    method: 'POST', body: JSON.stringify({ owner: 'fixture-owner', target: null, key: 'fixture-key', text: JSON.stringify(submission), ...fields }),
  });
}

test('tracked migration applies once, reapplies without drift and survives runtime restart', async () => {
  const migrations = await database.prepare('SELECT name FROM d1_migrations').all();
  assert.equal(migrations.results.length, 1);
  await runtime.dispose();
  await startRuntime();
  assert.equal((await database.prepare('SELECT count(*) AS total FROM listings').first()).total, 0);
});

test('actual owner handlers refuse anonymous requests without allocating D1 rows', async () => {
  const before = (await database.prepare('SELECT count(*) AS total FROM mutation_requests').first()).total;
  const response = await runtime.dispatchFetch('https://fixture.test/v2/listings', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'anonymous-fixture' },
    body: JSON.stringify(submission),
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await database.prepare('SELECT count(*) AS total FROM mutation_requests').first()).total, before);
  for (const path of ['/v2/me/listings', '/v2/me/summary', '/v2/me/listings/research-friend/versions/1']) {
    for (const method of ['GET', 'HEAD']) {
      const refused = await runtime.dispatchFetch(`https://fixture.test${path}`, { method });
      assert.equal(refused.status, 401);
      assert.equal(refused.headers.get('cache-control'), 'no-store');
      if (method === 'HEAD') assert.equal(await refused.text(), '');
    }
  }
});

test('actual v1 and v2 curated bodies preserve exact baseline bytes, immutable caching and weak validators', async () => {
  const baselines = [
    ['research-friend', 714, '724595ad545757cedb0f08c43252688b57d5c73f8992b20e393d50dad00ccd4c'],
    ['research-review', 1526, '041c25534aa8f52efa6aaf5bf3b4b2069ca87b445c2180657398c9a8bddbe45f'],
  ];
  for (const [listingId, length, hash] of baselines) {
    for (const protocol of ['v1', 'v2']) {
      const url = `https://fixture.test/${protocol}/listings/${listingId}/versions/1`;
      const response = await runtime.dispatchFetch(url);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.length, length);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), hash);
      assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      const head = await runtime.dispatchFetch(url, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), '');
      for (const validator of [`"${hash}"`, `W/"${hash}"`, `"other", W/"${hash}"`, '*']) {
        const unchanged = await runtime.dispatchFetch(url, { headers: { 'If-None-Match': validator } });
        assert.equal(unchanged.status, 304);
        assert.equal(await unchanged.text(), '');
      }
    }
  }
});

test('a failing final native D1 batch statement rolls back the receipt and earlier writes', async () => {
  await assert.rejects(database.batch([
    database.prepare(`INSERT INTO mutation_requests(request_id, owner_id, idempotency_key, operation, listing_id,
      request_digest, listing_cap, created_at, result_version) VALUES ('rollback-request','rollback-owner','rollback-key','create','rollback-listing',?,10,1,1)`).bind('a'.repeat(64)),
    database.prepare(`INSERT INTO listings(listing_id, owner_id, kind, created_request, created_at)
      VALUES ('rollback-listing','rollback-owner','orglet','rollback-request',1)`),
    database.prepare(`INSERT INTO listing_versions(listing_id,version,request_id,submitted_by,submitted_at,publication_epoch,
      author_name,metadata_json,body_sha256,review_digest,body_bytes,chunk_count)
      VALUES ('rollback-listing',1,'rollback-request','rollback-owner',1,0,'Fixture','{"kind":"orglet"}',?,?,1,1)`)
      .bind('a'.repeat(64), 'b'.repeat(64)),
    database.prepare(`INSERT INTO version_body_chunks(listing_id,version,ordinal,body) VALUES ('rollback-listing',1,0,?)`).bind(new Uint8Array([1])),
    database.prepare(`INSERT INTO version_body_chunks(listing_id,version,ordinal,body) VALUES ('rollback-listing',1,8,?)`).bind(new Uint8Array([1])),
  ]));
  assert.equal((await database.prepare("SELECT count(*) AS total FROM mutation_requests WHERE owner_id='rollback-owner'").first()).total, 0);
  assert.equal((await database.prepare("SELECT count(*) AS total FROM listings WHERE owner_id='rollback-owner'").first()).total, 0);
  assert.equal((await database.prepare("SELECT count(*) AS total FROM listing_versions WHERE submitted_by='rollback-owner'").first()).total, 0);
  assert.equal((await database.prepare("SELECT count(*) AS total FROM version_body_chunks WHERE listing_id='rollback-listing'").first()).total, 0);
});

test('simultaneous exact keys converge and changed metadata, target or operation conflict', async () => {
  const fields = { operation: 'submit', owner: 'race-owner', key: 'race-key' };
  const responses = await Promise.all(Array.from({ length: 8 }, () => repository(fields)));
  assert.ok(responses.every(response => response.status === 200));
  const receipts = await Promise.all(responses.map(response => response.json()));
  for (const receipt of receipts) assert.deepEqual(receipt, receipts[0]);
  assert.equal((await database.prepare("SELECT count(*) AS total FROM listing_versions WHERE submitted_by='race-owner'").first()).total, 1);
  assert.equal((await repository({ ...fields, text: JSON.stringify({ ...submission, summary: 'Changed metadata' }) })).status, 409);
  assert.equal((await repository({ ...fields, target: receipts[0].listingId })).status, 409);
  assert.equal((await repository({ ...fields, operation: 'unpublish', target: receipts[0].listingId })).status, 409);
  assert.equal((await repository({ ...fields, owner: 'different-race-owner' })).status, 200);
});

test('five successful submissions per rolling hour are guarded across concurrent version allocation', async () => {
  const now = Math.floor(Date.now() / 1000);
  const first = await (await repository({ operation: 'submit', owner: 'rate-owner', key: 'rate-first', now })).json();
  const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => repository({
    operation: 'submit', owner: 'rate-owner', target: first.listingId, key: `rate-${index}`, now,
  })));
  assert.equal(responses.filter(response => response.status === 200).length, 4);
  assert.equal(responses.filter(response => response.status === 429).length, 2);
  const versions = (await database.prepare("SELECT version FROM listing_versions WHERE submitted_by='rate-owner' ORDER BY version").all()).results;
  assert.deepEqual(versions.map(row => row.version), [1, 2, 3, 4, 5]);
  assert.equal((await database.prepare("SELECT count(*) AS total FROM mutation_requests WHERE owner_id='rate-owner'").first()).total, 5);
  assert.equal((await repository({ operation: 'submit', owner: 'rate-owner', key: 'rate-first', now })).status, 200);
  assert.equal((await repository({ operation: 'unpublish', owner: 'rate-owner', target: first.listingId, key: 'rate-unpublish' })).status, 200);
  assert.equal((await repository({ operation: 'submit', owner: 'rate-owner', target: first.listingId, key: 'rate-next-hour', now: now + 3600 })).status, 200);
});

test('all ten identities count after unpublish and lower or zero signed caps constrain new identities', async () => {
  const now = Math.floor(Date.now() / 1000);
  let first;
  for (let index = 0; index < 9; index += 1) {
    const response = await repository({ operation: 'submit', owner: 'capacity-owner', key: `capacity-${index}`, now: now - (10 - index) * 4000 });
    assert.equal(response.status, 200);
    first ??= await response.json();
  }
  const responses = await Promise.all([9, 10, 11].map(index => repository({ operation: 'submit', owner: 'capacity-owner', key: `capacity-${index}`, now })));
  assert.equal(responses.filter(response => response.status === 200).length, 1);
  assert.equal(responses.filter(response => response.status === 429).length, 2);
  await repository({ operation: 'unpublish', owner: 'capacity-owner', target: first.listingId, key: 'capacity-unpublish' });
  assert.equal((await repository({ operation: 'submit', owner: 'capacity-owner', key: 'capacity-after', now })).status, 429);
  assert.equal((await database.prepare("SELECT count(*) AS total FROM listings WHERE owner_id='capacity-owner'").first()).total, 10);
  assert.equal((await repository({ operation: 'submit', owner: 'zero-owner', key: 'zero-key', cap: 0 })).status, 429);
  const limited = await (await repository({ operation: 'submit', owner: 'limited-owner', key: 'limited-first', cap: 1 })).json();
  assert.equal((await repository({ operation: 'submit', owner: 'limited-owner', key: 'limited-second', cap: 1 })).status, 429);
  assert.equal((await repository({ operation: 'submit', owner: 'limited-owner', key: 'limited-version', target: limited.listingId, cap: 0 })).status, 200);
});

test('wrong owners and reserved curated IDs never create receipts or expose private previews', async () => {
  const first = await (await repository({ operation: 'submit', owner: 'ownership-owner', key: 'ownership-first' })).json();
  assert.equal((await repository({ operation: 'submit', owner: 'intruder', target: first.listingId, key: 'ownership-intruder' })).status, 404);
  assert.equal((await repository({ operation: 'preview', owner: 'intruder', target: first.listingId, version: 1 })).status, 404);
  assert.equal((await repository({ operation: 'unpublish', owner: 'intruder', target: first.listingId, key: 'ownership-unpublish' })).status, 404);
  assert.equal((await repository({ operation: 'submit', target: 'research-friend', key: 'seed-attempt' })).status, 404);
  assert.equal((await database.prepare("SELECT count(*) AS total FROM mutation_requests WHERE owner_id='intruder'").first()).total, 0);
  assert.equal((await repository({ operation: 'submit', owner: 'ownership-owner', target: first.listingId, key: 'ownership-kind-change', text: JSON.stringify(crewSubmission()) })).status, 409);
  assert.equal((await database.prepare("SELECT count(*) AS total FROM mutation_requests WHERE owner_id='ownership-owner'").first()).total, 1);
});

test('bounded owner summaries and exact public metadata keep latest pending separate from approved pointers through unpublish/republish', async () => {
  const first = await (await repository({ operation: 'submit', owner: 'visibility-owner', key: 'visibility-first' })).json();
  await database.batch([
    database.prepare("UPDATE version_reviews SET state='approved' WHERE listing_id=? AND version=1").bind(first.listingId),
    database.prepare('UPDATE listings SET published_version=1 WHERE listing_id=?').bind(first.listingId),
  ]);
  const downloaded = await (await repository({ operation: 'body', target: first.listingId, version: 1 })).text();
  const publicUrl = `https://fixture.test/v2/listings/${first.listingId}/versions/1`;
  const publicResponse = await runtime.dispatchFetch(publicUrl);
  assert.equal(publicResponse.status, 200);
  assert.equal(await publicResponse.text(), downloaded);
  assert.equal(publicResponse.headers.get('cache-control'), 'no-store');
  const validators = { 'If-None-Match': `W/${publicResponse.headers.get('etag')}` };
  assert.equal((await runtime.dispatchFetch(publicUrl, { headers: validators })).status, 304);
  await repository({ operation: 'submit', owner: 'visibility-owner', key: 'visibility-update', target: first.listingId,
    text: JSON.stringify({ ...submission, summary: 'Pending change' }) });
  const currentSummary = await (await repository({ operation: 'summary', owner: 'visibility-owner' })).json();
  assert.equal(currentSummary.publishingEnabled, false);
  assert.equal((await (await repository({ operation: 'summary', owner: 'visibility-owner', publishingEnabled: true })).json()).publishingEnabled, true);
  assert.equal(currentSummary.listings.length, 1);
  assert.equal(currentSummary.listings[0].latest.listing.version, 2);
  assert.equal(currentSummary.listings[0].latest.state, 'pending');
  assert.equal(currentSummary.listings[0].published.version, 1);
  assert.equal(currentSummary.listings[0].publicationEpoch, 0);
  assert.equal(JSON.stringify(currentSummary).includes('visibility-owner'), false);
  assert.equal((await (await repository({ operation: 'summary', owner: 'unrelated-owner' })).json()).listings.length, 0);
  const singleUrl = `https://fixture.test/v2/listings/${first.listingId}`;
  const single = await runtime.dispatchFetch(singleUrl);
  assert.equal(single.status, 200);
  assert.equal((await single.json()).version, 1);
  assert.equal(single.headers.get('cache-control'), 'no-store');
  const singleHead = await runtime.dispatchFetch(singleUrl, { method: 'HEAD' });
  assert.equal(singleHead.status, 200);
  assert.equal(await singleHead.text(), '');
  assert.equal(singleHead.headers.get('content-type'), single.headers.get('content-type'));
  assert.equal((await repository({ operation: 'body', target: first.listingId, version: 2 })).status, 404);
  assert.equal((await (await repository({ operation: 'public' })).json()).find(listing => listing.listingId === first.listingId).summary, submission.summary);
  const unpublish = await (await repository({ operation: 'unpublish', owner: 'visibility-owner', key: 'visibility-unpublish', target: first.listingId })).json();
  const withdrawnSummary = await (await repository({ operation: 'summary', owner: 'visibility-owner' })).json();
  assert.equal(withdrawnSummary.listings[0].latest.listing.version, 2);
  assert.equal(withdrawnSummary.listings[0].published, null);
  assert.equal(withdrawnSummary.listings[0].publicationEpoch, 1);
  assert.equal((await runtime.dispatchFetch(singleUrl)).status, 404);
  const withdrawnHead = await runtime.dispatchFetch(singleUrl, { method: 'HEAD' });
  assert.equal(withdrawnHead.status, 404);
  assert.equal(await withdrawnHead.text(), '');
  assert.equal((await repository({ operation: 'body', target: first.listingId, version: 1 })).status, 404);
  for (const method of ['GET', 'HEAD']) {
    const hidden = await runtime.dispatchFetch(publicUrl, { method, headers: validators });
    assert.equal(hidden.status, 404);
    assert.equal(hidden.headers.get('cache-control'), 'no-store');
    if (method === 'HEAD') assert.equal(await hidden.text(), '');
  }
  assert.deepEqual(JSON.parse(downloaded), template);
  await database.prepare("UPDATE version_reviews SET state='approved' WHERE listing_id=? AND version=2").bind(first.listingId).run();
  await assert.rejects(database.prepare('UPDATE listings SET published_version=2 WHERE listing_id=?').bind(first.listingId).run());
  assert.equal((await runtime.dispatchFetch(publicUrl)).status, 404);
  assert.equal((await runtime.dispatchFetch(publicUrl, { method: 'HEAD', headers: validators })).status, 404);
  await repository({ operation: 'submit', owner: 'visibility-owner', key: 'visibility-new-epoch', target: first.listingId });
  await database.batch([
    database.prepare("UPDATE version_reviews SET state='approved' WHERE listing_id=? AND version=3").bind(first.listingId),
    database.prepare('UPDATE listings SET published_version=3 WHERE listing_id=?').bind(first.listingId),
  ]);
  assert.deepEqual(await (await repository({ operation: 'unpublish', owner: 'visibility-owner', key: 'visibility-unpublish', target: first.listingId })).json(), unpublish);
  assert.equal((await database.prepare('SELECT published_version FROM listings WHERE listing_id=?').bind(first.listingId).first()).published_version, 3);
  assert.equal((await (await runtime.dispatchFetch(singleUrl)).json()).version, 3);
  const restoredHistory = await runtime.dispatchFetch(publicUrl);
  assert.equal(restoredHistory.status, 200);
  assert.equal(await restoredHistory.text(), downloaded);
  assert.equal(restoredHistory.headers.get('cache-control'), 'no-store');
  const restoredHead = await runtime.dispatchFetch(publicUrl, { method: 'HEAD' });
  assert.equal(restoredHead.status, 200);
  assert.equal(await restoredHead.text(), '');
  for (const method of ['GET', 'HEAD']) {
    const unchanged = await runtime.dispatchFetch(publicUrl, { method, headers: validators });
    assert.equal(unchanged.status, 304);
    assert.equal(await unchanged.text(), '');
  }
  const pending = await repository({ operation: 'submit', owner: 'visibility-owner', key: 'visibility-pending-after-republish', target: first.listingId });
  assert.equal(pending.status, 200);
  const pendingUrl = `https://fixture.test/v2/listings/${first.listingId}/versions/4`;
  for (const method of ['GET', 'HEAD']) {
    assert.equal((await runtime.dispatchFetch(pendingUrl, { method, headers: validators })).status, 404);
  }
});

test('ten owned identities retain twenty complete escaped latest/current metadata records without lifetime-history loading', async () => {
  const now = Math.floor(Date.now() / 1000);
  const authored = { ...submission, name: 'n'.repeat(80), summary: 's'.repeat(240), tags: Array(10).fill('t'.repeat(32)), changelog: '\u0001'.repeat(2000) };
  for (let index = 0; index < 10; index += 1) {
    const submittedAt = now - (10 - index) * 8000;
    const firstResponse = await repository({ operation: 'submit', owner: 'summary-bound-owner', key: `summary-${index}-first`, now: submittedAt, text: JSON.stringify(authored) });
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json();
    await database.batch([
      database.prepare("UPDATE version_reviews SET state='approved' WHERE listing_id=? AND version=1").bind(first.listingId),
      database.prepare('UPDATE listings SET published_version=1 WHERE listing_id=?').bind(first.listingId),
    ]);
    assert.equal((await repository({ operation: 'submit', owner: 'summary-bound-owner', target: first.listingId, key: `summary-${index}-latest`, now: submittedAt + 1, text: JSON.stringify(authored) })).status, 200);
  }
  const summary = await repository({ operation: 'summary', owner: 'summary-bound-owner' });
  assert.equal(summary.status, 200);
  const text = await summary.text();
  assert.ok(Buffer.byteLength(text) > 128 * 1024 && Buffer.byteLength(text) < 512 * 1024);
  const parsed = JSON.parse(text);
  assert.equal(parsed.listings.length, 10);
  assert.equal(parsed.allowance.listingCount, 10);
  assert.equal(parsed.allowance.submissionsInHour, 0);
  for (const listing of parsed.listings) {
    assert.equal(listing.latest.listing.version, 2);
    assert.equal(listing.latest.state, 'pending');
    assert.equal(listing.published.version, 1);
  }
});

test('exact 2 MiB normalized templates survive eight native chunks and an independent envelope cap', async () => {
  const seedResponse = await repository({ operation: 'validate', text: JSON.stringify(crewSubmission()) });
  const normalized = await seedResponse.json();
  assert.equal(normalized.ok, true);
  const largeTemplate = JSON.parse(normalized.templateText);
  largeTemplate.workers = Array.from({ length: 9 }, (_, index) => ({
    ...largeTemplate.workers[0], key: `worker-${index}`, skillKey: `skill-${index}`, instructions: '語'.repeat(16000),
  }));
  largeTemplate.skills = Array.from({ length: 9 }, (_, index) => ({ ...largeTemplate.skills[0], key: `skill-${index}`, content: '語'.repeat(16000) }));
  largeTemplate.team.memberKeys = largeTemplate.workers.slice(0, 8).map(worker => worker.key);
  largeTemplate.team.synthesizerKey = 'worker-8';
  largeTemplate.team.instructions = '語'.repeat(16000);
  largeTemplate.knowledge = Array.from({ length: 50 }, (_, index) => ({ title: `Fixture ${index}`, content: '語'.repeat(8000), tags: [], pinned: false }));
  const excess = Buffer.byteLength(JSON.stringify(largeTemplate)) - 2 * 1024 * 1024;
  assert.ok(excess > 0 && excess < 24000);
  const removedUnits = Math.ceil(excess / 3);
  largeTemplate.knowledge[0].content = '語'.repeat(8000 - removedUnits) + 'x'.repeat(removedUnits * 3 - excess);
  assert.equal(Buffer.byteLength(JSON.stringify(largeTemplate)), 2 * 1024 * 1024);
  const largeSubmission = { ...submission, kind: 'crew', template: largeTemplate };
  const text = JSON.stringify(largeSubmission);
  assert.ok(Buffer.byteLength(text) > 2 * 1024 * 1024);
  const response = await repository({ operation: 'submit', owner: 'boundary-owner', key: 'boundary-exact', text });
  assert.equal(response.status, 200, await response.clone().text());
  const receipt = await response.json();
  const stored = await database.prepare('SELECT body_bytes,chunk_count,body_sha256 FROM listing_versions WHERE listing_id=?').bind(receipt.listingId).first();
  assert.equal(stored.body_bytes, 2 * 1024 * 1024);
  assert.equal(stored.chunk_count, 8);
  const preview = await repository({ operation: 'preview', owner: 'boundary-owner', target: receipt.listingId, version: 1 });
  const bytes = Buffer.from(await preview.arrayBuffer());
  assert.equal(bytes.length, 2 * 1024 * 1024);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), stored.body_sha256);
  const chunks = await database.prepare('SELECT length(body) AS bytes FROM version_body_chunks WHERE listing_id=? ORDER BY ordinal').bind(receipt.listingId).all();
  assert.ok(chunks.results.every(chunk => chunk.bytes === 256 * 1024));
  largeTemplate.knowledge[0].content += 'x';
  const rejected = await repository({ operation: 'submit', owner: 'boundary-owner', key: 'boundary-over', text: JSON.stringify(largeSubmission) });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).diagnostics[0].rule, 'body-size');
  assert.equal((await database.prepare("SELECT count(*) AS total FROM mutation_requests WHERE owner_id='boundary-owner'").first()).total, 1);
});

test('Worker reconstruction rejects missing, reordered, oversized, malformed and digest-corrupt chunks', async () => {
  const body = Buffer.from('{}');
  const expected = { body_bytes: 2, chunk_count: 1, body_sha256: createHash('sha256').update(body).digest('hex') };
  assert.equal((await repository({ operation: 'integrity', chunks: [{ ordinal: 0, body: [...body] }], expected })).status, 200);
  for (const chunks of [[], [{ ordinal: 1, body: [...body] }], [{ ordinal: 0, body: [123] }],
    [{ ordinal: 0, body: [256, 125] }], [{ ordinal: 0, body: [123, 126] }], [{ ordinal: 0, body: Array(262145).fill(1) }]]) {
    assert.equal((await repository({ operation: 'integrity', chunks, expected })).status, 500);
  }
  const invalidUtf8 = [255];
  const invalidExpected = { body_bytes: 1, chunk_count: 1, body_sha256: createHash('sha256').update(Buffer.from(invalidUtf8)).digest('hex') };
  assert.equal((await repository({ operation: 'integrity', chunks: [{ ordinal: 0, body: invalidUtf8 }], expected: invalidExpected })).status, 500);
});

test('a native repository submit creates immutable pending content and exact retries consume no extra rows', async () => {
  const first = await repository({ operation: 'submit' });
  assert.equal(first.status, 200, await first.clone().text());
  const receipt = await first.json();
  assert.equal(receipt.state, 'pending');
  assert.deepEqual(await (await repository({ operation: 'submit' })).json(), receipt);
  assert.equal((await database.prepare("SELECT count(*) AS total FROM listing_versions WHERE submitted_by='fixture-owner'").first()).total, 1);
  const preview = await repository({ operation: 'preview', target: receipt.listingId, version: 1 });
  assert.equal(preview.status, 200);
  assert.deepEqual(JSON.parse(await preview.text()), template);
  assert.equal((await repository({ operation: 'body', target: receipt.listingId, version: 1 })).status, 404);
  await assert.rejects(database.prepare('UPDATE listing_versions SET body_sha256 = ? WHERE listing_id = ?').bind('b'.repeat(64), receipt.listingId).run());
});

test('owner projections derive allowances from signed entitlement and D1 without exposing identity or family', async () => {
  const owner = 'owner-page-fixture';
  const first = await (await repository({ operation: 'submit', owner, key: 'owner-page-create' })).json();
  await repository({ operation: 'submit', owner, key: 'owner-page-version', target: first.listingId });
  const pageResponse = await repository({ operation: 'owner', owner, cap: 1, limit: 1 });
  const page = await pageResponse.json();
  assert.deepEqual(page.allowance, { listingLimit: 1, listingCount: 1, submissionsInHour: 2, submissionLimit: 5 });
  assert.equal(page.versions.length, 1);
  assert.equal(page.versions[0].state, 'pending');
  assert.equal(page.versions[0].published, false);
  assert.ok(page.nextCursor);
  const after = Buffer.from(page.nextCursor, 'base64url').toString('utf8');
  const next = await (await repository({ operation: 'owner', owner, cap: 0, limit: 1, after })).json();
  assert.equal(next.versions[0].listing.version, 2);
  assert.equal(next.nextCursor, null);
  assert.equal(next.allowance.listingLimit, 0);
  assert.equal(next.allowance.listingCount, 1);
  assert.ok(!JSON.stringify(page).includes(owner));
  assert.ok(!JSON.stringify(page).includes('fixture-family'));
  assert.equal((await (await repository({ operation: 'owner', owner: 'empty-owner' })).json()).versions.length, 0);
});

test('actual public v2 catalog uses bounded keyset pages over approved pointers and curated seeds', async () => {
  const listingIds = [];
  for (let index = 0; index < 101; index += 1) {
    const response = await repository({ operation: 'submit', owner: `catalog-owner-${index}`, key: 'catalog-key' });
    assert.equal(response.status, 200);
    listingIds.push((await response.json()).listingId);
  }
  for (const listingId of listingIds) {
    await database.batch([
      database.prepare("UPDATE version_reviews SET state='approved' WHERE listing_id=? AND version=1").bind(listingId),
      database.prepare('UPDATE listings SET published_version=1 WHERE listing_id=?').bind(listingId),
    ]);
  }
  const response = await runtime.dispatchFetch('https://fixture.test/v2/catalog?limit=100');
  const page = await response.json();
  assert.equal(page.listings.length, 100);
  assert.ok(page.nextCursor);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const next = await (await runtime.dispatchFetch(`https://fixture.test/v2/catalog?limit=100&cursor=${page.nextCursor}`)).json();
  assert.equal(next.nextCursor, null);
  const listings = [...page.listings, ...next.listings];
  assert.equal(new Set(listings.map(listing => listing.listingId)).size, listings.length);
  assert.deepEqual(listings.map(listing => listing.listingId), listings.map(listing => listing.listingId).sort());
  assert.ok(listingIds.every(listingId => listings.some(listing => listing.listingId === listingId)));
  assert.ok(listings.some(listing => listing.listingId === 'research-friend'));
  assert.ok(listings.every(listing => Object.keys(listing.author).join(',') === 'displayName'));
  assert.ok(!JSON.stringify(listings).includes('catalog-owner-'));
  assert.ok(!JSON.stringify(listings).includes('fixture-family'));
  for (const query of ['limit=0', 'limit=101', 'limit=1&limit=2', 'cursor=invalid', 'cursor=', 'unknown=fixture']) {
    const refused = await runtime.dispatchFetch(`https://fixture.test/v2/catalog?${query}`);
    assert.equal(refused.status, 400);
    assert.equal(refused.headers.get('cache-control'), 'no-store');
  }
});
