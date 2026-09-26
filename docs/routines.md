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

Every trigger fires only while Orglet is open. The two event triggers are a clear break from the clock's catch-up: an event that happens while the app is closed is gone, and opening the app never runs it late. Any routine, whatever its trigger, can also be started with `orglet run`, or with **Run now** (the play button) on its card in **Schedules** (`runRoutineNow`). Run now takes the same path as `orglet run` without files (`Routines.runCalled`): the routine must be switched on, approved as it is now and done with its previous run, it runs with the routine's own sources only, and it leaves the next scheduled time where it was. The run opens like any scheduled run.

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

### Web search on a routine's run

A routine's editor has **Read and search the web**, the same switch a chat has. On, the routine's task carries `network.web` and each run is offered `web_search` and `web_read_url` like a chat is; off, it carries neither. A search never asks anyone, so it needs no one there. The switch is saved with the task and applies from the next run; a routine that never had the web or the browser still saves no capability list at all (`scheduleCapabilities` in `RoutinesPanel.tsx`).

### Reading pages on a routine's run

A routine may read pages in Orglet's browser ([browser.md](browser.md)) when its editor sets **Browser** to **Read pages**. The routine's task then carries `browser.read`, a profile and a site list, and all three are part of `approvedConfig`: a routine whose browser settings differ from the ones it was saved with does not run until it is saved again. A routine without the browser keeps the fingerprint shape it had before, so no existing approval changed. Reading needs no one to answer a card, so it can run unattended. Acting on pages (`browser.act`) never can: saving a routine whose task carries it is refused, a chat started by a routine cannot be given it, and a routine's runs are never offered the acting tools.

### A working folder for the routine's runs

Until COD-294 a routine only decided when a turn starts and granted nothing. Each run is a new chat, so it had no folder, whatever the orglet's own chat was given. A daily "run the tests" schedule could not work: the run stopped with "this chat has no working folder", and the advice to choose one in Details fixed only that one run.

The editor's **Limits & permissions** now has **Working folder**, with the same four levels a chat's folder control has (no folder, read files only, read and edit files, read, edit files and run commands) and the same native picker.

- **Which folder, at which level.** Choosing a level before there is a folder opens the picker at that level; its title says the folder is for the schedule and names the level. Main passes the path to the core, which resolves it and keeps it in `routine_folders` with the level the picker was opened at. The window holds only the folder's id and name (`Routine.workspace`: `folderId`, `folderName`, `permissions`, `review`). A narrower level keeps the folder; a wider one opens the picker again, so the window can never widen a folder by itself, and the core refuses a routine whose level is wider than the one picked (`RoutineFolders.workFolderName`) or that names a folder the picker never granted. **Change** beside the name picks another folder at the same level. Like the trigger, a save that leaves `workspace` out keeps it and `null` removes it, so switching the routine off from its card or an orglet's proposal keeps the folder; an orglet can never pick one.
- **What a run gets.** As any run starts (the clock, a new file, `orglet run`, **Run now**, catch-up), the core checks the folder on disk again: the same canonical path, still a directory, the same volume and file id, and the same birth time where the file system reports one (`RoutineFolders.workFolder`). The birth time is there for Linux, where ext4 and tmpfs can give a folder made again at the same path the inode number the deleted one had; NTFS, APFS and Node's `statx` on Linux report it. A file system that reuses file ids and reports no birth time cannot tell the two apart. A chat's working folder and a watched folder still compare path, volume and file id only, so they share that gap on Linux, which is a later target. The run's chat is then created with that folder as its own grant, at exactly the routine's level, in the same transaction as the chat row (`Routines.startRun` → `createTask`). The orglet's main chat and its grants play no part, and nothing done later in the run's chat changes the routine.
- **Levels an unattended run may have.** All three. Reading and editing happen in the run's private copy, as in a chat. Running commands is allowed as well: a workspace command runs in that copy with no network, not even loopback, and the copy still reaches the folder only through the hash-checked hand-in. None of these steps asks the person anything. What needs someone there stays off for a routine: MCP calls, acting on pages and desktop apps.
- **Review before applying.** On by default, and the switch sits under the folder once the level allows editing. A run's changes wait in its own chat as a chat's do with review on: the answer's files line says **Not in your folder yet · Review**, the notice says the schedule is ready and its changes wait, and the card says the same. Nothing reaches the folder until the person applies. While they wait, the next run does not start (`PREVIOUS_CHANGES_WAIT`): it would work from a folder without them, and two held copies of the same files would conflict at apply. For a clock routine that shows as a missed run with that reason. Turning the switch off gives each run `workspace.apply`, and its changes reach the folder as it finishes. A crew's routine always hands in as each member finishes, as a crew chat does, since the next member works from those files; its switch shows off and cannot be changed.
- **Approval.** The fingerprint adds the folder's identity (path, volume, file id), its level and the review choice, the way the watched folder adds its identity. A routine without a working folder keeps the exact fingerprint it had, so no existing approval changed. A level or review choice changed without a save, as in a hand-edited row, is refused until the routine is saved again. A backup never carries a folder grant: a restored routine comes back switched off, unapproved and without its working folder.
- **A folder that is gone or replaced.** The run does not start and no chat is made. The card shows **The schedule did not run**: "The schedule's working folder *name* is gone or was replaced, so the schedule did not run. Choose the folder again in the schedule and save it." A clock routine moves on to its next time instead of offering a catch-up that would fail the same way. The note goes when a run starts again (a drive plugged back in) or the routine is saved.
- **When a run still has no folder.** An orglet that asks for a folder tool in a routine's run without one, or without the level it needs, is told to change **Schedules → Edit schedule → Working folder** and save the schedule, not the run's own Details.

