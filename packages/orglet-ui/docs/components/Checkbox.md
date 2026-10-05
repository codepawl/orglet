---
name: Checkbox
exports: Checkbox
group: Forms
summary: A tick for picking items out of a list or confirming something once, with a label and optional description.
---

## When to use

- Picking some items out of a list: files to attach, channels to join.
- Confirming something once: "I have read the terms".
- A choice the form cannot be saved without: set `required` to draw the red asterisk.

## When not to

- A setting with two states, on and off: use `Switch` (or `SwitchField` for a whole row).
- Exactly one choice out of a few: use `Select`, or `ToolbarToggleGroup` for icons.
- An action: use `Button`.

## Example

```tsx
import { Checkbox } from '@codepawlhq/orglet-ui';

<Checkbox checked={allowed} onChange={event => setAllowed(event.target.checked)} required description="You can change this later.">
  I allow this orglet to read the folder
</Checkbox>
```

## Props

Every `<input>` prop except `type` and `children` passes through to the real input, `ref` included.

| Prop | Type | Default | What it does |
|---|---|---|---|
| `children` | `ReactNode` | required | The label text. |
| `description` | `ReactNode` | | A second, quieter line under the label. |
| `required` | `boolean` | | Draws a red asterisk in CSS and sets `aria-required`. It does not set native `required`, so there is no browser bubble. |
| `labelProps` | `Omit<ComponentProps<'label'>, 'children' \| 'className'>` | | Props for the wrapping `<label>`. |
| `className` | `string` | | Applied last, on the wrapping label. |

## Accessibility

- It is a real, visually hidden `<input type="checkbox">`, so keyboard, forms, screen readers and tests work as usual.
- The asterisk is drawn in CSS and never lands in the accessible name.
- The description is part of the label, so it is read with it.
- The form says what is wrong in its own words when a required tick is missing.
