# Marketplace: technical design

**Status: curated reads deployed; desktop publishing and moderation implemented; production writes await rollout** (COD-373). Decided with An on 2026-10-01: the marketplace moves out of [product.md](product.md)'s Not now, because the CodePawl account exists ([account.md](account.md)) and the marketplace should run on the same account and the same backend as sync ([account-sync-design.md](account-sync-design.md)).

## What we are building

A place inside Orglet to find ready-made orglets and crews and add them. Adding one is **making a friend**: the orglet joins your Friends list (the Discord-style shell, COD-366), you can DM it at once and put it in a channel. A crew arrives with its orglets.

- **Browsing and adding need no account.** The catalog is public. Orglet keeps working fully without an account, and someone on a local profile can still add a friend.
- **Publishing needs an account.** The listing carries the account's public name.
- **What you add is yours.** It becomes a normal local orglet (revision 1) that you can edit. It is never a live link to the author's copy.

## What a listing is

A listing is data in the template shapes Orglet already reads, checked with the same Zod schemas:

- **An orglet**: name, avatar, description, instructions, model suggestion (provider and ID, which the person can change), its skill as text, and an optional skill package.
- **A crew**: the existing `orglet-team-template` v1 from `core/storage/templates.ts`, with its orglets, skills and approved crew notes.

Plus listing fields: a slug, a short summary, tags, the language it was written in, a CC BY 4.0 license, the version, and the author.

**A listing never carries**, and the server rejects one that tries: scripts that run (skill package files stay files, as with every import today), MCP servers, the auto-apply switch, permissions, folder grants, browser or desktop grants, connections, keys or tokens, memories, or chats. These are the same things a template already leaves out, for the same reason: they belong to one person's computer.

## Pieces

| Piece | Where | Built with | Why |
|---|---|---|---|
| **Catalog API** | `market.orglet.codepawl.com`, a Worker in this repository (`services/market`, AGPL-3.0) | Phase one: immutable curated catalog and bodies in Git. Phase two: D1 for listings, versions and reports; content-addressed text bodies if separate storage is needed | Phase one needs no database or bindings. Mutable publishing will use D1 on the same Cloudflare account as identity and sync. Listings have no screenshots or image uploads. |
| **Identity** | `accounts.codepawl.com` | The existing service | Publishing sends the access token the desktop already holds. The market Worker verifies it locally against the accounts JWKS, the way `access-token.ts` does, with its own audience added. |
| **Desktop** | `core/market/` (fetch, verify, add), the Add friend page in the renderer | Zod contracts in `shared/market.ts` | Core fetches and verifies without account tokens; core turns a verified listing into local rows through the template import path; the renderer only shows it. |

The catalog is cached on the computer, so the Add friend page opens instantly and works offline with what was last seen.

## Adding a friend

1. The renderer asks core for the catalog page; core fetches it (no token needed) and validates every listing with Zod before anything is shown.
2. On **Add**, core downloads that listing version, checks its `sha256` against the catalog, parses it with the template schema, and writes the rows in one transaction, like `TeamTemplates.import`. Crew notes arrive as proposals, as they do now.
3. The new orglet records where it came from: `{ listingId, version }`. That is all the link there is.
4. Its model suggestion is applied only if the person has that connection; otherwise it uses the same first-ready connection rule as creating an orglet (Demo when none is ready), and a notice names the affected orglets. There is no separate global default setting.

## Updates

When a listing has a newer version, the friend's profile shows a quiet "Update available" with what changed. Applying it is a click and creates a new revision, so in-flight runs keep their snapshot and the person can go back. If the person edited the orglet, the update shows a side-by-side of their instructions and the new ones and never overwrites silently. Nothing updates by itself.

## Publishing

From an orglet's or crew's menu: **Publish to the marketplace**. Core builds the listing with the template export, then shows the person exactly what will be public before it is sent.

Before upload, on the computer and again on the server:

