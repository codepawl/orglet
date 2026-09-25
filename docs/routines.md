# Routine catch-up

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/orglets/routines-dark.png">
  <img src="images/orglets/routines-light.png" alt="" width="112" height="112" align="right">
</picture>

This is the current scheduler policy. It matches `apps/desktop/src/core/orchestration/routines.ts` and, for folder triggers, `folder-triggers.ts` next to it. Do not add cloud cron or run work while the machine is off.

## What starts a routine

The editor's **Starts** field picks one trigger per routine (COD-245):

| Trigger | Runs when | While the app is closed |
|---|---|---|
| **On a schedule** | The clock reaches the daily or weekly time | Missed times become one catch-up you can run or skip (below) |
| **When a file arrives** | A new file lands in the folder you picked | Nothing is recorded and nothing is replayed |
| **Only when called** | `orglet run "<name>"` calls it from a terminal ([cli.md](cli.md#run)) | The command starts the app first; nothing is queued |

Every trigger fires only while Orglet is open. The two event triggers are a clear break from the clock's catch-up: an event that happens while the app is closed is gone, and opening the app never runs it late. Any routine, whatever its trigger, can also be started with `orglet run`.

The row in **Schedules** says the trigger on the line under the name: "Daily at 09:00", "When a file arrives in Invoices" or "Only when called". A routine saved before triggers existed runs on its clock, as it always did.

### The trigger is part of what saving approves

Saving a routine is its permission to run unattended. The core stores a fingerprint of the setup it approved (`approvedConfig`): the orglet or crew, their skills and models (a custom connection's price included, COD-242), and the trigger, with the watched folder's identity (its path, volume and file id). A clock routine keeps exactly the fingerprint it had before triggers existed, so updating Orglet does not take away any routine's approval. A changed price asks every routine on that connection to be saved again, whatever its trigger.

Changing the trigger or picking another folder is a new save, so it is approved again then. A trigger that changed without a save, as in a restored backup or a hand-edited row, does not match and the run is refused until the routine is saved again. A change an orglet proposes keeps the routine's trigger and saves it switched off; an orglet cannot pick a folder to watch.

### When a file arrives

- **Which folder.** The person picks it with the same native picker the chat's working folder uses, at the read-only level. Main passes the path to the core, which resolves it and keeps it in `routine_folders`; the window only ever holds the folder's id and name. The core refuses a routine that names a folder the picker never granted, and refuses to watch a folder that was moved away or replaced at the same path.
- **What counts.** Only plain files at the top of the folder. Subfolders are not watched. Temporary and partial files never count: names starting with `~$` or `.`, and names ending in `.tmp`, `.crdownload`, `.part`, `.partial` or `.download`. A download that is renamed from `.crdownload` to its real name counts once, under the real name.
- **Settling.** A new file counts once it has kept the same size and modified time for 1.5 seconds and opens for reading, so a file still being copied is not picked up half-written.
- **Bursts.** Files that settle close together share one run: the batch starts once the folder has been quiet for 3 seconds, or 30 seconds after the first file, whichever comes first. A run takes at most 20 files, the routine's own sources included, and 64 MB together.
- **Attaching.** Each file goes through the same import as the file picker, with the same type and size limits. Unsupported, unreadable or over-limit files are left out and listed in the run's excluded list with the reason, as the folder import does. If none of them can be read, no run starts and the routine shows why.
- **Only new files.** When watching starts (the routine is saved or switched on, or the app opens), everything already in the folder is the baseline and never runs. Files a run took are also recorded per routine in `routine_arrivals` (name, size and modified time), so they do not run again.
- **One run at a time.** If the routine's previous run is still going or waiting for you, new files wait for it and join one batch; the routine says that files are waiting. They run after the previous run ends, as long as the app stays open.
- **Watching.** Node's `fs.watch` tells the core to look soon; what counts is the folder listing, so a missed or doubled event changes nothing. The core also looks on its five-second tick, which covers a watcher that fails or a network drive that sends no events. A quiet folder costs one directory listing per tick.

When a batch cannot start (the routine changed and needs saving, the folder was replaced), the routine shows the reason as **The schedule did not run** in **Schedules** until you dismiss it. There is nothing to catch up: the files stay where they are, and the ones that were handed to the failed batch do not run again.

### No MCP tools on a routine's run

Every run a routine starts, on the clock, on a new file or from `orglet run`, is a task with the routine's id, and such a task is never offered MCP tools, even when its orglet has MCP servers (COD-241). An MCP call asks the person first, and nobody is there to answer for an unattended run. The orglet works with its other tools and the attached files; to use MCP, send the same request in its chat.

### Only when called

The routine runs only when `orglet run` names it, while the app is open. The editor shows the command to copy. `run` can start a routine but never create or change one, and it passes the same checks as a scheduled run: switched on, approved as it is now, previous run finished.

## Where a run shows up

Every run is its own chat row with `routineId`, apart from the orglet's or crew's main chat, and the routine keeps the newest one as `lastTaskId`. Before COD-258 that chat could only be reached through **Schedules → Open latest run**, so a daily run's answer went unread unless someone went looking. Now a run is found where the person looks and says when it lands, whatever started it:

- **Sidebar.** Each routine has one row under the orglet or crew its newest run was for, next to the orglet's side threads, newest first and three at a time with **Show more** (`chatsUnder` and `scheduleRunsOf` in `apps/desktop/src/shared/schedule-runs.ts`). The row is named after the routine, carries a small schedule mark and the newest run's status mark, and its menu opens the routine, archives the run or deletes it. The row belongs to the run, not to the routine's current setting: a crew run sits under the crew, and a routine moved to another orglet moves when its next run starts. An archived newest run hides the row until the next run, rather than bringing an older run back; deleting it clears `lastTaskId`, which does the same.
- **The chat.** The header shows the routine's name with the schedule mark instead of the orglet's, so it does not read as the main chat, and the top of the thread says "A run of the schedule *name*, by *orglet*" with **Open schedule**. The header cannot rename it: the name changes in the routine's editor, where saving is also the approval to run.
- **Notices.** When a run finishes, stops with a problem (failed, partial, interrupted) or waits for the person (an answer or budget), the window shows a toast naming the routine, such as "Daily standup note is ready" or "Daily standup note needs you", with the orglet or crew as what it was about and **Open**. It is kept unread in **Notifications**, and its row there opens the run (`chatNotices.ts`). A run that started and finished between two workspace reads still counts, since nobody watched it start. Nothing is shown for the run already open.
- **In the background.** With Orglet not focused, the same moment also raises a system notification titled with the routine's name, unless **Settings → Chat** turned it off ([chat guide](chat-guide.md#while-orglet-is-in-the-background)).

The **Open latest run** button on the routine's card in **Schedules** stays.

## What runs, and when

The rest of this page is the clock trigger. Orglet checks schedules only while the app is open. The core process polls every five seconds (`apps/desktop/src/core/entry.ts`). Closing the app, sleeping, or shutting the machine down creates no tasks.

Each enabled routine stores one next due instant in UTC (`nextDueAt`) in the schedule's IANA timezone. There is no `lastRun` / `nextRun` field and no queue of missed dates.

## Missed window

A due routine is a **miss** — and is not started automatically — when any of these is true (`shouldDeferRoutine`, threshold `ROUTINE_MISS_MS` = 30 seconds):

1. **Reopen / first tick:** `lastTick` is null (process just started).
2. **Gap:** more than 30 seconds since the previous tick (sleep, hang, or the app was not polling).
3. **Late:** the due time is already more than 30 seconds in the past.
4. **Already waiting:** `pending` is set.

On-time dispatch happens only on a continuous tick: the previous tick was recent, the due time is at most 30 seconds old, and there is no pending catch-up. Opening the app at or after the scheduled time therefore prompts for catch-up instead of silently starting work.

A daylight-saving gap is skipped by `nextOccurrence`; a repeated local time runs at its first instant. Those are schedule math, not catch-up.

## Catch-up is one pending, one run

Missed occurrences are **coalesced**. `defer()`:

- keeps **at most one** `pending` object per routine (`pending` is a single nullable record, not a list);
- preserves `pending.dueAt` as the first missed due (`routine.pending?.dueAt ?? routine.nextDueAt`);
- advances `nextDueAt` to the next future occurrence from *now*, so the calendar does not disappear and does not replay a backlog.

**N = 1.** **Chạy bù một lần** (`catchUpRoutine`) creates **one** task if the routine is enabled and `pending` is set. It does not drain missed days. A second catch-up is blocked until a later miss, and overlapping catch-up calls share a per-routine `dispatching` lock.

**Bỏ qua lần lỡ** (`dismissRoutine`) clears `pending` only. It does not move `nextDueAt` and does not create a task.

Saving a routine recomputes `nextDueAt` from the current clock and sets `pending: null`.

## After a long time off

Example: a daily 09:00 schedule, machine off for 30 days, app opened again.

1. No tasks were created while the machine was off.
2. The first tick sees `lastTick === null` and an overdue `nextDueAt`, so it defers.
3. The UI shows one missed-run prompt with that first missed `dueAt`, the skip reason, and the already-advanced next due time.
4. The user runs catch-up once, dismisses, or leaves the prompt. The next scheduled time remains on the calendar either way.

Guards that still apply to catch-up: recurring approval fingerprint, a non-terminal prior task, source byte verification, and a revision check. Occurrence advancement and task insert share one database transaction.

## What this is not

- No OS wake timer, background agent, or cloud cron.
- No automatic burst of one task per missed day.
- No catch-up while the computer is off.
- No replay of folder events or `orglet run` calls that happened while the app was closed.
- No watching of subfolders, of folders the person did not pick, or of anything with more than read access.