Why this is safe to do unattended: the person picks the folder, the level and review in the routine itself, with the same picker a chat uses, and saving is the approval, as it is for everything else a routine runs with. The core holds the path, re-checks the folder's identity before every run and refuses anything that differs from what was saved. Each run gets a fresh grant no wider than the saved level, works in a private copy, runs commands without network, and by default changes nothing in the folder until the person has looked; the next run waits for that. The window can neither widen a picked folder nor name one the picker did not grant.

### No MCP tools on a routine's run

Every run a routine starts, on the clock, on a new file or from `orglet run`, is a task with the routine's id, and such a task is never offered MCP tools, even when its orglet has MCP servers (COD-241). An MCP call asks the person first, and nobody is there to answer for an unattended run. The orglet works with its other tools and the attached files; to use MCP, send the same request in its chat.

### Only when called

The routine runs only when `orglet run` names it, while the app is open. The editor shows the command to copy. `run` can start a routine but never create or change one, and it passes the same checks as a scheduled run: switched on, approved as it is now, previous run finished.

## Where a run shows up

Every run is its own chat row with `routineId`, apart from the orglet's or crew's main chat, and the routine keeps the newest one as `lastTaskId`. Before COD-258 that chat could only be reached through **Schedules → Open latest run**, so a daily run's answer went unread unless someone went looking. Now a run is found where the person looks and says when it lands, whatever started it:

