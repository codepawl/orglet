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

**In the tool loop** (API providers, Ollama, OpenCode, and a harness with a working folder, web or data checks) the worker has a `remember` tool: one short line and a scope. `worker` (the default) keeps the line for that worker alone; `team` shares it with the worker's team and is refused outside a team chat; `workspace` gives it to every worker. The tool tells the model to pick the scope by who the line is about: anything about the person themselves (how they write numbers, dates and money, their language, schedule, names, tools, preferences that hold for any work) goes to `workspace`, so every orglet follows it; how the worker should do its own role stays `worker`; what a team agreed about its shared work is `team` (COD-259). The chat line says where a new line was kept: **Remembered something for every orglet**, **for the whole crew**, or **for Dev only**. The tool needs no switch. A memory is visible and editable and never grants anything, and a chat is where you are teaching the worker. It is not offered on a scheduled run: nobody is watching, so a routine must not build up a memory on its own.

**In a one-shot harness answer** (Claude Code, Codex, Cursor Agent or Gemini CLI without a working folder, web or data checks) there is no tool loop. The JSON answer carries an optional `memories` array of the same items, at most five per answer, the same way it carries `appProposals` ([agent-tools.md](agent-tools.md#proposing-app-changes)). Each item is stored through the same path as a tool call. An item the worker got wrong (a team scope outside a team, a malformed item) becomes a limitation of the answer and the rest are still stored.

A memory is written the moment the tool runs, not when the run ends. A colleague remembers even when the reply that followed failed.

**Untrusted input.** A run that has already read a web page, an attached file, a workspace file or another worker's message cannot make an active memory: the line is stored as `proposed` and waits in Library → Knowledge → Waiting for review, next to proposed notes. Approving it makes it active; rejecting archives it. A one-shot harness answer with any source attached is treated the same way. This mirrors how app proposals hold on untrusted input (COD-199): the whole run is treated as tainted from the first unvetted read. A line remembered before the first read comes from your own words and is active.

## Kept small

- **Cap.** Each scope (one worker, one team, the workspace) keeps at most 60 active memories.
- **Duplicates.** A line the scope already holds, ignoring case, punctuation and spacing, or sharing nine words in ten with an existing line, is merged: the existing memory gets a new revision pointing at the new chat, so it counts as newest and keeps both chats as its origin. Nothing is added.
- **Eviction.** Past the cap, the oldest unpinned memory is archived, never deleted. A pinned memory is never evicted. Proposed memories do not count.

## What reaches a run

Before its first request, a run freezes the active memories of its worker, its team (when running for one) and the workspace: pinned first, then newest, up to 30 lines and 6 000 characters. A line a note already says is skipped. They go to the model as one message after the approved notes, and both follow the chat's earlier turns, so every turn of a chat starts with the same messages and the provider's prompt cache can serve them (COD-358). They are labelled as guidance, not source evidence, not instructions, and unable to grant permissions or override policy. **Details → Context loaded** lists each one under *Memory* and names the ones left out as duplicates or over the limit.

Above the answer, since the memories are loaded before the worker writes ([COD-217](https://linear.app/codepawl/issue/COD-217)), they are the first rows of the turn's trace ([COD-220](https://linear.app/codepawl/issue/COD-220), [worker-actions.md](worker-actions.md#the-trace-above-an-answer)): one folded line counts them with everything else the run did ("Used 1 memory · Read 2 files"), and opening it lists each memory's text in the order it was given, before the notes loaded and the steps taken, with a link to the worker's **Memory** tab under the rows. They show there as soon as the run has frozen its context, while the answer is still streaming. The list is frozen on the answer (`usedMemories` on the artifact), so it still shows what the worker knew after a memory is edited or deleted. A later edit only reaches the next run.

## Which notes load, and why

Notes are not memories, but they are frozen at the same moment. A pinned note loads whenever there is room. An unpinned note loads when the message shares a keyword with it: a word of three letters or more from its title, text or tags.

- **Stop words do not count** (COD-307). Words such as "the", "and", "for", "what", "của", "được" or "không" appear in almost every message and note, so a note that shares only those with the message stays out. The lists are in `core/context/stop-words.ts`.
- **Tags always count.** A tag is your own label for the note, so a message naming it loads the note even when the tag is a common word.
- **Rarer words weigh more.** Matching notes are ranked by their shared keywords, each weighted by how few of the run's notes contain it. A message about "leakage in the report" puts the one note about leakage ahead of the twelve that mention reports, so it gets room under the limit of 12 notes and 16 KB before they do.

Keywords still miss a note worded differently from the message: "bill Acme for May" never loads **Invoice format**, and "ổ cứng hư thì tính thế nào?" never loads **Sao lưu dữ liệu**.

When [Tacet](decisions.md) is on this computer, it gets one look at the notes that would not load (COD-306):

1. Only unpinned notes that share no keyword with the message are asked about, up to 30, in scope for the run like any other note.
2. Tacet reads the message and answers one question, **What is this message about?**, the way it routes a ticket to a team: each note is an option named by its title and described by its tags, beside **other**. The same options go in twice, in opposite orders, in one request, and each note's two probabilities are averaged, since on the measured cases where a note sat in the list moved its probability a lot.
3. A note loads when its averaged probability is at least 4.2 times an even share (0.20 with twenty notes, 0.60 with six, never more than 0.75) and beats **other**.
4. Tacet can only add. Pinned and matching notes load first, and Tacet's picks fill the room left under the same limit of 12 notes and 16 KB, so one never pushes a matching note out.
5. The run waits at most 1.5 seconds. When Tacet is not downloaded, fails or is late, the run loads what the words matched, as before Tacet. A model that has been quiet for two minutes takes a few seconds to load, so the first message after a pause usually goes without it and the next one gets it.

**Details → Context loaded** says why each note loaded: *always loaded*, *matched keywords*, or *picked by Tacet* with the probability it gave. In the chat, a note Tacet picked carries *picked by Tacet* in the answer's trace. Both are frozen with the run (`because` and `fit` on the manifest's knowledge rows). Under *Not loaded* the same view names every note left out and why: *does not match the request*, *duplicates loaded content* or *exceeds the context limit*. Each step of a run compiles its frozen notes again, and that record of omissions stays on the manifest through every step and a resume.

The threshold is deliberately strict. On 48 pairs of a short message and a note that share no word (`scripts/tacet/knowledge_cases.json`, English and Vietnamese, half of them the right note), measured with `scripts/tacet/eval_uses.ts`, Tacet loaded 6 of the 24 right notes and none of the 24 wrong ones in a workspace of twenty notes, the same on the tune half and the held-out half; in workspaces of six notes it loaded 4 right notes and 1 wrong one ("which hex codes go on our banner?" took **Social media**). It found more of the English messages (4 of 11) than the Vietnamese ones (2 of 13). Asking about each note on its own (yes/no, a score, or a two-way choice) did no better than chance, which is why the notes are options of one question. On a busy six-core desktop the question over twenty notes took 0.4 seconds at the median and 0.7 at the 95th percentile once the model was loaded.

## Where you see and edit memory

Open a worker from the sidebar menu (**Edit**) and choose the **Memory** tab. Memories are listed newest first, each with its text, the chat it came from (click to open that chat) and its date. From the row's menu you can edit the text in place, pin or unpin it, or delete it. A memory still waiting for review carries a *Waiting for review* badge. With nothing remembered, the tab shows one line.

Team and workspace memories, and every memory in one place, are under **Library → Knowledge → Memory**, with the same rows plus the scope. Proposed memories sit with the other proposals above. Editing a memory through the note editor keeps it a memory.

An edit or a pin creates a new approved revision. Runs already in progress keep the lines they froze.

## Deleting

- **Deleting a chat** deletes the memories learned only in that chat. A memory that was also merged from another chat that still exists stays.
- **Deleting an orglet or a crew** deletes the memories and the unreviewed notes scoped to it, and archives its approved notes. Workspace memories and notes stay, because they are about the person, not about that owner. Archiving the owner keeps both.
- **Settings → Data → Delete memory** removes every memory, in every scope, including ones waiting for review. **Delete knowledge** removes notes only and leaves memory alone; the two are separate rows on that page. **Delete everything** removes both.
- Backups carry memories, since they carry every knowledge row with its revision history; a restore brings them back. Team templates do not: a template carries a team's approved notes, and what a team remembered is about you, not about the team.

## Out of scope

Cloud sync, sharing memory between machines, and reading files without a grant.

## Where it lives

- Contract: `apps/desktop/src/shared/knowledge.ts` (`kind: 'memory'`, the `turn` provenance, `remember` arguments, `RunMemory`).
- Store: `apps/desktop/src/core/context/knowledge.ts` (`remember`, `updateMemory`, `deleteMemory`, cap and eviction, `memoriesOnlyFrom`).
- Compilation: `apps/desktop/src/core/context/compiler.ts` (`memories`, `memoryMessage`, the `remembered` manifest kind).
- Runner: `apps/desktop/src/core/orchestration/runner.ts` (`remember` tool call, `memories` in the harness answer, `usedMemories` on the artifact).
- UI: `apps/desktop/src/renderer/components/Memories.tsx`, the worker dialog's Memory tab, the Library's Memory section, the memory rows of `TurnTrace` in the thread (`renderer/turnTrace.ts` builds them).
- Tests: `tests/integration/memory.test.ts`.
