---
name: Confirm
exports: confirmAction, Confirmer
group: Overlays
summary: Ask one yes-or-no question in a small modal and await the answer, from anywhere in the application.
---

## When to use

- A yes that cannot be undone: deleting a chat, erasing data. Use `tone: 'danger'`.
- A choice the person must make before the action goes on, where you want `await` instead of state.
- Render one `Confirmer` in the application and call `confirmAction` from any handler.

## When not to

- A question tied to a row's menu item: use `confirm` on the `RowMenu` item, which asks inside the panel.
- A form with several fields: use `TabbedFormDialog`.
- A message that needs no answer: use `showToast` from `Toaster`.
- Something that can be undone: do it, and offer the undo in a toast action.

## Example

```tsx
import { Confirmer, confirmAction } from '@codepawlhq/orglet-ui';

async function deleteChat(chatId: string) {
  const confirmed = await confirmAction({
    title: 'Delete this chat?',
    description: 'Its messages and files are removed from this computer.',
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (confirmed) await removeChat(chatId);
}

// Once, near the root of the application:
<Confirmer confirmLabel="Yes" cancelLabel="No" />
```

## Props

### confirmAction

`confirmAction(options): Promise<boolean>`. It resolves `true` only when the person confirms. A second question while one is open answers the first with `false`.

| Prop | Type | Default | What it does |
|---|---|---|---|
| `title` | `string` | required | The question. |
| `description` | `string` | | A sentence of detail under it. |
| `confirmLabel` | `string` | the `Confirmer`'s | The yes button's text. |
| `cancelLabel` | `string` | the `Confirmer`'s | The no button's text. |
| `tone` | `'default' \| 'danger'` | `'default'` | `danger` draws the yes as a danger button. |

### Confirmer

| Prop | Type | Default | What it does |
|---|---|---|---|
| `confirmLabel` | `string` | required | The yes text when a question brings none. |
| `cancelLabel` | `string` | required | The no text when a question brings none. |

## Accessibility

- It is an `alertdialog`. The title names it and the description describes it.
- The safe answer, the cancel button, takes focus when it opens.
- Escape and a click on the backdrop answer `false`.
- Focus returns to what asked when the dialog closes.
- A danger yes is also worded as the action ("Delete"), not "Yes", so colour is not the only cue.
