# Orglet continuation

The full goal is active. Continue both plans in `plans/`; do not redefine completion as the current demo. `docs/implementation_status.md` is the detailed implementation and validation record.

## User decisions

- Continue API integration without waiting for a key. The user will later supply a local `.txt` key-file path. Do not search for credentials or call real providers before that. One future OpenAI acceptance task is authorized with a $0.05 ceiling.
- Test the app with computer use as well as E2E. Native Windows UI testing has found packaging and layout bugs that automated checks missed.
- Prepare handoff before quota runs low. The last usage read showed 94% used, 6% remaining in the weekly window. This note is preparation, not a reason to stop local work.
- Do not publish, deploy, push or send external messages without authorization. No commits or remote are configured; source is still untracked. Do not remove existing app data.

## Phiên Claude 2026-09-16: nối harness trên máy (mới nhất)

An quyết định: nối trước Claude Code, Codex và các harness có sẵn trên máy, dò theo từng máy để máy người khác cũng dùng được.

Đã làm:
- `core/harness/detect.ts`: dò Claude Code (PATH, `~/.local/bin`, npm/bun/volta, bản app Claude desktop tải về kể cả trong thư mục package MSIX) và Codex (PATH, npm, `%LOCALAPPDATA%\OpenAI\Codex\bin`). Chỉ chạy `--version` và lệnh xem login của CLI. Kết quả cache 60 giây, bấm "Dò lại" thì làm mới.
- `core/harness/exec.ts`: Claude Code `-p --restricted --safe-mode --strict-mcp-config --tools Read,Grep,Glob --json-schema`; Codex `exec --sandbox read-only --ignore-user-config --ignore-rules --ephemeral --output-schema`, tắt apps/browser/computer use. Shim `.cmd` được escape theo cách của cross-spawn. Timeout 15 phút, hủy thì kill cả cây process.
- Runner: provider `claude-code`/`codex` chạy một bước duy nhất trên bản copy nguồn đã kiểm hash; report đi qua cùng hàm `finalize` với native. Không giữ chỗ ngân sách Orglet, chi phí harness tự báo thì ghi vào activity. Codex có ghi chú là vẫn đọc được tệp ngoài thư mục task.
- UI: Cài đặt → Harness trên máy, chọn harness trong model của worker, consent riêng cho từng task, gợi ý đăng nhập.

Kiểm chứng: typecheck, 133 test / 18 file (thêm `harness.test.ts`), Forge make, smoke packaged `harness`, `desktop`, `knowledge` pass. Dò thật trên máy này: Claude Code 2.1.270 (CLI chưa đăng nhập), Codex 0.154.

Codex đã nghiệm thu live qua `CoreService`: task `completed`, bắt đúng mâu thuẫn, trích đúng dòng 3, `revision_required`, không giữ ngân sách. Phát hiện trong lúc thử: sandbox read-only của Codex trên Windows chặn mọi lệnh đọc tệp, nên với Codex Orglet gửi nội dung nguồn trong prompt và tắt hẳn shell tool. Lượt live đầu bị gate chặn vì model khuyến nghị ready khi không có check; đã đưa luật report vào prompt harness và mô tả tool.

Claude Code cũng đã nghiệm thu live sau khi An đăng nhập (claude.ai, gói Max): task `completed`, trích dòng 3, `revision_required`, harness ước tính $0.1191, không giữ ngân sách Orglet. CLI do app desktop tải về không nằm trong PATH nên gợi ý đăng nhập giờ in lệnh kèm đường dẫn đầy đủ. Cả hai harness đã xong.

## Phiên Claude 2026-09-15

