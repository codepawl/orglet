# Curated marketplace API

The phase-one Worker serves text-only CodePawl orglet and crew templates under CC BY 4.0. Reading needs no account. Publishing, uploads, account tokens, D1 and R2 are not part of this phase. Catalog source and immutable template bodies live in `apps/desktop/src/shared/market-seed.ts`, which also supplies the desktop's clearly labelled offline seed.

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
