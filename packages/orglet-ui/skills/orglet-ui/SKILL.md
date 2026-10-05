---
name: orglet-ui
description: Use when building, changing or reviewing React UI in a project that depends on @codepawlhq/orglet-ui. Picks the kit component for each control, shows where its reference page is, and lists the rules the kit's design follows.
---

# Orglet UI

`@codepawlhq/orglet-ui` is a small set of accessible React 19 components and the `--org-` tokens they read. Use one of
its components before writing a raw `<button>`, `<input>`, `<select>`, dialog, menu, tooltip or toast.

## Set up

```tsx
import '@codepawlhq/orglet-ui/tokens.css'; // once, in the application's entry file
import { Button, Select, showToast } from '@codepawlhq/orglet-ui';
```

Each component imports its own stylesheet, so the bundler must handle CSS imports (Vite does). Theme with
`data-theme="light" | "dark" | "system"` on the root element. Make the kit match an application by setting `--org-`
tokens after importing `tokens.css`, never by overriding `.org-` classes.

## Pick a component

Read the page of a component before using it: it has when to use it, when not to, an example, the props and the
accessibility notes. In an installed package the pages are in `node_modules/@codepawlhq/orglet-ui/docs/components/`;
`llms.txt` and `llms-full.txt` beside them hold the same content for a single read.

<!-- components:start -->
<!-- components:end -->

## Rules

1. **Text comes in as props.** The kit translates nothing. Every control that needs a name for a screen reader takes
   it as a required prop (`label`, `aria-label`, `closeLabel`): pass a real, translated string.
2. **Colours, radii and timings are `--org-` tokens.** No hex values in component code. A new colour is a token.
3. **`className` is applied last**, so an application overrides without `!important`. Several looks of one component
   are a `variant` prop.
4. **The shape says what a control does.** Two states, on and off: `Switch`. Picking from a list or confirming once:
   `Checkbox`. One of a few: `RadioGroup`, `Select` or `ToolbarToggleGroup`.
5. **A wait is a `Skeleton`** in the shape of what is coming. The kit has no spinner. `Progress` is for work whose
   size is known.
6. **A state leads with a mark.** Success, failure, waiting and warning each get a `StatusMark` whose shape differs,
   in the state's colour. Colour alone is never the only difference.
7. **No separator lines and no alert with a coloured left border.** Separate with spacing, grouping or a quiet
   background (`Card`).
8. **One primary action per place.** The rest step down to `outline` and `ghost`. Icons sit left of the text.
9. **A hover label is a `Tooltip`**, not a `title` attribute. Detail a person may copy goes in an `InfoTip`.
10. **A close button belongs to a centred dialog** (`Drawer`, `Viewer`, `TabbedDialog`). A panel or page is left by
    navigating or by the toggle that opened it.
11. **Do not rebuild keyboard handling.** Focus return, Escape order inside dialogs, arrow keys and roles are part of
    each component. If one is missing something, fix the component.

## When nothing fits

Compose existing components first. If a control is still missing and would make sense in an application that is not
yours, propose it for the kit: its own file and stylesheet, classes that start with `org-`, tokens with fallbacks,
text as props, a keyboard and axe test, stories, and a page in `docs/components/`. The rules are in the package
README under "The rules a component here follows".
