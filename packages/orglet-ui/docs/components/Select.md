---
name: Select
exports: Select, SelectOption
group: Forms
summary: A single-choice dropdown with groups, details, icons and full keyboard support.
---

## When to use

- One value out of a list that is too long or too wordy for icon buttons: a model, a folder, a language.
- Options that need a second line (`detail`), an icon, a group title, a badge or their own font.
- A row that is an action, not a value, such as "More": give it `onSelect`.

## When not to

- Two states, on and off: use `Switch`.
- Several items picked from a list: use `Checkbox`.
- A few icon choices in a toolbar: use `ToolbarToggleGroup`.
- Free text: use `Input`.
- A menu of actions on a row: use `RowMenu`.

## Example

```tsx
import { Select, type SelectOption } from '@codepawlhq/orglet-ui';

const models: SelectOption[] = [
  { value: 'fast', label: 'Fast', detail: 'Cheap, good for drafts', group: 'Models' },
  { value: 'deep', label: 'Deep', detail: 'Slower, better at hard tasks', group: 'Models', note: 'default' },
];

<Select value={model} options={models} onChange={setModel} ariaLabel="Model" placeholder="Pick a model" />
```

## Props

### Select

| Prop | Type | Default | What it does |
|---|---|---|---|
| `value` | `string` | required | The chosen option's `value`. |
| `options` | `SelectOption[]` | required | The choices, in order. |
| `onChange` | `(value: string) => void` | required | Called when a different option is chosen. |
| `ariaLabel` | `string` | | The accessible name, when there is no visible title. |
| `labelledBy` | `string` | | The id of a visible title that names it. |
| `describedBy` | `string` | | The id of a description. |
| `placeholder` | `string` | | Shown while nothing is chosen. |
| `disabled` | `boolean` | | Disables the trigger. |
| `size` | `'md' \| 'sm'` | `'md'` | The trigger's height. |
| `className` | `string` | | Classes for the trigger button. |
| `menuMinWidth` | `number` | `0` | The menu is at least this wide in pixels. |
| `showDetail` | `boolean` | `true` | Show the chosen option's detail in the trigger. |
| `showIcon` | `boolean` | `true` | Show the chosen option's icon in the trigger. The menu keeps its icons. |
| `inlineDetail` | `boolean` | `false` | Put each option's detail on the label's line. |
| `invalid` | `boolean` | | Sets `aria-invalid` and a red border. |
| `flash` | `number` | | A counter that replays the shake each time it changes. Only used with `invalid`. |
| `field` | `string` | | Set as the trigger's `data-field`, the name a form uses to find and focus it. |
| `ref` | `Ref<HTMLButtonElement>` | | The trigger button. |

### SelectOption

| Prop | Type | Default | What it does |
|---|---|---|---|
| `value` | `string` | required | What `value` and `onChange` carry. |
| `label` | `string` | required | The option's text. |
| `note` | `string` | | A small muted word after the label in the menu, such as "default". |
| `detail` | `string` | | A second, muted line. |
| `icon` | `ReactNode` | | Sits left of the label. |
| `disabled` | `boolean` | | Cannot be chosen and is skipped by the keys. |
| `dimmed` | `boolean` | | Greyed but still works. |
| `group` | `string` | | Starts a titled group where it changes. |
| `badge` | `ReactNode` | | A small chip at the row's end. |
| `labelStyle` | `CSSProperties` | | Draws the label in what it names, such as a font family. |
| `spaced` | `boolean` | | Starts the row after a small gap, a group with no title. |
| `onSelect` | `() => void` | | Makes the row an action: it runs and the list stays open. |

## Accessibility

- It follows the select-only combobox pattern: the trigger is `role="combobox"`, the list is a `listbox` and options are `option`.
- Name it with `ariaLabel` or `labelledBy`.
- Keys: arrows, Page Up and Down, Home and End, type to jump, Enter or Space to choose, Escape to close without closing a dialog around it.
- The menu is portaled into the open dialog or the page, and flips above the trigger when there is more room there.
- The chosen option is marked with a tick as well as `aria-selected`.
