# Orglet technical guide

This guide covers how Orglet runs work, connects providers and harnesses, and what each limit and check does. First walk-through: [Getting started](getting-started.md). For what Orglet is and who it is for, see the [README](../README.md) and [product direction](product.md). The [docs map](README.md) lists the rest.

This build supports individual workers, sequential or parallel teams, native OpenAI, Anthropic, xAI (Grok) and OpenRouter connections, local Ollama, local Claude Code / Codex / Cursor Agent harnesses, local dataset checks, routines, checkpoint/resume, backup/restore, team templates, Agent Skills import/review/export and reviewed reusable knowledge. The full MVP in `plans/orglet_mvp_plan_vi.md` is still in progress. Custom metric recomputation beyond built-in exact-match accuracy, live API-provider acceptance (script ready, needs a key path), a clean-machine Setup install and benchmarks remain unverified. The public 0.2.x release ships Windows Setup and ZIP; macOS and Linux have separate pull-request packaging workflows for dogfooding, not public release assets.

## Run

Use Windows or macOS, Node 24.19 or newer and pnpm 11.19.0.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` opens the Electron app. The Vite renderer binds `127.0.0.1`; Electron loads that loopback address even when Forge still injects `localhost`. `pnpm dev:web` only serves the renderer and intentionally has no desktop data bridge.

To try the interface without a model connection, keep the Researcher worker on **Demo**. Demo reports are labeled and do not analyze files or call an API.

## Connect a provider

1. In **Cài đặt → Kết nối API**, turn on the provider you need. Paste the key and choose **Lưu key**, or choose **Từ tệp**. Turn the switch off to disconnect and hide the fields. Ollama has no key: turn the switch on if Ollama is running at `127.0.0.1:11434`.
2. The main process encrypts the key with Electron `safeStorage` (DPAPI on Windows, Keychain on macOS). The renderer never receives the saved key back (typed drafts are cleared after a successful save). The original `.txt`, if you used one, remains where you saved it; remove it yourself when it is no longer needed.
3. Edit Researcher, choose a connection (OpenAI, Anthropic, Grok, OpenRouter, Ollama, or a local harness), then pick a model from the fetched list or type a custom ID, and save. Catalog names such as GPT-4.1 mini are suggestions only.
4. Select UTF-8 text files, describe the task, set a task budget and allow the selected content to be sent to the providers listed for that task.
5. Send the task. Open **Chi tiết** for activity or source references. Accepting a report only updates its status in Orglet.

The worker dialog lists each connection and, for every non-Demo worker, a model ID field: pick from that provider's cached list or type a custom ID. Catalog IDs in `apps/desktop/src/core/adapters/catalog.ts` (`gpt-4.1-mini-2025-04-14`, `claude-haiku-4-5-20251001`, `grok-3-mini`, `openai/gpt-4.1-mini`) and the Ollama suggestion `llama3.2` are suggestions, not a lock. Core fetches each provider's own model list (`modelList`), caches it for 24 hours in SQLite `settings.modelLists`, and always accepts a typed custom ID if the fetch fails. Leaving the ID blank keeps the catalog suggestion (or the CLI default for a harness). If the cached list marks that selected or suggested ID as deprecated, the picker shows a quiet chip; the sunset date is included only when the native payload had `shutdown_date`. A saved key does not establish that the provider account has credits. No subscription credentials are imported. See [model-list-fetch.md](model-list-fetch.md).

### Live acceptance (manual)

One authorized OpenAI or xAI task may be run against the real API with a **$0.05** budget. Orglet never searches for keys.

```powershell
$env:ORGLET_LIVE_KEY_FILE = 'C:\path\to\key.txt'
$env:ORGLET_LIVE_PROVIDER = 'openai'   # or 'xai'
pnpm test:live
```

Anthropic live acceptance needs a separate authorization and is not covered by `pnpm test:live`.

## Local harnesses (Claude Code, Codex, Cursor Agent)

Orglet can also run a worker through an agent CLI already installed on the machine, using whatever account that CLI is logged in with. **Cài đặt → Harness trên máy** always lists Claude Code, Codex and Cursor. Each row is **chưa cài** (not installed), **đã thấy · chưa đăng nhập** (found on disk), **đã đăng nhập · sẵn sàng** (signed in, ready to run) or **lỗi đăng nhập** (the status probe failed). Found on disk is not ready. A failed harness login does not fall back to Demo. **Dò lại** probes again after installing or logging in. Detection runs only each CLI's `--version` and its own login-status command, and looks in:

- Claude Code: `PATH`, `~/.local/bin`, npm/bun/volta global bins, `~/.claude/local`, and the build Claude desktop downloads (`%APPDATA%\Claude\claude-code\<version>` on Windows, or `~/Library/Application Support/Claude/claude-code/<version>` on macOS; also the Claude MSIX package's `LocalCache` on Windows). Sign in with `claude auth login` (the settings row copies the detected path). The desktop app's session is not reused.
- Codex: `PATH`, npm global bins and the Codex desktop app's `%LOCALAPPDATA%\OpenAI\Codex\bin` (Windows) or `/Applications/Codex.app/Contents/Resources/codex` (macOS). Sign in with `codex login`. An expired ChatGPT token can still look signed in until a run fails; then sign in again. Orglet does not call a paid model just to check this.
- Cursor Agent: `PATH`, `~/.local/bin`, `%USERPROFILE%\.cursor\bin\agent.exe` (install script), and `%LOCALAPPDATA%\cursor-agent` (`agent` / `cursor-agent`). Sign in with `agent login`; install with the documented `curl https://cursor.com/install -fsS | bash` or Windows `irm 'https://cursor.com/install?win32=true' | iex`.

