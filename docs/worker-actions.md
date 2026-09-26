# How a worker's actions read in the chat

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/orglets/worker-actions-dark.png">
  <img src="images/orglets/worker-actions-light.png" alt="" width="112" height="112" align="right">
</picture>

Decided 2026-09-23 (COD-163). This page says how each kind of thing a worker does appears in the chat while it happens and after the run ends, which components draw it, and what is kept. Change it when a decision changes. Where it says **later**, the design is settled but the code is not there yet.

## The rule: a trace is evidence

The chat names only what the core observed. It never guesses from the answer text, and it never implies more than it saw.

| Connection | What the core sees | What the chat can name |
|---|---|---|
| API worker (OpenAI, Anthropic, xAI, OpenRouter, OpenCode, Ollama), and any worker with a working folder | Every tool call, because the tools are Orglet's own (`core/tools`) | Reads, searches, edits, commands, web pages, dataset checks, skill resources, exactly |
| Claude Code as a streaming harness (no folder, no web or dataset tools) | Its stream: thinking, tool calls with their input, the answer | The file it read, the pattern it searched, that a step ran |
| Codex as a streaming harness | Reasoning and the answer | That it is thinking, then writing |
| Cursor Agent | The answer | Nothing finer than working, then writing |

So "Read 2 files" under an answer is a count of observed reads. When the core saw no steps, the chat shows a timer and the answer, not an invented trace. Orglet cannot see which files Codex or Cursor Agent opened on their own, and the chat must not say it can.

## One vocabulary

