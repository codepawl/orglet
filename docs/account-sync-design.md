# Orglet account and sync: technical design

**Status: design, not built** ([COD-329](https://linear.app/codepawl/issue/COD-329)). The product decisions are in [product.md](product.md) point 3. This page is how it would work. No account or sync code gets written before phase 0 below has run.

Prices and versions were read from the vendors' own pages on 2026-09-29. Cost figures are estimates built on the assumptions listed with them.

## What we are building

A person chooses between two ways of using Orglet:

- **A local profile.** This is today's Orglet: one SQLite file, no network except the providers they pick.
- **A CodePawl account.** The same app and the same SQLite file, plus a background sync to CodePawl's servers. Their orglets, crews and chats then show up on their other computers, on Orglet on the web and, later, on a phone.

Local-first is the rule in both cases. The SQLite file on each computer stays the source of truth, and the app works fully offline. Sync is a replication that catches up when it can.

## Pieces

| Piece | Where | Built with | Why |
|---|---|---|---|
| **Identity** (one CodePawl account for every CodePawl product) | `accounts.codepawl.com`, a Worker | [Better Auth](https://github.com/better-auth/better-auth) 1.7.x (MIT) on D1 | Covers email + password, emailed codes, Google and GitHub. It can also act as the OAuth/OIDC provider for other CodePawl sites. Free. |
| **Sync** | `sync.orglet.codepawl.com`, a Worker plus **one Durable Object per account** | Durable Object SQLite storage and hibernating WebSockets | Each account gets its own small, strongly consistent database. It pushes changes to open devices and costs nothing while idle. |
| **Files** | R2 bucket | Content-addressed blobs, keyed by `sha256` | Keeps big bytes out of the account database. R2 has no egress fees. |
| **Email** | Resend's free plan while Orglet runs free, then Cloudflare Email Service, from `codepawl.com` | Email Service needs the paid plan; codepawl-web already used it for Tacet's sign-in mail | Verification codes, password reset. |
| **Web app** (later) | `orglet.codepawl.com/app` | Orglet's renderer components and the shared Zod contracts | Reads and replies through the same sync API. |

The sync server lives in this repository (`services/sync`, AGPL-3.0), so anyone can deploy their own with `wrangler`. The identity service is shared by all CodePawl products, so it lives in its own repository.

### Why not an off-the-shelf sync engine

Checked 2026-09-29. None of these fit all three needs: offline writes on the desktop, no Postgres, and hosting on Cloudflare.

- **Zero** (Rocicorp): says it does not support offline writes. Replicache has been archived since 2022.
- **ElectricSQL:** read-path only, and needs Postgres.
- **PowerSync:** needs a Postgres, MongoDB or MySQL source database and its own service.
- **Turso Sync:** still beta, syncs only to Turso Cloud, and its own announcement warned of data loss while conflict handling was unfinished.
- **cr-sqlite:** no release since January 2024.

A small op-log is not much code, because every write in Orglet already goes through one place (`Store.put` and the revision helpers in `core/storage/database.ts`).

## Signing in from the desktop app

1. **First run.** A new install shows one screen with two choices: **Sign in** as the filled button, and **Use without an account**. There is no "recommended" label. Someone already using Orglet can sign in later from Settings, and their local data is uploaded then (see [Moving between local and account](#moving-between-local-and-account)).
2. **Sign in in the browser.** Pressing Sign in opens the system browser at `accounts.codepawl.com`, using OAuth 2.1 with PKCE, as RFC 8252 asks of desktop apps. There the person uses email + password (a 6-digit code confirms a new address and any sign-in from a new device), Google or GitHub.
3. **Back to the app.** The browser returns to the app through the `orglet://` link Orglet already registers ([integrations.md](integrations.md)). Better Auth's Electron plugin implements exactly this flow.
4. **Tokens.** Main stores the refresh token with `safeStorage`, like API keys today. The renderer never sees it. Core gets a short-lived access token from main for each sync connection.
5. **Signing out** keeps the local SQLite file and stops syncing. The person can also **Remove this computer's copy**, which erases it.

Passwords are hashed by Better Auth (scrypt by default). Codes last 5 minutes and allow 3 tries. Sign-in attempts are rate-limited per address and per IP.

## What syncs and what never does

**Syncs**, unless marked "only on this computer":

- Orglets, crews, skills and their revisions.
- Chats: tasks, turns, runs, events, reports, reactions, quotes.
- Knowledge notes and memories, schedules (the schedule, not its folder), custom connection names.
- A few settings: theme, language, sidebar order, chat titles.
- Saved file versions (`edited-sources`), and attached files up to a size cap.

**Never syncs.** These come from the storage survey; the backup already leaves out most of them:

- **Secrets:** API keys, MCP secret values, web search keys, the CLI token, browser profiles (cookies and sign-ins), harness sign-ins (they live in each CLI's own folder).
- **This computer's paths and grants:** workspace grants and the new-chat folder, source file paths, schedule folders, browser and desktop choices on a chat, granted desktop programs.
- **Run journals and scratch state:** tool calls, workspace copies and processes, checkpoints, leases, browser and desktop action journals and their screenshots.
- **Derived data:** the `chat_messages` search index (rebuilt locally), model lists, reviewed skills, app proposals, MCP server definitions (they name local commands).

**"Only on this computer."** A switch on each chat and each orglet. A local-only orglet makes all its chats local-only. Local-only rows never enter the outbox. Turning the switch on for something that already synced deletes its server copy, and the change record says so.

## Encryption

The server can read synced data (decided in COD-329; the web app, search and the router need it). Three layers protect it:

1. **Secrets never leave the device** (the list above).
2. **Confidential chats stay local** with the switch above.
3. **Everything synced is encrypted again at rest with the account's own key.**
   - Each account has a random 256-bit data key, wrapped with a master key that lives only as a Worker secret, and stored next to the account.
   - Each row's `data` and each R2 blob is AES-GCM encrypted with the data key, using WebCrypto in the Worker.
   - **Deleting an account deletes its wrapped key**, so its remaining ciphertext and backups can never be read again.
   - A `keyVersion` field lets the master key rotate by re-wrapping the data keys.

The per-account key is random, not derived from the master key (the research note suggested HKDF derivation). A derived key can always be derived again, and the promise that deleting the account destroys its key needs a key that exists nowhere else.

Transport is TLS everywhere. Cloudflare also encrypts Durable Object and R2 storage at rest underneath our layer.

## The sync model

### On the desktop: a change log

- **An outbox.** Every write to a synced table appends a row to a new `sync_outbox` table in the same SQLite transaction: `(table, id, hlc, deleted, data)`. The hook goes where `Store.put`, the revision helpers and the delete paths already are. When the person has no account, nothing is recorded.
- **HLC.** Each change carries a hybrid logical clock value: wall time, a counter and the device id. It gives an order that stays correct when two computers' clocks disagree.
- **Deletes** become tombstones (`deleted: true`), kept for 90 days.

### On the server: one Durable Object per account

- It stores the latest version of each row, the full-row `data` still encrypted, and a sequence number per change.
- **Push:** a device sends a batch from its outbox. For each row, the version with the higher HLC wins. The server gives accepted changes the next sequence numbers and replies with what it kept.
- **Pull:** a device asks for everything after the last sequence number it saw.
- **Poke:** devices with the app open hold a hibernating WebSocket. After a push, the object sends the others one small "new changes" message and they pull. A hibernating object is not billed for idle time.
- A new computer downloads a snapshot first, then pulls from that point on.

### Conflicts, by kind of data

| Data | Rule |
|---|---|
| Turns, runs, events, reports | Append-only with unique ids, so they never conflict. A run belongs to the computer that ran it; other devices see it read-only. |
| Orglets, crews, skills, notes (already revisioned) | Revisions are kept from both sides. The live row is the highest revision, ties broken by HLC. The losing edit stays in history, visible in the revision list. |
| A chat's own fields (title, archived, reactions, quotes) | Merge per field, not per row, so a reaction added on one computer and a rename on another both survive. Reactions become their own rows. |
| Settings | Per key, the higher HLC wins. |

### Changes the current schema needs

From the storage survey:

1. **Revision ids.** `nextRevision` is `MAX + 1`, so two offline computers can both write revision 5. Revisions get a unique id and an HLC, and the displayed number is assigned in order at read time.
2. **Split chat fields.** `task.messageReactions` and similar arrays inside the task JSON move to their own rows, or merge per field. Otherwise one computer's reaction overwrites another's.
3. **`updatedAt` and `hlc`** on synced rows. Today no row records when it changed.
4. **Local-only columns.** Machine-specific parts of a synced row (a source's path, a chat's folder grant) move to local side tables keyed by the same id, so the synced row carries none of them. The backup's `withoutBrowser` already strips some of this.
5. **Schema version on each change**, so an older app skips fields it does not know and never overwrites them.

Each is a normal migration (`SCHEMA_VERSION` 19 → 20+), tested without any server.

## Files

- **Uploads.** Saved file versions, and attachments under 25 MB in synced chats, go to R2 at `blobs/<account>/<sha256>`, encrypted with the account key. The synced row holds only the hash and size.
- **Downloads.** Another computer downloads a file only when it is opened.
- **Too big or not a copy.** Larger files, and sources that are only a path on this computer, show on other devices as "on the other computer" with the device's name. The chat still shows their name and what the orglet read.

## Moving between local and account

- **Local → account:** the existing data is uploaded as the account's first snapshot. It reuses the backup snapshot and its exclusion list (`storage/backup.ts`). Local-only chats stay out.
- **Second computer that already has local data:** the app asks to merge it into the account or replace it, with a count of chats and orglets on each side.
- **Account → local:** sign out and keep the data. **Delete account** removes the server copy and the wrapped key, and emails a confirmation. **Export** keeps working as the backup file.

## Web and phone (later)

- The web app signs in with the same account and reads the account's Durable Object. It uses the Zod contracts in `apps/desktop/src/shared/`, so the web and the desktop agree on shapes.
- **Replying from the web or a phone does not run anything there.** The reply is written as a pending turn. A desktop that has that orglet's harness picks it up and runs it (the relay [mobile.md](mobile.md) describes). If no desktop is online, the reply waits, and the page says so.
- Push notifications come with the phone app.

## Cost

A chatty client, as a worst case (estimates, not measurements; the lean protocol below cuts this sharply), per active account:

- 2,000 sync requests a day, a fifth of them writes of about 5 rows.
- 50 MB in R2, and a WebSocket open 8 hours a day with hibernation.
- Two code emails a month.

Prices are Cloudflare's, read 2026-09-29.

| Active accounts | 100 | 1,000 | 10,000 |
|---|---|---|---|
| Estimated monthly cost | about $5 | about $38 | about $840, or about $360 with 5× write batching |
| Biggest line | Workers Paid base ($5) | requests and rows written | rows written (about two thirds) |

Three things keep it there:

- **Hibernation.** Without it, idle WebSockets alone would cost about $1,400 a month at 1,000 accounts.
- **Batching writes.**
- **Few indexes on the account database.**

Better Auth is free. Email includes 3,000 messages a month, then $0.35 per 1,000.

## A lean protocol, and running free

The table above assumes a chatty client. The protocol decides the bill more than any price does. These rules apply from phase 3 whatever plan the account is on:

- **Batch pushes.** Collect outbox rows and push at most once every 30 seconds while changes keep coming. Several updates to the same row within a batch collapse into the last one.
- **Pull only when poked** or when the window gains focus. No polling timer.
- **Heartbeats cost nothing.** Answer pings with `setWebSocketAutoResponse`, which Cloudflare says neither wakes the object nor bills duration. Let the object hibernate between messages.
- **Store a batch compactly.** Store a pushed batch as a few rows, not one row per index. Compact a run's activity lines (one `events` row per line today) into one row when the run ends; in-progress lines stay local.
- **Nothing while the app is closed.** Sync runs only while Orglet is open.
- **Files on demand.** A file downloads only when it is opened, and there is a per-account cap while free.

Resulting estimate for an active account (assumptions, not measurements):

- About 100 requests and 100 rows written a day.
- About 5 MB of synced rows; files go to R2.

### On Cloudflare's free plan

Free plan limits, read 2026-09-29. They reset at 00:00 UTC. Past a limit, further operations of that kind fail until the reset.

- **Requests:** Workers 100,000 a day, Durable Objects 100,000 a day.
- **Durable Objects:** 13,000 GB-s a day, 100,000 rows written a day, 5 GB of SQLite storage in total.
- **D1:** 100,000 rows written a day, 5 GB.
- **R2:** 10 GB, 1M Class A and 10M Class B operations a month.
- **CPU:** 10 ms per request.

With the lean protocol that is room for **roughly 500 to 1,000 accounts active on the same day**. The first ceilings reached are:

- requests and rows written a day;
- the 5 GB storage total, which is about 5 MB of rows per account at 1,000 accounts.

**Email is not free on Cloudflare**: Email Service sending needs the paid plan. While free, codes go through Resend's free plan (3,000 a month, 100 a day, read 2026-09-29). Codes are sent only for a new address and a sign-in from a new device. Google and GitHub sign-in send no email.

**One risk to measure in phase 0:** password hashing is slow on purpose, and the free plan allows 10 ms of CPU per request. If Better Auth's hash does not fit, either passwords start on the paid plan or the free phase offers codes, Google and GitHub only.

**Staying safe on the free plan:**

- **A quota guard.** The Worker counts the day's requests and rows. Near a limit it tells clients to back off.
- **Degrade gracefully.** The app keeps working locally and shows "Sync resumes later" instead of failing.
- **Per-account caps** on synced rows and files.

**Moving to Workers Paid ($5 a month)** comes when any of these happens:

- more than about 400 accounts are active on a day;
- storage passes 3.5 GB;
- the email quota bites;
- password hashing needs more CPU.

With the lean protocol, the paid estimate becomes:

| Active accounts | 1,000 | 10,000 |
|---|---|---|
| Estimated monthly cost, lean protocol | about $6 | about $40 |

## Phases

| Phase | What | Proves |
|---|---|---|
| **0. Spike** (a few days) | Better Auth on Workers + D1 with the Electron browser sign-in. One Durable Object doing push, pull and poke for a toy table between two computers. | The two riskiest parts: Better Auth has no first-party Workers guide, and DO sync under real latency. |
| **1. Identity** | `accounts.codepawl.com`, the first-run chooser, sign in and out, the account page. No sync yet. | Accounts work end to end. |
| **2. Change log** | The schema changes above, HLC, outbox, local-only switches. Tested with two SQLite files merging, no server. | The merge rules are right before any network. |
| **3. Sync** | `services/sync`, push/pull/poke, first upload, second-computer download, tombstones, R2 files, encryption at rest. | Two computers stay in step, offline included. |
| **4. Account life** | Merge or replace on a second computer, delete account, conflict view in revisions, rate limits, audit log. | People can leave cleanly. |
| **5. Web** | Read and reply on `orglet.codepawl.com/app`, the relay to a desktop. | The ecosystem piece. |
| Later | Phone app and push, then the model router. | |

## Open, to settle during phase 0

- Whether a paid Workers plan and the Email Service daily quota for a new sender are enough for a public launch. Cloudflare does not publish the quota.
- Self-hosting: whether the desktop app gets a "sync server" setting in phase 3, or later.
- The attachment size cap (25 MB is a starting guess).
