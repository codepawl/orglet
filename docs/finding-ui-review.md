# Finding evidence navigation

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/orglets/finding-ui-review-dark.png">
  <img src="images/orglets/finding-ui-review-light.png" alt="" width="112" height="112" align="right">
</picture>

The packaged app was tested with an explicitly labelled synthetic report in an isolated database. Its CSV profile was produced by the real local checker; the report was inserted after closing the database. This tests presentation and navigation, not model analysis.

Packaged E2E passed provenance display, exact source focus and automatic text preview, exact checker focus and expansion, and overflow at 780 × 640. Evidence is in `test-results/finding-smoke.json` and `test-results/finding-evidence.png`.

Native Windows computer use separately clicked evidence.txt and observed both preview lines. After Escape, clicking Xem checker 1 opened the referenced DuckDB result with data.csv, 1 row and 2 columns. The target was visible without manually searching the drawer. The test window was closed and the smoke process exited successfully.

Core integration tests separately cover assigned authorship, usable checker IDs, unknown/cross-run/unrelated-source references, backup tampering, legacy reports and Markdown preservation. The full suite passed 90 tests across 14 files; strict typecheck and the general desktop smoke passed. Forge produced ZIP and unsigned Setup. No live provider or installer execution was tested.

The implementation reuses the existing source drawer and report renderer. Navigation targets are typed and scoped to the task; preview still uses the permission-checked core command. Imported old reports do not acquire fabricated provenance. Line-level citations, related findings and conflict metadata remain open.

The structured-review extension also passed packaged checks for insufficient evidence, a not-assessed run-stability check and draft feedback. Native computer use scrolled to these fields and collapsed the check disclosure. Conflicting-member presentation has not yet received a native fixture check.

Required-checklist extension: packaged Eris Demo showed all five required checks as not assessed. Team-edit, template and backup roundtrip retained the policy. Native computer use opened Run stability after restore and observed the missing-assessment explanation. This was the actual Demo pipeline, not a manually inserted report.

Feedback copying: E2E captured the main clipboard write and matched persisted feedback, then restored the real function. Native computer use clicked Copy, opened an unsent composer and pasted the exact fixture feedback. No task was submitted.

Checklist editor: E2E covers duplicate rejection, adding/removing a row and saving. Native computer use renamed a check and saved; isolated read-only DB inspection confirmed the new revision and unchanged prior task snapshot. No UI error remained in this flow.

Evidence requests: native computer use clicked Ghi nhận giới hạn on the restored Demo task, observed acknowledgment and unchanged insufficient-evidence status. E2E verified that pending requests survived backup. No source supplementation or rerun was tested because those flows remain unimplemented.
