# The orglet command

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/orglets/cli-dark.png">
  <img src="images/orglets/cli-light.png" alt="" width="112" height="112" align="right">
</picture>

`orglet` lets you talk to your orglets and channels from a terminal. It uses the same local backend as the desktop. Keys, chats, files and the sandbox stay in the app. The command only sends requests to it.

If Orglet is not running, a terminal command starts its backend in the background without opening a desktop window. Use `/open` in the terminal chat, `orglet open`, or the normal Orglet shortcut to open the desktop. If the desktop is already open, terminal commands use it as it is.

Leaving the terminal chat keeps the backend and any work running. To quit the backend, open the desktop and close its window. Settings, connections and permission approvals still need the desktop; use `/open` when a chat needs your approval.

## What it can do

| Command | What it does |
|---|---|
| `orglet` | In a terminal, opens a chat: pick an orglet or channel, then write to it. See [Chat in the terminal](#chat-in-the-terminal). |
| `orglet chat [--to <name>]` | The same, and with `--to` it opens that chat straight away |
| `orglet status` | Says whether the app is running, its version, and how many orglets and channels it has |
| `orglet list` | Lists orglets with their provider and model, then every channel under its space, with how it answers (its lead, or in turn) and its members. See [Channels](#channels). |
| `orglet config [--json]` | Shows editable configurations and the IDs needed for JSON input |
| `orglet create <orglet\|channel> --config <file.json>` | Creates an orglet or channel |
| `orglet edit <orglet\|channel> "<name>" --config <patch.json>` | Changes the supplied configuration fields |
| `orglet delete <orglet\|channel> "<name>" --confirm "<full name>"` | Removes a confirmed entity while retaining past chats |
| `orglet send "message" --to <name> [--reply-to <number>]` | Sends a message into that chat and prints the answer, optionally as a reply |
| `orglet read --to <name> [--turns <n>]` | Prints the latest answer in that chat, or its last turns, numbered |
| `orglet revise "corrected text" --to <name> --message <number> [--file <path>]` | Starts a new turn from your saved message; keeps earlier history. `--file` adds files to it. |
| `orglet react <reaction> --to <name>` | Reacts to the latest answer or a numbered message. See [react](#react). |
| `orglet forward --to <name> --target <name>` | Forwards a message to up to five other chats. See [forward](#forward). |
| `orglet answer "<answer>" --to <name>` | Answers the question an orglet is waiting on. See [answer](#answer). |
| `orglet stop\|pause\|resume\|retry\|continue --to <name>` | The buttons under a chat's latest turn. See [Stop, pause, resume, retry, continue](#stop-pause-resume-retry-continue). |
| `orglet chats [--archived] [--space <name>]` | Lists chats, side threads and channels with the short id `--chat` takes; `--space` lists only that space's channels, in the order the space shows them. See [Chats by id](#chats-by-id). |
| `orglet side "message" --to <orglet> [--file <path>]` | Sends a message in a new side thread of that orglet |
| `orglet bring --chat <id>` | Brings a side thread's answer into its main chat |
| `orglet channel "message" --with <name> [--name <name>] [--topic <topic>] [--space <name> [--category <name>]] [--file <path>]` | Creates a channel of those orglets and sends its first message (`group` is the older name). `--space` picks the space; without it the channel goes to the space named Channels. |
| `orglet members --chat <id> --with <name> …` | Changes who is in a channel |
| `orglet rename\|archive --to <name> \| --chat <id>` | Renames or archives a chat (`rename` takes `--rename "<new name>"`); `restore --chat <id>` brings it back |
| `orglet delete --chat <id> --confirm "<chat name>"` | Deletes a chat after its exact name |
| `orglet archive\|restore <orglet\|channel> "<name>"` | Archives or restores an orglet or channel |
| `orglet template <id> --provider openai` | Creates a channel from one of the app's templates |
| `orglet open [--to <name>]` | Brings the Orglet window forward, and with `--to` opens that chat |
| `orglet run "<schedule>" [--file <path>]` | Starts a schedule now, with the files you attach. See [run](#run). |
| `orglet search "<words>"` | Searches every chat, message and name. See [Search, Running and the Library](#search-running-and-the-library). |
| `orglet running` | Every run working or waiting across chats, as the Running view shows them |
| `orglet library [memory\|notes]` | Memories or notes, optionally one orglet's or channel's, or what `--query` finds |
| `orglet memory edit <id>\|delete <id> --confirm "<id or text>"` | Edits, pins or deletes an approved memory |
| `orglet usage` | Plan usage of the signed-in CLI accounts |
| `orglet models <provider>` | The models a connection offers; `--to <orglet>` uses that orglet's |
| `orglet preferences [--language …] [--theme …] [--titles …]` | Shows or changes the app's language, theme and looks. See [preferences](#preferences). |
| `orglet show <connections\|spend\|changelog\|update\|browser\|desktop\|sources\|changes>` | Looks at the app without changing it. See [show, update and assign](#show-update-and-assign). |
| `orglet update` | Checks for a new version and says what it found, then lists Marketplace items with an update |
| `orglet assign --chat <id> [--with <name> …] [--budget <USD>]` | Changes who answers a chat and lowers its cost limit |
| `orglet schedules` | Lists schedules with their timing and limits |
| `orglet spaces` | Lists spaces: the orglets in each, then each channel with its category, how it answers and who is in it, in the order the space shows them |
| `orglet space add\|edit\|category\|uncategory\|move\|out\|delete` | Creates, changes or deletes a space and its categories, and moves a channel into or out of one. See [Spaces](#spaces). |
| `orglet market [installed \| add <id>]` | Lists the marketplace, what was added from it, or adds a listing. See [The marketplace](#the-marketplace). |
| `orglet completion <powershell\|bash\|zsh>` | Prints the completion script for that shell. See [Shell completion](#shell-completion). |
| `orglet schedule add\|edit\|on\|off\|delete "<name>"` | Creates, changes, switches or deletes a schedule. See [Schedules](#schedules). |

It can create, edit and remove orglets and channels, and act on a chat's messages and its latest turn. Some things stay in the desktop on purpose; see [What stays in the desktop](#what-stays-in-the-desktop). The app refuses any other request, even one that carries the right token.

### Unlocking: answering what is waiting from the terminal

The design is [cli-held-actions-design.md](cli-held-actions-design.md). A terminal gets the right to answer what a chat is waiting on in one way: **Orglet shows a short code in its window and you type it at the terminal that asked.** An orglet that runs through a coding CLI cannot see Orglet's window and cannot type at your keyboard, so it cannot do this; a flag such as `--yes` would not help it, because it can type that too.

```
orglet unlock                       opens the terminal chat already unlocked
orglet approve --to Researcher      prints the card the chat waits on and its choices
orglet approve --to Researcher once answers it (the choice's name, here an MCP approval)
orglet approve                      the cards that belong to the app: memories to review, a downloaded update
orglet reconcile <id> 1.50 invoice  records what the provider billed for an unsettled run
orglet test mcp <name>|web-search|decision-model
orglet install-update
orglet show terminal                what the terminal did (read-only, needs no code)
```

What you can answer is the same as what the window's buttons do: an MCP, browser or desktop approval; applying or discarding what a run changed, and applying a working copy that a check command blocked; applying, dismissing or undoing an app-change proposal; approving or archiving what an orglet wanted to remember; recording the amount a provider billed; installing a downloaded update; and testing an MCP server, web search or the decision model. Each prints the same facts as the window's card first.

1. The command needs a real terminal on input and output. In a script, or with either redirected, it exits with code 2 before it sends anything.
2. It asks the app for a code. Orglet comes forward and shows a dialog: **A terminal is asking to act for you**, the code, what it allows and the time left. The only button is **Cancel**. Press it if you did not just run a command.
3. You type the code at the terminal. It is read from the terminal only, never from an argument, an environment variable, a pipe or a file. A code lives 2 minutes and allows 5 wrong tries. One pairing is open at a time. After 3 pairings that ended without the right code in 10 minutes, pairing is held for 10 minutes.
4. A one-shot command (`orglet approve … once`) pairs for exactly that operation with exactly those arguments; the key is spent by it and forgotten when the command exits. In the terminal chat, `/unlock` pairs for decisions: the key stays in memory for the session, lasts 15 minutes or 5 without use, and `/lock`, leaving the chat, a refused request or **End now** forget it. When a turn stops on a card, the chat prints the card and says `/unlock` (or `/open` to answer in the window); unlocked, `/approve <choice>` answers it. `/unlock setup` pairs for grants and secrets (next section); the dialog says so in words.
5. While a terminal is acting, the user panel shows a mark with **End now**. Every answer is listed in **Settings → Data → What the terminal did** and by `orglet show terminal`.

**Settings → Data → Let a terminal act for me** (on by default) turns the whole path off: pairing and every one of these answers are refused, with a sentence that names the setting.

Exit codes are the usual ones; a refused unlock or answer is 1, and a command with no terminal is 2. In `--json` form a request without a live unlock answers `{"ok": false, "code": "locked"}`.

### Grants and keys from the terminal

Grants (what an orglet may reach) and secrets (API keys) take the same code, with a wider scope. In the chat, `/unlock setup` pairs for the session (15 minutes, 5 idle); a one-shot command pairs for exactly its own operation, and the dialog says that operation in words (the chat, the folder, the level) before you type anything. A `decisions` unlock does not allow any of this.

```
orglet grant tools --to <name> <capability…>                 a chat's tools (skill.read, network.web, workspace.apply…)
orglet grant folder --to <name> <path> [--edit | --run]      a folder in place of the picker; --chat <id> names a chat by id
orglet grant folder-level --to <name> read|edit|run          another level on the folder the chat has
orglet grant folder-revoke --to <name>
orglet grant schedule-folder watch|work <path> [--edit | --run]
orglet grant file-revoke <source id>                         take a file back
orglet grant mcp-enable <server> on|off      mcp --to <name> <server> [<tool>] allow|deny      mcp-remove <server>      mcp-sign-in <server> [--cancel]
orglet grant limit --to <name> <USD>                         a chat's cost limit, up as well as down
orglet grant space-tools <space> [<capability…>]             what a new channel in a space starts with
orglet grant decision-model off | <connection>:<model>…
orglet grant analytics|cli-path|send-to on|off
orglet grant backup <path>                                   a new file in a folder that exists, outside the data folder
orglet grant sync --confirm "<account name>" [merge|replace]
orglet grant browser-profile clear|delete <profile> --confirm "<profile name>"
orglet grant harness add <harness> <label> | remove|select|sign-in|sign-out <harness> <account> | cancel <harness>
orglet grant account sign-in|sign-out|cancel|reopen
orglet grant custom save <name> <base url> | delete <name>
orglet connect <provider>        asks for the key with nothing shown as you type
orglet connect search <provider>
orglet disconnect <provider>     disconnect search <provider>
```

- A **folder** is resolved by the app. It has to exist and be a folder, and it may not be a drive root, your home folder itself, the data folder, or a folder that contains the data folder. The folder picker lets you click anything; a path typed in a terminal gets these refusals as well.
- A **key** is read from the terminal with echo off and only on a real terminal, after the pairing succeeded. It is never an argument, an environment variable, a file path or standard input. It travels inside the one request that saves it, goes to the same encrypted store Settings uses, and is dropped: no answer, no journal line, no log and no error message contains it (a failed save says only that the key was not saved). A pairing for a one-shot `connect` names the operation and the provider, never the key; the hash the pairing is bound to covers the operation and its other arguments and leaves the key out. In the chat, `/connect <provider>` types the key into a masked line that goes nowhere but the request.
- **`sync`** and **`browser-profile`** need the account's name or the profile's name typed back as `--confirm`. Sign-ins that open a browser (`mcp-sign-in`, `account sign-in`) do what the window does.
- Each grant raises a **notice** in the window's notification list when it happens. In **Settings → Data → What the terminal did**, a row has **Undo** where the core can take it back: a folder given to a chat that had none (revokes it), a chat's tools or the level of its folder (restores the previous set or level), an MCP server turned on or off, and an MCP permission. Undo runs from the window only; a terminal cannot undo its own grant, and a row's recipe is checked against a fixed list of shapes before it runs. Limits, keys, switches, backups and the rest have no Undo, because the previous value is not kept or the act cannot be taken back.
- In the chat the same words are slash commands: `/grant …`, `/connect <provider>`, `/disconnect <provider>`.

### What stays in the desktop

These are trust decisions that the terminal never reaches, even with a code:

- erasing data, and restoring a backup
- the first-run choice about the CodePawl account
- the live browser view, taking the browser over, and creating or opening a browser profile
- publishing to and moderating the marketplace

And these have no terminal command yet, so they stay in the window (`parity.ts` marks each `held` with its reason):

- a chat's browser profile and site list (`setBrowser`) and its granted desktop programs (`setDesktop`)
- adding or editing an MCP server with its secret values (`saveMcpServer`), and importing servers from a file (`importMcpServers`)
- the sign-in link the window copies (`accountSignInLink`)
- writing a note to the library (the core saves it as approved, with no review), restoring a file from its working copy, trusting a skill package, choosing between two versions of a synced chat, and noting that a run's evidence limit was seen

The reason is where the pipe's token lives. It is a file in the data folder. An orglet that runs through a harness CLI such as Claude Code or Codex runs as you, the same user, and can read that folder. Anything the pipe could approve, an orglet could approve for itself. When a turn stops on one of these cards, `send`, `answer` and the chat stop waiting and say so; `/open` or `orglet open --to <name>` shows the card in the app.

Decisions about work that is waiting for you, grants and keys are not in this list: a terminal reaches them after you type a code the window shows (the two sections above).

File Explorer's **Send to** menu and `orglet://` links are other ways in, on [their own page](integrations.md).

## Install

### Windows

1. Download Setup.exe from the [latest release](https://github.com/codepawl/orglet/releases/latest) and install it.
2. Open a new terminal and run `orglet status`.

Or, with Node.js 20 or later, `npx @codepawlhq/orglet` does step 1 for you: it downloads that Setup from the `codepawl/orglet` releases only, checks its SHA-256 against the release and its signature, and runs it. Without a terminal to ask in, it installs nothing unless you pass `--yes`. Installed with `npm i -g @codepawlhq/orglet`, the package's own `orglet` starts the same thing the app's command starts (it reads `orglet.cmd` and runs that Orglet.exe directly), so it never behaves differently from the command Setup adds, whichever comes first on PATH. The package lives in [`installer/npm`](../installer/npm/README.md).

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

1. One mascot sits beside the product name and version. Orglet rows have small mascots; channel rows have a ▦ group icon in the lead's colour. Both remain visible when colour is off. Every channel is in this list, whether its lead splits the work (older versions called that a crew) or its orglets take turns. A channel where the orglets take turns opens by its chat's id, so one nobody has written in yet is not offered; send its first message from the app, or make a new one with `orglet channel`.
2. The input shows **Search orglets or channels…** until you type. Orglets and Channels have separate bracketed headings with counts. While filtering, the count shows matches out of the total, such as **Orglets · 1/5**. Move through them with the Up and Down keys, or type part of a name to narrow the list. Matches stay grouped, with the closest name matches first in each section. Case and Vietnamese accents do not matter: `ke` finds "Kế toán". Press Enter to open the highlighted chat, or Tab to fill in its name. In a short terminal, the list scrolls to keep the selected chat and its section heading visible.
3. The header shows the chat name, connection, selected model, billing category and your terminal's current directory. This directory does not grant folder access. The app still controls which folder the chat can use. The connection's exact plan tier and thinking effort are not reported; the terminal says so instead of guessing.
4. The conversation sits above an input between two horizontal rules. Your turns start with **You**; answers start with the orglet's name. Type a message and press Enter. Ctrl+J adds a line; Shift+Enter also works in terminals that report it separately. Paste stays in the draft, including its newlines, until you press Enter to send it.
5. While the orglet works, the status changes from **message** to **queue** and shows elapsed seconds. You can keep editing a visible draft. Enter adds it to this terminal's queue; each item goes to the app after the previous wait ends. The unsent draft stays in place when an answer arrives.

Model requests and observed tool calls appear as timestamped rows in the conversation, in the order they started. The current step has a light moving across its words; a finished step folds to one line. Ctrl+O opens or closes completed step details, including a tool target or an explicitly shared Codex reasoning summary, along with long answers and channel member replies. API connections show model request status without invented reasoning. A tool that returned an error says failed; an interrupted tool whose effect is uncertain stays marked outcome unknown. A returned tool call does not mean its requested work succeeded. Native harness steps are shown only when that harness reports them. Short steps are still retained even if they finish between chat polls. This live history belongs to the terminal session; `/read` retrieves saved answers, not transient reasoning. Page Up and Page Down scroll the conversation or an open details panel. Ctrl+G opens agent names, small mascots and connection details; Esc closes the panel. Left on an empty draft returns to the orglet and channel picker with the current chat highlighted. Esc returns to the chat, preserving its draft and transcript. While waiting, switching waits behind earlier queued work. Small terminals use a compact header and keep the input visible.

Interactive chat requires a model. If an orglet or any member of its channel has no model connected, a message is refused before sending and the terminal says so. Use `/open` to bring the app forward and connect a signed-in CLI or an API or local connection, then `/list` to refresh and choose the chat again.

Type `/` to see commands with descriptions. Up and Down choose one; Tab or Enter fills it into the draft, and Enter on a filled command runs it. Esc dismisses the menu without clearing the draft. `/to `, `/edit ` and `/delete ` offer entity names with orglet mascots or channel icons and connection/model or lead details, instead of repeating the command description on every row. A pasted message with several lines is sent as a message even when its first line starts with `/`.

While an answer is on its way, `/queue` shows previews of the messages and commands waiting in this terminal. `/undo` takes the last one out of that queue and puts its full text back into the draft, including its newlines. Edit it and press Enter to queue it again, or clear the draft to leave it unsent. It cannot take back a message already sent to the app, and it does not stop the current run. This queue belongs to the terminal session and is not saved between sessions.

`/open`, `/help`, `/clear`, `/queue`, `/undo`, `/history`, `/react`, `/unreact`, `/forward`, `/stop` and `/pause` run immediately while waiting. This lets you open the desktop for an approval without waiting for the blocked turn to finish. Other messages and commands, including `/to`, keep their order in the queue.

The draft wraps with the terminal's width. For a long draft, only the rows around the cursor are shown; moving the cursor reveals the rest. Press Ctrl+C twice to leave: the first press shows a plain reminder without horizontal rules and pauses queue dispatch, the second exits. Esc or Enter dismisses the reminder without sending; typing or pasting dismisses it and continues editing. Pasted control keys never confirm. Ctrl+D or `/exit` leaves immediately. Leaving drops this terminal's unsent draft and local queue. Messages already sent keep running in the app.

`orglet chat --to Researcher` skips the list and opens that chat. If the name fits several chats, or none, the list opens with it typed in.

A message you send is the same turn the app's message box makes, with the same consent and cost limit as [send](#send). The answer is also in the app.

Answers are wrapped to the width of the terminal. Headings, **bold**, `code`, lists and quotes are shown as such, links print as their text followed by the address, and code blocks are kept exactly as written, indented. Switching chats keeps their terminal histories separate. `/read` retrieves the latest saved answer; `/clear` clears only the terminal view. Leaving restores the terminal screen that was there before chat opened.

### Earlier turns, replies, reactions and the latest turn

Page Up at the top of the conversation loads the ten turns before what is shown, and `/history [n]` loads `n` of them. They appear above, numbered the way `orglet read --turns` numbers them: `#3` is your third message and `#3.1` the first answer to it. The first load starts before the first message this terminal sent, so nothing shows twice. A line at the top says how many earlier turns are left, or that the chat starts there.

Messages are numbered in the order they were written, with their saved send times. Messages received out of order from another device appear in that same order. Use the current history to find a message's number before replying or revising it.

`/reply #3.1 <message>` sends a message as a reply to that one. `/react <reaction> [#n]` puts your reaction on the latest answer or on message `#n`, and `/unreact` takes it off; Tab completes the reaction names. `/forward Writer, Review channel [#n]` forwards the latest answer, or message `#n`, to those chats, and each one answers it as a new turn.

When an orglet asks a question, the chat prints it with numbered choices. `/answer 2` picks the second; `/answer <words>` answers in your own words, as the desktop's message box does. The terminal then waits for the turn to go on. A question asking to use an MCP tool is not shown this way: it is an approval, so the chat says to open it in the app.

`/chats` lists the chats with their short ids, and `/to #bbbb0000` opens one of them here: a side thread, a channel or an older chat. Everything after that, messages included, goes to that chat. `/side <message>` starts a side thread from the current orglet's main chat and prints the `/to #id` that opens it; in a side thread, `/bring [#n]` brings its latest answer, or answer `#n`, into the main chat. `/channel Researcher, Launch channel -- <message>` creates a channel (`/group` still works), and in one, `/members <names>` changes who is in it. `/rename <title>` and `/archive` act on the open chat.

`/stop` and `/pause` act at once, even while a message is waiting for its answer. `/resume`, `/retry` and `/continue` wait for the turn they start, like a message. `/continue` is only there for an answer that stopped because its steps ran out, the same as the desktop's Continue.

## Create, edit and remove orglets and channels

Press **Ctrl+N** from the picker or a chat to create an **Orglet** or **Channel**. It keeps the current draft. `/new` opens the same choice; `/new orglet` and `/new channel` skip it. Up and Down move between settings; Enter edits one. Text values reuse the input, with Ctrl+J for instructions on several lines. Connection, skill, member and lead choices use arrows and a search filter. A channel can have up to eight members and a separate lead; select members with Enter, then **Done choosing members**. Choose **Save** to apply the configuration or **Cancel** to discard it. Esc goes back from a field and cancels from the settings list. Ctrl+N does not replace an unsaved form.

In the orglet/channel list, press **Left** on the highlighted entry to open its **Edit configuration / Delete / Back to list** menu. A typed search filter is kept, along with the selected row, when Esc returns to the list. The menu and editor show the entity's icon and current connection/model or channel members, lead and workflow. Left on an empty chat draft still opens the list; press Left again for the highlighted entry's menu. Left in an ordinary text draft still moves the cursor.

Orglets need a name, instructions, an existing skill and a real connection. A blank model uses that connection’s default; custom connections require an explicit model ID. Creating an orglet does not sign in or set up credentials. A packaged skill still needs its review in the desktop library. Task and monthly limits in the form are USD amounts; Orglet stores integer micros.

`/edit` opens the current chat’s configuration. `/edit <full name>` selects a matching entry; when names repeat, choose the intended orglet or channel with the arrows. The editor preserves settings it does not expose, including MCP selections, automatic proposal settings and channel review, preflight and work hours. Saves create revisions, and a running turn keeps its starting snapshot. If the desktop changed the configuration after you opened the form, save is refused; Esc and `/edit` load a fresh copy.

`/delete` opens a confirmation for the current chat’s owner, or a picker when no chat is open. Type the displayed full name exactly and press Enter. Page Up/Down reveals confirmation details in a short terminal. Empty input and Esc never delete. An orglet used by a channel, an owner of an enabled schedule, or an entity with queued/running work cannot be removed; the error says what to resolve. The last orglet can be removed, which leaves the list empty. Removal hides the entity from the active list and keeps past chats readable. It does not erase the database. A deleted current chat returns to the picker.

Forms do not send chat messages or dispatch queued messages while open. Leaving a form resumes the local queue after applying any chat rename. Deleting the current chat also requires this terminal’s queue to be empty; Esc, `/queue` and `/undo` let you review the held messages first. Editing or deleting another entry keeps the current chat open. A newly created entry opens its chat when no messages are queued. Ctrl+C retains the normal two-press exit reminder; unsaved configuration is discarded on exit.

### JSON configurations in scripts

Use `orglet config --json` for editable configurations, IDs, revisions, skills and existing provider names. This result contains no credentials or permission grants. A configuration file must be a JSON object of at most 64 KiB.

```sh
orglet config --json
orglet create orglet --config orglet.json
orglet create channel --config channel.json
orglet edit orglet "Researcher" --config patch.json
orglet delete channel "Review channel" --confirm "Review channel"
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

`create channel` makes a channel the way **New channel** in the app does, in the space named Channels; `crew` and `team` still work as names for `channel`, and a channel made in the app shows up here too. A channel configuration requires `name` and `members`, a list of `{"kind":"orglet","id":"<orglet ID>"}`. Optional fields are `topic` and `mode`: `turns` (the default) makes the orglets answer in turn, and `lead` makes one orglet split the work. When the lead splits the work, its settings are the field `lead`: `synthesizerId` (the lead's ID, the first member when left out), `instructions`, `workflow` (`parallel` or `sequential`), `monthlyBudgetMicros`, `maxConcurrentTasks` (one to eight) and `taskBudgetMicros`. The lead must be one of the members. Budget fields are integer millionths of a USD: `100000` is $0.10.

```json
{
  "name": "launch",
  "topic": "Ship the 0.14 release",
  "members": [
    { "kind": "orglet", "id": "11111111-1111-4111-8111-111111111111" },
    { "kind": "orglet", "id": "22222222-2222-4222-8222-222222222222" }
  ],
  "mode": "lead",
  "lead": { "synthesizerId": "11111111-1111-4111-8111-111111111111", "workflow": "parallel" }
}
```

The names a crew file used still work for one release: `memberIds` (orglet IDs, with `synthesizerId` added to them), and `instructions`, `synthesizerId`, `workflow`, `monthlyBudgetMicros`, `maxConcurrentTasks` and `taskBudgetMicros` written beside `name` instead of inside `lead`. A new channel with any of them has a lead. A `null` for `maxConcurrentTasks` or `taskBudgetMicros` now keeps the value the channel has, since a channel with a lead always has both. `orglet config --json` lists every channel under `channels` (id, `config`, and for a channel with a lead its `revision`); `crews`, the channels with a lead in their older shape, is still there and is going away in a later release. The `id` in the result of a channel with a lead is still its crew's, and `channelId` is the channel's own; either names the channel in later edits.

An edit file is a patch: `{"description":"Reviews code"}` changes only that field. Omitted fields keep their value; `null` clears an optional model, description, task limit or avatar of an orglet, and an empty `topic` clears a channel's topic. Avatar properties merge; changing just its color preserves its emoji, and `{"avatar":{"color":null}}` restores the automatic color without removing that emoji. Changing the connection without supplying a model clears the old connection’s model. Permission fields, connection creation and proposal auto-apply fields are refused. Edits and deletes require a unique full name within the chosen kind; use the TUI arrow picker for duplicate names. Scripts also refuse a configuration that changed between reading and writing. All four commands accept `--json`.

### Keys

| Key | What it does |
|---|---|
| Enter | Sends the message, or queues it while waiting. In a menu, fills the highlighted choice; in the chat list, opens the highlighted chat. |
| Ctrl+J | Adds a line to the draft |
| Ctrl+O | Expands or collapses completed steps and answer details |
| Ctrl+G | Opens or closes agent details |
| Ctrl+Q | Opens or closes the local queue |
| Ctrl+Z | Takes the last queued item into an empty draft |
| Ctrl+P, Left with an empty draft | Returns to the orglet and channel picker after any earlier queued work |
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
| `/to <name>` | Switches to another orglet or channel. Without a name, it opens the list. |
| `/list` | Refreshes connections and opens the orglet and channel picker |
| `/read` | Shows the latest answer in this chat again, including one you stopped waiting for |
| `/open` | Brings the app forward on this chat |
| `/clear` | Clears the screen |
| `/queue` | Shows previews of messages and commands waiting in this terminal |
| `/undo` | Takes the last queued item back into the draft for editing; already sent work keeps running |
| `/details` | Expands or collapses completed steps and answer details |
| `/agents` | Opens or closes agent details |
| `/history [n]` | Loads earlier turns of this chat, numbered |
| `/revise <#n> <text>` | Corrects your saved message and waits for a new answer |
| `/reply <#n> <message>` | Replies to message `#n` |
| `/react <reaction> [#n]`, `/unreact <reaction> [#n]` | Puts a reaction on the latest answer or message `#n`, or takes it off |
| `/forward <name, …> [#n]` | Forwards the latest answer or message `#n` to other chats |
| `/answer <n\|text>` | Answers the question the orglet is waiting on |
| `/stop`, `/pause` | Stops the running turn, or pauses it after its current step; both act at once |
| `/resume`, `/retry`, `/continue` | Resumes, runs again or continues the latest turn, and waits for the answer |
| `/chats [archived] [--space <name>]` | Lists chats with their short ids, only those of one space with `--space`; `/to #id` opens one |
| `/restore #<id>`, `/restore orglet\|channel "<name>"` | Brings an archived chat, orglet or channel back; `/chats archived` lists the chats |
| `/side <message>` | Sends the message in a new side thread of this orglet |
| `/bring [#n]` | In a side thread, brings its latest answer or answer `#n` into the main chat |
| `/channel [--space <name> [--category <name>]] <name, …> -- <message>` | Creates a channel of those orglets and channels, in a space if one is named; `/group` is the older name |
| `/members <name, …>` | In a channel, changes who is in it |
| `/rename <title>`, `/archive` | Renames or archives the open chat |
| `/schedules` | Lists schedules |
| `/schedule on\|off\|run <name>` | Switches a schedule on or off, or starts it now |
| `/schedule dismiss\|catch-up "<name>"`, `/schedule delete "<name>" --confirm "<name>"` | Closes the missed-run notice, runs the missed time once, or deletes a schedule; adding and editing one is `orglet schedule` |
| `/spaces` | Lists the spaces with their orglets and channels |
| `/space <verb> …` | The same as `orglet space`: add, edit, category, uncategory, move, out, folder, color, order, delete |
| `/market [installed\|add <id>\|update "<name>" [--confirm <code>]]` | The same as `orglet market` |
| `/search <words>` | Searches every chat |
| `/running` | Lists every run working or waiting |
| `/memory` | Lists this orglet's or channel's memories |
| `/memory edit <id> --text "<text>"`, `/memory delete <id> --confirm "<id or text>"` | The same as `orglet memory`; a delete needs its confirmation here too |
| `/usage` | Shows plan usage of the CLI accounts |
| `/models` | Lists the models of this orglet's connection |
| `/language vi\|en\|en-GB`, `/theme system\|light\|dark` | Changes the app's language or theme |
| `/preferences [--titles on\|off …]` | The same as `orglet preferences` |
| `/show <topic>`, `/update` | The same as `orglet show` and `orglet update`; `browser`, `desktop`, `sources` and `changes` are about the open chat |
| `/new [orglet|channel]` | Creates an orglet or channel in a keyboard form |
| `/edit [name]` | Edits the current chat’s orglet or channel; without a current chat, choose an entry |
| `/delete [name]` | Removes an orglet or channel after exact-name confirmation |
| `/help` | Lists these commands |
| `/exit` | Leaves |

A command that says "the same as" runs the one-shot command as typed, quoting as a shell does, and prints what it prints, so its checks and confirmations apply: a delete in the chat needs the same `--confirm` as `orglet delete`. `/edit` and `/delete` open the keyboard form for an orglet or any channel; for a channel that takes turns the form has its name, topic and members.

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

The message goes into the orglet's or channel's chat exactly as if you had typed it in the message box. If the chat already has a conversation, the message is the next turn in it; if not, it starts one. A channel's chat is led by its lead, as in the app. If the app window is showing that orglet's or channel's empty chat when the command starts one, the window switches to the new chat, so a question the chat asks, such as approving an MCP tool, is in view.

By default the command waits for the turn to finish and prints the answer. A channel prints each member's reply and then the lead's, each under its name. In a terminal, the orglet's face waits beside you on standard error while it works. Ctrl+C stops waiting; the turn keeps running in the app, and `orglet read` shows the answer later.

| Option | Meaning |
|---|---|
| `--to <name>` | The orglet or channel. Required. |
| `--file <path>` | Attach a file. Repeat it for more, up to 20. The same size and type limits as the file picker apply. |
| `--no-wait` | Return right after sending. Read the answer later with `orglet read`. |
| `--timeout <seconds>` | How long to wait. The default is 600. When it runs out, the turn keeps running in the app. |
| `--json` | Print the result as JSON |

Sending gives the same consent the message box gives: the message and attached files go to the providers of the orglets that run. The cost limit is the chat's own, or the orglet's or channel's default for a new chat.

### read

```sh
orglet read --to Researcher
```

Prints the answers of the latest message in that chat that has any. If the orglet is working on a newer message, the command says so. Reading a chat marks its answer as read, like opening it in the app.

```sh
orglet read --to Researcher --turns 5
```

With `--turns`, it prints that many of the latest turns instead, up to 50, oldest first. Every message has a number: `#3` is your third message and `#3.1`, `#3.2` the answers to it, in the order they came (a channel's members, then its lead). A line above says how many earlier turns there are. A reply says what it answered, a forwarded message where it came from, and your reaction shows after the message it is on. `react`, `forward` and `send --reply-to` take these numbers; `last` means the newest answer.

If the chat waits on a question, `read` prints it with its choices on standard error. If it waits on an approval only the app gives, it says so.

`send --reply-to 3.1` sends the message as a reply to that answer, the way **Reply** does in the app.

### react

```sh
orglet react agree --to Researcher --message 3.1
```

Puts your reaction on a message: `agree`, `delighted`, `funny`, `unsure`, `watching` or `against`. Without `--message` it goes on the newest answer. A message holds one reaction of yours, so a new one replaces the old; `--off` takes it off. The orglet reads it on its next turn, as it does in the app.

### forward

```sh
orglet forward --to Researcher --message 2.1 --target Writer --target "Review channel" --note "Can you check this?"
```

Forwards one message, the newest answer by default, to up to five orglets' or channels' chats. It arrives there as your own message with your note, and each chat answers it as a new turn with its own cost limit and permissions. Files the message had go by name only; attach the real files in the app. The command prints where it went and why any place refused it, and exits 1 if one did.

### revise

Correct a saved message with `orglet revise "corrected text" --to Researcher --message 3`, or `/revise #3 corrected text` in the terminal chat. Use `/history` or `orglet read --turns 5` to find your message number. This starts a new turn and keeps earlier messages and answers unchanged. It reuses that message’s files, reply reference and plan choice, omitting files no longer allowed; it does not copy a forward’s attribution. Only your own numbered messages can be revised, and a running turn must stop first. `--file <path>` adds files to the new turn, beside the message's own. `--chat <id>`, `--no-wait`, `--timeout` and `--json` work as with other message commands. If an old message has no saved input, the command reports that its original files cannot be recovered.

### answer

```sh
orglet answer 2 --to Researcher
```

Answers the question an orglet stopped on. A number picks that choice from the list `send` and `read` printed; anything else is sent as your own words, as the desktop's message box does while a question waits. Then the command waits for the turn to go on and prints the answer, like `send`, with the same `--no-wait`, `--timeout` and `--json`.

A question that asks to use an MCP tool is an approval. `answer` refuses it and says to open the chat in the app. `answer` takes no `--file`: the answer has nowhere to carry one. Send the file with `send --file` instead.

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

`orglet chats` lists the open chats, newest first: each orglet's and channel's main chat, side threads, channels (`#name`) and schedule runs, with the first eight characters of the chat's id, what kind of chat it is, its name, who answers in it and how it stands. `--archived` lists archived chats instead. Every command that takes `--to` also takes `--chat <id>` with that id, or any unique start of it of four characters or more, and a leading `#` is fine. A side thread has no other name, and a channel is reached by its id too.

### Side threads

```sh
orglet side "Try it with the 2025 numbers instead" --to Researcher
orglet bring --chat 7f3a91c2
```

`side` sends a message "in a new thread" from an orglet's main chat, as the app's composer does, and takes `--file <path>` like `send`. The side thread starts with a copy of the main chat's permissions, folder and MCP grants, never more, and the main chat stays as it was. Channels have no side threads. The command waits for the answer like `send`, prints it, and says how to reach the side thread again with `--chat`.

`bring` copies one answer of a side thread into its main chat as a quote, the latest by default or `--message 2.1`. It never starts a run there.

### Channels

```sh
orglet channel "Compare your takes on this plan" --with Researcher --with "Launch channel" --name launch --topic "Friday's release"
orglet send "And the budget?" --chat c41d0e88
orglet members --chat c41d0e88 --with Researcher --with Writer --with Editor
```

`channel` creates a channel of these orglets and sends its first message, the way **New channel** in the app does (COD-361): each orglet answers in turn. One member is enough. `--name` names it (the members' names otherwise) and `--topic` sets its topic. `--file <path>` attaches a file to the first message, so it needs a message. `--space <name>` puts the channel in that space, and `--category <name>` in one of its categories; a space is found by its name or the start of it. Without `--space` the channel goes to the space named Channels, which the app keeps for channels that arrive outside every space, and the command says which space it is in. With `--name` and no message the channel is only created, as **New channel** in the app does, and no chat starts. In a space `--with` can be left out: the channel then takes every orglet of its category or space and follows that list when it changes. With `--with` it keeps the orglets named. `orglet chats --space <name>` lists only the channels of that space. Each `channel` makes a new channel; the next message goes in with `send --chat`. `group`, the older name, does the same and takes the same options. `members` changes who is in the channel from the next message on, orglets and channels alike; it replaces the whole list, keeps the name and topic, and is refused while the channel is working. `orglet chats` lists a channel as `channel` with its `#name`, and `delete --chat <id> --confirm launch` takes the name with or without its `#`, since a shell reads an unquoted `#` as the start of a comment.

There is one kind of channel. Its **lead** splits the work and combines the answers, or its orglets **take turns**; `orglet list` and `orglet spaces` say which (`lead Writer`, or `in turn`). A channel with a lead was once a crew. `orglet create channel`, `edit channel` and `delete channel` work on any channel, with or without a lead, through the same commands as the app's channel dialog: a channel you create appears in the space named Channels, and an edit patch changes only the fields it names, among them `name`, `topic`, `members`, and the lead's settings. A patch with lead settings changes a channel that takes turns only when it also says `"mode": "lead"`; the terminal never switches how a channel answers by accident. `delete channel` removes a channel nobody has written in. A channel with a lead that has messages leaves the list and keeps its chat history, as before; one that takes turns and has messages is deleted as a chat with `orglet delete --chat <id>`. `archive channel` and `restore channel` still archive and restore the record of a channel with a lead, because the app has no archive command for a channel itself. `crew` and `team` are accepted in place of `channel` in those commands, and `group` in place of the `channel` command; none of them appears in the output.

`orglet list` shows every channel under its space, with the channels outside every space last. Inside a space, the channels directly in it come first, then each category in the order the app shows them, and in each place the channels keep the order you gave them in the app, with one you never moved after those you did, newest first. `orglet spaces` and `orglet chats --space <name>` use the same order. With `--json`, `list` has a `channels` list; its `crews` list, the channels with a lead only, is still there for scripts and is going away in a later release.

### Spaces

```
orglet space add "Launch" --with Researcher --with Writer
orglet space edit "Launch" --rename "Liftoff" --with Researcher
orglet space category "Launch" --category Drafts
orglet space category "Launch" --category Drafts --rename Copy --with Writer
orglet space uncategory "Launch" --category Copy
orglet space move "Launch" --chat cccc0000 --category Drafts
orglet space move "Launch" --name ideas
orglet space out --chat cccc0000
orglet space delete "Launch" --confirm "Launch"
orglet space folder "Launch" --value Work
orglet space color "Launch" --value "#7c8be8"
orglet space order "Launch" --name ideas --position 1
orglet space order "Launch" --category Drafts --position 1
```

`folder` puts a space's tile in a folder on the rail, `color` sets its colour; without `--value` the space leaves its folder or goes back to the default colour. `order` moves a channel to a place among the channels of its category (or the ones directly in the space), or a category to a place among the space's categories; the other channels keep their places. What a new channel in a space starts with is a set of tool permissions, so it is set in the app.

The same as a space's settings in the app. `add` makes a space with these orglets. `edit` renames it with `--rename`, and with `--with` replaces the whole list of its orglets. `category` adds one category; for a category that exists, `--rename` renames it and `--with` sets the orglets of its own. `uncategory` removes a category and keeps its channels in the space. `move` puts a channel in the space, or in one of its categories with `--category`; `out` takes the channel out of every space. Both name the channel with `--chat <id>` or with `--name <channel name>`, which is the only way for a channel that has no message yet. `delete` needs the space's full name in `--confirm` and keeps its channels, which are then in no space. A space is found by its name or the start of it, except for `--confirm`. A space holds orglets, so `--with` does not take a channel's name. The command sets no permission and no folder.

`orglet search "words" --space <name>` keeps only the messages in that space's channels, and `orglet running --space <name>` only its runs. In the terminal chat, `/spaces` lists the spaces as `orglet spaces` does.

### The marketplace

```
orglet market
orglet market installed
orglet market add launch-space
orglet market update "Launch space"
orglet market update "Launch space" --confirm 1a2b3c4d
```

`market update` shows what an update of something you added changes (each field, before and after) and prints an eight-character code for exactly that update. With the code in `--confirm` the update is applied, after the app previews it again and finds the same code; if the listing changed in between, nothing is applied and you read the new changes first.

`orglet market` lists the catalog: each listing's id, whether it is an orglet, a channel or a space, its name, its author and its summary. It reads up to five pages and says when there are more. When the online catalog cannot be fetched it lists the saved copy, or the one that ships with the app, and says which. `--refresh` fetches it again. `installed` lists what was added from the marketplace, with the version of each and whether an update is waiting. `add <id>` adds the listing's current version, as **Add** on the Marketplace page does, with the same checks of its bytes: its orglets, and the channel or space it carries. It names the orglets it made, and the ones whose suggested connection this computer does not have. None of this needs an account. Publishing, reviewing and applying an update stay in the app, where you see the content before anything is sent or changed.

### Shell completion

```
orglet completion powershell | Out-String | Invoke-Expression
eval "$(orglet completion bash)"
eval "$(orglet completion zsh)"
```

`orglet completion` prints a script that completes the command names as the first word and the option names after a `-`. Put the line for your shell in its startup file. The script is static text: completing asks the app nothing, and it holds no orglet, chat or space name. The command itself does not start the app.

### Rename, archive, restore and delete chats

```sh
orglet rename --to Researcher --rename "Q3 research"
orglet archive --chat 7f3a91c2
orglet chats --archived
orglet restore --chat 7f3a91c2
orglet delete --chat 7f3a91c2 --confirm "Try it with the 2025 numbers instead"
```

The same as the chat's menu in the app. `--rename` is the option every command that renames takes (schedules and spaces too); `--title` still works for a chat. An archived chat takes no new message until it is restored; archiving is refused while the chat is working. `restore` takes `--chat`, because an archived chat is no longer an orglet's main chat. `delete` needs the chat's name exactly as `orglet chats` prints it and cannot be undone.

### Archive and restore orglets and channels

```sh
orglet archive channel "Review channel"
orglet restore orglet "Old helper"
```

Archiving takes an orglet or channel off the active list, keeping its chats and history; restoring brings it back. The name must match a full name, ignoring case. The app refuses what it refuses in the desktop: an orglet a channel uses, an owner of an enabled schedule, or one with work running.

### template

```sh
orglet template research-review --provider openai
```

Creates a channel from one of the app's templates (`research-review`, `writing-desk` or `data-check`) with its orglets and evidence skill. `--provider openai` puts the new orglets on the OpenAI connection, which must already be set up in the app. The channel goes to the space named Channels, and the command says so. Choose a model for each orglet in the app if you want one other than the default.

### open

```sh
orglet open --to "Review channel"
```

Brings the window forward and opens that chat. On Windows the taskbar button may flash instead, because Windows does not always let another program take the front.

### run

```sh
orglet run "Invoice check" --file invoice.pdf
```

Starts one of the app's schedules now: its brief goes to its orglet or channel, within its cost limit, with the files you attach added to the schedule's own sources. The command returns once the run has started, and the run appears in the app's sidebar under the orglet or channel it runs for, named after the schedule. It does not wait for the answer; the app says when the run is done, with a system notification if Orglet is in the background ([chat guide](chat-guide.md#while-orglet-is-in-the-background)).

Any schedule can be started this way. A schedule set to **Only when called** runs in no other way. The schedule must:

- exist. `run` cannot create one (`orglet schedule add` does), and names match the way chat names do.
- be switched on. A schedule that is off is refused with a message that says to switch it on with `orglet schedule on "<name>"`.
- be approved as it is now. If its orglet, channel, skill, model or trigger changed since it was saved, the app refuses and asks you to save it again, the same as for a scheduled run.
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
orglet schedule dismiss "Morning review"
orglet schedule catch-up "Morning review"
```

After the app was closed over a schedule's time, the schedule shows a notice with two buttons. `dismiss` closes the notice, and `catch-up` runs the missed time once, as the second button does; the app refuses either when the schedule has no notice.

`schedules` lists each schedule with whether it is on, who runs it, when, in which time zone, and its limits. `schedule add` creates one, `edit` changes only the options given, `on` and `off` switch it the way the card's switch does, and `delete` removes it after its exact name; its past runs stay as chats.

| Option | Meaning |
|---|---|
| `--to <name>` | The orglet or channel that runs it. Required for `add`. |
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

A schedule made in the terminal has the name, orglet or channel, brief, timing and limits, and nothing else: no tool permissions, browser, desktop programs, sources, watched folder or working folder. Those are trust decisions, so they are set in the app. Its runs send the brief to the providers of the orglet or channel while you are away, so those providers must already be in the app's **Settings → Allowed providers**; otherwise the command refuses and says which ones. An orglet with no model connected needs no provider. An edit keeps everything the app set, and moving a schedule that has any of those settings to another orglet or channel is refused. The app saves the schedule as approved, as the desktop's Save does.

### Search, Running and the Library

```sh
orglet search "contract terms"
orglet running
orglet library memory --to Researcher
orglet memory edit a1b2c3d4 --text "Prefers bullet points" --pin
orglet memory delete a1b2c3d4 --confirm "Prefers bullet points"
```

`search` finds what the app's search finds: every message you wrote, every answer, chat names, and orglet and channel names, ignoring case and accents. It prints the matching names, then one line per chat with its id (for `read --chat`), who wrote the message and the words around the match.

`running` lists every run working, waiting its turn or stopped at a checkpoint, across chats, as the Running view does: the chat's id and name, the orglet, its state, what it waits for (a provider slot, a teammate, an answer, an approval) and its connection. Stop or pause one with `orglet stop --chat <id>`.

`library` lists memories (the default) or `notes`, approved and waiting for review, with `--to` for one orglet's or channel's and `--query` to search them as the Library does. `memory edit <id>` gives an approved memory new text, a pin or no pin, and `memory delete <id> --confirm "<id or text>"` deletes it for good, as an orglet's Memory tab does. `--confirm` takes the memory's id, whole or as the library prints it, or its exact text, the way the other deletes take a name. `--yes` still works as the older way to confirm. A memory waiting for review is a proposal: approving or dismissing it stays in the desktop, so both commands refuse it.

### usage and models

```sh
orglet usage --refresh
orglet models --to Researcher
```

`usage` shows the plan usage of each signed-in Claude Code, Codex, Cursor Agent and Gemini CLI account, as Settings does: the plan, how much of each allowance is used and when it resets. Emails show only in part. `--refresh` reads again now. Signing in and spending a banked reset stay in Settings.

`models` lists the models a connection offers, by provider id (`openai`, `claude-code`, `custom:<id>`, …) or with `--to` for the orglet's own connection; `--refresh` fetches the list again.

### preferences

```sh
orglet preferences --language en-GB --theme dark
orglet preferences --titles off --retention 30 --copy-format markdown --accent "#7c8be8"
orglet preferences --font "Fira Sans" --code-font default --auto-update on --notifications off
```

Shows the app's looks and behaviour settings, and changes the ones given: the language, the theme, whether chats are named automatically (`--titles on|off`), whether opening a chat from a notification asks first (`--open-confirmation on|off`), the copy and download formats (`--copy-format`, `--download-format`: `ask`, `text` or `markdown`), how long an archived chat is kept (`--retention 0|7|30` days, 0 until you delete it), automatic updates (`--auto-update`), applying updates of things added from the Marketplace by itself (`--market-auto-update on|off`, off by default), system notifications while the window is in the background (`--notifications`), the accent colour (`--accent #rrggbb`) and the two fonts (`--font`, `--code-font`; `default` goes back to the font the app ships with). Every other setting stays in the app's Settings: provider permission, the connection limit and the web search provider have no field in the request.

### show, update and assign

```sh
orglet show connections
orglet show spend
orglet show changelog --refresh
orglet show update
orglet update
orglet show changes --chat cccc0000
orglet show browser --to Researcher
orglet show desktop --to Researcher
orglet show sources --chat cccc0000
orglet assign --chat cccc0000 --with Writer --budget 0.25
```

`show` only looks. `connections` says yes or no for each API key, custom connection and web search key, and the sign-in status of each CLI account; it never returns a key, token or the account's address. `spend` prints what was charged and what is reserved for runs under way, in integer millionths of a USD, with the connection limit. `changelog` lists the latest releases (`--refresh` fetches them again) and `update` the updater's state; `orglet update` starts the same check as the window's button and prints the state right after, then the things added from the Marketplace that have a newer version (the command that previews one is `orglet market update "<name>"`, which stays as it is) and what automatic Marketplace updates did: updated, failed with the reason, or left for you with why. A downloaded update is installed from the window.

`browser` and `desktop` print a chat's journal, what each step touched and how it ended. `sources` lists the chat's files by name and size, not where they were picked from. `changes` lists what the chat's runs changed in the working folder, by working copy, with each change's path and status, and notes how many commands ran and how many are uncertain. It does not return the review token: applying or discarding a hand-in, and restoring a file, stay in the window.

`assign` is the chat dialog's assignee and limit. `--with` replaces the orglets that answer (name one channel with a lead alone to give the chat to it); in a channel, `--with` is refused and `orglet members` changes who is in it. `--budget` can only lower the limit: raising what a chat may spend is done in the app. A chat that is running is refused by the core.

### Names

Names match without regard to case. A unique start of a name is enough: `--to res` finds Researcher. If the start fits several names, or nothing fits, the command lists the names you can use. If an orglet and a channel share a name, rename one in the app.

### JSON and exit codes

`--json` prints the result as JSON on standard output, including errors (`{"ok": false, "code": "not_found", "error": "…"}`).

| Exit code | Meaning |
|---|---|
| 0 | It worked |
| 1 | It failed: an unknown name, a turn that failed or ran out of time, a chat with no answer yet |
| 2 | The command was typed wrong. Run `orglet --help` or `orglet <command> --help`. A command that needs you to type a code (`unlock`, `approve`, `reconcile`, `test`, `install-update`, `grant`, `connect`, `disconnect`) also exits 2 when input or output is not a terminal. |
| 3 | The app could not be reached, even after trying to start it |

Messages that come from the app are in the app's language.

## How it works

- While Orglet runs, it listens on a named pipe on Windows (`\\.\pipe\orglet-cli-` plus a hash of the data folder) or a socket file `cli.sock` in the data folder on macOS and Linux. Nothing listens on the network.
- Each start writes a new random token to `cli-token` in the data folder, readable only by you where the system supports it. Every request must carry it; the app compares it in constant time. Anyone who cannot read your data folder cannot use the pipe.
- A request is one line of JSON and the final answer is one line back. Interactive sends opt into intermediate progress lines on that same authenticated connection; other commands keep their single response. The app checks each request against a fixed list of allowed operations and refuses everything else, lines over 1 MB, and more than eight commands at once.
- If an older app refuses the progress option before dispatch, chat retries once without it. The message is sent once, with the older app's usual waiting status.
- `send` goes through the same steps as the message box: attached files are imported by the app, then the chat's live conversation takes the message or a new one starts. The app then checks the chat until the turn stops.
- `react`, `forward`, `control` and `answer` name a chat by its orglet or channel and a message by its number. The app turns the number into the message id from the chat's saved history, then calls the same core command as the desktop's button: `setMessageReaction`, `forwardMessage`, `cancel`, `pause`, `resume`, `retry`, `reviseTask` with `continueFrom`, and `answerDecision`. `answer` refuses a pending MCP approval before calling anything. A wait ends early when the chat shows a card only the desktop answers.
- `chats`, `side-thread`, `bring`, `channel`, `members`, `chat-change`, `archive-entity` and `template` call `startSideThread`, `bringIntoMainChat`, `createChannel` and then `createTask` for the channel's first message, `updateChannel`, `renameTask`, `archiveTask`, `deleteTask`, `archiveEntity` and `createTemplate`. `channel` without `--space`, and `template`, then call `adoptLooseChannels` with the same word for Channels the window passes, so the new channel is in the space the app keeps for them before its first message runs. `side-thread`, `channel` and `revise` import `--file` paths the way `send` does and pass the source ids on (`sourceIds` of `startSideThread`, `createTask` and `reviseTask`). None of them carries a permission, folder, browser or MCP field; the protocol refuses a request that adds one.
- `config`, `save-orglet`, `save-crew` and `delete-entity` are `orglet config`, `create`, `edit` and `delete`. For an orglet they call `saveWorker` and `deleteEntity`. For a channel `save-crew` calls `createChannel` (then `adoptLooseChannels`, as `channel` does) or `updateChannel`, with the lead's settings as the command's `lead` field, and `delete-entity` calls `deleteChannel` for a channel with no message, or `deleteEntity` for the crew record behind a channel with a lead that has messages. `updateChannel` has no revision check, so the app compares the revision of a channel with a lead just before it calls; an edit made in the window in between can still be overwritten.
- `preferences` calls `settings` with the one field to change, `chat-settings` calls `updateTask`, `schedule-notice` calls `dismissRoutine` and `catchUpRoutine`, and `market update` calls `marketInstallations`, `marketPreviewUpdate` and, with the code, `marketApplyUpdate`. `show` reads `workspace`, `harnesses`, `browserActions`, `desktopActions`, `sourceMetadata` and `workspaceRecovery` from the core, and the saved keys, the release notes and the updater from main; `update` calls the updater's check. `space folder`, `color` and `order` call `updateSpace` and `reorder`.
- `space-change` and `spaces` call `createSpace`, `updateSpace` and `deleteSpace` for a space, and `updateChannel` for a channel moved into or out of one or into a category. `spaces`, `list`, `status` and `chats --space` put channels in the order the window does: the workspace's `channelOrder`, a channel not in it after those that are, newest first, and categories in the order of each space's `categories`.
- `market` calls `marketCatalog` and `marketInstallations`, and `marketAdd` for `add`. Publishing, moderation and applying an update have no operation here.
- `schedules`, `schedule-enable`, `schedule-delete` and `schedule-save` read the workspace's routines and call `saveRoutine` and `deleteRoutine`. `schedule-save` has fields for the name, target, brief, timing, limits and a clock or called trigger only; the app fills consent and provider scopes from the target's providers, and refuses providers not in **Settings → Allowed providers** (`providerConsent`). An edit sends the routine's own task back with only the given fields changed.
- `search`, `running`, `library`, `usage` and `models` read through `searchChats`, the workspace's `running`, `knowledge` and `searchKnowledge`, `harnessUsage` and `modelList`. `memory-edit` and `memory-delete` call `updateMemory` and `deleteMemory`, only for an approved memory, because `updateMemory` approves what it saves. A delete carries `--confirm` text that the app compares with the memory's id and text, or `--yes`; a request with neither is refused by the protocol. `preferences` sends `settings` with the current theme and connection limit and only the language or theme changed; main then updates its own language as for a save in the window.
- `run` names a schedule and carries file paths, nothing else. The app imports the files the way `send` does, then starts the schedule through the same checks a scheduled run passes. The window's **Run now** (`runRoutineNow`) starts a schedule through the same checks too, but it names the schedule and nothing else, so no file reaches a schedule from the window; only `run` attaches files by path.
- The operations that answer held decisions (`held`) carry an `elevation` key beside the token. The server checks the token first, then the key's SHA-256 in constant time, its life (15 minutes, 5 idle) and scope; a missing or dead key answers `locked`. The set of operations that need a key comes from `apps/desktop/src/cli/parity.ts` (the `elevated` answer), not from a second list, and a test fails when the two differ. `pair-start` asks for a code (main makes it from an alphabet without 0, O, 1, I and L and shows it in the window; the answer does not carry it), `pair-finish` sends the typed code and is the only answer that ever carries a key, `pair-cancel` and `elevation-end` end a pairing or a key, and `waiting` reads the cards a chat or the app is waiting on, with the same facts as the window and a ready request for each choice. Each answer calls the core command its window button calls; `held` also journals it in `terminal-journal.jsonl` in the data folder (words, never an argument; local, not synced, not in a backup). The key is never written to disk, a log or an environment variable, and the window never receives it. Grants and secrets are `held` bodies too (`tools`, `folder`, `limit`, `connect`, … in `held-protocol.ts`); `main/cli-setup.ts` runs them. Each calls the core command or the `main` function the window's control calls (`setToolCapabilities`, `grantWorkspace` with the checked path, `setWorkspaceLevel`, `revokeWorkspace`, `setMcpServerEnabled`, `setMcpGrant`, `updateTask`, `updateSpace`, `saveDecisionModelSetting`, the harness account commands, `saveCustomConnection`; `backupExport` written to the checked path; the credential, web search key, MCP, account, sync and browser profile functions of `main/index.ts`), and a request needs the `setup` scope or a `one` key made for it. A `secret` field is optional in the schema so the same body can name the operation to a pairing; `pair-start` refuses an operation that carries one, `operationHash` leaves it out, and a body that arrives without it is refused. Settings' **Undo** names a journal row to `undoTerminalAction`; main reads the recipe saved with that row and runs one of five fixed shapes.
- Chat in the terminal uses `list`, `send`, `read`, `open`, the chat actions and the configuration operations; its waiting `send` sets `progress: true`. Progress frames contain validated IDs, authors, timestamps and bounded lifecycle details, with up to 500 steps and a visible omission count. The core observes model requests and journaled tools; per-send listeners join only the captured input revision. Codex public summaries remain in memory, while private tool output, checkpoints and model working notes never enter the frames. Listeners detach when the wait ends or disconnects. Stopping the wait with Ctrl+C closes the connection, which ends the app's wait and leaves the turn running.
- Configuration operations project an explicit editable whitelist, merge patches into the current core configuration, and compare revisions synchronously before mutation. Deletion compares both revision and name and uses the desktop’s removal guards. Comparison metadata is never stored in entity revisions.
- Native harness step times are when Orglet first observes the start and completion. They are not exact internal harness timings. A step received before its channel member's run metadata keeps those observed times when the author is joined later.
- The answers to `list`, `status`, `send` and `read` carry each orglet's colour as `#rrggbb`: the one picked in the app, or the colour of the face the app chose for it by name. The command draws the faces from these fields and falls back to grey when they are missing.
- If nothing answers, the command starts Orglet's backend on the same data folder without creating a desktop window and tries again for up to 30 seconds. `open` creates the window and waits for its page to load before confirming. A normal app launch also opens the window of an existing background instance.
- The command finds the data folder from `ORGLET_USER_DATA`, then `ORGLET_DATA_DIR` (what a source run uses), then the usual place for the app. The Windows shim sets `ORGLET_USER_DATA` for you.
- On start, a copy of Orglet reads the shim's executable and data folder back and rewrites the shim only when both are its own. A Setup install owns every `app-x.y.z\Orglet.exe` in its folder, so the shim follows an update to a new version folder. An update or uninstall leaves a shim that starts another copy alone; only running Setup or a click in **Settings → About** takes it over.
- The command itself is the app's own executable running a small script (`resources/orglet-cli.cjs`) as Node, the same way VS Code ships `code`. It needs no separate Node install.

The automatic checks run every command against a packaged build, including a wrong token and a request outside the list, and check that `list` stays plain text when piped. Progress tests exercise the real pipe and tool journal, including legacy responses, early events, revision filtering, failed and unknown steps, disconnect cleanup and motion controls. Chat tests drive raw terminal input against a fake app and inspect the rendered terminal grid: multiline paste, command choices, queue previews and undo, immediate desktop opening while a turn is waiting, draft preservation after a delayed error, resize and leaving. They do not click **Add to PATH**, because that changes the user PATH of the machine running them.
