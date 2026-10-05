---
name: Switch
exports: Switch, SwitchField
group: Forms
summary: An on/off switch for a setting that applies at once, bare or as a titled settings row.
---

## When to use

- A setting with exactly two states that takes effect the moment it changes.
- `SwitchField` for a row in a form: the title on the left, the switch on the right, an optional description under the title.
- Bare `Switch` inside a row you lay out yourself, named by `labelledBy` (the row's title) or `label`.

## When not to

- Picking items out of a list, or confirming once: use `Checkbox`.
- A choice out of several: use `Select` or `ToolbarToggleGroup`.
- An action: use `Button`.

## Example

```tsx
import { Switch, SwitchField } from '@codepawlhq/orglet-ui';

<SwitchField checked={notify} onChange={setNotify} description="A sound plays when an orglet finishes.">
  Play a sound
</SwitchField>
<Switch checked={compact} onChange={setCompact} label="Compact lists" />
```

## Props

### Switch

| Prop | Type | Default | What it does |
|---|---|---|---|
| `checked` | `boolean` | required | Whether the setting is on. |
| `onChange` | `(checked: boolean) => void` | required | Called with the new state on click. |
| `disabled` | `boolean` | | Disables the switch. |
| `label` | `string` | | The accessible name, when there is no visible title. |
| `labelledBy` | `string` | | The id of the visible title that names it. |
| `describedBy` | `string` | | The id of a description. |
| `className` | `string` | | Applied last, so it overrides the kit's classes. |

### SwitchField

| Prop | Type | Default | What it does |
|---|---|---|---|
| `checked` | `boolean` | required | Whether the setting is on. |
| `onChange` | `(checked: boolean) => void` | required | Called with the new state on click. |
| `children` | `ReactNode` | required | The setting's title. It names the switch. |
| `description` | `ReactNode` | | A quieter line under the title. |
| `disabled` | `boolean` | | Disables the switch and dims the row. |
| `className` | `string` | | Applied last, on the row. |

## Accessibility

- It is a `<button role="switch">` with `aria-checked`, so Space and Enter toggle it.
- It needs a name: `label`, `labelledBy`, or use `SwitchField`, which wires its title for you.
- The shape alone says it is a switch, so the control is not mistaken for a tick.
