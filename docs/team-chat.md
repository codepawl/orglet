# Team chat

Shipped in [COD-24](https://linear.app/codepawl/issue/COD-24) under epic [COD-22](https://linear.app/codepawl/issue/COD-22). Long-chat context, memory, cost and fail-closed rules stay in [team-chat-context.md](team-chat-context.md) (the five policy defaults are approved). This page is what the app does **today**.

It does not add the COD-25 orchestrator (plan → N members → one report), hide the task pile (COD-26), or change signing / [COD-19](https://linear.app/codepawl/issue/COD-19) / [COD-20](https://linear.app/codepawl/issue/COD-20).

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

## How this relates to worker chat

Worker chat is unchanged.

- Click a **worker** to pick them for a new message, or open a task under that worker. That is still today's standalone (or group) path: no `teamId`.
- A **group** chat (several workers, or everyone) still uses `assignees` and sequential `stage: 'group'` replies. That is not a team.
- A **team** chat uses `teamId` + `teamSnapshot`. Execution is today's member → synthesis workflow (`TeamRunner.run`): members run, then the synthesizer joins. There is no new orchestrator. Member reports stay in **Chi tiết**; the main transcript shows the synthesis (or chat) result for that turn.

You can still open an existing worker task while a team chat exists. The two threads do not share a `tasks` row.

## Errors, budget, retry

Refuse, budget and run errors stay on **this** thread (status copy, **Chi tiết**, retry / resume / cancel on the same task). A failure does not open a new session. Cost still sits next to **Chi tiết**; settled tokens on the latest turn. The rolling-summary / retrieval layers in [team-chat-context.md](team-chat-context.md) are not in this spike; follow-ups still send the existing truncated history window (10 turns / 24 000 characters).

## Code

- Click / send: `apps/desktop/src/renderer/App.tsx` (`openTeam`, `send`)
- Identity: `apps/desktop/src/shared/live-task.ts`
- Persist a turn: `createTask` / `reviseTask` in `apps/desktop/src/core/service.ts`
- Team run: `apps/desktop/src/core/orchestration/team.ts` (`run`, not `chat`)
- Tests: `tests/integration/live-task.test.ts`, plus the live-thread case in `tests/integration/team.test.ts`