Đã làm xong:
- Knowledge đã review + context compiler (plan §7.1, §7.3): schema v6, revision bất biến, FTS5, scope workspace/team/worker, model đề xuất tối đa 3 mục chờ duyệt, template chỉ mang knowledge của team và nhập lại ở trạng thái chờ duyệt, context mỗi run được đóng băng kèm manifest. UI ở Thư viện → Knowledge, manifest ở Chi tiết.
- Giới hạn request đồng thời mỗi provider (Cài đặt, 1–4, mặc định 2); bước đang xếp hàng không giữ ngân sách.
- So sánh hai dataset: tên cột, số dòng, ID chỉ có ở một tệp; gate `pair_alignment` cho checklist (template Eris mới dùng cho submission/answers).
- Trích dẫn theo dòng cho finding, kiểm lại bằng cách đọc lại nguồn; highlight trong preview.
- Bản sao DB trước khi migrate + `docs/recovery.md`; `docs/release-review.md`; bảng trạng thái Codex/quota trong `docs/capabilities.md`; chỉnh UI lịch sử revision.
- Follow-up core của `waiting_input` đã có test từ trước (restart/routine ở `routines.test.ts`, backup ở `preflight.test.ts`, standalone ở `finding-provenance.test.ts`).

Kiểm chứng: typecheck, 125 test / 17 file, Forge make (package, ZIP, Squirrel). Smoke packaged pass: knowledge, desktop, finding, run-audit trên build cuối; packaged-checker, revision, skill, routine trên build trước đó cùng phiên. Chưa test native bằng computer use: quyền điều khiển cửa sổ Orglet bị từ chối trong phiên này. Không gọi provider thật.

Còn lại (chi tiết ở `docs/mvp-gap-audit.md`), tất cả cần An: đường dẫn key cho task OpenAI $0.05, máy Windows sạch để test installer và quyết định ký build, corpus Eris có nhãn cho §14, có làm Codex adapter không, và cấp quyền computer use nếu muốn check native.

Lệnh trên máy này: shell của Claude không có `node`/`pnpm`. Thêm `~/Documents/Eris/tool/runtime/node-v24.19.0-win-x64` vào PATH. Forge make cần `USERPROFILE` trỏ tới một thư mục ngắn (ví dụ `$env:TEMP\ofh`) có file rỗng `.skip-forge-system-check`; đường dẫn dài làm Squirrel lỗi PathTooLong. Smoke mới: `node scripts/knowledge-smoke.mjs`.

## Previous milestone (Codex)

waiting_input lifecycle implemented: standalone final reports with not_assessed checks and team final synthesis with missing checks put the task in waiting_input while runs remain completed. UI gives supplement-or-accept instructions and hides blind retry. Acknowledging evidence leaves waiting_input intact; explicit accept completes the task without modifying the report. reviseTask continues with a fresh revision/consent; routines defer while their prior task waits for input. Backup status schema includes waiting_input. Full suite initially passed 110/111, with one expected old completed assertion; updated that expectation and all 18 team/preflight tests passed, plus typecheck. Packaged revision E2E passed with waiting-state assertions, acknowledgment persistence, new-source revision, history selection and unchanged artifacts. Test now polls IPC state directly with an explicit revision/status condition, avoiding an early report-save race. Fixture %TEMP%/orglet-revision-IHoGO5; task a3d03c60-a56d-4f5c-9a31-17100dd3407f. Closed. No live model calls.

Forge make session 58560 completed successfully, including Squirrel and ZIP. No live build/test processes remain. Next: native UI exercise of waiting_input, backup/restart assertion for that state, routine deferral regression and standalone missing-evidence coverage. Earlier history polish/preflight scoping follow-ups remain. Full MVP remains incomplete.

Revision history selection is implemented in TaskThread: current inputRevision is the default, prior revision displays its frozen brief and last final report, historical views are labelled and cannot accept the current task. Current revision with no final report no longer falls back to an earlier synthesis. Core accept also requires a report belonging to the current inputRevision. Eight team tests and typecheck passed. Packaged revision E2E passed including switch to history/current and acceptance visibility; Forge make completed and now includes the prior backup compatibility fix.

Native computer use opened fixture %TEMP%/orglet-revision-6KmLsf, task 83e778f5-6c6b-43b8-8c34-50a62ad10982, selected Lần 1, observed original brief/history label and no accept button. Window closed. Initial hidden shell launch had no targetable window; only that isolated root was terminated and relaunched visibly for interactive validation. No real API calls.

