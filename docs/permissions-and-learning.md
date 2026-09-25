# Permissions and learning

What an orglet may touch, and what it learns from working with you. Every one of these is something you can see and change; none of it leaves your computer.

Part of the [user guide](user-guide.md). The technical rules are in [agent-tools.md](agent-tools.md), [memory.md](memory.md) and [self-improvement.md](self-improvement.md).

## Permissions

Permissions belong to a **chat**. You find the same controls in two places:

- **Orglet settings → Permissions**, for that orglet's own chat.
- **Details → Tool permissions** in any open chat, including a crew or group chat, and including an empty chat before the first message.

| Control | What it allows |
|---|---|
| **Read attached sources** | Reading the files attached to this chat |
| **Check data** | Running the local checks on attached CSV, JSONL and Parquet files |
| **Read and search the web** | Reading public web pages and searching. Pages come back as text; nothing runs, and the content is treated as untrusted. |
| **Propose app changes** | Suggesting a new orglet, crew, skill, schedule or setting as a card you apply ([below](#app-change-proposals)). On by default. |
| **Working folder** | **No folder**, **Read files only**, **Read and edit files**, or **Read, edit files and run commands**. Choosing a level opens the folder picker, which states the access asked for. |

A control the orglet cannot use yet, because it is on Demo or its connection is missing, is disabled with the reason beside it.

### The working folder

An orglet never works in your folder directly. Each run gets a private copy (a private worktree when the folder is a Git repository, including your uncommitted changes) and edits that. When the run ends, Orglet checks that your files are still as the copy last saw them and integrates the edits; a file you changed meanwhile becomes a conflict shown in **Details → Files and processes**, never a silent overwrite. Commands run in an isolated container with no network, not even to `localhost` ([Troubleshooting](troubleshooting.md#a-command-cannot-reach-localhost)), and without your `PATH`; a command that failed after the last file change blocks the hand-in.

Widening a permission, or raising the folder level on the same folder, applies to every run that has not started yet and stops nothing. Choosing another folder, a lower level or **No folder** stops active work, because an orglet may be mid-edit. A run keeps the permissions it started with; send a new message to give it more. Skills, knowledge, schedules and a restored backup never grant access.

If the folder is deleted, renamed or moved after you picked it, the chat says the working folder is no longer on this computer, by its name. Pick it again under **Details** to go on.

## Memory

An orglet remembers short facts from its chats ("prefers short answers", "the quarterly file is report-q3.xlsx") and carries them into its next chats. Above an answer, **Memories used: N** opens the lines it was given. The orglet's **Memory** tab lists every memory with the chat it came from; edit, pin or delete any line there, or see every scope under **Library → Knowledge → Memory**.

A memory learned while the orglet was reading a web page, a file or another orglet's message waits under **Pending review** in the Library before it is used. Memory is a fact, never a permission or a change to instructions. How the cap, duplicates and review work: [memory.md](memory.md).

## Knowledge and the Library

**Library** in the footer holds what orglets reuse:

- **Skills.** A skill is a reusable set of instructions an orglet works from; pick one on the orglet's **Skill** tab. Write one here, or import an [Agent Skills](https://agentskills.io/specification) package from a folder that contains `SKILL.md`. An imported package must be reviewed and approved in the Library before an orglet can use it; its scripts are never run, and its reference files are readable text for the orglet, not evidence. Editing a skill creates a new revision.
- **Knowledge.** Short notes with a scope: the whole workspace, one crew or one orglet. Pinned notes always load; others load when they match the request. An orglet can suggest up to three notes when it answers; suggestions wait under **Pending review**, and the tab above the message box says how many are waiting and opens them. Knowledge is guidance for the model, not a source, and cannot grant anything.

Every edit, approval or archive is a new revision, and a run in progress keeps the version it started with. Details: [technical guide → Knowledge](technical-guide.md#knowledge).

## Self-improvement proposals

When the same correction repeats, an orglet may propose one sentence for its own instructions. The signals are only things you did or a check refused: you replied to its answer with a change, you gave it a 👎, its report failed a check, or it hit the same error twice. Two of a kind in its last twenty runs, and its next chat run may propose.

The proposal is a card in the chat: **Learning from feedback · Researcher**, the sentence it replaces struck through and the new one, and the chats the feedback came from. It **always waits for your click**, even when automatic app changes are on. **Apply** saves the orglet with a new revision and offers **Undo**; **Dismiss** means it will not ask again for that reason. Details: [self-improvement.md](self-improvement.md).

## App-change proposals

Ask an orglet, in its chat, to set the app up: "make a research crew of three", "turn this crew into a template", "write a skill for code review", "schedule this every Monday at 9", "switch to dark mode". It cannot do any of that itself. It answers with **proposal cards**, one per change, which go through the same validation as the dialogs:

| It can propose | Notes |
|---|---|
| A new orglet, or an edit to one | New orglets from one reply share one card; click a row for the full fields |
| A new crew, or an edit to one | Drawn as its members, the lead with a crown |
| A crew template file | Applying asks where to save it |
| A new skill, or a new revision of one | Not for imported packages |
| A schedule, new or edited | Saved switched off; enabling it is your approval |
| Settings | Theme, language, accent colour, fonts, copy and download format, automatic titles |

**Apply** makes the change; **Dismiss** drops it; **Apply all** applies a reply's cards in order, so an orglet lands before the crew that names it. Every applied change is announced in **Notifications**.

**Apply app changes without asking**, a switch on the orglet's **Permissions** tab, applies the safe cards the moment the run ends, with **Undo** on the card where a change can be taken back. Some cards always wait for your click, and say why: raising a spending limit, saving a file, anything proposed after the run read a web page, a file or another orglet's message, and a self-improvement. Keys, connections, permissions, folders, backups and deletions cannot be proposed at all, and a scheduled run never proposes. Details: [agent-tools.md → Proposing app changes](agent-tools.md#proposing-app-changes).
