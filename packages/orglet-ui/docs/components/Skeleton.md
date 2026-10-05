---
name: Skeleton
exports: Skeleton, SkeletonText, SkeletonGroup
group: Feedback
summary: The only shape a wait may take: bars, blocks and circles where content will be.
---

## When to use

- A wait that cannot be hidden by fetching early: a list, a page or a picture on its way.
- `Skeleton` for one shape: a `line`, a `block` or a `circle`.
- `SkeletonText` for a paragraph of several bars.
- `SkeletonGroup` around the shapes of one thing, so a screen reader hears one sentence.

## When not to

- A spinner: the kit has none and will not get one. Show the shape of what is coming.
- A result or an error: use `StatusMark`.
- A short confirmation after an action: use `showToast` from `Toaster`.
- Content that is already there: render it.

## Example

```tsx
import { Skeleton, SkeletonGroup, SkeletonText } from '@codepawlhq/orglet-ui';

<SkeletonGroup label="Loading chats">
  <Skeleton shape="circle" width={32} height={32} />
  <Skeleton width="40%" />
  <SkeletonText lines={3} />
</SkeletonGroup>
```

## Props

### Skeleton

| Prop | Type | Default | What it does |
|---|---|---|---|
| `shape` | `'line' \| 'block' \| 'circle'` | `'line'` | A bar for text, a block for a paragraph or picture, a circle for a face. |
| `width` | `string \| number` | | A CSS length or a percentage. A line defaults to the full width of its box. |
| `height` | `string \| number` | | A CSS length. |
| `delay` | `number` | | Seconds into the shimmer it starts, so stacked lines do not pulse together. |
| `className` | `string` | | Applied last, so it overrides the kit's classes. |
| `style` | `CSSProperties` | | Merged with the sizing props. |

### SkeletonGroup

| Prop | Type | Default | What it does |
|---|---|---|---|
| `label` | `string` | required | The sentence a screen reader hears, such as "Loading chats". |
| `children` | `ReactNode` | required | The skeleton shapes. |
| `className` | `string` | | Applied last, so it overrides the kit's classes. |

### SkeletonText

| Prop | Type | Default | What it does |
|---|---|---|---|
| `lines` | `number` | `3` | How many bars. The last one is shorter. |
| `className` | `string` | | Applied last, so it overrides the kit's classes. |

## Accessibility

- Every skeleton shape is `aria-hidden`. The group is a polite `status` region carrying the one `label`.
- The sentence is announced once and goes quiet when real content replaces the group.
- The shimmer runs under a second a pass and stops under `prefers-reduced-motion`.