Next: improve revision selector spacing/control styling, scope preflight navigation to selected revision, hide current-task status/acceptance explanatory copy when showing history, then implement persisted waiting-for-input lifecycle. History currently shows last final report per inputRevision; per-attempt/member artifacts remain in Chi tiết. Full MVP still incomplete.

Legacy backup compatibility is fixed in core/storage/backup.ts. Snapshot conflict comparison normalizes only the additive input/inputRevision fields, deriving absent input from each backup's own task before merging. Restored legacy runs receive this frozen original scope so newly merged source history cannot widen their evidence. Existing snapshot content still wins; changed original brief/source scope/worker/revision rejects atomically. Nine backup integration tests and typecheck passed. Two new regressions cover backfill compatibility and a missing legacy run restored into an expanded task. Packaged out/ predates this latest core fix; rebuild before next packaged validation. No UI changes or native test needed for this isolated core change.

Continue revision history/report selection and waiting-for-input lifecycle next. The earlier legacy-backup follow-up below is resolved by this milestone.

Revision UI is implemented in RevisionEditor.tsx, App.tsx and TaskThread.tsx. It selects only the current revision sources, supports removing/adding files, edits the new brief, requires fresh provider consent and labels the budget as cumulative for the entire task. Original brief and artifacts remain available. Forge make and typecheck passed. scripts/revision-smoke.mjs passed on the packaged app: same task, 8 retained/new artifacts, two preflight scopes, four fresh revision roles, correct selected-source defaults. Added test:revisions to package scripts and Windows CI. Updated older source-button selectors; desktop-smoke and run-audit-smoke both passed. The first revision E2E attempt timed out on an exact label selector; switching to the textbox accessible role/name resolved it without changing assertions.

Native computer use edited the revision brief and clicked Start in the isolated Demo fixture. Read-only DB inspection confirmed inputRevision=2, status=completed, 12 runs/12 artifacts, and the exact Vietnamese brief entered through the UI. Fixture: %TEMP%/orglet-revision-J4aHfo; task a6cf08f4-9a7c-4d73-a8ee-669bd084e9ea. Test window closed. No real API calls. Packaged out/ now includes RunInput, v5 migration, core revisions and revision UI. Latest full core suite remains 108/15 from the preceding milestone; not rerun for UI-only changes.

Next: test/fix legacy backup merge after snapshot input backfill; add explicit revision history/report selection and persisted waiting-for-input lifecycle. Review folder intake for revisions and prevent presenting a prior synthesis as the current revision result while a new revision is incomplete. Full MVP remains incomplete; continue both plans.

### Earlier milestones (historical statements below may be superseded)

Core reviseTask and inputRevision orchestration are implemented. New revision uses selected sources/current instructions, fresh roles and matching preflight; old artifacts remain unchanged and budget stays cumulative. 108 tests/15 files and typecheck passed. No UI revision composer yet. out/ is stale relative to current core; rebuild for UI testing. No live processes/windows. See .agents/plans/review-input-revisions.md; preserve explicit consent and label cumulative task budget. Add compatibility coverage for importing legacy backups after old snapshot input backfill.

Preflight scope versioning is implemented: schema v5 migration retains old records and allows multiple scopes per task. Cache matching includes policy/source hashes/excluded count; backup validates scope uniqueness. Typecheck passed; 105/106 full tests passed, then the only stale version expectation was fixed and all eight checkpoint tests passed. New migration/scope tests passed. No UI or packaged validation this turn, and out/ still predates frozen-input/v5 changes. Rebuild before desktop verification. Remaining next step is revision orchestration plus user response composer; do not reuse old successful roles across different run inputs.