- A credential scan over authored text and decoded package files. It shares key and JWT recognizers with error reports, but does not use telemetry's broader masking of prose, paths and digests. A hit blocks publishing and points at a logical field or file index and line; diagnostics never repeat the matching value or filename. This detects recognizable credentials, not arbitrary confidential prose.
- Size caps: 2 MB per listing like templates. Listings are text only; avatar data uses the existing emoji, mascot and color fields. There are no image uploads or screenshot fields.
- The schema check above, so nothing outside the allowed fields leaves.

Unpublishing hides the listing from the catalog. People who already added it keep their copy.

## Trust and moderation

Listings are instructions and text, never code, so the worst a bad listing can do is give an orglet bad instructions. That is the same risk as a template file someone sends today, and it runs under the same permissions the person sets. Still:

- **Phase 1 is curated.** Only CodePawl publishes, so the first catalog is ready-made friends we wrote and tested.
- **Phase 2 opens publishing** to verified accounts, with a **Report** button, a review queue and a per-account publishing rate limit. Every submitted version waits for review before it appears.
- Instructions that tell an orglet to send data somewhere, or to ask for keys, are review-queue reasons.

## How it rides on sync

The marketplace does not wait for sync. Friends you add are ordinary orglets, so once sync phase 3 lands they sync like any other orglet, and their `{ listingId, version }` syncs with them. Publishing will use the account token from phase 1 identity, which exists now. Reading the curated catalog is public and needs no account. Entitlements (`account-sync-design.md#plans-and-billing`) get one more field, `publishedListings`, so a cap is a data change.

## Phases

| Phase | What | Proves |
|---|---|---|
| **1. Curated catalog** | `services/market` read API, CodePawl's own listings, the Add friend page's Discover section, Add friend, the update card. No account needed. | People find and add ready-made friends. |
| **2. Publishing** | Publish and unpublish from an account, secret scan, review queue, Report, rate limits. | Others can share safely. |
| **3. With sync** | Added friends and their origin sync across computers (needs sync phase 3). | One friends list everywhere. |
| Later | Search ranking by adds, ratings, collections, the web catalog on `orglet.codepawl.com`. | |

## Decisions (2026-10-02)

- Listings are shared under **CC BY 4.0**.
- Models and harnesses are **suggestions only**, never required connections.
- Listings are **text only**, with no screenshots, image uploads or image storage. Existing avatar data is allowed.


## Phase-one behavior

**Home → Add friend → Marketplace → Discover** opens a validated local catalog immediately and refreshes the public read API in the background. It labels an online catalog, a previously saved catalog, and the bundled CodePawl seed separately. Saved pages and Add actions remain usable while refreshing. Selecting a cached page fences the initial background response, so a late refresh cannot replace that selection. A failed refresh says so and keeps the local copy; it never reports a successful server fetch. Downloaded bodies are size-capped, SHA-256 checked and strictly parsed before caching or import. A corrupt cache cannot bypass those checks. An existing version cannot change its hash or move backward during refresh.

Listings keep names and summaries ahead of grouped type, public author, language/version and license metadata. **Added** and **Update available** describe local copies. **Add another copy** creates a separate friend; it does not replace or update an existing copy. Report and per-version reviewer actions live in the listing's keyboard-accessible options menu. Closing a report returns focus to that menu's persistent trigger.

Each Add is one transaction for skills, orglets, the optional crew and its proposed notes, and `{ listingId, version }` origin metadata. Crew orglets share the references declared in the template; a crew becomes a channel through the existing adoption path. No account, chat history, memory, secret, permission, folder or MCP grant arrives with it. Skill packages remain files awaiting the same local review as template imports; nothing executes during Add.

Crew templates carry up to eight members and a lead that may be one of those members or a separate orglet. Local imports, public submissions and backup origin links therefore allow up to nine distinct orglets and nine distinct skills. Shared skills appear once; every orglet and skill must be referenced, and duplicate or missing keys are refused. The template format remains version 1. Older clients with five-entry template limits reject larger templates; they need an updated client to import them. Immutable v1 curated bodies stay unchanged. Larger account listings will use the forthcoming v2 publishing and desktop read path. The 2 MB listing limit and decoded skill file/package limits still apply.

