# Orglet sync service

This Worker replicates Orglet's explicit public records into one SQLite Durable Object per verified account. It never runs an orglet, enables a schedule or grants access to a computer. R2 files are a separate change. The checked-in configuration has no public route and keeps `SYNC_ENABLED=false`; it does not deploy or connect a user's local profile. The desktop connects only when started with `ORGLET_SYNC_URL` naming a server ([technical guide](../../docs/technical-guide.md#account-sync)).

## Protocol

Requests use an Accounts EdDSA access token in the Authorization bearer header. The Worker checks configured issuer/JWKS, the sync audience, desktop client, scopes, expiry and signed entitlements before selecting the account object. A supplementary Accounts userinfo audience is accepted; unrelated audiences are refused. Caller-supplied owner fields cannot choose an account. Account subjects and bearer tokens never appear in URLs or logs.

| Route | Request | Result |
|---|---|---|
| POST `/v1/push` | `deviceId`, 1–100 strict public `records` | Per-record kept, superseded or blocked outcomes, plus server cursor. Conflicts or rejected batches acknowledge nothing. |
| POST `/v1/pull` | `deviceId`, `after`, optional `limit` | Committed changes, next cursor and more flag. An invalidated or expired history cursor requires a snapshot. |
| POST `/v1/snapshot` | `deviceId`, optional opaque `cursor`, optional `limit` | A page at one pinned sequence and a continuation token, or null when complete. |
| POST `/v1/devices/release` | `deviceId`, `targetDeviceId` | Releases a registered computer and refuses its old grant on later requests. |
| GET `/v1/connect` | Bearer header, `X-Orglet-Device`, WebSocket upgrade | Hibernating socket with cursor hints only. Clients pull records separately. `ping` receives automatic `pong`. |
| GET `/health` | None | Service name and enabled flag; no account data. |

The shared schemas live in `apps/desktop/src/shared/sync-protocol.ts`. Each record is at most 2 MiB, and a batch or page is at most 8 MiB. A fresh snapshot is required after history pruning or privacy withdrawal. Snapshot continuations expire after five minutes and are invalidated by a concurrent write. A client must stage every page and apply only a completed snapshot; on restart it discards its staged pages. This can require retrying under continuous writes.

Higher HLC wins independently per record key. Revision, turn, run, artifact and event payloads are immutable; unchanged payloads may receive a new scope envelope. The server derives required privacy roots from public references and confirmed ownership. Frozen crew participants are explicit in chat projections. Unknown dependencies or schemas fail closed and leave the local outbox intact. Permanent deletion barriers and identity digests remain after payload/history removal, so a different envelope ID cannot reopen deleted data. Shared attachments can use another confirmed public owner; a claimed scope alone does not establish ownership.

Device limits count durable registrations, not open sockets. A grant is bound to one device UUID. Free `push=false` is the future phone notification entitlement and does not disable replication or cursor hints. Socket attachments retain verified device/grant/expiry state; expired, released or deleted sessions close with legal close codes.

## Storage and keys

Complete records and change-log payloads use AES-GCM with random nonces. Account identity, random data-key generation, record key and sequence are authenticated as AAD. The random account data key is wrapped under a versioned master key held only in the Worker secret. Necessary index metadata, scope epochs, permanent digests, device registrations and deletion barriers remain outside payload ciphertext.

`SYNC_MASTER_KEYS` is JSON with an `active` integer and a `keys` object mapping versions to base64-encoded random 32-byte keys. Keep it in a Worker secret, or the ignored `.dev.vars` for local development; never add it to Wrangler vars, source or logs. Rotation temporarily includes old and new master versions and switches active to the new version. Each accessed account rewraps its existing random data key without rewriting its encrypted records. Keep old versions until all existing account wrappers have been rewrapped; this change has no automatic fleet rotation job.

Trusted account lifecycle RPC can erase live payloads and the wrapped key while retaining an account-deleted marker. The public Worker has no erase route; the Accounts deletion hookup is separate work. A still-valid access token cannot recreate a deleted account.

Deleting the live wrapped key does **not** prove irreversible erasure of historical backups or SQLite point-in-time recovery. Historical wrappers may remain recoverable while their master version exists. Stronger historical crypto-erasure requires a separately designed key lifecycle; this service promises live-service deletion only. Cloudflare documents [SQLite storage and recovery](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

Incremental history lasts at most 90 days, or the lower signed history entitlement. Live winning records are not age-pruned here: deleting referenced chat history requires a separate reference-safe policy. Signed storage limits include current/log ciphertext and estimates for retained fence/device metadata. Deployment also imposes `SYNC_MAX_ACCOUNT_BYTES` (32 MiB default) and `SYNC_MAX_RECORDS` (10,000 default), because scope validation currently materializes the bounded account projection. These operational ceilings can be lower than a signed entitlement. Storage rejection never deletes local data. Privacy/deletion operations may reduce existing payloads even after a signed quota shrinks; permanent fence metadata is not evicted to make room.

## Local checks

Install the root workspace first, then the service's independent pinned tooling:

```text
pnpm --config.verify-deps-before-run=false --dir services/sync install --frozen-lockfile
pnpm --config.verify-deps-before-run=false --dir services/sync types
pnpm --config.verify-deps-before-run=false --dir services/sync typecheck
pnpm --config.verify-deps-before-run=false --dir services/sync test
pnpm --config.verify-deps-before-run=false --dir services/sync check:deploy
pnpm typecheck
pnpm test
```

The service pins the same Wrangler/Miniflare versions as Market. Node tests verify actual JWT signatures with ephemeral keys. Native runtime tests use a separate test-only entry with trusted synthetic account identities to call the real object through RPC, inspect actual SQLite ciphertext and restart on persistent storage. The production entry exports no inspection, mutation-fault or fixture routes. Anonymous production handlers are tested separately. These tests do not prove positive authenticated Worker HTTP, a real account login or a live deployment.

## Self-hosting and deployment

Use your own issuer/JWKS and HTTPS sync resource audience, registering the desktop client and required scopes with that issuer. Keep the account route derived from issuer and subject. Configure signed storage/device/history entitlements and the operational ceilings; limits never come from a plan name. Set the master key ring with Wrangler secret tooling. A local development profile can enable `SYNC_ENABLED` and use an ignored local secret; no resources are needed for tests.

For a production rollout, separately review the exact green commit, namespace migration, account identity configuration, master-key secret, route and storage limits. The tracked `new_sqlite_classes` migration creates an account namespace when deployed; unlike `check:deploy`, a real deploy changes infrastructure. Configure the intended route and enable flag only in that reviewed rollout. Verify the actual issuer, negative account/audience cases, two-device push/pull/snapshot/privacy and socket expiry before giving the desktop a default `ORGLET_SYNC_URL`. No production resources or routes have been provisioned by this source change.
