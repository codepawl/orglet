# Docs

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/orglets/README-dark.png">
  <img src="images/orglets/README-light.png" alt="" width="112" height="112" align="right">
</picture>

This folder is the map. Start with the [User guide](user-guide.md) if you want to use Orglet. Coding agents start at [AGENTS.md](../AGENTS.md); humans who want to contribute start at [CONTRIBUTING.md](../CONTRIBUTING.md). Do not copy those files here.

How to write new pages: [writing.md](writing.md).

## Start here

| Page | What it is |
|---|---|
| [user-guide.md](user-guide.md) | What Orglet is, install on Windows, first chat, and the map of the user pages |
| [getting-started.md](getting-started.md) | The first walk-through with screenshots: Demo chat, a real model, a crew, files |
| [../README.md](../README.md) | What Orglet is, platforms, and how to contribute |

## Using Orglet

One short page per part of the app, in the words on screen.

| Page | What it is |
|---|---|
| [orglets-and-crews.md](orglets-and-crews.md) | Create an orglet or a crew, how a crew turn runs, group chats, `@` tags, replies, reactions |
| [connections.md](connections.md) | Claude Code, Codex and Cursor Agent on this computer, API keys, Ollama, Demo, model IDs, cost limits |
| [chat-guide.md](chat-guide.md) | Attach files, reports as documents, the trace of what an orglet did, diffs, Details, schedules, notifications |
| [permissions-and-learning.md](permissions-and-learning.md) | Permission switches and the working folder, memory, knowledge and the Library, self-improvement, app-change proposals |
| [settings.md](settings.md) | Every settings tab: appearance, chat, connections, costs, backup and erase, About and updates |
| [cli.md](cli.md) | The `orglet` terminal command: install, send and read from a terminal, exit codes, how it talks to the app |
| [troubleshooting.md](troubleshooting.md) | Sign-in errors, SmartScreen, a harness not found, budget, blocked attempts, commands and `localhost` |

## How it works

What the app does today. Use the words on screen.

| Page | What it is |
|---|---|
| [team-chat.md](team-chat.md) | Click a worker or team → that chat; `@` tags; how a team turn runs |
| [agent-tools.md](agent-tools.md) | Workspace and web permissions, tool execution, team handoffs and interrupted attempts |
| [memory.md](memory.md) | A worker remembers its chats: how it writes memory, what reaches a run, where you correct it |
| [self-improvement.md](self-improvement.md) | A worker proposes one sentence for its own instructions after repeated feedback; the card, the click, Undo |
| [routines.md](routines.md) | Schedules, missed runs, and catch-up (one pending, not a backlog) |
| [recovery.md](recovery.md) | Where the database lives, upgrades, and rollback |
| [technical-guide.md](technical-guide.md) | Run the app, connect providers and harnesses, limits, checks |

## Product and decisions

These pages are the contract. Keep their precise language. Do not rewrite them into casual copy. See [writing.md](writing.md).

| Page | What it is |
|---|---|
| [product.md](product.md) | Who it is for, how it should feel, **Not now** |
| [worker-actions.md](worker-actions.md) | How a worker's actions read in the chat: the vocabulary, live vs afterwards, where the diff lives |
| [capabilities.md](capabilities.md) | What each connection can and cannot do |
| [team-chat-context.md](team-chat-context.md) | Long-chat context, memory, cost, fail-closed defaults |
| [model-list-fetch.md](model-list-fetch.md) | Where model lists come from, cache, custom IDs, deprecation |

## Build and ship

| Page | What it is |
|---|---|
| [windows-release-gates.md](windows-release-gates.md) | Windows release checklist and code signing |
| [macos-packaging.md](macos-packaging.md) | macOS ZIP, Developer ID signing and notarization |
| [linux-packaging.md](linux-packaging.md) | Linux ZIP and its headless CI job |
| [mobile.md](mobile.md) | Proposed shape for a mobile companion, not decided |

## Status and history

Ship/verify record and old session notes. Prefer [product.md](product.md) and the code when they disagree.

| Page | What it is |
|---|---|
| [implementation_status.md](implementation_status.md) | What was verified and what is still open |
| [mvp-gap-audit.md](mvp-gap-audit.md) | Gaps against the MVP plan |
| [handoff.md](handoff.md) | Historical session notes, not a current contract |
| [release-review.md](release-review.md) | Release review notes |

Native UI checklists from earlier milestones: [checkpoint](checkpoint-ui-review.md), [finding](finding-ui-review.md), [preflight](preflight-ui-review.md), [routine](routine-ui-review.md), [run-audit](run-audit-ui-review.md), [skill](skill-ui-review.md), [template](template-ui-review.md), [waiting-input](waiting-input-ui-review.md).

## Later (not written yet)

Point at an existing page until a dedicated guide exists. Do not add empty stub files.

| Guide | Until then |
|---|---|
| Dataset checks and structured reviews in depth | [technical-guide.md](technical-guide.md) (Current limits, Structured run logs) |
| Writing a good skill | [permissions-and-learning.md](permissions-and-learning.md#knowledge-and-the-library) and the [Agent Skills specification](https://agentskills.io/specification) |
