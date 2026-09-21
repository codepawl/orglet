# Docs

This folder is the map. Start with [Getting started](getting-started.md) if you want to use Orglet. Coding agents start at [AGENTS.md](../AGENTS.md); humans who want to contribute start at [CONTRIBUTING.md](../CONTRIBUTING.md). Do not copy those files here.

How to write new pages: [writing.md](writing.md).

## Start here

| Page | What it is |
|---|---|
| [getting-started.md](getting-started.md) | Install or run from source, Demo chat, then a real model |
| [../README.md](../README.md) | What Orglet is, platforms, and how to contribute |

## How it works

What the app does today. Use the words on screen.

| Page | What it is |
|---|---|
| [team-chat.md](team-chat.md) | Click a worker or team → that chat; `@` tags; how a team turn runs |
| [agent-tools.md](agent-tools.md) | Workspace and web permissions, tool execution, team handoffs and interrupted attempts |
| [routines.md](routines.md) | Schedules, missed runs, and catch-up (one pending, not a backlog) |
| [recovery.md](recovery.md) | Where the database lives, upgrades, and rollback |
| [technical-guide.md](technical-guide.md) | Run the app, connect providers and harnesses, limits, checks |

## Product and decisions

These pages are the contract. Keep their precise language. Do not rewrite them into casual copy. See [writing.md](writing.md).

| Page | What it is |
|---|---|
| [product.md](product.md) | Who it is for, how it should feel, **Not now** |
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
| Connect a model | [Getting started](getting-started.md) step 4 and [technical-guide.md](technical-guide.md) |
| Teams in more depth | [team-chat.md](team-chat.md) |
| Files, reports, and Details | [Getting started](getting-started.md) step 6 and [team-chat.md](team-chat.md) |
| Schedules | [routines.md](routines.md) |
| Backup and restore | [technical-guide.md](technical-guide.md) (Current limits) |
