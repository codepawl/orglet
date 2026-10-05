---
name: AnchoredPopover
exports: AnchoredPopover
group: Overlays
summary: A panel that floats beside its trigger, flips above when there is no room and closes on Escape.
---

## When to use

- A small panel opened by a button: a colour picker, a filter, a quick form.
- Anywhere an inline panel would push the layout around.
- Inside a dialog: it portals into that dialog, so the focus trap and scrolling still hold.

## When not to

- A list of actions on a row: use `RowMenu`.
- A choice from a list: use `Select`.
- Technical detail on hover: use `InfoTip`.
- A short message that needs no interaction: use `showToast` from `Toaster`.
- A full-size panel: use `Drawer`.

## Example

```tsx
import { AnchoredPopover, Button, Input } from '@codepawlhq/orglet-ui';
import { useRef, useState } from 'react';

const anchor = useRef<HTMLButtonElement>(null);
const [open, setOpen] = useState(false);

<Button ref={anchor} type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>Filter</Button>
<AnchoredPopover anchor={anchor} open={open} onClose={() => setOpen(false)} label="Filter chats">
  <Input aria-label="Search" placeholder="Search" />
</AnchoredPopover>
```

## Props

| Prop | Type | Default | What it does |
|---|---|---|---|
| `anchor` | `RefObject<HTMLElement \| null>` | required | The element it sits beside. A click on its own control does not count as outside. |
| `open` | `boolean` | required | Whether it is shown. Nothing renders when false. |
| `onClose` | `() => void` | required | Called on Escape and on a pointer outside. |
| `label` | `string` | required | The popover's accessible name. |
| `className` | `string` | | Applied last, so it overrides the kit's classes. |
| `children` | `ReactNode` | required | The content. |

## Accessibility

- It is `role="dialog"` with `aria-label`. Focus moves to its first control once it is placed.
- Escape closes it and gives focus back to the anchor.
- It sets `data-popup-open`, so a dialog around it stays open on that Escape.
- Content taller than the room is held to the room and scrolls inside.
- Give the anchor `aria-expanded` yourself, since the anchor is your element.
