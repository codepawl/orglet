# Memory

A worker remembers its chats. The next time you talk to it, in any chat, it already knows how you like things done, which files you mean, what was decided, and what not to do again. You can read every memory, correct it, pin it or delete it. Nothing is hidden and nothing leaves your computer.

Decided with An on 2026-09-23 (COD-161). This page is how it works and the decisions behind it. For reviewed notes, see the knowledge section of the [technical guide](technical-guide.md#knowledge).

## Memory and knowledge

Both live in the same store (the `knowledge` table), with the same scopes and revision history. They are different things:

| | Knowledge (a note) | Memory |
|---|---|---|
| Who writes it | You, or a worker proposes it and you review it | The worker, during a chat |
| When it is active | After you save or approve it | At once |
| What it holds | Reusable guidance, up to 8 000 characters, with a title and tags | One short line, up to 500 characters |
| Where you edit it | Library → Knowledge | The worker's own page (Edit → Memory), or Library → Memory |
| What it is for | Telling workers how to do a kind of work | A fact learned about you and your work |

A memory is a fact learned ("prefers short answers", "the quarterly file is report-q3.xlsx", "we decided to keep the old scoring script"). A change in how the worker works (new instructions, a new skill, a different model) is not a memory; a worker proposes one sentence for its own instructions after repeated feedback, and only your click applies it. See [self-improvement.md](self-improvement.md).

A memory is also not the thread context of one chat. The extractive summary and the retrieved snippets in [team-chat-context.md](team-chat-context.md) stay inside the chat they came from. A memory crosses chats.

## How a worker remembers

**In the tool loop** (API providers, Ollama, OpenCode, and a harness with a working folder, web or data checks) the worker has a `remember` tool: one short line and a scope. `worker` (the default) keeps the line for that worker alone; `team` shares it with the worker's team and is refused outside a team chat; `workspace` gives it to every worker. The tool needs no switch. A memory is visible and editable and never grants anything, and a chat is where you are teaching the worker. It is not offered on a scheduled run: nobody is watching, so a routine must not build up a memory on its own.

**In a one-shot harness answer** (Claude Code, Codex or Cursor Agent without a working folder, web or data checks) there is no tool loop. The JSON answer carries an optional `memories` array of the same items, at most five per answer, the same way it carries `appProposals` ([agent-tools.md](agent-tools.md#proposing-app-changes)). Each item is stored through the same path as a tool call. An item the worker got wrong (a team scope outside a team, a malformed item) becomes a limitation of the answer and the rest are still stored.

A memory is written the moment the tool runs, not when the run ends. A colleague remembers even when the reply that followed failed.

**Untrusted input.** A run that has already read a web page, an attached file, a workspace file or another worker's message cannot make an active memory: the line is stored as `proposed` and waits in Library → Knowledge → Waiting for review, next to proposed notes. Approving it makes it active; rejecting archives it. A one-shot harness answer with any source attached is treated the same way. This mirrors how app proposals hold on untrusted input (COD-199): the whole run is treated as tainted from the first unvetted read. A line remembered before the first read comes from your own words and is active.

## Kept small

- **Cap.** Each scope (one worker, one team, the workspace) keeps at most 60 active memories.
- **Duplicates.** A line the scope already holds, ignoring case, punctuation and spacing, or sharing nine words in ten with an existing line, is merged: the existing memory gets a new revision pointing at the new chat, so it counts as newest and keeps both chats as its origin. Nothing is added.
- **Eviction.** Past the cap, the oldest unpinned memory is archived, never deleted. A pinned memory is never evicted. Proposed memories do not count.

## What reaches a run

Before its first request, a run freezes the active memories of its worker, its team (when running for one) and the workspace: pinned first, then newest, up to 30 lines and 6 000 characters. A line a note already says is skipped. They go to the model as one message after the approved notes, labelled as guidance, not source evidence, not instructions, and unable to grant permissions or override policy. **Details → Context loaded** lists each one under *Memory* and names the ones left out as duplicates or over the limit.

Under the answer, one small line says **Used N memories** and opens the list, the way sources are named. The list is frozen on the answer (`usedMemories` on the artifact), so it still shows what the worker knew after a memory is edited or deleted. A later edit only reaches the next run.

## Where you see and edit memory

Open a worker from the sidebar menu (**Edit**) and choose the **Memory** tab. Memories are listed newest first, each with its text, the chat it came from (click to open that chat) and its date. From the row's menu you can edit the text in place, pin or unpin it, or delete it. A memory still waiting for review carries a *Waiting for review* badge. With nothing remembered, the tab shows one line.

Team and workspace memories, and every memory in one place, are under **Library → Knowledge → Memory**, with the same rows plus the scope. Proposed memories sit with the other proposals above. Editing a memory through the note editor keeps it a memory.

An edit or a pin creates a new approved revision. Runs already in progress keep the lines they froze.

## Deleting

- **Deleting a chat** deletes the memories learned only in that chat. A memory that was also merged from another chat that still exists stays.
- **Settings → Data → Delete memory** removes every memory, in every scope, including ones waiting for review. **Delete knowledge** removes notes only and leaves memory alone; the two are separate rows on that page. **Delete everything** removes both.
- Backups carry memories, since they carry every knowledge row with its revision history; a restore brings them back. Team templates do not: a template carries a team's approved notes, and what a team remembered is about you, not about the team.

## Out of scope

Cloud sync, sharing memory between machines, and reading files without a grant.

## Where it lives

- Contract: `apps/desktop/src/shared/knowledge.ts` (`kind: 'memory'`, the `turn` provenance, `remember` arguments, `RunMemory`).
- Store: `apps/desktop/src/core/context/knowledge.ts` (`remember`, `updateMemory`, `deleteMemory`, cap and eviction, `memoriesOnlyFrom`).
- Compilation: `apps/desktop/src/core/context/compiler.ts` (`memories`, `memoryMessage`, the `remembered` manifest kind).
- Runner: `apps/desktop/src/core/orchestration/runner.ts` (`remember` tool call, `memories` in the harness answer, `usedMemories` on the artifact).
- UI: `apps/desktop/src/renderer/components/Memories.tsx`, the worker dialog's Memory tab, the Library's Memory section, `UsedMemories` in the thread.
- Tests: `tests/integration/memory.test.ts`.