Pick **Claude Code trên máy này**, **Codex trên máy này** or **Cursor Agent trên máy này** as a worker's connection, then optionally a model ID (`--model` / Codex `-m`). Empty ID keeps the CLI default. Each task still needs explicit consent for that harness. Core lists models for those CLIs (`codex debug models`, `agent --list-models`, Claude Code aliases) and always accepts a typed custom ID. A standalone source-only run copies the permitted, hash-checked sources and the skill's reference files into a temporary folder, sends the compiled context as the prompt and requires the same JSON report schema; Orglet then applies the same citation, checker, checklist and line-range checks as native runs and deletes the folder.

The following settings describe that source-only path. Workspace, team, web and dataset-tool runs use the core tool loop described below.

- Claude Code runs with `-p --restricted --safe-mode --strict-mcp-config --tools Read,Grep,Glob --no-session-persistence`, so it has no command, web or MCP tools, ignores your hooks, plugins and CLAUDE.md, and its file tools stay inside the task folder. The remaining task budget is passed as `--max-budget-usd`.
- Codex runs `exec --sandbox read-only --ignore-user-config --ignore-rules --ephemeral` with apps, browser use, computer use, web search, image attachment and its shell tools disabled; project instruction loading is set to zero bytes. Orglet sends the permitted text sources in the prompt instead (256 KB per file, 1 MB total, no Parquet). Codex therefore has no file or command access at all.
- Codex's structured-output API requires all nested object properties to be required. For a source-only answer, Orglet asks for one strict string field containing the report JSON, parses it, then validates the original report contract before saving anything. This avoids rejecting optional nested fields such as `review.checks[].processIds` at request time. A signed-in Codex CLI 0.155.0-alpha.9.2 completed source-only and tool-loop trial turns with this path; that does not establish native CLI containment across other versions.
- Cursor Agent runs `agent -p --mode=ask --sandbox enabled --trust --workspace <task-copy> --output-format json`. Orglet never passes `--force` or `--yolo`. The report JSON schema is embedded in the prompt and validated again by core.
- No Orglet budget reservation is made. Usage counts against the harness's plan or account; a cost the CLI reports is shown in activity only. Runs share the per-provider concurrency setting and stop after 15 minutes. Cancel kills the process tree. A source-only harness run is one step: pausing takes effect before it starts, not inside it.
- Orglet cannot see which files Claude Code or Cursor Agent actually opened, so its reports carry that limitation.
For a workspace, team, web or dataset-tool run, each CLI invocation returns one structured tool request. Core validates the request against the tool catalog and current grants before executing it. Claude Code has an empty native tool list; Codex uses the restrictions above; Cursor gets native-tool deny rules in a fresh call directory. Pausing between tool steps saves a checkpoint. Reported CLI cost estimates reduce subsequent call allowances and survive resume, but remain separate from API billing; missing costs remain unknown. Fixtures cover all three bridges, while live enforcement inside the CLIs remains unverified. See [agent tools](agent-tools.md) for the supported operations and test boundaries.

