# Team and worker chat

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/orglets/team-chat-dark.png">
  <img src="images/orglets/team-chat-light.png" alt="" width="112" height="112" align="right">
</picture>

Team plans can declare an expected output, dependencies on other assigned members, and workspace resources they intend to change. With a workspace grant, the lead can inspect its files and brief through read-only tools before choosing those paths. Members report whether their assignment completed or is blocked; a saved blocker report remains visible but does not satisfy a dependency. A file assignment with no integrated changes is blocked even if its report claims completion. Failed prerequisites block downstream work and remain visible in the final status. Independent members can still run two at a time; overlapping file or directory ownership is serialized, including case aliases on Windows. Resource ownership does not grant permission to edit files.

The core claims each member run in a SQLite transaction. A second claim for the same worker and turn is rejected, as is a claim for an older input revision. Retries keep completed results. Older saved plans without dependency or resource fields retain their independent-work behavior. Declared ownership currently coordinates members within one task; workspace-wide file execution and isolation are still pending.

Shipped in [COD-24](https://linear.app/codepawl/issue/COD-24) (team shell), [COD-25](https://linear.app/codepawl/issue/COD-25) (orchestrator) and [COD-26](https://linear.app/codepawl/issue/COD-26) (hide the task pile) under epic [COD-22](https://linear.app/codepawl/issue/COD-22). Long-chat context, memory, cost and fail-closed rules stay in [team-chat-context.md](team-chat-context.md) (the five policy defaults are approved). This page is what the app does **today**.

It does not change signing / [COD-19](https://linear.app/codepawl/issue/COD-19) / [COD-20](https://linear.app/codepawl/issue/COD-20).

## Mental model

Work is a **chat**, not a pile of tasks or sessions.

- Click a **worker** → that worker's conversation.
- Click a **team** → that team's conversation (roster under the row and in the header).
- One live thread per worker and per team. A new message is a turn in that chat, not a new row in the sidebar.
- Archive the thread (⋯ next to **Chi tiết** / Chat details) to start over. Search still finds older or archived chats.
- **Lịch chạy** stays a list of discrete scheduled jobs. Those rows are not merged into the infinite chat.

Under the hood the thread is still a `tasks` row. **Chi tiết** lists internal `runs` (plan, members, synthesis, or the single worker job) for retry, cost and cancel. Dollars sit next to **Chi tiết**.

**Tool permissions** in Chi tiết belong to the chat and are there before anything is sent (COD-178). For an empty chat the three switches set what the first message will start with; the core keeps that set under the worker or team until `createTask` moves it onto the new row, and the folder is chosen after the first message because a grant is made for one task. Each run freezes its permissions when it starts, not when the message was sent: turning on the web while the lead is still routing reaches the member and report runs that have not started, and a run already working keeps what it started with. See [agent-tools.md](agent-tools.md).

For a reassigned member, Chi tiết names the worker who actually ran the attempt and its original assignment owner. Lead context and recovery results carry both identities from saved runs and artifacts, plus failed attempt history; the original owner is never treated as the file author merely because the plan named them.

## Click a worker or team → that chat

1. Click a **name** in **Nhân viên** or **Nhóm**. The main pane opens that conversation.
2. If there is no live thread yet, you get an empty chat (composer pinned at the bottom). The first send creates the thread.
3. If a live thread already exists, it opens with the saved messages. Later sends are follow-ups in the same chat.

A **team** row is one row: clicking it opens that team's chat. Its members are listed in the chat **Details** panel, not nested under it in the sidebar. **Workers have no nested task list.**

Ctrl+N focuses the current worker or team chat (it does not create a new session). Search (Ctrl+K) finds chats by their text, including archived ones.

## One live thread

Policy: one open conversation per worker and per team; archive it to start over; do **not** create a new `tasks` row on every message ([team-chat-context.md](team-chat-context.md)).

There is no separate `threads` table.

| Thread | Identity |
|---|---|
| Worker chat | Newest non-archived, non-deleted `tasks` row with that `workerId`, no `teamId`, no `assignees`, no `routineId` |
| Team chat | Newest non-archived, non-deleted `tasks` row with that `teamId`, no `assignees`, no `routineId` |

| User does | Core |
|---|---|
| First message in this chat | `createTask` (`teamId` + synthesizer as `workerId` for a team) |
| Later message in the same chat | `reviseTask` on that row (`inputRevision` + 1) |
| Archive the thread | Next click is an empty chat; the next send creates a new live row |

Find-or-create lives in `apps/desktop/src/shared/live-task.ts` (`liveWorkerTask`, `liveTeamTask`, `nextWorkerMessage`, `nextTeamMessage`). The renderer uses it when you click a worker or team and when you send from the empty composer. `createTask` itself is unchanged, so routines and explicit extra rows can still insert their own records. Group chats (`assignees`) stay reachable from search; they are not the primary sidebar.

## Orchestrator: one message → workers → one report

A user message on a team thread is one turn. The synthesizer (team lead) runs a **plan** job, then only the assigned members run as internal jobs, then one **synthesis** report comes back to the chat.

For a choice that materially changes the work, the lead can ask one short question with two or three choices before dispatching members. A solo API worker can do the same. The question pauses the current run; choosing an option or replying in the composer resumes it from its saved checkpoint, without creating another turn or expanding its grants. The question and answer stay in **Details → Chat decisions**. At most two such questions are allowed in a turn. A fresh request sent after a completed turn is still a new turn. Source-only CLI sessions currently ask in a normal reply rather than using this pause mechanism; tool-loop CLI sessions can use it.

An API worker or team lead can save one interpretation for a turn before assigning work or changing files. The chat shows its short goal; **Details → Turn goal** separates user-stated constraints, unconfirmed assumptions, and planned checks. The record is part of the run snapshot and survives backup. It does not grant access or prove that the planned checks ran. A tool-loop CLI can use the same record; a source-only CLI cannot call this tool.

A new user message can also revise a turn that is still running. Core stores the new input revision before cancelling active worker and team runs, then dispatches it only after the old run settles. The old attempts and committed outputs remain in Details. If the app restarts during that handoff, the new message stays saved but needs an explicit resume; it is not silently replayed. Cancel while the new revision is waiting drops its pending dispatch.

The latest turn shows a compact summary of saved workspace command exits and any file conflicts or uncertain calls. It counts only runs in that turn. An exit code of zero reports that a command finished successfully; it does not establish that every planned check or the whole task passed. Detailed output and recovery stay in Details.

```
User message (inputRevision)
  → plan run (synthesizer, stage: plan)     hidden job
  → member runs (assigned workers only)     hidden jobs
  → synthesis run (stage: synthesis)        the report in the transcript
```

- Plan may assign a **subset** of members. Unassigned members are cancelled with a named skip (`Không được phân việc cho lượt này.`); they are not treated as failures.
- Member chatter is **not** the user-facing transcript. **Chi tiết** still lists every job (plan, members, synthesis) for retry, cost and cancel. The thread copy/download on the synthesis reply is `Sao chép` / `Tải xuống`. Hidden job artifacts in Chi tiết still export with `Xuất báo cáo này` (the first Chi tiết `<details>` is `Context đã nạp` on the plan job, not a report).
- Demo assigns every member the user brief, or only members you `@` tagged (no invented extra workers), and does not call a model for routing.

### Fail-closed

| Event | Thread shows | Dispatch |
|---|---|---|
| Plan fails (schema, unknown worker, provider) | Team-lead error on this turn | No member jobs, no invented report. Status `failed`. |
| A member fails | That worker's name; synthesis limitations `Role chưa hoàn tất`; status `partial` | Remaining assigned members keep today's rule. Synthesis must not invent the missing result. |
| All assigned members fail | Failed turn | No synthesis report |
| Cancel | `cancelled` | In-flight request may still bill; queued jobs are not started |
| Retry | Same thread | Reuses a completed plan; starts **new** runs only for unfinished jobs of **this turn** |

Cancel aborts the whole turn (plan + members + synthesis). Partial success stays `partial`, never silent `completed`. Worker chat is one run with no `stage`.

## @mentions

In a **team** or **group** chat, type `@` in the composer to pick a worker or `@all`. Tagged names highlight in the message. The team's own name is not offered, because tagging it means what `@all` means; typed by hand it still works, so older messages keep their meaning.

- **Group chat:** only tagged assignees answer that turn. `@all`, the team name, or no tag keeps everyone.
- **Team chat:** Demo assigns the tagged members. A live planner is told who you tagged and may still assign others. Untagged messages still assign every member.

Unknown `@` text is left as typed and does not change who runs.

## Errors, budget, retry

Refuse, budget and run errors stay on **this** thread (status copy, **Chi tiết**, retry / resume / cancel on the same task). A failure does not open a new session. Cost still sits next to **Chi tiết**; settled tokens on the latest turn. If the compacted prompt is still over 200 KB, the send is refused (no reservation, no model call) with a repair message. Rolling summary and thread-memory retrieval are frozen on the run manifest (**Chi tiết → Context đã nạp**).

## Code

- Click / send: `apps/desktop/src/renderer/App.tsx` (`openWorker`, `openTeam`, `send`)
- Identity: `apps/desktop/src/shared/live-task.ts`
- Mentions: `apps/desktop/src/shared/mentions.ts`
- Persist a turn: `createTask` / `reviseTask` in `apps/desktop/src/core/service.ts`
- Orchestrator: `apps/desktop/src/core/orchestration/team.ts` (`run`) and `plan.ts`
- Transcript layers: `apps/desktop/src/core/context/thread.ts`
- Plan tool / Demo routing: `apps/desktop/src/core/orchestration/runner.ts` (`submit_plan`, `completePlan`)
- Tests: `tests/integration/team.test.ts`, `tests/integration/live-task.test.ts`, `tests/integration/thread-context.test.ts`, `tests/integration/mentions.test.ts`
## Worker messages

Every saved user turn, completed answer and team message has a stable ID. Reply chooses one of those messages in the current chat; core resolves the ID when the next turn starts and supplies a short, attributed excerpt to the worker. A reply never broadens the worker's sources, workspace access or team assignment. The user can react to any saved message without starting a run. Reactions belong to an actor, message and emoji, so repeating the same request is harmless. The latest user reaction on an answer is also explained in the next brief. A worker may use `react_to_message` only during its assigned run and only for a committed message it can see; this tool does not send a team message or start another worker. Team message bodies and interactions appear in Details. These links and reactions survive restart, archive and backup; restoring a backup does not restore execution rights.

Reply quotes open their original message in the chat or Details. Details lists reaction counts and actors. Downloading an answer or report includes its message ID, reply link and reactions; copying keeps just the answer text. A download of one answer does not export the full chat graph, so use backup export to move the entire conversation.

API workers can send a question, response, blocker or handoff to another assigned participant in the same team turn. The event journal keeps the sender, recipient, run, turn and reply link. It also keeps acknowledgements, so resuming does not redeliver a processed handoff. A repeated tool call returns its saved message instead of sending another copy.

An invalid recipient ID returns the current turn's valid recipients to the worker for a same-run correction. No message is stored for the rejected ID, and receiving a message never starts an agent or changes file permissions.

A worker can ask two questions per assignment. A third becomes a blocker addressed to the lead. Sending a message never launches another agent or grants permissions. Workers can read their inbox during their existing run; the lead can inspect pending messages across the turn. The existing six-step and spending limits still apply. A dependent worker sees the handoff when it starts.

Unanswered questions and blockers keep the final task partial. The lead receives them as limitations and must preserve disagreements. The lead can record a resolution or reassign unfinished work to a member from the frozen roster. Reassignment preserves dependencies and resource ownership and narrows permissions to the intersection of both workers. Core dispatches the new attempt before continuing waiting dependents. API and CLI tool-loop fixtures cover messaging, reassignment, pause and cancellation; live CLI sessions remain unverified. See [agent tools](agent-tools.md) for limits and recovery controls.

Message-interaction integration fixtures cover API tool calls, reply context, duplicate reactions, wrong-chat and unfinished targets, and backup restoration. The CLI tool bridge advertises the same tool catalog; this does not prove a live signed-in CLI session or its native tool containment. The renderer and packaged app still need manual interaction checks for keyboard and screen-reader behavior.

Chat progress includes each assignment's brief beside its worker and status. Long briefs use a native disclosure: the short description stays visible, and opening it shows the full text. The disclosure works with the keyboard as well as the pointer.
