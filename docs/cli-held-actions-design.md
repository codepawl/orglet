# The terminal and the decisions held for the person: design

**Status: design, 2026-10-10. Phase 4 of the plan in issue 554. Stages A to D below are built in that order; each stage says what it adds.**

The `orglet` command reaches most of the app. It reaches none of the trust decisions: approvals, grants, secrets, deletions of data. [cli.md](cli.md#what-stays-in-the-desktop) lists them and `apps/desktop/src/cli/parity.ts` marks each one `held`. This note describes the one path by which the terminal may reach them, and which of them it never reaches.

## The problem

The pipe's token is a file in the data folder. An orglet that runs through a coding CLI (Claude Code, Codex, Cursor Agent) runs as the same user, can read that file, and can run `orglet` itself. So today:

> Anything the terminal can do, an orglet can do to itself.

A held decision reached through the token alone would let an orglet approve its own tool call, widen its own folder, or save a key. A flag such as `--yes` or `--confirm "<name>"` changes nothing: the orglet can type it too.

What the path needs is a factor the person has and a process started by the app does not.

## What an orglet cannot do

- **It cannot see Orglet's window.** The desktop tools never read or drive Orglet's own programs (`NEVER_DESKTOP_PROGRAMS` and the run-time addition in `shared/desktop.ts`). Orglet's browser shows web pages, not the app. No tool returns a picture of the window.
- **It cannot type at the person's terminal.** It can start its own `orglet` process, but that process has no person at its keyboard.

So the factor is **a short code that only the window shows, typed by the person into the terminal that asked**. Call it pairing. A click in the window would be weaker: an orglet could ask again and again until a hurried person clicks Allow on a dialog they did not expect. A code has nowhere to go unless the person is sitting at the terminal that is waiting for it.

### What this does not stop

A program that runs as the person with no sandbox, and is hostile, can read another process's memory or send clicks to any window. Nothing in a desktop app stops that, and the window's own buttons are no safer. The design's claim is narrower and is the one that matters here: an orglet using the tools Orglet gives it, or the `orglet` command, cannot complete a held decision.

## Pairing

1. The person runs a held command, or `/unlock` in the terminal chat, or `orglet unlock`.
2. The command checks that it has a real terminal on both ends (`isTTY` for input and output). Without one it stops with exit code 2 and says the command needs a person at a terminal. A script cannot pair.
3. The command sends `pair-start`. Main makes a code of eight characters from an alphabet without look-alikes (no 0, O, 1, I, L), shows a dialog in the window, and answers with a pairing id. The code is not in the answer.
4. The window's dialog says: **A terminal is asking to act for you.** It shows the code in large type, what the code allows (see Scope), and how long. Its only button is **Cancel**. If the window is hidden, main shows it and brings it forward; the terminal also prints where to look.
5. The person reads the code and types it at the terminal's prompt. The command reads it from the terminal, never from an argument, an environment variable, standard input that is a pipe, or a file.
6. The command sends `pair-finish` with the pairing id and the code. Main compares in constant time. On a match it answers with an **elevation key**: 32 random bytes, hex. Main keeps only its SHA-256.
7. The dialog closes. While an elevation is live, the window shows a quiet mark in the user panel, "Terminal is acting for you", with **End now**.

Limits on pairing:

- A code lives 2 minutes and allows 5 wrong tries, then it is dead and the dialog says so.
- One pairing at a time. A second `pair-start` while one is open is refused; it does not replace the dialog.
- After 3 pairings that ended without a match (cancelled, expired, or too many tries) inside 10 minutes, `pair-start` is refused for 10 minutes and the window keeps one notice that says why. This is what an orglet spamming the dialog runs into.
- **Settings → Privacy → Let a terminal act for me** turns the whole path off. It is on by default. Off, every held operation is refused with a sentence that names the setting.

## Elevation

An elevation is the right to send held operations for a while.

- **Where the key lives.** In the memory of the process that paired, and nowhere else. The command never writes it to disk, never prints it, and never puts it in an environment variable.
  - The terminal chat (`orglet` with no arguments) keeps it for the session. One pairing covers the approvals of a working session.
  - A one-shot command (`orglet grant …`) pairs, does its one thing, and forgets the key when it exits. The person types a code for each such command. These are rare acts, and a key kept anywhere a second process could read would be a key an orglet could read.
- **How long.** 15 minutes from pairing, and it ends earlier after 5 minutes without a held operation, when the app quits, when the person presses **End now**, or when the setting is turned off.
- **One at a time.** A new pairing ends the previous elevation.
- **On the wire.** A held request carries `elevation` beside the token. Main checks the token first, then the elevation's hash in constant time, then its expiry and scope. A missing or dead elevation answers with the code `locked`, which the command turns into the pairing prompt (interactive) or exit code 2 (script).

### Scope

The pairing dialog names what the code allows, and the elevation is limited to it:

| Scope | Asked by | Allows |
|---|---|---|
| `decisions` | `/unlock`, `orglet unlock`, or the first approval in the terminal chat | Stage B: answering what a chat is waiting on |
| `one` | a one-shot held command | exactly the operation that asked, with exactly its arguments; the dialog shows it in words ("Let Researcher work in D:\notes, read and write") |
| `setup` | `/unlock setup` | Stages C and D inside the terminal chat: grants and secrets, for the session |

A `one` elevation is spent by its operation. A `decisions` elevation cannot grant or save a secret; asking for more opens a new pairing that says so.

## What each held operation becomes

Four groups. The first three are reached with an elevation. The fourth never is.

### Stage B: decisions about work that is waiting (`decisions`)

These already have a card in the window. The terminal shows the same facts the card shows, then takes the answer.

- Approving or refusing a tool call: `accept`, an MCP call, a browser step, a desktop step (`answerBrowserApproval`, `answerDesktopApproval`).
- A run's changes: `applyWorkspaceReview`, `discardWorkspaceReview`, `applyBlockedHandIn`, `restoreWorkspaceFile`. The terminal prints the diff summary first (`orglet show changes` already does) and takes the review token from main only inside an elevated request.
- An app-change card: `applyAppProposal`, `dismissAppProposal`, `undoAppProposal`. The terminal prints the card's values.
- What an orglet wants to remember: `reviewKnowledge` (approve or archive), and writing a note (`saveKnowledge`).
- `acknowledgeEvidence`, `resolveSyncConflict` (prints both versions' summaries first), `reconcileBudget`.
- `reviewSkill`: only after `orglet skill show` printed the package's files in this session; main refuses a review of a skill it has not shown to this elevation.
- `installUpdate`, `testMcpServer`, `testWebSearch`, `testDecisionModel`.

In the terminal chat a waiting card appears as a prompt under the turn, with the keys the card's buttons map to. Locked, it says "Type /unlock to answer here, or /open to answer in the window."

### Stage C: grants (`one` or `setup`)

A grant changes what an orglet may reach, so each one also leaves a line in the window (see The journal) with **Undo** where the core can undo it.

- A chat's tools: `setToolCapabilities`. A folder and its level: `setWorkspaceLevel`, `revokeWorkspace`, and the pickers (`pickWorkspace`, `pickNewChatWorkspace`, `pickWatchFolder`, `pickRoutineWorkspace`) with a path argument standing in for the picker. Main resolves the path, refuses one that does not exist, and applies the same refusals the picker applies (the data folder, a drive root, the home folder itself).
- `revoke` (taking a file back), `setMcpServerEnabled`, `setMcpGrant`, `removeMcpServer`, `importMcpServers`.
- `setBrowser` and `setDesktop` (sites, profiles in use, granted programs), with the same fixed refusals as the window.
- What a new channel in a space starts with (the `defaults.capabilities` left out of phase 2).
- Raising what a chat may spend (`updateTask` with a higher budget, refused in phase 2).
- `saveDecisionModelSetting`, `setAnalytics`, `setCliOnPath`, `setSendTo`.
- `backup` to a path. `syncStart`, with the account's name typed back as `--confirm`.
- `clearBrowserProfile` and `deleteBrowserProfile`, with the profile's name typed back.

### Stage D: secrets (`one` or `setup`)

A secret is read from the terminal with echo off and travels in the elevated request. It is never an argument (arguments show in the process list), never an environment variable, never read from a file path, and no answer contains it. Main hands it to the same `safeStorage` path the window uses and drops it.

- API keys and custom connections: `connect`, `disconnect`, `saveCustomConnection`, `deleteCustomConnection`, `saveWebSearchKey`, `removeWebSearchKey`.
- MCP servers with their secrets: `saveMcpServer`; `signInMcpServer` and `cancelMcpSignIn` open the browser as the window does.
- Coding CLI sign-ins: `startHarnessSignIn`, `cancelHarnessSignIn`, `signOutHarness`, `saveHarnessAccount`, `selectHarnessAccount`, `removeHarnessAccount`.
- The CodePawl account: `accountSignIn` (opens the browser), `accountSignOut`, and the link helpers.

A scripted way to load a key (CI, a setup script) is out of scope on purpose: a path a script can take is a path an orglet can take.

### Never from the terminal

- `eraseData` and `restore`. They replace or destroy everything, and the window's own flow has steps a prompt would only imitate.
- `accountChoice`: the first-run choice belongs to the first window.
- `browserInput`, `browserTakeOver`, `createBrowserProfile`, `openBrowserProfile`: they are the live browser view and the person's own hands in it.
- Marketplace publishing and moderation.
- Everything already marked window-only for being visual or window chrome.

`parity.ts` gains a fourth answer, `elevated(command, scope)`, beside `reached`, `windowOnly` and `held`. The test that fails on a key with no answer stays, and a second test fails when an operation main accepts with an elevation is not `elevated` in the table, or the reverse.

## The journal

Every elevated operation is recorded by main: time, the operation in words, the chat or orglet it touched, the outcome, and which scope it ran under. Never an argument that is a secret.

- **Settings → Privacy → What the terminal did** lists it, newest first, with **Undo** on a grant the core can undo.
- `orglet show terminal` prints the same list. It is read-only and needs no elevation.
- A grant or a secret also raises a notice in the window's notification list at the moment it happens, so a person who paired and walked away from the window still finds it.

The journal is local, is not synced, and is kept as long as the browser and desktop journals are.

## The window

- **The pairing dialog** is a dialog in the middle of the screen: a heading, one sentence, the code, the scope in words, the time left as text that updates each ten seconds (no spinner, no progress ring), and Cancel. For a `one` scope the sentence is the operation in words, so the person reads what they are about to allow before they type anything.
- **The live mark** sits in the user panel while an elevation is live: an icon and "Terminal is acting for you", with End now in its popover and the time left.
- **Notices** for grants and secrets go to the notification list, on a plain surface, led by an icon.
- All of it is app chrome: Vietnamese source strings, English in `en.ts`, the kit's components.

## The terminal

```
orglet unlock                      pair for decisions, in the chat or before a few one-shot answers
orglet approve <chat> [--deny]     answer the card a chat is waiting on
orglet changes <chat> apply|discard
orglet proposal <chat> apply|dismiss|undo
orglet memory review <id> approve|archive
orglet grant folder <chat> <path> [--read-only]
orglet grant tools <chat> <tool…>
orglet connect <provider>          prompts for the key, echo off
orglet show terminal               the journal
```

The exact verbs follow what is already there (`answer`, `show`, `memory`, `preferences`, `space`); the list above fixes the shape, not every name. Each has its slash command in the terminal chat. A held command run without a terminal exits with 2 and names the reason.

## Protocol and code

- `cli/protocol.ts`: `pair-start`, `pair-finish`, `pair-cancel`, `elevation-end`; an optional `elevation` on every request; the error code `locked`.
- `main/cli-elevation.ts` (new): pairing state, the elevation's hash, expiry, scope, the rate limit, the journal. No Electron in it, so tests drive it with a fake clock.
- `main/cli-server.ts`: after the token check, a request whose operation is in the elevated set is passed to the elevation check before dispatch. The set is derived from `parity.ts`, not written twice.
- `main/cli-held-*.ts` (new, by stage): the operations themselves, each calling the same core command as the window's button.
- Main to renderer: one typed bridge channel for the pairing dialog and the live mark. The renderer never sees the elevation key; it sees the code (to draw it) and the scope.
- The preference is a `settings` field validated with Zod; the journal is a table with a Zod row.

## Tests

- Pairing: a match issues a key once; a wrong code counts down and dies at five; expiry; cancel; a second start is refused; the rate limit; the setting off refuses everything.
- Elevation: each held operation is refused with `locked` without a key, with a dead key, with a key of the wrong scope, and after End now; a `one` key is spent by its operation and refuses a second or a different one.
- No terminal: every held command exits 2 when input or output is not a terminal, before it sends anything.
- Secrets: a key sent in an elevated request is saved, and appears in no answer, no journal row and no log line.
- The parity tests above.
- Packaged smoke (`cli-smoke`): `locked` for one operation of each group with only the token, and a full pairing driven through a pseudo-terminal with the code read from the window by the test's own access to the page.

## Stages

- **A. Foundation.** Protocol, `cli-elevation`, the pairing dialog, the live mark, the setting, the journal with `orglet show terminal`, `orglet unlock` and `/unlock`. No held operation is reachable yet.
- **B. Decisions.** The first group, and the waiting-card prompt in the terminal chat.
- **C. Grants.** The second group, with notices and Undo.
- **D. Secrets.** The third group, with the echo-off prompt.

After each stage `docs/cli.md` moves the reached items out of "What stays in the desktop" and says how they are reached.