Origin metadata lives in SQLite settings independently of editable worker inputs, so editing an orglet keeps its marketplace link. The profile refreshes the catalog and offers **Update available**; Discover also lists updates for installed orglets and crews. The card shows the changelog, current and incoming instructions, names, descriptions, avatar data, skill/package metadata and crew settings and roster. It marks a customized copy. Applying explicitly replaces template content, keeps existing connection choices and local privilege switches, creates new worker/crew revisions, reuses unchanged skills, and copies changed skills to avoid changing unrelated orglets. Removed crew members remain local friends. Existing channel membership follows the revised crew; in-flight run snapshots and earlier revisions remain intact. Edits, archive or deletion after review invalidate the card before the transaction writes any entity.

### Installed copies across computers

With account sync, an installed orglet or crew reaches the account's other computers as ordinary records: its orglets, skills and crew, and one origin record per installed copy, keyed by the copy's own id (GH-479). The origins are never one shared list, so two computers that each add the same listing while apart keep two copies with two origins. The receiving computer does not install anything, fetch a listing body or get a permission, a folder or a connection; the copy arrives the way any synced orglet does.

An origin's baseline says what was installed, so an update card can tell whether the copy was edited. The baseline `authoring-v1` is a digest of only the content an update replaces: each orglet's name, instructions, description, avatar and limit, the skill it uses now, and the crew's settings with members named by their template keys. It leaves out ids, local revision numbers and the choices an update never replaces (connection, model, effort, auto-apply, MCP servers), so every computer computes the same value, and changing a connection is not an edit. Add and Apply write it. An origin saved before this change hashed the adding computer's whole rows: a match still means unchanged, and a mismatch is reported as **unknown**, not as edited, because the copy may only have arrived from another computer. The update card then asks the person to compare both sides. Applying an update writes a comparable baseline from then on.

The update card's token is separate and stays exact: it covers this computer's current rows, revision numbers included, so an edit or a synced change that lands while the card is open invalidates the click.

A copy marked **Only on this computer** sends neither its orglets and skills nor its origin. Deleting an installed copy removes it on the other computers and a stale copy cannot bring it back. Catalog pages and listing bodies are cached per computer and never sync. Unpublishing a listing does not remove installed copies.

The API and deployment setup are in [services/market](../services/market/README.md). Public publishing remains a later phase. Cached catalogs are local application data, and origin metadata syncs only as described above; full Data erase clears them. Workspace backups carry validated origin links with their local entity IDs, but no catalog or downloaded body cache. Additive restore keeps an existing local origin with its existing entity rows and adds missing links; dangling references or conflicting listing identities are rejected.

## Desktop publishing

An orglet's menu and a crew channel's menu offer **Publish to marketplace**. A normal channel has no publishing action. The local form asks for a public name, summary, tags, language and changelog. A built-in connection/model can be suggested without changing the local orglets' connection choices. Preview selects only template instructions, skills, avatar data, crew settings and approved non-memory crew notes. Chats, local IDs, permissions, folders, private connections and account credentials stay on the computer.

The form groups public metadata first, with optional version notes and model suggestions behind a disclosure. The preview leads with readable public names, summaries and instructions; labelled disclosures retain every decoded text skill file and the complete exact submission JSON. Nothing executes. Credential or package diagnostics identify a safe logical path and rule; edit the original content and preview again. Sending requires separate license and pending-review acknowledgements and an explicit **Send for review** click in the stable action footer. Every version starts pending. The recorded submission receipt says **Submitted for review**; the latest owner summary separately shows its current pending, approved or rejected state. No reviewer reason or moderator-hidden status is invented.

Preview binds the source revisions, public metadata, current account generation and target listing summary for ten minutes. Source edits, account changes, changed target state or expiration refuse the initial send. Unrelated chat events do not discard a preview. Core rechecks the persisted source and current server summary at the final save boundary. It writes an immutable request and idempotency key to SQLite before main may dispatch it. A timeout, lost response or malformed success remains **Unknown**. **My listings** lets the person inspect the exact saved public content and retry those same bytes/key, including after an app restart. A failed retry cannot establish that the original attempt never committed. Starting, reconnecting or opening the page never resends an operation.

