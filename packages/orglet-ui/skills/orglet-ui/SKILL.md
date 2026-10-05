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
| Need | Use | Page |
|---|---|---|
| The basic icons an application needs, drawn on one grid with one stroke, so no icon library is required. | `AlertIcon`, `ArrowLeftIcon`, `ArrowRightIcon`, `ArrowUpRightIcon`, `BellIcon`, `BookIcon`, `CalendarIcon`, `CheckIcon`, `ChevronDownIcon`, `ChevronLeftIcon`, `ChevronRightIcon`, `ChevronUpIcon`, `CloseIcon`, `CodeIcon`, `CopyIcon`, `DownloadIcon`, `ErrorIcon`, `EyeIcon`, `FileIcon`, `FileTextIcon`, `GitHubIcon`, `InfoIcon`, `MenuIcon`, `MinusIcon`, `MonitorIcon`, `MoonIcon`, `MoreHorizontalIcon`, `MoreVerticalIcon`, `PackageIcon`, `PencilIcon`, `PlusIcon`, `SearchIcon`, `SettingsIcon`, `SuccessIcon`, `SunIcon`, `TrashIcon`, `UserIcon` | [Icons](../../docs/components/Icons.md) |
| A button in four looks, or a square holding one icon. | `Button` | [Button](../../docs/components/Button.md) |
| A menu of a row's actions behind one icon button, with an in-panel question for destructive items. | `RowMenu` | [RowMenu](../../docs/components/RowMenu.md) |
| One choice out of a few small icon buttons, such as the tool or colour of a drawing bar. | `ToolbarToggleGroup` | [ToolbarToggleGroup](../../docs/components/ToolbarToggleGroup.md) |
| A tick for picking items out of a list or confirming something once, with a label and optional description. | `Checkbox` | [Checkbox](../../docs/components/Checkbox.md) |
| A colour panel with an area, a hue slider, a hex field, presets and the person's saved colours. | `ColorPicker`, `normalizeHex` | [ColorPicker](../../docs/components/ColorPicker.md) |
| A name that is renamed where it is shown: text at rest, an input when clicked. | `EditableText` | [EditableText](../../docs/components/EditableText.md) |
| A single-line text input and a multi-line textarea with a shared invalid state and shake. | `Input`, `Textarea` | [Field](../../docs/components/Field.md) |
| A field's title with a small leading icon and an optional required asterisk drawn outside its name. | `FieldLabel` | [FieldLabel](../../docs/components/FieldLabel.md) |
| A field for an amount of money, with the currency symbol before it and its code after it. | `MoneyInput` | [MoneyInput](../../docs/components/MoneyInput.md) |
| One choice out of a few labelled options, each with an optional description. | `RadioGroup` | [RadioGroup](../../docs/components/RadioGroup.md) |
| A single-choice dropdown with groups, details, icons and full keyboard support. | `Select` | [Select](../../docs/components/Select.md) |
| An on/off switch for a setting that applies at once, bare or as a titled settings row. | `Switch`, `SwitchField` | [Switch](../../docs/components/Switch.md) |
| Tabs on a page, as quiet text buttons, with a panel for each. | `Tabs`, `TabPanel` | [Tabs](../../docs/components/Tabs.md) |
| A panel that floats beside its trigger, flips above when there is no room and closes on Escape. | `AnchoredPopover` | [AnchoredPopover](../../docs/components/AnchoredPopover.md) |
| Ask one yes-or-no question in a small modal and await the answer, from anywhere in the application. | `confirmAction`, `Confirmer` | [Confirm](../../docs/components/Confirm.md) |
| The pieces to make your own Radix dialog behave like the kit's: backdrop, Escape order and focus return. | `DialogOverlay`, `keepOpenForPopup`, `OPEN_POPUP_SELECTOR`, `useReturnFocus` | [DialogOverlay](../../docs/components/DialogOverlay.md) |
| A centred panel for an editor or a list, with a header, actions and a body that scrolls on its own. | `Drawer` | [Drawer](../../docs/components/Drawer.md) |
| A small button that reveals technical detail such as ids and paths on hover, focus or click. | `InfoTip` | [InfoTip](../../docs/components/InfoTip.md) |
| The settings layout: tabs on the left, the open section on the right, with an optional Save footer. | `TabbedDialog`, `TabbedFormDialog`, `DialogTabs` | [TabbedDialog](../../docs/components/TabbedDialog.md) |
| A short text label for a control, shown on hover and keyboard focus. | `Tooltip` | [Tooltip](../../docs/components/Tooltip.md) |
| A large Quick Look style dialog for looking at one document, file or diff. | `Viewer` | [Viewer](../../docs/components/Viewer.md) |
| A bar for work whose size is known, such as 3 of 12 files. | `Progress` | [Progress](../../docs/components/Progress.md) |
| The only shape a wait may take: bars, blocks and circles where content will be. | `Skeleton`, `SkeletonText`, `SkeletonGroup` | [Skeleton](../../docs/components/Skeleton.md) |
| A small status glyph for the left of a title, with a different shape for every state. | `StatusMark` | [StatusMark](../../docs/components/StatusMark.md) |
| Short messages shown above everything, called from anywhere, with one optional action. | `showToast`, `Toaster` | [Toaster](../../docs/components/Toaster.md) |
| A file as a same-width card with its kind's icon, name and size, plus helpers to read a file's kind and size. | `Attachment`, `fileKind`, `formatFileSize` | [Attachment](../../docs/components/Attachment.md) |
| A small pill for a count or a short state word. | `Badge` | [Badge](../../docs/components/Badge.md) |
| A quiet rounded surface that groups content, with an optional header. | `Card` | [Card](../../docs/components/Card.md) |
| A command to paste into a terminal, on a quiet card with a copy button. | `CommandBlock` | [CommandBlock](../../docs/components/CommandBlock.md) |
| A section's title with its description beneath and the section's own actions on the right. | `PanelHeading` | [PanelHeading](../../docs/components/PanelHeading.md) |
| Reactions thrown at one message: a trigger with a floating row of faces, and badges on the bubble's corner. | `ReactionBar`, `ReactionPicker`, `ReactionBadges` | [ReactionBar](../../docs/components/ReactionBar.md) |
| Joins class names and lets the caller's class win over the kit's. | `cn` | [cn](../../docs/components/cn.md) |
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
