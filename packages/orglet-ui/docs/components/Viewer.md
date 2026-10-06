---
name: Viewer
exports: Viewer
group: Overlays
summary: A large Quick Look style dialog for looking at one document, file or diff.
---

## When to use

- Looking at one thing at full size: a document, an image, a PDF, a diff.
- A title with an `icon` and a `meta` line, `actions` on the right and a content area that scrolls on its own.
- An editing mode with its own tools: put them in `toolbar`, a second row that stays while the content scrolls.

## When not to

- An editor or list with a header of actions: use `Drawer`.
- Settings in sections: use `TabbedDialog`.
- A yes-or-no question: use `confirmAction` from `Confirm`.
- A tool row inside the viewer: build it with `ToolbarToggleGroup` and `Button`.

## Example

```tsx
import { Button, Viewer } from '@codepawlhq/orglet-ui';
import { Download, FileText, X } from 'lucide-react';

<Viewer
  open={open}
  onClose={() => setOpen(false)}
  title="report.pdf"
  icon={<FileText size={16} aria-hidden />}
  meta="1.4 MB"
  closeLabel="Close"
  closeIcon={<X size={16} aria-hidden />}
  actions={<Button type="button" variant="outline"><Download size={16} aria-hidden />Download</Button>}
>
  <FilePreview />
</Viewer>
```

## Props

| Prop | Type | Default | What it does |
|---|---|---|---|
| `open` | `boolean` | required | Whether the viewer is shown. |
| `onClose` | `() => void` | required | Called on Escape, the backdrop and the close button. |
| `title` | `ReactNode` | required | Centred in the toolbar. |
| `icon` | `ReactNode` | | Sits left of the title. |
| `meta` | `ReactNode` | | A quiet line under the title. |
| `actions` | `ReactNode` | | On the toolbar's right. |
| `toolbar` | `ReactNode` | | A centred row of tools under the toolbar, for an editing mode. |
| `closeLabel` | `string` | required | The close button's accessible name and tooltip. |
| `closeIcon` | `ReactNode` | required | The close button's icon. |
| `id` | `string` | | Set on the dialog. |
| `className` | `string` | | Classes for the dialog, such as one that makes it wider. |
| `children` | `ReactNode` | required | The content, on a grey backdrop that scrolls on its own. |

## Accessibility

- It is a modal dialog built on Radix, named by its title. Focus is trapped and returns to the opener on close.
- Escape closes an open menu or list inside first, then the viewer.
- The close button is on the left of the toolbar and is named by `closeLabel`.
- The close X belongs here because the viewer is a centred dialog.
