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
| `orglet config [--json]` | Shows editable configurations and the IDs needed for JSON input |
| `orglet create <orglet\|crew> --config <file.json>` | Creates an orglet or crew |
| `orglet edit <orglet\|crew> "<name>" --config <patch.json>` | Changes the supplied configuration fields |
| `orglet delete <orglet\|crew> "<name>" --confirm "<full name>"` | Removes a confirmed entity while retaining past chats |
| `orglet send "message" --to <name> [--reply-to <number>]` | Sends a message into that chat and prints the answer, optionally as a reply |
| `orglet read --to <name> [--turns <n>]` | Prints the latest answer in that chat, or its last turns, numbered |
| `orglet react <reaction> --to <name>` | Reacts to the latest answer or a numbered message. See [react](#react). |
| `orglet forward --to <name> --target <name>` | Forwards a message to up to five other chats. See [forward](#forward). |
| `orglet answer "<answer>" --to <name>` | Answers the question an orglet is waiting on. See [answer](#answer). |
| `orglet stop\|pause\|resume\|retry\|continue --to <name>` | The buttons under a chat's latest turn. See [Stop, pause, resume, retry, continue](#stop-pause-resume-retry-continue). |
| `orglet chats [--archived]` | Lists chats, side threads and group chats with the short id `--chat` takes. See [Chats by id](#chats-by-id). |
| `orglet side "message" --to <orglet>` | Sends a message in a new side thread of that orglet |
| `orglet bring --chat <id>` | Brings a side thread's answer into its main chat |
| `orglet group "message" --with <name> --with <name>` | Starts a group chat of those orglets |
| `orglet members --chat <id> --with <name> …` | Changes who a group chat's messages go to |
| `orglet rename\|archive --to <name> \| --chat <id>` | Renames or archives a chat; `restore --chat <id>` brings it back |
| `orglet delete --chat <id> --confirm "<chat name>"` | Deletes a chat after its exact name |
| `orglet archive\|restore <orglet\|crew> "<name>"` | Archives or restores an orglet or crew |
| `orglet template <id> --provider <demo\|openai>` | Creates a crew from one of the app's templates |
| `orglet open [--to <name>]` | Brings the Orglet window forward, and with `--to` opens that chat |
| `orglet run "<schedule>" [--file <path>]` | Starts a schedule now, with the files you attach. See [run](#run). |
| `orglet schedules` | Lists schedules with their timing and limits |
| `orglet schedule add\|edit\|on\|off\|delete "<name>"` | Creates, changes, switches or deletes a schedule. See [Schedules](#schedules). |

It can create, edit and remove orglets and crews, and act on a chat's messages and its latest turn. Some things stay in the desktop on purpose; see [What stays in the desktop](#what-stays-in-the-desktop). The app refuses any other request, even one that carries the right token.

### What stays in the desktop

These are trust decisions, so the terminal has no operation for them:

- browser, desktop and MCP approvals, the cards that ask before an orglet takes a consequential step
- folder grants and the folder's level
- a chat's permissions (tools, commands, web)
- API keys and connections, and signing a harness CLI in
- approving or archiving knowledge proposals, and applying app-change proposals
- backups, restore and erase
- the CodePawl account

The reason is where the pipe's token lives. It is a file in the data folder. An orglet that runs through a harness CLI such as Claude Code or Codex runs as you, the same user, and can read that folder. Anything the pipe could approve, an orglet could approve for itself. When a turn stops on one of these cards, `send`, `answer` and the chat stop waiting and say so; `/open` or `orglet open --to <name>` shows the card in the app.

File Explorer's **Send to** menu and `orglet://` links are other ways in, on [their own page](integrations.md).

## Install

### Windows

1. Download Setup.exe from the [latest release](https://github.com/codepawl/orglet/releases/latest) and install it.
2. Open a new terminal and run `orglet status`.

Or, with Node.js 20 or later, `npx @codepawlhq/orglet` does step 1 for you: it downloads that Setup, checks its SHA-256 against the release and its signature, and runs it. Installed with `npm i -g @codepawlhq/orglet`, the package's own `orglet` starts the same thing the app's command starts (it reads `orglet.cmd` and runs that Orglet.exe directly), so it never behaves differently from the command Setup adds, whichever comes first on PATH. The package lives in [`installer/npm`](../installer/npm/README.md).

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

1. One mascot sits beside the product name and version. Orglet rows have small mascots; crew rows have a ▦ group icon in the lead's colour. Both remain visible when colour is off.
2. The input shows **Search orglets or crews…** until you type. Orglets and Crews have separate bracketed headings with counts. While filtering, the count shows matches out of the total, such as **Orglets · 1/5**. Move through them with the Up and Down keys, or type part of a name to narrow the list. Matches stay grouped, with the closest name matches first in each section. Case and Vietnamese accents do not matter: `ke` finds "Kế toán". Press Enter to open the highlighted chat, or Tab to fill in its name. In a short terminal, the list scrolls to keep the selected chat and its section heading visible.
3. The header shows the chat name, connection, selected model, billing category and your terminal's current directory. This directory does not grant folder access. The app still controls which folder the chat can use. The connection's exact plan tier and thinking effort are not reported; the terminal says so instead of guessing.
4. The conversation sits above an input between two horizontal rules. Your turns start with **You**; answers start with the orglet's name. Type a message and press Enter. Ctrl+J adds a line; Shift+Enter also works in terminals that report it separately. Paste stays in the draft, including its newlines, until you press Enter to send it.
5. While the orglet works, the status changes from **message** to **queue** and shows elapsed seconds. You can keep editing a visible draft. Enter adds it to this terminal's queue; each item goes to the app after the previous wait ends. The unsent draft stays in place when an answer arrives.

Model requests and observed tool calls appear as timestamped rows in the conversation, in the order they started. The current step has a light moving across its words; a finished step folds to one line. Ctrl+O opens or closes completed step details, including a tool target or an explicitly shared Codex reasoning summary, along with long answers and crew member replies. API connections show model request status without invented reasoning. A tool that returned an error says failed; an interrupted tool whose effect is uncertain stays marked outcome unknown. A returned tool call does not mean its requested work succeeded. Native harness steps are shown only when that harness reports them. Short steps are still retained even if they finish between chat polls. This live history belongs to the terminal session; `/read` retrieves saved answers, not transient reasoning. Page Up and Page Down scroll the conversation or an open details panel. Ctrl+G opens agent names, small mascots and connection details; Esc closes the panel. Left on an empty draft returns to the orglet and crew picker with the current chat highlighted. Esc returns to the chat, preserving its draft and transcript. While waiting, switching waits behind earlier queued work. Small terminals use a compact header and keep the input visible.

Interactive chat requires a real connection. If an orglet or any member of its crew still uses Demo, a message is refused before sending. Use `/open` to choose a signed-in CLI or an API/local connection in the app, then `/list` to refresh and choose the chat again. One-shot commands retain their existing Demo support.

Type `/` to see commands with descriptions. Up and Down choose one; Tab or Enter fills it into the draft, and Enter on a filled command runs it. Esc dismisses the menu without clearing the draft. `/to `, `/edit ` and `/delete ` offer entity names with orglet mascots or crew icons and connection/model or lead details, instead of repeating the command description on every row. A pasted message with several lines is sent as a message even when its first line starts with `/`.

While an answer is on its way, `/queue` shows previews of the messages and commands waiting in this terminal. `/undo` takes the last one out of that queue and puts its full text back into the draft, including its newlines. Edit it and press Enter to queue it again, or clear the draft to leave it unsent. It cannot take back a message already sent to the app, and it does not stop the current run. This queue belongs to the terminal session and is not saved between sessions.

`/open`, `/help`, `/clear`, `/queue`, `/undo`, `/history`, `/react`, `/unreact`, `/forward`, `/stop` and `/pause` run immediately while waiting. This lets you open the desktop for an approval without waiting for the blocked turn to finish. Other messages and commands, including `/to`, keep their order in the queue.

The draft wraps with the terminal's width. For a long draft, only the rows around the cursor are shown; moving the cursor reveals the rest. Press Ctrl+C twice to leave: the first press shows a plain reminder without horizontal rules and pauses queue dispatch, the second exits. Esc or Enter dismisses the reminder without sending; typing or pasting dismisses it and continues editing. Pasted control keys never confirm. Ctrl+D or `/exit` leaves immediately. Leaving drops this terminal's unsent draft and local queue. Messages already sent keep running in the app.

`orglet chat --to Researcher` skips the list and opens that chat. If the name fits several chats, or none, the list opens with it typed in.

A message you send is the same turn the app's message box makes, with the same consent and cost limit as [send](#send). The answer is also in the app.

Answers are wrapped to the width of the terminal. Headings, **bold**, `code`, lists and quotes are shown as such, links print as their text followed by the address, and code blocks are kept exactly as written, indented. Switching chats keeps their terminal histories separate. `/read` retrieves the latest saved answer; `/clear` clears only the terminal view. Leaving restores the terminal screen that was there before chat opened.

### Earlier turns, replies, reactions and the latest turn

Page Up at the top of the conversation loads the ten turns before what is shown, and `/history [n]` loads `n` of them. They appear above, numbered the way `orglet read --turns` numbers them: `#3` is your third message and `#3.1` the first answer to it. The first load starts before the first message this terminal sent, so nothing shows twice. A line at the top says how many earlier turns are left, or that the chat starts there.

`/reply #3.1 <message>` sends a message as a reply to that one. `/react <reaction> [#n]` puts your reaction on the latest answer or on message `#n`, and `/unreact` takes it off; Tab completes the reaction names. `/forward Writer, Review crew [#n]` forwards the latest answer, or message `#n`, to those chats, and each one answers it as a new turn.

When an orglet asks a question, the chat prints it with numbered choices. `/answer 2` picks the second; `/answer <words>` answers in your own words, as the desktop's message box does. The terminal then waits for the turn to go on. A question asking to use an MCP tool is not shown this way: it is an approval, so the chat says to open it in the app.

`/chats` lists the chats with their short ids, and `/to #bbbb0000` opens one of them here: a side thread, a group chat or an older chat. Everything after that, messages included, goes to that chat. `/side <message>` starts a side thread from the current orglet's main chat and prints the `/to #id` that opens it; in a side thread, `/bring [#n]` brings its latest answer, or answer `#n`, into the main chat. `/group Researcher, Writer -- <message>` starts a group chat, and in one, `/members <names>` changes who it goes to. `/rename <title>` and `/archive` act on the open chat.

`/stop` and `/pause` act at once, even while a message is waiting for its answer. `/resume`, `/retry` and `/continue` wait for the turn they start, like a message. `/continue` is only there for an answer that stopped because its steps ran out, the same as the desktop's Continue.

## Create, edit and remove orglets and crews

Press **Ctrl+N** from the picker or a chat to create an **Orglet** or **Crew**. It keeps the current draft. `/new` opens the same choice; `/new orglet` and `/new crew` skip it. Up and Down move between settings; Enter edits one. Text values reuse the input, with Ctrl+J for instructions on several lines. Connection, skill, member and lead choices use arrows and a search filter. A crew can have up to eight members and a separate lead; select members with Enter, then **Done choosing members**. Choose **Save** to apply the configuration or **Cancel** to discard it. Esc goes back from a field and cancels from the settings list. Ctrl+N does not replace an unsaved form.

In the orglet/crew list, press **Left** on the highlighted entry to open its **Edit configuration / Delete / Back to list** menu. A typed search filter is kept, along with the selected row, when Esc returns to the list. The menu and editor show the entity's icon and current connection/model or crew members, lead and workflow. Left on an empty chat draft still opens the list; press Left again for the highlighted entry's menu. Left in an ordinary text draft still moves the cursor.

Orglets need a name, instructions, an existing skill and a real connection. A blank model uses that connection’s default; custom connections require an explicit model ID. Creating an orglet does not sign in or set up credentials. A packaged skill still needs its review in the desktop library. Task and monthly limits in the form are USD amounts; Orglet stores integer micros.

`/edit` opens the current chat’s configuration. `/edit <full name>` selects a matching entry; when names repeat, choose the intended orglet or crew with the arrows. The editor preserves settings it does not expose, including MCP selections, automatic proposal settings and crew review, preflight and work hours. Saves create revisions, and a running turn keeps its starting snapshot. If the desktop changed the configuration after you opened the form, save is refused; Esc and `/edit` load a fresh copy.

`/delete` opens a confirmation for the current chat’s owner, or a picker when no chat is open. Type the displayed full name exactly and press Enter. Page Up/Down reveals confirmation details in a short terminal. Empty input and Esc never delete. An orglet used by a crew, an owner of an enabled schedule, or an entity with queued/running work cannot be removed; the error says what to resolve. The last orglet can be removed, which leaves the list empty. Removal hides the entity from the active list and keeps past chats readable. It does not erase the database. A deleted current chat returns to the picker.

Forms do not send chat messages or dispatch queued messages while open. Leaving a form resumes the local queue after applying any chat rename. Deleting the current chat also requires this terminal’s queue to be empty; Esc, `/queue` and `/undo` let you review the held messages first. Editing or deleting another entry keeps the current chat open. A newly created entry opens its chat when no messages are queued. Ctrl+C retains the normal two-press exit reminder; unsaved configuration is discarded on exit.

### JSON configurations in scripts

Use `orglet config --json` for editable configurations, IDs, revisions, skills and existing provider names. This result contains no credentials or permission grants. A configuration file must be a JSON object of at most 64 KiB.

```sh
orglet config --json
orglet create orglet --config orglet.json
orglet create crew --config crew.json
orglet edit orglet "Researcher" --config patch.json
orglet delete crew "Review crew" --confirm "Review crew"
```

An orglet configuration requires `name`, `instructions`, `provider` and `skillId`. Optional fields are `modelId`, `description`, `taskBudgetMicros` and `avatar`. For example, replace `skillId` below with an ID from `orglet config`:

```json
{
  "name": "Reviewer",
  "instructions": "Review the supplied changes and explain any problems.",
  "provider": "codex",
  "skillId": "11111111-1111-4111-8111-111111111111"
}
```

A crew requires `name`, `instructions`, `memberIds` (one to eight unique orglet IDs), `synthesizerId` (lead ID), `workflow` (`parallel` or `sequential`) and `monthlyBudgetMicros`. Optional fields are `taskBudgetMicros` and `maxConcurrentTasks` (one to eight). The lead may be outside the members. Budget fields are integer millionths of a USD: `100000` is $0.10.

An edit file is a patch: `{"description":"Reviews code"}` changes only that field. Omitted fields keep their value; `null` clears an optional model, description, task limit, avatar or concurrency setting. Avatar properties merge; changing just its color preserves its emoji, and `{"avatar":{"color":null}}` restores the automatic color without removing that emoji. Changing the connection without supplying a model clears the old connection’s model. Permission fields, connection creation and proposal auto-apply fields are refused. Edits and deletes require a unique full name within the chosen kind; use the TUI arrow picker for duplicate names. Scripts also refuse a configuration that changed between reading and writing. All four commands accept `--json`.

### Keys

| Key | What it does |
|---|---|
| Enter | Sends the message, or queues it while waiting. In a menu, fills the highlighted choice; in the chat list, opens the highlighted chat. |
| Ctrl+J | Adds a line to the draft |
| Ctrl+O | Expands or collapses completed steps and answer details |
| Ctrl+G | Opens or closes agent details |
| Ctrl+Q | Opens or closes the local queue |
| Ctrl+Z | Takes the last queued item into an empty draft |
| Ctrl+P, Left with an empty draft | Returns to the orglet and crew picker after any earlier queued work |
| Page Up, Page Down | Scrolls the conversation or details panel. Page Up at the top loads earlier turns. |
| Up, Down | Move the highlight in a menu or list. In a multiline draft, move between lines; at its first or last line, go through sent messages and return to the unsent draft. |
| Left, Right, Home, End | Move within the draft; Home and End go to the start and end of the current line |
| Tab | Fills the highlighted command or name after `/to` |
| Esc | Dismisses the command menu, closes details, or returns from the `/to` list to the chat |
| Ctrl+C | First press shows an exit reminder and pauses queue dispatch; press again to leave. Esc, Enter, typing or paste dismisses it and keeps the draft and queue. Sent work keeps running in the app. |
| Ctrl+D | Leaves |

Set `ORGLET_REDUCED_MOTION=1` before starting chat to hold the working text still. In PowerShell: `$env:ORGLET_REDUCED_MOTION='1'; orglet`. No-colour chat also holds still. Completed steps and waits for the person do not animate.

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
| `/details` | Expands or collapses completed steps and answer details |
| `/agents` | Opens or closes agent details |
| `/history [n]` | Loads earlier turns of this chat, numbered |
| `/reply <#n> <message>` | Replies to message `#n` |
| `/react <reaction> [#n]`, `/unreact <reaction> [#n]` | Puts a reaction on the latest answer or message `#n`, or takes it off |
| `/forward <name, …> [#n]` | Forwards the latest answer or message `#n` to other chats |
| `/answer <n\|text>` | Answers the question the orglet is waiting on |
| `/stop`, `/pause` | Stops the running turn, or pauses it after its current step; both act at once |
| `/resume`, `/retry`, `/continue` | Resumes, runs again or continues the latest turn, and waits for the answer |
| `/chats [archived]` | Lists chats with their short ids; `/to #id` opens one |
| `/side <message>` | Sends the message in a new side thread of this orglet |
| `/bring [#n]` | In a side thread, brings its latest answer or answer `#n` into the main chat |
| `/group <name, …> -- <message>` | Starts a group chat of those orglets |
| `/members <name, …>` | In a group chat, changes who its messages go to |
| `/rename <title>`, `/archive` | Renames or archives the open chat |
| `/schedules` | Lists schedules |
| `/schedule on\|off\|run <name>` | Switches a schedule on or off, or starts it now |
| `/new [orglet|crew]` | Creates an orglet or crew in a keyboard form |
| `/edit [name]` | Edits the current chat’s orglet or crew; without a current chat, choose an entry |
| `/delete [name]` | Removes an orglet or crew after exact-name confirmation |
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

```sh
orglet read --to Researcher --turns 5
```

With `--turns`, it prints that many of the latest turns instead, up to 50, oldest first. Every message has a number: `#3` is your third message and `#3.1`, `#3.2` the answers to it, in the order they came (a crew's members, then its lead). A line above says how many earlier turns there are. A reply says what it answered, a forwarded message where it came from, and your reaction shows after the message it is on. `react`, `forward` and `send --reply-to` take these numbers; `last` means the newest answer.

If the chat waits on a question, `read` prints it with its choices on standard error. If it waits on an approval only the app gives, it says so.

`send --reply-to 3.1` sends the message as a reply to that answer, the way **Reply** does in the app.

### react

```sh
orglet react agree --to Researcher --message 3.1
```

Puts your reaction on a message: `agree`, `delighted`, `funny`, `unsure`, `watching` or `against`. Without `--message` it goes on the newest answer. A message holds one reaction of yours, so a new one replaces the old; `--off` takes it off. The orglet reads it on its next turn, as it does in the app.

### forward

```sh
orglet forward --to Researcher --message 2.1 --target Writer --target "Review crew" --note "Can you check this?"
```

Forwards one message, the newest answer by default, to up to five orglets' or crews' chats. It arrives there as your own message with your note, and each chat answers it as a new turn with its own cost limit and permissions. Files the message had go by name only; attach the real files in the app. The command prints where it went and why any place refused it, and exits 1 if one did.

### answer

```sh
orglet answer 2 --to Researcher
```

Answers the question an orglet stopped on. A number picks that choice from the list `send` and `read` printed; anything else is sent as your own words, as the desktop's message box does while a question waits. Then the command waits for the turn to go on and prints the answer, like `send`, with the same `--no-wait`, `--timeout` and `--json`.

A question that asks to use an MCP tool is an approval. `answer` refuses it and says to open the chat in the app.

### Stop, pause, resume, retry, continue

```sh
orglet pause --to Researcher
orglet resume --to Researcher
```

The buttons under a chat's latest turn. `stop` ends the turn that is running and refuses when nothing runs. `pause` stops after the current step and keeps the checkpoint. `resume` goes on from a paused or interrupted checkpoint, `retry` runs the latest message again with the current setup, and `continue` goes on from an answer that stopped because its steps ran out, starting from that run's calls and results. The app checks each one the way it checks the button, so a refusal says why.

`resume`, `retry` and `continue` wait for the answer like `send` and take `--no-wait` and `--timeout`. `stop` and `pause` return at once.

When a turn the command waits for stops on a question, the question is printed on standard error with how to answer it, and the exit code is 1. When it stops on a browser, desktop or MCP approval, the command stops waiting, says so and exits 1.

### Chats by id

```sh
orglet chats
orglet read --chat bbbb0000 --turns 3
```

`orglet chats` lists the open chats, newest first: each orglet's and crew's main chat, side threads, group chats and schedule runs, with the first eight characters of the chat's id, what kind of chat it is, its name, who answers in it and how it stands. `--archived` lists archived chats instead. Every command that takes `--to` also takes `--chat <id>` with that id, or any unique start of it of four characters or more, and a leading `#` is fine. A side thread or group chat has no other name.

### Side threads

```sh
orglet side "Try it with the 2025 numbers instead" --to Researcher
orglet bring --chat 7f3a91c2
```

`side` sends a message "in a new thread" from an orglet's main chat, as the app's composer does. The side thread starts with a copy of the main chat's permissions, folder and MCP grants, never more, and the main chat stays as it was. Crews and group chats have no side threads. The command waits for the answer like `send`, prints it, and says how to reach the side thread again with `--chat`.

`bring` copies one answer of a side thread into its main chat as a quote, the latest by default or `--message 2.1`. It never starts a run there.

### Group chats

```sh
orglet group "Compare your takes on this plan" --with Researcher --with Writer
orglet send "And the budget?" --chat c41d0e88
orglet members --chat c41d0e88 --with Researcher --with Writer --with Editor
```

`group` starts a group chat of two or more orglets with its first message, the way picking several orglets in the sidebar does: each one answers, and the first one named owns the chat. Each `group` makes a new chat; the next message goes in with `send --chat`. `members` changes who the chat's messages go to from the next message on; it replaces the whole list and is refused while the chat is working.

### Rename, archive, restore and delete chats

```sh
orglet rename --to Researcher --title "Q3 research"
orglet archive --chat 7f3a91c2
orglet chats --archived
orglet restore --chat 7f3a91c2
orglet delete --chat 7f3a91c2 --confirm "Try it with the 2025 numbers instead"
```

The same as the chat's menu in the app. An archived chat takes no new message until it is restored; archiving is refused while the chat is working. `restore` takes `--chat`, because an archived chat is no longer an orglet's main chat. `delete` needs the chat's name exactly as `orglet chats` prints it and cannot be undone.

### Archive and restore orglets and crews

```sh
orglet archive crew "Review crew"
orglet restore orglet "Old helper"
```

Archiving takes an orglet or crew off the active list, keeping its chats and history; restoring brings it back. The name must match a full name, ignoring case. The app refuses what it refuses in the desktop: an orglet a crew uses, an owner of an enabled schedule, or one with work running.

### template

```sh
orglet template research-review --provider openai
```

Creates a crew from one of the app's templates (`research-review` or `eris-review`) with its orglets and evidence skill. `--provider demo` gives the new orglets sample replies; `--provider openai` puts them on the OpenAI connection, which must already be set up in the app.

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

- exist. `run` cannot create one (`orglet schedule add` does), and names match the way chat names do.
- be switched on. A schedule that is off is refused with a message saying so.
- be approved as it is now. If its orglet, crew, skill, model or trigger changed since it was saved, the app refuses and asks you to save it again, the same as for a scheduled run.
- have finished its previous run. A run still going or waiting for you is refused.

| Option | Meaning |
|---|---|
| `--file <path>` | Attach a file to this run. Repeat it for more; the schedule's own sources and these together stay within 20. The same size and type limits as the file picker apply. |
| `--json` | Print the schedule and the new chat's id as JSON |

Like every command, `run` needs the local backend; it starts that backend in the background when it is not running. Nothing is queued while the backend is stopped, and nothing is replayed later.

### Schedules

```sh
orglet schedules
orglet schedule add "Morning review" --to Researcher --brief "Review yesterday's notes" --every weekdays --at 08:00 --budget 0.50
orglet schedule edit "Morning review" --at 09:15 --daily-cap 2
orglet schedule off "Morning review"
orglet schedule delete "Morning review" --confirm "Morning review"
```

`schedules` lists each schedule with whether it is on, who runs it, when, in which time zone, and its limits. `schedule add` creates one, `edit` changes only the options given, `on` and `off` switch it the way the card's switch does, and `delete` removes it after its exact name; its past runs stay as chats.

| Option | Meaning |
|---|---|
| `--to <name>` | The orglet or crew that runs it. Required for `add`. |
| `--brief "<text>"` | What each run is asked. Required for `add`. |
| `--every <when>` | `daily`, `weekdays`, `weekly`, or every few hours as `1h`, `2h`, `3h`, `4h`, `6h`, `8h` or `12h`. Required for `add`. |
| `--at <HH:MM>` | When it runs; for hours, the first run of the day. Required for `add`. |
| `--day <day>` | The weekday for `weekly`: `mon` to `sun`. Monday by default. |
| `--timezone <zone>` | A time zone such as `Asia/Ho_Chi_Minh`. This computer's by default. |
| `--budget <USD>` | The limit per run, such as `0.50`. Required for `add`. |
| `--daily-cap <USD>` | The most its runs may cost in one day; at least the per-run limit. |
| `--called` | Runs only when `orglet run` calls it (**Only when called**). |
| `--off` | With `add`, creates it switched off. |
| `--rename "<name>"` | With `edit`, a new name. |

A schedule made in the terminal has the name, orglet or crew, brief, timing and limits, and nothing else: no tool permissions, browser, desktop programs, sources, watched folder or working folder. Those are trust decisions, so they are set in the app. Its runs send the brief to the providers of the orglet or crew while you are away, so those providers must already be in the app's **Settings → Allowed providers**; otherwise the command refuses and says which ones. Demo orglets need nothing. An edit keeps everything the app set, and moving a schedule that has any of those settings to another orglet or crew is refused. The app saves the schedule as approved, as the desktop's Save does.

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
- A request is one line of JSON and the final answer is one line back. Interactive sends opt into intermediate progress lines on that same authenticated connection; other commands keep their single response. The app checks each request against a fixed list of allowed operations and refuses everything else, lines over 1 MB, and more than eight commands at once.
- If an older app refuses the progress option before dispatch, chat retries once without it. The message is sent once, with the older app's usual waiting status.
- `send` goes through the same steps as the message box: attached files are imported by the app, then the chat's live conversation takes the message or a new one starts. The app then checks the chat until the turn stops.
- `react`, `forward`, `control` and `answer` name a chat by its orglet or crew and a message by its number. The app turns the number into the message id from the chat's saved history, then calls the same core command as the desktop's button: `setMessageReaction`, `forwardMessage`, `cancel`, `pause`, `resume`, `retry`, `reviseTask` with `continueFrom`, and `answerDecision`. `answer` refuses a pending MCP approval before calling anything. A wait ends early when the chat shows a card only the desktop answers.
- `chats`, `side-thread`, `bring`, `group`, `members`, `chat-change`, `archive-entity` and `template` call `startSideThread`, `bringIntoMainChat`, `createTask` with several orglets, `updateTask`, `renameTask`, `archiveTask`, `deleteTask`, `archiveEntity` and `createTemplate`. None of them carries a permission, folder, browser or MCP field; the protocol refuses a request that adds one.
- `schedules`, `schedule-enable`, `schedule-delete` and `schedule-save` read the workspace's routines and call `saveRoutine` and `deleteRoutine`. `schedule-save` has fields for the name, target, brief, timing, limits and a clock or called trigger only; the app fills consent and provider scopes from the target's providers, and refuses providers not in **Settings → Allowed providers** (`providerConsent`). An edit sends the routine's own task back with only the given fields changed.
- `run` names a schedule and carries file paths, nothing else. The app imports the files the way `send` does, then starts the schedule through the same checks a scheduled run passes. The window's **Run now** (`runRoutineNow`) starts a schedule through the same checks too, but it names the schedule and nothing else, so no file reaches a schedule from the window; only `run` attaches files by path.
- Chat in the terminal uses `list`, `send`, `read`, `open`, the chat actions and the configuration operations; its waiting `send` sets `progress: true`. Progress frames contain validated IDs, authors, timestamps and bounded lifecycle details, with up to 500 steps and a visible omission count. The core observes model requests and journaled tools; per-send listeners join only the captured input revision. Codex public summaries remain in memory, while private tool output, checkpoints and model working notes never enter the frames. Listeners detach when the wait ends or disconnects. Stopping the wait with Ctrl+C closes the connection, which ends the app's wait and leaves the turn running.
- Configuration operations project an explicit editable whitelist, merge patches into the current core configuration, and compare revisions synchronously before mutation. Deletion compares both revision and name and uses the desktop’s removal guards. Comparison metadata is never stored in entity revisions.
- Native harness step times are when Orglet first observes the start and completion. They are not exact internal harness timings. A step received before its crew member's run metadata keeps those observed times when the author is joined later.
- The answers to `list`, `status`, `send` and `read` carry each orglet's colour as `#rrggbb`: the one picked in the app, or the colour of the face the app chose for it by name. The command draws the faces from these fields and falls back to grey when they are missing.
- If nothing answers, the command starts Orglet's backend on the same data folder without creating a desktop window and tries again for up to 30 seconds. `open` creates the window and waits for its page to load before confirming. A normal app launch also opens the window of an existing background instance.
- The command finds the data folder from `ORGLET_USER_DATA`, then `ORGLET_DATA_DIR` (what a source run uses), then the usual place for the app. The Windows shim sets `ORGLET_USER_DATA` for you.
- On start, a copy of Orglet reads the shim's executable and data folder back and rewrites the shim only when both are its own. A Setup install owns every `app-x.y.z\Orglet.exe` in its folder, so the shim follows an update to a new version folder. An update or uninstall leaves a shim that starts another copy alone; only running Setup or a click in **Settings → About** takes it over.
- The command itself is the app's own executable running a small script (`resources/orglet-cli.cjs`) as Node, the same way VS Code ships `code`. It needs no separate Node install.

The automatic checks run every command against a packaged build, including a wrong token and a request outside the list, and check that `list` stays plain text when piped. Progress tests exercise the real pipe and tool journal, including legacy responses, early events, revision filtering, failed and unknown steps, disconnect cleanup and motion controls. Chat tests drive raw terminal input against a fake app and inspect the rendered terminal grid: multiline paste, command choices, queue previews and undo, immediate desktop opening while a turn is waiting, draft preservation after a delayed error, resize and leaving. They do not click **Add to PATH**, because that changes the user PATH of the machine running them.
