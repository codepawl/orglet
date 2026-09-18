# Capability catalog

| Path | Enabled | Limits |
|---|---|---|
| Demo | Yes | Deterministic sample report; no model or source analysis |
| OpenAI native | Implemented; live acceptance pending | Default suggestion `gpt-4.1-mini-2025-04-14`; worker may pick or type any ID. Verified mini prices only for that catalog ID. Trusted text reader and validated report only |
| Anthropic native | Implemented; live acceptance pending | Default suggestion `claude-haiku-4-5-20251001`; worker may pick or type any ID. Verified Haiku prices only for that catalog ID. Provider-scoped consent, trusted tools |
| Grok (xAI) native | Implemented; live acceptance pending | OpenAI-compatible Chat Completions at `https://api.x.ai/v1`, default suggestion `grok-3-mini`, worker may pick or type any ID; native list tenths used when cached. Same trusted tools and report gate |
| Teams | Yes | Up to four members, parallel concurrency two, sequential upstream reports, partial retry and synthesis |
| Team chat + orchestrator | Yes ([COD-24](https://linear.app/codepawl/issue/COD-24) shell, [COD-25](https://linear.app/codepawl/issue/COD-25) plan→members→report; [team-chat.md](team-chat.md)) | Click team → one live `tasks` row keyed by `teamId`; later messages `reviseTask`; synthesizer plans, assigned members run as hidden jobs, one synthesis in the transcript; fail-closed `partial` / named errors; worker chat unchanged |
| Provider request concurrency | Yes | Workspace-wide per provider, 1–4 (default 2); queued steps hold no budget reservation |
| Local dataset checker | Yes | CSV/JSONL/Parquet; schema, counts, ID checks, column-name/row-count/ID-set comparison for two files; fixed SQL, process deadline, retained provenance |
| Reviewed knowledge | Yes | Workspace/team/worker scope, immutable revisions, FTS5 keyword search, pins; model proposals and template imports wait for review |
| Context compiler | Yes | Platform → team → worker → skill → approved knowledge; duplicate removal, 12 items / 16 KB knowledge budget, frozen per-run manifest |
| Folder intake | Yes | 20 files, 64 MB total, 8 levels, 1,000 entries; excluded-item list |
| Local Claude Code harness | Yes, when installed and signed in; live review verified | Headless `-p` with restricted/safe mode, Read/Grep/Glob only, JSON schema output; one step per run; no Orglet reservation |
| Local Codex harness (`codex exec`) | Yes, when installed and signed in; live review verified | Sources inlined in the prompt; shell tools, apps, browser and computer use disabled; user config ignored |
| Local Cursor Agent harness | Yes, when installed and signed in; live probe optional | Headless `agent -p --mode=ask --sandbox enabled --trust`; report schema embedded in the prompt; never `--force`/`--yolo`; no Orglet reservation |
| Codex app-server | No | `codex exec` covers review runs; app-server is not used. See below |
| Model list fetch + cache | Yes ([COD-31](https://linear.app/codepawl/issue/COD-31)) | Native OpenAI/Anthropic/xAI HTTP, Codex/Cursor CLI, Claude Code aliases; SQLite `settings.modelLists`, 24h TTL, stale-while-revalidate; fail-open custom ID; no HTML scrape. See [model-list-fetch.md](model-list-fetch.md) |
| Worker model picker | Yes ([COD-28](https://linear.app/codepawl/issue/COD-28)) | Per-worker list + typed custom ID; catalog defaults are suggestions; adapters/harness `--model`/`-m` use the saved ID |
| Deprecated model chip | Yes ([COD-30](https://linear.app/codepawl/issue/COD-30)) | Quiet chip on selected/suggested ID when cached `deprecated` is true; sunset day only from native `sunsetAt` (OpenAI `shutdown_date`); no HTML scrape or invented dates |
| Subscription quota display / internal allocation | No | Neither CLI exposes quota windows in headless mode; no screen is shown |
| Shell, imported scripts, external writes | No | Not exposed through IPC or tool schemas |

## Local harness capability matrix

Decision (user, 2026-09-16): connect the agent harnesses already installed on the machine first, detected per machine so it works for other users too. The native OpenAI and Anthropic paths do not depend on them.

| Capability Orglet needs | Claude Code 2.1.x | Codex CLI 0.154 | Cursor Agent CLI |
|---|---|---|---|
| Read only the selected sources | Copies in a temp folder; `--restricted` confines file tools to it | Text inlined in the prompt; no file access (its shell-based reads are rejected by the Windows read-only sandbox, and shell tools are disabled) | Copies in a temp folder; `--workspace` points at the copy; ask mode |
| No shell, network, MCP, user plugins | `--restricted --safe-mode --strict-mcp-config --tools Read,Grep,Glob` | `--sandbox read-only --ignore-user-config`, `shell_tool`, `unified_exec`, apps, browser and computer use disabled | `--mode=ask --sandbox enabled`; never `--force`/`--yolo`; MCP not auto-approved |
| Structured report | `--json-schema`, validated again by core | `--output-schema`, last message validated again by core | Schema embedded in the prompt; `--output-format json`; validated again by core |
| Auth state | `claude auth status` JSON | `codex login status` text; an expired token only shows at run time | `agent status --format json` (text fallback) |
| Sign-in command | `claude auth login` (detected path) | `codex login` (detected path) | `agent login` (detected path) |
| Cost and quota | `total_cost_usd` reported, shown in activity; `--max-budget-usd` = remaining task budget | Not reported | Not reported |
| Cancellation | Process tree killed | Process tree killed | Process tree killed |

**Settings → Local harnesses** always lists Claude Code, Codex and Cursor Agent with four states: **not installed**, **found on disk (detected, not signed in)**, **signed in (ready to run)**, and **sign-in error** when the status probe fails. Detected-on-disk is never treated as ready. A failed harness login does not fall back to Demo. Repair steps are the CLI's own login command with the detected executable path (PowerShell `& "path" …` on Windows). Cursor also shows the documented install one-liner. There is no invented login URL; each CLI opens its own browser flow.

Verified locally: detection on this Windows machine (both found), argument contract, output parsing of real failure shapes, a `.cmd` shim round trip, runner validation and cancellation with an injected executor, packaged UI smoke. Live acceptance 2026-09-16: a Codex review through `CoreService` with real detection and execution completed. It found the contradiction in a three-line note, cited line 3 (re-validated by core), recommended `revision_required` and made no Orglet reservation. The first live attempt failed Orglet's gate because the model recommended ready with no checks; the report rules are now included in the harness prompt and the tool description. A Claude Code review (2.1.270, claude.ai Max login) through the same path also completed: it read the copied source with its restricted Read tool, cited line 3, recommended `revision_required`, reported an estimated $0.1191 against its plan, and made no Orglet reservation. The desktop-bundled CLI is not on PATH, so the login hint now shows the detected executable's full path.

## Pinned technical choices

- Electron 44.3.0, Forge 7.11.2, Vite 8.3.0, React 19.3.0; exact transitive resolution in `pnpm-lock.yaml`.
- Native desktop smoke reports the actual bundled SQLite engine, independently of the host Node engine. Startup rejects SQLite older than 3.51.3.
- OpenAI SDK 7.15.0. Default suggestion `gpt-4.1-mini-2025-04-14`, standard text input $0.40 and output $1.60 per million tokens for that catalog ID only. Cached input is deliberately estimated at the ordinary rate. No server tools with additional fees are enabled. Other IDs may be typed; they are not billed at mini rates.
- xAI via the same OpenAI SDK with `baseURL` `https://api.x.ai/v1`. Default suggestion `grok-3-mini` at $0.30 input / $0.50 output per million tokens (`pricingVersion` `grok-3-mini:0.30:0.50`). Cached native tenths apply to other listed IDs. Revalidate against [xAI pricing](https://docs.x.ai/developers/pricing) before release.
- The request upper bound uses serialized context/tool UTF-8 bytes plus framing allowance and the output cap. Reservation and settlement use integer micro-USD. Unknown requests keep their reservation across restarts and month boundaries.
- Forge's rebuild dependency references Electron node-gyp by Git URL; `pnpm-workspace.yaml` overrides it with the registry release `10.2.0-electron.2`. Exotic-subdependency blocking remains enabled.
- Forge needs hoisted node_modules. Lifecycle builds are explicitly allowed only for Electron, esbuild and electron-winstaller.
- DuckDB Node Neo 1.5.5-r.5, native engine 1.5.5. Packager explicitly includes its API, bindings, Windows x64 addon and detect-libc; native binaries are unpacked from ASAR. A packaged smoke verifies execution, not just file presence.

## Primary references

- [Electron releases](https://releases.electronjs.org/)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron utility process](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [SQLite WAL and the reset fix](https://sqlite.org/wal.html)
- [Node SQLite API](https://nodejs.org/api/sqlite.html)
- [OpenAI GPT-4.1 mini pricing and snapshot](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
- [Anthropic model overview](https://platform.claude.com/docs/en/models/overview)
- [OpenAI list models](https://developers.openai.com/api/reference/resources/models/methods/list) (`shutdown_date` on the model object)
- [Anthropic list models](https://platform.claude.com/docs/en/api/http/models/list.md) (no deprecation fields)
- [xAI language-models](https://docs.x.ai/developers/rest-api-reference/inference/models) (native prices; no sunset field)
- [Codex `debug models`](https://developers.openai.com/codex/cli/reference.md)
- [Cursor Agent `--list-models`](https://cursor.com/docs/cli/reference/parameters.md)
- [Model list fetch plan](model-list-fetch.md)
- [DuckDB Node Neo](https://duckdb.org/docs/current/clients/node_neo/overview)
- [DuckDB security configuration](https://duckdb.org/docs/current/operations_manual/securing_duckdb/overview)

Revalidate prices and supported model snapshots before a release. Registry versions and local tests alone do not establish provider compatibility.
