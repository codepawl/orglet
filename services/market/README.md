# Marketplace API

The Worker serves text-only CodePawl orglet and crew templates under CC BY 4.0. Public reading needs no account. Curated catalog source and immutable bodies live in `apps/desktop/src/shared/market-seed.ts`, which also supplies the desktop's offline seed. The owner-submission service uses local D1 fixtures, but production publishing is disabled until moderation is available. There are no image uploads or R2 bindings.

`src/auth.ts` authenticates owner handlers with the fixed `https://accounts.codepawl.com/api/auth` issuer and its `/jwks`. It requires a market token for `orglet-desktop`, the required scopes, verified email/public name, a signed grant family and a bounded listing entitlement. Sync tokens and mixed cross-product audiences are refused. Signature, issuer, audience and expiry checks use pinned jose 6.2.12. Claims can lag issuer changes by the existing 15-minute token lifetime; immediate family revocation is later work.

`GET /v1/catalog` and `/v1/listings/:listingId/versions/:version` retain their original curated metadata, exact bytes and immutable body cache headers. V2 curated version URLs serve those same bodies. GET/HEAD revalidation accepts weak ETags, validator lists and `*`. Desktop imports independently verify bytes, strict fields and references before creating local rows.

`GET /v2/catalog?limit=50` returns display-only authors and bounded pages of up to 100 listings. Account rows require `MARKET_PUBLIC_PUBLISHING_ENABLED=true`, a complete valid reviewer allowlist and working migrated D1. The catalog then merges the seed with current approved non-hidden pointers using keyset cursors and `no-store`. A closed or unavailable account-public gate serves only the existing seed snapshot and its snapshot-bound cursors. Invalid, noncanonical or stale seed cursors return 400. HEAD returns the same status and headers with no body. V2 errors use `no-store` too.

Account bodies use `/v2/listings/:listingId/versions/:version`. Pending versions stay private. Public reads reconstruct and verify the body, then recheck current primary visibility before HEAD or ETag revalidation. Account bodies use `no-store`; unpublishing hides historical approved URLs while the listing is withdrawn. After an approved current-epoch version republishes the listing, its historical approved exact bodies become readable again. Pending or rejected versions stay private. The immutable curated seed is reserved and cannot be owned or unpublished by an account.

Owner routes all call the real issuer verifier and use `no-store`:

| Route | Behavior |
|---|---|
| `POST /v2/listings` | Create a listing identity and its first pending version |
| `POST /v2/listings/:listingId/versions` | Add a pending version of the same kind |
| `POST /v2/listings/:listingId/unpublish` | Hide the whole listing using an empty `{}` payload |
| `GET/HEAD /v2/me/summary` | Return at most ten owned latest/current summaries, publication epochs, verified allowance counters and explicit `publishingEnabled` readiness |
| `GET/HEAD /v2/me/listings` | Page owned versions and return verified entitlement/D1 allowance counters |
| `GET/HEAD /v2/me/listings/:listingId/versions/:version` | Preview an owned version, including pending or rejected content |

POST routes require an `Idempotency-Key` matching `[A-Za-z0-9_-]{1,128}`. A D1 batch owns receipt, version allocation, ownership, quota, immutable chunks and initial pending state. Failed batches consume nothing. Exact retries return the original receipt; changed operation, target or authored content under the same key returns 409. Ten listing identities count across all states, or fewer if the signed entitlement says so. Unpublishing does not reclaim capacity. Existing listing versions remain allowed under a lowered cap, subject to ownership and five successful submissions per rolling hour. Unpublishing and exact retries do not spend that hourly allowance.

Unpublish is a listing-wide action, not a comparison against a previously previewed version. It advances a publication epoch so a late review cannot publish a pre-unpublish submission. Retrying the old key cannot clear a later republished pointer. Installed copies and immutable rows remain intact. The desktop prepares explicit public previews and durable retries; production publishing is still disabled.

Moderation routes also verify the fixed issuer and use `no-store`. `MARKET_REVIEWER_SUBJECTS` is a strict JSON array of one to 32 unique exact opaque issuer subjects, never names or email addresses. Missing, empty or malformed configuration grants nobody review authority and closes account-public serving. Every reviewer read, mutation and receipt retry checks the current allowlist. Reporting accepts a verified account with zero publisher capacity.

| Route | Behavior |
|---|---|
| `GET/HEAD /v2/me/moderation` | Return only the caller's review/report/write capability hints |
| `GET/HEAD /v2/review/queue` | Reviewer-only pending versions, keyset pages of 20 |
| `GET/HEAD /v2/review/listings/:id/versions/:version` | Reviewer-only exact metadata, review/publication revisions, hidden state and report count |
| `GET/HEAD /v2/review/listings/:id/versions/:version/body` | Reviewer-only immutable literal template bytes, including pending content |
| `GET/HEAD /v2/review/listings/:id/versions/:version/reports` | Reviewer-only report evidence and resolution revisions, pages of 20, no reporter subjects |
| `GET/HEAD /v2/review/listings/:id/versions/:version/audit` | Reviewer-only append-only decisions, reasons, public actor name and self-review marker, pages of 20 |
| `POST /v2/listings/:id/versions/:version/report` | Report an exact currently public approved account version |
| `POST /v2/review/listings/:id/versions/:version/decision` | Explicit approve, reject or listing-wide hide, with exact expected state and reason |
| `POST /v2/review/reports/:reportId/resolve` | Resolve or dismiss an open report using its expected revision and a reason |

