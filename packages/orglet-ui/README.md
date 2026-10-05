# @codepawlhq/orglet-ui

The interface Orglet is built from: a small set of React components and the tokens they read.

Components move here from the Orglet app one at a time, under a contract: a component arrives only when it meets
the rules below, and the app then imports it from here like any other application would.

## Install

```sh
pnpm add @codepawlhq/orglet-ui
```

It needs React 19 (`react` and `react-dom` are peer dependencies). It ships as ES modules with type declarations,
and each component imports its own stylesheet, so it expects a bundler that handles CSS imports, as Vite does out of
the box.

Inside this repository the app depends on it as `workspace:*` and reads its source directly, through an alias in
`vite.renderer.config.ts` and `vitest.config.ts` and a path in `tsconfig.json`. Neither `pnpm dev` nor the packaged
app needs a build of the kit first.

## Use

Import the tokens once, in the application's entry file, then use the components:

```tsx
import '@codepawlhq/orglet-ui/tokens.css';
import { useState } from 'react';
import { SwitchField } from '@codepawlhq/orglet-ui';

export function ReportSetting() {
  const [weekly, setWeekly] = useState(true);
  return <SwitchField checked={weekly} onChange={setWeekly} description="Every Monday morning">Weekly report</SwitchField>;
}
```

A component's styles come with it: `Switch` imports `Switch.css`, so an application that only uses the switch only
loads the switch's styles.

## Components

Each component has a page in [docs/components](docs/components): when to use it, when not to, an example, its props
and its accessibility notes. This table is written from those pages by `pnpm --filter @codepawlhq/orglet-ui docs`.

