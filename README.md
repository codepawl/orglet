<div align="center">

<img src="apps/desktop/assets/icon.svg" alt="Orglet logo" width="88" height="88">

# Orglet

**Your own small team of AI workers, on your computer.**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D4)](#download)
[![Status: early](https://img.shields.io/badge/status-early-orange)](docs/implementation_status.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/chat-dark.png">
  <img src="docs/images/chat-light.png" alt="Orglet with three workers answering the same message in one chat" width="900">
</picture>

</div>

## What is Orglet?

Orglet is a desktop app where you keep a few AI workers, each with a name, a role and their own instructions, and give them work in a normal chat.

- **Use the AI plan you already pay for.** Workers can run on the Claude Code or Codex account you are signed in to, so there is no extra API bill.
- **Keep your data on your computer.** No Orglet account, no Orglet server. Chats, workers and files live in a local database.
- **Made for one person.** Freelancers, solo founders and anyone who uses ChatGPT or Claude every day and wants a bit more structure.

> Orglet is early. Expect rough edges, and check answers against your own sources before you rely on them.

## Features

| | |
|---|---|
| 💬 **Chat with a worker** | Ask questions, talk things through or hand over a job. Follow-ups keep the earlier conversation. |
| 👥 **Work as a team** | Send one message to a single worker, a few of them, everyone, or a team that combines their answers. |
| 📎 **Attach files safely** | A worker only reads the files you attach to that task. |
| 📄 **Reports as documents** | Ask for a report and it opens like a file. Copy it as plain text or Markdown, or download it. |
| 🔁 **Repeat work on a schedule** | Schedules send the same request every day or week while Orglet is open. |
| 📚 **Reuse what works** | Save skills and notes that workers use in later tasks. |
| 🗂️ **Stay tidy** | Archive or delete tasks, workers and teams. Archived items can clear themselves after 7 or 30 days. |
| 🌐 **Your language** | US English by default, with UK English and Vietnamese in Settings. |

<p align="center">
  <img src="docs/images/new-task.png" alt="Starting a new task in Orglet" width="720">
</p>

## Download

| Platform | Status |
|---|---|
| 🪟 Windows | Build from source today. Installers come with the first release. |
| 🍎 macOS | Coming soon |
| 🐧 Linux | Coming soon |
| 📱 iOS and Android | Coming soon |

## How workers run

| Option | What you need | Cost |
|---|---|---|
| Claude Code on this computer | Claude Code installed and signed in | Your Claude plan |
| Codex on this computer | Codex installed and signed in | Your ChatGPT plan |
| OpenAI or Anthropic API | An API key saved in Settings | Pay per use, with limits you set |
| Demo | Nothing | Free, sample replies only |

API keys are encrypted with your system's secure storage and never reach the app's interface.

## Run it from source

You need Windows, Node 24.19 or newer and pnpm 11.19.0.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

The Researcher worker starts on **Demo**, so you can try the app without any account.

To run the checks and build an unsigned installer under `out/make`:

```powershell
pnpm typecheck
pnpm test
pnpm make
```

## Privacy

Orglet has no account and no server of its own. Requests go only to the provider or local tool you choose for a worker, and only with the files you attached.

## Learn more

- [Product direction](docs/product.md): who Orglet is for and what it should do well
- [Technical guide](docs/technical-guide.md): providers, harnesses, limits, checks and smoke tests
- [Implementation status](docs/implementation_status.md): what is verified and what is left

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Contributions need the [Contributor License Agreement](CLA.md), and everyone follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately as described in [SECURITY.md](SECURITY.md).

Questions and ideas go to [Discussions](https://github.com/codepawl/orglet/discussions).

## License

Orglet is free software under the [GNU Affero General Public License v3.0](LICENSE). You can use, study, change and share it. If you share Orglet, or let other people use a changed version over a network, you must also share the source under the same license.

For a commercial license without those terms, contact legal@codepawl.com.

Copyright (C) 2026 Nguyen Xuan An (CodePawl).
