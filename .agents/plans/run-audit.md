# Structured run-log audit

Extend the trusted dataset utility process with an explicit run-log mode. Accept CSV/JSONL/Parquet logs using columns solution, run, split, metric, status and score; optional error_code. One metric per log, score direction selected explicitly. Refuse ambiguous/invalid rows and duplicate run identities. Bound input to 10,000 rows and 200 solution/split groups in the existing 32 MB / utility-process memory/time limits.

Compute per-solution/split repeat summaries and failure counts. Compare public/private mean-score ranks only when both splits cover the same solutions with completed observations. Use competition ranks for ties; report public rank minus private rank as improvement. Never infer challenge validity from rank changes, differences across solutions or an arbitrary stability threshold. Missing repeated observations remains insufficient evidence.

Store the result through existing ProfileRecord/source hashes, expose it through a dedicated trusted tool and source-panel action, preserve it in backups and Markdown exports, and add deterministic fixtures plus packaged E2E/native UI checks. Scoring-code execution remains out of scope for this checker, not completed by these observations.
