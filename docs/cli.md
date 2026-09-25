# The orglet command

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/orglets/cli-dark.png">
  <img src="images/orglets/cli-light.png" alt="" width="112" height="112" align="right">
</picture>

`orglet` lets you talk to your orglets and crews from a terminal. It is a companion to the running app, like VS Code's `code` command, not a separate agent. Keys, chats, files and the sandbox stay in the app. The command only sends requests to it.

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

It cannot grant a folder, touch API keys or connections, change settings or permissions, back up, archive or delete anything. Those stay in the window, where you can see what you are agreeing to. The app refuses any other request, even one that carries the right token.

## Install

### Windows

1. Install Orglet with Setup.exe.
2. Open a new terminal and run `orglet status`.

Setup writes a small `orglet.cmd` into `%LOCALAPPDATA%\Orglet\bin` and adds that folder to your own user PATH (not the system one), the way VS Code's installer does. Each update and every start of the app rewrite that file, so the command keeps working after an update. A terminal that was already open does not see the new PATH; open a new one.

**Settings → About → Remove from PATH** deletes the file and the PATH entry, and later updates leave it off. **Add to PATH** there puts it back. Uninstalling Orglet removes both the file and the PATH entry.

Unpacked the ZIP instead of running Setup? Nothing is added by itself: click **Add to PATH** in **Settings → About**.

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

1. The first line shows your orglets' faces. Under it is a list of your orglets and crews, each with its face in its own colour. A crew shows its members side by side.
2. Move through the list with the Up and Down keys, or type part of a name to narrow it. Case and Vietnamese accents do not matter: `ke` finds "Kế toán". Press Enter to open the highlighted chat, or Tab to fill in its name.
3. The chat opens with the orglet's face, its name, and its provider and model. Type a message and press Enter.
4. While the orglet works, its face waits beside you: it blinks and glances around, with the seconds so far. When the answer lands, it prints under the orglet's name with a happy face.

`orglet chat --to Researcher` skips the list and opens that chat. If the name fits several chats, or none, the list opens with it typed in.

A message you send is the same turn the app's message box makes, with the same consent and cost limit as [send](#send). The answer is also in the app.

Answers are wrapped to the width of the terminal. Headings, **bold**, `code`, lists and quotes are shown as such, links print as their text followed by the address, and code blocks are kept exactly as written, indented. A crew prints each member's answer under that member's name and colour, and then the lead's.

### Keys

| Key | What it does |
|---|---|
| Enter | Sends the message, or opens the chat highlighted in the list |
| Up, Down | In the list, move the highlight. In a chat, go back through the messages you sent. |
| Tab | Completes a command or a name after `/to` |
| Esc | In the list you opened with `/to`, goes back to the chat you were in |
| Ctrl+C | While an answer is on its way, stops waiting. The orglet keeps working in the app; `/read` shows the answer later. On an empty line, leaves. |
| Ctrl+D | Leaves |

### Commands in the chat

| Command | What it does |
|---|---|
| `/to <name>` | Switches to another orglet or crew. Without a name, it opens the list. |
| `/list` | Lists orglets and crews |
| `/read` | Shows the latest answer in this chat again, including one you stopped waiting for |
| `/open` | Brings the app forward on this chat |
| `/clear` | Clears the screen |
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
- A request is one line of JSON and the answer is one line back. The app checks each request against a fixed list of five operations and refuses everything else, lines over 1 MB, and more than eight commands at once.
- `send` goes through the same steps as the message box: attached files are imported by the app, then the chat's live conversation takes the message or a new one starts. The app then checks the chat until the turn stops.
- Chat in the terminal makes only the requests `list`, `send`, `read` and `open` make; the pipe has no operation of its own for it. Stopping the wait with Ctrl+C closes the connection, which ends the app's wait and leaves the turn running.
- The answers to `list`, `status`, `send` and `read` carry each orglet's colour as `#rrggbb`: the one picked in the app, or the colour of the face the app chose for it by name. The command draws the faces from these fields and falls back to grey when they are missing.
- If nothing answers, the command starts Orglet on the same data folder and tries again for up to 30 seconds.
- The command finds the data folder from `ORGLET_USER_DATA`, then `ORGLET_DATA_DIR` (what a source run uses), then the usual place for the app. The Windows shim sets `ORGLET_USER_DATA` for you.
- The command itself is the app's own executable running a small script (`resources/orglet-cli.cjs`) as Node, the same way VS Code ships `code`. It needs no separate Node install.

The automatic checks run every command against a packaged build, including a wrong token and a request outside the list, and check that `list` stays plain text when piped. The chat itself is tested with a scripted session against a fake app; the checks do not type into a real terminal window. They do not click **Add to PATH**, because that changes the user PATH of the machine running them.
