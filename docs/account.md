# CodePawl account

Orglet works fully without an account. You can also sign in to a free CodePawl account. Syncing your orglets, crews and chats between computers comes next; **today nothing syncs**. Signing in changes nothing about where your chats and files live: they stay on this computer.

Part of the [user guide](user-guide.md). The design behind it is [account-sync-design.md](account-sync-design.md).

## The first start

A new install asks once, before the app opens:

- **Sign in** opens your browser at `accounts.codepawl.com`.
- **Use without an account** opens Orglet the way it has always worked. You can sign in later from Settings.

If you already used Orglet before this version, you are not asked. The app opens as it did.

## Sign in

1. Choose **Sign in**, on the first start or in **Settings → CodePawl account**.
2. Your browser opens the CodePawl sign-in page. Sign in there, or create an account.
3. The browser asks to open Orglet. Allow it. Orglet comes forward, signed in.

While the browser is open, Orglet shows **Continue in your browser** with **Cancel**. After 10 minutes without an answer the sign-in stops and you can try again. If the sign-in fails, the reason is shown with **Try again**.

The link back to the app uses the `com.codepawl.orglet:` scheme. Setup registers it for your user, next to [`orglet://` links](integrations.md). A ZIP copy and a development run do not register it, so signing in there cannot finish.

## Settings → CodePawl account

- **Not signed in**: a short note and **Sign in**.
- **Signed in**: your email, shown only in part (such as `an•••@example.com`) so a screenshot does not carry it, and your name, with **Sign out**, your **Plan** (Free), and **Sync**, which says it is coming next and that nothing leaves this computer yet.
- **Your sign-in ended**: the service no longer accepts this computer's sign-in, for example after 30 days without opening Orglet or after you signed out everywhere. Choose **Sign in again**. Nothing on this computer is lost.

## What is stored where

- **On this computer**, in Orglet's data folder, one file `account.credential` holds the sign-in, encrypted with your system's secure storage the same way as API keys, plus your email, name and plan so Settings can show them offline. It is not in the database, so a backup never includes it and **Erase all data** leaves it alone.
- **The short-lived access token** stays in the app's memory and is gone when Orglet closes. The app's window never sees either token; it only learns whether you are signed in, your email, name and plan.
- **On CodePawl's servers**: your account (email, name, a hashed password or the Google or GitHub sign-in you used). No chats, orglets or files, since nothing syncs yet.

## Sign out

**Settings → CodePawl account → Sign out**. Orglet deletes the sign-in from this computer first, then asks the service to cancel it. Signing out works offline too; the sign-in then ends at the service by itself within 30 days. An access token already handed out can stay valid at the service for up to 15 minutes. Your chats, orglets and files stay exactly as they are.
