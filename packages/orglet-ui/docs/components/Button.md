---
name: Button
exports: Button
group: Actions
summary: A button in four looks, or a square holding one icon.
---

## When to use

- Anything a person clicks to act: save, cancel, open, delete.
- `primary` for the one main action of a place, `outline` for a secondary action, `ghost` (the default) for quiet
  actions, `danger` for a yes that cannot be undone.
- `size="icon"` for a square holding one icon.

## When not to

- Navigation to another page or site: use a link.
- An on/off setting: use `Switch`.
- One choice out of a few icons: use `ToolbarToggleGroup`.
- Two `primary` buttons in one place: the second steps down to `outline`.

## Example

```tsx
import { Button } from '@codepawlhq/orglet-ui';
import { Trash2 } from 'lucide-react';

<Button type="button" variant="primary" onClick={save}>Save</Button>
<Button type="button" variant="outline" onClick={close}>Cancel</Button>
<Button type="button" size="icon" aria-label="Delete" onClick={remove}><Trash2 size={16} aria-hidden /></Button>
```

## Props

Every `<button>` prop passes through, `ref` included.

| Prop | Type | Default | What it does |
|---|---|---|---|
| `variant` | `'ghost' \| 'outline' \| 'primary' \| 'danger'` | `'ghost'` | The look. |
| `size` | `'default' \| 'icon'` | `'default'` | `icon` is a square for a single icon. |
| `className` | `string` | | Applied last, so it overrides the kit's classes. |

## Accessibility

- `type` is not set for you. Inside a form a button submits, so a button that only acts says `type="button"`.
- An icon-only button needs `aria-label`, and its icon is `aria-hidden`.
- An icon sits left of the text, never right.
