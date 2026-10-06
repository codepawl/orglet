---
name: PanelHeading
exports: PanelHeading
group: Display
summary: A section's title with its description beneath and the section's own actions on the right.
---

## When to use

- The top of a section or a settings panel: a title, a line of description and the actions that belong to it.
- Choosing the heading `level` (2 or 3) so the section sits correctly in the page's outline.

## When not to

- A field's title: use `FieldLabel`.
- A dialog's title bar: the dialog components draw their own.
- Divider lines between sections: use spacing or grouping instead.

## Example

```tsx
import { Button, PanelHeading } from '@codepawlhq/orglet-ui';
import { Plus } from 'lucide-react';

<PanelHeading title="Skills" description="What this orglet knows how to do.">
  <Button type="button" variant="primary"><Plus size={16} aria-hidden />New skill</Button>
</PanelHeading>
```

## Props

| Prop | Type | Default | What it does |
|---|---|---|---|
| `title` | `ReactNode` | required | The heading's text. |
| `description` | `ReactNode` | | A line under the title. It wraps before the actions do. |
| `level` | `2 \| 3` | `2` | The heading element: `h2` or `h3`. |
| `className` | `string` | | Applied last, so it overrides the kit's classes. |
| `children` | `ReactNode` | | The section's actions, on the right, vertically centred. |

## Accessibility

- It renders a real `h2` or `h3`. Pick the level that fits the page, not the look.
- Actions end flush with the section's right edge, so give each a visible surface: `primary` for the section's main add or create action, `outline` for a utility action. A bare `ghost` button with a label reads as shifted left. An icon-only `ghost` button is fine.
- An icon in an action sits left of its text.