The device journal allows ten unresolved operations and keeps at most twenty records. It blocks a new send when unresolved capacity is full; it never evicts an uncertain request to make room. Settled records can be compacted. The journal is excluded from backup export, backup import, sync and templates. A restored workspace cannot acquire another account's saved publishing authority. A retry requires the original signed-in account; tokens and opaque internal account/generation context never enter renderer views.

Open the **My listings** tab to read at most ten listing summaries; **Refresh my listings** requests them again. Latest review status and the currently published version are separate. The server's publication epoch identifies a withdrawn listing, and hidden listings retain their moderation reason. Verified allowance counters stay visible. The response explicitly reports whether the server write gate is enabled; a bound D1 alone does not make submission ready. Reads still work with the gate closed. Account changes clear the old view and load the new account's read-only state. Responses from a previous account generation cannot restore its listing names, saved content or operation history after switching accounts. The summary does not scan lifetime history or infer withdrawal from a missing catalog page. Unpublish confirmation binds that fresh summary, then withdraws the whole listing. Installed local copies remain intact. The server's unpublish action is listing-wide; it has no version compare-and-swap payload. A lost unpublish response follows the same immutable retry rules.

Discover reads bounded v2 pages and falls back to the curated v1 catalog on a service without v2. Existing seed body URLs remain v1. New account installs and updates fetch the exact body from the server even if older metadata or body bytes remain cached; withdrawal therefore blocks a new install while preserving previously installed copies. Account bodies are not stored as reusable catalog-body cache. Installed account listings always offer **Check for updates**, which looks up that listing's current public metadata directly even when it is off the visible page. A 404 or failed check keeps the installed copy and does not claim a successful availability check. Exact approved historical bodies are still readable whenever their listing is currently public; withdrawal hides them until an approved republish.

Discover offers Previous and Next page controls. SQLite retains the first page and up to nine recent additional pages, with at most 200 metadata records in total. Previous reads the retained page without requiring the network. When using saved data, Open a saved page also opens any retained page directly, including after an offline restart with gaps in the page history. An evicted page returns to the first page with a specific explanation. Refreshing the first page starts a new page history; a transient v2 failure preserves saved pages rather than replacing them with the v1 seed catalog. Navigation can proceed during the initial background refresh; its later response cannot overwrite the selected page.

A source using a private connection opens the model-suggestion disclosure and requires an explicit built-in connection suggestion before preview. The local connection is unchanged. When the service disables publishing, owner summaries and saved-request inspection remain available, while withdrawal and retry are disabled with an explanation. Service unavailability does not suggest signing in again.

Production remains the read-only service without a publishing database. The desktop preview works locally, but sends stay unavailable until the moderation rollout enables the bound service. Local trusted transport fixtures are distinct from a positive authenticated Worker HTTP/signature proof, which remains unverified.

## Human review and reports

Account listing rows offer **Report** for the exact public version. A verified account can send a short reason without a publisher allowance. Reports are unique per account/version, limited to ten accepted reports in a rolling 24 hours, and never hide content automatically. The form warns against private data and credentials; it accepts text only. Curated templates remain maintained in Git and use their existing review process.

The **Review marketplace** entry appears only after fresh server capability. Authority comes from a strict Worker configuration of exact subjects under the trusted issuer, checked on every private read and action. Missing, empty or malformed configuration grants nobody review access. A paid plan, public name, caller header or publisher allowance grants no reviewer role. An authorized reviewer may review their own listing, but must inspect it and make the same explicit audited decision.

The drawer shows the complete escaped version text and decoded skill files, the previous approved version on demand, reports and review history. A reason and an explicit acknowledgement precede approve, reject or listing-wide hide. The decision carries the exact version/body SHA, complete-content digest and the state revisions shown in the drawer. A conflict requires reopening the version; it never silently substitutes newer content. The server records actor, reason, exact target and self-review in the same D1 batch as the decision. Report dismissal/resolution separately checks the report revision. Evidence and instructions are inert text: they are never run, sent to an agent or loaded as linked resources.

