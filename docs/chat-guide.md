# In a chat

What you can do inside a chat once an orglet or channel is set up: keep several chats at hand and switch what you see of one, attach files, type emoji, keep typing from the keyboard, see how much of a plan and of the context is used, ask something on the side, forward a message, get reports, see what the orglet did and what it changed, open Details, put a request on a schedule, find an earlier message, and find what the app told you.

Part of the [user guide](user-guide.md). How the words in the chat are chosen and what is kept afterwards: [worker-actions.md](worker-actions.md).

In an orglet's chat, the model picker in the row under the message box shows the selected model's name. Open it to choose another model for that orglet. Each row shows the maker's logo and the model's name with its version, such as Opus 5.5, as the CLI or provider reports it. When the version is not known, the row shows the short name, such as Opus.

The row marked **Default** is the model that runs when you have not picked one. Choosing it saves no model, so the orglet follows the CLI if its default changes later. The newest model of each family is listed first. Older ones, and models only reachable by their full ID, are under **More models**. The same list appears in the orglet's settings under **Model**, where you can still type any model ID.

## The area rail and the sidebar

Orglet's shell follows Discord's. A narrow **area rail** at the far left picks an area, the **sidebar** beside it lists that area, and the main card shows what you picked. The tabs at the top of a chat pick what you see of it: the messages, its files, what it changed, its schedules or its memory.

