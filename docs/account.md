# CodePawl account

Orglet works fully without an account. You can also sign in to a free CodePawl account. Syncing your orglets, channels and chats between computers comes next; **today nothing syncs**. Signing in changes nothing about where your chats and files live: they stay on this computer. A signed-in account sends usage statistics and error reports, which you can turn off; see [below](#usage-statistics-and-error-reports).

Part of the [user guide](user-guide.md). The design behind it is [account-sync-design.md](account-sync-design.md).

## What an account gives you

- **Today:** it is free, and it is one CodePawl account for every CodePawl product.
- **Next:** syncing your orglets, channels, chats and settings between your computers.
- **Later:** Orglet on your phone.
- Your usage statistics show CodePawl how Orglet is used, so it gets better where it matters to you.

## The first start

A new install asks once, before the app opens:

- **Sign in** opens your browser at `accounts.codepawl.com`. The line under it says that signing in sends usage statistics and error reports, which you can turn off, and links to the [privacy policy](https://codepawl.com/privacy) and [terms](https://codepawl.com/terms).
- **Use without an account** opens Orglet the way it has always worked. You can sign in later from Settings.

If you already used Orglet before this version, you are not asked. The app opens as it did.

The orglet on the screen reacts as you go. It looks aside while your browser is open, winces if signing in fails, and smiles once you have chosen, just before the app opens.

## Sign in

1. Choose **Sign in**, on the first start or in **Settings → Account**.
2. Your browser opens the CodePawl sign-in page. Sign in there, or create an account.
3. The browser asks to open Orglet. Allow it. Orglet comes forward, signed in.

While the browser is open, Orglet shows **Continue in your browser** with **Cancel**. After 10 minutes without an answer the sign-in stops and you can try again. If the sign-in fails, the reason is shown with **Try again**.

The link back to the app uses the `com.codepawl.orglet:` scheme. Setup registers it for your user, next to [`orglet://` links](integrations.md). A ZIP copy and a development run do not register it, so signing in there cannot finish.

## Settings → Account

- **Not signed in**: **Sign in**, what an account gives you (above), and one sentence on what signing in sends, with the privacy and terms links and an **i** that lists what is sent.
- **Signing in**: while your browser is open, the orglet beside **Signing in** thinks, and **Cancel** stops the sign-in.
- **Signed in**: your email, shown only in part (such as `an•••@example.com`) so a screenshot does not carry it, and your name, with **Sign out**, your **Plan** (Free), **Sync**, which says it is coming next and that no chat or file leaves this computer yet, and the **Usage statistics and error reports** switch.
- **Your sign-in ended**: the service no longer accepts this computer's sign-in, for example after 30 days without opening Orglet or after you signed out everywhere. Choose **Sign in again**. Nothing on this computer is lost.

## Only on this computer

Open an orglet's **Edit** window or a chat's **Chat settings** and turn on **Only on this computer** to keep it out of future sync. An orglet passes this choice to its chats and memories. A chat passes it to its side threads. An inherited switch explains where to change the choice and cannot be turned off in the child chat.

The choice is saved on this computer and included in a workspace backup. It does not delete your local messages or files. Signing in still does not send chats between computers; the connection to the sync service comes next.

## What is stored where

- **On this computer**, in Orglet's data folder, one file `account.credential` holds the sign-in, encrypted with your system's secure storage the same way as API keys, plus your email, name and plan so Settings can show them offline. It is not in the database, so a backup never includes it and **Erase all data** leaves it alone.
- **The short-lived access token** stays in the app's memory and is gone when Orglet closes. The app's window never sees either token; it only learns whether you are signed in, your email, name and plan.
- Sync and marketplace use separate access tokens. New browser sign-ins authorize both resources; an older saved sign-in still works for sync and usage statistics, but needs another browser sign-in before marketplace account access. The desktop can prepare a [public submission](marketplace-design.md#desktop-publishing); production sends remain unavailable until moderation is enabled.
- **Also in the data folder**: `analytics.json`, a random install id made on this computer (never a hardware id), whether the analytics switch is on and the version that last ran, and `analytics-queue.json`, the statistics waiting to be sent. Neither is in the database or a backup.
- **On CodePawl's servers**: your account (email, name, a hashed password or the Google or GitHub sign-in you used), and the usage statistics and error reports below while analytics is on. No chats, orglets or files, since nothing syncs yet.

## Usage statistics and error reports

While you are signed in, Orglet sends usage statistics and error reports to CodePawl, so it can see which parts are used and what breaks. It is on once you sign in, and **Settings → Account → Usage statistics and error reports** turns it off at any time. Turning it off, or signing out, deletes whatever was still waiting on this computer. **Without an account nothing is sent.**

What is sent:

- **When Orglet starts**: the version, the operating system and processor type, the app language and how Orglet was installed, and the old and new version after an update.
- **When you send a message**: the kind of chat (one orglet, a channel, a side thread or a schedule), the kind of connection (Demo, API, local harness or a custom connection) and, except for a custom connection, the provider and model id.
- **When a run ends**: how it ended (done, partly done, failed, stopped, interrupted), roughly how long it took and roughly how many steps it made.
- **Features you use**, counted once per session: tabs, the rail, side threads, schedules, the browser, desktop apps, MCP, the file viewer, editing a file, forwarding, the `orglet` command, Send to and Tacet.
- **Settings you change**: which setting, and its new value only when it is a fixed choice such as the theme or an on/off switch.
- **Errors**: the kind of error, its message and where in Orglet's code it happened. Before anything is kept, your home folder and user name become `~`, emails and the part of a web address after `?` are removed, and anything that looks like a key or token is masked. A failed run is sent as its error code only.
- A random install id, so reports from one computer can be told apart.

What is never sent: the text of your chats, prompts and answers, file names and contents, folder paths, the names and instructions of your orglets and channels, API keys and tokens, and your email.

CodePawl keeps these reports for **180 days**, and deletes them when you delete your account. Orglet sends them every 5 minutes and when it closes; if the service cannot be reached, they wait on this computer (at most 500 events and 50 errors, the oldest dropped first).

## Sign out

**Settings → Account → Sign out**. Orglet deletes the sign-in from this computer first, then asks the service to cancel it. Signing out works offline too; the sign-in then ends at the service by itself within 30 days. An access token already handed out can stay valid at the service for up to 15 minutes. Your chats, orglets and files stay exactly as they are.
