---
name: Progress
exports: Progress
group: Feedback
summary: A bar for work whose size is known, such as 3 of 12 files.
---

## When to use

- Work with a known total: files copied, a step of a few, an upload with a size.
- `valueText` to say it in words next to the bar: `3 of 12`, `40%`.

## When not to

- A wait of unknown length: that is not progress. Show the shape of what is coming with a `Skeleton`. The kit has no spinner and no indeterminate bar.
- A fixed amount used, such as storage: that is a measurement, not work under way.

## Example

```tsx
import { Progress } from '@codepawlhq/orglet-ui';

<Progress label="Files copied" value={3} max={12} valueText="3 of 12" />
```

## Props

Every `<div>` prop passes through.

| Prop | Type | Default | What it does |
|---|---|---|---|
| `label` | `string` | | The accessible name. Required. |
| `value` | `number` | | How far along. Held between `0` and `max`. |
| `max` | `number` | `100` | The value that means done. |
| `valueText` | `string` | | The progress in words, shown beside the bar and announced instead of the bare number. |
| `className` | `string` | | Applied last, so it overrides the kit's classes. |

## Accessibility

- The bar is `role="progressbar"` with `aria-valuenow`, `aria-valuemin` and `aria-valuemax`, named by `label`. `valueText` becomes `aria-valuetext`.
- The visible text is hidden from assistive technology, since the bar already announces it.
- Nothing is announced on every change. When a finished state matters, tell the person in text or with a toast.