<!-- components:start -->
| Need | Use | Page |
|---|---|---|
| A button in four looks, or a square holding one icon. | `Button` | [Button](docs/components/Button.md) |
| A menu of a row's actions behind one icon button, with an in-panel question for destructive items. | `RowMenu` | [RowMenu](docs/components/RowMenu.md) |
| One choice out of a few small icon buttons, such as the tool or colour of a drawing bar. | `ToolbarToggleGroup` | [ToolbarToggleGroup](docs/components/ToolbarToggleGroup.md) |
| A tick for picking items out of a list or confirming something once, with a label and optional description. | `Checkbox` | [Checkbox](docs/components/Checkbox.md) |
| A colour panel with an area, a hue slider, a hex field, presets and the person's saved colours. | `ColorPicker`, `normalizeHex` | [ColorPicker](docs/components/ColorPicker.md) |
| A name that is renamed where it is shown: text at rest, an input when clicked. | `EditableText` | [EditableText](docs/components/EditableText.md) |
| A single-line text input and a multi-line textarea with a shared invalid state and shake. | `Input`, `Textarea` | [Field](docs/components/Field.md) |
| A field's title with a small leading icon and an optional required asterisk drawn outside its name. | `FieldLabel` | [FieldLabel](docs/components/FieldLabel.md) |
| A field for an amount of money, with the currency symbol before it and its code after it. | `MoneyInput` | [MoneyInput](docs/components/MoneyInput.md) |
| One choice out of a few labelled options, each with an optional description. | `RadioGroup` | [RadioGroup](docs/components/RadioGroup.md) |
| A single-choice dropdown with groups, details, icons and full keyboard support. | `Select` | [Select](docs/components/Select.md) |
| An on/off switch for a setting that applies at once, bare or as a titled settings row. | `Switch`, `SwitchField` | [Switch](docs/components/Switch.md) |
| Tabs on a page, as quiet text buttons, with a panel for each. | `Tabs`, `TabPanel` | [Tabs](docs/components/Tabs.md) |
| A panel that floats beside its trigger, flips above when there is no room and closes on Escape. | `AnchoredPopover` | [AnchoredPopover](docs/components/AnchoredPopover.md) |
| Ask one yes-or-no question in a small modal and await the answer, from anywhere in the application. | `confirmAction`, `Confirmer` | [Confirm](docs/components/Confirm.md) |
| The pieces to make your own Radix dialog behave like the kit's: backdrop, Escape order and focus return. | `DialogOverlay`, `keepOpenForPopup`, `OPEN_POPUP_SELECTOR`, `useReturnFocus` | [DialogOverlay](docs/components/DialogOverlay.md) |
| A centred panel for an editor or a list, with a header, actions and a body that scrolls on its own. | `Drawer` | [Drawer](docs/components/Drawer.md) |
| A small button that reveals technical detail such as ids and paths on hover, focus or click. | `InfoTip` | [InfoTip](docs/components/InfoTip.md) |
| The settings layout: tabs on the left, the open section on the right, with an optional Save footer. | `TabbedDialog`, `TabbedFormDialog`, `DialogTabs` | [TabbedDialog](docs/components/TabbedDialog.md) |
| A short text label for a control, shown on hover and keyboard focus. | `Tooltip` | [Tooltip](docs/components/Tooltip.md) |
| A large Quick Look style dialog for looking at one document, file or diff. | `Viewer` | [Viewer](docs/components/Viewer.md) |
| A bar for work whose size is known, such as 3 of 12 files. | `Progress` | [Progress](docs/components/Progress.md) |
| The only shape a wait may take: bars, blocks and circles where content will be. | `Skeleton`, `SkeletonText`, `SkeletonGroup` | [Skeleton](docs/components/Skeleton.md) |
| A small status glyph for the left of a title, with a different shape for every state. | `StatusMark` | [StatusMark](docs/components/StatusMark.md) |
| Short messages shown above everything, called from anywhere, with one optional action. | `showToast`, `Toaster` | [Toaster](docs/components/Toaster.md) |
| A file as a same-width card with its kind's icon, name and size, plus helpers to read a file's kind and size. | `Attachment`, `fileKind`, `formatFileSize` | [Attachment](docs/components/Attachment.md) |
| A small pill for a count or a short state word. | `Badge` | [Badge](docs/components/Badge.md) |
| A quiet rounded surface that groups content, with an optional header. | `Card` | [Card](docs/components/Card.md) |
| A command to paste into a terminal, on a quiet card with a copy button. | `CommandBlock` | [CommandBlock](docs/components/CommandBlock.md) |
| A section's title with its description beneath and the section's own actions on the right. | `PanelHeading` | [PanelHeading](docs/components/PanelHeading.md) |
| Reactions thrown at one message: a trigger with a floating row of faces, and badges on the bubble's corner. | `ReactionBar`, `ReactionPicker`, `ReactionBadges` | [ReactionBar](docs/components/ReactionBar.md) |
| Joins class names and lets the caller's class win over the kit's. | `cn` | [cn](docs/components/cn.md) |
<!-- components:end -->

For agents, the same pages ship as [llms.txt](llms.txt), [llms-full.txt](llms-full.txt) and a skill,
[skills/orglet-ui/SKILL.md](skills/orglet-ui/SKILL.md). See [docs/agents.md](docs/agents.md).

## Theming

`tokens.css` defines every value a component reads as an `--org-` custom property on `:root`. Light is the default.
`data-theme` on the root element picks another:

- `data-theme="dark"` uses the dark palette.
- `data-theme="system"` follows the operating system through `prefers-color-scheme`.
- No attribute, or `data-theme="light"`, stays light.

To make the kit look like the application around it, set the tokens after importing `tokens.css`:

```css
:root { --org-accent: #0a7d5a; --org-radius: 6px; }
:root[data-theme=dark] { --org-accent: #4fd1a5; }
```

Orglet does exactly this: it keeps its own tokens and hands them over once in `styles.css` (`--org-bg: var(--bg)`,
and so on). A subtree can carry another palette by setting the tokens on its own root element.

Under `prefers-reduced-motion: reduce` the tokens set every `--org-motion-` duration to zero, so a component that
animates through them stops without any code of its own.

## Develop

