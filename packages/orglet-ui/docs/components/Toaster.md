---
name: Toaster
exports: showToast, Toaster, ToastAction, ToastTone
group: Feedback
summary: Short messages shown above everything, called from anywhere, with one optional action.
---

## When to use

- A short result of something the person did: saved, copied, failed.
- A fault or a note that should stay long enough to read, and may offer one thing to do about it.
- Call `showToast` from any handler and render one `Toaster` in the application.

## When not to

- A question that needs an answer: use `confirmAction` from `Confirm`.
- A state that stays true, such as a run that is waiting: use `StatusMark` beside the thing.
- A wait: use `Skeleton`. The kit has no spinner.
- A notice about the chat's or the app's state: put it by the prompt bar or on its own surface, not in a toast.

## Example

```tsx
import { Toaster, showToast } from '@codepawlhq/orglet-ui';
import { CircleAlert, CircleCheck, Info } from 'lucide-react';

showToast('Chat deleted', 'success', { label: 'Undo', onSelect: restoreChat });
showToast('Could not save the file', 'error');

// Once, near the root of the application:
<Toaster icons={{
  success: <CircleCheck size={16} aria-hidden />,
  error: <CircleAlert size={16} aria-hidden />,
  info: <Info size={16} aria-hidden />,
}} />
```

## Props

### showToast

`showToast(text, tone?, action?)`. A repeated message replaces its older copy, and at most three are visible. A plain success goes after about 3 seconds, anything else after about 6.

| Prop | Type | Default | What it does |
|---|---|---|---|
| `text` | `string` | required | The message. |
| `tone` | `ToastTone` | `'success'` | `success`, `error` or `info`. |
| `action` | `ToastAction` | | One thing to do about it. Choosing it dismisses the toast first. |

### Toaster

| Prop | Type | Default | What it does |
|---|---|---|---|
| `icons` | `Record<ToastTone, ReactNode>` | required | The mark drawn per tone. Pick shapes that differ per tone, not only colours. |
| `renderText` | `(text: string) => ReactNode` | `text => text` | Lets the application translate a message when it is shown. |

### ToastTone

`'success' | 'error' | 'info'`. `info` is a calm note that is neither a success nor a fault.

### ToastAction

| Prop | Type | Default | What it does |
|---|---|---|---|
| `label` | `string` | required | The action button's text. |
| `onSelect` | `() => void` | required | Runs when it is chosen. |

## Accessibility

- The container is a polite live region. An `error` toast has `role="alert"`, the others `role="status"`.
- It is portaled to the page, so an open modal dialog does not hide the announcements.
- Each toast leads with its tone's icon, left of the text, so the outcome is a shape and not colour alone.
- Toasts are not focusable except their action, so keep the action to something that is also reachable elsewhere.
