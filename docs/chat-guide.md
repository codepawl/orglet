# In a chat

What you can do inside a chat once an orglet or crew is set up: attach files, type emoji, ask something on the side, get reports, see what the orglet did and what it changed, open Details, put a request on a schedule, and find what the app told you.

Part of the [user guide](user-guide.md). How the words in the chat are chosen and what is kept afterwards: [worker-actions.md](worker-actions.md).

## Attach files

An orglet reads only what you attach to **that** chat, or what is inside the working folder you granted it ([Permissions](permissions-and-learning.md#permissions)).

1. Click **+** next to the message box.
2. Pick **Files**, or **Folder** for up to 20 supported files from one folder (hidden and generated files are skipped, and the chat lists what was left out).
3. Write what you want done, then send.

Attached files sit as cards above your message; hover a card to remove it. This works the same in a chat that already has messages: the files you add go with your next message, and the chat keeps the files its earlier messages had, up to 20 in all; each message shows only the files sent with it, and all of them are listed under **Details → Sources**. To stop an orglet reading a file the chat already has, open it and choose **Revoke read access**. Click a card in the chat to open the file: text and code with line numbers, Markdown, CSV tables, JSON trees, images, video, audio and PDF pages. Images, video, audio and PDF are preview-only for now: the orglet is told they exist but cannot read them.

Text files are read as UTF-8, up to 256 KB each and 1 MB per chat. CSV, JSONL and Parquet files can also be checked locally under **Details → Sources**: schema, row counts, duplicate and missing IDs, and, for two files, an exact-match accuracy. Demo cannot analyze files; switch **Model** off Demo first.

## Emoji

Type a colon and at least two letters of an emoji's name, such as `:sk`, and a small menu lists the emoji that fit. Arrow keys move through it, Enter or Tab inserts the one highlighted, Escape closes it. A full name such as `:skull:` becomes 💀 as soon as you type the closing colon.

The names are GitHub's, which Slack and Discord mostly share. The menu only opens at the start of the message or after a space or bracket, and only when an emoji matches, so times like `10:30` and links stay as you typed them.

## Side threads

Each orglet has one main chat. Clicking the orglet always opens it. When you want to ask something on the side without mixing it into the main chat, or while the orglet is still busy there, send it in a side thread.

1. Type the message in the orglet's main chat.
2. Press **Ctrl+Shift+Enter** (Cmd+Shift+Enter on macOS), or click the small arrow next to Send and choose **Send in a new thread**.
3. You stay in the main chat. A short message says the side thread started; click **Open** to go there, or open it later.

Side threads are listed under the orglet in the sidebar, newest first, each with its own status mark. In the **Send to** picker's recent chats, a side thread says "side thread · Researcher" beside its name, so files go there only when you pick it; choosing the orglet itself goes to its main chat. The name is the orglet's title for it, or your first message. Each one has a menu to rename, archive or delete it, like any chat. When a side thread answers while you are somewhere else, a message says so with **Open**, and it is also kept in Notifications.

What a side thread knows and can do:

- Its first answer reads the last few turns of the main chat (up to six), so you do not have to repeat the context. After that, it only reads its own messages.
- It carries the files of the message you sent it with.
- It has the main chat's permissions: the same switches, the same working folder at the same level, and the same MCP tools allowed. It never gets more. If you turn something off in the main chat, its side threads lose it at once. A side thread that was working with a switch or the folder you turned off stops; an MCP tool you took back asks again the next time it is used. To change permissions, change them in the main chat. An MCP tool that asks in a side thread can only be allowed once there.
- It counts as its own chat for the **Limit per task**, and it shares the orglet's connection and slots with the main chat.

To use an answer in the main chat, click **Bring into main chat** (the return arrow under the answer). The answer appears in the main chat as a quote, marked with the side thread it came from. Nothing runs when you do this; the orglet reads the quote with the next message you send in the main chat.

Side threads are for single orglets. A crew chat and a group chat do not have them yet.

## Reports as documents

Ask for a report and it arrives as a card, not a wall of text. Open it to read it; **Copy** puts it on the clipboard and **Download** saves it. Whether copy and download give plain text or Markdown is set in **Settings → Chat**. A download of one answer carries its message ID, reply link and reactions; to move a whole conversation, use a backup.

## What the orglet did

While an orglet works, a tab docks onto the message box: the faces of the orglets at work, one sentence for what they are doing now ("Researcher is reading invoice.xlsx…"), and above it the last step that finished. What the tab can say depends on how the orglet runs, because the chat only names what Orglet itself saw:

| Connection | What the chat can name |
|---|---|
| An API key, Ollama, OpenCode, or any orglet with a working folder | Every read, search, edit, command, web page and data check, exactly |
| Claude Code without a working folder | The file it read and the pattern it searched, from the CLI's own stream |
| Codex without a working folder | That it is thinking, then writing |
| Cursor Agent | Working, then writing |

Afterwards the answer keeps a folded line of the steps ("Read 2 files · Searched 1 time"); open it for the targets. Above it, **Memories used: N** opens the memories the orglet was given ([Memory](memory.md)). An orglet's thinking shows only inside the folded control, only when the model shares it, and is not saved.

Commands the orglet ran are summed under the answer ("Commands: 2 exit 0, 1 failed"), with their full output under **Details**. Exit 0 means that command finished; it does not mean the task passed.

## Diffs

When a run changed files in its working copy, a line under the answer says **Files changed: 3 · +42 −7**. Click it for a read-only diff: each changed file with its hunks, the old and new line numbers side by side, and removed and added lines in colour. In a crew turn each member has its own line, because each works in its own copy.

The diff exists only when the working folder is a Git repository, because the comparison is against the snapshot the copy started from; a plain folder says so instead. Applying the changes to your folder, keeping your current files, and file conflicts are handled in **Details → Files and processes**, not in the viewer. Details: [worker-actions.md](worker-actions.md#where-a-diff-lives).

## Details

**Details** at the top of a chat opens the panel that holds everything the chat does not show inline:

- **Tool permissions** and the working folder for this chat ([Permissions](permissions-and-learning.md#permissions)).
- Cost so far, and for each internal job (a crew's plan, members and combining step) its status, retry and cancel. **Pause after this step** and **Continue from checkpoint** let you stop a long run and pick it up later; **Retry with current settings** starts a new run for what did not finish.
- **What happened**: the run's activity, the sources it cited, and **Loaded context**, the exact instructions, skill, knowledge and memory the run started with.
- **Chat decisions**: questions an orglet paused to ask you, with your answers. **Turn goal**: how an orglet understood the request, its assumptions, and the checks it planned (planned is not done).
- **Files and processes**: every attempt that changed files, with its outcome, its commands and their output. An attempt whose outcome is unknown after a crash or cancel blocks the chat until you check your files and choose **Keep current files**. See [Reviewing an interrupted attempt](agent-tools.md#reviewing-an-interrupted-attempt).
- **Messages between workers** and **Reactions** in a crew or group chat, and export of any job's report.

## Schedules

A schedule sends the same request to an orglet or crew daily or weekly, while Orglet is open.

1. Click **Schedules** in the footer, then **New schedule**.
2. Name it, write the repeating brief, choose the orglet or crew, the frequency, the weekday and run time, the time zone, and a limit per run. Attach sources if the request needs them.
3. Choose **Enable schedule**. Enabling is your approval for that content and connection; a later change to the orglet, crew, model or sources turns the schedule off until you review and save it again.

Orglet checks schedules only while it is open. If the computer was off or asleep at the time, the missed run becomes one **Run once to catch up** choice, or **Skip missed run**; missed days are never queued up, and the next time stays on the calendar. Scheduled runs cannot write memory, react, or propose app changes, since nobody is watching. There are at most 100 schedules. Policy detail: [routines.md](routines.md).

You can also ask an orglet, in its chat, to schedule something ("run this every Monday at 9"); it answers with a proposal card, and the schedule it creates is saved switched off until you enable it ([App-change proposals](permissions-and-learning.md#app-change-proposals)).

## What is running

Click **Running** in the footer to see every turn that is working or waiting, across all chats. The button shows a count while anything runs or waits its turn.

The list has up to three parts:

- **Running**: each orglet at work, with its face, its name, the chat or crew it works for, what it is doing now ("Reading invoice.xlsx…"), how long it has run, what it has cost so far, and its provider. A cost Orglet does not know yet says **Cost unknown** (a harness before it reports, or a custom connection with no price), and one with a request of unknown cost says **At least**, rather than showing $0.
- **Queued**: turns that have not started, with the reason and their place in line: "Waiting for Claude Code · 2 ahead" when the provider already has as many requests as **Settings → requests at once per provider** allows, "Waiting for a crew slot" or "Waiting for results from Lan" inside a crew, "Waiting for its turn to answer" in a group chat, and "Waiting for budget" for a chat that stopped at its **Limit per task**.
- **Waiting for you**: chats stopped at a checkpoint, including a crew paused at the end of its work hours, and chats waiting for your answer: an MCP tool the orglet wants to use ("Waiting for you to allow the MCP tool: search · Docs") or a question it asked. Answer in the chat and the same run goes on.

Each row has its controls on the right:

1. **Pause** (after the current step) and **Stop** for a running turn. Stopping a queued turn cancels it before it starts; nothing is sent and nothing is charged.
2. **Resume** for a paused chat, or for one waiting for budget after you raise its limit.
3. **Open chat** to go to that conversation. A chat waiting for your answer offers only this, because the answer card is in the chat.

The controls act on the whole turn of that chat. In a crew, stopping one member's row stops the crew's turn, the same as **Stop** in the chat. The list follows the sidebar: a chat whose mark shows it working or waiting is always in it. With nothing running, the view says so in one line. How the queue is kept: [technical guide](technical-guide.md#what-is-running-and-the-queue).

## Notifications

Every message the app shows as a passing toast is also kept: click **Notifications** in the footer. A dot and a count on the button mean new ones since you last looked. A confirmation of something you just did (saved, created, copied, archived) is listed but does not count, since you saw it as it happened. Problems count, and so does news that arrived on its own: an answer in a side thread, a downloaded update, a change an orglet applied by itself.

The list is newest first, grouped by day, with new rows marked. Filter it by **All**, **Problems**, **Done** or **Info**. Each row says what happened and what it was about (the setting, the orglet, the chat, the command); a run of identical notices is one row with a count. Every app change an orglet makes through a proposal is announced here too. **Clear all** empties the list.

Notifications are notes about this machine's session, stored in the window, not in the workspace: they are not in a backup and do not follow you to another computer. The **Schedules** and **Library** buttons in the footer show the same dot when something there waits for you: a missed run, or knowledge to review.
