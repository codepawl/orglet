# Marketplace read API

The phase-one Worker serves text-only CodePawl orglet and crew templates under CC BY 4.0. Reading needs no account. Publishing, uploads, D1 and R2 are not part of this phase. Catalog source and immutable template bodies live in `apps/desktop/src/shared/market-seed.ts`, which also supplies the desktop's clearly labelled offline seed.

`src/auth.ts` prepares a local JWKS verifier for future authenticated handlers; no route calls it yet. It trusts only `https://accounts.codepawl.com/api/auth`, its `/jwks`, and a market token for `orglet-desktop` with the required scopes, stored verified email/public name, signed grant family and bounded listing entitlement. Sync bearer tokens and mixed cross-product audiences are refused. JWT signature, issuer, audience and expiry checks use pinned jose 6.2.12. Tests may supply an ephemeral local JWKS; production uses the fixed remote issuer. Anonymous reads stay unchanged. Claims can lag issuer changes by the existing 15-minute token lifetime; immediate family revocation is later work.

`GET /v1/catalog` returns validated listing metadata. `GET /v1/listings/:listingId/versions/:version` returns the exact JSON body whose SHA-256 appears in the catalog. Bodies use immutable cache headers and ETags. GET and HEAD revalidation accepts weak ETags, validator lists and `*`, including the weak validators Cloudflare returns for compressed bodies. Other methods return 405; missing versions return 404. Desktop imports independently verify the bytes, strict template fields and references before creating local rows.

Install tooling separately from the Electron workspace:

```powershell
pnpm --dir services/market install --frozen-lockfile
pnpm --dir services/market dev
pnpm --dir services/market check:deploy
```

The pinned Wrangler version is 4.143.0. `wrangler.jsonc` names `orglet-market`, disables workers.dev, and declares the custom domain `market.orglet.codepawl.com`. There are no bindings or secrets to provision in phase one. Deployment is a separate authorized action: commit and push first, then run `pnpm --dir services/market deploy` from that exact checkout with the intended Cloudflare account. Verify the live catalog and a body hash afterward; a local dry run does not establish deployment.

Add a new immutable body key when editing a published listing. Increment its version and write its changelog in the current metadata; retain earlier bodies for existing version URLs. Never change a body under an existing version. `tests/integration/marketplace.test.ts` exercises the real fetch handler and desktop integrity/import/update behavior. Run the root `pnpm typecheck`, `pnpm test` and `pnpm i18n:keys` before shipping.

Cloudflare configuration follows the [Wrangler reference](https://developers.cloudflare.com/workers/wrangler/configuration/). A mutable catalog, account publishing and moderation will introduce D1 in phase two without changing these read routes. No image routes or image storage are planned.

`GET /v2/catalog?limit=50` serves the same curated seed through a separate public-author contract. Authors contain `displayName` only. Limits are 1–100; pass the returned `nextCursor` to continue. Cursors bind the catalog snapshot and position; invalid, noncanonical or stale cursors return 400. HEAD has the same status and headers with no body. V1 remains the desktop default, and template bodies remain at their existing immutable v1 URLs. Future account versions need separate visibility/cache rules; this seed does not implement unpublishing.

The v2 seed passes through `validateMarketSubmission`, the portable content-only boundary also intended for later desktop/server publishing callers. It refuses unknown fields, invalid crew references, recognizable credentials, nontext or malformed packages, preview/package mismatches and unsupported manifest controls. Diagnostics use logical fields/file indexes and line numbers without matching values. A template SHA covers body bytes; `reviewDigest` separately covers the entire authored submission, including metadata. There is no POST/authentication/D1 facade or publish action.

Safe sampled logs record only a fixed operation name, GET/HEAD and status for v2 requests. Invocation logs are disabled, and traces redact query strings; traces can still retain request path/method. Request bodies, headers, cursors, credentials and raw exceptions must never be logged. Local handler tests and `check:deploy` validate behavior/bundling; neither proves a live deployment.
