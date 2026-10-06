---
name: orglet-ui
description: Use when building, changing or reviewing UI in the Orglet desktop app (apps/desktop/src/renderer), so you reuse its components and follow its design rules.
---

# Orglet UI (the desktop app)

Orglet's renderer uses the generic kit in `packages/orglet-ui` (`@codepawlhq/orglet-ui`) plus app components in
`apps/desktop/src/renderer/components/`. Paths below are relative to the repo root.

## Rules for every UI change

1. **Component before raw HTML.** Use a kit or app component before a raw `<button>`, `<select>`,
   `<input type="checkbox">`, dialog, menu, toast or tooltip. `tests/integration/ui-kit-usage.test.ts` (part of
   `pnpm test`) counts raw `<button>`, `<select>`, checkbox inputs, `title=` attributes and hard-coded hex colours per
   renderer file against a baseline that may only go down. It fails when you add one.
2. **Import from the app wrapper when one exists** (`./ui`, `./Select`, `./Checkbox`, `./Switch`, `./toast`,
   `./confirm` ...), because the wrapper adds translated labels, icons and notice recording. Otherwise import from
   `@codepawlhq/orglet-ui`. Never import the kit's `dist`.
3. **Tokens, not hex.** Colours, radii and spacing come from the tokens in `apps/desktop/src/renderer/styles.css`
   (`--text`, `--muted`, `--accent`, `--row-hover` ...) and the kit's `--org-*` tokens.
4. **Text goes through `t('Vietnamese source')`.** Add the English line to `apps/desktop/src/shared/locales/en.ts`
   in the same change and keep `pnpm i18n:keys` clean. Core messages use `tMessage(...)`; label maps use
   `translated({...})`.
5. **A hover label is the kit's `Tooltip`, not a `title=` attribute.**
6. **No spinner.** A wait draws `Skeleton` in the shape of what is coming; fetch on hover (`renderer/prefetch.ts`)
   so a click shows kept content at once.
7. **No horizontal divider lines, no eyebrow labels, no coloured left-border callouts.** Separate with spacing,
   grouping or a quiet background.
8. **A state leads with a mark.** Success, failure, warning and waiting each get an icon whose shape differs, in the
   state's colour (`StatusMark`, `--success`, `--error`). Colour alone is never the only signal.
9. **The shape says what a control does.** Two states: `Switch`. Pick from a list or confirm once: `Checkbox`. One
   of a few: `Select`. Icons sit left of text; icon-only buttons need `aria-label`.
10. **Quiet shell.** Calm ChatGPT-like layout, tight spacing, details on demand. A close (X) button belongs only to
    a centred dialog; a panel or page is left by navigating or by the toggle that opened it.
11. **UI is checked on the rendered screen, not only in code.** After any UI change run `pnpm build`, then
    `pnpm test:alignment`, and fix every finding. A new screen is added to `scripts/alignment-check.mjs` in the same
    change.
12. **Docs and tests in the same change** (README plus the matching `docs/` page; `tests/integration/*.test.ts`).

## Where to read next

| When you ... | Read |
|---|---|
| Pick a kit component (Button, Select, Dialog, Skeleton, Tooltip ...) | `packages/orglet-ui/skills/orglet-ui/SKILL.md` and `packages/orglet-ui/docs/components/<Name>.md` |
| Need to know which app component covers a need (sidebar, chat, viewers, runs, settings, kit wrappers) | `.agents/skills/orglet-ui/app-components.md` |
| Lay out panels, rows, forms, states, motion, or run the alignment check | `.agents/skills/orglet-ui/house-rules.md` |
| Add a component to the app or move one into the kit | `.agents/skills/orglet-ui/adding-a-component.md` |
| Change how the app is built, checked or released | `AGENTS.md`, `CONTRIBUTING.md` |
| Write user-facing docs | `docs/writing.md` |

If nothing fits, add the component first (see `adding-a-component.md`), then use it.
