# Connections

A **connection** is what runs an orglet's model: a coding CLI already signed in on this computer, an API key, a local Ollama, or Demo. Each orglet has one, chosen under **Model** in its settings. Nothing runs through an Orglet server; requests go from this computer to the provider or tool you picked.

Part of the [user guide](user-guide.md). The full technical detail, including the exact flags each CLI runs with, is in the [technical guide](technical-guide.md#local-harnesses-claude-code-codex-cursor-agent); what each connection can and cannot do is in the [capability catalog](capabilities.md).

| Connection | What you need | Cost |
|---|---|---|
| Claude Code on this computer | Claude Code installed **and signed in** | Your Claude plan |
| Codex on this computer | Codex installed **and signed in** | Your ChatGPT plan |
| Cursor Agent on this computer | Cursor Agent CLI installed **and signed in** | Your Cursor plan |
| OpenAI, Anthropic, Grok (xAI), OpenRouter | An API key saved in Settings | Pay per use, within limits you set |
| OpenCode Zen, OpenCode Go | A Zen or Go key saved in Settings (two separate connections) | Your Zen balance or Go subscription; Orglet does not track or cap this spending |
| Ollama on this computer | Ollama running at `127.0.0.1:11434` | Local, free |
| Demo | Nothing | Free, sample replies only |

## Local harnesses (Claude Code, Codex, Cursor Agent)

A harness runs the orglet through the CLI's own account, so the cost lands on the plan you already pay for.

1. Install the CLI and sign in to it in your own terminal (`claude auth login`, `codex login` or `agent login`).
2. Open **Settings → Local harnesses**. Each row shows one of four states: **Not installed**, **Found on disk** (installed, not signed in), **Signed in** (ready to run) or **Sign-in error** (the status check failed). Found on disk is not ready.
3. If a row is not signed in, copy the login command it shows and run it, then choose **Rescan**. On Windows, pick your terminal beside the command first (PowerShell, Command Prompt or Git Bash); each needs its own line, and Orglet remembers the one you pick. Orglet never switches an orglet to Demo when sign-in fails.
4. Open the orglet's settings and set **Model** to that harness. The model ID is optional; empty keeps the CLI's default.

Orglet finds each CLI on `PATH` and in its usual install locations, including the copy the Claude or Codex desktop app downloaded. It only ever runs each CLI's `--version` and login-status command to detect it. The desktop app's own session is not reused; the CLI must be signed in itself.

**Accounts.** A harness row can hold more than one sign-in. **Default account** is what the CLI already has on this machine. The row's menu adds, renames and removes accounts; each is a private config folder that Orglet points the CLI at when it runs, and the login command the row copies signs in to the selected account. Orglet never copies or changes the credentials in those folders. Removing an account deletes its folder and that sign-in.

**Plan usage.** A signed-in row shows the account's address and plan, and how much of each allowance it has used (the current session, the week, a week limited to one model) with when it resets. The account picker shows the same for every account, so you can switch to one that still has room. Claude Code and Codex report these numbers; Cursor Agent reports only the account and plan. For Claude Code, Orglet sends the CLI's own sign-in token to Anthropic's usage endpoint and nowhere else. If the token has expired, open Claude Code once and choose **Rescan**.

When a reply stops because the account ran out, the bar above the message box offers another account that still has room, for example **Use Work · 70% left**. One click switches to it and runs the turn again. If no other account has room, it says when yours resets.

**What a harness run can do.** With no working folder, web or data checks, a harness chat is one CLI call: the CLI gets a private copy of the attached files and nothing else, no shell, no network, no MCP servers, and it ignores your own hooks, plugins and instruction files. With a working folder, web or data checks turned on, every file read, edit, command and web read goes through Orglet's own tools and permissions instead of the CLI's, so the same controls apply as for an API orglet. Orglet never adds `--force` or `--yolo` to Cursor Agent. A harness run stops after 15 minutes; cancel stops the process.

**Cost.** Harness runs make no Orglet budget reservation. Claude Code reports an estimate per call, which the chat shows and counts toward the chat's **Limit per task**; Orglet also passes what is left of that limit to Claude Code as its own cap, so a run that reaches it stops and the chat says **Waiting for budget** with the setting to raise. Codex and Cursor Agent report no cost, so those runs are unknown spend against your plan.

## API keys

1. Open **Settings → API connections** and turn on the provider.
2. Paste the key and choose **Save key**, or choose **From file** and pick a `.txt` file that holds it. Turn the switch off to disconnect.
3. In the orglet's settings, set **Model** to that provider and pick a model ID.

Keys are encrypted with your system's secure storage (DPAPI on Windows, Keychain on macOS) and stored next to the database, not in it. The window never shows a saved key again, backups do not include keys, and erasing data in **Settings → Data** does not touch them. A saved key does not prove the account has credit.

Ollama has no key: turn its switch on while Ollama is running locally.

## Model IDs

For everything but Demo, an orglet has a model ID. The picker lists that provider's own models, fetched from the provider's API or CLI and cached on this computer for 24 hours; you can also type any ID. Built-in names such as GPT-4.1 mini are suggestions, not a lock. If the list fails to load, typing still works.

When the provider's own list marks the chosen model as deprecated, the picker shows a quiet chip; a sunset date appears only when the provider included one. OpenCode Zen and Go have no default: pick a model from that plan's list, and models the OpenCode docs put on another endpoint show as **Not supported**. Details: [model-list-fetch.md](model-list-fetch.md).

## Cost limits

Orglet counts only requests it makes itself through an API key. Harness runs count against their own plan, and Ollama is free.

- **Limit per task** on an orglet or crew caps what one chat may spend. Raising it applies to the next turn of an existing chat.
- **Settings → Costs & limits** sets a monthly limit per connection, how many requests may run at once per provider (1–4), and which providers are allowed. It also lists **Charges to reconcile**: requests that failed or came back without usage keep their reservation until you check the provider's bill and enter the real amount. Orglet never assumes a failed request was free.
- A crew also has a monthly limit of its own.

Cancelling a run stops further requests; a request already in flight may still be billed.
