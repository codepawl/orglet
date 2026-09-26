# @codepawl/orglet-ui

The interface Orglet is built from: a small set of React components and the tokens they read.

It is not published yet. This package exists so components can be moved out of the app one at a time, under a
contract, instead of being untangled in one go on the day someone wants to use them. The app still imports its own
`apps/desktop/src/renderer/components`; a component moves here only when it meets the rules below, and the app then
imports it from here.

## Install

Once it is published:

```sh
pnpm add @codepawl/orglet-ui
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
import '@codepawl/orglet-ui/tokens.css';
import { useState } from 'react';
import { SwitchField } from '@codepawl/orglet-ui';

export function ReportSetting() {
  const [weekly, setWeekly] = useState(true);
  return <SwitchField checked={weekly} onChange={setWeekly} description="Every Monday morning">Weekly report</SwitchField>;
}
```

A component's styles come with it: `Switch` imports `Switch.css`, so an application that only uses the switch only
loads the switch's styles.

## Components

- `Button`: `variant` `ghost` (the default: quiet text, a soft background on hover), `outline` (a soft filled pill for a
  secondary action) or `primary` (the one filled action of a place); `size="icon"` for a square holding one icon,
  named with `aria-label`, which answers hover with the icon's colour instead of a tile. `type` is left to the caller,
  so inside a form it submits unless it says `type="button"`.
- `Input` and `Textarea`: a text field. Name it with a `<label>` around it or `aria-label`. `invalid` marks it as
  failing validation, and `flash` replays the shake: pass a counter the form increments on every failed submit.
- `Switch` and `SwitchField`: an on/off setting. `Switch` is the bare control, named by `label` or `labelledBy`;
  `SwitchField` is the whole row, its title on the left and the switch on the right, with `description` under the
  title.
- `Skeleton`, `SkeletonText` and `SkeletonGroup`: the only shape a wait may take. A bar where text will be, a block
  where a picture will be, a circle where a face will be, sweeping under a second per pass and still under reduced
  motion. The group is the one status region, and its `label` is what a screen reader hears. The kit has no spinner
  and will not grow one.
- `CommandBlock`: a command for someone to paste into a terminal. A label, the command on a quiet card that breaks
  only after a path separator or a space, and a copy button. A small control that changes the command, such as a
  terminal picker, goes in its `toolbar`, on the card's top bar. The application does the copying in `onCopy`.
- `EditableText`: a name renamed where it is shown. A click, Enter or F2 turns it into a field; Enter or leaving the
  field keeps the change, Escape puts the old value back. `onCommit` does the saving and may be async.
- `Checkbox`: a tick for picking items out of a list or confirming something once, never for an on/off setting
  (that is a `Switch`). A real, hidden `<input type="checkbox">` with a drawn box, so forms and keyboards work as
  usual; every input prop passes through. `description` adds a second line, `required` draws the red asterisk
  without the browser's own validation bubble.
- `AnchoredPopover`: a panel attached to a trigger (`anchor` ref). It floats below it, flips above when there is no
  room, stays inside the window, closes on Escape or a pointer outside and gives focus back to the anchor. Inside an
  open dialog it portals into that dialog and sets `data-popup-open`, so Escape closes the popover, not the dialog.
- `StatusMark`: a small status glyph for the left of a title. `variant` (`empty`, `dashed`, `filled`, `busy`) and
  `tone` (`muted`, `success`, `error`, `working`) pick a shape and a colour, and every state has its own shape, so
  colour is never the only difference. `label` is what a screen reader hears; `decorative` keeps it out of a named
  control. Which state a thing is in belongs to the application.
- `ReactionBar`, `ReactionPicker` and `ReactionBadges`: reactions thrown at a message. The bar is a trigger (`label`,
  `icon`) that opens a floating row of faces (`options` of `{ name, emoji, meaning }`, the `picked` one pressed;
  picking it again takes it off). The badges sit on a bubble's corner (`align` `start`, `end` or `inline`), one
  button each with a count above one. Where reactions are stored is the application's.
- `ColorPicker` and `normalizeHex`: a saturation and brightness area (pointer and arrow keys), a hue slider and a hex
  field that change the colour live, preset swatches, and saved colours with save and remove. Every string comes in
  `labels`, including the ones built from a value (`areaValue`, `presetColor`, `removeColor`). It sets
  `data-popup-open`, so Escape closes it rather than a dialog around it.
- `PanelHeading`: a section's title (`level` 2 or 3) with its `description` under it on the left and the section's
  actions (its children) on the right, vertically centred.
- `FieldLabel`: a field's title with a small decorative leading `icon` (any icon component that takes `size`, such as
  one from lucide-react); `required` draws the red asterisk without adding it to the field's name.
- `InfoTip`: technical detail (ids, paths, hashes) behind a small button: opens on hover and keyboard focus, pins
  open on click so a row's copy button can be reached, closes on Escape, focus leaving or a pointer outside. `rows` of
  `{ label, value, mono?, onCopy? }`; `label` names the trigger, `icon` is what it shows, `copyLabel` names each copy
  button. Portaled, so a scrolling dialog cannot clip it.