Moderation POST envelopes are streamed and capped at 8 KiB; explanation/reason text is capped at 2 KiB UTF-8 and scanned for recognizable credentials. Unknown fields, role/subject/time claims and path/body mismatches fail. Reports are unique per reporter/exact version. Ten accepted reports in a rolling 24-hour window count even after resolution, with trusted server time and transactional last-slot guards. Exact idempotent retries consume no extra report. Counts never hide content.

Migration `0002_moderation.sql` adds reports, review/moderation revisions and append-only requests/events. A decision's template SHA and complete review digest, publication epoch, published pointer and review/moderation revisions must match inside the same atomic batch as the audit and state change. Competing decisions, prior unpublish and approval of a newer version produce 409 conflicts, with no orphan receipt/event. Pending updates leave the prior approved version public. Hide clears the pointer and advances the epoch; owner submission cannot clear it, and this API has no restore endpoint. Explicit self-review is allowed only through the ordinary checked decision and records that fact in the audit. The ledger is application append-only, not immune to a database administrator.

`validateMarketSubmission` refuses unknown/local fields, malformed crew references, recognizable credentials, nontext or malformed packages, preview/package mismatches and unsupported manifest controls. Diagnostics use fixed rules, logical paths and line numbers without matching values. Normalized template JSON is at most 2 MiB, stored in at most eight 256 KiB chunks. Reads verify contiguous order, count, length, SHA and fatal UTF-8. A separate complete-content review digest binds authored metadata too. Validation and import never execute resources.

The raw envelope limit is 2 MiB + 16 KiB + 12 bytes. The metadata schema allows 2,640 authored UTF-16 units, at most 15,840 escaped bytes plus fewer than 544 fixed JSON bytes. The template is a nested object, serialized once. Streaming bytes, declared length and normalized body size are checked separately; raw whitespace also counts. The decoded file/package limits still apply.

Install the service's own tooling after installing the root workspace:

```powershell
pnpm --config.verify-deps-before-run=false --dir services/market install --frozen-lockfile
pnpm --config.verify-deps-before-run=false --dir services/market types
pnpm --config.verify-deps-before-run=false --dir services/market typecheck
pnpm --config.verify-deps-before-run=false --dir services/market test
pnpm --config.verify-deps-before-run=false --dir services/market check:deploy
```

The service pins its own TypeScript compiler to 7.0.2, Wrangler to 4.143.0 and Miniflare to 5.20260926.0-alpha. Tests apply the tracked migration twice, start the bundled Worker with native local D1 persistence, and check rollback, races, body boundaries, visibility and anonymous handlers. The repository fixture supplies trusted synthetic identities only in `test/runtime-worker.ts`; the production configuration and entry never install it. Node tests cover real signature verification with ephemeral keys. Positive authenticated HTTP behavior in workerd remains unverified. Local checks do not establish a live deployment.

The `types` command runs pinned Wrangler against `local_test`, then exports only the required `D1Database` and `Env` types from the generated declaration module. Service imports are explicit. Worker DOM declarations and binding-derived ProcessEnv types therefore stay outside Electron's ambient scope; use this command when regenerating instead of raw `wrangler types`.

`wrangler.jsonc` keeps both `MARKET_WRITES_ENABLED` and `MARKET_PUBLIC_PUBLISHING_ENABLED` false, an empty reviewer configuration and no default D1 binding. Only the isolated `local_test` environment declares a local-only database. Both tracked migrations, reviewer subject configuration, database provisioning/binding and the exact Worker deployment require separate production authorization. Private reviewer reads remain available when writes are paused; account public serving and writes have separate explicit flags. Root integration checks and service tests run in Windows, macOS and Linux CI; release workflow behavior is unchanged.

Sampled catalog logs record only a fixed operation name, GET/HEAD and status. Invocation logs are disabled, and traces redact query strings; traces can still retain request path/method. Never log request bodies, headers, cursors, credentials or raw exceptions. Public errors contain fixed messages/codes and bounded redacted diagnostics.

GH-477 adds anonymous `GET/HEAD /v2/listings/:listingId` for current public metadata and authenticated `GET/HEAD /v2/me/summary` for bounded owner summaries. Existing owner/version and hourly indexes cover the queries; no new migration is needed. Summary reads use the primary session and at most ten latest plus ten current approved metadata rows, independently of lifetime version history. Public single-listing metadata returns 404 while withdrawn. Curated v1 bytes and cache behavior stay unchanged. The desktop bounds a ten-listing summary at 512 KiB and requests twenty-row v2 catalog pages within the same ceiling; metadata remains capped at 16 KiB per authored record.

The bounded reviewer queue includes pending versions and versions with open reports, including withdrawn or replaced versions, so historical evidence remains reachable.
