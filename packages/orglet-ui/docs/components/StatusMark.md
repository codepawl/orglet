---
name: StatusMark
exports: StatusMark, StatusMarkState, StatusMarkTone, StatusMarkVariant
group: Feedback
summary: A small status glyph for the left of a title, with a different shape for every state.
---

## When to use

- The state of a thing beside its title: idle, waiting, paused, working, done, needs a person.
- Any outcome or state in a list row, a result page or an inline notice. The mark leads, left of the text.
- `decorative` when the mark sits inside a control that already has a name.

## When not to

- A message that goes away: use `showToast` from `Toaster`.
- A wait for content: use `Skeleton`. The kit has no spinner.
- Colour alone to tell states apart: pick the `variant`, since each has its own shape.
- Deciding which state a thing is in: that belongs to the application.

## Example

```tsx
import { StatusMark, type StatusMarkState } from '@codepawlhq/orglet-ui';

const state: StatusMarkState = { variant: 'filled', tone: 'success' };

<li>
  <StatusMark variant={state.variant} tone={state.tone} label="Done, ready to read" />
  <span>Weekly report</span>
</li>
<li>
  <StatusMark variant="asking" tone="accent" label="Waiting for your answer" />
  <span>Install the update</span>
</li>
```

## Props

### StatusMark

| Prop | Type | Default | What it does |
|---|---|---|---|
| `variant` | `StatusMarkVariant` | required | Picks the shape. |
| `tone` | `StatusMarkTone` | `'muted'` | Picks the colour. |
| `label` | `string` | required | What a screen reader hears. Also the tooltip. |
| `decorative` | `boolean` | | Hides the mark from assistive technology, for use inside a named control. |
| `className` | `string` | | Applied last, so it overrides the kit's classes. |

### StatusMarkVariant

`'empty' | 'dashed' | 'paused' | 'filled' | 'busy' | 'asking'`. Each draws a different glyph.

- `empty`: a dotted ring, nothing to report.
- `dashed`: the dotted ring, a touch heavier, waiting on something outside the person. With `tone: 'error'` it becomes an exclamation stroke.
- `paused`: two bars, stopped until the person goes on.
- `filled`: a tick, something new to read. With `tone: 'error'` it becomes an exclamation stroke.
- `busy`: a ring with a gap, turning.
- `asking`: a head and shoulders, waiting for the person to answer, allow or review.

### StatusMarkTone

`'muted' | 'success' | 'error' | 'working' | 'accent'`. States that carry news sit on a soft tint of their own colour. `muted` stays plain.

### StatusMarkState

A type: `{ variant: StatusMarkVariant; tone: StatusMarkTone }`. Use it to keep a state in one value.

## Accessibility

- Unless `decorative`, it is `role="status"` with `aria-label` set to `label`. The glyph itself is `aria-hidden`.
- The shape differs per variant, so the state is readable without colour.
- Put the mark left of the title, never right.