Frozen run input foundation is implemented: RunInput snapshots brief/sourceIds/excludedSources, all newly created roles capture it, Runner enforces it, exports and backup checks use it. 104 tests/15 files plus typecheck passed. Source/brief revision commands and response composer remain next; see .agents/plans/review-input-revisions.md. out/ predates these core changes and needs rebuilding. No processes/windows remain.

Evidence-request persistence/acknowledgment is implemented: final report missing checks append task.evidenceRequests atomically, backups validate/preserve them, and acknowledgeEvidence logs acknowledgment without changing report findings, check statuses or acceptance. UI has Ghi nhận giới hạn. Full suite 102 tests and typecheck passed; packaged template/backup E2E passed. Native computer use acknowledged a restored request and still saw insufficient evidence. Forge make completed and all test windows/processes closed. This does NOT finish the input workflow: supplementing sources, review revisions and waiting-for-input state are still absent. See the last implementation-status section before designing source mutations.

Checklist editor is complete: add/remove/rename required checks and choose evidence requirements in team settings; duplicate/blank names are rejected. Typecheck, 16 targeted tests and packaged checker/template/backup E2E passed. Native computer use renamed a check and saved revision 3; read-only fixture DB evidence confirmed the old task snapshot retained its prior checklist. Forge make completed; out/ is current. All test windows/processes closed. Quota last read: 94% used, 6% remaining. The handoff is ready; remaining substantive work is the persisted missing-evidence/review-revision flow, knowledge/context compiler, scoring and adapter/release/evaluation gates.

Feedback-copy action is complete: typed main/preload bridge, persisted artifact text from core, visible busy/error/success handling. Typecheck, six targeted integration tests and packaged finding E2E passed. Native computer use copied and pasted the exact fixture feedback into an unsent composer. Forge make completed, out/ is current, and all test windows/processes closed. Next remains persisted evidence requests/review revisions. App currently owns the composer inline in renderer/App.tsx; there is no separate Composer.tsx.

Required-checklist milestone is implemented and packaged. New Eris templates use generic Team.reviewPolicy with five required checks; missing items become not_assessed/insufficient_evidence. Run stability needs a valid supplied run-audit observation before PASS. All 102 tests passed; final tightened-status targeted tests (16) passed. Current Forge make and packaged checker/template/backup E2E passed. Native computer use opened a missing check on the restored Demo report. No live processes/windows remain. out/ is current, superseding the stale-build note below. See the final implementation-status section for exact limitations. Quota is down to 9%; this handoff is ready for another agent. Next substantive work is persisted input requests/review revisions, not redoing completed checks.

Join-integrity follow-up: core backup validation now rejects cyclic, duplicate and cross-task joins with recomputed checksums. Structured synthesis cannot recommend ready over upstream critical findings/unresolved recommendations. 99 tests/15 files and final typecheck passed. No UI changes; out/ still contains the preceding structured-review build and needs rebuilding before the next packaged test. The cyclic-graph concern in earlier notes is fixed. Template-required checks and input requests remain next.

Structured review contract/UI is now implemented as a partial milestone; see the final section of docs/implementation_status.md for exact checks and remaining integrity/UI gates. Latest suite: 97 tests/15 files; strengthened finding integration tests and final typecheck also passed. Forge make and extended finding E2E completed; native computer use observed the missing-log check and feedback and exercised its disclosure. No processes/windows remain. Continue template-required coverage and input requests; do not treat optional historical review metadata as a complete gate.

Earlier milestones:

Finding provenance and exact evidence navigation are implemented. Core assigns findingId/writerId/runId, validates checker references against the current run or frozen preflight and cited sources, and returns profile IDs to model tools. New findings carry category/recommendation/checkerIds. Backup validation rejects forged identities even with recomputed checksums. Markdown retains metadata. Previously exported Agent Skills report schemas remain supported.

Latest verification: 90 tests across 14 files, strict typecheck, Forge make, packaged finding E2E and general desktop smoke all passed. Native computer use observed the automatic text preview and exact linked CSV checker with 1 row and 2 columns. The UI report was a labelled synthetic fixture, not model output. All associated test windows and processes are closed. See docs/finding-ui-review.md and .agents/plans/finding-provenance.md. CI includes test:findings but has not run remotely.

