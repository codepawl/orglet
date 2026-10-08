---
name: RowMenu
exports: RowMenu, RowMenuIcon, RowMenuItem
group: Actions
summary: A menu of a row's actions behind one icon button, with an in-panel question for destructive items.
---

## When to use

- The actions of one row in a list: rename, duplicate, delete.
- A destructive item that should ask first: give it `confirm` and the question appears inside the same panel.
- A right-click menu on a row: set `contextMenuOf` to a selector of the ancestor that owns the click.

## When not to

- One action only, with no question: use a `Button`.
- Choosing a value for a field: use `Select`.
- A question that needs a full sentence of explanation or is not tied to a row: use `confirmAction` from `Confirm`.
- An on/off setting: use `Switch`.

## Example

```tsx
import { RowMenu, type RowMenuItem } from '@codepawlhq/orglet-ui';
import { Copy, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

const items: RowMenuItem[] = [
  { label: 'Rename', icon: Pencil, onSelect: rename, shortcut: 'F2' },
  { label: 'Duplicate', icon: Copy, onSelect: duplicate },
  { label: 'Delete', icon: Trash2, danger: true, onSelect: remove, confirm: { question: 'Delete this chat?', label: 'Delete' } },
];

<RowMenu label="Chat actions" icon={MoreHorizontal} items={items} cancelLabel="No" />
```

## Props

### RowMenu

| Prop | Type | Default | What it does |
|---|---|---|---|
| `label` | `string` | required | Names the trigger and the panel. Also the trigger's tooltip. |
| `items` | `RowMenuItem[]` | required | The entries, in order. |
| `icon` | `RowMenuIcon` | required | What the trigger shows. |
| `cancelLabel` | `string` | required | The way back from a question, such as "No". |
| `children` | `ReactNode` | | A trigger wider than one icon. Shown in place of the icon, and the button drops its square size. |
| `className` | `string` | | Classes for the trigger button. |
| `align` | `'start' \| 'end'` | `'end'` | Which edge of the trigger the panel lines up with. |
| `asksOnOpen` | `boolean` | `false` | A menu of one item with `confirm` opens straight on its question. |
| `contextMenuOf` | `string` | | A selector. A right-click inside the closest matching ancestor opens the menu at the pointer. |
| `disabled` | `boolean` | `false` | Disables the trigger. |

### RowMenuItem

| Prop | Type | Default | What it does |
|---|---|---|---|
| `label` | `string` | required | The item's text. Also its key, so it is unique in one menu. |
| `icon` | `RowMenuIcon` | required | An icon component that takes `size`, such as one from lucide-react. Sits left of the label. |
| `onSelect` | `() => void` | required | Runs after the menu closes, or after the question is confirmed. |
| `danger` | `boolean` | | Draws the item in the danger colour. |
| `confirm` | `{ question: string; label: string; icon?: Icon; safe?: boolean }` | | Asks inside the panel before running `onSelect`. `icon` replaces the item's icon on the answer; `safe` drops the danger colour when the answer is a way out (open the channel that blocks a delete) rather than the destructive act. |
| `shortcut` | `string` | | The keys that do the same thing, shown quietly at the item's end and announced on the trigger. |

### RowMenuIcon

A type: any icon component that takes `size` and `aria-hidden`, such as one from lucide-react. It is used by `icon` on the menu and on each item.

## Accessibility

- The trigger has `aria-haspopup="menu"` and `aria-expanded`. The panel has `role="menu"` and items have `role="menuitem"`.
- Arrow keys move between items and wrap. Escape closes the panel and returns focus to the trigger, or backs out of a question first.
- The panel also closes on a pointer outside, on resize and when focus leaves.
- The panel is portaled into the open dialog, or the page, so a row's overflow cannot clip it.
- Icons are `aria-hidden`. The shortcut is shown but hidden from assistive technology, and `aria-keyshortcuts` on the trigger carries it.
