# Tool permissions

Core owns the tool catalog: each entry declares its input schema, required capability, deadline and cancellation behavior. The model receives only the tools allowed for its run stage and permissions. Core checks each returned call again before execution; text in a prompt or skill cannot grant access.

Runs freeze their capabilities when created. Every check intersects that snapshot with the task's current capabilities. Granting more access does not upgrade an existing run; reducing access cancels active work. Read results are checked again after IO so revoked content is not returned to the model.

The current catalog includes selected-source reads, reviewed skill resources, dataset checks and report/plan submission. API workers support source, skill and dataset capabilities. Source-only CLI harnesses receive only authorized copies; unsupported capabilities are rejected explicitly. The workspace backend and permission-gated API web tools are described below.

The typed `setToolCapabilities` command updates a task's grants. Imported task and routine backups retain their history but start with no tool permissions. Historical run snapshots do not grant access by themselves.

Verification: `tool-policy.test.ts` covers denied calls, invalid schemas, snapshot intersection, revocation during reads, active-request cancellation, tool timeout, restored grants and source withholding for each CLI fixture. These fixtures do not establish live CLI containment or provider authentication.

## Workspace and web backend

The workspace backend snapshots an explicitly granted folder into a private copy. It lists, searches, reads and conditionally writes relative paths. The helper rejects traversal, internal paths, Windows aliases and links that leave its boundary. Source attachments do not grant folder-write access.

On Windows x64, commands run in a BaseContainer with only the private copy writable. They do not inherit host secrets or network access. Process handles expose status and paged stdout/stderr, and cancellation waits for the sandbox process tree. Deadlines and output limits are enforced by the executor. Unsupported isolation platforms fail closed.

Process state and tool results use local journals. An interrupted effect is uncertain, not successful, and is not launched again automatically. Grants and local directory paths are excluded from exported backups. The original folder is not changed by these backend operations; guarded integration, Git worktrees and recovery controls arrive with the persistence and UI changes.

API workers can use `web_read_url` and `web_search` only with an explicit `network.web` capability. Retrieval validates public addresses, pins DNS results, bounds redirects and output, and returns source URLs and untrusted text. Search challenges fail explicitly. Source-only CLI workers still reject this capability until the controlled CLI tool bridge is integrated.

This change supplies the workspace execution backend and core grant services. Workspace tool dispatch and desktop grant controls are connected by the following integration changes. It does not claim that the current desktop UI exposes file editing yet.

Verification includes file/path fixtures, grant revocation and backup boundaries, process handles, web permission/provenance tests, and packaged isolation through `pnpm test:isolation --packaged`. Native tests are separate from model/provider fixtures.

## Team coordination

Each message belongs to one team, turn and assignment. Questions require a response; acknowledging a message cannot silently close a question or blocker. Processed responses and handoffs remain acknowledged after resume. Two questions per assignment are allowed; further questions become blockers for the lead. The turn also has a bounded message count.

The lead can record a resolution or reassign an unfinished assignment to a member frozen into the current turn. Reassignment preserves resources and dependencies and intersects both workers' original grants. At most two reassignment attempts are allowed per assignment. Dispatch alone never counts as success: dependents wait for committed output, and unresolved blockers keep the final result partial.

The API orchestration tests cover parallel question/response exchange, durable acknowledgements, cross-team rejection, failed prerequisite recovery, pause/resume and cancellation on a recovery deadline. CLI fixtures are connected with the controlled harness bridge in the integration layer; these tests do not establish live provider behavior.