A pending update leaves the previous approved version visible. Unpublish advances the publication epoch so an earlier pending submission cannot revive the listing. Moderator hide also fences approval and remains in effect after owner submissions; there is no automatic restoration, appeal or report-count takedown. Authors can see the latest decision reason and hidden status in **My listings**. Neither report evidence nor reporter identity enters public or owner catalog responses. Installed local copies remain intact.

The reviewer queue includes pending versions and any historical version with open reports, even after withdrawal or replacement. Decisions require successful inspection through the last report page. Accepting or resolving a report advances the review revision, so evidence changes invalidate an earlier decision snapshot. Curated seed reads never wait on D1 readiness. Failed journal reads retain known recovery entries and show an explicit retry.

Uncertain reports and decisions retain their exact request/key in a private core-owned SQLite journal, limited to ten unresolved actions across the device, including actions from other accounts. A full journal blocks new actions without evicting evidence or revealing another account's inputs; sign in to the original account to resolve them. Closing a drawer or restarting does not send anything. **Unresolved reviews and reports** lets the original signed-in account inspect and explicitly retry the saved action. A later refusal does not overwrite an earlier unknown outcome; a verified success receipt clears it. This journal is excluded from backups, templates and sync. Service pauses leave reviewer inspection available and disable mutations with an availability explanation.

Account-public reads additionally require the explicit public flag, valid nonempty reviewer configuration and the working moderation migration contract. The default remains closed, with both write/public flags false and no production database binding. The deployment approval covers the exact Worker revision, D1 creation/binding and migrations, trusted reviewer subjects, and enabling the flags. The existing read-only deployment is not that approval.

## Public content contract

COD-378 prepares account authentication without adding a write route. Main requests sync and market resources in one PKCE browser grant, then obtains a separate token for each audience. Refresh rotations are serialized and persisted before another resource refresh starts. Old saved credentials without resource metadata remain sync-only; `invalid_target` asks for a browser grant upgrade without expiring a usable sync grant. Account generation checks fence network responses and asynchronous credential saves; failed rotation persistence blocks reuse until a fresh grant or sign-out.

