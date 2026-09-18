# Fetching model lists

Plan for [COD-29](https://linear.app/codepawl/issue/COD-29) under epic [COD-27](https://linear.app/codepawl/issue/COD-27). **This page is the decision.** [COD-31](https://linear.app/codepawl/issue/COD-31) implements fetch + cache; [COD-28](https://linear.app/codepawl/issue/COD-28) is the picker UI; [COD-30](https://linear.app/codepawl/issue/COD-30) is the deprecated chip.

**Shipped (COD-31):** `modelList` fetches each connection from its native API or CLI, caches the result in SQLite `settings.modelLists` (24h TTL, stale-while-revalidate), stores OpenAI `shutdown_date` and Codex `upgrade` when present, and always allows a typed custom model ID.

**Shipped (COD-28):** Worker settings persist optional `modelId`. The dialog lists cached models and always accepts a typed ID (`customIdOk`). Catalog defaults are suggestions. Adapters and harness CLIs use the saved ID.

**Shipped (COD-30):** The worker model picker chips a selected or suggested model when cached `deprecated` is true. The sunset day is shown only from native `sunsetAt` (OpenAI `shutdown_date`). Anthropic, xAI and harness HTML dates are not scraped or guessed. Codex `replacementId` is plain “prefer” text, not an auto-switch. No toast on dialog open.

It does not add feature UI, scrape HTML, or change signing / [COD-19](https://linear.app/codepawl/issue/COD-19) / [COD-20](https://linear.app/codepawl/issue/COD-20). Team chat ([COD-24](https://linear.app/codepawl/issue/COD-24)) is unrelated.

## Decision in one paragraph

Fetch each connection's model list from **that provider's own API or CLI**. Cache the result in local SQLite. Opening worker settings must not hit the network every time. If the fetch fails, keep the last good cache (even if stale) and **always allow typing a custom model ID**. Catalog names in the app today (`GPT-4.1 mini`, `Claude Haiku 4.5`, `grok-3-mini`) become suggestions, not a lock. Do not scrape docs pages. Do not send Orglet traffic through OpenRouter, LiteLLM, models.dev, or any other aggregator unless a native list is missing **and** the aggregator is clearly better — none of Orglet's current connections meet that bar.

## What Orglet does today

A worker stores `provider` and optional `modelId` (`apps/desktop/src/shared/contracts.ts`). Absence of `modelId` means the catalog suggestion for that provider (or the CLI default for a harness). Verified prices for the three pinned IDs stay in `apps/desktop/src/core/adapters/catalog.ts`:

| Provider | Pinned ID | Price snapshot |
|---|---|---|
| OpenAI | `gpt-4.1-mini-2025-04-14` | $0.40 / $1.60 per MTok |
| Anthropic | `claude-haiku-4-5-20251001` | $1.00 / $5.00 per MTok |
| xAI | `grok-3-mini` | $0.30 / $0.50 per MTok |
| Demo / Claude Code / Codex / Cursor | (none) | No Orglet reservation |

The worker dialog labels those three IDs as suggestions in the picker (`WorkerDialog.tsx`, `workerModel.ts`). A saved `modelId` is frozen onto `run.snapshot.model`. Custom OpenAI/Anthropic IDs are not billed at mini/Haiku rates (unknown reservation until a later COD stores a verified price). xAI native tenths from the cached list are used when present. Harness runs pass `--model` / `-m` when `modelId` is set.

## Per-provider source

Checked against official docs on 2026-09-18. Revalidate URLs before COD-31 lands if a provider changelog disagrees.

| Connection | Source | Why this, not an aggregator | Deprecation / sunset in that source |
|---|---|---|---|
| **OpenAI API** | Native `GET https://api.openai.com/v1/models` with the saved key (SDK `client.models.list()`). | Account-specific availability. Same key Orglet already stores. | **`shutdown_date`** (`YYYY-MM-DD` or null) on the model object. Treat non-null as deprecated + sunset. No separate `deprecated` boolean. |
| **Anthropic API** | Native `GET https://api.anthropic.com/v1/models` (SDK `client.models.list()`, paginate `limit` up to 1000 until `has_more` is false). | Already the Messages API we call. Returns `id` + `display_name`. | **None.** `created_at`, capabilities, token limits only. Retirement dates live on the HTML deprecations page — **do not scrape it.** |
| **xAI (Grok) API** | Native `GET https://api.x.ai/v1/language-models` with the saved key. | Chat/tool models plus **native prices**. Better than `/v1/models`, which mixes image-generation rows Orglet cannot run. | **None.** Retirement notices are HTML ([May 15 retirement](https://docs.x.ai/developers/migration/may-15-retirement)) — do not scrape. |
| **Claude Code** | No list command. Ship the documented `--model` **aliases** (`sonnet`, `opus`, `haiku`, `fable`) plus custom ID. | Official CLI has `--model` but no `claude model list` ([feature request](https://github.com/anthropics/claude-code/issues/12612)). `/model` is interactive. Anthropic Models API **rejects** Claude Code OAuth. | **None.** Aliases are not versions and have no sunset. |
| **Codex** | Native `codex debug models` JSON on the detected executable (logged-in). Fall back to `codex debug models --bundled` if the remote catalog refresh fails. | Official CLI JSON. Do **not** start Codex app-server (`model/list`) — [capabilities.md](capabilities.md) already keeps app-server off. | No sunset date. Optional **`upgrade`** (replacement slug) and `visibility` if present. Map `upgrade` as `replacementId` for COD-30 copy, not as a date. |
| **Cursor Agent** | Native `agent --list-models` (same as `agent models`) on the detected executable. Prefer the flag so older builds do not treat `models` as a prompt. | Official CLI. Account-specific. | **None.** Text rows `id - display name` only. |
| **Demo** | No fetch. | Demo calls no API. | n/a |

### Display filter (OpenAI only)

`/v1/models` returns embeddings, audio, images, moderation, and chat IDs together. There is no capability field. COD-31 may **hide** IDs whose prefix is in this deny list from the suggestion list (not from custom-ID accept):

`text-embedding`, `embedding`, `whisper`, `tts`, `dall-e`, `gpt-image`, `chatgpt-image`, `omni-moderation`, `transcribe`, `sora`, `computer-use`, `babbage`, `davinci`, `ada`

Do not invent a chat allowlist that drops a new family. A typed ID is never rejected because it failed the display filter.

xAI: keep rows whose `output_modalities` include `text`; drop image-generation-only. Anthropic's list is already Messages models.

### Aggregators considered and rejected

| Aggregator | Why not |
|---|---|
| OpenRouter `/api/v1/models` | Different account and bill. Orglet already holds native keys. |
| LiteLLM / any local proxy | Extra process Orglet does not ship or detect. |
| [models.dev](https://models.dev) `api.json` | Community catalog, not this key's availability. `status: deprecated` has **no sunset date** (v2 only proposes one). OpenAI already returns `shutdown_date` natively. Not clearly better. |
| Provider HTML (OpenAI deprecations, Anthropic deprecations, xAI migration pages) | Forbidden. Fragile, ToS-risky, and the epic says avoid scrape/heuristic. |

A later COD may add an optional community overlay **only** if a native list is still missing *and* An wants unofficial sunset dates. That is not this plan.

## Canonical record (COD-31 stores this)

Normalize every source into one object. Unknown fields stay omitted, never invented.

```
provider        openai | anthropic | xai | claude-code | codex | cursor
id              exact slug sent to the API or `--model`
displayName     optional (Anthropic, Codex, Cursor)
aliases         optional (xAI, Claude Code)
deprecated      true only when the native payload says so
sunsetAt        ISO date only when native (`shutdown_date`)
replacementId   optional (Codex `upgrade`)
inputTenths     optional; only xAI native prices in v1
outputTenths    optional; same
source          native | alias | catalog-hint
```

`catalog-hint` is today's pinned ID, shown when the list is empty so the picker is not blank. It is not written onto a worker unless the user picks it (COD-28).

Cap **500** models per provider. Drop the rest rather than paginating forever in the UI.

## Cache

Reuse the existing `settings` table (`id TEXT PRIMARY KEY, data TEXT NOT NULL` in `apps/desktop/src/core/storage/database.ts`). No new SQLite table. Key: `modelLists`.

```
{
  version: 1,
  byProvider: {
    openai: { fetchedAt, source, models, error? },
    …
  }
}
```

| Rule | Value |
|---|---|
| **TTL** | **24 hours** from `fetchedAt`. Fresh enough that opening the worker dialog does not spam; stale enough that a sunset announced today shows by tomorrow. |
| **Where** | Core SQLite settings, same file as the workspace (`%APPDATA%\orglet\orglet.sqlite` / `~/Library/Application Support/Orglet/orglet.sqlite`). Not `localStorage`, not a JSON file beside the key. |
| **In-memory** | While the core process is up, return the last fetch immediately (same idea as the 60s harness detect cache in `CoreService.harnesses`). |
| **Read path** | COD-28 asks core `modelList({ provider, refresh? })`. If a row exists, return it at once. If missing or older than 24h, refresh in the background and still return the stale row. Never block the dialog on the network. |
| **Backup** | **Exclude** `modelLists` from backup/restore (same idea as `reviewedSkills`). It is derived from this machine's keys/CLIs, not user content. |
| **Size** | Reject a payload over **1 MB** uncompressed per provider; keep the previous row. |

### Invalidate (drop or refetch that provider only)

1. API key saved or removed for that provider (`connect` / `disconnect` in main).
2. Harness **Dò lại** for that harness (`harnesses(true)`).
3. Explicit `refresh: true` from the UI (COD-28; a quiet “Làm mới” is enough).
4. `version` bump of this cache shape.

Do **not** refetch on every `workspace()` poll, every sidebar click, or every five-second tick.

Harness detect stays a 60-second memory cache of *install/login*. Model lists are a different, persisted cache.

## Deprecation metadata (feeds COD-30)

COD-31 stores whatever the native source actually has. COD-30 renders a chip only from these fields. No HTML, no guessed dates.

| Provider | `deprecated` | `sunsetAt` | Honest gap |
|---|---|---|---|
| OpenAI | `shutdown_date != null` | `shutdown_date` | No “deprecated but no date yet” flag. Legacy vs deprecated is HTML-only. |
| Anthropic | omit | omit | Dates exist only on [model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations). Chip cannot show a sunset until Anthropic puts it on `GET /v1/models`. |
| xAI | omit | omit | Retirement redirects (e.g. grok-3 → grok-4.3) are HTML. A still-listed slug may already be a redirect; we will not infer that. |
| Claude Code | omit | omit | Aliases have no version lifecycle. |
| Codex | omit (unless JSON later adds it) | omit | `upgrade` → `replacementId` only. `visibility` is picker hygiene, not deprecation. |
| Cursor | omit | omit | List text has no dates. |

If OpenAI returns `shutdown_date` in the past, still show the chip (COD-30); do not delete the ID from the list — the user may need it until the call fails.

## Error / fallback (fail-open)

Never scrape HTML. Never switch the worker to Demo. Never invent a model ID.

| Event | List in the UI | Custom model ID | Dispatch |
|---|---|---|---|
| Fetch OK | Native (or alias) list | Always | Selected ID, else catalog-hint if the user never changed it (until COD-28 persists `modelId`) |
| Network / 401 / timeout / non-JSON | Last good cache if any, else catalog-hint only | Always | Unchanged |
| Key missing / harness not installed | Empty native list + catalog-hint | Always | Existing “connect first” / harness-not-ready gates |
| CLI output shape changed (Cursor lines, Codex JSON) | Treat as fetch fail | Always | Unchanged |
| User types an ID not in the list | Keep typing; do not auto-correct | That ID is valid | Send it; provider/CLI error is the source of truth |
| Selected ID later missing from a refresh | Keep the saved ID; COD-30 may chip if native deprecation says so | Keep | Do not silently retarget a newer model |

Timeouts: **8 seconds** per provider fetch. COD-31 must not hold an API budget reservation to list models (list calls are not billed as completions; they still need the key).

Credentials stay in main `safeStorage`. Core already asks main for a key over the existing `key` IPC (`entry.ts`). The renderer never receives the key and never calls `api.openai.com` itself.

## How this meets the rest of COD-27

COD-31 fetch is not the picker and not the chip. It must still leave the door open:

- **Worker field (COD-28):** add optional `modelId` (trimmed string, max ~200 chars) on `Worker`. Absence means “catalog-hint for this provider.” Custom ID always saves even when the list is empty or failed.
- **Run snapshot:** freeze the *selected* `modelId` + a `pricingVersion`. Stop comparing every run to `modelCatalog[provider].model` once a worker has its own ID (`runner.ts` today throws if the catalog moved).
- **Prices:** OpenAI and Anthropic lists have **no** prices. Keep `modelCatalog` as the settlement table for those two pinned IDs only. For any other OpenAI/Anthropic ID, do **not** silently bill at mini/Haiku rates. Use the existing **unknown reservation** path (or refuse hard-cap) until a later COD stores a verified price. xAI list **does** include tenths — COD-31 may fill `inputTenths` / `outputTenths` for that ID and derive `pricingVersion` from them.
- **Harness exec:** today's `harnessArgs` does not pass `--model`. COD-28/31 should pass `--model <id>` for Claude Code, Codex (`-m`), and Cursor when `modelId` is set. Empty `modelId` keeps the CLI default.
- **Routines:** approval fingerprint already includes model/pricing (`routines.ts`). Persist `modelId` into that fingerprint so a silent catalog bump does not look like the user changed models.

## Implementation checklist

Do **not** do this list in the COD-29 PR.

### COD-31 — fetch + cache

Shipped. Picker and deprecated chip are COD-28 / COD-30.

1. Typed `ModelEntry` / `ModelListCache` in `shared/models.ts` (zod). Settings key `modelLists`, versioned, excluded from backup.
2. Core command `modelList({ provider, refresh?: boolean })`. Return `{ models, fetchedAt, stale, error?, customIdOk }`. Renderer-only; no keys.
3. OpenAI / Anthropic / xAI: `GET` with the saved key; 8s timeout; pagination for Anthropic; xAI `language-models`; OpenAI display filter above.
4. Codex: `codex debug models` JSON → `id`/`displayName`/`replacementId`. Cursor: `agent --list-models`, parse `id - name` lines; if the shape is wrong, fail-open. Claude Code: static aliases, no network. Demo: empty.
5. Persist; TTL 24h; invalidate on key change and harness **Dò lại**; stale-while-revalidate.
6. Map OpenAI `shutdown_date` into `deprecated` + `sunsetAt`. Leave other providers' deprecation fields omitted.
7. Tests with HTTP/CLI fixtures in `tests/integration/model-list.test.ts`.
8. This file's “Shipped” line. No worker dialog UI in COD-31.

### COD-28 — UI (after or with a stub list)

Shipped. Worker dialog lists cached models and always accepts a typed custom ID. `modelId` persists on the worker; adapters and harness `--model`/`-m` use it. Catalog-hint is a suggestion.

1. Worker (and harness) picker: searchable list + **always-on custom ID** field. Catalog-hint is a suggestion, not a lock.
2. Persist `modelId` on the worker revision. Adapter + `harnessArgs` use it. Labels in `workerModel.ts` show the chosen ID.
3. Opening the dialog calls `modelList` once; shows stale list instantly; does not spam. Quiet refresh control.
4. README + docs in that PR. Fail-open copy when the list is empty (“Gõ ID model. Danh sách chưa tải được.”).

### COD-30 — chip (after COD-31 metadata)

Shipped. The picker reads cached `deprecated` / `sunsetAt` / `replacementId` and renders a quiet chip on the selected or catalog-suggested ID. List rows that are deprecated get the same short chip without a date. Tests: `tests/integration/model-deprecation.test.ts`.

1. Chip on the selected model when `deprecated` is true. Show `sunsetAt` if present. Omit the date if absent (Anthropic/xAI/harness gap).
2. Optional: `replacementId` as plain text, not an auto-switch.
3. Do not toast on every dialog open. Chip on the worker row / picker row is enough.

## Out of scope (this plan page)

- COD-28 picker chrome and COD-30 chip (both shipped)
- COD-31 code (this PR is docs)
- Scraping, OpenRouter, models.dev overlay, embeddings/image models as workers
- New SQLite `models` table, cloud sync of lists
- Auto-migrating a worker to a replacement ID
- Passing `--model` before COD-28 persists `modelId` (COD-28 now persists it)
- COD-19/20 signing, COD-24/25 team chat

## What this is not

- Not permission to hit provider HTML or status blogs.
- Not a third-party model marketplace.
- Not a promise that every listed ID supports Orglet's tool/report loop — a bad ID fails at run time, plainly.
- Not a change to Demo isolation, key encryption, or per-task consent.
