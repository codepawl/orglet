# MVP scope audit

This is an implementation gap audit, not a completion certificate. The contract remains both files in `plans/`. Passing tests establish their tested behaviors, not all milestone acceptance gates. Updated 2026-09-18 for the 0.2.0 Windows scope.

## Status against the plan

| Plan requirement | Current evidence | Remaining work and proof required |
|---|---|---|
| §3.2, §8.3, demo 4: request missing evidence while independent work continues | `waiting_input` task state, persisted evidence requests, acknowledgment, supplement-by-revision, routine deferral, restart and backup preservation, all covered by integration and packaged revision E2E | Native UI checklist in [waiting-input-ui-review.md](waiting-input-ui-review.md); native computer-use rows still open |
| §3.4, §8.2, §11: structured checks, recommendation, draft feedback | Review contract with checks, recommendation, feedback, conflicts; required checklist editor; feedback copy; run-audit and pair-alignment evidence gates | Semantic quality needs live model evaluation |
| §8.2: conflicting findings and adjudication | Frozen upstream finding references, preserved conflicts, backup join-graph validation | Automatic detection of undeclared semantic disagreement is not attempted |
| §3.4, demo 3: finding to exact source | Source and checker links, line-level locations validated against the re-read source and highlighted | Locations for Parquet/binary sources are not supported |
| §7.1: context selection, deduplication, manifest | `core/context/compiler.ts`, frozen per-run context and manifest, tests for dedup, limits and scope | Byte budget is a proxy for tokens; provider tokenizers are not used |
| §7.3: reviewed reusable knowledge | Schema v6 knowledge with revisions, review, tags, pins, FTS5 search, workspace/team/worker scope, proposals from runs and templates, backup/template scope tests, packaged E2E | Native UI exercise |
| §8.1: conservative concurrency | Team task/role limits plus workspace provider request limit | None known |
| §9.2, M3: local harness backends (user decision 2026-09-16: Claude Code, Codex and other installed harnesses first) | Per-machine detection, read-only execution of `claude -p` and `codex exec` over source copies, same report gate, consent, cancellation; matrix in `docs/capabilities.md` Live reviews through both Claude Code and Codex verified 2026-09-16. Other harnesses (Gemini CLI, OpenCode) not added until one is installed to test against |
| §10.2: subscription quota and internal allocation | Hidden; neither CLI reports quota windows headlessly | Revisit if a harness exposes quota data |
| §11: data/scoring review | Profiling, run-log audit, two-file column/row/ID-set comparison and gate; bounded exact-match accuracy on an explicitly selected predictions/answers pair | Custom challenge metrics and official score equivalence remain unverified; arbitrary scoring code stays prohibited |
| §5, starter constraint 3: core utility process | Implemented | Keep packaged-process proof after changes |
| §8.4, M4: routines and recovery | Implemented and tested | None beyond native re-checks |
| M0/M5: install and clean Windows | Setup.exe built, unsigned | Run installer, startup and uninstall on a clean Windows test machine |
| M5: migration rollback, dependency/privacy review | Pre-upgrade copies and `docs/recovery.md`; local license and data-flow review in `docs/release-review.md` | Rollback onto an older installed build; vulnerability/maintenance audit with network access |
| §14: authorized corpus, holdout, A/B/C baselines | None | Authorized corpus, labels and protocol from the user |
| M1/M3/demo 2/6: live provider acceptance | SDKs tested against local HTTP/SSE fixtures | One OpenAI task capped at $0.05 once the user supplies a key-file path; Anthropic live run needs separate authorization |

## Next steps that need the user

1. Key-file path for the authorized OpenAI acceptance task.
2. A clean Windows machine or VM for installer validation, and whether to sign builds.
3. An authorized Eris case corpus with labels for §14.
5. Native computer-use checks of the knowledge, line-citation and waiting-input screens, if access to the Orglet window is granted.
