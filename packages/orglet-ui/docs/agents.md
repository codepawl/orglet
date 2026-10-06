---
title: For agents
summary: The same pages as Markdown, an llms.txt and a skill, so a coding agent picks the right component.
---

## What ships for agents

The package carries its own documentation, so an agent reads the version that is installed, not a newer one from
the web:

| File in the package | What it is |
|---|---|
| `skills/orglet-ui/SKILL.md` | The skill: when to use which component, the rules of the design, and where each page is. |
| `docs/components/<Name>.md` | One page per component: when to use it, when not to, an example, the props, accessibility. |
| `llms.txt` | An index of every page with a one-line summary. |
| `llms-full.txt` | Every page in one file, for a single read. |

The same files are served by this site: [llms.txt](/llms.txt), [llms-full.txt](/llms-full.txt) and
[the skill](/skills/orglet-ui/SKILL.md). Every component page has a "View as Markdown" link.

## Point your agent at the skill

Add one line to the instructions file your agent reads (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules`):

```md
Before building or changing UI, read node_modules/@codepawlhq/orglet-ui/skills/orglet-ui/SKILL.md and use its
components before raw HTML controls.
```

For a harness that loads skills from a folder, copy the skill there. It keeps working after an update as long as
you copy it again:

```sh
mkdir -p .agents/skills/orglet-ui
cp node_modules/@codepawlhq/orglet-ui/skills/orglet-ui/SKILL.md .agents/skills/orglet-ui/SKILL.md
```

Claude Code reads `.claude/skills/orglet-ui/SKILL.md`. Codex and other tools that follow the shared layout read
`.agents/skills/orglet-ui/SKILL.md`.

## What the skill tells an agent

- Use a kit component before a raw `<button>`, `<input>`, `<select>`, dialog, menu, tooltip or toast.
- Read the component's page before using it. Props are not guessed.
- Text comes in as props, colours are tokens, and `className` goes last.
- Two states are a `Switch`, a tick is a `Checkbox`, a wait is a `Skeleton`, a hover label is a `Tooltip`.
- No spinner, no separator lines, no alert with a coloured left border.

## Keeping an agent honest

A skill is advice, and an agent can skip it. A check cannot be skipped. Orglet counts raw controls, `title`
attributes and hex colours in its own interface in a test, against a baseline that may only go down. The script is
small and worth copying: `scripts/ui-kit-usage.ts` in the [Orglet repository](https://github.com/codepawl/orglet).