The market verifier checks the fixed accounts issuer and JWKS, the exact market audience (plus the issuer's standard OAuth userinfo audience), `orglet-desktop`, required scopes, verified email, a bounded public name and signed `publishedListings` from 0 to 10. A missing cap is unavailable. A signed `orglet_grant_id` comes from the issuer's validated authorization-code family and survives rotations; browser session IDs and random JWT IDs are not grant families. Claims can remain valid for the existing 15-minute token lifetime; immediate family revocation is separate work. Curated GET/HEAD reads remain anonymous, and no publishing, identity cleanup, D1 or sync route is added here.

COD-377 adds a strict content-only submission validator and a seeded `GET`/`HEAD /v2/catalog` route. The desktop continues to read v1. V1 catalog authors remain the literal `CodePawl`, and its immutable template URLs, bytes and hashes remain unchanged. V2 authors contain only a bounded public display name; pagination accepts limits from 1 to 100 and rejects invalid or stale cursors with 400. Curated listing IDs are reserved and cannot be claimed by future account listings.

A submission contains kind, name, summary, tags, language, license, changelog and a matching orglet or crew template. Public fields are explicitly selected rather than inherited from local settings. Provider/model and semantic thinking effort are suggestions. Custom connection IDs, native effort resolutions, capability metadata, local IDs, review receipts and grants are refused. Ownership, listing/version IDs and review state belong to the later authenticated handler, which is not implemented here.

Packages use canonical base64, bounded decoded sizes, fatal UTF-8 and no NUL bytes. All published package files must be text. Public frontmatter refuses aliases and explicit YAML tags. Case-insensitive collisions and file/directory conflicts are rejected, and SKILL.md name/content must match the preview. Manifest checks preserve existing supported report schemas and tool/permission blockers. Desktop imports retain their synchronous hashes and still require local review before use. Resources are files; validation and import never execute them.

The template-body SHA proves import byte integrity. A separate canonical complete-content digest covers every authored metadata field plus the template, so changing only a summary, tag or changelog requires a new review. Package review identity includes `orglet.json`; its own `version_hash` excludes that manifest, as before. Neither hash is a client-supplied approval. Credential diagnostics stop at a bounded count while still refusing the entire submission. No authenticated write route, moderation storage, desktop publishing UI or sync ships in this step; local tests and a Worker dry run do not establish deployment.

## Owner submission service

GH-476 adds the D1 repository and authenticated v2 handlers. Production writes require both a `MARKET_DB` binding and `MARKET_WRITES_ENABLED=true`. The default deployment has neither an enabled flag nor a database binding. Publishing remains closed until the moderation and reporting flow is available. No desktop publishing UI ships in this change.

`POST /v2/listings` creates an account-owned listing identity. `POST /v2/listings/:listingId/versions` adds an immutable version to an existing identity of the same kind. Both accept the strict public submission and an `Idempotency-Key` header. The server assigns ownership, IDs and version numbers. Every successful version starts pending; a caller cannot supply approval or publication state. One account can hold ten listing identities across all states, or a lower signed entitlement. Unpublishing does not reclaim a slot. Existing identities can receive new versions even if the current signed cap is lower than their count, subject to ownership and the hourly limit.

One atomic D1 batch reserves the receipt, allocates the version, checks ownership and quota, stores the body chunks and creates the pending review row. Failed batches leave no receipt or quota charge. At most five new versions succeed per rolling hour, including initial submissions. Exact retries return the committed receipt without charging again; changing the operation, target or authored content under the same key returns 409. Immutable content and complete-content review digests remain separate from the template-body SHA.

Normalized template JSON is limited to 2 MiB and stored in at most eight 256 KiB chunks. Reads verify chunk order, count, byte length, fatal UTF-8 and SHA before returning content. The raw request has a separate bound of 2 MiB plus 16 KiB metadata and 12 joining bytes. Metadata allows at most 2,640 authored UTF-16 units; worst-case JSON escaping uses 15,840 bytes, with fewer than 544 bytes for fixed keys, enums and punctuation. Raw whitespace also counts toward the envelope limit. Neither streaming nor a false Content-Length can bypass it.

`GET`/`HEAD /v2/me/listings` returns bounded owner-only versions, review states and safe allowance counters from the verified entitlement and primary D1 reads. It exposes no account subject, email or grant family. `GET`/`HEAD /v2/me/listings/:listingId/versions/:version` previews any version owned by that account with `no-store`. Sync tokens do not authorize these routes.

`POST /v2/listings/:listingId/unpublish` accepts an empty JSON object and an idempotency key. It hides the whole listing, clears the published pointer and advances its publication epoch. The action applies to the listing regardless of which version a person last previewed; it is not a conditional version update. A late review cannot publish a version captured before that epoch. An exact unpublish retry returns its original receipt and cannot clear a later republished pointer. Installed local copies stay intact.

With D1 bound, `/v2/catalog` merges the curated seed and current approved published pointers using bounded keyset pages, with limits from 1 to 100. Account version URLs use `/v2/listings/:listingId/versions/:version`. Pending content stays private, and every account body read rechecks current primary visibility before HEAD or ETag revalidation. Account catalogs, bodies, previews and errors use `no-store`; unpublishing therefore hides previously approved version URLs while the listing is withdrawn. Approved history becomes readable again only when an approved current-epoch version republishes the listing; pending and rejected versions stay private. Curated v1 bytes and immutable cache behavior stay unchanged, and the same curated bodies are also available at v2 version URLs.

Local verification runs the bundled Worker and tracked migrations against actual local D1, including rollback, concurrent quotas, idempotent retries, chunk boundaries and public visibility. Signature-verifier tests use ephemeral local keys in Node. Positive authenticated HTTP behavior in workerd remains unverified; the repository fixtures supply a trusted synthetic identity only inside a separate test bundle. They are never installed by the production entry or configuration.