**The area rail.** At the very top, two arrows go back and forward along the places you have been (also Alt+Left and Alt+Right, and the mouse's back and forward buttons). Below them: **Home**, **Activity**, **Library** and **Schedules**, a short divider, a tile for each of your spaces, then a **+** that makes a space. Each button shows its name beside it while the pointer is on it. The open area's icon is filled and the others are outlines, and a dot on a button's corner says something waits there: blue when it waits for you, grey when it is only news. Home, each space and Activity are areas, so the sidebar changes with them. Activity, Library and Schedules share one layout: the sidebar lists the page's parts, and the main panel shows a centred column with no title row or tabs of its own. Library and Schedules open as a page in the main panel (a schedule, a skill or a note is made and edited in a dialog over that page). **New schedule** is in the sidebar, above the list; the Library's buttons are at the top of the main panel. with the rail still beside them and the sidebar listing the page's own rows (Skills and Knowledge, or your schedules); picking a chat or an area, or Esc, takes you back. The area you left open comes back when Orglet starts. Folding the sidebar (the button in its head) leaves only the rail. With the sidebar folded, the pointer over the rail shows it over the chat for a look, listing the tile the pointer is on, and it goes when the pointer leaves; a click on any tile opens it for good, and the tile of the area already on screen only opens it. In a window narrower than 780 px the sidebar lies over the chat, beside the rail, until you pick something. The **Home** button always lands on a chat: the DM you had open, else the orglet you last wrote to.

**You, at the bottom of the rail.** Your face opens a menu with your account (or Sign in), **Settings**, **Usage**, **Check for updates** and **Exit Orglet**. The other settings pages are inside Settings. Rest the pointer on it for a few words on what Orglet is doing (what is running, or whether you are signed in to a CodePawl account). A dot says whether any connection can run a model, and a ready update shows its restart button above your face.

**Home.** Under the search box ("Find or start a conversation") are two rows: **Add orglet** opens a dialog where you make an orglet or bring an archived one back, and **Marketplace** opens the marketplace as a page. **Direct messages** lists your orglets, each with its side threads and schedule runs under it. An orglet's row opens your DM with it. An orglet is yours to make, not a friend to find, so nothing here is called a friend:

- **All** lists every orglet, **Working** only the ones with a run going right now. Each row has its face, its name, its description (or **Working**), a message button and a menu to edit, archive or delete it. The box above searches names and descriptions, ignoring case and accents.
- **Marketplace** has a **Discover** tab for ready-made CodePawl orglets and crews under CC BY 4.0 and a **My listings** tab for publishing status. Discover shows which templates you have added; **Add another copy** creates a separate friend and keeps your edits. The catalog opens from this computer first and refreshes online. Saved pages stay usable while refreshing, and a late response keeps the page you chose. Report and reviewer actions are in each listing's options menu. A connection suggestion is used only when ready, otherwise the same default as creating an orglet is used and a notice tells you. A friend's settings and Discover offer updates explicitly, with a side-by-side comparison for customized copies. [Marketplace](marketplace-design.md).
- **Add orglet** makes an orglet from a name: type it, choose **Create orglet**, and the new-orglet dialog opens with the name filled in. Under **Other ways to add an orglet** you can bring back an archived orglet, add a ready-made group (Research Review, Writing Desk, Data Check: each adds its orglets and a channel, on Demo until you connect a model; its faces sit beside its name, and pointing at them says who they are) or import a template file.

**Channels.** A channel is made in a space: a space's **+**, or a category's **+** there. Home lists your direct messages only. A channel that arrives outside every space, such as one a ready-made group brought or one left after you delete a space, is put into a space named **Channels**, with the orglets it had. A channel's category is set in its settings, under **Category**. Each channel is a **#** and its name with its status mark; the rest is under [Channels](orglets-and-crews.md#channels). Open channels show a **member column** at the right with you first, then each orglet's face and whether it is working, and the lead marked when the lead splits the work. Click an orglet there for its profile card: its face, what it runs on, what it does, and **Message** and **Edit**. Right-click it for a menu with Profile, Message, Edit and **Remove from channel**. Removing asks first and only takes the orglet out of that channel: it stays your friend and its messages stay. The lead and the last orglet in a channel cannot be removed. The header's member button hides or shows the column, Details takes its place while open, and a window narrower than 1100 px has no column.

**Spaces.** A space groups the channels of one piece of work with the orglets that do it, the way a Discord server does. Make one from the rail's **+**: give it a name, tick its orglets, and add categories if you want them. Each space gets a tile on the rail, filled with a gradient of its own, with its name beside it while the pointer is on it, and its sidebar lists its channels under their categories. A channel in a space has every orglet of the space, or of its category, unless you give it its own list under **Channel settings → Members**. A channel with its own list shows a lock. Take an orglet out of the space and it leaves every channel in it. Its messages stay, and it stays your friend. A space holds categories and channels, and a category holds channels. The **+** beside the space's name makes either: **Create channel** or **Create category**. Drag a channel onto another category to move it there, or onto another channel to take the place before it. Drag a category by its name to move it among the categories. The order you leave is kept. A space can also set what a new channel starts with, under **Space settings → Permissions**.

**Folders of spaces.** Spaces can share a folder on the rail, the way Discord folds servers. Right-click a space's tile and choose **Move to a new folder**, or **Move to the folder …** for one you have. A folder is an outlined group with its own tile at the top: click it to close the folder to that one tile, and again to open it. A closed folder shows the count of what waits in its spaces. Right-click the folder's tile to **Close all folders** or **Remove the folder**, which leaves its spaces on the rail. **Take out of the folder** on a space's tile moves one space out. A folder has a name, which is its tooltip, and you can change it under **Space settings → Folder**: spaces with the same folder name share a folder.

**Activity.** Four views, chosen in the sidebar:

| View | What it holds |
|---|---|
| **Needs you** | Runs stopped for a question or an approval, schedules that did not run, and notes waiting for review, each with the way to open it. |
| **Running** | Every run under way or in line, with pause, resume, stop and the chat it works for ([technical guide](technical-guide.md#what-is-running-and-the-queue)). |
| **Done** | Everything the app told you after its toast was gone, grouped by day, filtered by kind. Opening it marks the news as read. |
| **Saved** | Messages you saved with **Save for later** under a message. A row opens the chat at that message; the bookmark takes it off again. |

The Activity button on the rail carries what waits for you, in the accent, or the unread news.

**Marks.** Each chat row shows a face (or a **#**), the name and one mark:

| Mark | Meaning |
|---|---|
| A turning ring | The orglet is working. |
| A person on a tint | It needs you: a question, a step or an app change to allow, changes to review, or a paused turn. |
| A tick | A new answer you have not opened. |
| An exclamation mark | Something went wrong. |
| A dotted ring | Nothing new. |

A schedule's run has a calendar before its name. Hover a row to see whose chat it is.

**Open.** A chat is listed once: when you open a chat that has no row anywhere in the sidebar, for example an older run of a schedule found through search or a notification, it lands in **Open** at the top of Home. With nothing like that open, there is no **Open** section. To take a chat off **Open**, hover it and click **×**, or click it with the middle mouse button. This only takes it off the list. The chat and its messages stay, and it comes back when you open it again. When you close the chat you are in, the chat you used before it opens. A chat you archive or delete leaves the list. Orglet keeps the list when it restarts.

**The tabs at the top of a chat.** Beside the chat's name, a few tabs show the parts of that chat. When the chat is narrow, for example with **Details** open, they move to a line under the name. **Chat** is always first and is where every chat opens. The others appear only when the chat has something for them, with a count:

| Tab | What it shows |
|---|---|
| **Files** | The files attached to the chat. Click one to open it in the viewer. The data checks are here too ([Attach files](#attach-files)). |
| **Changes** | Every turn whose orglet changed files in a working folder, newest first. Click a line to see the changes, and apply or discard them while they wait for you ([what the orglet changed](worker-actions.md)). |
| **Schedules** | The schedules that run as this orglet or channel. Run one now, edit it or switch it off. |
| **Memory** | What this orglet or channel remembered from its chats. Edit, pin or delete a memory. |

With nothing but the messages, there are no tabs. Use the arrow keys to move between tabs once one has focus. Orglet remembers the tab each chat was on until it closes.

**Details** is remembered per chat while Orglet is open: a chat you had open with Details opens with Details again. The panel holds what is not a tab: who the chat is with, what it cost, its permissions, MCP, browser and desktop settings, and the working copies to recover. You can drag its edge. It never pushes the chat narrower than 480 px.

## Messages

Every message starts at the left: a face, the name and the time, then the text. Your own messages look the same, with **You** as the name. When the same person or orglet writes several messages within five minutes, only the first shows the face and name; point at a later one to see its time at the left.

Point at a message, or move to it with Tab, to see its buttons at its top right: copy and download for an answer, then **Reply**, **Forward** and **React**. Reactions show in a row under the message. Small faces at the end of that row show which orglets read up to here but have not answered yet.

## Attach files

An orglet reads only what you attach to **that** chat, or what is inside the working folder you granted it ([Permissions](permissions-and-learning.md#permissions)).

1. Click **+** under the message box, at the left.
2. Pick **Files**, or **Folder** for up to 20 supported files from one folder (hidden and generated files are skipped, and the chat lists what was left out).
3. Write what you want done, then send.

Attached files sit as cards above your message; hover a card to remove it. This works the same in a chat that already has messages: the files you add go with your next message, and the chat keeps the files its earlier messages had, up to 20 in all; each message shows only the files sent with it, and all of them are listed in the chat's **Files** tab. Files and words you have not sent yet stay on that chat's message box when you open another chat and come back, until you send or remove them; each chat, and each orglet's or channel's new chat, keeps its own. They are still there after Orglet restarts, for example to install an update, and Orglet opens the chat you were in when it closed; erasing chats, sources or everything in **Settings → Data** clears them. To stop an orglet reading a file the chat already has, open it and choose **Revoke read access**. Click a card in the chat to open the file: text and code with line numbers, Markdown, CSV tables, JSON trees, images, video, audio and PDF pages. In the viewer you can edit a text or code file, mark up an image, or mark up a PDF and type notes on it; saving adds a new version to the chat and leaves your file as it was ([Viewing and editing files](viewing-and-editing-files.md)).

What the orglet gets from each kind:

- **PDF:** the text of each page, pulled out on your computer. The PDF itself is not sent. A scanned PDF has no text to pull out, so the orglet says it cannot read it. So does a PDF with a password. Pictures and layout in a PDF are not included.
- **Images (PNG, JPEG, GIF, WebP, up to 5 MB):** shown to the orglet when its connection can see images. Claude, most OpenAI models, Claude Code and Codex can. When the connection cannot, the orglet tells you instead of guessing. SVG and BMP are never shown. [Which connections see images](capabilities.md#pdfs-and-images).
- **Video and audio:** preview only. The orglet is told they are there but cannot read them.

Text files are read as UTF-8, up to 256 KB each and 1 MB per chat. A PDF's text is held to the same 256 KB per file: a longer PDF is cut after the last page that fits, and the orglet is told where it stops. CSV, JSONL and Parquet files can also be checked on this computer under **Files → Check data**: rows, columns and empty cells, what each column holds (number, date or text) and its range, identical rows, negative numbers, cells that do not fit their column and dates that do not exist, each named by row number; with an ID column, repeated or missing IDs too. The result opens under the button when the check finishes. Comparing a file with an answer key and the run-log check are under **More checks**. Demo cannot analyze files; switch **Model** off Demo first.

## Emoji

Type a colon and at least two letters of an emoji's name, such as `:sk`, and a small menu lists the emoji that fit. Arrow keys move through it, Enter or Tab inserts the one highlighted, Escape closes it. A full name such as `:skull:` becomes 💀 as soon as you type the closing colon.

The names are GitHub's, which Slack and Discord mostly share. The menu only opens at the start of the message or after a space or bracket, and only when an emoji matches, so times like `10:30` and links stay as you typed them.

## Keyboard

- **Ctrl+Tab** goes back to the chat you used before this one. Keep **Ctrl** held and press **Tab** again to go further back; **Ctrl+Shift+Tab** goes the other way. Let go of **Ctrl** on the chat you want. **Ctrl+W** takes the chat you are in off **Open**. It never closes the Orglet window, and it does nothing in a chat that is not on **Open**, such as an orglet's own chat or a side thread. These keys do nothing while a dialog is open.
- After you send, the message box stays ready, so you can type the next message straight away. If a message cannot be sent, it comes back in the box, in front of anything you typed since.
- After you pick files or a folder with **+**, the cursor is back in the message box.
- Opening **Details** moves the keyboard into the panel. Its close button or **Escape** puts you back where you were.
- Closing Settings, a viewer or any other window with **Escape** puts you back on the button that opened it.

## Usage and context

Under the message box, at the right end of the row with the model picker, a small ring shows how close the chat is to a limit: the orglet's subscription plan (Claude Code or Codex) or the model's context window, whichever is closer. It stays grey until 80%, turns amber from 80%, and red at 100%.

Click the ring to see what it is made of:

- **Context window**: the model the orglet will answer with next, how many tokens its latest answer in this chat sent, out of how many that model holds ("304.3k / 1M (30%)"). Before the chat's first answer it shows the model's size with nothing used yet ("0 / 1M (0%)"). In a channel each orglet has its own line with its model. The popover keeps to the figures; how a long chat is trimmed is here: each message sends up to the last 10 turns word for word, and older turns are folded into a short summary.
- **Plan usage limits**: each allowance of the plan, with how much is used and when it resets, and which account it is. If Orglet could not read fresh numbers, for example because Claude Code's sign-in renews only when it runs, you see the last numbers with their time (**Figures as of 07:05**).
- **View details** opens **Settings → Harness**.

From 80% of a plan allowance, a line under that row says how much is used and when it resets. At 100% there is no line: the island on top of the message box says the plan ran out and when it resets (**Claude Code ran out · Resets Sat, 10/10, 9:00 AM**), and × hides it until that reset. If another account of the same app has room, the island offers it instead (**Use Work · 70% left**). Clicking it switches that app to the other account for every orglet, as **Settings → Harness** would. Nothing is sent until you send it.

In a channel, the ring follows the account closest to its limit among the orglets in the chat, and the details list each app.

The ring shows only what a provider reported. A model's size comes from its model list (OpenRouter, and Anthropic's Models API, which Claude Code's list reads with your sign-in) or from what Claude Code said on an earlier answer with that model; until one of them says, the line reads **Window size unknown**. Codex reports neither its context use nor its window, so a Codex chat's ring follows its plan. Nothing shows for Demo, Cursor Agent or Gemini CLI, which report neither a plan nor a window.

## Side threads

Each orglet has one main chat. Clicking the orglet always opens it. When you want to ask something on the side without mixing it into the main chat, or while the orglet is still busy there, send it in a side thread.

1. Type the message in the orglet's main chat.
2. Press **Ctrl+Shift+Enter** (Cmd+Shift+Enter on macOS), or click the small arrow in the row under the message box and choose **Send in a new thread**.
3. You stay in the main chat. A short message says the side thread started; click **Open** to see it, or open it later.

A side thread opens in the panel on the right, next to its main chat, so you can read both at once. It has its own message box at the bottom of the panel. Close it with the **×** at the top of the panel or Esc. The panel is the one **Details** uses: opening Details closes the thread, and opening a thread closes Details. In a narrow window, where there is no room for the panel, the thread opens in place of the main chat instead, with **Open main chat** at the top.

Side threads are listed under the orglet in the sidebar, newest first, each with its own status mark. In the **Send to** picker's recent chats, a side thread says "side thread · Researcher" beside its name, so files go there only when you pick it; choosing the orglet itself goes to its main chat. The name is the orglet's title for it, or your first message. Each one has a menu to rename, archive or delete it, like any chat. An archived one leaves the sidebar and waits in **Settings → Archive**. When a side thread answers while you are away from that orglet's chats, a message says so with **Open**, and it is also kept in Notifications, where one orglet's answers share one row ([Notifications](#notifications)).

What a side thread knows and can do:

- Its first answer reads the last few turns of the main chat (up to six), so you do not have to repeat the context. After that, it only reads its own messages.
- It carries the files of the message you sent it with.
- It has the main chat's permissions: the same switches, the same working folder at the same level, and the same MCP tools allowed. It never gets more. If you turn something off in the main chat, its side threads lose it at once. A side thread that was working with a switch or the folder you turned off stops; an MCP tool you took back asks again the next time it is used. To change permissions, change them in the main chat. An MCP tool that asks in a side thread can only be allowed once there.
- It counts as its own chat for the **Limit per task**, and it shares the orglet's connection and slots with the main chat.

To use an answer in the main chat, point at it and click **Bring into main chat** (the quote icon in its toolbar). The answer appears in the main chat as a quote, marked with the side thread it came from. Nothing runs when you do this; the orglet reads the quote with the next message you send in the main chat.

Side threads are for single orglets. A channel does not have them yet.

## Forward a message

You can pass a message on to another orglet, a channel or another chat, the way you forward one in Messenger or WhatsApp. It works for your own messages and for an orglet's answers.

1. Hover the message and click **Forward** (the arrow next to Reply).
2. Tick where it should go: recent chats, orglets or channels. Type to narrow the list. You can pick up to five.
3. If the message had files, tick the ones to send along. Files you leave unticked go by name only.
4. Add a note if you like, then click **Send** (Ctrl+Enter in the note works too).

Each chat you picked gets the message as yours, so the orglet or channel there answers it, the same as if you had typed it. It shows as a grey card headed **Forwarded from Researcher** (click it to open the chat it came from), with your note under it. It costs what any message there costs and uses that chat's own permissions and limit.

A few things to know:

- A chat that is working right now, or whose orglets are not connected, cannot be picked until it is ready. A message arriving would otherwise stop the work there.
- A file you tick becomes a file of that chat, as if you had attached it there yourself. Revoking it in one chat does not revoke it in the other.
- A side thread only uses its main chat's files, so files cannot be sent along into one.
- `@` names inside a forwarded message do not choose who answers in a channel; only `@` names in your note do.
- Forwarding a forwarded message passes on the original, still labelled with where it first came from.

Orglets never forward anything themselves. How it works: [team-chat.md](team-chat.md#forwarding).

## Reports as documents

Orglet saves chat answers up to 262,144 characters, including complete HTML or code documents, without cutting them. Structured report summaries still have a 16,000-character limit. HTML in a chat is text; it does not run inside Orglet.

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

While the orglet waits for you, for example on a card asking to click a button on a page, the line under its name in the chat says so ("Waiting for your OK…") and holds still, instead of the step it stopped on.

The chat stays on its newest message while you are there: new text, a card, a window resize or opening **Details** keep the end in view. Scroll up and it stays where you left it; scroll back to the last lines and it follows again. A card that needs you (an approval, a question, a failure or a blocked hand-in) is brought into view once when it appears if you were less than a screen up. Further up, the tab on the message box tells you instead. Sending a message always goes back to the end.

A message that got no answer keeps what happened to it after newer messages, on one line under the orglet's name: "This turn didn’t finish: …" with the error, "This turn was stopped before it answered.", "This turn stopped while it waited for you." Hover the line for a long error in full.

Commands the orglet ran in the latest turn are summed in **Details**, under the goal it worked from, last command first: "Last command exited 0 · earlier: 1 failed." A turn that ran a failing test, fixed the code and ran it again reads that way instead of "1 exited 0, 1 failed". Their full output is in the same panel. Exit 0 means that command finished; it does not mean the task passed.

### When the orglet runs out of steps

Each reply gets a fixed number of steps, where a step is one thing the orglet does, such as a search or a page read: from 6 for a chat with only its files, plus one for each attached file, up to 40 for one with a working folder. Web search and MCP tools get 24. When an orglet has used all its steps and is still working, it gets two more to stop looking things up and write its best answer from what it has. Only that answer reads **Ran out of steps before finishing; this is what it got done.** In a chat with one orglet and no working folder, **Continue** sits next to it while it is the latest message. Continue sends "Continue from where you stopped." as your next message, and the orglet picks up with everything it already searched and read, so it does not read the same pages again. Every step still counts against the chat's spending limit. Crews have no Continue: the crew's answer names the member that ran out of steps instead.

## Diffs

When a run changed files in its working copy, a line under the answer says **Changed 3 files · +42 −7** and ends with what happened to them: **Applied**, **Not in your folder yet**, or **Discarded, folder unchanged**. Moves and deletions get their own count, as in **Changed 6 files · 5 moved or renamed · 1 deleted**. Click it for the diff: each changed file with its hunks, the old and new line numbers side by side, and removed and added lines in colour. In a folder that is not a Git repository the diff lists what happened to each file (new, changed, moved, renamed, deleted) and the folders created or removed, without lines. In a channel turn each orglet has its own line, **Writer changed 1 file · +3 · Applied**, because each works in its own copy. A diff keeps opening after you change the folder's level; once you remove the folder or point the chat at another one, it says it can no longer be opened.

The diff has line-by-line hunks only when the working folder is a Git repository, because the comparison is against the snapshot the copy started from; a plain folder says so instead. Keeping your current files and file conflicts are handled in **Details → Files and processes**. Details: [worker-actions.md](worker-actions.md#where-a-diff-lives).

### Review before the folder changes

An orglet never edits your folder directly. It works in a private copy, and by default its changes wait for you when it finishes:

1. The answer arrives as usual. The line under it reads **Changed 3 files · +42 −7 · Not in your folder yet · Review**.
2. Click the line. The diff opens with **Discard changes** and **Apply** at the top.
3. To leave some files out, untick them in the list at the top of the diff. **Apply** then reads **Apply 2 of 3**. A new folder follows the files in it: untick its only file and the folder is not made either. A folder the orglet made empty on purpose has its own tick.
4. Click **Apply**. The line then ends with **Applied**, or **Applied, 1 skipped**. **Discard changes** asks once, then the line ends with **Discarded, folder unchanged**.

Nothing reaches your folder until you click **Apply**. If you edited, moved or deleted a file yourself in the meantime, Apply stops at that file instead of overwriting it; settle it in **Details → Files and processes** with **Keep current files**.

Changes that wait are kept when you close the app. If you send another message before deciding, the orglet goes on in the same copy, so it sees what it did last turn. The earlier line then says **Carried into the next turn**, and the new answer's line covers the changes from both turns.

To have changes applied as soon as a run finishes, turn off **Review before applying** under the working folder, in the chat's **Details → Tool permissions** or the orglet's **Permissions** tab. The switch appears once the folder level allows editing. A side thread follows its main chat. Channels apply each orglet's changes as it finishes, because the next orglet in the turn works from those files, so their switch is off and cannot be changed. A schedule's runs wait for review in their own chat too, unless you turn **Review before applying** off in the schedule ([Schedules](#schedules)).

### The mode next to +

The button next to **+** under the message box shows how the next message is handled. Click it, or tab to it and press Enter, for the **Mode** menu. Pick a row with the mouse, the arrow keys and Enter, or its number:

1. **Ask before applying** (the default): changes wait for you to review them, as above.
2. **Apply changes**: changes reach the folder when the orglet finishes. This is **Review before applying** turned off, so changing one changes the other.
3. **Plan first**: the orglet may read and search the working folder, your files and the web, but changes nothing. It cannot edit, move or delete files, run commands, act on web pages or in apps, or use MCP tools. It answers with a plan, and under the plan **Follow the plan** sends "Follow the plan above." as your next message, back in the mode you had before. Plan first stays on for later messages until you click **Follow the plan** or pick another mode, so you can talk the plan over first.

Ask before applying and Apply changes need a working folder the orglet may edit. Without one, the rows say **Needs a working folder**, and picking one opens the folder picker. With a read-only folder they ask for edit access instead. Plan first works without a folder.

In a crew or a channel, each orglet's changes are applied as it finishes, so the mode reads **Apply changes** and **Ask before applying** cannot be picked; Plan first applies to every orglet in the turn. A side thread uses its main chat's permissions, so only Plan first can be switched there. The mode never skips the cards that ask before a step on a web page, in a desktop app or through an MCP tool. Those always ask.

## Details

**Details** at the top of a chat opens the panel that holds everything the chat does not show inline:

- **Tool permissions** and the working folder for this chat ([Permissions](permissions-and-learning.md#permissions)).
- Cost so far, and how long the orglets worked, such as **30s of work**: each run's own time added up, so the gaps between your messages do not count, and orglets working at the same time count once. Each internal job (a lead channel's plan, members and combining step) shows its status, retry and cancel. **Pause after this step** and **Continue from checkpoint** let you stop a long run and pick it up later; **Retry with current settings** starts a new run for what did not finish.
- **What happened**: the run's activity, the sources it cited, and **Loaded context**, the exact instructions, skill, knowledge and memory the run started with.
- **Chat decisions**: questions an orglet paused to ask you, with your answers. **Turn goal**: how an orglet understood the request, its assumptions, and the checks it planned (planned is not done).
- **Files and processes**: every attempt that changed files, with its outcome, its commands and their output. An attempt whose outcome is unknown after a crash or cancel blocks the chat until you check your files and choose **Keep current files**. See [Reviewing an interrupted attempt](agent-tools.md#reviewing-an-interrupted-attempt).

If the app closes while an orglet works, that turn stops where it was and is not sent again on its own. The chat says so on that turn ("This turn stopped partway because the app closed."), also after you have sent newer messages; check the cost and send the message again if you still need the answer.
- **Messages between workers** and **Reactions** in a channel, and export of any job's report.

## Schedules

A schedule sends the same request to an orglet or channel daily, on weekdays, weekly or every few hours, while Orglet is open.

1. Click **Schedules** in the footer, then **New schedule**.
2. Name it, write the repeating brief, choose the orglet or channel, the frequency, the weekday and run time, the time zone (picked from a list, this computer's first), a limit per run and, if you want one, a daily cap. Under **Limits & permissions**, set **Working folder** if each run should work in a folder (below), turn on **Read and search the web** if each run should look things up, and set **Browser** to **Read pages** if it should open pages in Orglet's browser. Attach sources if the request needs them.
3. Choose **Enable schedule**. Enabling is your approval for that content and connection; a later change to the orglet, channel, model or sources turns the schedule off until you review and save it again.

**Every few hours.** Choose **Every few hours** as the frequency and pick the interval: every hour, or every 2, 3, 4, 6, 8 or 12 hours. Nothing runs more often than once an hour. Turn on **Only between set hours** to keep it to part of the day: "every hour from 09:00 until 18:00" runs at 09:00, 10:00 and so on up to 17:00. Turn on **Weekdays only** to skip Saturday and Sunday. If a run is still going when the next hour comes, that hour is skipped and the card says so; it runs again at the next time after the run ends. A run that simply finishes does not send a message every hour: the card counts today's runs instead, and you still hear about a run that fails, waits for you or has changes to review. **Weekdays (Mon–Fri)** runs once a day at the time, Monday to Friday.

**A daily cap.** Under the limit per run, the editor says what the schedule may cost at most, such as "Up to 9 runs a day · up to $4.50 a day at $0.50 per run". Set **Daily cap** to a lower amount to spend less; it has to be at least the limit per run. A run only starts when its whole limit still fits under what today's runs have left, so a day never goes over the cap. Once it would, the rest of the day's runs are skipped, the card shows **Reached today's cost cap**, and you get one message about it. The cap starts over at midnight in the schedule's time zone. **Run now** counts too. Runs on Claude Code, Codex or Cursor Agent are billed to that plan, not counted here.

**A folder for the schedule.** A scheduled run is its own chat, so it does not get the folder you gave the orglet's chat. To have a schedule check a repository or tidy a folder, choose a level in **Working folder**: **Read files only**, **Read and edit files**, or **Read, edit files and run commands**. Orglet opens the folder picker at that level; pick the folder. Each run works in its own copy of it, and commands run without network access. A lower level keeps the folder; a higher one asks for the folder again, and **Change** picks another. With an editing level, **Review before applying** is on: a run's changes wait in that run's chat until you open it and click **Apply** or **Discard changes**, and the schedule's next run waits until you have. Turn it off to have changes reach the folder as each run finishes. A channel's schedule always applies as each orglet finishes. If the folder is moved, deleted or replaced, the schedule does not run and its card says so; pick the folder again and save.

Orglet checks schedules only while it is open. If the computer was off or asleep at the time, the card says which run it missed and when, with one **Run once to catch up** choice, or **Skip missed run**; missed days are never queued up, and the next time stays on the calendar. Scheduled runs cannot write memory, react, or propose app changes, since nobody is watching. There are at most 100 schedules.

To delete a schedule, open the **⋮** menu on its card and choose **Delete schedule**; the menu asks once more before it deletes. Its past runs stay as chats: they keep the schedule's name, say it was deleted, and are still in Search. An orglet or channel with a schedule switched on cannot be archived or deleted; Orglet names the schedule and offers **View schedules**, where you can turn it off or delete it. Policy detail: [routines.md](routines.md).

Each run is its own chat, apart from the orglet's main chat. You find it three ways:

- **In the sidebar**, under the orglet or channel it ran for, next to the side threads: one row per schedule, named after it with a small calendar mark, showing its newest run and that run's status mark. The row's menu opens the schedule, archives the run or deletes it.
- **In Notifications.** When a run finishes, stops with a problem or waits for you, a message names the schedule ("Daily standup note is ready", "Daily standup note needs you", "Daily repo check is ready; its changes wait for your review") with **Open**, and stays unread in Notifications until you look. A run that failed or waits for you is listed under **Problems** even when you were looking at it. A schedule that could not start at all ("Daily repo check did not run") is a problem too, with the reason and **View schedules**. Runs that come back with a restored backup are history and send no message.
- **In Schedules**, where each card's **Open latest run** says what became of that run: **Done**, **Needs attention**, **Needs you**, **Running** or **Changes wait for your review**. An hourly schedule's card also says how many times it ran today, and a card with a daily cap shows what today's runs used of it.

To try a schedule without waiting for its time, click **Run now** (the play button) on its card. It runs the same way a scheduled run does, with the same checks, and opens the run; the next scheduled time does not move. A schedule that is switched off, changed since you saved it, still busy with its previous run, or at its daily cap does not start, and Schedules says why. A switched-off schedule's button stays greyed out.

The run's header shows the schedule's name with the same calendar mark, and the top of the chat says which schedule it is and who ran it, with **Open schedule**.

You can also ask an orglet, in its chat, to schedule something ("run this every Monday at 9"); it answers with a proposal card, and the schedule it creates is saved switched off until you enable it ([App-change proposals](permissions-and-learning.md#app-change-proposals)).

## What is running

Click **Running** in the footer to see every turn that is working or waiting, across all chats. The button shows a grey count while anything runs or waits its turn, and beside it a count in the accent colour with a pause sign for chats that wait for you: paused, stopped at their limit, or waiting for your answer. Hover a count to see which is which.

The list has up to three parts:

- **Running**: each orglet at work, with its face, its name, the chat it works for, what it is doing now ("Reading invoice.xlsx…"), how long it has run, what it has cost so far, and its provider. A cost Orglet does not know yet says **Cost unknown** (a harness before it reports, or a custom connection with no price), and one with a request of unknown cost says **At least**, rather than showing $0.
- **Queued**: turns that have not started, with the reason and their place in line: "Waiting for Claude Code · 2 ahead" when the provider already has as many requests as **Settings → requests at once per provider** allows, "Waiting for a crew slot" or "Waiting for results from Lan" inside a channel where the lead splits the work (in one that works one member after another, each member waits for the results of the ones before it), and "Waiting for its turn to answer" in a channel where the orglets take turns.
- **Waiting for you**: chats stopped at a checkpoint, including a channel paused at the end of its work hours, chats stopped at their **Limit per task** ("Waiting for budget"), and chats waiting for your answer: an MCP tool the orglet wants to use ("Waiting for you to allow the MCP tool: search · Docs") or a question it asked. Answer in the chat and the same run goes on. A paused channel is listed under the member whose step came last, and its chat says so: "Paused after Scout's step, waiting for you to continue."

Each row has its controls on the right:

1. **Pause** (after the current step) and **Stop** for a running turn. Stopping a queued turn cancels it before it starts; nothing is sent and nothing is charged.
2. **Resume** for a paused chat, or for one waiting for budget after you raise its limit.
3. **Open chat** to go to that conversation. A chat waiting for your answer offers only this, because the answer card is in the chat.

The controls act on the whole turn of that chat. In a channel, stopping one orglet's row stops the channel's turn, the same as **Stop** in the chat. The list follows the sidebar: a chat whose mark shows it working (a turning ring) or paused (two bars on a soft tint) is always in it. With nothing running, the view says so in one line. How the queue is kept: [technical guide](technical-guide.md#what-is-running-and-the-queue).

## Search

Search finds any message in any chat, not only how a chat started.

1. Press **Ctrl+K**, or click the magnifier at the top of the sidebar.
2. Type a few words. Case and accents do not matter, so "hop dong" finds "hợp đồng", and a word can be the start of a longer one, so "inv" finds "invoice".
3. Move with the arrow keys and press Enter, or click a result.

It looks through every message you sent, every answer and report an orglet wrote, side threads, scheduled chats, chat names, and the names of your orglets and channels. With nothing typed, it lists your chats, newest first.

- **Orglets and channels** whose name matches come first. Choosing one opens its chat.
- **Chats** come next, one row each: the orglet's face or the channel's **#**, the chat's name (its title, or the orglet's or channel's name), whose chat it is when the name is a title, when the message was written, and a short piece of that message after **You** or the orglet's name, with your words in bold. Choosing it opens the chat scrolled to that message. The piece is plain text, the way the chat reads, without Markdown marks; a message you forwarded is its note and the forwarded words.

A chat where your words appear together, in the order you typed them, comes before one where they appear apart. Within each of those, the chat with the newest matching message comes first, and each chat shows its best message once.

Archived chats are found too; deleted chats are not. A lead channel's chat is found by its combined answer, not by the reports its members handed in. Search runs on this computer only. After an update from a version that searched only first messages, Orglet adds your existing chats in the background once it has started; until then the search window says a few results may be missing. How it works: [technical guide](technical-guide.md#search).

### Archived and deleted chats

An archived chat opens from search like any other, to read. Its message box is turned off, and a line under it says the chat is archived, with **Restore** next to it; restoring puts it back in the sidebar and you can write again. Archived chats are listed in **Settings → Archive**, not in the sidebar, with **Restore** and **Delete permanently** on each row. The same happens when the orglet the chat belongs to was archived: the line names it, and **Restore** brings the orglet back. When that orglet was deleted, the chat stays readable with its name in the header, and nothing can be sent there.

When the chat you have open is deleted, from its menu or with **Settings → Data → Delete chat history**, Orglet moves to the orglet's main chat, or to the first orglet when that one is gone too. Nothing is reported as a problem.

## Notifications

Every message the app shows as a passing toast is also kept: click **Notifications** in the footer. A dot and a count on the button mean new ones since you last looked. A confirmation of something you just did (saved, created, copied, archived) is listed but does not count, since you saw it as it happened. Problems count, and so does news that arrived on its own: an answer in a side thread, a schedule's run that finished or needs you, a downloaded update, a change an orglet applied by itself. A downloaded update's notice has a **Restart now** button while that update still waits. The notice of something you archived has **Open archive**, which opens **Settings → Archive**.

A few rules keep the list short:

- A side thread that answers while you are in its orglet's main chat, or in another of that orglet's side threads, sends no message. Its row is right there under the orglet, with its unread mark.
- Answers from one orglet's side threads wait as one row: "Scout answered in 3 side threads", which opens the newest. Once you have opened Notifications, the next answer starts a new row. A side thread that failed keeps a row of its own.
- A problem that is already waiting unread, with the same words about the same thing, is not listed again. A refresh that keeps failing shows its banner each time but adds one row, not one per try. After you have looked, a new failure is listed again.

What counts as new since you last looked comes first, under **New**; the rest follows newest first, grouped by day. Filter it by **All**, **Problems**, **Done** or **Info**. Each row says what happened and what it was about (the setting, the orglet, the chat, the command); a run of identical notices is one row with a count. A row about a chat, such as a side thread's answer or a schedule's run, opens that chat when you click it, as long as the chat still exists. Every app change an orglet makes through a proposal is announced here too. **Clear all** empties the list.

### While Orglet is in the background

When you are in another app and a chat finishes, stops with a problem or waits for you, Orglet also shows a notification from the system: the orglet's, channel's or schedule's name and a word or two ("Done", "Needs you", "Needs attention"). It never shows the answer, your message or a file name, since it appears on your desktop. Clicking it brings Orglet forward on that chat. It covers every chat: main chats, side threads, channels and schedule runs. With Orglet in front, the sidebar marks and the messages above already tell you, so nothing is shown.

Turn it off in **Settings → Chat → Notify me when a chat finishes**. It is on by default. How they look, whether they make a sound, and whether they show at all follow the system's own notification settings for Orglet.

Notifications are notes about this machine's session, stored in the window, not in the workspace: they are not in a backup and do not follow you to another computer. The **Schedules** and **Library** buttons in the footer show the same dot when something there waits for you: a missed run, or knowledge to review.
