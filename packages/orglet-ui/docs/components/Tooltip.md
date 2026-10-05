---
name: Tooltip
exports: Tooltip, TooltipSide
group: Overlays
summary: A short text label for a control, shown on hover and keyboard focus.
---

## When to use

- Naming an icon-only control, such as a toolbar button, for people who point at it.
- Showing the shortcut that triggers a control, next to its name.

## When not to

- Anything a person must read or act on: put it in the surface, or use `InfoTip` for detail behind a button.
- Links, buttons or copyable text inside the label: a tooltip is not interactive content.
- A control that already shows its own text, where the label would only repeat it.

## Example

```tsx
import { Button, Tooltip } from '@codepawlhq/orglet-ui';
import { Trash2 } from 'lucide-react';

<Tooltip label="Delete chat" shortcut="Ctrl+Shift+D">
  <Button type="button" size="icon" aria-label="Delete chat" onClick={remove}>
    <Trash2 size={16} aria-hidden />
  </Button>
</Tooltip>
```

## Props

| Prop | Type | Default | What it does |
|---|---|---|---|
| `label` | `string` | | The text shown. Required. |
| `shortcut` | `string` | | A key combination shown after the label, such as `Ctrl+K`. Handling the key is the caller's job. |
| `side` | `'top' \| 'bottom'` | `'top'` | Where it sits. It moves to the other side when there is no room. |
| `children` | `ReactElement` | | Exactly one element. It must accept `ref` and pointer and focus handlers, as a `Button` does. |
| `className` | `string` | | Applied last, so it overrides the kit's classes. |

## Accessibility

- While shown, the label is `role="tooltip"` and the child gets `aria-describedby` pointing at it. The child keeps its own accessible name, so an icon-only button still needs `aria-label`.
- It shows after a short hover and at once on keyboard focus, and hides on Escape, when the pointer leaves, on a press and when focus leaves. Escape closes only the tooltip, so a dialog around it stays open.
- It appears inside the open dialog, or on the page, and stays inside the window.
- The label never takes the pointer, and a tooltip is not the only place a control's meaning lives: a touch screen has no hover.
