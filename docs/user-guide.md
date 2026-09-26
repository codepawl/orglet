# User guide

Orglet is a desktop app where you keep a small team of AI workers, called **orglets**, and give them work in a normal chat. Orglets can be grouped into **crews**. There is no Orglet account and no Orglet server: chats, orglets and files stay on this computer, and each orglet runs on a connection you choose, such as the Claude Code or Codex account you are already signed in to, an API key, or a local Ollama.

This page is the front door. It covers what Orglet is, how to install it, and your first chat, then points at one short page per part of the app.

Orglet is early. Expect rough edges, and check answers against your own sources before you rely on them.

## The pages

| Page | What it covers |
|---|---|
| [Orglets and crews](orglets-and-crews.md) | Creating an orglet, crews and how a crew turn runs, group chats, `@` tags, replies, reactions |
| [Connections](connections.md) | Claude Code, Codex, Cursor Agent and Gemini CLI on this computer; API keys; Ollama; Demo; model IDs; cost limits |
| [In a chat](chat-guide.md) | Attaching files, reports as documents, the trace of what an orglet did, diffs, Details, schedules, notifications |
| [Permissions and learning](permissions-and-learning.md) | The permission switches and the working folder, memory, knowledge and the Library, self-improvement, app-change proposals |
| [Settings](settings.md) | Every settings tab, including backup, erasing data, and updates |
| [Troubleshooting](troubleshooting.md) | Sign-in errors, SmartScreen, a harness that is not found, commands that cannot reach `localhost` |

The step-by-step first walk-through with screenshots is [Getting started](getting-started.md). The full [docs map](README.md) also lists the how-it-works pages and the product decisions behind them.

## What Orglet is

- **A team with roles.** Each orglet has a name, a face, instructions and a skill. You talk to one orglet, a few of them, or a crew.
- **Your existing AI plan.** An orglet can run through Claude Code, Codex, Cursor Agent or Gemini CLI using the account you are already logged in to. An API key is optional.
- **Private by default.** No account, no server. An orglet reads only the files you attach to that chat or the folder you grant it.
- **Repeat work runs itself.** Schedules send the same request daily or weekly while the app is open.

What Orglet is not, and what it will not become for now, is in [product.md](product.md).

## Install

### Windows

Windows is the public target. The [latest GitHub Release](https://github.com/codepawl/orglet/releases/latest) carries two builds:

| Build | Pick it when | Updates |
|---|---|---|
| **Setup.exe** | You want the normal install. It installs per user, under your local app data, with a Start Menu entry. | Updates itself (since 0.2.4). |
| **ZIP** | You want to unzip and run without an installer, for example on a machine where you cannot install software. | Does not update itself. Download the next release by hand. |

Run Setup. **Windows protected your PC** (SmartScreen) can appear: the build is signed, but a new signing certificate has no reputation yet. Check that the dialog names **Nguyen Xuan An** as the publisher, then choose **More info → Run anyway**. A dialog that says **Unknown publisher** means the file is not the signed release; stop and download it again from the Release page.

After the first launch, a Setup install checks GitHub Releases shortly after it starts and every few hours, downloads a new version in the background, and offers a restart. If you skip the restart, the next launch already uses the new version. **Settings → About** shows the version you run, lets you check by hand, and can turn automatic updates off. Versions 0.2.3 and earlier have no updater: install the current release by hand once, and from then on it updates itself. Details: [Settings → About](settings.md#about).

### macOS and Linux

macOS packaging exists (a ZIP of `Orglet.app` from CI, signed and notarized on `main`), but it is not a GitHub Release asset yet, and it cannot update itself unless it is signed. Linux has a CI ZIP that nobody has used on a real desktop yet. Both are for trying the app, not for daily use. See [macos-packaging.md](macos-packaging.md) and [linux-packaging.md](linux-packaging.md).

### From source

You need Node 24.19 or newer and pnpm 11.19.0.

```
pnpm install --frozen-lockfile
pnpm dev
```

A build run from source does not update itself. How to run the checks: [CONTRIBUTING.md](../CONTRIBUTING.md).

## First chat

1. Open Orglet. The window is in US English, and a **Researcher** orglet is already in the sidebar, on **Demo**.
2. Click **Researcher**. The main column is that orglet's chat, with the message box at the bottom.
3. Type a short message and send it. Demo answers with a labelled sample reply; it calls no model and reads no files.
4. To get real answers, connect a model: [Connections](connections.md). Then open the orglet's settings and set **Model** to that connection.

Every orglet and every crew has **one live chat**. A new message is a turn in that chat, not a new item in the sidebar. To start over, open **⋯** next to **Details** and choose **Archive**; search (Ctrl+K) still finds the old chat.

## The window

- The **sidebar** lists **Orglets** and **Crews**. Click a name to open that chat. **+** next to a section creates one; the pencil turns on select mode for archiving, deleting or starting a group chat. In a window narrower than 780 px the sidebar folds away; widen the window and it comes back, unless you closed it yourself.
- The **main column** is the conversation. **Details** opens the panel with the chat's permissions, cost, internal jobs and recovery controls.
- The **footer** has **Notifications**, **Schedules**, **Library** and **Settings**. A dot on a button means something waits for you there.
- Back and forward work like a browser: the side buttons on a mouse, or Alt+Left and Alt+Right, step through the chats and panels you opened.

Language and appearance are in **Settings → General**: English (US), English (UK) or Tiếng Việt; light or dark; accent colour and fonts.
