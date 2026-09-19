# Tool permissions

Core owns the tool catalog: each entry declares its input schema, required capability, deadline and cancellation behavior. The model receives only the tools allowed for its run stage and permissions. Core checks each returned call again before execution; text in a prompt or skill cannot grant access.

Runs freeze their capabilities when created. Every check intersects that snapshot with the task's current capabilities. Granting more access does not upgrade an existing run; reducing access cancels active work. Read results are checked again after IO so revoked content is not returned to the model.

The current catalog includes selected-source reads, reviewed skill resources, dataset checks and report/plan submission. API workers support source, skill and dataset capabilities. Source-only CLI harnesses receive only authorized copies; unsupported capabilities are rejected explicitly. Workspace and web execution are delivered in the next issue.

The typed `setToolCapabilities` command updates a task's grants. Imported task and routine backups retain their history but start with no tool permissions. Historical run snapshots do not grant access by themselves.

Verification: `tool-policy.test.ts` covers denied calls, invalid schemas, snapshot intersection, revocation during reads, active-request cancellation, tool timeout, restored grants and source withholding for each CLI fixture. These fixtures do not establish live CLI containment or provider authentication.
