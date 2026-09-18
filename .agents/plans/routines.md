# Routines and shifts

Add daily/weekly local schedules to the existing single-writer core. Persist the next UTC due time, one missed-run prompt and last task. Reuse task creation, source verification, provider consent, reservations and checkpoints. Advancing an occurrence and creating its task must share a transaction. Startup/sleep never replays missed occurrences automatically. Config changes invalidate saved recurring approval.

Team work hours and task concurrency are live policies. Reject new starts outside a shift or over capacity, pause active tasks at step boundaries when a shift ends, and generate a deterministic handoff from committed artifacts, blockers, next steps and usage. No worklog model call.

UI: existing monochrome drawers, native time/select/checkbox controls; routine list shows next run and one explicit catch-up action. On reopen, a status notice explains that missed runs coalesced and the calendar stayed put. Configure from selected brief/sources, manage from sidebar. Preserve existing type/color tokens. Verify timezone/DST, restart, atomic claims, consent, source changes, concurrency, shift handoff, backup and native UI.
