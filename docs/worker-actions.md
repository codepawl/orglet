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

- **The island** on the prompt bar (`LiveIsland`, docked by `TaskThread`) carries the faces of the workers really running, one sentence for what they do now, and above it one grey line for the last step that finished. It says who, and it says the action in the vocabulary above. No dots, colours or marks to learn.
- **The step list, the timer and the worker's notes** sit behind one folded control above the streaming text (`ActivityGroup` in `LiveRun`). The control is the step count ("Đọc 2 tệp · Tìm 1 lần"), or *Chi tiết* when only notes are there.
- **The answer** appears as it is written, as a normal message.
- **Thinking** shows only inside that folded control, as the worker's notes, and only when the model shares it. It is not on the page by default. It is never saved: `HarnessProgress` lives in memory and is dropped when the run stops.
- **A crew run** reads as one island counting the workers at work ("3 Tí đang làm việc…"), with every face. The lead's planning and combining use the same island with the core's own states. Members' internal jobs stay under **Details**.

## Afterwards

- **The order** ([COD-217](https://linear.app/codepawl/issue/COD-217)): everything attached to one turn reads in the order it happened. Above the answer, what the run loaded before writing: the memories it used (*Đã dùng 1 ghi nhớ*), then the folded step line. Under it, what came out of the answer: the changed-files line, the proposal cards (self-improvements included), and last the copy / download / reply / react row. The same order holds while the answer streams, and a group-chat reply keeps its own notices with its own bubble. `turnNotices` in `renderer/components/turnNotices.tsx` is the one place that knows this order; a new notice goes into its slot there.
- **The step line** stays above the answer, built from the events the core saved (*Đã đọc …*, *Đã tìm …*, *Đã liệt kê tệp …*). It is folded; opening it lists the steps with their targets.
- **The changed-files line** sits under the answer when the run changed files in its working copy: **Đã thay đổi 3 tệp · +42 −7** (`ChangedFilesLine`). It opens the diff viewer. Nothing is shown when nothing changed. In a crew turn each member's line is named ("Writer đã thay đổi 2 tệp · +10 −1"), because each member works in its own copy.
- **Commands** are summed in the turn's outcome line ("Lệnh: 2 thoát 0, 1 lỗi"), with their output under **Details**.
- **A report** arrives as a `DocumentCard` that opens in `DocumentViewer`, never poured into the chat.
- **What is kept**: the saved events, the answer or report, the working copy's counts (`WorkspaceRecoveryView.copies[].diff`), and the copy itself on disk until the chat is deleted, so the diff can be opened later. Thinking and the live progress are not kept.

## Where a diff lives

The diff is the first piece built against this page, because nothing showed one before.

- **Entry point.** The changed-files line under the answer. It is the only place; there is no diff in the report and no diff in the island.
- **Viewer.** `DiffViewer` (`renderer/components/DiffViewer.tsx`) opens like `SourceViewer`: close on the left, "Thay đổi của Scout" and "3 tệp · +42 −7" in the middle, the info button on the right. Inside: the list of changed files with their counts, then each file with its hunks, the snapshot's and the copy's line numbers side by side, removed lines tinted in the error colour and added lines in the success colour, with the same tokenizer as every other code view (`highlight.ts`). It is read-only. Applying, keeping current files and conflicts stay in **Details** (`WorkspaceRecovery`).
- **Source.** The `workspaceDiff` command (`shared/contracts.ts`, handled in `core/service.ts` → `WorkspaceRuntime.diff`) compares the run's working copy with the `orglet-snapshot` commit the copy started from (`core/tools/workspace-diff.ts`). Only a copy of a Git repository has that snapshot, so only those runs can be diffed; a plain folder copy answers with a clear message. The comparison runs Git with the same isolation as the copy itself: no user config, no hooks, no filters, no line-ending conversion, and Git never walks the copy. The paths come from the same inventory the snapshot used, so a link a worker planted cannot lead outside the copy.
- **Limits.** Binary files are listed without content. One file shows at most 2,000 hunk lines, the whole diff at most 10,000, and Git output stops at 4 MiB; anything past a cap is marked, never silently dropped. What the inventory skips (`.git`, `node_modules`, links) is not in the diff, and a copy holding a file over 1 MiB cannot be inventoried at all, so it cannot be diffed.
- **Counts.** When a run finishes, the core counts the diff once and keeps the counts with the copy. The chat reads those counts; it never diffs every run just to draw a line.

## The floor for a worker that streams nothing

A native API run, a Codex run and a Cursor Agent run must never be a blank pause.

- The island always has a state from the core's own events: planning, handing out, reading a source the core read itself, waiting for a turn, the model returning. The faces move with that state.
- The folded control shows the timer as one plain line when there are no steps and no notes.
- Afterwards the answer keeps whatever the core saved: reads of attached sources, the changed-files line, the outcome line. When there is nothing, there is nothing, and the chat does not pretend.

## Built now and later

Built in COD-163:

- The `workspaceDiff` command and `WorkspaceRuntime.diff`, with tests on a real Git worktree (modified, added, deleted, renamed and binary files; the caps; hooks and filters not run; a run without a copy refused).
- The counts kept with the copy when a run finishes, exposed on the recovery view.
- `DiffViewer`, `DiffDialog` and `ChangedFilesLine`, and the line's place under the answer (`turnNotices`) in `TaskThread`.

Later:

- `edit`, `command` and `web` in `ActivityKind`, with their live sentences and saved steps. This is a small change in `claudeStream.ts` and `LiveRun.tsx`, held back on purpose: a streaming Claude Code run works in a throwaway copy of the attached sources, so "Đã sửa report.md" would name an edit the person never receives. The words go in once the harness's edits either land in a working copy the person can open or are labelled as discarded.
- A diff for a plain folder copy (no Git). It needs the snapshot's bytes kept beside the copy, not only their hashes.
- The web, dataset and skill actions in the island for tool-loop workers, from the events the core already saves.
