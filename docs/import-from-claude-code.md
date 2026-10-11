# Import from Claude Code

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/orglets/mcp-dark.png">
  <img src="images/orglets/mcp-light.png" alt="" width="112" height="112" align="right">
</picture>

If you use Claude Code, you can bring its skills, commands, subagents and MCP servers into Orglet. Nothing is imported until you check it and press **Import**. Nothing you import runs.

Open **Library**, choose **Skills**, then **Import from Claude Code**.

## What Orglet reads

Only when you open the dialog, and only these places:

| Place | What it holds |
|---|---|
| `~/.claude/skills/<name>/SKILL.md` | Skills, with the files beside each one |
| `~/.claude/commands/**/*.md` | Commands, the older form of a skill |
| `~/.claude/agents/**/*.md` | Subagents |
| `mcpServers` in `~/.claude.json` | MCP servers for your user |

The dialog says which folder it read. **Choose a project folder** reads a project instead: its `.claude` folder, its `.mcp.json`, and the servers `~/.claude.json` keeps for that project. **Read the home folder** goes back.

Orglet reads only the `mcpServers` objects of `~/.claude.json`. It does not read, show or keep your account or anything else in that file.

The folders `synced` and `anthropic-skills` under `skills` are skipped: they are copies of your claude.ai account. A link inside the folder is followed only when it ends inside the folder or your home folder. Skills follow the same limits as a folder you pick: 256 KB a file, 1 MB and 100 files a package.

## What each thing becomes

Every item has a checkbox. An item whose name already exists in Orglet says **Already here** and cannot be checked. An item Orglet cannot take says why.

**Skills and commands** become skill packages, through the same path as **Import from a folder**. They wait for review in the Library before an orglet can use them. Orglet is as forgiving as Claude Code about what is missing:

- No `name`: the folder name is used, in lowercase with hyphens. A command in a subfolder is named `folder-file`.
- No `description`: the first line of the body is used. `when_to_use` is added after the description. The description is cut to 1,024 characters.
- Orglet keeps `license`, `compatibility`, `metadata` and `allowed-tools`. Every other field is left out, and the item lists each one, for example "hooks: not used by Orglet".
- `allowed-tools` that names a tool Orglet does not have makes the review block the package. The item says so.
- Text such as `` !`command` `` and `$ARGUMENTS` stays text. Orglet does not run or fill it, and the item says so.

**Subagents** become orglets. The file's name, description and body become the orglet's name, description and instructions.

- **Model.** When Claude Code is connected in Orglet, the orglet uses it with the model you named (`sonnet`, `opus` and so on). `inherit` or no model sets none. When Claude Code is not connected, the orglet starts on the provider a new orglet would start on, and the item says the model was not carried over.
- **Effort.** `low`, `medium`, `high` and `max` carry over. `xhigh` becomes `max`.
- **Skill.** An orglet has one skill. If a named skill already exists and has been reviewed, the orglet takes the first such skill. A skill that is imported in the same run waits for review, so the orglet starts on the default skill and the item tells you to pick the skill after the review.
- **Not carried over:** `tools`, `disallowedTools`, `permissionMode`, `mcpServers`, `hooks`, `memory`, `isolation`, `background`, `maxTurns`, `color`. Each one that is present is named. An imported orglet gets no permission, folder or MCP server beyond what a new orglet gets. You give those yourself.

**MCP servers** are saved the way **Import from a file** in [MCP settings](mcp.md) saves them, so keys stay encrypted by the app.

- `streamable-http` is read as `http`. `sse` is read as `http` too, with a note: if the server only speaks SSE, the connection test will fail. `ws` is not supported and is listed with that reason.
- `${VAR:-default}` becomes its default. A `${VAR}` with no default is never filled from Orglet's own environment. In an environment variable or a header it is left out, and the item names the variable so you can enter it in the server's settings. In a command, an argument or an address it is kept as written, and the item names it.
- The same name in more than one scope keeps the most local one.

## What you see

The dialog never shows a key, token or header value. For a server it shows the name, the transport and the host or command name only. After **Import**, each item says whether it was imported, skipped (with the reason) or failed. A failure message never repeats a secret.

## What does not happen

- No script, command or hook is run. A skill's scripts stay files in its package, as with any imported package.
- No skill is usable before you review it in the Library.
- Orglet does not look for Claude Code's folder until you open this dialog.

The Add orglet dialog does not offer this import; subagents are imported here too, from **Library**.

How it is built: `main/claude-code-scan.ts` reads the files, and `shared/claude-code-import.ts` and `shared/claude-code-orglet.ts` turn their text into Orglet's shapes. The window is `renderer/components/ClaudeCodeImport.tsx`.