## Teams

Click a **worker** or a **team** in the sidebar to open that chat. How find-or-create, Chi tiết jobs, and the orchestrator work: [team-chat.md](team-chat.md).

Identity: newest non-archived `tasks` row with that `workerId` (no `teamId`, no `assignees`, no `routineId`) or that `teamId` (`liveWorkerTask` / `liveTeamTask` in `apps/desktop/src/shared/live-task.ts`). The first user message calls `createTask`; later messages call `reviseTask` on the same id. Do not create a new task row per send. The sidebar does not list discrete task rows. Routines stay separate under **Lịch chạy**. `createTask` itself is unchanged, so scheduled work can still insert discrete rows.

Execution for a team is the COD-25 orchestrator (`TeamRunner.run` when `task.teamSnapshot` is set): plan job (synthesizer) → assigned member jobs → one synthesis report. Unassigned members are skipped with a named cancel, not treated as failures. A failed plan does not dispatch members or invent a report. Worker chat is one run with no `stage`. Group chat (`assignees`, `TeamRunner.chat`) stays reachable from search. In a team or group chat, `@name` tags workers; group turns run only the tagged assignees, and Demo team plans assign tagged members (`apps/desktop/src/shared/mentions.ts`).

Long-chat context budget, rolling summary, retrieval and refuse-the-send are specified in [team-chat-context.md](team-chat-context.md); follow-ups still send the existing truncated history window (10 turns, 24 000 characters) until that plan is implemented.

Choose **Tạo team** and use a Research Review or Eris Review template, or select up to four existing workers and a synthesizer. Templates start in Demo mode. Parallel teams run at most two members at once; sequential teams pass committed reports to the next member. The synthesizer joins the saved reports. Open **Chi tiết** to inspect or export individual role results. Retry keeps successful member results and continues missing roles.

Use **Tạm dừng sau bước này** to finish the current step and save a checkpoint. **Tiếp tục từ checkpoint** uses the same run and frozen worker/skill settings, including team roles that have not started. A completed final report wins over a pending pause. After restart, interrupted requests are never replayed automatically: a saved response can be processed, but an uncertain request blocks resume. Inspect its retained cost reservation before choosing a new retry. A retry uses current settings for unfinished roles.

New Eris Review templates enable **Kiểm tra dataset trước khi review**. Any team can use this option. It runs local CSV/JSONL/Parquet checks before model roles, including in Demo mode, and saves results and limitations. Configure the ID column explicitly; when enabled, pair comparison runs only if the task contains exactly two datasets. It does not infer whether those files are submission/answers or train/test. Existing teams keep their configuration. Preflight supports pause/resume and cancellation; completed checker results are reused. Finished preflight records, including partial coverage, remain fixed for that task. Create a new task to recheck changed inputs.

