# Team chat

Shipped in [COD-24](https://linear.app/codepawl/issue/COD-24) (shell) and [COD-25](https://linear.app/codepawl/issue/COD-25) (orchestrator) under epic [COD-22](https://linear.app/codepawl/issue/COD-22). Long-chat context, memory, cost and fail-closed rules stay in [team-chat-context.md](team-chat-context.md) (the five policy defaults are approved). This page is what the app does **today**.

It does not hide the task pile ([COD-26](https://linear.app/codepawl/issue/COD-26)), or change signing / [COD-19](https://linear.app/codepawl/issue/COD-19) / [COD-20](https://linear.app/codepawl/issue/COD-20).

## Click a team → that team's chat

The sidebar **Nhóm** list is the way into team chat, not only a roster.

1. Click a **team** name. The main pane opens that team's conversation. Members stay visible under the team row and as avatars in the header.
2. If this team has no live thread yet, you get an empty chat (composer pinned at the bottom). The first send creates the thread.
3. If a live thread already exists, it opens with the saved messages. Later sends are follow-ups in the same chat.

The chevron next to the avatar still expands or collapses the roster. Clicking the name selects the team and keeps the roster open.

**Công việc mới** (Ctrl+N) leaves team chat and starts a normal new-task composer for a worker. Picking a team in that composer's recipient menu opens that team's chat again.

## One live thread per team

Policy: one open conversation per team; archive it to start over; do **not** create a new `tasks` row on every message ([team-chat-context.md](team-chat-context.md)).

There is no separate `threads` table. The thread is the newest non-archived, non-deleted `tasks` row with that `teamId`, no `assignees`, and no `routineId`.

| User does | Core |
|---|---|
| First message in this team's chat | `createTask` with `teamId` (synthesizer as `workerId`) |
| Later message in the same chat | `reviseTask` on that row (`inputRevision` + 1) |
| Archive the thread | Next click is an empty chat; the next send creates a new live row |

Find-or-create lives in `apps/desktop/src/shared/live-task.ts` (`liveTeamTask`, `nextTeamMessage`). The renderer uses it when you click a team and when you send from the empty team composer. `createTask` itself is unchanged, so routines and explicit extra team tasks can still insert their own rows.

Routines under **Lịch chạy** stay discrete tasks. They are not merged into the team chat.

Until COD-26, **Công việc** may still list the live thread as a task. Opening that row is the same conversation.

## Orchestrator: one message → workers → one report

A user message on a team thread is one turn. The synthesizer (team lead) runs a **plan** job, then only the assigned members run as internal jobs, then one **synthesis** report comes back to the chat.

```
User message (inputRevision)
  → plan run (synthesizer, stage: plan)     hidden job
  → member runs (assigned workers only)     hidden jobs
  → synthesis run (stage: synthesis)        the report in the transcript
```

- Plan may assign a **subset** of members. Unassigned members are cancelled with a named skip (`Không được phân việc cho lượt này.`); they are not treated as failures.
- Member chatter is **not** the user-facing transcript. **Chi tiết** still lists every job (plan, members, synthesis) for retry, cost and cancel.
- Demo assigns every member the user brief (no invented extra workers) and does not call a model for routing.

### Fail-closed

| Event | Thread shows | Dispatch |
|---|---|---|
| Plan fails (schema, unknown worker, provider) | Team-lead error on this turn | No member jobs, no invented report. Status `failed`. |
| A member fails | That worker's name; synthesis limitations `Role chưa hoàn tất`; status `partial` | Remaining assigned members keep today's rule. Synthesis must not invent the missing result. |
| All assigned members fail | Failed turn | No synthesis report |
| Cancel | `cancelled` | In-flight request may still bill; queued jobs are not started |
| Retry | Same thread | Reuses a completed plan; starts **new** runs only for unfinished jobs of **this turn** |

Cancel aborts the whole turn (plan + members + synthesis). Partial success stays `partial`, never silent `completed`.

## How this relates to worker chat

Worker chat is unchanged.

- Click a **worker** to pick them for a new message, or open a task under that worker. That is still today's standalone (or group) path: no `teamId`.
- A **group** chat (several workers, or everyone) still uses `assignees` and sequential `stage: 'group'` replies. That is not a team.
- A **team** chat uses `teamId` + `teamSnapshot` and `TeamRunner.run`: plan → members → synthesis.

You can still open an existing worker task while a team chat exists. The two threads do not share a `tasks` row.

## Errors, budget, retry

Refuse, budget and run errors stay on **this** thread (status copy, **Chi tiết**, retry / resume / cancel on the same task). A failure does not open a new session. Cost still sits next to **Chi tiết**; settled tokens on the latest turn. The rolling-summary / retrieval layers in [team-chat-context.md](team-chat-context.md) are not in this spike; follow-ups still send the existing truncated history window (10 turns / 24 000 characters).

## Code

- Click / send: `apps/desktop/src/renderer/App.tsx` (`openTeam`, `send`)
- Identity: `apps/desktop/src/shared/live-task.ts`
- Persist a turn: `createTask` / `reviseTask` in `apps/desktop/src/core/service.ts`
- Orchestrator: `apps/desktop/src/core/orchestration/team.ts` (`run`) and `plan.ts`
- Plan tool / Demo routing: `apps/desktop/src/core/orchestration/runner.ts` (`submit_plan`, `completePlan`)
- Tests: `tests/integration/team.test.ts`, `tests/integration/live-task.test.ts`
