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
- One live thread per worker and per team: its **main chat**. A new message is a turn in that chat, not a new row in the sidebar.
- A worker's main chat can send a message into a **side thread** ([COD-247](https://linear.app/codepawl/issue/COD-247)): a second chat with the same worker, listed under it in the sidebar, that never replaces the main chat. See [Side threads](#side-threads).
- Archive the thread (⋯ next to **Chi tiết** / Chat details) to start over. Search still finds older or archived chats.
- **Lịch chạy** stays a list of discrete scheduled jobs. Those rows are not merged into the infinite chat.

Under the hood the thread is still a `tasks` row. **Chi tiết** lists internal `runs` (plan, members, synthesis, or the single worker job) for retry, cost and cancel. Dollars sit next to **Chi tiết**. The thread's cap is the crew's or orglet's current **Giới hạn mỗi task** (Limit per task): every follow-up, retry and resume reads it again, so raising it in **Thiết lập hội → Giới hạn & ca** or **Thiết lập Tí** applies to the existing chat. When a member on Claude Code stops at that cap, the crew waits for budget and the chat names the limit and that setting.

**Tool permissions** in Chi tiết belong to the chat and are there before anything is sent (COD-178, COD-186). For an empty chat the three switches and the working folder set what the first message will start with; the core keeps them under the worker or team until `createTask` moves the switches onto the new row and makes the folder that row's grant, checking first that the folder is still the one that was picked (if not, the chat starts without it and the first run says so). A coding crew can therefore plan and build its first turn inside the project folder. Each run freezes its permissions when it starts, not when the message was sent: turning on the web, or granting or widening the folder, while the lead is still routing reaches the member and report runs that have not started and stops nothing; a run already working keeps what it started with. Only no folder, another folder or a lower level stops the turn. See [agent-tools.md](agent-tools.md).