In a saved team's settings, choose **Xuất template đã lưu** to export its saved configuration, workers and shared skills. In **Tạo team**, choose **Nhập template từ tệp** to create a separate copy with fresh IDs. Import preserves provider choices but does not run a task or grant provider/source access. Templates exclude keys, sources and task history. They use versioned JSON, with a 2 MB limit; this is separate from importing Agent Skills directories.

## Routines and work hours

Choose **Lên lịch cho công việc này** after writing a brief and selecting sources, or open **Lịch chạy → Tạo lịch**. Set a daily or weekly time, an IANA timezone such as `Asia/Ho_Chi_Minh`, and a per-task budget. Enabling a schedule requires recurring approval for its selected content and providers. A change to worker, skill, team, model or pricing configuration blocks automatic dispatch until you review and save the schedule again.

Orglet checks schedules while the app is open. Closing it or putting the machine to sleep prevents execution. The next due time stays on the calendar. On return, missed occurrences become **one** **Chạy bù một lần** choice (`pending`); they are never queued in bulk and never start automatically. **Bỏ qua lần lỡ** dismisses that choice. See [Routine catch-up](routines.md) for the exact miss threshold (30 seconds), reopen/first-tick rule, and N=1 coalescing. A prior paused, interrupted or budget-blocked task must be resolved before another occurrence runs. Changed or revoked source files block execution. Turning off a schedule does not cancel its current task. There are at most 100 saved schedules.

Times follow the schedule's timezone; the next occurrence is stored in UTC. A nonexistent daylight-saving time is skipped, and a repeated time runs only at its first occurrence. The scheduler polls every five seconds; a gap or delay over 30 seconds is treated as missed work, not permission to catch up automatically.

In team settings, set **Số công việc chạy đồng thời** (1–4) and optionally **Giới hạn khung giờ làm việc**. Existing teams default to at most four active tasks. Work hours apply to manual and scheduled tasks. Overnight shifts belong to their starting weekday. At shift end, an in-flight step can finish; no new step starts. Orglet saves a checkpoint and **Bàn giao cuối ca** with committed reports, blockers, next steps and cost state, without calling a model for the worklog. Resume explicitly during a later shift. Lowering concurrency prevents new starts but does not cancel active tasks.

## Knowledge

Open **Thư viện → Knowledge** to save short reusable notes. Each note has a scope: the whole workspace, one team or one worker. A team's notes load only when that team runs, even if one of its workers also belongs to another team. Pinned notes load whenever there is room; unpinned notes load only when they share keywords with the task brief. Knowledge is guidance for the model, not source evidence, and cannot grant permissions or raise budgets.

A model can suggest up to three notes when it submits a report. Suggestions and notes arriving in an imported team template wait under **Chờ duyệt** and never reach a model until approved. Editing, approving or archiving creates a new revision. Search uses SQLite FTS5 over title, content and tags.

Before its first request, every run freezes the context it will use. **Chi tiết → Context đã nạp** lists the instruction and knowledge revisions loaded and anything left out as a duplicate, over the 12-note/16 KB limit, or unrelated to the brief. Later edits never change a finished or resumed run. Follow-up turns currently send a truncated recent window (10 turns, 24 000 characters), not a rolling summary; the long-chat policy is [team-chat-context.md](team-chat-context.md). Team chat UI (click team → one live thread) is [team-chat.md](team-chat.md). Team templates carry only that team's approved notes; backups carry all knowledge with its revision history.

## Current limits

In **Cài đặt → Sao lưu và khôi phục**, save a JSON backup of workers, teams, revisions, schedules, task history, reports, checker results, handoffs and costs. Restore validates the format, checksums and references, then adds missing records in one transaction. Existing work, settings and recorded costs stay in place. Imported sources have no file path or read permission; select the files again in a new task. Backups exclude stored API keys, checkpoint context and source file contents, but reports can contain source excerpts. Keep the JSON private. Restored schedules are disabled and lose recurring/provider approval; select sources again and review them before enabling. The backup limit is 50 MB.

