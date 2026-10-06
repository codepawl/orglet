# Adding a component

Reading map: app-only component, then moving one into the kit, then the CSS order pitfall and the proof.

Rule: if an existing component covers the control, use it. Do not add a native `<select>`, a bare
`<input type="checkbox">`, a hand-rolled dialog or a one-off toast. If nothing fits, add the component first, then use it.
Treat app components like a library: no product logic inside, props in and events out, an accessible name required
by its props, styling through `styles.css` classes and tokens.

## An app-only component

1. Create `apps/desktop/src/renderer/components/<Name>.tsx`: no workspace or IPC calls, props in and callbacks out, an accessible name required by its props.
2. Style it with classes and existing tokens in `apps/desktop/src/renderer/styles.css`; put a short comment above the rule block saying what the component is.
3. Replace the existing ad-hoc uses in one pass. For a bulk migration use a TypeScript-AST script, not regex. Update smoke selectors that depended on native controls.
4. Add a row to `.agents/skills/orglet-ui/app-components.md` in the matching area.
5. Add UI strings with `t()` and `locales/en.ts`; keep `pnpm i18n:keys` clean.
6. Verify: `pnpm typecheck`, `pnpm test`, the affected Playwright smokes against a packaged build, `pnpm build` then `pnpm test:alignment`, and a screenshot in light and at narrow width.
7. If the screen is new, add it to `scripts/alignment-check.mjs`.

## Moving a component into the kit

The kit is `packages/orglet-ui`; its rules are in `packages/orglet-ui/README.md`. Also:

1. Export it from `packages/orglet-ui/src/index.ts`; give it its own file and stylesheet, `org-` classes, `--org-` tokens with fallbacks, and text as props.
2. Add a test in `packages/orglet-ui/test/`: rendered with its required text, driven from the keyboard, `className` last, and `toHaveNoViolations` from vitest-axe. The root `pnpm test` runs it as the `orglet-ui` project.
3. Add its page in `packages/orglet-ui/docs/components/<Name>.md` (the kit skill's table is generated from these).
4. `pnpm --filter @codepawlhq/orglet-ui build` and `check:package` (publint, Are the Types Wrong) must stay clean.
5. The app reads the kit's source through the alias, never its `dist`.
6. If the app needs translated labels, icons or notice recording, keep a thin wrapper in `renderer/components/` and list it under Kit wrappers in `app-components.md`.

## CSS source-order pitfall

The kit's CSS is bundled before `styles.css`, because the renderer imports `App` first. An app rule that used to lose
to the moved rule on source order now wins whenever the two tie on specificity. Example: `.form input:not(.org-input)`
turned the colour picker's hue slider into a text box. Give a moved rule one more class where an app rule can reach
it, and rename the app's contextual rules in the same pass.

## Prove the move

Take a before and after pixel diff of every place the component appears, form contexts included, on the same profile
copy in two packaged builds. A move is done when the diff is empty or every difference is intended.
