# Structured review contract

Add optional stored review metadata for legacy compatibility, required by new model tool schemas. Include named checks with status, coverage, sources/checkers, overall recommendation, draft feedback, frozen upstream finding references and unresolved conflicts. Validate references and conservative recommendation invariants in core and backups. Preserve original member artifacts; conflicts expose both original findings instead of replacing them. Existing reports and exported skill schemas remain readable.

Implement core/schema and regression coverage first, then renderer/Markdown and packaged/native UI checks. Missing-evidence input requests, review revisions and knowledge remain separate required work; this contract is their foundation. Never infer semantic completeness or live-provider success from schema tests.
