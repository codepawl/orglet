# The orglet command

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/orglets/cli-dark.png">
  <img src="images/orglets/cli-light.png" alt="" width="112" height="112" align="right">
</picture>

`orglet` lets you talk to your orglets and crews from a terminal. It uses the same local backend as the desktop. Keys, chats, files and the sandbox stay in the app. The command only sends requests to it.

If Orglet is not running, a terminal command starts its backend in the background without opening a desktop window. Use `/open` in the terminal chat, `orglet open`, or the normal Orglet shortcut to open the desktop. If the desktop is already open, terminal commands use it as it is.

Leaving the terminal chat keeps the backend and any work running. To quit the backend, open the desktop and close its window. Settings, connections and permission approvals still need the desktop; use `/open` when a chat needs your approval.

## What it can do

| Command | What it does |
|---|---|
| `orglet` | In a terminal, opens a chat: pick an orglet or crew, then write to it. See [Chat in the terminal](#chat-in-the-terminal). |
| `orglet chat [--to <name>]` | The same, and with `--to` it opens that chat straight away |
| `orglet status` | Says whether the app is running, its version, and how many orglets and crews it has |
| `orglet list` | Lists orglets with their provider and model, and crews with their lead and members |
| `orglet send "message" --to <name>` | Sends a message into that chat and prints the answer |
| `orglet read --to <name>` | Prints the latest answer in that chat |
| `orglet open [--to <name>]` | Brings the Orglet window forward, and with `--to` opens that chat |
| `orglet run "<schedule>" [--file <path>]` | Starts a schedule now, with the files you attach. See [run](#run). |

It cannot grant a folder, touch API keys or connections, change settings or permissions, create or edit a schedule, back up, archive or delete anything. Those stay in the window, where you can see what you are agreeing to. The app refuses any other request, even one that carries the right token.

File Explorer's **Send to** menu and `orglet://` links are other ways in, on [their own page](integrations.md).

## Install

### Windows

1. Download Setup.exe from the [latest release](https://github.com/codepawl/orglet/releases/latest) and install it.
2. Open a new terminal and run `orglet status`.

Setup writes a small `orglet.cmd` into `%LOCALAPPDATA%\Orglet\bin` and adds that folder to your own user PATH (not the system one), the way VS Code's installer does. Each update and every start of that install rewrite the file, so the command keeps working after an update. A terminal that was already open does not see the new PATH; open a new one.

**Settings → About → Remove from PATH** deletes the file and the PATH entry, and later updates leave it off. **Add to PATH** there puts it back. Uninstalling Orglet removes both the file and the PATH entry, unless the command starts another copy of Orglet by then.

Unpacked the ZIP instead of running Setup? Nothing is added by itself: click **Add to PATH** in **Settings → About**.

### More than one copy of Orglet

There is one `orglet` command per Windows user, and it starts one copy of Orglet: the one you last chose. Running Setup chooses that install; **Add to PATH** or **Use this copy** in **Settings → About** chooses the copy you click it in. Starting or updating any other copy, such as an unpacked ZIP or a test build, leaves the command as it is. A copy started on a different data folder counts as another copy too.

When the command starts another copy, **Settings → About** says so and shows that copy's folder, with **Use this copy** to point the command at the one you have open.

### macOS

The **About** tab shows a line like the one below. Add it to your shell's startup file, such as `~/.zprofile`, then open a new terminal:

```sh
export PATH="$PATH:/Applications/Orglet.app/Contents/Resources/bin"
```

### From source

Run `pnpm dev`, then in another terminal from the repository:

```sh
pnpm orglet status
pnpm orglet send "hello" --to Researcher
```

This uses the script `pnpm dev` builds into `.vite/build/orglet-cli.cjs`. It cannot start the app for you; start `pnpm dev` first.

## Chat in the terminal

Run `orglet` with no command, or `orglet chat`:

1. One mascot sits beside the product name and version. The list below lets you choose an orglet or crew.
2. Move through the list with the Up and Down keys, or type part of a name to narrow it. Case and Vietnamese accents do not matter: `ke` finds "Kế toán". Press Enter to open the highlighted chat, or Tab to fill in its name.
3. The header shows the chat name, connection, selected model, billing category and your terminal's current directory. This directory does not grant folder access. The app still controls which folder the chat can use. The connection's exact plan tier and thinking effort are not reported; the terminal says so instead of guessing.
4. The conversation sits above an input between two horizontal rules. Your turns start with **You**; answers start with the orglet's name. Type a message and press Enter. Ctrl+J adds a line; Shift+Enter also works in terminals that report it separately. Paste stays in the draft, including its newlines, until you press Enter to send it.
5. While the orglet works, the status changes from **message** to **queue** and shows elapsed seconds. You can keep editing a visible draft. Enter adds it to this terminal's queue; each item goes to the app after the previous wait ends. The unsent draft stays in place when an answer arrives.

Long answers show a short preview. Ctrl+O expands the full answer and each crew member's reply, or collapses them to the lead's synthesis. Page Up and Page Down scroll the conversation or an open details panel. Left on an empty draft, or Ctrl+G, opens agent names and connection details. Esc closes the panel. Small terminals use a compact header and keep the input visible.

Interactive chat requires a real connection. If an orglet or any member of its crew still uses Demo, a message is refused before sending. Use `/open` to choose a signed-in CLI or an API/local connection in the app, then `/list` to refresh and choose the chat again. One-shot commands retain their existing Demo support.

Type `/` to see commands with descriptions. Up and Down choose one; Tab or Enter fills it into the draft, and Enter on a filled command runs it. Esc dismisses the menu without clearing the draft. `/to ` offers chat names in the same menu. A pasted message with several lines is sent as a message even when its first line starts with `/`.

While an answer is on its way, `/queue` shows previews of the messages and commands waiting in this terminal. `/undo` takes the last one out of that queue and puts its full text back into the draft, including its newlines. Edit it and press Enter to queue it again, or clear the draft to leave it unsent. It cannot take back a message already sent to the app, and it does not stop the current run. This queue belongs to the terminal session and is not saved between sessions.

`/open`, `/help`, `/clear`, `/queue` and `/undo` run immediately while waiting. This lets you open the desktop for an approval without waiting for the blocked turn to finish. Other messages and commands, including `/to`, keep their order in the queue.

The draft wraps with the terminal's width. For a long draft, only the rows around the cursor are shown; moving the cursor reveals the rest. Ctrl+C asks before leaving; only Y confirms. Enter, N or Esc returns to the draft, and bracketed paste does not confirm. Ctrl+D or `/exit` leaves immediately. Leaving drops this terminal's unsent draft and local queue. Messages already sent keep running in the app.

`orglet chat --to Researcher` skips the list and opens that chat. If the name fits several chats, or none, the list opens with it typed in.

A message you send is the same turn the app's message box makes, with the same consent and cost limit as [send](#send). The answer is also in the app.

Answers are wrapped to the width of the terminal. Headings, **bold**, `code`, lists and quotes are shown as such, links print as their text followed by the address, and code blocks are kept exactly as written, indented. Switching chats keeps their terminal histories separate. `/read` retrieves the latest saved answer; `/clear` clears only the terminal view. Leaving restores the terminal screen that was there before chat opened.

### Keys

| Key | What it does |
|---|---|
| Enter | Sends the message, or queues it while waiting. In a menu, fills the highlighted choice; in the chat list, opens the highlighted chat. |
| Ctrl+J | Adds a line to the draft |
| Ctrl+O | Expands or collapses answer details |
| Ctrl+G, Left with an empty draft | Opens or closes agent details |
| Ctrl+Q | Opens or closes the local queue |
| Ctrl+Z | Takes the last queued item into an empty draft |
| Ctrl+P | Opens the chat picker after any earlier queued work |
| Page Up, Page Down | Scrolls the conversation or details panel |
| Up, Down | Move the highlight in a menu or list. In a multiline draft, move between lines; at its first or last line, go through sent messages and return to the unsent draft. |
| Left, Right, Home, End | Move within the draft; Home and End go to the start and end of the current line |
| Tab | Fills the highlighted command or name after `/to` |
| Esc | Dismisses the command menu, closes details, or returns from the `/to` list to the chat |
| Ctrl+C | Asks before leaving: Y exits; N, Enter or Esc stays with the draft and queue intact. Queue dispatch pauses while the question is open. Sent work keeps running in the app. |
| Ctrl+D | Leaves |

### Commands in the chat

| Command | What it does |
|---|---|
| `/to <name>` | Switches to another orglet or crew. Without a name, it opens the list. |
| `/list` | Refreshes connections and opens the orglet and crew picker |
| `/read` | Shows the latest answer in this chat again, including one you stopped waiting for |
| `/open` | Brings the app forward on this chat |
| `/clear` | Clears the screen |
| `/queue` | Shows previews of messages and commands waiting in this terminal |
| `/undo` | Takes the last queued item back into the draft for editing; already sent work keeps running |
| `/details` | Expands or collapses answer details |
| `/agents` | Opens or closes agent details |
| `/help` | Lists these commands |
| `/exit` | Leaves |

Chat mode needs a terminal you type into. In a script, or with input or output redirected, use `send` and `read` instead: `orglet chat` then stops with exit code 2, and plain `orglet` prints the usual usage error.

## Colours and faces

In a terminal, `list`, `status`, `read` and `send` draw each orglet's face in its colour, and `send` shows the waiting face on standard error while it waits. The face is the Orglet logo drawn with block characters: the speech bubble with its small bottom-left corner, and two eyes. The colour is the one you picked for the orglet in the app. An orglet without one gets the colour the app shows for it. The eyes are white, and dark on a very light orglet, as in the app.

The output is plain text, exactly as before, when any of these is true:

- the output goes to a file or another command
- you pass `--json`
- `NO_COLOR` is set
- `TERM` is `dumb`

Set `FORCE_COLOR=1` to get colour even into a file or a pipe (`FORCE_COLOR=0` turns it off). `FORCE_COLOR` wins over `NO_COLOR`, the same as for Node.js.

Windows Terminal, PowerShell and cmd on Windows 10 and later show the faces in full colour. A terminal that reports only 256 colours gets the nearest ones. On an older copy of Orglet that does not send colours yet, the faces are grey.

## Commands

### send

```sh
orglet send "Summarise these notes" --to Researcher --file notes.txt
```

The message goes into the orglet's or crew's chat exactly as if you had typed it in the message box. If the chat already has a conversation, the message is the next turn in it; if not, it starts one. A crew's chat is led by its lead, as in the app. If the app window is showing that orglet's or crew's empty chat when the command starts one, the window switches to the new chat, so a question the chat asks, such as approving an MCP tool, is in view.

By default the command waits for the turn to finish and prints the answer. A crew prints each member's reply and then the lead's, each under its name. In a terminal, the orglet's face waits beside you on standard error while it works. Ctrl+C stops waiting; the turn keeps running in the app, and `orglet read` shows the answer later.

| Option | Meaning |
|---|---|
| `--to <name>` | The orglet or crew. Required. |
| `--file <path>` | Attach a file. Repeat it for more, up to 20. The same size and type limits as the file picker apply. |
| `--no-wait` | Return right after sending. Read the answer later with `orglet read`. |
| `--timeout <seconds>` | How long to wait. The default is 600. When it runs out, the turn keeps running in the app. |
| `--json` | Print the result as JSON |

Sending gives the same consent the message box gives: the message and attached files go to the providers of the orglets that run. The cost limit is the chat's own, or the orglet's or crew's default for a new chat.

### read

```sh
orglet read --to Researcher
```

Prints the answers of the latest message in that chat that has any. If the orglet is working on a newer message, the command says so. Reading a chat marks its answer as read, like opening it in the app.

### open

```sh
orglet open --to "Review crew"
```

Brings the window forward and opens that chat. On Windows the taskbar button may flash instead, because Windows does not always let another program take the front.

### run

```sh
orglet run "Invoice check" --file invoice.pdf
```

Starts one of the app's schedules now: its brief goes to its orglet or crew, within its cost limit, with the files you attach added to the schedule's own sources. The command returns once the run has started, and the run appears in the app's sidebar under the orglet or crew it runs for, named after the schedule. It does not wait for the answer; the app says when the run is done, with a system notification if Orglet is in the background ([chat guide](chat-guide.md#while-orglet-is-in-the-background)).

Any schedule can be started this way. A schedule set to **Only when called** runs in no other way. The schedule must:

- exist. `run` cannot create one, and names match the way chat names do.
- be switched on. A schedule that is off is refused with a message saying so.
- be approved as it is now. If its orglet, crew, skill, model or trigger changed since it was saved, the app refuses and asks you to save it again, the same as for a scheduled run.
- have finished its previous run. A run still going or waiting for you is refused.

| Option | Meaning |
|---|---|
| `--file <path>` | Attach a file to this run. Repeat it for more; the schedule's own sources and these together stay within 20. The same size and type limits as the file picker apply. |
| `--json` | Print the schedule and the new chat's id as JSON |

Like every command, `run` needs the local backend; it starts that backend in the background when it is not running. Nothing is queued while the backend is stopped, and nothing is replayed later.

### Names

Names match without regard to case. A unique start of a name is enough: `--to res` finds Researcher. If the start fits several names, or nothing fits, the command lists the names you can use. If an orglet and a crew share a name, rename one in the app.

### JSON and exit codes

`--json` prints the result as JSON on standard output, including errors (`{"ok": false, "code": "not_found", "error": "…"}`).

| Exit code | Meaning |
|---|---|
| 0 | It worked |
| 1 | It failed: an unknown name, a turn that failed or ran out of time, a chat with no answer yet |
| 2 | The command was typed wrong. Run `orglet --help` or `orglet <command> --help`. |
| 3 | The app could not be reached, even after trying to start it |

Messages that come from the app are in the app's language.

## How it works

- While Orglet runs, it listens on a named pipe on Windows (`\\.\pipe\orglet-cli-` plus a hash of the data folder) or a socket file `cli.sock` in the data folder on macOS and Linux. Nothing listens on the network.
- Each start writes a new random token to `cli-token` in the data folder, readable only by you where the system supports it. Every request must carry it; the app compares it in constant time. Anyone who cannot read your data folder cannot use the pipe.
- A request is one line of JSON and the answer is one line back. The app checks each request against a fixed list of six operations and refuses everything else, lines over 1 MB, and more than eight commands at once.
- `send` goes through the same steps as the message box: attached files are imported by the app, then the chat's live conversation takes the message or a new one starts. The app then checks the chat until the turn stops.
- `run` names a schedule and carries file paths, nothing else. The app imports the files the way `send` does, then starts the schedule through the same checks a scheduled run passes. The window's **Run now** (`runRoutineNow`) starts a schedule through the same checks too, but it names the schedule and nothing else, so no file reaches a schedule from the window; only `run` attaches files by path.
- Chat in the terminal makes only the requests `list`, `send`, `read` and `open` make; the pipe has no operation of its own for it. Stopping the wait with Ctrl+C closes the connection, which ends the app's wait and leaves the turn running.
- The answers to `list`, `status`, `send` and `read` carry each orglet's colour as `#rrggbb`: the one picked in the app, or the colour of the face the app chose for it by name. The command draws the faces from these fields and falls back to grey when they are missing.
- If nothing answers, the command starts Orglet's backend on the same data folder without creating a desktop window and tries again for up to 30 seconds. `open` creates the window and waits for its page to load before confirming. A normal app launch also opens the window of an existing background instance.
- The command finds the data folder from `ORGLET_USER_DATA`, then `ORGLET_DATA_DIR` (what a source run uses), then the usual place for the app. The Windows shim sets `ORGLET_USER_DATA` for you.
- On start, a copy of Orglet reads the shim's executable and data folder back and rewrites the shim only when both are its own. A Setup install owns every `app-x.y.z\Orglet.exe` in its folder, so the shim follows an update to a new version folder. An update or uninstall leaves a shim that starts another copy alone; only running Setup or a click in **Settings → About** takes it over.
- The command itself is the app's own executable running a small script (`resources/orglet-cli.cjs`) as Node, the same way VS Code ships `code`. It needs no separate Node install.

The automatic checks run every command against a packaged build, including a wrong token and a request outside the list, and check that `list` stays plain text when piped. Chat tests drive raw terminal input against a fake app and inspect the rendered terminal grid: multiline paste, command choices, queue previews and undo, immediate desktop opening while a turn is waiting, draft preservation after a delayed error, resize and leaving. They do not click **Add to PATH**, because that changes the user PATH of the machine running them.
