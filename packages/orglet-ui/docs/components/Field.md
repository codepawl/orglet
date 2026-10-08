---
name: Field
exports: Input, Textarea, FieldError
group: Forms
summary: A single-line text input and a multi-line textarea with a shared invalid state and shake, and the line that says what is wrong under a field.
---

## When to use

- `Input` for one line of text: a name, a path, a search.
- `Textarea` for several lines: instructions, a message.
- Marking a failed validation with `invalid`, and replaying the shake on each failed submit with `flash`.
- Saying what is wrong, directly under the field, with `FieldError`: a mark, then a short sentence, in the error colour. Turn the browser's own bubble off with `noValidate` on the form and validate on submit.

## When not to

- An amount of money: use `MoneyInput`.
- One value from a fixed list: use `Select`.
- A name edited where it is shown: use `EditableText`.
- An on/off setting: use `Switch`. A tick for picking from a list: use `Checkbox`.
- A bare field with no name: give it a `<label>` around it or `aria-label`. The kit does not invent one.

## Example

```tsx
import { FieldError, FieldLabel, Input, Textarea } from '@codepawlhq/orglet-ui';
import { FileText, Tag } from 'lucide-react';

<label>
  <FieldLabel icon={Tag} required>Name</FieldLabel>
  <Input value={name} onChange={event => setName(event.target.value)} invalid={nameError} flash={failedSubmits} aria-describedby="name-error" />
  {nameError && <FieldError id="name-error">Give it a name.</FieldError>}
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

`FieldError` takes the props of a `<span>` (`id` is the one to use) and its children are the message. It carries `role="alert"`, so it is announced when it appears, and draws the kit's error mark before the text.

## Accessibility

- Name every field with a wrapping `<label>` or `aria-label`.
- `invalid` sets `aria-invalid="true"`. Say what is wrong in text near the field, with a mark, not by colour alone: that is `FieldError`, and the field's `aria-describedby` points at its `id`.
- `Textarea` grows downwards only, so the form around it does not rearrange.
