# Waiting-for-input UI review

Contract: after a final report with `not_assessed` checks, the task stays in `waiting_input` while runs remain completed. The user can acknowledge limits, accept without changing the report, or supplement via a new revision. Routines defer while the prior task waits.

## Packaged evidence (automated)

[`scripts/revision-smoke.mjs`](../scripts/revision-smoke.mjs) (`pnpm test:revisions`) already exercises:

1. Demo / Eris path that ends in `waiting_input`
2. `acknowledgeEvidence` leaves status `waiting_input`
3. Supplement via `reviseTask` (new input revision) while prior artifacts stay intact
4. History selection of the earlier revision

Integration coverage: team/preflight and revision tests assert routine deferral and backup preservation of `waiting_input` (see [`docs/mvp-gap-audit.md`](mvp-gap-audit.md)).

## Native computer-use checklist (manual)

Run against a packaged build when access to the Orglet window is granted. Prefer an isolated `--user-data-dir`.

| Step | Expected | Result |
|---|---|---|
| Open a Demo Eris task that finished with missing checks | Status shows waiting for evidence; Accept and supplement actions available; blind Retry hidden | Not run this session |
| Click **Ghi nhận giới hạn** | Success toast; status remains waiting; report checks unchanged | Not run this session |
| Supplement sources / brief and send a revision | New revision completes; old artifacts unchanged; history can show revision 1 | Not run this session |
| Restart the app with the same user data | Waiting task still waiting; acknowledgment preserved | Not run this session |
| Restore a backup that contains a waiting task | Status and pending evidence requests survive | Not run this session |
| Enable a routine whose last task is waiting | Catch-up / next occurrence deferred until the wait is resolved | Not run this session |

## Bugs found

None in this pass (no native session). No product code changes.

## Follow-up

Re-run the native table above and replace “Not run this session” with pass/fail evidence (screenshots under `test-results/`). Update [`mvp-gap-audit.md`](mvp-gap-audit.md) when native rows pass.