- `RowMenu`: a row's actions behind an icon button (`icon`, named by `label`). Items (`{ label, icon, onSelect,
  danger?, confirm?, shortcut? }`) close the menu when chosen; one with `confirm` asks inside the panel first, with
  `cancelLabel` as the way back, and `asksOnOpen` opens a lone asking item straight on its question. Arrow keys move
  between items, Escape and a pointer outside close it, and `contextMenuOf` opens it at the pointer on a right-click
  in the matching ancestor.
- `MoneyInput`: an amount with the currency `symbol` before it and its `code` after it, both hidden from the field's
  name; the text stays as typed and converting it is the application's. `invalid` and `flash` work as on `Input`.
- `Attachment`, `fileKind` and `formatFileSize`: a file as a same-width card (`name`, a `meta` line, the kind's
  `icon`), rendered as a list item. With `onOpen` the whole card opens the file; with `onRemove` (named by
  `removeLabel`, showing `removeIcon`) a remove button appears on hover or focus without moving anything. `fileKind`
  reads the kind from the extension; `formatFileSize` gives "1.5 KB" in a locale.
- `Drawer`: a centred panel with a header (title or breadcrumb, `description`, the panel's `actions`, a close button
  named by `closeLabel` showing `closeIcon`) and a body that scrolls on its own. Focus goes back to what opened it.
- `confirmAction` and `Confirmer`: `await confirmAction({ title, description?, confirmLabel?, cancelLabel? })` asks one
  yes-or-no question and resolves true only on confirm; render one `<Confirmer confirmLabel cancelLabel />` for the
  default labels.
- `DialogOverlay`, `keepOpenForPopup` and `OPEN_POPUP_SELECTOR`: the frosted backdrop for any Radix dialog, and the
  Escape rule that closes an open menu inside a dialog before the dialog.
- `showToast` and `Toaster`: `showToast(text, tone?, action?)` shows a short message at the top centre, `success`,
  `error` or `info`, with at most one `{ label, onSelect }` action. A repeated message replaces its older copy, three
  at most are visible, and a plain success goes after 3 s, anything else after 6 s. Render one
  `<Toaster icons={{ success, error, info }} renderText? />`; it portals to the page, so an open modal does not hide it.
- `Select`: a single-choice dropdown (the select-only combobox pattern) named by `labelledBy` or `ariaLabel`, with a
  `placeholder`. Options (`SelectOption`) take `icon`, `detail`, `note`, `group`, `disabled`, `dimmed`, `badge` and
  `labelStyle`; `size="sm"`, `inlineDetail`, `menuMinWidth`, `invalid` with `flash`, and `field` (the trigger's
  `data-field`). The list is portaled into the open dialog or the page, flips up when there is more room above, fits
  the window and only scrolls when it must. Arrows, Page Up and Down, Home and End, typing to jump, Enter or Space to
  choose, Escape to close without closing the dialog. Sizes come from `--org-select-height`, `--org-select-radius` and
  `--org-select-option-height`.
- `TabbedDialog`, `TabbedFormDialog` and `DialogTabs`: the settings layout, a title and close button on top, the tabs
  on the left (a row on a narrow window) and the open section headed by its tab's `label`, with `description` and
  `actions`, scrolling on its own. `TabbedDialog` applies changes at once; with `onSubmit` its body and `footer` form
  one form. `TabbedFormDialog` pins Cancel and Save at the bottom with the `error` beside them, shows `busyLabel`
  while saving, and lands on the field named by `focusField`. A tab's `buttonProps` reach its button, such as a
  handler that prefetches on hover. Tabs follow the WAI-ARIA pattern: the arrows move and open, only the open tab is
  in the Tab order.
- `Viewer`: a large dialog for looking at one thing, in the style of macOS Quick Look: close on the left (`closeLabel`,
  `closeIcon`), the `icon` and `title` centred with an optional `meta` line under them, `actions` on the right, and the
  content on a grey backdrop that scrolls on its own. `className` widens or restyles one kind of viewer.
- `cn`: joins class names and lets the caller's win.

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
pnpm --filter @codepawl/orglet-ui build           # dist/: one module per component, its stylesheet beside it, types
pnpm --filter @codepawl/orglet-ui test            # Vitest in jsdom, Testing Library, axe
pnpm --filter @codepawl/orglet-ui check:package   # publint and Are the Types Wrong, on the built package
```

The build is tsdown. It keeps each component in its own file and copies its stylesheet next to it unchanged, so the
`import './Switch.css'` in `Switch.js` still finds it. `dist` is not committed.

The root `pnpm test` runs these tests too, as the `orglet-ui` Vitest project. CI builds the kit and runs
`check:package` on every pull request.

A new component comes with a test in `test/`: it renders with its required text, works from the keyboard, applies
`className` last, and passes an axe check. `test/styles.test.ts` checks every stylesheet for the `org-` prefix and for
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

The kit is deliberately thin today. Before it can be published it needs at least the controls an application cannot
do without: `Label`, `Card`, `Badge`, and a real `Tooltip`. After those: `Tabs` outside a dialog,
`RadioGroup`, `Progress`, `Table`.

Two things it will not grow: a `Separator` and the alert with a coloured left border. Orglet separates with spacing,
grouping and a quiet background instead, and that rule travels with the kit.

## Licence

AGPL-3.0-only for now, the same as the repository. A more permissive licence for this package is a decision to make
deliberately before it is published, not a default to drift into.