- **Sidebar.** Each routine has one row under the orglet or crew its newest run was for, next to the orglet's side threads, newest first and three at a time with **Show more** (`chatsUnder` and `scheduleRunsOf` in `apps/desktop/src/shared/schedule-runs.ts`). The row is named after the routine, carries a small schedule mark and the newest run's status mark, and its menu opens the routine, archives the run or deletes it. The row belongs to the run, not to the routine's current setting: a crew run sits under the crew, and a routine moved to another orglet moves when its next run starts. An archived newest run hides the row until the next run, rather than bringing an older run back; deleting it clears `lastTaskId`, which does the same.
- **The chat.** The header shows the routine's name with the schedule mark instead of the orglet's, so it does not read as the main chat, and the top of the thread says "A run of the schedule *name*, by *orglet*" with **Open schedule**. The header cannot rename it: the name changes in the routine's editor, where saving is also the approval to run.
- **Notices.** When a run finishes, stops with a problem (failed, partial, interrupted) or waits for the person (an answer or budget), the window shows a toast naming the routine, such as "Daily standup note is ready" or "Daily standup note needs you", with the orglet or crew as what it was about and **Open**. A run whose changes wait for review says "Daily repo check is ready; its changes wait for your review" (COD-294). It is kept unread in **Notifications**, and its row there opens the run (`chatNotices.ts`). A run that started and finished between two workspace reads still counts, since nobody watched it start. A finished run already open says nothing; a run that failed or waits for the person is announced even when it is the chat on screen (`announcedInWindow`), because **Run now** opens the run it starts, and before COD-294 a run that then failed left nothing in **Problems**.
- **When a run could not start.** A routine that could not start a run (its working folder gone, the last run's changes still waiting, a setup changed since it was saved) raises "*name* did not run" as a problem with the reason and **View schedules** (`blockedSchedules`). A miss while Orglet was closed does not: the card and the catch-up banner already offer to run it once. The **Schedules** button counts these routines with the missed ones.
- **In the background.** With Orglet not focused, the same moment also raises a system notification titled with the routine's name, unless **Settings → Chat** turned it off ([chat guide](chat-guide.md#while-orglet-is-in-the-background)).

The routine's card in **Schedules** says what became of its newest run on the button that opens it: **Open latest run · Done**, **Needs attention**, **Needs you**, **Running** or **Changes wait for your review**, the words in the colour of the status mark before them (`lastRunOutcome`, COD-294). Before, the card only said **Open latest run**, so a run that failed overnight looked the same as one that went well.

## Deleting a routine

The card's **⋮** menu has **Delete schedule** (`deleteRoutine`), which asks inside the same menu before it deletes (COD-283). Until then only **Erase everything** removed a routine, so dead ones piled up: the 100-routine cap and the rule below kept pointing at routines nobody could remove.

- **What goes.** The routine row, and for a folder trigger the files it already handled (`routine_arrivals`); the watcher stops at once. The folder's grant row in `routine_folders` stays, like any grant the picker made.
- **What stays.** Every run is a chat and stays. Each keeps `routineId`, so it is still a routine's run with a routine's limits (no MCP, no memory writes, no proposals, no acting on pages), and takes the routine's name as `routineName`. The chat's header keeps that name, the line at the top reads "A run of the deleted schedule *name*, by *orglet*" with no **Open schedule**, and notices keep the name. The sidebar row goes with the routine, since it stood for the routine; the runs are still in Search and Notifications. A backup accepts a run whose routine is gone only when it carries that name.
- **When it is refused.** While the routine is starting a run (the same `dispatching` lock catch-up uses). A run already going keeps going; it no longer needs the routine.

An orglet or crew with an enabled routine still cannot be archived or deleted ("Turn off or delete the schedule *name* first"). The window checks first and says which schedule, with **View schedules**, instead of leaving the refusal as a dead end.

## What runs, and when

The rest of this page is the clock trigger. Orglet checks schedules only while the app is open. The core process polls every five seconds (`apps/desktop/src/core/entry.ts`). Closing the app, sleeping, or shutting the machine down creates no tasks.

Each enabled routine stores one next due instant in UTC (`nextDueAt`) in the schedule's IANA timezone. The editor picks the zone from a list (`timeZoneChoices` in `renderer/timeZones.ts`): this computer's zone first, then every zone the runtime lists by region with its current offset, then UTC, which the runtime's list leaves out. A saved zone the list lacks, such as `Asia/Ho_Chi_Minh` where the runtime says `Asia/Saigon`, is kept as saved, so opening and saving an old routine never moves it. The card writes the daily time and the next run on the interface language's clock (`01:36` in Vietnamese, `1:36 AM` in US English). There is no `lastRun` / `nextRun` field and no queue of missed dates.

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
3. The card shows one calm note, not an error: "Missed the run at *first missed `dueAt`*", why in plain words (Orglet was closed or the computer was asleep; any other reason is the start that failed), and that catching up runs it once however many times it missed while the next run stays at the already-advanced time.
4. The user runs catch-up once, dismisses, or leaves the prompt. The next scheduled time remains on the calendar either way.

Guards that still apply to catch-up: recurring approval fingerprint, a non-terminal prior task, source byte verification, and a revision check. Occurrence advancement and task insert share one database transaction.

## What this is not

- No OS wake timer, background agent, or cloud cron.
- No automatic burst of one task per missed day.
- No catch-up while the computer is off.
- No replay of folder events or `orglet run` calls that happened while the app was closed.
- No watching of subfolders, of folders the person did not pick, or of anything with more than read access.
- No working folder for a routine's run other than the one picked in the routine's own form, and never at a wider level.
