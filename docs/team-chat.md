# Team and worker chat

Shipped in [COD-24](https://linear.app/codepawl/issue/COD-24) (team shell), [COD-25](https://linear.app/codepawl/issue/COD-25) (orchestrator) and [COD-26](https://linear.app/codepawl/issue/COD-26) (hide the task pile) under epic [COD-22](https://linear.app/codepawl/issue/COD-22). Long-chat context, memory, cost and fail-closed rules stay in [team-chat-context.md](team-chat-context.md) (the five policy defaults are approved). This page is what the app does **today**.

It does not change signing / [COD-19](https://linear.app/codepawl/issue/COD-19) / [COD-20](https://linear.app/codepawl/issue/COD-20).

## Mental model

Work is a **chat**, not a pile of tasks or sessions.

- Click a **worker** → that worker's conversation.
- Click a **team** → that team's conversation (roster under the row and in the header).
- One live thread per worker and per team. A new message is a turn in that chat, not a new row in the sidebar.
- Archive the thread (⋯ next to **Chi tiết**) to start over. Search still finds older or archived chats.
- **Lịch chạy** stays a list of discrete scheduled jobs. Those rows are not merged into the infinite chat.

Under the hood the thread is still a `tasks` row. **Chi tiết** lists internal `runs` (plan, members, synthesis, or the single worker job) for retry, cost and cancel. Dollars sit next to **Chi tiết**.

## Click a worker or team → that chat

1. Click a **name** in **Nhân viên** or **Nhóm**. The main pane opens that conversation.
2. If there is no live thread yet, you get an empty chat (composer pinned at the bottom). The first send creates the thread.
3. If a live thread already exists, it opens with the saved messages. Later sends are follow-ups in the same chat.

The chevron next to a **team** avatar still expands or collapses the roster. Clicking the team name selects the team and keeps the roster open. **Workers have no nested task list.**

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

In a **team** or **group** chat, type `@` in the composer to pick a worker, `@all`, or the team name. Tagged names highlight in the message.

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
