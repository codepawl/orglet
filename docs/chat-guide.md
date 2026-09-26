# In a chat

What you can do inside a chat once an orglet or crew is set up: attach files, type emoji, ask something on the side, forward a message, get reports, see what the orglet did and what it changed, open Details, put a request on a schedule, find an earlier message, and find what the app told you.

Part of the [user guide](user-guide.md). How the words in the chat are chosen and what is kept afterwards: [worker-actions.md](worker-actions.md).

## Attach files

An orglet reads only what you attach to **that** chat, or what is inside the working folder you granted it ([Permissions](permissions-and-learning.md#permissions)).

1. Click **+** next to the message box.
2. Pick **Files**, or **Folder** for up to 20 supported files from one folder (hidden and generated files are skipped, and the chat lists what was left out).
3. Write what you want done, then send.

Attached files sit as cards above your message; hover a card to remove it. This works the same in a chat that already has messages: the files you add go with your next message, and the chat keeps the files its earlier messages had, up to 20 in all; each message shows only the files sent with it, and all of them are listed under **Details → Sources**. Files and words you have not sent yet stay on that chat's message box when you open another chat and come back, until you send or remove them; each chat, and each orglet's or crew's new chat, keeps its own. They are kept while Orglet is open, not after a restart. To stop an orglet reading a file the chat already has, open it and choose **Revoke read access**. Click a card in the chat to open the file: text and code with line numbers, Markdown, CSV tables, JSON trees, images, video, audio and PDF pages. In the viewer you can edit a text or code file or mark up an image; saving adds a new version to the chat and leaves your file as it was ([Viewing and editing files](viewing-and-editing-files.md)).

What the orglet gets from each kind:

- **PDF:** the text of each page, pulled out on your computer. The PDF itself is not sent. A scanned PDF has no text to pull out, so the orglet says it cannot read it. So does a PDF with a password. Pictures and layout in a PDF are not included.
- **Images (PNG, JPEG, GIF, WebP, up to 5 MB):** shown to the orglet when its connection can see images. Claude, most OpenAI models, Claude Code and Codex can. When the connection cannot, the orglet tells you instead of guessing. SVG and BMP are never shown. [Which connections see images](capabilities.md#pdfs-and-images).
- **Video and audio:** preview only. The orglet is told they are there but cannot read them.

Text files are read as UTF-8, up to 256 KB each and 1 MB per chat. A PDF's text is held to the same 256 KB per file: a longer PDF is cut after the last page that fits, and the orglet is told where it stops. CSV, JSONL and Parquet files can also be checked locally under **Details → Sources**: schema, row counts, duplicate and missing IDs, and, for two files, an exact-match accuracy. Demo cannot analyze files; switch **Model** off Demo first.

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

Side threads are for single orglets. A crew chat and a group chat do not have them yet. Group chats you started by picking several orglets are listed in the sidebar under **Group chats**, newest first, so you can get back to one after opening another chat.

## Forward a message

You can pass a message on to another orglet, a crew or another chat, the way you forward one in Messenger or WhatsApp. It works for your own messages and for an orglet's answers.

1. Hover the message and click **Forward** (the arrow next to Reply).
2. Tick where it should go: recent chats, orglets or crews. Type to narrow the list. You can pick up to five.
3. If the message had files, tick the ones to send along. Files you leave unticked go by name only.
4. Add a note if you like, then click **Send** (Ctrl+Enter in the note works too).

Each chat you picked gets the message as yours, so the orglet or crew there answers it, the same as if you had typed it. It shows as a grey bubble headed **Forwarded from Researcher** (click it to open the chat it came from), with your note under it. It costs what any message there costs and uses that chat's own permissions and limit.

A few things to know:

- A chat that is working right now, or whose orglets are not connected, cannot be picked until it is ready. A message arriving would otherwise stop the work there.
- A file you tick becomes a file of that chat, as if you had attached it there yourself. Revoking it in one chat does not revoke it in the other.
- A side thread only uses its main chat's files, so files cannot be sent along into one.
- `@` names inside a forwarded message do not choose who answers in a crew or group chat; only `@` names in your note do.
- Forwarding a forwarded message passes on the original, still labelled with where it first came from.

Orglets never forward anything themselves. How it works: [team-chat.md](team-chat.md#forwarding).

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

Commands the orglet ran in the latest turn are summed in **Details**, under the goal it worked from, last command first: "Last command exited 0 · earlier: 1 failed." A turn that ran a failing test, fixed the code and ran it again reads that way instead of "1 exited 0, 1 failed". Their full output is in the same panel. Exit 0 means that command finished; it does not mean the task passed.

### When the orglet runs out of steps

Each reply gets a fixed number of steps, where a step is one thing the orglet does, such as a search or a page read: from 6 for a chat with only its files up to 40 for one with a working folder. Web search and MCP tools get 24. Two steps before the end the orglet stops looking things up and writes its best answer from what it has. That answer then reads **Ran out of steps before finishing; this is what it got done.** In a chat with one orglet and no working folder, **Continue** sits next to it while it is the latest message. Continue sends "Continue from where you stopped." as your next message, and the orglet picks up with everything it already searched and read, so it does not read the same pages again. Every step still counts against the chat's spending limit. Crews have no Continue: the crew's answer names the member that ran out of steps instead.

## Diffs

When a run changed files in its working copy, a line under the answer says **Files changed: 3 · +42 −7**; moves and deletions get their own count, as in **Files changed: 6 · 5 moved or renamed · 1 deleted**. Click it for the diff: each changed file with its hunks, the old and new line numbers side by side, and removed and added lines in colour. In a folder that is not a Git repository the diff lists what happened to each file (new, changed, moved, renamed, deleted) and the folders created or removed, without lines. In a crew turn each member has its own line, because each works in its own copy.

The diff has line-by-line hunks only when the working folder is a Git repository, because the comparison is against the snapshot the copy started from; a plain folder says so instead. Keeping your current files and file conflicts are handled in **Details → Files and processes**. Details: [worker-actions.md](worker-actions.md#where-a-diff-lives).

### Review before the folder changes

An orglet never edits your folder directly. It works in a private copy, and by default its changes wait for you when it finishes:

1. The answer arrives as usual. The line under it reads **Files changed: 3 · +42 −7 · Not in your folder yet · Review**.
2. Click the line. The diff opens with **Discard changes** and **Apply** at the top.
3. To leave some files out, untick them in the list at the top of the diff. **Apply** then reads **Apply 2 of 3**.
4. Click **Apply**. The line then ends with **Applied**, or **Applied, 1 skipped**. **Discard changes** asks once, then the line ends with **Discarded, folder unchanged**.

Nothing reaches your folder until you click **Apply**. If you edited, moved or deleted a file yourself in the meantime, Apply stops at that file instead of overwriting it; settle it in **Details → Files and processes** with **Keep current files**.

Changes that wait are kept when you close the app. If you send another message before deciding, the orglet goes on in the same copy, so it sees what it did last turn. The earlier line then says **Carried into the next turn**, and the new answer's line covers the changes from both turns.

To have changes applied as soon as a run finishes, turn off **Review before applying** under the working folder, in the chat's **Details → Tool permissions** or the orglet's **Permissions** tab. The switch appears once the folder level allows editing. A side thread follows its main chat. Crews and group chats apply each orglet's changes as it finishes, because the next orglet in the turn works from those files, so their switch is off and cannot be changed. A schedule's runs also apply as they finish, since nobody is there to review them.

## Details

**Details** at the top of a chat opens the panel that holds everything the chat does not show inline:

- **Tool permissions** and the working folder for this chat ([Permissions](permissions-and-learning.md#permissions)).
- Cost so far, and for each internal job (a crew's plan, members and combining step) its status, retry and cancel. **Pause after this step** and **Continue from checkpoint** let you stop a long run and pick it up later; **Retry with current settings** starts a new run for what did not finish.
- **What happened**: the run's activity, the sources it cited, and **Loaded context**, the exact instructions, skill, knowledge and memory the run started with.
- **Chat decisions**: questions an orglet paused to ask you, with your answers. **Turn goal**: how an orglet understood the request, its assumptions, and the checks it planned (planned is not done).
- **Files and processes**: every attempt that changed files, with its outcome, its commands and their output. An attempt whose outcome is unknown after a crash or cancel blocks the chat until you check your files and choose **Keep current files**. See [Reviewing an interrupted attempt](agent-tools.md#reviewing-an-interrupted-attempt).

If the app closes while an orglet works, that turn stops where it was and is not sent again on its own. The chat says so on that turn ("This turn stopped partway because the app closed."), also after you have sent newer messages; check the cost and send the message again if you still need the answer.
- **Messages between workers** and **Reactions** in a crew or group chat, and export of any job's report.

## Schedules

A schedule sends the same request to an orglet or crew daily or weekly, while Orglet is open.

1. Click **Schedules** in the footer, then **New schedule**.
2. Name it, write the repeating brief, choose the orglet or crew, the frequency, the weekday and run time, the time zone, and a limit per run. Under **Limits & permissions**, turn on **Read and search the web** if each run should look things up, and set **Browser** to **Read pages** if it should open pages in Orglet's browser. Attach sources if the request needs them.
3. Choose **Enable schedule**. Enabling is your approval for that content and connection; a later change to the orglet, crew, model or sources turns the schedule off until you review and save it again.

Orglet checks schedules only while it is open. If the computer was off or asleep at the time, the missed run becomes one **Run once to catch up** choice, or **Skip missed run**; missed days are never queued up, and the next time stays on the calendar. Scheduled runs cannot write memory, react, or propose app changes, since nobody is watching. There are at most 100 schedules. Policy detail: [routines.md](routines.md).

Each run is its own chat, apart from the orglet's main chat. You find it three ways:

- **In the sidebar**, under the orglet or crew it ran for, next to the side threads: one row per schedule, named after it with a small calendar mark, showing its newest run and that run's status mark. The row's menu opens the schedule, archives the run or deletes it.
- **In Notifications.** When a run finishes, stops with a problem or waits for you, a message names the schedule ("Daily standup note is ready", "Daily standup note needs you") with **Open**, and stays unread in Notifications until you look. Runs that come back with a restored backup are history and send no message.
- **In Schedules**, where each card has **Open latest run**.

To try a schedule without waiting for its time, click **Run now** (the play button) on its card. It runs the same way a scheduled run does, with the same checks, and opens the run; the next scheduled time does not move. A schedule that is switched off, changed since you saved it, or still busy with its previous run does not start, and Schedules says why. A switched-off schedule's button stays greyed out.

The run's header shows the schedule's name with the same calendar mark, and the top of the chat says which schedule it is and who ran it, with **Open schedule**.

You can also ask an orglet, in its chat, to schedule something ("run this every Monday at 9"); it answers with a proposal card, and the schedule it creates is saved switched off until you enable it ([App-change proposals](permissions-and-learning.md#app-change-proposals)).

## What is running

Click **Running** in the footer to see every turn that is working or waiting, across all chats. The button shows a count while anything runs or waits its turn.

The list has up to three parts:

- **Running**: each orglet at work, with its face, its name, the chat or crew it works for, what it is doing now ("Reading invoice.xlsx…"), how long it has run, what it has cost so far, and its provider. A cost Orglet does not know yet says **Cost unknown** (a harness before it reports, or a custom connection with no price), and one with a request of unknown cost says **At least**, rather than showing $0.
- **Queued**: turns that have not started, with the reason and their place in line: "Waiting for Claude Code · 2 ahead" when the provider already has as many requests as **Settings → requests at once per provider** allows, "Waiting for a crew slot" or "Waiting for results from Lan" inside a crew (in a crew that works one member after another, each member waits for the results of the ones before it), "Waiting for its turn to answer" in a group chat, and "Waiting for budget" for a chat that stopped at its **Limit per task**.
- **Waiting for you**: chats stopped at a checkpoint, including a crew paused at the end of its work hours, and chats waiting for your answer: an MCP tool the orglet wants to use ("Waiting for you to allow the MCP tool: search · Docs") or a question it asked. Answer in the chat and the same run goes on.

Each row has its controls on the right:

1. **Pause** (after the current step) and **Stop** for a running turn. Stopping a queued turn cancels it before it starts; nothing is sent and nothing is charged.
2. **Resume** for a paused chat, or for one waiting for budget after you raise its limit.
3. **Open chat** to go to that conversation. A chat waiting for your answer offers only this, because the answer card is in the chat.

The controls act on the whole turn of that chat. In a crew, stopping one member's row stops the crew's turn, the same as **Stop** in the chat. The list follows the sidebar: a chat whose mark shows it working or waiting is always in it. With nothing running, the view says so in one line. How the queue is kept: [technical guide](technical-guide.md#what-is-running-and-the-queue).

## Search

Search finds any message in any chat, not only how a chat started.

1. Press **Ctrl+K**, or click the magnifier at the top of the sidebar.
2. Type a few words. Case and accents do not matter, so "hop dong" finds "hợp đồng", and a word can be the start of a longer one, so "inv" finds "invoice".
3. Move with the arrow keys and press Enter, or click a result.

It looks through every message you sent, every answer and report an orglet wrote, side threads, scheduled chats, chat names, and the names of your orglets and crews. With nothing typed, it lists your chats, newest first.

- **Orglets and crews** whose name matches come first. Choosing one opens its chat.
- **Chats** come next, one row each: the orglet's or crew's face, the chat's name (its title, or the orglet's or crew's name), whose chat it is when the name is a title, when the message was written, and a short piece of that message after **You** or the orglet's name, with your words in bold. Choosing it opens the chat scrolled to that message. The piece is plain text, the way the chat reads, without Markdown marks; a message you forwarded is its note and the forwarded words.

A chat where your words appear together, in the order you typed them, comes before one where they appear apart. Within each of those, the chat with the newest matching message comes first, and each chat shows its best message once.

Archived chats are found too; deleted chats are not. A crew's chat is found by its combined answer, not by the reports its members handed in. Search runs on this computer only. After an update from a version that searched only first messages, Orglet adds your existing chats in the background once it has started; until then the search window says a few results may be missing. How it works: [technical guide](technical-guide.md#search).

## Notifications

Every message the app shows as a passing toast is also kept: click **Notifications** in the footer. A dot and a count on the button mean new ones since you last looked. A confirmation of something you just did (saved, created, copied, archived) is listed but does not count, since you saw it as it happened. Problems count, and so does news that arrived on its own: an answer in a side thread, a schedule's run that finished or needs you, a downloaded update, a change an orglet applied by itself.

What counts as new since you last looked comes first, under **New**; the rest follows newest first, grouped by day. Filter it by **All**, **Problems**, **Done** or **Info**. Each row says what happened and what it was about (the setting, the orglet, the chat, the command); a run of identical notices is one row with a count. A row about a chat, such as a side thread's answer or a schedule's run, opens that chat when you click it, as long as the chat still exists. Every app change an orglet makes through a proposal is announced here too. **Clear all** empties the list.

### While Orglet is in the background

When you are in another app and a chat finishes, stops with a problem or waits for you, Orglet also shows a notification from the system: the orglet's, crew's or schedule's name and a word or two ("Done", "Needs you", "Needs attention"). It never shows the answer, your message or a file name, since it appears on your desktop. Clicking it brings Orglet forward on that chat. It covers every chat: main chats, side threads, crews, group chats and schedule runs. With Orglet in front, the sidebar marks and the messages above already tell you, so nothing is shown.

Turn it off in **Settings → Chat → Notify me when a chat finishes**. It is on by default. How they look, whether they make a sound, and whether they show at all follow the system's own notification settings for Orglet.

Notifications are notes about this machine's session, stored in the window, not in the workspace: they are not in a backup and do not follow you to another computer. The **Schedules** and **Library** buttons in the footer show the same dot when something there waits for you: a missed run, or knowledge to review.
