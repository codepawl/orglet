# Agent Skills import and review

Implement the directory contract from https://agentskills.io/specification using yaml 2.9.1 (stable upstream release). Main owns bounded directory IO and native pickers; core validates the entire package and stores immutable bytes with its skill revision. Imported packages start unreviewed. Review is an explicit action against a content hash; worker assignment and execution enforce it. References are available through a built-in scoped text reader, never filesystem paths or execution. Unsupported capabilities block activation with reasons.

Preserve SKILL.md, references, assets and scripts for inspection/export. Export into a fresh directory without overwriting files. Orglet-specific manifest fields remain separate in orglet.json. Backups and team templates retain package contents but cannot transfer review authority. Add boundary and runtime tests, then packaged E2E and native computer use of the review flow.