A crew can also be asked to set the app up ("make this crew a template", "add a third researcher", "schedule this every Monday") and answers with **proposal cards** in the turn, one per change, which you apply or dismiss (COD-199). The lead's plan run never proposes; the members and the final synthesis run can, and each card records which run made it. A card from a member or synthesis run that read the other members' reports or messages always waits for your click, even for an orglet whose auto-apply switch is on, because those texts were written by other models. The cards, the capability switch and what can never be proposed are in [agent-tools.md](agent-tools.md#proposing-app-changes).

For a reassigned member, Chi tiết names the worker who actually ran the attempt and its original assignment owner. Lead context and recovery results carry both identities from saved runs and artifacts, plus failed attempt history; the original owner is never treated as the file author merely because the plan named them.

## Click a worker or team → that chat

1. Click a **name** in **Nhân viên** or **Nhóm**. The main pane opens that conversation.
2. If there is no live thread yet, you get an empty chat (composer pinned at the bottom). The first send creates the thread.
3. If a live thread already exists, it opens with the saved messages. Later sends are follow-ups in the same chat.

A **team** row is one row: clicking it opens that team's chat. Its members are listed in the chat **Details** panel, not nested under it in the sidebar; the only rows under a team are its schedules' runs. A worker row lists its open side threads and its schedules' runs under it, newest first (`chatsUnder` in `apps/desktop/src/shared/schedule-runs.ts`, COD-258); its main chat is the row itself, and it has no other nested task list. A schedule's row is the schedule's newest run (`lastTaskId`), named after the schedule; see [routines.md](routines.md#where-a-run-shows-up). A thin line runs down from under the orglet's or crew's face and curves into each row under it, the way Discord draws a channel's threads, so they read as that row's (COD-262).

Ctrl+N focuses the current worker or team chat (it does not create a new session). Search (Ctrl+K) finds chats by their text, including archived ones.

### Select several

Each section's header has an edit (pencil) button beside **+**. It turns that section's select mode on: every row shows a checkbox where its status mark was, clicking a row picks it instead of opening its chat, and the pencil becomes a check (Done). Outside select mode, Ctrl-click (Cmd on macOS) picks or unpicks a row and Shift-click selects exactly the rows from the last Ctrl-picked one to it, replacing what was picked before; a plain click still opens the chat, and drops the selection. A selection belongs to one section: picking an orglet drops any crews picked. Right-clicking an orglet or a crew opens its menu at the pointer.

While anything is picked, a bar between the list and the footer shows the count with **Archive**, **Delete** (which asks first, naming the count) and a clear button. Archive and delete run the same commands as a row's menu, one row at a time, and end in one toast: the count that went through, or the names of the rows that did not; an archive toast carries **Undo**, which restores every row it archived. Esc clears the selection and leaves select mode. Nothing is stored: the selection is forgotten when the app restarts, and a row that leaves the list (archived, deleted, another workspace) leaves the selection.

### Archiving from the sidebar

A row menu's archive, restore and delete answer in a toast, never in the banner of the chat that happens to be open (COD-286). Archiving a chat, an orglet or a crew ends in a toast with **Undo**; Undo of a chat that was on screen brings it back on screen. Restoring a chat ends in a toast with **Open**.

An orglet or crew that something still depends on is refused, and the toast says what to change first (`removalBlocker` in `apps/desktop/src/shared/removal.ts`, which the core's refusal and the renderer both read): every crew an orglet is in ("Remove Scout from the crews Launch crew and Quick crew first", three or more counted and listed), with **Open** for the first of those crews; otherwise the enabled schedule that still runs it, which the window catches before asking the core and names in a note with **View schedules** (COD-283); otherwise the last orglet, or work still running, with no action.

Archived chats wait at the end of the section their row came from, in a collapsed **Archived chats (N)** list under the section's **Archived (N)** orglets or crews (`archivedChatsIn` in `apps/desktop/src/renderer/sidebarChats.ts`): a crew's main chat and schedule runs under Crews; an orglet's main chat, side threads and schedule runs under Orglets; group chats under Group chats, which then shows even with no open group chat. Most recently archived first. Each row has the face of whose chat it was, its name (a schedule run's is the schedule's), a tooltip with the whole name and what it was ("Side thread with Scout"), the same days-left pill as an archived orglet, and **Restore** and **Delete permanently**, which asks with that kind of chat's own question. One list per section rather than one under every orglet keeps the tree short, and it sits where archived orglets and crews already are. The rows do not open the chat; restore it first.

A chat opened from search that sits past a list's **Show N more** opens that list and is marked as the chat on screen, and the sidebar scrolls to it. Side thread and schedule run rows carry their whole name in a tooltip.

### Group chat from a selection

With two or more orglets picked, the bar adds **Group chat** (crews get no such action: a crew already has its own chat, and one orglet is a plain chat). It clears the selection and opens an empty chat addressed to those orglets: their faces greet above the composer, the header shows their stacked avatars with their names (up to three) or "N orglets", and keeps showing them once the chat has messages, and `@` in the composer offers the group. Nothing is created until the first message, which calls `createTask` with `assignees` set to those orglets in sidebar order and the first one picked as the row's `workerId`; from there it is an ordinary group chat, each orglet answering in turn, listed in the sidebar's **Group chats** section (COD-268): newest first, with the orglets' faces, its title or their names, its status mark, and a menu to rename, archive or delete it. The section is hidden while there are none. Later messages go through the chat's own composer (`reviseTask`), so a group chat never becomes the sidebar's live thread of any one orglet.

Permissions and a working folder chosen in Details before the first message work the way they do for a worker or crew: they wait in the core under `newChatKey({ workerIds })`, the sorted ids, so the same orglets picked in another order share one entry, and the first message moves them onto the row. Deleting an orglet drops every waiting group entry it was part of. The group itself is renderer state only: opening any chat, orglet or crew drops it, and a step back through navigation history (recipient `group:<ids>`) reopens the same empty chat as long as every orglet is still listed. The pure parts live in `apps/desktop/src/renderer/groupChat.ts`.

Back and forward work like a browser. The side buttons on a mouse, or Alt+Left and Alt+Right, step through what you opened: a chat, then another chat, then back to the first; Library, a skill, back to Library, forward to the skill again; Settings tab to tab; Notifications open, then back closes it. Closing a panel is a step too, so back reopens it. A chat, skill or knowledge item deleted since is skipped. Alt+arrows do nothing while you type in a text box; the mouse buttons always work. Leaving a schedule you are editing asks about unsaved changes, the same as the panel's own Back.

## One live thread

Policy: one open conversation per worker and per team; archive it to start over; do **not** create a new `tasks` row on every message ([team-chat-context.md](team-chat-context.md)).

There is no separate `threads` table.

| Thread | Identity |
|---|---|
| Worker chat | Newest non-archived, non-deleted `tasks` row with that `workerId`, no `teamId`, no `assignees`, no `routineId`, no `sideOf` |
| Team chat | Newest non-archived, non-deleted `tasks` row with that `teamId`, no `assignees`, no `routineId`, no `sideOf` |
| Side thread | A `tasks` row with `sideOf` set; never returned by the two lookups above |
| Schedule run | A `tasks` row with `routineId` set; never returned by the two lookups above. The sidebar lists the schedule's newest one under its worker or team |

| User does | Core |
|---|---|
| First message in this chat | `createTask` (`teamId` + synthesizer as `workerId` for a team) |
| Later message in the same chat | `reviseTask` on that row (`inputRevision` + 1) |
| Archive the thread | Next click is an empty chat; the next send creates a new live row |

Find-or-create lives in `apps/desktop/src/shared/live-task.ts` (`liveWorkerTask`, `liveTeamTask`, `nextWorkerMessage`, `nextTeamMessage`). Every one of them skips a row with `sideOf`, so everything built on them (the worker row, the empty-chat composer, the worker dialog's Permissions tab, the `orglet` terminal command) keeps meaning the main chat. The renderer uses it when you click a worker or team and when you send from the empty composer. `createTask` itself is unchanged, so routines and explicit extra rows can still insert their own records. Group chats (`assignees`) stay reachable from search; they are not the primary sidebar, and are started from a selection as described above.

## Side threads

A message sent with **Send in a new thread** (the menu beside Send, or Ctrl+Shift+Enter) from a worker's main chat becomes a side thread ([COD-247](https://linear.app/codepawl/issue/COD-247)). Only a worker's own open main chat can start one: `startSideThread` refuses a crew chat, a group chat, a scheduled run's row, an archived chat and a side thread. The option is not shown in those chats.

**Data.** A side thread is its own `tasks` row of the same `workerId`, with `sideOf: { taskId, throughRevision }`: the main chat it came from and that chat's `inputRevision` at that moment. It is an optional JSON field on the row, so no table changes and the schema version stays the same. `isOpenEnvelope` in `live-task.ts` excludes it from the live lookups. The sidebar lists a worker's open side threads under its row, newest first (`sideThreadsOf` in `apps/desktop/src/shared/side-threads.ts`), each with its own `StatusMark`; rename, archive and delete are the ordinary `renameTask`, `archiveTask` and `deleteTask`. The Send to picker (COD-246) keeps side threads in its recent chats, labelled `side thread · <orglet>` in a muted detail that never gives way to the name (`sideThread` on `SendToOption` in `renderer/sendTo.ts`); its orglet rows resolve through `liveWorkerTask`, so they always mean the main chat. Archiving or deleting the main chat leaves its side threads as they are. Backups carry `sideOf` and the main chat's `quotes`, and refuse a side thread whose main chat is in the backup but belongs to another worker, a crew or a group.

**Starting.** The main chat is not touched: no revision, no run, and a run already working there keeps going. The side thread's message may only carry sources already in the main chat's `sourceIds`. Its limit is the worker's current **Limit per task**, applied to the side thread as its own chat; it runs through the same runner, provider slots and budget reservations as any chat, and moves through the same statuses. The Running view (COD-244) lists each running or waiting side thread as its own row, named like its row in the sidebar, and its Open chat opens the side thread; a side thread started while the main chat works waits behind it for the provider's slot like any other chat.

**Context.** The side thread's first turn (`inputRevision` 0, no stage) reads the main chat's turns up to `throughRevision` as a read-only `mainChat` layer (`mainChatTurns` in `core/context/thread.ts`): the last `MAIN_CHAT_TURNS` (6) turns, dropping the oldest while they are over `MAIN_CHAT_CHARS` (12 000 characters). It uses the same turn collection as the chat's own history, so the worker's own answers there read as `you`. The run's manifest records it as a `main_chat` entry with `mainChatTurns`, shown in **Details → Loaded context**. Later turns in the side thread read only that thread's history. A main chat deleted before the first turn runs leaves the layer out.

**Permissions.** `startSideThread` copies, in the transaction that creates the row, the main chat's `toolCapabilities`, `mcpGrants` and working-folder grant (`WorkspaceGrants.copyInsideTransaction`: same folder and level, the side thread's own grant id). Nothing on a side thread can be wider than its main chat:

- `setToolCapabilities` on a side thread refuses a capability the main chat does not have; `grantWorkspace` on a side thread is refused; `setMcpGrant` on a side thread refuses a grant the main chat does not give; an MCP approval card in a side thread offers only **Allow once** and **Refuse**, and core refuses the two "always" answers there. Details shows the side thread's permission controls locked with that reason.
- When the main chat loses something, its side threads lose it in the same command (`SideThreads` in `core/orchestration/side-threads.ts`), archived ones included: `setToolCapabilities` keeps each side thread's set inside the main chat's and cancels a side thread's running work when it lost one; `grantWorkspace` and `revokeWorkspace` narrow each side thread's grant (`WorkspaceGrants.narrowTo`: another folder or none revokes it, fewer permissions on the same folder keeps only the shared ones) as a new revision, so a running side run is refused its next file operation, and its work is cancelled; `setMcpGrant` with `allowed: false` drops every side-thread grant the main chat no longer gives.
- Widening the main chat later does not reach side threads that already started.

**Bringing an answer back.** `bringIntoMainChat` copies a side thread's answer into its main chat as a `ChatQuote` (`quotes` on the main chat's row: the text, who wrote it, the side thread and answer ids, and `afterRevision`, the main chat's latest turn). If that main chat is archived or deleted, it goes to the worker's current main chat; with none, it is refused. It never starts a run and never changes the main chat's revision or status; bringing the same answer twice adds nothing. The thread shows it after that turn as a quote on the person's side, with the side thread's name opening it. The main chat's next turn reads it as part of the history, from the user, naming who wrote it. Deleting the side thread leaves the quote.

**The empty chat.** When an orglet's empty chat is on screen, the view switches to a chat only when a new main chat appears (`liveChatToAdopt` in `live-task.ts`, the MCP "adopt a live chat" rule); a side-thread row never qualifies, so nothing typed or sent there follows it into a side thread.

**Finishing.** When a side thread stops working while another chat is on screen, the renderer shows a toast with **Open** (`chatNotices.ts`), which the notice centre keeps and opens the thread from. The answer stays in the side thread.

## Forwarding

**Forward** on any saved message (the person's turn or an orglet's answer, in any chat) sends it to up to five other chats ([COD-257](https://linear.app/codepawl/issue/COD-257)). The shape follows the messengers people already use: Messenger, Instagram and WhatsApp open a list with search and send one message to several people at once; Slack and Discord add an optional note; WhatsApp and Discord stop at five places; WhatsApp and Discord label the result "Forwarded" and WhatsApp keeps one label however many times it is passed on.

**What arrives.** In each place the forward is a message from the person, so it is a **turn**: the orglet, crew or group there answers it. That holds with or without a note. An orglet only reads a message on a turn, so a forward that started nothing would sit unread, and the Instagram model the owner asked for is "a forward is a message to that orglet". A person who only wants to keep something copies it instead. The picker says so under the note: each chat gets it as your message and the orglet there answers.

**Same path as typing it.** `forwardMessage` (`core/service.ts`, reading the message through `Forwards` in `core/orchestration/forwards.ts`) resolves every place first, then sends each one through the same private `reviseTask` the composer's command uses, or through `createTask` for an orglet or crew with no main chat yet (with the permissions and folder chosen for its empty chat, as a first message takes them). Budgets, provider scopes, the chat's **Limit per task**, the queue and permission checks are the ones a typed message meets. Consent is the one the composer and the `orglet` command give: pressing Send consents for the non-Demo providers of the orglets that will run. One place failing does not stop the others; the result lists each place that did not go with its reason, and the toast names them.

- A place whose chat is working (queued, running, pausing or waiting to start a saved message) is refused: a message arriving there would cancel its turn, which a person typing into it chooses and a forward does not. The picker shows it as **Working** and cannot tick it; a chat whose orglets have no ready connection shows **Not connected**.
- The chat the message is in, an archived chat, and the same chat twice (an orglet and its main chat under Recent are one place) are refused.
- The window names only the chat and the message. The core reads the text, the author and the files from saved history, as it does for a reply target; `reviseTask` and `startSideThread` refuse a `forwarded` field, so no command can write a forward with made-up content.
- Only the person forwards. There is no worker tool for it and the `orglet` terminal command has none either.

**Data.** The turn's input (`currentInput`, then the run snapshot's `input`) carries `forwarded` (`ForwardedMessage` in `shared/forward.ts`): the chat and message it came from, that chat's name at the time (the orglet's or crew's name for a main chat, the schedule's for a scheduled run, otherwise the title), who wrote it (`person` or the orglet's name), the text (at most 10 000 characters, cut with a mark), the files it named, and the note. The turn's `brief` is `forwardBrief` of that record: the note, then `Forwarded from the chat "…", written by …:` and the text fenced in `"""`, then the files it named and whether each came along. Every reader of a brief (the model, the history, search) therefore sees the forward without a change of its own. The chat's name is the exception ([COD-285](https://linear.app/codepawl/issue/COD-285)): a chat whose first message is a forward goes by the first line of what was forwarded (`chatHeadline`), never by the prompt text around it or by the note, both for the title its first answer gives and for the name shown before it has one. With automatic titles off, that line becomes the title when the next message arrives, so the chat keeps it. Crew and group runs copy the record into their snapshot input too. A first message that is a forward keeps the record on `currentInput` at revision 0. Backups carry it and refuse a record whose carried file is not one of that turn's files. `@` tags are read from the note only (`ownWords`), so a name tagged inside a forwarded message never changes who answers in a crew or group chat.

**Files.** Files are granted per chat, so a forward never widens a chat by itself. The picker lists the files the message had (a person's turn: the files added with it) with a tick each, off by default. A ticked file is attached to the target chat as a new source row for the same file on disk (`Sources.copyFor`): the core first checks it is still there, unchanged and readable by the chat it came from, and the copy has its own id, so revoking it in one chat leaves the other alone. It then sits above the forwarded bubble like any attachment, next to the files the target chat already carries, up to 20 per message. An unticked file travels by name only: the bubble says **Not sent along: …** and the brief says the file was not shared with this chat. A side thread cannot take a carried file, because a side thread never holds a file its main chat does not; the picker turns the ticks off when a side thread is picked and the core refuses the place otherwise.

**Side threads and group chats.** A side thread can be forwarded from and to like any chat, within the rule above; it then answers under its own permissions, never its main chat's wider ones. A group chat is a place under Recent: the forward is a group turn and every orglet answers, unless the note tags some. A forward to an orglet always means its main chat (`liveWorkerTask`), never a side thread; picking a side thread is picking it from Recent, where it says "side thread · <orglet>". A scheduled run says "schedule · <schedule>" there, since every run of a schedule starts with the same message.

**Forward of a forward.** Forwarding a turn that is itself a forward sends the original: its first chat, author, text and file names, without the note that came with it the first time.

**In the chat.** The forwarded message sits on the person's side on the quiet surface (`ForwardedTurn` in `TaskThread.tsx`), headed **Forwarded from X**, or **Forwarded from X · written by Y** when the writer is not the chat's name; while the chat it came from exists the heading opens it. The note follows as the person's own bubble. Reactions, reply and forward act on the turn as on any message. Search indexes the turn as it reads there, the note and then the forwarded words as plain text (`turnText` in `core/storage/chat-search.ts`), never the brief written for the model; the picker's head shows the message the same way (`forwardPreview`, through `plainSearchText`).

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

- Plan may assign a **subset** of members. Unassigned members are cancelled with a named skip (`Không được phân việc cho lượt này.`); they are not treated as failures. The members and the lead see only the people working this turn as `participants` (the lead, the assigned members and anyone the lead handed work to). The combining step gets the others as `notAssignedThisTurn`, told that nothing of theirs is missing and to leave them out of the answer; it can still hand one of them unfinished work ([COD-256](https://linear.app/codepawl/issue/COD-256)).
- **The lead answers once** ([COD-185](https://linear.app/codepawl/issue/COD-185)). Combining the members' results into the final answer is the synthesis run, so the plan must not hand that job to the lead as a member too. The plan prompt says so, and the core enforces it: a lead assignment that depends on every other assignment, that no other assignment depends on, and that owns no workspace files is the combining step. `completePlan` drops it from the member assignments, appends its brief (and expected output) to the plan's `synthesisBrief`, and records `Phần gộp kết quả của … chuyển vào bước tổng hợp` on the plan job. The lead's queued member run is then cancelled with the same named skip as an unassigned member, and the synthesis run receives the brief as its notes for the final answer. A lead assignment with its own research, partial dependencies or file ownership still runs as a member. The lead can also fill `synthesisBrief` directly for notes about the final answer.
- Member chatter is **not** the user-facing transcript. **Chi tiết** still lists every job (plan, members, synthesis) for retry, cost and cancel. The thread copy/download on the synthesis reply is `Sao chép` / `Tải xuống`. Hidden job artifacts in Chi tiết still export with `Xuất báo cáo này` (the first Chi tiết `<details>` is `Context đã nạp` on the plan job, not a report).
- Demo assigns every member the user brief, or only members you `@` tagged (no invented extra workers), and does not call a model for routing.

### Fail-closed

| Event | Thread shows | Dispatch |
|---|---|---|
| Plan fails (schema, unknown worker, provider) | Team-lead error on this turn | No member jobs, no invented report. Status `failed`. |
| A member fails | That worker's name; synthesis limitations `Role chưa hoàn tất`; status `partial` | Remaining assigned members keep today's rule. Synthesis must not invent the missing result. |
| A member hands in a blocker | The card under the turn says the assignment is blocked, and **Mở báo cáo của {tên}** opens that member's saved report in the document viewer | The report is kept for diagnosis; dependents stay locked (COD-125). |
| A member runs out of steps | Its report is its result, with `Hết số bước trước khi xong phần việc; đây là phần đã làm được.` among its limitations; the crew answer adds a line naming that member | Not a blocker, even when the member marks it blocked, unless a file change its assignment requires is missing. The lead combines it like any other result. |
| All assigned members fail | Failed turn | No synthesis report |
| Cancel | `cancelled` | In-flight request may still bill; queued jobs are not started |
| Retry | Same thread | Reuses a completed plan; starts **new** runs only for unfinished jobs of **this turn** |

Cancel aborts the whole turn (plan + members + synthesis). Partial success stays `partial`, never silent `completed`. Worker chat is one run with no `stage`.

While a turn runs, the **Running** view in the footer lists each job: the members at work, and the queued ones with what they wait for (the plan, a teammate's result, one of the two member slots, or the members before the combining step). Stopping any of them is this same Cancel ([What is running](chat-guide.md#what-is-running)).

## @mentions

In a **team** or **group** chat, type `@` in the composer to pick a worker or `@all`. Tagged names highlight in the message. The team's own name is not offered, because tagging it means what `@all` means; typed by hand it still works, so older messages keep their meaning.

- **Group chat:** only tagged assignees answer that turn. `@all`, the team name, or no tag keeps everyone. A reply to one orglet's answer with no tag in it counts as tagging that orglet, so only it answers; any tag in the message (`@all` included) decides instead, so replying to Writer and asking `@Reviewer` gets Reviewer alone (`groupTurnWorkers` in `core/service.ts`, COD-257).
- **Team chat:** Demo assigns the tagged members. A live planner is told who you tagged and may still assign others. Untagged messages still assign every member.

Unknown `@` text is left as typed and does not change who runs.

## Errors, budget, retry

Refuse, budget and run errors stay on **this** thread (status copy, **Chi tiết**, retry / resume / cancel on the same task). A failure does not open a new session. Cost still sits next to **Chi tiết**; settled tokens on the latest turn. If the compacted prompt is still over 200 KB, the send is refused (no reservation, no model call) with a repair message. Rolling summary and thread-memory retrieval are frozen on the run manifest (**Chi tiết → Context đã nạp**).

## Code

- Click / send: `apps/desktop/src/renderer/App.tsx` (`openWorker`, `openTeam`, `send`); send in a new thread: `FollowUpComposer` in `apps/desktop/src/renderer/components/Composer.tsx`
- Identity: `apps/desktop/src/shared/live-task.ts`; side threads: `apps/desktop/src/shared/side-threads.ts`, `apps/desktop/src/core/orchestration/side-threads.ts`
- Mentions: `apps/desktop/src/shared/mentions.ts`
- Persist a turn: `createTask` / `reviseTask` in `apps/desktop/src/core/service.ts`
- Orchestrator: `apps/desktop/src/core/orchestration/team.ts` (`run`) and `plan.ts`
- Transcript layers: `apps/desktop/src/core/context/thread.ts`
- Plan tool / Demo routing: `apps/desktop/src/core/orchestration/runner.ts` (`submit_plan`, `completePlan`)
- Forwarding: `forwardMessage` in `apps/desktop/src/core/service.ts`, `apps/desktop/src/core/orchestration/forwards.ts`, `apps/desktop/src/shared/forward.ts`, the picker in `apps/desktop/src/renderer/components/ForwardPicker.tsx` and `apps/desktop/src/renderer/forward.ts`
- Tests: `tests/integration/team.test.ts`, `tests/integration/live-task.test.ts`, `tests/integration/thread-context.test.ts`, `tests/integration/mentions.test.ts`, `tests/integration/side-threads.test.ts`, `tests/integration/forward.test.ts`
## Worker messages

Every saved user turn, completed answer and team message has a stable ID. Reply chooses one of those messages in the current chat; core resolves the ID when the next turn starts and supplies a short, attributed excerpt to the worker. A reply never broadens the worker's sources, workspace access or team assignment. The user can react to any saved message without starting a run. Each person, the user or a worker, has at most one reaction per message: repeating the same request is harmless, adding a different emoji replaces the earlier one, and adding the current one again with `active: false` takes it off (COD-219). The user's reaction on the latest answer is also explained when the next turn starts: the core adds it as a note of its own (`previousAnswerReaction`, with the meaning the reaction's button shows), and the person's message stays exactly as they typed it. A worker may use `react_to_message` only during its assigned run and only for a committed message it can see; this tool does not send a team message or start another worker. Team message bodies and interactions appear in Details.

Workers react too, rarely. The tool description and the harness prompt carry one line: a worker may put one emoji on the person's message when it is natural (agree on a stated preference, delighted on good news) and most turns need none. A Claude Code, Codex, Cursor Agent or Gemini CLI worker has no tool loop, so its one JSON answer carries an optional `reactions` array of at most three `{ messageId, emoji }` items; core records each one through the same check as the tool, and an item it refuses is noted in the run's activity in Details, never shown under the answer and never a failed run. The ids a worker may use are the ones already in its prompt: the latest message's `messageId` and the id of each earlier turn or colleague's answer in the thread context, so it can react to a crew member's or group-chat colleague's answer it was given. A worker never reacts to its own message, a scheduled run never reacts, and Demo does not react. A worker's mark shows on the person's bubble with the worker's name, the same way the person's marks show on an answer. These links and reactions survive restart, archive and backup; restoring a backup does not restore execution rights.

Reactions sit on the message they belong to, the way Messenger and iMessage draw them (COD-219): a small pill on the bubble's lower corner, overlapping its edge by half its height, on the left corner of the person's own bubble and the right corner of an answer or a report card. Each emoji shows once with a count when more than one person left it, and its tooltip names who did ("2 người thả 😂: Bạn, Researcher"). The person's own reaction is drawn pressed. Clicking a badge follows the same rule as the picker: the emoji the person already left comes off, any other one is added or switched to. The react button in the action row always opens the picker with the person's current emoji highlighted; it never removes a reaction by itself. Faces in the picker and badges grow slightly on hover, a new badge pops in, and every one of these motions stops under `prefers-reduced-motion`. The action row keeps a gap the size of the pill's overhang, so a reaction never covers a button and nothing moves when one appears.

Reply quotes open their original message in the chat or Details. Details lists reaction counts and actors. Downloading an answer or report includes its message ID, reply link and reactions; copying keeps just the answer text. A download of one answer does not export the full chat graph, so use backup export to move the entire conversation.

API workers can send a question, response, blocker or handoff to another assigned participant in the same team turn. The event journal keeps the sender, recipient, run, turn and reply link. It also keeps acknowledgements, so resuming does not redeliver a processed handoff. A repeated tool call returns its saved message instead of sending another copy.

An invalid recipient ID returns the current turn's valid recipients to the worker for a same-run correction. No message is stored for the rejected ID, and receiving a message never starts an agent or changes file permissions.

A worker can ask two questions per assignment. A third becomes a blocker addressed to the lead. Sending a message never launches another agent or grants permissions. Workers can read their inbox during their existing run; the lead can inspect pending messages across the turn. The existing six-step and spending limits still apply. A dependent worker sees the handoff when it starts.

Unanswered questions and blockers keep the final task partial. The lead receives them as limitations and must preserve disagreements. The lead can record a resolution or reassign unfinished work to a member from the frozen roster. Reassignment preserves dependencies and resource ownership and narrows permissions to the intersection of both workers. Core dispatches the new attempt before continuing waiting dependents. API and CLI tool-loop fixtures cover messaging, reassignment, pause and cancellation; live CLI sessions remain unverified. See [agent tools](agent-tools.md) for limits and recovery controls.

Message-interaction integration fixtures cover API tool calls, reply context, duplicate reactions, wrong-chat and unfinished targets, and backup restoration. The CLI tool bridge advertises the same tool catalog; this does not prove a live signed-in CLI session or its native tool containment. The renderer and packaged app still need manual interaction checks for keyboard and screen-reader behavior.

Chat progress includes each assignment's brief beside its worker and status. Long briefs use a native disclosure: the short description stays visible, and opening it shows the full text. The disclosure works with the keyboard as well as the pointer.
