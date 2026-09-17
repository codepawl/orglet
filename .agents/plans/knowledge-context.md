# Reviewed knowledge and context compiler (plan §7.1, §7.3)

Knowledge items are app-owned records with immutable revisions (`knowledge`, `knowledge_revisions`, FTS5 `knowledge_search`; schema v6). Scope is workspace, one team or one worker. Status: proposed, approved, archived. Only approved revisions can enter a model context.

Model runs may propose up to three items through `submit_report.knowledgeProposals`. Core stores them as proposed, scoped to the run's team (or worker when standalone), with run/artifact provenance. A user approves the exact revision; editing creates a new revision. Team templates carry only that team's approved items and import them as proposed.

`core/context/compiler.ts` builds the system prompt in plan order (platform, team, role, skill), removes normalized duplicate blocks, selects in-scope approved knowledge (pinned first, then keyword overlap with the brief), enforces a byte budget and returns a manifest of loaded revisions/hashes and omissions (duplicate, context_limit, not_relevant). Runner freezes the selection and manifest in `run.snapshot.context` before the first dispatch, so resumed runs and later edits cannot change a run's context. Demo runs record the manifest too.

Proof: integration tests for proposal/approval gating, team/worker isolation with a shared worker, dedup, limits, frozen revisions, FTS search, backup/template scope and v5→v6 migration; packaged E2E and native computer use for the library review flow.
