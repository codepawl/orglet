# Connections

A **connection** is what runs an orglet's model: a coding CLI already signed in on this computer, an API key, a local Ollama, or Demo. Each orglet has one, chosen under **Model** in its settings. Nothing runs through an Orglet server; requests go from this computer to the provider or tool you picked.

Part of the [user guide](user-guide.md). The full technical detail, including the exact flags each CLI runs with, is in the [technical guide](technical-guide.md#local-harnesses-claude-code-codex-cursor-agent-gemini-cli); what each connection can and cannot do is in the [capability catalog](capabilities.md).

| Connection | What you need | Cost |
|---|---|---|
| Claude Code on this computer | Claude Code installed **and signed in** | Your Claude plan |
| Codex on this computer | Codex installed **and signed in** | Your ChatGPT plan |
| Cursor Agent on this computer | Cursor Agent CLI installed **and signed in** | Your Cursor plan |
| Gemini CLI on this computer | Gemini CLI installed **and signed in** (Sign in with Google, or its own API key) | Your Google account's Gemini allowance |
| OpenAI, Anthropic, Grok (xAI), OpenRouter | An API key saved in Settings | Pay per use, within limits you set |
| OpenCode Zen, OpenCode Go | A Zen or Go key saved in Settings (two separate connections) | Your Zen balance or Go subscription; Orglet does not track or cap this spending |
| Ollama on this computer | Ollama running at `127.0.0.1:11434` | Local, free |
| A custom connection | A name, a base URL and, if the server needs one, an API key; optionally its price | Free on this computer or a private network; otherwise the price you enter, or unknown until you reconcile it |
| Demo | Nothing | Free, sample replies only |

## Local harnesses (Claude Code, Codex, Cursor Agent, Gemini CLI)

A harness runs the orglet through the CLI's own account, so the cost lands on the plan you already pay for.

1. Install the CLI and sign in to it in your own terminal (`claude auth login`, `codex login` or `agent login`). Gemini CLI has no login command: run `gemini`, choose **Sign in with Google**, finish in the browser, then type `/quit`.
2. Open **Settings → Local harnesses**. Each row shows one of four states: **Not installed**, **Found on disk** (installed, not signed in), **Signed in** (ready to run) or **Sign-in error** (the status check failed). Found on disk is not ready.
3. If a row is not signed in, copy the login command it shows and run it, then choose **Rescan**. On Windows, pick your terminal beside the command first (PowerShell, Command Prompt or Git Bash); each needs its own line, and Orglet remembers the one you pick. Orglet never switches an orglet to Demo when sign-in fails.
4. Open the orglet's settings and set **Model** to that harness. The model ID is optional; empty keeps the CLI's default.

Orglet finds each CLI on `PATH` and in its usual install locations, including the copy the Claude or Codex desktop app downloaded and the npm global folder. It only ever runs each CLI's `--version` and login-status command to detect it. Gemini CLI has no login-status command, so Orglet reads its sign-in from the CLI's own `.gemini` folder instead (the method it chose and whether a Google sign-in is cached), without touching it. The desktop app's own session is not reused; the CLI must be signed in itself.

**Accounts.** A harness row can hold more than one sign-in. **Default account** is what the CLI already has on this machine. The row's menu adds, renames and removes accounts; each is a private config folder that Orglet points the CLI at when it runs, and the login command the row copies signs in to the selected account. Orglet never copies or changes the credentials in those folders. Removing an account deletes its folder and that sign-in. Gemini CLI accounts work the same way through its `GEMINI_CLI_HOME` folder, as long as the CLI keeps its sign-in in files (its default). With `GEMINI_FORCE_ENCRYPTED_FILE_STORAGE` set, Gemini CLI keeps one sign-in in the system keychain for every folder, so only the default account is useful.

**Plan usage.** A signed-in row shows the account's address and plan, and how much of each allowance it has used (the current session, the week, a week limited to one model) with when it resets. The account picker shows the same for every account, so you can switch to one that still has room. Claude Code and Codex report these numbers; Cursor Agent reports only the account and plan, and Gemini CLI only the Google account. For Claude Code, Orglet sends the CLI's own sign-in token to Anthropic's usage endpoint and nowhere else. If the token has expired, open Claude Code once and choose **Rescan**.

When a reply stops because the account ran out, the bar above the message box offers another account that still has room, for example **Use Work · 70% left**. One click switches to it and runs the turn again. If no other account has room, it says when yours resets.

**What a harness run can do.** With no working folder, web or data checks, a harness chat is one CLI call: the CLI gets a private copy of the attached files and nothing else, no shell, no network, no MCP servers, and it ignores your own hooks, plugins and instruction files. With a working folder, web or data checks turned on, or an MCP server picked for the orglet, every file read, edit, command, web read and MCP call goes through Orglet's own tools and permissions instead of the CLI's, so the same controls apply as for an API orglet. The CLI's own MCP stays off; your [MCP servers](mcp.md) reach a harness orglet only through Orglet's tool loop, one approved call at a time. Orglet never adds `--force` or `--yolo` to Cursor Agent, or `--yolo` to Gemini CLI. Gemini CLI gets none of its own tools on any run, not even file reads: the attached files' text goes in the prompt, the way it does for Codex. It also runs without your extensions, MCP servers, skills, hooks and `GEMINI.md` files. A harness run stops after 15 minutes; cancel stops the process.

Gemini CLI writes a transcript of every session under `.gemini/tmp` in its own folder and has no switch to turn that off, so each Orglet run leaves one there too. Claude Code and Codex runs keep no such record.

**Cost.** Harness runs make no Orglet budget reservation. Claude Code reports an estimate per call, which the chat shows. An orglet on Claude Code runs on your plan with no cap unless you give it a **Limit per task**: the field is optional there and empty means no limit. When it has one, or when it works in a crew, a group chat or a schedule (which always carry a limit), Orglet passes what is left of that limit to Claude Code as its own cap, so a run that reaches it stops and the chat says **Waiting for budget** with the setting to raise. Orglets that were saved with the old $0.50 default the form used to force get no cap after updating; a limit you picked yourself is kept. Codex, Cursor Agent and Gemini CLI report no cost, so those runs are unknown spend against your plan. Gemini CLI does report its token counts, which the chat shows.

## API keys

1. Open **Settings → API connections** and turn on the provider.
2. Paste the key and choose **Save key**, or choose **From file** and pick a `.txt` file that holds it. Turn the switch off to disconnect.
3. In the orglet's settings, set **Model** to that provider and pick a model ID.

Keys are encrypted with your system's secure storage (DPAPI on Windows, Keychain on macOS) and stored next to the database, not in it. The window never shows a saved key again, backups do not include keys, and erasing data in **Settings → Data** does not touch them. A saved key does not prove the account has credit.

Ollama has no key: turn its switch on while Ollama is running locally.

## Custom connections

Any server that speaks the OpenAI chat/completions API can be a connection of its own: LM Studio at `http://localhost:1234/v1`, Groq, DeepSeek, Mistral, Together, Fireworks or a proxy at work. You can add up to 16, and each one is a model choice for an orglet.

1. Open **Settings → API connections** and choose **Add connection** under **Custom connections**.
2. Give it a name you will recognise, and the base URL: the address that ends right before `/chat/completions` and `/models`, usually with `/v1`.
3. Paste an API key if the server needs one. A local server such as LM Studio usually does not; leave the field empty and Orglet sends no key at all.
4. If the server charges, enter its **Input price** and **Output price** per 1M tokens, in your display currency. Enter both or neither.
5. Choose **Save**. In the orglet's settings, pick the connection under **Model**, then pick a model from its list or type the ID. A custom connection has no default model, so a model ID is required.

The model list comes from the server's own `GET /models`, cached for 24 hours like the other lists. If the server does not answer, type the model ID yourself.

**Which addresses are allowed.** `https://` works for any host. Plain `http://` is allowed only for this computer (`localhost`, `127.0.0.1`, `::1`) and private-network addresses (`10.x`, `172.16–31.x`, `192.168.x`, `169.254.x`, `100.64–127.x`, `fc00::/7`, `fe80::/10`, and `.local` names). For any other host Orglet refuses `http://` instead of warning about it, because the key and every prompt would cross the internet unencrypted. An address may not carry a user name, a password, a `?query` or a `#fragment`; the key goes in its own field, where it is encrypted.

**The key.** It is kept like any other API key: encrypted with your system's secure storage, one file per connection, never shown again and never in a backup. The row only says whether a key is saved. **Remove API key** in the row's menu drops it; **Delete connection** drops the connection and its key, and is refused while an orglet still uses it.

**Cost.** The row in Settings and the model picker say which of three prices a connection has.

- **Local · free.** A server on this computer or a private network (the same addresses plain `http://` is allowed for) costs nothing unless you enter a price. Requests hold nothing against your limits, so a chat can send message after message. The tokens are still counted.
- **The price you entered.** Each request is held against the chat's **Limit per task**, the connection's monthly limit and the crew's limit at that price, then settled from the token counts the server reports, the same as the built-in paid APIs. An entered price also wins over the free default of a local server.
- **Price unknown.** A server elsewhere with no price entered. Each request holds the rest of the chat's limit and then waits in **Charges to reconcile** until you enter the real amount. Until you do, the chat's limit stays taken, so the next message waits for budget.

A reply that comes back without token counts stays unknown in **Charges to reconcile** whatever the price, so a missing count is never read as zero. On a free connection it holds nothing.

**Backups and erasing.** A backup carries each connection's name and address, never its key; restoring one adds the connections this computer does not have and, where a name is already taken, adds a number to it. A restored connection that needs a key waits for it in Settings. **Erase all data** keeps custom connections, like it keeps API keys.

## Model IDs

For everything but Demo, an orglet has a model ID. The picker lists that provider's own models, fetched from the provider's API or CLI and cached on this computer for 24 hours; you can also type any ID. Built-in names such as GPT-4.1 mini are suggestions, not a lock. If the list fails to load, typing still works.

When the provider's own list marks the chosen model as deprecated, the picker shows a quiet chip; a sunset date appears only when the provider included one. OpenCode Zen and Go have no default: pick a model from that plan's list, and models the OpenCode docs put on another endpoint show as **Not supported**. Details: [model-list-fetch.md](model-list-fetch.md).

## Cost limits

Orglet counts only requests it makes itself through an API key. Harness runs count against their own plan, and Ollama is free.

- **Limit per task** on an orglet or crew caps what one chat may spend. Raising it applies to the next turn of an existing chat.
- **Settings → Costs & limits** sets a monthly limit per connection, how many requests may run at once per provider (1–8), and which providers are allowed. It also lists **Charges to reconcile**: requests that failed or came back without usage keep their reservation until you check the provider's bill and enter the real amount. Orglet never assumes a failed request was free.
- A crew also has a monthly limit of its own.

Cancelling a run stops further requests; a request already in flight may still be billed.
