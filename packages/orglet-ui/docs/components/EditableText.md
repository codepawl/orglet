---
name: EditableText
exports: EditableText
group: Forms
summary: A name that is renamed where it is shown: text at rest, an input when clicked.
---

## When to use

- A title shown in a header or list that people may rename in place: a chat, an orglet, a channel.
- Saving that may be async: `onCommit` can return a promise, and the new text shows while it runs.

## When not to

- A field in a form with a Save button: use `Input`.
- Text that is long or spans several lines: use `Textarea`.
- A rename that needs an explanation or a confirmation: use a dialog.

## Example

```tsx
import { EditableText } from '@codepawlhq/orglet-ui';

<EditableText
  value={chat.name}
  label={`Rename ${chat.name}`}
  maxLength={80}
  onCommit={async next => { await renameChat(chat.id, next); }}
/>
```

## Props

| Prop | Type | Default | What it does |
|---|---|---|---|
| `value` | `string` | required | The current text. |
| `onCommit` | `(next: string) => void \| Promise<void>` | required | Saves the new text. If it throws, the old text returns and the error is rethrown for the application to show. |
| `label` | `string` | required | The accessible name and the tooltip, such as "Rename Researcher". |
| `maxLength` | `number` | | The input's maximum length. |
| `disabled` | `boolean` | | Stops editing. |
| `className` | `string` | | Applied last, so it overrides the kit's classes. |

## Accessibility

- At rest it is a `<button>` named by `label`. A click, Enter or F2 starts editing with the text selected.
- Enter or leaving the field keeps the change. Escape puts the old value back and does not close a dialog around it.
- An empty or unchanged value commits nothing.
- It shows the outline of an input on hover and keyboard focus, so it reads as editable.
