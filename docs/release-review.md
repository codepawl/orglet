# Release review (v0.2.0 candidate)

Local review updated 2026-09-18 for the Windows 0.2.0 branch stack. It records what was checked and what is still open; it is not a release approval.

## Dependencies

- Direct runtime dependencies are pinned exactly in `package.json`, with the full tree in `pnpm-lock.yaml`. CI installs with `--frozen-lockfile`.
- The production tree resolved from the direct dependencies has 49 packages. All use MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause or 0BSD, except `fast-sha256@1.3.0` (Unlicense, public-domain dedication).
- Build-only packages add MPL-2.0 (`lightningcss`, used by Tailwind at build time), CC-BY-4.0 (`caniuse-lite` data), CC-BY-3.0/CC0 (`spdx-*` data) and BlueOak-1.0.0 (`minipass-flush`). None of these ship inside the packaged app code; confirm by inspecting `app.asar` before a public release.
- Native code shipped: DuckDB Node bindings (MIT) unpacked from ASAR, and Electron itself. SQLite is Node's bundled engine; startup refuses versions older than 3.51.3.
- Production dependency audit: CI runs `pnpm audit --prod --audit-level=high` on every Windows desktop workflow (fails the job on high or critical advisories). DevDependency-only findings are reviewed manually before release and are not a CI hard fail. Upstream maintenance status for each direct dependency is still a human check before tagging.

## Third-party marks

Provider logos (OpenAI, Anthropic, Claude, X for xAI) are inline SVG paths from Simple Icons 15.22.0, released under CC0-1.0. The license covers the SVG files, not the trademarks, which belong to their owners. User decision 2026-09-16: ship the official marks and remove them if an owner objects. They live in `apps/desktop/src/renderer/components/ProviderMark.tsx`; Demo and Cursor Agent keep a plain monogram.

## Privacy and data flow

Checked by reading `apps/desktop/src`:

- The only direct network request outside provider SDKs is the optional exchange-rate lookup (`core/currency.ts`, a GET to `open.er-api.com` with no workspace data) when a non-USD display currency is chosen, refreshed at most every 12 hours. Budgets and the ledger stay in USD micros.
- Local harness detection and runs use `child_process` for installed Claude Code / Codex / Cursor Agent CLIs only (see `docs/capabilities.md`). `shell.openExternal` is used only for fixed provider pricing URLs (`orglet:open-pricing`, the renderer passes `openai`, `anthropic` or `xai`). No `console` logging in app source. Model traffic goes only through the official OpenAI and Anthropic SDK adapters (xAI reuses the OpenAI SDK against `https://api.x.ai/v1`), created in the core after the main process hands over a decrypted key for that request.
- The renderer is sandboxed with context isolation, no Node integration, a navigation block, a request filter limited to the packaged renderer files, and an allowlisted IPC command set validated with zod in both main and core.
- API keys: read from a user-chosen `.txt`, encrypted with Electron `safeStorage` (DPAPI), never returned to the renderer, excluded from backups and templates.
- User decision 2026-09-17: there is no separate "send to model" permission. Choosing a non-Demo model for a worker and submitting a task (or saving an approved routine) counts as consent; the renderer sends `consent: true` with the task's providers.
- Provider context contains the brief, the selected source manifest and content the worker reads, approved knowledge in scope, skill resources and checker observations. Excluded folder entries are sent only as a count.
- Stored locally unencrypted: SQLite workspace (reports, knowledge, checkpoints that can contain source text until the report commits), pre-upgrade database copies, exported backups and Markdown. Backups can contain source excerpts in reports.
- Knowledge proposals come from model output and wait for user review before they can enter any prompt. Template imports also arrive as proposals.

## Release gates still open

| Gate | Status |
|---|---|
| Installer on a clean Windows machine, startup, uninstall | Procedure in [windows-release-gates.md](windows-release-gates.md). Not yet run on a clean machine |
| Code signing | Not configured. Env-var prep documented in windows-release-gates.md; leave unsigned until a cert is supplied |
| Live OpenAI acceptance ($0.05 cap) | Script ready: set `ORGLET_LIVE_KEY_FILE` (+ optional `ORGLET_LIVE_PROVIDER=openai`) and run `pnpm test:live`. Waiting for the user's key file path |
| Live xAI (Grok) acceptance ($0.05 cap) | Same script with `ORGLET_LIVE_PROVIDER=xai`. Waiting for the user's key file path |
| Live Anthropic acceptance | Not authorized |
| Rollback onto an older installed build | Procedure documented in `docs/recovery.md`; only the database copy is tested |
| Benchmark corpus (plan §14) | Needs an authorized corpus and labels |
| Vulnerability and maintenance audit | CI: `pnpm audit --prod --audit-level=high`. Manual maintenance review of direct deps still required before tag |
