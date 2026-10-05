---
name: InfoTip
exports: InfoTip, InfoTipRow
group: Overlays
summary: A small button that reveals technical detail such as ids and paths on hover, focus or click.
---

## When to use

- Detail most people never need but some need to copy: an id, a path, a hash, a version.
- Rows of label and value, some in monospace, some with a copy button.
- Next to a title where there is no room for the detail itself.

## When not to

- A hint everyone needs: write it as text.
- A panel with controls in it: use `AnchoredPopover`.
- A list of actions: use `RowMenu`.
- A result or an error: use `StatusMark` or `showToast`.

## Example

```tsx
import { InfoTip, type InfoTipRow } from '@codepawlhq/orglet-ui';
import { Info } from 'lucide-react';

const rows: InfoTipRow[] = [
  { label: 'Chat id', value: chat.id, mono: true, onCopy: () => navigator.clipboard.writeText(chat.id) },
  { label: 'Folder', value: chat.folder, mono: true },
  { label: 'Created', value: createdText },
];

<InfoTip label="Chat details" icon={<Info size={16} aria-hidden />} rows={rows} copyLabel={rowLabel => `Copy ${rowLabel}`} />
```

## Props

### InfoTip

| Prop | Type | Default | What it does |
|---|---|---|---|
| `label` | `string` | required | The trigger's accessible name. |
| `rows` | `InfoTipRow[]` | required | The lines of the panel. |
| `icon` | `ReactNode` | required | What the trigger shows. |
| `copyLabel` | `(rowLabel: string) => string` | required | Names each row's copy button from the row's label. |

### InfoTipRow

| Prop | Type | Default | What it does |
|---|---|---|---|
| `label` | `string` | required | The row's name. |
| `value` | `ReactNode` | required | The row's content. |
| `mono` | `boolean` | | Draws the value in a monospace face, for ids and hashes. |
| `onCopy` | `() => void \| Promise<void>` | | Adds a copy button. The application writes to the clipboard. The button shows a tick for a moment after. |

## Accessibility

- The trigger is a button with `aria-expanded`. The panel is `role="tooltip"` and described by id while open.
- It opens on hover and keyboard focus, and a click pins it so a copy button can be reached.
- Escape, focus leaving, a pointer outside and a resize close it. Escape does not close a dialog around it.
- Hovering the panel keeps it open, and it closes shortly after the pointer leaves both.
- The panel is portaled into the open dialog or the page, so a scrolling container cannot clip it.
