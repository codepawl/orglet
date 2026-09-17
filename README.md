# Orglet

Your own small team of AI workers, on your computer.

Orglet is a desktop app for Windows, macOS and Linux. You create workers with a name, a role and their own instructions, then give them work in a normal chat. They can run on the Claude Code or Codex account you are already signed in to, so you don't need a separate API bill. Your chats, workers and files stay on your machine.

It is made for people who work alone and for anyone who uses ChatGPT or Claude every day and wants a bit more structure.

> Orglet is early. It is tested on Windows today; macOS and Linux builds are on the way. Expect rough edges, and check answers against your own sources before you rely on them.

## What you can do

- **Chat with a worker.** Ask questions, talk things through, or hand over a job. Follow-up messages keep the earlier conversation.
- **Build a small team.** Give one task to a single worker, several workers, everyone, or a team that combines its members' results.
- **Attach files safely.** A worker only reads the files you attach to that task.
- **Get reports as documents.** Ask for a report and it arrives as a file you open, copy as plain text or Markdown, or download.
- **Repeat work on a schedule.** Routines send the same request every day or week while Orglet is open.
- **Reuse what works.** Save skills and notes that workers can use in later tasks.
- **Stay tidy.** Archive or delete tasks, workers and teams. Archived items can clear themselves after 7 or 30 days.

The interface is in US English by default. Vietnamese and UK English are in Settings.

## How workers run

| Option | What you need | Cost |
|---|---|---|
| Claude Code on this computer | Claude Code installed and signed in | Your Claude plan |
| Codex on this computer | Codex installed and signed in | Your ChatGPT plan |
| OpenAI or Anthropic API | An API key saved in Settings | Pay per use, with limits you set |
| Demo | Nothing | Free, sample replies only |

API keys are encrypted with your system's secure storage (Windows DPAPI, macOS Keychain or the Linux secret service) and never reach the app's interface.

## Run it from source

You need Node 24.19 or newer and pnpm 11.19.0. Development and CI run on Windows for now.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Keep the Researcher worker on **Demo** to try the app without any account.

Checks and packaging:

```powershell
pnpm typecheck
pnpm test
pnpm make
```

`pnpm make` builds an unsigned installer under `out/make`.

## Learn more

- [Product direction](docs/product.md): who Orglet is for and what it should do well
- [Technical guide](docs/technical-guide.md): providers, harnesses, limits, checks and smoke tests
- [Implementation status](docs/implementation_status.md): what is verified and what is left

## Privacy

Orglet has no account and no server of its own. Data is stored in a local SQLite database. Requests go only to the provider or local tool you choose for a worker, and only with the files you attached.

## License

Orglet is free software under the [GNU Affero General Public License v3.0](LICENSE). You can use, study, change and share it. If you share Orglet, or let other people use a changed version over a network, you must also share the source under the same license.

If you want to use Orglet in a product without those terms, contact legal@codepawl.com about a commercial license.

Copyright (C) 2026 Nguyen Xuan An (CodePawl).

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first: contributions need the [Contributor License Agreement](CLA.md).
