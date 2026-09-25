# Settings

**Settings** is the last button in the sidebar footer. Nine tabs, each a few rows.

Part of the [user guide](user-guide.md).

## General

Language (English (US), English (UK), Tiếng Việt), **Appearance** (light or dark), accent colour, logo colour, and the two fonts. The interface asks for SF Pro and falls back to Inter, which ships with the app; code uses JetBrains Mono. Either can be swapped for a family installed on this machine, with a preview. Details: [technical guide → Appearance](technical-guide.md#appearance).

## Chat

- **Name chats automatically**: a title from the first message.
- **Copy format** and **Download format**: plain text or Markdown for answers and reports.
- **Ask before opening a task**.
- **Delete archived items**: archived chats, orglets and crews can clear themselves after a while.

## API connections

Turn a provider on, paste its key or pick a `.txt` file, save. Ollama is a switch with no key. **Custom connections** below the list add any OpenAI-compatible server by name, base URL and an optional key. See [Connections → API keys](connections.md#api-keys) and [Connections → Custom connections](connections.md#custom-connections).

## Web search

Where an orglet's web searches go. Orglets send only the search query, never chat text or files.

- **Provider**: **Exa** (the default) or **DuckDuckGo**. Exa is free without a key but rate-limited: when its free searches run out, a search fails with a message that says so, and they come back later (on 2026-09-26 the limit reset at midnight UTC). DuckDuckGo reads its plain results page, which often asks for human verification instead of answering.
- **Exa API key** (Exa only, optional): paste a key from **Get a key** (dashboard.exa.ai) and choose **Save key**. Searches then count against your Exa account instead of the free limit. The key is encrypted on this computer like the API keys and never shown again; **Remove key** deletes it.
- **Try a search**: **Test** sends one real query ("Wikipedia") to the provider and shows the first result's title, or the error an orglet would get.

A failed search never switches to the other provider. The switch under **Read and search the web** in a chat's permissions names the provider in use. How it works: [agent tools → Web search](agent-tools.md#web-search).

## Local harnesses

Claude Code, Codex, Cursor Agent and Gemini CLI: whether each is installed and signed in, its login command, its accounts with how much of each plan is used, and **Rescan**. See [Connections → Local harnesses](connections.md#local-harnesses-claude-code-codex-cursor-agent-gemini-cli).

## MCP

MCP servers you add by hand, run on this computer or remote: each row shows whether it is connected, its tools, a switch to turn it off, and **Test connection**, **Edit** and **Remove**. **Import from a file** reads a JSON file you pick; Orglet never reads another app's MCP settings on its own. Secret values are encrypted on this computer and never shown again. See [MCP servers](mcp.md).

## Browser

The browser Orglet found (Chrome, or Edge when Chrome is not installed), the **Clean** profile every chat starts with, and the profiles you made. **Add profile** makes one; **Open to sign in** opens it in a normal window so you can sign in to sites yourself; its menu has **Close window**, **Clear data** and **Delete profile**. Profiles stay on this computer and never go into a backup. See [Orglet's browser](browser.md#profiles).

## Costs & limits

- **Limit per connection / month**: a cap on what Orglet may spend through each API key, by UTC month.
- **Concurrent requests per provider** (1–8): how many model requests may be in flight at once across all chats. Above 4, a short note says that more at once means more spend at once.
- **Allowed providers**.
- **Charges to reconcile**: requests that failed or came back without usage keep their reservation. After checking the provider's usage page, enter the actual amount; enter zero only when the provider shows zero. See [Connections → Cost limits](connections.md#cost-limits).

These numbers cover requests Orglet makes through an API key. Harness runs use the CLI's own plan and are not counted here.

## Data

### Backup and restore

**Save backup** writes one JSON file with orglets, crews, revisions, schedules, chat history, answers and reports, checker results, memories and knowledge, reactions and costs. It does **not** include API keys, source file contents, the working-folder grants, checkpoint context, or the proposal cards in chats; reports can contain excerpts of your sources, so keep the file private. The limit is 50 MB.

**Restore from file** validates the backup and adds the records that are missing; what is already there stays. Restored schedules come back disabled, restored sources have no file access until you attach the files again, and a restored backup grants no folder or web access. Interrupted requests are not resent.

### Erase

Each row refuses while a run, schedule or check is in progress, and reports what it removed. None of them touches your API keys or your own files.

| Row | Removes |
|---|---|
| **Delete chat history** | Every chat, answer and report. Orglets, crews, skills and knowledge stay; a chat that cost money keeps its cost figures. |
| **Delete knowledge** | Every note, including ones waiting for review. Memory stays. |
| **Delete memory** | Every memory in every scope, including ones waiting for review. Notes stay. |
| **Delete imported sources** | Orglet's record of the files you attached. Your files are untouched; a source a chat still refers to is revoked instead so that chat still opens. |
| **Erase all data** | Everything. Asks you to type `Orglet`. The workspace comes back as a fresh install with the Researcher. Browser profiles are kept, like API keys; delete them in **Settings → Browser**. |

Where the data lives: `%APPDATA%\orglet\orglet.sqlite` on Windows, `~/Library/Application Support/Orglet/orglet.sqlite` on macOS. Opening the workspace with a newer build first saves a copy of the database; how to roll back is in [recovery.md](recovery.md).

## About

The Orglet face and the version you run. The face says hello when the tab opens, looks at your pointer, and hops when you click it or press Enter on it; with reduced motion turned on in Windows it stays still. Then **Build details** (Electron, Chromium, Node and SQLite versions, the OS, and how the build was installed) with a **Copy** button for bug reports. Links to the website, GitHub, Discord, X and Threads.

**orglet command in the terminal** is the `orglet` command for sending messages and reading answers from a terminal. On Windows, Setup already put it on your PATH; **Remove from PATH** takes it off and keeps it off through updates, and **Add to PATH** puts it back. On macOS the row shows the line to add yourself. See [the orglet command](cli.md).

**Send to Orglet in Explorer** (Windows only) is the switch for Orglet in File Explorer's **Send to** menu. Setup turns it on. Turning it off removes the entry and keeps it off through updates; turning it on puts it back. See [Send to and orglet:// links](integrations.md).

**What is new** lists the last ten releases, the one you run marked. Each shows its version, its date and what changed; the install advice every release page repeats is left out. It is fetched from GitHub once an hour; offline, it shows the last copy and when it was fetched.

**Check for updates** shows one state at a time: not checked yet, checking, up to date with the time, downloading, ready with **Restart now**, or the error. **Automatic updates** (on by default) checks 30 seconds after launch and every four hours, downloads in the background, then asks you to restart; if you do not, the next launch uses the new version. Off, it checks only when you click.

| Build | Updates itself |
|---|---|
| Windows, installed with Setup.exe | Yes |
| Windows ZIP | No; the row links the releases page |
| macOS, signed by CI | Yes, once a release carries a macOS ZIP |
| macOS unsigned, Linux ZIP, run from source | No; the row links the releases page |

Versions 0.2.3 and earlier have no updater; install a current release by hand once.
