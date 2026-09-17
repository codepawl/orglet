# Review input revisions

Freeze brief, selected source IDs and excluded-source manifest on each run before dispatch. Runner uses frozen input while consent/revocation and budget remain live policy. Exports and backup relation validation must respect the run scope. Older history without input snapshots remains readable with its existing task scope; do not claim those old inputs were independently captured.

Implemented foundation: RunInput schema, creation for standalone/team runs, scoped runner dispatch, Markdown source list and backup validation. Next: source/brief revision command, same-thread history and a focused response composer. Preserve old artifact/source metadata and explicit provider consent when changing selected evidence. Do not simply replace task.sourceIds without a compatible history strategy.

Preflight prerequisite completed: schema v5 supports multiple preflights per task; scope matches source hashes, policy and excluded-source count. Revision orchestration still must bind the new run to the matching preflight and avoid retaining completed members from an older input revision.

Core reviseTask is now implemented with currentInput/inputRevision and history source union. Team reuse is restricted to the same revision. All new revision tests pass (108 full suite). UI is pending. Total task budget includes prior usage; the composer must label that clearly. Legacy snapshot backfill needs restore-merge compatibility coverage.
