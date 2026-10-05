---
name: DialogOverlay
exports: DialogOverlay, keepOpenForPopup, OPEN_POPUP_SELECTOR, useReturnFocus
group: Overlays
summary: The pieces to make your own Radix dialog behave like the kit's: backdrop, Escape order and focus return.
---

## When to use

- Building a dialog the kit does not have, on Radix `Dialog`, that should look and behave like the others.
- `DialogOverlay` for the frosted backdrop inside a `Dialog.Portal`.
- `keepOpenForPopup` on `Dialog.Content`'s `onEscapeKeyDown`, so Escape closes an open menu or list before the dialog.
- `useReturnFocus` for a dialog opened from state, with no `Dialog.Trigger`: it remembers the opener and focuses it again on close.
- `OPEN_POPUP_SELECTOR` when you write your own check for "is a popup open inside this dialog".

## When not to

- A panel, a settings dialog, a viewer or a question: use `Drawer`, `TabbedDialog`, `Viewer` or `Confirm`, which already use these.
- A popover next to a trigger: use `AnchoredPopover`.

## Example

```tsx
import * as Dialog from '@radix-ui/react-dialog';
import { DialogOverlay, keepOpenForPopup, useReturnFocus } from '@codepawlhq/orglet-ui';

function PlanDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const returnFocus = useReturnFocus();
  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <Dialog.Portal>
      <DialogOverlay />
      <Dialog.Content onEscapeKeyDown={keepOpenForPopup} {...returnFocus}>
        <Dialog.Title>Plan</Dialog.Title>
        <PlanFields />
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
```

## Props

### DialogOverlay

| Prop | Type | Default | What it does |
|---|---|---|---|
| `className` | `string` | | Applied last, so it overrides the kit's classes. |

### keepOpenForPopup

`keepOpenForPopup(event: KeyboardEvent): void`. Pass it as `onEscapeKeyDown`. It calls `preventDefault` when focus is inside an open menu, list or picker, so only that closes.

### OPEN_POPUP_SELECTOR

A CSS selector string. It matches `[aria-haspopup][aria-expanded="true"]`, an expanded `[role="combobox"]`, and anything with `data-popup-open`. A disclosure that only shows more of a form is not matched on purpose.

### useReturnFocus

`useReturnFocus(onOpenAutoFocus?: (event: Event) => void)` returns `{ onOpenAutoFocus, onCloseAutoFocus }`. Spread it on `Dialog.Content`.

| Prop | Type | Default | What it does |
|---|---|---|---|
| `onOpenAutoFocus` | `(event: Event) => void` | | Your own handler, run after the opener is remembered. |

## Accessibility

- Focus returns to the opener only when it would otherwise be lost: on the page, or still inside the closed dialog. A deliberate focus elsewhere is kept.
- Escape order is menu first, dialog second. Mark your own popups with `data-popup-open` to join that order.
- Give the dialog a `Dialog.Title`. Radix warns without one, and a dialog without a name is unusable to screen readers.
