<div align="center">

<img src="apps/desktop/assets/icon.svg" alt="Orglet logo" width="88" height="88">

# Orglet

**Your own small team of AI workers, on your computer.**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/orglets/crew-dark.png">
  <img src="docs/images/orglets/crew-light.png" alt="" width="378" height="96">
</picture>

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
[![Release](https://img.shields.io/github/v/release/codepawl/orglet)](https://github.com/codepawl/orglet/releases/latest)
[![Status: early](https://img.shields.io/badge/status-0.2.0%20early-orange)](docs/implementation_status.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/chat-dark.png">
  <img src="docs/images/chat-light.png" alt="Orglet team chat: one report back, workers and teams in the sidebar, no task list" width="900">
</picture>

</div>

## What

Orglet is a desktop app where you keep a few AI workers, each with a name, a role and their own instructions, and give them work in a normal chat.

- **Use the AI plan you already pay for.** Workers can run on the Claude Code, Codex, Cursor Agent or Gemini CLI account you are signed in to, so there is no extra API bill.
- **Keep your data on your computer.** No Orglet account, no Orglet server. Chats, workers and files live in a local database.
- **Made for one person.** Freelancers, solo founders and anyone who uses ChatGPT or Claude every day and wants a bit more structure.

Click a **team** or **worker** in the sidebar to open that chat. One live conversation each; a new message is a turn, not a new task. Team chats plan, run members as hidden jobs, and bring one report back. Internal jobs stay under **Details**. [How it works](docs/team-chat.md).

Reply to a saved user or worker message to give the next turn a precise reference, or react without starting a run. Team messages appear in Details with the same actions. Reactions and reply links stay with the local chat and its backup; a reaction alone does not change permissions or dispatch work.

> Orglet is early. Expect rough edges, and check answers against your own sources before you rely on them.

| | |
|---|---|
| 💬 **Chat with a worker** | Click a worker. One live thread — a new message is a turn, not a new task. |
| 👥 **Chat with a team** | Click a team to open its chat. Members stay in the roster. One live thread per team. Type `@name` to tag who should take that turn. The lead plans, assigned members work, one report comes back. [How it works](docs/team-chat.md). |
| 📎 **Attach files safely** | A worker only reads the files you attach to that chat. Open any attached file to see what is in it: text and code with line numbers, Markdown, CSV tables, JSON trees, images, video, audio and PDF pages. Workers read the text of a PDF (invoices, contracts, statements), pulled out on your computer. Images and screenshots are shown to connections that can see them; a connection that cannot says so. Video and audio are still preview-only. [Which connections see images](docs/capabilities.md#pdfs-and-images). |
| 📄 **Reports as documents** | Ask for a report and it opens like a file. Copy it as plain text or Markdown, or download it. |
| 🔁 **Repeat work on a schedule** | Schedules send the same request every day or week while Orglet is open. If the computer was off, missed runs become one catch-up you can run or skip; the next time stays on the calendar. A schedule can instead start when a new file lands in a folder you pick, or only when `orglet run` calls it; those fire only while the app is open and never replay what happened while it was closed ([how](docs/routines.md#what-starts-a-routine)). Each run shows in the sidebar under its orglet or crew, named after the schedule, and Orglet tells you when it is done, with a system notification if you are in another app ([where](docs/routines.md#where-a-run-shows-up)). |
| 📚 **Reuse what works** | Save skills and notes that workers use in later chats. |
| 🗂️ **Stay tidy** | Archive a chat to start over. Archive or delete workers and teams. Archived items can clear themselves after 7 or 30 days. |
| 🌐 **Your language** | US English by default, with UK English and Vietnamese in Settings. |

<p align="center">
  <img src="docs/images/new-task.png" alt="Empty worker chat in Orglet. The sidebar lists teams and workers, not a pile of tasks." width="720">
</p>

Workers can run through a local CLI, an API key, or Demo:

| Option | What you need | Cost |
|---|---|---|
| Claude Code on this computer | Claude Code installed **and signed in** | Your Claude plan |
| Codex on this computer | Codex installed **and signed in** | Your ChatGPT plan |
| Cursor Agent on this computer | Cursor Agent CLI installed **and signed in** | Your Cursor plan |
| Gemini CLI on this computer | Gemini CLI installed **and signed in** (Sign in with Google, or its own API key) | Your Google account's Gemini allowance |
| OpenAI, Anthropic, Grok (xAI) or OpenRouter API | An API key saved in Settings | Pay per use, with limits you set |
| OpenCode Zen API | A Zen API key saved in Settings | Pay per use from your Zen balance. Orglet does not track Zen spending or apply its task budget; set a spending limit in the OpenCode Zen console |
| OpenCode Go API | A Go API key saved in Settings (a separate connection from Zen) | Your Go subscription and its 5-hour, weekly and monthly limits, not Orglet budgets |
| Ollama on this computer | Ollama running locally | Local, no Orglet budget |
| Any OpenAI-compatible server (LM Studio, Groq, DeepSeek, Mistral, a company proxy) | A name, a base URL and, if the server needs one, an API key, added in Settings | Free when the server is on this computer or a private network; otherwise the price per 1M tokens you enter, or held as an unknown charge until you enter the real cost |
| Demo | Nothing | Free, sample replies only |

Each API or harness worker can use a model ID from **that provider's own list** (cached 24 hours in the local database) or a typed custom ID. Catalog names such as GPT-4.1 mini are suggestions, not a lock. If the list is empty or fails to load, you can still type an ID. When the cached list marks the selected (or suggested) model as deprecated, the picker shows a quiet chip; a sunset date appears only if that provider's API included one (OpenAI `shutdown_date`). Anthropic, xAI and harness lists have no native dates, so Orglet does not invent them. OpenCode Zen and Go have no default model: pick one from that plan's own list. Orglet calls them over the chat/completions endpoint only, so models the OpenCode docs put on another endpoint (Claude, GPT, Gemini and some others) are listed as **Not supported** instead of being sent the wrong request. Details: [model-list-fetch.md](docs/model-list-fetch.md).

**Settings → General** sets the theme, the accent colour and the two fonts. The interface asks for SF Pro first and falls back to Inter, which ships with the app along with JetBrains Mono, so text always renders; either can be swapped for a family you have, with a preview in the picker and, for the code font, a light and a dark sample with real syntax colours. Details: [technical guide](docs/technical-guide.md#appearance).
A worker remembers its chats. It keeps short lines about how you like things done, which files you mean and what was decided, and carries them into the next chat. Every memory is on the worker's own page (**Edit → Memory**), where you can correct, pin or delete it; an answer says which ones it used. A line learned from a web page, a file or another worker waits for your review first. Details: [memory](docs/memory.md).

A worker also learns from the feedback it already gets. When you keep asking it to revise, give its answers a thumbs-down, or its reports keep failing a check, its next chat shows the evidence and it may propose one sentence for its own instructions: a card with the sentence before and after and the chats it came from, which always waits for your click, even with automatic app changes on. Apply is a worker revision with Undo; Dismiss means it will not ask again for that reason. Details: [self-improvement](docs/self-improvement.md).

The `orglet` command talks to the running app from a terminal, like VS Code's `code`: `orglet send "Summarise this" --to Researcher --file notes.txt` sends a message into that chat and prints the answer, and `orglet read`, `list`, `status` and `open` do what they say. Run `orglet` on its own to pick an orglet and chat with it in the terminal, with its face drawn in its colour. Keys, chats and files stay in the app, and the command cannot change settings, permissions or folders. On Windows, **Settings → About → Add to PATH** installs it. Details: [the orglet command](docs/cli.md).

On Windows you can also select files in File Explorer and choose **Send to → Orglet**: Orglet asks which chat, then puts the files in its message box. `orglet://chat/Researcher` and `orglet://new?to=Researcher&text=…` links open a chat or prefill a message; they never send. Details: [Send to and orglet:// links](docs/integrations.md).

**Settings → MCP** adds MCP servers by hand, run on this computer or remote, so an orglet can use other services such as GitHub or a database. An orglet uses only the servers picked in its settings and asks you in the chat before it calls a tool; secret values are encrypted on this computer. Details: [MCP servers](docs/mcp.md).

**Settings → Data** backs the workspace up, restores it, and deletes what you no longer want kept: the chat history, the knowledge your workers built up, what they remembered, the sources you imported, or everything at once. Nothing there touches your API keys or your own files. Details: [technical guide](docs/technical-guide.md#deleting-data).

**Settings → Local harnesses** always shows Claude Code, Codex, Cursor Agent and Gemini CLI as **not installed**, **found on disk**, **signed in (ready)** or **sign-in error**. Found on disk is not ready to run. If sign-in fails, the screen gives the CLI login command to copy; Orglet does not switch to Demo.

API keys are encrypted with your system's secure storage and never reach the app's interface.

Orglet has no account and no server of its own. Requests go only to the provider or local tool you choose for a worker, using attached files and workspace folders you explicitly grant. If a worker submits a malformed report, Details shows the invalid field and Orglet allows one report-only correction without repeating completed file operations.

Start here: the [user guide](docs/user-guide.md), one short page per part of the app, or the [getting started](docs/getting-started.md) walk-through. The [docs map](docs/README.md) lists how-it-works pages, product decisions, and ship records. Product fit is [product.md](docs/product.md). How to run and test is [technical-guide.md](docs/technical-guide.md). How a worker's reads, searches, edits and commands appear in the chat, and where the diff of what it changed lives, is [worker-actions.md](docs/worker-actions.md).

[Agent tools and permissions](docs/agent-tools.md) explains task permissions, workspace grants and revocation. A worker's **Permissions** tab and a chat's **Details → Tool permissions** are the same controls: switches for attached sources, data checks and public web reads, and one dropdown for the working folder (no folder, read, read and edit, or read, edit and run). A control a worker cannot use yet is disabled with the reason beside it. Core can edit that folder, create folders and move, rename or delete files in it, and run isolated checks through private copies and conflict checks; a deleted file is kept in a private backup that Details can restore. API workers and the CLI tool bridge dispatch through these handlers; native CLI permission enforcement still needs live verification. Git workspace roots use separate worktrees based on the current files, including uncommitted edits. Search may be unavailable when its provider requires human verification.

For a task with two CSV, JSONL or Parquet sources, **Details → Sources → Compute exact-match accuracy** lets you choose the predictions file, answers file, ID column and value columns. The local checker reports matched/total and accuracy only when IDs align one-to-one and values have compatible types. It saves source hashes and the selected columns with the result. Run the checker before sending a new review turn; an earlier report stays unchanged. A team review can require this checker as evidence, but its result is only the selected exact-match calculation, not a challenge's official metric or proof that the task is solvable. See [technical-guide.md](docs/technical-guide.md) for limits and incomplete results.

Team progress shows who is doing each unfinished assignment, a short description, and who they are waiting for. Expand a long description to read the full assignment. **Details → Files and processes** keeps conflicts, saved output and unknown outcomes visible after a restart. After checking the current files, you can retire an interrupted attempt without retrying its effects or marking it successful.

API team leads can inspect a granted workspace read-only before assigning paths, record blocker resolutions, and reassign unfinished work within the turn's existing permissions. Reassignment retains dependencies and file ownership, with at most two attempts per assignment. A blocker report is saved for review but does not unlock dependent work; file assignments with no changes remain unfinished. Saved runs identify who actually completed a reassigned result.

A mistyped team-message recipient gets an error with the valid participants so the worker can correct it in the same run. Structured reports can cite completed workspace process IDs for command checks; unsupported checks stay unassessed instead of discarding completed files.
A `workspace_read` result has an evidence ID that a worker can cite in a finding about that file. Orglet checks the saved read, grant and unchanged file hash before accepting the report; a later edit requires another read. Details and backups retain the relative path and hash, but no local file path or contents. Uncited workspace observations remain visible as unverified limitations, and blocked QA work stays blocked for the lead to repair.

When a worker or team lead needs a material choice before continuing, it can pause the current chat turn with a short question. Choosing an option or answering in the composer resumes that same run; the decision stays visible in Details. Answering does not extend workspace or network permissions. A restored backup retains the question history but cannot resume its excluded checkpoint.

An API worker or team lead can also record how it understands the current turn: the goal, constraints stated by the user, assumptions it has made, and checks it plans to run. The latest goal appears in chat; the full record is in Details. Planned checks are intentions, not evidence that a check passed.

You can send a changed request while a worker or team is running. Orglet saves it as the next revision immediately, cancels the older run, and waits until that run has stopped before dispatching the new one. Already integrated files stay in history; uncertain effects and conflicts still need inspection. If the app closes while switching, the saved request waits for an explicit resume rather than replaying an unknown action.

When workspace commands run, chat shows a short count from their saved exit states: exit code 0, failed, or unfinished. File conflicts and uncertain tool calls remain visible beside that count; Details retains the commands, output and recovery controls. A planned check in the turn goal is still only a plan until evidence is recorded.

If an API request fails or its provider omits usage, Orglet keeps the budget reservation and shows it under **Settings → Cost & limits**. After checking the provider's usage page or invoice, you can record the actual USD charge, including zero only when confirmed. The original hold and adjustment remain in local history and backups; Orglet never guesses that a failed request was free.

## Install

[Latest GitHub Release](https://github.com/codepawl/orglet/releases/latest) includes an unsigned Windows **Setup.exe** and **ZIP**. The release page shows the version and assets available now; [build from source](#dev) if you need the current `main` branch instead.

Windows installers are unsigned. macOS CI signs when Developer ID credentials are available and notarizes only when Apple credentials are also available; check that artifact's CI run before relying on Gatekeeper approval.

| Platform | Status |
|---|---|
| Windows | Public 0.2.x target. Unsigned ZIP and Squirrel Setup are on the [latest release](https://github.com/codepawl/orglet/releases/latest). SmartScreen may warn (unknown publisher); that is expected. See [windows-release-gates.md](docs/windows-release-gates.md). |
| macOS | ZIP of `Orglet.app` from `pnpm make` on a Mac, or a signed/unsigned ZIP from macOS CI depending on available credentials. A signed build needs notarization credentials too before Gatekeeper approval is verified. Not a GitHub Release asset yet. See [macos-packaging.md](docs/macos-packaging.md). |
| Linux | ZIP from `pnpm make` on Linux, or the `orglet-linux-zip` CI artifact. CI builds it and starts it headless on every pull request, but nobody has used it on a real Linux desktop yet, so treat it as untested. See [linux-packaging.md](docs/linux-packaging.md). |
| iOS and Android | Not started. The shape under discussion is a companion to a desktop workspace, not a port: a phone cannot run a worker. See [mobile.md](docs/mobile.md). |

### Updates

A Windows install from **Setup.exe** updates itself. It checks GitHub Releases shortly after launch and every few hours, downloads a new version in the background, and then offers a restart; if you skip it, the next launch uses the new version. **Settings → About** shows the version you run, lets you check by hand or turn automatic updates off, and lists what changed in each release. The ZIP build, macOS and Linux cannot update themselves; the same tab links to the releases page instead. Versions 0.2.3 and earlier have no updater, so install the next release by hand once. Details in the [technical guide](docs/technical-guide.md#about-and-updates).

## Dev

You need Windows, macOS or Linux, Node 24.19 or newer and pnpm 11.19.0.

```
pnpm install --frozen-lockfile
pnpm dev
```

The Researcher worker starts on **Demo**, so you can try the app without any account.

To run the checks and build a package under `out/make`:

```
pnpm typecheck
pnpm test
pnpm make
```

On Windows that writes a ZIP and Squirrel Setup (unsigned). On macOS it writes a ZIP of `Orglet.app`. Local macOS makes stay unsigned unless `APPLE_SIGNING_ENABLED=true` and a Developer ID identity is in the keychain; CI signs when secrets exist. Notarization is a separate Apple ID / API key step.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first; it covers setup, checks, the pull request flow, and how to work with an AI coding agent in this repo. Coding agents should start at [AGENTS.md](AGENTS.md). Contributions need the [Contributor License Agreement](CLA.md), and everyone follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately as described in [SECURITY.md](SECURITY.md).

Questions and ideas go to [Discussions](https://github.com/codepawl/orglet/discussions).

## License

Orglet is free software under the [GNU Affero General Public License v3.0](LICENSE). You can use, study, change and share it. If you share Orglet, or let other people use a changed version over a network, you must also share the source under the same license.

For a commercial license without those terms, contact legal@codepawl.com.

Copyright (C) 2026 Nguyen Xuan An (CodePawl).

Tool access is checked by core against both the run's frozen permissions and the task's current permissions. Reducing permissions cancels active work; restored backups do not restore tool grants. See [tool permissions](docs/agent-tools.md).

Team assignments record an expected output, dependencies and editable resources. Independent work can run in parallel; overlapping resources are serialized, and a dependent worker waits for a committed prerequisite result.

The Windows workspace backend provides bounded file operations and isolated command processes in private copies. Public web tools require a separate task capability. The desktop controls and guarded integration of edited files are delivered separately; see [agent tools](docs/agent-tools.md).

Ask a worker to set the app up and it proposes rather than acts: a new orglet, a crew, a template, a skill, a schedule or a setting each arrive as a card in the chat that you apply or dismiss, through the same validation the dialogs use. A per-orglet switch can apply the safe ones automatically with Undo; raising a limit or anything proposed after reading the web, files or other workers' messages still waits for your click, and keys, connections, permissions and backups cannot be proposed at all. See [proposing app changes](docs/agent-tools.md#proposing-app-changes).

Team workers can exchange durable questions, responses, blockers and handoffs within one turn. The lead resolves blockers or reassigns unfinished work to an existing member without expanding its permissions. See [worker messages](docs/team-chat.md#worker-messages).

Workspace edits are integrated from private copies with version checks. Conflicts and interrupted writes remain visible and block automatic replay. Git workspaces use private worktrees; the original checkout is not used for worker commands. API workers and the three CLI adapters share the core tool dispatcher.
