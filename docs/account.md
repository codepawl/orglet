# CodePawl account

Orglet works fully without an account. You can also sign in to a free CodePawl account. Signing in also syncs your orglets, channels and chats between the computers signed in to the same account; see [Sync](#sync). Each computer keeps its own full copy, so your chats and files still live on this computer, and the sync server holds an encrypted copy. A signed-in account sends usage statistics and error reports, which you can turn off; see [below](#usage-statistics-and-error-reports).

Part of the [user guide](user-guide.md). The design behind it is [account-sync-design.md](account-sync-design.md).

## What an account gives you

- **Today:** it is free, and it is one CodePawl account for every CodePawl product.
- **Next:** syncing your orglets, channels, chats and settings between your computers.
- **Later:** Orglet on your phone.
- Your usage statistics show CodePawl how Orglet is used, so it gets better where it matters to you.
- **The CodePawl router, when it opens:** the account is how Orglet connects to it, with no key to paste (see [Connections](connections.md#api-keys)). Nothing about it shows until a build names the router's address.

## The first start

A new install asks once, before the app opens:

Two cards, each with an icon, a label and one short line. A single line under them says that signing in sends usage statistics and error reports, which you can turn off, with links to the [privacy policy](https://codepawl.com/privacy) and [terms](https://codepawl.com/terms).

- **Sign in** (the filled card) opens your browser at `accounts.codepawl.com`.
- **No account needed** opens Orglet the way it has always worked. You can sign in later from Settings.

If you already used Orglet before this version, you are not asked. The app opens as it did.

The orglet on the screen reacts as you go. It looks aside while your browser is open, winces if signing in fails, and smiles once you have chosen, just before the app opens.

## Sign in

1. Choose **Sign in**, on the first start or in **Settings → Account**.
2. Your browser opens the CodePawl sign-in page. Sign in there, or create an account.
3. The browser returns to Orglet on its own and shows a short "signed in" page on accounts.codepawl.com. Orglet is signed in.

While the browser is open, Orglet shows **Continue in your browser** with the orglet thinking and a still waiting mark (no spinner), **Open the browser again** (opens the same sign-in page once more), **Copy link** (copies that page's address, for a different browser) and **Cancel**. The address holds nothing secret. After 10 minutes without an answer the sign-in stops and you can try again. If the sign-in fails, the reason leads with an error mark and the card turns into **Try again**.

The way back to the app is a loopback address (RFC 8252): for the length of one sign-in Orglet listens on `127.0.0.1` on a port the system picks, and the sign-in page sends your browser to `http://127.0.0.1:<port>/auth/callback`. Only this computer can reach it, it takes the one callback that carries this sign-in's `state`, and it closes when the sign-in finishes, fails, is cancelled or times out. It needs no registration with Windows, so a ZIP copy and a development run sign in too. If Orglet cannot open that listener, it falls back to the `com.codepawl.orglet:` scheme, which Setup registers for your user next to [`orglet://` links](integrations.md); a ZIP copy and a development run cannot finish a sign-in that way.

## Settings → Account

Every row starts with an icon. **Sync** leads with its state: a tick when synced, a turning ring while it works, a dashed or filled mark when it cannot go on.

- **Not signed in**: **Sign in**, what an account gives you (above), and one sentence on what signing in sends, with the privacy and terms links and an **i** that lists what is sent.
- **Signing in**: while your browser is open, the orglet beside **Signing in** thinks. **Open the browser again** and **Copy link** are there if the browser did not come forward, and **Cancel** stops the sign-in.
- **Signed in**: your email, shown only in part (such as `an•••@example.com`) so a screenshot does not carry it, and your name, with **Sign out**, your **Plan** (Free), **Sync** (what it is doing, see [Sync](#sync)), and the **Usage statistics and error reports** switch.
- **Your sign-in ended**: the service no longer accepts this computer's sign-in, for example after 30 days without opening Orglet or after you signed out everywhere. Choose **Sign in again**. Nothing on this computer is lost.

## Only on this computer

Open an orglet's **Edit** window or a chat's **Chat settings** and turn on **Only on this computer** to keep it out of future sync. An orglet passes this choice to its chats and memories. A chat passes it to its side threads. An inherited switch explains where to change the choice and cannot be turned off in the child chat.

The choice is saved on this computer and included in a workspace backup. It does not delete your local messages or files. Turning it on for something that already synced takes it off the account; your other computers keep their copy, marked the same way.

## Sync

Sync keeps your orglets, channels, chats, memories, schedules and a few settings the same on every computer signed in to the same account. Each computer keeps its own full copy and works offline; changes catch up when it is online again.

Orglet syncs with CodePawl's sync server (`sync.orglet.codepawl.com`). Someone running their own server starts Orglet with `ORGLET_SYNC_URL` set to its address, or `off` to turn sync off for that install (see the [technical guide](technical-guide.md#account-sync)).

### Turning it on

- **Sync turns itself on when you sign in.** A new computer joins the account and the Researcher it started with makes way for your own orglets. A computer that already has chats or orglets joins too and merges: what is here goes to the account, and what the account has comes here. Two orglets with the same name stay two orglets; nothing is matched by name. Anything marked **Only on this computer** stays here.
- **A sign-in from before sync existed asks first.** If you signed in on an earlier version, when Orglet said nothing leaves this computer, Orglet does not upload anything on its own after the update. When that computer holds orglets or chats, **Settings → Account → Sync** says "Đồng bộ giờ đã có" and offers **Đồng bộ máy này** (merge, as above) or **Chỉ lấy từ tài khoản** (this computer's data is saved as a copy beside the database, erased, and replaced by the account's). A notice in Notifications and a message on screen open **Settings → Account** once each time Orglet starts while it waits. Pressing either button, or signing in again, counts as agreeing, and Orglet does not ask again. A computer with nothing of its own beyond the Researcher joins without asking.
- **Sync** in **Settings → Account** runs a sync right now. It rests for three seconds after each press.
- After **Erase all data**, sync waits on that computer until you press **Sync**, so the account's copy does not come straight back.
- **Erase all data** changes only this computer. It does not delete your account or anything in it.

### When two computers changed the same thing

If you edit the same orglet, skill, crew or note on two computers before they sync, Orglet keeps both versions and uses the one changed later. **Settings → Account** then shows **Changed on two computers** with **Review**. The review puts the two versions side by side and says which one is in use and which computer changed each.

- **Keep this one** or **Use this one** makes that version the current one on every computer.
- The other version is not deleted; it stays in the history.
- A chat that is already running keeps the version it started with.

Messages, reactions and renamed chats never need this: two messages are both kept, and a rename and a reaction on different computers both apply.

### What it does not do

- Nothing marked **Only on this computer** leaves it.
- API keys, harness sign-ins, MCP servers, folder grants, file paths and browser profiles never sync. A chat that arrives from another computer has no permissions and no folder here; a schedule arrives turned off until you check it and turn it on here.
- An orglet's run belongs to the computer that ran it. Other computers show it and cannot continue it.
- A file you attached is a path on the computer where you attached it. Orglet never copied it, so its contents do not sync; other computers show its name and say it is on another computer.

### Files

Only Orglet's own copies of files sync: a version you saved in the [file viewer](viewing-and-editing-files.md), up to 25 MiB, once a message in the chat carries it.

- On the computer that saved it, the version's contents are sent after the message.
- On another computer the version appears in the chat, and its contents are downloaded only when you open it and choose **Download to this computer**. The download is checked against the file's fingerprint before it is kept.
- For a file that did not sync, open it and choose **Choose file** to point Orglet at the same file here. It is accepted only when its contents match.

### What Settings shows

**Settings → Account → Sync** says one of:

- **Syncing** or **Synced**.
- **Could not reach the sync server**: Orglet tries again by itself, waiting longer each time (up to 5 minutes), and right away when you bring the window forward. **Retry** tries now.
- **Your account is full**: new changes stay on this computer and keep arriving from others. **Retry** tries to send them again.
- **Your account has data from a newer Orglet**: update the app; changes from here wait until then.
- **This computer was removed from your account** (its sign-in was revoked from your account page), or **Your account already syncs as many computers as it allows**, or **This account was deleted on the server**. Nothing on this computer is lost in any of these.

Changes are sent a few seconds after you make them, and while you keep changing things, at most once a minute. Changes from other computers arrive as soon as the server says there are some, or when you bring the window forward. Nothing syncs while Orglet is closed.

## What is stored where

- **On this computer**, in Orglet's data folder, one file `account.credential` holds the sign-in, encrypted with your system's secure storage the same way as API keys, plus your email, name and plan so Settings can show them offline. It is not in the database, so a backup never includes it and **Erase all data** leaves it alone.
- **The router key**, if you connect the CodePawl router, sits in `codepawl.credential` beside the API keys, encrypted the same way, with the key's identifier in `codepawl-key-id.txt`. Orglet asks the accounts service for a router access token only to make or revoke that key and to read your usage; the window never sees it. It is not in the database or a backup.
- **The short-lived access token** stays in the app's memory and is gone when Orglet closes. The app's window never sees either token; it only learns whether you are signed in, your email, name and plan.
- Sync and marketplace use separate access tokens. New browser sign-ins authorize both resources; an older saved sign-in still works for sync and usage statistics, but needs another browser sign-in before marketplace account access. The desktop can prepare a [public submission](marketplace-design.md#desktop-publishing); production sends remain unavailable until moderation is enabled.
- **Also in the data folder**: `analytics.json`, a random install id made on this computer (never a hardware id), whether the analytics switch is on and the version that last ran, and `analytics-queue.json`, the statistics waiting to be sent. Neither is in the database or a backup.
- **Sync's own bookkeeping** (which account this computer joined and how far it has read it) is in the database but never in a backup.
- **On CodePawl's servers**: your account (email, name, a hashed password or the Google or GitHub sign-in you used), and the usage statistics and error reports below while analytics is on. No chats, orglets or files, since CodePawl's sync server is not running yet.

## Usage statistics and error reports

While you are signed in, Orglet sends usage statistics and error reports to CodePawl, so it can see which parts are used and what breaks. It is on once you sign in, and **Settings → Account → Usage statistics and error reports** turns it off at any time. Turning it off, or signing out, deletes whatever was still waiting on this computer. **Without an account nothing is sent.**

What is sent:

- **When Orglet starts**: the version, the operating system and processor type, the app language and how Orglet was installed, and the old and new version after an update.
- **When you send a message**: the kind of chat (one orglet, a channel, a side thread or a schedule), the kind of connection (Demo, API, local harness or a custom connection) and, except for a custom connection, the provider and model id.
- **When a run ends**: how it ended (done, partly done, failed, stopped, interrupted), roughly how long it took and roughly how many steps it made.
- **Features you use**, counted once per session: tabs, the rail, side threads, schedules, the browser, desktop apps, MCP, the file viewer, editing a file, forwarding, the `orglet` command, Send to and the decision model.
- **Settings you change**: which setting, and its new value only when it is a fixed choice such as the theme or an on/off switch.
- **Errors**: the kind of error, its message and where in Orglet's code it happened. Before anything is kept, your home folder and user name become `~`, emails and the part of a web address after `?` are removed, and anything that looks like a key or token is masked. A failed run is sent as its error code only.
- A random install id, so reports from one computer can be told apart.

What is never sent: the text of your chats, prompts and answers, file names and contents, folder paths, the names and instructions of your orglets and channels, API keys and tokens, and your email.

CodePawl keeps these reports for **180 days**, and deletes them when you delete your account. Orglet sends them every 5 minutes and when it closes; if the service cannot be reached, they wait on this computer (at most 500 events and 50 errors, the oldest dropped first).

## Sign out

**Settings → Account → Sign out**. If the CodePawl router is connected, Orglet revokes its key at the router first, because that needs your sign-in, and forgets it here either way. Then it deletes the sign-in from this computer, then asks the service to cancel it. Signing out works offline too; the sign-in then ends at the service by itself within 30 days. An access token already handed out can stay valid at the service for up to 15 minutes. Your chats, orglets and files stay exactly as they are.