- Text/code/JSON are read as UTF-8 text, at most 256 KB per file and 1 MB per task. CSV, JSONL and Parquet support local DuckDB checks up to 32 MB per file, 128 columns, a 128 MB query memory limit and a 20-second process deadline. Unsupported or malformed inputs fail explicitly; mixed CSV line endings can be rejected by strict parsing.
- Folder intake selects at most 20 supported files and 64 MB total, traverses at most 8 levels and 1,000 entries, and lists excluded items. Hidden files, generated directories and symlinks/junctions are skipped. Review the selected manifest before allowing provider access.
- A task retains the intake exclusion list. Models receive only the excluded count, not those names or contents, and reports disclose that the whole folder was not reviewed.
- Open task sources to run local schema, row/null/distinct counts, ID duplicates, overlap and order alignment. For two files it also compares column names, row counts and IDs present in only one file. Results retain source hashes and checker versions in history. Checks use complete input within the limits; they do not establish semantic correctness, absence of leakage or valid scoring.
- A required team check can demand **Cần đối chiếu hai dataset** evidence. The synthesizer's PASS then stands only when it cites a two-file checker result with an ID column, matching column names and row counts, no null or duplicate IDs and no IDs missing from either file. New Eris Review templates use this for submission/answer alignment, so set the ID column in team settings.
- To recompute one bounded metric, attach two CSV/JSONL/Parquet files to a task and open **Sources → Tính exact-match accuracy**. Select which file contains predictions, which contains answers, the shared ID column and the two value columns. The checker requires non-empty files, unique non-null IDs, identical ID sets and counts, non-null values, and matching supported scalar column types. Row order does not matter. A missing column or incompatible type produces `unsupported`; empty files, duplicate/null/missing IDs or null values produce `incomplete`. Neither state contains a score. A complete result stores matched/total, accuracy, source hashes, chosen columns and checker version in task history and backups. Run this manual checker before sending a new review turn; an already-started run does not gain new evidence. A team review can require a cited complete `exact_match_accuracy` profile; that PASS means the calculation is available, not that its value meets a threshold or equals the challenge's official metric. Changed or revoked sources must be checked again before a later run cites the result. Custom metrics remain insufficient evidence.
- **Cài đặt → Request đồng thời mỗi provider** (1–4, default 2) caps in-flight model requests per provider across all tasks and teams. Waiting steps show a queue message and hold no budget reservation.
- Opening a workspace with a newer build first saves a pre-upgrade copy of the database. See `docs/recovery.md` for rollback.
- The checker runs in a separate utility process without API keys, with extension auto-loading and external access disabled except for its exact temporary source copies. This is process separation, not an OS security sandbox. Normal completion, cancellation and parser failure clean the copies; a whole-app/OS crash can leave temporary copies for OS cleanup.
- A worker has at most six model requests per run, or 24 when it has a workspace grant, with 4,096 output tokens per API request. File edits and commands require separate workspace permissions; commands use the Windows isolation backend. Public web tools require explicit network permission. These grants do not authorize changes to another service. See [agent tools](agent-tools.md) for containment, recovery and harness limits.
- Source references are checked against sources the worker read. This verifies provenance, not whether a model's interpretation is correct. Unread sources are listed as a limitation.
- New findings include a category, an optional recommendation and checker references. Orglet assigns the finding, writer and run IDs itself. Checker references must belong to that run or its frozen preflight and overlap the finding's cited sources. Reports and backups retain this metadata; older reports stay readable without invented historical IDs.
- Click a finding's source to open its location and preview eligible text, or its checker link to expand the exact result. Provenance is available in a disclosure and Markdown exports. Line-level citations and links between findings are still pending.
- Budgets cover calls through Orglet only. Input is conservatively charged at the uncached rate. Failed requests, missing usage and interrupted requests keep their original reservation. **Cài đặt → Chi phí & giới hạn → Khoản cần đối soát** lists each one with its provider, chat, run, original hold and reason. Check the provider's usage page or invoice, enter the actual USD amount and confirm that you checked it; enter zero only with provider evidence. Orglet keeps the original hold and a dated adjustment in local history and backups. The task's cumulative cap uses the verified amount; connection and team monthly caps use it for the original request month. An unresolved hold continues to count across months. Repeating the same reconciliation has no further effect; a different amount requires inspecting the saved record rather than silently overwriting it. Orglet cannot independently verify the provider bill.
- Cancelling stops further dispatch. An in-flight request may still cost money. Restart marks interrupted runs explicitly and never silently replays them; retry creates a new run using current worker/skill revisions.
- History, reports and checkpoint context are stored in `%APPDATA%\orglet\orglet.sqlite` on Windows, or `~/Library/Application Support/Orglet/orglet.sqlite` on macOS. Checkpoints can contain selected source text; they are removed on successful report commit, and never sent through the renderer bridge. `safeStorage` protects stored keys (DPAPI on Windows, Keychain on macOS), not against every process running as your user. Workspace records are not encrypted.