```sh
pnpm --filter @codepawlhq/orglet-ui build           # dist/: one module per component, its stylesheet beside it, types
pnpm --filter @codepawlhq/orglet-ui test            # Vitest in jsdom, Testing Library, axe
pnpm --filter @codepawlhq/orglet-ui check:package   # publint and Are the Types Wrong, on the built package
```

The build is tsdown. It keeps each component in its own file and copies its stylesheet next to it unchanged, so the
`import './Switch.css'` in `Switch.js` still finds it. `dist` is not committed.

The root `pnpm test` runs these tests too, as the `orglet-ui` Vitest project. CI builds the kit and runs
`check:package` on every pull request.

### The gallery

Every component has stories in `stories/`, one per meaningful state, in [Storybook](https://storybook.js.org) 10:

```sh
pnpm --filter @codepawlhq/orglet-ui storybook         # the gallery at http://localhost:6006
pnpm --filter @codepawlhq/orglet-ui build-storybook   # a static copy in storybook-static/ (not committed, not deployed)
pnpm --filter @codepawlhq/orglet-ui check:stories     # every story of the static copy, light and dark, rendered and axe-checked
```

The toolbar's Theme switch sets `data-theme` on the root element, exactly as an application does, and the
Accessibility panel runs axe on the open story. Foundations → Tokens is read from `tokens.css` itself, so it never
drifts from what ships. `check:stories` opens each story in headless Chromium (Playwright), fails on a render error, a
console error or a WCAG 2.2 A/AA violation, and with `--screenshots <folder>` saves each story at 1280 and 740 wide. A
story that needs an exception says so in its `a11y` parameter, with the reason beside it.

Storybook and everything it pulls in are development dependencies of this package only: the app never imports
`stories/` or `.storybook/`, and the published package still ships `dist` alone.

A new component comes with a test in `test/`: it renders with its required text, works from the keyboard, applies
`className` last, and passes an axe check. It also gets stories in `stories/`. `test/styles.test.ts` checks every stylesheet for the `org-` prefix and for
reduced motion.

## What belongs here

A component belongs here when it would make sense in an application that is not Orglet. A worker avatar, a status
circle, a select: yes. A harness row, a chat composer, the details panel: no, those are Orglet.

Judge it by its dependencies rather than by its name. If a component needs Orglet's contracts, its IPC bridge, or a
token like `--sidebar`, it is not general yet, and forcing it here only moves the problem.

## The rules a component here follows

1. **Its own file of styles, beside it**, imported by the component. No shared stylesheet, no rule that reaches
   across components.
2. **Every class starts with `org-`.** A host application has class names too, and the kit does not get to own
   `.row` or `.card`.
3. **Colours, radii and timings come from `--org-` tokens**, each with a fallback at the use site, so a page that
   forgets `tokens.css` still renders something sane. See [src/styles/tokens.css](src/styles/tokens.css).
4. **Text comes in as props.** No translation call inside a component: the kit cannot ship Orglet's Vietnamese
   strings, and an application already knows how it translates. Where a control needs a name for assistive
   technology, take it as a prop and make it required.
5. **`className` is accepted and applied last**, so an application can override anything without `!important`.
   Several looks of one component are `variant` props, not classes the caller has to know.
6. **Keyboard and assistive technology are part of the component**, not something the caller adds: roles, labels,
   focus handling, and a visible focus ring.
7. **Reduced motion is honoured.** The tokens flatten every duration under `prefers-reduced-motion`, so a component
   that animates through them needs nothing extra. A component that animates by hand handles it itself.

## What is still missing

The kit is still thin. The one control an application cannot do without that it lacks is a `Table`. (A form label is
`FieldLabel`, so there is no separate `Label`.)

Two things it will not grow: a `Separator` and the alert with a coloured left border. Orglet separates with spacing,
grouping and a quiet background instead, and that rule travels with the kit.

## Licence

AGPL-3.0-only for now, the same as the repository. A more permissive licence for this package is a decision to make
deliberately before it is published, not a default to drift into.
