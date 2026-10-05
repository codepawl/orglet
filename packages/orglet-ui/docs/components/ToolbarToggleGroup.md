---
name: ToolbarToggleGroup
exports: ToolbarToggleGroup, ToolbarToggleItem
group: Actions
summary: One choice out of a few small icon buttons, such as the tool or colour of a drawing bar.
---

## When to use

- Picking one option out of a few that are best shown as icons: a drawing tool, a stroke width, a colour.
- A choice that stays visible in a toolbar and applies at once.
- Options that have a keyboard shortcut handled elsewhere: pass it in `shortcut` so it is shown and announced.

## When not to

- A single on/off setting: use `Switch`.
- A long list or options that need words: use `Select`.
- Picking several items from a list: use `Checkbox`.
- A plain action with no state: use `Button` with `size="icon"`.

## Example

```tsx
import { ToolbarToggleGroup, type ToolbarToggleItem } from '@codepawlhq/orglet-ui';
import { Highlighter, Pen, Square } from 'lucide-react';

const tools: ToolbarToggleItem[] = [
  { value: 'pen', label: 'Pen', icon: <Pen size={16} aria-hidden />, shortcut: 'P' },
  { value: 'highlight', label: 'Highlighter', icon: <Highlighter size={16} aria-hidden />, shortcut: 'H' },
  { value: 'box', label: 'Rectangle', icon: <Square size={16} aria-hidden />, shortcut: 'R' },
];

<ToolbarToggleGroup label="Drawing tool" items={tools} value={tool} onValueChange={setTool} />
```

## Props

### ToolbarToggleGroup

| Prop | Type | Default | What it does |
|---|---|---|---|
| `label` | `string` | required | Names the radio group. |
| `items` | `readonly ToolbarToggleItem[]` | required | The choices, in order. |
| `value` | `string` | required | The `value` of the picked item. |
| `onValueChange` | `(value: string) => void` | required | Called when an item is clicked or reached with the arrow keys. |
| `className` | `string` | | Applied last, so it overrides the kit's classes. |

### ToolbarToggleItem

| Prop | Type | Default | What it does |
|---|---|---|---|
| `value` | `string` | required | What `value` and `onValueChange` carry. |
| `label` | `string` | required | What a screen reader hears and the tooltip shows. |
| `icon` | `ReactNode` | required | What the button draws. Mark it `aria-hidden`. |
| `shortcut` | `string` | | The key that picks it, shown in the tooltip and set as `aria-keyshortcuts`. The kit does not handle the key. |

## Accessibility

- It is a `radiogroup`. Only the picked button is in the Tab order, so the group is one Tab stop.
- Arrow keys, Home and End move the choice and the focus together, and wrap at the ends.
- Each button is named by its `label`, never by its icon.
- The picked state is a pale tint behind the icon and also `aria-checked`.