## Structured run logs

In task sources, select one CSV/JSONL/Parquet dataset and choose the metric direction under **Kiểm tra run-log**. Required columns are `solution`, `run`, `split`, `metric`, `status` and `score`; `error_code` is optional. Identifier fields are text. Status must be `completed`, `failed` or `cancelled`; completed rows require a finite numeric score. Keep one metric per file and a unique solution/run/split combination per row. Limits: 10,000 rows, 100 solutions, 200 solution/split groups, 200 error codes and absolute score at most 1e100, within the existing file/time/memory limits.

The checker reports completion/failure counts and per-solution/split mean, min/max and sample standard deviation. It excludes failure/cancellation scores without converting them to zero. Fewer than two completed observations in a group is insufficient evidence for that group's rerun variability.

Public/private ranks use mean completed scores only when both named splits cover the same solutions with completed observations. Ties share competition ranks; public rank minus private rank is the number of places gained. Direction is supplied explicitly, not inferred from the metric name. These are descriptive observations, not a stability threshold or approval. The run-log checker does not rerun solutions, authenticate logs or establish independent trials; the separate exact-match checker does not validate a custom challenge metric.

Results are stored with source hashes and preserved in backups. Model-invoked audits use the trusted `audit_run_log` tool and are included with checker provenance in that run's exported report. Manual audits remain in the task's checker history and backup; they are not retroactively inserted into an earlier model report.

## Agent Skills