The following paragraphs record earlier milestones; their test counts are historical.

Structured run-log auditing now uses the DuckDB utility process. One CSV/JSONL/Parquet with solution/run/split/metric/status/score columns produces failure counts, within-solution/split repeat summaries and comparable public/private ranks. Failed/cancelled scores are excluded rather than replaced with zero. There is no automatic stability PASS; missing repeats are insufficient evidence. The trusted `audit_run_log` model tool preserves checker provenance in exported run reports; manual checks remain in task history/backup. README defines the input format and limits.

Final run-audit E2E and desktop smoke passed. Native computer use ran the checker and, on the final UI, opened the rank disclosure and observed public 15 → private 1 = +14. Group/rank tables collapse separately to avoid burying results. Final Forge make finished; all associated processes/windows closed. Final fixture: `C:\Users\nxan2\AppData\Local\Temp\orglet-run-audit-ui-3p1czT`.

Agent Skills directory import, review and export are implemented. Packages retain all files, scripts never run, unsupported capabilities block activation, and local approval cannot be imported through a backup or team template. Resources are available through `read_skill_resource`, scoped to the reviewed snapshot. Native UI findings were fixed: distinguish same-name packages, align the review checkbox, and keep import errors visible inside the drawer.

Typecheck and all 83 tests passed. Desktop smoke, packaged checker/template/backup smoke and the new packaged skill smoke passed. Native computer use selected a script, inspected the blocked state, imported a package through the actual Windows folder picker and confirmed review. Final UI adjustments were verified by E2E. Forge make finished; ZIP, portable executable and unsigned Setup are under `out/`. Installer execution and live providers remain unverified. There are no running smoke/build processes or test windows from this milestone.

## Next work

Read `docs/mvp-gap-audit.md` before implementing the next milestone. The current-source audit confirms missing input-request states, structured overall checks/recommendation/feedback and conflict adjudication; it also confirms the core already runs in a utility process. The next cohesive change is the structured review contract followed by the missing-evidence interaction, not another isolated metadata field.

1. Add remaining scoring checks, line-level source positions, related/upstream finding references, explicit conflict preservation and structured overall recommendation/check coverage/draft feedback. Basic finding provenance/category/recommendation/checker links are implemented. Descriptive run-log audit is implemented; it does not recompute predictions/answers metrics or prove independent reruns. Missing-log gates still need full-plan auditing. Keep arbitrary downloaded code non-executable; do not use a real private Eris corpus without authorization.
2. Implement reusable-knowledge review/tags/pins/scoped search and instruction compiler selection/dedup/context manifests from plan section 7.3.
3. Audit remaining full-plan acceptance gates: rollback/migrations, global provider concurrency if required, release/dependency checks, installer/clean-machine validation, benchmarks and optional Codex adapter conformance. Codex subscription access is not implemented.
4. When the user supplies the key path, run the authorized small OpenAI acceptance task within $0.05. Do not report fixture tests as live API proof.

## Working commands

`node` and `pnpm` are available; `npm` is not on PATH. Direct local CLI commands avoid a previous package-manager housekeeping stall:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
node node_modules/@electron-forge/cli/dist/electron-forge.js make
node scripts/desktop-smoke.mjs
node scripts/packaged-checker-smoke.mjs
node scripts/routine-smoke.mjs
node scripts/skill-smoke.mjs --inspect-ui
node scripts/run-audit-smoke.mjs --inspect-ui
node scripts/finding-smoke.mjs --inspect-ui
```

Run checks when changes justify them; do not rerun passing checks as a ritual. Packaged tests require `--user-data-dir` isolation. For native computer use, follow the computer-use skill and use `@oai/sky` through the node REPL tool; the CUA browser tool has native app control disabled. Refresh window IDs from `sky.list_windows()` and interact only with the Orglet test window. Close fixture windows to let `--inspect-ui` finish.





