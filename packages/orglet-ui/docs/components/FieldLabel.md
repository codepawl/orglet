---
name: FieldLabel
exports: FieldLabel, FieldLabelIcon
group: Forms
summary: A field's title with a small leading icon and an optional required asterisk drawn outside its name.
---

## When to use

- The title above a field when an icon helps people find it in a long form.
- A required field: `required` draws the asterisk without adding it to the accessible name.

## When not to

- A title with no icon: write plain text in the `<label>`.
- A section's heading with actions: use `PanelHeading`.
- Naming a field only for assistive technology: use `aria-label` on the control.

## Example

```tsx
import { FieldLabel, Input } from '@codepawlhq/orglet-ui';
import { FolderOpen } from 'lucide-react';

<label>
  <FieldLabel icon={FolderOpen} required>Working folder</FieldLabel>
  <Input value={folder} onChange={event => setFolder(event.target.value)} />
</label>
```

## Props

### FieldLabel

| Prop | Type | Default | What it does |
|---|---|---|---|
| `icon` | `FieldLabelIcon` | required | An icon component that takes `size`, such as one from lucide-react. It sits left of the text. |
| `children` | `ReactNode` | required | The title. |
| `required` | `boolean` | | Draws a red asterisk in CSS with empty alternative text. |
| `className` | `string` | | Applied last, so it overrides the kit's classes. |

### FieldLabelIcon

A type: any icon component that takes `size` and `aria-hidden`, such as one from lucide-react.

## Accessibility

- The icon is decorative and `aria-hidden`, so the accessible name is the text.
- The asterisk never becomes part of the field's name. Mark the control itself `required` or `aria-required` when assistive technology should know.
- It renders a `<span>`, so put it inside a `<label>` that also wraps the control.