An action is worded as what it did, never as which tool it called. The same words are used live (the island's sentence and receipt), in the folded step list, and in the saved line under the answer.

| Action | Live sentence | Receipt / saved step | Icon | Status |
|---|---|---|---|---|
| read | *Scout đang đọc invoice.xlsx…* | *Đã đọc invoice.xlsx* | file | built |
| search | *Scout đang tìm "budget"…* | *Đã tìm "budget"* | magnifier | built |
| list | *Scout đang liệt kê tệp…* | *Đã liệt kê tệp src* | folder | built |
| edit | *Scout đang sửa report.md…* | *Đã sửa report.md*; the counts line **Đã thay đổi 3 tệp · +42 −7** | file-diff | the counts line and the viewer are built; the live sentence is later |
| command | *Scout đang chạy pnpm test…* | *Lệnh: 1 thoát 0* (already in the turn's outcome line) | terminal | outcome line built; live sentence later |
| web | *Scout đang đọc trang web…* | *Đã đọc trang web* | globe | later |
| dataset | *Scout đang kiểm tra dữ liệu…* | *Đã kiểm tra dữ liệu* | table | later |
| skill | *Scout đang đọc skill…* | *Đã đọc tài nguyên skill: references/x.md* | book | saved event built; live sentence later |
| sub-worker | *Đang giao Writer…* (crew) | The member's own reply and its own counts line | face | built |
| other | *Scout đang chạy một bước…* | *Đã xong một bước* | wrench | built |

The live words come from `ActivityKind` in `shared/progress.ts` and the sentences in `renderer/components/LiveRun.tsx`. Today `ActivityKind` has `read`, `search`, `list` and `other`; `edit`, `command` and `web` are **later** (see the end of this page for why).

## While work happens

- **The island** on the prompt bar (`LiveIsland`, docked by `TaskThread`) carries the faces of the workers really running, one sentence for what they do now, and above it one grey line for the last step that finished. It says who, and it says the action in the vocabulary above. No dots, colours or marks to learn. When the sentence does not fit, the name gives way first: it shortens with an ellipsis (the full name is in its tooltip) down to a few letters, and only then is the action cut, so "Quarterly Revenue Op… is reading invoice.xlsx…" still says what is happening (COD-250). A short name takes only its own width, so "Dev is writing a reply…" reads as one sentence (COD-257).
- **The step list, the timer and the worker's notes** sit behind one folded control above the streaming text: the same trace the finished answer keeps (`TurnTrace`, below), with the memories the run froze as its first rows. The control counts what has happened so far ("Dùng 1 ghi nhớ · Đọc 2 tệp · Tìm 1 lần"), or says *Chi tiết* when only notes are there.
- **The answer** appears as it is written, as a normal message.
- **Thinking** shows only inside that folded control, as the worker's notes, and only when the model shares it. It is not on the page by default. It is never saved: `HarnessProgress` lives in memory and is dropped when the run stops.
- **The working line** in the chat, under the orglet's name, repeats the island's sentence without the name ("Writing a reply…", "Reading src/sum.js…") while no answer text has arrived, with a light sweeping across the words so the chat itself shows the work is alive. It goes as soon as the answer starts streaming, holds still under reduced motion, and is not announced again, since the island already is (COD-257).
- **A crew run** reads as one island counting the workers at work ("3 Tí đang làm việc…"), with every face. The lead's planning and combining use the same island with the core's own states. Members' internal jobs stay under **Details**.

## Afterwards

- **The order** ([COD-217](https://linear.app/codepawl/issue/COD-217)): everything attached to one turn reads in the order it happened. Above the answer, one folded trace of what the run did before writing (next section). Under it, what came out of the answer: the changed-files line, the proposal cards (self-improvements included), and last the copy / download / reply / react row. The same order holds while the answer streams, and a group-chat reply keeps its own notices with its own bubble. `turnNotices` in `renderer/components/turnNotices.tsx` is the one place that knows this order; a new notice goes into its slot there.
- **The trace** is the only control above the answer; it is built from what the run froze and the events the core saved, and there is none when there is nothing (below).
- **The changed-files line** sits under the answer when the run changed files in its working copy: **Đã thay đổi 3 tệp · +42 −7** (`ChangedFilesLine`). Moves and deletions have their own counts (COD-254): **Đã thay đổi 6 tệp · 5 chuyển hoặc đổi tên · 1 đã xóa**, and a plain folder copy, which has no line counts, leaves the `+ −` part out. A run that only created or removed folders says **Đã thay đổi 2 thư mục**. The `+42` and `−7` are drawn in the diff's own colours, the theme's success and error, and a heavier weight, so they read apart from the file count. It opens the diff viewer. Nothing is shown when nothing changed. In a crew turn each member's line is named ("Writer đã thay đổi 2 tệp · +10 −1"), because each member works in its own copy.
- **Commands** are summed in the turn's outcome line ("Lệnh: 2 thoát 0, 1 lỗi"), with their output under **Details**.
- **A blocked hand-in** ([COD-270](https://linear.app/codepawl/issue/COD-270)): when a command that ran after the last edit failed, the answer is not saved and nothing reaches the folder, but the turn still shows what the orglet said, in the usual bubble. It has no copy, reply or reaction row, because nothing is saved yet. Under it, first in the notices, one line per blocking command, a warning icon and "`npm test` thoát với mã 1, nên thay đổi chưa được áp dụng · Xem đầu ra". The line opens the last 80 lines of stdout and stderr in the `SourceViewer` shell (`CommandOutputDialog` in `renderer/components/BlockedHandIn.tsx`). The changed-files line follows. The latest turn's actions are **Vẫn áp dụng**, **Nhờ sửa** and **Thử lại**, described in [agent-tools.md](agent-tools.md). The answer and the line stay on the turn after later messages. In a crew, the line names the member in its error card or under the crew's answer. Once applied, the turn reads like any other answer, with a limitation saying the person applied it past the failed command.
- **A report** arrives as a `DocumentCard` that opens in `DocumentViewer`, never poured into the chat.
- **Files are named, never numbered.** The model is told to cite a source by its id only in a report's findings and to name the file in anything the person reads. An id it still copies into a message (a reply once ended "Source: metrics.csv (49843085-…)") reads as the file's name wherever the answer is shown, copied or exported (`withoutSourceIds` in `shared/source-mentions.ts`, COD-257).
- **What is kept**: the saved events, the answer or report, the working copy's counts (`WorkspaceRecoveryView.copies[].diff`), and the copy itself on disk until the chat is deleted, so the diff can be opened later. Thinking and the live progress are not kept.

## The trace above an answer

Decided 2026-09-24 ([COD-220](https://linear.app/codepawl/issue/COD-220), user: "memories used should sit inside another collapsible section that holds all of the worker's actions, for users who like clear transparency about what each worker does"). It replaced the separate *Đã dùng 1 ghi nhớ* line and the folded step line, so a finished turn shows exactly one control before the bubble, and a crew or group chat gives each member's answer its own.

- **Collapsed**, one muted line counts each kind of thing that happened, in a fixed order, each count with its own words for one and for several: *Dùng 1 ghi nhớ · Nạp 2 ghi chú · Đọc 2 tệp · Tìm 1 lần · Lên web 1 lần · Ghi nhớ thêm 1 điều* ("Used 1 memory · Loaded 2 notes · Read 2 files · Searched once · Went online once · Remembered 1 thing"). With nothing to count there is no control at all.
- **Open**, the rows in the order they happened, an icon and plain words each: the memories used (each one's text, with *Mở tab Ghi nhớ* under the rows), the notes loaded (their titles, from the manifest the run froze), a crew's handoffs (one row per member, and a reassignment), then the steps the core saved: files read, patterns searched, folders listed, skill resources read, web searches and pages, dataset checks, files edited, folders created, files moved or deleted and commands ended in a working copy (each named as typed, with how it ended: *Đã chạy lệnh npm test · mã thoát 1*, "Ran npm test · exit code 1", or that it timed out, was stopped or printed too much), MCP tools used (the tool and its server, [mcp.md](mcp.md)), pages opened, read, searched, scrolled or pictured in Orglet's browser (with the site, [browser.md](browser.md)), a memory or an app change stored, and, as quieter rows, what did not go through (a refused reaction or memory, an unreadable page, a missing file, an MCP call refused or failed). The rows use the vocabulary of the table above; a row is worded as what the worker did, never as which tool it called, so a step the core could not name shows as *Dùng công cụ* with no target.
- **The rule holds.** A row is something the core recorded: a memory frozen on the answer, a note in the manifest, a saved event. The runner's status lines (calling the model, saving the answer, costs) are not actions and never appear. A Codex or Cursor Agent run that streamed nothing and saved no reads has no trace, and the chat does not pretend it did. Members' own steps in a crew stay in **Details** with their jobs; the synthesis answer's trace names the handoffs and its own steps.
- **Live**, the same control holds the memories first and the steps streamed so far, an open step pulsing, with the timer and the worker's notes after the rows; once the run ends the saved trace takes its place.
- **Where.** `renderer/turnTrace.ts` turns memories, the run context and events into the ordered rows and the summary line (`traceOf`, `liveTraceOf`, `traceSummary`; the event sentences it reads are listed there). `renderer/components/TurnTrace.tsx` draws them as a native `<details>` (reachable and announced without state of its own, the rows an ordered list). Tests: `tests/integration/turn-trace.test.ts`.

## Where a diff lives

The diff is the first piece built against this page, because nothing showed one before.

- **Entry point.** The changed-files line under the answer. It is the only place; there is no diff in the report and no diff in the island.
- **Viewer.** `DiffViewer` (`renderer/components/DiffViewer.tsx`) opens like `SourceViewer`: close on the left, "Thay đổi của Scout" and "3 tệp · +42 −7" in the middle, the info button on the right. Inside: the list of changed files with their counts (left out when one file changed, since its heading already names it), then each file with its hunks, the snapshot's and the copy's line numbers side by side, removed lines tinted in the error colour and added lines in the success colour, with the same tokenizer as every other code view (`highlight.ts`). It is read-only. Applying, keeping current files and conflicts stay in **Details** (`WorkspaceRecovery`); the one exception is **Vẫn áp dụng** on a turn whose hand-in a failed command blocked, which sits with the turn's actions, not in the viewer.
- **Moves, deletions and folders** (COD-254). A file that went to another folder reads *Đã chuyển*, one renamed in place *Đã đổi tên*, both as `old → new`; a deleted file *Đã xóa*. Folders the run created or removed follow the files as `receipts/` rows (*Thư mục mới*, *Đã xóa thư mục*), since Git keeps no folders and they come from the two inventories.
- **Source.** The `workspaceDiff` command (`shared/contracts.ts`, handled in `core/service.ts` → `WorkspaceRuntime.diff`) compares the run's working copy with the `orglet-snapshot` commit the copy started from (`core/tools/workspace-diff.ts`). Only a copy of a Git repository has that snapshot, so only those runs have hunks. A plain folder copy kept only the snapshot's hashes, so its diff is the hand-in plan described (`plainCopyDiff` in `core/tools/workspace-plan.ts`): each file with what happened to it and no lines or counts, under one note that says why (`WorkspaceDiff.lines: false`). The comparison runs Git with the same isolation as the copy itself: no user config, no hooks, no filters, no line-ending conversion, and Git never walks the copy. The paths come from the same inventory the snapshot used, so a link a worker planted cannot lead outside the copy.
- **Limits.** Binary files are listed without content. One file shows at most 2,000 hunk lines, the whole diff at most 10,000, and Git output stops at 4 MiB; anything past a cap is marked, never silently dropped. What the inventory skips (`.git`, `node_modules`, links) is not in the diff, and a copy holding a file over 1 MiB cannot be inventoried at all, so it cannot be diffed.
- **Counts.** When a run finishes, the core counts the diff once and keeps the counts with the copy. The chat reads those counts; it never diffs every run just to draw a line.

## The floor for a worker that streams nothing

A native API run, a Codex run and a Cursor Agent run must never be a blank pause.

- The island always has a state from the core's own events: planning, handing out, reading a source the core read itself, waiting for a turn, the model returning. The faces move with that state.
- The folded control shows the timer as one plain line when there are no memories, no steps and no notes.
- Afterwards the answer keeps whatever the core saved: reads of attached sources, the changed-files line, the outcome line. When there is nothing, there is nothing, and the chat does not pretend.

## Built now and later

Built in COD-163:

- The `workspaceDiff` command and `WorkspaceRuntime.diff`, with tests on a real Git worktree (modified, added, deleted, renamed and binary files; the caps; hooks and filters not run; a run without a copy refused).
- The counts kept with the copy when a run finishes, exposed on the recovery view.
- `DiffViewer`, `DiffDialog` and `ChangedFilesLine`, and the line's place under the answer (`turnNotices`) in `TaskThread`.

Later:

- `edit`, `command` and `web` in `ActivityKind`, with their live sentences and saved steps. This is a small change in `claudeStream.ts` and `LiveRun.tsx`, held back on purpose: a streaming Claude Code run works in a throwaway copy of the attached sources, so "Đã sửa report.md" would name an edit the person never receives. The words go in once the harness's edits either land in a working copy the person can open or are labelled as discarded.
- Line hunks for a plain folder copy (no Git). It lists its files since COD-254; lines need the snapshot's bytes kept beside the copy, not only their hashes.
- The web, dataset and skill actions in the island for tool-loop workers, from the events the core already saves.
