# Orglet sync service

This Worker replicates Orglet's explicit public records into one SQLite Durable Object per verified account. It never runs an orglet, enables a schedule or grants access to a computer. File bytes go to an R2 bucket (below). The checked-in configuration has no public route and keeps `SYNC_ENABLED=false`; it does not deploy or connect a user's local profile. The desktop connects only when started with `ORGLET_SYNC_URL` naming a server ([technical guide](../../docs/technical-guide.md#account-sync)).

## Protocol

Requests use an Accounts EdDSA access token in the Authorization bearer header. The Worker checks configured issuer/JWKS, the sync audience, desktop client, scopes, expiry and signed entitlements before selecting the account object. A supplementary Accounts userinfo audience is accepted; unrelated audiences are refused. Caller-supplied owner fields cannot choose an account. Account subjects and bearer tokens never appear in URLs or logs.

| Route | Request | Result |
|---|---|---|
| POST `/v1/push` | `deviceId`, 1–100 strict public `records` | Per-record kept, superseded or blocked outcomes, plus server cursor. Conflicts or rejected batches acknowledge nothing. |
| POST `/v1/pull` | `deviceId`, `after`, optional `limit` | Committed changes, next cursor and more flag. An invalidated or expired history cursor requires a snapshot. |
| POST `/v1/snapshot` | `deviceId`, optional opaque `cursor`, optional `limit` | A page at one pinned sequence and a continuation token, or null when complete. |
| POST `/v1/devices/release` | `deviceId`, `targetDeviceId` | Releases a registered computer and refuses its old grant on later requests. |
| GET `/v1/connect` | Bearer header, `X-Orglet-Device`, WebSocket upgrade | Hibernating socket with cursor hints only. Clients pull records separately. `ping` receives automatic `pong`. |
| PUT `/v1/files/<source id>` | Bearer header, `X-Orglet-Device`, raw bytes as `application/octet-stream` | `stored` or `present`. The bytes must have the size and SHA-256 of that source's public record. |
| GET `/v1/files/<source id>` | Bearer header, `X-Orglet-Device` | The file's bytes, decrypted and verified, while its record is still public. |
| GET `/health` | None | Service name and enabled flag; no account data. |

The shared schemas live in `apps/desktop/src/shared/sync-protocol.ts`. Each record is at most 2 MiB, and a batch or page is at most 8 MiB. A fresh snapshot is required after history pruning or privacy withdrawal. Snapshot continuations expire after five minutes and are invalidated by a concurrent write. A client must stage every page and apply only a completed snapshot; on restart it discards its staged pages. This can require retrying under continuous writes.

Higher HLC wins independently per record key. Revision, turn, run, artifact and event payloads are immutable; unchanged payloads may receive a new scope envelope. The server derives required privacy roots from public references and confirmed ownership. Frozen crew participants are explicit in chat projections. Unknown dependencies or schemas fail closed and leave the local outbox intact. Permanent deletion barriers and identity digests remain after payload/history removal, so a different envelope ID cannot reopen deleted data. Shared attachments can use another confirmed public owner; a claimed scope alone does not establish ownership.

Device limits count durable registrations, not open sockets. A grant is bound to one device UUID. Free `push=false` is the future phone notification entitlement and does not disable replication or cursor hints. Socket attachments retain verified device/grant/expiry state; expired, released or deleted sessions close with legal close codes.

## Storage and keys

Complete records and change-log payloads use AES-GCM with random nonces. Account identity, random data-key generation, record key and sequence are authenticated as AAD. The random account data key is wrapped under a versioned master key held only in the Worker secret. Necessary index metadata, scope epochs, permanent digests, device registrations and deletion barriers remain outside payload ciphertext.

### Files

A file belongs to a `source` record that the account already holds; a request names the source, never a hash, and bytes that do not match the record are refused (`file_mismatch`). One object per account and plaintext SHA-256 lives at `files/<SHA-256 of the account name>/<plaintext SHA-256>`, so two sources with the same bytes share it and another account never does. The object is the 12-byte nonce followed by AES-GCM ciphertext under the account key, bound to the account, key generation, hash and size.

The bucket and the account object's SQLite are not one transaction. An upload reserves its bytes first (`pending`, counted toward the limit, expiring after 10 minutes), writes the object, then commits; the commit is refused, and the object deleted, when the account was deleted or the record withdrawn meanwhile. A sweep after control records and on the alarm deletes objects that no record names and reservations that expired. Account deletion deletes every object it knows.

`SYNC_MAX_FILE_BYTES` (25 MiB default, which is also the protocol's ceiling) bounds one file, and `SYNC_MAX_FILE_STORAGE_BYTES` (256 MiB default) bounds an account's files, pending included. These are deployment limits; no signed entitlement covers files yet, and one must before a public rollout promises a number.

`SYNC_MASTER_KEYS` is JSON with an `active` integer and a `keys` object mapping versions to base64-encoded random 32-byte keys. Keep it in a Worker secret, or the ignored `.dev.vars` for local development; never add it to Wrangler vars, source or logs. Rotation temporarily includes old and new master versions and switches active to the new version. Each accessed account rewraps its existing random data key without rewriting its encrypted records. Keep old versions until all existing account wrappers have been rewrapped; this change has no automatic fleet rotation job.

The identity service reaches account lifecycle through the `SyncLifecycle` entrypoint, by service binding only: it has no route, and a sync access token cannot call it. Both calls take the subject from the identity service's own session and are safe to repeat.

- `deleteAccount(subject)` erases live payloads, files and the wrapped key and keeps the account-deleted marker, so a still-valid access token cannot recreate the account.
- `revokeDevice(subject, grantId)` refuses that sign-in from then on, frees its device slot and closes its sockets, without waiting for its token to end.

Binding the identity Worker to this entrypoint and calling it from its deletion and device pages is that service's change.

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

The service pins the same Wrangler/Miniflare versions as Market. Node tests verify actual JWT signatures with ephemeral keys. Native runtime tests use a separate test-only entry with trusted synthetic account identities to call the real object through RPC, inspect actual SQLite ciphertext and restart on persistent storage. The production entry exports no inspection, mutation-fault or fixture routes. Anonymous production handlers are tested separately. The repository's `tests/integration/sync-production-entry.test.ts` runs this production entry over loopback HTTP with signed tokens and a stand-in JWKS. None of these prove a real account login or a live deployment.

## Self-hosting and deployment

Use your own issuer/JWKS and HTTPS sync resource audience, registering the desktop client and required scopes with that issuer. Keep the account route derived from issuer and subject. Configure signed storage/device/history entitlements and the operational ceilings; limits never come from a plan name. Set the master key ring with Wrangler secret tooling. A local development profile can enable `SYNC_ENABLED` and use an ignored local secret; no resources are needed for tests.

For a production rollout, separately review the exact green commit, namespace migration, the R2 bucket named in `wrangler.jsonc` (it must exist before a deploy), account identity configuration, master-key secret, route and storage limits. The tracked `new_sqlite_classes` migration creates an account namespace when deployed; unlike `check:deploy`, a real deploy changes infrastructure. Configure the intended route and enable flag only in that reviewed rollout. Verify the actual issuer, negative account/audience cases, two-device push/pull/snapshot/privacy and socket expiry before giving the desktop a default `ORGLET_SYNC_URL`. No production resources or routes have been provisioned by this source change.
