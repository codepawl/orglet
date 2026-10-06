---
name: RadioGroup
exports: RadioGroup, RadioOption
group: Forms
summary: One choice out of a few labelled options, each with an optional description.
---

## When to use

- Picking exactly one of a few options that a person should see together, such as how often to send a report.
- Options that need a sentence of explanation each: use `description`.

## When not to

- Picking several: use `Checkbox`.
- An on/off setting: use `Switch`.
- A long list or a choice with groups and icons: use `Select`.
- A few icons rather than words: use `ToolbarToggleGroup`.

## Example

```tsx
import { RadioGroup } from '@codepawlhq/orglet-ui';

<RadioGroup
  label="Send the report"
  name="schedule"
  value={schedule}
  onChange={setSchedule}
  options={[
    { value: 'daily', label: 'Every day', description: 'At 08:00 on workdays' },
    { value: 'weekly', label: 'Every week' },
    { value: 'never', label: 'Never', disabled: true },
  ]}
/>
```

## Props

Every `<fieldset>` prop passes through, except `name` and `onChange`, which mean something else here.

| Prop | Type | Default | What it does |
|---|---|---|---|
| `label` | `ReactNode` | | The group's title, drawn as its `<legend>` and used as its name. |
| `options` | `{ value, label, description?, disabled? }[]` | | The choices. |
| `value` | `string` | | The picked option's value, or an empty string for none. |
| `onChange` | `(value: string) => void` | | Called with the value of the option chosen. |
| `name` | `string` | made up | The form field name. |
| `required` | `boolean` | `false` | Draws the red asterisk and sets `aria-required`, without the browser's validation bubble. |
| `disabled` | `boolean` | `false` | Disables every option. |
| `className` | `string` | | Applied last, so it overrides the kit's classes. |

## Accessibility

- Every option is a real, visually hidden `<input type="radio">` with a drawn mark, so forms, the arrow keys and screen readers work as the browser has them. The group is one Tab stop; the arrow keys move the choice.
- The `<fieldset>` is a radio group named by its legend. The required asterisk is drawn in CSS with empty alternative text, so it stays out of the name.
- A visible focus ring appears around the mark on keyboard focus.
