---
name: Drawer
exports: Drawer
group: Overlays
summary: A centred panel for an editor or a list, with a header, actions and a body that scrolls on its own.
---

## When to use

- An editor or a list that needs room and is opened from the page: a skill list, an instruction editor.
- A header with a title or breadcrumb, a `description` and the panel's own `actions`.
- Content that scrolls on its own while the header stays put.

## When not to

- One yes-or-no question: use `confirmAction` from `Confirm`.
- Settings split into sections: use `TabbedDialog` or `TabbedFormDialog`.
- Looking at one document, file or diff: use `Viewer`.
- A small panel attached to a button: use `AnchoredPopover`.
- A place reached from the navigation: open it as a page in the main panel, not as a dialog.

## Example

```tsx
import { Button, Drawer } from '@codepawlhq/orglet-ui';
import { Plus, X } from 'lucide-react';

<Drawer
  open={open}
  onClose={() => setOpen(false)}
  title="Skills"
  description="What this orglet knows how to do."
  closeLabel="Close"
  closeIcon={<X size={16} aria-hidden />}
  actions={<Button type="button" variant="primary"><Plus size={16} aria-hidden />New skill</Button>}
>
  <SkillList />
</Drawer>
```

## Props

| Prop | Type | Default | What it does |
|---|---|---|---|
| `open` | `boolean` | required | Whether the panel is shown. |
| `onClose` | `() => void` | required | Called on Escape, a click on the backdrop and the close button. |
| `title` | `ReactNode` | required | The header's title. A breadcrumb works too. |
| `description` | `ReactNode` | | A line under the title. |
| `actions` | `ReactNode` | | The panel's own actions, left of the close button. |
| `closeLabel` | `string` | required | The close button's accessible name. |
| `closeIcon` | `ReactNode` | required | The close button's icon. |
| `children` | `ReactNode` | required | The body. It scrolls on its own. |

## Accessibility

- It is a modal dialog built on Radix: focus is trapped inside and the title names it.
- Focus returns to what opened it when it closes.
- Escape closes an open menu or list inside the panel first, then the panel.
- The close X belongs here because the panel is centred on the screen. Do not copy it onto side panels.
