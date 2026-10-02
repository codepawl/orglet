# Marketplace: technical design

**Status: curated phase one implemented; deployment is a separate release step** ([COD-373](https://linear.app/codepawl/issue/COD-373)). Decided with An on 2026-10-01: the marketplace moves out of [product.md](product.md)'s Not now, because the CodePawl account exists ([account.md](account.md)) and the marketplace should run on the same account and the same backend as sync ([account-sync-design.md](account-sync-design.md)).

## What we are building

A place inside Orglet to find ready-made orglets and crews and add them. Adding one is **making a friend**: the orglet joins your Friends list (the Discord-style shell, [COD-366](https://linear.app/codepawl/issue/COD-366)), you can DM it at once and put it in a channel. A crew arrives with its orglets.

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
| **Desktop** | `core/market/` (fetch, verify, add), the Friends page in the renderer | Zod contracts in `shared/market.ts` | Core fetches and verifies without account tokens; core turns a verified listing into local rows through the template import path; the renderer only shows it. |

The catalog is cached on the computer, so the Friends page opens instantly and works offline with what was last seen.

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

- A secret scan over every text field (key and token patterns, the same masking rules as error reports). A hit blocks publishing and points at the line.
- Size caps: 2 MB per listing like templates. Listings are text only; avatar data uses the existing emoji, mascot and color fields. There are no image uploads or screenshot fields.
- The schema check above, so nothing outside the allowed fields leaves.

Unpublishing hides the listing from the catalog. People who already added it keep their copy.

## Trust and moderation

Listings are instructions and text, never code, so the worst a bad listing can do is give an orglet bad instructions. That is the same risk as a template file someone sends today, and it runs under the same permissions the person sets. Still:

- **Phase 1 is curated.** Only CodePawl publishes, so the first catalog is ready-made friends we wrote and tested.
- **Phase 2 opens publishing** to any verified account, with a **Report** button, a review queue, a per-account publishing rate limit, and listings from new accounts held for review before they appear.
- Instructions that tell an orglet to send data somewhere, or to ask for keys, are review-queue reasons.

## How it rides on sync

The marketplace does not wait for sync. Friends you add are ordinary orglets, so once sync phase 3 lands they sync like any other orglet, and their `{ listingId, version }` syncs with them. Publishing will use the account token from phase 1 identity, which exists now. Reading the curated catalog is public and needs no account. Entitlements (`account-sync-design.md#plans-and-billing`) get one more field, `publishedListings`, so a cap is a data change.

## Phases

| Phase | What | Proves |
|---|---|---|
| **1. Curated catalog** | `services/market` read API, CodePawl's own listings, the Friends page's Discover section, Add friend, the update card. No account needed. | People find and add ready-made friends. |
| **2. Publishing** | Publish and unpublish from an account, secret scan, review queue, Report, rate limits. | Others can share safely. |
| **3. With sync** | Added friends and their origin sync across computers (needs sync phase 3). | One friends list everywhere. |
| Later | Search ranking by adds, ratings, collections, the web catalog on `orglet.codepawl.com`. | |

## Decisions (2026-10-02)

- Listings are shared under **CC BY 4.0**.
- Models and harnesses are **suggestions only**, never required connections.
- Listings are **text only**, with no screenshots, image uploads or image storage. Existing avatar data is allowed.


## Phase-one behavior

**Home → Friends → Add friend → Discover** opens a validated local catalog immediately and refreshes the public read API in the background. It labels an online catalog, a previously saved catalog, and the bundled CodePawl seed separately. A failed refresh says so and keeps the local copy; it never reports a successful server fetch. Downloaded bodies are size-capped, SHA-256 checked and strictly parsed before caching or import. A corrupt cache cannot bypass those checks. An existing version cannot change its hash or move backward during refresh.

Each Add is one transaction for skills, orglets, the optional crew and its proposed notes, and `{ listingId, version }` origin metadata. Crew orglets share the references declared in the template; a crew becomes a channel through the existing adoption path. No account, chat history, memory, secret, permission, folder or MCP grant arrives with it. Skill packages remain files awaiting the same local review as template imports; nothing executes during Add.

Origin metadata lives in SQLite settings independently of editable worker inputs, so editing an orglet keeps its marketplace link. The profile refreshes the catalog and offers **Update available**; Discover also lists updates for installed orglets and crews. The card shows the changelog, current and incoming instructions, names, descriptions, avatar data, skill/package metadata and crew settings and roster. It marks a customized copy. Applying explicitly replaces template content, keeps existing connection choices and local privilege switches, creates new worker/crew revisions, reuses unchanged skills, and copies changed skills to avoid changing unrelated orglets. Removed crew members remain local friends. Existing channel membership follows the revised crew; in-flight run snapshots and earlier revisions remain intact. Edits, archive or deletion after review invalidate the card before the transaction writes any entity.

The API and deployment setup are in [services/market](../services/market/README.md). Public publishing and sync remain later phases. Cached catalogs and origin metadata are local application data; full Data erase clears them. Workspace backups carry validated origin links with their local entity IDs, but no catalog or downloaded body cache. Additive restore keeps an existing local origin with its existing entity rows and adds missing links; dangling references or conflicting listing identities are rejected.
