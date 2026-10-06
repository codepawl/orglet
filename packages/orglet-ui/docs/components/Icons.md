---
name: Icons
exports: AlertIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpRightIcon, BellIcon, BookIcon, CalendarIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon, CloseIcon, CodeIcon, CopyIcon, DownloadIcon, ErrorIcon, EyeIcon, FileIcon, FileTextIcon, GitHubIcon, IconProps, InfoIcon, MenuIcon, MinusIcon, MonitorIcon, MoonIcon, MoreHorizontalIcon, MoreVerticalIcon, PackageIcon, PencilIcon, PlusIcon, SearchIcon, SettingsIcon, SuccessIcon, SunIcon, TrashIcon, UserIcon
group: Foundations
summary: Pips, the kit's own icons: the basics an application needs, drawn on one grid with one stroke.
---

## When to use

- The everyday glyphs of an interface: close, add, search, copy, settings, a status mark beside text.
- Beside a label, to the left of it, so the eye finds the action before reading.
- Anywhere you want the same drawing as the Orglet app, since the kit and the app share their paths.

## When not to

- A glyph that is not in the list: use any other set. `lucide-react` or another library still works wherever the kit
  takes an icon, such as `Button`, `RowMenu` items or `FieldLabel`.
- An icon on its own that acts: wrap it in a `Button` with `size="icon"`; the icon is never the control.
- A state that needs a shape of its own in a list row: use `StatusMark`.

## Example

```tsx
import { Button, CopyIcon, SuccessIcon } from '@codepawlhq/orglet-ui';

<Button type="button" variant="outline"><CopyIcon /> Copy link</Button>
<Button type="button" size="icon" aria-label="Copy link"><CopyIcon /></Button>
<SuccessIcon title="Saved" size={20} />
```

Every icon is its own named export, so a bundler drops the ones you do not import.

| Icon | Use for |
|---|---|
| `AlertIcon` | A warning: something may go wrong. |
| `ArrowLeftIcon` | Back to the previous page. |
| `ArrowRightIcon` | Forward, continue. |
| `ArrowUpRightIcon` | A link that leaves the app or opens a new tab. |
| `BellIcon` | Notifications. |
| `BookIcon` | Documentation, guides. |
| `CalendarIcon` | A date or a schedule. |
| `CheckIcon` | Done, chosen, on. |
| `ChevronDownIcon` | An opened list, a menu or a section that expands. |
| `ChevronLeftIcon` | Previous item or page. |
| `ChevronRightIcon` | Next item, a row that opens something. |
| `ChevronUpIcon` | A list closed back up. |
| `CloseIcon` | Close a dialog, remove a chip. |
| `CodeIcon` | Source code, a technical view. |
| `CopyIcon` | Copy to the clipboard. |
| `DownloadIcon` | Save a file to the device. |
| `ErrorIcon` | A failure: something did not work. |
| `EyeIcon` | Show, preview, or a hidden value revealed. |
| `FileIcon` | Any file. |
| `FileTextIcon` | A document or a text file. |
| `GitHubIcon` | The GitHub mark: a repository or an account. Filled, the one exception to stroke-only. |
| `InfoIcon` | A neutral note or a hint. |
| `MenuIcon` | Open the navigation. |
| `MinusIcon` | Remove one, collapse, subtract. |
| `MonitorIcon` | The system theme or a computer. |
| `MoonIcon` | The dark theme. |
| `MoreHorizontalIcon` | More actions in a row of controls. |
| `MoreVerticalIcon` | More actions for a list row. |
| `PackageIcon` | A package or a release. |
| `PencilIcon` | Edit. |
| `PlusIcon` | Add, create. |
| `SearchIcon` | Search or filter by text. |
| `SettingsIcon` | Settings and preferences. |
| `SuccessIcon` | A success: it worked. |
| `SunIcon` | The light theme. |
| `TrashIcon` | Delete. |
| `UserIcon` | A person or an account. |

## Props

Every `<svg>` prop passes through.

| Prop | Type | Default | What it does |
|---|---|---|---|
| `size` | `number` | `16` | Width and height in pixels. |
| `title` | `string` | | Names the icon for assistive technology. Without it the icon is hidden from it. |
| `className` | `string` | | Applied last, after the kit's `org-icon` class. |

## Accessibility

- Decorative by default: the svg is `aria-hidden="true"`. Pass `title` only when the icon stands alone without text
  beside it; it then gets `role="img"` and `aria-label`.
- An icon-only button still needs `aria-label` on the button itself. The icon inside stays hidden.
- Icons take `currentColor`, so contrast follows the text colour around them. A status never relies on colour alone:
  `AlertIcon`, `ErrorIcon`, `SuccessIcon` and `InfoIcon` each have their own shape.
- Put an icon to the left of its text, and keep both in the same control so one click target covers them.
