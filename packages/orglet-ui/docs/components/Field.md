---
name: Field
exports: Input, Textarea
group: Forms
summary: A single-line text input and a multi-line textarea with a shared invalid state and shake.
---

## When to use

- `Input` for one line of text: a name, a path, a search.
- `Textarea` for several lines: instructions, a message.
- Marking a failed validation with `invalid`, and replaying the shake on each failed submit with `flash`.

## When not to

- An amount of money: use `MoneyInput`.
- One value from a fixed list: use `Select`.
- A name edited where it is shown: use `EditableText`.
- An on/off setting: use `Switch`. A tick for picking from a list: use `Checkbox`.
- A bare field with no name: give it a `<label>` around it or `aria-label`. The kit does not invent one.

## Example

```tsx
import { FieldLabel, Input, Textarea } from '@codepawlhq/orglet-ui';
import { FileText, Tag } from 'lucide-react';

<label>
  <FieldLabel icon={Tag} required>Name</FieldLabel>
  <Input value={name} onChange={event => setName(event.target.value)} invalid={nameError} flash={failedSubmits} />
</label>
<label>
  <FieldLabel icon={FileText}>Instructions</FieldLabel>
  <Textarea rows={4} value={instructions} onChange={event => setInstructions(event.target.value)} />
</label>
```

## Props

Every `<input>` prop passes through to `Input`, and every `<textarea>` prop to `Textarea`. `ref` is included.

| Prop | Type | Default | What it does |
|---|---|---|---|
| `invalid` | `boolean` | | Sets `aria-invalid` and draws the error border. |
| `flash` | `number` | | A counter the form increments on every failed submit, so the shake plays each time. Only used with `invalid`. |
| `className` | `string` | | Applied last, so it overrides the kit's classes. |

## Accessibility

- Name every field with a wrapping `<label>` or `aria-label`.
- `invalid` sets `aria-invalid="true"`. Say what is wrong in text near the field, with a mark, not by colour alone.
- `Textarea` grows downwards only, so the form around it does not rearrange.