Open Library to import a directory containing `SKILL.md`. Orglet validates [Agent Skills frontmatter](https://agentskills.io/specification), keeps references/assets/scripts intact, and requires review before assignment or execution. Imported packages are immutable: edit the original directory and import a new package to change one. Library items show their package identity and local review status.

The limit is 100 files, 200 directory entries, eight path components, 256 KB per file and 1 MB per package. Instructions are limited to 16,000 characters. Windows device names, traversal, symbolic links, junctions and hard links are rejected. YAML aliases, custom tags, duplicate keys and unknown frontmatter fields are rejected with an import error.

Workers can read UTF-8 files from the reviewed package's `references/` and `assets/` through `read_skill_resource`. These are guidance, not source evidence. Binary assets and scripts remain available for inspection/export but are not executed or sent as resources. Package instructions and requested text resources can be sent to the task's approved provider. Tool declarations never grant extra permissions.

Export creates a new named directory and refuses to overwrite an existing one. It adds `orglet.json` when absent, containing `input_schema`, `output_schema`, `required_permissions`, `evaluator` and `version_hash`. This extension is specific to Orglet; unsupported schemas, evaluators and permissions block activation. Backups and team templates retain package files, but review approval stays on the current machine. A team template including packages must still fit its 2 MB limit.

## Checks and packaging

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm test:desktop
pnpm make
pnpm test:packaged
pnpm test:routines
pnpm test:skills
pnpm test:run-audit
pnpm test:findings
pnpm test:revisions
pnpm test:knowledge
pnpm test:harness
```

The harness smoke installs fixture CLIs so **Harness trên máy** always has a logged-out Claude Code and an unreadable Codex login probe, and still lists Cursor (including a not-installed row). It checks status pills and copy-login commands, that detected is not signed-in, that an auth failure does not show Demo, and that the worker model list and send gate match those states. It never starts a harness run. GitHub Actions runs this on Windows after `pnpm make`; see [windows-release-gates.md](windows-release-gates.md). Packaged smoke scripts resolve the Windows `.exe` or the macOS `.app` binary via `scripts/packaged-executable.mjs`.

The knowledge smoke creates a team note in the library, carries it through a template export/import as a proposal, approves it, searches it and checks the frozen context shown in **Chi tiết**. `node scripts/knowledge-smoke.mjs --inspect-ui` leaves that task open for computer use.

The desktop smoke test uses a temporary data directory, an explicit demo task and a fake credential. It checks a real Electron window, renderer isolation, source access, export, keyboard behavior and history after restart. It does not call a paid provider.

The packaged smoke launches the actual executable with an isolated `--user-data-dir`, checks the shipped DuckDB addon, configures an Eris template's preflight in the UI and runs its four demo roles. It exports and restores reports, preflight and checker results into a fresh workspace. Use `node scripts/packaged-checker-smoke.mjs --inspect-ui` to leave that restored preflight task open for computer use, then close the window to finish.

The routine smoke uses the packaged app and real clock for one scheduled demo, then checks offline catch-up, work hours, handoff and a narrow editor. Its only SQLite fixture edit happens in isolated user data after the app has closed. Add `--inspect-ui` to `node scripts/routine-smoke.mjs` to leave the fixture open for computer use.

The skill smoke checks directory import, review gating, resource preview, export, unsupported capabilities and a narrow drawer. `node scripts/skill-smoke.mjs --inspect-ui` leaves the isolated package review open for computer use.

The run-audit smoke checks structured log errors, direction selection, repeat/failure summaries and public/private rank changes. `node scripts/run-audit-smoke.mjs --inspect-ui` leaves the result open for computer use.

`pnpm build` produces `out/Orglet-win32-x64/Orglet.exe` on Windows, or `out/Orglet-darwin-<arch>/Orglet.app` on a Mac. `pnpm make` writes makers under `out/make`: ZIP + Squirrel Setup on Windows; a ZIP of `Orglet.app` on macOS; a Linux ZIP on Linux. The [latest public release](https://github.com/codepawl/orglet/releases/latest) carries Windows Setup and ZIP. Public Windows 0.2.x installers are unsigned by decision; see [windows-release-gates.md](windows-release-gates.md). macOS CI Developer ID signs when P12 secrets exist and notarizes only when Apple ID or App Store Connect API key credentials exist; see [macos-packaging.md](macos-packaging.md). Linux CI makes a ZIP and starts the packaged app headlessly; it does not prove use on a real Linux desktop. Both workflows are separate from the required Windows `test` aggregator; see [linux-packaging.md](linux-packaging.md).

See `docs/implementation_status.md` for actual verification and remaining work.

Structured reviews can show check statuses, an overall recommendation, unresolved finding disagreements and draft feedback. Core validates their references and rejects a ready recommendation with declared missing/failed checks or conflicts. Historical reports can lack these fields. Required template checklists and the interactive request for missing evidence are still being implemented.

New Eris templates include five required review checks. Missing assessments remain visible, and a run-stability PASS requires a cited run-log checker result with sufficient observations. This does not prove the supplied runs are independent or the metric is correct. Existing teams keep their saved configuration; interactive requests for missing evidence are still pending.

Edit required checks under Team settings → Checklist bắt buộc. Each check has a name and evidence requirement. Saving creates a new team revision; existing task snapshots keep their previous checklist.
