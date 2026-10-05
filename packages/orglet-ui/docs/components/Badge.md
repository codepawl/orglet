---
name: Badge
exports: Badge
group: Display
summary: A small pill for a count or a short state word.
---

## When to use

- A count beside a label: unread messages, items in a list.
- A short state word beside a title: Draft, Passed, Failed.
- `tone` to say how it should weigh: `neutral` (the default), `accent`, `success`, `warning` or `error`.

## When not to

- A state shown by colour alone: pair it with a word, or put a `StatusMark` beside it.
- A long sentence or an action: a badge is a label, not a button.
- Anything that needs to be read first: a badge is a hint beside the main text.

## Example

```tsx
import { Badge, StatusMark } from '@codepawlhq/orglet-ui';

<Badge tone="accent" count={142} />
<StatusMark variant="filled" tone="success" label="Passed" decorative />
<Badge tone="success">Passed</Badge>
```

## Props

Every `<span>` prop passes through.

| Prop | Type | Default | What it does |
|---|---|---|---|
| `tone` | `'neutral' \| 'accent' \| 'success' \| 'warning' \| 'error'` | `'neutral'` | The colour, as a pale tint with readable text in both themes. |
| `count` | `number` | | A number to show instead of `children`. |
| `max` | `number` | `99` | The most a count shows exactly. Above it the badge reads `99+`. |
| `children` | `ReactNode` | | The word shown when there is no `count`. |
| `className` | `string` | | Applied last, so it overrides the kit's classes. |

## Accessibility

- Meaning never rests on colour alone. A state badge says its state in words, or sits beside a `StatusMark` whose shape differs per state.
- It is a plain `<span>`, so a screen reader reads its text where it stands. Put the count's context in the text around it ("Messages 3") when the number alone would be unclear.
- The tint and text colours are chosen to keep WCAG AA contrast in the light and dark themes.
